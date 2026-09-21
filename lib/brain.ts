/**
 * G-Brain adapter. The real provider (default) shells out to the installed
 * gbrain CLI (brain-store markdown + Supabase + ZeroEntropy hybrid search)
 * with a local brain-store fallback when the database is unreachable.
 * BRAIN_PROVIDER=stub selects the inert provider for tests.
 */
import { createGBrainProvider } from '@/lib/connectors/gbrain';
import { createGBrainHttpProvider } from '@/lib/connectors/gbrain-http';

export type BrainStatus = {
  connected: boolean;
  provider: string;
  detail: string;
};

export type BrainSearchResult = {
  title: string;
  snippet: string;
  source: string;
};

export interface BrainProvider {
  name: string;
  status(): Promise<BrainStatus>;
  search(query: string): Promise<BrainSearchResult[]>;
}

const stubProvider: BrainProvider = {
  name: 'stub',
  async status() {
    return {
      connected: false,
      provider: 'stub',
      detail:
        'G Brain is not wired yet. Implement a BrainProvider in lib/brain.ts and set BRAIN_PROVIDER to activate it.',
    };
  },
  async search() {
    return [];
  },
};

/**
 * The CLI provider needs a `gbrain` binary and a brain-store on local disk, so
 * on the cloud host it can only ever report failure — which is why G-Brain was
 * counted among the workstation-bound connectors. `gbrain serve --http` makes a
 * remote brain reachable, and GBRAIN_URL is how a deployment says to use one.
 *
 * A URL with no token deliberately still selects HTTP rather than falling back
 * to the CLI: in the cloud there is no binary, so the fallback would report
 * "gbrain CLI unavailable" for what is really a missing token. The HTTP
 * provider's 401 path names the actual fault.
 */
export function getBrainProvider(): BrainProvider {
  const name = process.env.BRAIN_PROVIDER ?? 'gbrain';
  if (name === 'stub') return stubProvider;
  const url = process.env.GBRAIN_URL?.trim();
  if (name === 'gbrain-http' || url) {
    return createGBrainHttpProvider({ url: url ?? '', token: process.env.GBRAIN_TOKEN?.trim() ?? '' });
  }
  return createGBrainProvider();
}
