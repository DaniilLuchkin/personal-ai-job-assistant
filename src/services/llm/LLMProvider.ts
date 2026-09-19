import type { Job, JobAnalysis, Resume, ResumeAdaptation, ResumeMatch, ResumeStructuredData, UserProfile } from '../../types/models';

export interface LLMRequest { system: string; user: string; images?: string[]; temperature?: number; maxTokens?: number; }
export interface LLMProvider {
  readonly name: string;
  generateText(request: LLMRequest): Promise<string>;
  generateJson<T>(request: LLMRequest): Promise<T>;
  extractResumeData(text: string): Promise<ResumeStructuredData>;
  analyzeJob(job: Job, resumes: Resume[], profile: UserProfile, context?: { screenshots?: string[]; extraText?: string }): Promise<{ analysis: JobAnalysis; matches: ResumeMatch[] }>;
  adaptResume(job: Job, resume: Resume, profile: UserProfile): Promise<ResumeAdaptation>;
  generateFieldAnswer(input: { fieldLabel: string; instructions?: string; job: Job; resume?: Resume; profile: UserProfile; knowledge: string[]; previousAnswer?: string; customPrompt?: string; applicationContext?: string }): Promise<string>;
}
