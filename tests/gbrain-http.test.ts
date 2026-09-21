import { describe, expect, it } from 'vitest';
import {
  createGBrainHttpProvider,
  parseMcpBody,
  toSearchResults,
  type FetchFn,
} from '@/lib/connectors/gbrain-http';

/**
 * G-Brain over HTTP.
 *
 * The CLI provider shells out to a local `gbrain` binary, which is exactly why
 * G-Brain was listed among the connectors that cannot run in the cloud. It can:
 * `gbrain serve --http` is a real remote server (OAuth 2.1, bearer tokens), and
 * this provider is the other half of that wire.
 *
 * Two protocol choices are load-bearing and therefore pinned here:
 *
 *   - Search goes through `recall`, not `search`. `recall` is the FROZEN
 *     MEMORY_VERBS v1 contract with a documented response shape, present on the
 *     `starter` and `full` surfaces alike. `search` is neither frozen nor
 *     guaranteed to be served.
 *   - Status is the `initialize` handshake, not `run_doctor` or `get_stats`.
 *     Both of those need ADMIN scope; a dashboard should run on a read-only
 *     token, and initialize already proves reachability and token validity.
 */

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('parseMcpBody', () => {
  it('reads a plain JSON-RPC body', () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } });
    expect(parseMcpBody('application/json', body)).toEqual({ jsonrpc: '2.0', id: 1, result: { ok: true } });
  });

  /**
   * MCP's streamable HTTP transport may answer the same POST as SSE — which is
   * why the client advertises `Accept: application/json, text/event-stream`.
   * Reading that body as JSON throws on the `event:` line.
   */
  it('reads an SSE body, which the same endpoint may return instead', () => {
    const sse = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n';
    expect(parseMcpBody('text/event-stream', sse)).toEqual({ jsonrpc: '2.0', id: 1, result: { ok: true } });
  });

  it('returns null rather than throwing on a body that is neither', () => {
    expect(parseMcpBody('text/html', '<html>502 Bad Gateway</html>')).toBeNull();
  });
});

describe('toSearchResults', () => {
  /** The frozen `recall` shape: results[] carry slug, title, chunk. */
  it('maps the frozen recall shape onto the dashboard shape', () => {
    const payload = {
      protocol_version: 1,
      results: [
        { slug: 'people/dave', title: 'Dave', chunk: 'runs four businesses', evidence: 'exact_title_match' },
      ],
    };
    expect(toSearchResults(payload)).toEqual([
      { title: 'Dave', snippet: 'runs four businesses', source: 'people/dave' },
    ]);
  });

  /** A page with no title still has a slug; showing an empty heading is worse. */
  it('falls back to the slug when a result carries no title', () => {
    const payload = { results: [{ slug: 'notes/untitled', chunk: 'body text' }] };
    expect(toSearchResults(payload)[0].title).toBe('notes/untitled');
  });

  it('a response with no search arm yields nothing, not a crash', () => {
    expect(toSearchResults({ protocol_version: 1, facts: [], total: 0 })).toEqual([]);
    expect(toSearchResults(null)).toEqual([]);
    expect(toSearchResults('nonsense')).toEqual([]);
  });
});

describe('createGBrainHttpProvider', () => {
  const okInit = () => jsonResponse({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'gbrain', version: '0.51.6.0' } } });

  it('sends the bearer token and both accepted content types', async () => {
    let seen: RequestInit | undefined;
    const fetchImpl: FetchFn = async (_url, init) => {
      seen = init;
      return okInit();
    };
    const provider = createGBrainHttpProvider({ url: 'https://brain.example/mcp', token: 'gbrain_xyz', fetchImpl });
    await provider.status();

    const headers = seen?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer gbrain_xyz');
    expect(headers.Accept).toBe('application/json, text/event-stream');
    expect(seen?.method).toBe('POST');
  });

  it('a successful handshake reports connected', async () => {
    const provider = createGBrainHttpProvider({ url: 'https://brain.example/mcp', token: 't', fetchImpl: async () => okInit() });
    const status = await provider.status();
    expect(status.connected).toBe(true);
    expect(status.provider).toBe('gbrain-http');
  });

  /**
   * A rejected token and an unreachable host are different problems with
   * different fixes. Collapsing them into "not connected" sends the operator
   * to restart a server that is running fine.
   */
  it('a rejected token says so, rather than blaming the server', async () => {
    const provider = createGBrainHttpProvider({
      url: 'https://brain.example/mcp',
      token: 'stale',
      fetchImpl: async () => jsonResponse({ error: 'unauthorized' }, 401),
    });
    const status = await provider.status();
    expect(status.connected).toBe(false);
    expect(status.detail).toMatch(/token/i);
  });

  it('an unreachable host is reported, not thrown', async () => {
    const provider = createGBrainHttpProvider({
      url: 'https://brain.example/mcp',
      token: 't',
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const status = await provider.status();
    expect(status.connected).toBe(false);
    expect(status.detail).toMatch(/ECONNREFUSED|unreachable/i);
  });

  it('calls recall — the frozen verb — with the query', async () => {
    let body: unknown;
    const provider = createGBrainHttpProvider({
      url: 'https://brain.example/mcp',
      token: 't',
      fetchImpl: async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return jsonResponse({
          jsonrpc: '2.0',
          id: 1,
          result: { content: [{ type: 'text', text: JSON.stringify({ results: [{ slug: 's', title: 'T', chunk: 'C' }] }) }] },
        });
      },
    });
    const results = await provider.search('machine shop');

    expect(body).toMatchObject({ method: 'tools/call', params: { name: 'recall', arguments: { query: 'machine shop' } } });
    expect(results).toEqual([{ title: 'T', snippet: 'C', source: 's' }]);
  });

  /**
   * A page render must never 500 because the brain is down. The CLI provider
   * falls back to the local store; the HTTP one has no local store to fall back
   * to, so it returns nothing and lets the view show its empty state.
   */
  it('a failing brain yields no results rather than a thrown page render', async () => {
    const provider = createGBrainHttpProvider({
      url: 'https://brain.example/mcp',
      token: 't',
      fetchImpl: async () => {
        throw new Error('gateway timeout');
      },
    });
    await expect(provider.search('anything')).resolves.toEqual([]);
  });

  it('a JSON-RPC error envelope is not mistaken for results', async () => {
    const provider = createGBrainHttpProvider({
      url: 'https://brain.example/mcp',
      token: 't',
      fetchImpl: async () => jsonResponse({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'unknown tool' } }),
    });
    await expect(provider.search('x')).resolves.toEqual([]);
  });
});
