import type { Job, JobAnalysis, Resume, ResumeMatch, ResumeStructuredData, Settings, UserProfile } from '../../types/models';
import { backendChat } from '../api/backendClient';
import type { LLMProvider, LLMRequest } from './LLMProvider';
import { fieldGenerationPrompt } from './prompts/fieldGeneration';
import { jobAnalysisPrompt } from './prompts/jobAnalysis';
import { normalizeJobAnalysis, normalizeResumeStructuredData } from './validation';

export class BackendLLMProvider implements LLMProvider {
  readonly name = 'Oracle / OpenRouter';
  constructor(private readonly settings: Settings) {}
  private async request(request: LLMRequest) { return (await backendChat(this.settings, { ...request, maxTokens: request.maxTokens })).content; }
  private parse<T>(raw: string): T { return JSON.parse(raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '')) as T; }
  async generateText(request: LLMRequest) { return this.request(request); }
  async generateJson<T>(request: LLMRequest) { return this.parse<T>(await this.request(request)); }
  async extractResumeData(text: string): Promise<ResumeStructuredData> { return normalizeResumeStructuredData(await this.generateJson<ResumeStructuredData>({ system: 'Extract structured resume data. Return valid JSON only. Preserve facts and use empty arrays for unknown values.', user: `Return this schema: firstName, lastName, fullName, email, phone, address, city, province, postalCode, linkedin, portfolio, website, workAuthorization, jobTitles[], skills[], companies[], workExperience[{title,company,dates,bullets[]}], achievements[], projects[], education[], certifications[], languages[], tools[], industries[]. RESUME TEXT:\n${text.slice(0, 18000)}`, maxTokens: 2200 })); }
  async analyzeJob(job: Job, resumes: Resume[], profile: UserProfile) { return normalizeJobAnalysis(await this.generateJson<{ analysis: JobAnalysis; matches: ResumeMatch[] }>({ system: 'You are a careful job application assistant. Return valid JSON only.', user: jobAnalysisPrompt(job, resumes, profile) }), job, resumes); }
  async generateFieldAnswer(input: Parameters<LLMProvider['generateFieldAnswer']>[0]) { return this.generateText({ system: 'You help a candidate write truthful application answers. Return only the answer text.', user: fieldGenerationPrompt(input), maxTokens: 1000 }); }
}
