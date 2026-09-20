/**
 * Dave's four businesses — the venture lens over the OS.
 *
 * One database, one G-Brain, one agent roster: ventures never partition the
 * data. They are saved filters — each one names the agents that serve it per
 * life area, the brain tag that marks its pages, and the current executive
 * focus. Switching venture in the hierarchy or life map swaps which crew
 * lights up; the agents themselves keep full visibility of everything.
 *
 * Three of the four sit on one shared Odoo instance as separate sites
 * (desktopmachineshop.com, desktopmachineshop.co.uk, 3dpandme.com); OpenV runs
 * independently. That split matters when connectors land: one Odoo credential
 * serves three ventures, and OpenV needs its own.
 */
import type { LifeArea } from '@/lib/life-map';
import { LIFE_AREAS } from '@/lib/life-map';

export type Venture = {
  id: string;
  label: string;
  kind: string;
  color: string;
  detail: string;
  /** Public site for this venture. */
  url: string;
  /** Tag that marks this venture's pages inside the single shared G-Brain. */
  brainTag: string;
  /** Current executive priorities — edit freely, this is Dave's list. */
  focus: string[];
  /** life-area id → the agents working that area FOR this venture. */
  areaAgents: Record<string, string[]>;
};

const SHARED_OPS = ['conductor', 'stack-monitor'];
const SHARED_KNOWLEDGE = ['data-agent', 'markdown-auditor', 'vector-auditor'];

/**
 * Retired venture ids, mapped to whichever venture now covers that ground.
 * `funnel_contacts.venture` is validated on the way out of the database, so a
 * stored row on a retired id would throw rather than render; `lib/db.ts`
 * rewrites them on open. Keep an entry here for as long as any store might
 * still hold the old value.
 */
export const RETIRED_VENTURE_IDS: Record<string, string> = {
  vantage: 'dms-industrial',
  'launchpad-cohort': 'openv',
  'brand-deals': '3dpandme',
};

export const VENTURES: Venture[] = [
  {
    id: 'desktop-machine-shop',
    label: 'Desktop Machine Shop',
    kind: 'Odoo web store',
    color: '#ff7a1a',
    detail: 'CNC and 3D printing accessories for the hobby market.',
    url: 'https://www.desktopmachineshop.com',
    brainTag: 'dms',
    focus: [
      'Catalogue depth — the accessories hobbyists actually re-buy',
      'Organic reach: build, teardown and how-to content that sells parts',
      'Repeat purchase rate, not just first orders',
    ],
    areaAgents: {
      marketing: ['social-agent', 'postly-publisher', 'reelkit-editor', 'renderly-creative'],
      sales: ['sales-agent', 'stripe-sales', 'processor-confirmation'],
      communication: ['comms-agent', 'gmail-worker'],
      finances: ['payments-pulse', 'stripe-sales'],
      knowledge: SHARED_KNOWLEDGE,
      operations: SHARED_OPS,
    },
  },
  {
    id: 'dms-industrial',
    label: 'DMS Industrial',
    kind: 'Industrial CNC supply',
    color: '#0ea5e9',
    detail: 'Low-cost CNC goods for industrial buyers — the UK site, same Odoo instance.',
    url: 'https://www.desktopmachineshop.co.uk',
    brainTag: 'dms-industrial',
    focus: [
      'Named accounts — who reorders, and what they reorder',
      'Quote turnaround; industrial buyers go quiet if you are slow',
      'Margin per line, not headline revenue',
    ],
    areaAgents: {
      marketing: ['social-agent', 'renderly-creative'],
      sales: ['sales-agent', 'sales-calls-data', 'crm-pulse'],
      clients: ['client-roster', 'client-onboarding', 'client-success'],
      communication: ['comms-agent', 'gmail-worker', 'slack-worker'],
      finances: ['payments-pulse', 'processor-confirmation'],
      knowledge: SHARED_KNOWLEDGE,
      operations: SHARED_OPS,
    },
  },
  {
    id: '3dpandme',
    label: '3DPandMe',
    kind: 'Content & blog',
    color: '#ec4899',
    detail: '3D printing, CNC, automation and tech — the audience arm, also on Odoo.',
    url: 'https://www.3dpandme.com',
    brainTag: '3dpandme',
    focus: [
      'Publishing cadence — the thing that compounds',
      'Feed the two stores: content that answers a buying question',
      'Owned audience over rented reach',
    ],
    areaAgents: {
      marketing: [
        'social-agent',
        'postly-publisher',
        'reelkit-editor',
        'renderly-creative',
        'adsmith-creative',
      ],
      communication: ['comms-agent', 'gmail-worker'],
      finances: ['payments-pulse'],
      knowledge: [...SHARED_KNOWLEDGE, 'notion-sync'],
      operations: SHARED_OPS,
    },
  },
  {
    id: 'openv',
    label: 'OpenV',
    kind: 'SaaS product',
    color: '#6366f1',
    detail: 'Requirements management SaaS — runs independently of the Odoo estate.',
    url: 'https://openv.app',
    brainTag: 'openv',
    focus: [
      'Activation: does a new team get to a first real requirement set?',
      'Retention and expansion inside existing accounts',
      'Roadmap driven by what users actually hit, not what is asked for',
    ],
    areaAgents: {
      marketing: ['social-agent', 'postly-publisher', 'reelkit-editor'],
      sales: ['sales-agent', 'sales-calls-data', 'crm-pulse'],
      clients: ['client-roster', 'client-onboarding', 'client-success'],
      communication: ['comms-agent', 'gmail-worker', 'slack-worker'],
      finances: ['payments-pulse', 'stripe-sales'],
      knowledge: SHARED_KNOWLEDGE,
      operations: SHARED_OPS,
    },
  },
];

export function getVenture(id: string): Venture | null {
  return VENTURES.find((v) => v.id === id) ?? null;
}

/** Every agent serving a venture, across all its life areas. */
export function ventureAgentSet(ventureId: string): Set<string> {
  const v = getVenture(ventureId);
  return new Set(v ? Object.values(v.areaAgents).flat() : []);
}

/** Which ventures an agent works for (shared infra agents serve all). */
export function venturesForAgent(agentId: string): Venture[] {
  return VENTURES.filter((v) => ventureAgentSet(v.id).has(agentId));
}

/** Agents on one life area for one venture (the click-through from the map). */
export function ventureAreaAgents(ventureId: string, areaId: string): string[] {
  return getVenture(ventureId)?.areaAgents[areaId] ?? [];
}

export function lifeAreaById(areaId: string): LifeArea | null {
  return LIFE_AREAS.find((a) => a.id === areaId) ?? null;
}
