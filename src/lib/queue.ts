import { Queue, Worker, type Job } from 'bullmq';
import { makeBullConnection } from './redis.js';
import { processScript } from './processing.js';
import { publishScriptEvent } from './events.js';

export const SCRIPT_QUEUE = 'script-processing';

export type ScriptJobData = {
  scriptId: string;
};

let queue: Queue<ScriptJobData> | null = null;

export function getScriptQueue(): Queue<ScriptJobData> {
  if (!queue) {
    queue = new Queue<ScriptJobData>(SCRIPT_QUEUE, {
      connection: makeBullConnection(),
      defaultJobOptions: {
        attempts: 1, // Claude/EL calls cost money; don't retry blindly
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 200 },
      },
    });
  }
  return queue;
}

export async function enqueueScript(scriptId: string): Promise<void> {
  const q = getScriptQueue();
  await publishScriptEvent({ type: 'queued', scriptId });
  await q.add('process', { scriptId }, { jobId: scriptId }); // jobId = scriptId prevents accidental dupes
}

/**
 * Start a worker. Call from `src/worker.ts` (separate process, recommended)
 * or from `src/server.ts` when WORKER_MODE=inline (dev convenience).
 */
export function startScriptWorker(): Worker<ScriptJobData> {
  const worker = new Worker<ScriptJobData>(
    SCRIPT_QUEUE,
    async (job: Job<ScriptJobData>) => {
      await processScript(job.data.scriptId);
    },
    {
      connection: makeBullConnection(),
      concurrency: 2, // tune based on Anthropic / ElevenLabs rate limits
    },
  );

  worker.on('failed', (job, err) => {
    console.error(`[worker] job ${job?.id} failed:`, err.message);
  });
  worker.on('completed', (job) => {
    console.log(`[worker] job ${job.id} done`);
  });

  return worker;
}
