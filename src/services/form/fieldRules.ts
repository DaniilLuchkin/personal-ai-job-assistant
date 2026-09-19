import type { FieldCategory, FieldRule, FormField } from '../../types/models';
import { normalizeKey } from '../../utils/text';

type DefaultRule = { name: string; aliases: string[]; category: FieldCategory; llmEnabled?: boolean; prompt?: string };

const defaults: DefaultRule[] = [
  { name: 'First Name', aliases: ['first name', 'given name'], category: 'fixed' },
  { name: 'Last Name', aliases: ['last name', 'family name', 'surname'], category: 'fixed' },
  { name: 'Full Name', aliases: ['full name', 'legal name'], category: 'fixed' },
  { name: 'Email', aliases: ['email', 'email address'], category: 'fixed' },
  { name: 'Phone', aliases: ['phone', 'phone number', 'mobile'], category: 'fixed' },
  { name: 'Address', aliases: ['address', 'street address'], category: 'fixed' },
  { name: 'City', aliases: ['city', 'town'], category: 'fixed' },
  { name: 'Province / State', aliases: ['province', 'state', 'region'], category: 'fixed' },
  { name: 'Postal Code', aliases: ['postal code', 'zip code', 'zip'], category: 'fixed' },
  { name: 'LinkedIn', aliases: ['linkedin', 'linkedin url', 'linkedin profile'], category: 'fixed' },
  { name: 'Portfolio / Website', aliases: ['portfolio', 'website', 'personal website'], category: 'fixed' },
  { name: 'Work Authorization', aliases: ['work authorization', 'legally authorized', 'eligible to work', 'sponsorship'], category: 'reusable' },
  { name: 'Current Job Title', aliases: ['current title', 'job title', 'current position'], category: 'reusable' },
  { name: 'Years of Experience', aliases: ['years of experience', 'years experience'], category: 'reusable' },
  { name: 'Skills', aliases: ['skills', 'technical skills', 'technologies', 'tools'], category: 'reusable' },
  { name: 'Education', aliases: ['education', 'degree', 'university', 'school'], category: 'reusable' },
  { name: 'Certifications', aliases: ['certifications', 'certificates'], category: 'reusable' },
  { name: 'Cover Letter', aliases: ['cover letter', 'cover note'], category: 'llm', llmEnabled: true, prompt: 'Write a concise, truthful cover letter tailored to this job.' },
  { name: 'Why this role?', aliases: ['why do you want this job', 'why are you interested', 'why this role', 'motivation'], category: 'llm', llmEnabled: true, prompt: 'Explain the genuine fit between my background and this role. Keep it specific and concise.' },
  { name: 'Why should we hire you?', aliases: ['why should we hire you', 'why are you a good fit', 'what makes you a good fit'], category: 'llm', llmEnabled: true, prompt: 'Use only evidence from my resume and profile. Emphasize the strongest relevant experience.' },
  { name: 'Additional Information', aliases: ['additional information', 'anything else', 'additional comments'], category: 'llm', llmEnabled: true },
];

export const createDefaultFieldRules = (stamp = new Date().toISOString()): FieldRule[] => defaults.map((rule, index) => ({
  id: `field-rule-default-${index + 1}`,
  name: rule.name,
  aliases: rule.aliases,
  category: rule.category,
  value: '',
  status: 'active',
  source: 'Orbit default',
  editable: true,
  llmEnabled: rule.llmEnabled ?? rule.category === 'llm',
  prompt: rule.prompt,
  createdAt: stamp,
  updatedAt: stamp,
}));

const words = (value: string) => new Set(normalizeKey(value).split(' ').filter(Boolean));
const similarity = (left: string, right: string) => {
  const a = words(left);
  const b = words(right);
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((word) => b.has(word)).length;
  return overlap / Math.min(a.size, b.size);
};

export const findFieldRule = (field: Pick<FormField, 'label' | 'name'>, rules: FieldRule[]) => {
  const haystack = `${field.label} ${field.name}`;
  return rules
    .map((rule) => ({ rule, score: Math.max(...[rule.name, ...rule.aliases].map((alias) => similarity(haystack, alias))) }))
    .filter(({ score }) => score >= 0.66)
    .sort((a, b) => b.score - a.score)[0]?.rule;
};

export const applyFieldRules = (fields: FormField[], rules: FieldRule[]): FormField[] => fields.map((field) => {
  const rule = findFieldRule(field, rules);
  if (!rule) return field;
  return {
    ...field,
    category: rule.status === 'disabled' ? 'ignore' : rule.category,
    value: field.value || rule.value,
    prompt: rule.prompt,
    instructions: rule.instructions,
    ruleId: rule.id,
    source: rule.value && !field.value ? rule.source : field.source,
    confidence: Math.max(field.confidence, 0.94),
  };
});
