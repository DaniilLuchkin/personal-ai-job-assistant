import { describe, expect, it } from 'vitest';
import { HeuristicProvider } from './HeuristicProvider';
import type { Job, Resume, UserProfile } from '../../types/models';
const job = { id: 'j', title: 'Project Manager', company: 'Acme', location: 'Remote', description: 'Manage projects using Jira and Excel', requirements: ['Jira'], responsibilities: ['Manage projects'], skills: ['Jira'], preferredQualifications: [], status: 'Saved', source: 'test', sourceUrl: 'https://example.com', discoveredAt: '', lastSeenAt: '', notes: '', statusHistory: [], lastActivityAt: '', remoteType: 'remote', benefits: [] } as Job;
describe('local LLM fallback', () => { it('returns explainable match results without a network call', async () => { const resume = { id: 'r', name: 'Base', parsedText: 'Project Manager Jira Excel', structuredData: { jobTitles: ['Project Manager'], skills: ['Jira', 'Excel'] } } as Resume; const result = await new HeuristicProvider().analyzeJob(job, [resume], {} as UserProfile); expect(result.matches[0].resumeId).toBe('r'); expect(result.matches[0].score).toBeGreaterThan(0); expect(result.analysis.mandatoryRequirements).toContain('Jira'); }); });

describe('local field answer fallback', () => {
  it('answers tell-us-about-yourself from resume facts before reusable knowledge', async () => {
    const resume = {
      id: 'r', name: 'Base', parsedText: 'Project Manager at Acme. Jira and Excel.', targetRoles: ['Project Manager'],
      structuredData: { jobTitles: ['Project Manager'], skills: ['Jira', 'Excel'], workExperience: [{ title: 'Project Manager', company: 'Acme', bullets: ['Delivered projects on schedule'] }], achievements: ['Improved delivery workflow'] },
    } as Resume;
    const profile = { fullName: 'Jane Doe', skills: [], experience: [], preferences: [] } as unknown as UserProfile;
    const answer = await new HeuristicProvider().generateFieldAnswer({ fieldLabel: 'Tell us about yourself', answerKind: 'candidate_summary', job, resume, profile, knowledge: ['Unrelated saved answer'] });
    expect(answer).toContain('Project Manager');
    expect(answer).toContain('Acme');
    expect(answer).not.toBe('Unrelated saved answer');
  });
});
