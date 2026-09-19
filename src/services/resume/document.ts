const safeFilePart = (value: string) => value.replace(/[^a-z0-9 _-]+/gi, '').trim().replace(/\s+/g, '-') || 'adapted';

export async function createResumeDocx(text: string, title: string): Promise<File> {
  const { Document, Packer, Paragraph, TextRun } = await import('docx');
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const children = lines.map((line) => {
    const trimmed = line.trim();
    const heading = trimmed.length > 0 && trimmed.length < 55 && /^[A-Z][A-Z\s/&-]+$/.test(trimmed);
    const bullet = /^[-•*]\s+/.test(trimmed);
    return new Paragraph({
      text: bullet ? trimmed.replace(/^[-•*]\s+/, '') : undefined,
      bullet: bullet ? { level: 0 } : undefined,
      spacing: { after: heading ? 80 : 45 },
      children: bullet ? undefined : [new TextRun({ text: trimmed || ' ', bold: heading, size: heading ? 24 : 21 })],
    });
  });
  const document = new Document({ sections: [{ properties: {}, children }] });
  const blob = await Packer.toBlob(document);
  return new File([blob], `${safeFilePart(title)}.docx`, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
