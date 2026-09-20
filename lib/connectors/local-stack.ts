import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { whichSync } from '@/lib/media-bins';
import type { ConnectorStatus } from '@/lib/connectors/types';

/**
 * One connector for the local machine stack: running services (ports) and
 * installed daily-driver CLIs. Everything here is checked live.
 */

type Check = { name: string; up: boolean; detail: string };

function ping(url: string, timeoutMs = 1500): Promise<boolean> {
  return fetch(url, { signal: AbortSignal.timeout(timeoutMs) }).then(
    (r) => r.status > 0,
    () => false,
  );
}

function binExists(...candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      /* next */
    }
  }
  return null;
}

function tmuxSessions(): Promise<number> {
  return new Promise((resolve) => {
    execFile('tmux', ['list-sessions', '-F', '#{session_name}'], { timeout: 2000 }, (err, stdout) => {
      resolve(err ? 0 : stdout.split('\n').filter(Boolean).length);
    });
  });
}

const HOME = os.homedir();

/**
 * Tool presence is a PATH question, not a homebrew question. These used to
 * probe `/opt/homebrew/bin` literally, so on the Windows workstation every
 * binary read as "down" even when installed. `whichSync` looks a command up
 * the way the OS does (PATHEXT included), and the explicit paths stay as a
 * fallback for installs that are not on PATH.
 */
function toolUp(command: string, ...fallbacks: string[]): boolean {
  return Boolean(whichSync(command) ?? binExists(...fallbacks));
}

export async function localStackStatus(): Promise<ConnectorStatus> {
  const [commandCenter, remotionStudio, ollama, openclawGateway, tmuxCount] = await Promise.all([
    ping('http://localhost:4000'),
    ping('http://localhost:3789'),
    ping('http://localhost:11434/api/tags'),
    ping('http://localhost:8090'),
    tmuxSessions(),
  ]);

  const remotionDir = fs.existsSync(path.join(HOME, 'Projects', 'remotion-pipeline'));

  const checks: Check[] = [
    { name: 'command-center', up: commandCenter, detail: 'command-center :4000' },
    {
      name: 'remotion',
      up: remotionStudio || remotionDir,
      detail: remotionStudio ? 'studio live :3789' : remotionDir ? 'pipeline installed' : 'missing',
    },
    { name: 'ollama', up: ollama, detail: 'local LLM :11434' },
    { name: 'openclaw', up: openclawGateway, detail: 'gateway' },
    { name: 'tmux', up: tmuxCount > 0, detail: `${tmuxCount} sessions` },
    {
      name: 'whisper',
      up: toolUp('whisper-cli', '/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli'),
      detail: 'local transcription',
    },
    {
      name: 'ffmpeg',
      up: toolUp('ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'),
      detail: 'media processing',
    },
    {
      name: 'higgsfield',
      up: toolUp('higgsfield', path.join(HOME, '.npm-global', 'bin', 'higgsfield'), '/opt/homebrew/bin/higgsfield'),
      detail: 'AI video CLI',
    },
    {
      name: 'gh',
      up: toolUp('gh', '/opt/homebrew/bin/gh', '/usr/local/bin/gh'),
      detail: 'GitHub CLI',
    },
  ];

  const up = checks.filter((c) => c.up);
  const downNames = checks.filter((c) => !c.up).map((c) => c.name);
  const meta: Record<string, string | number> = {};
  for (const check of checks) meta[check.name] = check.up ? `up · ${check.detail}` : 'down';

  return {
    id: 'local-stack',
    name: 'Local Stack',
    kind: 'local',
    state: up.length > 0 ? 'connected' : 'error',
    detail: `${up.length}/${checks.length} up — ${up.map((c) => c.name).join(', ')}${
      downNames.length ? ` · down: ${downNames.join(', ')}` : ''
    }`,
    meta,
  };
}
