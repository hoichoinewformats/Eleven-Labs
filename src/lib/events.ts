import { makePublisher, makeSubscriber } from './redis.js';

// Progress events emitted by the script-processing pipeline. Frontend
// receives these over SSE and uses them to drive the upload progress UI.
export type ScriptEvent =
  | { type: 'queued'; scriptId: string; ts: number }
  | { type: 'parsing'; scriptId: string; ts: number }
  | { type: 'analyzing'; scriptId: string; ts: number }
  | {
      type: 'analysis_done';
      scriptId: string;
      episodeCount: number;
      characterCount: number;
      ts: number;
    }
  | {
      type: 'matching_voices';
      scriptId: string;
      character: string;
      index: number;
      total: number;
      ts: number;
    }
  | {
      type: 'character_done';
      scriptId: string;
      character: string;
      voiceCount: number;
      ts: number;
    }
  | { type: 'done'; scriptId: string; ts: number }
  | { type: 'error'; scriptId: string; message: string; ts: number };

export const eventChannel = (scriptId: string) => `script:events:${scriptId}`;

let publisher: ReturnType<typeof makePublisher> | null = null;

function getPublisher() {
  if (!publisher) publisher = makePublisher();
  return publisher;
}

// DistributiveOmit preserves the discriminated union when stripping `ts`,
// otherwise TS collapses the union into a single shape.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export async function publishScriptEvent(event: DistributiveOmit<ScriptEvent, 'ts'>) {
  const payload = JSON.stringify({ ...event, ts: Date.now() });
  await getPublisher().publish(eventChannel(event.scriptId), payload);
}

/**
 * Subscribe to events for a single script. Returns an unsubscribe function
 * that closes the dedicated subscriber connection.
 */
export function subscribeScriptEvents(
  scriptId: string,
  onEvent: (event: ScriptEvent) => void,
): () => Promise<void> {
  const sub = makeSubscriber();
  const channel = eventChannel(scriptId);

  sub.subscribe(channel).catch((err: unknown) => {
    console.error('subscribe failed', err);
  });
  sub.on('message', (_channel: string, payload: string) => {
    try {
      const event = JSON.parse(payload) as ScriptEvent;
      onEvent(event);
    } catch (err) {
      console.error('bad event payload', err);
    }
  });

  return async () => {
    try {
      await sub.unsubscribe(channel);
    } catch {
      /* ignore */
    }
    await sub.quit();
  };
}
