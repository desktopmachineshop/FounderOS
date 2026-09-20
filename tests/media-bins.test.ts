import { describe, expect, it } from 'vitest';
import { whichSync, resolveBin, unsupportedKinds } from '@/lib/media-bins';
import type { RunnerConfig } from '@/lib/media-runner';

/**
 * The workstation is a Windows PC. The worker previously resolved its tools by
 * testing a list of literal macOS paths (`/opt/homebrew/bin/ffmpeg`, …) for
 * existence, so on Windows every tool resolved to null, `supportedKinds` came
 * back without transcribe/caption/thumbnail, and the worker quietly claimed
 * nothing — without ever saying why.
 *
 * Two fixes, both tested here: look the tool up on PATH the way the operating
 * system would, and when a kind cannot run, name what is missing.
 */

/** A fake filesystem: only these exact paths exist. */
const fsWith = (...paths: string[]) => {
  const set = new Set(paths);
  return (p: string) => set.has(p);
};

describe('whichSync', () => {
  it('finds a bare command on a POSIX PATH', () => {
    expect(
      whichSync('ffmpeg', {
        platform: 'linux',
        env: { PATH: '/usr/local/bin:/usr/bin' },
        exists: fsWith('/usr/bin/ffmpeg'),
      }),
    ).toBe('/usr/bin/ffmpeg');
  });

  it('respects PATH order — the first hit wins', () => {
    expect(
      whichSync('ffmpeg', {
        platform: 'linux',
        env: { PATH: '/usr/local/bin:/usr/bin' },
        exists: fsWith('/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'),
      }),
    ).toBe('/usr/local/bin/ffmpeg');
  });

  /**
   * On Windows the executable is `ffmpeg.exe`, PATH is `;`-separated, and
   * PATHEXT lists the suffixes to try. A lookup that assumes POSIX finds
   * nothing, which is exactly the bug.
   */
  it('appends PATHEXT suffixes on Windows', () => {
    expect(
      whichSync('ffmpeg', {
        platform: 'win32',
        env: {
          PATH: 'C:\\Windows\\system32;C:\\tools\\ffmpeg\\bin',
          PATHEXT: '.COM;.EXE;.BAT;.CMD',
        },
        exists: fsWith('C:\\tools\\ffmpeg\\bin\\ffmpeg.EXE'),
      }),
    ).toBe('C:\\tools\\ffmpeg\\bin\\ffmpeg.EXE');
  });

  it('falls back to a default PATHEXT when Windows does not supply one', () => {
    expect(
      whichSync('whisper-cli', {
        platform: 'win32',
        env: { PATH: 'C:\\bin' },
        exists: fsWith('C:\\bin\\whisper-cli.exe'),
      }),
    ).toBe('C:\\bin\\whisper-cli.exe');
  });

  it('a command already carrying its extension is not double-suffixed', () => {
    expect(
      whichSync('ffmpeg.exe', {
        platform: 'win32',
        env: { PATH: 'C:\\bin', PATHEXT: '.EXE' },
        exists: fsWith('C:\\bin\\ffmpeg.exe'),
      }),
    ).toBe('C:\\bin\\ffmpeg.exe');
  });

  it('returns null when the tool is genuinely absent', () => {
    expect(whichSync('ffmpeg', { platform: 'linux', env: { PATH: '/usr/bin' }, exists: fsWith() })).toBeNull();
    expect(whichSync('ffmpeg', { platform: 'linux', env: {}, exists: fsWith('/usr/bin/ffmpeg') })).toBeNull();
  });

  it('ignores empty PATH segments rather than probing the working directory', () => {
    // A trailing ':' would otherwise resolve './ffmpeg' — running whatever
    // happens to sit in the current directory.
    expect(
      whichSync('ffmpeg', { platform: 'linux', env: { PATH: '/usr/bin:' }, exists: () => true }),
    ).toBe('/usr/bin/ffmpeg');
  });
});

describe('resolveBin', () => {
  const base = { platform: 'win32' as const, env: { PATH: 'C:\\bin', PATHEXT: '.EXE' } };

  it('an explicit path that exists always wins', () => {
    expect(
      resolveBin('ffmpeg', { ...base, explicit: 'D:\\ffmpeg\\ffmpeg.exe', exists: fsWith('D:\\ffmpeg\\ffmpeg.exe') }),
    ).toBe('D:\\ffmpeg\\ffmpeg.exe');
  });

  /**
   * An explicit path that does NOT exist is a typo in .env.local, and silently
   * falling back to PATH would hide it. Better to report the tool missing.
   */
  it('an explicit path that does not exist resolves to null, not to a PATH hit', () => {
    expect(
      resolveBin('ffmpeg', { ...base, explicit: 'D:\\typo\\ffmpeg.exe', exists: fsWith('C:\\bin\\ffmpeg.EXE') }),
    ).toBeNull();
  });

  it('with no explicit value, falls back to PATH', () => {
    expect(resolveBin('ffmpeg', { ...base, exists: fsWith('C:\\bin\\ffmpeg.EXE') })).toBe('C:\\bin\\ffmpeg.EXE');
  });

  it('still finds the macOS homebrew install when PATH does not list it', () => {
    expect(
      resolveBin('ffmpeg', {
        platform: 'darwin',
        env: { PATH: '/usr/bin' },
        exists: fsWith('/opt/homebrew/bin/ffmpeg'),
      }),
    ).toBe('/opt/homebrew/bin/ffmpeg');
  });

  it('whisper resolves under either of the names it ships as', () => {
    expect(
      resolveBin('whisper', { platform: 'linux', env: { PATH: '/usr/bin' }, exists: fsWith('/usr/bin/whisper-cli') }),
    ).toBe('/usr/bin/whisper-cli');
    expect(
      resolveBin('whisper', { platform: 'linux', env: { PATH: '/usr/bin' }, exists: fsWith('/usr/bin/whisper') }),
    ).toBe('/usr/bin/whisper');
  });
});

/**
 * The silent part of the bug. A worker that can run nothing used to print one
 * generic line; a worker that can run *some* kinds said nothing at all about
 * the rest. Either way the operator had no idea which tool to install.
 */
describe('unsupportedKinds', () => {
  const cfg = (over: Partial<RunnerConfig> = {}): RunnerConfig => ({
    mediaRoot: 'C:\\media',
    remotionProject: null,
    whisperBin: null,
    ffmpegBin: null,
    ...over,
  });

  it('names every kind that cannot run, and what each one needs', () => {
    const rows = unsupportedKinds(cfg());
    const byKind = new Map(rows.map((r) => [r.kind, r.reason]));
    expect([...byKind.keys()].sort()).toEqual(['caption', 'render', 'thumbnail', 'transcribe']);
    expect(byKind.get('render')).toContain('REMOTION_PROJECT_DIR');
    expect(byKind.get('transcribe')).toContain('WHISPER_BIN');
    expect(byKind.get('caption')).toContain('FFMPEG_BIN');
  });

  it('a reason says how to fix it, not just what is absent', () => {
    expect(unsupportedKinds(cfg())[0].reason).toMatch(/set |PATH/i);
  });

  it('a fully equipped host reports nothing unsupported', () => {
    expect(
      unsupportedKinds(
        cfg({ remotionProject: 'C:\\r', whisperBin: 'C:\\w.exe', ffmpegBin: 'C:\\f.exe' }),
      ),
    ).toEqual([]);
  });

  it('ffmpeg covers both of the kinds that need it', () => {
    const rows = unsupportedKinds(cfg({ remotionProject: 'C:\\r', whisperBin: 'C:\\w.exe' }));
    expect(rows.map((r) => r.kind).sort()).toEqual(['caption', 'thumbnail']);
  });
});
