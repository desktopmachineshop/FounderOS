import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { describe, expect, it, test } from 'vitest';
import { notWiredCopy, noEntriesCopy } from '@/components/terminal';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/**
 * The component that replaces every fabricated number.
 *
 * Upstream ships this app as a demo whose whole trick is that seeded data makes
 * empty panels look alive. The fix is not a blank box — a blank box is just as
 * uninformative — it is a panel that says what it WOULD show, what source it
 * needs, and which variable turns it on. That makes the dashboard its own
 * to-do list instead of a set of invented numbers.
 */
describe('notWiredCopy', () => {
  test('names what the panel would show and what it needs', () => {
    const copy = notWiredCopy({ what: 'Revenue by venture', needs: 'Odoo' });
    expect(copy.title).toBe('Revenue by venture');
    expect(copy.line).toBe('Needs Odoo.');
  });

  test('names every variable that switches it on', () => {
    const copy = notWiredCopy({
      what: 'Catalogue',
      needs: 'Odoo',
      env: ['ODOO_URL', 'ODOO_DB', 'ODOO_USER', 'ODOO_API_KEY'],
    });
    expect(copy.envLine).toBe('Set ODOO_URL, ODOO_DB, ODOO_USER, ODOO_API_KEY in .env.local.');
  });

  test('a single variable reads naturally', () => {
    expect(notWiredCopy({ what: 'Newsletter', needs: 'Beehiiv', env: ['BEEHIIV_API_KEY'] }).envLine).toBe(
      'Set BEEHIIV_API_KEY in .env.local.',
    );
  });

  test('no variables means no env line — some sources are not a pasted key', () => {
    expect(notWiredCopy({ what: 'Voice notes', needs: 'Wispr Flow on this machine' }).envLine).toBeNull();
    expect(notWiredCopy({ what: 'X', needs: 'Y', env: [] }).envLine).toBeNull();
  });

  test("a connector's own honest detail is carried through when there is one", () => {
    const copy = notWiredCopy({
      what: 'Catalogue',
      needs: 'Odoo',
      detail: 'Credentials set but the instance rejected the call: expired API key',
    });
    expect(copy.detail).toBe('Credentials set but the instance rejected the call: expired API key');
  });

  test('a null or absent detail stays null rather than becoming "null"', () => {
    expect(notWiredCopy({ what: 'X', needs: 'Y' }).detail).toBeNull();
    expect(notWiredCopy({ what: 'X', needs: 'Y', detail: null }).detail).toBeNull();
    expect(notWiredCopy({ what: 'X', needs: 'Y', detail: '  ' }).detail).toBeNull();
  });

  test('trailing punctuation is not doubled', () => {
    expect(notWiredCopy({ what: 'X', needs: 'Odoo.' }).line).toBe('Needs Odoo.');
  });
});

describe('the NotWired component', () => {
  const src = read('components/terminal.tsx');

  test('is exported from the shared primitives, beside Dot and Badge', () => {
    expect(src).toContain('export function NotWired');
    expect(src).toContain('notWiredCopy');
  });

  /**
   * The point of the component is that it cannot imply data. A dot state of
   * `ok` would read as "connected" on a panel that has nothing.
   */
  test('never renders an ok/connected state', () => {
    const block = src.slice(src.indexOf('export function NotWired'));
    expect(block).not.toMatch(/state="ok"|state="connected"/);
    expect(block).toMatch(/state="off"|state="not_configured"/);
  });

  test('carries no sample figures of its own', () => {
    const block = src.slice(src.indexOf('export function NotWired'));
    // any bare multi-digit literal in the JSX would be a fabricated number
    expect(block).not.toMatch(/>\s*[£$€]?\d{2,}/);
  });
});

/**
 * Two different facts, two different sentences.
 *
 * "Needs a source" and "nothing written yet" must not read identically.
 * /roadmap and /reference are the operator's to author — telling him they need
 * an integration would send him looking for a connector that does not exist,
 * which is its own species of dishonesty.
 */
describe('noEntriesCopy', () => {
  it('says the thing is unwritten, not unwired', () => {
    const copy = noEntriesCopy({ what: 'Roadmap entries' });
    expect(copy.title).toBe('Roadmap entries');
    expect(copy.line).toBe('Nothing here yet.');
    expect(copy.line).not.toMatch(/needs|source|connect/i);
  });

  it('carries the hint about how entries arrive, when there is one', () => {
    expect(noEntriesCopy({ what: 'Tasks', hint: 'Add one from the board above.' }).hint).toBe(
      'Add one from the board above.',
    );
    expect(noEntriesCopy({ what: 'Tasks' }).hint).toBeNull();
    expect(noEntriesCopy({ what: 'Tasks', hint: '  ' }).hint).toBeNull();
  });

  it('never names an env var — that would make it read as an integration', () => {
    const copy = noEntriesCopy({ what: 'Reference domains', hint: 'Add your own.' });
    expect(JSON.stringify(copy)).not.toMatch(/_KEY|\.env/);
  });
});

describe('the empty states are actually used', () => {
  /**
   * The whole point of NotWired was that it replaces blank boxes. It sat
   * exported and unreferenced by any page — the comment in lib/data.ts claimed
   * "every view renders its NotWired state" while nothing imported it.
   */
  it('NotWired has real call sites, not just a test', () => {
    const hits = execSync(
      "grep -rl 'NotWired' app/ components/ || true",
      { cwd: process.cwd(), encoding: 'utf8' },
    )
      .split('\n')
      .filter((l: string) => l.trim() !== '' && !l.includes('components/terminal.tsx'));
    expect(hits.length).toBeGreaterThan(0);
  });
});
