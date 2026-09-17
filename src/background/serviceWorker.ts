import type { ExtensionMessage, ExtensionResponse } from '../types/messages';

chrome.runtime.onInstalled.addListener(() => { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined); });
chrome.action.onClicked.addListener((tab) => { if (tab.id) chrome.sidePanel.open({ tabId: tab.id }).catch(() => undefined); });
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse: (response: ExtensionResponse) => void) => {
  if (message.type === 'PING') { sendResponse({ ok: true, pong: true }); return false; }
  const tabId = sender.tab?.id ?? message.tabId;
  if (!tabId) { sendResponse({ ok: false, error: 'No active tab available.' }); return false; }
  chrome.tabs.sendMessage(tabId, message).then((response: ExtensionResponse) => sendResponse(response)).catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unable to reach page.' }));
  return true;
});
