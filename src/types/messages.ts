import type { FormField, PageContext } from './models';

export type ExtensionMessage =
  | { type: 'CAPTURE_PAGE_CONTEXT'; tabId?: number }
  | { type: 'CAPTURE_SCREENSHOT'; tabId?: number }
  | { type: 'DETECT_FORM_FIELDS'; tabId?: number }
  | { type: 'FILL_FORM_FIELDS'; tabId?: number; fields: Array<Pick<FormField, 'selector' | 'frameId' | 'value' | 'checked'>> }
  | { type: 'FILL_FILE_FIELD'; tabId?: number; selector: string; frameId?: number; fileName: string; mimeType: string; dataUrl: string }
  | { type: 'CONFIGURE_PARSER_ALARM' }
  | { type: 'PING' };

export type ExtensionResponse =
  | { ok: true; context: PageContext }
  | { ok: true; screenshot: string }
  | { ok: true; fields: FormField[] }
  | { ok: true; filled: number }
  | { ok: true; attached: boolean }
  | { ok: true; configured: true }
  | { ok: true; pong: true }
  | { ok: false; error: string };
