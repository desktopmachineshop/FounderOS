import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { planCommand, resolveMediaPath, type RunnerConfig } from '@/lib/media-runner';
import { newMediaJob } from '@/lib/media-jobs';

const config: RunnerConfig = {
  mediaRoot: '/media/founderos',
  remotionProject: '/home/alex/Projects/remotion-pipeline',
  whisperBin: '/opt/homebrew/bin/whisper-cli',
  ffmpegBin: '/opt/homebrew/bin/ffmpeg',
};

describe('resolveMediaPath', () => {
  it('resolves a relative path inside the media root', () => {
    expect(resolveMediaPath(config.mediaRoot, 'clips/hook.mp4')).toBe(
      path.join('/media/founderos', 'clips/hook.mp4'),
    );
  });

  // Defence in depth. The schema already rejects traversal on the way into the
  // queue, but this is the last check before a real path hits a real disk, and
  // it is the one running on the operator's machine.
  it.each(['../escape', '/etc/passwd', 'a/../../b', ''])('refuses %j', (p) => {
    expect(() => resolveMediaPath(config.mediaRoot, p)).toThrow(/media root/i);
  });

  it('refuses a path that normalises its way out', () => {
    expect(() => resolveMediaPath(config.mediaRoot, 'clips/../../outside.mp4')).toThrow();
  });
});

describe('planCommand', () => {
  it('renders through the Remotion project, with props passed as one argument', () => {
    const job = newMediaJob({
      spec: { kind: 'render', composition: 'ReelKit', props: { title: 'Hook' }, output: 'clips/a.mp4' },
    });
    const plan = planCommand(job, config);
    expect(plan.cwd).toBe(config.remotionProject);
    expect(plan.bin).toBe('npx');
    expect(plan.args).toContain('ReelKit');
    expect(plan.args).toContain(path.join(config.mediaRoot, 'clips/a.mp4'));
    // Props travel as a single JSON argv entry, never interpolated into a string.
    expect(plan.args).toContain(`--props=${JSON.stringify({ title: 'Hook' })}`);
  });

  it('transcribes with whisper against the resolved source', () => {
    const job = newMediaJob({ spec: { kind: 'transcribe', source: 'raw/take.mov', model: 'small.en' } });
    const plan = planCommand(job, config);
    expect(plan.bin).toBe(config.whisperBin);
    expect(plan.args).toContain(path.join(config.mediaRoot, 'raw/take.mov'));
    expect(plan.args).toContain('small.en');
  });

  it('burns captions with ffmpeg', () => {
    const job = newMediaJob({
      spec: { kind: 'caption', source: 'clips/a.mp4', transcript: 'clips/a.srt', output: 'clips/a-cc.mp4' },
    });
    const plan = planCommand(job, config);
    expect(plan.bin).toBe(config.ffmpegBin);
    expect(plan.args).toContain(path.join(config.mediaRoot, 'clips/a-cc.mp4'));
  });

  it('pulls a thumbnail at the requested second', () => {
    const job = newMediaJob({
      spec: { kind: 'thumbnail', source: 'clips/a.mp4', output: 'thumbs/a.jpg', atSeconds: 3.5 },
    });
    const plan = planCommand(job, config);
    expect(plan.bin).toBe(config.ffmpegBin);
    expect(plan.args).toContain('3.5');
  });

  // The whole point of a plan: an argv array handed to execFile, never a
  // string handed to a shell.
  it('never produces a shell string, and every argument is separate', () => {
    const job = newMediaJob({
      spec: { kind: 'render', composition: 'A; rm -rf ~', props: {}, output: 'clips/a.mp4' },
    });
    const plan = planCommand(job, config);
    expect(typeof plan.bin).toBe('string');
    expect(Array.isArray(plan.args)).toBe(true);
    // The nasty composition name stays one inert argv entry; nothing splits it.
    expect(plan.args).toContain('A; rm -rf ~');
    expect(plan.args.join('\u0000')).not.toMatch(/\n/);
  });

  it('refuses to plan when the job needs a tool this host has not got', () => {
    const job = newMediaJob({ spec: { kind: 'transcribe', source: 'raw/take.mov' } });
    expect(() => planCommand(job, { ...config, whisperBin: null })).toThrow(/whisper/i);
  });

  it('refuses to plan a render with no Remotion project configured', () => {
    const job = newMediaJob({
      spec: { kind: 'render', composition: 'ReelKit', props: {}, output: 'clips/a.mp4' },
    });
    expect(() => planCommand(job, { ...config, remotionProject: null })).toThrow(/remotion/i);
  });
});
