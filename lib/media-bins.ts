import { existsSync } from 'node:fs';
import type { MediaJobKind } from '@/lib/media-jobs';
import type { RunnerConfig } from '@/lib/media-runner';

/**
 * Locating the workstation's media tools.
 *
 * The worker used to resolve these by testing a list of literal macOS paths
 * (`/opt/homebrew/bin/ffmpeg`, …) for existence. The workstation is a Windows
 * PC, where those paths can never exist and the tools live on PATH — so every
 * tool resolved to null, `supportedKinds()` came back short, and the worker
 * quietly claimed nothing while reporting itself healthy. Silence was the real
 * bug: a worker that cannot transcribe should say which tool it is missing.
 *
 * So: look a tool up the way the operating system would (PATH, plus PATHEXT on
 * Windows), keep the platform defaults as a fallback for installs that are not
 * on PATH, and give every unsupported job kind a reason.
 *
 * Pure by injection — `platform`, `env` and `exists` are all parameters — so
 * Windows behaviour is tested on any machine, including CI.
 */

export type ToolName = 'whisper' | 'ffmpeg';

export type LookupOpts = {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  exists?: (p: string) => boolean;
};

/** Windows' default when PATHEXT is unset. */
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

/**
 * The command names each tool ships under. whisper.cpp installs as
 * `whisper-cli`; some builds and wrappers use plain `whisper`.
 */
const COMMANDS: Record<ToolName, string[]> = {
  whisper: ['whisper-cli', 'whisper'],
  ffmpeg: ['ffmpeg'],
};

/**
 * Install locations worth trying when a tool is present but not on PATH.
 * Windows is deliberately sparse: package managers (winget, choco, scoop) all
 * put their shims on PATH, so the lookup above is the reliable route.
 */
const PLATFORM_DIRS: Partial<Record<NodeJS.Platform, string[]>> = {
  darwin: ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'],
  linux: ['/usr/local/bin', '/usr/bin'],
  win32: ['C:\\ffmpeg\\bin', 'C:\\Program Files\\ffmpeg\\bin'],
};

/** `which`, as the OS does it: PATH order, plus PATHEXT suffixes on Windows. */
export function whichSync(command: string, opts: LookupOpts = {}): string | null {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const exists = opts.exists ?? existsSync;
  const isWindows = platform === 'win32';

  const raw = env.PATH ?? env.Path ?? env.path;
  if (!raw) return null;

  const dirs = raw.split(isWindows ? ';' : ':').filter((d) => d.trim() !== '');
  const suffixes = candidateSuffixes(command, isWindows, env);

  for (const dir of dirs) {
    for (const suffix of suffixes) {
      const candidate = (isWindows ? `${dir}\\` : `${dir}/`) + command + suffix;
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

function candidateSuffixes(command: string, isWindows: boolean, env: Record<string, string | undefined>): string[] {
  if (!isWindows) return [''];
  const exts = (env.PATHEXT ?? DEFAULT_PATHEXT).split(';').filter(Boolean);
  // Already carries a known extension → do not append another.
  if (exts.some((e) => command.toLowerCase().endsWith(e.toLowerCase()))) return [''];
  // PATHEXT is conventionally upper case while the file on disk is usually
  // lower case. Windows' own lookup is case-insensitive, but a case-sensitive
  // filesystem (a network share, a mounted volume) is not — so try both.
  const out: string[] = [];
  for (const e of exts) {
    for (const variant of [e, e.toLowerCase(), e.toUpperCase()]) {
      if (!out.includes(variant)) out.push(variant);
    }
  }
  return out;
}

export type ResolveOpts = LookupOpts & {
  /** WHISPER_BIN / FFMPEG_BIN, when set. */
  explicit?: string | null;
};

/**
 * Resolve a tool to an absolute path, or null when this host cannot run it.
 *
 * An explicit path that does not exist resolves to **null**, deliberately: it
 * is a typo in `.env.local`, and silently falling back to PATH would hide it
 * behind a different binary than the one the operator asked for.
 */
export function resolveBin(tool: ToolName, opts: ResolveOpts = {}): string | null {
  const platform = opts.platform ?? process.platform;
  const exists = opts.exists ?? existsSync;

  const explicit = opts.explicit?.trim();
  if (explicit) return exists(explicit) ? explicit : null;

  for (const command of COMMANDS[tool]) {
    const onPath = whichSync(command, { ...opts, platform });
    if (onPath) return onPath;
  }

  const isWindows = platform === 'win32';
  for (const dir of PLATFORM_DIRS[platform] ?? []) {
    for (const command of COMMANDS[tool]) {
      for (const suffix of candidateSuffixes(command, isWindows, opts.env ?? process.env)) {
        const candidate = (isWindows ? `${dir}\\` : `${dir}/`) + command + suffix;
        if (exists(candidate)) return candidate;
      }
    }
  }
  return null;
}

export type UnsupportedKind = { kind: MediaJobKind; reason: string };

/**
 * Every job kind this host cannot run, and what would fix it. The worker prints
 * these at startup so an operator learns which tool is missing instead of
 * watching a healthy-looking worker claim nothing.
 */
export function unsupportedKinds(config: RunnerConfig): UnsupportedKind[] {
  const out: UnsupportedKind[] = [];
  if (!config.remotionProject) {
    out.push({
      kind: 'render',
      reason: 'no Remotion project — set REMOTION_PROJECT_DIR to the checkout',
    });
  }
  if (!config.whisperBin) {
    out.push({
      kind: 'transcribe',
      reason: 'whisper not found — put whisper-cli on PATH, or set WHISPER_BIN to its full path',
    });
  }
  if (!config.ffmpegBin) {
    const reason = 'ffmpeg not found — put ffmpeg on PATH, or set FFMPEG_BIN to its full path';
    out.push({ kind: 'caption', reason });
    out.push({ kind: 'thumbnail', reason });
  }
  return out;
}

/** Resolve the whole toolchain for this host. */
export function resolveTools(opts: LookupOpts & { whisper?: string | null; ffmpeg?: string | null } = {}): {
  whisperBin: string | null;
  ffmpegBin: string | null;
} {
  return {
    whisperBin: resolveBin('whisper', { ...opts, explicit: opts.whisper }),
    ffmpegBin: resolveBin('ffmpeg', { ...opts, explicit: opts.ffmpeg }),
  };
}
