import { describe, expect, test } from 'vitest';
import {
  odooDateToIso,
  websiteVentureMap,
  mapOdooOrders,
  revenueByVenture,
  ORDER_REVENUE_STATES,
  mapOdooWebsites,
  ventureForOdooWebsite,
} from '@/lib/connectors/odoo';
import { OdooOrderSchema } from '@/lib/schemas';

/**
 * Odoo returns datetimes as naive strings in UTC — "2026-09-19 14:32:11", with
 * no zone marker at all. Passed to `new Date()` in a browser that is not on
 * UTC, that parses as *local* time and silently shifts every order by the
 * offset. Every date crosses this function.
 */
describe('odooDateToIso', () => {
  test('a naive Odoo datetime is read as UTC', () => {
    expect(odooDateToIso('2026-09-19 14:32:11')).toBe('2026-09-19T14:32:11.000Z');
  });

  test('a date with no time is midnight UTC', () => {
    expect(odooDateToIso('2026-09-19')).toBe('2026-09-19T00:00:00.000Z');
  });

  test('an already-zoned value is respected rather than double-converted', () => {
    expect(odooDateToIso('2026-09-19T14:32:11Z')).toBe('2026-09-19T14:32:11.000Z');
  });

  test('Odoo empty-as-false and junk are null, never the epoch', () => {
    expect(odooDateToIso(false)).toBeNull();
    expect(odooDateToIso('')).toBeNull();
    expect(odooDateToIso('not a date')).toBeNull();
    expect(odooDateToIso(null)).toBeNull();
  });
});

describe('websiteVentureMap', () => {
  const websites = mapOdooWebsites([
    { id: 1, name: 'Desktop Machine Shop', domain: 'https://www.desktopmachineshop.com' },
    { id: 2, name: 'DMS Industrial', domain: 'https://www.desktopmachineshop.co.uk' },
    { id: 9, name: 'Staging', domain: false },
  ]);

  test('maps website id to venture id', () => {
    const map = websiteVentureMap(websites);
    expect(map.get(1)).toBe('desktop-machine-shop');
    expect(map.get(2)).toBe('dms-industrial');
  });

  test('a website that matches no venture maps to null, and an unknown id is undefined', () => {
    const map = websiteVentureMap(websites);
    expect(map.get(9)).toBeNull();
    expect(map.get(404)).toBeUndefined();
  });
});

/**
 * A website whose `domain` is blank in Odoo is common — the field is optional
 * and plenty of live instances never set it. Falling back to an exact name
 * match against the venture labels keeps those sites attributable without
 * guessing: an exact label match is a match, a fuzzy one would be a guess.
 */
describe('ventureForOdooWebsite — name fallback', () => {
  test('an exact venture label resolves when no domain is set', () => {
    expect(ventureForOdooWebsite(false, 'Desktop Machine Shop')).toBe('desktop-machine-shop');
    expect(ventureForOdooWebsite(null, 'DMS Industrial')).toBe('dms-industrial');
    expect(ventureForOdooWebsite('', '3DPandMe')).toBe('3dpandme');
  });

  test('the label match ignores case and surrounding space', () => {
    expect(ventureForOdooWebsite(false, '  desktop machine shop ')).toBe('desktop-machine-shop');
  });

  test('a partial or unrelated name stays null — no fuzzy matching', () => {
    expect(ventureForOdooWebsite(false, 'Desktop Machine Shop EU')).toBeNull();
    expect(ventureForOdooWebsite(false, 'Machine Shop')).toBeNull();
    expect(ventureForOdooWebsite(false, 'Some Other Site')).toBeNull();
    expect(ventureForOdooWebsite(false, false)).toBeNull();
  });

  test('the domain still wins when both are present', () => {
    expect(ventureForOdooWebsite('https://www.3dpandme.com', 'DMS Industrial')).toBe('3dpandme');
  });

  test('mapOdooWebsites applies the fallback', () => {
    const [site] = mapOdooWebsites([{ id: 5, name: '3DPandMe', domain: false }]);
    expect(site.venture).toBe('3dpandme');
  });
});

describe('mapOdooOrders', () => {
  const ventures = new Map<number, string | null>([
    [1, 'desktop-machine-shop'],
    [2, 'dms-industrial'],
  ]);
  const row = {
    id: 501,
    name: 'S00123',
    date_order: '2026-09-19 14:32:11',
    state: 'sale',
    partner_id: [88, 'Harbor Dental'],
    website_id: [2, 'DMS Industrial'],
    currency_id: [1, 'GBP'],
    amount_total: 1440.0,
    amount_untaxed: 1200.0,
    amount_tax: 240.0,
  };

  test('maps a sale order row into a validated order', () => {
    const [o] = mapOdooOrders([row], ventures);
    expect(o.id).toBe(501);
    expect(o.ref).toBe('S00123');
    expect(o.at).toBe('2026-09-19T14:32:11.000Z');
    expect(o.state).toBe('sale');
    expect(o.customer).toBe('Harbor Dental');
    expect(o.venture).toBe('dms-industrial');
    expect(o.currency).toBe('GBP');
    expect(o.amountTotal).toBe(1440);
    expect(o.amountUntaxed).toBe(1200);
    expect(o.amountTax).toBe(240);
    expect(() => OdooOrderSchema.parse(o)).not.toThrow();
  });

  test('a back-office order with no website is unattributed, not dropped', () => {
    const [o] = mapOdooOrders([{ ...row, website_id: false }], ventures);
    expect(o.venture).toBeNull();
    expect(o.websiteId).toBeNull();
    expect(o.amountTotal).toBe(1440);
  });

  test('a website id the map does not know stays null rather than guessing', () => {
    const [o] = mapOdooOrders([{ ...row, website_id: [77, 'Unknown Site'] }], ventures);
    expect(o.websiteId).toBe(77);
    expect(o.venture).toBeNull();
  });

  test('a malformed row is skipped rather than throwing the read away', () => {
    const rows = mapOdooOrders([row, null, { id: 'nope' }, { name: 'no id' }], ventures);
    expect(rows).toHaveLength(1);
  });

  test('a missing currency is null — never assumed to be the one you expect', () => {
    const [o] = mapOdooOrders([{ ...row, currency_id: false }], ventures);
    expect(o.currency).toBeNull();
  });
});

/**
 * What counts as revenue is an accounting decision, not a formatting one.
 * Odoo keeps abandoned web checkouts as `draft` orders forever, so counting
 * them would inflate every number on the dashboard. Only confirmed orders
 * (`sale`, `done`) are revenue.
 */
describe('revenueByVenture', () => {
  const ventures = new Map<number, string | null>([
    [1, 'desktop-machine-shop'],
    [2, 'dms-industrial'],
  ]);
  const order = (over: Record<string, unknown>) => ({
    id: 1,
    name: 'S1',
    date_order: '2026-09-19 10:00:00',
    state: 'sale',
    partner_id: [1, 'A'],
    website_id: [1, 'Desktop Machine Shop'],
    currency_id: [1, 'USD'],
    amount_total: 100,
    amount_untaxed: 100,
    amount_tax: 0,
    ...over,
  });

  test('the confirmed states are the ones Odoo treats as sold', () => {
    expect([...ORDER_REVENUE_STATES].sort()).toEqual(['done', 'sale']);
  });

  test('sums confirmed orders per venture', () => {
    const orders = mapOdooOrders(
      [order({ id: 1 }), order({ id: 2, amount_total: 250 }), order({ id: 3, state: 'done', amount_total: 50 })],
      ventures,
    );
    const rows = revenueByVenture(orders);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ venture: 'desktop-machine-shop', currency: 'USD', orders: 3, total: 400 });
  });

  test('abandoned and cancelled checkouts are excluded', () => {
    const orders = mapOdooOrders(
      [
        order({ id: 1, amount_total: 100 }),
        order({ id: 2, state: 'draft', amount_total: 9999 }),
        order({ id: 3, state: 'sent', amount_total: 9999 }),
        order({ id: 4, state: 'cancel', amount_total: 9999 }),
      ],
      ventures,
    );
    const rows = revenueByVenture(orders);
    expect(rows).toHaveLength(1);
    expect(rows[0].total).toBe(100);
    expect(rows[0].orders).toBe(1);
  });

  /**
   * The .com store and the .co.uk store do not bill in the same currency, and
   * adding 100 USD to 100 GBP produces a number that is true of nothing. Rows
   * are per (venture, currency) so a display can show both instead of lying.
   */
  test('currencies are never summed together', () => {
    const orders = mapOdooOrders(
      [
        order({ id: 1, amount_total: 100, currency_id: [1, 'USD'] }),
        order({ id: 2, amount_total: 200, currency_id: [2, 'GBP'], website_id: [2, 'DMS Industrial'] }),
        order({ id: 3, amount_total: 50, currency_id: [2, 'GBP'] }),
      ],
      ventures,
    );
    const rows = revenueByVenture(orders);
    expect(rows).toHaveLength(3);
    const dms = rows.filter((r) => r.venture === 'desktop-machine-shop');
    expect(dms.map((r) => `${r.currency}:${r.total}`).sort()).toEqual(['GBP:50', 'USD:100']);
  });

  test('unattributed orders are reported under a null venture, never silently dropped', () => {
    const orders = mapOdooOrders([order({ id: 1, website_id: false, amount_total: 75 })], ventures);
    const rows = revenueByVenture(orders);
    expect(rows).toHaveLength(1);
    expect(rows[0].venture).toBeNull();
    expect(rows[0].total).toBe(75);
  });

  test('an order with no currency is still counted, under a null currency', () => {
    const orders = mapOdooOrders([order({ id: 1, currency_id: false, amount_total: 10 })], ventures);
    expect(revenueByVenture(orders)[0]).toMatchObject({ currency: null, total: 10, orders: 1 });
  });

  test('rows come back biggest-first so a display needs no sort of its own', () => {
    const orders = mapOdooOrders(
      [
        order({ id: 1, amount_total: 10 }),
        order({ id: 2, amount_total: 500, website_id: [2, 'DMS Industrial'] }),
      ],
      ventures,
    );
    expect(revenueByVenture(orders).map((r) => r.total)).toEqual([500, 10]);
  });

  test('floating-point cents do not leak into a total', () => {
    const orders = mapOdooOrders(
      [order({ id: 1, amount_total: 0.1 }), order({ id: 2, amount_total: 0.2 })],
      ventures,
    );
    expect(revenueByVenture(orders)[0].total).toBe(0.3);
  });
});
