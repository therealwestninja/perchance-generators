# Perchance Platform — Technical Reference

A complete technical reference for building on Perchance.org: generators, AI chat
applications, plugins, and any JavaScript that runs inside a Perchance generator.

This document covers the platform architecture, the four core plugins (`ai-text-plugin`,
`text-to-image-plugin`, `upload-plugin`, `super-fetch-plugin`), the Perchance DSL, the
`root` bridge, the public HTTP API, the AI character-chat data model, and the patterns
used in production Perchance applications.

Where the behavior described here differs from Perchance's official plugin documentation,
this document reflects the observed runtime behavior.

---

## Table of Contents

1. [Platform Architecture](#1--platform-architecture)
2. [Perchance DSL Fundamentals](#2--perchance-dsl-fundamentals)
3. [ai-text-plugin](#3--ai-text-plugin)
4. [text-to-image-plugin](#4--text-to-image-plugin)
5. [upload-plugin](#5--upload-plugin)
6. [super-fetch-plugin](#6--super-fetch-plugin)
7. [The `root` Proxy](#7--the-root-proxy)
8. [Public HTTP API](#8--public-http-api)
9. [Sandbox Capabilities](#9--sandbox-capabilities)
10. [AI Character-Chat Data Model](#10--ai-character-chat-data-model)
11. [Message Format & Wire Protocol](#11--message-format--wire-protocol)
12. [Hierarchical Summarization](#12--hierarchical-summarization)
13. [Memory & Lore](#13--memory--lore)
14. [File Hosting & Share Links](#14--file-hosting--share-links)
15. [Sandboxed Custom Code](#15--sandboxed-custom-code)
16. [UI Utilities](#16--ui-utilities)
17. [Page Initialization](#17--page-initialization)
18. [Common Patterns](#18--common-patterns)
19. [Security Notes](#19--security-notes)
20. [Common Pitfalls](#20--common-pitfalls)
21. [Quick Reference](#21--quick-reference)

---

## 1 · Platform Architecture

A Perchance generator has two authoring zones and a backend broker layer.

```
┌──────────────────────────────────────────────────────────────────┐
│  perchance.org  (parent frame, cross-origin from the sandbox)     │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Sandbox iframe — <hex>.perchance.org/slug                  │ │
│  │                                                             │ │
│  │  ┌──────────────────┐   ┌──────────────────────────────┐   │ │
│  │  │ Top editor       │   │ HTML panel                   │   │ │
│  │  │ (Perchance DSL)  │   │ (standard HTML + CSS + JS)   │   │ │
│  │  │ lists, functions │   │ application code             │   │ │
│  │  │ plugin imports   │   │ accesses plugins via root.x  │   │ │
│  │  └──────────────────┘   └──────────────────────────────┘   │ │
│  │                                                             │ │
│  │  <iframe src="text-generation.perchance.org/embed">  ◄──────┼─┼─ broker
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### 1.1 The Sandbox

The HTML panel runs in a sandboxed iframe served from a per-generator 32-hex subdomain:

```
https://<32-hex-id>.perchance.org/your-slug
```

| Property | Value |
|----------|-------|
| Parent origin | `https://perchance.org` |
| `crossOriginIsolated` | `true` — COOP/COEP enabled; `SharedArrayBuffer` is available [VERIFIED R25] |
| `window.top === window` | `false` — the panel is nested inside the parent frame |
| Storage quota | `navigator.storage.estimate()` → **quota = 10240 MB (10 GB), persisted = true** — confirms the long-claimed ~10 GB persistent quota exactly [VERIFIED R25] |
| Sandbox flags | `allow-scripts allow-same-origin` |
| Host environment (machine-dependent) | `hardwareConcurrency = 24`, `deviceMemory = 32 GB` (reference values from the measured host) [VERIFIED R25] |

`location.search` carries Perchance boot parameters such as `?__generatorLastEditTime=...`.
Never use `location.origin` to build share links — always hardcode `https://perchance.org`,
because `location.origin` inside the panel is the per-generator hex subdomain.

### 1.2 Backend Topology — the Broker Model

Plugins do **not** call the AI backend directly from the panel frame. They communicate by
`postMessage` RPC with dedicated broker iframes that the runtime injects into the sandbox
document:

```
panel JS  →  root.aiTextPlugin({...})
          →  plugin postMessages  →  text-generation.perchance.org/embed  (broker iframe)
                                  →  broker performs the real backend request
          ←  postMessage replies stream back  ←
```

No `fetch`, `XHR`, `WebSocket`, or `SSE` traffic leaves the sandbox during an AI call —
all transport is `postMessage`. The broker iframe is visible in the panel's DOM:

```js
document.querySelector('iframe').getAttribute('src')
// → "https://text-generation.perchance.org/embed"
```

The brokers are independent services, so calls to different services run in parallel:

| Service | Broker origin |
|---------|---------------|
| Text generation | `text-generation.perchance.org/embed` |
| Image generation | `image-generation.perchance.org` |
| File upload | `upload.perchance.org` |
| CORS proxy (`superFetch`) | `fetch-plugin.perchance.org` |

**Full subdomain map** (from Certificate Transparency logs and DNS probing):

| Subdomain | Purpose | Status |
|-----------|---------|--------|
| `perchance.org` | Main site + public API | Active (HTTP 200) |
| `www.perchance.org` | Redirects to `perchance.org` | Active |
| `<32-hex>.perchance.org` | Per-generator sandbox iframes (wildcard cert) | Active |
| `text-generation.perchance.org` | AI text broker + `/api/generate` backend | Active |
| `image-generation.perchance.org` | AI image broker + `/api/generate` + `/gallery` | Active |
| `upload.perchance.org` | File upload broker + `/api/upload,fileInfo,delete` | Active |
| `user-uploads.perchance.org` | Upload CDN origin (same backend as `user.uploads.dev`) | Active |
| `fetch-plugin.perchance.org` | CORS proxy (`/proxy1/`) | Active |
| `comments-plugin.perchance.org` | Comments backend (404 "Not Found" — alive; loads via iframe) [VERIFIED R25] | Live |
| `generated-images.perchance.org` | Content-addressed file API (400 `{"code":"bad_request","message":"File names must contain at least one character"}` at root); shares one backend with `user.uploads.dev` and `aigc.uploads.dev` [VERIFIED R25] | Alive |
| `browser-runner.perchance.org` | **Perchance-only** headless screenshot/render backend; validates `url` (only perchance.org main-domain URLs pass); public gateway = `/api/getGeneratorScreenshot` [VERIFIED R25] | Alive |
| `connect-plugin.perchance.org` | WebSocket/real-time connection plugin (520 origin error) [VERIFIED R25] | Down (HTTP 520) |
| `count-plugin.perchance.org` | Counter/analytics plugin backend (no response — backend-only, not importable) [VERIFIED R25] | Backend-only |
| `db-plugin.perchance.org` | Database plugin backend (no response — backend-only, not importable) [VERIFIED R25] | Backend-only |
| `editor-collab.perchance.org` | Collaborative editing service — returns "okay" on `/` [VERIFIED R25] | Alive |
| `editor-copilot.perchance.org` | AI copilot — `GET /api/findBugsInCode` → 500 (editor-only) [VERIFIED R25] | Active (editor context) |
| `posts-plugin.perchance.org` | Posts CRUD API broker (WIP, source has bugs) | Down (HTTP 522 — origin timeout) |
| `rss-feeds.perchance.org` | RSS feed per generator (path = name; strict CSP) | Live |
| `server-plugin.perchance.org` | WebTransport/WebSocket gateway (wildcard: `*.server-plugin`) | Down (HTTP 526 — invalid SSL cert) |
| `wt0.server-plugin.perchance.org` | WebTransport endpoint for server-plugin | Down (depends on server-plugin) |
| `null.perchance.org` | Test/sentinel subdomain — 404 (Express "Cannot GET /", alive) [VERIFIED R25] | Alive |
| `ads.perchance.org` | Ad service for image generation (loads `?provider=vli`); root serves an `<title>Advertisement</title>` HTML page — the ad iframe behind the (freely-obtainable, see §8) `adAccessCode` [VERIFIED R25] | Live |
| `api.perchance.org` | DNS exists (CF 522 — origin error) [VERIFIED R25] | Inactive |
| `cdn.perchance.org` | DNS exists (CF 520/522) | Inactive |
| `static.perchance.org` | DNS exists (CF 520/522) | Inactive |
| `assets.perchance.org` | DNS exists (CF 520/522) | Inactive |
| `app.perchance.org` | DNS exists (CF 520/522) | Inactive |
| `beta.perchance.org` | DNS exists (CF 520/522) | Inactive |
| `dev.perchance.org` | DNS exists (CF 520/522) | Inactive |
| `staging.perchance.org` | DNS exists (CF 520/522) | Inactive |
| `admin.perchance.org` | DNS exists (CF 520/522) | Inactive |

**External domains (non-perchance.org):**

| Domain | Purpose |
|--------|---------|
| `user.uploads.dev` | Upload CDN origin (shared backend with `user-uploads.perchance.org`) |
| `aigc.uploads.dev` | The **AI-generated image CDN** — images at `/image/<sha256>.jpeg` [VERIFIED R25] |
| `hf-mirror.uploads.dev` | Serves an SPA app-shell HTML (same ~28 KB on every path) — does **NOT** expose HuggingFace `/org/repo/resolve/` paths publicly [VERIFIED R25] |
| `hf-mirror-eastern-europe.uploads.dev` | Regional HuggingFace mirror |
| `cdn.rollbar.com` | Error tracking (in text-generation broker) |
| `challenges.cloudflare.com` | Cloudflare Turnstile (image-gen + upload brokers) |
| `cdn.jsdelivr.net` | JavaScript CDN (all brokers) |
| `analytics.google.com` | GA4 tracking (ID: `G-YJWJRNESS5`) |

**Analytics endpoints** (fire-and-forget, return HTTP 200 with empty body — called
automatically by every generator page on load):

| Endpoint | Purpose |
|----------|---------|
| `/api/count?keys=uaine,abpsgp` | Counter/analytics (called on page load) |
| `/api/cv?generatorName=...&isFromEmbed=0` | View counter (increments the `views` in `getGeneratorStats`) |
| `/api/securityData` | Spam hostname blocklist — `{spamHostnames: string[58]}` |

**Message protocol for one text-generation call:**

| Step | `type` | Other fields | Meaning |
|------|--------|--------------|---------|
| 1 | `embedIsReady` | — | Broker iframe finished loading |
| 2–3 | `verified` | — | Auth handshake (fires twice; subsequent calls reuse it) |
| 4…N | `streamData` | `requestId`, `value.text` | One token chunk each |
| N+1 | `streamData` | `requestId`, `value.text`, `value.final`, `value.stopReason` | Final chunk |
| N+2 | `streamEnd` | `requestId` | Stream closed |

Every AI call is internally a stream, even non-streaming ones. The `requestId` format is
`aiTextCompletion` followed by 17 digits. The broker silently ignores malformed or unknown
messages — there is no error-reply surface.

**Sandbox → parent control surface [VERIFIED R25].** Cross-origin isolation from the parent
(`perchance.org`) is SOLID. From the sandbox, reads of `window.parent.location.href`,
`window.top.location.href`, `window.parent.location.hash`, `window.parent.document`, and
`window.parent.origin` all throw `SecurityError`. Readable from the sandbox:
`window.frames.length` (= 0), `document.referrer` (= the generator's own URL),
`window.opener` (= null), `window.location.ancestorOrigins` (= `['https://perchance.org']`).

Outbound control postMessages to the parent — `changePageTitle`, `changeFavicon`,
`changeHash`, `changeUrl`, `requestOutputUpdate`, `metaUpdate`, `firstPageInteraction`,
`saveKeyboardShortcut`, `scriptTag` — all send WITHOUT throwing, but are **NOT
acknowledged**: the sandbox cannot confirm whether the parent acts on them (the parent DOM is
unreadable). So **upward command is fire-and-forget / unconfirmed; upward read is closed.**
(Methodology note: apparent "replies" during testing were actually an unrelated browser
extension's `weld.skybridge` `here` broadcasts, not Perchance responses.)

### 1.3 Generator Serving & Stale Builds

Generator HTML is served with:

```
Cache-Control: public, max-age=0, s-maxage=31104000
```

`max-age=0` means browsers always revalidate, but `s-maxage=31104000` means the Cloudflare
edge may hold a build for up to 360 days. When a generator is saved, Perchance purges the
edge cache; if that purge is delayed, the edge can serve a stale HTML panel. No service
worker is involved — stale builds are always a CDN purge-delay issue. The actual
invalidation is performed by the `clearCacheIfGeneratorOrImportsHaveBeenUpdated` endpoint
(see [§8](#8--public-http-api)).

---

### 1.4 Embedding & Offline [CANONICAL — FAQ]

- **Embed** a generator on any site via the `null.perchance.org` subdomain in an iframe:
  `<iframe src="https://null.perchance.org/<name>"></iframe>`.
- **Download** a generator as a single self-contained HTML file from the editor's settings
  → "download"; the downloaded file is itself editable by appending `#edit` to its URL and
  reloading.
- Generators are openly forkable/remixable; "make private" in settings removes a generator
  from public lists but not from direct-URL access.
- The boxed-String quirk (§3.2) traces back to the engine deliberately altering built-in
  prototypes and using `valueOf`/`Symbol` operator-overloading to make the DSL work — so
  plugin returns are wrapped objects, never primitives.

## 2 · Perchance DSL Fundamentals

The top editor uses the Perchance domain-specific language: indentation-structured lists,
functions, and plugin imports.

### 2.1 List & Function Syntax

```
listName
  item one
  item two
  {nestedList}           // embed another list
  {import:plugin-name}   // import a plugin

// Single-line function — expression only, no `return` keyword:
myFunc(x) => "result: " + x

// Multi-line async function — body indented under the signature:
async myFunc(opts) =>
  if(!opts) opts = {};
  let result = await someAsyncThing();
  return result;
```

**Naming rules** (enforced by the engine — violations are errors):

- List names may contain letters, numbers, and underscores only — no spaces, hyphens, or
  parentheses.
- A name cannot start with a number.
- A name cannot be a JavaScript reserved word (`return`, `function`, `for`, `let`,
  `const`, …).
- Function bodies must be indented relative to the signature.
- Single-line functions must be `name(args) => expression` on one physical line.

**HTML Panel String-Literal Interception [VERIFIED R24].** The DSL parser scans the
ENTIRE HTML panel source (including inside `<script>` tags) for template-expression
patterns BEFORE JavaScript runs. This means string literals in your panel JS that happen
to contain DSL-shaped patterns get intercepted and evaluated:

```js
// ❌ BREAKS — parser sees [vibrant] as a list reference
let prompts = ['a [vibrant] flower'];

// ❌ BREAKS — parser sees {import:foo}
let helpText = 'Add {import:my-plugin} to your lists';

// ❌ BREAKS — parser sees {1F3B2} as a range/expression
let dice = '\u{1F3B2}';   // ES6 escape

// ✓ FIX — backslash escape (JS treats \[ \{ as no-op, parser respects as literal)
let prompts = ['a \[vibrant\] flower'];
let helpText = 'Add \{import:my-plugin\} to your lists';

// ✓ FIX — surrogate pair or runtime construction
let dice = '\uD83C\uDFB2';
let dice = String.fromCodePoint(0x1F3B2);

// ✓ FIX — set via innerHTML at runtime (parser already done)
el.innerHTML = '<code>literal {brace} text</code>';
```

Intercepted patterns: `{word}`, `{import:x}`, `{1-10}`, `{A|B|C}`, `{s}`, `{a}`, `[word]`,
`[A:B:N]`, `[A|B]`. JS array indexing (`arr[i]`) and object literals (`{x:1}`) are
generally safe — they don't match the DSL pattern shape. HTML entities (`&#123;`,
`&#x7b;`) are NOT a workaround — the parser decodes entities before scanning.

### 2.2 Core Plugin Imports

```
aiTextPlugin      = {import:ai-text-plugin}
textToImagePlugin = {import:text-to-image-plugin}
uploadPlugin      = {import:upload-plugin}
superFetch        = {import:super-fetch-plugin}
loadDependencies  = {import:ai-character-chat-dependencies-v1}   // Dexie, DOMPurify, etc.
commentsPlugin    = {import:comments-plugin}
dynamicImport     = {import:dynamic-import-plugin}
bugReport         = {import:bug-report-plugin}
```

**Defensive plugin access from panel JS** — handles the case where a plugin handle is not
yet present:

```js
function grab(name) {
  try { if (typeof root !== 'undefined' && root[name] !== undefined) return root[name]; } catch (e) {}
  try { if (window[name] !== undefined) return window[name]; } catch (e) {}
  return undefined;
}
const plugin = grab('aiTextPlugin');
if (typeof plugin !== 'function') { /* not loaded yet */ }
```

### 2.3 `$meta.dynamic`

The `$meta.dynamic` function generates page metadata. It must be fully self-contained — it
cannot reference `root.*` or external globals, so any list data it needs must be duplicated
as a literal inside it:

```
$meta
  header
    mode = minimal
  async dynamic(inputs) =>
    let urlNamedCharacters = { "ai-adventure": "abc123.gz" };  // duplicated inline
    return { title: "...", description: "..." };
```

### 2.4 `dynamicImport` — Lazy Loading

```
customBots
  ExtraBots = [dynamicImport('some-generator-id')]
```

Use `dynamicImport` for optional or large dependencies; use `{import:...}` for required
ones. `dynamicImport` lazy-loads another generator on demand.

---

## 3 · ai-text-plugin

The text-generation plugin. The underlying model is a DeepSeek model, which accounts for
its characteristically direct, informal response style.

### 3.1 Call Signature

```js
// Non-streaming:
const result = await root.aiTextPlugin({
  instruction:   "System prompt / task description",
  startWith:     "Text the model continues from",
  stopSequences: ["\n\n[[", "\n[["],
  hideStartWith: true,   // exclude startWith from generatedText
});
const text       = String(result);        // always String() — see §3.2
const stopReason = result.stopReason;      // see §3.3

// Streaming:
const handle = root.aiTextPlugin({
  instruction, startWith, stopSequences, hideStartWith,
  onChunk: ({ textChunk, isFromStartWith, fullTextSoFar }) => {
    if (isFromStartWith) return;
    updateUI(textChunk);
  },
});
const final = await handle;

// Token utilities:
const { countTokens, idealMaxContextTokens } = root.aiTextPlugin({ getMetaObject: true });
```

The options that take effect are `instruction`, `startWith`, `hideStartWith`,
`stopSequences`, and `onChunk`. Fields such as `temperature`, `model`/`modelName`, `topP`,
`frequencyPenalty`, and `maxTokens` are accepted without error but have **no effect** —
they are stored in the character-chat UI and database but never passed to the plugin.
`instruction`, `startWith`, and `stopSequences` may each also be a function returning the
value.

### 3.2 The Return Value is a Boxed String

The awaited return is **not** a plain string or plain object — it is a `String` object
(`new String(text)`) with extra named properties. This is the most common source of silent
bugs in Perchance code.

```js
typeof result                          // "object"
result instanceof String               // true
Object.prototype.toString.call(result) // "[object String]"
result.valueOf()                       // the primitive string

result.text            // trimmed output text
result.generatedText   // full output text — use this
result.stopReason      // see §3.3
result.length          // string length (works correctly)
```

Safe access:

```js
// Correct:
const text = String(result);
const text = result.generatedText;
if (String(result) === "hello") { }
if (result.generatedText === "hello") { }

// Wrong — an object reference never strict-equals a primitive string:
if (result === "hello") { }
```

The same rule applies to `uploadPlugin` (`result.url` is a boxed String) and to
`textToImagePlugin` (the awaited result is a boxed String).

### 3.3 The Synchronous Handle

`aiTextPlugin(...)` returns two different things at two different times. After `await` you
receive the boxed String above. The value returned *synchronously* — the awaitable handle —
is an extended **Promise** carrying additional properties:

```js
const handle = root.aiTextPlugin({ instruction: "..." });
// Object.getPrototypeOf(handle) === Promise.prototype

handle.stop                  // function — abort generation (resolved stopReason → "user")
handle.inputs                // object  — { instruction, startWith, stopSequences }
handle.liveResponseText      // string  — current text; updates live, includes user edits
handle.textStream            // ReadableStream — yields plain string chunks
handle.onFinishPromise       // Promise — resolves to { text, generatedText, stopReason }
handle.id                    // string  — completion id: "aiTextCompletion" + 17 digits
handle.loadingIndicatorHtml  // string  — inline SVG spinner markup (~519 chars)
handle.submitUserRating      // async function — submit a response-quality rating

const result = await handle; // → the boxed String
```

**`textStream`** is a standard web `ReadableStream` of plain string chunks — a cleaner
alternative to the `onChunk` callback:

```js
const handle = root.aiTextPlugin({ instruction: "Write a story." });
for await (const chunk of handle.textStream) {
  process(chunk);            // chunk is a bare string fragment
}
const result = await handle; // boxed String, as usual
// handle.textStream.getReader() is also available
```

**`submitUserRating`** is an `async` function feeding the response-quality system:

```js
await handle.submitUserRating({ score: 0.8, reason: "optional explanation" });
// score:  number from 0 (bad) to 1 (good), e.g. 0.4 or 0.8 — out-of-range values are rejected
// reason: optional string
// It refuses (logs an error) if generation has not finished or ended with an error.
// It performs a network round-trip and resolves to undefined.
```

Note: `handle.inputs.instruction` holds the original instruction text you passed. The
plugin applies a small mutation (see §3.7) to the internal wire payload only, not to
`handle.inputs`.

### 3.4 `stopReason` Vocabulary

| Value | Meaning |
|-------|---------|
| `"natural"` | The model finished on its own |
| `"artificial"` | A stop sequence was hit, or the output token limit was reached — both map here |
| `"error"` | Malformed request; `generatedText` is `""` |
| `"user"` | Generation was stopped via `handle.stop()` or an aborted stream |

`"stop_sequence"` and `"max_tokens"` are never returned — code branching on those strings
is dead. `"artificial"` cannot distinguish a stop-sequence hit from a token-limit hit.
`"user"` appears on the resolved result's `stopReason`; the `onChunk` callback's
`stopReason` stays `null` when a stream is stopped.

```js
if (result.stopReason === "error") {
  // malformed request — generatedText is empty
  return;
}
```

### 3.5 Context Window

`idealMaxContextTokens` is `6000`, but this is **conservative** — it is not the real server
limit [VERIFIED R25]. The text broker's actual server cap is
`maxContextTokens = 8000 - 1024 = 6976` usable input tokens (1024 are reserved for output).
The `idealMaxContextTokens = 6000` value returned to clients is deliberately below the real
8000-token allowance. Middle-out truncation triggers only above ~6976 input tokens. Use
`idealMaxContextTokens - 800` as a practical prompt budget; the 800-token buffer keeps a
single new message or summary update from invalidating the backend prefix cache on every
send.

`countTokens(str)` is an **approximate** token counter — a base64-embedded bigram
approximation model (magic header `"DBG1"`), roughly **80× faster and 200× smaller** than the
real HF tokenizer [VERIFIED R25]. Every value it returns is the ceiling of an estimate. It
runs locally with no network call, so token counts are approximate but instant. Its fallback
char-per-token estimate is **3.9** (base) or **3.4** for French (French is auto-detected by
regex character-density) when the bigram model is unavailable.

**The "real" tokenizer is DeepSeek-R1-0528, loaded client-side [VERIFIED R25].** For "smart"
middle-out truncation the broker loads the actual DeepSeek-R1-0528 tokenizer in the browser
from
`https://huggingface.co/deepseek-ai/DeepSeek-R1-0528/resolve/main/tokenizer.json` (plus
`tokenizer_config.json`), with a content-CDN **mirror fallback** at
`https://user.uploads.dev/file/f27e15b2ffa9e5098575a127b49e1145.json` and
`https://user.uploads.dev/file/db8eb69f7363289462954ddf699853ef.json`. If the tokenizer fails
to load (≤2 retries) or would take more than 4000 ms, the broker falls back to the
char-per-token estimate above.

### 3.6 Concurrency & Performance

```
Concurrency:        text broker now PROCESSES CONCURRENT REQUESTS IN PARALLEL (see correction below)
Cross-service:      text, image, and upload brokers are independent — they run in parallel
Rate limiting:      none observed across sequential calls
```

**CONCURRENCY CORRECTION [VERIFIED R25].** This previously read "1 call at a time per broker
(strictly serial)". That is now **wrong**: three simultaneous `aiTextPlugin` calls
**OVERLAPPED** — wall-clock ≈ the max single call (~4286 ms), NOT the sum (~6961 ms), with
two calls completing near-simultaneously. The text broker now processes concurrent requests
**in parallel** (observed parallel; R25-observed, may warrant re-confirmation as backend
behavior can change).

**Warmup [VERIFIED R25].** No prompt-prefix KV-cache is detectable from the client, but there
is a strong general **warmup**: the first (cold) call is ~4662 ms; warm calls are ~940 ms. A
repeated prompt and a *different* prompt both sped up equally, so it is
connection/model warmup, not prompt-prefix caching.

**Rate limiting [VERIFIED R25].** No rate limiting observed across 5 rapid sequential calls
(latencies varied 716–4793 ms with no throttling or errors).

| Metric | Approximate value |
|--------|-------------------|
| Round-trip, short output | ~2,000 ms |
| Time-to-first-token | ~4,200 ms |
| Inter-chunk gap | ~286 ms average; first chunk up to ~2,300 ms |
| Output throughput | ~6 tokens/second |
| Practical output ceiling | ~900 tokens (~146 s), then `stopReason: "artificial"` |

The ~900-token ceiling is backend-enforced but not a hard limit — the model sometimes
stops naturally earlier. For longer output, chain sequential calls.

### 3.7 Streaming Details

Two streaming approaches are available — the `onChunk` callback and `handle.textStream`
(§3.3). The `onChunk` payload:

```js
{
  textChunk:       "...",  // the new delta
  isFromStartWith: false,  // true while echoing startWith
  fullTextSoFar:   "...",  // accumulated text so far
}
```

Aborting:

```js
handle.stop();
// → the promise resolves (it does not reject)
// → stopReason becomes "user"
// → onChunk fires zero more times after stop() returns
// → the queue slot is freed immediately; the next call starts at normal latency
```

**Instruction mutation:** every `instruction` is silently rewritten before being sent — the
first space becomes a non-breaking space (`\u00a0`), and if no regular space remains, a
trailing space is appended (so single-word instructions are padded). This applies to the
wire payload, not to `handle.inputs`.

**Text generate request shape [VERIFIED R25].** The broker's real request is:

```
POST text-generation.perchance.org/api/generate
  ?userKey=${userKey}        # Turnstile-minted 64-hex session gate
  &thread=${thread}          # 0 or 1 \u2014 see thread pool below
  &requestId=${requestId}    # "aiTextCompletion" + 17 digits
  &__cacheBust=${rand}
```

- `userKey` is a 64-hex session gate minted via Cloudflare Turnstile.
- `maxThreadsPerUser = 2`. Threads are rotated LRU via `moveToLeastRecentlyUsedThread`, so
  `thread` is always `0` or `1`.
- The **first** generate call of a session gets a tokenless "pass".
- On a network error there are up to **5 continuation retries**: each retry resumes by
  appending the already-streamed text to `startWith` (10 s delays between attempts), so a
  dropped stream is transparently continued rather than restarted.

**Streaming shape [VERIFIED R25].** Each `streamData` postMessage's `value` is
`{text: <delta>}` \u2014 the `text` key carries the **delta**, NOT the cumulative text. The output
ceiling is ~900 tokens, at which point `stopReason` becomes `"artificial"`. A
`streamKeepAlive` mechanism holds the stream open during long generations.

**Broker postMessage vocabulary [VERIFIED R25].**

| Direction | Messages |
|-----------|----------|
| IN (parent \u2192 broker) | `preload`, `verifyUser`, `startStream {postData}`, `stopStream` |
| OUT (broker \u2192 parent) | `verifying`, `verified`, `streamData`, `streamEnd`, `streamError` |

**Undocumented `ai-text-plugin` options the broker reads [VERIFIED R25]** (alongside the
known `instruction` / `startWith` / `stopSequences` / `hideStartWith` / `onChunk` / `preload`
/ `getMetaObject`): `_debug`, `appendContinuationSuffix`, `isFinalRender`, `addEndButtons`.

**Broker analytics & error tracking [VERIFIED R25].** The broker fires
`POST /api/clientPerformanceAnalytics` every 2 minutes carrying 1/20-sampled
`tokenizerPerformance` events. Rollbar error-tracking code is present in the broker but
**disabled** (commented out).

### 3.8 Input Validation

| Input | Result |
|-------|--------|
| Numeric `instruction` | Coerced to string; `stopReason: "natural"` |
| Object or array as `instruction` | Throws a `TypeError` inside plugin code |
| Empty `{}` | Accepted; the model free-runs |
| 21+ `stopSequences` | `stopReason: "error"`, empty `generatedText` — the maximum is **20** |
| Null byte in instruction | Accepted (appears stripped) |

After a `stopReason: "error"` or an uncaught throw, the queue recovers cleanly — a bad
request cannot wedge the pipeline for later callers.

### 3.9 Instruction Patterns

**Chat completion:**

```js
const instruction = `
<MESSAGES>
[[User]]: Hello!
[[Chloe]]: Hi, how can I help?
</MESSAGES>
REMINDER: Keep replies short and in character.
>>> TASK: Write the next 3 messages.
`.trim();
const startWith = `[[Chloe]]:`;
const stopSequences = ["\n\n[[", "\n[["];
```

**Summarization:**

```js
const startWith = `
>>> FULL TEXT of [C]: ${messagesToSummarize}
>>> SUMMARY of [C]: (full, natural, readable sentences):`.trim();
const stopSequences = ["\n\n", "\n---", "\n>>> FULL TEXT", "FULL TEXT"];
const summary = result.generatedText.trim()
  .replace(/\n+/g, " ").replace(/---$/, "")
  .replace(">>> FULL TEXT", "").replace("FULL TEXT", "").trim()
  .replaceAll(/ *[—–] */g, ", ").trim();
```

**Memory extraction:**

```js
const instruction = `
@@@ TASK: Condense *NEW_TEXT* into up to 3 lore/memory/fact entries.
- Timeless facts only ("Bob was born in Paris", not "Bob is hungry").
- Each entry fully self-contained; use real names not pronouns.
# NEW_TEXT: ${messagesSummarizedText}
`.trim();
const startWith = `# Lore/memory entries from NEW_TEXT:\n1.`;
const stopSequences = ["\n4."];
const memories = ("1." + result.generatedText).trim()
  .split("\n").map(l => l.trim())
  .filter(l => /^[0-9]\. .+/.test(l))
  .map(l => l.replace(/^[0-9]\. /, "").replaceAll(/ *[—–] */g, ", "));
```

**Shared prefix cache** — structure related calls so they begin with an identical prefix;
the backend caches the token sequence and tokenizes the shared segment only once:

```js
const sharedPrefix = `# Context:\n${extraContext}\n# Prior summary:\n${priorSummary}`;
// Both the summary call and the memory call start with sharedPrefix.
```

### 3.10 The Injected System Prompt & Model Behavior [VERIFIED R25]

**The complete injected system prompt is extractable, and it is EXACTLY TWO BULLETS.**
Verified complete via probing: a "how many instructions" probe returned `2`; "text before"
→ NOTHING-BEFORE; "other/identity/format rules" → NONE-OTHER; "names this generator" →
NO-GENERATOR-CONTEXT. The prompt is **GLOBAL** (generator-agnostic — the broker injects no
generator name/title/description). It contains **NO identity, safety, or formatting rules** —
only creative-writing house-style. Verbatim:

> **Bullet 1:** "For stories, allow plot points to happen in a way that feels authentic,
> earned, believable, and realistic. Consider physical plausibility and relative spatial
> validity. Let the story unfold organically, in a way that feels surprisingly real. Would it
> *actually* happen like that? If not, don't write it like that - the reader is not stupid.
> Make it believable via the backstory and world building."
>
> **Bullet 2:** "For stories, use an unusual opener, which only later makes sense. Or maybe
> some surprising dialogue as a hook that makes you want to read on. Or a time skip. Avoid
> boring/normal/cliche openers about the weather or temperature, or whatever."

**Model behavior [VERIFIED R25]:**

| Property | Finding |
|----------|---------|
| Knowledge cutoff | **≈ end of 2024** — correctly states Donald Trump won the 2024 US presidential election, but answers "I do not know" when asked to name a 2025 technology |
| Determinism | **NON-DETERMINISTIC** — sampling at temperature > 0; two identical calls produce different outputs. (Complements §3.1: the temperature *parameter* is ignored, but the server still samples at temp > 0.) |
| Reasoning style | Inline chain-of-thought **prose** (Markdown step lists). It does NOT emit DeepSeek-R1 `<think>` tags — the reasoning is in the answer body, not a separate hidden trace |
| Guardrails | **NO refusal** on mild lawful content (e.g. it explains how a basic pin-tumbler lock works) — consistent with the no-safety-rules system prompt above |

---

## 4 · text-to-image-plugin

The image-generation plugin.

### 4.1 Call Modes

`textToImagePlugin(...)` returns two things at two times. The **synchronous return** is a
plain object (not a boxed String) with four own properties: `iframeHtml`, `evaluateItem`,
`onFinishPromise`, `toString`. After `await`, the result is a boxed String with three own
properties: `canvas`, `dataUrl`, `inputs`.

```js
// Template-injection mode — inject the iframe HTML directly:
container.innerHTML = `${root.textToImagePlugin(options)}`;
// String(result) is the raw iframe HTML (also result.iframeHtml / result.evaluateItem)

// Recommended — await the result directly:
const result = root.textToImagePlugin({ prompt, resolution, negativePrompt });
const data = await result;
// data.canvas   — HTMLCanvasElement
// data.dataUrl  — canvas.toDataURL("image/jpeg")
// data.inputs   — echoed options (prompt, resolution, guidanceScale, seed, width, style, save*)
// the awaited result has exactly these three own keys — there is no data.iframe

// Advanced — manual iframe injection. The iframe MUST be appended directly to
// document.body (not inside a hidden or clipped wrapper) or onFinishPromise hangs forever:
const raw = root.textToImagePlugin(options);
const tmp = document.createElement("div");
tmp.innerHTML = raw.iframeHtml;
const iframeEl = tmp.firstElementChild;
document.body.appendChild(iframeEl);
const data2 = await raw.onFinishPromise;
// after generation, the iframe ELEMENT gains a .textToImagePluginOutput property:
//   iframeEl.textToImagePluginOutput.canvas / .dataUrl / .inputs
iframeEl.remove();
```

### 4.2 Resolution

Only four resolution strings are accepted; any other value is silently dropped client-side
(0×0 canvas, `inputs.resolution` absent):

```
"512x512"   "512x768"   "768x512"   "768x768"
```

Re-confirmed: **both 512 and 768 are accepted** (768 returns a 768×768 canvas); **1024 is
rejected** (no canvas produced) [VERIFIED R25].

| Scenario | Resolution |
|----------|-----------|
| Plugin called with no `resolution` option | 512×512 (bare default) |
| AI character chat, no orientation keywords | 768×768 |
| `portrait` or `selfie` in the prompt | 512×768 |
| `landscape` or `wide angle` in the prompt | 768×512 |

The AI character chat resolves orientation before calling the plugin:

```js
if (!prompt.includes("(resolution:::")) {
  if (/\b(portrait|selfie)\b/i.test(prompt))            options.resolution = "512x768";
  else if (/\b(landscape|wide.?angle)\b/i.test(prompt)) options.resolution = "768x512";
  else                                                  options.resolution = "768x768";
}
if (!prompt.includes("(negativePrompt:::")) {
  options.negativePrompt = "low quality, worst quality, blurry";
}
```

### 4.3 Inline Prompt Parameters

The plugin parses a fixed set of `(key:::value)` parameters embedded anywhere in the prompt
text. They are extracted into `inputs` and stripped from the prompt before it reaches the
model:

```
A beautiful sunset (resolution:::768x512) (negativePrompt:::cars, buildings) (seed:::42)
```

| Inline parameter | Type | Notes |
|------------------|------|-------|
| `(seed:::N)` | number | `-1` = random |
| `(resolution:::WxH)` | string | one of the four valid sizes |
| `(negativePrompt:::text)` | string | parses correctly (bracket-depth parser; missing `)` → rest of string), is URL-encoded into the image `/api/generate` query string and reaches the server — but **sent to the server, not acted on by the model** [VERIFIED R25] |
| `(guidanceScale:::N)` | number | 1–30, default 7 |
| `(size:::N)` | number | square size |
| `(width:::N)`, `(height:::N)` | number | echoed as a `"512px"` CSS string in `inputs` |
| `(style:::CSS)` | string | CSS for the iframe DOM element |
| `(saveTitle:::text)`, `(saveDescription:::text)` | string | public-gallery metadata |

### 4.4 Options & Behavior

| Option / property | Behavior |
|-------------------|----------|
| `negativePrompt` | Reaches the broker payload as a real string AND is URL-encoded into the image `/api/generate` query string — so it **is sent to the server, but not acted on by the model** [VERIFIED R25]. (Earlier rounds described this as "dropped"; the correction is that it travels all the way to the server and is ignored at the model, not dropped client-side.) |
| `seed` | Sent to the server in the request, but **not acted on by the model** — output varies regardless [VERIFIED R25] |
| `referenceImage` | Plumbed through the plugin's `$output` and reaches the broker payload as `{url, blur}`, but **the SD backend ignores it** — a real-but-dead img2img feature (see §4.4c) [VERIFIED R25] |
| `guidanceScale` | Default 7, range 1–30; reaches the backend |
| `style` | CSS string applied to the iframe DOM element — not an image-style preset |
| `removeBackground: true` | Runs client-side (see below) |
| Generation time | ~13–14 s |
| Queue | Independent from text generation — image and text run in parallel |
| Determinism | **DETERMINISTIC** for identical inputs — two identical renders gave Pearson 1.0 on a structural signature [VERIFIED R25] |
| `guidanceScale` effect | **Minimal / near-ignored** — Pearson 0.949 between scale 1 and 15; weakly honored [VERIFIED R25] |
| NSFW content-guard | **Not a blanket block** — did NOT fire on a mild non-explicit prompt (rendered normally) [VERIFIED R25] |

**`removeBackground: true`** runs entirely client-side: it downloads the `briaai/RMBG-1.4`
model via transformers.js (q8 quantization, WASM backend) and strips the background
in-browser. The server generates a normal image; the device removes the background. Output
is a **PNG with alpha** rather than JPEG. The option is not echoed in `inputs` because it
is a post-process, not a server parameter. The first call is slow (model download); later
calls reuse the cached model.

**Empty or inline-only prompts hang forever.** A `prompt` of `""`, or one consisting only
of inline parameters, passes client-side validation but the backend never responds — the
call never resolves and never times out. Always pass real description text:

```js
// Hangs — never resolves:
await t2i({ prompt: '', resolution: '512x512' });
await t2i({ prompt: '(resolution:::512x768)' });

// Fine — both accepted, generate normally:
await t2i({ prompt: 'a red apple', negativePrompt: '' });
await t2i({ prompt: 'a red apple', negativePrompt: null });
```

The AI character chat guards against this by stripping empty `<image></image>` tags before
rendering — custom code must do the same.

### 4.4a A1111 Prompt Syntax Compatibility [VERIFIED R24]

The backend is a Stable Diffusion 1.5-class model (1024² rejected, native 512, CLIP ViT-L
77-token limit). The **exact checkpoint is server-side and is NOT exposed in the client
source** — the hf-mirror does not expose HF repo paths (it is an SPA) [VERIFIED R25]. The model
natively understands A1111 WebUI-style prompt
syntax — but the **Perchance DSL layer sits between you and the backend** and owns the
`[...]` syntax space. So square-bracket A1111 features get intercepted before they reach
the model. Verified empirically via side-by-side same-seed comparison tests:

| Syntax | A1111 meaning | Perchance result | Status |
|---|---|---|---|
| `(text)` | emphasize ~1.1× | passes to backend, works | ✅ |
| `((text))` | emphasize ~1.21× | passes to backend, works | ✅ |
| `(text:1.5)` | explicit weight | passes to backend, works | ✅ |
| `(text:0.5)` | de-emphasize | passes to backend, works | ✅ |
| `[text]` | de-emphasize ~0.9× | **intercepted by Perchance DSL parser**, contents dropped | ❌ |
| `[A:B:N]` | prompt editing (switch A→B at step N) | **intercepted by DSL parser**, contents dropped, empty space remains in prompt | ❌ |
| `[A\|B]` | alternating tokens per step | **intercepted as Perchance random-pick syntax** — picks ONE option at evaluation | ❌ |
| `word AND word` | compositional diffusion | backend doesn't implement | ❌ |
| `BREAK` | attention break | backend doesn't implement | ❌ |
| `negativePrompt` (param/inline) | suppress concepts | reaches the **server** (URL-encoded in the query string), **ignored at the model** [VERIFIED R25] | ⚠️ |

**The cause of the `[...]` failures is not the model — it's the Perchance DSL layer.**
Anywhere `[word]` appears in a string sent through the plugin, Perchance evaluates it as
a template expression and either errors or substitutes random content from a same-named
list. The string that reaches the SD backend has the bracket content stripped.

**For weight control on Perchance: parentheses only.** `(detailed:1.4)`, `(blurry:0.5)`.
For "negative prompt" effects: not possible — fall back to positive prompt construction
with vivid descriptors.

### 4.4b Inspecting the Actual Broker Payload [VERIFIED R24]

To verify what data is actually being sent to `image-generation.perchance.org`, extract
the iframe's `data-src` URL hash and decode it:

```js
const iframeHtml = String(root.textToImagePlugin(opts));
const hashMatch = iframeHtml.match(/data-src="[^"]*#([^"]+)"/);
if (hashMatch) {
  const payload = JSON.parse(decodeURIComponent(hashMatch[1]));
  console.log(payload);
  // {
  //   prompt: "a red apple",
  //   negativePrompt: "blurry, ugly",    // ← actually present in payload
  //   seed: 42,
  //   resolution: "512x512",
  //   guidanceScale: 7,
  //   requestId: "...",
  //   userKey: "...",
  //   ...
  // }
}
```

This technique proved that `negativePrompt` does reach the broker as a proper string. It is
then URL-encoded into the image `/api/generate` query string and **sent to the server** — the
data is not dropped in the plugin, the DSL→JS bridge, or the broker. It is simply **not acted
on by the model** [VERIFIED R25]. The same is true of `seed` and `referenceImage`.

**Complete payload key set & platform defaults [VERIFIED R25].** The exact JSON the plugin
sends to the image broker (read from the iframe `data-src` payload) has keys: `saveChannel`
(= generator name), `saveTitle`, `saveDescription`, `prompt`, `seed`, `resolution`,
`guidanceScale`, `defaultGuidanceScale`, `negativePrompt`, `requestId` (a `Math.random()`
float string), `iframeId`, `referenceImage`. The **prompt is passed RAW** — no client-side
quality-tag injection — and `negativePrompt` defaults to `""` (**no default negative
prompt**). Platform defaults: **`seed` defaults to `-1` (random); `guidanceScale` defaults to
`7`** (a `defaultGuidanceScale: 7` field confirms the house default is 7). Any prompt
enhancement is server-side and not visible client-side.

### 4.4c img2img (`referenceImage`) — a Real but Dead Feature [VERIFIED R25]

The `text-to-image-plugin` has a working `referenceImage` handler in its `$output`. Schema:

```js
referenceImage = {
  url:  { evaluateItem: "<blob: or hosted URL>" },
  blur: { evaluateItem: 0..1 },   // blur is the img2img STRENGTH (0 = ignore ref, 1 = full)
}
```

The handler survives `$output`, validates that `blur` is in the 0–1 range, and the payload
reaches the broker as `{url, blur}` — so it is fully plumbed on the client side. **But the SD
backend ignores it.** Verified empirically: a magenta reference image plus a "green forest"
prompt produced no structural or colour change at `blur` 0, 0.5, or 1. So `referenceImage` is
plumbed in the plugin but dead at the model — the same fate as `negativePrompt` and `seed`.

### 4.5 Image Persistence

Images regenerate by default on every render. A "Keep" button saves the JPEG to
`message.customData.__savedImages[corePrompt]` in IndexedDB. Including `@noKeepButton`
anywhere in an image description suppresses the keep/delete UI (useful for transient
images).

### 4.6 The `<image>` Tag in AI Chat

When an AI message contains `<image>description</image>`, the character chat extracts the
description, applies `imagePromptPrefix` / `imagePromptSuffix` / `imagePromptTriggers`,
resolves the resolution, calls `textToImagePlugin`, and injects the iframe.

The model only knows about the `<image>` syntax when it is explicitly told. Without the
hint, the model either ignores image requests or refuses them outright. Provide the hint in
the instruction whenever image generation should be available:

```js
const IMAGE_TAG_HINT =
  'Note: You can embed an AI-generated image in your reply using this exact syntax: ' +
  '`<image>A detailed description of the scene or subject</image>` ' +
  '— the content inside the tag will be used to generate an actual image. ' +
  'Use this when the user asks for an image or when an image would enhance the reply.';
```

Once the hint is given, the model reliably produces well-formed single and multiple
`<image>...</image>` tags. Structural priming with `startWith: '<image>'` does not work —
the model writes the description but never closes the tag.

`imagePromptTriggers` syntax (one rule per line; values may contain Perchance
`{option|option}` syntax):

```
CharacterName: physical description to append when the name appears in the prompt
/regex/flags: text to append when the regex matches the prompt
keyword: @prepend description    ← @ prefix prepends instead of appending
```

---

## 5 · upload-plugin

Anonymous file hosting on Perchance's content-addressed CDN.

```js
const result = await root.uploadPlugin(blob);
const url = String(result.url);   // String() required — url is a boxed String
const { size, error, deletionUrl } = result;
```

### 5.1 Return Shape

```js
{
  url:         BoxedString,   // "https://user.uploads.dev/file/<hash>.<ext>"
  size:        number,        // file size in bytes
  error:       string | null,
  deletionUrl: string,        // GET this URL to permanently delete the file
}
```

### 5.2 Content Addressing

The CDN is content-addressed, but the hash covers **bytes plus MIME type**, not bytes
alone:

```js
const a = await uploadPlugin(new Blob([data], { type: 'text/plain' }));
const b = await uploadPlugin(new Blob([data], { type: 'application/octet-stream' }));
String(a.url) !== String(b.url);   // different hash and different extension
```

Identical bytes with an identical MIME type deduplicate to the same URL.

### 5.3 Deletion

```js
// deletionUrl format:
// https://upload.perchance.org/api/delete?fileId=<id>&deletionKey=<key>
await fetch(result.deletionUrl);
// The file is deleted immediately; subsequent requests to the file URL return 404.
```

### 5.4 MIME Type Coverage

| MIME type | Result | Served as |
|-----------|--------|-----------|
| `text/plain` | accepted | `.txt` |
| `image/png`, `image/jpeg`, `image/gif`, `image/webp` | accepted | matching |
| `image/svg+xml` | accepted — see [§19](#19--security-notes) | `.svg` |
| `application/json` | accepted | `.json` |
| `application/pdf` | accepted | `.pdf` |
| `application/javascript` | accepted, stored as `.bin` (served as `application/octet-stream`, not executable) | `.bin` |
| `application/octet-stream` | accepted | `.bin` |
| `video/mp4` | accepted | `.mp4` |
| `audio/mpeg` | accepted | `.mp3` |
| `text/html` | **rejected** → `invalid_filetype` | — |

The service is very permissive. `text/html` is the only confirmed rejection. JavaScript is
accepted but defanged to `.bin`. SVG is accepted and is script-capable — see the security
notes.

### 5.5 Size Limits

| Item | Value |
|------|-------|
| Maximum accepted | 5 MB |
| Rejected | 6 MB → `file_too_big` |
| Zero-byte blob | accepted |

### 5.6 Anti-Abuse & the `expires` Option

The upload broker runs a Cloudflare Turnstile verification before the first anonymous
upload of a session. The two Turnstile sitekeys are:
- `0x4AAAAAAAJn3pYzPx4ATVOt` — text-generation broker
- `0x4AAAAAAAA8g8NphwaSOT59` — image-generation broker
- `0x4AAAAAAAIXRUXRfqyYaEMy` — upload broker (distinct from image-gen!) It is usually invisible, but it is a real anti-abuse gate that can
challenge automated upload pipelines. The first upload of a session is slow (it includes
the verification); subsequent uploads reuse the token and are fast.

`uploadPlugin(blob, { expires: ... })` accepts an `expires` option that is passed through
to the upload backend. It is validated client-side and is format-strict — plain numbers and
duration strings are rejected with `invalid_expiry`. The accepted format is a timestamp.

### 5.7 Error Handling

```js
if (result.error) {
  alert(`Upload error: ${result.error}${
    result.error === "disallowed_content"
      ? ". Edit the character description to explicitly state the character is 18+ —"
        + " the moderation system can flag ambiguous descriptions."
      : ""
  }`);
  return;
}
```

---

## 6 · super-fetch-plugin

A server-side CORS proxy. Requests egress from Cloudflare infrastructure rather than the
user's browser, which bypasses CORS restrictions inside the sandbox.

```js
const response = await root.superFetch(url, init);
// Returns a standard Response-like object:
const data = await response.json();
const text = await response.text();
const buf  = await response.arrayBuffer();
```

### 6.1 Behavior

| Feature | Result |
|---------|--------|
| GET, POST, PUT, DELETE | All work; correct status codes are returned |
| POST/PUT request body | Forwarded to the upstream |
| Redirects | Followed; the final status code is returned |
| Status passthrough | Yes (e.g. 418 → 418) |
| `data:` URLs | Handled |
| Slow upstreams | The proxy waits; no client-side timeout was observed |
| Custom request headers | **Stripped** — they never reach the upstream |
| Cookie jar | **None** — each call is cookie-isolated |
| Response size | **No general cap** — large files (hundreds of KB and up) return in full |
| Caching | By full URL including query string |

For authenticated requests, put credentials in URL parameters rather than headers — custom
headers are stripped:

```js
// Wrong — the header never arrives:
root.superFetch(url, { headers: { Authorization: 'Bearer token' } });
// Correct:
root.superFetch(url + '?token=' + encodeURIComponent(token));

// Cache-bust when fresh data is required:
const fresh = await root.superFetch(`${url}?_=${Date.now()}`);
```

### 6.2 Proxy Bypass List

Requests to a small set of origins are sent via plain `window.fetch`, skipping the proxy
entirely (faster, no header handling):

- `*.jsdelivr.net`
- `*.catbox.moe`
- `raw.githubusercontent.com`
- `huggingface.co` URLs containing `/resolve/`
- `blob:` and `data:` URLs (handled by direct `window.fetch`, never proxied)

The upload origins (`user-uploads.perchance.org`, `user.uploads.dev`, `aigc.uploads.dev`)
attempt a direct fetch first and fall back to the proxy on failure.

### 6.3 SSRF Protection

Requests to internal and private addresses fail immediately (`Failed to fetch`, within
~65–160 ms): `localhost`, `127.0.0.1`, `0.0.0.0`, `169.254.169.254` (cloud metadata), and
RFC-1918 ranges (`192.168.x.x`, `10.x.x.x`, `172.16.x.x`). The proxy attempts the request,
but Cloudflare cannot route to private addresses. There is no SSRF exposure via
`superFetch`.

### 6.3a Proxy Characterization [VERIFIED R25]

`superFetch` is a **transparent full HTTP proxy**:

- **Status passthrough** — returns the origin's REAL status code (verified `418` passed
  through with body).
- **Follows redirects server-side** — a `302` returned the final 200 + body.
- **Forwards arbitrary HTTP methods with bodies** — `PUT` and `DELETE` verified via httpbin
  echo.
- **Egresses via Cloudflare Workers** — the origin sees `Cdn-Loop: cloudflare`.

**SSRF-hardened (nothing to disclose) [VERIFIED R25].** Requests to `169.254.169.254` (cloud
metadata), `127.0.0.1`, and `127.0.0.1:8080` all fail (`Failed to fetch` — unroutable from
the Cloudflare edge); `file://` URLs are rejected with `"Must provide full URL, starting with
https:// or http://"`. It cannot be used for SSRF to internal/loopback/metadata targets or
local files.

### 6.4 Realtime Reach: the Server Plugin & the Userscript Bridge

`superFetch` proxies through Cloudflare at
`https://fetch-plugin.perchance.org/proxy1/<encoded-url>?origin=https://<generatorPublicId>.perchance.org`.
Beyond the private-range failures in §6.3 it will not sustain relay/realtime endpoints — an
unroutable target or a long-lived WebSocket/SSE relay returns HTTP 530, which the plugin
converts to `Failed to fetch` [confirmed in source]. So for live/shared state, a generator's
options by reach are:

1. **`BroadcastChannel`** — same browser, tabs of the *same* generator (which share one
   sandbox subdomain). Zero backend. (The platform itself doesn't relay over it — §23 —
   but a generator's own same-origin tabs can.)
2. **`server-plugin`** — the **official realtime/multiplayer backend**: a WebSocket connection
   to `server-plugin.perchance.org` with per-generator "universes" keyed by
   `window.generatorPublicId` (binary framed protocol with multiplexed/bidi streams;
   `#forceUseWS=1` forces the WS path). Use this for cross-device shared state / multiplayer
   rather than rolling your own — and **don't fork it** (its code is coupled to the server;
   wrap it via an importing plugin instead).
3. **`superFetch` polling** — cross-device but request/response only; no persistent
   connection, and relays 530.
4. **A userscript bridge** (a Tampermonkey/Greasemonkey companion on the editor/top frame) —
   `GM_xmlhttpRequest` makes the arbitrary cross-origin calls neither the sandbox nor
   `superFetch` can. Best for capabilities the sandbox lacks entirely (arbitrary hosts,
   own-model AI), or as a realtime fallback when `server-plugin` doesn't fit.

Rule of thumb: shared/multiplayer state → `server-plugin`; one user's own tabs →
`BroadcastChannel`; arbitrary-host or own-model needs → the userscript bridge
(`editor-and-userscripts.md` §4). A generator's effective cross-origin reach = its own
`superFetch` ∪ a userscript bridge, when present.

### 6.5 Sandbox Network Boundary — Raw Egress WITHOUT superFetch [VERIFIED R25]

What the sandbox's RAW network stack can do without `superFetch`, measured from a generator
sandbox subdomain:

| Transport | Raw (no superFetch) | Notes |
|-----------|---------------------|-------|
| Cross-origin `fetch` (CORS) | **ALLOWED** | The iframe CSP `connect-src` permits https egress. A plain `fetch('https://perchance.org/api/securityData', {mode:'cors'})` resolves **200/ok** — that endpoint sends `Access-Control-Allow-Origin` to sandbox subdomains and is directly fetchable WITHOUT superFetch. A `no-cors` fetch to a third party resolves opaque. |
| WebSocket (`wss://`) | **BLOCKED** | CSP-refused — `onerror` fires immediately. |
| EventSource / SSE | **ALLOWED** | An SSE connection to a third-party stream opens successfully. Note the asymmetry: SSE allowed, WebSockets blocked. |
| WebRTC (`RTCPeerConnection`) | **ALLOWED** | See privacy caveat below. |

**CONCLUSION on superFetch's purpose:** raw https egress is NOT blocked by the sandbox — so
`superFetch` exists to bypass **CORS** (read cross-origin response bodies the browser would
otherwise hide), NOT because the sandbox cannot make outbound requests at all.

**⚠️ WebRTC IP leak — PRIVACY/SECURITY CAVEAT (disclosure-worthy) [VERIFIED R25].** An
`RTCPeerConnection` with a public STUN server gathers `srflx` (server-reflexive) candidates
that **expose the visitor's real public IP** (a real `srflx` candidate was observed).
Perchance sets **no permissions-policy** to restrict WebRTC in generator iframes. So **any
generator can deanonymize a visitor's public IP via WebRTC**, entirely bypassing
`superFetch`'s server-side IP anonymization. This is a known privacy limitation of the
sandbox.

---

## 7 · The `root` Proxy

`root` is a JavaScript `Proxy` wrapping a callable function target. It is the bridge
between the Perchance DSL (top editor) and panel JavaScript.

### 7.1 Proxy Characteristics

```js
typeof root              // "function" — a callable Proxy
'aiTextPlugin' in root   // true — the in-operator works
root.__nonexistent__     // undefined — safe for feature detection
Reflect.ownKeys(root)    // THROWS — the ownKeys trap is non-spec-compliant
JSON.stringify(root)     // undefined — no enumerable keys
root[Symbol.iterator]    // undefined — not iterable
root()                   // THROWS, and corrupts the Proxy for all subsequent reads
```

**Never call `root()` directly.** Doing so throws and also leaves the Proxy in a broken
state where every later `root.x` read throws as well. Only ever read properties from
`root`.

### 7.2 DSL List Objects

`root.myList` returns the internal Perchance List object, not an evaluated string:

```js
const list = root.myList;

// Own keys:
// $root, $declarationLineNumber, $moduleName, $valueChildren, $functionChildren,
// $allKeys, $allKeysSet, $perchanceCode, $odds,
// getOdds, getName, getParent, getLength, getRawListText, getSelf,
// getPropertyKeys, getPropertyNames, getChildNames, getFunctionNames, getAllKeys

list.toString()        // the list name as a string
list.evaluateItem      // a STRING — a pre-evaluated item snapshot, not a callable
list[Symbol.iterator]  // undefined — not iterable
```

### 7.3 DSL Functions — a One-Way Bridge

Functions defined in the top editor are exposed as callable properties, but their return
values do not cross back to panel JavaScript:

```js
// Top editor:  greet(name) => "Hello " + name
const fn = root.greet;
typeof fn      // "function"
fn.length      // 1 — arity is passed through
fn("world")    // undefined — the return value is dropped at the bridge boundary
```

The Perchance engine executes the DSL function, but the result stays on the DSL side. Any
logic that must return a value should be written directly in the panel script.

---

## 8 · Public HTTP API

Server-callable endpoints on `https://perchance.org/api/`. They require no broker handshake
and work from anywhere — a server, a script, or another origin. They expose generator
**metadata and source only**; they do not run the AI plugins.

| Endpoint | Returns |
|----------|---------|
| `getGeneratorStats?name=NAME` | **Open, no auth** [VERIFIED R25]. `{"status":"success","data":{"name","views","lastEditTime","metaData":{"title","description","image"},"publicId"}}` (e.g. `animal` → 641301 views). Cleanest open per-generator data surface. |
| `getGeneratorStats?names=N1,N2,N3` | Same shape but `data` is an **array** — batch lookup in one call [VERIFIED R25] |
| `getGeneratorList?max=N&tags=...` | JSON: generators; `?tags=<tag>` WORKS as a queryable tag index for discovery; `max=1000` returns ~357 (the public feed) [VERIFIED R25] |
| `downloadGenerator?generatorName=NAME` | The full generator as HTML |
| `downloadGenerator?...&listsOnly=true` | DSL lists only, without the HTML wrapper |
| `getGeneratorsAndDependencies?generatorNames=...` | JSON: the **full transitive import tree** (dependencies-of-dependencies included); each entry = `{name, imports, code, lastEditTime}` [VERIFIED R25] |
| `getGeneratorScreenshot?generatorName=NAME` | `image/jpeg` |
| `upload.perchance.org/api/fileInfo?url=...` or `?id=...` | JSON: `{"tags":[...], "extension":"..."}` only — no size/date [VERIFIED R25] |
| `upload.perchance.org/api/upload` | Upload endpoint — returns `anti_bot_verification_needed` without Turnstile |
| `upload.perchance.org/api/delete?fileId=...&deletionKey=...` | Delete a file by ID + key |
| `upload.perchance.org/api/checkVerificationStatus` | `{status:"not_verified", success:true}` [VERIFIED R25] |
| `upload.perchance.org/api/cloudflareTurnstileVerify` | `{status:"failed_verification", success:false}` — the anti-bot gate [VERIFIED R25] |
| `upload.perchance.org/api/delete?fileId=…&deletionKey=…` (bad key) | `{status:"not_found", success:false}` — deletion needs a valid fileId + deletionKey pair [VERIFIED R25] |
| `upload.perchance.org/api/uploadChunk` | `{status:"anti_bot_verification_needed", success:false}` — chunked/large upload requires Turnstile first [VERIFIED R25] |

The whole upload path (`upload.perchance.org/api/*`) is Turnstile-gated end to end:
`uploadChunk` and `upload` both demand verification, `cloudflareTurnstileVerify` is the gate
itself, and `checkVerificationStatus` reports `not_verified` for an unverified session.

**Backend endpoints** (require broker-minted auth tokens — not directly callable):

| Endpoint | Auth | Response without auth |
|----------|------|-----------------------|
| `text-generation.perchance.org/api/generate` | `userKey` (64-hex, from broker handshake) | `{"status":"invalid_key"}` |
| `image-generation.perchance.org/api/generate` | `userKey` (same pattern) | `{"status":"invalid_key"}` |
| `image-generation.perchance.org/gallery` | Parameter-dependent | `{"status":"invalid_parameter"}` |

**Platform-internal endpoints** (observed on load, not part of the stable API):

| Endpoint | Method | Response |
|----------|--------|----------|
| `getCommunityData` | GET, no auth | `{status:"success", data:{lastPost:{secondsAgo, title}, posts:[{secondsAgo, title, ...}]}}` — OPEN, browsable community forum feed [VERIFIED R25] |
| `checkGeneratorOwnership` | POST (with `{generatorName}`) | `{"status":"is-not-owner"}` or `"is-owner"` — open per-session ownership check [VERIFIED R25] |
| `clearCacheIfGeneratorOrImportsHaveBeenUpdated` | GET (with params) | `true` — the CDN edge-cache invalidation mechanism |
| `getGeneratorHtml?generatorName=X` | GET, no auth | Raw HTML-panel **source** server-side (DSL templates like `[pride()]` intact); distinct from `downloadGenerator` (which returns lists/DSL) [VERIFIED R25] |
| `cv?generatorName=X&isFromEmbed=0` | GET, no auth | 200 empty body — the **view-counter WRITE**; an anonymous GET increments the generator's view count (a view-inflation vector) [VERIFIED R25] |
| `securityData` | GET, no auth | `{spamHostnames:["galaxy-link.space","shrinkme.io","linkvertise.com","adf.ly","exe.io", ...]}` — Perchance's PUBLIC spam/URL-shortener denylist; reusable for moderation [VERIFIED R25] |
| `getAccessCodeForAdPoweredStuff` | GET, no auth | **FREELY mints a valid 64-hex `adAccessCode`** (e.g. `30a2d786…c9353`) with no ad watched and no auth — see note below [VERIFIED R25] |
| `login` | POST | `{status:"captcha-needed"}` — account login is Turnstile-gated [VERIFIED R25] |
| `aiHelper` | POST | `{status:"server-error"}` for ALL body shapes (`{prompt}`/`{message}`/`{question}`/`{text}`/`{instruction}`/`{messages:[]}`/`{type,prompt}`/`{action,description}`) incl. empty — it fails BEFORE reading the body, i.e. it is SESSION/AUTH-gated, not an open AI endpoint [VERIFIED R25] |

**The ad-gate on image generation is SOFT [VERIFIED R25].** `getAccessCodeForAdPoweredStuff`
freely mints a valid 64-hex `adAccessCode` with no ad watched and no auth, so the ad token is
freely obtainable. The only **hard** gate on image generation is the Turnstile-minted
`userKey` (cf. §4 image ad-gating and the image generate request shape).

**There is NO open, un-keyed AI endpoint reachable from outside Perchance [VERIFIED R25].** Both
`/api/generate` paths (text + image) gate on the Turnstile `userKey`, and `aiHelper` gates on
session. This settles the common "the text-gen API is callable from outside, that's a bug"
claim: the `userKey` **IS** the gate — it is simply minted per-browser via Turnstile, not a
missing check.

**Dead / legacy routes (404 "Cannot GET/POST") [VERIFIED R25]:** `getGeneratorDiffPatches`,
`getPrivateNotes`, `getUserData`, `getGeneratorMetaData` (the real meta route is
`getDynamicMetaData`). A `count?keys=…` read returns an empty body.

`downloadGenerator` carries an explicit backwards-compatibility guarantee and is the safe
endpoint to build on. The older `generateList.php` endpoint is **legacy and dead** (404
"Cannot GET" [VERIFIED R25]) — prefer `downloadGenerator` with client-side DSL evaluation, or
`getGeneratorStats` / `getGeneratorList` for metadata.

**Response schemas** (confirmed via probing):

```
getGeneratorStats?name=NAME
  → { name, views, lastEditTime, metaData: { title, description, ... }, publicId }

getGeneratorList?max=N
  → { status, generators: [{ name, views, lastEditTime, lastEditTime_ago, metaData }] }

getGeneratorsAndDependencies?generatorNames=N1,N2
  → { success, generators: { slug: { name, imports, code, lastEditTime } }, unfound }

getGeneratorHtml?generatorName=NAME
  → HTML panel content only (no DSL lists); only accepts generatorName param

downloadGenerator?generatorName=NAME
  → full generator as HTML; with &listsOnly=true → DSL lists only

upload.perchance.org/api/fileInfo?url=URL (or ?id=ID)
  → { tags, extension }
```

**Headless / server-side execution [CANONICAL — diy-perchance-api].** Because no API runs a
generator's AI for you, the official "DIY API" runs the generator itself, headless: download
its HTML and execute it under JSDOM, then drive its `root`:

```js
const { JSDOM } = require("jsdom");
const html = await fetch(
  `https://perchance.org/api/downloadGenerator?generatorName=${name}&__cacheBust=${Math.random()}`
).then(r => r.text());
const { window } = new JSDOM(html, { runScripts: "dangerously" });
window.root.output.toString();                   // evaluate a list
window.root.character.hitpoints = 10;            // set a property
window.root.character.description.evaluateItem;  // pre-evaluated snapshot
window.update();                                 // re-render
```

The first request is slow (the generator must warm the cache; cf. §1.3). **The AI plugins
cannot run this way.** `ai-text-plugin` and `text-to-image-plugin` are funded by ads shown on
the Perchance page, so they run only on `perchance.org` itself — a headless/JSDOM or
self-hosted copy has no way to display the funding ads, and the plugins refuse to run. This
is the hard reason the public API exposes source/metadata only and never drives generation
(cf. the broker model, §1.2).

**Backend API wire format** (from console log analysis of a live chat session):

Text generation (`POST text-generation.perchance.org/api/generate`):
```
?userKey=<64-hex>                    # Turnstile-minted session key
&thread=0                            # conversation thread ID
&requestId=aiTextCompletion<17-digits>
&__cacheBust=<Math.random>
```

Image generation (`POST image-generation.perchance.org/api/generate`):
```
?userKey=<64-hex>                    # different key from text-gen
&requestId=<Math.random>             # NOT the aiTextCompletion format
&adAccessCode=<64-hex>               # ad completion proof token
&v=<64-hex>                          # build/version verification hash
&__cacheBust=<Math.random>
```

Image generation requires an `adAccessCode` — a token proving the user watched an ad via
`ads.perchance.org/?provider=vli`. Each broker mints its own `userKey` independently via
Turnstile verification. The `v` parameter appears to be a build verification hash.

None of these endpoints can drive AI generation. `aiTextPlugin` and `textToImagePlugin`
require the in-page broker handshake, which requires a real browser loading a real
generator page.

**`/api/save`** (POST, session-based) — saves a generator. Only callable by the
generator owner from the editor context.

**Complete API endpoint catalog** (34 endpoints from saved page source analysis):

Public (no auth): `downloadGenerator`, `getGeneratorList`, `getGeneratorStats`,
`getGeneratorScreenshot`, `getGeneratorsAndDependencies`, `getCommunityData`,
`getDynamicMetaData`, `getGeneratorHtml`, `securityData`, `generate`, `cv`, `count`.

Session-based (require `sessionToken`): `save`, `checkGeneratorOwnership`,
`changeGeneratorName`, `changeGeneratorPrivacy`, `deleteGenerator`,
`duplicateGenerator`, `getGeneratorsByUser`, `saveUserGeneratorFolderMap`,
`getPrivateNotes`, `setPrivateNotes`, `getGeneratorDiffPatches`.

Account management: `login`, `verify`, `changeEmail`, `changePassword`,
`deleteAccount`, `requestPasswordResetCode`, `resetPassword`.

Collab editing (all live, return JSON): `getCollabEditKey`
(→ `{"status":"invalid-credentials"}` without auth), `validateCollabEditKey`
(→ `{"status":"invalid"}`), `deleteCollabEditKey` (POST, → `{"status":"server-error"}`),
`regenerateCollabEditKey` (POST, → `{"status":"server-error"}`).

Re-confirmed R25: the session-based POSTs (`save`, `changeGeneratorName`, `deleteGenerator`,
`duplicateGenerator`, `setPrivateNotes`, `verify`) all return `{"status":"server-error"}` for
an unauthenticated/empty-body call — they fail *before* reading the body, so they cannot be
exercised without a real session (same gating posture as `aiHelper`). `getGeneratorDiffPatches`
/ `getPrivateNotes` / `getUserData` / `getGeneratorMetaData` return 404 "Cannot GET" as GET
routes (the real meta route is `getDynamicMetaData`). There is **no `/api/archive*` route on
`perchance.org`** — the AI-character `/api/archive/v1/<source>/image/character/<user>/<char>`
URL is built from the *card's own origin* (the character app's domain), not Perchance [VERIFIED R25].

**API error vocabulary** (complete set observed R22-R23):
`server-error`, `session-token-error`, `invalid-credentials`, `invalid`,
`captcha-needed`, `incorrect-code`, `invalid_data_type`, `is-not-owner`, `is-owner`.

Note: `getDynamicMetaData` is **GET-only** (404 on POST). `getGeneratorsByUser`
returns the distinct `session-token-error` status (not generic `server-error`).
`verify` accepts body and checks code without verifying user existence first.
`/api/rateGeneratedText` is a quality-feedback endpoint (from broker source).

Infrastructure: `clearCacheIfGeneratorOrImportsHaveBeenUpdated` (GET, → `true`/`false`),
`getAccessCodeForAdPoweredStuff` (GET, returns 64-hex ad token — no auth needed),
`aiHelper` (POST-only, GET times out), `alc` (GET, → `"1"`), `iusb` (GET, → `"0"`).

**Mystery / legacy endpoints resolved [VERIFIED R25]:**

| Endpoint | Result |
|----------|--------|
| `/api/alc` | `"1"` |
| `/api/iusb` | `"0"` |
| `/api/generateList.php` | 404 "Cannot GET" — **legacy, dead** |
| `/api/clearCacheIfGeneratorOrImportsHaveBeenUpdated` | `true` / `false` |
| `text-generation.perchance.org/api/rateGeneratedText` | `{"status":"success"}` |
| `/api/getCollabEditKey` | `{"status":"invalid-credentials"}` |
| `/api/validateCollabEditKey` | `{"status":"invalid"}` |
| `editor-copilot.perchance.org/api/findBugsInCode` (GET) | 500 |

**Reverse-dependency lookups do not exist [VERIFIED R25].** There is **no** reverse-dependency
API — `getDependents`, `getGeneratorsByDependency`, and `getGeneratorsThatImport` all 404. A
"who imports X" index must be built by crawling. (`getGeneratorsAndDependencies` only walks
*forward* through the import tree.)

**`getDynamicMetaData` → `{"success":false}` for external callers** (gated/dead for
non-page callers) [VERIFIED R25].

**`/api/generate` (text AND image) is GATED, not open/abusable [VERIFIED R25].** A POST without
a valid `userKey` returns `{"status":"invalid_key"}` regardless of method or other params — it
cannot be called as an open public API.

Note on `/api/generate` [VERIFIED R25]: on the **backend brokers**
(`text-generation.perchance.org` and `image-generation.perchance.org`) it is a real but
**gated** endpoint — a POST without a valid `userKey` returns `{"status":"invalid_key"}` (not
404). It is not an open/abusable API. (On the main `perchance.org/api/` host it is not a
generation endpoint.)

POST-only endpoints (404 on GET): `login` (returns `{"status":"captcha-needed"}`),
`verify`, `changeGeneratorName`, `changeGeneratorPrivacy`, `deleteGenerator`,
`duplicateGenerator`, `getGeneratorsByUser`, `saveUserGeneratorFolderMap`,
`getPrivateNotes`, `setPrivateNotes`, `getGeneratorDiffPatches`,
`requestPasswordResetCode`.

**Platform-internal endpoint details** (from probing — not a stable API):

`clearCacheIfGeneratorOrImportsHaveBeenUpdated` returns a boolean:
- `true` = CDN cache was invalidated.
- `false` = no invalidation (insufficient params, or generator doesn't exist).
- Requires the full param set: `generatorName`, `importedGeneratorNames`,
  `clientHtmlServerRenderTime`, `transferSize`. With `generatorName` alone → `false`.
  A far-future `clientHtmlServerRenderTime` always triggers invalidation (`true`).

`checkGeneratorOwnership` is **session-based** — it checks the caller's browser session,
not a request-body field. POST with any body returns `{"status":"is-not-owner"}` (or
`"is-owner"` for the logged-in creator). GET returns 404 — POST only.

`getCommunityData` returns `{status:"success", data:{lastPost, posts}}` — a community
forum feed. Accepts query parameters that slightly vary the response.

**Backend `/api/generate`** (on `text-generation` and `image-generation`): the `userKey`
is validated first; every request without a valid key returns `{"status":"invalid_key"}`
regardless of other parameters or HTTP method.

**`image-generation.perchance.org/gallery` [VERIFIED R25].** With a valid `channel`,
`/gallery?channel=<generatorName>` returns a per-generator **server-rendered HTML gallery
page** (~2.5 MB, with image URLs embedded; `channel` = the generator name). `/gallery` alone,
or with only `?subChannel`, returns `{"status":"invalid_parameter"}`.

- **AI-generated images** are stored content-addressed at
  `https://aigc.uploads.dev/image/<sha256>.jpeg` — that is what `aigc.uploads.dev` IS.
- **No JSON image-list API exists** (`getGalleryImages`, `getImages`, etc. all 404). To browse
  a gallery you must fetch the HTML gallery page and parse the
  `aigc.uploads.dev/image/*.jpeg` URLs out of it.
- **Built-in gallery vote system:**
  `image-generation.perchance.org/api/voteOnGalleryImage?imageId=&channel=&subChannel=&direction=&auto=&userKey=`
  (with `__wafDisallowTor=true` anti-Tor WAF), plus `/api/galleryImageViewCount` and
  `/api/getPublicUserId?channel=`. The gallery uses `idb-keyval` client-side.

**Upload `/api/upload`** validates the `expires` query parameter *before* the Turnstile
check — `?expires=test` returns `invalid_expiry` while all other params return
`anti_bot_verification_needed`.

**`rss-feeds.perchance.org/<generatorName>`** serves an RSS 2.0 XML feed per generator.
The path is the generator name (e.g. `/animal`, `/ai-character-chat`). Each feed has a
`<title>` matching the generator name and contains 1 `<item>`. Even nonexistent generator
names return a 200 with a valid RSS feed. The root `/` returns 404. The service has a
strict CSP (`default-src 'none'`) blocking all external scripts.

**Infrastructure behavior:**

- `fetch-plugin.perchance.org` validates `?origin=` before routing — every request
  without a valid origin returns `HTTP 400 "Invalid origin."`.
- `comments-plugin.perchance.org` returns 404 for all probed paths (36 tested).
- Generator page query parameters (`?raw=1`, `?json=1`, `?debug=1`, etc.) are ignored by
  the server — all return the identical full HTML. URL-param handling is client-side only.
- `robots.txt` disallows only `/api/downloadGenerator`.

---

## 9 · Sandbox Capabilities

The sandbox iframe (`allow-scripts allow-same-origin`) exposes a wider capability set than
many developers expect:

| Capability | Available | Notes |
|-----------|-----------|-------|
| Popups (`window.open`) | Sometimes | Sometimes returns a window now (not always blocked) [VERIFIED R25] |
| Notifications | API present | Permission pre-denied |
| Fullscreen | Yes | |
| Cache Storage | Yes | `caches.open()` succeeds |
| OPFS (`storage.getDirectory`) | Yes | Main-thread read/write round-trip succeeds. `createSyncAccessHandle` is undefined on the main thread (Worker-only) but **WORKS inside a Worker** — verified a synchronous `write`→`flush`→`read`→`getSize` round-trip there. **SQLite-wasm OPFS VFS is VIABLE** — a full local SQLite database (`sqlite-wasm`/`wa-sqlite`) runs in the sandbox: persistent, synchronous, up to the 10 GB quota, no server [VERIFIED R25] |
| WebGPU (`navigator.gpu`) | Present, but no adapter | `navigator.gpu` exists, but `await navigator.gpu.requestAdapter()` returns **null** — no GPU adapter is exposed to the isolated iframe. **WebGPU-based local model inference is NOT viable** in the sandbox (on this host) [VERIFIED R25] |
| `OffscreenCanvas` | Yes | Present [VERIFIED R25] |
| WebGL2 + float textures | Yes | WebGL2 context obtainable; `EXT_color_buffer_float` extension available — enables a WebGL float-texture inference fallback [VERIFIED R25] |
| `WebAssembly` | Yes | `WebAssembly.validate` ok; `instantiateStreaming` present; threads via SAB confirmed (see below) [VERIFIED R25] |
| Geolocation | Present | State `prompt` — the user can be asked |
| Camera / microphone | Present | State `prompt` — the user can be asked |
| Clipboard read | Present | Denied by default |
| `localStorage` / `indexedDB` | Yes | Functional |
| `document.cookie` | Yes | Readable and writable |
| `crossOriginIsolated` | Yes | `true` — COOP/COEP enabled [VERIFIED R25] |
| `SharedArrayBuffer` | Yes | `typeof SharedArrayBuffer === "function"` — available [VERIFIED R25] |
| WASM threads / multithreading | Yes | Verified end-to-end: blob Worker + SAB + Atomics works in both main frame and workers [VERIFIED R25] |
| Child iframes with scripts | Yes | Inherit `allow-scripts` |

**True multithreading now works in the sandbox [VERIFIED R25].** Because the platform now
enables cross-origin isolation (COOP/COEP), `crossOriginIsolated === true` and
`SharedArrayBuffer` is a real constructor. A blob `Worker` + `SharedArrayBuffer` + `Atomics`
was verified end-to-end: the worker wrote `42` to shared memory via `Atomics.store` and the
main thread read it back via `Atomics.load`. Both the main frame AND spawned workers are
`crossOriginIsolated` with SAB. This means threaded WASM now runs in the sandbox —
transformers.js threads, ffmpeg.wasm, and sqlite-wasm threads are all viable. This is a
change from the prior "false / unavailable" state.

**Local model inference viability [VERIFIED R25].** In-sandbox local model inference is
viable on the **CPU path** (WASM + SAB threads + a WebGL2 `EXT_color_buffer_float` fallback)
but **NOT via WebGPU** — `navigator.gpu.requestAdapter()` returns `null`, so no GPU adapter
is exposed to the isolated iframe (on the measured host). The 10 GB persistent quota leaves
room for a quantized model on disk.

---

## 10 · AI Character-Chat Data Model

The AI character chat persists state in IndexedDB via Dexie.js:

```js
const db = new Dexie("chatbot-ui-v1");
db.version(N).stores({
  characters: "++id, name, uuid",
  threads:    "++id, characterId, lastViewTime, lastMessageTime",
  messages:   "++id, threadId, characterId, order",
  memories:   "++id, threadId",
  lore:       "++id, bookId, bookUrl",
  summaries:  "hash",
  usageStats: "++id, threadId",
  misc:       "key",
});
```

### 10.1 Character

```js
{
  id, uuid,
  name: "Chloe",
  roleInstruction: "...",            // < 1000 words
  reminderMessage: "...",            // < 100 words
  generalWritingInstructions: "@roleplay1" | "@roleplay2" | "custom text",
  initialMessages: [{ author: "user"|"ai"|"system", content: "..." }],
  avatar: { url: "https://...", size: 1, shape: "square" },
  userCharacter: { name, roleInstruction, reminderMessage, avatar: { url } },
  systemCharacter: { avatar: {} },
  modelName: "good" | "great",       // stored and shown in UI, but not passed to aiTextPlugin
  scene: { background: { url }, music: { url } },
  loreBookUrls: ["https://user.uploads.dev/file/xxx.txt"],
  autoGenerateMemories: "none" | "enabled",
  textEmbeddingModelName: "default",
  maxParagraphCountPerMessage: null | 1 | 2 | 3 | 4,
  streamingResponse: true,
  customCode: "",
  imagePromptPrefix: "",             // prepended to every image prompt; supports Perchance syntax
  imagePromptSuffix: "",             // appended to every image prompt; supports Perchance syntax
  imagePromptTriggers: "",           // conditional appends — see §4.6
  metaTitle: "", metaDescription: "", metaImage: "",
  customData: {}, folderPath: "",
  creationTime: Date.now(), lastMessageTime: Date.now(),
}
```

`temperature`, `modelName`, `topP`, and `frequencyPenalty` are stored on characters and
threads but are never passed to `aiTextPlugin` — they are effectively inert in the current
implementation.

### 10.2 Message

```js
{
  id, threadId, characterId,
  message: "Text of the message",
  name: null,
  order: id,
  hiddenFrom: [],                // [] | ["ai"] | ["user"]
  expectsReply: undefined | true | false,
  variants: [null],
  summariesEndingHere: {},       // { level: "summary text" }
  memoriesEndingHere: {},        // { level: [{ text, embedding }] }
  memoryIdBatchesUsed: [],
  loreIdsUsed: [],
  memoryQueriesUsed: [],
  messageIdsUsed: [],
  scene: null, avatar: {}, customData: {}, wrapperStyle: "",
  instruction: null,
}
```

### 10.3 Thread

```js
{
  id, characterId,
  name: "Thread name",
  modelName, textEmbeddingModelName,
  character: {},
  userCharacter: { name, roleInstruction, reminderMessage, avatar: {} },
  systemCharacter: { avatar: {} },
  isFav: false, folderPath: "",
  lastViewTime, lastMessageTime,
  currentSummaryHashChain: [],
  customCodeWindow: { visible: false, width: null },
  customData: {},
}
```

---

## 11 · Message Format & Wire Protocol

The AI character chat serializes conversation history into a simple bracketed format:

```
[[CharacterName]]: Message content here.

[[AnotherCharacter]]: Their reply.
```

- Messages are separated by `\n\n`.
- Standard stop sequences are `["\n\n[[", "\n[["]`; add `"\n\n"` to limit output to a
  single paragraph.
- Messages with `hiddenFrom: ["ai"]` are filtered out before sending.
- `<!--hidden-from-ai-start-->…<!--hidden-from-ai-end-->` strips inline sections from what
  the AI sees.
- Template variables: `{{user}}` → the user's name, `{{char}}` → the character's name.

---

## 12 · Hierarchical Summarization

Long conversations are compressed with multi-level summarization:

```
Level 0 = raw messages
Level 1 = summaries of ~1500-character blocks of level 0
Level 2 = summaries of level-1 summaries
...
```

**When to summarize** — compare the current conversation length against a token budget:

```js
const { countTokens, idealMaxContextTokens } = root.aiTextPlugin({ getMetaObject: true });
const budget = idealMaxContextTokens - 800;   // the 800-token buffer protects the prefix cache
const currentLength = countTokens(messageText + extraTextForAccurateTokenCount);
if (currentLength < budget) return;
(async () => { /* background summarization — non-blocking */ })();
```

**Batch injection** — write summaries to the database only once several are ready, so the
backend prefix cache is not invalidated on every message:

```js
if (window.__aiHierarchicalSummaryStuff[threadId].summariesReadyToInject.length >= 3) {
  for (const m of messagesToUpdate) {
    await db.messages.update(m.id, { summariesEndingHere: m.summariesEndingHere });
  }
  window.__aiHierarchicalSummaryStuff[threadId].summariesReadyToInject = [];
}
```

**Block size** — summarize ~1500 characters at a time. Larger blocks risk overflowing the
context when summarizing summaries at deeper levels.

```js
const numCharsToSummarizeAtATime = 1500;
```

**Context reconstruction** — walk backward through messages, collecting them while
monotonically climbing summary levels; a higher-level summary covers all the lower-level
raw messages it replaced:

```js
let highestLevelSeen = 0;
while (messages.length > 0) {
  const m = messages.pop();
  const level = m.summariesEndingHere
    ? Math.max(...Object.keys(m.summariesEndingHere).map(Number))
    : 0;
  if (level >= highestLevelSeen) { result.unshift(m); highestLevelSeen = level; }
}
```

---

## 13 · Memory & Lore

**Associative memory** — timeless facts extracted from conversations, stored in
`db.memories`. Embeddings are computed lazily at database-write time:

```js
if (window.textEmbedderFunction && m.memoriesEndingHere) {
  for (const lvl in m.memoriesEndingHere) {
    for (const mem of m.memoriesEndingHere[lvl]) {
      if (!mem.embedding) {
        [mem.embedding] = await window.embedTexts({
          textArr: [mem.text],
          modelName: thread.textEmbeddingModelName,
        });
      }
    }
  }
}
```

**Lorebooks** — static fact files hosted on `user.uploads.dev`, loaded and embedded at
thread start.

**Text embedding** — requires `{import:ai-character-chat-dependencies-v1}`:

```js
if (window.textEmbedderFunction) {
  const [vector] = await window.embedTexts({ textArr: ["text"], modelName: "default" });
  const dist = cosineDistance(vec1, vec2);   // lower = more similar
}
```

**Injection format** — retrieved memories and lore are wrapped so the model can disregard
them when irrelevant:

```
<ignore_this_if_irrelevant>
[MEMORIES & LORE]
• Bob was born in Paris (memory)
• The castle has three towers (lore)
</ignore_this_if_irrelevant>
```

---

## 14 · File Hosting & Share Links

Share links pack application state into a gzip-compressed upload and reference it by URL:

```js
async function generateShareLink(json) {
  if (!window.CompressionStream) {
    alert("Share links require a modern browser.");
    return;
  }
  const blob = await fetch("data:text/plain;charset=utf-8,"
    + JSON.stringify(json).replace(/#/g, "%23")).then(r => r.blob());
  const compressed = await compressBlobWithGzip(blob);
  const result = await root.uploadPlugin(compressed);
  if (result.error) { /* handle */ return; }
  const fileName = String(result.url)   // String() — url is a boxed String
    .replace("https://user.uploads.dev/file/", "");
  const charName = json.addCharacter.name.replace(/\s+/g, "_").replaceAll("~", "");
  return `https://perchance.org/${window.generatorName}?data=${charName}~${fileName}`;
}

async function loadDataFromShareUrl() {
  const dataParam = new URL(window.location.href).searchParams.get("data");
  const fileName = dataParam.split("~").slice(-1)[0];
  const blob = await fetch("https://user.uploads.dev/file/" + fileName, {
    signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : null,
  }).then(r => r.ok ? r.blob() : null).catch(console.error);
  if (!blob) { return null; }
  return JSON.parse(await (await decompressBlobWithGzip(blob)).text());
}

async function compressBlobWithGzip(blob) {
  const cs = new CompressionStream("gzip");
  return new Blob([await new Response(blob.stream().pipeThrough(cs)).blob()],
                  { type: "application/gzip" });
}
async function decompressBlobWithGzip(blob) {
  return new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).blob();
}
```

---

## 15 · Sandboxed Custom Code

User-supplied code is evaluated inside a separate sandboxed iframe with a strict origin
check and a timeout:

```js
const result = await root.evaluatePerchanceTextInSandbox(codeString, { timeout: 5000 });

async function evaluatePerchanceTextInSandbox(text, opts = {}) {
  const SANDBOX_ORIGIN = 'https://<sandbox-hex-id>.perchance.org';
  let iframe = document.querySelector('#perchanceCodeEvaluationSandboxIframe');
  if (!iframe) {
    iframe = document.createElement("iframe");
    iframe.src = SANDBOX_ORIGIN + "/ai-character-chat-sandboxed-executor";
    iframe.id = "perchanceCodeEvaluationSandboxIframe";
    iframe.sandbox = "allow-scripts allow-same-origin";
    iframe.style.cssText =
      "position:fixed;width:1px;height:1px;opacity:0.01;top:-10px;right:-10px;"
      + "pointer-events:none;border:0;";
    document.body.append(iframe);
    iframe._resolvers = {};
    let readyResolve;
    const ready = new Promise(r => readyResolve = r);
    window.addEventListener('message', event => {
      if (event.origin !== SANDBOX_ORIGIN) return;          // origin check is mandatory
      if (event.data.finishedLoading) { readyResolve(); return; }
      const { requestId, text } = event.data;
      if (iframe._resolvers[requestId]) {
        iframe._resolvers[requestId](text);
        delete iframe._resolvers[requestId];
      }
    });
    await ready;
  }
  const requestId = Math.random().toString();
  return new Promise((resolve, reject) => {
    iframe._resolvers[requestId] = resolve;
    if (opts.timeout) setTimeout(() => {
      if (iframe._resolvers[requestId]) reject("Sandbox timeout");
    }, opts.timeout);
    iframe.contentWindow.postMessage({ text, requestId }, SANDBOX_ORIGIN);
  });
}
```

Always verify `event.origin` against the expected sandbox origin before trusting a message.

---

## 16 · UI Utilities

**`confirmAsync`** — a promise-returning confirmation modal:

```js
async function confirmAsync(message, opts = {}) {
  return new Promise(resolve => {
    const overlay = Object.assign(document.createElement("div"), { tabIndex: 0 });
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:99999999;display:grid;place-items:center;"
      + "background:rgba(0,0,0,.65);font:16px/1.4 system-ui";
    overlay.innerHTML = `<div style="max-width:min(97vw,450px);padding:15px;border-radius:8px;
      background:light-dark(#fff,#222);color:light-dark(#000,#fff);">
      <p style="margin:0 0 20px;white-space:pre-wrap;">${
        message.replace(/[<>&]/g, m => ({ '<':'&lt;','&':'&amp;','>':'&gt;' }[m]))}</p>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button ${opts.hideCancel ? "hidden" : ""}>Cancel</button>
        <button autofocus>Okay</button>
      </div></div>`;
    const [cancelBtn, okBtn] = overlay.querySelectorAll("button");
    const done = val => { overlay.remove(); resolve(val); };
    cancelBtn.onclick = () => done(false);
    okBtn.onclick = () => done(true);
    overlay.onkeydown = e => {
      if (e.key === "Escape") done(false);
      else if (e.key === "Enter") done(true);
    };
    document.body.append(overlay);
    overlay.focus({ preventScroll: true });
  });
}
```

**`prompt2`** — a rich form modal:

```js
const result = await window.prompt2({
  fieldName: { type: "textLine", label: "Name", placeholder: "...", defaultValue: "" },
  bio:       { type: "text",     label: "Bio",  placeholder: "..." },
  model:     { type: "select",   label: "Model", options: ["good", "great"] },
  extra:     { type: "textLine", show: (v) => v.model === "great" },
});
// Returns null if cancelled, otherwise { fieldName: "...", ... }
```

**Loading and floating windows:**

```js
const modal = createLoadingModal("Processing...");
modal.delete();
const win = createFloatingWindow({
  header: "Title", body: element, initialWidth: 400, initialHeight: 300,
});
```

---

## 17 · Page Initialization

A typical AI-chat generator initializes in this order:

```
1. Open the IndexedDB database
2. Parse the URL for hash/data commands
3. Render the thread list
4. Auto-open the most recent thread (or add a starter character)
5. Reveal the UI, hide the loading modal
6. Persist browser storage
7. Preload the AI plugin
```

```js
async function checkForHashCommand() {
  let urlHashJson = null;
  try { urlHashJson = JSON.parse(decodeURIComponent(window.location.hash.slice(1))); }
  catch (e) {}
  if (urlHashJson?.addCharacter
      || new URL(window.location.href).searchParams.get("data")) {
    const data = await loadDataFromShareUrl();
    const character = data?.addCharacter;
    if (character) {
      const confirmed = await confirmAsync(
        "You've visited a character sharing link. This character may discuss sensitive"
        + " themes — please click cancel if you are under 18."
      );
      if (confirmed) {
        const result = await characterDetailsPrompt(character,
          { autoSubmit: urlHashJson?.quickAdd });
        if (result) {
          const newChar = await addCharacter(result);
          await createNewThreadWithCharacterId(newChar.id);
        }
      }
    }
    if (window.location.hash) { window.location.hash = ""; }
  }
}

async function tryPersistBrowserStorageData() {
  if (navigator.storage?.persist) await navigator.storage.persist();
}
```

Preload the AI plugin once at the end of initialization with
`root.aiTextPlugin({ preload: true })`.

---

## 18 · Common Patterns

**CORS bypass:**

```js
const r = await root.superFetch("https://api.example.com/data");
const text = await r.text();
const fresh = await root.superFetch(`https://api.example.com/data?_=${Date.now()}`);
```

**Conditional image generation** — only tell the model about the `<image>` tag when an
image is likely wanted:

```js
const imageKeywords = /\b(images?|pics?|photos?|selfie|draw|paint|generate)\b/i;
if (imageKeywords.test(fullContext)) {
  // append the IMAGE_TAG_HINT from §4.6 to the instruction
}
```

**iOS Safari viewport fix** — prevent auto-zoom when an input is focused:

```js
try {
  if (navigator.vendor?.includes('Apple') && window.innerWidth < 800
      && window.matchMedia("(pointer: coarse)").matches) {
    const m = document.querySelector("[name=viewport]");
    if (!m.content.includes("maximum-scale")) m.content += ", maximum-scale=1";
  }
} catch (e) {}
```

**Token budget management:**

```js
const { countTokens, idealMaxContextTokens } = root.aiTextPlugin({ getMetaObject: true });
const budget = idealMaxContextTokens - 800;
if (countTokens(roleInstructionText) > budget * 0.3) {
  roleInstructionText = truncateRoleInstruction(roleInstructionText, 3000);
}
// Drop the oldest messages first until the conversation fits within budget.
```

---

## 19 · Security Notes

### 19.1 SVG Uploads — Stored XSS Risk

`uploadPlugin` accepts SVG files and the CDN serves them verbatim as `image/svg+xml` with
no sanitization, no `Content-Disposition: attachment`, and no `Content-Security-Policy`. An
SVG can carry script (`<svg onload="...">`), and that script executes on the
`user.uploads.dev` origin when the file URL is opened directly in a browser. The `text/html`
MIME type is rejected, but SVG is an equally capable script-execution context and is not
filtered.

Implications for generators that allow user-controlled SVG uploads:

- Never surface a raw `user.uploads.dev` SVG URL for direct navigation by untrusted users.
- Embed uploaded images with `<img src="...">` rather than direct links — browsers do not
  execute scripts in SVGs loaded via `<img>`.

### 19.2 Plugin Input Validation

Passing a plain object or array as `instruction` to `ai-text-plugin` throws an uncaught
`TypeError` from inside the plugin. The plugin expects `instruction` to be a string (or a
Perchance DSL object). Always pass a string.

### 19.3 Camera & Microphone

A generator can call `navigator.mediaDevices.getUserMedia()` and prompt the user for camera
or microphone access — the sandbox does not block these requests. Users visiting
third-party generators should be aware that generators are able to make such prompts.

---

## 20 · Common Pitfalls

| Pitfall | Fix |
|---------|-----|
| `result === "string"` never matches | `String(result) === "string"` |
| `result.url === otherUrl` always false | `String(result.url) === otherUrl` |
| `stopReason === "stop_sequence"` always false | Use `"artificial"` |
| `stopReason === "max_tokens"` always false | Use `"artificial"` |
| Calling `root()` corrupts the Proxy | Only ever read `root.propertyName` |
| `root.myFunc()` returns `undefined` | The DSL→JS bridge is one-way; no return values cross |
| Output truncates silently near ~900 tokens | Chain sequential calls for longer output |
| `superFetch` auth header never arrives | Put credentials in URL parameters |
| Empty or inline-only image prompt hangs forever | Always pass real description text |
| Uploaded SVG is a stored-XSS vector | Never serve raw SVG CDN URLs; embed via `<img>` |
| `temperature` / `model` / `topP` have no effect | They are inert; not passed to the plugin |
| `idealMaxContextTokens` (6000) treated as the real cap | It is conservative; real server cap is ~6976 usable input tokens (8000−1024) [R25] |
| HTML panel stale after saving | CDN edge cache; wait for the purge or hard-refresh |
| `countTokens` treated as exact | It is an approximate estimate |
| 21+ `stopSequences` causes an error | The maximum is 20 |

---

## 21 · Quick Reference

**ai-text-plugin**

```
Effective options : instruction, startWith, hideStartWith, stopSequences, onChunk
Inert options     : temperature, model/modelName, topP, frequencyPenalty, maxTokens
Awaited result    : boxed String — use String(r) or r.generatedText
Sync handle       : Promise + stop, inputs, liveResponseText, textStream,
                    onFinishPromise, id, loadingIndicatorHtml, submitUserRating
stopReason        : "natural" | "artificial" | "error" | "user"
onChunk payload   : { textChunk, isFromStartWith, fullTextSoFar }
Context           : idealMaxContextTokens = 6000 (conservative); real server cap
                    maxContextTokens = 8000 - 1024 = 6976 usable input tokens [R25]
stopSequences max : 20
Output ceiling    : ~900 tokens — chain calls for more
Concurrency       : 1 per broker; text + image + upload run in parallel
Abort             : handle.stop() — resolves, stopReason "user", frees the slot
```

**text-to-image-plugin**

```
Sync return   : { iframeHtml, evaluateItem, onFinishPromise, toString }
Awaited result: boxed String — { canvas, dataUrl, inputs }
Resolutions   : 512x512, 512x768, 768x512, 768x768 (others silently rejected)
Defaults      : 512x512 bare; 768x768 in the AI chat
Orientation   : portrait/selfie → 512x768; landscape/wide-angle → 768x512
Inline params : (resolution:::) (negativePrompt:::) (seed:::) (guidanceScale:::)
                (size:::) (width:::) (height:::) (style:::) (saveTitle:::) (saveDescription:::)
negativePrompt: sent to server, NOT acted on by model [R25]
seed          : sent to server, NOT acted on by model (server reports seedUsed) [R25]
referenceImage: plumbed as {url, blur} but dead at the model (img2img ignored) [R25]
Ad-gating     : IMAGE gen is ad-gated (adAccessCode); TEXT gen is NOT [R25]
removeBackground: client-side (RMBG-1.4 via transformers.js); PNG output
Generation    : ~13–14 s
Empty prompt  : hangs forever — always pass real description text
```

**upload-plugin**

```
result.url   : boxed String — String(result.url) before any comparison
Hash         : bytes + MIME type (not bytes alone)
Size         : 5 MB accepted, 6 MB rejected (file_too_big)
Rejected MIME: text/html only
deletionUrl  : GET it to permanently delete the file
expires      : timestamp-format option, passed to the backend
SVG          : accepted but a stored-XSS vector — never serve raw SVG URLs
First upload : slow — runs a Turnstile verification
```

**super-fetch-plugin**

```
Methods      : GET / POST / PUT / DELETE — all work; bodies and redirects forwarded
Headers      : custom request headers are stripped — put auth in URL params
Cookies      : none — each call is cookie-isolated
Response size: no general cap
Caching      : by full URL — add ?_=Date.now() to bust
Bypass list  : jsdelivr, catbox, raw.githubusercontent, huggingface /resolve/ URLs
SSRF         : private/internal addresses are blocked
```

**root Proxy**

```
typeof root  : "function" — but NEVER call root()
root.missing : undefined — safe for feature detection
root.myList  : internal List object ($root, evaluateItem string, getName(), …)
root.myFunc(): undefined — the DSL→JS bridge is one-way
```

**Backend RPC**

```
Broker     : text-generation.perchance.org/embed (an iframe in the panel DOM)
Transport  : postMessage only — no fetch/XHR/WebSocket leaves the sandbox
Sequence   : embedIsReady → verified ×2 → streamData ×N → streamEnd
requestId  : "aiTextCompletion" + 17 digits
```



---

## 22 · Plugin API Reference

All names below are valid `{import:...}` targets (12 confirmed importable generators).
Seven subdomain names (`connect-plugin`, `count-plugin`, `rss-feeds-plugin`,
`browser-runner`, `editor-collab`, `editor-copilot`, `generated-images`) are NOT
importable — they are backend-only infrastructure with no Perchance generator.

### Function Plugins

**`serverPlugin(worldName)`** — WebTransport/WebSocket multiplayer gateway.

Returns a transport object with datagrams and bidirectional/unidirectional streams for
real-time multiplayer communication. Each generator is its own "universe"
(`window.generatorPublicId`); worlds are isolated within the universe.

```js
const transport = await root.serverPlugin("my-world");
// World name regex (from source): /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
//   Valid:   "my-app", "test-world", "a", "a-b-c", "abc123"
//   Invalid: "123abc" (digit start), "my_world" (underscores),
//            "MY-APP" (uppercase), "my world" (space), "my.app" (dot)
// Returns a transport object (WebTransport or WebSocket-backed):
//   transport.datagrams.readable  — ReadableStream (fire-and-forget messages)
//   transport.datagrams.writable  — WritableStream
//   transport.incomingBidirectionalStreams  — ReadableStream of {readable, writable}
//   transport.incomingUnidirectionalStreams — ReadableStream of ReadableStream
//   transport.createBidirectionalStream()  — Promise<{readable, writable}>
//   transport.createUnidirectionalStream() — Promise<WritableStream>
//   transport.close({closeCode, reason})
```

Handshake (from source — the `$output` creates an iframe to
`server-plugin.perchance.org/embed`):

```
1. iframe loads  →  embed sends {type:"loaded"}
2. parent sends  →  {type:"init", universe, origin, webtransportOrigin, generatorName, ...}
3. embed sends   →  {type:"ready"}
4. parent sends  →  {type:"connect", world, requestId}
5. embed sends   →  {type:"connect_ready", wtUrl, wsUrl, token, expiry,
                      webtransportCertHashes}   (or {type:"connect_error"})
6. client opens WebTransport to wtUrl (or WebSocket to wsUrl as fallback)
   + later: {type:"evict"}, {type:"token_refresh"}, {type:"meta"}, {type:"disconnect"}
```

`universe = window.generatorPublicId`. World name regex:
`/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/`. WebTransport endpoint:
`wt0.server-plugin.perchance.org`; WebSocket fallback is triggered by `#forceUseWS=1` in the
URL hash.

**WS binary framing [VERIFIED R25].** Frame types: `DATAGRAM=1`, `STREAM_OPEN_BI=2`,
`STREAM_OPEN_UNI=3`, `STREAM_DATA=4`, `STREAM_FIN=5`, `CONTROL=6`, `CLOSE=7`. Stream ids are
u32 big-endian. A `CONTROL` frame is JSON `{type:"token_refresh", token, expiry}`. A `CLOSE`
frame is a u32 code followed by a UTF-8 reason. Tokens expire and are refreshed over a
dedicated control stream.

**`commentsPlugin(opts)`** — Channel-based comment system with moderation.

```js
const c = root.commentsPlugin();             // default channel
const c = root.commentsPlugin({channel: "my-channel"});
// Returns:
// {
//   submit(text)                     // post a comment (async — needs iframe context)
//   banUser(userId)                  // ban a user from commenting
//   unbanUser(userId)                // unban a user
//   setNicknameForNextComment(name)  // set display name before posting
//   setAvatarUrlForNextComment(url)  // set avatar URL before posting
//   channel                          // string — current channel name
//   comments                         // array — loaded comments (initially [])
//   inputText                        // string — current input text
// }
// commentsPlugin({getMetaObject:true}) returns the same object.
// The plugin uses comments-plugin.perchance.org as its backend.
```

The source code (1,094 lines) reveals it creates an iframe with `postMessage` RPC,
supports channel rules (`channelName+u:username,ids:channel`), and has nickname/avatar
management for anonymous posting.

**Architecture:** The `$output` function returns a `<span>` marker tag (not an iframe)
with `data-folder-name="generatorName+channelName"`. The Perchance runtime detects this
marker and replaces it with the full comment widget iframe. Methods like
`setNicknameForNextComment` work after the marker is rendered into the DOM.

**Important:** The comments iframe is NOT automatically injected. It is only created when
the plugin's `$output()` function is called (which renders the comment widget HTML).
Without the rendered widget, `setNicknameForNextComment`, `setAvatarUrlForNextComment`,
`submit`, and `inputText` all throw `"Cannot read properties of undefined (reading
'postMessage')"`. The `channel` and `comments` properties work without the iframe.

#### comments-plugin — Client API Reference [VERIFIED R25]

The server code is private and coupled to the backend (fork-warned), so only the **client
API** is documented here, sourced from the archive `ref/comments-plugin_2.txt` (NOT a live
embed — the embed `comments-plugin.perchance.org/embed/` is not directly fetchable → 404).

**Usage:**

```
commentsPlugin = {import:comments-plugin}
[commentsPlugin(options)]                  // render the widget
[com = commentsPlugin(options)]            // grab the programmatic handle
```

**Channels.** The `channel` option = a separate comment store; channel names are lowercase
letters/numbers/hyphens only. `channelLabel` overrides the display text (any chars).
Channel-name **suffixes**:

| Suffix | Effect |
|--------|--------|
| `+u:alice\|bob` | username-permissioned — only those usernames may post |
| `+ids:channel` | scope user-IDs to this channel rather than sharing across the page |
| `chat+ids:channel,u:alice\|bob` | combinable — **ORDER-SENSITIVE**: reordering yields a *different* channel |

**Identity — IDs are IP-derived [significant].** A user's ID is **derived from their IP
address** (full ID format like `MW22-8e5123…`). Banning a user = banning that IP, so
shared-IP users (e.g. everyone at one school) share an ID. Commenter IDs implicitly encode
IP/region.

**Rate limiting is CLIENT-configured** via
`rateLimits = "1 per minute, 3 per 10 minutes"` (comma-separated rules; any limit hit → the
comment is blocked/hidden). The server's own hard ceiling is not exposed.

**Programmatic handle** (`com = commentsPlugin(opts)`):

```js
com.submit("text")
com.inputText                       // get/set the input box text
com.setNicknameForNextComment(name)
com.setAvatarUrlForNextComment(url)
com.banUser(id)
com.unbanUser(id)
```

**Callbacks** (in `options`):

```js
onLoad(comments)        // initial array; items have .message
onComment(comment)      // a new comment arrived
onInputTextChange
beforeSubmit(text)      // return null → cancel; return a string → replace; return nothing → proceed
```

**Moderation:**

- `adminPasswordHash = sha256("perchance-comments-plugin|" + password)` — admin logs in via
  Ctrl/Cmd+L.
- `bannedUsers` — list of IP-derived IDs.
- `bannedWords` — supports `/regex/` patterns; common slurs are banned by default; general
  profanity is NOT banned by default.

**Other options:** custom emojis (images MUST be hosted on perchance.org / upload →
`user.uploads.dev`; trigger words = letters/numbers/underscores; `@import =
{import:huge-emoji-list}` for ~80k emojis; only one `@import` allowed); `slashCommands`;
visual style options (`containerStyle`, `messageBubbleStyle`, `loadFonts`,
`forceColorScheme`); `hideComments`, `hideDates`, `newestCommentsAtTop`,
`replacedDuringUpdate=true` (fresh box on randomize), `hideCommentsBeforeDate`.

**`fullscreenBtn(element, options, callback)`** — Fullscreen toggle button (arity 3).

**`dynamicImport(generatorName, opts)`** — Lazy-load another generator at runtime (arity 2).

### Object Plugins

**`postsPlugin`** — Post/content database with voting and feeds. Backed by
`posts-plugin.perchance.org/embed` (live server currently **down — HTTP 522**). **The plugin
source has two confirmed client bugs that make it non-functional [VERIFIED R25]:** (1) it
listens on the **cross-origin** `iframe.contentWindow.addEventListener` (which never fires),
and (2) it does `delete requestIdToResolver[requestId]()` — which deletes the *result of
calling* the resolver, so responses never resolve. The intended API from source:

```js
const posts = root.postsPlugin;
// Top-level (default channel ''):
//   posts.add(post)            posts.addMany(posts)
//   posts.get(id)              posts.getMany(ids)
//   posts.query(opts)          posts.stream(opts)
// Channel-scoped (posts.<channel>.*, e.g. posts.blog):
//   .add(post)   .get(id)   .vote(id, -1..1)   .seen(id)
//   .update(id, partialObj)   .replace(id, fullObj)
//   .query({sort, tags, after, limit})   // sort: "new"/"best"/"trending"/"value"
//   .feed({sort, period})                 // rendered feed widget (for DSL)
//
// Post shape: { id?, content, tags?, title?, _channel(default '') }
```

The config system supports **weighted voting** (`increment = userTrustScore`), score
**decay**, per-key `max` votes, `publicValues:false`, and **DirectMessages with Ed25519**
(`readKeyMapper = Ed25519`).

**`kvPlugin`** — Key-value storage. Empty object on `root.*`; the full API is on
`kvPlugin.folder`:

```js
const folder = root.kvPlugin.folder;
// CRUD (all operations 0-5ms):
//   folder.set(key, value)       // write — types preserved (string, number, object, boolean, array)
//   folder.setMany(entries)      // batch write — takes an ITERABLE, NOT a plain object
//   folder.get(key)              // read — returns the value with original type preserved
//   folder.getMany([keys])       // batch read — returns array; null for missing keys
//   folder.update(key, fn)       // fn receives old value, returns new: update(k, v => v + "!")
//   folder.has(key)              // returns boolean true/false
// Delete:
//   folder.delete(key)           // get() returns undefined after delete
//   folder.deleteMany([keys])    // batch delete
//   folder.clear()               // delete ALL keys — use with caution
// Enumeration:
//   folder.keys()                // returns array of key strings
//   folder.values()              // returns array of values (types preserved)
//   folder.entries()             // returns array of [key, value] pairs
```

Type preservation: `42` round-trips as `number`, `{x:1}` as `object`, `true` as
`boolean`. Overwriting a key replaces the value. Operations are synchronous-fast
(0-5ms) despite being async.

**kv-plugin preserves types EXACTLY across a get/set round-trip [VERIFIED R25]** — verified
for string, number, float, nested object, mixed array, boolean, and `null` (no
JSON-flattening or coercion). Backend is IndexedDB `folder-db-kv-plugin`, per-generator
partitioned, LOCAL to the browser (not shared across users).

**Backend:** IndexedDB database `"folder-db-kv-plugin"` v1. The database name is
derived from `this.$root.$moduleName` in the plugin source, so forked plugins get
their own isolated database. No server-side persistence — data is local to the browser.

### DSL List Plugins

`dbPlugin = {import:db-plugin}` resolves to the DSL tree root (52 `$`-prefixed internal
keys). It is NOT a database API — `kvPlugin` is the database. The `$moduleSpace` key on
`dbPlugin` lists all loaded modules.

`bugReport = {import:bug-report-plugin}` is a DSL list with a `$output` handler
containing `createTemporaryDebugInfo`.

### Invalid Import Names (backend-only infrastructure)

These subdomain names exist but are NOT importable generators:

```
connect-plugin      → undefined on root (backend: real-time connections)
count-plugin        → undefined on root (backend: analytics counters)
rss-feeds-plugin    → undefined on root (backend: RSS feed generation)
browser-runner      → undefined on root (backend: headless browser)
editor-collab       → undefined on root (backend: collaborative editing)
editor-copilot      → undefined on root (backend: AI editor assistant — HTTP 404)
generated-images    → undefined on root (backend: image CDN)
```

### Broker Protocol Details

**Only 3 broker iframes** are injected when all 12 valid plugins are imported:

| Iframe | Plugin | Protocol |
|--------|--------|----------|
| `text-generation.perchance.org/embed` | ai-text-plugin | `embedIsReady` → auto-`verified` |
| `upload.perchance.org/embed#{"email":false,"sessionToken":false}` | upload-plugin | `uploadEmbedIsReady` (fires 2×) → `anonUploadResponse` |
| `posts-plugin.perchance.org/embed` | posts-plugin | Silent (no auto-announce) |

Upload auth passes via URL **hash** (not query params): `{"email":false,"sessionToken":false}`.

Upload response: `{type:"anonUploadResponse", requestId, result:{url:BoxedString, size, error, deletionUrl}}`.

**Complete postMessage vocabulary** (from broker source code analysis):

Text-generation broker: `embedIsReady`, `verified`, `verifying`, `streamData`,
`streamEnd`, `streamError`, `tokenizerPerformance`, `ttft_withRecentRequest`,
`ttft_withoutRecentRequest`.

Image-generation broker [VERIFIED R25]: `imageSavedToSubChannel`, `readyForData`,
`plsGibAccessCodeForAdPoweredStuff` (requests an `adAccessCode` ad token, minted via
`ads.perchance.org`), `custom`, `ImageFeatureExtractor` (CLIP feature extraction),
`finished`, `updateContentGuardVisibility`. Image generation is **queue-based** (`joinQueue`,
`updateQueuePos` in broker source).

The `finished` postMessage carries `{type, dataUrl, seedUsed, id}` — note `seedUsed`: the
server reports back its OWN seed (further evidence the client `seed` is not honored).

**KEY POINT: image generation is ad-gated; text generation is NOT [VERIFIED R25].** The image
broker fires a `plsGibAccessCodeForAdPoweredStuff` postMessage to obtain an `adAccessCode`
minted via `ads.perchance.org`, and the image request carries it. Text generation has no such
ad gate.

**Image generate request [VERIFIED R25]:**

```
POST image-generation.perchance.org/api/generate
  ?prompt=&seed=&resolution=&guidanceScale=&negativePrompt=
  &channel=${saveChannel}&subChannel=&userKey=
  # plus an adAccessCode (ad-completion proof)
```

Upload broker: `uploadEmbedIsReady`, `anonUploadResponse`, `file`.
Outgoing from plugin: `anonUploadRequest`, `init`.

**Text-generation broker internals** (from 72,969-byte embed source) [R23]:

- Streaming wire format: `postMessage({type:"streamData", requestId, value})` —
  `value` is `{text: <delta>}`, the new delta (NOT cumulative) [VERIFIED R25].
  Stop: `{type:"stopStream", requestId}`. A `streamKeepAlive` mechanism is present.
- LRU thread pool: `moveToLeastRecentlyUsedThread()` selects thread.
  User identity: `localStorage["userKey-{thread}"]`, sent as URL query param.
- Prompt truncation: `middleOut` algorithm (`middleOutWithoutTokenizer()` for
  fast mode). Sets `postData.didMiddleOut = true` when active.
- Hash function: `djb2Hash(str)` — `hash=5381; hash=((hash<<5)+hash)+charCode`.
- **Tokenizer: DeepSeek-R1-0528**, loaded **client-side** from HuggingFace
  (`deepseek-ai/DeepSeek-R1-0528` `tokenizer.json` + `tokenizer_config.json`), with a
  content-CDN mirror fallback at `user.uploads.dev/file/f27e15b2…json` and
  `user.uploads.dev/file/db8eb69f…json`. Falls back to the char estimate (3.9 base / 3.4
  French) if it fails to load (≤2 retries) or would take >4000 ms [VERIFIED R25].
- `countTokens`: base64-embedded bigram approximation model (magic header `"DBG1"`),
  ~80× faster / 200× smaller than the HF tokenizer [VERIFIED R25].
- Quality feedback: `/api/rateGeneratedText` endpoint (→ `{"status":"success"}`).
- Analytics: `POST /api/clientPerformanceAnalytics` every 2 min (1/20-sampled
  `tokenizerPerformance` events) [VERIFIED R25].
- Error tracking: Rollbar code present but **DISABLED / commented out** [VERIFIED R25].
- Token limits: real server cap `maxContextTokens = 8000 - 1024 = 6976` usable input tokens;
  `idealMaxContextTokens = 6000` returned to clients is conservative [VERIFIED R25].
- Turnstile flow: `verifyUser` with `alreadyVerifying` guard.

**Image-generation broker internals** (from 76,155-byte embed source) [R23]:

- Full parameter set: `joinQueue({prompt, seed, resolution, guidanceScale,
  negativePrompt, referenceImage})`.
- Ad token flow: `updateAdAccessCode()` — Promise-based, listens for postMessage
  from parent with the 64-hex code. Tokens are time-bucketed (same token across requests).
- Background removal: `removeBackground(imageUrl)` — uses transformers.js with
  RMBG-1.4 model (cached in Cache API `"transformers-cache"`).
- Gallery: `saveImageToGallery()` — modal UI with subChannel selection.
- Content moderation: `contentGuardMessageEl` CSS class.

**Image API endpoints (9) [VERIFIED R25]** — mostly undocumented, on
`image-generation.perchance.org/api/`:

| Endpoint | Purpose |
|----------|---------|
| `generate` | Generate an image (ad-gated; see request shape above) |
| `getUserQueuePosition` | Current position in the generation queue |
| `awaitExistingGenerationRequest` | Request **coalescing/dedup** of identical in-flight generations |
| `downloadTemporaryImage` | Fetch a just-generated (not-yet-saved) image |
| `saveImageToGallery` | Persist an image to the public gallery |
| `flagImage` | Moderation report on an image |
| `canExpireImageIds` | Whether given image IDs can be expired |
| `checkUserVerificationStatus` | → `{"status":"not_verified"}` when unauthenticated |
| `verifyUser` | Turnstile verification |

**Content guard [VERIFIED R25]** is a **configurable NSFW filter** with an over-18 checkbox UI
(`contentGuardOver18CheckboxEl`, `ContentGuardVisibility`) — it is **not a hard block**. The
`updateContentGuardVisibility` postMessage toggles its display.

**Runtime globals** set by the Perchance platform:

```
window.generatorName           // generator slug ("my-gen")
window.generatorPublicId       // 32-hex string (= sandbox subdomain)
window.generatorLastEditTime   // unix timestamp of last edit
window.update(selector?)       // trigger DSL re-render
window.createPerchanceTree     // DSL parser function
window.logPerchanceListsFunctionError
window.clearPerchanceErrors / window.__clearPerchanceErrors
window.ignorePerchanceErrors
```

**⚠ DSL parser curly-brace warning:** The Perchance DSL parser scans the
*entire* HTML panel — including `<script>` tag content — for `{...}` patterns
before JavaScript executes. String literals containing `{import:...}`,
`{word}`, `{A|B}`, or `{1-10}` will be interpreted as DSL commands and break
your code. To avoid this, base64-encode complex scripts:
`<script>eval(atob("base64encodedscript"))<` + `/script>`, or build such
strings at runtime with `String.fromCharCode(123)` for `{`.

**Google Analytics:** Property ID `G-YJWJRNESS5`. Cloudflare Real User
Monitoring at `/cdn-cgi/rum`. Tracking keys via `/api/count?keys=uaine,abpsgp`.

### The `root` Proxy [VERIFIED R23]

`root` is a **Proxy wrapping a function** (`typeof root === "function"`), not
a plain object. Behavioral details:

- **get trap** works: `root.myList` returns the DSL list proxy.
- **set trap** works: `root.x = 42` stores and retrieves correctly.
- **has trap** works: `"aiTextPlugin" in root` → `true`, `"nonExistent"` → `false`.
- **delete trap** works: `delete root.x` → `true`.
- **ownKeys trap is BUGGY**: `Object.keys(root)` throws `"ownKeys trap result
  did not include 'prototype'"` because the handler returns DSL list names but
  omits `prototype` (required for function-based Proxy targets). Do NOT call
  `Object.keys(root)`.
- **toString()** picks a **random** top-level list name each call (nondeterministic).
- **constructor** = `bound Object`.

**Dollar-prefixed metadata properties** (accessible via get, but NOT in has trap):

| Property | Type | Value |
|---|---|---|
| `root.$moduleName` | string | generator slug (e.g. "my-gen") |
| `root.$meta` | object | the `$meta` DSL block contents |
| `root.$root` | function | circular reference back to root |
| `root.$children` | object | child nodes of the DSL tree |
| `root.$perchanceCode` | string | **full DSL source** of the generator |
| `root.$output` | undefined | NOT accessible (lives in tree, not proxy) |

### Upload Plugin Behavior [VERIFIED R23]

- **Result keys:** `url`, `error`, `size`, `deletionUrl`
- **result.url is a boxed String** (`[object Object]`) — same as aiTextPlugin.
  Always use `String(result.url)` to get a primitive string.
- **File host:** `user.uploads.dev` (NOT `user-uploads.perchance.org`)
- **Deletion URLs:** `https://user.uploads.dev/file/{hash}.{ext}`
- **Type restriction:** `text/plain` Blobs return `error: "invalid_data_type"`.
  Upload plugin accepts image types; other types may be rejected.
- **Error on reject still returns deletionUrl** — partial result object.

### Cross-Tab Coordination [VERIFIED R23]

The platform does NOT use standard browser cross-tab APIs:
- BroadcastChannel: channels can be created but no messages are exchanged.
- SharedWorker: available but not used by the runtime.
- localStorage events: 0 received.
- navigator.locks: no locks held or pending.
Tab coordination likely uses server-plugin's WebTransport/WebSocket connection
(when server-plugin is operational).

**Browser storage** used by the platform:

- IndexedDB: `"folder-db-kv-plugin"` v1 — the kvPlugin.folder backend (local to browser)
- Cache API: `"transformers-cache"` (2 entries) — RMBG-1.4 model cache for `removeBackground`
- localStorage/sessionStorage: empty in the sandbox (used by the editor for backups)
- Cookies: ad tracking (`_gid`, `_pubcid`, `__qca`, `cto_bundle`)

### Complete DSL List Accessor Map (35 accessors)

Every DSL list object (from `root.myList`) exposes these accessors and methods:

```
Selection:     evaluateItem    → random item as string ("charlie")
               selectOne       → random item as LIST ITEM OBJECT (not a string!)
               selectAll       → array of ALL items as list item objects
               selectUnique(n) → array of n unique item objects
               selectMany(n)   → array of n item objects (may repeat)
Metadata:      getName         → list name string ("monitorTestList")
               getLength       → item count as number (3) — PROPERTY, not method
               getOdds         → odds value (1)
               getParent       → parent list in the DSL tree
               getSelf         → the list object itself with named children
Structure:     getPropertyKeys → array of property names (keys with = values)
               getPropertyNames→ same as getPropertyKeys
               getChildNames   → array of child item text (["alpha","bravo","charlie"])
               getFunctionNames→ array of function names defined on the list
               getAllKeys       → all keys (children + properties + functions)
Content:       getRawListText  → raw DSL source ("listName\n  alpha\n  bravo\n")
               joinItems(sep)  → "alpha, bravo, charlie"
               sumItems        → concatenates "0" + all items (not numeric sum for strings)
               replaceText(a,b)→ evaluates a random item with replacement applied
Cloning:       consumableList  → the list object with named children
               createClone     → DOES NOT EXIST on list objects (throws)
String:        toString()      → evaluates to a random item string
               valueOf()       → same as toString()
Case:          upperCase       → random item uppercased ("ALPHA")
               lowerCase       → random item lowercased ("alpha")
               titleCase       → random item title-cased ("Bravo")
               sentenceCase    → random item sentence-cased ("Bravo")
Grammar:       pluralForm      → random item pluralized ("alphas")
               singularForm    → random item singularized ("alpha")
               pastTense       → THROWS "PERCH is not defined" (needs top-editor context)
               presentTense    → random item with present tense ("alphas")
               futureTense     → "will " + random item ("will alpha")
               negativeForm    → random item ("alpha")
```

Case and grammar transforms pick a **random item** first, then apply the transform.
Each access may return a different item. `pastTense` requires the `PERCH` global
which is only available in the top editor, not in panel JavaScript.

`selectOne` and `selectAll` return **list item objects** (the same type as `root.myList`),
not plain strings. Use `String(list.selectOne)` or `list.evaluateItem` for a string.



### PERCH Engine Runtime (~100 methods)

**Important:** `window.PERCH` and `window.nlp` exist ONLY on the parent/editor
frame — they are NOT available in the sandbox iframe where panel JS (`$output`,
HTML panel scripts) executes. These methods are used internally by the runtime
to process DSL, not as a public API for generator authors.

The `window.PERCH` object is the DSL runtime engine. Key method groups
(from saved page source analysis of `pa7xdy82ob.html`):

**DSL parsing & evaluation:**
`createPerchanceTree`, `evaluateText`, `evaluateCurlyBlock`, `evaluateSquareBlock`,
`splitTextAtAllBlocks`, `splitTextAtCurlyBlocks`, `splitTextAtSquareBlocks`,
`splitUpCurlyOrBlock`, `processEscapedBrackets`, `processEscapedCharacters`,
`normaliseLineIndentsToTabs`, `stripCommentFromLine`, `collectTemplatableTextChunks`,
`collectNonHoistedTopLevelDeclarations`, `collectImportedModuleNamesFromText`.

**List item methods (exposed as DSL accessors):**
`selectOneMethod`, `selectManyMethod`, `selectManyMethodStringNum`,
`selectUniqueMethod`, `selectAllMethod`, `consumableListMethod`,
`joinItemsMethod`, `replaceTextMethod`, `toStringMethod`, `valueOfMethod`.

**Grammar transforms (powered by compromise.js v11.12.4):**
`pastTenseMethod`, `presentTenseMethod`, `futureTenseMethod`, `pluralFormMethod`,
`singularFormMethod`, `negativeFormMethod`, `pluralize`.

**Case transforms:**
`upperCaseMethod`, `lowerCaseMethod`, `titleCaseMethod`, `sentenceCaseMethod`.

**Template & DOM:**
`updateOutput`, `updateOutputMessageHandler`, `updateTemplatedNodes`,
`addNodeMethods`, `addNodeTemplates`, `addAttributeTemplateToEl`,
`isTemplatableAttributeName`, `isDomEventAttributeName`, `domEventAttributeNames`,
`executeScriptTag`, `executeScriptTags`, `htmlToElements`,
`reAttachAllDomElementEventsWithRoot`, `reAttachSpecificDomElementEventWithRoot`,
`getAllDescendentNodesIncludingTextNodes`, `getAllTextNodeDescendents`.

**Curly-block functions** (`{A|B}`, `{import:x}`, `{a/b}`, `{1-10}`, `{s}`):
`curlyFunctions`, `curlyFunction_Or`, `curlyFunction_Import`,
`curlyFunction_Range`, `curlyFunction_A`, `curlyFunction_S`.

**Node/tree manipulation:**
`duplicatePerchanceNode`, `clonedNodeToOriginalNodeWeakMap`,
`getPrimitiveNodeDetails`, `getFunctionDetails`, `getFunctionHeaderDetails`,
`getFunctionArgumentsDetails`, `getInlineFunctionDetails`,
`getTextOddsDetails`, `oddsTextToNumber`, `chooseRandomTextByOdds`.

**Error handling:**
`perchanceError`, `perchanceErrorString`, `showPerchanceErrorBox`,
`clearPerchanceErrors`, `ignorePerchanceErrors`, `currentPerchanceErrorCount`,
`lastPerchanceErrorTime`, `maxPerchanceErrorCount`.

**Utility:** `AvsAnSimple`, `escapeHTMLSpecialChars`, `getAllMatches`,
`isValidJavaScriptIdentifier`, `isServedOnPerchanceSubdomain`,
`updateGeneratorMetaData`, `dynamicMetaDataCache`.

**NLP library:** `PERCH.nlpCompromise` — compromise.js v11.12.4, the NLP engine
behind grammar transforms. Loaded from `perchance.org/lib/compromise-11.12.4.min.js`
(URL-encoded inline in the runtime). Provides POS tagging, verb conjugation,
noun pluralization, and other morphological transforms.

### Editor Infrastructure

**Editor bundle:** `editors.bundle.min.js` (847KB) — the CodeMirror-based editor with:

- **Collab editing:** WebSocket to `wss://editor-collab.perchance.org` for real-time
  multi-user editing. Key flow: `getCollabEditKey` → share link → `validateCollabEditKey`.
  Keys can be regenerated (`regenerateCollabEditKey`) or deleted (`deleteCollabEditKey`).

- **AI copilot:** Two POST endpoints on `editor-copilot.perchance.org`:
  - `/api/autocomplete` — inline code completion (triggered by Tab, stored in
    `localStorage.copilotIsEnabledV2`). Uses prefix/suffix context up to 20K chars.
    Returns HTTP 400 from sandbox — requires editor context.
  - `/api/findBugsInCode` — static analysis of DSL code, returns bug annotations
    (empty `[]` array when no bugs found). Also returns 400 from sandbox.
  Both endpoints are live but only accept requests from the editor frame
  (`editors.bundle.min.js`), not from the sandbox iframe.
  Copilot can be toggled; state is in `localStorage.copilotIsEnabledV2`.

- **Linting:** ESLint v9.14.0 (`eslint-linter-browserify`) + htmlparser2 v9.1.0,
  both loaded from `/lib/` on perchance.org.

- **User session:** `app.store.data.user` = `{email, sessionToken, loggedIn}`.
  Generator data: `generatorData` = `{name, imports, canLink}`.

### Debug & Diagnostics

- `null.perchance.org/debug-freeze` — debug freeze mode URL
- `window.DEBUG_FREEZE_MODE` — enables freeze diagnostics
- `window.codeWarningsArray` — collected editor warnings
- `window.diffStuff` / `window.dmp` — diff-match-patch for generator versioning
- `window.downloadLocalBackup` / `window.downloadTextFile` — backup utilities
- Ad system: `window.freestar` (Freestar ad network), `window.adsAreShowing`,
  `window.forceDisableAds`, `window.advertHeight`

---

## 23 · Community Plugins Catalog

A non-exhaustive but representative map of widely-used community plugins. Import any of
them with `name = {import:plugin-slug}` and call as `name(args)` or `name.subMember(args)`.
Source for each is on `perchance.org/<slug>#edit`. The full directory is at
<https://perchance.org/plugins>.

### State, Persistence, and Variables

**`createInstance` / `create-instance-plugin`** — freeze a "blueprint" list into an
"instance" whose `selectOne` results are fixed in place. Critical for hierarchical
randomization where you want `c.eyeColor` and `c.height` to stay consistent.

```
createInstance = {import:create-instance-plugin}

character
  name = {Molly|Anita|Murphy}
  age = {18-90}
  // NOTE: only `=` properties freeze. Sub-lists (no equals sign) keep randomizing —
  // collapse them to `mood = {happy|sad}` to fix them too.

output
  [c = createInstance(character), ""] [c.name] is [c.age]. [c.name] said hi.
  // → "Murphy is 22. Murphy said hi."
```

`create-instances-plugin` (plural) creates multiple at once.

**`remember-plugin`** — persist variables to `localStorage` so they survive page reloads.
Pass `@inputs` to auto-persist input field values.

```
remember = {import:remember-plugin}

// At the top of HTML panel:
[remember(root, "score, level, @inputs")]
[remember(root, "@forget")]   // wipe everything and reload
```

**`kv-plugin`** — namespaced async key-value store backed by IndexedDB. Usable as
`kv.myStoreName.get/set/keys/entries/delete/clear/update/setMany/getMany/deleteMany`.
Stores survive forever; each generator has its own partitioned IDB.

```
kv = {import:kv-plugin}

async start() =>
  await kv.scores.set("user42", { score: 100, level: 3 })
  let entries = await kv.scores.entries()    // [[key, value], ...]
```

**`locker-plugin`** — "lock" a randomized value in place so it survives `update()`. Shows
a 🔓/🔐 toggle button for the user. Useful for character generators where you randomize
a face but want to keep it while rerolling clothes.

```
lockable = {import:locker-plugin}

output
  Name: [lockable("characterName", name.selectOne)]
        [lockable("characterName_button")]   // <-- 🔓/🔐 toggle button
```

**`seeder-plugin`** — deterministic randomization. Override `Math.random` with a seeded
PRNG so the same seed always produces the same generator output. Useful for shareable
"share this exact result" URLs.

```
seed = {import:seeder-plugin}

// Set seed from URL parameter so same URL → same result:
[seed(window.location.hash || "default")]

// Or with a cache option to memoize:
[seed("hello world", "cache")]
[seed("hello world", true)]              // forceUpdate (legacy boolean form)
[seed("")]                                // un-seed (restore Math.random)
```

**`url-params-plugin`** — exposes URL query params as a Perchance-side object. Read with
`[urlParams.foo]`.

```
urlParams = {import:url-params-plugin}

output
  Hello [urlParams.name || "stranger"].
  // visit ?name=Alice → "Hello Alice."
```

**`literal-plugin`** — escape user-controlled text so it can be safely interpolated into
DSL templates without triggering `[…]` / `{…}` interpretation. Essential whenever you put
user input into an `instruction` list.

```
literal = {import:literal-plugin}

// User typed "[evil] {code}" into an input — without literal() it would be evaluated:
instruction
  The character's name is: [literal(nameEl.value.trim())]
  $output = [this.joinItems("\n")]

// Optional second arg "+html" also HTML-escapes:
[literal(userInput, "+html")]
```

### Content & Formatting

**`markdown-plugin`** — render Markdown to HTML. Pass either a string or a Perchance list
(it calls `.getRawListText` and strips the first line + leading indent for you).

```
md = {import:markdown-plugin}

myText
  # A heading
  Some **bold** content.
  \s
  - A list item

[md(myText)]
```

**`perchance-callouts`** — Obsidian-style callouts (`note`, `warning`, `tip`, etc.) with
optional collapsibility and per-callout styling. Accepts either a Perchance list with
nested `type`, `header`, `data`, `collapsible.state`, `style.*` properties, or an inline
JS object.

```
callout = {import:perchance-callouts}

exampleNote
  type = warning
  header = Heads up
  data = Pay attention.
  collapsible
    state = open

[callout(exampleNote)]
[callout({type:"note", header:"Inline", data:"or pass an object"})]
```

Types include `note`/`info`/`abstract`/`todo`/`tip`/`done`/`question`/`warning`/`fail`/
`danger`/`bug`/`example`/`quote`. Icons are Bootstrap Icons.

**`docs-plugin`** — a Markdown-based documentation site builder. Author each page as a
`<script type="text/markdown" data-hash="page-id" data-title="Page Title">` block, then
call `docsPlugin()` once. Handles navigation, anchor scrolling, code highlighting.

```html
<script type="text/markdown" data-hash="overview" data-title="📘 Overview">
# Overview
Hello world.
</script>

<script type="text/markdown" data-hash="api" data-title="API">
# API
</script>

<script>docsPlugin()</script>
```

**`combine-emojis-plugin`** — composite multiple emojis into a single image (Google's
emoji-kitchen API).

**`text-editor-plugin-v1`** — higher-performance `<textarea>` replacement with inline
styling (asterisks → italic, etc.). Used in the canonical AI chat for the message editor.

### Layout & UI Widgets

**`tabs-plugin`** — tab viewer over a list of `*`-items with `title` and `content`. Set
one item's `default = true` for the initial tab; set `rememberActiveTab = true` to
persist. Each tab can have an `id` so `update(thatId)` re-rolls just that tab.

```
tabs = {import:tabs-plugin}

tabList
  rememberActiveTab = true
  backgroundColor = #ffffff
  *
    title = Tab 1
    content = Hello!
    default = true
  *
    title = Tab 2
    content = <button onclick="update(myTab)">re-roll</button> [animal]
    id = myTab
```

**`go-to-plugin`** — clickable text that appends, moves, or replaces content into a
target element. Useful for branching text-adventure UIs without a routing library.

```
goto = {import:go-to-plugin}

// goto(location, anchorText, type, elementId, style?, sep?)
//   type:  'a' append   |  'm' move (append then clear source)
//          'r' replace  |  'g' go (replace + clear source) — default 'g'
[goto(loc2, "Continue →", "g", "mainStage")]
```

**`nested-plugin`** — render a hierarchical Perchance list as an expandable tree UI with
+/− toggles. Each branch lazy-loads on expand.

```
nested = {import:nested-plugin}

world
  Europe
    France
      description = the wine country
    Italy
      description = the pasta country
  Asia
    Japan
      description = land of the rising sun

[nested(world)]
```

**`tldraw-plugin`** — embed a tldraw whiteboard. Channels are namespaced by
`generatorName`-`channel`, so two generators with the same channel don't collide.
Fullscreen toggle included; intersection observer defers iframe load until visible.

```
tldraw = {import:tldraw-plugin}
[tldraw({ channel: "my-board", width: 800, height: 600 })]
```

**`prompt2-plugin` — async modal form builder from spec object, supports select/text/textarea/checkbox, dark/light mode** — async form-modal builder. Renders a dialog with typed fields
(`textLine`, `text`, `select`, `buttons`, `none`+inline `html`); resolves to an object or
`null` if cancelled. Conditional field visibility via `show: (v) => …`.

```js
const result = await prompt2({
  name:  { type: "textLine", label: "Name", defaultValue: "" },
  model: { type: "select", label: "Model", options: ["good", "great"] },
  bio:   { type: "text", label: "Bio", show: v => v.model === "great" },
}, { submitButtonText: "Save", cancelButtonText: "Cancel" });
if (result) console.log(result.name, result.model);
```

**`tap-plugin` — click-to-randomize inline spans, returns `{html, noTap, noTapNoUpdate}` object** — wrap a list so its rendered item re-rolls when clicked. Can render as
`<span>` (default), `<button>` (style="button"), or with custom inline CSS.

```
tap = {import:tap-plugin}

animal
  cat
  dog
  fish

// In HTML:
Click to reroll: [tap(animal)]
[tap(animal, "button")]
```

**`tap-anywhere-plugin` — one-liner: adds global click → `update()` listener** — like `tap-plugin` — click-to-randomize inline spans, returns `{html, noTap, noTapNoUpdate}` object but the entire page is the click target.
Click anywhere → page re-rolls.

**`tooltip-plugin` — Tippy.js wrapper with Perchance list → options interop (46KB source)** — hover tooltips with rich content.

**`pattern-maker-plugin`** / **`layout-maker-plugin` — CSS Grid layout from DSL spec, wraps `update()` for area-specific re-evaluation** — visual editors for repeating
patterns and page layouts.

**`flat-avatar-plugin`** — generate simple flat-color avatar images from a seed string
(no AI; pure SVG).

**`rpg-icon-plugin`** — SVG icon set for RPG/fantasy generators (swords, potions, etc.).

**`fullscreen-button-plugin`** — a button that toggles fullscreen mode.

**`favicon-plugin`** — set the page favicon programmatically (useful with emoji).

**`perchance-logo-plugin`** — drop-in branded "Made with Perchance" badge.

**`live-activity-plugin`** — display a real-time count of users currently viewing a
generator.

### Visualization, Images, and Media

**`text-to-image-plugin`** — AI image generation (covered in §4).

**`image-plugin`** — non-AI image utility (loading, sizing, basic effects).

**`background-image-plugin` — fixed fullscreen background with opacity/blur/filter, accepts URL or config list** — fixed-position background image with `opacity`, `blur`,
and CSS-filter options. Accepts a URL string or a list of URLs (picks randomly).

```
bg = {import:background-image-plugin}

[bg("https://example.com/sunset.jpg", 0.3, 5)]   // url, opacity, blur(px)
[bg(bgUrlList)]                                   // picks one randomly from the list
```

**`background-audio-plugin` — embeds YouTube (IFrame API) or SoundCloud audio, auto-plays on first click** — embed a background audio player (SoundCloud or YouTube)
that auto-plays on first user interaction (browser autoplay policy compliant).

```
bgAudio = {import:background-audio-plugin}
[bgAudio("https://www.youtube.com/watch?v=…", { volume: 30 })]
```

**`image-layer-combiner-plugin` — composites multiple images via canvas, supports CSS filters per layer** — composite multiple images into one (alpha blending,
per-layer CSS filters). Includes a download-as-PNG button.

**`font-plugin` — Google Fonts loader, applies to element/body/span with size and color options** — load and use custom Google Fonts (or any web font URL).

**`t2i-styles`** — a curated catalog of `text-to-image-plugin` prompt-engineering
styles (`Painted Anime`, `Casual Photo`, `Cinematic`, etc.), each with a tagged scoring
profile. Used as a backing list for style-picker UIs. Communicates with the t2i call via
the **`window.input` scope-bridge pattern** — see §22.X below.

**`t2i-framework-plugin-v2`** — the framework that backs `t2i-styles`. Provides
`window.input = { description, negative }` as a bridge for styles to interpolate the
user's prompt.

### Comments, Community, and Moderation

**`comments-plugin`** — drop-in comment box backed by Perchance servers. Accepts a
settings list (a `co` block is conventional) with `channel`, `style`,
`messageBubbleStyle`, `inputAreaStyle`, `adminPasswordHash`, `adminFlair`,
`bannedWords`, `onComment(comment) =>`, and many more options. Channels are *global*
across all generators sharing the channel name.

```
c = {import:comments-plugin}

co
  channel = my-channel
  style = width: 100%; height: 360px;
  bannedWords = [bwList]
  onComment(comment) =>
    if(comment.byCurrentUser) console.log("posted:", comment.message)

[c(co)]
```

**`tabbed-comments-plugin-v1`** — comments-plugin with tabs (popular / new / sticky).
Used in the canonical `ai-chat` generator.

**`comments-plugin-oncomment-example`** — official example of the `onComment` callback.

**`bw-list`** — pre-built banned-words list (sourced from public GitHub banned-words
repos) you can plug into `comments-plugin.bannedWords` or `text-to-image-plugin` gallery
moderation.

**`secret-plugin`** — client-side **post-quantum public-key encryption** (CRYSTALS-Kyber /
ML-KEM FIPS 203, via `crystals-kyber-js`), no backend [VERIFIED R25]. API:
`secret.generateKeyPair()` → `{public, private}`; `secret.encrypt(text, publicKey)`;
`secret.decrypt(encrypted, privateKey)`. Auto-compresses before encrypting; output is
**non-deterministic** (random padding, so identical plaintexts yield different ciphertexts);
versioned tokens `PUBLIC_n_…_PUBLIC_END` / `PRIVATE_…` / `ENCRYPTED_…`. Canonical use: an
owner embeds their *public* key in a generator and the `comments-plugin` `beforeSubmit` hook
encrypts each submission with it, so a public/anonymous comment channel delivers feedback only
the owner's *private* key can decrypt (the `send-me-a-secret-message` pattern). Works for any
file by first converting it to a data-URL.

### Selection Algorithms

**`select-leaf-plugin`** — pick a single random *leaf* (item with no children) from a
hierarchical list. Repeatedly applies `selectOne` until it hits a leaf.

```
selectLeaf = {import:select-leaf-plugin}

animal
  mammal
    cat
    dog
  reptile
    lizard

[selectLeaf(animal)]   // "cat" | "dog" | "lizard" — never "mammal" or "reptile"
```

**`select-leaves-plugin`** — pick *N* random leaves.

**`select-all-leaves-plugin`** — return *every* leaf in the tree.

**`select-range-plugin`** — pick a contiguous slice of a list by index.

**`consumable-leaf-list-plugin`** — a "deck of cards" over leaves: each `selectOne` call
removes the picked leaf so it can't be picked again until reset. Exposes
`.getLength` (remaining count), `.selectMany(n)`, `.reset()`.

```
clp = {import:consumable-leaf-list-plugin}

deck
  hearts
    A
    K
    Q
  spades
    A
    K
    Q

cards = [clp(deck), ""]                  // create once
[cards.selectOne]  [cards.selectOne]     // never the same card twice
```

### Math, Dice, and Generators

**`dice-plugin`** — standard dice notation. `dice("1d6")`, `dice("3d20")`,
`dice("2d6+3")`. Returns a number.

```
dice = {import:dice-plugin}
output
  You rolled [dice("2d6+3")].
```

### Speech and Accessibility

**`text-to-speech-plugin` — Web Speech API with streaming support via ReadableStream, auto-sentence splitting** — speak text using the Web Speech API. Accepts a string, a
stream from `ai-text-plugin.textStream`, or an options object. Returns a handle with
`.stop()`. Auto-splits long text into sentence chunks for finer-grained `.stop()`.

```
speak = {import:text-to-speech-plugin}

let handle = speak({ text: "Hello world", voice: "Google US English", speed: 1.2 });
await handle;
handle.stop();

// Stream directly from ai-text-plugin:
let aiHandle = ai({ instruction: "Tell me a story." });
speak({ textStream: aiHandle.textStream });
```

### Data & Network

**`google-sheets-plugin`** — import published Google Sheets columns as DSL lists. The
plugin attaches columns as sub-lists under a parent of your choice. URLs in DSL must
escape `=` as `\=`.

```
gs = {import:google-sheets-plugin}

sheetsSettings
  urls
    https://docs.google.com/spreadsheets/d/e/.../pub?gid\=0&single\=true&output\=tsv
  onLoad() =>
    update(myList)

[gs(root, sheetsSettings)]
```

**`super-fetch-plugin`** — CORS-bypassing fetch (covered in §6).

**`server-plugin`** — the official realtime/multiplayer backend (WebSocket to
`server-plugin.perchance.org`, per-generator "universes" via `window.generatorPublicId`). The
right tool for cross-device shared state; see §6.4. Tightly coupled to the server — import
and wrap it, don't fork it.

**`generator-stats-plugin-v2`** — read public view-count and last-edit time from
`/api/getGeneratorStats`. Mounts a `<span>` and fills it asynchronously.

```
gen = {import:generator-stats-plugin-v2}
This generator has [gen("views")] views, last edited [gen("lastEditTime")].
```

### Time

**`power-timer-plugin`** — countdown / count-up timers with a date target. Returns an
object whose properties (`year`, `month`, `day`, `hour`, …, `totalSeconds`) are
*auto-updating spans*, so `[myTimer.day]` ticks on its own.

```
pt = {import:power-timer-plugin}

timerOpts
  time = 2030-01-01
  onTimeUp = passed since
  onTimeDown = until
  timeZone = -3

[pt(timerOpts).year] years [pt(timerOpts).onTimeOutput()]
```

### Power Plugin Family

A loosely-coordinated family of generator-styling plugins, all by the same author:

- **`power-generator-styler`** — apply a unified visual theme to a generator.
- **`power-plugin-template`** — boilerplate scaffolding for new plugins.
- **`power-plugin-temps`** — collection of plugin templates to fork.
- **`power-footer-plugin`** — drop-in styled page footer.
- **`power-scroll-remember-plugin`** — restore scroll position across reloads.

### Lazy Loading and Discovery

**`dynamic-import-plugin`** — lazy-load another generator's lists on demand. Use for
optional or large dependencies (see §2.4).

```
optional
  ExtraBots = [dynamicImport('some-bot-pack-slug')]
```

**`bug-report-plugin`** — collect browser / device info into a debug blob for bug
reports.

### Themed / Decorative

**`pride-plugin`** — display Pride imagery during Pride month (June by default), or on
custom calendar dates. Accepts a number (size in rem) or an options object mapping date
names (`"june"`, `"march 31"`, …) to image/HTML strings.

### AI-Chat Foundation

**`ai-text-plugin`** — text generation (covered in §3).

**`ai-character-chat-dependencies-v1`** — bundle import pulling in Dexie.js, DOMPurify,
the embedding model loader, etc. Required for AI-chat-style applications.

### Cross-Plugin Patterns

**The `window.input` scope-bridge.** Some plugins (notably `t2i-styles`, the
`t2i-framework-plugin-v2`) read values from `window.input` rather than receiving them as
function arguments. To pass data into such a plugin, temporarily set `window.input`,
evaluate the plugin's property, then restore:

```js
function addStyleToPrompt(prompt) {
  const original = window.input;
  window.input = { description: prompt };
  const result = visualStyles[styleSelectEl.value].prompt.evaluateItem;
  window.input = original;
  return result;
}
```

This is the canonical pattern for "evaluate another generator's DSL templates while
making my data visible to them".

### Discovery

The full plugin directory is at <https://perchance.org/plugins>. Most plugins have a
fully-rendered example/demo at the same URL as their import slug; their source is
editable at `perchance.org/<slug>#edit`. Each plugin's page typically also has a `<slug>-example` companion generator demonstrating typical usage.

---

## 24 · Pre-Built Word Lists — The `/useful-generators` Tier

Perchance hosts ~200 pre-built importable word lists at <https://perchance.org/useful-generators>.
These are *not* plugins — they're plain Perchance lists exported with `$output = [theList]`,
designed to be pulled into your own generator via `{import:slug}`. They make randomized
text dramatically easier to author.

A representative slice:

| Category | Examples |
|----------|----------|
| Language | `noun`, `concrete-noun`, `abstract-noun`, `sci-fi-noun`, `pronoun`, `adjective`, `comparative-adjective`, `superlative-adjective`, `verb`, `speech-verb`, `adverb`, `time-adverb`, `intensifier`, `interjection`, `common-word`, `rare-word`, `archaic-word`, `long-word`, `cliche`, `simile`, `sentence` |
| Life & nature | `animal`, `dog-breed`, `cat-breed`, `pet-animal`, `dinosaur`, `reptile-species`, `fish-species`, `sea-creature`, `flower-species`, `plant-species`, `tree-species`, `bird-species`, `body-part`, `body-of-water` |
| Food & drink | `vegetable`, `fruit`, `ingredient`, `spice`, `herb`, `dessert`, `cocktail`, `tea-variety` |
| People | `common-first-name`, `common-last-name`, `common-male-name`, `common-female-name`, `common-unisex-name`, `surname`, `japanese-surname`, `aesthetic-username`, `couple-name`, `celebrity`, `us-president`, `pope`, `famous-scientist`, `person-build`, `person-height`, `face-shape` |
| Geography | `country`, `nationality`, `continent`, `us-city`, `us-state`, `japanese-city`, `german-town`, `english-town-name`, `river-name`, `sea-name`, `geographic-location` |
| History / culture | `roman-city`, `ancient-greek-city`, `egyptian-god`, `greek-god`, `norse-deity`, `religion`, `tarot-prediction`, `zodiac-sign` |
| Symbols | `emoji`, `bw-emoji`, `ascii-face`, `wingding`, `braille` |
| Color | `css-color`, `hex-color`, `paint-color`, `crayon-color`, `color-palette` |
| Sci-fi / fantasy | `star-trek-planet`, `fantasy-language`, `monster-type`, `lotr-character` |
| Internet | `website`, `youtube-thumbnail`, `imgur-image`, `instagram-username`, `social-network` |
| Tech | `programming-languge` (yes, misspelled in the canonical), `mime-type`, `gtld`, `phone-brand` |
| Misc | `password`, `phobia`, `fabric-type`, `object`, `knot-name`, `container-type`, `fact`, `playing-card`, `mood`, `hobby`, `occupation` |

**Use:**

```
animal = {import:animal}
noun   = {import:concrete-noun}
name   = {import:common-first-name}

output
  [name = name.selectOne, ""][name] saw a {strange|fluffy|tiny} [animal]
  and immediately needed a [noun].
```

The canonical word lists are stable and maintained — the page is curated, and unlisted
or placeholder entries are visually dimmed (rendered with grey opacity).

