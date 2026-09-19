import type { ExtensionMessage, ExtensionResponse } from '../types/messages';

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
