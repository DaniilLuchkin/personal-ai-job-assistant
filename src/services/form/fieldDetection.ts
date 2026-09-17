import type { FieldCategory, FormField } from '../../types/models';
import { uid } from '../../utils/id';

const fixedPatterns = /first.?name|last.?name|full.?name|email|phone|mobile|address|city|province|state|postal|zip|linkedin|website|portfolio/i;
const reusablePatterns = /years?.*(experience|work)|job title|education|degree|certif|skill|authorization|sponsor|language/i;
export const classifyField = (label: string, type: string): { category: FieldCategory; confidence: number } => { if (type === 'file') return { category: 'ignore', confidence: 0.99 }; if (fixedPatterns.test(label)) return { category: 'fixed', confidence: 0.98 }; if (reusablePatterns.test(label)) return { category: 'reusable', confidence: 0.9 }; return { category: 'llm', confidence: 0.72 }; };
export const createFormField = (input: Omit<FormField, 'id' | 'category' | 'status' | 'confidence'>): FormField => ({ ...input, id: uid('field'), ...classifyField(input.label || input.name, input.type), status: 'detected' });
