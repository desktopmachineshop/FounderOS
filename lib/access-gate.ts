/**
 * Production access gate, pure logic (middleware.ts is the thin edge wrapper).
 *
 * Deployed FounderOS instances live on public URLs (Railway hands out
 * *.up.railway.app). Set FOUNDER_OS_ACCESS_TOKEN and every request must
 * present the token once (?token=… or the challenge form); a cookie remembers
 * the browser after that. Leave it unset and the gate stays open — local dev
 * and the read-only demo deployment are unaffected.
 */

export const GATE_COOKIE = 'founder_os_access';

/**
 * The one path the gate always lets through.
 *
 * A platform health check is not a browser: it carries no cookie, so the gate
 * would answer the challenge page with 401 and the platform would conclude
 * every deploy is broken. `/api/health` therefore stays open — it reports only
 * that the process is serving, and carries no business data.
 */
export const HEALTH_PATH = '/api/health';

export function isHealthRoute(pathname: string): boolean {
  return pathname === HEALTH_PATH;
}

export type GateDecision =
  | { kind: 'open' } // no token configured — gate disabled
  | { kind: 'pass' } // cookie already carries the token
  | { kind: 'set-cookie'; value: string } // correct ?token= — set cookie, clean the URL
  | { kind: 'challenge' }; // everything else — show the token form

export function gateDecision(input: {
  token: string | undefined;
  cookie: string | null;
  queryToken: string | null;
}): GateDecision {
  const token = input.token?.trim();
  if (!token) return { kind: 'open' };
  // fresh correct query token wins even over a stale cookie
  if (input.queryToken === token) return { kind: 'set-cookie', value: token };
  if (input.cookie === token) return { kind: 'pass' };
  return { kind: 'challenge' };
}

/** Self-contained challenge page: no app chrome, no data, just the form. */
export function challengePage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>FounderOS · Private</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#0a0a0a; color:#f5f5f5; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
  .card { text-align:center; padding:40px; }
  .mark { font-size:13px; font-weight:700; letter-spacing:.3em; text-transform:uppercase; }
  .mark b { color:#EF4444; }
  p { font-size:12px; color:#8a8a8a; margin:14px 0 22px; }
  input { background:#141414; border:1px solid #2a2a2a; color:#f5f5f5; padding:10px 12px;
          font:inherit; font-size:13px; width:240px; outline:none; }
  input:focus { border-color:#EF4444; }
  button { background:#EF4444; border:0; color:#fff; padding:10px 18px; font:inherit;
           font-size:12px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; cursor:pointer; }
</style>
</head>
<body>
  <div class="card">
    <div class="mark"><b>F</b>OUNDER OS</div>
    <p>This OS is private. Enter your access token.</p>
    <form method="GET" action="/">
      <input name="token" type="password" placeholder="access token" autofocus>
      <button type="submit">Unlock</button>
    </form>
  </div>
</body>
</html>`;
}
