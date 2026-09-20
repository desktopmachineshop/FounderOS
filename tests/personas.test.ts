import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { openDb, type FounderDb } from '@/lib/db';
import { seedDatabase } from '@/lib/seed';
import { PERSONAS } from '@/lib/personas-seed';
import { PersonaSchema } from '@/lib/schemas';

let db: FounderDb;
afterEach(() => db?.close());

describe('PERSONAS seed data', () => {
  test('eleven distinct personas, each valid against the schema', () => {
    expect(PERSONAS).toHaveLength(11);
    const ids = new Set(PERSONAS.map((p) => p.id));
    expect(ids.size).toBe(11);
    const names = new Set(PERSONAS.map((p) => p.name));
    expect(names.size).toBe(11);
    for (const p of PERSONAS) {
      expect(() => PersonaSchema.parse(p)).not.toThrow();
    }
  });

  test('each persona is a full template: 5 pillars (each with agents), connectors, metrics', () => {
    for (const p of PERSONAS) {
      expect(p.pillars.length).toBe(5);
      for (const pillar of p.pillars) expect(pillar.agents.length).toBeGreaterThanOrEqual(1);
      expect(p.connectors.length).toBeGreaterThanOrEqual(5);
      expect(p.metrics.length).toBeGreaterThanOrEqual(4);
      expect(p.northStar.length).toBeGreaterThan(0);
      expect(p.signaturePlay.length).toBeGreaterThan(0);
    }
  });

  test('order is sequential 1..11', () => {
    expect(PERSONAS.map((p) => p.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});

describe('personas repo', () => {
  test('seedDatabase loads all eleven personas, ordered, round-tripped through the repo', async () => {
    db = await openDb(':memory:');
    await seedDatabase(db);
    const rows = await db.personas.all();
    expect(rows).toHaveLength(11);
    expect(rows.map((p) => p.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    // JSON columns survive the round-trip
    const first = rows[0];
    expect(first.pillars.length).toBe(5);
    expect(Array.isArray(first.connectors)).toBe(true);
  });
});

/**
 * The personas view is a showcase: each persona gets the same radial G-Brain
 * constellation the real /brain renders, built from that persona's own
 * departments and agents, in a split view beside the card. The org-chart cover
 * is suppressed there because the graph is the visual.
 */
describe('personas G-Brain graph', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

  test('the viewer renders the persona brain graph in a split view', () => {
    const viewer = read('components/PersonasViewer.tsx');
    expect(viewer).toContain('PersonaBrainGraph');
    expect(viewer).toContain('lg:grid-cols-');
    // the cover org chart is off in the split view, so it is not shown twice
    expect(viewer).toContain('cover={false}');
  });

  test('the graph animates its synapses using the shared keyframes', () => {
    const graph = read('components/PersonaBrainGraph.tsx');
    expect(graph).toContain('kg-synapse');
    // the animation has to exist in the stylesheet, not just as a class name
    expect(read('app/globals.css')).toContain('@keyframes kg-synapse-flow');
  });

  test('the graph is driven purely by persona data, with no live connector calls', () => {
    const graph = read('components/PersonaBrainGraph.tsx');
    expect(graph).toContain("persona");
    expect(graph).not.toMatch(/\bfetch\(/);
  });
});
