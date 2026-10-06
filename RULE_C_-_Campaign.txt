# Rule C — Campaign (many features, one proven at a time)

A **campaign** is a roadmap: many features built in sequence, not one. Rule F builds ONE feature;
Rule C governs the sequence. It exists because the hardest bug on a long build isn't inside any one
feature — it's the one that slips through because you BUILT a feature and REVIEWED it with the same
pair of eyes that just convinced itself it was right. Your own test checks your own assumptions;
"I'm sure I didn't change anything" is a hope, not a check. Rule C forces a real **separation of
powers inside one head**: build with one hat, then **put it down and review with the other** —
adversarially, from the saved-before state, with the checks you did NOT write while building.

No sub-agents, no fan-out — you do every item yourself, in order. The win is the discipline
*between* items, not doing them at once.

## When to use it

- The work is a **list** of features (a roadmap, or several requests in a row), not one change.
- Each feature is its own Rule F build (freeze the shape, build the pieces, wire last, gate).
- Behavior must not silently **drift across the series** — the first feature must still work after
  the fifth.

**Don't** use it for a single feature — that's just Rule F. And don't half-build several features at
once: the sandbox hides which join is broken, and a half-wired pile makes every later failure
ambiguous.

## The method

### 1. One item at a time — finish and PROVE it before the next
Take the next feature off the list. Build it as a full **Rule F** (freeze the contract → build each
piece alone → wire in one pass → gate 5a/5b, Rule P). Do not start the next feature while this one is
half-wired. One finished, proven item, then the next — this is the no-agents form of "one persistent
builder, serial": you keep all the context, so you never throw away what you learned about the last
seam, but you also never let two unfinished features tangle.

### 2. Switch hats: review your own build as an adversary (the separation of powers)
This is the step only you can skip, so don't. When the builder in you says "done," stop and become
the reviewer — and the reviewer does **not trust the builder**:

- **Re-prove the wire (Rule X), with inputs you did NOT use while building.** Force each new join to
  FAIL and confirm the error is loud in the console; drive it and confirm the result is real in the
  preview. The builder tried the happy path; the reviewer brings the ugly one — `null`, the empty
  list, the from-the-future value, the giant input, the name that collides.
- **Reproduce "nothing else changed" from the saved BEFORE, not from memory.** Before you touched
  anything you backed the behavior up (the old output, a saved slot — Rule 0 §5). Now run the OLD
  path and the NEW path on the **same battery** and diff the results. "I didn't change that" is a
  hypothesis until the before-copy agrees. Reproducing byte-for-byte is the proof; your certainty is
  not.
- **Force every guard to TRIP.** A safety check or a drift-guard you never watched FAIL is
  unverified. Feed it the exact thing it's meant to reject and confirm it rejects — loudly. A guard
  that can't be made to fail isn't guarding anything.
- **Run the null-controls as hard assertions** (Rule 0 §10): off means byte-identical, neutral input
  stays neutral. The builder writes the test that passes; the reviewer writes the one that *should*
  fail and confirms it does.

### 3. Carry the deferrals — don't let them evaporate
Everything you noticed-but-didn't-do this item (a rough edge, a follow-up, a "needs the user's call")
goes to **one carried-forward list** (`src/TODO.md`, Rule 0 §11) — not your memory, not a comment
you'll never find again. Prune it as items close; carry it into the next item so nothing drops
between features. Surface the scope-expanding or risky ones to the user before acting (Rule 0 §11
boundaries) — don't quietly widen the build.

### 4. Gates green EVERY item, not just at the end
After each feature, run the whole harness green (Rule 0 §5) and a live pass of the touched flows AND
the ones it works alongside (Rule 0 §7) — the earlier features must still work now. Log the landing:
`src/change.log` (what / why / what you verified), the memory cube, the chat log (Rule 0 §8/§12/§1).
A cleared or compacted session must be able to see where the campaign stands — what's built, what's
deferred — without re-deriving it.

### 5. Record the verdict even when it's clean
A review that found nothing, *after* you genuinely forced the failures and ran the nulls, is a
RESULT — write it down (change.log: "re-proved X adversarially, behavior unchanged on N inputs").
Silence is not evidence; a logged clean adversarial pass is — and it's what lets you trust the early
features when you're five deep and can no longer hold them all in your head.

## Close-out checklist (per item, before the next)

- [ ] Built as a full Rule F — contract frozen, pieces built alone, wired in one pass, 5a/5b gated.
- [ ] Re-proved the wire as an adversary (Rule X), with inputs you did NOT build against.
- [ ] "Nothing else changed" reproduced from the saved before-copy on a battery — not from memory.
- [ ] Every new guard watched to FAIL on the input it's supposed to reject.
- [ ] Null-controls are hard assertions (off = unchanged, neutral input = neutral).
- [ ] Harness green + live pass of the touched AND adjacent flows; preview console clean.
- [ ] Deferrals in the one carried-forward list; the verdict (even "clean") in the change log.

## In one line

Build the list one proven feature at a time, and after each, **put down the builder and pick up the
adversary** — re-prove the wire, reproduce "unchanged" from the before-copy, and force every guard to
fail — before you move on.
