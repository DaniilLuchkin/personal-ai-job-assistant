import type { Job, Resume, UserProfile } from '../../../types/models';
import { truncate } from '../../../utils/text';

export const resumeAdaptationPrompt = (job: Job, resume: Resume, profile: UserProfile) => `Adapt the resume to the target job without changing any facts. Return strict JSON only with keys adaptedText, changeSummary[], targetTitle.

NON-NEGOTIABLE RULES:
- Never invent employers, job titles, dates, responsibilities, tools, education, certifications, achievements, metrics or years of experience.
- Never claim a requirement unless it is supported by the source resume or profile.
- You may reorder sections and bullets, tighten wording, emphasize relevant facts and use job keywords only where truthful.
- Keep all contact details that appear in the source.
- adaptedText must be a complete, ready-to-use resume in clean plain text with section headings.
- changeSummary must briefly explain the meaningful wording/order changes.

TARGET JOB:
${JSON.stringify({ title: job.title, company: job.company, description: truncate(job.description, 9000), requirements: job.requirements, responsibilities: job.responsibilities, skills: job.skills })}

SOURCE RESUME:
${truncate(resume.parsedText, 16000)}

VERIFIED PROFILE:
${JSON.stringify(profile)}`;
