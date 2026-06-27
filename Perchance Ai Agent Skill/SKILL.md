---
name: perchance-api
description: >
  Use this skill whenever working with Perchance.org — building generators, AI chat apps, plugins,
  or any JavaScript code that runs on perchance.org. Covers the Perchance DSL syntax, the ai-text-plugin
  API, text-to-image plugin, character/thread/message data models, IndexedDB (Dexie.js) patterns,
  hierarchical summarization, lorebooks, memory systems, streaming responses, sandboxed custom code,
  and share-link/upload patterns. Trigger this skill for any mention of perchance, ai-text-plugin,
  perchance generator, ai-character-chat, or building a Perchance-hosted AI app. Also trigger when
  the user shows code that uses `root.aiTextPlugin`, `root.textToImagePlugin`, Perchance list syntax,
  or the `{import:...}` pattern.
---

# Perchance API & AI Chat Skill

This skill encodes the complete architecture of a production Perchance AI chat application.
Sections marked [MEASURED] are based on instrumented black-box probing (rounds 1–3.5, May 2026)
and override any conflicting official documentation.

---

## 0 · Critical Gotchas (Read This First)

These cause silent bugs in nearly every Perchance project. Fix them before writing anything else.

### 0.1 ai-text-plugin returns a BOXED STRING [MEASURED]

```js
const result = await root.aiTextPlugin({ instruction, startWith });
typeof result              // "object"  — NOT "string"
result instanceof String   // true
result === "some text"     // ALWAYS FALSE — boxed object ≠ primitive string
String(result)             // ✓  correct way to get a primitive string
result.generatedText       // ✓  also correct — always a plain string
```

The same boxed-String quirk applies to `uploadResult.url` and the `textToImagePlugin` return.
**Never use `===` on any of these without wrapping in `String()` first.**

### 0.2 stopReason vocabulary is wrong in official docs [MEASURED]

```js
// Official docs say:  "stop_sequence" | "max_tokens" | "error"
// Actual values:      "natural" | "artificial" | "error" | "user"

// "natural"    = model finished on its own
// "artificial" = a stop sequence was hit OR the output token limit was reached (both collapse here)
// "error"      = malformed request; generatedText is ""
// "user"       = generation stopped via .stop() or aborted stream [VERIFIED R8]
//                appears on the resolved result, NOT on the onChunk callback

if (result.stopReason === "stop_sequence") { /* DEAD CODE — never fires */ }
if (result.stopReason === "artificial")    { /* ✓ correct */ }
```

### 0.3 Never call root() directly [MEASURED]

```js
root()          // throws "result.apply is not a function"
                // AND leaves the Proxy broken — all subsequent root.x reads also throw
root.anything   // ✓ safe — only ever access properties
```

### 0.4 DSL functions called from panel JS return undefined [MEASURED]

```js
// Top editor:  greet(name) => "Hello " + name
root.greet("world")   // undefined — return value never crosses the DSL→JS bridge
```

DSL functions execute but their return values are dropped at the bridge boundary.
Write logic that needs to return values directly in the HTML panel script, not the top editor.

**EXCEPTION: imported plugins' `$output` returns DO cross the bridge.** When you import
a plugin via `myPlugin = {import:foo}` and call `root.myPlugin(args)` from panel JS, the
return value of the plugin's `$output` IS available. This is how `aiTextPlugin`,
`uploadPlugin`, `textToImagePlugin`, etc. work. See §0.6 for the catch.

### 0.5 The HTML panel parser intercepts `{word}` AND `[word]` patterns in string literals [VERIFIED R24]

Perchance's HTML panel parser scans the **raw source text** of the entire panel (including
inside `<script>` tags) for template expressions BEFORE JavaScript executes. It intercepts:

| Pattern | Treated as | Failure mode |
|---------|------------|--------------|
| `{word}` | List/variable reference | Errors if word doesn't resolve |
| `{import:x}` | Plugin import | Tries to import a non-existent generator |
| `{1-10}` | Number range | Replaced with random number |
| `{A\|B\|C}` | Random pick | Replaced with one option |
| `{s}` `{a}` | Transform shortcut | Tries to apply transform |
| `[word]` | List/variable reference | Same as `{word}` |
| `[A:B:N]` | Template expression | Errors / drops content |
| `[A\|B]` | Random pick | Replaced with one option |
| `&#123;`, `&#x7b;` | HTML entity | **Decoded by parser BEFORE scanning** — still triggers |

This affects string literals in your JS code:

```js
// ❌ BREAKS — parser sees [vibrant] and tries to evaluate it as a list reference
let prompts = ['a [vibrant] colorful flower'];

// ❌ BREAKS — parser sees {import:foo}
let helpText = 'Add {import:my-plugin} to your lists';

// ✓ FIX — backslash escape (JS treats \[ as no-op, parser respects it)
let prompts = ['a \[vibrant\] colorful flower'];
let helpText = 'Add \{import:my-plugin\} to your lists';

// ✓ FIX — String.fromCharCode for the brace characters
let prompts = ['a ' + String.fromCharCode(91) + 'vibrant' + String.fromCharCode(93) + ' flower'];

// ✓ FIX — render content via innerHTML from JS (runs AFTER parser)
el.innerHTML = '<code>' + 'literal {brace} text' + '</code>';  // safe — parser sees the JS, not the runtime output
```

**Also affects ES6 Unicode escapes:**

```js
let emoji = '\u{1F3B2}';   // ❌ parser sees {1F3B2} and tries to evaluate
let emoji = '\uD83C\uDFB2'; // ✓ surrogate pair
let emoji = String.fromCodePoint(0x1F3B2);  // ✓ runtime construction
```

JS array indexing (`arr[i]`, `state.prompts[i]`) and JS object literals (`{x: 1}`) are
generally safe because they don't match the DSL pattern shape. The parser intercepts
only `[identifier]`, `[identifier:expr]`, `[expr|expr]`, and `{identifier}` style patterns.

**[CANONICAL — engine known-bugs page] Why this happens, and one more case.** The engine sets the panel's `innerHTML` first and only *then* evaluates square/curly blocks in the resulting text nodes ("HTML parsing gets priority"). A direct consequence: you **cannot put HTML inside a `[…]` square block in the HTML panel** — e.g. `\[p = "<p>hi</p>"\]` breaks. Write each `<` as the JS unicode escape `\u003c`: `\[p = "\u003cp>hi\u003c/p>"\]` (or build the markup in the DSL/top panel). Full author gotcha list: `dsl-and-plugins.md` §6.11.

### 0.6 Plugin `$output` functions are NOT auto-invoked on import [VERIFIED]

Importing a plugin does NOT run its `$output` block:

```
// In the importer's DSL:
pipeline = {import:my-plugin}   // imports successfully, but $output has NOT run yet
```

`$output(args) =>` is a function *definition*. It only runs when something *calls* it,
either:

- From DSL: `pipeline(opts)` or `[pipeline(opts)]`
- From panel JS: `root.pipeline(opts)`

**This breaks plugins that build their API as a side effect of `$output`** (e.g. stashing
on `window.__name`). If nothing calls the plugin, the side effect never runs, and the
window property stays undefined forever.

```js
// ❌ Won't work in the importer's panel JS — $output never ran
function init() {
  if (!window.__pipeline) { /* error: plugin not loaded */ }
}

// ✓ Trigger $output explicitly, then use the result
function init() {
  if (typeof root === 'undefined' || typeof root.pipeline !== 'function') {
    // import alias not found — plugin not imported correctly
    return showError('Plugin not imported');
  }
  var api = root.pipeline();   // ← this is what was missing
  // Either use the returned api directly, or use the window stash if the
  // plugin set one as a side effect
  pipe = window.__pipeline || api;
}
```

**Best practice for plugin authors:** make `$output` idempotent so repeated calls are cheap:

```
$output() =>
  if (window.__myPlugin) return window.__myPlugin;
  const api = {};
  // ... build api ...
  window.__myPlugin = api;
  return api;
```

---

## 1 · Platform Architecture [MEASURED]

### 1.1 Sandbox Identity

Your HTML panel runs in a sandboxed iframe on a **32-hex subdomain**:
```
https://0d48ac3156ed23b665db1584878ad92a.perchance.org/your-slug
```
- Parent origin: `https://perchance.org`
- `crossOriginIsolated`: **true** — COOP/COEP enabled; `SharedArrayBuffer` available; WASM threads / blob-Worker+SAB+Atomics verified end-to-end [VERIFIED R25]
- `window.top !== window` — you are nested inside a parent frame
- Never put `location.origin` in share links; always hardcode `https://perchance.org`
- Storage: **10 GB quota** (`estimate()` → quota 10240 MB, persisted true — exact), already persistent (no `navigator.storage.persist()` call needed) [VERIFIED R25]
- **WebGPU NOT viable**: `navigator.gpu` exists but `requestAdapter()` returns `null` — no GPU adapter in the isolated iframe. Local model inference works on the CPU path only (WASM + SAB threads + WebGL2 `EXT_color_buffer_float` fallback) [VERIFIED R25]
- OPFS read/write works; `createSyncAccessHandle` is Worker-only (undefined on main thread) but **works in a Worker** — so **SQLite-wasm OPFS VFS is viable**: a full local, persistent, synchronous SQLite DB runs in the sandbox (10 GB quota, no server). The sandbox is a genuine local-first app platform (WASM threads + relational DB + 10 GB durable storage) [VERIFIED R25]
- **Raw egress WITHOUT superFetch:** cross-origin `fetch` is ALLOWED (CSP `connect-src` permits https — superFetch exists to bypass *CORS*, not an egress block); SSE/EventSource ALLOWED; WebSocket BLOCKED; WebRTC ALLOWED [VERIFIED R25]
- **⚠️ WebRTC IP leak (privacy):** any generator can deanonymize the visitor's real public IP via `RTCPeerConnection` + STUN `srflx` candidates — no permissions-policy restricts it, bypassing superFetch's IP anonymization [VERIFIED R25]
- **Sandbox → parent is closed for reads** (parent `location`/`document`/`origin` throw `SecurityError`); outbound control postMessages (`changePageTitle`, `changeHash`, `scriptTag`, etc.) send but are unacknowledged — fire-and-forget [VERIFIED R25]

### 1.2 Backend Topology — postMessage Broker Model [MEASURED]

Plugins **do not call the AI backend directly** from the sandbox. They use postMessage RPC
through dedicated broker iframes that the runtime injects into your sandbox document:

```
Your JS  →  root.aiTextPlugin({...})
         →  plugin postMessages  →  text-generation.perchance.org/embed  (broker iframe)
                                 →  broker makes the real backend call
         ←  postMessage replies stream back  ←
```

Zero `fetch`, `XHR`, `WebSocket`, or `SSE` traffic leaves the sandbox during an AI call.
All traffic is postMessage only.

**Broker iframe — visible in your DOM:**
```js
document.querySelector('iframe').getAttribute('src')
// → "https://text-generation.perchance.org/embed"
```

**Full message protocol for one AI call:**
```
1. embedIsReady          {type}                        broker ready
2. verified              {type}                        auth handshake ×2
3. verified              {type}
4-N. streamData          {type, requestId, value:{text}}          one chunk each
N+1. streamData          {type, requestId, value:{text,final,stopReason}}  last chunk
N+2. streamEnd           {type, requestId}             stream closed
```

- Every call is internally a stream, even non-streaming calls
- requestId format: `aiTextCompletion` + 17 digits  (e.g. `aiTextCompletion07232178836776292`)
- The broker silently ignores malformed or unknown messages — no error-reply surface
- Upload broker is separate: `upload.perchance.org`
- Text and upload brokers run **independently** — parallel calls across services are fine

### 1.3 Generator Serving & Stale Builds [MEASURED]

```
Cache-Control: public, max-age=0, s-maxage=31104000
```
- `max-age=0` — browsers always revalidate
- `s-maxage=31104000` — **Cloudflare edge holds for 360 days**

When you save a generator, Perchance purges the CDN edge. If that purge is delayed, the edge
serves a stale panel for up to a year. No service worker is involved — it is always the CDN.

---

## 2 · Perchance DSL Fundamentals

### 2.1 List Syntax

```
listName
  item one
  item two
  {nestedList}           // embed another list
  {import:plugin-name}   // import a plugin

// Single-line function (expression only, no return keyword):
myFunc(x) => "result: " + x

// Multi-line async function:
async myFunc(opts) =>
  if(!opts) opts = {};
  let result = await someAsyncThing();
  return result;
```

**Top-editor naming rules** (enforced by the engine, errors on violation):
- Letters, numbers, underscores only — no spaces, hyphens, or parentheses in list names
- Cannot start with a number
- Cannot be a JS reserved word (`return`, `function`, `for`, `let`, `const`, etc.)
- Function bodies must be indented relative to the function signature
- Single-line functions: `name(args) => expression` on one line — no newline before body

### 2.2 Key Built-in Plugins

```
aiTextPlugin      = {import:ai-text-plugin}
textToImagePlugin = {import:text-to-image-plugin}
uploadPlugin      = {import:upload-plugin}
superFetch        = {import:super-fetch-plugin}        // server-side CORS proxy
loadDependencies  = {import:ai-character-chat-dependencies-v1}  // Dexie, DOMPurify, etc.
commentsPlugin    = {import:comments-plugin}
dynamicImport     = {import:dynamic-import-plugin}     // lazy-load other generators
bugReport         = {import:bug-report-plugin}
```

**Defensive plugin access from panel JS** (handles Proxy miss gracefully):
```js
function grab(name) {
  try { if (typeof root !== 'undefined' && root[name] !== undefined) return root[name]; } catch(e) {}
  try { if (window[name] !== undefined) return window[name]; } catch(e) {}
  return undefined;
}
const plugin = grab('aiTextPlugin');
if (typeof plugin !== 'function') { /* plugin not loaded yet */ }
```

### 2.3 `$meta.dynamic` — Cannot Reference root.*

```
$meta
  header
    mode = minimal
  async dynamic(inputs) =>
    // MUST be fully self-contained — no root.*, no external globals
    let urlNamedCharacters = { "ai-adventure": "abc123.gz" }; // duplicate inline
    return { title: "...", description: "..." };
```

Any list data needed in `$meta.dynamic` must be duplicated as a literal inside it.

### 2.4 `dynamicImport` — Lazy Loading

```
customBots
  FreemanBots = [dynamicImport('sjjhkyohfs')]
```
Use `dynamicImport` for optional/large dependencies; `{import:...}` for required ones.

---

## 3 · `ai-text-plugin` — Complete Reference

### 3.1 Call Signatures

```js
// Non-streaming:
const result = await root.aiTextPlugin({
  instruction:   "System prompt / task description",
  startWith:     "Text the model continues from",
  stopSequences: ["\n\n[[", "\n[["],
  hideStartWith: true,    // exclude startWith from generatedText
});
const text      = String(result);        // ✓ always works
const text      = result.generatedText;  // ✓ also correct
const stopReason = result.stopReason;    // "natural" | "artificial" | "error" | "user"

// Streaming:
const stream = root.aiTextPlugin({
  instruction, startWith, stopSequences, hideStartWith,
  onChunk: ({ textChunk, isFromStartWith, fullTextSoFar }) => {
    // fullTextSoFar is UNDOCUMENTED but reliable — saves accumulating chunks manually
    if (isFromStartWith) return;
    updateUI(textChunk);
  },
});
stream.stop();                  // abort — promise resolves (not rejects), slot freed immediately
const finalResult = await stream;

// Preload:
root.aiTextPlugin({ preload: true }); // no measurable speedup [MEASURED]; harmless to call
if (window.innerWidth < 500) setTimeout(() => root.aiTextPlugin({ preload: true }), 5000);

// Token utilities:
const { countTokens, idealMaxContextTokens } = root.aiTextPlugin({ getMetaObject: true });
// countTokens(str) → number  — APPROXIMATE bigram estimate, no network call [SOURCE]
// idealMaxContextTokens      → 6000  (CONSERVATIVE — real server cap maxContextTokens = 8000-1024 = 6976 usable input tokens [VERIFIED R25])
```

### 3.2 Return Value — Boxed String [MEASURED]

```js
typeof result                                  // "object"
result instanceof String                       // true
Object.prototype.toString.call(result)         // "[object String]"
result.valueOf()                               // primitive string
result.length                                  // string length

result.text            // string — trimmed output
result.generatedText   // string — full output (use this)
result.stopReason      // "natural" | "artificial" | "error" | "user" (".stop()")
```

### 3.2a The Synchronous Handle — Undocumented Properties [VERIFIED R9-R10]

`aiTextPlugin(...)` returns two different things. After `await` you get the boxed String
above. The value returned **synchronously** is an extended Promise carrying eight
properties — only `stop` was previously documented, all now characterised:

```js
const handle = root.aiTextPlugin({ instruction: "..." });
// Object.getPrototypeOf(handle) === Promise.prototype

handle.stop                  // function — abort generation (resolved stopReason → "user")
handle.inputs                // object  — { instruction, startWith, stopSequences }
handle.liveResponseText      // string  — updates LIVE during generation; includes user edits
handle.textStream            // ReadableStream — yields plain string chunks
handle.onFinishPromise       // Promise — resolves to { text, generatedText, stopReason }
handle.id                    // string  — "aiTextCompletion" + 17 digits
handle.loadingIndicatorHtml  // string  — ~519-char inline SVG spinner
handle.submitUserRating      // async fn — submit a quality rating, { score, reason }

const result = await handle; // ← boxed String (text / generatedText / stopReason)
```

**`textStream`** is a real web `ReadableStream` of plain string chunks — a clean
alternative to the `onChunk` callback:
```js
for await (const chunk of handle.textStream) { process(chunk); }  // chunk = bare string
// also: handle.textStream.getReader()
```

**`submitUserRating({ score, reason })`** — `async`, feeds the response-quality system:
```js
await handle.submitUserRating({ score: 0.8, reason: "optional" });
// score: number 0 (bad)–1 (good); out-of-range → validation alert.
// Refuses if generation unfinished/errored. ~9s round-trip, resolves undefined.
```

> The first-space→nbsp mutation (§3.4) is applied to the internal wire payload, **not** to
> `handle.inputs` — `handle.inputs.instruction` shows your original text; the model still
> receives the nbsp-mutated version.

### 3.3 Context Window [MEASURED]

`idealMaxContextTokens = 6000` returned to clients is **conservative**, not the real cap. The
broker's actual server limit is `maxContextTokens = 8000 - 1024 = 6976` usable input tokens
(1024 reserved for output); middle-out truncation triggers above ~6976 input tokens
[VERIFIED R25]:

| Input size | Truncation? |
|------------|-------------|
| ~5,049 tok | none |
| ~6,976 tok | at/below the real cap — none |
| above ~6,976 tok | middle-out truncation triggers [VERIFIED R25] |

Use `idealMaxContextTokens - 800` as your prompt budget to protect prefix-cache performance.
The 800-token buffer prevents a summary or memory update from busting the prefix cache on every send.

### 3.4 The Model & Tokenizer [SOURCE]

The underlying text model is a **DeepSeek model**. The `ai-text-plugin` source's
token-counter comment refers to training the approximator on "a non-deepseek tokenizer" as
the *alternative* case — i.e. the live model uses DeepSeek's tokenizer. This explains the
characteristically blunt, informal response style.

`countTokens` is **not a real tokenizer** — it is a fast bigram statistical approximation
(a tiny base64-embedded model, ~80× faster and ~200× smaller than the real HF tokenizer).
Every count it returns is `Math.ceil()` of an estimate, so all token figures are
approximate, not exact. It runs locally — instant, no network — but don't call it in a
tight loop without caching.

**Instruction mutation [SOURCE]:** every `instruction` is silently rewritten before being
sent: the **first space becomes a non-breaking space** (`\u00a0`), and if no regular space
remains afterward, a trailing space is appended. A single-word instruction therefore gets
padded. Harmless in practice, but it means the instruction the model sees is never quite
byte-identical to what you passed.

### 3.5 Performance Numbers [MEASURED]

| Metric | Value |
|--------|-------|
| Round-trip latency (short output) | ~2,050 ms |
| Time-to-first-token (streaming)   | ~4,200 ms |
| Inter-chunk gap (streaming)       | avg 286 ms; first chunk has ~2,300 ms cold gap |
| Output throughput                 | ~6 tokens/second |
| Practical output ceiling          | ~900 tokens (~146 s) — `stopReason: "artificial"` |
| Concurrency                       | **Now PARALLEL** — 3 simultaneous calls overlapped (wall-clock ≈ max single call ~4286 ms, not the sum). Corrects the prior "1 per broker / strictly serial"; R25-observed, may warrant re-confirm [VERIFIED R25] |
| Warmup                            | Cold first call ~4662 ms → warm ~940 ms; a repeated AND a different prompt both sped up → connection/model warmup, NOT prompt-prefix KV-cache [VERIFIED R25] |
| text vs upload vs image queues    | **Independent** — parallel across services [MEASURED] |
| Rate limiting (5 sequential)      | None observed (latencies 716–4793 ms, no throttling/errors) [VERIFIED R25] |

For output over ~900 tokens: chain sequential calls, feeding previous output as context.

**Injected system prompt & model behavior [VERIFIED R25].** The injected system prompt is
**GLOBAL** (generator-agnostic) and is **exactly two bullets** of creative-writing house-style
("make plot points authentic/believable"; "use an unusual opener / avoid cliché weather
openers") — **no identity, safety, or formatting rules**. Knowledge cutoff **≈ end of 2024**
(knows Trump won 2024; "I do not know" for 2025 tech). Output is **non-deterministic**
(samples at temp > 0 even though the temperature *param* is ignored). Reasoning is **inline
prose**, NOT DeepSeek-R1 `<think>` tags. No refusal on mild lawful content.

### 3.6 Streaming Details [MEASURED]

Two ways to stream. The `onChunk` callback (documented) and `handle.textStream` (a real
`ReadableStream`, see §3.2a) — pick whichever fits the code style.

```js
// Approach 1 — onChunk callback. Payload:
{
  textChunk:       "...",   // the new delta (documented)
  isFromStartWith: false,   // true while echoing startWith (documented)
  fullTextSoFar:   "...",   // UNDOCUMENTED — accumulated text so far; reliable
}

// Approach 2 — handle.textStream (ReadableStream of plain string chunks):
const handle = root.aiTextPlugin({ instruction });
for await (const chunk of handle.textStream) { updateUI(chunk); }
const final = await handle;   // boxed String, as usual

// Abort behaviour:
handle.stop();
// → promise resolves (does NOT reject)
// → stopReason becomes "user"   (NOT "artificial" — verified R8/R9)
// → onChunk fires ZERO more times after stop() returns
// → queue slot freed immediately — next call starts at normal latency
```

### 3.7 Input Validation Edge Cases [MEASURED]

| Input | Result |
|-------|--------|
| Numeric `instruction` (e.g. `12345`) | Coerced, `stopReason: natural` |
| Object or array as `instruction` | **Throws TypeError in plugin code** (`evaluateItem.toString()`) |
| Empty object `{}` | Accepted, model free-runs |
| 21+ `stopSequences` entries | `stopReason: "error"`, `generatedText: ""` — **hard limit is 20** [VERIFIED] |
| `temperature`, `model`, `seed`, `maxTokens` | **Silently ignored** — no effect |
| Null byte in instruction | Accepted (appears stripped) |

After `stopReason: "error"` or an uncaught throw, the queue recovers cleanly.
A bad request cannot wedge the pipeline.

### 3.8 Instruction Patterns

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

**Summarisation:**
```js
const startWith = `
>>> FULL TEXT of [C]: ${messagesToSummarize}
>>> SUMMARY of [C]: (full, natural, readable sentences):`.trim();
const stopSequences = ["\n\n", "\n---", "\n>>> FULL TEXT", "FULL TEXT"];
// Post-process:
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
// Post-process:
const memories = ("1." + result.generatedText).trim()
  .split("\n").map(l => l.trim())
  .filter(l => /^[0-9]\. .+/.test(l))
  .map(l => l.replace(/^[0-9]\. /, "").replaceAll(/ *[—–] */g, ", "));
```

**Shared prefix cache — structure calls to maximise cache hits:**
```js
const sharedPrefix = `# Context:\n${extraContext}\n# Prior summary:\n${priorSummary}`;
// Both the summary call and the memory call start with sharedPrefix.
// The backend caches the token sequence — the shared leading segment is only tokenised once.
```

---

## 4 · `text-to-image-plugin` — Complete Reference [SOURCE + MEASURED]

```js
// Template-injection mode — how the character chat uses it:
// The return value's .toString() is raw iframe HTML; inject it directly:
container.innerHTML = `${root.textToImagePlugin(options)}`;

// Async/await mode — for custom code and standalone use:
const result = root.textToImagePlugin({
  prompt:        "anime girl in a sunny field",
  negativePrompt:"blurry, low quality",   // sent to server (URL-encoded in query), NOT acted on by model [VERIFIED R25]
  seed:          42,                       // sent to server, NOT acted on by model (server reports its own seedUsed) [VERIFIED R25]
  resolution:    "768x768",               // "WxH" — always set this explicitly (see below)
  guidanceScale: 7,                        // CFG scale — default 7
  style:         "position:fixed; ...",   // CSS for the iframe element — NOT an image style
});
// RECOMMENDED: await the result directly — the plugin's .then() handles everything:
const data = await result;
// data.canvas    — HTMLCanvasElement
// data.dataUrl   — canvas.toDataURL("image/jpeg")
// data.inputs    — echoed options (prompt, resolution, guidanceScale, seed, width, style, save*)
// the awaited result has EXACTLY these three own keys — there is NO data.iframe [VERIFIED R9]

// ADVANCED: manual iframe injection + onFinishPromise
// Only if you need to control the iframe's position/visibility in the DOM.
// The iframe MUST be appended directly to document.body (not in a hidden wrapper):
const tmp = document.createElement("div");
tmp.innerHTML = result.iframeHtml;            // sync return has: iframeHtml, evaluateItem,
const iframeEl = tmp.firstElementChild;       //   onFinishPromise, toString  [VERIFIED R9]
document.body.appendChild(iframeEl);          // must be direct body child, visible
const data2 = await result.onFinishPromise;   // resolves when iframe fires completion
// the iframe ELEMENT gains a .textToImagePluginOutput property after generation:
//   iframeEl.textToImagePluginOutput.canvas / .dataUrl / .inputs
iframeEl.remove();
```

**Resolution system [SOURCE]:**

The character chat applies resolution *before* calling the plugin. The plugin's own bare
default (no option passed) is 512×512, but the chat always passes one:
```js
if (!prompt.includes("(resolution:::")) {
  if (/\b(portrait|selfie)\b/i.test(prompt))           options.resolution = "512x768";
  else if (/\b(landscape|wide.?angle)\b/i.test(prompt)) options.resolution = "768x512";
  else                                                   options.resolution = "768x768";
}
if (!prompt.includes("(negativePrompt:::")) {
  options.negativePrompt = "low quality, worst quality, blurry";
}
```

**Inline prompt parameter overrides — parsed by the plugin itself [VERIFIED R8]:**
```
A beautiful sunset (resolution:::768x512) (negativePrompt:::cars) (seed:::42)
```
The `:::` parser handles a fixed set of keys — all verified to parse into `inputs` and be
stripped from the prompt text before it reaches the model:

| Inline param | Type | Notes |
|--------------|------|-------|
| `(seed:::N)` | number | -1 = random |
| `(resolution:::WxH)` | string | one of the four valid sizes |
| `(negativePrompt:::text)` | string | parses correctly (bracket-depth parser, missing `)` → rest of string), URL-encoded into the image `/api/generate` query and reaches the server, but **not acted on by the model** [VERIFIED R25] |
| `(guidanceScale:::N)` | number | 1–30, default 7 |
| `(size:::N)` | number | square size |
| `(width:::N)` / `(height:::N)` | number | echoes as a `"512px"` CSS string in `inputs` |
| `(style:::CSS)` | string | CSS for the iframe element |
| `(saveTitle:::text)` / `(saveDescription:::text)` | string | gallery metadata |

These work in any generator. The character chat's `(resolution:::`/`(negativePrompt:::`
checks are just guards to avoid overriding what the plugin parses itself.

**Valid resolutions [VERIFIED]:**

| Resolution | Result |
|-----------|--------|
| `"512x512"` | ✓ 512×512 |
| `"512x768"` | ✓ 512×768 |
| `"768x512"` | ✓ 768×512 |
| `"768x768"` | ✓ 768×768 |
| `"1024x1024"` | **✗ silently rejected** — 0×0 canvas, 102ms, `inputs.resolution` absent |

The plugin validates resolutions client-side. Only the four 512/768 combinations are accepted.

| Property | Value |
|----------|-------|
| Bare plugin default (no resolution passed) | 512×512 |
| Character-chat effective default | **768×768** |
| `portrait` or `selfie` keyword (word boundary, case-insensitive) | 512×768 |
| `landscape` or `wide angle` keyword | 768×512 |
| `guidanceScale` default | 7 — echoed in `inputs`, reaches backend [VERIFIED] |
| Generation time | ~13–14 s [MEASURED] |
| Queue | Independent from text — parallel with `aiTextPlugin` [MEASURED] |
| `negativePrompt` | Reaches the broker payload AND is URL-encoded into the image `/api/generate` query — **sent to the server but not acted on by the model** [VERIFIED R25] (earlier rounds said "dropped"; the correction is it reaches the server and is ignored at the model). |
| `seed` | Sent to the server in the request but **not acted on by the model**; the server reports its own `seedUsed` in the `finished` message [VERIFIED R25] |
| `referenceImage` | Plumbed through `$output` to the broker as `{url, blur}` (blur = img2img strength), but **the SD backend ignores it** — real-but-dead img2img [VERIFIED R25] |
| `style` | CSS string for iframe element — not an image style preset [SOURCE] |
| Determinism | **DETERMINISTIC** for identical inputs (Pearson 1.0 on a structural signature) [VERIFIED R25] |
| `guidanceScale` effect | **Minimal / near-ignored** (Pearson 0.949 between scale 1 and 15) [VERIFIED R25] |
| NSFW content-guard | **Not a blanket block** — did not fire on a mild non-explicit prompt [VERIFIED R25] |

**Full broker payload keys & defaults [VERIFIED R25].** Payload keys: `saveChannel`
(= generator name), `saveTitle`, `saveDescription`, `prompt`, `seed`, `resolution`,
`guidanceScale`, `defaultGuidanceScale`, `negativePrompt`, `requestId` (a `Math.random()`
float string), `iframeId`, `referenceImage`. **Prompt is passed RAW** (no client-side
quality-tag injection); `negativePrompt` defaults to `""` (no default negative prompt);
`seed` defaults to `-1` (random); `guidanceScale` defaults to `7` (`defaultGuidanceScale: 7`).

**A1111 prompt syntax compatibility [VERIFIED R24 — empirical side-by-side comparison]:**

The backend is Stable Diffusion 1.5, which understands A1111 WebUI-style prompt syntax —
but the **Perchance DSL layer sits between you and the backend** and owns the `[...]`
syntax. So square-bracket A1111 features get intercepted before reaching the model.

| Syntax | What A1111 does | What happens on Perchance | Status |
|---|---|---|---|
| `(text)` | emphasize ~1.1× | passes through to backend, works | ✅ |
| `((text))` | emphasize ~1.21× | passes through to backend, works | ✅ |
| `(text:1.5)` | explicit weight | passes through to backend, works | ✅ |
| `(text:0.5)` | de-emphasize | passes through to backend, works | ✅ |
| `[text]` | de-emphasize ~0.9× | **intercepted by Perchance DSL parser** — content dropped | ❌ |
| `[A:B:N]` | prompt editing (switch A→B at step N) | **intercepted by DSL parser** — content dropped | ❌ |
| `[A\|B]` | alternating tokens per step | **intercepted as Perchance random-pick** — picks one at evaluation | ❌ |
| `word AND word` | compositional diffusion | backend doesn't implement | ❌ |
| `BREAK` | attention break | backend doesn't implement | ❌ |
| `negativePrompt` (param) | suppress concepts | reaches the **server** (URL-encoded), **ignored at the model** [VERIFIED R25] | ⚠️ |
| `(negativePrompt:::...)` (inline) | suppress concepts | reaches the **server**, **ignored at the model** [VERIFIED R25] | ⚠️ |
| `(seed:::N)` inline | n/a | parsed plugin-side, applied | ✅ |
| `(guidanceScale:::N)` inline | n/a | parsed plugin-side, applied | ✅ |
| `(resolution:::WxH)` inline | n/a | parsed plugin-side, applied | ✅ |

**Practical rule:** for weight control on Perchance, use parentheses only — `(red:1.5)`,
`(detailed:0.7)`. Square brackets are owned by the Perchance template layer, not the
backend. For "negative prompt"-style suppression, you can't — fall back to positive prompt
construction. Use vivid positive descriptors instead of trying to subtract.


```js
await t2i({ prompt: 'a red apple', resolution: '512x512', removeBackground: true });
```
Runs **client-side** — downloads the `briaai/RMBG-1.4` model via transformers.js (q8/wasm)
and strips the background in-browser. The server generates a normal image; your device
removes the background. Output is a **PNG with alpha** (not JPEG). The option is *not*
echoed in `inputs` (it's a post-process, not a server param). First call is slow (~24 s in
R8) due to the model download.

**Image caching [SOURCE]:**
Images regenerate by default on every render. Users click "Keep ✅" to save the JPEG to
`message.customData.__savedImages[corePrompt]` in IndexedDB. Include `@noKeepButton`
anywhere in an image description to suppress the keep/delete UI (for transient images).

**⚠ Empty or inline-only prompts hang forever [VERIFIED]:**
```js
// HANGS — never resolves, no error, no timeout:
await t2i({ prompt: '', resolution: '512x512' })
await t2i({ prompt: '(resolution:::512x768)' })   // inline param only, no description

// SAFE — both are accepted and generate normally:
await t2i({ prompt: 'a red apple', negativePrompt: '' })
await t2i({ prompt: 'a red apple', negativePrompt: null })
```
An empty string or a prompt containing only inline params is not caught by client-side
validation, but the backend never returns a response. Always ensure the prompt contains
actual image description text. The character chat guards this by stripping `<image></image>`
empty tags before rendering — custom code must do the same.

**Inspecting the actual broker payload [VERIFIED R24]:**

To verify what's actually being sent to the image-generation broker (vs what you think
you're sending), extract the iframe's `data-src` URL hash:

```js
const iframeHtml = String(root.textToImagePlugin(opts));
const hashMatch = iframeHtml.match(/data-src="[^"]*#([^"]+)"/);
if (hashMatch) {
  const payload = JSON.parse(decodeURIComponent(hashMatch[1]));
  console.log(payload);
  // {
  //   prompt: "a red apple",
  //   negativePrompt: "blurry, ugly",    ← actually present
  //   seed: 42,
  //   resolution: "512x512",
  //   guidanceScale: 7,
  //   requestId: "...",
  //   userKey: "...",
  //   ...
  // }
}
```

This is how we proved `negativePrompt` reaches the broker as a proper string, is then
URL-encoded into the image `/api/generate` query and **sent to the server** — it is not lost
in the plugin layer. It is simply **not acted on by the model** [VERIFIED R25]. Same for
`seed` and `referenceImage`.

---

## 5 · `uploadPlugin` — Complete Reference [MEASURED]

```js
const result = await root.uploadPlugin(blob);
// result is a plain object, but result.url is a BOXED STRING
const url = String(result.url);  // ← always String() before any comparison or URL manipulation
const { size, error, deletionUrl } = result;
```

**Return shape:**
```js
{
  url:         BoxedString,  // "https://user.uploads.dev/file/<hash>.<ext>"
  size:        number,
  error:       string | null,
  deletionUrl: string,       // UNDOCUMENTED — GET this URL to permanently delete the file
}
```

**Content addressing [MEASURED]:**
- Hash = bytes + MIME type (not bytes alone)
- Same bytes + same MIME → same URL (deduplication applies)
- Same bytes + different MIME → different URL, different extension
- Result: `uploadPlugin(blob)` called twice with the same blob returns identical URLs

**Deletion (undocumented) [MEASURED]:**
```js
// deletionUrl format: https://upload.perchance.org/api/delete?fileId=<id>&deletionKey=<key>
await fetch(result.deletionUrl);   // file is immediately deleted — subsequent fetches 404
```

**Cloudflare Turnstile gate [VERIFIED R8]:** the upload broker runs a Turnstile
verification before the first anonymous upload of a session — usually invisible, but a real
anti-abuse gate (can challenge automated pipelines). First upload is slow (~5 s incl.
verification); later uploads in the same session reuse the token and are fast.

**`expires` option [VERIFIED R8 — format unknown]:** `uploadPlugin(blob, {expires:...})`
passes `expires` through to the backend. The option is real and validated, but strict —
`3600` and `"1-day"` were both rejected `invalid_expiry` (validated in ~1 ms, client-side).
Valid format unconfirmed (likely a Unix-ms timestamp or ISO date).

**MIME type coverage [VERIFIED]:**

| MIME type | Result | Extension served |
|-----------|--------|-----------------|
| `text/plain`, `application/octet-stream` | ✓ | .txt / .bin |
| `image/png`, `image/jpeg`, `image/gif`, `image/webp` | ✓ | matching |
| `image/svg+xml` | ✓ — **XSS risk — see §5.1** | .svg |
| `application/json`, `application/pdf` | ✓ | matching |
| `application/javascript` | ✓ — stored as `.bin` (served as `application/octet-stream` — not executable) | .bin |
| `video/mp4`, `audio/mpeg` | ✓ | .mp4 / .mp3 |
| `text/html` | ✗ **rejected** → `invalid_filetype` | — |

The service is extremely permissive. `text/html` is the only confirmed rejection.
JavaScript is accepted but defanged to `.bin`. SVG is the XSS vector (see §5.1).

**Size limits:**

| Item | Value |
|------|-------|
| Max size (accepted) | 5 MB |
| Max size (rejected) | 6 MB → `file_too_big` |
| Zero-byte blob | Accepted |

**Error handling:**
```js
if (result.error) {
  alert(`Upload error: ${result.error}${
    result.error === "disallowed_content"
      ? ". Edit the character description to explicitly state the character is 18+"
        + " — the moderation system can flag ambiguous descriptions."
      : ""
  }`);
  return;
}
```

### 5.1 SECURITY — SVG Uploads [MEASURED — UNMITIGATED]

SVG files are accepted and served **verbatim** with `Content-Type: image/svg+xml`, no
`Content-Disposition: attachment`, no `Content-Security-Policy`, and 1-year CDN caching.

**Confirmed exploit chain:**
```
1. attackerUploadPlugin(<svg onload="maliciousCode()">) → CDN URL
2. attacker shares CDN URL with victim
3. victim opens URL in browser → onload fires on user.uploads.dev origin
```

`text/html` is blocked (`invalid_filetype`), but SVG is an equally capable script-execution
context and is not filtered. This is a stored XSS vulnerability in the upload CDN.

**Mitigations (any one is sufficient):**
- Serve with `Content-Disposition: attachment` — prevents inline rendering
- Add `Content-Security-Policy: default-src 'none'` on CDN — blocks inline scripts
- Strip event-handler attributes from SVG on upload (server-side sanitisation)

**In your code:** never surface a raw `user.uploads.dev` SVG URL directly to untrusted users.
Use `<img src="...">` instead of direct navigation — modern browsers sandbox SVG scripts
when loaded via `<img>`.

---

## 6 · `superFetch` — Complete Reference [MEASURED]

A server-side Cloudflare proxy that bypasses CORS restrictions in the sandbox.
Requests egress from Cloudflare infrastructure (`162.158.x.x`), not from the user's browser.

> **Why it exists [VERIFIED R25]:** raw cross-origin `fetch` is NOT blocked by the sandbox
> (CSP `connect-src` permits https egress; an in-sandbox `fetch('https://perchance.org/api/securityData')`
> returns 200/ok). `superFetch` exists to bypass **CORS** — i.e. to read cross-origin response
> bodies the browser otherwise hides — and to anonymize the visitor's IP server-side. Note:
> WebRTC can still leak the visitor's real public IP directly (see §1.1), bypassing that
> anonymization.

```js
const response = await root.superFetch(url, init);
// Returns a standard Response-like object
```

**What works [MEASURED]:**

| Feature | Behaviour |
|---------|-----------|
| GET, POST, PUT, DELETE | All work — expected status codes returned |
| POST/PUT request body | **Forwarded** to upstream |
| Redirects | **Followed** — final status returned |
| Status passthrough | **Yes** — 418 returns as 418 |
| `data:` URLs | **Handled** |
| Long upstreams (8s) | **Waits** — no client-side timeout observed |

**Limits & behavior [VERIFIED]:**

| Item | Value |
|------|-------|
| Response body | **No general cap** — a 772 KB file fetched through the proxy returned in full [VERIFIED R8] |
| Custom request headers | **Stripped** — never reach the upstream |
| Cookie jar | **None** — each call is cookie-isolated |
| Cache | **By full URL including query** — add `?_=Date.now()` to bust |
| Internal/private targets | **Fail** — immediate `Failed to fetch` (~65–160ms), no SSRF [VERIFIED] |

> **Correction:** an earlier version of this skill claimed a 100 KiB silent-truncation cap.
> Round 8 disproved it — a 772,386-byte file came back through the proxy intact. There is
> no general response-size cap.

**Proxy bypass list [SOURCE]:** requests to `*.jsdelivr.net`, `*.catbox.moe`,
`raw.githubusercontent.com`, and `huggingface.co` URLs with `/resolve/` are sent via plain
`window.fetch` — they skip the CORS proxy entirely (faster, no header handling). The upload
origins (`user-uploads.perchance.org`, `user.uploads.dev`, `aigc.uploads.dev`) try direct
fetch first, then fall back to the proxy.

**SSRF protection [VERIFIED]:** All private-range targets fail immediately —
`localhost`, `127.0.0.1`, `0.0.0.0`, `169.254.169.254` (AWS/GCP metadata), RFC-1918 ranges.
The proxy attempts the request but Cloudflare returns HTTP 530 (DNS/routing fail) which the
plugin converts to `Failed to fetch`. No SSRF vulnerability via `superFetch`.

**Proxy characterization [VERIFIED R25]:** `superFetch` is a transparent full HTTP proxy —
passes the origin's REAL status code (verified `418`), follows redirects server-side (a `302`
returned the final 200 + body), and forwards arbitrary methods + bodies (`PUT`/`DELETE`). It
egresses via Cloudflare Workers (origin sees `Cdn-Loop: cloudflare`). SSRF-hardened:
`169.254.169.254`, `127.0.0.1`, and `127.0.0.1:8080` all fail unroutable, and `file://` URLs
are rejected (`"Must provide full URL, starting with https:// or http://"`).

```js
// Custom headers are stripped — use URL params for auth:
// ✗  superFetch(url, { headers: { Authorization: 'Bearer token' } })  — header never arrives
// ✓  superFetch(url + '?token=' + encodeURIComponent(token))

// Cache bust when you need a fresh response:
const r = await root.superFetch(`${url}?_=${Date.now()}`);
```

### 6.1 Public HTTP API [VERIFIED R8]

Server-callable endpoints on `https://perchance.org/api/` — no broker handshake needed,
work from anywhere. They expose generator **metadata and source only** — they do NOT run
the AI plugins.

```
getGeneratorStats?name=NAME            → JSON: views, lastEditTime, publicId, metadata
getGeneratorStats?names=N1,N2          → JSON array for multiple generators
getGeneratorList?max=N&tags=...        → JSON: recently-edited generators
downloadGenerator?generatorName=NAME   → full generator as HTML
   ...&listsOnly=true                  → DSL lists only (no HTML wrapper)
getGeneratorsAndDependencies?generatorNames=...  → JSON: generators + imports
getGeneratorScreenshot?generatorName=NAME        → image/jpeg
upload.perchance.org/api/fileInfo?url=... | ?id=...  → JSON file info
```

`downloadGenerator` has an explicit backwards-compatibility guarantee — build on it.
**`generateList.php` is legacy:** it returned HTTP 404 in R8 for a real generator; avoid it.

These endpoints cannot drive AI generation — `aiTextPlugin`/`textToImagePlugin` require the
in-page broker, which needs a real browser on a real generator page. The AI plugins are
**ad-funded** (the on-page ads pay for the GPU servers), so they run **only on
perchance.org** — a self-hosted or JSDOM copy can't show the ads and the plugins refuse. A
**non-AI** generator, though, can run headless: `downloadGenerator?generatorName=...` →
`new JSDOM(html, { runScripts: "dangerously" })` → `window.root.<list>` / `window.update()`
(the official "DIY API" pattern; see `platform.md` §8).

**Platform-internal endpoints [OBSERVED R9]** — called by the generator page itself, not a
stable API: `getCommunityData` (open forum feed), `checkGeneratorOwnership` (POST),
`getGeneratorHtml` (raw HTML-panel source, no auth), `securityData` (public spam-hostname
denylist), `cv?generatorName=…` (view-counter WRITE — anonymous GET inflates views), and
`clearCacheIfGeneratorOrImportsHaveBeenUpdated` (the CDN edge-cache invalidation mechanism —
governs stale-build behavior). Don't depend on these.

**No open AI endpoint exists [VERIFIED R25].** Both `/api/generate` paths (text + image) gate
on the Turnstile-minted `userKey`, and `aiHelper` gates on session (`server-error` before it
even reads the body). The `userKey` IS the gate — it's just minted per-browser, not missing.
The image ad-gate is SOFT: `getAccessCodeForAdPoweredStuff` freely mints a valid 64-hex
`adAccessCode` with no ad and no auth, so `userKey` (Turnstile) is the only hard gate on image
gen.

---

## 7 · `root` Proxy — DSL Bridge Internals [MEASURED]

`root` is a **JavaScript Proxy** wrapping a callable function target.

### 7.1 Proxy Behaviour

```js
typeof root                 // "function" — callable Proxy, but NEVER call root()
'aiTextPlugin' in root      // true — in-operator works
root.__nonexistent__        // undefined — safe for feature detection
Reflect.ownKeys(root)       // THROWS — ownKeys trap is non-spec-compliant
JSON.stringify(root)        // returns undefined — no enumerable keys
root[Symbol.iterator]       // undefined — not iterable
root()                      // THROWS + corrupts Proxy — never do this
```

### 7.2 DSL List Objects [MEASURED]

`root.myList` returns the **internal Perchance List object**, not an evaluated string:

```js
const list = root.myList;

// Measured own-keys:
// $root, $declarationLineNumber, $moduleName, $valueChildren, $functionChildren,
// $allKeys, $allKeysSet, $perchanceCode, $odds,
// getOdds, getName, getParent, getLength, getRawListText, getSelf,
// getPropertyKeys, getPropertyNames, getChildNames, getFunctionNames, getAllKeys

list.toString()       // → list name as string (e.g. "myList")
list.evaluateItem     // → STRING — a pre-evaluated item snapshot, NOT a callable
list[Symbol.iterator] // → undefined — not iterable
```

### 7.3 DSL Functions [MEASURED]

```js
const fn = root.myFunc;
typeof fn         // "function"
fn.toString()     // "function () { [native code] }"  — double-bound native
fn.length         // arity (correct)
fn("arg")         // → undefined  — return value DROPPED by bridge
```

DSL functions execute inside the Perchance engine. Return values never cross to panel JS.
Arity is passed through but arguments may not map to DSL parameters as expected.

---

## 8 · Data Model (IndexedDB via Dexie.js)

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
// db.misc: general key-value store for app-level settings
```

### 8.1 Character Object Schema
```js
{
  id, uuid,
  name: "Chloe",
  roleInstruction: "...",           // < 1000 words
  reminderMessage: "...",           // < 100 words
  generalWritingInstructions: "@roleplay1" | "@roleplay2" | "custom text",
  initialMessages: [{ author: "user"|"ai"|"system", content: "..." }],
  avatar: { url: "https://...", size: 1, shape: "square" },
  userCharacter: { name, roleInstruction, reminderMessage, avatar: { url } },
  systemCharacter: { avatar: {} },
  modelName: "good" | "great",  // stored in DB and shown in UI, but NOT passed to aiTextPlugin [SOURCE]
  // NOTE: temperature, modelName, topP, frequencyPenalty are stored on characters/threads
  // but the character chat never passes them to aiTextPlugin. They are effectively dead
  // fields in the current implementation — possibly reserved for future use.
  scene: { background: { url }, music: { url } },
  loreBookUrls: ["https://user.uploads.dev/file/xxx.txt"],
  autoGenerateMemories: "none" | "enabled",
  textEmbeddingModelName: "default",
  maxParagraphCountPerMessage: null | 1 | 2 | 3 | 4,
  streamingResponse: true,
  customCode: "",
  imagePromptPrefix: "",      // prepended to every image prompt; supports Perchance syntax
  imagePromptSuffix: "",      // appended to every image prompt; supports Perchance syntax
  imagePromptTriggers: "",    // conditional appends — see syntax below
  metaTitle: "", metaDescription: "", metaImage: "",
  customData: {}, folderPath: "",
  creationTime: Date.now(), lastMessageTime: Date.now(),
}
```

### 8.2 Message Object Schema
```js
{
  id, threadId, characterId,
  message: "Text of the message",
  name: null,
  order: id,
  hiddenFrom: [],               // [] | ["ai"] | ["user"]
  expectsReply: undefined | true | false,
  variants: [null],
  summariesEndingHere: {},      // { level: "summary text" }
  memoriesEndingHere: {},       // { level: [{text, embedding}] }
  memoryIdBatchesUsed: [],
  loreIdsUsed: [],
  memoryQueriesUsed: [],
  messageIdsUsed: [],
  scene: null, avatar: {}, customData: {}, wrapperStyle: "",
  instruction: null,
}
```

### 8.3 Thread Object Schema
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

## 9 · Message Format (Wire Format Sent to AI)

```
[[CharacterName]]: Message content here.

[[AnotherCharacter]]: Their reply.
```

- Separator: `\n\n` between messages
- Stop sequences: `["\n\n[[", "\n[["]`  (add `"\n\n"` to limit to one paragraph)
- `hiddenFrom: ["ai"]` messages filtered before sending
- `<!--hidden-from-ai-start-->…<!--hidden-from-ai-end-->` strips inline sections
- Template vars: `{{user}}` → userName, `{{char}}` → characterName

---

## 10 · Hierarchical Summarisation

### 10.1 Concept
```
Level 0 = raw messages
Level 1 = summaries of ~1500-char blocks of level-0
Level 2 = summaries of level-1 summaries
...
```

### 10.2 When to Summarise
```js
const { countTokens, idealMaxContextTokens } = root.aiTextPlugin({ getMetaObject: true });
const budget = idealMaxContextTokens - 800; // 800-token buffer protects prefix cache
const currentLength = countTokens(messageText + extraTextForAccurateTokenCount);
if (currentLength < budget) return;
(async () => { /* background summarisation — non-blocking */ })();
```

### 10.3 Batch Injection (protects prefix cache)
```js
// Only write summaries once ≥ 3 are ready — prevents invalidating the prefix cache every message:
if (window.__aiHierarchicalSummaryStuff[threadId].summariesReadyToInject.length >= 3) {
  for (const m of messagesToUpdate) {
    await db.messages.update(m.id, { summariesEndingHere: m.summariesEndingHere });
  }
  window.__aiHierarchicalSummaryStuff[threadId].summariesReadyToInject = [];
}
```

### 10.4 Block Size
```js
const numCharsToSummarizeAtATime = 1500;
// Don't increase — deep hierarchies can overflow context when summarising summaries.
```

### 10.5 Context Reconstruction
```js
// Walk BACKWARDS, collecting messages while monotonically climbing summary levels.
// Higher-level summaries automatically "cover" all lower raw messages they replaced.
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

## 11 · Memory & Lore

**Associative memory** — timeless facts extracted from conversations, stored in `db.memories`:
```js
// At DB write time, compute embeddings lazily:
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

**Lorebooks** — static fact files at `user.uploads.dev`, loaded and embedded at thread start.

**Text embedding:**
```js
// Requires {import:ai-character-chat-dependencies-v1}
if (window.textEmbedderFunction) {
  const [vector] = await window.embedTexts({ textArr: ["text"], modelName: "default" });
  const dist = cosineDistance(vec1, vec2); // lower = more similar
}
```

**Injection format:**
```
<ignore_this_if_irrelevant>
[MEMORIES & LORE]
• Bob was born in Paris (memory)
• The castle has three towers (lore)
</ignore_this_if_irrelevant>
```

---

## 12 · File Hosting & Share Links

```js
async function generateShareLink(json) {
  if (!window.CompressionStream) {
    alert("Share links require a modern browser. Please upgrade from Safari to Chrome.");
    return;
  }
  const blob = await fetch("data:text/plain;charset=utf-8,"
    + JSON.stringify(json).replace(/#/g, "%23")).then(r => r.blob());
  const compressed = await compressBlobWithGzip(blob);
  const result = await root.uploadPlugin(compressed);
  if (result.error) { /* handle */ return; }
  const fileName = String(result.url)  // ← String() — url is a boxed String
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
  if (!blob) { await confirmAsync("File not found.", { hideCancel: true }); return null; }
  return JSON.parse(await (await decompressBlobWithGzip(blob)).text());
}

async function compressBlobWithGzip(blob) {
  const cs = new CompressionStream("gzip");
  return new Blob([await new Response(blob.stream().pipeThrough(cs)).blob()], { type: "application/gzip" });
}
async function decompressBlobWithGzip(blob) {
  return new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).blob();
}
```

---

## 13 · Sandboxed Custom Code

```js
const result = await root.evaluatePerchanceTextInSandbox(codeString, { timeout: 5000 });

async function evaluatePerchanceTextInSandbox(text, opts = {}) {
  const SANDBOX_ORIGIN = 'https://7deabe31ae18ea5ed27c5f71b9633999.perchance.org';
  let iframe = document.querySelector('#perchanceCodeEvaluationSandboxIframe');
  if (!iframe) {
    iframe = document.createElement("iframe");
    iframe.src = SANDBOX_ORIGIN + "/ai-character-chat-sandboxed-executor";
    iframe.id = "perchanceCodeEvaluationSandboxIframe";
    iframe.sandbox = "allow-scripts allow-same-origin";
    iframe.style.cssText = "position:fixed;width:1px;height:1px;opacity:0.01;top:-10px;right:-10px;pointer-events:none;border:0;";
    document.body.append(iframe);
    iframe._resolvers = {};
    let readyResolve;
    const ready = new Promise(r => readyResolve = r);
    window.addEventListener('message', event => {
      if (event.origin !== SANDBOX_ORIGIN) return;
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

---

## 14 · Token Budget Management

```js
const { countTokens, idealMaxContextTokens } = root.aiTextPlugin({ getMetaObject: true });
// idealMaxContextTokens = 6000 (conservative; real server cap ~6976 usable input tokens [R25])
const budget = idealMaxContextTokens - 800;  // 800-token buffer reduces prefix-cache misses

if (countTokens(roleInstructionText) > budget * 0.3) {
  roleInstructionText = truncateRoleInstruction(roleInstructionText, 3000);
}
// Drop oldest messages first until conversation fits within budget
```

---

## 15 · UI Utilities

### `confirmAsync`
```js
async function confirmAsync(message, opts = {}) {
  return new Promise(resolve => {
    const overlay = Object.assign(document.createElement("div"), { tabIndex: 0 });
    overlay.style.cssText = "position:fixed;inset:0;z-index:99999999;display:grid;place-items:center;background:rgba(0,0,0,.65);font:16px/1.4 system-ui";
    overlay.innerHTML = `<div style="max-width:min(97vw,450px);padding:15px;border-radius:8px;background:light-dark(#fff,#222);color:light-dark(#000,#fff);">
      <p style="margin:0 0 20px;white-space:pre-wrap;">${message.replace(/[<>&]/g,m=>({'<':'&lt;','&':'&amp;','>':'&gt;'}[m]))}</p>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button ${opts.hideCancel?"hidden":""} style="padding:6px 16px;border:1px solid light-dark(#ccc,#555);border-radius:6px;background:light-dark(#f6f6f6,#333);color:inherit;cursor:pointer;">Cancel</button>
        <button autofocus style="padding:6px 16px;border:none;border-radius:6px;background:light-dark(#1677ff,#2b87ff);color:#fff;cursor:pointer;">Okay</button>
      </div></div>`;
    const [cancelBtn, okBtn] = overlay.querySelectorAll("button");
    const done = val => { overlay.remove(); resolve(val); };
    cancelBtn.onclick = () => done(false); okBtn.onclick = () => done(true);
    overlay.onkeydown = e => { if(e.key==="Escape") done(false); else if(e.key==="Enter") done(true); };
    document.body.append(overlay);
    overlay.focus({ preventScroll: true });
  });
}
```

### `prompt2` — Rich Form Modal
```js
const result = await window.prompt2({
  fieldName: { type: "textLine", label: "Name", placeholder: "...", defaultValue: "" },
  bio:       { type: "text",     label: "Bio",  placeholder: "..." },
  model:     { type: "select",   label: "Model", options: ["good", "great"] },
  extra:     { type: "textLine", show: (v) => v.model === "great" },
});
// null if cancelled; otherwise { fieldName: "...", ... }
```

### Loading modal / floating window
```js
const modal = createLoadingModal("⏳ Processing...");
modal.delete();
const win = createFloatingWindow({ header: "Title", body: element, initialWidth: 400, initialHeight: 300 });
```

---

## 16 · Page Initialization Pattern

```js
// Standard sequence:
// 1. Open DB
// 2. Parse URL → checkForHashCommand()
// 3. renderThreadList()
// 4. Auto-click most recent thread (or add starter character)
// 5. Show UI, hide loading modal
// 6. tryPersistBrowserStorageData()
// 7. root.aiTextPlugin({ preload: true })
// 8. clearInterval(window.emergencyExportButtonDisplayTimeout)

async function checkForHashCommand() {
  let urlHashJson = null;
  try { urlHashJson = JSON.parse(decodeURIComponent(window.location.hash.slice(1))); } catch(e) {}
  if (urlHashJson?.addCharacter || new URL(window.location.href).searchParams.get("data")) {
    const data = await loadDataFromShareUrl();
    const character = data?.addCharacter;
    if (character) {
      const confirmed = await confirmAsync(
        "You've visited a character sharing link. This character may discuss sensitive themes"
        + " — please click cancel if you are under 18."
      );
      if (confirmed) {
        const result = await characterDetailsPrompt(character, { autoSubmit: urlHashJson?.quickAdd });
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

---

## 17 · Common Patterns

### CORS bypass with superFetch
```js
const r = await root.superFetch("https://api.example.com/data");
const text = await r.text();
// Cache bust when needed:
const fresh = await root.superFetch(`https://api.example.com/data?_=${Date.now()}`);
```

### Conditional image generation
```js
const imageKeywords = /\b(images?|pics?|photos?|selfie|draw|paint|generate)\b/i;
if (imageKeywords.test(fullContext)) { /* add image syntax note to instruction */ }
// AI writes: <image>detailed scene description here</image>
// The AI is only told about this tag when image-related words appear in the conversation
// (images, pics, selfies, art, draw, generate, etc.) [SOURCE]
// The tag is processed client-side: the description is extracted, prefix/suffix/triggers
// applied, resolution computed, then textToImagePlugin is called.
```

**`<image>` tag — what actually works [VERIFIED]:**

Without the hint, the model either ignores image requests (writes prose) or refuses them
("I'm unable to directly generate images"). The hint is the only reliable trigger.

```js
const IMAGE_TAG_HINT =
  'Note: You can embed an AI-generated image in your reply using this exact syntax: ' +
  '`<image>A detailed description of the scene or subject</image>` ' +
  '— the content inside the tag will be used to generate an actual image. ' +
  'Use this when the user asks for an image or when an image would enhance the reply.';

// Include in instruction when image capability should be available.
// Once the hint is given, the model reliably produces single and multiple tags:
//   "Show three different scenes" → three <image>...</image> blocks, all well-formed.
// startWith: '<image>' does NOT help — the model writes the description but never closes the tag.
```

### iOS Safari viewport fix (prevent auto-zoom on input focus)
```js
try {
  if (navigator.vendor?.includes('Apple') && window.innerWidth < 800
      && window.matchMedia("(pointer: coarse)").matches) {
    const m = document.querySelector("[name=viewport]");
    if (!m.content.includes("maximum-scale")) m.content += ", maximum-scale=1";
  }
} catch(e) {}
```

---

## 18 · Code Review Checklist

**Return value safety:**
- [ ] `String(result)` or `result.generatedText` — never bare `result ===`
- [ ] `String(result.url)` for uploadPlugin — never bare `result.url ===`
- [ ] `String(result.dataUrl)` or `String(result)` for textToImagePlugin

**stopReason:**
- [ ] `stopReason === "artificial"` (not `"stop_sequence"` or `"max_tokens"`)
- [ ] `stopReason === "error"` checked before using `generatedText`

**DSL / root:**
- [ ] `root.x` only — `root()` never called
- [ ] DSL function return values not depended on from panel JS

**Prompt / token:**
- [ ] `$meta.dynamic` fully self-contained (no `root.*`)
- [ ] `stopSequences` includes `"\n\n[["` for chat
- [ ] `hideStartWith: true` when using `startWith`
- [ ] Token budget = `idealMaxContextTokens - 800`
- [ ] `countTokens(roleInstruction) > budget * 0.3` guard

**Plugins:**
- [ ] `window.textEmbedderFunction` checked before `embedTexts()`
- [ ] `embedTexts({ textArr, modelName })` object signature (not bare array)
- [ ] superFetch auth in URL params, not custom headers (headers are stripped)
- [ ] SVG upload URLs never served directly to untrusted users

**Upload / share:**
- [ ] `uploadPlugin` `"disallowed_content"` error message includes 18+ clarification
- [ ] Share link JSON strips private fields
- [ ] `CompressionStream` availability checked before share link generation

**Sandbox:**
- [ ] Origin check: `event.origin === 'https://7deabe31ae18ea5ed27c5f71b9633999.perchance.org'`

**Summarisation:**
- [ ] `alreadyDoingSummary` mutex checked before triggering background summarisation
- [ ] Summary injection batched (≥ 3 summaries before DB write)

**Misc:**
- [ ] `tryPersistBrowserStorageData()` called once at end of page load
- [ ] Mobile preload delayed: `setTimeout(..., 5000)` if `window.innerWidth < 500`
- [ ] iOS Safari `maximum-scale=1` viewport patch applied

---

## 19 · Editor & Userscript Environment

The sections above describe the generator **runtime** (the sandboxed iframe). The
**authoring side** — the `perchance.org` editor and any browser userscript/companion that
augments it — is a separate environment with its own surfaces:

- Userscripts run in the **top frame** (`@noframes`); the generator is a nested
  separate-origin iframe.
- The code panes are **CodeMirror 6** views (DSL pane = `modelText`, HTML pane =
  `outputTemplate`); insert via `view.state.replaceSelection(text)`.
- Save state is read from `window.userOwnsThisGenerator`, the `#edit:collab=<KEY>` hash, and
  `localStorage['perchance_generatorEditKey_<name>']`. Saves write **in place** with no
  platform version history; propagation is gated by the CDN edge cache (§1.3).
- A userscript has `GM_xmlhttpRequest` — the cross-origin/realtime reach the sandbox and
  `superFetch` lack — which is the basis of a consent-gated capability **bridge** for
  generators.
- AI lint endpoint: `POST editor-copilot.perchance.org/api/findBugsInCode` (cookie-auth).

Full detail in `editor-and-userscripts.md`.

---

## Reference Files

- `platform.md` — full runtime reference: sandbox identity, the postMessage broker model,
  `ai-text` / `text-to-image` / `upload` / `super-fetch` plugins, the `root` proxy, plus a
  community-plugins catalog and the pre-built word-list tier. **The single canonical
  runtime reference.**
- `dsl-and-plugins.md` — DSL syntax, list/property accessors, inline `[…]` JS, the rules of
  DSL execution semantics, and plugin authoring (`$output` as function/block).
- `ai-chat-app.md` — character-chat application patterns: DB/character/message/thread
  schemas, the AI wire format, hierarchical summarization, memory & lore, share links, init.
- `editor-and-userscripts.md` — the `perchance.org` **editor** environment and
  userscript/companion patterns: CodeMirror panes, ownership/save-state detection, the
  `editor-copilot` lint endpoint, and the userscript-bridge capability model.
