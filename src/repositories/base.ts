import { dbPromise } from '../db/database';
export class Repository<T extends { id: string }> {
  constructor(private readonly store: 'resumes' | 'jobs' | 'sessions' | 'fields' | 'knowledge' | 'applications') {}
  async list(): Promise<T[]> { return (await (await dbPromise).getAll(this.store)) as unknown as T[]; }
  async get(id: string): Promise<T | undefined> { return (await (await dbPromise).get(this.store, id)) as unknown as T | undefined; }
  async put(value: T): Promise<T> { await (await dbPromise).put(this.store, value as never, value.id); return value; }
  async delete(id: string): Promise<void> { await (await dbPromise).delete(this.store, id); }
}
