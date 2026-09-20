import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { ConnectorStatus } from '@/lib/connectors/types';

/**
 * Where Wispr Flow keeps its database.
 *
 * `WISPR_DB` wins everywhere. Otherwise only macOS has a default: this repo has
 * not verified where Wispr Flow stores its database on Windows, and a guessed
 * `%APPDATA%` path would report "not installed" for an app that is installed —
 * a worse answer than admitting we do not know.
 */
export function wisprDbPath(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const explicit = env.WISPR_DB?.trim();
  if (explicit) return explicit;
  if (platform !== 'darwin') return null;
  const home = env.HOME ?? os.homedir();
  return path.join(home, 'Library', 'Application Support', 'Wispr Flow', 'flow.sqlite');
}

/**
 * Wispr Flow (voice dictation). Local read-only SQLite; tables of interest:
 * History (dictations), Notes, Todos, Meetings.
 */
export async function wisprStatus(): Promise<ConnectorStatus> {
  const WISPR_DB = wisprDbPath();
  if (!WISPR_DB) {
    return {
      id: 'wispr',
      name: 'Wispr Flow',
      kind: 'local',
      state: 'not_configured',
      detail:
        'No default location for Wispr Flow on this platform — set WISPR_DB to the full path of flow.sqlite.',
    };
  }
  if (!fs.existsSync(WISPR_DB)) {
    return {
      id: 'wispr',
      name: 'Wispr Flow',
      kind: 'local',
      state: 'not_configured',
      detail: `flow.sqlite not found at ${WISPR_DB} — is Wispr Flow installed? Set WISPR_DB to override.`,
    };
  }
  try {
    const db = new Database(WISPR_DB, { readonly: true, fileMustExist: true });
    try {
      const count = (table: string): number => {
        try {
          return (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;
        } catch {
          return 0;
        }
      };
      const dictations = count('History');
      const notes = count('Notes');
      const todos = count('Todos');
      const meetings = count('Meetings');
      const mtime = fs.statSync(WISPR_DB).mtime;
      const minutesAgo = Math.max(0, Math.round((Date.now() - mtime.getTime()) / 60_000));
      return {
        id: 'wispr',
        name: 'Wispr Flow',
        kind: 'local',
        state: 'connected',
        detail: `${dictations.toLocaleString('en-US')} dictations · ${notes} notes · ${todos} todos · ${meetings} meetings · last activity ${minutesAgo}m ago`,
        meta: { dictations, notes, todos, meetings },
      };
    } finally {
      db.close();
    }
  } catch (err) {
    return {
      id: 'wispr',
      name: 'Wispr Flow',
      kind: 'local',
      state: 'error',
      detail: `flow.sqlite exists but read failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
