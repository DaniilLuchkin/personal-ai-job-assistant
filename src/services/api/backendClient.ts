import type { Settings } from '../../types/models';

const baseUrl = (settings: Settings) => settings.backendUrl.replace(/\/$/, '');
const headers = (settings: Settings) => ({ 'Content-Type': 'application/json', ...(settings.backendToken ? { Authorization: `Bearer ${settings.backendToken}` } : {}) });

export async function loginBackend(url: string, email: string, password: string): Promise<{ access_token: string; expires_at: string; email: string }> {
  const response = await fetch(`${url.replace(/\/$/, '')}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!response.ok) throw new Error(response.status === 401 ? 'Invalid server email or password' : `Server login failed (${response.status})`);
  return await response.json() as { access_token: string; expires_at: string; email: string };
}

export async function syncRecord(settings: Settings, entityType: string, entityId: string, payload: unknown): Promise<void> {
  if (!settings.syncEnabled || !settings.backendUrl.trim() || !settings.backendToken) return;
  const response = await fetch(`${baseUrl(settings)}/api/v1/sync/push`, { method: 'POST', headers: headers(settings), body: JSON.stringify({ records: [{ entity_type: entityType, entity_id: entityId, payload }] }) });
  if (!response.ok) throw new Error(`Server sync failed (${response.status})`);
}

export async function pullRecords(settings: Settings): Promise<Array<{ entity_type: string; entity_id: string; payload: Record<string, unknown> }>> {
  if (!settings.syncEnabled || !settings.backendUrl.trim() || !settings.backendToken) return [];
  const response = await fetch(`${baseUrl(settings)}/api/v1/sync/pull`, { headers: headers(settings) });
  if (!response.ok) throw new Error(`Server pull failed (${response.status})`);
  return await response.json() as Array<{ entity_type: string; entity_id: string; payload: Record<string, unknown> }>;
}

export async function uploadResumeFile(settings: Settings, resumeId: string, file: Blob, fileName: string): Promise<void> {
  if (!settings.syncEnabled || !settings.backendUrl.trim() || !settings.backendToken) return;
  const form = new FormData(); form.append('file', file, fileName);
  const response = await fetch(`${baseUrl(settings)}/api/v1/resumes/${encodeURIComponent(resumeId)}/file`, { method: 'POST', headers: settings.backendToken ? { Authorization: `Bearer ${settings.backendToken}` } : {}, body: form });
  if (!response.ok) throw new Error(`Resume upload failed (${response.status})`);
}

export async function backendChat(settings: Settings, request: { system: string; user: string; temperature?: number; maxTokens?: number }): Promise<{ content: string; model: string }> {
  const response = await fetch(`${baseUrl(settings)}/api/v1/llm/chat`, { method: 'POST', headers: headers(settings), body: JSON.stringify({ ...request, max_tokens: request.maxTokens }) });
  if (!response.ok) throw new Error(`Server LLM request failed (${response.status})`);
  return await response.json() as { content: string; model: string };
}
