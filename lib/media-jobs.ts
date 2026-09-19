import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * Media jobs: the contract between the always-on cloud instance and the
 * workstation.
 *
 * Video work is filesystem-bound — Remotion, whisper, the raw footage, the
 * editor — so it cannot run on Railway. Scheduling and webhooks are URL-bound,
 * so they cannot run on a laptop. This queue is the seam: the cloud instance
 * (or an agent) enqueues work, the workstation claims it, runs it against the
 * local stack, and reports back. Both halves read the same table through the
 * same repository, because they share one database.
 *
 * ## Why the kinds are a closed set
 *
 * The workstation executes whatever it claims. A queue that carried a command
 * string would therefore be remote code execution on the operator's machine,
 * gated only by a bearer token — and that token has to live on a public web
 * host to be useful. So there is no passthrough kind: each kind names a
 * specific local capability, and the worker maps it to a fixed argv. Adding a
 * capability is a deliberate code change here and in the worker, not a payload.
 * `tests/media-jobs.test.ts` holds that line.
 */

/**
 * Paths cross a trust boundary — written in the cloud, resolved against a real
 * directory on the workstation. Relative, no traversal, no absolute paths, no
 * drive letters, no NUL.
 */
export function isSafeMediaPath(p: string): boolean {
  if (!p || p.length > 512) return false;
  if (p.includes('\0')) return false;
  if (p.startsWith('/') || p.startsWith('\\')) return false;
  if (/^[a-zA-Z]:/.test(p)) return false; // C:\...
  const parts = p.split(/[/\\]/);
  if (parts.some((seg) => seg === '..' || seg === '.')) return false;
  return parts.every((seg) => seg.length > 0);
}

const mediaPath = z.string().refine(isSafeMediaPath, {
  message: 'must be a relative path inside the media root (no .., no absolute paths)',
});

export const MediaJobKindSchema = z.enum(['render', 'transcribe', 'caption', 'thumbnail']);

/** Remotion: render a named composition to a file. */
export const RenderSpecSchema = z.object({
  kind: z.literal('render'),
  composition: z.string().min(1).max(200),
  props: z.record(z.unknown()).default({}),
  output: mediaPath,
});

/** whisper: transcribe an existing asset. */
export const TranscribeSpecSchema = z.object({
  kind: z.literal('transcribe'),
  source: mediaPath,
  model: z.string().min(1).max(64).default('base.en'),
});

/** Burn an existing transcript into an existing clip. */
export const CaptionSpecSchema = z.object({
  kind: z.literal('caption'),
  source: mediaPath,
  transcript: mediaPath,
  output: mediaPath,
});

/** Single frame out of a clip, for a post's preview image. */
export const ThumbnailSpecSchema = z.object({
  kind: z.literal('thumbnail'),
  source: mediaPath,
  output: mediaPath,
  atSeconds: z.number().nonnegative().default(0),
});

export const MediaJobSpecSchema = z.discriminatedUnion('kind', [
  RenderSpecSchema,
  TranscribeSpecSchema,
  CaptionSpecSchema,
  ThumbnailSpecSchema,
]);

export const MediaJobStatusSchema = z.enum(['queued', 'claimed', 'done', 'failed']);

export const MediaJobSchema = z.object({
  id: z.string().min(1),
  spec: MediaJobSpecSchema,
  status: MediaJobStatusSchema,
  /** Higher runs first; ties break by age. */
  priority: z.number().int().default(0),
  attempts: z.number().int().nonnegative().default(0),
  maxAttempts: z.number().int().positive().default(3),
  /** Agent id or 'operator' — who asked for this. */
  requestedBy: z.string().min(1).default('operator'),
  workerId: z.string().nullable().default(null),
  result: z.record(z.unknown()).nullable().default(null),
  error: z.string().nullable().default(null),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  claimedAt: z.string().nullable().default(null),
  finishedAt: z.string().nullable().default(null),
});

export type MediaJobKind = z.infer<typeof MediaJobKindSchema>;
export type MediaJobSpec = z.infer<typeof MediaJobSpecSchema>;
/** Before defaults are applied — what a caller may legitimately pass in. */
export type MediaJobSpecInput = z.input<typeof MediaJobSpecSchema>;
export type MediaJobStatus = z.infer<typeof MediaJobStatusSchema>;
export type MediaJob = z.infer<typeof MediaJobSchema>;

/**
 * How long a claim can sit untouched before another worker may take it. The
 * workstation is a laptop — it sleeps, drops wifi, gets closed mid-render — so
 * a claim has to expire or the job is stranded forever.
 */
export const STALE_CLAIM_MS = 15 * 60 * 1000;

/** Build a queued job, filling in the bookkeeping. */
export function newMediaJob(input: {
  spec: MediaJobSpecInput;
  id?: string;
  priority?: number;
  maxAttempts?: number;
  requestedBy?: string;
  now?: string;
}): MediaJob {
  const now = input.now ?? new Date().toISOString();
  return MediaJobSchema.parse({
    id: input.id ?? randomUUID(),
    spec: MediaJobSpecSchema.parse(input.spec),
    status: 'queued',
    priority: input.priority ?? 0,
    attempts: 0,
    maxAttempts: input.maxAttempts ?? 3,
    requestedBy: input.requestedBy ?? 'operator',
    workerId: null,
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    claimedAt: null,
    finishedAt: null,
  });
}

/** One-line summary for the agent run log and the UI. */
export function describeMediaJob(job: MediaJob): string {
  const s = job.spec;
  switch (s.kind) {
    case 'render':
      return `render ${s.composition} → ${s.output}`;
    case 'transcribe':
      return `transcribe ${s.source} (${s.model})`;
    case 'caption':
      return `caption ${s.source} → ${s.output}`;
    case 'thumbnail':
      return `thumbnail ${s.source} @${s.atSeconds}s → ${s.output}`;
  }
}
