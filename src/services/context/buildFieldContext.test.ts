import { describe, expect, it } from 'vitest';
import { buildFieldContext } from './buildFieldContext';
import type { FormField, Job, Resume, UserProfile } from '../../types/models';
const job = { id: 'j', title: 'Project Manager', company: 'Acme', description: 'Coordinate projects', requirements: ['Jira'], responsibilities: [] } as unknown as Job;
const profile = { id: 'default', firstName: 'Jane', skills: ['Jira'], experience: [] } as unknown as UserProfile;
const field = { id: 'f', label: 'Why this role?', name: 'why', type: 'textarea', instructions: '', prompt: '', value: '', required: true, category: 'llm', status: 'detected', confidence: .8 } as FormField;
describe('field context builder', () => { it('includes only bounded relevant context', () => { const context = buildFieldContext(field, job, undefined as Resume | undefined, profile, []); expect(context.job.description).toBe('Coordinate projects'); expect(context.field.label).toBe('Why this role?'); expect(context.resume).toBeUndefined(); }); });
