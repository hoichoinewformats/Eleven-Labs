import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Role } from '@prisma/client';

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
    req.currentUser = req.user;
  } catch {
    return reply.code(401).send({ error: 'unauthorized' });
  }
}

export function requireRole(...allowed: Role[]) {
  return async function (req: FastifyRequest, reply: FastifyReply) {
    if (!req.currentUser) return reply.code(401).send({ error: 'unauthorized' });
    if (!allowed.includes(req.currentUser.role)) {
      return reply.code(403).send({ error: 'forbidden', need: allowed });
    }
  };
}
