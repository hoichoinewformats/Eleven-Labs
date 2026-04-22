import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { getBufferedEvents, subscribeScriptEvents } from '../lib/events.js';

/**
 * SSE: live progress for one script.
 *
 * Auth note: EventSource in browsers can't send custom headers, so we accept
 * the JWT either via Authorization header (for tools/curl) or via a `?token=`
 * query string. The frontend typically does:
 *   new EventSource(`/api/scripts/${id}/events?token=${jwt}`)
 *
 * Stream behaviour:
 *  - Sends a `snapshot` event immediately with current DB status.
 *  - Streams Redis pub/sub messages as named events (`event: <type>`).
 *  - If the script is already `done` or `error` when the client connects,
 *    sends the final event and closes - no waiting.
 *  - Heartbeats every 25s to keep proxies/load-balancers from killing the
 *    connection.
 */
export async function eventRoutes(app: FastifyInstance) {
  app.get('/scripts/:id/events', async (req, reply) => {
    const { id: scriptId } = req.params as { id: string };
    const q = req.query as { token?: string };

    // Manual JWT verification supporting both header and query param
    try {
      if (q.token) {
        const payload = app.jwt.verify(q.token);
        req.currentUser = payload as typeof req.currentUser;
      } else {
        await req.jwtVerify();
        req.currentUser = req.user;
      }
    } catch {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const script = await prisma.script.findUnique({ where: { id: scriptId } });
    if (!script) return reply.code(404).send({ error: 'not_found' });

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering
    });

    const writeEvent = (type: string, data: unknown) => {
      raw.write(`event: ${type}\n`);
      raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Initial snapshot from DB
    writeEvent('snapshot', {
      scriptId,
      status: script.status,
      errorMessage: script.errorMessage,
      processedAt: script.processedAt?.getTime() ?? null,
    });

    // Replay any progress events that fired before the client connected.
    // Without this, fast-failure cases (or fast-completion cases) lose the
    // intermediate `parsing`/`analyzing`/`matching_voices` events.
    const buffered = getBufferedEvents(scriptId);
    let replayedSinceTs = 0;
    let bufferedTerminal = false;
    for (const e of buffered) {
      writeEvent(e.type, e);
      if (e.ts > replayedSinceTs) replayedSinceTs = e.ts;
      if (e.type === 'done' || e.type === 'error') bufferedTerminal = true;
    }

    // If the buffer or DB tells us this script is finished, we're done.
    if (bufferedTerminal || script.status === 'done' || script.status === 'error') {
      // If the buffer was empty (e.g. server restarted after the script
      // finished) but the DB shows terminal, synthesise a terminal event
      // so the client gets a clean close signal.
      if (!bufferedTerminal && (script.status === 'done' || script.status === 'error')) {
        writeEvent(script.status, {
          scriptId,
          message: script.errorMessage ?? null,
          ts: Date.now(),
        });
      }
      raw.end();
      return;
    }

    const heartbeat = setInterval(() => {
      raw.write(`: ping ${Date.now()}\n\n`);
    }, 25_000);

    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      try {
        await unsubscribe();
      } catch {
        /* ignore */
      }
      try {
        raw.end();
      } catch {
        /* ignore */
      }
    };

    // Live subscription. Skip events the client already saw via replay.
    const unsubscribe = subscribeScriptEvents(scriptId, (event) => {
      if (event.ts <= replayedSinceTs) return;
      writeEvent(event.type, event);
      if (event.type === 'done' || event.type === 'error') {
        // Give the client a tick to receive, then close.
        setTimeout(() => void close(), 50);
      }
    });

    req.raw.on('close', () => void close());
    req.raw.on('end', () => void close());
  });
}
