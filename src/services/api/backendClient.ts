import type { Settings } from "../../types/models";

const baseUrl = (settings: Settings) => settings.backendUrl.replace(/\/$/, "");
const headers = (settings: Settings) => ({
  "Content-Type": "application/json",
  ...(settings.backendToken
    ? { Authorization: `Bearer ${settings.backendToken}` }
    : {}),
});

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = 15_000,
  attempts = 2,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(input, init, timeoutMs);
      if (response.ok || attempt === attempts - 1) return response;
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error("Request failed");
}

export async function loginBackend(
  url: string,
  email: string,
  password: string,
): Promise<{ access_token: string; expires_at: string; email: string }> {
  const response = await fetchWithTimeout(
    `${url.replace(/\/$/, "")}/api/v1/auth/login`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
  );
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "Invalid server email or password"
        : `Server login failed (${response.status})`,
    );
  return (await response.json()) as {
    access_token: string;
    expires_at: string;
    email: string;
  };
}

export async function syncRecord(
  settings: Settings,
  entityType: string,
  entityId: string,
  payload: unknown,
): Promise<void> {
  if (!settings.syncEnabled || !settings.backendUrl.trim() || !settings.backendToken)
    return;
  const response = await fetchWithRetry(
    `${baseUrl(settings)}/api/v1/sync/push`,
    {
      method: "POST",
      headers: headers(settings),
      body: JSON.stringify({
        records: [{ entity_type: entityType, entity_id: entityId, payload }],
      }),
    },
    15_000,
  );
  if (!response.ok) throw new Error(`Server sync failed (${response.status})`);
}

export async function pullRecords(
  settings: Settings,
): Promise<
  Array<{
    entity_type: string;
    entity_id: string;
    payload: Record<string, unknown>;
  }>
> {
  if (!settings.syncEnabled || !settings.backendUrl.trim() || !settings.backendToken)
    return [];
  const records: Array<{
    entity_type: string;
    entity_id: string;
    payload: Record<string, unknown>;
  }> = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const response = await fetchWithRetry(
      `${baseUrl(settings)}/api/v1/sync/pull?offset=${offset}&limit=${pageSize}`,
      { headers: headers(settings) },
      15_000,
    );
    if (!response.ok) throw new Error(`Server pull failed (${response.status})`);
    const page = (await response.json()) as typeof records;
    records.push(...page);
    if (page.length < pageSize) return records;
  }
}

export async function deleteRemoteRecord(
  settings: Settings,
  entityType: string,
  entityId: string,
): Promise<void> {
  if (!settings.syncEnabled || !settings.backendUrl.trim() || !settings.backendToken)
    return;
  const response = await fetchWithTimeout(
    `${baseUrl(settings)}/api/v1/sync/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`,
    { method: "DELETE", headers: headers(settings) },
  );
  if (!response.ok) throw new Error(`Server delete failed (${response.status})`);
}

export async function uploadResumeFile(
  settings: Settings,
  resumeId: string,
  file: Blob,
  fileName: string,
): Promise<void> {
  if (!settings.syncEnabled || !settings.backendUrl.trim() || !settings.backendToken)
    return;
  const form = new FormData();
  form.append("file", file, fileName);
  const response = await fetchWithTimeout(
    `${baseUrl(settings)}/api/v1/resumes/${encodeURIComponent(resumeId)}/file`,
    {
      method: "POST",
      headers: settings.backendToken
        ? { Authorization: `Bearer ${settings.backendToken}` }
        : {},
      body: form,
    },
    30_000,
  );
  if (!response.ok) throw new Error(`Resume upload failed (${response.status})`);
}

export async function downloadResumeFile(
  settings: Settings,
  resumeId: string,
): Promise<Blob> {
  const response = await fetchWithTimeout(
    `${baseUrl(settings)}/api/v1/resumes/${encodeURIComponent(resumeId)}/file`,
    {
      headers: settings.backendToken
        ? { Authorization: `Bearer ${settings.backendToken}` }
        : {},
    },
    30_000,
  );
  if (!response.ok) throw new Error(`Resume download failed (${response.status})`);
  return response.blob();
}

export async function backendChat(
  settings: Settings,
  request: {
    system: string;
    user: string;
    temperature?: number;
    maxTokens?: number;
  },
): Promise<{ content: string; model: string }> {
  const response = await fetchWithTimeout(
    `${baseUrl(settings)}/api/v1/llm/chat`,
    {
      method: "POST",
      headers: headers(settings),
      body: JSON.stringify({ ...request, max_tokens: request.maxTokens }),
    },
    50_000,
  );
  if (!response.ok) throw new Error(`Server LLM request failed (${response.status})`);
  return (await response.json()) as { content: string; model: string };
}
