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

// Per-script ring buffer. Without this, an SSE client that connects after
// the worker has already emitted `parsing`/`analyzing` would miss those
// events. The buffer is replayed on connect by `getBufferedEvents`.
//
// Bounded at MAX_BUFFER per script and dropped TTL_MS after the script
// hits a terminal state, so memory doesn't grow unbounded.
const MAX_BUFFER = 200;
const TTL_MS = 60_000;
const buffers = new Map<string, ScriptEvent[]>();
const cleanupTimers = new Map<string, NodeJS.Timeout>();

function pushToBuffer(event: ScriptEvent): void {
  const buf = buffers.get(event.scriptId) ?? [];
  buf.push(event);
  if (buf.length > MAX_BUFFER) buf.shift();
  buffers.set(event.scriptId, buf);

  if (event.type === 'done' || event.type === 'error') {
    // Keep the buffer briefly so a reconnecting client can still see the
    // full history. After TTL, drop it to free memory.
    const existing = cleanupTimers.get(event.scriptId);
    if (existing) clearTimeout(existing);
    cleanupTimers.set(
      event.scriptId,
      setTimeout(() => {
        buffers.delete(event.scriptId);
        cleanupTimers.delete(event.scriptId);
      }, TTL_MS),
    );
  }
}

export function getBufferedEvents(scriptId: string): ScriptEvent[] {
  return buffers.get(scriptId) ?? [];
}

export async function publishScriptEvent(event: DistributiveOmit<ScriptEvent, 'ts'>): Promise<void> {
  const stamped = { ...event, ts: Date.now() } as ScriptEvent;
  pushToBuffer(stamped);
  bus.emit(channel(stamped.scriptId), stamped);
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
