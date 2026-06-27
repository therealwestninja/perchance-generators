# Book-maker — a brain-steered storybook builder  ·  perchance.org/book-maker

Make a custom book, starting from the basics and growing toward full authorship.
Merges the **character-chat** idea (bring your cast) with the **narration-engine** architecture
(wizard → phase/beat → recurring motif → narrator voice), re-aimed at **fiction** and driven by
the **Chloe/Rook council brain**. (Formerly "Storyforge" — renamed; that URL was taken.)

> Status: **runnable PoC** (`book-maker.html` + `book-maker.js`). Verified standalone in the preview:
> streaming chapters, ✨ invent, save/library, continue-from-cursor all working.
> Perchance packaging (inline brain libs + HTML pane) is the next deploy step.

## What it has now (verified)
- **Streaming chapters** — prose writes in live, token by token, with a blinking cursor and auto-scroll.
- **Saved library (My Books)** — save/open/delete books; `kv-plugin` on Perchance, localStorage off-platform; auto-saves after each chapter.
- **Continue-from-cursor** — place the caret anywhere in a chapter and a floating **▶ continue** appears; click to extend from that exact point (text after the caret is dropped).
- **✨ Invent a character** — the model (or an offline pool) invents a name + persona for the chosen genre.

## The chain (what the user does)

1. **Story type** — pick a genre frame (Cozy, Epic Fantasy, Noir, Romance, Sci-Fi, Fairy Tale,
   Gothic Horror, Comedy). Each frame sets a **default narrator**, a **beat arc** (the chapter
   skeleton), and a **voice-matched motif bank** (its recurring imagery).
2. **Characters** — add them by typing, **pasting AICC / character-card JSON**, or from the
   provided sample cast. For each: assign a **role** (Protagonist/Hero · Side-character ·
   Antagonist/Villain · Background) and a **role-aware fate**:
   - Hero/Sidekick → *Can die (real stakes / sad ending allowed)* or *Never dies (immortal)*
   - Villain → *Must fall by the end* / *May survive* / *Redeemed, not killed*
   - Background → *Survives* / *Doesn't survive* / *Up to the story*
   - …plus a **Romantic interest** toggle on anyone.
   The fate rules become hard constraints the narration honors across the whole book.
3. **Narrator** — pick the **type** (third-omniscient, third-close, first-person, fairy-tale teller,
   dry & wry, lyrical, hardboiled) and the **voice** (warm, wry, grand, intimate, eerie, breezy, somber).
4. **Write the book** — generate chapter by chapter. Each chapter: the **brain picks an emotional
   tilt** for the beat, a **motif rotates in** (HNE `pickFromBank`, anti-repetition), the prompt is
   assembled from the whole wizard + the story-so-far, and the **mouth writes the prose**. Then
   **add a chapter**, **write a custom-beat chapter**, **regenerate**, **edit inline** (chapters are
   contenteditable), **delete**, or **export to `.txt`**.

## How the brain drives it

- The same council libs as Rook (`brain.min.js` / `nation.js` / `intent-directive.js` / `rook-core.js`).
- A `RookAgent` ("narrative director") is asked to `decide()` the **emotional tilt** of each beat;
  the tilt nudges the prose (tenderness / rising tension / dread / mischief / …).
- **Graceful**: if the brain libs are absent, Storyforge uses its built-in beat template — still
  fully functional. If `aiTextPlugin` is absent (off Perchance), a **preview stub narrator** composes
  a readable placeholder that proves the assembly (cast + beat + motif), so the whole flow is testable.

## The mouth (model)

- **On Perchance**: `aiTextPlugin` (free model). Bring-your-own-key is a later add.
- **Off-platform**: the preview stub. (Could later route to the Rook extension's mouths — Ollama /
  Gemini Nano — via the same adapter pattern.)

## Files

| file | what |
|---|---|
| `storyforge.html` | shell + warm book-themed CSS |
| `storyforge.js`   | the whole app: catalogue, wizard, brain steer, chapter assembly, import, export |
| `lib/*.js`        | the Chloe brain (copied from the extension; optional) |
| `perchance-top.txt` | the Perchance top-editor (imports) for deploy |

## Roadmap (toward "make a book")

- **Now**: 3-step wizard → chapter generation → add/regen/edit/export. ✅
- **Next**: Perchance packaging (inline libs, HTML pane); streaming per-chapter (token-by-token);
  cover + scene art (`textToImagePlugin`); character **upload** from file + **export back to AICC**.
- **Advanced**: chapter reordering + a chapter outline/timeline; per-chapter regenerate-with-diff
  (from HNE); save/resume a book (IndexedDB); share a book as a link; a "front matter" step
  (title, dedication); multi-act structure picker; tighter brain control (a faculty per chapter:
  heart for emotion, play for whimsy, conscience for the fate rules).
