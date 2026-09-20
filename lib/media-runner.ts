import path from 'node:path';
import { isSafeMediaPath, type MediaJob, type MediaJobKind } from '@/lib/media-jobs';

/**
 * Turning a claimed job into something to execute.
 *
 * Kept separate from the worker loop in `scripts/media-worker.ts` because this
 * is the part worth testing hard: it is where a path written on a public web
 * host becomes a path on the operator's disk, and where a job becomes an argv.
 *
 * Two rules hold throughout:
 *
 *  - Every path is resolved and re-checked against the media root. The schema
 *    already rejected traversal on the way into the queue; this is the last
 *    check before the filesystem, and the one running on the workstation.
 *  - Nothing is ever a shell string. A plan is a binary plus an argv array for
 *    `execFile`, so a job field cannot become a command no matter what it says.
 */

export type RunnerConfig = {
  /** Directory every job path is relative to. */
  mediaRoot: string;
  /** Remotion project checkout, or null when this host cannot render. */
  remotionProject: string | null;
  /** whisper CLI, or null when this host cannot transcribe. */
  whisperBin: string | null;
  /** ffmpeg, or null when this host cannot cut video. */
  ffmpegBin: string | null;
};

export type CommandPlan = {
  bin: string;
  args: string[];
  cwd?: string;
  /** Path the job is expected to produce, for reporting back. */
  produces?: string;
};

/** Resolve a job path inside the media root, or refuse. */
export function resolveMediaPath(root: string, p: string): string {
  if (!isSafeMediaPath(p)) {
    throw new Error(`refusing path outside the media root: ${JSON.stringify(p)}`);
  }
  const base = path.resolve(root);
  const resolved = path.resolve(base, p);
  // Belt and braces: even a path that passed the syntactic check must land
  // under the root once normalised.
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`refusing path outside the media root: ${JSON.stringify(p)}`);
  }
  return resolved;
}

function required(value: string | null, kind: MediaJobKind, tool: string): string {
  if (!value) {
    throw new Error(`this host cannot run ${kind} jobs: ${tool} is not configured`);
  }
  return value;
}

/** What to execute for this job on this host. */
export function planCommand(job: MediaJob, config: RunnerConfig): CommandPlan {
  const spec = job.spec;
  const at = (p: string) => resolveMediaPath(config.mediaRoot, p);

  switch (spec.kind) {
    case 'render': {
      const project = required(config.remotionProject, 'render', 'Remotion project');
      const output = at(spec.output);
      return {
        bin: 'npx',
        args: [
          'remotion',
          'render',
          spec.composition,
          output,
          // One argv entry. Remotion parses the JSON itself; it is never
          // interpolated into a command line.
          `--props=${JSON.stringify(spec.props)}`,
        ],
        cwd: project,
        produces: output,
      };
    }

    case 'transcribe': {
      const whisper = required(config.whisperBin, 'transcribe', 'whisper');
      const source = at(spec.source);
      return {
        bin: whisper,
        args: ['-m', spec.model, '-f', source, '--output-srt'],
        produces: `${source}.srt`,
      };
    }

    case 'caption': {
      const ffmpeg = required(config.ffmpegBin, 'caption', 'ffmpeg');
      const source = at(spec.source);
      const transcript = at(spec.transcript);
      const output = at(spec.output);
      return {
        bin: ffmpeg,
        args: ['-y', '-i', source, '-vf', `subtitles=${transcript}`, output],
        produces: output,
      };
    }

    case 'thumbnail': {
      const ffmpeg = required(config.ffmpegBin, 'thumbnail', 'ffmpeg');
      const source = at(spec.source);
      const output = at(spec.output);
      return {
        bin: ffmpeg,
        args: ['-y', '-ss', String(spec.atSeconds), '-i', source, '-frames:v', '1', output],
        produces: output,
      };
    }
  }
}

/** Which kinds this host is actually equipped to run. */
export function supportedKinds(config: RunnerConfig): MediaJobKind[] {
  const kinds: MediaJobKind[] = [];
  if (config.remotionProject) kinds.push('render');
  if (config.whisperBin) kinds.push('transcribe');
  if (config.ffmpegBin) kinds.push('caption', 'thumbnail');
  return kinds;
}
