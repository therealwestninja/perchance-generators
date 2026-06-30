#!/usr/bin/env node
'use strict';
/*
 * Perchance platform uptime monitor — minimal external down-time detector.
 *
 * Pings the four backends that matter: the site, text generation, image
 * generation, and the superFetch proxy. It does NOT generate anything — it
 * hits the cheapest path on each host that (a) reaches the real origin and
 * (b) is not behind Cloudflare's bot challenge, so it works from a plain
 * datacenter server. Per-host status codes differ (404 vs 400 vs 200),
 * proving these are origin answers, not edge responses.
 *
 * Down-time signal:
 *   - up        : origin answered (HTTP < 500, no CF challenge)        -> backend alive
 *   - down      : HTTP 520-530 (Cloudflare reached, origin is down)    -> the outage
 *   - down      : timeout / DNS / connection refused                   -> host unreachable
 *   - degraded  : other 5xx
 *   - challenged: CF served a bot challenge on our probe path          -> edge up, origin unknown
 *
 * Node 18+ (global fetch + AbortSignal.timeout). Zero dependencies.
 *
 * Usage:
 *   node monitor.js              one-shot check, prints a table, exit code = # down
 *   node monitor.js --json       one-shot check, prints JSON
 *   node monitor.js --serve      run an HTTP server (status page + /status.json + /healthz)
 *
 * Env:
 *   PORT          server port (default 8080)
 *   INTERVAL_MS   poll interval in serve mode (default 30000, min 10000)
 *   TIMEOUT_MS    per-probe timeout (default 8000)
 */

const TARGETS = [
  { key: 'site',       label: 'Perchance site',   url: 'https://perchance.org/robots.txt',                  expect: 200 },
  { key: 'text-gen',   label: 'Text generation',  url: 'https://text-generation.perchance.org/robots.txt',  expect: 404 },
  { key: 'image-gen',  label: 'Image generation', url: 'https://image-generation.perchance.org/robots.txt', expect: 404 },
  { key: 'superfetch', label: 'superFetch proxy', url: 'https://fetch-plugin.perchance.org/robots.txt',     expect: 400 },
];

// A browser-like UA avoids a blanket 403; the probe paths still reach origin.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const TIMEOUT_MS = clampInt(process.env.TIMEOUT_MS, 8000, 1000, 30000);

function clampInt(v, def, lo, hi) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(lo, Math.min(hi, n));
}

function classify(status, mitigated) {
  if (mitigated) return 'challenged';           // CF bot challenge on our path
  if (status >= 520 && status <= 530) return 'down';      // CF up, origin down
  if (status >= 500) return 'degraded';         // other 5xx
  return 'up';                                  // origin answered (2xx/3xx/4xx)
}

async function probeOnce(t) {
  const start = Date.now();
  try {
    const res = await fetch(t.url, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': UA, 'Accept': '*/*', 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Date.now() - start;
    const status = res.status;
    const mitigated = res.headers.get('cf-mitigated'); // 'challenge' when blocked
    const state = classify(status, mitigated);
    return {
      key: t.key, label: t.label, url: t.url,
      ok: state === 'up', state, status, ms,
      drift: state === 'up' && status !== t.expect,
      error: null,
    };
  } catch (err) {
    const ms = Date.now() - start;
    const reason = err && err.name === 'TimeoutError'
      ? 'timeout'
      : ((err && err.cause && err.cause.code) || (err && err.code) || (err && err.message) || 'error');
    return {
      key: t.key, label: t.label, url: t.url,
      ok: false, state: 'down', status: 0, ms, drift: false,
      error: String(reason),
    };
  }
}

// One retry on failure (not on a challenge) to ride out transient blips.
async function probe(t) {
  let r = await probeOnce(t);
  if (!r.ok && r.state !== 'challenged') {
    await new Promise((s) => setTimeout(s, 400));
    const r2 = await probeOnce(t);
    if (r2.ok || r.state === 'down') r = r2; // prefer the retry's verdict
  }
  return r;
}

async function checkAll() {
  const results = await Promise.all(TARGETS.map(probe));
  const downCount = results.filter((r) => !r.ok).length;
  return { ts: new Date().toISOString(), allUp: downCount === 0, downCount, results };
}

/* ----------------------------- CLI (one-shot) ---------------------------- */

const ICON = { up: 'UP  ', down: 'DOWN', degraded: 'DEGR', challenged: 'CHLG' };

async function runOnce(asJson) {
  const snap = await checkAll();
  if (asJson) {
    process.stdout.write(JSON.stringify(snap, null, 2) + '\n');
  } else {
    console.log(`Perchance platform — ${snap.ts}`);
    for (const r of snap.results) {
      const code = r.status ? `HTTP ${r.status}` : '(no response)';
      const note = r.error ? `  ${r.error}` : (r.drift ? `  code drift (want ${expectOf(r.key)})` : '');
      console.log(
        `  [${ICON[r.state] || r.state}] ${r.label.padEnd(17)} ${String(r.ms).padStart(5)}ms  ${code}${note}`,
      );
    }
    console.log(snap.allUp ? 'All systems operational.' : `${snap.downCount} service(s) down.`);
  }
  process.exit(snap.downCount); // 0 = all up; cron/CI friendly
}

function expectOf(key) {
  const t = TARGETS.find((x) => x.key === key);
  return t ? t.expect : '?';
}

/* ------------------------------- Server mode ----------------------------- */

function serve() {
  const http = require('http');
  const PORT = clampInt(process.env.PORT, 8080, 1, 65535);
  const INTERVAL_MS = clampInt(process.env.INTERVAL_MS, 30000, 10000, 3600000);

  let last = null;                 // most recent snapshot
  const since = {};                // key -> { state, ts } when current state began

  async function tick() {
    try {
      const snap = await checkAll();
      for (const r of snap.results) {
        if (!since[r.key] || since[r.key].state !== r.state) {
          since[r.key] = { state: r.state, ts: snap.ts };
        }
      }
      last = snap;
    } catch (e) {
      // keep last good snapshot; never crash the loop
      console.error('tick error:', e && e.message);
    }
  }

  http.createServer(async (req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (!last) await tick();

    if (url === '/status.json') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(withSince(last), null, 2));
      return;
    }
    if (url === '/healthz') {
      // 200 only when everything is up — point an uptime pinger here.
      res.writeHead(last && last.allUp ? 200 : 503, { 'Content-Type': 'text/plain' });
      res.end(last && last.allUp ? 'ok' : 'degraded');
      return;
    }
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(renderPage(withSince(last), INTERVAL_MS));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }).listen(PORT, () => {
    console.log(`Perchance uptime monitor on http://0.0.0.0:${PORT}  (poll ${INTERVAL_MS}ms, timeout ${TIMEOUT_MS}ms)`);
  });

  tick();
  setInterval(tick, INTERVAL_MS);

  function withSince(snap) {
    if (!snap) return { ts: null, allUp: false, downCount: TARGETS.length, results: [] };
    return {
      ...snap,
      results: snap.results.map((r) => ({ ...r, since: since[r.key] ? since[r.key].ts : snap.ts })),
    };
  }
}

/* -------------------------------- HTML page ------------------------------ */

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const COLOR = { up: '#3fb950', down: '#f85149', degraded: '#d29922', challenged: '#a371f7' };
const WORD  = { up: 'Operational', down: 'Down', degraded: 'Degraded', challenged: 'Edge only' };

function renderPage(snap, interval) {
  const ts = snap.ts ? new Date(snap.ts).toUTCString() : '—';
  const banner = snap.allUp
    ? { c: COLOR.up, t: 'All systems operational' }
    : { c: COLOR.down, t: `${snap.downCount} service(s) down` };
  const rows = snap.results.map((r) => {
    const c = COLOR[r.state] || '#8b949e';
    const detail = r.error ? esc(r.error)
      : (r.status ? `HTTP ${r.status}` + (r.drift ? ' · code drift' : '') : '—');
    const sinceTxt = r.since ? new Date(r.since).toUTCString().replace('GMT', 'UTC') : '';
    return `<tr>
      <td><span class="dot" style="background:${c}"></span></td>
      <td class="name">${esc(r.label)}</td>
      <td><span class="state" style="color:${c}">${WORD[r.state] || esc(r.state)}</span></td>
      <td class="mono">${r.ms ? r.ms + ' ms' : '—'}</td>
      <td class="mono detail">${detail}</td>
      <td class="mono since" title="since this state began">${esc(sinceTxt)}</td>
    </tr>`;
  }).join('');

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="${Math.max(15, Math.round(interval / 1000))}">
<title>Perchance status</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;background:#0d1117;color:#e6edf3;font:15px/1.5 ui-sans-serif,system-ui,Segoe UI,Roboto,Helvetica,Arial}
  .wrap{max-width:760px;margin:0 auto;padding:32px 20px}
  h1{font-size:20px;margin:0 0 2px;font-weight:600}
  .sub{color:#8b949e;font-size:13px;margin-bottom:20px}
  .banner{border-radius:10px;padding:14px 18px;font-weight:600;margin-bottom:20px;
    background:#161b22;border:1px solid #21262d}
  .banner b{font-size:16px}
  table{width:100%;border-collapse:collapse;background:#161b22;border:1px solid #21262d;border-radius:10px;overflow:hidden}
  td{padding:13px 14px;border-top:1px solid #21262d;vertical-align:middle}
  tr:first-child td{border-top:none}
  .dot{display:inline-block;width:10px;height:10px;border-radius:50%}
  .name{font-weight:600}
  .state{font-weight:600;font-size:13px}
  .mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;color:#8b949e}
  .detail{white-space:nowrap}
  .since{text-align:right}
  @media(max-width:560px){.since,.detail{display:none}}
  .foot{color:#6e7681;font-size:12px;margin-top:16px}
  a{color:#58a6ff;text-decoration:none}
</style></head><body><div class="wrap">
  <h1>Perchance platform status</h1>
  <div class="sub">Independent external monitor · probes origin liveness, no generation</div>
  <div class="banner" style="border-color:${banner.c}"><span class="dot" style="background:${banner.c}"></span> <b>${banner.t}</b></div>
  <table>${rows}</table>
  <div class="foot">Last checked ${esc(ts)} · auto-refresh ${Math.max(15, Math.round(interval / 1000))}s ·
    <a href="/status.json">JSON</a> · <a href="/healthz">healthz</a></div>
</div></body></html>`;
}

/* --------------------------------- main ---------------------------------- */

const argv = process.argv.slice(2);
if (argv.includes('--serve')) serve();
else runOnce(argv.includes('--json'));
