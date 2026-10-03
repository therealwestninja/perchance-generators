# Rule F — Factory Build (sequential, no agents)

Build one feature as a set of small, independent pieces against a **frozen contract**, then
prove every join. This is the no-agents version: you do each step yourself, **in order**.
There is no fan-out — the win comes from freezing the contract first and gating on the wire
last, not from doing things at once. Pairs with Rule P (Prove the Wire), which is step 5 here.

**The failure it prevents:** a piece that *runs* without proving it *works as wired*. You
build a module, it looks right, nothing errors — and the join to the rest silently does
nothing. Code running clean is not the same as code connected.

## When to use it

- The feature splits into **two or more independent pieces** that don't need each other's
  internals (a formatter, a palette, a layout helper, a data loader…).
- Correctness at the joins matters (stored data, a plugin's shape, a DSL value, the DOM).

**Don't** use it for one tightly-coupled change to existing code — just do that change
directly. And don't start if the design isn't settled: a contract that keeps moving puts
every piece out of sync with the next.

## The method

### 1. Freeze the contract before you write anything
For each new piece, write down and DO NOT change mid-build:

- **Name & call:** what you call it and exactly what arguments it takes.
- **Inputs:** the real shape of each argument — field names, types, units, id format
  (string vs number), whether anything can be null. **Copy a real sample from the live data
  or plugin output. Never describe the shape from memory** — that is the #1 source of wire
  bugs. If the shape is `item.tag: [{name}]`, write that, not "item has tags".
- **Output:** the exact shape whatever consumes this piece will read.
- **Where it runs:** which plugins/tables/DOM must exist first, and which may be missing.

If the contract has to change, stop, change it in the **one** written place, and re-read it
before continuing. Don't carry two versions of the shape in your head.

### 2. Build one piece at a time, in isolation
Take one piece. Build only that piece, against only its slice of the contract. Don't reach
into another piece's internals and don't wire it into the page yet. Finish it, check it
against its own contract, set it aside. Then the next. One at a time — this keeps each piece's
assumptions small enough to hold exactly.

### 3. Wire last, in one pass, by yourself
Only after every piece exists do you edit the shared code (the page body, the main generator
list, the setup script) to actually CALL the pieces. Do all the wiring in one deliberate pass.
Never interleave wiring with building — half-wired pieces hide which join is the broken one.

### 4. Obey the sandbox while you build
- No `eval`, no inline `onclick`, no remote `fetch`, no raw `localStorage`. Use the allowed
  path: `addEventListener`, the plugin's own fetch, IndexedDB/Dexie.
- Anything loaded async (a plugin, a table) may not be ready yet — confirm it **exists**
  before you call it; `await` or poll if needed.
- Wrap risky code in `try { … } catch (e) { console.error(e) }` so a failure is loud, not
  swallowed.
- If you need repeatable output, seed your randomness; don't rely on unseeded `Math.random`
  on a path that has to reproduce.
- Leave a small toggleable debug line/panel that prints the last error and key state, so the
  next problem is one glance.

### 5. The gate: prove the piece, THEN prove the wire
This is the whole point. Do not skip it.

**5a. Prove each piece** does what its own contract says. Necessary, never sufficient — it
only shows the piece works against *its own assumptions*.

**5b. Prove each wire** — for every join, in the live preview, check:
- **Real consumer:** the actual page code calls it on the path that really runs, not only in
  a scratch test.
- **Real input:** the shape you actually pass matches the frozen contract — field names,
  types, units, string-vs-number id. Log it and look.
- **Reached:** the code path actually fires in a real run. Instrument or observe it; don't
  assume.
- **Real result:** the DOM actually changed / the value is what you expected. "No error" is
  not success (that's Rule P).

A join can pass a **name check** ("the key / selector / method still exists") and still fail a
**meaning check** ("the other side still holds what my code assumes"). When something breaks
after you change one side, **suspect the join first**: re-read the other side's *current*
shape, and disable one join at a time until the broken one stands alone.

### 6. Sweep before you call it done
- Walk the assembled feature once for polish and obvious bugs.
- Re-read everything you built for wiring faults that *run* but are wrong: a value clamped or
  scaled twice, a piece that's reachable but never actually lights up, a dead branch, two
  handlers fighting over the same element.

## Close-out checklist

- [ ] Each piece does what its own contract says.
- [ ] Each join checked live: real consumer, real input shape, matches the contract, actually
      reached, real visible result.
- [ ] Repeatable output still repeats (if that matters here).
- [ ] Wiring was done in one pass, after the pieces existed — no half-wired leftovers.
- [ ] Preview console is clean; the final reload shows no errors.

## In one line

Freeze the shape, build each piece alone, wire them in one pass, and prove **every join**
works as wired — not just that the code ran.
