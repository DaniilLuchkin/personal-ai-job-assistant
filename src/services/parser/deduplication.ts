import type { Job } from '../../types/models';
import { normalizeKey } from '../../utils/text';
export const jobDeduplicationKey = (job: Pick<Job, 'sourceUrl' | 'externalId' | 'company' | 'title' | 'location'>) => normalizeKey(job.externalId || job.sourceUrl || `${job.company}|${job.title}|${job.location}`);
export const findDuplicateJob = (candidate: Pick<Job, 'sourceUrl' | 'externalId' | 'company' | 'title' | 'location'>, existing: Job[]) => existing.find((job) => jobDeduplicationKey(job) === jobDeduplicationKey(candidate));
