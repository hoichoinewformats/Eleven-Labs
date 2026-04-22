import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  PageBreak,
  Packer,
} from 'docx';

export type EpisodeBlock = {
  scriptName: string;
  episodeNumber: number;
  episodeTitle: string | null;
  characterName: string;
  role: string;
  mood: string;
  lineCount: number;
  dialogues: { sequence: number; text: string; sceneCue: string | null }[];
};

export type CharacterDialogueDoc = {
  projectName: string;
  displayName: string;
  totalLines: number;
  episodes: EpisodeBlock[];
};

/**
 * Produce a voice-actor-friendly DOCX:
 *  - Title page: character name, project, total line count
 *  - One section per episode, with the mood description as a subtitle
 *  - Each line numbered, with optional scene cue in italic parentheses
 *
 * Returns a Buffer ready to send as `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.
 */
export async function buildCharacterDialogueDocx(
  data: CharacterDialogueDoc,
): Promise<Buffer> {
  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 400, after: 200 },
      children: [
        new TextRun({ text: data.displayName, bold: true, size: 56 }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [
        new TextRun({ text: data.projectName, italics: true, size: 28, color: '666666' }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 },
      children: [
        new TextRun({
          text: `${data.totalLines} lines across ${data.episodes.length} episode${data.episodes.length === 1 ? '' : 's'}`,
          size: 22,
          color: '888888',
        }),
      ],
    }),
  );

  data.episodes.forEach((ep, epIndex) => {
    if (epIndex > 0) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }

    const epTitle = ep.episodeTitle
      ? `Episode ${ep.episodeNumber} — ${ep.episodeTitle}`
      : `Episode ${ep.episodeNumber}`;

    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 200, after: 100 },
        children: [new TextRun({ text: epTitle, bold: true, size: 36 })],
      }),
      new Paragraph({
        spacing: { after: 60 },
        children: [
          new TextRun({ text: 'Source: ', bold: true, size: 20, color: '888888' }),
          new TextRun({ text: ep.scriptName, size: 20, color: '888888' }),
        ],
      }),
      new Paragraph({
        spacing: { after: 60 },
        children: [
          new TextRun({ text: 'Role: ', bold: true, size: 20, color: '888888' }),
          new TextRun({ text: ep.role, size: 20, color: '888888' }),
        ],
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [
          new TextRun({ text: 'Mood: ', bold: true, size: 20, color: '888888' }),
          new TextRun({ text: ep.mood, italics: true, size: 20, color: '888888' }),
        ],
      }),
    );

    ep.dialogues.forEach((d, i) => {
      const num = (i + 1).toString().padStart(2, '0');
      const runs: TextRun[] = [
        new TextRun({ text: `${num}. `, bold: true, size: 22, color: 'D20820' }),
      ];
      if (d.sceneCue) {
        runs.push(
          new TextRun({
            text: `(${d.sceneCue}) `,
            italics: true,
            size: 22,
            color: '888888',
          }),
        );
      }
      runs.push(new TextRun({ text: d.text, size: 24 }));
      children.push(
        new Paragraph({
          spacing: { after: 160, line: 320 },
          children: runs,
        }),
      );
    });
  });

  const doc = new Document({
    creator: 'Logline AI',
    title: `${data.displayName} — ${data.projectName}`,
    sections: [{ children }],
  });

  return Packer.toBuffer(doc);
}

export function safeFilename(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'character'
  );
}
