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
