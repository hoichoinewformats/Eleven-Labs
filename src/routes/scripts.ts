import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { processScript } from '../lib/processing.js';

const SCRIPT_LIMIT_PER_PROJECT = 50;

export async function scriptRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // List scripts in a project
  app.get('/projects/:id/scripts', async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) return reply.code(404).send({ error: 'project_not_found' });
    const scripts = await prisma.script.findMany({
      where: { projectId: id },
      orderBy: { createdAt: 'desc' },
    });
    return { scripts: scripts.map(serializeScript) };
  });

  // Upload a DOCX -> create script row -> kick off processing in background
  app.post(
    '/projects/:id/scripts',
    { preHandler: [requireRole('admin', 'writer')] },
    async (req, reply) => {
      const { id: projectId } = req.params as { id: string };
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) return reply.code(404).send({ error: 'project_not_found' });

      const count = await prisma.script.count({ where: { projectId } });
      if (count >= SCRIPT_LIMIT_PER_PROJECT) {
        return reply.code(409).send({ error: 'project_full', limit: SCRIPT_LIMIT_PER_PROJECT });
      }

      const file = await req.file();
      if (!file) return reply.code(400).send({ error: 'no_file' });

      const isDocx =
        file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        file.filename.toLowerCase().endsWith('.docx');
      if (!isDocx) {
        return reply.code(415).send({ error: 'unsupported_type', expected: 'docx' });
      }

      await fs.mkdir(env.UPLOAD_DIR, { recursive: true });
      const safeName = `${crypto.randomUUID()}.docx`;
      const storagePath = path.join(env.UPLOAD_DIR, safeName);
      const buffer = await file.toBuffer();
      await fs.writeFile(storagePath, buffer);

      const displayName = file.filename.replace(/\.[^.]+$/, '');
      const script = await prisma.script.create({
        data: {
          projectId,
          name: displayName,
          filename: file.filename,
          storagePath: safeName,
          sizeBytes: buffer.length,
          status: 'pending',
        },
      });

      // Kick off processing without awaiting; client polls /scripts/:id for status.
      processScript(script.id).catch((err) => {
        console.error(`processScript(${script.id}) failed:`, err);
      });

      return reply.send({ script: serializeScript(script) });
    },
  );

  app.get('/scripts/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const script = await prisma.script.findUnique({ where: { id } });
    if (!script) return reply.code(404).send({ error: 'not_found' });
    return { script: serializeScript(script) };
  });

  app.delete('/scripts/:id', { preHandler: [requireRole('admin', 'writer')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const script = await prisma.script.findUnique({ where: { id } });
    if (!script) return reply.code(404).send({ error: 'not_found' });
    await prisma.script.delete({ where: { id } });
    // Best-effort cleanup of the file
    try {
      await fs.unlink(path.resolve(env.UPLOAD_DIR, path.basename(script.storagePath)));
    } catch {
      /* ignore */
    }
    return { ok: true };
  });

  // Manual re-process trigger (useful if a previous run errored)
  app.post('/scripts/:id/reprocess', { preHandler: [requireRole('admin', 'writer')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const script = await prisma.script.findUnique({ where: { id } });
    if (!script) return reply.code(404).send({ error: 'not_found' });
    processScript(id).catch((err) => console.error(`reprocess(${id}) failed:`, err));
    return { ok: true, status: 'processing' };
  });
}

function serializeScript(s: {
  id: string;
  projectId: string;
  name: string;
  filename: string;
  sizeBytes: number;
  status: string;
  errorMessage: string | null;
  createdAt: Date;
  processedAt: Date | null;
}) {
  return {
    id: s.id,
    projectId: s.projectId,
    name: s.name,
    filename: s.filename,
    size: s.sizeBytes,
    status: s.status,
    errorMessage: s.errorMessage,
    uploadedAt: s.createdAt.getTime(),
    processedAt: s.processedAt?.getTime() ?? null,
    processed: s.status === 'done',
  };
}
