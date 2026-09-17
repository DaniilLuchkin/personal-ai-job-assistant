import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ApplicationRecord, FormField, Job, JobSession, KnowledgeItem, Resume, Settings, UserProfile } from '../types/models';

interface OrbitDB extends DBSchema {
  resumes: { key: string; value: Resume };
  jobs: { key: string; value: Job; indexes: { 'by-status': string; 'by-updated': string } };
  sessions: { key: string; value: JobSession };
  fields: { key: string; value: FormField };
  knowledge: { key: string; value: KnowledgeItem };
  settings: { key: string; value: Settings };
  profile: { key: string; value: UserProfile };
  applications: { key: string; value: ApplicationRecord };
}

export const dbPromise: Promise<IDBPDatabase<OrbitDB>> = openDB<OrbitDB>('orbit-job-assistant', 1, {
  upgrade(db) {
    db.createObjectStore('resumes');
    const jobs = db.createObjectStore('jobs'); jobs.createIndex('by-status', 'status'); jobs.createIndex('by-updated', 'lastActivityAt');
    db.createObjectStore('sessions'); db.createObjectStore('fields'); db.createObjectStore('knowledge'); db.createObjectStore('settings'); db.createObjectStore('profile'); db.createObjectStore('applications');
  },
});
