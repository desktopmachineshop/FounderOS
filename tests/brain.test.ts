import { afterEach, describe, expect, it, test } from 'vitest';
import { getBrainProvider } from '@/lib/brain';

afterEach(() => {
  delete process.env.BRAIN_PROVIDER;
});

describe('G Brain adapter', () => {
  test('defaults to the real gbrain provider', () => {
    const brain = getBrainProvider();
    expect(brain.name).toBe('gbrain');
  });

  test('falls back to stub when BRAIN_PROVIDER=stub', () => {
    process.env.BRAIN_PROVIDER = 'stub';
    const brain = getBrainProvider();
    expect(brain.name).toBe('stub');
  });

  test('stub reports a disconnected status with wiring instructions', async () => {
    process.env.BRAIN_PROVIDER = 'stub';
    const brain = getBrainProvider();
    const status = await brain.status();
    expect(status.connected).toBe(false);
    expect(status.provider).toBe('stub');
    expect(status.detail.length).toBeGreaterThan(0);
  });

  test('stub search returns an empty result set, never throws', async () => {
    process.env.BRAIN_PROVIDER = 'stub';
    const brain = getBrainProvider();
    await expect(brain.search('launchpad cohort')).resolves.toEqual([]);
  });
});

/**
 * Which provider a deployment gets.
 *
 * The CLI provider needs a `gbrain` binary and a brain-store on local disk, so
 * on the cloud host it can only ever report failure — which is why G-Brain was
 * listed as workstation-bound. Pointing GBRAIN_URL at a `gbrain serve --http`
 * brain switches the connector to the HTTP provider and that stops being true.
 */
describe('getBrainProvider selection', () => {
  const saved = {
    provider: process.env.BRAIN_PROVIDER,
    url: process.env.GBRAIN_URL,
    token: process.env.GBRAIN_TOKEN,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries({
      BRAIN_PROVIDER: saved.provider,
      GBRAIN_URL: saved.url,
      GBRAIN_TOKEN: saved.token,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const clear = () => {
    delete process.env.BRAIN_PROVIDER;
    delete process.env.GBRAIN_URL;
    delete process.env.GBRAIN_TOKEN;
  };

  it('defaults to the CLI provider', () => {
    clear();
    expect(getBrainProvider().name).toBe('gbrain');
  });

  it('a configured brain URL switches to HTTP', () => {
    clear();
    process.env.GBRAIN_URL = 'https://brain.example/mcp';
    process.env.GBRAIN_TOKEN = 'gbrain_xyz';
    expect(getBrainProvider().name).toBe('gbrain-http');
  });

  /**
   * A URL with no token must NOT silently fall back to the CLI: on the cloud
   * host there is no binary, so the fallback would report "gbrain CLI
   * unavailable" for what is really a missing token. The HTTP provider's 401
   * path names the actual problem.
   */
  it('a URL without a token still uses HTTP, so the error names the real fault', () => {
    clear();
    process.env.GBRAIN_URL = 'https://brain.example/mcp';
    expect(getBrainProvider().name).toBe('gbrain-http');
  });

  it('the stub still wins, so tests are unaffected', () => {
    clear();
    process.env.BRAIN_PROVIDER = 'stub';
    process.env.GBRAIN_URL = 'https://brain.example/mcp';
    expect(getBrainProvider().name).toBe('stub');
  });
});
