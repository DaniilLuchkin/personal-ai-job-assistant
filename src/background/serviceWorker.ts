import type { ExtensionMessage, ExtensionResponse } from "../types/messages";
import type { FormField, PageContext } from "../types/models";
import { repos } from "../repositories/repositories";
import { ApifyProvider } from "../services/parser/ApifyProvider";
import { findDuplicateJob } from "../services/parser/deduplication";
import { normalizeExternalJob } from "../services/parser/normalization";
import { syncRecord } from "../services/api/backendClient";

const parserAlarmName = "orbit-job-parser";

const parserAlarmOptions = (schedule: string): chrome.alarms.AlarmCreateInfo => {
  const everyMinutes = schedule.trim().match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (everyMinutes) {
    return { periodInMinutes: Math.max(1, Number(everyMinutes[1])) };
  }
  const daily = schedule.trim().match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+\*$/);
  if (daily) {
    const next = new Date();
    next.setUTCHours(Number(daily[2]), Number(daily[1]), 0, 0);
    if (next.getTime() <= Date.now()) next.setUTCDate(next.getUTCDate() + 1);
    return { when: next.getTime(), periodInMinutes: 24 * 60 };
  }
  return { periodInMinutes: 24 * 60 };
};

const configureParserAlarm = async () => {
  await chrome.alarms.clear(parserAlarmName);
  const settings = await repos.settings.get();
  if (!settings?.parserEnabled || settings.parserExecution === 'server' || !settings.apifyApiKey || !settings.apifyActor) return;
  await chrome.alarms.create(parserAlarmName, parserAlarmOptions(settings.parserSchedule));
};

const runScheduledParser = async () => {
  const settings = await repos.settings.get();
  if (!settings?.parserEnabled || settings.parserExecution === 'server' || !settings.apifyApiKey || !settings.apifyActor) return;
  const provider = new ApifyProvider(settings.apifyApiKey, settings.apifyActor);
  const jobs = await repos.jobs.list();
  const imported = await provider.fetchJobs(settings);
  for (const item of imported) {
    const candidate = normalizeExternalJob(item as unknown as Record<string, unknown>);
    const existing = findDuplicateJob(candidate, jobs);
    const job = existing
      ? { ...existing, ...candidate, id: existing.id, discoveredAt: existing.discoveredAt, status: existing.status, statusHistory: existing.statusHistory, notes: existing.notes, lastActivityAt: new Date().toISOString() }
      : candidate;
    await repos.jobs.put(job);
    await syncRecord(settings, "job", job.id, job).catch(() => undefined);
    if (existing) Object.assign(existing, job);
    else jobs.push(job);
  }
};

const capturePageDirectly = async (tabId: number): Promise<ExtensionResponse> => {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    func: (): PageContext => {
      const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
      const text = normalize(document.body?.innerText || "");
      const metadata = {
        title: document.title,
        sourceUrl: location.href,
        applicationUrl: location.href,
        description: text.slice(0, 10000),
        remoteType: /hybrid/i.test(text)
          ? ("hybrid" as const)
          : /remote/i.test(text)
            ? ("remote" as const)
            : /on[- ]site/i.test(text)
              ? ("on-site" as const)
              : ("unknown" as const),
      };
      return {
        title: document.title,
        url: location.href,
        htmlSnapshot: document.documentElement.outerHTML.slice(0, 120000),
        extractedText: text.slice(0, 20000),
        metadata,
        capturedAt: new Date().toISOString(),
      };
    },
  });
  if (!result?.result) throw new Error("Page context was empty.");
  return { ok: true, context: result.result as PageContext };
};

const detectFieldsDirectly = async (tabId: number): Promise<ExtensionResponse> => {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (): FormField[] => {
      const fixed = /first.?name|last.?name|full.?name|email|phone|mobile|address|city|province|state|postal|zip|linkedin|website|portfolio/i;
      const reusable = /years?.*(experience|work)|job title|education|degree|certif|skill|authorization|sponsor|language/i;
      const sensitive = /password|social security|social insurance|\bssn\b|\bsin\b|date of birth|birth date|gender|race|ethnicity|disability|veteran|sexual orientation/i;
      const ignoredInputTypes = new Set(["hidden", "submit", "button", "reset", "image", "password"]);
      const isUnique = (selector: string) => {
        try {
          return document.querySelectorAll(selector).length === 1;
        } catch {
          return false;
        }
      };
      const selectorFor = (element: Element) => {
        const html = element as HTMLElement;
        if (html.id) {
          const byId = `#${CSS.escape(html.id)}`;
          if (isUnique(byId)) return byId;
        }
        const name = element.getAttribute("name");
        if (name) {
          const byName = `${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
          if (isUnique(byName)) return byName;
        }
        const path: string[] = [];
        let current: Element | null = element;
        while (current && current !== document.body && current !== document.documentElement) {
          const parent: HTMLElement | null = current.parentElement;
          if (!parent) break;
          const siblings = [...parent.children].filter(
            (child) => child.tagName === current?.tagName,
          );
          path.unshift(
            `${current.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(current) + 1})`,
          );
          const candidate = path.join(" > ");
          if (isUnique(candidate)) return candidate;
          current = parent;
        }
        return path.join(" > ") || element.tagName.toLowerCase();
      };
      const labelFor = (element: Element) => {
        const id = element.getAttribute("id");
        const explicit = id
          ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent
          : "";
        const labelledBy = element
          .getAttribute("aria-labelledby")
          ?.split(/\s+/)
          .map((value) => document.getElementById(value)?.textContent)
          .filter(Boolean)
          .join(" ");
        const parent = element.closest("label")?.textContent;
        const fieldset = element.closest("fieldset")?.querySelector("legend")?.textContent;
        const sibling = element.previousElementSibling?.textContent;
        return (explicit || labelledBy || element.getAttribute("aria-label") || parent || fieldset || element.getAttribute("placeholder") || sibling || element.getAttribute("name") || "Unnamed field").replace(/\s+/g, " ").trim().slice(0, 500);
      };
      return [...document.querySelectorAll('input, textarea, select, [contenteditable="true"]')]
        .filter((element) => {
          const input = element as HTMLInputElement;
          return !input.disabled && !ignoredInputTypes.has((input.type || "text").toLowerCase()) && (element as HTMLElement).offsetParent !== null;
        })
        .map((element, index) => {
          const input = element as HTMLInputElement;
          const tag = element.tagName.toLowerCase();
          const inputType = (input.type || "text").toLowerCase();
          const type = tag === "textarea" ? "textarea" : tag === "select" ? "select" : element.getAttribute("contenteditable") === "true" ? "contenteditable" : inputType;
          const label = labelFor(element);
          const isChoice = inputType === "checkbox" || inputType === "radio";
          const category = sensitive.test(label) ? "ignore" : type === "file" ? (/resume|\bcv\b|curriculum/i.test(label) ? "reusable" : "ignore") : fixed.test(label) ? "fixed" : reusable.test(label) ? "reusable" : "llm";
          const confidence = category === 'ignore' ? 0.99 : type === "file" ? 0.98 : category === "fixed" ? 0.98 : category === "reusable" ? 0.9 : 0.72;
          const options = element instanceof HTMLSelectElement ? [...element.options].map((option) => ({ label: option.text.replace(/\s+/g, ' ').trim(), value: option.value })) : undefined;
          return { id: `field-${Date.now()}-${index}`, selector: selectorFor(element), label, name: input.name || input.id || "", type, value: isChoice ? input.value || label : input.value || element.textContent?.trim() || "", checked: isChoice ? input.checked : undefined, options, required: input.required || element.getAttribute("aria-required") === "true", category, status: "detected", confidence } as FormField;
        });
    },
  });
  const fields = results.flatMap((result) => (result.result || []).map((field) => ({ ...field, id: `${field.id}-frame-${result.frameId}`, frameId: result.frameId })));
  return { ok: true, fields };
};

const fillFieldsDirectly = async (
  tabId: number,
  fields: Array<{ selector: string; frameId?: number; value: string; checked?: boolean }>,
): Promise<ExtensionResponse> => {
  const grouped = new Map<number, typeof fields>();
  for (const field of fields) grouped.set(field.frameId ?? 0, [...(grouped.get(field.frameId ?? 0) || []), field]);
  let filled = 0;
  for (const [frameId, frameFields] of grouped) {
    const [result] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    args: [frameFields],
    func: (items: Array<{ selector: string; frameId?: number; value: string; checked?: boolean }>) => {
      let filled = 0;
      for (const item of items) {
        const element = document.querySelector(item.selector) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement | null;
        if (!element || (element as HTMLInputElement).disabled) continue;
        if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
          const checked = item.checked ?? /^(true|1|yes|on)$/i.test(item.value);
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set;
          setter?.call(element, checked);
          if (!setter) element.checked = checked;
        } else if (element instanceof HTMLSelectElement) {
          const expected = item.value.toLowerCase();
          const option = [...element.options].find((candidate) => candidate.text.toLowerCase().includes(expected) || candidate.value.toLowerCase() === expected);
          element.value = option?.value || item.value;
        } else if (element.isContentEditable) {
          element.textContent = item.value;
        } else {
          const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
          setter?.call(element, item.value);
          if (!setter) (element as HTMLInputElement).value = item.value;
        }
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        filled += 1;
      }
      return filled;
    },
    });
    filled += Number(result?.result || 0);
  }
  return { ok: true, filled };
};

const fillFileDirectly = async (tabId: number, selector: string, frameId: number | undefined, fileName: string, mimeType: string, dataUrl: string): Promise<ExtensionResponse> => {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId ?? 0] },
    args: [selector, fileName, mimeType, dataUrl],
    func: (targetSelector: string, targetFileName: string, targetMimeType: string, targetDataUrl: string) => {
      const element = document.querySelector(targetSelector);
      if (!(element instanceof HTMLInputElement) || element.type !== 'file' || element.disabled) return false;
      const encoded = targetDataUrl.includes(',') ? targetDataUrl.slice(targetDataUrl.indexOf(',') + 1) : targetDataUrl;
      const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], targetFileName, { type: targetMimeType }));
      element.files = transfer.files;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return element.files.length === 1;
    },
  });
  return { ok: true, attached: Boolean(result?.result) };
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  configureParserAlarm().catch(() => undefined);
});

chrome.runtime.onStartup.addListener(() => {
  configureParserAlarm().catch(() => undefined);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === parserAlarmName) runScheduledParser().catch(() => undefined);
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) chrome.sidePanel.open({ tabId: tab.id }).catch(() => undefined);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void repos.sessions
    .list()
    .then(async (sessions) => {
      const stamp = new Date().toISOString();
      const settings = await repos.settings.get();
      await Promise.all(
        sessions
          .filter((session) => session.status === "active" && session.tabId === tabId)
          .map(async (session) => {
            const closed: import('../types/models').JobSession = {
              ...session,
              status: "closed",
              updatedAt: stamp,
              events: [
                ...session.events,
                { id: `event-${Date.now()}`, type: "tab_closed", timestamp: stamp },
              ],
            };
            await repos.sessions.put(closed);
            if (settings) await syncRecord(settings, 'session', closed.id, closed).catch(() => undefined);
          }),
      );
    })
    .catch(() => undefined);
});

chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    sender,
    sendResponse: (response: ExtensionResponse) => void,
  ) => {
    if (message.type === "CONFIGURE_PARSER_ALARM") {
      configureParserAlarm()
        .then(() => sendResponse({ ok: true, configured: true }))
        .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Unable to configure parser schedule" }));
      return true;
    }
    if (message.type === "PING") {
      sendResponse({ ok: true, pong: true });
      return false;
    }
    const tabId = sender.tab?.id ?? message.tabId;
    if (!tabId) {
      sendResponse({ ok: false, error: "No active tab available." });
      return false;
    }
    if (message.type === "CAPTURE_SCREENSHOT") {
      chrome.tabs.get(tabId)
        .then((tab) => chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 60 }))
        .then((screenshot) => sendResponse({ ok: true, screenshot }))
        .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unable to capture screenshot' }));
      return true;
    }
    if (message.type === 'DETECT_FORM_FIELDS') {
      detectFieldsDirectly(tabId).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unable to detect fields' }));
      return true;
    }
    if (message.type === 'FILL_FORM_FIELDS') {
      fillFieldsDirectly(tabId, message.fields).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unable to fill fields' }));
      return true;
    }
    if (message.type === 'FILL_FILE_FIELD') {
      fillFileDirectly(tabId, message.selector, message.frameId, message.fileName, message.mimeType, message.dataUrl).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unable to attach resume' }));
      return true;
    }
    const relay = () => chrome.tabs.sendMessage(tabId, message);
    relay()
      .then((response: ExtensionResponse) => sendResponse(response))
      .catch(async () => {
        try {
          await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
          sendResponse(await relay());
        } catch (injectionError: unknown) {
          try {
            if (message.type === "CAPTURE_PAGE_CONTEXT") {
              try {
                sendResponse(await capturePageDirectly(tabId));
                return;
              } catch {
                // Continue with a user-facing error.
              }
            }
            const tab = await chrome.tabs.get(tabId);
            const url = tab.url || "";
            const restricted = /^(chrome|edge|about|devtools|chrome-extension):/i.test(url) || /chromewebstore\.google\.com/i.test(url);
            const technical = injectionError instanceof Error ? injectionError.message : String(injectionError);
            sendResponse({ ok: false, error: restricted ? "This Chrome page does not allow extensions to read it. Open the vacancy on a regular http(s) page." : `Could not initialize page assistant (${technical}). Reload the vacancy tab and try again.` });
          } catch {
            sendResponse({ ok: false, error: "Unable to access the active page. Reload the vacancy tab and try again." });
          }
        }
      });
    return true;
  },
);
