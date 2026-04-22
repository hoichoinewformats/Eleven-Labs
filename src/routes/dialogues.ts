import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { buildCharacterDialogueDocx, safeFilename } from '../lib/docx-export.js';

function canonicalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s*\/.*$/, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function dialogueRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // All dialogues for one character within a single episode
  app.get('/characters/:id/dialogues', async (req, reply) => {
    const { id } = req.params as { id: string };
    const character = await prisma.character.findUnique({
      where: { id },
      include: {
        dialogues: { orderBy: { sequence: 'asc' } },
        episode: { select: { id: true, episodeNumber: true, title: true, scriptId: true } },
      },
    });
    if (!character) return reply.code(404).send({ error: 'not_found' });
    return {
      character: {
        id: character.id,
        name: character.name,
        role: character.role,
        gender: character.gender,
        age: character.age,
        mood: character.mood,
        lineCount: character.lineCount,
      },
      episode: character.episode,
      dialogues: character.dialogues,
    };
  });

  /**
   * Aggregated episodic dialogues for a character across ALL scripts in a project.
   * This is the "give me every line Ravan speaks across the whole show" endpoint.
   *
   * Characters are matched by canonicalKey so "Ravan / Dashanan" in ep 1
   * aggregates with "Ravan" in ep 12.
   *
   * Query param: `name` (character display name) OR `key` (canonical key).
   */
  app.get('/projects/:id/dialogues', async (req, reply) => {
    const { id: projectId } = req.params as { id: string };
    const q = req.query as { name?: string; key?: string };
    if (!q.name && !q.key) return reply.code(400).send({ error: 'missing_query', need: 'name or key' });

    const canonicalKey = q.key ?? canonicalizeName(q.name ?? '');

    const characters = await prisma.character.findMany({
      where: {
        canonicalKey,
        episode: { script: { projectId } },
      },
      include: {
        dialogues: { orderBy: { sequence: 'asc' } },
        episode: {
          select: {
            id: true,
            episodeNumber: true,
            title: true,
            scriptId: true,
            script: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (characters.length === 0) return reply.code(404).send({ error: 'character_not_found', canonicalKey });

    // Group dialogues by episode, ordered by script.createdAt then episodeNumber.
    // This yields "Episode 1 lines ... Episode 2 lines ..." which is the
    // natural order for handing off to a voice actor.
    const grouped = characters
      .map((c) => ({
        scriptId: c.episode.scriptId,
        scriptName: c.episode.script.name,
        episodeId: c.episode.id,
        episodeNumber: c.episode.episodeNumber,
        episodeTitle: c.episode.title,
        characterId: c.id,
        characterName: c.name,
        role: c.role,
        mood: c.mood,
        lineCount: c.lineCount,
        dialogues: c.dialogues.map((d) => ({
          sequence: d.sequence,
          text: d.text,
          sceneCue: d.sceneCue,
        })),
      }))
      .sort(
        (a, b) =>
          a.scriptName.localeCompare(b.scriptName) || a.episodeNumber - b.episodeNumber,
      );

    const totalLines = grouped.reduce((sum, g) => sum + g.dialogues.length, 0);

    return {
      canonicalKey,
      displayName: characters[0]!.name,
      totalLines,
      episodes: grouped,
    };
  });

  /**
   * DOCX download of every line a character speaks across the whole project.
   * Same data as /projects/:id/dialogues but rendered as a Word document the
   * voice actor can print or annotate.
   */
  app.get('/projects/:id/dialogues.docx', async (req, reply) => {
    const { id: projectId } = req.params as { id: string };
    const q = req.query as { name?: string; key?: string };
    if (!q.name && !q.key) return reply.code(400).send({ error: 'missing_query', need: 'name or key' });

    const canonicalKey = q.key ?? canonicalizeName(q.name ?? '');

    const [project, characters] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectId }, select: { name: true } }),
      prisma.character.findMany({
        where: {
          canonicalKey,
          episode: { script: { projectId } },
        },
        include: {
          dialogues: { orderBy: { sequence: 'asc' } },
          episode: {
            select: {
              episodeNumber: true,
              title: true,
              script: { select: { name: true } },
            },
          },
        },
      }),
    ]);

    if (!project) return reply.code(404).send({ error: 'project_not_found' });
    if (characters.length === 0) return reply.code(404).send({ error: 'character_not_found' });

    const sorted = [...characters].sort(
      (a, b) =>
        a.episode.script.name.localeCompare(b.episode.script.name) ||
        a.episode.episodeNumber - b.episode.episodeNumber,
    );

    const docData = {
      projectName: project.name,
      displayName: characters[0]!.name,
      totalLines: sorted.reduce((sum, c) => sum + c.dialogues.length, 0),
      episodes: sorted.map((c) => ({
        scriptName: c.episode.script.name,
        episodeNumber: c.episode.episodeNumber,
        episodeTitle: c.episode.title,
        characterName: c.name,
        role: c.role,
        mood: c.mood,
        lineCount: c.lineCount,
        dialogues: c.dialogues.map((d) => ({
          sequence: d.sequence,
          text: d.text,
          sceneCue: d.sceneCue,
        })),
      })),
    };

    const buffer = await buildCharacterDialogueDocx(docData);
    const filename = `${safeFilename(project.name)}__${safeFilename(characters[0]!.name)}.docx`;
    return reply
      .header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      )
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(buffer);
  });

  /**
   * List every distinct character in a project - used to populate a
   * "pick a character" dropdown for the episodic dialogue export.
   */
  app.get('/projects/:id/characters', async (req, reply) => {
    const { id: projectId } = req.params as { id: string };
    const rows = await prisma.character.findMany({
      where: { episode: { script: { projectId } } },
      select: {
        name: true,
        canonicalKey: true,
        role: true,
        gender: true,
        age: true,
        lineCount: true,
        episode: { select: { script: { select: { id: true, name: true } } } },
      },
    });

    const grouped = new Map<
      string,
      { canonicalKey: string; name: string; role: string; totalLines: number; appearsIn: Set<string> }
    >();
    for (const r of rows) {
      const key = r.canonicalKey;
      const existing = grouped.get(key);
      if (existing) {
        existing.totalLines += r.lineCount;
        existing.appearsIn.add(r.episode.script.name);
      } else {
        grouped.set(key, {
          canonicalKey: key,
          name: r.name,
          role: r.role,
          totalLines: r.lineCount,
          appearsIn: new Set([r.episode.script.name]),
        });
      }
    }

    return {
      characters: [...grouped.values()]
        .map((c) => ({ ...c, appearsIn: [...c.appearsIn] }))
        .sort((a, b) => b.totalLines - a.totalLines),
    };
  });
}
