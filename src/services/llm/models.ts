export interface OpenRouterModel { id: string; name: string; context_length?: number; pricing?: { prompt?: string; completion?: string }; }

export async function fetchOpenRouterModels(apiKey: string): Promise<OpenRouterModel[]> {
  const response = await fetch('https://openrouter.ai/api/v1/models', { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined });
  if (!response.ok) throw new Error(`Unable to load OpenRouter models (${response.status})`);
  const data = await response.json() as { data?: OpenRouterModel[] };
  return (data.data ?? []).sort((a, b) => a.id.localeCompare(b.id));
}
