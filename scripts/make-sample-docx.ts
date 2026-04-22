/**
 * One-off script: build a small mock 2-episode audio drama DOCX so we can
 * smoke-test the upload + analysis pipeline without depending on real
 * production scripts.
 */
import fs from 'node:fs/promises';
import { Document, Paragraph, TextRun, Packer } from 'docx';

const lines: string[] = [
  'EPISODE 1 - The Prophecy',
  '',
  'NARRATOR: In the kingdom of Lanka, a child was born under a cursed star.',
  'NARRATOR: His destiny would shake the three worlds.',
  '',
  'KAIKESI: My son, you are stronger than any king.',
  'KAIKESI: Promise me you will use this gift for good.',
  '',
  'RAVAN: Mother, I promise. But the world will know my name.',
  'RAVAN (angrily): They have insulted our family for too long.',
  '',
  'VISHRAVA: Calm yourself, my son. Anger is the fuel of the asura.',
  'VISHRAVA: Wisdom is the fuel of kings.',
  '',
  'NARRATOR: And so the seed of greatness was planted, alongside the seed of pride.',
  '',
  '',
  'EPISODE 2 - The Coronation',
  '',
  'NARRATOR: Years passed, and Ravan grew into the warrior the prophecy foretold.',
  '',
  'RAVAN: Today I claim what is mine by right and by might.',
  'RAVAN: Let all the gods bear witness.',
  '',
  'KUBER: Brother, you cannot challenge the order of the heavens.',
  'KUBER (haughty): I am the rightful ruler. Step aside.',
  '',
  'RAVAN: You speak of rights, brother? Then meet me on the field.',
  '',
  'KAIKESI: Stop this madness! You are family!',
  '',
  'NARRATOR: But Ravan did not stop. The throne was his.',
];

const doc = new Document({
  creator: 'logline-ai test',
  title: 'Sample Mythological Drama',
  sections: [
    {
      children: lines.map(
        (l) =>
          new Paragraph({
            children: [new TextRun({ text: l, size: 24 })],
          }),
      ),
    },
  ],
});

const buf = await Packer.toBuffer(doc);
await fs.writeFile('/tmp/sample-script.docx', buf);
console.log(`wrote /tmp/sample-script.docx (${buf.length} bytes)`);
