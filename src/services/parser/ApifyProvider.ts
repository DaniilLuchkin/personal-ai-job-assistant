import type { Job, Settings } from '../../types/models';
import type { JobSourceProvider } from './JobSourceProvider';

export class ApifyProvider implements JobSourceProvider {
  readonly name = 'Apify';
  constructor(private readonly apiKey: string, private readonly actor: string) {}
  async fetchJobs(settings: Settings): Promise<Partial<Job>[]> {
    if (!this.apiKey || !this.actor) throw new Error('Configure an Apify API key and actor first.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 130_000);
    let response: Response;
    try {
      response = await fetch(`https://api.apify.com/v2/acts/${encodeURIComponent(this.actor)}/runs?token=${encodeURIComponent(this.apiKey)}&waitForFinish=120`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ jobTitles: settings.jobTitles, keywords: settings.keywords, locations: settings.locations, remoteTypes: settings.remoteTypes, platforms: settings.platforms, excludeKeywords: settings.excludeKeywords, minimumSalary: settings.minimumSalary }) });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error(`Apify run failed (${response.status})`);
    const run = await response.json() as { data?: { defaultDatasetId?: string } };
    if (!run.data?.defaultDatasetId) return [];
    const datasetController = new AbortController();
    const datasetTimer = setTimeout(() => datasetController.abort(), 30_000);
    let dataset: Response;
    try {
      dataset = await fetch(`https://api.apify.com/v2/datasets/${run.data.defaultDatasetId}/items?token=${encodeURIComponent(this.apiKey)}`, { signal: datasetController.signal });
    } finally {
      clearTimeout(datasetTimer);
    }
    if (!dataset.ok) throw new Error(`Apify dataset failed (${dataset.status})`);
    return await dataset.json() as Partial<Job>[];
  }
}
