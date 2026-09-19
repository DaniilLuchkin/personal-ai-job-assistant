import type { FormField, PageContext } from './models';

export type ExtensionMessage =
  | { type: 'CAPTURE_PAGE_CONTEXT'; tabId?: number }
  | { type: 'DETECT_FORM_FIELDS'; tabId?: number }
  | { type: 'FILL_FORM_FIELDS'; tabId?: number; fields: Array<Pick<FormField, 'selector' | 'value' | 'checked'>> }
  | { type: 'CONFIGURE_PARSER_ALARM' }
  | { type: 'PING' };

export type ExtensionResponse =
  | { ok: true; context: PageContext }
  | { ok: true; fields: FormField[] }
  | { ok: true; filled: number }
  | { ok: true; configured: true }
  | { ok: true; pong: true }
  | { ok: false; error: string };
