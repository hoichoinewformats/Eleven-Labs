import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export type { User, Project, Script, Episode, Character, Dialogue, VoiceMatch } from '@prisma/client';
export { Role, ScriptStatus, Gender, AgeBucket } from '@prisma/client';
