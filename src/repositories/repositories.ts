import { dbPromise } from '../db/database';
import { Repository } from './base';
import type { Job, JobSession, FormField, KnowledgeItem, Resume, Settings, UserProfile, ApplicationRecord } from '../types/models';

export class ResumeRepository extends Repository<Resume> { constructor() { super('resumes'); } }
export class JobRepository extends Repository<Job> { constructor() { super('jobs'); } }
export class SessionRepository extends Repository<JobSession> { constructor() { super('sessions'); } }
export class FormFieldRepository extends Repository<FormField> { constructor() { super('fields'); } }
export class KnowledgeRepository extends Repository<KnowledgeItem> { constructor() { super('knowledge'); } }
export class ApplicationRepository extends Repository<ApplicationRecord> { constructor() { super('applications'); } }

export class SettingsRepository {
  async get(): Promise<Settings | undefined> { return (await dbPromise).get('settings', 'default'); }
  async put(value: Settings): Promise<Settings> { await (await dbPromise).put('settings', value, 'default'); return value; }
}
export class UserProfileRepository {
  async get(): Promise<UserProfile | undefined> { return (await dbPromise).get('profile', 'default'); }
  async put(value: UserProfile): Promise<UserProfile> { await (await dbPromise).put('profile', value, 'default'); return value; }
}

export const repos = { resumes: new ResumeRepository(), jobs: new JobRepository(), sessions: new SessionRepository(), fields: new FormFieldRepository(), knowledge: new KnowledgeRepository(), applications: new ApplicationRepository(), settings: new SettingsRepository(), profile: new UserProfileRepository() };
