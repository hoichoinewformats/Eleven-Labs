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
import { startScriptWorker } from './lib/queue.js';
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
    origin: env.CORS_ORIGIN,
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

    // In inline mode (dev default) we also run a worker in this process so
    // `npm run dev` is a single command. In queue mode (production) the API
    // only enqueues; run `npm run start:worker` in a separate process.
    if (env.WORKER_MODE === 'inline') {
      const w = startScriptWorker();
      app.log.info(
        `WORKER_MODE=inline: in-process BullMQ worker attached (concurrency ${w.opts.concurrency ?? 'default'})`,
      );
    } else {
      app.log.info('WORKER_MODE=queue: API enqueues only - run `npm run start:worker` separately.');
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
