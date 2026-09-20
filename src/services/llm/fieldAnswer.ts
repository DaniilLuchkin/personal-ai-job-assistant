import type { Job, Resume, UserProfile } from '../../types/models';
import type { FieldAnswerInput, FieldAnswerKind } from './LLMProvider';

const words = (value: string) => value.toLowerCase().match(/[\p{L}\p{N}+#.-]{3,}/gu) ?? [];

export const inferFieldAnswerKind = (label: string, name = ''): FieldAnswerKind => {
  const question = `${label} ${name}`.toLowerCase();
  if (/cover\s*(letter|note)|сопроводительн/i.test(question)) return 'cover_letter';
  if (/tell\s+(us\s+)?about\s+yourself|about\s+you|introduce\s+yourself|professional\s+(summary|bio)|расскаж\p{L}*\s+(нам\s+)?о\s+себе|о\s+вас/iu.test(question)) return 'candidate_summary';
  if (/why.*(role|job|position|company|interested|want|apply)|motivation|почему.*(роль|ваканси|компан|работ)|мотивац/i.test(question)) return 'motivation';
  if (/why.*hire|good\s+fit|best\s+candidate|what.*bring|suitab|почему.*(нанять|подход)|чем.*полез/i.test(question)) return 'qualification';
  if (/describe.*experience|experience\s+(with|in)|background\s+(with|in)|расскаж\p{L}*.*опыт|опыт\s+(работы|с)/iu.test(question)) return 'experience';
  if (/additional\s+(information|comments)|anything\s+else|дополнительн\p{L}*\s+(информац|комментар)/iu.test(question)) return 'additional';
  return 'general';
};

const evidenceCandidates = (resume: Resume, profile: UserProfile) => {
  const data = resume.structuredData;
  return [
    ...(data.workExperience || []).map((item) => [
      `Experience: ${item.title}${item.company ? ` at ${item.company}` : ''}${item.dates ? ` (${item.dates})` : ''}`,
      ...item.bullets.map((bullet) => `Achievement in ${item.title}: ${bullet}`),
    ]).flat(),
    ...(data.achievements || []).map((item) => `Achievement: ${item}`),
    ...(data.projects || []).map((item) => `Project: ${item}`),
    ...(data.jobTitles?.length ? [`Professional roles: ${data.jobTitles.join(', ')}`] : []),
    ...(data.skills?.length ? [`Skills: ${data.skills.join(', ')}`] : []),
    ...(data.tools?.length ? [`Tools: ${data.tools.join(', ')}`] : []),
    ...(data.education || []).map((item) => `Education: ${item}`),
    ...(data.certifications || []).map((item) => `Certification: ${item}`),
    ...(profile.experience || []).map((item) => `Profile experience: ${item}`),
    ...(profile.skills?.length ? [`Profile skills: ${profile.skills.join(', ')}`] : []),
  ].map((item) => item.trim()).filter(Boolean);
};

export const selectResumeEvidence = (fieldLabel: string, fieldName: string, kind: FieldAnswerKind, job: Job, resume: Resume, profile: UserProfile) => {
  const query = new Set(words(`${fieldLabel} ${fieldName} ${job.title} ${(job.skills || []).join(' ')} ${(job.requirements || []).join(' ')}`));
  const kindBoost = (candidate: string) => {
    if (kind === 'candidate_summary' && /^(Experience|Achievement|Professional roles|Skills|Profile experience)/i.test(candidate)) return 5;
    if (kind === 'experience' && /^(Experience|Achievement|Project|Profile experience)/i.test(candidate)) return 6;
    if (kind === 'qualification' && /^(Achievement|Experience|Skills|Tools)/i.test(candidate)) return 5;
    if (kind === 'motivation' && /^(Experience|Professional roles|Skills|Profile experience)/i.test(candidate)) return 3;
    return 0;
  };
  return evidenceCandidates(resume, profile)
    .map((candidate, index) => ({
      candidate,
      index,
      score: words(candidate).filter((word) => query.has(word)).length * 3 + kindBoost(candidate),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 16)
    .map(({ candidate }) => candidate);
};

export const cleanFieldAnswer = (raw: string) => {
  let answer = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<analysis>[\s\S]*?<\/analysis>/gi, '')
    .trim();
  const fenced = answer.match(/^```(?:json|text|markdown)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) answer = fenced[1].trim();
  if (answer.startsWith('{')) {
    try {
      const parsed = JSON.parse(answer) as { answer?: unknown; text?: unknown; content?: unknown };
      const value = parsed.answer ?? parsed.text ?? parsed.content;
      if (typeof value === 'string') answer = value.trim();
    } catch {
      // Keep plain text if a model wrapped an otherwise usable answer in malformed JSON.
    }
  }
  answer = answer.replace(/^(?:final\s+)?answer\s*:\s*/i, '').trim();
  if ((answer.startsWith('"') && answer.endsWith('"')) || (answer.startsWith('“') && answer.endsWith('”'))) answer = answer.slice(1, -1).trim();
  return answer;
};

export const isUsefulFieldAnswer = (answer: string, input: FieldAnswerInput) => {
  if (!answer || /(?:^|\s)(?:undefined|null|n\/a)(?:\s|$)/i.test(answer)) return false;
  if (/[�]/.test(answer)) return false;
  const letters = answer.match(/\p{L}/gu)?.length ?? 0;
  const wordsCount = answer.match(/\p{L}[\p{L}'’-]*/gu)?.length ?? 0;
  const minimumWords = input.answerKind === 'candidate_summary' || input.answerKind === 'cover_letter' ? 25 : 4;
  return letters >= 12 && wordsCount >= minimumWords;
};
