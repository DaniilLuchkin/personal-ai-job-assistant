import type { Job, PageContext, RemoteType } from '../../types/models';
import { normalizeText, splitLines } from '../../utils/text';
import { now, uid } from '../../utils/id';

const remoteType = (text: string): RemoteType => /hybrid/i.test(text) ? 'hybrid' : /remote|work from home/i.test(text) ? 'remote' : /on[- ]site|onsite/i.test(text) ? 'on-site' : 'unknown';
const firstMatch = (text: string, patterns: RegExp[]) => patterns.map((pattern) => text.match(pattern)?.[1]).find(Boolean)?.trim();

export function normalizePageContext(context: PageContext): Job {
  const text = normalizeText(context.extractedText); const metadata = context.metadata;
  const title = metadata.title || context.title || 'Untitled role'; const company = metadata.company || firstMatch(text, [/at ([A-Z][\w .&-]{2,})/]) || 'Unknown company';
  const location = metadata.location || firstMatch(text, [/(?:location|based in|job location)[:\s]+([^|.]{2,60})/i]) || '';
  const lines = splitLines(context.extractedText); const requirements = lines.filter((line) => /experience|degree|proficiency|knowledge|ability|skills?/i.test(line)).slice(0, 16);
  const responsibilities = lines.filter((line) => /responsibilit|manage|coordinate|develop|lead|support|create|analy[sz]e/i.test(line)).slice(0, 16);
  const discoveredAt = now(); return { id: uid('job'), title, company, location, remoteType: metadata.remoteType || remoteType(text), employmentType: metadata.employmentType, salary: metadata.salary || firstMatch(text, [/((?:\$|CAD|USD)\s?[\d,]+(?:\s?[-–]\s?(?:\$|CAD|USD)?\s?[\d,]+)?\s?(?:per year|annually|\/yr)?)/i]), description: text, responsibilities, requirements, preferredQualifications: [], skills: [], benefits: [], source: context.url ? new URL(context.url).hostname : 'browser', sourceUrl: context.url, applicationUrl: metadata.applicationUrl || context.url, externalId: metadata.externalId, discoveredAt, lastSeenAt: discoveredAt, status: 'Saved', notes: '', statusHistory: [], lastActivityAt: discoveredAt };
}
