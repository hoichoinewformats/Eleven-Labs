import mammoth from 'mammoth';
import fs from 'node:fs/promises';

export async function docxToText(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const result = await mammoth.extractRawText({ buffer });
  // Strip excessive blank lines but preserve paragraph structure since
  // dialogue formatting tends to be paragraph-per-line in scripts.
  return result.value
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
