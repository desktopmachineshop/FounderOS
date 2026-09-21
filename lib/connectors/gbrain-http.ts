import type { BrainProvider, BrainSearchResult, BrainStatus } from '@/lib/brain';

/**
 * G-Brain over HTTP — the cloud half of the brain connector.
 *
 * The CLI provider (`./gbrain.ts`) shells out to a local `gbrain` binary, which
 * is why G-Brain was counted among the connectors that cannot run in the cloud.
 * It can: `gbrain serve --http` is a real remote server (OAuth 2.1, bearer
 * tokens, scoped operations), and this is the client for it.
 *
 * Two protocol choices are deliberate:
 *
 *   - **Search calls `recall`, not `search`.** `recall` is the frozen
 *     MEMORY_VERBS v1 read verb with a documented response shape, served on the
 *     `starter` and `full` surfaces alike. `search` is neither frozen nor
 *     guaranteed to be on the surface a given brain serves.
 *   - **Status is the `initialize` handshake.** `run_doctor` and `get_stats`
 *     both require ADMIN scope; a dashboard should run on a read-only token,
 *     and initialize already proves both reachability and token validity.
 *
 * Request shape matches gbrain's own client (`src/commands/auth.ts`): POST
 * JSON-RPC 2.0, bearer token, and an Accept naming both content types.
 */
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export type GBrainHttpOptions = {
  url: string;
  token: string;
  fetchImpl?: FetchFn;
  timeoutMs?: number;
};

const READ_TIMEOUT_MS = 15_000;
const MAX_RESULTS = 8;

/** The last `data:` payload in an SSE frame, or null when there is none. */
function sseData(body: string): string | null {
  const lines = body.split('\n').filter((l) => l.startsWith('data:'));
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const payload = lines[i].slice('data:'.length).trim();
    if (payload) return payload;
  }
  return null;
}

/**
 * MCP's streamable HTTP transport answers the same POST as either JSON or SSE,
 * which is why the client advertises both. Reading an SSE body as JSON throws
 * on the `event:` line, so the content type decides.
 *
 * Returns null rather than throwing: an HTML error page from a proxy in front
 * of the brain is a normal failure, not an exception.
 */
export function parseMcpBody(contentType: string, body: string): Record<string, unknown> | null {
  const text = contentType.includes('text/event-stream') ? sseData(body) : body;
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The frozen `recall` envelope's search arm → the dashboard's shape.
 *
 * A result with no title still has a slug, and a slug beats an empty heading.
 * Anything that is not the documented shape yields nothing rather than
 * throwing, because this runs inside a page render.
 */
export function toSearchResults(payload: unknown): BrainSearchResult[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  return results.slice(0, MAX_RESULTS).flatMap((raw): BrainSearchResult[] => {
    if (typeof raw !== 'object' || raw === null) return [];
    const row = raw as { slug?: unknown; title?: unknown; chunk?: unknown };
    const slug = typeof row.slug === 'string' ? row.slug : '';
    const title = typeof row.title === 'string' && row.title ? row.title : slug;
    if (!title) return [];
    return [
      {
        title,
        snippet: typeof row.chunk === 'string' ? row.chunk : '',
        source: slug || 'gbrain',
      },
    ];
  });
}

/** The tool result's text content, which carries the verb's JSON envelope. */
function toolPayload(envelope: Record<string, unknown>): unknown {
  if (envelope.error) return null; // a JSON-RPC error is not a result
  const result = envelope.result as { content?: unknown } | undefined;
  if (!result) return null;
  const content = result.content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    const text = (block as { text?: unknown })?.text;
    if (typeof text !== 'string') continue;
    try {
      return JSON.parse(text);
    } catch {
      // not this block
    }
  }
  return null;
}

export function createGBrainHttpProvider(opts: GBrainHttpOptions): BrainProvider {
  const doFetch: FetchFn = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const timeoutMs = opts.timeoutMs ?? READ_TIMEOUT_MS;

  const rpc = async (method: string, params: unknown, id: number) => {
    const res = await doFetch(opts.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.token}`,
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id }),
      // A paused or overloaded brain must not hang a page render.
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res;
  };

  return {
    name: 'gbrain-http',

    async status(): Promise<BrainStatus> {
      let res: Response;
      try {
        res = await rpc(
          'initialize',
          {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'founder-os', version: '1.0' },
          },
          1,
        );
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'unreachable';
        return {
          connected: false,
          provider: 'gbrain-http',
          detail: `${opts.url} unreachable — ${detail.slice(0, 160)}`,
        };
      }

      // A rejected token and a dead server need different fixes; saying only
      // "not connected" sends the operator to restart a healthy brain.
      if (res.status === 401 || res.status === 403) {
        return {
          connected: false,
          provider: 'gbrain-http',
          detail: `brain rejected the token (${res.status}) — check GBRAIN_TOKEN against \`gbrain auth create\``,
        };
      }
      if (!res.ok) {
        return {
          connected: false,
          provider: 'gbrain-http',
          detail: `brain answered ${res.status} ${res.statusText}`.trim(),
        };
      }

      const envelope = parseMcpBody(res.headers.get('content-type') ?? '', await res.text());
      const server = (envelope?.result as { serverInfo?: { name?: string; version?: string } } | undefined)?.serverInfo;
      if (!envelope?.result) {
        return { connected: false, provider: 'gbrain-http', detail: 'brain answered, but not with an MCP result' };
      }
      return {
        connected: true,
        provider: 'gbrain-http',
        detail: `${server?.name ?? 'gbrain'} ${server?.version ?? ''} · ${opts.url}`.replace('  ', ' ').trim(),
      };
    },

    async search(query: string): Promise<BrainSearchResult[]> {
      // Unlike the CLI provider there is no local brain-store to fall back to,
      // so a failure yields nothing and the view shows its own empty state.
      try {
        const res = await rpc('tools/call', { name: 'recall', arguments: { query, limit: MAX_RESULTS } }, 2);
        if (!res.ok) return [];
        const envelope = parseMcpBody(res.headers.get('content-type') ?? '', await res.text());
        if (!envelope) return [];
        return toSearchResults(toolPayload(envelope));
      } catch {
        return [];
      }
    },
  };
}
