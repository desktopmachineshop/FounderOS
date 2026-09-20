import { VENTURES } from '@/lib/ventures';
import { OdooProductSchema, OdooWebsiteSchema, type OdooProduct, type OdooWebsite } from '@/lib/schemas';
import type { ConnectorStatus } from '@/lib/connectors/types';

/**
 * Odoo — the ERP behind three of the four businesses.
 *
 * Desktop Machine Shop, DMS Industrial and 3DPandMe are three websites on ONE
 * Odoo instance, so one credential serves all three and a row is attributable
 * only once its website is mapped back to a venture (`ventureForOdooWebsite`).
 * OpenV runs independently and is not in here at all.
 *
 * Transport is **JSON-RPC** (`POST /jsonrpc`), not the XML-RPC the Odoo docs
 * lead with: it is the same API surface, speaks JSON both ways, and needs no
 * XML dependency in a Next app. Two services are used — `common.authenticate`
 * to exchange the API key for a uid, then `object.execute_kw` for every read.
 *
 * Read-only by construction. Nothing here calls a write method, and no
 * caller-supplied model or method reaches `execute_kw` — the callable reads are
 * the exported functions below. Credentials resolve through the env record
 * (`.env.local` via runtimeEnv()); the key itself never enters this repo.
 *
 * Env var names deliberately match the `odoo-product-info` skill, so an
 * instance already set up for that skill works here with nothing to re-enter.
 */

export const ODOO_ENV_KEYS = ['ODOO_URL', 'ODOO_DB', 'ODOO_USER', 'ODOO_API_KEY'] as const;

export type OdooConfig = { url: string; db: string; user: string; apiKey: string };

export type OdooConfigResult = { ok: true; config: OdooConfig } | { ok: false; missing: string[] };

const TIMEOUT_MS = 8000;

/** Resolve the four credentials, naming precisely which are absent. */
export function resolveOdooConfig(env: Record<string, string | undefined>): OdooConfigResult {
  const missing = ODOO_ENV_KEYS.filter((k) => !env[k] || env[k]!.trim() === '');
  if (missing.length > 0) return { ok: false, missing: [...missing] };
  return {
    ok: true,
    config: {
      url: env.ODOO_URL!.trim().replace(/\/+$/, ''),
      db: env.ODOO_DB!.trim(),
      user: env.ODOO_USER!.trim(),
      apiKey: env.ODOO_API_KEY!.trim(),
    },
  };
}

/** The JSON-RPC envelope Odoo expects on `/jsonrpc`. */
export function jsonRpcBody(service: string, method: string, args: unknown[], id = 1): string {
  return JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id });
}

/**
 * Unwrap a JSON-RPC response.
 *
 * Odoo answers faults with **HTTP 200** and an `error` envelope, so `res.ok`
 * proves nothing and a client that trusts it reports success on an access
 * error. Everything goes through here, and Odoo's own message is preserved —
 * "expired API key" is worth seeing, "request failed" is not.
 */
export function parseOdooResponse(raw: unknown): unknown {
  const body = raw as { result?: unknown; error?: { message?: string; data?: { message?: string } } } | null;
  if (!body || typeof body !== 'object') throw new Error('Odoo returned a non-JSON-RPC response');
  if (body.error) {
    throw new Error(body.error.data?.message || body.error.message || 'Odoo Server Error');
  }
  if (!('result' in body)) throw new Error('Odoo response carried neither result nor error');
  return body.result;
}

/** Odoo uses `false` for "empty" and `[id, label]` for a many2one reference. */
export function normalizeOdooValue(value: unknown): unknown {
  if (value === false) return null;
  if (Array.isArray(value) && value.length === 2 && typeof value[1] === 'string') return value[1];
  return value;
}

const str = (v: unknown): string | null => {
  const n = normalizeOdooValue(v);
  return typeof n === 'string' && n.trim() !== '' ? n : null;
};
const num = (v: unknown): number | null => {
  const n = normalizeOdooValue(v);
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/**
 * Map `product.template` rows into validated products. A row Odoo returns in
 * an unexpected shape is skipped, not fatal: one bad record should not cost
 * the whole catalogue.
 */
export function mapOdooProducts(rows: unknown[]): OdooProduct[] {
  const out: OdooProduct[] = [];
  for (const raw of rows ?? []) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const parsed = OdooProductSchema.safeParse({
      id: r.id,
      name: str(r.name) ?? '',
      sku: str(r.default_code),
      barcode: str(r.barcode),
      listPrice: num(r.list_price),
      cost: num(r.standard_price),
      category: str(r.categ_id),
      weightKg: num(r.weight),
      onHand: num(r.qty_available),
      active: r.active !== false,
      saleOk: r.sale_ok !== false,
    });
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** Hostname of a domain-ish string, lowercased and stripped of `www.`. */
function hostOf(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Which venture owns an Odoo website, by domain. The venture URLs in
 * `lib/ventures.ts` are the single source — the two lists cannot drift because
 * this one is derived. An unrecognised domain is null: an unattributed row is
 * honest, a guessed one is not.
 */
export function ventureForOdooWebsite(domain: unknown): string | null {
  const host = hostOf(domain);
  if (!host) return null;
  for (const v of VENTURES) {
    if (hostOf(v.url) === host) return v.id;
  }
  return null;
}

/** Map `website` rows, pairing each with its venture where one matches. */
export function mapOdooWebsites(rows: unknown[]): OdooWebsite[] {
  const out: OdooWebsite[] = [];
  for (const raw of rows ?? []) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const parsed = OdooWebsiteSchema.safeParse({
      id: r.id,
      name: str(r.name) ?? '',
      domain: str(r.domain),
      venture: ventureForOdooWebsite(r.domain),
    });
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

// ── Transport ──────────────────────────────────────────────────────────────

async function rpc(
  config: OdooConfig,
  service: string,
  method: string,
  args: unknown[],
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const res = await fetchImpl(`${config.url}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: jsonRpcBody(service, method, args),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseOdooResponse(await res.json());
}

/** Exchange the API key for a uid. Odoo returns `false` when it refuses. */
export async function odooAuthenticate(
  config: OdooConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const uid = await rpc(config, 'common', 'authenticate', [config.db, config.user, config.apiKey, {}], fetchImpl);
  if (typeof uid !== 'number' || uid <= 0) {
    throw new Error('Odoo refused the credentials (authenticate returned no uid) — check ODOO_DB, ODOO_USER and that the API key is still valid.');
  }
  return uid;
}

/** One `execute_kw` read. Models and methods come from this module only. */
async function read(
  config: OdooConfig,
  uid: number,
  model: string,
  method: 'search_read' | 'search_count',
  args: unknown[],
  kwargs: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  return rpc(config, 'object', 'execute_kw', [config.db, uid, config.apiKey, model, method, args, kwargs], fetchImpl);
}

const PRODUCT_FIELDS = [
  'name',
  'default_code',
  'barcode',
  'list_price',
  'standard_price',
  'categ_id',
  'weight',
  'qty_available',
  'active',
  'sale_ok',
];

/** The sellable catalogue, newest-id first. Never throws — [] on any failure. */
export async function odooProducts(
  env: Record<string, string | undefined>,
  opts: { limit?: number; fetchImpl?: typeof fetch } = {},
): Promise<OdooProduct[]> {
  const resolved = resolveOdooConfig(env);
  if (!resolved.ok) return [];
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const uid = await odooAuthenticate(resolved.config, fetchImpl);
    const rows = await read(
      resolved.config,
      uid,
      'product.template',
      'search_read',
      [[['sale_ok', '=', true]]],
      { fields: PRODUCT_FIELDS, limit: opts.limit ?? 200 },
      fetchImpl,
    );
    return mapOdooProducts(Array.isArray(rows) ? rows : []);
  } catch {
    return [];
  }
}

/**
 * The websites on the instance, paired with the ventures they belong to.
 * Returns [] when the Website module is not installed — that is a shape of
 * Odoo, not a failure of the connector.
 */
export async function odooWebsites(
  env: Record<string, string | undefined>,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<OdooWebsite[]> {
  const resolved = resolveOdooConfig(env);
  if (!resolved.ok) return [];
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const uid = await odooAuthenticate(resolved.config, fetchImpl);
    const rows = await read(
      resolved.config,
      uid,
      'website',
      'search_read',
      [[]],
      { fields: ['name', 'domain'] },
      fetchImpl,
    );
    return mapOdooWebsites(Array.isArray(rows) ? rows : []);
  } catch {
    return [];
  }
}

const NAME = 'Odoo (ERP + stores)';

function status(state: ConnectorStatus['state'], detail: string, meta?: ConnectorStatus['meta']): ConnectorStatus {
  return { id: 'odoo', name: NAME, kind: 'commerce', state, detail, meta };
}

/**
 * Honest instance status. `connected` requires a real uid from a real
 * authenticate call; a missing Website module downgrades the website count to
 * 0 rather than the whole connector to error.
 */
export async function odooStatus(
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectorStatus> {
  const resolved = resolveOdooConfig(env);
  if (!resolved.ok) {
    return status('not_configured', `Set ${resolved.missing.join(', ')} in .env.local.`);
  }
  const { config } = resolved;
  try {
    const uid = await odooAuthenticate(config, fetchImpl);
    const count = await read(config, uid, 'product.template', 'search_count', [[['sale_ok', '=', true]]], {}, fetchImpl);
    const products = typeof count === 'number' ? count : 0;

    // The Website module is optional; its absence is not a connection failure.
    let websites: OdooWebsite[] = [];
    try {
      const rows = await read(config, uid, 'website', 'search_read', [[]], { fields: ['name', 'domain'] }, fetchImpl);
      websites = mapOdooWebsites(Array.isArray(rows) ? rows : []);
    } catch {
      websites = [];
    }

    const ventures = new Set(websites.map((w) => w.venture).filter(Boolean)).size;
    const siteNote =
      websites.length > 0
        ? ` · ${websites.length} website${websites.length === 1 ? '' : 's'}, ${ventures} mapped to a venture`
        : ' · website module not reporting';
    return status('connected', `${products} sellable products${siteNote}`, {
      products,
      websites: websites.length,
      ventures,
      uid,
    });
  } catch (err) {
    return status('error', `Credentials set but the instance rejected the call: ${err instanceof Error ? err.message : String(err)}`);
  }
}
