# Running G-Brain in the cloud

G-Brain was listed among the connectors that force the two-host split, on the
grounds that it reads local files. That was true of *this repo's connector*, not
of G-Brain: `gbrain serve --http` is a real remote server (OAuth 2.1, bearer
tokens, scoped operations, admin dashboard). FounderOS can now talk to one.

Set `GBRAIN_URL` and the connector stops shelling out to a local binary and
speaks MCP over HTTP instead. Leave it unset and nothing changes — the CLI
provider is still the default, and `BRAIN_PROVIDER=stub` still wins over both.

## What talks to what

| | Local (workstation) | Remote (cloud) |
|---|---|---|
| Provider | `lib/connectors/gbrain.ts` | `lib/connectors/gbrain-http.ts` |
| Transport | `execFile('gbrain', …)` | `POST <GBRAIN_URL>`, JSON-RPC 2.0 |
| Auth | the binary's own login | `Authorization: Bearer $GBRAIN_TOKEN` |
| Search | `gbrain query … --no-expand` | `tools/call` → `recall` |
| Status | `gbrain doctor --json --fast` | `initialize` handshake |
| On failure | falls back to grepping brain-store | returns nothing; the view shows its empty state |

Two protocol choices are deliberate and pinned by `tests/gbrain-http.test.ts`:

- **Search calls `recall`, not `search`.** `recall` is the frozen MEMORY_VERBS
  v1 read verb with a documented response shape, served on the `starter` and
  `full` surfaces alike. `search` is neither frozen nor guaranteed to be on the
  surface a given brain serves.
- **Status is `initialize`, not `run_doctor`/`get_stats`.** Those two need
  ADMIN scope. A dashboard should run on a read-only token, and the handshake
  already proves both reachability and token validity.

The HTTP provider has no local brain-store to fall back to, so a failing brain
yields no results rather than a thrown page render. A rejected token and an
unreachable host report differently on purpose — "not connected" alone sends you
to restart a brain that is running fine.

## Standing it up

Order matters: steps 1–2 are prerequisites for the rest.

1. **Upgrade G-Brain.** The `claude-cli` recipe (below) landed in **v0.42.66.0**.
   Check with `gbrain --version`.

2. **Pick a database.** `PostgresEngine` wants Postgres + pgvector. A free-tier
   Supabase that pauses on idle is not suitable for an always-on brain — it will
   be asleep exactly when a page render needs it.

3. **Move the brain-store** into the cloud brain (`gbrain migrate --to …`). This
   is the real migration work and it is the operator's data.

4. **Serve it**: `gbrain serve --http --port 3131`. On Railway this is a second
   service in the project, not code inside the Next.js app.

5. **Mint a read-only token** for the dashboard:

   ```bash
   gbrain auth create founder-os --scopes read
   ```

   Read-only is the point. FounderOS only searches; a token that can also write
   or administer the brain is a larger blast radius than this connector needs.

6. **Point FounderOS at it** — set on the cloud service, not committed:

   ```
   GBRAIN_URL=https://<host>/mcp
   GBRAIN_TOKEN=gbrain_…
   ```

## Railway service config (verified against the source, 2026-09-21)

GBrain is a Bun project (`engines.bun >= 1.3.11`, `bin.gbrain -> src/cli.ts`,
no `start` script), deployed as its **own service** beside the app — not as
code inside the Next.js app.

Deploy from a **fork** you control. Railway auto-deploys whatever lands on the
branch it tracks, so tracking the upstream repo would put someone else's
commits into production unreviewed.

| setting | value |
|---|---|
| Build | `bun install` |
| Start | `bun run src/cli.ts serve --http --bind 0.0.0.0 --port $PORT --public-url https://<service-domain>` |
| Variable | `GBRAIN_DATABASE_URL` → its **own** database on the Postgres service |

Three details are load-bearing; each one silently breaks the deploy if missed:

- **`--bind 0.0.0.0` is required.** The default flipped to `127.0.0.1` in
  v0.34.1 specifically so a laptop does not expose its brain. In a container
  that default means nothing can reach the service — and the process still
  logs that it is listening, so it looks healthy from the inside.
- **`GBRAIN_DATABASE_URL`, not `DATABASE_URL`.** `docs/ENGINES.md`: a plain
  `DATABASE_URL` is "adopted only when the target is already a gbrain brain or
  holds no tables at all", while `GBRAIN_DATABASE_URL` is "always stated
  intent". FounderOS's database already holds the app's schema, so the plain
  form would be refused — and it should be a separate database regardless.
- **Its own database, on the same Postgres instance is fine.** Railway's
  Postgres supports `pgvector` (`CREATE EXTENSION IF NOT EXISTS vector;`), so
  no second database provider is needed.

Two things are optional and degrade honestly rather than failing:

- **No embedding key** → search falls back to keyword-only and the response
  carries `search_degraded`. GBrain is explicitly designed to start keyless, so
  a brain with no keys at all still serves `recall` over MCP. That is enough to
  verify this repo's HTTP provider end to end.
- **No `CLAUDE_CODE_OAUTH_TOKEN`** → no synthesis; retrieval still works.

`GBRAIN_HTTP_CORS_ORIGIN` is unset deliberately: it governs browser
cross-origin calls to the OAuth endpoints, and FounderOS calls the brain
server-side with a bearer token, so it never applies.

The container needs **both** binaries when the claude-cli recipe is in use —
`gbrain` and `claude` (`@anthropic-ai/claude-code`). A container with only
gbrain fails at the first synthesis call.

## Using a Claude subscription instead of an API key

G-Brain's `claude-cli` recipe routes chat, synthesis and query expansion through
the local `claude` binary in print mode, using the CLI's own OAuth session — no
`ANTHROPIC_API_KEY`, no per-token billing:

```bash
gbrain config set models.tier.reasoning claude-cli:claude-sonnet-5
```

In a container there is no interactive login, so mint a long-lived token with
`claude setup-token` (it requires a Claude subscription) and give it to the
service. This is still Claude Code running under the subscription — not the
token repurposed as an API credential, which is a different thing and not
supported.

**Embeddings cannot move.** `gateway.embed()` throws for every `claude-cli:`
model; Claude ships no first-party embedding model, so retrieval still needs a
real embedding provider. The subscription covers generation, not search.
