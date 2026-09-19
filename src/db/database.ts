import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ApplicationRecord, FieldRule, FormField, Job, JobSession, KnowledgeItem, Resume, Settings, UserProfile } from '../types/models';

interface OrbitDB extends DBSchema {
  resumes: { key: string; value: Resume };
  jobs: { key: string; value: Job; indexes: { 'by-status': string; 'by-updated': string } };
  sessions: { key: string; value: JobSession };
  fields: { key: string; value: FormField };
  fieldRules: { key: string; value: FieldRule };
  knowledge: { key: string; value: KnowledgeItem };
  settings: { key: string; value: Settings };
  profile: { key: string; value: UserProfile };
  applications: { key: string; value: ApplicationRecord };
}

export const dbPromise: Promise<IDBPDatabase<OrbitDB>> = openDB<OrbitDB>('orbit-job-assistant', 2, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('resumes')) db.createObjectStore('resumes');
    if (!db.objectStoreNames.contains('jobs')) {
      const jobs = db.createObjectStore('jobs'); jobs.createIndex('by-status', 'status'); jobs.createIndex('by-updated', 'lastActivityAt');
    }
    if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions');
    if (!db.objectStoreNames.contains('fields')) db.createObjectStore('fields');
    if (!db.objectStoreNames.contains('fieldRules')) db.createObjectStore('fieldRules');
    if (!db.objectStoreNames.contains('knowledge')) db.createObjectStore('knowledge');
    if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
    if (!db.objectStoreNames.contains('profile')) db.createObjectStore('profile');
    if (!db.objectStoreNames.contains('applications')) db.createObjectStore('applications');
  },
});
