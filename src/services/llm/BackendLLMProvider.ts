import type { Job, JobAnalysis, Resume, ResumeMatch, ResumeStructuredData, Settings, UserProfile } from '../../types/models';
import { backendChat } from '../api/backendClient';
import type { LLMProvider, LLMRequest } from './LLMProvider';
import { fieldGenerationPrompt } from './prompts/fieldGeneration';
import { jobAnalysisPrompt } from './prompts/jobAnalysis';
import { resumeAdaptationPrompt } from './prompts/resumeAdaptation';
import { normalizeJobAnalysis, normalizeResumeStructuredData } from './validation';
import { parseLLMJson } from './json';

export class BackendLLMProvider implements LLMProvider {
  readonly name = 'Oracle / OpenRouter';
  constructor(private readonly settings: Settings) {}
  private async request(request: LLMRequest) { return (await backendChat(this.settings, { ...request, model: this.settings.openRouterModel || undefined, maxTokens: request.maxTokens })).content; }
  async generateText(request: LLMRequest) { return this.request(request); }
  async generateJson<T>(request: LLMRequest) { return parseLLMJson<T>(await this.request(request)); }
  async extractResumeData(text: string): Promise<ResumeStructuredData> { return normalizeResumeStructuredData(await this.generateJson<ResumeStructuredData>({ system: 'Extract structured resume data. Return valid JSON only. Preserve facts and use empty arrays for unknown values.', user: `Return this schema: firstName, lastName, fullName, email, phone, address, city, province, postalCode, linkedin, portfolio, website, workAuthorization, jobTitles[], skills[], companies[], workExperience[{title,company,dates,bullets[]}], achievements[], projects[], education[], certifications[], languages[], tools[], industries[]. RESUME TEXT:\n${text.slice(0, 18000)}`, maxTokens: 2200 })); }
  async analyzeJob(job: Job, resumes: Resume[], profile: UserProfile, context?: { screenshots?: string[]; extraText?: string }) { return normalizeJobAnalysis(await this.generateJson<{ analysis: JobAnalysis; matches: ResumeMatch[] }>({ system: 'You are a careful job application assistant. Return valid JSON only.', user: `${jobAnalysisPrompt(job, resumes, profile)}${context?.extraText ? `\nADDITIONAL PAGE CONTEXT:\n${context.extraText.slice(0, 4000)}` : ''}`, images: context?.screenshots }), job, resumes); }
  async adaptResume(job: Job, resume: Resume, profile: UserProfile) {
    const result = await this.generateJson<{ adaptedText?: unknown; changeSummary?: unknown; targetTitle?: unknown }>({ system: 'You adapt resumes truthfully. Return valid JSON only and never invent candidate facts.', user: resumeAdaptationPrompt(job, resume, profile), maxTokens: Math.max(this.settings.maxTokens, 3000) });
    const adaptedText = typeof result.adaptedText === 'string' ? result.adaptedText.trim() : '';
    if (adaptedText.length < 100) throw new Error('The LLM did not return a complete adapted resume.');
    return { adaptedText, changeSummary: Array.isArray(result.changeSummary) ? result.changeSummary.map(String).filter(Boolean) : [], targetTitle: typeof result.targetTitle === 'string' && result.targetTitle.trim() ? result.targetTitle.trim() : job.title };
  }
  async generateFieldAnswer(input: Parameters<LLMProvider['generateFieldAnswer']>[0]) { return this.generateText({ system: 'You help a candidate write truthful application answers. Return only the answer text.', user: fieldGenerationPrompt(input), maxTokens: 1000 }); }
}
