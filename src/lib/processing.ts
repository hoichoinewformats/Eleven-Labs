import path from 'node:path';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { docxToText } from './docx.js';
import { analyzeScript, rankVoicesForCharacter, type AnalyzedCharacter } from './claude.js';
import {
  searchSharedVoices,
  ageLabelForVoice,
  languageLabelForVoice,
} from './elevenlabs.js';
import { Gender, AgeBucket, ScriptStatus } from '@prisma/client';

// Map Claude's free-text age strings into our enum.
function ageToBucket(age: string): AgeBucket {
  switch (age) {
    case 'teen':
      return 'teen' as AgeBucket;
    case 'young':
      return 'young' as AgeBucket;
    case 'middle-aged':
    case 'middle_aged':
      return 'middle_aged' as AgeBucket;
    case 'elder':
    case 'old':
      return 'elder' as AgeBucket;
    default:
      return 'unspecified' as AgeBucket;
  }
}

function genderToEnum(g: string): Gender {
  if (g === 'Male') return 'Male' as Gender;
  if (g === 'Female') return 'Female' as Gender;
  return 'Unspecified' as Gender;
}

function canonicalize(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s*\/.*$/, '') // drop "/ alias" parts
    .replace(/\(.*?\)/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Run the full pipeline for a script row. Updates status to processing,
 * then done or error. Idempotent in the sense that re-running clears
 * existing episodes/characters first.
 */
export async function processScript(scriptId: string): Promise<void> {
  const script = await prisma.script.findUnique({ where: { id: scriptId }, include: { project: true } });
  if (!script) throw new Error(`script not found: ${scriptId}`);

  await prisma.script.update({
    where: { id: scriptId },
    data: { status: ScriptStatus.processing, errorMessage: null },
  });

  try {
    const fullPath = path.isAbsolute(script.storagePath)
      ? script.storagePath
      : path.resolve(env.UPLOAD_DIR, path.basename(script.storagePath));
    const text = await docxToText(fullPath);
    if (!text || text.length < 30) {
      throw new Error('Script appears to be empty after DOCX extraction.');
    }

    const analysis = await analyzeScript(text);
    if (!analysis.episodes?.length) {
      throw new Error('Claude returned no episodes for this script.');
    }

    // Wipe previous results if re-processing
    await prisma.episode.deleteMany({ where: { scriptId } });

    for (const ep of analysis.episodes) {
      const episode = await prisma.episode.create({
        data: {
          scriptId,
          episodeNumber: ep.episodeNumber,
          title: ep.title ?? null,
          rawText: text, // store the source text once per episode for now; cheap and useful for re-analysis
        },
      });

      for (const ch of ep.characters) {
        const character = await prisma.character.create({
          data: {
            episodeId: episode.id,
            canonicalKey: canonicalize(ch.name),
            name: ch.name,
            role: ch.role,
            gender: genderToEnum(ch.gender),
            age: ageToBucket(ch.age),
            mood: ch.mood,
            lineCount: ch.lineCount ?? ch.dialogues.length,
            dialogues: {
              create: ch.dialogues.map((d, i) => ({
                sequence: d.sequence ?? i + 1,
                text: d.text,
                sceneCue: d.sceneCue ?? null,
              })),
            },
          },
        });

        try {
          await matchAndStoreVoices(character.id, ch, analysis.language || script.project.language);
        } catch (err) {
          // Voice matching failures shouldn't kill the whole pipeline -
          // the casting sheet can still show the character with no voices.
          console.error(`voice match failed for ${ch.name}:`, err);
        }
      }
    }

    await prisma.script.update({
      where: { id: scriptId },
      data: { status: ScriptStatus.done, processedAt: new Date() },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.script.update({
      where: { id: scriptId },
      data: { status: ScriptStatus.error, errorMessage: msg },
    });
    throw err;
  }
}

async function matchAndStoreVoices(characterId: string, ch: AnalyzedCharacter, language: string): Promise<void> {
  const candidates = await searchSharedVoices({
    language,
    gender: ch.gender,
    age: ch.age,
    pageSize: 30,
  });

  // If gender-filtered search returns too few, retry without gender filter
  let pool = candidates;
  if (pool.length < 5) {
    pool = await searchSharedVoices({ language, age: ch.age, pageSize: 30 });
  }
  if (pool.length === 0) return;

  const ranked = await rankVoicesForCharacter(
    {
      name: ch.name,
      role: ch.role,
      gender: ch.gender,
      age: ch.age,
      mood: ch.mood,
      language,
    },
    pool,
  );

  const byId = new Map(pool.map((v) => [v.voice_id, v]));
  const top3 = ranked
    .filter((r) => byId.has(r.voice_id))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 3);

  for (const r of top3) {
    const v = byId.get(r.voice_id)!;
    if (!v.preview_url) continue;
    await prisma.voiceMatch.upsert({
      where: { characterId_rank: { characterId, rank: r.rank } },
      create: {
        characterId,
        rank: r.rank,
        voiceId: v.voice_id,
        voiceName: v.name,
        language: languageLabelForVoice(v, language),
        age: ageLabelForVoice(v),
        previewUrl: v.preview_url,
        reason: r.reason,
      },
      update: {
        voiceId: v.voice_id,
        voiceName: v.name,
        language: languageLabelForVoice(v, language),
        age: ageLabelForVoice(v),
        previewUrl: v.preview_url,
        reason: r.reason,
      },
    });
  }
}
