import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../auth/middleware.js';

const projectInput = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(2000).optional().nullable(),
  language: z.string().min(1).max(40),
  genre: z.string().min(1).max(40),
  medium: z.string().min(1).max(40),
});

// Viewers see all projects in the workspace; writers/admins can create/edit.
// Owner is the user that created the project.
function canEdit(role: string) {
  return role === 'admin' || role === 'writer';
}

export async function projectRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/projects', async (req) => {
    // All authenticated users can see all projects in this workspace.
    const projects = await prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { scripts: true } }, owner: { select: { id: true, name: true, email: true } } },
    });
    return {
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        language: p.language,
        genre: p.genre,
        medium: p.medium,
        createdAt: p.createdAt,
        scriptCount: p._count.scripts,
        owner: p.owner,
      })),
    };
  });

  app.post('/projects', { preHandler: [requireRole('admin', 'writer')] }, async (req, reply) => {
    const parsed = projectInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const project = await prisma.project.create({
      data: { ...parsed.data, ownerId: req.currentUser!.id },
    });
    return reply.send({ project });
  });

  app.get('/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        _count: { select: { scripts: true } },
        owner: { select: { id: true, name: true, email: true } },
      },
    });
    if (!project) return reply.code(404).send({ error: 'not_found' });
    return {
      project: {
        ...project,
        scriptCount: project._count.scripts,
      },
    };
  });

  app.patch('/projects/:id', { preHandler: [requireRole('admin', 'writer')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = projectInput.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    // Writers can only edit their own; admins edit any.
    if (req.currentUser!.role === 'writer' && existing.ownerId !== req.currentUser!.id) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const project = await prisma.project.update({ where: { id }, data: parsed.data });
    return { project };
  });

  app.delete('/projects/:id', { preHandler: [requireRole('admin', 'writer')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    if (req.currentUser!.role === 'writer' && existing.ownerId !== req.currentUser!.id) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    await prisma.project.delete({ where: { id } });
    return { ok: true };
  });
}
