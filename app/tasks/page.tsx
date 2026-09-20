import { getDb } from '@/lib/data';
import { PageHeader } from '@/components/PageHeader';
import { TaskBoard } from '@/components/TaskBoard';

export const dynamic = 'force-dynamic';

export default async function TasksPage() {
  const db = (await getDb());
  const tasks = await db.agentTasks.all();
  const agentNames = Object.fromEntries((await db.agents.all()).map((a) => [a.id, a.name]));
  return (
    <div>
      <PageHeader eyebrow="agent work" title="Tasks" />
      <TaskBoard initialTasks={tasks} agentNames={agentNames} />
    </div>
  );
}
