import { describe, expect, it } from 'vitest';
import { applyFieldRules, createDefaultFieldRules, findFieldRule } from './fieldRules';
import type { FormField } from '../../types/models';

const field = (label: string): FormField => ({ id: label, selector: '#x', label, name: '', type: 'text', value: '', required: false, category: 'llm', status: 'detected', confidence: 0.72 });

describe('field rules', () => {
  it('matches common aliases', () => expect(findFieldRule(field('Given name'), createDefaultFieldRules())?.name).toBe('First Name'));
  it('applies a saved value and category', () => {
    const rules = createDefaultFieldRules();
    rules[0] = { ...rules[0], value: 'Jane', source: 'User setting' };
    expect(applyFieldRules([field('First name')], rules)[0]).toMatchObject({ category: 'fixed', value: 'Jane', source: 'User setting' });
  });
  it('turns disabled known fields into ignored fields', () => {
    const rules = createDefaultFieldRules();
    rules[0] = { ...rules[0], status: 'disabled' };
    expect(applyFieldRules([field('Given name')], rules)[0].category).toBe('ignore');
  });
});
