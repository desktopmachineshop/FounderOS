import { afterEach, describe, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb, type FounderDb } from '@/lib/db';
import { seedDatabase } from '@/lib/seed';
import { buildBrainDocs, writeBrainDocs, GENERATED_MARKER } from '@/lib/brain-docs';

let db: FounderDb;

afterEach(async () => {
  await db?.close();
});

async function seeded(): Promise<FounderDb> {
  db = await openDb(':memory:');
  await seedDatabase(db);
  return db;
}

async function docsFor(d: FounderDb) {
  return buildBrainDocs({
    departments: await d.departments.all(),
    agents: await d.agents.all(),
    people: await d.people.all(),
    tasks: await d.sopTasks.all(),
    tools: await d.tools.all(),
  });
}

describe('buildBrainDocs', () => {
  test('one doc per agent, sop, tool, person and pillar', async () => {
    const d = await seeded();
    const docs = await docsFor(d);
    const paths = new Set(docs.map((x) => x.path));
    expect(docs.filter((x) => x.path.startsWith('agents/')).length).toBe((await d.agents.all()).length);
    expect(docs.filter((x) => x.path.startsWith('sops/')).length).toBe((await d.sopTasks.all()).length);
    expect(docs.filter((x) => x.path.startsWith('tools/')).length).toBe((await d.tools.all()).length);
    expect(docs.filter((x) => x.path.startsWith('people/')).length).toBe((await d.people.all()).length);
    expect(docs.filter((x) => x.path.startsWith('org/pillar-')).length).toBe((await d.departments.all()).length);
    expect(paths.has('agents/gmail-worker.md')).toBe(true);
    expect(paths.has('sops/sop-gmail-worker.md')).toBe(true);
    expect(paths.has('tools/imap.md')).toBe(true);
    expect(paths.has('people/person-marco.md')).toBe(true);
    expect(paths.has('org/pillar-clients.md')).toBe(true);
  });

  test('every doc carries the generated marker in frontmatter', async () => {
    const docs = await docsFor(await seeded());
    for (const doc of docs) expect(doc.content).toContain(GENERATED_MARKER);
  });

  test('an agent doc holds its charter, SOP instructions and wikilinked tools', async () => {
    const docs = await docsFor(await seeded());
    const gmail = docs.find((x) => x.path === 'agents/gmail-worker.md')!.content;
    expect(gmail).toContain('IMAP Inboxes');
    expect(gmail).toContain('Triage the four Gmail inboxes');
    expect(gmail).toContain('Classify each thread');
    expect(gmail).toContain('[[imap]]');
    expect(gmail).toContain('[[comms-agent]]'); // reports to
    expect(gmail).toContain('[[pillar-communications]]');
  });

  test('a SOP doc is built out: purpose, owner, trigger, steps, done, escalation', async () => {
    const docs = await docsFor(await seeded());
    const sop = docs.find((x) => x.path === 'sops/sop-client-onboarding.md')!.content;
    for (const section of ['## Purpose', '## Owner', '## Trigger', '## Steps', '## Definition of done', '## Escalation']) {
      expect(sop, `missing ${section}`).toContain(section);
    }
    expect(sop).toContain('closed-won');
    expect(sop).toContain('[[client-onboarding]]');
  });

  test('a tool doc lists who uses it, wikilinked', async () => {
    const docs = await docsFor(await seeded());
    const ledger = docs.find((x) => x.path === 'tools/ledger.md')!.content;
    expect(ledger).toContain('[[sales-agent]]');
    expect(ledger).toContain('[[person-marco]]');
  });

  test('a pillar doc rosters its workers and SOPs', async () => {
    const docs = await docsFor(await seeded());
    const clients = docs.find((x) => x.path === 'org/pillar-clients.md')!.content;
    expect(clients).toContain('[[client-roster]]');
    expect(clients).toContain('[[person-rae]]');
    expect(clients).toContain('[[sop-client-onboarding]]');
  });

  test('deterministic output', async () => {
    const d = await seeded();
    expect(await docsFor(d)).toEqual(await docsFor(d));
  });
});

describe('writeBrainDocs', () => {
  test('writes files, is idempotent, and never clobbers a non-generated file', async () => {
    const d = await seeded();
    const docs = await docsFor(d);
    const dir = mkdtempSync(path.join(tmpdir(), 'brain-docs-'));
    const first = writeBrainDocs(docs, dir);
    expect(first.written).toBeGreaterThan(0);
    expect(existsSync(path.join(dir, 'agents', 'gmail-worker.md'))).toBe(true);

    // hand-edited (non-generated) file must be left alone
    const handmade = path.join(dir, 'agents', 'gmail-worker.md');
    writeFileSync(handmade, '# my own notes, no marker');
    const second = writeBrainDocs(docs, dir);
    expect(readFileSync(handmade, 'utf8')).toBe('# my own notes, no marker');
    expect(second.skipped).toBeGreaterThan(0);

    // everything else regenerated cleanly
    expect(readdirSync(path.join(dir, 'sops')).length).toBe((await d.sopTasks.all()).length);
  });
});
