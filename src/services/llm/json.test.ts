import { describe, expect, it } from 'vitest';
import { parseLLMJson } from './json';

describe('LLM JSON parsing', () => {
  it('accepts fenced JSON and harmless surrounding text', () => expect(parseLLMJson<{ ok: boolean }>('Result:\n```json\n{"ok":true}\n```')).toEqual({ ok: true }));
  it('rejects responses without JSON', () => expect(() => parseLLMJson('not json')).toThrow(/valid JSON/));
});
