import type { ExtensionMessage, ExtensionResponse } from '../types/messages';
import type { FormField, PageContext } from '../types/models';

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

const detectFieldsDirectly = async (tabId: number): Promise<ExtensionResponse> => {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    func: (): FormField[] => {
      const fixed = /first.?name|last.?name|full.?name|email|phone|mobile|address|city|province|state|postal|zip|linkedin|website|portfolio/i;
      const reusable = /years?.*(experience|work)|job title|education|degree|certif|skill|authorization|sponsor|language/i;
      const selectorFor = (element: Element, index: number) => {
        const id = element.getAttribute('id');
        if (id) return `#${CSS.escape(id)}`;
        const name = element.getAttribute('name');
        if (name) return `${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
        return `${element.tagName.toLowerCase()}:nth-of-type(${index + 1})`;
      };
      const labelFor = (element: Element) => {
        const id = element.getAttribute('id');
        const explicit = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent : '';
        const parent = element.closest('label')?.textContent;
        const sibling = element.previousElementSibling?.textContent;
        return (explicit || parent || element.getAttribute('aria-label') || element.getAttribute('placeholder') || sibling || element.getAttribute('name') || 'Unnamed field').replace(/\s+/g, ' ').trim();
      };
      return [...document.querySelectorAll('input, textarea, select, [contenteditable="true"]')]
        .filter((element) => !(element as HTMLInputElement).disabled && (element as HTMLElement).offsetParent !== null)
        .map((element, index) => {
          const input = element as HTMLInputElement;
          const type = element.tagName.toLowerCase() === 'textarea' ? 'textarea' : element.tagName.toLowerCase() === 'select' ? 'select' : element.getAttribute('contenteditable') === 'true' ? 'contenteditable' : input.type || 'text';
          const label = labelFor(element);
          const category = type === 'file' ? 'ignore' : fixed.test(label) ? 'fixed' : reusable.test(label) ? 'reusable' : 'llm';
          const confidence = category === 'ignore' ? 0.99 : category === 'fixed' ? 0.98 : category === 'reusable' ? 0.9 : 0.72;
          return { id: `field-${Date.now()}-${index}`, selector: selectorFor(element, index), label, name: input.name || input.id || '', type, value: input.value || element.textContent?.trim() || '', required: input.required || element.getAttribute('aria-required') === 'true', category, status: 'detected', confidence } as FormField;
        });
    },
  });
  if (!result?.result) throw new Error('Form fields were empty.');
  return { ok: true, fields: result.result as FormField[] };
};

const fillFieldsDirectly = async (tabId: number, fields: Array<{ selector: string; value: string }>): Promise<ExtensionResponse> => {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    args: [fields],
    func: (items: Array<{ selector: string; value: string }>) => {
      let filled = 0;
      for (const item of items) {
        const element = document.querySelector(item.selector) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement | null;
        if (!element) continue;
        if (element instanceof HTMLSelectElement) {
          const option = [...element.options].find((candidate) => candidate.text.toLowerCase().includes(item.value.toLowerCase()) || candidate.value.toLowerCase() === item.value.toLowerCase());
          element.value = option?.value || item.value;
        } else if (element.isContentEditable) {
          element.textContent = item.value;
        } else {
          const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
          setter?.call(element, item.value);
          if (!setter) (element as HTMLInputElement).value = item.value;
        }
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        filled += 1;
      }
      return filled;
    },
  });
  return { ok: true, filled: Number(result?.result || 0) };
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
        if (message.type === 'DETECT_FORM_FIELDS') {
          try { sendResponse(await detectFieldsDirectly(tabId)); return; } catch { /* continue with a user-facing error */ }
        }
        if (message.type === 'FILL_FORM_FIELDS') {
          try { sendResponse(await fillFieldsDirectly(tabId, message.fields)); return; } catch { /* continue with a user-facing error */ }
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
