# FounderOS on Windows

Setting this repo up on a PC, and moving it to another one.

## Moving to a new PC — the whole procedure

On the **old** PC:

```
scripts\founderos backup
```

That snapshots every database into Google Drive and puts `.env.local` on your
clipboard — paste it into the `FounderOS .env.local` secure note in your
password manager. Wait for Google Drive to finish syncing.

On the **new** PC:

```
git clone https://github.com/desktopmachineshop/FounderOS.git
cd FounderOS
scripts\founderos bootstrap -Restore
```

Then paste `.env.local` back from your password manager, and:

```
npm run dev
```

http://localhost:4100.

## What moves, and how

Git carries the code. It deliberately does not carry the three things that make
an install *yours*, so each one needs its own route:

| | Where it lives | How it travels | Why not git |
|---|---|---|---|
| Node 22 | fnm | `bootstrap` installs it | Not a repo artifact |
| `node_modules` | repo | `npm ci`, fresh each PC | `better-sqlite3` is a compiled native module — a copied `node_modules` from another machine is the single most common way to break this app |
| `.env.local` | repo root | Password-manager secure note | Live Stripe key + email app passwords. Gitignored, and never written to Google Drive |
| `data\*.db` | repo `data\` | `VACUUM INTO` snapshot in Google Drive | Your agent runs, tasks, notes, bank and ledger rows |

### Why the databases are snapshotted, not copied

All three stores run in WAL mode. Copying `founder-os.db` while pages are still
in `founder-os.db-wal` gives you a file that opens cleanly and is quietly
missing your most recent writes — the worst kind of backup. `scripts\snapshot.ts`
runs SQLite's `VACUUM INTO` instead, which produces a fully-checkpointed
single-file image and is safe to run while `npm run dev` has the database open.
Each snapshot is reopened and `integrity_check`ed before the script reports
success.

There are **three** stores, not one: `founder-os.db`, plus `bank.db` and
`ledger.db` behind `/finances` (see `lib/bank.ts` and `lib/ledger.ts`). The
backup writes a `manifest.json` listing what it captured, and `restore` reads
that back — so adding a fourth store to `STORES` in `scripts/snapshot.ts` makes
both directions handle it with no other changes.

### Why `.env.local` never goes to Google Drive

It holds a live `STRIPE_SECRET_KEY`, your IMAP app passwords, and Slack, Notion,
GHL and Wise tokens. A password manager is built for exactly this and the file
is only ~6 KB of text. It is also why a private GitHub repo is a bad home for
it: GitHub's push protection actively rejects `sk_live_…` and `xoxb-…`, and
anything that does land in git history stays there after you rotate the key.

## Commands

Always go through `scripts\founderos` rather than calling the `.ps1` files
directly. Windows ships PowerShell's execution policy at `Restricted`, so
`.\scripts\backup.ps1` fails on a fresh PC; the `.cmd` sets `Bypass` for that one
process, so the move never depends on changing a machine setting.

```
scripts\founderos bootstrap              Set up this PC. Safe to re-run.
scripts\founderos bootstrap -Restore     ...and pull the databases back too.

scripts\founderos backup                 Snapshot databases; .env.local to clipboard.
scripts\founderos backup -SkipSecrets    Databases only.
scripts\founderos backup -KeepDays 90    Keep timestamped snapshots longer (default 30).

scripts\founderos restore                Restore databases from the snapshot folder.
scripts\founderos restore -Force         ...replacing existing ones (renamed aside, not deleted).
```

The snapshot folder defaults to `H:\My Drive\FounderOS` — the business Google
account. Override it per-run with `-BackupDir`, or permanently with the
`FOUNDER_OS_BACKUP_DIR` environment variable.

**Check the letter on every new PC.** Google Drive for Desktop mounts one drive
per signed-in account and hands out letters in sign-in order, so the business
account is not guaranteed to be `H:`. After signing in, open Drive's
Preferences → Google Drive and set the business account's drive letter to `H`. The
scripts print the drive's volume label, which names the account (e.g. `Using H:
(dave@desktopmachineshop.com -...)`), so a backup headed for the wrong account is
visible.

If Google Drive isn't running, its drive letter is simply absent. The scripts
treat that as a hard error rather than creating a folder on a drive that
happens to exist, because a backup that silently goes nowhere is worse than one
that fails.

## Windows-specific notes

**Use `npm run dev`, not `npm start`.** The `start` script is
`next start -p ${PORT:-4100}` — POSIX expansion that cmd.exe passes through as a
literal string. `dev` uses a plain `-p 4100` and is fine. This only affects
Windows; Railway runs Linux, so the script is correct as it stands and should be
left alone.

**`BRAIN_PROVIDER=stub`.** `BRAIN_PROVIDER` defaults to `gbrain`, which shells
out to a `gbrain` CLI that only exists on the author's macOS setup. `bootstrap`
writes the stub setting into a newly created `.env.local`; if you paste a saved
`.env.local` over it, keep that line.

**Connectors that report `error` or `not configured` are working as designed.**
The upstream repo is macOS-shaped: `lib/creds.ts` falls back to
`~/.config/social/.env` and `~/knowledge/.env.agents`, `lib/connectors/local-stack.ts`
shells out to brew and tmux, and `lib/connectors/obsidian.ts` wants a macOS vault
path. On Windows those report honest failure rather than a fake green light,
which is the repo's stated design rule.

**Two vitest files fail on Windows in teardown.** `tests/lead-magnet-actions.test.ts`
and `tests/lead-magnets-route.test.ts` hit `EBUSY: resource busy or locked` when `afterAll` deletes their
temp database — Windows won't unlink a file whose handle SQLite hasn't fully
released. All 963 assertions pass; only the cleanup fails. Cosmetic, but it
means `npm test` returns non-zero here.

## If `npm ci` tries to compile better-sqlite3

It shouldn't: better-sqlite3 11.10.0 ships a prebuilt binary for Node 22 on
Windows x64, which is exactly why this repo pins Node 22 and why `bootstrap`
refuses to continue on any other version. If you ever see node-gyp and Visual
Studio errors, you are on the wrong Node — check `node -v`, then `fnm use 22`.
