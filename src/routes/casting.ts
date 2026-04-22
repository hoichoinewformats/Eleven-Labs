import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/middleware.js';

// Mirror the frontend's CASTING_DATA shape exactly so the React app can
// drop `fetch('/api/scripts/:id/casting')` straight in where the hardcoded
// array lives today.
type CastingVoice = {
  name: string;
  voiceId: string;
  language: string;
  age: string;
  previewUrl: string;
  reason: string;
};

type CastingCharacter = {
  id: number;
  name: string;
  role: string;
  lines: number;
  age: string;
  gender: 'Male' | 'Female' | 'Unspecified';
  mood: string;
  voices: CastingVoice[];
};

const ageEnumToLabel: Record<string, string> = {
  teen: 'teen',
  young: 'young',
  middle_aged: 'middle-aged',
  elder: 'elder',
  unspecified: 'unspecified',
};

export async function castingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // Whole-script casting sheet (all episodes flattened, characters merged by canonicalKey)
  app.get('/scripts/:id/casting', async (req, reply) => {
    const { id } = req.params as { id: string };
    const script = await prisma.script.findUnique({
      where: { id },
      include: {
        episodes: {
          include: {
            characters: {
              include: {
                voices: { orderBy: { rank: 'asc' } },
              },
            },
          },
        },
      },
    });
    if (!script) return reply.code(404).send({ error: 'not_found' });

    // Merge same-canonical characters across episodes (sum lineCount, take first non-null fields)
    const merged = new Map<string, CastingCharacter>();
    let nextId = 1;

    for (const ep of script.episodes) {
      for (const c of ep.characters) {
        const key = c.canonicalKey || c.name.toLowerCase();
        const existing = merged.get(key);
        if (existing) {
          existing.lines += c.lineCount;
          // Keep the longest mood text; first-seen voices/role
          if (c.mood.length > existing.mood.length) existing.mood = c.mood;
          continue;
        }
        merged.set(key, {
          id: nextId++,
          name: c.name,
          role: c.role,
          lines: c.lineCount,
          age: ageEnumToLabel[c.age] ?? 'unspecified',
          gender: c.gender as 'Male' | 'Female' | 'Unspecified',
          mood: c.mood,
          voices: c.voices.map((v) => ({
            name: v.voiceName,
            voiceId: v.voiceId,
            language: v.language,
            age: v.age,
            previewUrl: v.previewUrl,
            reason: v.reason,
          })),
        });
      }
    }

    const characters = [...merged.values()].sort((a, b) => b.lines - a.lines);
    return {
      script: { id: script.id, name: script.name, status: script.status },
      characters,
    };
  });

  // Per-episode casting sheet
  app.get('/episodes/:id/casting', async (req, reply) => {
    const { id } = req.params as { id: string };
    const episode = await prisma.episode.findUnique({
      where: { id },
      include: {
        characters: {
          include: { voices: { orderBy: { rank: 'asc' } } },
          orderBy: { lineCount: 'desc' },
        },
      },
    });
    if (!episode) return reply.code(404).send({ error: 'not_found' });

    const characters: CastingCharacter[] = episode.characters.map((c, i) => ({
      id: i + 1,
      name: c.name,
      role: c.role,
      lines: c.lineCount,
      age: ageEnumToLabel[c.age] ?? 'unspecified',
      gender: c.gender as 'Male' | 'Female' | 'Unspecified',
      mood: c.mood,
      voices: c.voices.map((v) => ({
        name: v.voiceName,
        voiceId: v.voiceId,
        language: v.language,
        age: v.age,
        previewUrl: v.previewUrl,
        reason: v.reason,
      })),
    }));

    return {
      episode: { id: episode.id, episodeNumber: episode.episodeNumber, title: episode.title },
      characters,
    };
  });

  // List episodes for a script (for the per-episode dropdown)
  app.get('/scripts/:id/episodes', async (req, reply) => {
    const { id } = req.params as { id: string };
    const episodes = await prisma.episode.findMany({
      where: { scriptId: id },
      orderBy: { episodeNumber: 'asc' },
      include: { _count: { select: { characters: true } } },
    });
    return {
      episodes: episodes.map((e) => ({
        id: e.id,
        episodeNumber: e.episodeNumber,
        title: e.title,
        characterCount: e._count.characters,
      })),
    };
  });
}
