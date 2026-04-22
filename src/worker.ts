/**
 * Standalone BullMQ worker process. Run with `npm run dev:worker` (dev) or
 * `npm run start:worker` (prod). Consumes the script-processing queue and
 * publishes progress events that the API serves over SSE.
 */
import { startScriptWorker } from './lib/queue.js';

const worker = startScriptWorker();
console.log('[worker] started, awaiting jobs…');

async function shutdown(signal: string) {
  console.log(`[worker] received ${signal}, draining…`);
  await worker.close();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
