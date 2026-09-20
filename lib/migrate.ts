import type { FounderDb } from '@/lib/db';

/**
 * Copy a whole store into another one.
 *
 * Used to move an existing workstation SQLite database into the managed
 * Postgres that both hosts then share. It goes through the repository layer
 * rather than dumping SQL, which means every row is Zod-validated on the way
 * out and re-validated on the way in — a migration that would have carried
 * bad data fails loudly instead of landing it in the new system of record.
 *
 * Every write is an upsert by primary key, so running it twice is safe and a
 * half-finished run can simply be repeated.
 */

export type MigrationCounts = Record<string, number>;

/**
 * Insert order is load-bearing. SQLite does not enforce foreign keys unless
 * asked; Postgres always does. Parents must land before children or the
 * migration fails on the first agent, person, SOP, broadcast reply or funnel
 * touch.
 */
export async function migrateStore(
  from: FounderDb,
  to: FounderDb,
  onProgress?: (table: string, rows: number) => void,
): Promise<MigrationCounts> {
  const counts: MigrationCounts = {};
  const step = async (table: string, run: () => Promise<number>) => {
    const n = await run();
    counts[table] = n;
    onProgress?.(table, n);
  };

  // ── Parents first ───────────────────────────────────────────────────────
  await step('departments', async () => {
    const rows = await from.departments.all();
    for (const r of rows) await to.departments.insert(r);
    return rows.length;
  });

  await step('agents', async () => {
    const rows = await from.agents.all();
    for (const r of rows) await to.agents.insert(r);
    return rows.length;
  });

  await step('people', async () => {
    const rows = await from.people.all();
    for (const r of rows) await to.people.insert(r);
    return rows.length;
  });

  await step('tools', async () => {
    const rows = await from.tools.all();
    for (const r of rows) await to.tools.insert(r);
    return rows.length;
  });

  await step('sopTasks', async () => {
    const rows = await from.sopTasks.all();
    for (const r of rows) await to.sopTasks.insert(r);
    return rows.length;
  });

  // ── Reference data ──────────────────────────────────────────────────────
  await step('roadmap', async () => {
    const rows = await from.roadmap.all();
    for (const r of rows) await to.roadmap.insert(r);
    return rows.length;
  });

  await step('metrics', async () => {
    const rows = await from.metrics.all();
    for (const r of rows) await to.metrics.insert(r);
    return rows.length;
  });

  await step('domains', async () => {
    const rows = await from.domains.all();
    for (const r of rows) await to.domains.insert(r);
    return rows.length;
  });

  await step('personas', async () => {
    const rows = await from.personas.all();
    for (const r of rows) await to.personas.insert(r);
    return rows.length;
  });

  await step('phases', async () => {
    const rows = await from.phases.all();
    for (const r of rows) await to.phases.insert(r);
    return rows.length;
  });

  await step('workflows', async () => {
    const rows = await from.workflows.all();
    for (const r of rows) await to.workflows.insert(r);
    return rows.length;
  });

  await step('skills', async () => {
    const rows = await from.skills.all();
    for (const r of rows) await to.skills.insert(r);
    return rows.length;
  });

  await step('leadMagnets', async () => {
    const rows = await from.leadMagnets.all();
    for (const r of rows) await to.leadMagnets.insert(r);
    return rows.length;
  });

  // ── The operator's own history — the part that actually matters ─────────
  await step('agentRuns', async () => {
    // `recent` is the only unbounded read; the ceiling is deliberately high
    // because this history is the thing worth keeping.
    const rows = await from.agentRuns.recent(1_000_000);
    for (const r of rows) await to.agentRuns.insert(r);
    return rows.length;
  });

  await step('agentMessages', async () => {
    const rows = await from.agentMessages.recent(1_000_000);
    for (const r of rows) await to.agentMessages.insert(r);
    return rows.length;
  });

  await step('agentTasks', async () => {
    const rows = await from.agentTasks.all();
    for (const r of rows) await to.agentTasks.insert(r);
    return rows.length;
  });

  await step('agentCrons', async () => {
    const rows = await from.agentCrons.all();
    for (const r of rows) await to.agentCrons.insert(r);
    return rows.length;
  });

  await step('broadcasts', async () => {
    const rows = await from.broadcasts.recent(1_000_000);
    for (const b of rows) {
      await to.broadcasts.insert({ id: b.id, message: b.message, createdAt: b.createdAt });
      // Replies reference their broadcast, so they follow it.
      for (const reply of b.replies) await to.broadcasts.insertReply(reply);
    }
    return rows.length;
  });

  await step('contactTags', async () => {
    const rows = await from.contactTags.all();
    for (const r of rows) await to.contactTags.upsert(r);
    return rows.length;
  });

  // ── Social ──────────────────────────────────────────────────────────────
  await step('socialAccounts', async () => {
    const rows = await from.social.accounts();
    for (const r of rows) await to.social.upsertAccount(r);
    return rows.length;
  });

  await step('socialSnapshots', async () => {
    let n = 0;
    for (const account of await from.social.accounts()) {
      for (const s of await from.social.snapshots(account.platform)) {
        await to.social.insertSnapshot(s);
        n += 1;
      }
    }
    return n;
  });

  await step('socialDms', async () => {
    const rows = await from.social.dms();
    for (const r of rows) await to.social.upsertDm(r);
    return rows.length;
  });

  await step('dmSnapshots', async () => {
    const rows = await from.social.dmSnapshots();
    for (const r of rows) await to.social.insertDmSnapshot(r);
    return rows.length;
  });

  await step('dmMessages', async () => {
    const rows = await from.social.dmMessages();
    for (const r of rows) await to.social.upsertDmMessage(r);
    return rows.length;
  });

  await step('emailSnapshots', async () => {
    const rows = await from.emailList.snapshots();
    for (const r of rows) await to.emailList.insertSnapshot(r);
    return rows.length;
  });

  await step('socialPosts', async () => {
    const rows = await from.socialPosts.all();
    for (const r of rows) await to.socialPosts.enqueue(r);
    return rows.length;
  });

  // ── Funnel: contacts before their touches ───────────────────────────────
  await step('funnel', async () => {
    const journeys = await from.funnel.journeys();
    for (const j of journeys) {
      const { touches, ...contact } = j;
      await to.funnel.insertContact(contact);
      for (const touch of touches) await to.funnel.insertTouch(touch);
    }
    return journeys.length;
  });

  await step('mediaJobs', async () => {
    const rows = await from.mediaJobs.list({ limit: 1_000_000 });
    for (const r of rows) await to.mediaJobs.enqueue(r);
    return rows.length;
  });

  return counts;
}
