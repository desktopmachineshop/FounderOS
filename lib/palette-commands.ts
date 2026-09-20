import type { FounderDb } from '@/lib/db';
import type { Command } from '@/lib/palette';

/**
 * The command palette's dynamic entries: one per agent, one per tool.
 *
 * This is called from the root layout, which puts it in an unusual position —
 * it runs for *every* page, including the statically prerendered `/_not-found`
 * at build time. Two consequences shape the code:
 *
 *  - At build time there is no database. On Railway `DATABASE_URL` points at
 *    the private network (`postgres.railway.internal`), which does not resolve
 *    from the build container, so the read fails with ENOTFOUND and takes the
 *    whole `next build` down with it.
 *  - At runtime, a throw in the root layout is not a broken palette — it is a
 *    500 on every route in the app.
 *
 * So a failure here degrades to the static navigation commands instead of
 * propagating. That is not papering over a broken database: the pages
 * themselves still read it and still report honestly when it is down. It is
 * only saying that a navigation shortcut list is not worth the whole site.
 */
export async function buildPaletteCommands(
  staticCommands: Command[],
  source: FounderDb | (() => Promise<FounderDb>),
): Promise<Command[]> {
  try {
    const db = typeof source === 'function' ? await source() : source;
    const [agentRows, toolRows] = await Promise.all([db.agents.all(), db.tools.all()]);

    const agents: Command[] = agentRows.map((a) => ({
      id: `agent-${a.id}`,
      label: a.name,
      keywords: `${a.role} ${a.description}`,
      href: '/agents',
      hint: 'agent',
    }));
    const tools: Command[] = toolRows.map((t) => ({
      id: `tool-${t.id}`,
      label: t.name,
      keywords: `${t.category} ${t.description}`,
      href: '/integrations',
      hint: 'tool',
    }));
    return [...staticCommands, ...agents, ...tools];
  } catch {
    return staticCommands;
  }
}
