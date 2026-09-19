/**
 * The workstation media worker.
 *
 * Runs on the machine that holds the footage, the editor, Remotion and
 * whisper. Polls the always-on instance for work it can actually do, runs it
 * locally, and reports the result back. Nothing here is exposed to the
 * network: it only makes outbound requests, so the workstation needs no
 * public URL, no port forwarding and no inbound firewall hole.
 *
 *   npm run worker
 *
 * Configuration (see .env.example):
 *   FOUNDER_OS_URL           the cloud instance, e.g. https://os.example.com
 *   FOUNDER_OS_WORKER_TOKEN  the shared token, same value as the server's
 *   FOUNDER_OS_MEDIA_ROOT    directory every job path resolves inside
 *   REMOTION_PROJECT_DIR     Remotion checkout (omit → cannot render)
 *   WHISPER_BIN / FFMPEG_BIN tool paths (omit → cannot transcribe / cut)
 *   FOUNDER_OS_WORKER_ID     defaults to the hostname
 *   WORKER_POLL_MS           idle poll interval, default 5s
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { describeMediaJob, MediaJobSchema, type MediaJob } from '@/lib/media-jobs';
import { planCommand, supportedKinds, type RunnerConfig } from '@/lib/media-runner';

const SERVER = (process.env.FOUNDER_OS_URL ?? '').replace(/\/$/, '');
const TOKEN = process.env.FOUNDER_OS_WORKER_TOKEN ?? '';
const WORKER_ID = process.env.FOUNDER_OS_WORKER_ID ?? hostname();
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 5000);
/** A render can legitimately take a while; beyond this something is wrong. */
const JOB_TIMEOUT_MS = Number(process.env.WORKER_JOB_TIMEOUT_MS ?? 20 * 60 * 1000);

function binIfPresent(value: string | undefined, ...fallbacks: string[]): string | null {
  const candidates = [value, ...fallbacks].filter(Boolean) as string[];
  return candidates.find((c) => existsSync(c)) ?? null;
}

const config: RunnerConfig = {
  mediaRoot: path.resolve(process.env.FOUNDER_OS_MEDIA_ROOT ?? path.join(process.cwd(), 'media')),
  remotionProject: process.env.REMOTION_PROJECT_DIR ?? null,
  whisperBin: binIfPresent(
    process.env.WHISPER_BIN,
    '/opt/homebrew/bin/whisper-cli',
    '/usr/local/bin/whisper-cli',
  ),
  ffmpegBin: binIfPresent(process.env.FFMPEG_BIN, '/opt/homebrew/bin/ffmpeg', '/usr/bin/ffmpeg'),
};

const log = (...parts: unknown[]) =>
  console.log(`[media-worker ${new Date().toISOString()}]`, ...parts);

async function api(pathname: string, body: unknown): Promise<Response> {
  return fetch(`${SERVER}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
}

async function claim(kinds: string[]): Promise<MediaJob | null> {
  const res = await api('/api/media/jobs/claim', { workerId: WORKER_ID, kinds });
  if (!res.ok) {
    // 503 means the server has no worker token set; 401 means ours is wrong.
    throw new Error(`claim failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const { job } = (await res.json()) as { job: unknown };
  return job ? MediaJobSchema.parse(job) : null;
}

function run(plan: ReturnType<typeof planCommand>): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // execFile, not exec: the argv array never reaches a shell, so nothing in
    // a job payload can be interpreted as a command.
    execFile(
      plan.bin,
      plan.args,
      { cwd: plan.cwd, timeout: JOB_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`${err.message}\n${String(stderr).slice(-2000)}`));
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

async function handle(job: MediaJob): Promise<void> {
  log(`claimed ${job.id}: ${describeMediaJob(job)}`);
  const startedAt = Date.now();
  try {
    const plan = planCommand(job, config);
    const { stdout } = await run(plan);
    const result = {
      output: plan.produces ?? null,
      durationMs: Date.now() - startedAt,
      // Enough to debug from the board without shipping megabytes of log.
      tail: stdout.trim().split('\n').slice(-5).join('\n'),
    };
    const res = await api(`/api/media/jobs/${job.id}/complete`, { result });
    log(res.ok ? `done ${job.id} in ${result.durationMs}ms` : `complete rejected: ${res.status}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`failed ${job.id}: ${message.split('\n')[0]}`);
    await api(`/api/media/jobs/${job.id}/fail`, { error: message.slice(0, 4000) });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  if (!SERVER || !TOKEN) {
    console.error(
      'media-worker: set FOUNDER_OS_URL and FOUNDER_OS_WORKER_TOKEN (see .env.example)',
    );
    process.exitCode = 1;
    return;
  }

  const kinds = supportedKinds(config);
  if (kinds.length === 0) {
    console.error(
      'media-worker: this host has none of the tools configured — set REMOTION_PROJECT_DIR, WHISPER_BIN or FFMPEG_BIN',
    );
    process.exitCode = 1;
    return;
  }

  log(`worker ${WORKER_ID} → ${SERVER}`);
  log(`media root ${config.mediaRoot}`);
  log(`can run: ${kinds.join(', ')}`);

  let running = true;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    // Finish the job in hand rather than stranding a claim mid-render.
    process.on(signal, () => {
      log(`${signal} — finishing current job, then stopping`);
      running = false;
    });
  }

  while (running) {
    try {
      const job = await claim(kinds);
      if (!job) {
        await sleep(POLL_MS);
        continue;
      }
      await handle(job);
    } catch (err) {
      log(`poll error: ${err instanceof Error ? err.message : String(err)}`);
      await sleep(POLL_MS);
    }
  }
  log('stopped');
}

void main();
