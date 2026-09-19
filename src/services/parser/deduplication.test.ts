import { describe, expect, it } from 'vitest';
import { findDuplicateJob, jobDeduplicationKey } from './deduplication';
import type { Job } from '../../types/models';

const job = (overrides: Partial<Job> = {}): Job => ({ id: '1', title: 'Project Coordinator', company: 'Acme', location: 'Vancouver', remoteType: 'hybrid', description: '', responsibilities: [], requirements: [], preferredQualifications: [], skills: [], benefits: [], source: 'linkedin', sourceUrl: 'https://linkedin.com/jobs/view/123?trk=abc', discoveredAt: '2026-01-01', lastSeenAt: '2026-01-01', status: 'Saved', notes: '', statusHistory: [], lastActivityAt: '2026-01-01', ...overrides });

describe('job deduplication', () => {
  it('normalizes tracking params from canonical URLs', () => expect(jobDeduplicationKey(job())).toBe(jobDeduplicationKey(job({ sourceUrl: 'https://linkedin.com/jobs/view/123' }))));
  it('matches an existing job by external ID before title', () => expect(findDuplicateJob(job({ externalId: 'abc' }), [job({ id: 'existing', externalId: 'abc' })])?.id).toBe('existing'));
  it('uses company/title/location when URL is absent', () => expect(jobDeduplicationKey(job({ sourceUrl: '' }))).toBe(jobDeduplicationKey(job({ sourceUrl: '', title: 'Project Coordinator' }))));
  it('matches by canonical URL even when only one source has an external id', () => expect(findDuplicateJob(job({ externalId: undefined }), [job({ id: 'existing', externalId: 'platform-123' })])?.id).toBe('existing'));
});
