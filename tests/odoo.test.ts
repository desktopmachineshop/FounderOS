import { describe, expect, test } from 'vitest';
import {
  resolveOdooConfig,
  jsonRpcBody,
  parseOdooResponse,
  normalizeOdooValue,
  mapOdooProducts,
  mapOdooWebsites,
  ventureForOdooWebsite,
  odooStatus,
  ODOO_ENV_KEYS,
} from '@/lib/connectors/odoo';
import { OdooProductSchema } from '@/lib/schemas';

const ENV = {
  ODOO_URL: 'https://desktopmachineshop.odoo.com',
  ODOO_DB: 'desktopmachineshop',
  ODOO_USER: 'dave@desktopmachineshop.com',
  ODOO_API_KEY: 'test-key',
};

/** A fetch stand-in that answers each JSON-RPC call from a queue. */
function fakeFetch(results: unknown[]): typeof fetch {
  const queue = [...results];
  return (async () => {
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return {
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: next }),
    } as Response;
  }) as unknown as typeof fetch;
}

describe('resolveOdooConfig', () => {
  test('all four variables present resolves', () => {
    const r = resolveOdooConfig(ENV);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.db).toBe('desktopmachineshop');
    expect(r.config.user).toBe('dave@desktopmachineshop.com');
  });

  test('a trailing slash on the URL is stripped so paths never double up', () => {
    const r = resolveOdooConfig({ ...ENV, ODOO_URL: 'https://desktopmachineshop.odoo.com/' });
    expect(r.ok && r.config.url).toBe('https://desktopmachineshop.odoo.com');
  });

  test('missing variables are named exactly — the board tells you what to set', () => {
    const r = resolveOdooConfig({ ODOO_URL: ENV.ODOO_URL });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing).toEqual(['ODOO_DB', 'ODOO_USER', 'ODOO_API_KEY']);
  });

  test('an empty string counts as missing, not as a value', () => {
    const r = resolveOdooConfig({ ...ENV, ODOO_API_KEY: '' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing).toEqual(['ODOO_API_KEY']);
  });

  test('the documented key names are the ones the odoo-product-info skill uses', () => {
    expect(ODOO_ENV_KEYS).toEqual(['ODOO_URL', 'ODOO_DB', 'ODOO_USER', 'ODOO_API_KEY']);
  });
});

describe('jsonRpcBody', () => {
  test('wraps a service call in the envelope Odoo expects', () => {
    const body = JSON.parse(jsonRpcBody('object', 'execute_kw', ['db', 2, 'key', 'res.partner', 'search_read']));
    expect(body.jsonrpc).toBe('2.0');
    expect(body.method).toBe('call');
    expect(body.params.service).toBe('object');
    expect(body.params.method).toBe('execute_kw');
    expect(body.params.args[3]).toBe('res.partner');
  });
});

/**
 * The gotcha that makes a naive client report success on failure: Odoo answers
 * JSON-RPC faults with **HTTP 200** and an `error` envelope, so `res.ok` proves
 * nothing. Every call has to look inside the body.
 */
describe('parseOdooResponse', () => {
  test('returns the result on success, including falsy results', () => {
    expect(parseOdooResponse({ jsonrpc: '2.0', id: 1, result: [1, 2] })).toEqual([1, 2]);
    expect(parseOdooResponse({ jsonrpc: '2.0', id: 1, result: false })).toBe(false);
    expect(parseOdooResponse({ jsonrpc: '2.0', id: 1, result: 0 })).toBe(0);
  });

  test('an error envelope throws with Odoo own message, not a generic one', () => {
    expect(() =>
      parseOdooResponse({
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: 200,
          message: 'Odoo Server Error',
          data: { name: 'odoo.exceptions.AccessError', message: 'You are not allowed to access Product.' },
        },
      }),
    ).toThrow('You are not allowed to access Product.');
  });

  test('falls back to the outer message when data carries none', () => {
    expect(() => parseOdooResponse({ error: { code: 200, message: 'Odoo Server Error' } })).toThrow(
      'Odoo Server Error',
    );
  });

  test('a response with neither result nor error is not silently treated as success', () => {
    expect(() => parseOdooResponse({ jsonrpc: '2.0', id: 1 })).toThrow();
    expect(() => parseOdooResponse(null)).toThrow();
  });
});

describe('normalizeOdooValue', () => {
  test('Odoo false-for-empty becomes null', () => {
    expect(normalizeOdooValue(false)).toBeNull();
  });

  test('a many2one [id, label] pair becomes its label', () => {
    expect(normalizeOdooValue([12, 'CNC Kits'])).toBe('CNC Kits');
  });

  test('real values pass through untouched — including 0 and true', () => {
    expect(normalizeOdooValue(0)).toBe(0);
    expect(normalizeOdooValue(true)).toBe(true);
    expect(normalizeOdooValue('MILO-V2')).toBe('MILO-V2');
  });
});

describe('mapOdooProducts', () => {
  const row = {
    id: 42,
    name: 'Milo v2.0 CNC mill kit 220V',
    default_code: 'MILO-V2-BASE-220',
    barcode: false,
    list_price: 1250,
    standard_price: 640,
    categ_id: [7, 'CNC Kits'],
    weight: 38.5,
    qty_available: 12,
    active: true,
    sale_ok: true,
  };

  test('maps an Odoo product row into a validated product', () => {
    const [p] = mapOdooProducts([row]);
    expect(p.id).toBe(42);
    expect(p.sku).toBe('MILO-V2-BASE-220');
    expect(p.name).toBe('Milo v2.0 CNC mill kit 220V');
    expect(p.listPrice).toBe(1250);
    expect(p.cost).toBe(640);
    expect(p.category).toBe('CNC Kits');
    expect(p.weightKg).toBe(38.5);
    expect(p.onHand).toBe(12);
    expect(() => OdooProductSchema.parse(p)).not.toThrow();
  });

  test('Odoo empty-as-false is normalised to null, never to the string "false"', () => {
    const [p] = mapOdooProducts([row]);
    expect(p.barcode).toBeNull();
    const [noSku] = mapOdooProducts([{ ...row, default_code: false, categ_id: false }]);
    expect(noSku.sku).toBeNull();
    expect(noSku.category).toBeNull();
  });

  test('a malformed row is skipped rather than throwing the whole read away', () => {
    const rows = mapOdooProducts([row, { id: 'not-a-number', name: 'broken' }, null, { name: 'no id' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(42);
  });

  test('missing optional fields land as null, not as invented numbers', () => {
    const [p] = mapOdooProducts([{ id: 9, name: 'Bare', list_price: 10 }]);
    expect(p.cost).toBeNull();
    expect(p.weightKg).toBeNull();
    expect(p.onHand).toBeNull();
    expect(p.listPrice).toBe(10);
  });
});

/**
 * Three of the four businesses share one Odoo instance as separate websites,
 * so a row is only attributable once its website maps to a venture. The
 * mapping is by domain, taken from `lib/ventures.ts` — the two lists cannot
 * drift because one is derived from the other.
 */
describe('ventureForOdooWebsite', () => {
  test('each Odoo-hosted site maps to its venture', () => {
    expect(ventureForOdooWebsite('https://www.desktopmachineshop.com')).toBe('desktop-machine-shop');
    expect(ventureForOdooWebsite('https://www.desktopmachineshop.co.uk')).toBe('dms-industrial');
    expect(ventureForOdooWebsite('https://www.3dpandme.com')).toBe('3dpandme');
  });

  test('the .com and .co.uk stores never collide', () => {
    expect(ventureForOdooWebsite('desktopmachineshop.co.uk')).not.toBe(
      ventureForOdooWebsite('desktopmachineshop.com'),
    );
  });

  test('scheme, www, case, port and path are all ignored', () => {
    for (const d of [
      'www.3dpandme.com',
      '3DPandMe.com',
      'http://3dpandme.com:8069',
      'https://www.3dpandme.com/shop',
    ]) {
      expect(ventureForOdooWebsite(d), d).toBe('3dpandme');
    }
  });

  test('an unknown or empty domain is null, never a guess', () => {
    expect(ventureForOdooWebsite('example.com')).toBeNull();
    expect(ventureForOdooWebsite('')).toBeNull();
    expect(ventureForOdooWebsite(null)).toBeNull();
    expect(ventureForOdooWebsite(false)).toBeNull();
  });
});

describe('mapOdooWebsites', () => {
  test('pairs each website with the venture that owns it', () => {
    const sites = mapOdooWebsites([
      { id: 1, name: 'Desktop Machine Shop', domain: 'https://www.desktopmachineshop.com' },
      { id: 2, name: 'DMS Industrial', domain: 'https://www.desktopmachineshop.co.uk' },
      { id: 3, name: '3DPandMe', domain: 'https://www.3dpandme.com' },
    ]);
    expect(sites.map((s) => s.venture)).toEqual(['desktop-machine-shop', 'dms-industrial', '3dpandme']);
  });

  test('a website with no domain set is kept, but unattributed', () => {
    const [site] = mapOdooWebsites([{ id: 4, name: 'Staging', domain: false }]);
    expect(site.name).toBe('Staging');
    expect(site.venture).toBeNull();
  });
});

describe('odooStatus', () => {
  test('unconfigured names the missing variables and never claims connected', async () => {
    const s = await odooStatus({}, fakeFetch([]));
    expect(s.id).toBe('odoo');
    expect(s.state).toBe('not_configured');
    expect(s.detail).toContain('ODOO_URL');
    expect(s.detail).toContain('ODOO_API_KEY');
  });

  test('a good instance reports the real product and website counts', async () => {
    const s = await odooStatus(
      ENV,
      fakeFetch([
        7, // authenticate → uid
        124, // search_count product.template
        [
          { id: 1, name: 'Desktop Machine Shop', domain: 'https://www.desktopmachineshop.com' },
          { id: 2, name: 'DMS Industrial', domain: 'https://www.desktopmachineshop.co.uk' },
          { id: 3, name: '3DPandMe', domain: 'https://www.3dpandme.com' },
        ],
      ]),
    );
    expect(s.state).toBe('connected');
    expect(s.detail).toContain('124');
    expect(s.meta?.products).toBe(124);
    expect(s.meta?.websites).toBe(3);
    expect(s.meta?.ventures).toBe(3);
  });

  test('rejected credentials are an error, not a silent not_configured', async () => {
    // Odoo answers a failed authenticate with `false`, HTTP 200.
    const s = await odooStatus(ENV, fakeFetch([false]));
    expect(s.state).toBe('error');
    expect(s.detail.toLowerCase()).toContain('authentic');
  });

  test('a network failure surfaces as error with the cause', async () => {
    const s = await odooStatus(ENV, fakeFetch([new Error('ECONNREFUSED')]));
    expect(s.state).toBe('error');
    expect(s.detail).toContain('ECONNREFUSED');
  });

  test('an instance reachable but with the website module absent still connects', async () => {
    const s = await odooStatus(
      ENV,
      fakeFetch([7, 12, new Error('Object website doesn not exist')]),
    );
    expect(s.state).toBe('connected');
    expect(s.meta?.products).toBe(12);
    expect(s.meta?.websites).toBe(0);
  });
});
