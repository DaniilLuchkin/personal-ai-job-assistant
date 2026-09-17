import type { Settings } from '../../types/models';

export async function syncRecord(settings: Settings, entityType: string, entityId: string, payload: unknown): Promise<void> {
  if (!settings.syncEnabled || !settings.backendUrl.trim()) return;
  const response = await fetch(`${settings.backendUrl.replace(/\/$/, '')}/api/v1/sync/push`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(settings.backendToken ? { 'X-Orbit-Token': settings.backendToken } : {}) }, body: JSON.stringify({ records: [{ entity_type: entityType, entity_id: entityId, payload }] }) });
  if (!response.ok) throw new Error(`Server sync failed (${response.status})`);
}
