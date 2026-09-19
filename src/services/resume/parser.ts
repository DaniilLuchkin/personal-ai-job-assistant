import type { ResumeStructuredData } from '../../types/models';
import { extractOcrText } from './ocr';

const normalizeResumeText = (value: string) => value
  .replace(/\r\n?/g, '\n')
  .split('\n')
  .map((line) => line.replace(/[ \t]+/g, ' ').trim())
  .filter(Boolean)
  .join('\n');

export async function extractResumeText(file: File): Promise<string> {
  const fileName = file.name.toLowerCase();
  if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || fileName.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return normalizeResumeText(result.value);
  }
  if (file.type === 'application/pdf' || fileName.endsWith('.pdf')) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages: string[] = [];
    const pdfPages = [];
    for (let index = 1; index <= pdf.numPages; index += 1) {
      const page = await pdf.getPage(index);
      pdfPages.push(page);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => 'str' in item ? item.str : '').join(' '));
    }
    const extractedText = normalizeResumeText(pages.join('\n'));
    if (extractedText) return extractedText;
    return normalizeResumeText(await extractOcrText(pdfPages));
  }
  return normalizeResumeText(await file.text());
}

const emptyStructured = (): ResumeStructuredData => ({ jobTitles: [], skills: [], companies: [], workExperience: [], achievements: [], projects: [], education: [], certifications: [], languages: [], tools: [], industries: [] });

export function heuristicResumeData(text: string): ResumeStructuredData {
  const data = emptyStructured();
  const email = text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0];
  const phone = text.match(/(?:\+?\d[\d\s().-]{7,}\d)/)?.[0];
  const lines = text.split(/\n|\r/).map((line) => line.trim()).filter(Boolean);
  const fullName = lines.slice(0, 10).find((line) => {
    const parts = line.split(/\s+/);
    return line.length <= 70 && parts.length >= 2 && parts.length <= 5 && !/[\d@]|https?:|linkedin|resume|curriculum|profile|summary|experience|education|skills/i.test(line);
  });
  const nameParts = fullName?.split(/\s+/) || [];
  const linkedin = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w%-]+\/?/i)?.[0];
  const website = text.match(/https?:\/\/(?![^\s]*linkedin\.com)[^\s)]+/i)?.[0];
  const workAuthorization = lines.find((line) => /authorized to work|eligible to work|work permit|permanent resident|citizen/i.test(line));
  const skillsLine = lines.find((line) => /skills|technologies|tools/i.test(line));
  const skills = skillsLine?.split(/skills?:|technologies?:|tools?:/i)[1]?.split(/,|\||;/).map((s) => s.trim()).filter(Boolean) ?? [];
  const titleLines = lines.filter((line) => /manager|coordinator|analyst|engineer|designer|developer|specialist|director|lead/i.test(line)).slice(0, 8);
  return { ...data, email, phone, fullName, firstName: nameParts[0], lastName: nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined, linkedin, website, workAuthorization, skills, jobTitles: titleLines };
}
