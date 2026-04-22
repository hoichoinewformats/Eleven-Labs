import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from './middleware.js';

const signupSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  // First account becomes admin automatically; otherwise defaults to writer.
  role: z.enum(['admin', 'writer', 'viewer']).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/signup', async (req, reply) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const { name, email, password } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return reply.code(409).send({ error: 'email_in_use' });

    const userCount = await prisma.user.count();
    // Bootstrap: the first user is the admin. After that, creating non-default
    // roles requires an admin to use POST /auth/users.
    const role = userCount === 0 ? 'admin' : 'writer';

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, passwordHash, role },
    });

    const token = app.jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role });
    return reply.send({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  });

  app.post('/auth/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return reply.code(401).send({ error: 'invalid_credentials' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return reply.code(401).send({ error: 'invalid_credentials' });

    const token = app.jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role });
    return reply.send({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  });

  app.get('/auth/me', { preHandler: [requireAuth] }, async (req) => {
    return { user: req.currentUser };
  });

  // Admin: list users
  app.get('/auth/users', { preHandler: [requireAuth, requireRole('admin')] }, async () => {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return { users };
  });

  // Admin: create a user with explicit role
  app.post('/auth/users', { preHandler: [requireAuth, requireRole('admin')] }, async (req, reply) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    const { name, email, password, role } = parsed.data;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return reply.code(409).send({ error: 'email_in_use' });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, passwordHash, role: role ?? 'writer' },
    });
    return reply.send({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  });

  // Admin: update a user's role
  app.patch('/auth/users/:id/role', { preHandler: [requireAuth, requireRole('admin')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ role: z.enum(['admin', 'writer', 'viewer']) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    const user = await prisma.user.update({ where: { id }, data: { role: body.data.role } });
    return reply.send({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  });
}
