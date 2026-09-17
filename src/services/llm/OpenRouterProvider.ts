import type { Job, JobAnalysis, Resume, ResumeMatch, ResumeStructuredData, UserProfile } from '../../types/models';
import type { LLMProvider, LLMRequest } from './LLMProvider';
import { jobAnalysisPrompt } from './prompts/jobAnalysis';
import { fieldGenerationPrompt } from './prompts/fieldGeneration';

export class OpenRouterProvider implements LLMProvider {
  readonly name = 'OpenRouter';
  constructor(private readonly apiKey: string, private readonly model: string, private readonly temperature = 0.2, private readonly maxTokens = 1800) {}
  private async request(request: LLMRequest) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', signal: controller.signal, headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'chrome-extension://orbit-job-assistant' }, body: JSON.stringify({ model: this.model, temperature: request.temperature ?? this.temperature, max_tokens: request.maxTokens ?? this.maxTokens, messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.user }] }) });
      if (!response.ok) throw new Error(`OpenRouter request failed (${response.status})`);
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      return data.choices?.[0]?.message?.content?.trim() ?? '';
    } finally { clearTimeout(timer); }
  }
  async generateText(request: LLMRequest) { return this.request(request); }
  async generateJson<T>(request: LLMRequest) { const raw = await this.request(request); const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, ''); return JSON.parse(cleaned) as T; }
  async extractResumeData(text: string) { return this.generateJson<ResumeStructuredData>({ system: 'Extract structured resume data. Return valid JSON only. Preserve facts and use empty arrays for unknown values.', user: `Return this schema: firstName, lastName, fullName, email, phone, address, city, province, postalCode, linkedin, portfolio, website, workAuthorization, jobTitles[], skills[], companies[], workExperience[{title,company,dates,bullets[]}], achievements[], projects[], education[], certifications[], languages[], tools[], industries[]. RESUME TEXT:\n${text.slice(0, 18000)}`, maxTokens: 2200 }); }
  async analyzeJob(job: Job, resumes: Resume[], profile: UserProfile) { return this.generateJson<{ analysis: JobAnalysis; matches: ResumeMatch[] }>({ system: 'You are a careful job application assistant. Return valid JSON only.', user: jobAnalysisPrompt(job, resumes, profile) }); }
  async generateFieldAnswer(input: Parameters<LLMProvider['generateFieldAnswer']>[0]) { return this.generateText({ system: 'You help a candidate write truthful application answers. Return only the answer text.', user: fieldGenerationPrompt(input), maxTokens: 1000 }); }
}
