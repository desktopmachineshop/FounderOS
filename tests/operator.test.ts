import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_OPERATOR_NAME, operatorName, operatorPossessive } from '@/lib/operator';

/**
 * Whose dashboard this is, in one place.
 *
 * It used to be in three: /org rendered a literal name, lib/life-map.ts wrote
 * its own possessive, and lib/knowledge-graph.ts a third copy. When the
 * operator was renamed, /org was missed and kept showing the previous
 * operator's name under OPERATOR for a day — on the one view whose whole job
 * is to say who runs what.
 *
 * The miss was not carelessness about that file specifically. "Alex Rivera" is
 * ALSO a seeded prospect (`ig-alex`), so a blanket rename would have corrupted
 * seed data; the literal was deliberately protected, and that protection
 * covered the operator node too. Any scheme that depends on spotting which
 * occurrences of a name are the operator's will fail the same way again.
 *
 * So the name is read from here, and the guard below keeps it that way.
 */
describe('operator identity', () => {
  const original = process.env.FOUNDER_OS_OPERATOR;
  afterEach(() => {
    if (original === undefined) delete process.env.FOUNDER_OS_OPERATOR;
    else process.env.FOUNDER_OS_OPERATOR = original;
  });

  it('defaults to the operator this instance belongs to', () => {
    delete process.env.FOUNDER_OS_OPERATOR;
    expect(operatorName()).toBe(DEFAULT_OPERATOR_NAME);
    expect(DEFAULT_OPERATOR_NAME).toBe('Dave');
  });

  it('an env var renames the operator without touching code', () => {
    process.env.FOUNDER_OS_OPERATOR = 'Morgan';
    expect(operatorName()).toBe('Morgan');
  });

  /** Blank or whitespace must not blank out the name on every view. */
  it('an empty value falls back rather than rendering nothing', () => {
    process.env.FOUNDER_OS_OPERATOR = '   ';
    expect(operatorName()).toBe(DEFAULT_OPERATOR_NAME);
  });

  it('possessive is built from the name, not written out by hand', () => {
    process.env.FOUNDER_OS_OPERATOR = 'Morgan';
    expect(operatorPossessive()).toBe("Morgan's");
  });

  /** A name already ending in s takes the bare apostrophe. */
  it('possessive handles a name ending in s', () => {
    process.env.FOUNDER_OS_OPERATOR = 'James';
    expect(operatorPossessive()).toBe("James'");
  });
});

/**
 * The regression pin. The prospect keeps her name in the seed — that row is
 * real fixture data and renaming it would be the corruption the protection
 * was guarding against. What must never come back is an operator name written
 * into a rendered view.
 */
describe('no view hardcodes an operator name', () => {
  const files = (dir: string): string[] =>
    readdirSync(join(process.cwd(), dir)).flatMap((entry) => {
      const rel = join(dir, entry);
      if (statSync(join(process.cwd(), rel)).isDirectory()) return files(rel);
      return /\.tsx?$/.test(entry) ? [rel] : [];
    });

  it('the previous operator name is gone from app/ and components/', () => {
    const offenders = [...files('app'), ...files('components')].filter((f) =>
      readFileSync(join(process.cwd(), f), 'utf8').includes('Alex Rivera'),
    );
    expect(offenders).toEqual([]);
  });

  it('the seeded prospect keeps hers — that row is fixture data', () => {
    expect(readFileSync(join(process.cwd(), 'lib/seed.ts'), 'utf8')).toContain('Alex Rivera');
  });
});
