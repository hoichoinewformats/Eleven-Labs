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

- **Node.js + TypeScript + Fastify** (HTTP + JSON)
- **PostgreSQL + Prisma** (data)
- **@anthropic-ai/sdk** (Claude analysis & voice ranking)
- **ElevenLabs REST API** (`/v1/shared-voices`)
- **mammoth** (DOCX → text)
- **bcryptjs + @fastify/jwt** (auth)

## Setup

```bash
# 1. Install deps
npm install

# 2. Configure environment
cp .env.example .env
# then edit .env - set DATABASE_URL, JWT_SECRET, ANTHROPIC_API_KEY, ELEVENLABS_API_KEY

# 3. Create DB schema
npx prisma migrate dev --name init

# 4. (Optional) Seed an admin user
ADMIN_EMAIL=admin@hoichoi.com ADMIN_PASSWORD=changeme ADMIN_NAME="Admin" npm run seed:admin

# 5. Run dev server
npm run dev
# -> http://localhost:4000
```

## Environment variables

| Var | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `JWT_SECRET` | yes | Long random string for signing JWTs |
| `ANTHROPIC_API_KEY` | yes | Your Claude API key (`sk-ant-...`) |
| `ELEVENLABS_API_KEY` | yes | From https://elevenlabs.io/app/settings/api-keys |
| `CLAUDE_MODEL` | no | Defaults to `claude-sonnet-4-6`. Use `claude-opus-4-7` for highest quality. |
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
| POST | `/projects/:id/scripts` | writer/admin | Multipart upload, single `.docx` file. Returns `{ script }` immediately, processing runs in background. |
| GET | `/scripts/:id` | any | Includes `status`: `pending` / `processing` / `done` / `error` |
| DELETE | `/scripts/:id` | writer/admin | |
| POST | `/scripts/:id/reprocess` | writer/admin | Re-runs Claude + ElevenLabs |

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
| Upload from `accept(files)` | `POST /api/projects/:id/scripts` (multipart) — then poll `GET /api/scripts/:id` for `status === 'done'` |
| `CASTING_DATA` in `ScriptView` | `GET /api/scripts/:id/casting` then use `data.characters` directly |
| Delete script | `DELETE /api/scripts/:id` |
| New "Export character lines" button | `GET /api/projects/:id/dialogues?name=<character>` |

## Notes

- **Processing time**: a 50-page DOCX with ~17 characters takes roughly 30–90s end-to-end (one Claude analysis call + one Claude rerank per character + one ElevenLabs lookup per character). The upload endpoint returns immediately; clients should poll `GET /api/scripts/:id` for status.
- **Episode splitting**: Claude detects boundaries from headers like `EPISODE 1`, `एपिसोड 1`, `পর্ব ১`, etc. If your scripts have a different convention, tweak the prompt in `src/lib/claude.ts`.
- **Voice library scope**: this matches against the public ElevenLabs Shared Voice Library. To also include workspace voices, extend `searchSharedVoices` in `src/lib/elevenlabs.ts` to also call `/v1/voices`.
