import type { Job } from '../../types/models';
import { normalizeKey } from '../../utils/text';
type DeduplicationJob = Pick<Job, 'sourceUrl' | 'externalId' | 'company' | 'title' | 'location'>;

const canonicalUrl = (value: string) => {
  if (!value) return '';
  try {
    const url = new URL(value);
    url.hash = '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'trk', 'trackingId', 'ref'].forEach((key) => url.searchParams.delete(key));
    url.pathname = url.pathname.replace(/\/+$/, '');
    return `${url.hostname.replace(/^www\./, '').toLowerCase()}${url.pathname}${url.searchParams.toString() ? `?${url.searchParams}` : ''}`;
  } catch {
    return normalizeKey(value);
  }
};

const identity = (job: DeduplicationJob) => ({
  url: canonicalUrl(job.sourceUrl),
  external: normalizeKey(job.externalId || ''),
  composite: normalizeKey(`${job.company}|${job.title}|${job.location}`),
});

export const jobDeduplicationKey = (job: DeduplicationJob) => {
  const keys = identity(job);
  return keys.external || keys.url || keys.composite;
};

export const findDuplicateJob = (candidate: DeduplicationJob, existing: Job[]) => {
  const keys = identity(candidate);
  return existing.find((job) => {
    const other = identity(job);
    return Boolean(
      (keys.url && other.url && keys.url === other.url) ||
      (keys.external && other.external && keys.external === other.external) ||
      (keys.composite && other.composite && keys.composite === other.composite),
    );
  });
};
