import type { Job, JobAnalysis, Resume, ResumeMatch, ResumeStructuredData, UserProfile } from '../../types/models';

export interface LLMRequest { system: string; user: string; temperature?: number; maxTokens?: number; }
export interface LLMProvider {
  readonly name: string;
  generateText(request: LLMRequest): Promise<string>;
  generateJson<T>(request: LLMRequest): Promise<T>;
  extractResumeData(text: string): Promise<ResumeStructuredData>;
  analyzeJob(job: Job, resumes: Resume[], profile: UserProfile): Promise<{ analysis: JobAnalysis; matches: ResumeMatch[] }>;
  generateFieldAnswer(input: { fieldLabel: string; instructions?: string; job: Job; resume?: Resume; profile: UserProfile; knowledge: string[]; previousAnswer?: string; customPrompt?: string }): Promise<string>;
}
