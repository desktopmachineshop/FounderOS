/**
 * Terminal-direction primitives shared across screens.
 * Server-component friendly: no state, no handlers.
 */

export type DotState = 'ok' | 'warn' | 'err' | 'off';

const DOT_FOR: Record<string, DotState> = {
  connected: 'ok',
  active: 'ok',
  ok: 'ok',
  available: 'warn',
  warn: 'warn',
  training: 'warn',
  idle: 'warn',
  error: 'err',
  fail: 'err',
  not_configured: 'off',
  planned: 'off',
  off: 'off',
};

export function dotState(state: string): DotState {
  return DOT_FOR[state] ?? 'off';
}

export function Dot({ state, pulse = false }: { state: string; pulse?: boolean }) {
  const cls = dotState(state);
  return <span className={`dot ${cls}${pulse && cls === 'ok' ? ' pulse' : ''}`} />;
}

export type BadgeTone = 'default' | 'accent' | 'ok' | 'warn' | 'err';

const BADGE_TONE: Record<BadgeTone, string> = {
  default: 'border-os-border-strong text-os-muted',
  accent: 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-os-accent',
  ok: 'border-[color-mix(in_oklab,var(--ok)_35%,transparent)] bg-[color-mix(in_oklab,var(--ok)_9%,transparent)] text-os-ok',
  warn: 'border-[color-mix(in_oklab,var(--warn)_35%,transparent)] bg-[color-mix(in_oklab,var(--warn)_9%,transparent)] text-os-warn',
  err: 'border-[color-mix(in_oklab,var(--err)_35%,transparent)] bg-[color-mix(in_oklab,var(--err)_9%,transparent)] text-os-err',
};

export function Badge({
  tone = 'default',
  ghost = false,
  children,
}: {
  tone?: BadgeTone;
  ghost?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm-t border px-2 py-[3px] font-mono text-[9.5px] uppercase tracking-[0.14em] ${BADGE_TONE[tone]} ${
        ghost ? 'border-dashed' : ''
      }`}
    >
      {children}
    </span>
  );
}

/** Mono section label: `LABEL  count ————` */
export function Label({
  children,
  count,
  rule = false,
}: {
  children: React.ReactNode;
  count?: string | number;
  rule?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.26em] text-os-dim">
      <span className="whitespace-nowrap">{children}</span>
      {count != null && <span className="text-os-muted">{count}</span>}
      {rule && <span className="h-px flex-1 bg-os-border" />}
    </div>
  );
}

export function SectionHead({
  label,
  count,
  link,
  href,
}: {
  label: string;
  count?: string | number;
  link?: string;
  href?: string;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <div className="min-w-0 flex-1">
        <Label count={count} rule>
          {label}
        </Label>
      </div>
      {link && href && (
        <a href={href} className="shrink-0 font-mono text-[11px] text-os-dim transition-colors hover:text-os-accent">
          {link} →
        </a>
      )}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-sm-t border border-os-border-strong border-b-2 bg-os-surface px-1.5 py-0.5 font-mono text-[10px] text-os-muted">
      {children}
    </kbd>
  );
}

/** Accent sparkline with a 10%-opacity fill. */
export function Spark({ data, w = 72, h = 22 }: { data: number[]; w?: number; h?: number }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map(
    (v, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / range) * (h - 5)).toFixed(1)}`,
  );
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polygon points={`0,${h} ${pts.join(' ')} ${w},${h}`} fill="var(--accent)" opacity="0.1" />
      <polyline points={pts.join(' ')} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
    </svg>
  );
}

/**
 * The honest empty state.
 *
 * Upstream's whole trick is that seeded data makes an unwired panel look alive.
 * A blank box would be no better — it says nothing about why it is blank. This
 * says what the panel WOULD show, which source it needs, and the variable that
 * switches it on, so the dashboard doubles as the list of what is left to wire.
 *
 * It deliberately cannot imply data: no figures of its own, and never an `ok`
 * dot, which would read as "connected" on a panel that has nothing.
 */
export type NotWiredInput = {
  /** What this panel would show once wired. */
  what: string;
  /** The source it needs, in human terms. */
  needs: string;
  /** The variables that switch it on. Omit when it is not a pasted key. */
  env?: string[];
  /** The source's own honest message, when it has one (e.g. an expired key). */
  detail?: string | null;
};

export function notWiredCopy({ what, needs, env, detail }: NotWiredInput): {
  title: string;
  line: string;
  envLine: string | null;
  detail: string | null;
} {
  const source = needs.trim().replace(/\.+$/, '');
  return {
    title: what,
    line: `Needs ${source}.`,
    envLine: env && env.length > 0 ? `Set ${env.join(', ')} in .env.local.` : null,
    detail: detail && detail.trim() !== '' ? detail : null,
  };
}

export function NotWired(props: NotWiredInput) {
  const { title, line, envLine, detail } = notWiredCopy(props);
  return (
    <div className="border border-dashed border-os-border-strong px-4 py-5">
      <div className="flex items-center gap-2">
        <Dot state="off" />
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.26em] text-os-dim">
          Not wired
        </span>
      </div>
      <p className="mt-2.5 font-mono text-[12px] text-os-muted">{title}</p>
      <p className="mt-1 font-mono text-[11px] text-os-dim">{line}</p>
      {envLine && <p className="mt-1 font-mono text-[11px] text-os-dim">{envLine}</p>}
      {detail && <p className="mt-2 font-mono text-[11px] text-os-warn">{detail}</p>}
    </div>
  );
}
