# AI Character-Chat Application Patterns

A practitioner's reference for building character-chat-style applications on top of
Perchance's `ai-text-plugin`. Covers data model, hierarchical summarization, memory & lore,
share links, page initialization, and the common UI utilities used across production AI
chat apps.

For the low-level plugin APIs and platform internals, see [`platform.md`](./platform.md).
For DSL syntax and plugin authoring, see [`dsl-and-plugins.md`](./dsl-and-plugins.md).

---

## 1 · Application Shape

```
┌─────────────────────────────────────────────────────────────┐
│  Perchance generator page                                    │
│                                                              │
│  • Top editor: plugin imports + $meta + named-character map  │
│  • HTML panel: full SPA — thread list, message UI, modals    │
│  • IndexedDB (via Dexie): persistent state per browser       │
│  • root.aiTextPlugin: generation, embeddings, token utils    │
│  • root.uploadPlugin:  share links via CDN                   │
└─────────────────────────────────────────────────────────────┘
```

Generation is request-time and stateless on the server. All conversation history, character
definitions, summaries, memories, and lore live in the user's browser (IndexedDB). Sharing
a character is "upload the character JSON to the CDN, link to it by hash".

---

## 2 · Top-Editor Skeleton

```
loadDependencies   = {import:ai-character-chat-dependencies-v1}  // Dexie, DOMPurify, embedding model loader
aiTextPlugin       = {import:ai-text-plugin}
textToImagePlugin  = {import:text-to-image-plugin}
uploadPlugin       = {import:upload-plugin}
superFetch         = {import:super-fetch-plugin}
literal            = {import:literal-plugin}                     // ESSENTIAL — sanitize user input before DSL interpolation (§7.2)
combineEmojis      = {import:combine-emojis-plugin}
fullscreenButton   = {import:fullscreen-button-plugin}
bugReport          = {import:bug-report-plugin}
dynamicImport      = {import:dynamic-import-plugin}

// Optional but recommended for feedback widgets:
tabbedComments     = {import:tabbed-comments-plugin-v1}          // popular/new tabs over comments-plugin
textEditor         = {import:text-editor-plugin-v1}              // higher-perf textarea with inline styling

// Named-character URLs — `?char=ai-adventure` resolves to a CDN file:
urlNamedCharacters
  ai-adventure = 6c2f68e41de41e75a51971487c97b2d9.gz
  therapist    = 5cdaa39f9aabc7424c3b2e1b780a1e29.gz
  // NOTE: must also re-declare this map inside $meta.dynamic — no root.* access there

// Optional / large bundles loaded lazily:
customBots
  ExtraBots = [dynamicImport('some-generator-slug')]

$meta
  title       = My AI Chat
  description = Build your own AI characters and chat.
  header
    mode = minimal
  async dynamic(inputs) =>
    // SEO metadata per URL — fully self-contained, no root.* access:
    let urlNamedCharacters = {
      "ai-adventure": "6c2f68e41de41e75a51971487c97b2d9.gz",
      "therapist":    "5cdaa39f9aabc7424c3b2e1b780a1e29.gz",
    };
    let fileName = urlNamedCharacters[inputs.urlParams.char];
    return {
      title: fileName ? `Chat with ${inputs.urlParams.char}` : "My AI Chat",
      description: "...",
    };
```

The `$meta.dynamic` function runs in isolation; any list data it needs has to be duplicated
inline. The most common mistake is forgetting to also update `$meta.dynamic` when you add a
named character to the top-level map.

---

## 3 · IndexedDB Schema

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

The `misc` store is a general key/value drawer for app-level settings — useful for letting
users provide custom post-load JavaScript, theme overrides, last-active-tab, etc.

```js
// Read:
let val = (await db.misc.get("customPostPageLoadMainThreadCode"))?.value || "";

// Write:
await db.misc.put({ key: "customPostPageLoadMainThreadCode", value: "..." });

// Eval user-injected JS at startup (gated by an admin toggle):
if (customPostPageLoadMainThreadCode.trim()) eval(customPostPageLoadMainThreadCode);
```

---

## 4 · Character Schema

```js
{
  id, uuid,
  name: "Chloe",
  roleInstruction: "...",                      // < 1000 words; system-prompt-like
  reminderMessage: "...",                      // < 100 words; reinforces tone near end of prompt
  generalWritingInstructions: "@roleplay1" | "@roleplay2" | "custom text",
  initialMessages: [{ author: "user"|"ai"|"system", content: "..." }],
  avatar: { url: "https://...", size: 1, shape: "square" },
  userCharacter:   { name, roleInstruction, reminderMessage, avatar: { url } },
  systemCharacter: { avatar: {} },
  modelName: "good" | "great",                 // displayed in UI; NOT passed to aiTextPlugin
  scene: { background: { url }, music: { url } },
  loreBookUrls: ["https://user.uploads.dev/file/xxx.txt"],
  autoGenerateMemories: "none" | "enabled",
  textEmbeddingModelName: "default",
  maxParagraphCountPerMessage: null | 1 | 2 | 3 | 4,
  streamingResponse: true,
  customCode: "",                              // user-supplied JS, run in a sandbox iframe
  imagePromptPrefix: "",                       // prepended to every image prompt
  imagePromptSuffix: "",
  imagePromptTriggers: "",                     // conditional appends — see §10
  metaTitle: "", metaDescription: "", metaImage: "",
  customData: {}, folderPath: "",
  creationTime, lastMessageTime,
}
```

**Inert fields.** `temperature`, `topP`, `frequencyPenalty`, and (for `aiTextPlugin`)
`modelName` are stored on characters and threads but never reach the plugin. They are
preserved across exports for forward-compatibility; treat them as UI state, not as
generation parameters.

**Default custom code per global preset:**

```js
character.customCode = character.customCode?.length
  ? character.customCode
  : window.globalCustomJavaScripts["@removeHyphens"];
```

`window.globalCustomJavaScripts` is a curated object of named presets the app ships with.

---

## 5 · Message Schema

```js
{
  id, threadId, characterId,
  message: "Text of the message",
  name: null,                       // optional name override (null = use character default)
  order: id,                        // sort key; non-contiguous after edits
  hiddenFrom: [],                   // [] | ["ai"] | ["user"]
  expectsReply: undefined | true | false,
  variants: [null],                 // swipe variants; null = current
  summariesEndingHere: {},          // { level: "summary text" }
  memoriesEndingHere: {},           // { level: [{ text, embedding }] }
  memoryIdBatchesUsed: [],
  loreIdsUsed: [],
  memoryQueriesUsed: [],
  messageIdsUsed: [],
  scene: null, avatar: {}, customData: {}, wrapperStyle: "",
  instruction: null,                // the replyInstruction used when generated
}
```

`memoriesEndingHere` parallels `summariesEndingHere`: when a block of messages gets
summarized into the last one, the memories extracted from that same block are pinned to
the same message. Embeddings are computed lazily at DB write time:

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
await db.messages.update(m.id, {
  summariesEndingHere: m.summariesEndingHere,
  memoriesEndingHere:  m.memoriesEndingHere,
});
```

---

## 6 · Thread Schema

```js
{
  id, characterId,
  name: "Thread name",
  modelName, textEmbeddingModelName,
  character:        { /* per-thread character overrides */ },
  userCharacter:    { name, roleInstruction, reminderMessage, avatar: {} },
  systemCharacter:  { avatar: {} },
  isFav: false, folderPath: "",
  lastViewTime, lastMessageTime,
  currentSummaryHashChain: [],
  customCodeWindow: { visible: false, width: null },
  customData: {},
}
```

Per-thread overrides on `thread.character`, `thread.userCharacter`, `thread.systemCharacter`
let users tweak a character within one specific thread (e.g. "in this thread, Chloe is more
formal") without changing the saved character.

---

## 7 · Wire Format — Message Serialization

Conversation history is serialized to plain text before being sent to `aiTextPlugin`:

```
[[Chloe]]: Hi! How can I help you today?

[[User]]: I need a recipe for pasta.

[[Chloe]]: Of course — here's a simple aglio e olio…
```

| Rule | Detail |
|------|--------|
| Separator | `\n\n` between messages |
| Stop sequences | `["\n\n[[", "\n[["]` — add `"\n\n"` to limit AI output to one paragraph |
| AI-hidden messages | Filter out anything with `hiddenFrom: ["ai"]` before serialization |
| Inline hidden sections | Strip `<!--hidden-from-ai-start-->...<!--hidden-from-ai-end-->` |
| Template vars | `{{user}}` → user's name, `{{char}}` → character's name |

The chat completion call:

```js
const instruction = `
<MESSAGES>
${serializedHistory}
</MESSAGES>

REMINDER for writing ${character.name}'s messages: "${character.reminderMessage}"

>>> TASK: Your task is to write the next 3 messages in this chat.
`.trim();

const result = await root.aiTextPlugin({
  instruction,
  startWith:     `[[${character.name}]]:`,
  hideStartWith: true,                       // don't echo startWith in generatedText
  stopSequences: ["\n\n[[", "\n[["],
});
```

### 7.1 Alternative — DSL-List Prompt Shape

For prompts that are mostly *static templating* with a few dynamic interpolations, the
DSL-list call shape is often cleaner than building a JS template string. The prompt
lives in the top editor as a Perchance list with named children; the HTML panel invokes
it with `[ai(promptName)]` (auto-injects output into the page) or panel JS awaits
`ai(promptName)` (returns the boxed-String result).

```
ai = {import:ai-text-plugin}
literal = {import:literal-plugin}

botName = [botNameEl.value.trim() || "Bot"]
userName = [userNameEl.value.trim() || "Anon"]

chatPrompt
  instruction
    Please write the next message for the following chat/RP between [literal(userName)]
    and [literal(botName)]. Keep the message in character. Use *asterisks* for actions.
    [""]
    # Character description:
    [literal(botDescriptionEl.value.trim())]
    [""]
    # Conversation so far:
    <MESSAGES>
    [chatLogsEl.value]
    </MESSAGES>
    [""]
    Write the next message in this conversation. Just the message, no preamble.
    $output = [this.joinItems("\n")]
  startWith = [[[literal(botName)]]]:
  stopSequences = ["\n\n[[", "\n[["]
  hideStartWith = true
  async onFinish(data) =>
    if(data.stopReason === "user") return;
    appendMessageToLog(botName, data.text);

// HTML panel:
<button onclick="ai(chatPrompt)">Send</button>
<div id="lastReply"></div>
```

Things to note:

- `instruction` is itself a list with multiple items, collapsed by
  `$output = [this.joinItems("\n")]` at the end. This lets each line of the prompt use
  full DSL templating — including `[literal(userInputField)]` interpolations.
- `[""]` between paragraphs emits a blank line in the joined output.
- Handlers (`onStart`, `onChunk`, `render`, `onFinish`) are defined as DSL functions on
  the prompt list itself, not passed as a JS options object.
- `[ai(chatPrompt)]` in a template auto-injects the streaming output where it appears.
  For more control, capture the handle in JS and assign to `innerHTML`:

```js
let handle = ai(chatPrompt);
lastReplyDiv.innerHTML = handle;       // live-updating innerHTML
window.currentStream = handle;
await handle.stop();                   // .stop() is awaitable
```

When to choose which shape:

- **DSL-list shape** — static system prompts, character cards, scenario templates.
  Cleaner when the prompt has many fixed paragraphs with a few variable interpolations.
- **JS-object shape** — fully dynamic prompts, chat history assembly, token-budget-aware
  truncation. Cleaner when most of the prompt is computed from runtime state.

### 7.2 `literal()` — User-Input Safety

Any user-controlled string interpolated into an `instruction` (or anywhere else inside a
DSL template) is a DSL injection risk: `[`, `]`, `{`, `}`, and `=` are all DSL syntax.
The user types `[secret_admin_command]` into a name field and your generator runs it.

The `literal-plugin` escapes those characters so the text is treated as literal data:

```
literal = {import:literal-plugin}

instruction
  The user's name is: [literal(nameEl.value.trim())]
  $output = [this.joinItems("\n")]

// Wherever a user-provided string crosses into the DSL:
[literal(userInput)]                   // DSL-safe
[literal(userInput, "+html")]          // also HTML-escape
```

Used heavily in the canonical AI chat (every `botName` / `userName` / `description`
interpolation is wrapped). Without it, you ship a stored-XSS-equivalent for the DSL.

---

## 8 · Hierarchical Summarization

Long conversations get compressed in the background after every reply.

### 8.1 Concept

```
Level 0  =  raw messages
Level 1  =  summaries of ~1500-char blocks of Level 0
Level 2  =  summaries of Level-1 summaries
...
```

When the conversation grows past the token budget, the oldest unsummarized block becomes a
Level-1 summary stored on the *last message* of that block. When enough Level-1 summaries
accumulate, they collapse into a Level-2 summary, and so on.

### 8.2 Per-Thread Global State

```js
if (!window.__aiHierarchicalSummaryStuff) window.__aiHierarchicalSummaryStuff = {};
if (!window.__aiHierarchicalSummaryStuff[threadId]) {
  window.__aiHierarchicalSummaryStuff[threadId] = {
    summariesReadyToInject: [],   // pending — batched before DB write
    alreadyDoingSummary: false,   // mutex — only one bg summary at a time
  };
}
```

### 8.3 When to Summarize

```js
const { countTokens, idealMaxContextTokens } = root.aiTextPlugin({ getMetaObject: true });
const tokenBudget = idealMaxContextTokens - 800;   // 800-token buffer protects the prefix cache

const currentLength = countTokens(
  messageTextWithSummaryReplacements.join("\n\n")
  + (opts.extraTextForAccurateTokenCount || "")
);

if (currentLength < tokenBudget) return;

// Trigger background summarization in an IIFE so it doesn't block reply generation:
(async () => {
  if (window.__aiHierarchicalSummaryStuff[threadId].alreadyDoingSummary) return;
  window.__aiHierarchicalSummaryStuff[threadId].alreadyDoingSummary = true;
  try { /* summarize a block */ } finally {
    window.__aiHierarchicalSummaryStuff[threadId].alreadyDoingSummary = false;
  }
})();
```

### 8.4 Batch Injection (Prefix-Cache Protection)

Don't write summaries to the DB after every single message — invalidating the backend's
prefix cache repeatedly hurts performance. Wait until several are ready:

```js
if (window.__aiHierarchicalSummaryStuff[threadId].summariesReadyToInject.length >= 3) {
  for (const m of messagesToUpdate) {
    await db.messages.update(m.id, { summariesEndingHere: m.summariesEndingHere });
  }
  window.__aiHierarchicalSummaryStuff[threadId].summariesReadyToInject = [];
}
```

### 8.5 Block Size Heuristic

```js
const numCharsToSummarizeAtATime = 1500;
// Higher risks overflowing the summary call's own context when the hierarchy gets deep.

// Trim the final block down to the target size:
while (block.length > 1) {
  const numChars = block.reduce((a, v) => a + v.length, 0);
  if (numChars < numCharsToSummarizeAtATime) break;
  // Drop half at once if way too big (speed optimization):
  if (numChars > numCharsToSummarizeAtATime * 10) {
    const half = Math.floor(block.length / 2);
    for (let j = 0; j < half; j++) block.pop();
  } else {
    block.pop();
  }
}
```

### 8.6 Context Reconstruction — Walk Backward, Climb Levels

When building the prompt, you need the *minimal* set of messages/summaries that covers the
history. The algorithm: walk backwards through messages, keeping each one whose summary
level is ≥ the highest level seen so far. A higher-level summary *covers* all the
lower-level raw messages it replaced, so once we've kept a Level-2 summary, we drop any
Level-1 or Level-0 entries that preceded it.

```js
getMessageObjsWithoutSummarizedOnes(messages, opts) =>
  messages = messages.slice(0);
  let result = [];
  let highestLevelSeen = 0;

  while (messages.length > 0) {
    let m = messages.pop();
    let level = m.summariesEndingHere
      ? Math.max(...Object.keys(m.summariesEndingHere).map(Number))
      : 0;
    if (level < (opts?.minimumMessageLevel || 0)) continue;
    if (level >= highestLevelSeen) {
      result.unshift(m);
      highestLevelSeen = level;
    }
  }
  return result;
  // When using result for inference, read the HIGHEST level summary from each message:
  //   text = (level > 0) ? m.summariesEndingHere[level] : m.content;
```

### 8.7 Sanity Check Before Injecting

If the user edited messages between when we kicked off a summary and when it returned, the
input text we summarized no longer matches reality. Verify before writing:

```js
const expected = level === 1
  ? `${lastMessageObj.name}: ${lastMessageObj.content}`
  : lastMessageObj.summariesEndingHere[level - 1];

if (expected.trim() === lastSummarizedText.trim()) {
  // safe to inject
} else {
  console.warn("Content mismatch — summary discarded. Will recompute next send.");
}
```

### 8.8 Auto-Fix Repetition in Summaries

Long-context models occasionally produce summaries that loop. Detect with a cheap
heuristic — does the final 30-char chunk appear many times earlier? — and ask the model to
clean it up:

```js
if (summary.split(summary.slice(-30)).length > 5) {
  let result = await root.aiTextPlugin({
    instruction: [
      `Does the following story summary snippet shown within <story_summary_snippet>...</story_summary_snippet>`,
      `include erroneous/unnecessary repetition? If so, respond with fixed text within`,
      `<fixed_story_summary_snippet>...</fixed_story_summary_snippet>. If fine, respond with exactly 'no_repetition'.`,
      ``,
      `<story_summary_snippet>`,
      summary,
      `</story_summary_snippet>`,
    ].join("\n"),
    stopSequences: ["</fixed_story_summary_snippet>"],
  });
  const fixed = result.generatedText
    .match(/<fixed_story_summary_snippet>(.+)<\/fixed_story_summary_snippet>/s)?.[1].trim();
  if (fixed) summary = fixed;
}
```

### 8.9 Shared Prefix Cache for Summary + Memory Calls

When the same conversation block produces both a summary and memory extraction, structure
both calls to share an identical prefix so the backend tokenizes the shared part only
once:

```js
const sharedContextPrefix = [
  `# Extra context:\n${extraContext}`,
  `# Prior events summary:`,
  (priorSummaries.length > 0 ? priorSummaries : ["(None.)"]).join("\n"),
].join("\n");

// Summary call uses: [sharedContextPrefix, "", summaryTaskPrompt]
// Memory call uses:  [sharedContextPrefix, "", memoryTaskPrompt]
// Both share the same prefix → better prefix-cache hit rates
```

---

## 9 · Memory & Lore

### 9.1 Associative Memory

Timeless facts extracted from past conversations, stored in `db.memories`, retrieved via
text-embedding similarity before each reply:

```js
const memories = await db.memories.where("threadId").equals(threadId).toArray();
// Each: { id, threadId, text: "Bob was born in Paris", embedding: Float32Array }
```

Retrieval: embed the current conversation tail, sort all memories by cosine distance, take
the top N. Always guard the embedder — not all browsers can load the model:

```js
if (window.textEmbedderFunction) {
  const [embedding] = await window.embedTexts({
    textArr: [queryText],
    modelName: thread.textEmbeddingModelName,
  });
  // sort by cosineDistance(embedding, mem.embedding)
}
```

### 9.2 Memory Extraction

```js
const instruction = `
@@@ TASK: Condense *NEW_TEXT* into up to 3 lore/memory/fact entries for a facts database.
- Timeless facts only ("Bob was born in Paris", NOT "Bob is hungry right now").
- Each entry fully self-contained — readable in isolation.
- Use real names, not pronouns. "Bob said to Alice..." NOT "He said to her..."
- ≤ 3 sentences per entry.
- If unsure if a fact is timeless, add context: "Bob was kind to Alice when he first met her."
- IMPORTANT: Do NOT repeat things already known from above context. Extract only NEW info.

# NEW_TEXT:
${messagesSummarizedText}

Use this format:
# Lore/memory entries from NEW_TEXT:
1. <something we can deduce directly from NEW_TEXT>
2. <something else>
3. <another thing>
`.trim();

const startWith     = `# Lore/memory entries from NEW_TEXT:\n1.`;
const stopSequences = ["\n4."];

const data = await root.aiTextPlugin({ instruction, startWith, stopSequences });

const memories = ("1." + data.generatedText).trim()
  .split("\n").map(l => l.trim())
  .filter(l => /^[0-9]\. .+/.test(l))
  .map(l => l.replace(/^[0-9]\. /, "").replaceAll(/ *[—–] */g, ", "));
```

### 9.3 Lorebooks

Static fact files hosted on `user.uploads.dev`. One fact per line, blank lines separate
entries. Loaded once at thread start and cached in `db.lore`:

```js
for (const url of character.loreBookUrls) {
  const text = await fetch(url).then(r => r.text());
  // parse into entries, embed (if textEmbedderFunction available), upsert into db.lore
}
```

### 9.4 Injection Format

Memories and lore are wrapped so the model knows it can disregard them when irrelevant:

```
<ignore_this_if_irrelevant>
[MEMORIES & LORE]
• Bob was born in Paris (memory)
• The castle has three towers (lore)
</ignore_this_if_irrelevant>
```

---

## 10 · Image Generation in Chat

### 10.1 The `<image>` Tag

AI-generated messages can embed images by writing:

```
<image>A detailed description of the scene</image>
```

The application strips the tag from the displayed message, runs the description through
`textToImagePlugin`, and replaces the tag with an iframe. The model only reliably emits
the tag when explicitly told about it — provide the syntax hint in the instruction
whenever image generation should be available (see
[`platform.md` §4.7](./platform.md#47-the-image-tag-in-ai-chat)).

**Conditional inclusion** — only mention the syntax to the model when it's likely needed,
to keep the prompt smaller:

```js
const imageKeywords = /\b(images?|pics?|photos?|selfie|draw|paint|generate)\b/i;
if (imageKeywords.test(fullContext)) {
  instruction += "\n\n" + IMAGE_TAG_HINT;
}
```

### 10.2 Character-Level Image Controls

| Field | Effect |
|-------|--------|
| `character.imagePromptPrefix` | Prepended to every image prompt (supports Perchance `{a\|b}` syntax) |
| `character.imagePromptSuffix` | Appended to every image prompt (same) |
| `character.imagePromptTriggers` | Multi-line rules: per-character physical descriptions, regex matches, keyword conditions |

`imagePromptTriggers` syntax:

```
CharacterName: physical description to append when the name appears in the prompt
/regex/flags: text to append when the regex matches the prompt
keyword: @prepend description    ← @ prefix prepends instead of appending
```

### 10.3 Empty-Prompt Guard

A `textToImagePlugin` call with an empty or inline-only prompt **hangs forever** — see
[`platform.md` §4.4](./platform.md#44-options--behavior). Strip empty `<image></image>`
tags before rendering, and always pass real description text.

---

## 11 · Share Links

```js
// URL shapes:
// https://perchance.org/<generator>?data=<CharName>~<filename>.gz
// https://perchance.org/<generator>?char=<named-character>
// https://perchance.org/<generator>#<urlencoded JSON>   (debugging only)

async function generateShareLink(json) {
  if (!window.CompressionStream) {
    alert("Share links require a modern browser. Please switch from Safari to Chrome.");
    return;
  }
  const loadingModal = createLoadingModal("⏳ Generating share link...");

  // Also build a hash-based URL for debugging:
  const hashData = encodeURIComponent(JSON.stringify(json))
    .replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16));
  console.log(`shareUrl (hash): https://perchance.org/${window.generatorName}#${hashData}`);

  const jsonStr = JSON.stringify(json);
  const blob = await fetch("data:text/plain;charset=utf-8," + jsonStr.replace(/#/g, "%23"))
    .then(r => r.blob());
  const compressed = await compressBlobWithGzip(blob);
  const result = await root.uploadPlugin(compressed);
  loadingModal.delete();

  if (result.error) {
    alert(`Error: ${result.error}${result.error === "disallowed_content"
      ? ". If you believe this is incorrect, you may need to edit the character description to"
        + " explicitly state that the character is 18 or older — the moderation system can"
        + " misfire on ambiguous descriptions."
      : ""}`);
    return;
  }

  // String() is REQUIRED — result.url is a boxed String, not a primitive:
  const fileName = String(result.url).replace("https://user.uploads.dev/file/", "");
  // Character name in URL is cosmetic; the gz filename is what actually loads:
  const charName = json.addCharacter.name.replace(/\s+/g, "_").replaceAll("~", "");
  return `https://perchance.org/${window.generatorName}?data=${charName}~${fileName}`;
}

async function loadDataFromShareUrl() {
  const params = new URL(window.location.href).searchParams;
  let dataParam = params.get("data");

  // Named-character shortcut — ?char=ai-adventure → look up gz filename:
  if (!dataParam && params.get("char")) {
    dataParam = "foo~" + urlNamedCharacters[params.get("char")];
  }

  const fileName = dataParam.split("~").slice(-1)[0];
  const fileUrl  = "https://user.uploads.dev/file/" + fileName;

  const blob = await fetch(fileUrl, {
    signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : null,
  }).then(r => r.ok ? r.blob() : null).catch(console.error);

  if (!blob) {
    await confirmAsync(
      "File not found. Check if it has been quarantined:\nperchance.org/quarantined-files",
      { hideCancel: true }
    );
    return null;
  }
  const decompressed = await decompressBlobWithGzip(blob);
  return JSON.parse(await decompressed.text());
}

async function compressBlobWithGzip(blob) {
  const cs = new CompressionStream("gzip");
  const out = await new Response(blob.stream().pipeThrough(cs)).blob();
  return new Blob([out], { type: "application/gzip" });
}

async function decompressBlobWithGzip(blob) {
  const ds = new DecompressionStream("gzip");
  return await new Response(blob.stream().pipeThrough(ds)).blob();
}
```

**Always strip private user data** from the JSON before uploading — `id`, `lastMessageTime`,
user character details that aren't shared, etc. The share payload should be the minimal
character definition someone else needs to recreate the chat.

---

## 12 · Sandboxed Custom Code

Characters can carry user-supplied JavaScript, evaluated inside a hidden sandboxed iframe
served from a per-app hex subdomain. The origin check is mandatory:

```js
const SANDBOX_ORIGIN = 'https://<sandbox-hex-id>.perchance.org';

let result = await root.evaluatePerchanceTextInSandbox(codeString, { timeout: 5000 });

async function evaluatePerchanceTextInSandbox(text, opts = {}) {
  let iframe = document.querySelector('#perchanceCodeEvaluationSandboxIframe');
  if (!iframe) {
    iframe = document.createElement("iframe");
    iframe.src = SANDBOX_ORIGIN + "/ai-character-chat-sandboxed-executor";
    iframe.id = "perchanceCodeEvaluationSandboxIframe";
    iframe.sandbox = "allow-scripts allow-same-origin";
    iframe.style.cssText = "position:fixed;width:1px;height:1px;opacity:0.01;"
                         + "top:-10px;right:-10px;pointer-events:none;border:0;";
    document.body.append(iframe);
    iframe._resolvers = {};

    let iframeReady;
    const iframeReadyPromise = new Promise(r => iframeReady = r);

    window.addEventListener('message', (event) => {
      // REQUIRED: verify origin before trusting anything
      if (event.origin !== SANDBOX_ORIGIN) return;
      if (event.data.finishedLoading) { iframeReady(); return; }
      const { requestId, text } = event.data;
      if (iframe._resolvers[requestId]) {
        iframe._resolvers[requestId](text);
        delete iframe._resolvers[requestId];
      }
    });
    await iframeReadyPromise;
  }

  const requestId = Math.random().toString();
  return new Promise((resolve, reject) => {
    iframe._resolvers[requestId] = resolve;
    if (opts.timeout) {
      setTimeout(() => {
        if (iframe._resolvers[requestId]) reject("Sandbox did not respond in time.");
      }, opts.timeout);
    }
    iframe.contentWindow.postMessage({ text, requestId }, SANDBOX_ORIGIN);
  });
}
```

Properties visible to custom code: `oc.character`, `oc.thread`, `oc.userCharacter`,
`oc.messages`, `oc.customData`. The sandbox cannot reach back into the parent panel except
by `postMessage` reply.

---

## 13 · UI Utilities

### 13.1 `confirmAsync` — Promise-Based Confirm Dialog

```js
async function confirmAsync(message, opts = {}) {
  if (!message) message = "Are you sure?";
  return new Promise(resolve => {
    const overlay = Object.assign(document.createElement("div"), { tabIndex: 0 });
    overlay.style.cssText = `position:fixed;inset:0;z-index:99999999;display:grid;
      place-items:center;background:rgba(0,0,0,.65);font:16px/1.4 system-ui`;
    overlay.innerHTML = `<div style="max-width:min(97vw,450px);padding:15px;
      border-radius:8px;background:light-dark(#fff,#222);color:light-dark(#000,#fff);">
      <p style="margin:0 0 20px;white-space:pre-wrap;">${
        message.replace(/[<>&]/g, m => ({"<":"&lt;","&":"&amp;",">":"&gt;"}[m]))}</p>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button ${opts.hideCancel ? "hidden" : ""} style="padding:6px 16px;border:1px solid
          light-dark(#ccc,#555);border-radius:6px;background:light-dark(#f6f6f6,#333);
          color:inherit;cursor:pointer;">Cancel</button>
        <button autofocus style="padding:6px 16px;border:none;border-radius:6px;
          background:light-dark(#1677ff,#2b87ff);color:#fff;cursor:pointer;">Okay</button>
      </div>
    </div>`;
    const [cancelBtn, okBtn] = overlay.querySelectorAll("button");
    const done = v => { overlay.remove(); resolve(v); };
    cancelBtn.onclick = () => done(false);
    okBtn.onclick     = () => done(true);
    overlay.onkeydown = e => {
      if (e.key === "Escape") done(false);
      else if (e.key === "Enter") done(true);
    };
    document.body.append(overlay);
    overlay.focus({ preventScroll: true });
  });
}
```

### 13.2 `prompt2` — Rich Form Modal

```js
// Standard field-based form:
const result = await window.prompt2({
  fieldName: { type: "textLine", label: "Name",  placeholder: "...", defaultValue: "" },
  bio:       { type: "text",     label: "Bio",   placeholder: "..." },
  model:     { type: "select",   label: "Model", options: ["good", "great"] },
  // Show/hide fields conditionally on other field values:
  extra:     { type: "textLine", label: "Extra", show: (v) => v.model === "great" },
}, {
  submitButtonText: "Save",
  cancelButtonText: "Cancel",            // null hides the cancel button
});
if (result) console.log(result.fieldName, result.bio);

// Raw HTML content (no form fields) — e.g. for showing a share URL:
const r2 = await window.prompt2({
  content: {
    type: "none",
    html: `<div style="display:flex; gap:0.5rem;">
      <input value="${shareUrl}" style="flex-grow:1;">
      <button onclick="navigator.clipboard.writeText(
        this.parentElement.querySelector('input').value);
        this.textContent='copied ✅';
        setTimeout(()=>{ this.textContent='copy url'; }, 2000);">copy url</button>
    </div>`,
  },
}, { cancelButtonText: null, submitButtonText: "finished" });
```

Field types: `textLine`, `text`, `select`, `buttons`, `none` (plus inline `html`).

### 13.3 Other Modals

```js
const modal = createLoadingModal("⏳ Processing...");
modal.delete();                            // remove when done

const win = createFloatingWindow({
  header: "Window Title",
  body:   someHtmlElement,
  initialWidth:  400,
  initialHeight: 300,
});
```

---

## 14 · Page Initialization

### 14.1 Load Sequence

```
1. Set up the emergency-export watchdog (see §14.2)
2. Open the IndexedDB database
3. Parse URL params / hash → checkForHashCommand()
4. renderThreadList()
5. Auto-click most recently viewed thread (or add starter character if no threads)
6. Reveal UI, hide loading modal
7. tryPersistBrowserStorageData()   // call once — prevents browser from clearing IndexedDB
8. AI preload — root.aiTextPlugin({ preload: true })
9. Clear the emergency timer
```

```js
async function tryPersistBrowserStorageData() {
  if (navigator.storage?.persist) await navigator.storage.persist();
}

// Mobile-aware AI preload — don't slow down first paint on phones:
if (window.innerWidth < 500) {
  setTimeout(() => root.aiTextPlugin({ preload: true }), 5000);
} else {
  root.aiTextPlugin({ preload: true });
}
```

### 14.2 Emergency Export Watchdog

Protect users from a corrupted DB that prevents load — show an "export raw DB" button if
the page hasn't made progress in 10 seconds:

```js
window.lastKnownActivelyLoadingTime = Date.now();
window.emergencyExportButtonDisplayTimeout = setInterval(() => {
  if (Date.now() - window.lastKnownActivelyLoadingTime > 10000) {
    emergencyExportCtn.hidden = false;
    initialPageLoadingModal.hidden = true;
    clearInterval(window.emergencyExportButtonDisplayTimeout);
  }
}, 5000);

// Update window.lastKnownActivelyLoadingTime during slow legit operations
// (e.g. loading large lorebooks) so the watchdog doesn't trip on them.
```

### 14.3 Share Link / Hash Command Routing

```js
let ignoreHashChange = false;

async function checkForHashCommand() {
  let urlHashJson = null;
  try {
    urlHashJson = JSON.parse(decodeURIComponent(window.location.hash.slice(1)));
  } catch (e) {}

  if (urlHashJson?.addCharacter || new URL(window.location.href).searchParams.get("data")) {
    const data = await loadDataFromShareUrl();
    const character = data?.addCharacter;
    if (character) {
      const confirmed = await root.confirmAsync(
        "You've visited a character sharing link. This character may discuss sensitive themes —"
        + " please click cancel if you are under 18."
      );
      if (confirmed) {
        const result = await characterDetailsPrompt(character, {
          autoSubmit: urlHashJson?.quickAdd && !editingExistingCharacter && !sameNameExists,
        });
        if (result) {
          const newCharacter = await addCharacter(result);
          await createNewThreadWithCharacterId(newCharacter.id);
        }
      }
    }
    if (window.location.hash) {
      ignoreHashChange = true;
      window.location.hash = "";
      await new Promise(r => setTimeout(r, 20));
      ignoreHashChange = false;
    }
  }
}
window.addEventListener('hashchange', () => { if (!ignoreHashChange) checkForHashCommand(); });
```

### 14.4 Emergency Raw DB Export

```js
async function exportRawDb(dbName, opts = {}) {
  // Opens DB → reads all object stores → serializes to CBOR+gzip → triggers download.
  // If getAll() times out for a store, falls back to one-by-one individual gets
  //   (slower but safer for corrupted stores).
  // opts.corruptItemReplacer({storeName, id, dbData}) → return a placeholder object
  //   so corrupt records don't abort the whole export.
  // opts.onProgress({message, type}) → progress callback
  // opts.skipStores → array of store names to skip
}
// Export filename: <dbName>.<timestamp>.cbor.gz

await exportRawDb(window.dbName, {
  onProgress: (e) => console[e.type]("exportRawDb:", e.message),
  corruptItemReplacer: ({ storeName, id, dbData }) => {
    if (storeName === "characters") return { id, name: "CORRUPT" };
    if (storeName === "threads")    return { id, characterId: dbData.characters[0].id, name: "CORRUPT" };
    // returning undefined effectively deletes the corrupt item
    // (safe for messages/lore/etc. — they're recreatable)
  },
});
```

---

## 15 · Token Budget Management

```js
const { countTokens, idealMaxContextTokens } = root.aiTextPlugin({ getMetaObject: true });

// Leave 800-token buffer — reduces prefix-cache invalidation frequency:
const budget = idealMaxContextTokens - 800;

// Character descriptions: cap at 30% of budget
if (countTokens(roleInstructionText) > budget * 0.3) {
  roleInstructionText = truncateRoleInstruction(roleInstructionText, 3000);
}

// Messages: drop oldest first until everything fits in remaining budget.
// Always keep at least 3-5 most recent exchanges so the model has fresh context.
```

`countTokens` is approximate (a fast bigram estimator, not the real backend tokenizer).
The backend loads the **DeepSeek-R1-0528 tokenizer** from HuggingFace for actual token
counting (`deepseek-ai/DeepSeek-R1-0528/tokenizer.json`). Long prompts are truncated
via the `middleOut` algorithm (`middleOutWithoutTokenizer()` for fast mode) before
reaching the model. The broker sets `postData.didMiddleOut = true` when truncation occurs.
Don't treat it as exact — leave headroom. `idealMaxContextTokens` (currently `6000`) is
**conservative**, not the real cap: the broker's actual server limit is
`maxContextTokens = 8000 - 1024 = 6976` usable input tokens (1024 reserved for output), and
middle-out truncation triggers above ~6976 input tokens [VERIFIED R25]. Going near it also
costs prefix-cache hits and latency.

---

## 16 · iOS Safari Viewport Fix

Prevent auto-zoom when an input is focused — a common iOS Safari annoyance that makes the
chat UI feel broken:

```js
try {
  const isTouch = window.matchMedia("(pointer: coarse)").matches;
  const isSafari = navigator.vendor?.indexOf('Apple') > -1
    && !navigator.userAgent.includes('CriOS')
    && !navigator.userAgent.includes('FxiOS');
  if (isSafari && window.innerWidth < 800 && isTouch) {
    const m = document.querySelector("[name=viewport]");
    if (!m.getAttribute("content").includes("maximum-scale")) {
      m.setAttribute("content", m.getAttribute("content") + ", maximum-scale=1");
    }
  }
} catch (e) { console.error(e); }
```

---

## 17 · Code Review Checklist (AI Chat Apps)

- [ ] All DSL list functions use `async functionName() =>` syntax (not `function`)
- [ ] `$meta.dynamic` is fully self-contained (no `root.*` refs)
- [ ] `urlNamedCharacters` map **duplicated** inside `$meta.dynamic` — can't read the list there
- [ ] `stopSequences` includes `"\n\n[["` for chat completions
- [ ] `hideStartWith: true` set when using `startWith` to avoid double-printing
- [ ] CORS-sensitive fetches in custom code use `root.superFetch`
- [ ] Token budget: `idealMaxContextTokens - 800` buffer to protect the prefix cache
- [ ] Role-instruction token check: `countTokens(text) > idealMaxContextTokens * 0.3` triggers truncation
- [ ] `window.textEmbedderFunction` checked before calling `embedTexts()`
- [ ] `embedTexts()` called with `{ textArr, modelName }` object signature (not bare array)
- [ ] Share link JSON strips private user data (`id`, `lastMessageTime`, etc.)
- [ ] Sandbox origin check: `event.origin === '<sandbox-hex>.perchance.org'`
- [ ] `data.stopReason === "error"` handled before using `data.generatedText`
- [ ] Summary injection batched (`summariesReadyToInject.length >= 3` before DB write)
- [ ] `window.__aiHierarchicalSummaryStuff[threadId].alreadyDoingSummary` mutex checked
- [ ] `CompressionStream` / `DecompressionStream` availability checked before use
- [ ] `uploadPlugin` `"disallowed_content"` error handled with under-18 clarification message
- [ ] `String(result.url)` used before comparing — `result.url` is a boxed String
- [ ] Empty `<image></image>` tags stripped before render (avoid hang)
- [ ] iOS Safari `maximum-scale=1` viewport patch applied for touch devices
- [ ] `tryPersistBrowserStorageData()` called once at end of page load
- [ ] Mobile preload delayed: `if (window.innerWidth < 500) setTimeout(..., 5000)`
- [ ] `$meta.dynamic` named-character map has a comment reminder: `// NOTE: must add named chars to $meta.dynamic too`
- [ ] **Every user-input interpolation in DSL `instruction` lists wrapped with `literal()`** (XSS-equivalent for the DSL otherwise)
- [ ] For DSL-list prompt shape: `$output = [this.joinItems("\n")]` is the last child of any multi-item `instruction` / `startWith` list
- [ ] `handle.stop()` is awaited (`await handle.stop()`) when aborting in async code
- [ ] `handle.loadingIndicatorHtml` concatenated into status element to show streaming spinner
- [ ] Consider `tabbed-comments-plugin-v1` (popular/new tabs) over plain `comments-plugin` for chat feedback widgets
