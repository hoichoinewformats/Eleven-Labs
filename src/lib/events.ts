import { EventEmitter } from 'node:events';

// Progress events emitted by the script-processing pipeline. The frontend
// consumes these via the SSE endpoint to drive the upload progress UI.
export type ScriptEvent =
  | { type: 'queued'; scriptId: string; ts: number }
  | { type: 'parsing'; scriptId: string; ts: number }
  | { type: 'analyzing'; scriptId: string; ts: number }
  | { type: 'analysis_done'; scriptId: string; episodeCount: number; characterCount: number; ts: number }
  | { type: 'matching_voices'; scriptId: string; character: string; index: number; total: number; ts: number }
  | { type: 'character_done'; scriptId: string; character: string; voiceCount: number; ts: number }
  | { type: 'done'; scriptId: string; ts: number }
  | { type: 'error'; scriptId: string; message: string; ts: number };

// In-process pub/sub. Works because the pg-boss worker runs in the same
// process as the API (single-process mode). If you ever split worker out,
// swap this for Postgres LISTEN/NOTIFY using the pg client.
const bus = new EventEmitter();
// Drop the default 10-listener cap - we may have many concurrent SSE
// subscribers per script during development.
bus.setMaxListeners(0);

const channel = (scriptId: string) => `script:events:${scriptId}`;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export async function publishScriptEvent(event: DistributiveOmit<ScriptEvent, 'ts'>): Promise<void> {
  bus.emit(channel(event.scriptId), { ...event, ts: Date.now() });
}

/**
 * Subscribe to events for one script. Returns an unsubscribe function.
 */
export function subscribeScriptEvents(
  scriptId: string,
  onEvent: (event: ScriptEvent) => void,
): () => void {
  const ch = channel(scriptId);
  bus.on(ch, onEvent);
  return () => {
    bus.off(ch, onEvent);
  };
}
