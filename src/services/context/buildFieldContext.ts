import type { FormField, Job, KnowledgeItem, PageContext, Resume, UserProfile } from '../../types/models';

const tokens = (value: string) => new Set(value.toLowerCase().match(/[\p{L}\p{N}+#.-]{3,}/gu) ?? []);

const relevantKnowledge = (field: FormField, job: Job, knowledge: KnowledgeItem[]) => {
  const context = tokens(`${field.label} ${field.name} ${job.title} ${job.company} ${(job.skills || []).join(' ')}`);
  return knowledge
    .map((item) => {
      const searchable = `${item.question || ''} ${item.tags.join(' ')}`;
      const overlap = [...tokens(searchable)].filter((token) => context.has(token)).length;
      const reusableBoost = ['personal', 'professional', 'experience', 'achievement', 'preference', 'application_answer', 'cover_letter_fragment'].includes(item.type) ? 1 : 0;
      return { item, score: overlap * 3 + reusableBoost + item.confidence };
    })
    .filter(({ score }) => score > 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map(({ item }) => item);
};

export const buildFieldContext = (field: FormField, job: Job, resume: Resume | undefined, profile: UserProfile, knowledge: KnowledgeItem[], applicationPage?: PageContext) => ({
  field: { label: field.label, name: field.name, type: field.type, instructions: field.instructions, prompt: field.prompt },
  job: { id: job.id, title: job.title, company: job.company, description: job.description.slice(0, 9000), requirements: job.requirements },
  applicationPage: applicationPage ? { url: applicationPage.url, title: applicationPage.title, text: applicationPage.extractedText.slice(0, 3500) } : undefined,
  resume: resume ? { id: resume.id, name: resume.name, text: resume.parsedText.slice(0, 9000), data: resume.structuredData } : undefined,
  profile,
  knowledge: relevantKnowledge(field, job, knowledge),
});
