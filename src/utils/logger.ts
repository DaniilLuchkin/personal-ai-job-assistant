let enabled = false;

export const configureDebugLogging = (value: boolean) => { enabled = value; };

export const debugLog = (scope: 'Session' | 'Parser' | 'LLM' | 'Form Detection' | 'Storage', message: string, safeDetails?: Record<string, string | number | boolean>) => {
  if (!enabled) return;
  if (safeDetails) console.debug(`[${scope}] ${message}`, safeDetails);
  else console.debug(`[${scope}] ${message}`);
};
