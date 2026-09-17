import { describe, expect, it } from 'vitest';
import { normalizePageContext } from './normalization';
import type { PageContext } from '../../types/models';

const context: PageContext = { title: 'Senior Operations Manager', url: 'https://example.com/jobs/1', extractedText: 'Senior Operations Manager at Northwind\nLocation: Vancouver, BC\nRemote\nResponsibilities\nManage continuous improvement projects\nRequirements\n5 years experience\nSalary $90,000 - $110,000 annually', metadata: {}, capturedAt: '2026-01-01' };
describe('job normalization', () => { it('creates a stable common job shape', () => { const job = normalizePageContext(context); expect(job.title).toBe('Senior Operations Manager'); expect(job.company).toContain('Northwind'); expect(job.remoteType).toBe('remote'); expect(job.requirements.length).toBeGreaterThan(0); expect(job.salary).toContain('$90,000'); }); });
