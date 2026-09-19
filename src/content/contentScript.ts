import type { ExtensionMessage, ExtensionResponse } from "../types/messages";
import type { FormField, PageContext } from "../types/models";
import { createFormField } from "../services/form/fieldDetection";
import { normalizeText } from "../utils/text";

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
    const tag = current.tagName.toLowerCase();
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) break;
    const siblings = [...parent.children].filter(
      (child) => child.tagName === current?.tagName,
    );
    const position = siblings.indexOf(current) + 1;
    path.unshift(`${tag}:nth-of-type(${position})`);
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
  return normalizeText(
    explicit ||
      labelledBy ||
      element.getAttribute("aria-label") ||
      parent ||
      fieldset ||
      element.getAttribute("placeholder") ||
      sibling ||
      element.getAttribute("name") ||
      "Unnamed field",
  );
};

function capture(): PageContext {
  const text = normalizeText(document.body?.innerText || "");
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
}

function detect(): FormField[] {
  const ignoredInputTypes = new Set(["hidden", "submit", "button", "reset", "image"]);
  return [...document.querySelectorAll('input, textarea, select, [contenteditable="true"]')]
    .filter((element) => {
      const input = element as HTMLInputElement;
      return (
        !input.disabled &&
        !ignoredInputTypes.has((input.type || "text").toLowerCase()) &&
        (element as HTMLElement).offsetParent !== null
      );
    })
    .map((element) => {
      const input = element as HTMLInputElement;
      const tag = element.tagName.toLowerCase();
      const inputType = (input.type || "text").toLowerCase();
      const type =
        tag === "textarea"
          ? "textarea"
          : tag === "select"
            ? "select"
            : element.getAttribute("contenteditable") === "true"
              ? "contenteditable"
              : inputType;
      const label = labelFor(element);
      const isChoice = inputType === "checkbox" || inputType === "radio";
      return createFormField({
        selector: selectorFor(element),
        label,
        name: input.name || input.id || "",
        type,
        value: isChoice
          ? input.value || label
          : input.value || element.textContent?.trim() || "",
        checked: isChoice ? input.checked : undefined,
        required: input.required || element.getAttribute("aria-required") === "true",
      });
    });
}

function fill(fields: Array<{ selector: string; value: string; checked?: boolean }>) {
  let filled = 0;
  for (const field of fields) {
    const element = document.querySelector(field.selector) as
      | HTMLInputElement
      | HTMLTextAreaElement
      | HTMLSelectElement
      | HTMLElement
      | null;
    if (!element || (element as HTMLInputElement).disabled) continue;
    if (
      element instanceof HTMLInputElement &&
      (element.type === "checkbox" || element.type === "radio")
    ) {
      element.checked = field.checked ?? /^(true|1|yes|on)$/i.test(field.value);
    } else if (element instanceof HTMLSelectElement) {
      const expected = field.value.toLowerCase();
      const option = [...element.options].find(
        (item) =>
          item.text.toLowerCase().includes(expected) ||
          item.value.toLowerCase() === expected,
      );
      element.value = option?.value || field.value;
    } else if (element.isContentEditable) {
      element.textContent = field.value;
    } else {
      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(element),
        "value",
      )?.set;
      setter?.call(element, field.value);
      if (!setter) (element as HTMLInputElement).value = field.value;
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    filled += 1;
  }
  return filled;
}

chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    _sender,
    sendResponse: (response: ExtensionResponse) => void,
  ) => {
    try {
      if (message.type === "CAPTURE_PAGE_CONTEXT")
        sendResponse({ ok: true, context: capture() });
      else if (message.type === "DETECT_FORM_FIELDS")
        sendResponse({ ok: true, fields: detect() });
      else if (message.type === "FILL_FORM_FIELDS")
        sendResponse({ ok: true, filled: fill(message.fields) });
      else sendResponse({ ok: true, pong: true });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Content script failed",
      });
    }
    return true;
  },
);
