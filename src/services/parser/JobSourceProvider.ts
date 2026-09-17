import type { Job, Settings } from '../../types/models';
export interface JobSourceProvider { readonly name: string; fetchJobs(settings: Settings): Promise<Partial<Job>[]>; }
