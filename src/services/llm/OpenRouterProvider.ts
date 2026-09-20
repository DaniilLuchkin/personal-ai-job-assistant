import type { Job, JobAnalysis, Resume, ResumeMatch, ResumeStructuredData, UserProfile } from '../../types/models';
import type { LLMProvider, LLMRequest } from './LLMProvider';
import { jobAnalysisPrompt } from './prompts/jobAnalysis';
import { fieldGenerationPrompt } from './prompts/fieldGeneration';
import { resumeAdaptationPrompt } from './prompts/resumeAdaptation';
import { normalizeJobAnalysis, normalizeResumeStructuredData } from './validation';
import { parseLLMJson } from './json';
import { cleanFieldAnswer, isUsefulFieldAnswer } from './fieldAnswer';

export class OpenRouterProvider implements LLMProvider {
  readonly name = 'OpenRouter';
  constructor(private readonly apiKey: string, private readonly model: string, private readonly temperature = 0.2, private readonly maxTokens = 1800) {}
  private async request(request: LLMRequest) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const userContent = request.images?.length ? [{ type: 'text', text: request.user }, ...request.images.slice(0, 2).map((url) => ({ type: 'image_url', image_url: { url } }))] : request.user;
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', signal: controller.signal, headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'chrome-extension://orbit-job-assistant' }, body: JSON.stringify({ model: this.model, temperature: request.temperature ?? this.temperature, max_tokens: request.maxTokens ?? this.maxTokens, messages: [{ role: 'system', content: request.system }, { role: 'user', content: userContent }] }) });
      if (!response.ok) throw new Error(`OpenRouter request failed (${response.status})`);
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      return data.choices?.[0]?.message?.content?.trim() ?? '';
    } finally { clearTimeout(timer); }
  }
  async generateText(request: LLMRequest) { return this.request(request); }
  async generateJson<T>(request: LLMRequest) { return parseLLMJson<T>(await this.request(request)); }
  async extractResumeData(text: string) { return normalizeResumeStructuredData(await this.generateJson<ResumeStructuredData>({ system: 'Extract structured resume data. Return valid JSON only. Preserve facts and use empty arrays for unknown values.', user: `Return this schema: firstName, lastName, fullName, email, phone, address, city, province, postalCode, linkedin, portfolio, website, workAuthorization, jobTitles[], skills[], companies[], workExperience[{title,company,dates,bullets[]}], achievements[], projects[], education[], certifications[], languages[], tools[], industries[]. RESUME TEXT:\n${text.slice(0, 18000)}`, maxTokens: 2200 })); }
  async analyzeJob(job: Job, resumes: Resume[], profile: UserProfile, context?: { screenshots?: string[]; extraText?: string }) { return normalizeJobAnalysis(await this.generateJson<{ analysis: JobAnalysis; matches: ResumeMatch[] }>({ system: 'You are a careful job application assistant. Return valid JSON only.', user: `${jobAnalysisPrompt(job, resumes, profile)}${context?.extraText ? `\nADDITIONAL PAGE CONTEXT:\n${context.extraText.slice(0, 4000)}` : ''}`, images: context?.screenshots }), job, resumes); }
  async adaptResume(job: Job, resume: Resume, profile: UserProfile) {
    const result = await this.generateJson<{ adaptedText?: unknown; changeSummary?: unknown; targetTitle?: unknown }>({ system: 'You adapt resumes truthfully. Return valid JSON only and never invent candidate facts.', user: resumeAdaptationPrompt(job, resume, profile), maxTokens: Math.max(this.maxTokens, 3000) });
    const adaptedText = typeof result.adaptedText === 'string' ? result.adaptedText.trim() : '';
    if (adaptedText.length < 100) throw new Error('The LLM did not return a complete adapted resume.');
    return { adaptedText, changeSummary: Array.isArray(result.changeSummary) ? result.changeSummary.map(String).filter(Boolean) : [], targetTitle: typeof result.targetTitle === 'string' && result.targetTitle.trim() ? result.targetTitle.trim() : job.title };
  }
  async generateFieldAnswer(input: Parameters<LLMProvider['generateFieldAnswer']>[0]) {
    const request: LLMRequest = {
      system: 'You write truthful job application answers. The application field question is authoritative. Select relevant candidate facts from the supplied resume evidence and return only polished answer text.',
      user: fieldGenerationPrompt(input),
      temperature: Math.min(this.temperature, 0.35),
      maxTokens: 1000,
    };
    let answer = cleanFieldAnswer(await this.generateText(request));
    if (!isUsefulFieldAnswer(answer, input)) {
      answer = cleanFieldAnswer(await this.generateText({ ...request, system: `${request.system} Your previous response was unusable. Write a coherent direct answer with normal prose and no meta-commentary.` }));
    }
    if (!isUsefulFieldAnswer(answer, input)) throw new Error('The LLM did not produce a usable answer. Check the selected OpenRouter model and try again.');
    return answer;
  }
}
