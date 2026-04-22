import PgBoss from 'pg-boss';
import { env } from '../env.js';
import { processScript } from './processing.js';
import { publishScriptEvent } from './events.js';

export const SCRIPT_QUEUE = 'script-processing';

export type ScriptJobData = { scriptId: string };

let boss: PgBoss | null = null;

/**
 * Lazily start pg-boss. pg-boss creates its own `pgboss` schema in the
 * Postgres database on first start. Reuses the existing DATABASE_URL so we
 * need no new env vars for the queue.
 */
export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    // Poll Postgres for new jobs every second (default is 2s).
    pollingIntervalSeconds: 1,
  });
  boss.on('error', (err) => {
    console.error('[pg-boss] error:', err);
  });
  await boss.start();
  return boss;
}

export async function enqueueScript(scriptId: string): Promise<void> {
  const b = await getBoss();
  // singletonKey == scriptId means the same script can't be in the queue
  // twice at once - protects us if the user double-clicks Upload.
  await b.send(SCRIPT_QUEUE, { scriptId } satisfies ScriptJobData, {
    singletonKey: scriptId,
    retryLimit: 0, // LLM/EL calls cost money/credits; don't retry blindly
  });
  await publishScriptEvent({ type: 'queued', scriptId });
}

/**
 * Register the worker handler. Call once during startup. pg-boss returns
 * immediately and starts polling Postgres for jobs in the background.
 *
 * `concurrency` controls how many scripts can be in-flight at once. We
 * implement it via batchSize: pg-boss fetches up to N jobs per poll and
 * we Promise.all them. Tune based on OpenRouter / ElevenLabs rate limits.
 */
export async function startScriptWorker(opts: { concurrency?: number } = {}): Promise<void> {
  const b = await getBoss();
  const concurrency = opts.concurrency ?? 2;
  await b.work<ScriptJobData>(
    SCRIPT_QUEUE,
    { batchSize: concurrency },
    async (jobs) => {
      await Promise.all(
        jobs.map((job) =>
          processScript(job.data.scriptId).catch((err) => {
            console.error(`[worker] script ${job.data.scriptId} failed:`, err);
          }),
        ),
      );
    },
  );
}

export async function stopBoss(): Promise<void> {
  if (boss) {
    await boss.stop({ graceful: true, timeout: 30_000 });
    boss = null;
  }
}
