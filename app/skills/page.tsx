import { getDb } from '@/lib/data';
import { PageHeader } from '@/components/PageHeader';
import { SkillsGrid, type SkillCard } from '@/components/SkillsGrid';
import { readPluginSkills, readUserSkills } from '@/lib/skills-catalog';

export const dynamic = 'force-dynamic';

const truncate = (t: string, n = 110) => (t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, '')}…` : t);

export default async function SkillsPage() {
  // All three catalogs, side by side: the real Claude Code skills read live
  // from disk — user-scope ~/.claude/skills plus every installed plugin's
  // skills (SKILL.md loads on demand via /api/skills/[slug]) — AND the
  // operator skill cards that have always lived in this section.
  const real = [...readUserSkills(), ...readPluginSkills()];
  const realCards: SkillCard[] = real.map((s) => ({
    id: s.slug,
    name: s.name,
    group: s.group,
    description: truncate(s.description),
    meta: s.path,
    filePath: s.path,
  }));

  const db = (await getDb());
  const agentNames = Object.fromEntries((await db.agents.all()).map((a) => [a.id, a.name]));
  const operatorCards: SkillCard[] = (await db.skills.all()).map((s) => ({
    id: s.id,
    name: s.name,
    group: `Operator · ${s.category}`,
    description: truncate(s.description),
    meta: s.ownerAgentId ? (agentNames[s.ownerAgentId] ?? s.ownerAgentId) : 'unassigned',
    filePath: `skills/${s.id}/SKILL.md`,
    status: s.status,
    markdown: s.markdown,
  }));

  const cards = [...realCards, ...operatorCards];
  const sourceNote =
    real.length > 0
      ? `${real.length} skills live from ~/.claude (user + plugins) + ${operatorCards.length} operator skills — open any card to read or download its SKILL.md.`
      : `${operatorCards.length} operator skills (no ~/.claude/skills on this machine) — open any card to read or download its SKILL.md.`;

  return (
    <div>
      <PageHeader eyebrow="capability library" title="Skills" />
      <SkillsGrid cards={cards} sourceNote={sourceNote} />
    </div>
  );
}
