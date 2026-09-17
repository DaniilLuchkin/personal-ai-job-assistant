import { describe, expect, it } from 'vitest';
import { heuristicResumeData } from './parser';
describe('resume extraction fallback', () => { it('extracts reusable contact and skills', () => { const result = heuristicResumeData('Jane Doe\njane@example.com\n(604) 555-1234\nSkills: Jira, Power BI, Excel\nProject Manager'); expect(result.fullName).toBe('Jane Doe'); expect(result.email).toBe('jane@example.com'); expect(result.skills).toContain('Jira'); expect(result.jobTitles).toContain('Project Manager'); }); });
