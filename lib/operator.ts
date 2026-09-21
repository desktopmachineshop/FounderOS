/**
 * Who this instance belongs to.
 *
 * Dependency-free on purpose (like lib/demo-mode.ts): client components render
 * the name, so this must not drag anything into the browser bundle.
 *
 * It exists because the name used to be written out separately in every view
 * that showed it — /org, the life map, the knowledge graph — and a rename
 * missed one, leaving the previous operator's name under OPERATOR on the org
 * chart. Reading it from here is what stops the next rename doing the same.
 */
export const DEFAULT_OPERATOR_NAME = 'Dave';

/**
 * The operator's display name. `FOUNDER_OS_OPERATOR` overrides it, so a fork
 * of this dashboard is renamed by setting a variable rather than editing JSX.
 *
 * A blank or whitespace-only value falls back: an operator who sets the
 * variable to nothing should see the default, not an empty space where their
 * name goes on every view.
 */
export function operatorName(env: Record<string, string | undefined> = process.env): string {
  const set = env.FOUNDER_OS_OPERATOR?.trim();
  return set ? set : DEFAULT_OPERATOR_NAME;
}

/**
 * "Dave's", or "James'" for a name already ending in s — derived rather than
 * written out, so an overridden name reads correctly without a second setting.
 */
export function operatorPossessive(env: Record<string, string | undefined> = process.env): string {
  const name = operatorName(env);
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}
