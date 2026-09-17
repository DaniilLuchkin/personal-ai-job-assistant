import { describe, expect, it } from 'vitest';
import { classifyField } from './fieldDetection';
describe('field classification', () => { it('locks fixed personal fields', () => expect(classifyField('Email address', 'email')).toEqual({ category: 'fixed', confidence: 0.98 })); it('recognizes reusable professional fields', () => expect(classifyField('Years of experience', 'number').category).toBe('reusable')); it('routes ambiguous questions to LLM review', () => expect(classifyField('Why do you want this role?', 'textarea')).toEqual({ category: 'llm', confidence: 0.72 })); });
