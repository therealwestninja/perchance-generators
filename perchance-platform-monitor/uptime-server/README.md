# Perchance uptime monitor

A minimal, dependency-free external down-time detector for the Perchance
platform. One file (`monitor.js`), Node 18+.

It checks the four things that matter and **never generates anything** — it
hits the cheapest path on each host that reaches the real backend, so a check
takes ~150 ms instead of the seconds a real text/image generation would.

| Service           | Probe                                              | Healthy |
|-------------------|----------------------------------------------------|---------|
| Perchance site    | `GET perchance.org/robots.txt`                     | 200     |
| Text generation   | `GET text-generation.perchance.org/robots.txt`     | 404     |
| Image generation  | `GET image-generation.perchance.org/robots.txt`    | 404     |
| superFetch proxy  | `GET fetch-plugin.perchance.org/robots.txt`        | 400     |

### Why these paths

Perchance sits behind Cloudflare. The app and API routes (`/`,
`/api/generate`, …) return a **Cloudflare bot challenge** (`cf-mitigated:
challenge`) to any non-browser client, so a plain server can't probe them. But
`robots.txt` on each host is **not** challenged and is answered by the **origin**
— the per-host codes differ (404 vs 400 vs 200), which proves these are real
backend responses, not Cloudflare's edge. If a backend goes down, Cloudflare
returns `52x` there instead. That status code is the down-time signal.

### Health classification

- **up** — origin answered (HTTP < 500, no challenge). Backend alive.
- **down** — HTTP 520–530 (Cloudflare reached, origin is down) **or** timeout /
  DNS failure / connection refused (host unreachable).
- **degraded** — some other 5xx.
- **challenged** — Cloudflare served a bot challenge on the probe path (edge up,
  origin unknown). Shouldn't happen on `robots.txt`; if it does, Perchance
  changed its Cloudflare rules and the probe path needs revisiting.

A failed probe is retried once (400 ms apart) to ride out transient blips.
"Code drift" is flagged when a service is up but its status code changed from
the expected baseline — an early warning that an endpoint's behavior shifted.

## Usage

```sh
node monitor.js            # one-shot: prints a table, exits with the number of down services (0 = all up)
node monitor.js --json     # one-shot: prints JSON
node monitor.js --serve    # HTTP server: status page + /status.json + /healthz
```

### Server endpoints

- `GET /` — dark status page, auto-refreshes.
- `GET /status.json` — full snapshot (per-service state, latency, `since` timestamp).
- `GET /healthz` — `200 ok` when everything is up, `503 degraded` otherwise.
  Point an uptime pinger (UptimeRobot, BetterStack, a load balancer health
  check, …) at this.

### Config (env vars)

| Var           | Default | Meaning                                  |
|---------------|---------|------------------------------------------|
| `PORT`        | 8080    | Server port (`--serve`).                 |
| `INTERVAL_MS` | 30000   | Poll interval (`--serve`, min 10000).    |
| `TIMEOUT_MS`  | 8000    | Per-probe timeout.                       |

## Hosting

**Any always-on Node host** (Fly.io, Railway, Render, a VPS, a Raspberry Pi):

```sh
PORT=8080 node monitor.js --serve
```

**As a cron / CI down-time alert** (no server needed) — the exit code is the
number of down services, so any scheduler can alert on a non-zero exit:

```sh
*/5 * * * * cd /path/to/uptime-server && node monitor.js || curl -fsS "$ALERT_WEBHOOK"
```

**systemd** (`/etc/systemd/system/perchance-monitor.service`):

```ini
[Service]
Environment=PORT=8080
ExecStart=/usr/bin/node /opt/perchance-uptime-monitor/monitor.js --serve
Restart=always
[Install]
WantedBy=multi-user.target
```

> Note: a check measures the link **edge → origin** from wherever the monitor
> runs. It detects backend and Cloudflare outages, not problems on a specific
> user's path to Cloudflare. For the full user-path picture (real text/image
> plugin calls), see the generator-hosted monitor in the parent folder.
