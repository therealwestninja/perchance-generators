# Deploying Book-maker to Perchance

Two files, two editors. Nothing else to host — the whole app is inlined into the HTML pane.

## Steps
1. Go to **perchance.org**, make a new generator, name it **`book-maker`** (matches the title).
2. **Top editor** (the DSL pane): paste the contents of [`perchance-top.txt`](perchance-top.txt).
   It imports `ai-text-plugin` (the mouth), `kv-plugin` (My-Books library), `super-fetch-plugin`
   (the 🔎 Research lookups), and `advanced-hypnosis-narration-engine` (motif rotation).
3. **HTML editor** (the pane): paste the contents of [`perchance-pane.html`](perchance-pane.html).
   `<style>` + two `<div>`s + an inert base64 payload (the **full Chloe brain** + the app) + a
   loader. **No external `src=`**, **no `<html>/<head>/<body>`** (Perchance wraps the pane).
4. **Save.** Open the generator and write a book.

## Rebuilding the pane
Don't hand-edit `perchance-pane.html`. Edit `book-maker.js` / `book-maker.html`, then run
`bash build-pane.sh` — it base64-packs the brain libs + app into the pane and audits it.

## Why the standalone files won't paste directly
`book-maker.html` (the dev/standalone version) uses `<script src="lib/…">` and a full document
scaffold — neither works in a Perchance pane (no `lib/` folder; the pane is bare content).
`perchance-pane.html` is the built, paste-ready version: same code, inlined, with the
Perchance-specific fixes applied.

## Perchance-correctness applied (per the ai-chat API)
- **Plugin access via `grab(name)`** → tries the DSL `root` proxy first, then `window`; never
  calls `root()` directly. Off-platform both miss → it uses the offline stub narrator.
- **Boxed-String returns** — `aiTextPlugin` resolves a boxed `String`; we read `r.generatedText`
  (never `=== "…"`).
- **Streaming** via `onChunk: ({textChunk}) => …` — chapters render live.
- **Parser-trap audit** — removed the `tags:'a|b'` fields whose `|` inside a standalone `[ ]`
  array literal could be misread as a `[A|B]` random-pick. No `{word}` / `[[` / `{import` /
  `\u{…}` patterns remain in source. (JS `arr[i]` indexing and `{key:val}` literals are safe.)
- Verified in-browser: the pane boots with **zero external scripts**, CSS applies, the full
  wizard → streaming chapter → save flow runs.

> Can't fully verify the live `aiTextPlugin`/`kv`/`hne` calls from here (they need a real
> Perchance page) — those follow the documented `root.<plugin>` contract exactly. First paste-test
> on the real generator is the final check.

## The brain IS inlined now
The full Chloe/Rook **council** ships in the pane (base64 payload). It steers every chapter
(`council.decide(beat)` → intent + directive + vibe), **learns from 👍/👎** (`council.feedback`),
and the **skybridge** weld client (`window.weld.skybridge`) self-installs so the Rook extension can
link to the page (graceful `no-anchor` when it isn't there). All of it degrades cleanly off-Perchance.

> Verified in-browser: the pane boots with **zero external scripts**, the brain goes live
> (`council.decide` returns intents), voting updates the learning tally, and the weld client installs.
> The live `aiTextPlugin` / `kv` / `superFetch` / anchor calls still need a real Perchance page (or the
> extension) for their final check.
