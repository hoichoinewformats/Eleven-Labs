# Logline AI Backend

Backend for the **Logline AI** voice casting studio (Hoichoi).

The flow:

1. A user uploads a `.docx` script to a project.
2. The backend extracts the text (`mammoth`), sends it to an LLM (via **OpenRouter**) which:
   - splits the document into one or more episodes,
   - extracts every speaking character with role, gender, age, mood, line count, and the full text of each dialogue.
3. For each character, the backend queries the **ElevenLabs Shared Voice Library** (filtered by language, gender, age) and asks the same LLM to pick the top 3 voices with a director-style reason.
4. The frontend reads the casting sheet via `GET /api/scripts/:id/casting` (matches the `CASTING_DATA` shape used in the React app), the live progress via SSE on `GET /api/scripts/:id/events`, and per-character episodic dialogue export via `GET /api/projects/:id/dialogues.docx?name=...`.

## Stack

- **Node.js + TypeScript + Fastify** (HTTP + JSON + SSE)
- **PostgreSQL + Prisma** (data — Neon recommended)
- **pg-boss** (background processing queue, persists in the same Postgres DB — no Redis needed)
- **openai SDK pointed at OpenRouter** (one API for Claude / GPT / Llama / Nemotron / Gemini)
- **ElevenLabs REST API** (`/v1/shared-voices`)
- **mammoth** (DOCX → text), **docx** (DOCX → out, for character dialogue export)
- **bcryptjs + @fastify/jwt** (auth, secret auto-generated)

## Setup

```bash
# 1. Install deps
npm install

# 2. Configure 3 env vars
cp .env.example .env
# then edit .env - set DATABASE_URL (Neon), OPENROUTER_API_KEY, ELEVENLABS_API_KEY

# 3. Create DB schema (Prisma migrate). pg-boss creates its own schema lazily.
npx prisma migrate deploy

# 4. (Optional) Seed an admin user
ADMIN_EMAIL=admin@hoichoi.com ADMIN_PASSWORD=changeme ADMIN_NAME="Admin" npm run seed:admin

# 5. Run dev server (in-process pg-boss worker, no extra processes)
npm run dev
# -> http://localhost:4000
```

The first signup also auto-becomes admin if you skip step 4.

## Environment variables

**3 required, everything else has defaults.**

| Var | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string. Neon (`https://console.neon.tech`) is recommended — free tier, fully managed. |
| `OPENROUTER_API_KEY` | yes | One key, many models. Get from https://openrouter.ai/keys |
| `ELEVENLABS_API_KEY` | yes | From https://elevenlabs.io/app/settings/api-keys |
| `OPENROUTER_MODEL` | no | Defaults to `deepseek/deepseek-chat:free`. Other examples: `anthropic/claude-sonnet-4.6` (paid, best JSON adherence), `openai/gpt-4o` (paid), `deepseek/deepseek-r1:free`, `google/gemini-2.0-flash-exp:free`, `meta-llama/llama-3.3-70b-instruct:free`. |
| `PORT` | no | Default `4000` |
| `HOST` | no | Default `0.0.0.0` |
| `CORS_ORIGIN` | no | Default `*`. Comma-separated list to restrict. |
| `UPLOAD_DIR` | no | Default `./uploads` |
| `MAX_UPLOAD_MB` | no | Default `25` |

**Auto-generated**: the JWT signing secret is generated on first boot and stored in `.jwt-secret` (gitignored). Reused on subsequent restarts. Delete the file to invalidate every existing session.

### A note on free LLMs

The default `deepseek/deepseek-chat:free` is generally one of the better free models for structured JSON output, but no free model matches Claude / GPT for strict-schema reliability on long mixed-language scripts. If you see analysis errors or malformed character data, switch `OPENROUTER_MODEL` to a paid model — analysis quality improves dramatically.

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
| POST | `/projects/:id/scripts` | writer/admin | Multipart upload, single `.docx` file. Returns `{ script }` immediately, processing runs on the in-process pg-boss worker. |
| GET | `/scripts/:id` | any | Includes `status`: `pending` / `processing` / `done` / `error` |
| GET | `/scripts/:id/events` | any (token via header or `?token=`) | **SSE stream** of live processing progress (see below) |
| DELETE | `/scripts/:id` | writer/admin | |
| POST | `/scripts/:id/reprocess` | writer/admin | Re-runs the LLM + ElevenLabs |

#### SSE progress stream

```js
// EventSource can't send custom headers, so pass the JWT as a query param.
const es = new EventSource(`/api/scripts/${scriptId}/events?token=${jwt}`);

es.addEventListener('snapshot',         (e) => console.log('initial:', JSON.parse(e.data)));
es.addEventListener('parsing',          (e) => console.log('parsing DOCX'));
es.addEventListener('analyzing',        (e) => console.log('LLM analyzing…'));
es.addEventListener('analysis_done',    (e) => console.log('episodes/characters:', JSON.parse(e.data)));
es.addEventListener('matching_voices',  (e) => {
  const { character, index, total } = JSON.parse(e.data);
  console.log(`matching voices for ${character} (${index}/${total})`);
});
es.addEventListener('character_done',   (e) => console.log('character matched:', JSON.parse(e.data)));
es.addEventListener('done',             (e) => { console.log('script ready'); es.close(); });
es.addEventListener('error',            (e) => { console.warn('processing error:', JSON.parse(e.data)); es.close(); });
```

The server sends an immediate `snapshot` event with current DB status, then streams in-process events as they arrive. If the script is already `done` or `error` when the client connects, the final event is sent and the stream closes immediately - safe to use with reconnects.

### Casting

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/scripts/:id/casting` | any | Returns the full casting sheet matching the frontend `CASTING_DATA` shape. Characters are merged across episodes by canonical name. |
| GET | `/scripts/:id/episodes` | any | List episodes detected in the script |
| GET | `/episodes/:id/casting` | any | Per-episode casting sheet |

Casting response shape:

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

### Dialogues

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/characters/:id/dialogues` | any | All dialogues for one character in one episode |
| GET | `/projects/:id/characters` | any | List every distinct character in the project (for picker UI) |
| GET | `/projects/:id/dialogues?name=Ravan` | any | **Cross-script aggregation**: every line that character speaks across all episodes of the project, JSON |
| GET | `/projects/:id/dialogues.docx?name=Ravan` | any | Same as above but as a downloadable Word document — title page, page-broken sections per episode, numbered lines, italic scene cues |

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

## Production notes

- **Single process design**: API and pg-boss worker run in the same Node process. To scale beyond one machine, the SSE event bus needs to move from in-process EventEmitter to Postgres LISTEN/NOTIFY (or back to Redis pub/sub). The queue itself is already shared via Postgres so multiple worker processes work today.
- **Processing time**: a 50-page DOCX with ~17 characters takes roughly 30–90s end-to-end (one LLM analysis call + one LLM rerank per character + one ElevenLabs lookup per character). Faster with paid Claude/GPT, slower with free models.
- **Episode splitting**: the LLM detects boundaries from headers like `EPISODE 1`, `एपिसोड 1`, `পর্ব ১`. If your scripts use a different convention, tweak the prompt in `src/lib/llm.ts`.
- **Voice library scope**: matches against the public ElevenLabs Shared Voice Library. To also include workspace voices, extend `searchSharedVoices` in `src/lib/elevenlabs.ts` to also call `/v1/voices`.
- **Concurrency**: pg-boss worker processes 2 scripts at once by default. Tune in `src/lib/queue.ts` based on your OpenRouter / ElevenLabs rate limits.
