import type { Job, JobAnalysis, Resume, ResumeMatch, ResumeStructuredData, UserProfile } from '../../types/models';
import type { LLMProvider, LLMRequest } from './LLMProvider';
import { heuristicResumeData } from '../resume/parser';

const terms = (value: string) => [...new Set(value.toLowerCase().match(/[a-z][a-z+#.-]{2,}/g) ?? [])];
export class HeuristicProvider implements LLMProvider {
  readonly name = 'Local fallback';
  async generateText(_request: LLMRequest) { return ''; }
  async generateJson<T>(_request: LLMRequest): Promise<T> { throw new Error('Local fallback does not support arbitrary JSON'); }
  async extractResumeData(text: string): Promise<ResumeStructuredData> { return heuristicResumeData(text); }
  async analyzeJob(job: Job, resumes: Resume[], _profile: UserProfile) {
    const jobTerms = new Set(terms([job.title, job.description, ...job.requirements, ...job.skills].join(' ')));
    const analysis: JobAnalysis = { summary: `${job.title} at ${job.company || 'the hiring company'} in ${job.location || 'the listed location'}.`, seniority: /senior|lead|director/i.test(job.title) ? 'Senior' : /junior|entry/i.test(job.title) ? 'Entry' : 'Mid-level', mandatoryRequirements: job.requirements.slice(0, 8), preferredRequirements: job.preferredQualifications.slice(0, 8), skills: job.skills, keywords: [...jobTerms].slice(0, 20), responsibilities: job.responsibilities, redFlags: [] };
    const matches: ResumeMatch[] = resumes.map((resume) => { const resumeTerms = new Set(terms(`${resume.parsedText} ${resume.structuredData.skills.join(' ')}`)); const matchingSkills = [...jobTerms].filter((term) => resumeTerms.has(term)).slice(0, 12); const score = Math.min(98, Math.round(35 + matchingSkills.length / Math.max(jobTerms.size, 1) * 65)); return { resumeId: resume.id, score, strengths: matchingSkills.slice(0, 5).map((term) => `Relevant keyword: ${term}`), missingRequirements: job.requirements.filter((requirement) => !resumeTerms.has(terms(requirement)[0] ?? '')).slice(0, 4), matchingSkills, relevantExperience: resume.structuredData.jobTitles.slice(0, 4), concerns: [], recommendation: score >= 70 ? 'Strong candidate fit' : score >= 50 ? 'Review before applying' : 'Low match — consider another resume' }; });
    return { analysis, matches: matches.sort((a, b) => b.score - a.score) };
  }
  async generateFieldAnswer(input: Parameters<LLMProvider['generateFieldAnswer']>[0]) {
    const p = input.profile;
    const resumeData = input.resume?.structuredData;
    const skills = [...new Set([...(p.skills || []), ...(resumeData?.skills || []), ...(resumeData?.tools || [])])].slice(0, 5);
    const roles = [...new Set([...(resumeData?.jobTitles || []), ...(input.resume?.targetRoles || [])])].slice(0, 2);
    const experience = [...(p.experience || []), ...((resumeData?.workExperience || []).map((item) => `${item.title} at ${item.company}`))].slice(0, 2);
    const relevantRequirements = input.job.requirements.filter((requirement) => skills.some((skill) => requirement.toLowerCase().includes(skill.toLowerCase()) || skill.toLowerCase().includes(requirement.toLowerCase()))).slice(0, 3);
    if (/why.*(interested|want)|why this/i.test(input.fieldLabel)) return `I’m interested in the ${input.job.title} role at ${input.job.company} because it connects my background in ${skills.join(', ') || roles.join(', ') || 'project coordination'} with the role’s focus on ${relevantRequirements.join(', ') || input.job.responsibilities.slice(0, 2).join(' and ') || 'practical, cross-functional work'}.`;
    if (/summary|experience|fit|hire|describe/i.test(input.fieldLabel)) return `My background includes ${experience.join('; ') || roles.join(' and ') || 'relevant professional experience'}. I have worked with ${skills.join(', ') || 'cross-functional teams'} and would bring a structured, collaborative approach to the ${input.job.title} role.`;
    if (/cover letter/i.test(input.fieldLabel)) return `Dear Hiring Team,\n\nI’m excited to apply for the ${input.job.title} position at ${input.job.company}. My background includes ${experience.join('; ') || roles.join(' and ') || 'relevant professional experience'}, with experience in ${skills.join(', ') || 'cross-functional collaboration'}. I would welcome the opportunity to discuss how this background could support your team.\n\nBest regards,\n${p.fullName || 'Applicant'}`;
    return input.previousAnswer || `My experience in ${skills.join(', ') || roles.join(', ') || 'project coordination'} is relevant to the ${input.job.title} position, particularly where the role requires structured collaboration and reliable execution.`;
  }
}
