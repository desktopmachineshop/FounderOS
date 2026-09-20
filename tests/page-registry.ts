import { readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Every `app/**\/page.tsx`, with the props each needs to be invoked.
 *
 * Shared by the two smoke nets — one renders these against demo data, the other
 * against an EMPTY store — so a new page cannot be covered by one and missed by
 * the other. `coversEveryPage()` is what stops the list going stale.
 */
export type PageEntry = {
  file: string; // path relative to app/, the source of truth for coverage
  // props is `any` so strongly-typed page components (e.g. /org's searchParams)
  // remain assignable to this generic invoker.
  load: () => Promise<{ default: (props?: any) => unknown }>;
  props?: unknown;
};

export const PAGES: PageEntry[] = [
  { file: 'page.tsx', load: () => import('@/app/page') },
  { file: 'comms/page.tsx', load: () => import('@/app/comms/page') },
  { file: 'social/page.tsx', load: () => import('@/app/social/page') },
  {
    file: 'social/[platform]/page.tsx',
    load: () => import('@/app/social/[platform]/page'),
    props: { params: { platform: 'instagram' } },
  },
  { file: 'social/beehiiv/page.tsx', load: () => import('@/app/social/beehiiv/page') },
  { file: 'content/page.tsx', load: () => import('@/app/content/page') },
  { file: 'content/lead-magnets/page.tsx', load: () => import('@/app/content/lead-magnets/page') },
  { file: 'agents/page.tsx', load: () => import('@/app/agents/page') },
  { file: 'tasks/page.tsx', load: () => import('@/app/tasks/page') },
  { file: 'skills/page.tsx', load: () => import('@/app/skills/page') },
  { file: 'org/page.tsx', load: () => import('@/app/org/page'), props: { searchParams: {} } },
  { file: 'brain/page.tsx', load: () => import('@/app/brain/page') },
  { file: 'doctor/page.tsx', load: () => import('@/app/doctor/page') },
  { file: 'finances/page.tsx', load: () => import('@/app/finances/page') },
  { file: 'funnel/page.tsx', load: () => import('@/app/funnel/page'), props: { searchParams: {} } },
  { file: 'workflows/page.tsx', load: () => import('@/app/workflows/page') },
  { file: 'integrations/page.tsx', load: () => import('@/app/integrations/page') },
  { file: 'roadmap/page.tsx', load: () => import('@/app/roadmap/page') },
  { file: 'analytics/page.tsx', load: () => import('@/app/analytics/page') },
  { file: 'reference/page.tsx', load: () => import('@/app/reference/page') },
  { file: 'personas/page.tsx', load: () => import('@/app/personas/page') },
];

export function discoverPages(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...discoverPages(path.join(dir, entry.name), rel));
    else if (entry.name === 'page.tsx') out.push(rel);
  }
  return out;
}

/** The registry against the filesystem: no page escapes either smoke net. */
export function coversEveryPage(): { covered: string[]; discovered: string[] } {
  return {
    covered: PAGES.map((p) => p.file).sort(),
    discovered: discoverPages(path.join(process.cwd(), 'app')).sort(),
  };
}
