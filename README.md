# Logline AI Backend

Backend for the **Logline AI** voice casting studio (Hoichoi).

The flow:

1. A user uploads a `.docx` script to a project.
2. The backend extracts the text (`mammoth`), sends it to **Claude** (`claude-sonnet-4-6` by default) which:
   - splits the document into one or more episodes,
   - extracts every speaking character with role, gender, age, mood, line count, and the full text of each dialogue.
3. For each character, the backend queries the **ElevenLabs Shared Voice Library** (filtered by language, gender, age) and asks Claude to pick the top 3 voices with a director-style reason.
4. The frontend reads the casting sheet via `GET /api/scripts/:id/casting` (matches the `CASTING_DATA` shape used in the React app exactly), and the per-character episodic dialogue export via `GET /api/projects/:id/dialogues?name=...`.

## Stack

- **Node.js + TypeScript + Fastify** (HTTP + JSON + SSE)
- **PostgreSQL + Prisma** (data)
- **Redis + BullMQ** (background processing queue + pub/sub for progress events)
- **@anthropic-ai/sdk** (Claude analysis & voice ranking)
- **ElevenLabs REST API** (`/v1/shared-voices`)
- **mammoth** (DOCX → text), **docx** (DOCX → out, for character dialogue export)
- **bcryptjs + @fastify/jwt** (auth)

## Setup

```bash
# 1. Install deps
npm install

# 2. Bring up Postgres + Redis locally
docker compose up -d

# 3. Configure environment
cp .env.example .env
# then edit .env - set JWT_SECRET, ANTHROPIC_API_KEY, ELEVENLABS_API_KEY
# DATABASE_URL and REDIS_URL defaults match the docker-compose services

# 4. Create DB schema
npx prisma migrate dev --name init

# 5. (Optional) Seed an admin user
ADMIN_EMAIL=admin@hoichoi.com ADMIN_PASSWORD=changeme ADMIN_NAME="Admin" npm run seed:admin

# 6. Run dev server (also runs an in-process worker - single command)
npm run dev
# -> http://localhost:4000
```

### Production (separate API + worker processes)

```bash
# In .env:
# WORKER_MODE=queue
npm run build

# Terminal 1 (API)
npm start

# Terminal 2 (worker - run as many as you need)
npm run start:worker
```

## Environment variables

| Var | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `REDIS_URL` | no | Default `redis://localhost:6379`. Used for BullMQ + SSE pub/sub. |
| `JWT_SECRET` | yes | Long random string for signing JWTs |
| `ANTHROPIC_API_KEY` | yes | Your Claude API key (`sk-ant-...`) |
| `ELEVENLABS_API_KEY` | yes | From https://elevenlabs.io/app/settings/api-keys |
| `CLAUDE_MODEL` | no | Defaults to `claude-sonnet-4-6`. Use `claude-opus-4-7` for highest quality. |
| `WORKER_MODE` | no | `inline` (dev default — API runs an in-process worker) or `queue` (production — run `npm run start:worker` separately) |
| `PORT` | no | Default `4000` |
| `CORS_ORIGIN` | no | Comma-separated list of allowed frontend origins |
| `UPLOAD_DIR` | no | Where uploaded DOCX files are stored. Default `./uploads` |
| `MAX_UPLOAD_MB` | no | Default `25` |

## API surface

All routes are prefixed `/api`. All non-auth routes require `Authorization: Bearer <jwt>`.

### Auth

| Method | Path | Role | Body |
| --- | --- | --- | --- |
| POST | `/auth/signup` | public | `{ name, email, password }` — first signup becomes admin |
| POST | `/auth/login` | public | `{ email, password }` |
| GET | `/auth/me` | any | – |
| GET | `/auth/users` | admin | – |
| POST | `/auth/users` | admin | `{ name, email, password, role }` |
| PATCH | `/auth/users/:id/role` | admin | `{ role }` |

### Projects

| Method | Path | Role |
| --- | --- | --- |
| GET | `/projects` | any |
| POST | `/projects` | writer/admin |
| GET | `/projects/:id` | any |
| PATCH | `/projects/:id` | writer (own) / admin |
| DELETE | `/projects/:id` | writer (own) / admin |

### Scripts

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/projects/:id/scripts` | any | List scripts in project |
| POST | `/projects/:id/scripts` | writer/admin | Multipart upload, single `.docx` file. Returns `{ script }` immediately, processing runs on the BullMQ worker. |
| GET | `/scripts/:id` | any | Includes `status`: `pending` / `processing` / `done` / `error` |
| GET | `/scripts/:id/events` | any (token via header or `?token=`) | **SSE stream** of live processing progress (see below) |
| DELETE | `/scripts/:id` | writer/admin | |
| POST | `/scripts/:id/reprocess` | writer/admin | Re-runs Claude + ElevenLabs |

#### SSE progress stream

```js
// EventSource can't send custom headers, so pass the JWT as a query param.
const es = new EventSource(`/api/scripts/${scriptId}/events?token=${jwt}`);

es.addEventListener('snapshot',         (e) => console.log('initial:', JSON.parse(e.data)));
es.addEventListener('parsing',          (e) => console.log('parsing DOCX'));
es.addEventListener('analyzing',        (e) => console.log('Claude analyzing…'));
es.addEventListener('analysis_done',    (e) => console.log('episodes/characters:', JSON.parse(e.data)));
es.addEventListener('matching_voices',  (e) => {
  const { character, index, total } = JSON.parse(e.data);
  console.log(`matching voices for ${character} (${index}/${total})`);
});
es.addEventListener('character_done',   (e) => console.log('character matched:', JSON.parse(e.data)));
es.addEventListener('done',             (e) => { console.log('script ready'); es.close(); });
es.addEventListener('error',            (e) => { console.warn('processing error:', JSON.parse(e.data)); es.close(); });
```

The server sends an immediate `snapshot` event with current DB status, then streams Redis pub/sub messages as they arrive. If the script is already `done` or `error` when the client connects, the final event is sent and the stream closes immediately - safe to use with reconnects.

### Casting

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/scripts/:id/casting` | any | Returns the full casting sheet matching the frontend `CASTING_DATA` shape. Characters are merged across episodes by canonical name. |
| GET | `/scripts/:id/episodes` | any | List episodes detected in the script |
| GET | `/episodes/:id/casting` | any | Per-episode casting sheet |

Casting response shape (matches `CASTING_DATA` in the React frontend):

```json
{
  "script": { "id": "...", "name": "Achanak Shadi Phir Pyar (1)", "status": "done" },
  "characters": [
    {
      "id": 1,
      "name": "NARRATOR",
      "role": "Narrator",
      "lines": 251,
      "age": "middle-aged",
      "gender": "Unspecified",
      "mood": "Cinematic, grave, mythological storyteller — the emotional spine of the show",
      "voices": [
        {
          "name": "Kabir R - Thriller Narrator",
          "voiceId": "NAuCjDa0V2FYHGI2F2CS",
          "language": "Hindi",
          "age": "middle-aged",
          "previewUrl": "https://storage.googleapis.com/...",
          "reason": "Thriller & suspense narrator..."
        }
      ]
    }
  ]
}
```

### Dialogues (the "give me every line of this character" feature)

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/characters/:id/dialogues` | any | All dialogues for one character in one episode |
| GET | `/projects/:id/characters` | any | List every distinct character in the project (for picker UI) |
| GET | `/projects/:id/dialogues?name=Ravan` | any | **Cross-script aggregation**: every line that character speaks across all episodes of the project, grouped by episode and ordered |
| GET | `/projects/:id/dialogues.docx?name=Ravan` | any | Same as above but as a downloadable Word document (titled, page-broken per episode, lines numbered, scene cues in italic) - hand straight to a voice actor |

## Wiring up the existing frontend

In your React app, replace:

```js
const Store = { /* localStorage shim */ };
const CASTING_DATA = [ /* hardcoded */ ];
```

with `fetch('/api/...')` calls:

| Frontend op | Replace with |
| --- | --- |
| `Store.getSession()` | `localStorage.getItem('jwt')` set after `POST /api/auth/login` |
| `Store.getProjects(email)` | `GET /api/projects` |
| `Store.setProjects(...)` (create) | `POST /api/projects` |
| `Store.getScripts(projId)` | `GET /api/projects/:id/scripts` |
| Upload from `accept(files)` | `POST /api/projects/:id/scripts` (multipart) — then open `EventSource('/api/scripts/:id/events?token=…')` for live progress |
| `CASTING_DATA` in `ScriptView` | `GET /api/scripts/:id/casting` then use `data.characters` directly |
| Delete script | `DELETE /api/scripts/:id` |
| New "Export character lines" button | `GET /api/projects/:id/dialogues.docx?name=<character>` (download) or JSON variant |

## Notes

- **Processing time**: a 50-page DOCX with ~17 characters takes roughly 30–90s end-to-end (one Claude analysis call + one Claude rerank per character + one ElevenLabs lookup per character). Upload returns immediately; subscribe to `/scripts/:id/events` for live progress.
- **Queue & worker**: jobs are stored in Redis and processed by a BullMQ worker. Worker concurrency is `2` by default (tune in `src/lib/queue.ts` based on your Anthropic / ElevenLabs rate limits). Job IDs equal script IDs to prevent accidental duplicates.
- **Episode splitting**: Claude detects boundaries from headers like `EPISODE 1`, `एपिसोड 1`, `পর্ব ১`, etc. If your scripts have a different convention, tweak the prompt in `src/lib/claude.ts`.
- **Voice library scope**: this matches against the public ElevenLabs Shared Voice Library. To also include workspace voices, extend `searchSharedVoices` in `src/lib/elevenlabs.ts` to also call `/v1/voices`.
