# Deploying Founder OS: two hosts, one database

The production build runs in **two places at once**, on purpose. This document
says why, what runs where, and how to set both halves up.

---

## The short version

| | Workstation (your PC/Mac) | Cloud (Railway) |
| --- | --- | --- |
| Always on | no | yes |
| Public URL | no | yes |
| Your footage, editor, Remotion, whisper | yes | no |
| Runs | `npm run dev` + `npm run worker` | the Next.js service |
| Database | — | **managed Postgres, shared by both** |

Both halves run the same code against the same database. Neither is a copy of
the other, and neither is the "real" one.

---

## Why it is split

This is not a preference. Two sets of things in this repo are physically bound
to different machines, and neither set can move.

**Bound to the workstation** — these read the local filesystem, localhost
ports, or macOS app containers. On a cloud host they cannot work at all, no
matter what credentials you supply:

| Connector | What it needs |
| --- | --- |
| `local-stack.ts` | Remotion studio on `:3789`, `whisper-cli`, ollama on `:11434`, tmux, command-center on `:4000` |
| `wispr.ts` | `~/Library/Application Support/Wispr Flow/flow.sqlite` |
| `whatsapp.ts` | `~/Library/Group Containers/…/ChatStorage.sqlite` |
| `obsidian.ts` | the vault directory on disk |
| `gbrain.ts` | the `gbrain` CLI and `~/knowledge/brain-store` |
| `zernio.ts` (partly) | `~/.config/social/config.json` for the account list — the API key itself comes from env, so live follower counts *do* work in the cloud |

**Bound to the cloud** — these need a machine that is up and reachable:

- `POST /api/webhooks/manychat` needs a stable public URL. A laptop cannot
  provide one.
- Scheduled agent runs need a host that is awake at the scheduled time.
  (`lib/cron.ts` stores schedules; the runner belongs on the always-on host.)
- Anything you want to open from your phone.

**Everything else works on either host**, because it is a network API reading
credentials from the environment: email/IMAP, Slack, Stripe, Notion, calendar,
GHL, Attio, Beehiiv, ManyChat, Meta Ads, Trakyo, WebinarJam, Adsmith, Miro, and
the LLM gateway.

So: video and local knowledge stay on the workstation, webhooks and scheduling
live in the cloud, and the shared Postgres is what stops them from becoming two
separate systems.

---

## Video work crosses the gap as jobs

Video is the reason the workstation matters, and it cannot be moved to Railway:
the raw footage is tens of gigabytes, Remotion renders want real CPU, and the
editor is on your desk.

So the cloud instance does not render. It **queues** the work, and the
workstation runs it:

```
cloud instance / agent            workstation
────────────────────────          ─────────────────────────
POST /api/media/jobs      ─┐
                           │  media_jobs table (shared Postgres)
                           └─▶  npm run worker
                                  claims a job it can run
                                  runs Remotion / whisper / ffmpeg locally
                                  POSTs the result back
```

Job kinds are a closed set: `render`, `transcribe`, `caption`, `thumbnail`.
There is deliberately **no kind that carries a command**. The workstation runs
whatever it claims, so a job carrying a shell string would be remote code
execution on your machine, gated only by a token that has to live on a public
web host. Adding a capability is a code change in `lib/media-jobs.ts` and
`lib/media-runner.ts`, not a payload.

The worker only makes **outbound** requests. Your workstation needs no public
URL, no port forwarding and no inbound firewall hole.

`/agents` shows the two video agents (`reelkit-editor`, `renderly-creative`)
reporting the queue — queued, running, failed — rather than "is Remotion up on
this machine", which is the wrong question on the cloud instance.

---

## Setting up the cloud half (Railway)

The repo ships `railway.json` (Nixpacks, `npm run build`, `npm start`,
healthcheck on `/`) and pins Node 22, so a fresh service needs no build or start
settings.

1. **Create a project** and add a service from this GitHub repo.
   Keep it separate from the public demo project: the demo is meant to be open
   and seeded, production carries real credentials and real data.
2. **Add a Postgres database** to the same project. Railway exposes
   `DATABASE_URL` — reference it from the app service so both move together.
   Prefer the private-network URL; it stays inside the project and needs no TLS.
3. **Set the environment variables:**

   | Variable | Why |
   | --- | --- |
   | `DATABASE_URL` | the shared store. Set, the app uses Postgres; unset, it falls back to a SQLite file |
   | `FOUNDER_OS_ACCESS_TOKEN` | puts the whole instance behind a token challenge. **Set this.** A production instance on a public URL holds your real business |
   | `FOUNDER_OS_WORKER_TOKEN` | lets the workstation claim jobs. `openssl rand -hex 32`. Unset means the dispatch surface is **off** (503), never open |
   | connector credentials | see `.env.example`; anything unset reports honest "not configured" |

4. **Generate a public domain** (Settings → Networking). The app serves on the
   `PORT` Railway injects.
5. **Do not set `NODE_ENV`.** Railway passes service variables into the build,
   and `NODE_ENV=production` makes `npm ci` skip devDependencies (tailwindcss,
   typescript), so `next build` fails. `next start` is production mode already.

A `/data` volume is no longer needed once `DATABASE_URL` is set — Postgres is
the durable store.

---

## Setting up the workstation half

```bash
git clone https://github.com/desktopmachineshop/FounderOS.git
cd FounderOS
npm ci
cp .env.example .env.local
```

In `.env.local`:

```bash
DATABASE_URL=postgres://…            # the SAME database as Railway (public URL)
FOUNDER_OS_URL=https://os.example.com
FOUNDER_OS_WORKER_TOKEN=…            # the SAME token as the server
FOUNDER_OS_MEDIA_ROOT=/Users/you/Movies/founderos
REMOTION_PROJECT_DIR=/Users/you/Projects/remotion-pipeline
WHISPER_BIN=/opt/homebrew/bin/whisper-cli
FFMPEG_BIN=/opt/homebrew/bin/ffmpeg
```

Then:

```bash
npm run dev      # the UI, on http://localhost:4100, against the shared database
npm run worker   # claims and runs video jobs
```

The worker prints what it can do on startup and only claims those kinds:

```
[media-worker …] worker mac-studio → https://os.example.com
[media-worker …] media root /Users/you/Movies/founderos
[media-worker …] can run: render, transcribe, caption, thumbnail
```

Omit `REMOTION_PROJECT_DIR` and it simply never claims a render, rather than
claiming one and failing.

For the Windows-specific setup (fnm, backups, moving between machines) see
[`SETUP-WINDOWS.md`](../SETUP-WINDOWS.md).

---

## Moving your existing data into Postgres

If you already have a workstation SQLite store with real history in it:

```bash
FOUNDER_OS_DB=data/founder-os.db \
DATABASE_URL=postgres://… \
npm run migrate:postgres
```

It copies every table through the repository layer, so each row is
Zod-validated out of SQLite and again into Postgres — a migration carrying bad
data fails loudly instead of landing it in your new system of record. Writes are
upserts by primary key, so **re-running is safe** and a half-finished run can
just be repeated.

It does not delete anything. Your SQLite file is left exactly as it was; keep it
until the new store has proven itself.

Note the three separate stores: `founder-os.db` is what this migrates.
`bank.db` and `ledger.db` (behind `/finances`) are still workstation-local.

---

## How the two backends stay one system

`lib/sql/` holds the whole difference. The schema and every query are written
once, in SQLite dialect, and translated for Postgres in one place:

- `?` placeholders → `$1`, `$2`, …
- `INSERT OR REPLACE` → `ON CONFLICT (pk) DO UPDATE SET …`, with the key columns
  parsed out of the DDL so the mapping cannot drift from the schema
- `rowid` (SQLite's implicit insertion order) → an explicit `seq BIGSERIAL`
- `REAL` → `DOUBLE PRECISION`, because Postgres REAL is 4-byte and these columns
  hold money

`tests/postgres-parity.test.ts` runs the real schema, the real seed and all 25
repository reads against both backends and requires identical results. It is
skipped unless `TEST_DATABASE_URL` points at a Postgres server:

```bash
TEST_DATABASE_URL=postgres://… npm test
```

If you change the repository layer, run it that way at least once before
deploying. The SQLite-only suite will not catch a Postgres-only break.

---

## Operational notes

**Stale claims.** The workstation is a laptop: it sleeps, drops wifi, and gets
closed mid-render. A claim older than 15 minutes is released back to the queue
automatically (on the next claim, on a board read, and on a video agent run), so
a job is never stranded by a worker that went away.

**Retries.** A failed job is requeued until `maxAttempts` (default 3) is spent,
then marked `failed` with its error. Nothing retries forever.

**Backups.** Railway backs up the Postgres plugin; that is now where your
history lives. The `scripts/founderos backup` flow still covers `.env.local`
and the workstation-local `bank.db` / `ledger.db`.

**The demo still works with none of this.** With `DATABASE_URL` unset the app
opens a local SQLite file and seeds it, exactly as before — that path is what
the public demo runs on and is covered by the same test suite.

---

## Known gaps

Stated plainly rather than discovered later:

- **The scheduled-agent runner does not exist yet.** `lib/cron.ts` stores and
  displays schedules; nothing executes them on a timer. The always-on host is
  the prerequisite, and that is what this deployment provides — but the runner
  itself is still to be written.
- **Zernio's account list is workstation-only.** The API key resolves from env,
  so live follower counts work in the cloud, but the handle/account map is read
  from `~/.config/social/config.json` with no env override, so
  `syncFromZernioConfig` is a no-op there.
- **`bank.db` and `ledger.db` have not moved.** `/finances` still reads two
  workstation-local SQLite files via `lib/bank.ts` and `lib/ledger.ts`. They
  would each need the same treatment `founder-os.db` just had.
- **G-Brain stays on the workstation.** `/brain` on the cloud instance reports
  its provider honestly as unavailable; the CLI and the markdown store are
  local. Moving it means running the retrieval service as its own Railway
  service, which is the next piece of the plan.
