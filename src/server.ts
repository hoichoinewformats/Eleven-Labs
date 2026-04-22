import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import { env } from './env.js';
import { authRoutes } from './auth/routes.js';
import { projectRoutes } from './routes/projects.js';
import { scriptRoutes } from './routes/scripts.js';
import { castingRoutes } from './routes/casting.js';
import { dialogueRoutes } from './routes/dialogues.js';
import { eventRoutes } from './routes/events.js';
import { startScriptWorker, stopBoss } from './lib/queue.js';
import './types.js';

async function build() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'development' ? 'info' : 'warn',
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
          : undefined,
    },
    bodyLimit: env.MAX_UPLOAD_MB * 1024 * 1024,
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN.length === 1 && env.CORS_ORIGIN[0] === '*' ? true : env.CORS_ORIGIN,
    credentials: true,
  });

  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_EXPIRES_IN },
  });

  await app.register(multipart, {
    limits: {
      fileSize: env.MAX_UPLOAD_MB * 1024 * 1024,
      files: 1,
    },
  });

  app.get('/health', async () => ({ ok: true, ts: Date.now() }));

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(projectRoutes);
      await api.register(scriptRoutes);
      await api.register(castingRoutes);
      await api.register(dialogueRoutes);
      await api.register(eventRoutes);
    },
    { prefix: '/api' },
  );

  return app;
}

async function main() {
  const app = await build();
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(`logline-ai backend listening on http://${env.HOST}:${env.PORT}`);

    // Start the in-process pg-boss worker. Single-process design - no
    // separate worker entrypoint, no Redis. Jobs persist in Postgres so
    // they survive restarts.
    await startScriptWorker({ concurrency: 2 });
    app.log.info('pg-boss worker started (concurrency 2)');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  const shutdown = async (sig: string) => {
    app.log.info(`received ${sig}, shutting down…`);
    await stopBoss();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main();
