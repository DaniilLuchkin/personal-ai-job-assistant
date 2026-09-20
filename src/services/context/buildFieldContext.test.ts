import { describe, expect, it } from 'vitest';
import { buildFieldContext } from './buildFieldContext';
import type { FormField, Job, Resume, UserProfile } from '../../types/models';
const job = { id: 'j', title: 'Project Manager', company: 'Acme', description: 'Coordinate projects', requirements: ['Jira'], responsibilities: [] } as unknown as Job;
const profile = { id: 'default', firstName: 'Jane', skills: ['Jira'], experience: [] } as unknown as UserProfile;
const field = { id: 'f', label: 'Why this role?', name: 'why', type: 'textarea', instructions: '', prompt: '', value: '', required: true, category: 'llm', status: 'detected', confidence: .8 } as FormField;
describe('field context builder', () => {
  it('includes only bounded relevant context', () => {
    const context = buildFieldContext(field, job, undefined as Resume | undefined, profile, []);
    expect(context.job.description).toBe('Coordinate projects');
    expect(context.field.label).toBe('Why this role?');
    expect(context.field.answerKind).toBe('motivation');
    expect(context.resume).toBeUndefined();
  });

  it('selects resume evidence for an about-yourself question', () => {
    const resume = {
      id: 'r', name: 'PM Resume', parsedText: 'Jane managed Jira projects at Acme.',
      structuredData: {
        jobTitles: ['Project Manager'], skills: ['Jira'], companies: ['Acme'],
        workExperience: [{ title: 'Project Manager', company: 'Acme', bullets: ['Delivered a portfolio of projects'] }],
        achievements: [], projects: [], education: [], certifications: [], languages: [], tools: [], industries: [],
      },
    } as unknown as Resume;
    const aboutField = { ...field, label: 'Tell us about yourself', name: 'candidate_bio' };
    const context = buildFieldContext(aboutField, job, resume, profile, []);
    expect(context.field.answerKind).toBe('candidate_summary');
    expect(context.resume?.evidence.join(' ')).toContain('Project Manager');
    expect(context.resume?.evidence.join(' ')).toContain('Delivered a portfolio of projects');
  });
});
