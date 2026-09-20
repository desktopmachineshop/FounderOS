import { describe, expect, test } from 'vitest';
import { LIFE_AREAS } from '@/lib/life-map';
import {
  VENTURES,
  RETIRED_VENTURE_IDS,
  ventureAgentSet,
  venturesForAgent,
  getVenture,
} from '@/lib/ventures';
import { FunnelVentureSchema } from '@/lib/schemas';

import { realAgents } from '@/lib/agents/real';

const KNOWN_AGENTS = new Set(realAgents.map((a) => a.id));

describe('VENTURES', () => {
  test('the four businesses, each with a distinct colour and brain tag', () => {
    expect(VENTURES.map((v) => v.id)).toEqual([
      'desktop-machine-shop',
      'dms-industrial',
      '3dpandme',
      'openv',
    ]);
    expect(new Set(VENTURES.map((v) => v.color)).size).toBe(4);
    expect(new Set(VENTURES.map((v) => v.brainTag)).size).toBe(4);
    for (const v of VENTURES) {
      expect(v.focus.length).toBeGreaterThan(0); // executive task list
      expect(v.detail.length).toBeGreaterThan(0);
    }
  });

  test('each venture carries its public site', () => {
    const byId = new Map(VENTURES.map((v) => [v.id, v]));
    expect(byId.get('desktop-machine-shop')?.url).toBe('https://www.desktopmachineshop.com');
    expect(byId.get('dms-industrial')?.url).toBe('https://www.desktopmachineshop.co.uk');
    expect(byId.get('3dpandme')?.url).toBe('https://www.3dpandme.com');
    expect(byId.get('openv')?.url).toBe('https://openv.app');
    for (const v of VENTURES) expect(v.url).toMatch(/^https:\/\//);
  });

  /**
   * The venture lens and the database enum are two sources for one list. They
   * drift silently — a venture the funnel cannot store is worse than useless —
   * so they are checked against each other.
   */
  test('every venture is a value funnel_contacts can actually store', () => {
    for (const v of VENTURES) {
      expect(FunnelVentureSchema.safeParse(v.id).success, `${v.id} not in the enum`).toBe(true);
    }
    expect(FunnelVentureSchema.options.length).toBe(VENTURES.length);
  });

  test('the example businesses are retired, and each maps somewhere real', () => {
    for (const retired of ['vantage', 'launchpad-cohort']) {
      expect(getVenture(retired)).toBeNull();
      expect(RETIRED_VENTURE_IDS[retired]).toBeTruthy();
      expect(getVenture(RETIRED_VENTURE_IDS[retired])).not.toBeNull();
    }
  });

  test('venture colors do not collide with life-area colors', () => {
    const areaColors = new Set(LIFE_AREAS.map((a) => a.color));
    for (const v of VENTURES) expect(areaColors.has(v.color)).toBe(false);
  });

  test('every areaAgents key is a real life area; every agent id is real', () => {
    const areaIds = new Set(LIFE_AREAS.map((a) => a.id));
    for (const v of VENTURES) {
      for (const [areaId, agents] of Object.entries(v.areaAgents)) {
        expect(areaIds.has(areaId), `unknown area ${areaId} in ${v.id}`).toBe(true);
        for (const id of agents) {
          expect(KNOWN_AGENTS.has(id), `unknown agent ${id} in ${v.id}/${areaId}`).toBe(true);
        }
      }
    }
  });

  test('every venture staffs marketing, communication, and finances at minimum', () => {
    for (const v of VENTURES) {
      for (const required of ['marketing', 'communication', 'finances']) {
        expect(
          (v.areaAgents[required] ?? []).length,
          `${v.id} has no agents on ${required}`,
        ).toBeGreaterThan(0);
      }
    }
  });
});

describe('lookups', () => {
  test('getVenture resolves by id and returns null for unknowns', () => {
    expect(getVenture('openv')?.label).toBe('OpenV');
    expect(getVenture('desktop-machine-shop')?.label).toBe('Desktop Machine Shop');
    expect(getVenture('nope')).toBeNull();
  });

  test('ventureAgentSet unions all areas for a venture', () => {
    const set = ventureAgentSet('dms-industrial');
    const industrial = getVenture('dms-industrial')!;
    for (const agents of Object.values(industrial.areaAgents)) {
      for (const id of agents) expect(set.has(id)).toBe(true);
    }
  });

  test('shared infrastructure agents serve every business', () => {
    for (const shared of ['conductor', 'stack-monitor', 'data-agent']) {
      expect(venturesForAgent(shared).map((v) => v.id)).toEqual(VENTURES.map((v) => v.id));
    }
  });

  test('the two account-led businesses staff the clients area; the store and blog do not', () => {
    for (const id of ['dms-industrial', 'openv']) {
      expect(getVenture(id)!.areaAgents.clients?.length ?? 0).toBeGreaterThan(0);
    }
    for (const id of ['desktop-machine-shop', '3dpandme']) {
      expect(getVenture(id)!.areaAgents.clients ?? []).toEqual([]);
    }
  });
});
