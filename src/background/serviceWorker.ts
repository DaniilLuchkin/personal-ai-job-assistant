import type { ExtensionMessage, ExtensionResponse } from '../types/messages';
import type { PageContext } from '../types/models';

const capturePageDirectly = async (tabId: number): Promise<ExtensionResponse> => {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    func: (): PageContext => {
      const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
      const text = normalize(document.body?.innerText || '');
      const metadata = { title: document.title, sourceUrl: location.href, applicationUrl: location.href, description: text.slice(0, 10000), remoteType: /hybrid/i.test(text) ? 'hybrid' as const : /remote/i.test(text) ? 'remote' as const : /on[- ]site/i.test(text) ? 'on-site' as const : 'unknown' as const };
      return { title: document.title, url: location.href, htmlSnapshot: document.documentElement.outerHTML.slice(0, 120000), extractedText: text.slice(0, 20000), metadata, capturedAt: new Date().toISOString() };
    },
  });
  if (!result?.result) throw new Error('Page context was empty.');
  return { ok: true, context: result.result as PageContext };
};

chrome.runtime.onInstalled.addListener(() => { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined); });
chrome.action.onClicked.addListener((tab) => { if (tab.id) chrome.sidePanel.open({ tabId: tab.id }).catch(() => undefined); });
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse: (response: ExtensionResponse) => void) => {
  if (message.type === 'PING') { sendResponse({ ok: true, pong: true }); return false; }
  const tabId = sender.tab?.id ?? message.tabId;
  if (!tabId) { sendResponse({ ok: false, error: 'No active tab available.' }); return false; }
  const relay = () => chrome.tabs.sendMessage(tabId, message);
  relay().then((response: ExtensionResponse) => sendResponse(response)).catch(async () => {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      sendResponse(await relay());
    } catch (injectionError: unknown) {
      try {
        if (message.type === 'CAPTURE_PAGE_CONTEXT') {
          try { sendResponse(await capturePageDirectly(tabId)); return; } catch { /* continue with a user-facing error */ }
        }
        const tab = await chrome.tabs.get(tabId);
        const url = tab.url || '';
        const restricted = /^(chrome|edge|about|devtools|chrome-extension):/i.test(url) || /chromewebstore\.google\.com/i.test(url);
        const technical = injectionError instanceof Error ? injectionError.message : String(injectionError);
        sendResponse({ ok: false, error: restricted ? 'This Chrome page does not allow extensions to read it. Open the vacancy on a regular http(s) page.' : `Could not initialize page assistant (${technical}). Reload the vacancy tab and try again.` });
      } catch {
        sendResponse({ ok: false, error: 'Unable to access the active page. Reload the vacancy tab and try again.' });
      }
    }
  });
  return true;
});
