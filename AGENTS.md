# AGENTS.md

Guidance for AI agents continuing **Marinara ↔ Perchance** bridge work in this repository.

This file documents **work added in this project** (the `marinara-bridge/` integration). The rest of the repo — `weld-ui/`, `smart-story/`, `Perchance Ai Agent Skill/`, and other generator folders — is pre-existing source archive material; use `Perchance Ai Agent Skill/SKILL.md` and `weld-ui/README.md` if you need context on those.

---

## What we built

Perchance has **no public API** for `text-to-image-plugin`. Images only run inside a real browser session on perchance.org, through a hidden broker iframe. **Marinara Engine** needs higher-quality images than its built-in Pollinations path, and wants to reuse Perchance generators (especially prompt-engineered forks like `n8n-style`) as remote renderers.

**Solution:** a `postMessage` bridge between a **parent frame** (Marinara extension, or the perchance.org editor shell during testing) and a **generator sandbox iframe** (the `*.perchance.org` child frame Perchance already uses). Pattern is modeled on `weld.skybridge` / Weld Companion, but parent-agnostic and focused on image RPC only.

```
┌─────────────────────────────────────┐
│  Parent (Marinara / perchance.org)  │
│  marinara-bridge-client.js          │
│       │ postMessage                  │
│       ▼                              │
│  ┌───────────────────────────────┐  │
│  │ Generator sandbox iframe       │  │
│  │ marinara-bridge-plugin         │  │
│  │  → text-to-image-plugin        │  │
│  │  → visible t2i broker mount    │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

**Status (verified working):** connect → ping → `generate()` returns a `dataUrl` when tested via the console snippet on a forked generator with `?marinara=1`.

---

## Published on Perchance

| Artifact | Slug / URL | Role |
|----------|------------|------|
| Bridge plugin | `marinara-bridge-plugin` | Import in any generator DSL: `marinaraBridge = {import:marinara-bridge-plugin}` |
| Example host | `marinara-t2i-host` (optional) | Minimal generator that only hosts the bridge |
| n8n-style fork (example) | `bh3yiwwq00` | `n8n-style` fork with bridge wired; test URL: `https://perchance.org/bh3yiwwq00?marinara=1` |

After editing `marinara-bridge-dsl.txt`, **republish** the plugin on perchance.org and **save** any generator that imports it (Perchance caches imports by `__generatorLastEditTime`).

Current plugin build id (in DSL): `mb-plugin/2026-06-21.3` — confirm with `ping()`; it should return `value.build`.

---

## `marinara-bridge/` files

| File | Purpose |
|------|---------|
| **`marinara-bridge-dsl.txt`** | **Source of truth.** Perchance plugin published as `marinara-bridge-plugin`. Defines `window.marinara.bridge`: opt-in, `postMessage` RPC, t2i queue, visible broker mount, reply packing. Paste into Perchance plugin editor or sync from here before publish. |
| **`marinara-bridge-client.js`** | Reference **parent-frame** client (`MarinaraPerchanceBridge`). Used by Marinara extension / tools. Not executed on Perchance. |
| **`bridge-console-snippet.js`** | **Local testing.** Paste into DevTools console on the **top** `perchance.org` tab (not inside the sandbox iframe). Exposes `marinaraBridgeTest.connect()`, `.ping()`, `.generate()`. |
| **`bridge-test-harness.html`** | Parent-frame UI tester. **Does not work** for cross-origin embeds (`X-Frame-Options: sameorigin`). Kept as reference; use the console snippet instead. |
| **`marinara-t2i-host-dsl.txt`** | Minimal DSL for a standalone “host” generator. |
| **`marinara-t2i-host-html.txt`** | HTML panel for the host generator (manual UI + bridge status pills). |
| **`n8n-style-hook-snippet.js`** | Copy-paste instructions for wiring the bridge into an `n8n-style` fork (DSL import + HTML init + `start()` retry). |

---

## Protocol (`marinara.bridge`)

| Item | Value |
|------|--------|
| Channel | `marinara.bridge` |
| Opt-in | `?marinara=1` or `#marinara` on the generator URL |
| Activation | Bridge only runs when **opted in** and **`window.parent !== window`** (sandbox iframe) |

**Parent → sandbox**

| `type` | Purpose |
|--------|---------|
| `ping` | Liveness; replies `{ pong: true, build }` |
| `request` | `cap: 'image'`, `payload: { prompt, resolution, guidanceScale, seed, referenceImage? }` |
| `configure` | Optional `allowedOrigins` allowlist |

**Sandbox → parent**

| `type` | Purpose |
|--------|---------|
| `ready` | Announced on start (+ periodic re-announce ~12s) |
| `reply` | `{ ok, value \| reason }` matched by `nonce` |
| `status` | Optional progress/error: `{ level: 'info' \| 'error', message, detail? }` — parent client logs these |

**UX (sandbox)**

- On each bridge job, the **prompt sent to t2i** is mirrored into the page prompt field (`#positivePromptInput`, `#prompt`, etc.) **silently** (no `input`/`change` events — those can trigger generator reloads). Override selector: `window.MARINARA_BRIDGE_PROMPT_SELECTOR`. Opt into events with `window.MARINARA_BRIDGE_MIRROR_EVENTS = true`. `window.__marinaraBridgeGenerating` is true while a job runs.
- On failure: `console.error('marinara.bridge:', …)` in the generator iframe, a **click-to-dismiss red toast** at top of page, render bay caption turns red and stays **15s** (vs 2s on success). Sync t2i validation errors (no iframe HTML) fail immediately with the plugin message text.

**Image constraints**

- Resolutions: `512x512`, `512x768`, `768x512`, `768x768` only.
- Replies must be **structured-cloneable** — no `HTMLCanvasElement` in `postMessage` payloads (extract `dataUrl` first).
- Empty prompts hang forever; bridge rejects them up front.
- **Reference image (optional):** `referenceImage: { url, blur }` forwarded to `text-to-image-plugin` for character consistency. `blur` is 0–1 (default `0.35` if omitted); lower = stronger likeness. `url` should be a Perchance upload URL (`user.uploads.dev` / `user-uploads.perchance.org`) or a `data:` URL. One reference per job. Prefer hosted URLs over large inline `data:` in `postMessage` payloads.

---

## How to test

Perchance blocks embedding `perchance.org` from `file://` or localhost. Testing uses the **same topology as Weld Companion**: parent = perchance.org shell, child = generator sandbox iframe.

1. Open fork with `?marinara=1` (e.g. `https://perchance.org/bh3yiwwq00?marinara=1`).
2. DevTools → **Console** on that tab (the outer page).
3. Paste all of `bridge-console-snippet.js`.
4. Run:

```javascript
await marinaraBridgeTest.connect()
await marinaraBridgeTest.ping()    // expect build mb-plugin/2026-06-21.3
await marinaraBridgeTest.generate({ prompt: 'a red apple on a wooden table' })
// With character reference:
await marinaraBridgeTest.generate({
  prompt: 'the same character walking through a rainy street',
  referenceImage: { url: 'https://user.uploads.dev/file/…', blur: 0.35 },
})
```

Success: ping shows build id; generate logs `dataUrl length …` and a console image preview (~15–45s). A small **“marinara.bridge rendering…”** panel appears bottom-right in the generator during t2i.

`marinaraBridgeTest.diagnose()` checks iframe URL and `marinara=1` propagation.

---

## Gotchas (learned the hard way)

1. **`X-Frame-Options: sameorigin`** — Marinara cannot iframe `perchance.org` from another origin unless a browser extension strips headers. Marinara integration should use a **perchance tab + content script** (Weld model) or extension header rules.

2. **Opt-in query parsing** — Perchance iframe URLs look like `?__generatorLastEditTime=…&marinara=1`. A naive ` marinara=1 ` substring check fails when `marinara` is not the first query param. Plugin parses query params properly.

3. **T2i visibility** — `text-to-image-plugin` only fires when its broker iframe is in a **visible on-screen** element. Off-screen 1×1 mounts never call `onFinish`. Bridge mounts a small fixed panel (see `mountT2iBay` in DSL).

4. **`postMessage` + canvas** — T2i results include a boxed String with `.canvas`. Sending that in a reply throws `DataCloneError`. `packReplyResult()` extracts `dataUrl` via `canvas.toDataURL()` and strips non-cloneable fields. **Ping/configure replies** must pass through unchanged (do not run image packing on `{ pong, build }`).

5. **Reply matching on the client** — Accept `reply` messages by **`nonce`**, not strict `ev.source === iframe.contentWindow` (iframe can reload during long t2i jobs).

6. **Prompt mirror must be silent** — writing the bridge prompt into the page textbox must not dispatch `input`/`change` events. Generators like n8n-style treat those as user edits and can reload or re-render, killing the in-flight job before the parent/sidecar receives the image.

7. **Fork DRM** — `n8n-style` shipped anti-fork scripts after `</html>` that wipe the page unless the URL is `/n8n-style`. Remove them in any fork or the UI breaks silently.

8. **`connect()` without `await`** — Leaves a floating `waitForReady` promise that rejects with `ready timeout` ~60s later. Always `await connect()`; snippet falls back to ping if `ready` announcements expired.

---

## Forking a generator for Marinara

Minimal steps (see `n8n-style-hook-snippet.js`):

1. **DSL:** `marinaraBridge = {import:marinara-bridge-plugin}`
2. **HTML init:** call `root.marinaraBridge()` and `window.marinara.bridge.start()` if needed.
3. **URL:** use `?marinara=1` when driving from Marinara or the console tester.

The bridge uses the raw `text-to-image-plugin` import. A production fork may later wire `createPrompt()` / style presets from Marinara job payloads — that mapping is not implemented yet.

---

## Marinara Engine (next steps, out of repo)

Sibling repo: `../Marinara-Engine`. Proposal: `docs/feature-proposals/04-web-ui-image-generators.md`.

| Layer | Owner | Role |
|-------|--------|------|
| Perchance fork | This repo | Prompt building, bridge plugin, t2i |
| Marinara extension | Marinara | Hidden iframe or perchance tab bridge, `marinara-bridge-client.js`, job queue |
| Marinara core (later) | Marinara | `client_image_job` SSE, fulfill API, optional `perchance-illustrator` agent |

Server-side Marinara agents **cannot** complete the image loop alone (no `postMessage` from server). The browser extension or a perchance tab is required.

### Character reference images (Marinara side — not implemented here)

The bridge and `marinara-t2i-host` now accept optional `referenceImage` in the image request payload. Marinara Engine still needs to supply it.

**What Marinara should do:**

1. **Source the portrait** — Use an existing character avatar URL from the character library (`character.avatar.url`), or upload a portrait once via Perchance `upload-plugin` in a perchance tab and cache the CDN URL on the character record.
2. **Pass through the client** — When fulfilling a `client_image_job` (or equivalent), include in `generateImage()` / bridge `request` payload:
   ```js
   {
     prompt: builtPrompt,
     resolution: '512x768',
     referenceImage: { url: characterAvatarUrl, blur: 0.35 }
   }
   ```
3. **Default blur** — Start with `0.35`; expose per-character or per-job tuning later (0 = strongest likeness, 1 = weakest).
4. **Avoid huge `data:` URLs** — `postMessage` can carry `data:` strings but multi‑MB portraits slow the RPC; prefer `user.uploads.dev` URLs.
5. **No upload from Marinara server** — Uploads require a real perchance.org browser session (Turnstile on first anonymous upload). The extension/content-script path must host or reuse uploaded URLs.
6. **Job schema** — Extend the image job model (SSE payload / fulfill API) with optional `referenceImageUrl` and `referenceBlur`; map to bridge payload in the extension before `postMessage`.
7. **Prompt forks** — Generators like `n8n-style` may still apply their own `createPrompt()` / style presets; reference image is orthogonal to prompt text — both can be sent together.

**Not in scope for Marinara yet:** multi-character refs per image, automatic portrait generation on first chat, or server-side upload proxy.

---

## Agent conventions for this work

1. **Edit `marinara-bridge-dsl.txt`**, then remind the user to republish `marinara-bridge-plugin` on Perchance.
2. **Preserve DSL / HTML split** — plugin logic in `*-dsl.txt`; panel boot in `*-html.txt` or hook snippets.
3. **Read** `Perchance Ai Agent Skill/SKILL.md` for t2i boxed-String behavior and resolution limits before changing generation code.
4. **Do not assume local HTML harness works** — use `bridge-console-snippet.js` on perchance.org.
5. **Bump `BUILD`** in the DSL when changing plugin behavior so ping can confirm deployment.
