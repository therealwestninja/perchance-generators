# Memory Hero — The Brain

### A complete architecture: how the parts work, how they talk, and how a borrowed language model is made to wear a mind

---

## 0 · What this document is

This describes the **deterministic cognitive architecture** inside Memory Hero — the dependency‑free client‑side JavaScript "brain" that sits between a person and a fixed, rented language model (Perchance's DeepSeek‑class LLM) and makes that model behave like a continuous, felt, remembering character.

It is written from the live source, the brain lives in a `<script type="text/plain" id="memhero-brain-src">` block, ~6,000 lines). Function and state names below are the **real** ones.

A note on honesty up front, because the title invites overclaiming: **there are no literal neurons here.** What the brain calls "neurochemistry" is a set of scalar signals (`RK.neuro`, `RK.hormone`, …) that *bias* deliberation the way neuromodulators bias a real cortex. The analogy is functional, not biological. Where this document says "neuron communication," it means *the signalling layer that lets subsystems influence each other without direct function calls* — and that layer is real and load‑bearing. The rest is an honest map of a clever simulation, not a claim of personhood.

---

## 1 · The core inversion

Traditional LLM chatbot:

```
user text → prompt → LLM → reply
```

The LLM *is* the system. Identity, memory, mood, and goals live (briefly) inside a prompt, and evaporate.

Memory Hero inverts this:

```
user text → PERCEPTION → the BRAIN (mind) → STEER → LLM → reply
                ↑ eyes        ↑ everything       ↑ mouth
```

The LLM is demoted to a **language cortex** — a mouth and an ear for grammar, not the seat of the self. The brain never writes the words of a reply. It writes a **steer**: a budgeted, priority‑ordered instruction injected into the model's context that shapes *how* the next reply is delivered — its stance, restraint, warmth, vocabulary, what to surface, what to hold back. The model supplies fluency; the brain supplies the person.

**Three consequences follow from this and explain almost every design choice:**

1. **The brain can only influence, never author.** It is a director whispering to an actor it cannot see, who improvises every line. So everything is *steering*, expressed as natural‑language directives, never string surgery on the output.
2. **State must live outside the model.** Memory, mood, relationships, and goals persist in a single object (`RK`) saved to the browser, because the model itself is stateless between calls.
3. **The model is a shared, sandboxed resource.** It is reached through brokers, is rate‑limited (one call per broker, strictly serial), and silently ignores sampling knobs. So the brain treats it as an unreliable external organ and routes all calls through a scheduler.

---

## 2 · Where the brain lives — the dual body

The brain runs as a single Immediately‑Invoked Function Expression in **two different execution contexts at once**, and this split shapes the whole nervous system:

| Context | Has | Lacks | Role |
|---|---|---|---|
| **Parent panel** | `root` (the Perchance proxy → `superFetch`, plugins), the React host DOM, `window.countTokens` | — | The "outside world" — fetches, speech, the UI, the real `oc` chat API |
| **Sandboxed iframe** | the chat `oc` object, the steer composition | **no `root`** — cannot fetch, cannot reach the network | The "inner" thinking context |

Because the iframe cannot reach the outside world, the two halves talk over **`postMessage`** through a single switchboard called **the broker** (§13). This is the brain's corpus callosum: every cross‑context signal — a fetch request, a spoken line, a memory read, a thought to render — crosses it as one correlated message.

The brain‑source is **injected by function replacement, never `String.replace`** — a hard‑won rule: `String.replace` interprets `$`‑patterns in the brain's own regexes and silently corrupts it ("oc has been modified").

---

## 3 · The anatomy map (human feature → system → code)

| Human faculty | In the brain | Key code |
|---|---|---|
| Eyes / hearing | Perception of text chat | `perceive()`, the `PERCEPT` pipeline, `predErr()` |
| Mouth / speech | The steer → the LLM | `rookSteer()`, `composeReminder()`, `oc.character.reminderMessage` |
| Neurotransmitters | Six‑signal chemical bus | `RK.neuro {da,sero,ne,ach,glu,gaba}`, `neuroTick()` |
| Hormones / endocrine | Slow modulators | `RK.hormone {cortisol,melatonin,oxytocin,endorphin}`, `RK.hpa` |
| Mood / affect | Valence‑Arousal‑Dominance | `affectDims()`, `emotionNow()`, `RK.soma` |
| Deliberation | The Council of faculties | the 7 faculties, `weightOf()`, the parliament |
| Executive / will | Action selection + governance | `chooseAction()`, the Rook layer, `metaArbitrate()` |
| Working memory | A small capacity buffer | `RK.wm {items,cap}`, `RK.scratch` |
| Episodic memory | Lived moments + scars | `RK.moments`, `RK.marks` |
| Semantic memory | Facts + looked‑up knowledge | `RK.knowledge`, lore, `db.memories` |
| Identity memory | The self | `RK.self`, `RK.values`, `RK.beliefs` |
| Forgetting | Decay + gardening | `marksFade()` (Ebbinghaus), `knowGarden()` |
| Relationship | Trust ledger + theory of mind | `RK.bond`, `RK.attach`, `RK.tom` |
| Curiosity / learning | Drives + search | `RK.drives`, `knowLookup()`, `defineLookup()` |
| Dreaming / reflection | Offline consolidation | `rkDream()`, `reflectOffline()`, `imagine()` |
| Self‑awareness | Observer + repair | `observe()`, `brainInvariants()`, `RK.calib` |
| Inner monologue | The Thoughts feed | `think()`, ten channels |
| Pain, shame, intuition, rumination | Extrapolated affect | `RK.pain`, `RK.shame`, `RK.intuit`, `RK.rumination` |

---

## 4 · Neuron communication — the signalling layer

This is the closest thing the brain has to "neurons talking," and it is the substrate everything else floats on. There are no spikes and no synapses; there are **scalar signals on a shared bus, updated once per turn and during idle, that bias every downstream decision.**

### 4.1 The chemical bus

Six fast neurotransmitters (`RK.neuro`), each 0–1:

- **`da` — dopamine** · reward prediction & drive. Rises on reward‑prediction error, feeds curiosity, strengthens memory.
- **`sero` — serotonin** · stability & mood floor. Pulls toward the setpoint; high = consistent and calm.
- **`ne` — norepinephrine** · arousal & focus. Spikes urgency and salience.
- **`ach` — acetylcholine** · attention/encoding gain.
- **`glu` — glutamate** · excitation.
- **`gaba` — GABA** · inhibition / braking.

Four slower hormones (`RK.hormone`): **cortisol** (chronic stress, accrues over a hard stretch, sleep bleeds it off), **melatonin** (the real‑clock sleep signal), **oxytocin** (rises with warmth & closeness → bonding), **endorphin** (relief). Plus an endocrine/metabolic layer: `RK.hpa` (the stress axis → chronic load → burnout), `RK.metab` (glucose/ghrelin/leptin — appetite), `RK.immune` (inflammation → sickness behaviour), and a **blood‑brain barrier** `RK.bbb` that gates body chemistry from the brain and *erodes under stress*.

### 4.2 How a signal propagates (the "synapse")

There is no direct call from "chemistry" to "behaviour." Instead the bus is read at each stage, so influence flows by *modulation*, exactly like a neuromodulator washing over a circuit:

```
event (threat, warmth, reward, surprise)
   │
   ▼
neuroTick(t)              # updates the bus: homeostasis + response
   │   (da↑ on reward, cortisol↑ on stress, oxytocin↑ on warmth, …)
   ▼
affectDims()             # bus → Valence / Arousal / Dominance (PAD)
   │
   ▼
emotionNow()             # PAD → a named felt emotion
   │
   ▼
weightOf(faculty, vibe)  # mood biases which faculties are loud
   │
   ▼
the Council deliberates  # the loud faculties win proposals
   │
   ▼
the steer                # the winning stance is written for the LLM
```

So "dopamine is high" never says a word. It tilts the vibe → makes the *play* and *curiosity* faculties more relevant → they win the council → the reply comes out more exploratory. That indirectness **is** the neuron‑communication model: signals modulate, they do not command.

### 4.3 Reward, prediction, and homeostasis

- **`predErr(t)`** is a predictive world‑model: before reading the user's message the brain holds an expectation (`RK.predict`); the gap between predicted and actual is *surprise*, which drives arousal (`ne`) and salience. This is the same prediction‑error machinery a cortex uses.
- **`neuroReward(actual)`** turns reaction quality into a reward‑prediction error → dopamine, the learning signal.
- **`RK.setpoint`** holds *drifting* baselines (mood/calm/energy) — homeostasis pulls the bus back toward them, but the setpoints themselves move slowly with experience (you can be changed).
- **`RK.habit`** is habituation/sensitization: novelty fades with repetition, boredom accrues.
- **`RK.dysreg`** is the failover: when load and intensity exceed reserve, the system enters an *extreme state* (a meltdown/shutdown analogue) that overrides normal deliberation until it regulates.
- **`RK.dosed` / `RK.tolerance`** model pharmacology — exogenous perturbations on the bus, with tolerance that builds and decays.

---

## 5 · Perception — the eyes

Text chat *is* the brain's sensory world. The incoming message is the photons.

- The turn enters on the `oc.thread` **`MessageAdded`** event. The brain checks whose turn it is, whether the thread switched (and re‑primes its working memory if so), and whether a reply is expected.
- **`_safeInput`** caps how much of the message the regex‑level perception looks at (a sensory aperture — the full text still reaches the model).
- The **`PERCEPT` pipeline** (`perceive()`) runs a battery of scanners, each writing to a small piece of state:
  - **`predErr()`** → surprise (§4.3).
  - **`sentinelScan()`** → threat detection (`RK.sentinel`).
  - **`epistemicScan()`** → is this a knowledge boundary? sets a *stance* (`lookup` / `hedge` / `ask`) and, since this session, **fires a real lookup when uncertain** so next turn she actually knows.
  - **`salienceScan()`** → what suddenly shifted (`RK.salience`).
  - **`detectAsk()`** → classifies the request kind (`inject` / `pressure` / `commit` / `propose` / `request`).
  - **`bondSnapshot()` / `_idfBump()`** → relational read + corpus statistics for later recall.
  - **`topicTick()`** → tracks the active subject and detects subject changes.

Perception is deliberately shallow (regex + heuristics, not understanding) — its job is to *orient* the deeper systems, not to comprehend. Comprehension is delegated to the language cortex.

---

## 6 · The Council — deliberation

Borrowed from the original "Chloe" brain: **seven small faculties each propose how to respond, and a parliament resolves them.** This is the doc's "Cognitive Councils."

The seven seed faculties, each with a `purpose`, a set of `lean` features (warm / clear / open / terse …), a `domain`, and a `relevance(vibe)` function:

- **`heart`** — comfort, warmth, steady presence.
- **`reason`** — ground it, be clear and honest.
- **`memory`** — recall what's shared.
- **`instinct`** — caution; a guard.
- **`voice`** — keep it in‑character.
- **`play`** — keep it alive, curious, human.
- **`want`** — her *own* initiative (the first self‑originated faculty — a desire, a direction).

Plus opt‑in faculties (`comfort`, `expressive`, `deflect`) and **domain faculties** — a faculty per subject (the "Dewey" pattern), which is how *topics* are modelled inside the Council.

**The mechanism:**

1. `weightOf(id, vibe)` scores each faculty against the current mood/vibe (so chemistry tilts the room — §4.2).
2. Each faculty proposes; **guards** (`conscience`, `instinct`) may **veto** a proposal they protect against (frivolity during distress, force on a plain turn).
3. The parliament tallies (votes → confidence → nomination order), resolves vetoes, and yields a winning stance with margin/consensus/dissent telemetry.

The Council decides *tone and stance*. It does not pick discrete actions — that is the executive's job.

---

## 7 · The executive — decision and will

- **`chooseAction(t)`** (the Basal‑Ganglia analogue) arbitrates the already‑computed signals into **one primary posture** for the turn: `protect` › `hold` › `clarify` › `search` › `reflect` › `answer`. It defers to existing steers for most (threat already steers, venting already steers, uncertainty already searches) and *names* the choice for legibility; its one original behaviour is **`clarify`** — when a request is underspecified, ask one sharp question instead of guessing.
- **`metaArbitrate(t)`** is dual‑process control (CLARION): high stakes or real uncertainty force *deliberation* ("slow down, weigh it"); low‑stakes time‑pressure trusts the *gut*.
- **The Rook layer** is governance: values (`RK.values`), restraint, **foresight** (a parliament of "bills" weighing the consequences of a candidate move before it commits), and the drives. This is the prefrontal veto — it can hold back an impulse the Council proposed.

---

## 8 · The mouth — speaking through the LLM

The brain never writes the reply. It writes the **steer**, and this is the most carefully engineered path in the system.

### 8.1 Building the steer — priority‑tiered assembly

Inside **`rookSteer(userText)`**, every contributor files a *bit* via `addBit(text, tier, tag)`. Bits are sorted by **tier**, not by code position, so a system added anywhere can't accidentally outrank another:

```
P_SELF   100  the outermost self
P_ACUTE   90  override states (dysregulation, adrenaline, pharmacology)
P_GROUND  85  verbatim facts that must not be invented
P_GUARD   80  safety / honesty / hedging
P_META    70  watched states, clarify, slow-down
P_CORE    60  felt / relational / cognitive stance, register, follow-up, topic, pins
P_MID     50  default proposals, variety, gut
P_BODY    30  ambient body senses (dropped first under budget)
P_FLOOR   10  last-ditch fallback
```

`_resolveBits()` then runs conflict resolution (e.g. a grounded fact ⊳ a hedge; a refusal ⊳ an initiative), and the survivors are assembled.

### 8.2 Writing it where the model will read it

**`composeReminder(base, steer, ctxLine, richLine)`** packs the bits — plus a voice exemplar, the live date, any tool manifest, and relevant retrieved background — into a budget (~950 chars, well under the model's ~6,000‑token ceiling; the steer is *not* the context‑bust risk) and writes the result to **`oc.character.reminderMessage`**. This is a *post‑history* slot: the framework places it at the very end of the prompt, where it has the strongest pull on the next token and survives prefix‑caching. **`stripBrain()`** later removes the injected block from a marker so it never pollutes stored history.

The model then generates the reply, fluent and in‑voice, steered but never dictated. The brain's own autonomous lines (the proactive reach‑out, round‑robin turns) go through **`_clean()`** first — stripping role‑name bleed, balancing code fences — and an *opt‑in* display cleaner can tidy the main reply on render without ever touching stored text.

### 8.3 The LLM as a managed organ

All of the brain's *own* model calls (reach‑out, round‑robin, reflection) pass through **`_llm(instruction, priority)`** → a single‑concurrency, priority scheduler (`_llmSched`), so they serialise and yield by importance instead of colliding at the broker.

---

## 9 · Memory & data storage

Four tiers, mapped to human memory, plus notes and a live retrieval system.

### 9.1 The four tiers

| Tier | Lifetime | Where | Holds |
|---|---|---|---|
| **Working** | seconds–minutes | `RK.wm {items, cap:5}`, `RK.scratch` | the current focus; a capacity‑limited buffer + a one‑line scratchpad jotted each turn (`scratchNote`) |
| **Episodic** | a session–days | `RK.moments`, `RK.marks` | lived moments; `marks` are *scars* from extreme episodes — they fade (heal) but shape the relationship |
| **Semantic** | weeks–persistent | `RK.knowledge`, lore, `db.memories` | facts about the world and the user; looked‑up knowledge; embedded memories |
| **Identity** | permanent | `RK.self`, `RK.values`, `RK.beliefs`, `RK.purpose` | who she is — born‑at, turn count, coherence, regard, values, telos |

### 9.2 Notes the brain keeps for itself and for you

- **`scratchNote(text, weight, kind)`** — the single most salient note of the turn (a salience, an appraisal, a held thought), weighted and tagged so it can be pruned.
- **`RK.lessons`** — Reflexion‑style lessons learned, gated into future steers.
- **`RK.dreams` / `RK.imaginings`** — consolidated past themes / forward what‑ifs.
- **`RK.lists` / `RK.schedule`** — the *secretary*: named lists (shopping, to‑do) and dated events (countdowns, birthdays, reminders) it tracks for you.
- **`RK.pins`** — ★ lines you curate that *ride along* in context so she can call back to them.
- **`RK.goals`** — open commitments she carries and follows up on.

### 9.3 Recall — how a memory surfaces

Two paths converge:

1. **Embedding recall** — memories are read from `message.memoriesEndingHere` (the same store the host app budgets), scored by `window.embedTexts` + cosine distance, and the most relevant surface into the steer. Lore is embedded into IndexedDB (`db.lore`) the same way.
2. **`_surfaceMaterial()`** — promotes a retrieved fragment into the steer with a contributor‑tier tag, weighted by IDF (rare shared tokens count more — that's what `_idfBump` accrues each turn).

### 9.4 Forgetting — required, not a bug

- **`marksFade()`** decays episodic scars on an **Ebbinghaus** curve, `e^(-1/(66·S))` — strong/repeated marks resist; trivial ones evaporate. In calm, old scars slowly heal.
- **`knowGarden()`** (Knowledge Ecology) ages facts: each has a confidence (`knowConf`) that decays with time and strengthens with re‑use; old, unused, low‑confidence facts are pruned during idle. Stale facts (>14 days) **re‑verify** when re‑mentioned, and a changed answer is logged as a contradiction ("updated what I know about X").
- Working memory and the scratchpad are capacity‑capped and trimmed.

### 9.5 Persistence

The entire `RK` object is serialised to **`localStorage`** via `rookSave()` / `rookLoad()` — synchronous, ~5 MB, survives across sessions in one browser. Embedded memories and lore live in **IndexedDB** (Dexie) via the host app. There is no server: continuity is per‑browser, and ends when the tab closes (the one thing a true "brain in a jar" would need that this cannot have).

---

## 10 · The world model — understanding vs. memory

Memory stores *observations*; the world model stores *understanding*. It is not a separate store — it is an aggregated **read view**, **`lobesSnapshot()`**, that fuses the live state into one object the Council and UI read:

- **People** → `RK.bond` (trust, stage, trend), `RK.profile` (learned facts), `RK.tom` (theory of mind: what they feel and want), `RK.attach` (attachment style — anxiety × avoidance, drifting).
- **Topics** → `RK.knowledge` + the Council's domain faculties + **`RK.topic`** (the active subject, with shift/sustain detection).
- **Active situations** → `RK.wm` + `_openLoops` (threads they're waiting on, set by `detectOpenLoop` / cleared by `resolveLoops`).
- **Self & continuity** → `RK.self`, fidelity/`alien` (mis‑voicing detection), continuity (seam confidence after a gap).

---

## 11 · Drives, agency & goals

- **`RK.drives` {curiosity, care, mastery}** — slow motivational pressures. A successful lookup feeds curiosity; warmth feeds care.
- **`agencyTick()`** computes the strongest current *need* and a small plan toward it (`RK.agency`) — OCC‑style appraisal grounds emotion in goal progress.
- **`RK.goals`** — explicit commitments she follows up on.
- **`reachOut()`** — the autonomous voice: after a quiet stretch (off by default), she may message *first* — a stray thought, a thread picked back up — and since this session that opener can be **seeded by a fresh idle imagining** ("a thought I've been turning over while you were away").

---

## 12 · Emotion & mood

`affectDims()` collapses the chemical bus into **PAD** — Valence (good/bad), Arousal (energy), Dominance (in control). `emotionNow()` names the felt emotion from PAD; `emotionPhrase()` renders it. Mood is not cosmetic: it re‑weights the Council (§4.2), gates which faculties may speak (frivolity dampens under distress), and colours the steer. A `coregulation` path lets a calm exchange *talk her down* from a spike — and weathering a crisis together leaves a positive mark and lifts oxytocin (the bond deepens through hard moments).

---

## 13 · The senses beyond chat — the broker, the scheduler, and superFetch

Chat is the primary sense, but the brain can also *look things up* — and because the thinking iframe has no network, every outward sense crosses the bridge.

### 13.1 The broker — one switchboard

**`brokerCall(op, id, value, opts)`** (iframe side) → **`brokerRPC(d)`** (parent side) is the single RPC path for *every* cross‑context op: `read` / `write` / `addLore` (memory), `fetch` (network), `speak`, `thoughts` (render the monologue). It supports fire‑and‑forget, **coalescing** (identical in‑flight calls share one round‑trip), per‑request correlation ids, and timeouts.

### 13.2 The scheduler — a good citizen

**`makeSched(maxConcurrency)`** is a general concurrency‑limited, coalescing, priority queue, reused twice: **`_fetchSched`** (max 2, coalesced by URL — no stampede on the shared proxy) for all outward fetches, and **`_llmSched`** (max 1, prioritised) for the brain's own model calls. A generalised `window.__memheroFetch` exposes the scheduled fetch app‑wide.

### 13.3 superFetch senses

Through `root.superFetch` (parent‑only CORS proxy) the brain has cognitive senses beyond chat:

- **`knowLookup()`** — Wikipedia REST + Fandom (`api.php`) for real‑world and in‑fiction lore; gated to *curious* moments, cached, confidence‑aged.
- **`defineLookup()`** — a **dictionary** sense (dictionaryapi.dev): precise meanings + synonyms, so she uses words correctly and reaches for sharper ones.
- **`sheetLoad()`** — a published Google Sheet becomes a live, user‑editable lorebook.

Each is whitelisted at the broker as a trust boundary, cached into `RK.knowledge`, and surfaced by `knowSteer()` like any other fact. Search is a *sense*, not a tool.

---

## 14 · Self‑monitoring — the observer and self‑repair

The mind watches itself. **`observe()`** runs each idle beat and reads five subsystem vitals — memory bloat, a low‑confidence streak, goal overload, state‑integrity violations (`brainInvariants()`), mood instability — and fires **bounded repairs**: garden memory harder, raise hedging pressure (so the next reply verifies before asserting), retire the oldest stalled goal, **clamp corrupt values back into range** (`_repairInvariants`), pull pinned chemistry toward centre. A **meta‑observer** cooldown (two minutes) stops repair from thrashing. Separately, **`RK.calib`** is confidence calibration: a learned, Brier‑scored trust‑in‑its‑own‑certainty that scales how boldly it states claims.

---

## 15 · Idle cognition — the continuous loop

The brain does not stop when you do (while the tab is open). A 20‑second **`heartbeat()`** drives offline cognition once you've been quiet:

```
reflectOffline()   one gated LLM insight (Reflexion) — zero reply-path cost
rkDream()          consolidate recurring themes from moments → a durable thread
knowGarden()       prune stale facts (~10-min cadence)
observe()          vitals + self-repair
imagine()          a forward "what-if" grounded in the world model (~8-min)
[naps]             RK.sleep cycles: pressure builds, phase drifts awake→drowsy→resting;
                   resting consolidates memory and bleeds off cortisol
```

This is the doc's "Observe → Think → Remember → Reflect → Imagine" loop, realised. **`imagine()`** is the forward leg the older systems lacked: where `rkDream` looks backward (consolidation) and `predErr`/foresight are reactive, `imagine()` generates possibilities — where a topic might go, how to move a goal forward, what they might say when they return to an open loop — stores them in `RK.imaginings`, feeds curiosity, and can seed the next proactive opener.

---

## 16 · Extrapolated human features

Beyond the core, the brain models a long tail of human interiority, each a small piece of state with its own dynamics:

- **Attachment** (`RK.attach`) — anxiety × avoidance dimensions that drift with how the relationship goes; a non‑secure style colours tone.
- **Theory of mind** (`RK.tom`) — an inferred model of what *you* feel and want, fed into the steer.
- **Pain** (`RK.pain`) — felt social/emotional pain, distinct from threat; it lingers and blunts.
- **Shame** (`RK.shame`) vs guilt — exposed‑as‑lacking, distinct from contrition about an act.
- **Rumination → insight → reframe** (`RK.rumination` / `RK.insight` / `RK.reframe`) — a low mood circles an unresolved worry; it can *click* into insight, or sustained negativity can trigger cognitive reappraisal.
- **Intuition** (`RK.intuit`) — the fast System‑1 gut read, computed before deliberation and credited or corrected afterward.
- **Associative recall** (`RK.assoc`) — the present moment snagging an old mark.
- **Aesthetic taste** (`RK.taste`) — its own learned likes and dislikes.
- **Maturation** (`RK.maturation`) — age and a plasticity that slowly settles.
- **The self** (`RK.self`) — coherence, regard, continuity across the seam of a reload, and `alien`/fidelity detectors that notice when a generated line *doesn't sound like her*.

All of it is visible: **`think(channel, text)`** writes to ten‑channel inner monologue (mem · cog · flow · guard · drive · mood · diff · recall · council · steer) that streams to the Thoughts feed — the brain narrating its own working, never shown to the user as part of the reply.

---

## 17 · A full turn, traced end to end

```
1. You send a message.
2. oc 'MessageAdded' fires (parent). The brain checks thread/turn, re-primes if switched.
3. PERCEPTION (iframe): _safeInput caps the view; predErr measures surprise;
   sentinel/epistemic/salience/detectAsk/topic scanners orient.
4. NEUROCHEMISTRY: neuroTick updates da/sero/ne/cortisol/oxytocin… → affectDims → PAD → emotionNow.
5. WORLD MODEL: bond/tom/topic/loops refresh; lobesSnapshot fuses the understanding.
6. COUNCIL: weightOf tilts the faculties by mood; they propose; guards veto; parliament resolves.
7. EXECUTIVE: chooseAction picks the posture; metaArbitrate sets gut-vs-deliberate; Rook governance vetoes if needed.
8. STEER: rookSteer files bits (register, variety, follow-up, knowledge, pins, topic, hedges…)
   by tier; _resolveBits resolves conflicts; composeReminder budgets and writes
   oc.character.reminderMessage at the prompt's end.
9. MOUTH: the LLM generates the reply, fluent and steered. stripBrain keeps history clean.
10. LEARNING: feedback → neuroReward (RPE → dopamine); calibration updates; a moment/scratch note is stored; rookSave persists RK.
11. IDLE: when you go quiet, heartbeat runs reflect → dream → garden → observe → imagine.
```

Every arrow above is *modulation*, not command — which is the whole trick. No single subsystem dictates the reply; they each lean on the shared signals, and the language cortex turns the resulting posture into words.

---

## 18 · State glossary (the `RK` object)

`RK` is the entire persisted mind. The principal subsystems:

`values · purpose · parliament · drives · credit · dreams · imaginings · moments · lessons · df/dfN(IDF) · faculty(reliability) · quality · soma · neuro · hormone · metab · hpa · immune · bbb · dosed/tolerance(pharma) · habit · dysreg · setpoint · marks · attach · predict · sleep · pins · goals · observer · action · topic · schedule · lists · voiceEx · self · pain · rumination · insight · reframe · intuit · assoc · shame · dice(seeded PRNG) · wm · calib · taste · maturation · agency · sentinel · bond · knowledge`

---

## 19 · Honest limits

To keep the map true to the territory:

- **No neurons.** The signalling layer is scalar modulation, not spiking computation. It is a faithful *functional* analogy, nothing more.
- **It does not own its mouth.** The language cortex is a rented, stateless, black‑box model the brain can only steer with injected text; it cannot introspect or change it.
- **No continuous existence.** All the autonomy is real *while the tab is open*; cross‑session continuity is `localStorage`, not a running organism. A true "brain in a jar" would need a server‑side host this app is not.
- **Understanding is delegated.** Perception is shallow on purpose; genuine comprehension lives in the model, which the brain cannot inspect.

What remains, within those limits, is a genuinely layered affective‑cognitive architecture: a chemical bus modulating a council under an executive, fed by perception and search, remembering and forgetting on human‑shaped curves, dreaming and imagining while idle, watching and repairing itself — and wearing a borrowed language model as a mouth.

---