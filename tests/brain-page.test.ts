import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/**
 * /brain layout contract (Dave, 2026-07-12): the capture box is ONE
 * compact untitled part riding the right of the G-BRAIN header — text or
 * dropped documents — and the knowledge graph sits directly under the title.
 */
describe('/brain header capture + graph placement', () => {
  test('the compact dump rides the header right slot; no standalone dump section', () => {
    const page = read('app/brain/page.tsx');
    expect(page).toMatch(/right=\{<BrainDump compact \/>\}/);
    expect(page).not.toMatch(/<section[^>]*>\s*<BrainDump \/>/);
  });

  test('the graph is the only thing under the header, and it fills the viewport', () => {
    const page = read('app/brain/page.tsx');
    const header = page.indexOf('<PageHeader');
    const graph = page.indexOf('<BrainGraphView');
    expect(graph).toBeGreaterThan(header);
    // no boxed section wrapper any more: the canvas IS the page
    expect(page).not.toContain('<section');
    expect(page).toContain('fill');
    expect(page).toMatch(/h-\[calc\(100dvh/);
  });

  test('BrainDump has a compact mode with document drop that reads files as text', () => {
    const dump = read('components/BrainDump.tsx');
    expect(dump).toMatch(/compact/);
    expect(dump).toMatch(/onDrop/);
    expect(dump).toMatch(/\.text\(\)/);
    // dropped docs keep their filename as the note title
    expect(dump).toMatch(/name\.replace/);
  });
});
