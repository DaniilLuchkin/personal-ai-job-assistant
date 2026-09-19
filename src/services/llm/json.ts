export function parseLLMJson<T>(raw: string): T {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || trimmed;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const objectStart = candidate.indexOf('{');
    const objectEnd = candidate.lastIndexOf('}');
    const arrayStart = candidate.indexOf('[');
    const arrayEnd = candidate.lastIndexOf(']');
    if (objectStart >= 0 && objectEnd > objectStart) return JSON.parse(candidate.slice(objectStart, objectEnd + 1)) as T;
    if (arrayStart >= 0 && arrayEnd > arrayStart) return JSON.parse(candidate.slice(arrayStart, arrayEnd + 1)) as T;
    throw new Error('The LLM response did not contain valid JSON.');
  }
}
