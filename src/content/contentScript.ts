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
  ).slice(0, 500);
};

function capture(): PageContext {
  const text = normalizeText(document.body?.innerText || "");
  const jsonObjects: unknown[] = [];
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const value = JSON.parse(script.textContent || 'null');
      jsonObjects.push(...(Array.isArray(value) ? value : [value]));
    } catch { /* Ignore invalid site metadata. */ }
  }
  const flatten = (value: unknown): Record<string, unknown>[] => {
    if (!value || typeof value !== 'object') return [];
    if (Array.isArray(value)) return value.flatMap(flatten);
    const object = value as Record<string, unknown>;
    return [object, ...flatten(object['@graph'])];
  };
  const structured = jsonObjects.flatMap(flatten).find((object) => {
    const type = object['@type'];
    return (Array.isArray(type) ? type : [type]).some((item) => String(item).toLowerCase() === 'jobposting');
  });
  const asObject = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const textValue = (value: unknown) => typeof value === 'string' ? normalizeText(value.replace(/<[^>]+>/g, ' ')) : '';
  const organization = asObject(structured?.hiringOrganization);
  const identifier = asObject(structured?.identifier);
  const locationObject = Array.isArray(structured?.jobLocation) ? asObject(structured?.jobLocation[0]) : asObject(structured?.jobLocation);
  const address = asObject(locationObject.address);
  const salary = asObject(structured?.baseSalary);
  const salaryValue = asObject(salary.value);
  const addressText = [address.addressLocality, address.addressRegion, address.addressCountry].map(textValue).filter(Boolean).join(', ');
  const salaryText = [salary.currency, salaryValue.minValue, salaryValue.maxValue, salaryValue.unitText].map((value) => value == null ? '' : String(value)).filter(Boolean).join(' ');
  const applicationLink = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].find((link) => /apply|application/i.test(`${link.textContent} ${link.getAttribute('aria-label') || ''}`));
  const canonicalUrl = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || location.href;
  const pdfLinks = [...new Set([...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
    .map((link) => link.href)
    .filter((href) => /\.pdf(?:$|[?#])/i.test(href)))].slice(0, 10);
  const structuredRemote = textValue(structured?.jobLocationType).toLowerCase();
  const metadata = {
    title: textValue(structured?.title) || normalizeText(document.querySelector('h1')?.textContent || '') || document.title,
    company: textValue(organization.name) || normalizeText(document.querySelector('[data-company-name], .company-name, [class*="company-name"]')?.textContent || '') || undefined,
    location: addressText || textValue(structured?.applicantLocationRequirements) || undefined,
    salary: salaryText || undefined,
    employmentType: Array.isArray(structured?.employmentType) ? structured?.employmentType.map(String).join(', ') : textValue(structured?.employmentType) || undefined,
    externalId: textValue(identifier.value || identifier.name) || undefined,
    postedAt: textValue(structured?.datePosted) || undefined,
    sourceUrl: canonicalUrl,
    applicationUrl: applicationLink?.href || location.href,
    description: textValue(structured?.description).slice(0, 20000) || text.slice(0, 10000),
    remoteType: structuredRemote.includes('telecommute') || structuredRemote.includes('remote')
      ? ("remote" as const)
      : /hybrid/i.test(text)
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
    pdfLinks,
    metadata,
    capturedAt: new Date().toISOString(),
  };
}

function detect(): FormField[] {
  const ignoredInputTypes = new Set(["hidden", "submit", "button", "reset", "image", "password"]);
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
        options: element instanceof HTMLSelectElement ? [...element.options].map((option) => ({ label: normalizeText(option.text), value: option.value })) : undefined,
        required: input.required || element.getAttribute("aria-required") === "true",
      });
    });
}

function fillFile(selector: string, fileName: string, mimeType: string, dataUrl: string) {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLInputElement) || element.type !== 'file' || element.disabled) return false;
  const encoded = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  const transfer = new DataTransfer();
  transfer.items.add(new File([bytes], fileName, { type: mimeType }));
  element.files = transfer.files;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  return element.files.length === 1;
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
      const checked = field.checked ?? /^(true|1|yes|on)$/i.test(field.value);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
      setter?.call(element, checked);
      if (!setter) element.checked = checked;
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
      else if (message.type === "FILL_FILE_FIELD")
        sendResponse({ ok: true, attached: fillFile(message.selector, message.fileName, message.mimeType, message.dataUrl) });
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
