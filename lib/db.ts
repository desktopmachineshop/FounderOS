import { openDriver, parsePrimaryKeys, type SqlDriver, type SqlValue } from '@/lib/sql';
import {
  MediaJobSchema,
  STALE_CLAIM_MS,
  type MediaJob,
  type MediaJobKind,
  type MediaJobStatus,
} from '@/lib/media-jobs';
import { isValidCron } from '@/lib/cron';
import {
  AgentCronSchema,
  AgentMessageSchema,
  AgentRunSchema,
  AgentSchema,
  AgentTaskSchema,
  BroadcastReplySchema,
  BroadcastSchema,
  ContactTagSchema,
  DepartmentSchema,
  DomainSchema,
  MetricSchema,
  PersonaSchema,
  PhaseSchema,
  RoadmapItemSchema,
  SocialAccountSchema,
  SocialSnapshotSchema,
  EmailListSnapshotSchema,
  SocialDmSchema,
  SocialDmSnapshotSchema,
  SocialDmMessageSchema,
  SocialPostSchema,
  FunnelContactSchema,
  FunnelTouchSchema,
  FunnelJourneySchema,
  PersonSchema,
  LeadMagnetSchema,
  type LeadMagnet,
  SopTaskSchema,
  WorkflowSchema,
  SkillSchema,
  ToolSchema,
  type Agent,
  type AgentCron,
  type AgentMessage,
  type AgentRun,
  type AgentTask,
  type Broadcast,
  type BroadcastReply,
  type ContactTag,
  type Department,
  type Domain,
  type Metric,
  type Persona,
  type Phase,
  type RoadmapItem,
  type SocialAccount,
  type SocialPlatform,
  type SocialSnapshot,
  type EmailListSnapshot,
  type SocialDm,
  type SocialDmSnapshot,
  type SocialDmMessage,
  type SocialPost,
  type FunnelContact,
  type FunnelTouch,
  type FunnelJourney,
  type FunnelVenture,
  type Person,
  type SopTask,
  type Workflow,
  type Skill,
  type Tool,
} from '@/lib/schemas';

const DDL = `
CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  tagline TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL,
  "order" INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  department_id TEXT NOT NULL REFERENCES departments(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  tier TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  tools TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS tools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL,
  color TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS roadmap_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  quarter TEXT NOT NULL,
  status TEXT NOT NULL,
  department_id TEXT,
  description TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS metrics (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  delta REAL NOT NULL DEFAULT 0,
  period TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS domains (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  color TEXT NOT NULL,
  items TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS personas (
  id TEXT PRIMARY KEY,
  ord INTEGER NOT NULL,
  name TEXT NOT NULL,
  archetype TEXT NOT NULL,
  tagline TEXT NOT NULL,
  summary TEXT NOT NULL,
  accent TEXT NOT NULL,
  north_star TEXT NOT NULL,
  pillars TEXT NOT NULL DEFAULT '[]',
  connectors TEXT NOT NULL DEFAULT '[]',
  metrics TEXT NOT NULL DEFAULT '[]',
  brain_use TEXT NOT NULL,
  signature_play TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS phases (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  items TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  ok INTEGER NOT NULL,
  summary TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS agent_messages (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  tool_calls TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS broadcasts (
  id TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_tasks (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_crons (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  schedule TEXT NOT NULL,
  description TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contact_tags (
  person TEXT NOT NULL,
  channel TEXT NOT NULL,
  tag TEXT NOT NULL,
  tier INTEGER NOT NULL,
  PRIMARY KEY (person, channel)
);
CREATE TABLE IF NOT EXISTS social_accounts (
  platform TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  url TEXT,
  "order" INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS social_snapshots (
  platform TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  followers INTEGER NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (platform, captured_at)
);
CREATE TABLE IF NOT EXISTS broadcast_replies (
  id TEXT PRIMARY KEY,
  broadcast_id TEXT NOT NULL REFERENCES broadcasts(id),
  agent_id TEXT NOT NULL,
  ok INTEGER NOT NULL,
  reply TEXT NOT NULL DEFAULT '',
  finished_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS email_list_snapshots (
  captured_at TEXT PRIMARY KEY,
  subscribers INTEGER NOT NULL,
  source TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS social_dms (
  platform TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS social_dm_snapshots (
  platform TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  count INTEGER NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (platform, captured_at)
);
CREATE TABLE IF NOT EXISTS social_dm_messages (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  subscriber_id TEXT NOT NULL,
  name TEXT NOT NULL,
  handle TEXT,
  text TEXT NOT NULL,
  direction TEXT NOT NULL,
  tag TEXT,
  ts TEXT NOT NULL,
  source TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_social_dm_messages_ts ON social_dm_messages (ts);
CREATE TABLE IF NOT EXISTS social_posts (
  id TEXT PRIMARY KEY,
  caption TEXT NOT NULL,
  media_url TEXT,
  platforms TEXT NOT NULL,
  status TEXT NOT NULL,
  scheduled_for TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  department_id TEXT NOT NULL REFERENCES departments(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  tools TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS lead_magnets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  offer TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  status TEXT NOT NULL,
  captures TEXT NOT NULL,
  destination TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  launched_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT 'seed'
);
CREATE TABLE IF NOT EXISTS sop_tasks (
  id TEXT PRIMARY KEY,
  department_id TEXT NOT NULL REFERENCES departments(id),
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  steps TEXT NOT NULL DEFAULT '[]',
  assignee_kind TEXT NOT NULL,
  assignee_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS funnel_contacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  venture TEXT NOT NULL,
  status TEXT NOT NULL,
  product TEXT,
  amount_usd REAL,
  relationship TEXT NOT NULL DEFAULT 'warm',
  likelihood INTEGER NOT NULL DEFAULT 50,
  email TEXT,
  phone TEXT,
  person TEXT,
  company TEXT,
  role TEXT,
  linkedin TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS funnel_touches (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES funnel_contacts(id),
  seq INTEGER NOT NULL,
  stage TEXT NOT NULL,
  channel TEXT NOT NULL,
  label TEXT NOT NULL,
  source TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  revenue_usd INTEGER NOT NULL DEFAULT 0,
  ord INTEGER NOT NULL DEFAULT 0,
  steps TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_agent_id TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  tools TEXT NOT NULL DEFAULT '[]',
  markdown TEXT NOT NULL DEFAULT '',
  ord INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS media_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  spec TEXT NOT NULL,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  requested_by TEXT NOT NULL DEFAULT 'operator',
  worker_id TEXT,
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  claimed_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_media_jobs_queue ON media_jobs (status, priority, created_at);
`;

/** Databases created before the hierarchy build lack these columns. */
async function migrateAgentsTable(db: SqlDriver): Promise<void> {
  const columns = await db.columns('agents');
  if (!columns.has('parent_id')) await db.exec('ALTER TABLE agents ADD COLUMN parent_id TEXT');
  if (!columns.has('instance')) await db.exec("ALTER TABLE agents ADD COLUMN instance TEXT NOT NULL DEFAULT 'builtin'");
}

/** Databases created before the funnel-space build lack these columns. */
async function migrateFunnelContactsTable(db: SqlDriver): Promise<void> {
  const columns = await db.columns('funnel_contacts');
  if (!columns.has('relationship')) await db.exec("ALTER TABLE funnel_contacts ADD COLUMN relationship TEXT NOT NULL DEFAULT 'warm'");
  if (!columns.has('likelihood')) await db.exec('ALTER TABLE funnel_contacts ADD COLUMN likelihood INTEGER NOT NULL DEFAULT 50');
  if (!columns.has('email')) await db.exec('ALTER TABLE funnel_contacts ADD COLUMN email TEXT');
  if (!columns.has('phone')) await db.exec('ALTER TABLE funnel_contacts ADD COLUMN phone TEXT');
  // dossier identity (Round 15) — the human behind the deal
  for (const col of ['person', 'company', 'role', 'linkedin']) {
    if (!columns.has(col)) await db.exec(`ALTER TABLE funnel_contacts ADD COLUMN ${col} TEXT`);
  }
}

// Skills gained a `markdown` (SKILL.md) column after first ship. Add it, and
// clear the stale rows so the re-seed backfills each skill's doc.
async function migrateSkillsTable(db: SqlDriver): Promise<void> {
  const columns = await db.columns('skills');
  if (columns.size > 0 && !columns.has('markdown')) {
    await db.exec("ALTER TABLE skills ADD COLUMN markdown TEXT NOT NULL DEFAULT ''");
    await db.exec('DELETE FROM skills');
  }
}

type AgentRow = {
  id: string;
  department_id: string;
  name: string;
  role: string;
  status: string;
  tier: string;
  description: string;
  model: string;
  tools: string;
  parent_id: string | null;
  instance: string;
};

function rowToAgent(row: AgentRow): Agent {
  return AgentSchema.parse({
    id: row.id,
    departmentId: row.department_id,
    name: row.name,
    role: row.role,
    status: row.status,
    tier: row.tier,
    description: row.description,
    model: row.model,
    tools: JSON.parse(row.tools),
    parentId: row.parent_id,
    instance: row.instance,
  });
}

/** lead_magnets gained `origin` when the operator started creating them from the
 *  OS; older databases predate the column. */
async function migrateLeadMagnetsTable(db: SqlDriver): Promise<void> {
  const columns = await db.columns('lead_magnets');
  if (!columns.has('origin')) await db.exec("ALTER TABLE lead_magnets ADD COLUMN origin TEXT NOT NULL DEFAULT 'seed'");
}

/**
 * Primary keys, read off the DDL above. The Postgres driver needs them to turn
 * `INSERT OR REPLACE` into an upsert; deriving them here means the schema stays
 * the single source of truth.
 */
export const PRIMARY_KEYS = parsePrimaryKeys(DDL);

export { DDL };

/**
 * Open the store and bring the schema up to date.
 *
 * `target` is either a SQLite path (a file, or `:memory:`) or a `postgres://`
 * URL. The repository methods below are identical either way — that is what
 * lets the workstation and the always-on cloud instance share one system of
 * record.
 */
export async function openDb(target: string) {
  const db = openDriver(target, PRIMARY_KEYS);
  await db.exec(DDL);
  await migrateAgentsTable(db);
  await migrateLeadMagnetsTable(db);
  await migrateFunnelContactsTable(db);
  await migrateSkillsTable(db);

  const departments = {
    async all(): Promise<Department[]> {
      const rows = await db.all('SELECT * FROM departments ORDER BY "order"');
      return rows.map((r) => DepartmentSchema.parse(r));
    },
    async insert(d: Department): Promise<void> {
      await db.run(
        'INSERT OR REPLACE INTO departments (id, name, slug, tagline, color, "order") VALUES (?, ?, ?, ?, ?, ?)',
        [d.id, d.name, d.slug, d.tagline, d.color, d.order],
      );
    },
    async deleteWhereIdNotIn(ids: string[]): Promise<void> {
      const placeholders = ids.map(() => '?').join(', ');
      await db.run(`DELETE FROM departments WHERE id NOT IN (${placeholders})`, ids);
    },
  };

  const agents = {
    async all(): Promise<Agent[]> {
      const rows = await db.all<AgentRow>('SELECT * FROM agents ORDER BY tier, name');
      return rows.map(rowToAgent);
    },
    async byDepartment(departmentId: string): Promise<Agent[]> {
      const rows = await db.all<AgentRow>(
        'SELECT * FROM agents WHERE department_id = ? ORDER BY tier, name',
        [departmentId],
      );
      return rows.map(rowToAgent);
    },
    async insert(a: Agent): Promise<void> {
      await db.run(
        'INSERT OR REPLACE INTO agents (id, department_id, name, role, status, tier, description, model, tools, parent_id, instance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          a.id, a.departmentId, a.name, a.role, a.status, a.tier, a.description, a.model,
          JSON.stringify(a.tools), a.parentId, a.instance,
        ],
      );
    },
    async deleteWhereIdNotIn(ids: string[]): Promise<void> {
      const placeholders = ids.map(() => '?').join(', ');
      await db.run(`DELETE FROM agents WHERE id NOT IN (${placeholders})`, ids);
    },
  };

  const tools = {
    async all(): Promise<Tool[]> {
      const rows = await db.all('SELECT * FROM tools ORDER BY category, name');
      return rows.map((r) => ToolSchema.parse(r));
    },
    async insert(t: Tool): Promise<void> {
      await db.run(
        'INSERT OR REPLACE INTO tools (id, name, category, status, color, description) VALUES (?, ?, ?, ?, ?, ?)',
        [t.id, t.name, t.category, t.status, t.color, t.description],
      );
    },
  };

  const roadmap = {
    async all(): Promise<RoadmapItem[]> {
      const rows = await db.all<any>('SELECT * FROM roadmap_items ORDER BY quarter, title');
      return rows.map((r) =>
        RoadmapItemSchema.parse({
          id: r.id,
          title: r.title,
          quarter: r.quarter,
          status: r.status,
          departmentId: r.department_id,
          description: r.description,
        }),
      );
    },
    async insert(item: RoadmapItem): Promise<void> {
      await db.run(
        'INSERT OR REPLACE INTO roadmap_items (id, title, quarter, status, department_id, description) VALUES (?, ?, ?, ?, ?, ?)',
        [item.id, item.title, item.quarter, item.status, item.departmentId, item.description],
      );
    },
  };

  const metrics = {
    async all(): Promise<Metric[]> {
      const rows = await db.all('SELECT * FROM metrics ORDER BY label');
      return rows.map((r) => MetricSchema.parse(r));
    },
    async insert(m: Metric): Promise<void> {
      await db.run(
        'INSERT OR REPLACE INTO metrics (id, key, label, value, unit, delta, period) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [m.id, m.key, m.label, m.value, m.unit, m.delta, m.period],
      );
    },
  };

  const domains = {
    async all(): Promise<Domain[]> {
      const rows = await db.all<any>('SELECT * FROM domains ORDER BY number');
      return rows.map((r) => DomainSchema.parse({ ...r, items: JSON.parse(r.items) }));
    },
    async insert(d: Domain): Promise<void> {
      await db.run('INSERT OR REPLACE INTO domains (id, number, title, color, items) VALUES (?, ?, ?, ?, ?)', [
        d.id,
        d.number,
        d.title,
        d.color,
        JSON.stringify(d.items),
      ]);
    },
  };

  const personas = {
    async all(): Promise<Persona[]> {
      const rows = await db.all<any>('SELECT * FROM personas ORDER BY ord');
      return rows.map((r) =>
        PersonaSchema.parse({
          id: r.id,
          order: r.ord,
          name: r.name,
          archetype: r.archetype,
          tagline: r.tagline,
          summary: r.summary,
          accent: r.accent,
          northStar: r.north_star,
          pillars: JSON.parse(r.pillars),
          connectors: JSON.parse(r.connectors),
          metrics: JSON.parse(r.metrics),
          brainUse: r.brain_use,
          signaturePlay: r.signature_play,
        }),
      );
    },
    async insert(p: Persona): Promise<void> {
      await db.run(
        `INSERT OR REPLACE INTO personas
          (id, ord, name, archetype, tagline, summary, accent, north_star, pillars, connectors, metrics, brain_use, signature_play)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          p.id,
          p.order,
          p.name,
          p.archetype,
          p.tagline,
          p.summary,
          p.accent,
          p.northStar,
          JSON.stringify(p.pillars),
          JSON.stringify(p.connectors),
          JSON.stringify(p.metrics),
          p.brainUse,
          p.signaturePlay,
        ],
      );
    },
  };

  const phases = {
    async all(): Promise<Phase[]> {
      const rows = await db.all<any>('SELECT * FROM phases ORDER BY number');
      return rows.map((r) => PhaseSchema.parse({ ...r, items: JSON.parse(r.items) }));
    },
    async insert(p: Phase): Promise<void> {
      await db.run('INSERT OR REPLACE INTO phases (id, number, title, items) VALUES (?, ?, ?, ?)', [
        p.id,
        p.number,
        p.title,
        JSON.stringify(p.items),
      ]);
    },
  };

  const rowToRun = (r: any): AgentRun =>
    AgentRunSchema.parse({
      id: r.id,
      agentId: r.agent_id,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      ok: Boolean(r.ok),
      summary: r.summary,
    });

  const agentRuns = {
    async byAgent(agentId: string): Promise<AgentRun[]> {
      const rows = await db.all('SELECT * FROM agent_runs WHERE agent_id = ? ORDER BY started_at DESC', [
        agentId,
      ]);
      return rows.map(rowToRun);
    },
    async recent(limit: number): Promise<AgentRun[]> {
      const rows = await db.all('SELECT * FROM agent_runs ORDER BY started_at DESC, rowid DESC LIMIT ?', [
        limit,
      ]);
      return rows.map(rowToRun);
    },
    async insert(run: AgentRun): Promise<void> {
      await db.run(
        'INSERT OR REPLACE INTO agent_runs (id, agent_id, started_at, finished_at, ok, summary) VALUES (?, ?, ?, ?, ?, ?)',
        [run.id, run.agentId, run.startedAt, run.finishedAt, run.ok ? 1 : 0, run.summary],
      );
    },
  };

  const rowToMessage = (r: any): AgentMessage =>
    AgentMessageSchema.parse({
      id: r.id,
      agentId: r.agent_id,
      role: r.role,
      content: r.content,
      toolCalls: JSON.parse(r.tool_calls || '[]'),
      createdAt: r.created_at,
    });

  const agentMessages = {
    async insert(m: AgentMessage): Promise<void> {
      const parsed = AgentMessageSchema.parse(m);
      await db.run(
        'INSERT OR REPLACE INTO agent_messages (id, agent_id, role, content, tool_calls, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [parsed.id, parsed.agentId, parsed.role, parsed.content, JSON.stringify(parsed.toolCalls), parsed.createdAt],
      );
    },
    /** Full conversation for one agent, oldest → newest (ready to replay). */
    async byAgent(agentId: string): Promise<AgentMessage[]> {
      const rows = await db.all(
        'SELECT * FROM agent_messages WHERE agent_id = ? ORDER BY created_at ASC, rowid ASC',
        [agentId],
      );
      return rows.map(rowToMessage);
    },
    async recent(limit: number): Promise<AgentMessage[]> {
      const rows = await db.all('SELECT * FROM agent_messages ORDER BY created_at DESC, rowid DESC LIMIT ?', [
        limit,
      ]);
      return rows.map(rowToMessage);
    },
  };

  const rowToReply = (r: any): BroadcastReply =>
    BroadcastReplySchema.parse({
      id: r.id,
      broadcastId: r.broadcast_id,
      agentId: r.agent_id,
      ok: Boolean(r.ok),
      reply: r.reply,
      finishedAt: r.finished_at,
    });

  const broadcasts = {
    async insert(b: { id: string; message: string; createdAt: string }): Promise<void> {
      await db.run('INSERT OR REPLACE INTO broadcasts (id, message, created_at) VALUES (?, ?, ?)', [
        b.id, b.message, b.createdAt,
      ]);
    },
    async insertReply(r: BroadcastReply): Promise<void> {
      await db.run(
        'INSERT OR REPLACE INTO broadcast_replies (id, broadcast_id, agent_id, ok, reply, finished_at) VALUES (?, ?, ?, ?, ?, ?)',
        [r.id, r.broadcastId, r.agentId, r.ok ? 1 : 0, r.reply, r.finishedAt],
      );
    },
    async recent(limit: number): Promise<Broadcast[]> {
      const rows = await db.all<{ id: string; message: string; created_at: string }>(
        'SELECT * FROM broadcasts ORDER BY created_at DESC, rowid DESC LIMIT ?',
        [limit],
      );
      return Promise.all(
        rows.map(async (b) => {
          const replies = await db.all(
            'SELECT * FROM broadcast_replies WHERE broadcast_id = ? ORDER BY agent_id',
            [b.id],
          );
          return BroadcastSchema.parse({
            id: b.id,
            message: b.message,
            createdAt: b.created_at,
            replies: replies.map(rowToReply),
          });
        }),
      );
    },
  };

  const rowToTask = (r: any): AgentTask =>
    AgentTaskSchema.parse({
      id: r.id, agentId: r.agent_id, title: r.title, status: r.status,
      createdAt: r.created_at, updatedAt: r.updated_at,
    });

  const agentTasks = {
    async insert(t: AgentTask): Promise<void> {
      AgentTaskSchema.parse(t);
      await db.run(
        'INSERT OR REPLACE INTO agent_tasks (id, agent_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [t.id, t.agentId, t.title, t.status, t.createdAt, t.updatedAt],
      );
    },
    async byAgent(agentId: string): Promise<AgentTask[]> {
      const rows = await db.all(
        'SELECT * FROM agent_tasks WHERE agent_id = ? ORDER BY created_at DESC, rowid DESC',
        [agentId],
      );
      return rows.map(rowToTask);
    },
    async all(): Promise<AgentTask[]> {
      const rows = await db.all('SELECT * FROM agent_tasks ORDER BY created_at DESC, rowid DESC');
      return rows.map(rowToTask);
    },
    async setStatus(id: string, status: AgentTask['status'], updatedAt: string): Promise<void> {
      AgentTaskSchema.shape.status.parse(status);
      await db.run('UPDATE agent_tasks SET status = ?, updated_at = ? WHERE id = ?', [status, updatedAt, id]);
    },
    async remove(id: string): Promise<void> {
      await db.run('DELETE FROM agent_tasks WHERE id = ?', [id]);
    },
  };

  const rowToCron = (r: any): AgentCron =>
    AgentCronSchema.parse({
      id: r.id, agentId: r.agent_id, schedule: r.schedule, description: r.description,
      enabled: Boolean(r.enabled), createdAt: r.created_at,
    });

  const agentCrons = {
    async insert(c: AgentCron): Promise<void> {
      AgentCronSchema.parse(c);
      if (!isValidCron(c.schedule)) throw new Error(`invalid cron schedule: ${c.schedule}`);
      await db.run(
        'INSERT OR REPLACE INTO agent_crons (id, agent_id, schedule, description, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [c.id, c.agentId, c.schedule, c.description, c.enabled ? 1 : 0, c.createdAt],
      );
    },
    async byAgent(agentId: string): Promise<AgentCron[]> {
      const rows = await db.all(
        'SELECT * FROM agent_crons WHERE agent_id = ? ORDER BY created_at DESC, rowid DESC',
        [agentId],
      );
      return rows.map(rowToCron);
    },
    async all(): Promise<AgentCron[]> {
      const rows = await db.all('SELECT * FROM agent_crons ORDER BY created_at DESC, rowid DESC');
      return rows.map(rowToCron);
    },
    async setEnabled(id: string, enabled: boolean): Promise<void> {
      await db.run('UPDATE agent_crons SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
    },
    async remove(id: string): Promise<void> {
      await db.run('DELETE FROM agent_crons WHERE id = ?', [id]);
    },
  };

  const contactTags = {
    async upsert(t: ContactTag): Promise<void> {
      ContactTagSchema.parse(t);
      await db.run(
        'INSERT INTO contact_tags (person, channel, tag, tier) VALUES (?, ?, ?, ?) ON CONFLICT(person, channel) DO UPDATE SET tag = excluded.tag, tier = excluded.tier',
        [t.person, t.channel, t.tag, t.tier],
      );
    },
    async all(): Promise<ContactTag[]> {
      const rows = await db.all('SELECT * FROM contact_tags ORDER BY tier, person');
      return rows.map((r) => ContactTagSchema.parse(r));
    },
    async byTier(tier: number): Promise<ContactTag[]> {
      const rows = await db.all('SELECT * FROM contact_tags WHERE tier = ? ORDER BY person', [tier]);
      return rows.map((r) => ContactTagSchema.parse(r));
    },
    async remove(person: string, channel: string): Promise<void> {
      await db.run('DELETE FROM contact_tags WHERE person = ? AND channel = ?', [person, channel]);
    },
  };

  const rowToSnapshot = (r: any): SocialSnapshot =>
    SocialSnapshotSchema.parse({
      platform: r.platform,
      capturedAt: r.captured_at,
      followers: r.followers,
      source: r.source,
    });

  const social = {
    async upsertAccount(a: SocialAccount): Promise<void> {
      SocialAccountSchema.parse(a);
      await db.run(
        'INSERT OR REPLACE INTO social_accounts (platform, handle, url, "order") VALUES (?, ?, ?, ?)',
        [a.platform, a.handle, a.url, a.order],
      );
    },
    async accounts(): Promise<SocialAccount[]> {
      const rows = await db.all('SELECT * FROM social_accounts ORDER BY "order"');
      return rows.map((r) => SocialAccountSchema.parse(r));
    },
    async insertSnapshot(s: SocialSnapshot): Promise<void> {
      SocialSnapshotSchema.parse(s);
      await db.run(
        'INSERT OR REPLACE INTO social_snapshots (platform, captured_at, followers, source) VALUES (?, ?, ?, ?)',
        [s.platform, s.capturedAt, s.followers, s.source],
      );
    },
    async snapshots(platform: SocialPlatform): Promise<SocialSnapshot[]> {
      const rows = await db.all('SELECT * FROM social_snapshots WHERE platform = ? ORDER BY captured_at', [
        platform,
      ]);
      return rows.map(rowToSnapshot);
    },
    async latest(): Promise<SocialSnapshot[]> {
      const rows = await db.all(
        `SELECT * FROM social_snapshots s
           WHERE captured_at = (SELECT MAX(captured_at) FROM social_snapshots WHERE platform = s.platform)
           ORDER BY platform`,
      );
      return rows.map(rowToSnapshot);
    },
    async upsertDm(d: SocialDm): Promise<void> {
      SocialDmSchema.parse(d);
      await db.run('INSERT OR REPLACE INTO social_dms (platform, count, updated_at) VALUES (?, ?, ?)', [
        d.platform, d.count, d.updatedAt,
      ]);
    },
    async dms(): Promise<SocialDm[]> {
      const rows = await db.all(
        `SELECT d.platform, d.count, d.updated_at AS "updatedAt" FROM social_dms d
           LEFT JOIN social_accounts a ON a.platform = d.platform
           ORDER BY a."order"`,
      );
      return rows.map((r) => SocialDmSchema.parse(r));
    },
    async insertDmSnapshot(s: SocialDmSnapshot): Promise<void> {
      SocialDmSnapshotSchema.parse(s);
      await db.run(
        'INSERT OR REPLACE INTO social_dm_snapshots (platform, captured_at, count, source) VALUES (?, ?, ?, ?)',
        [s.platform, s.capturedAt, s.count, s.source],
      );
    },
    async dmSnapshots(platform?: SocialPlatform): Promise<SocialDmSnapshot[]> {
      const rows = platform
        ? await db.all(
            'SELECT platform, captured_at AS "capturedAt", count, source FROM social_dm_snapshots WHERE platform = ? ORDER BY captured_at',
            [platform],
          )
        : await db.all(
            'SELECT platform, captured_at AS "capturedAt", count, source FROM social_dm_snapshots ORDER BY platform, captured_at',
          );
      return rows.map((r) => SocialDmSnapshotSchema.parse(r));
    },
    // Individual DM messages (the inbox). Fed live by POST /api/webhooks/manychat;
    // seeded until then. Upsert by id so replayed webhooks don't duplicate.
    async upsertDmMessage(m: SocialDmMessage): Promise<void> {
      SocialDmMessageSchema.parse(m);
      await db.run(
        `INSERT OR REPLACE INTO social_dm_messages
           (id, platform, subscriber_id, name, handle, text, direction, tag, ts, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [m.id, m.platform, m.subscriberId, m.name, m.handle, m.text, m.direction, m.tag, m.ts, m.source],
      );
    },
    async dmMessages(platform?: SocialPlatform): Promise<SocialDmMessage[]> {
      const cols =
        'id, platform, subscriber_id AS "subscriberId", name, handle, text, direction, tag, ts, source';
      const rows = platform
        ? await db.all(`SELECT ${cols} FROM social_dm_messages WHERE platform = ? ORDER BY ts DESC`, [platform])
        : await db.all(`SELECT ${cols} FROM social_dm_messages ORDER BY ts DESC`);
      return rows.map((r) => SocialDmMessageSchema.parse(r));
    },
  };

  const emailList = {
    async insertSnapshot(s: EmailListSnapshot): Promise<void> {
      EmailListSnapshotSchema.parse(s);
      await db.run(
        'INSERT OR REPLACE INTO email_list_snapshots (captured_at, subscribers, source) VALUES (?, ?, ?)',
        [s.capturedAt, s.subscribers, s.source],
      );
    },
    // Drop seed-sourced rows so a re-seed is authoritative — the real Beehiiv
    // baseline replaces any retired dummy history. Live-synced snapshots
    // (source 'beehiiv') are preserved.
    async deleteSeeded(): Promise<void> {
      await db.run("DELETE FROM email_list_snapshots WHERE source LIKE 'seed%'");
    },
    async snapshots(): Promise<EmailListSnapshot[]> {
      const rows = await db.all(
        'SELECT captured_at AS "capturedAt", subscribers, source FROM email_list_snapshots ORDER BY captured_at',
      );
      return rows.map((r) => EmailListSnapshotSchema.parse(r));
    },
    async latest(): Promise<EmailListSnapshot | null> {
      const row = await db.get(
        'SELECT captured_at AS "capturedAt", subscribers, source FROM email_list_snapshots ORDER BY captured_at DESC LIMIT 1',
      );
      return row ? EmailListSnapshotSchema.parse(row) : null;
    },
  };

  const rowToPost = (r: {
    id: string;
    caption: string;
    media_url: string | null;
    platforms: string;
    status: string;
    scheduled_for: string | null;
    created_at: string;
  }): SocialPost =>
    SocialPostSchema.parse({
      id: r.id,
      caption: r.caption,
      mediaUrl: r.media_url,
      platforms: JSON.parse(r.platforms),
      status: r.status,
      scheduledFor: r.scheduled_for,
      createdAt: r.created_at,
    });

  const socialPosts = {
    async enqueue(p: SocialPost): Promise<void> {
      SocialPostSchema.parse(p);
      await db.run(
        `INSERT OR REPLACE INTO social_posts (id, caption, media_url, platforms, status, scheduled_for, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [p.id, p.caption, p.mediaUrl, JSON.stringify(p.platforms), p.status, p.scheduledFor, p.createdAt],
      );
    },
    async all(): Promise<SocialPost[]> {
      const rows = await db.all('SELECT * FROM social_posts ORDER BY created_at DESC');
      return rows.map((r) => rowToPost(r as Parameters<typeof rowToPost>[0]));
    },
    async queued(): Promise<SocialPost[]> {
      const rows = await db.all("SELECT * FROM social_posts WHERE status = 'queued' ORDER BY created_at DESC");
      return rows.map((r) => rowToPost(r as Parameters<typeof rowToPost>[0]));
    },
  };

  const people = {
    async all(): Promise<Person[]> {
      const rows = await db.all<any>('SELECT * FROM people ORDER BY department_id, name');
      return rows.map((r) =>
        PersonSchema.parse({
          id: r.id,
          departmentId: r.department_id,
          name: r.name,
          role: r.role,
          tools: JSON.parse(r.tools),
        }),
      );
    },
    async insert(p: Person): Promise<void> {
      PersonSchema.parse(p);
      await db.run('INSERT OR REPLACE INTO people (id, department_id, name, role, tools) VALUES (?, ?, ?, ?, ?)', [
        p.id, p.departmentId, p.name, p.role, JSON.stringify(p.tools),
      ]);
    },
    async deleteWhereIdNotIn(ids: string[]): Promise<void> {
      const placeholders = ids.map(() => '?').join(', ');
      await db.run(`DELETE FROM people WHERE id NOT IN (${placeholders})`, ids);
    },
  };

  const leadMagnets = {
    async all(): Promise<LeadMagnet[]> {
      const rows = await db.all<any>('SELECT * FROM lead_magnets ORDER BY launched_at DESC, name');
      return rows.map((r) =>
        LeadMagnetSchema.parse({
          id: r.id,
          name: r.name,
          offer: r.offer,
          url: r.url,
          status: r.status,
          captures: r.captures,
          destination: r.destination,
          source: r.source,
          launchedAt: r.launched_at,
          notes: r.notes,
          origin: r.origin ?? 'seed',
        }),
      );
    },
    async insert(m: LeadMagnet): Promise<void> {
      LeadMagnetSchema.parse(m);
      await db.run(
        'INSERT OR REPLACE INTO lead_magnets (id, name, offer, url, status, captures, destination, source, launched_at, notes, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [m.id, m.name, m.offer, m.url, m.status, m.captures, m.destination, m.source, m.launchedAt, m.notes, m.origin ?? 'seed'],
      );
    },
    async byId(id: string): Promise<LeadMagnet | null> {
      const r = (await db.get('SELECT * FROM lead_magnets WHERE id = ?', [id])) as any;
      if (!r) return null;
      return LeadMagnetSchema.parse({
        id: r.id, name: r.name, offer: r.offer, url: r.url, status: r.status,
        captures: r.captures, destination: r.destination, source: r.source,
        launchedAt: r.launched_at, notes: r.notes, origin: r.origin ?? 'seed',
      });
    },
    /** Delete one row by id. Returns false when it was not there, so the API
     *  can 404 instead of pretending. */
    async remove(id: string): Promise<boolean> {
      const { changes } = await db.run('DELETE FROM lead_magnets WHERE id = ?', [id]);
      return changes > 0;
    },
    /** Prune retired SEED rows only. Anything created from the OS is the operator's
     *  and is never deleted by a re-seed. */
    async deleteWhereIdNotIn(ids: string[]): Promise<void> {
      const placeholders = ids.map(() => '?').join(', ');
      await db.run(`DELETE FROM lead_magnets WHERE origin = 'seed' AND id NOT IN (${placeholders})`, ids);
    },
  };

  const sopTasks = {
    async all(): Promise<SopTask[]> {
      const rows = await db.all<any>('SELECT * FROM sop_tasks ORDER BY department_id, title');
      return rows.map((r) =>
        SopTaskSchema.parse({
          id: r.id,
          departmentId: r.department_id,
          title: r.title,
          summary: r.summary,
          steps: JSON.parse(r.steps),
          assigneeKind: r.assignee_kind,
          assigneeId: r.assignee_id,
        }),
      );
    },
    async insert(t: SopTask): Promise<void> {
      SopTaskSchema.parse(t);
      await db.run(
        'INSERT OR REPLACE INTO sop_tasks (id, department_id, title, summary, steps, assignee_kind, assignee_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [t.id, t.departmentId, t.title, t.summary, JSON.stringify(t.steps), t.assigneeKind, t.assigneeId],
      );
    },
    async deleteWhereIdNotIn(ids: string[]): Promise<void> {
      const placeholders = ids.map(() => '?').join(', ');
      await db.run(`DELETE FROM sop_tasks WHERE id NOT IN (${placeholders})`, ids);
    },
  };

  const workflows = {
    async all(): Promise<Workflow[]> {
      const rows = await db.all<any>('SELECT * FROM workflows ORDER BY ord, name');
      return rows.map((r) =>
        WorkflowSchema.parse({
          id: r.id,
          name: r.name,
          subtitle: r.subtitle,
          revenueUsd: r.revenue_usd,
          order: r.ord,
          steps: JSON.parse(r.steps),
        }),
      );
    },
    async insert(w: Workflow): Promise<void> {
      WorkflowSchema.parse(w);
      await db.run(
        'INSERT OR REPLACE INTO workflows (id, name, subtitle, revenue_usd, ord, steps) VALUES (?, ?, ?, ?, ?, ?)',
        [w.id, w.name, w.subtitle, w.revenueUsd, w.order, JSON.stringify(w.steps)],
      );
    },
    async deleteWhereIdNotIn(ids: string[]): Promise<void> {
      const placeholders = ids.map(() => '?').join(', ');
      await db.run(`DELETE FROM workflows WHERE id NOT IN (${placeholders})`, ids);
    },
  };

  const skills = {
    async all(): Promise<Skill[]> {
      const rows = await db.all<any>('SELECT * FROM skills ORDER BY ord, name');
      return rows.map((r) =>
        SkillSchema.parse({
          id: r.id,
          name: r.name,
          category: r.category,
          description: r.description,
          ownerAgentId: r.owner_agent_id,
          status: r.status,
          tools: JSON.parse(r.tools),
          markdown: r.markdown,
          order: r.ord,
        }),
      );
    },
    async insert(s: Skill): Promise<void> {
      SkillSchema.parse(s);
      await db.run(
        'INSERT OR REPLACE INTO skills (id, name, category, description, owner_agent_id, status, tools, markdown, ord) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [s.id, s.name, s.category, s.description, s.ownerAgentId, s.status, JSON.stringify(s.tools), s.markdown, s.order],
      );
    },
    async deleteWhereIdNotIn(ids: string[]): Promise<void> {
      const placeholders = ids.map(() => '?').join(', ');
      await db.run(`DELETE FROM skills WHERE id NOT IN (${placeholders})`, ids);
    },
  };

  const rowToFunnelTouch = (r: any): FunnelTouch =>
    FunnelTouchSchema.parse({
      id: r.id,
      contactId: r.contact_id,
      seq: r.seq,
      stage: r.stage,
      channel: r.channel,
      label: r.label,
      source: r.source,
      at: r.at,
    });

  const funnel = {
    async insertContact(c: FunnelContact): Promise<void> {
      FunnelContactSchema.parse(c);
      await db.run(
        'INSERT OR REPLACE INTO funnel_contacts (id, name, venture, status, product, amount_usd, relationship, likelihood, email, phone, person, company, role, linkedin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [c.id, c.name, c.venture, c.status, c.product, c.amountUsd, c.relationship, c.likelihood, c.email, c.phone, c.person, c.company, c.role, c.linkedin, c.createdAt],
      );
    },
    async insertTouch(t: FunnelTouch): Promise<void> {
      FunnelTouchSchema.parse(t);
      await db.run(
        'INSERT OR REPLACE INTO funnel_touches (id, contact_id, seq, stage, channel, label, source, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [t.id, t.contactId, t.seq, t.stage, t.channel, t.label, t.source, t.at],
      );
    },
    /** Contacts with their touches in journey order, newest contact first. */
    async journeys(venture?: FunnelVenture): Promise<FunnelJourney[]> {
      const rows = (venture
        ? await db.all('SELECT * FROM funnel_contacts WHERE venture = ? ORDER BY created_at DESC, id', [venture])
        : await db.all('SELECT * FROM funnel_contacts ORDER BY created_at DESC, id')) as any[];
      return Promise.all(
        rows.map(async (r) => {
          const touches = await db.all('SELECT * FROM funnel_touches WHERE contact_id = ? ORDER BY seq', [r.id]);
          return FunnelJourneySchema.parse({
            id: r.id,
            name: r.name,
            venture: r.venture,
            status: r.status,
            product: r.product,
            amountUsd: r.amount_usd,
            relationship: r.relationship,
            likelihood: r.likelihood,
            email: r.email,
            phone: r.phone,
            person: r.person,
            company: r.company,
            role: r.role,
            linkedin: r.linkedin,
            createdAt: r.created_at,
            touches: touches.map(rowToFunnelTouch),
          });
        }),
      );
    },
  };

  const rowToMediaJob = (r: any): MediaJob =>
    MediaJobSchema.parse({
      id: r.id,
      spec: JSON.parse(r.spec),
      status: r.status,
      priority: r.priority,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      requestedBy: r.requested_by,
      workerId: r.worker_id,
      result: r.result ? JSON.parse(r.result) : null,
      error: r.error,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      claimedAt: r.claimed_at,
      finishedAt: r.finished_at,
    });

  /**
   * The cloud/workstation work queue. Both halves reach it through the same
   * repository because they share one database — that is the whole mechanism
   * behind dispatched video work.
   */
  const mediaJobs = {
    async enqueue(job: MediaJob): Promise<void> {
      const j = MediaJobSchema.parse(job);
      await db.run(
        `INSERT OR REPLACE INTO media_jobs
           (id, kind, spec, status, priority, attempts, max_attempts, requested_by, worker_id, result, error, created_at, updated_at, claimed_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          j.id, j.spec.kind, JSON.stringify(j.spec), j.status, j.priority, j.attempts,
          j.maxAttempts, j.requestedBy, j.workerId, j.result ? JSON.stringify(j.result) : null,
          j.error, j.createdAt, j.updatedAt, j.claimedAt, j.finishedAt,
        ],
      );
    },

    async byId(id: string): Promise<MediaJob | null> {
      const row = await db.get('SELECT * FROM media_jobs WHERE id = ?', [id]);
      return row ? rowToMediaJob(row) : null;
    },

    async list(opts: { status?: MediaJobStatus; limit?: number } = {}): Promise<MediaJob[]> {
      const limit = opts.limit ?? 100;
      const rows = opts.status
        ? await db.all(
            'SELECT * FROM media_jobs WHERE status = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
            [opts.status, limit],
          )
        : await db.all('SELECT * FROM media_jobs ORDER BY created_at DESC, rowid DESC LIMIT ?', [limit]);
      return rows.map(rowToMediaJob);
    },

    /**
     * Take the next job this worker can run.
     *
     * Read-then-conditional-update rather than `FOR UPDATE SKIP LOCKED`, which
     * SQLite has no answer for. The UPDATE is atomic on both backends and only
     * matches while the row is still queued, so two workers racing for the same
     * job produce one winner and one retry — no job runs twice.
     */
    async claim(opts: {
      workerId: string;
      kinds?: MediaJobKind[];
      now?: string;
    }): Promise<MediaJob | null> {
      const at = opts.now ?? new Date().toISOString();
      const kindFilter = opts.kinds?.length
        ? ` AND kind IN (${opts.kinds.map(() => '?').join(', ')})`
        : '';
      const params: SqlValue[] = ['queued', ...(opts.kinds ?? [])];

      // Bounded: each miss means another worker won that row, so the queue is
      // draining, not looping.
      for (let i = 0; i < 5; i += 1) {
        const row = await db.get(
          `SELECT id FROM media_jobs WHERE status = ?${kindFilter}
           ORDER BY priority DESC, created_at ASC, rowid ASC LIMIT 1`,
          params,
        );
        if (!row) return null;
        const id = (row as { id: string }).id;
        const { changes } = await db.run(
          `UPDATE media_jobs SET status = 'claimed', worker_id = ?, claimed_at = ?, updated_at = ?
           WHERE id = ? AND status = 'queued'`,
          [opts.workerId, at, at, id],
        );
        if (changes === 1) return mediaJobs.byId(id);
      }
      return null;
    },

    /** Worker finished. False when the job was not claimed (or never existed). */
    async complete(id: string, result: Record<string, unknown>, now?: string): Promise<boolean> {
      const at = now ?? new Date().toISOString();
      const { changes } = await db.run(
        `UPDATE media_jobs SET status = 'done', result = ?, error = NULL, updated_at = ?, finished_at = ?
         WHERE id = ? AND status = 'claimed'`,
        [JSON.stringify(result), at, at, id],
      );
      return changes === 1;
    },

    /** Worker failed. Requeues until maxAttempts is spent, then gives up. */
    async fail(id: string, error: string, now?: string): Promise<boolean> {
      const at = now ?? new Date().toISOString();
      const job = await mediaJobs.byId(id);
      if (!job) return false;
      const attempts = job.attempts + 1;
      const spent = attempts >= job.maxAttempts;
      await db.run(
        `UPDATE media_jobs SET status = ?, attempts = ?, error = ?, worker_id = NULL,
           claimed_at = NULL, updated_at = ?, finished_at = ? WHERE id = ?`,
        [spent ? 'failed' : 'queued', attempts, error, at, spent ? at : null, id],
      );
      return true;
    },

    /**
     * Release claims from workers that went away. Without this a laptop that
     * slept mid-render strands the job forever.
     */
    async requeueStale(opts: { now?: string; staleAfterMs?: number } = {}): Promise<number> {
      const at = opts.now ?? new Date().toISOString();
      const cutoff = new Date(Date.parse(at) - (opts.staleAfterMs ?? STALE_CLAIM_MS)).toISOString();
      const { changes } = await db.run(
        `UPDATE media_jobs SET status = 'queued', worker_id = NULL, claimed_at = NULL, updated_at = ?
         WHERE status = 'claimed' AND claimed_at < ?`,
        [at, cutoff],
      );
      return changes;
    },
  };

  return {
    /** The dialect actually in use, so the UI can be honest about where it is. */
    dialect: db.dialect,
    departments,
    agents,
    tools,
    roadmap,
    metrics,
    domains,
    personas,
    phases,
    agentRuns,
    agentMessages,
    agentTasks,
    agentCrons,
    broadcasts,
    contactTags,
    social,
    emailList,
    socialPosts,
    funnel,
    people,
    leadMagnets,
    sopTasks,
    workflows,
    skills,
    mediaJobs,
    close: () => db.close(),
  };
}

export type FounderDb = Awaited<ReturnType<typeof openDb>>;
