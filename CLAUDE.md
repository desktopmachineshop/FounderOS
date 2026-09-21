# FOUNDER OS

Personal OS / AI agent command center. Live web recreation of the FounderOS
"Conducting AI" board. Runs on port **4100** (command-center owns 4000).

## Commands

```bash
npm run dev        # dev server → http://localhost:4100
npm test           # vitest suite (must stay green)
npm run typecheck  # tsc --noEmit
npm run seed       # re-seed data/founder-os.db (idempotent)
npm run build && npm start
```

## Stack

Next.js 14 App Router (server components) + TypeScript + Tailwind +
better-sqlite3 (`data/founder-os.db`, WAL, auto-seeded on first touch) +
Zod + Vitest.

## Architecture: real by default (2026-09-20)

Upstream's design rule was "larp-first": the app looked alive because of rich
seeded data. **That is inverted here.** Demo data is gated behind
`FOUNDER_OS_DEMO` (off by default, `lib/data.ts`), so a real instance starts
empty and every view shows `NotWired` — what it would show, what source it
needs, which variable switches it on — rather than a figure nobody earned.

The seed is **not** deleted: it is the fixture a third of the suite is built on,
and `npm run seed` still seeds on demand. Tests that assert on seeded content
set `FOUNDER_OS_DEMO=1` explicitly.

Every page and API route still reads through the repository layer — never
query SQLite directly from a page or route:

- `lib/data.ts` — `getDb()` app singleton; seeds on first touch **only when
  `FOUNDER_OS_DEMO` is set** (`demoDataEnabled()`)
- `lib/db.ts` — `openDb()` + repos (`departments`, `agents`, `metrics`, `tools`, …)
- `lib/seed.ts` — all seeded content lives here
- `lib/schemas.ts` — Zod schemas validate every row on the way OUT of the DB

Swapping seeded tables for live sources (Attio, Zernio, OpenClaw, MCP status)
is a repo-level change. Keep it that way: new data = new repo method + Zod
schema + seed entry + test.

## G-Brain — ANSWERED (2026-06-11)

G-Brain = **GBrain v0.41** (`gbrain` CLI on PATH): markdown
knowledge in `~/knowledge/brain-store/` + Supabase backend ("Second Brain",
free tier — pauses on idle) + ZeroEntropy embeddings (key in
`~/.config/knowledge/config.json`). The real provider in `lib/connectors/gbrain.ts`
shells out to the CLI (`doctor --json --fast`, `query --no-expand`) and falls
back to local brain-store grep when the database is unreachable. Default
`BRAIN_PROVIDER=gbrain`; `stub` exists for tests.

A **second provider** (`lib/connectors/gbrain-http.ts`) talks MCP over HTTP to a
`gbrain serve --http` brain, selected by setting `GBRAIN_URL` (+ `GBRAIN_TOKEN`).
It calls the frozen `recall` verb rather than `search`, and uses the
`initialize` handshake for status because `run_doctor`/`get_stats` need admin
scope. Setup and the reasoning: `docs/GBRAIN_CLOUD.md`.

## Real connectors & agents (v2)

Dave's directive: real integrations, not larp. Strict black & white theme
(UI polish deferred — he'll design it himself once everything is wired).

- `lib/connectors/` — 13 connector groups, all returning honest
  `ConnectorStatus` (never fake "connected"): `email.ts` (4 IMAP slots),
  `slack.ts`, `payments.ts` (Stripe + registry), `notion.ts`, `gbrain.ts`,
  `odoo.ts` (ERP behind three of the four businesses — see below),
  `zernio.ts` (key from ~/.config/social/.env — LIVE), `attio.ts` (key reused
  from ~/.config/mcp.json mcpServers — LIVE), `arcads.ts` (local `.env` —
  LIVE), `miro.ts` (knowledge/.env.agents — LIVE),
  `wispr.ts` (local flow.sqlite readonly — LIVE), `obsidian.ts` (vault fs;
  needs macOS Documents permission), `local-stack.ts` (local service ports
  + tmux + brew binaries).
- **Odoo** (`lib/connectors/odoo.ts`) is the system of record for Desktop
  Machine Shop, DMS Industrial and 3DPandMe — three websites on ONE instance,
  so one credential serves three ventures and rows are attributed by mapping
  the website domain back to `lib/ventures.ts` (`ventureForOdooWebsite`).
  OpenV is not on Odoo. Transport is **JSON-RPC** (`POST /jsonrpc`), not the
  XML-RPC the Odoo docs lead with — same API, no XML dependency. Two gotchas
  are load-bearing and tested: Odoo answers faults with **HTTP 200** plus an
  `error` envelope (so `res.ok` proves nothing — everything goes through
  `parseOdooResponse`), and it returns `false` for an empty value (normalised
  to `null`, never `0`). Read-only by construction: no write method is called
  and no caller-supplied model reaches `execute_kw`. Env names match the
  `odoo-product-info` skill (`ODOO_URL`/`ODOO_DB`/`ODOO_USER`/`ODOO_API_KEY`)
  so an instance set up for that skill needs nothing re-entered.
  Order reads (`odooOrders`, `odooRevenue`) carry two more decisions that are
  accounting, not formatting: only `ORDER_REVENUE_STATES` (`sale`, `done`)
  count as revenue — abandoned web checkouts sit in `draft` forever and would
  inflate everything — and totals are grouped per **(venture, currency)**,
  never summed across currencies, because the .com and .co.uk stores do not
  bill in the same one. Odoo datetimes are naive UTC strings with no zone
  marker, so every date goes through `odooDateToIso` or it shifts by the
  reader's offset.
- `lib/creds.ts` — credential resolution: process.env first, then Dave's
  canonical files at runtime. NEVER copy secret values into this repo.
- `lib/agents/runtime.ts` + `real.ts` — agent registry; every seeded agent row
  maps 1:1 to a `RuntimeAgent` with a real `run()` (enforced by seed tests).
  Runs persist to `agent_runs`. `POST /api/agents/[id]/run`.
- `/integrations` is the live Connections board (`GET /api/connections`).
- Credentials go in `.env.local` (gitignored) — see `.env.example`. NEVER
  commit keys; never copy keys from `~/knowledge/.env.agents` into the repo.

## Views

`/` operator console (pulse row, connections strip, agent list, compact
G-Brain core) · `/comms` unified feed · `/social` Zernio growth dashboard ·
`/agents` roster with Run buttons + last-run state · `/org` hierarchy board
(operator → Conductor super agent → 5 pillars: Sales, Marketing/Growth, TECH,
Finances, Communications → worker pills; broadcast composer; markup frozen —
do not restructure) · `/brain` G-Brain knowledge core (signature `BrainViz`
rings + live `gbrain ›` query card + doctor warnings, with the original
capture / life-map / pipeline / graph / query-path sections kept underneath) ·
`/roadmap` phases + quarters · `/analytics` real connector numbers ·
`/funnel` living client-journey flow (Vantage + Launchpad Cohort: stage
columns left→right, one node per client, 4–5 touch markers per path; seeded
dummy, real-ready for Trakyo organic + Meta Ads MCP paid attribution) ·
`/reference` reference model · `/integrations` live connections board. Chrome:
fixed `Sidebar` (Operate/System groups) + sticky `Topbar` (breadcrumb + ⌘K) +
`CommandPalette` (⌘K, digit-key view jumps). API routes mirror these under
`app/api/*` — note `GET /api/brain?q=` runs a hybrid search; bare `GET` returns
provider status.

## No growth surfaces (2026-09-20)

Upstream shipped a cohort funnel — a footer CTA on every view plus a first-run
pop-up, both pointing at thefounderos.com. Both are **removed**, along with
`lib/cohort.ts` and their components. This is an operator's own dashboard; it
does not advertise anything. Do not reintroduce a marketing surface here.

## Deployment: two hosts, one database (2026-09-19)

Production runs on **two machines sharing one Postgres** — see
`docs/DEPLOYMENT.md`. This is forced, not preferred: five connectors
(`local-stack`, `wispr`, `whatsapp`, `obsidian`, and zernio's account
map) read local files/ports and cannot run in the cloud; the ManyChat webhook
and scheduled runs need a public always-on URL and cannot run on a laptop.
**`gbrain` was the sixth and no longer is** — `gbrain serve --http` is a real
remote server, so setting `GBRAIN_URL` moves the brain to the cloud host
(`docs/GBRAIN_CLOUD.md`). What was workstation-bound was this repo's connector,
not G-Brain.

- `lib/sql/` — `SqlDriver` with SQLite + Postgres drivers. The schema and every
  query are written **once in SQLite dialect**; `lib/sql/dialect.ts` translates
  (`?`→`$n`, `INSERT OR REPLACE`→`ON CONFLICT`, `rowid`→`seq`, `REAL`→`DOUBLE
  PRECISION`). Never fork a query per backend — extend the translator.
- **The repository layer is async.** Every `db.*` method returns a Promise.
  `getDb()` returns `Promise<FounderDb>` and memoizes the promise.
- Backend chosen by `DATABASE_URL` (postgres) else `FOUNDER_OS_DB` (SQLite).
- `tests/postgres-parity.test.ts` runs the real schema + seed + every repo read
  against both backends. It **skips** without `TEST_DATABASE_URL`, so run
  `TEST_DATABASE_URL=postgres://… npm test` after touching `lib/db.ts` —
  the SQLite-only suite cannot catch a Postgres-only break.
- `lib/media-jobs.ts` + `lib/media-runner.ts` + `scripts/media-worker.ts` —
  video work queued in the cloud, executed on the workstation. Job kinds are a
  **closed set** with validated relative paths; there is deliberately no kind
  carrying a command, because the worker executes what it claims. Keep it that
  way — `tests/media-jobs.test.ts` holds the line.
- Worker auth (`lib/worker-auth.ts`) **fails closed**: no
  `FOUNDER_OS_WORKER_TOKEN` means 503, never open.
- Scripts under `scripts/` run through tsx as **CJS** — no top-level await;
  wrap in `main()`.

## Conventions

- TDD: failing test first, then implementation. Tests live in `tests/`,
  one file per module; use `FOUNDER_OS_DB=:memory:` pattern (see `tests/db.test.ts`).
- Zod-validate anything that crosses the DB or API boundary.
- THEME: **Monolith Signal (`mono`) is the default** (2026-07-12,
  `DEFAULT_THEME` in `lib/theme.ts`; bare `:root` in `app/globals.css` carries
  the mono tokens). "Terminal" (`dark`) — the phosphor-green command deck on
  near-black — stays as a pickable colorway. Tokens live in
  `tailwind.config.ts` (`os.*` colors) AND as raw CSS vars in
  `app/globals.css` (the brain viz SVG + `color-mix` effects need `var()`
  access; keep the two in sync). Terminal tokens: `bg #050807`, `surface
  #0a0f0c`, `border #18211b` / `border-strong #243029`, `text #e4efe6` /
  `muted #8fa295` / `dim #54665b`, `accent #3df08c` (phosphor green), honest
  status colors `ok`/`warn #ffc53d`/`err #ff6259`. G-Brain viz uses its own
  independent violet/cyan/green palette (`--brain-1/2/3`). Lettering (Monolith pass,
  2026-07-10): JetBrains Mono everywhere — `font-sans` and `font-mono` both
  resolve to `--font-mono`; Space Grotesk is retired. Page titles 25px/700
  uppercase tracking 0.06em (`PageHeader`), eyebrows 9.5px/0.32em with a `//`
  prefix, section labels 10px/700/0.26em. Square corners (radius tokens are
  0), square LED status dots (blink, no pulse ring), no emblem hover-spin,
  hairline borders, no shadows on cards, 48px grid texture on the canvas
  (mono theme flattens it). The `mono` theme is **Monolith Signal**: bare
  black `#0a0a0a`, white accent, `--hairline #1c1c1c`, and color means
  status only (`ok #2fd36f`/`warn #ffb000`/`err #ff2d3f`). Shared primitives in `components/terminal.tsx`
  (`Dot`, `Badge`, `Label`, `SectionHead`, `Kbd`, `Spark`). `/org` keeps its
  existing markup — it inherits the tokens through Tailwind classes only.
- Env vars: `FOUNDER_OS_DB`, `BRAIN_PROVIDER`, `GBRAIN_BIN`, `GBRAIN_STORE`,
  plus connector creds in `.env.local`.
- Heavy interaction-driven visualizations load via `next/dynamic`
  (`ssr: false`) behind dimension-matched skeletons (see
  `BrainGraphView`/`AudienceConsistencyLazy`; contract in
  `tests/code-splitting.test.ts`). Use `next/image` for any future raster
  images — every current visual is SVG/canvas, so nothing needed a retrofit.
- Future: migrate hosting to a dedicated host; Supabase stays managed.

## Multi-agent etiquette

Multiple Claude Code sessions work on this repo concurrently:

- Commit small checkpoints often (`git log --oneline` to see where others are).
- Run `npm test && npm run typecheck` before claiming anything done.
- **CI does not start itself on our branches.** GitHub creates no workflow run
  for a `push` or `pull_request` event made with the Claude App's token
  (`workflow_dispatch` and `repository_dispatch` are the only exceptions), so
  a bot-authored PR sits with no checks unless one is asked for. After pushing,
  dispatch it: `gh workflow run ci.yml --ref <branch>`, then read the result —
  an undispatched PR is unverified, not green. The triggers in
  `.github/workflows/ci.yml` are correct and fire normally for a human push.
- Don't kill the dev server on 4100 — another session may be using it.
- Leave handoff notes in `docs/` if you stop mid-feature.
