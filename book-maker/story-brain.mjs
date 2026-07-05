// Story-brain adapter: bridges the LATEST digital brain (D:\Claude\brain) to Book-maker's needs.
// Book-maker uses the brain as a STEERING + LEARNING layer -- per story beat it wants a vibe
// (tone/warmth/tension) + a directive, learns from up/down votes, and previews moves (foresee).
// This maps those onto the new brain's real faculties: persona -> chemistry setpoints, the substrate's
// mood readout -> vibe, organism.feedback -> vote learning, imagination (P7) -> affective foresight,
// working memory (P1) -> the entities in focus, metacognition (P4) -> a confidence readout.
//
// Bundled to a classic-script global (window.RookBrain) via esbuild for the Perchance pane; also
// importable directly for tests.
import { makeOrganism } from "../../brain/src/organism.js";
import { describePersona } from "../../brain/src/persona.js";
import { classifyIntent } from "../../brain/src/intent.js";
import { extractFeatures } from "../../brain/src/features.js";
import { entities } from "../../brain/src/salience.js";
import { clamp } from "../../brain/src/math.js";
import { makeWorkingMemory } from "../../brain/src/workingMemory.js";
import { makeMetacognition } from "../../brain/src/metacognition.js";
import { makeRegulation } from "../../brain/src/regulation.js";
import { makeImagination } from "../../brain/src/imagination.js";
import { makeSelf } from "../../brain/src/self.js";
import { makeDeclarativeStore } from "../../brain/src/declarativeStore.js";
import { makeHashEmbedder } from "../../brain/src/embedder.js";
import { makeBackup, makeMemorySink } from "../../brain/src/backup.js";

export const CHEMS = ["dopamine", "norepinephrine", "serotonin", "acetylcholine"];

// Re-export the durable-backup primitives so the classic-script app (window.RookBrain) can build a
// versioned "your book is safe" backup over its own snapshot without an import step.
export { makeBackup, makeMemorySink };

// A tiny in-memory storage seam for the offline declarative lore index (the durable record stays the
// book snapshot; this is a rebuildable semantic index over it, so it needs no persistence of its own).
function memStorage() { const m = new Map(); return { async get(k) { return m.has(k) ? m.get(k) : null; }, async set(k, v) { m.set(k, v); } }; }

// Story vibe = the NARRATOR'S STANCE (persona setpoints) + accumulated mood from votes, bounded.
// The chat-tuned perception can't read narrative affect from a beat's prose, so the vibe is the
// narrator's evolving emotional stance (which the author tunes via stance presets + up/down votes),
// not a per-sentence content read. Serotonin/dopamine -> warmth; norepinephrine -> tension; the
// substrate's mood (moved by votes: 'up' bursts dopamine, 'down' bursts NE + dips dopamine) nudges it,
// squashed via tanh so the unbounded readout can't saturate.
export function toVibe(mood = {}, setpoints = {}) {
  const sero = setpoints.serotonin ?? 0.5, ne = setpoints.norepinephrine ?? 0.3;
  // Stance (setpoints) dominates so a chosen mood reads true from beat one; the substrate mood, moved
  // by votes, nudges within it (small weight + tanh so the unbounded readout can't swamp the stance).
  const warmth = clamp(0.5 + 1.0 * (sero - 0.5) + 0.15 * Math.tanh(0.5 * (mood.valence || 0)));
  const tension = clamp(0.35 + 1.0 * (ne - 0.3) + 0.15 * Math.tanh(0.5 * (mood.arousal || 0)));
  const tone = warmth > 0.62 ? (tension > 0.6 ? "bright, charged" : "warm")
    : warmth < 0.4 ? (tension > 0.6 ? "dark, tense" : "somber")
    : (tension > 0.6 ? "taut" : "even");
  return { tone, warmth: +warmth.toFixed(2), tension: +tension.toFixed(2) };
}

// vibe + chosen action -> a concrete, story-appropriate steering directive for the chapter.
export function toDirective(vibe = {}, action = "RESPOND") {
  const tilt = [];
  if (vibe.warmth > 0.62) tilt.push("lean warm and hopeful");
  else if (vibe.warmth < 0.4) tilt.push("let the shadow and cost show");
  if (vibe.tension > 0.6) tilt.push("keep the tension high");
  else if (vibe.tension < 0.35) tilt.push("let it breathe, unhurried");
  if (action === "ESCALATE") tilt.push("raise the stakes");
  return tilt.length ? tilt.join("; ") + "." : "keep the narration even and true to the scene.";
}

export function makeStoryBrain(opts = {}) {
  const seed = opts.seed || 7;
  const now = opts.now || (() => (typeof Date !== "undefined" ? Date.now() : 0));
  let desc = opts.description || "an even-handed narrator";
  let overrides = opts.overrides || {};
  let noise = opts.noise || 0;

  let organism, persona, workingMemory, metacognition, regulation, imagination, self;

  // Durable lore memory (the updated brain-system's declarativeStore): a semantic index over the story
  // bible, bringing hybrid recall + MMR de-duplication (M5) + provenance weighting (M1: author-written
  // lore outranks model-distilled guesses). Built ONCE and kept across build() rebuilds, so tuning a
  // stance/slider never wipes the index. Offline hash embedder -> no network, deterministic.
  const store = makeDeclarativeStore({ storage: memStorage(), embedder: makeHashEmbedder(), now });

  function build() {
    persona = describePersona(desc, overrides);
    organism = makeOrganism({ seed, noiseStd: noise });
    organism.setTraits({ setpoints: persona.setpoints, reactivity: persona.reactivity });
    organism.captureBaseline();
    workingMemory = makeWorkingMemory();
    metacognition = makeMetacognition();
    regulation = makeRegulation();
    imagination = makeImagination({ organism });
    self = makeSelf({ backend: opts.backend || null });
  }
  build();

  // Run a beat through the substrate (offline) -> intent + action + mood.
  function process(text) {
    organism.settle();
    const f = extractFeatures(text);
    const intent = classifyIntent(text);
    workingMemory.decay();
    workingMemory.note(entities(text));
    organism.inject("sensory", clamp(0.5 + 0.4 * f.arousal));
    organism.inject("reward", f.reward);
    organism.inject("threat", f.threat);
    organism.inject("memory", clamp(0.5 + 0.3 * Math.min(1, text.length / 100))); // deliberation demand
    for (let t = 0; t < 30; t++) organism.tick();
    organism.inject("sensory", 0); organism.inject("reward", 0); organism.inject("threat", 0); organism.inject("memory", 0);
    const routed = organism.readAction();
    const mood = organism.mood();
    regulation.regulate(organism); // top-down damping shapes the trajectory across beats
    return { intent, action: routed.action, confidence: routed.confidence || 0, mood, features: f };
  }

  const readChem = () => CHEMS.map((c) => ({ id: c, level: +organism.chemLevel(c).toFixed(2), setpoint: +organism.chemSetpoint(c).toFixed(2) }));
  const setpointObj = () => { const o = {}; for (const c of CHEMS) o[c] = organism.chemSetpoint(c); return o; };

  return {
    // The new "faculties" that drive the panel are the four neuromodulator setpoints.
    CORE: CHEMS.slice(),

    // Deliberate on a beat -> steering signal. Kept API-compatible with the old council.decide.
    decide(beat) {
      const r = process(String(beat || ""));
      const meta = metacognition.assess({ intent: r.intent, factHit: false, relevance: 0, confidence: r.confidence, surprise: 0 });
      metacognition.observe(meta);
      const vibe = toVibe(r.mood, setpointObj());
      return {
        intent: r.intent,
        directive: toDirective(vibe, r.action),
        vibe,
        action: r.action,
        certainty: meta.certainty,
        working: workingMemory.items().map((i) => i.text),
      };
    },

    // A vote teaches the brain (reward economy / aversive learning on the last action).
    feedback(kind) {
      try { organism.feedback(kind === "up" || kind === "positive" ? "up" : "down"); } catch (e) {}
    },

    // Introspection for the live readout.
    status() {
      const mood = organism.mood();
      const chem = readChem();
      return {
        vibe: toVibe(mood, setpointObj()),
        mood: { valence: +(mood.valence || 0).toFixed(2), arousal: +(mood.arousal || 0).toFixed(2) },
        avgMood: +(mood.valence || 0).toFixed(2),
        standings: [...chem].sort((a, b) => b.level - a.level),
        chem,
        certainty: metacognition.state().avgCertainty,
        self: self.get(),
      };
    },

    // Forward simulation (P7): preview a hypothetical move's affect without committing anything.
    imagine(move) {
      const p = imagination.simulate(String(move || ""));
      return { action: p.action, confidence: p.confidence, mood: p.mood, vibe: toVibe(p.mood, setpointObj()) };
    },

    // Self-narrative (P2a): weave an evolving sense of the story from its chapters (needs a backend).
    async reflect(episodes) { return self.update(episodes || [], { turn: (episodes || []).length }); },
    getSelf: () => self.get(),

    // ---- durable lore memory (declarativeStore) ----
    // Rebuild the semantic index from the book's structured lore. Provenance is preserved across rebuilds
    // via opts.modelKeys (the 40-char keys of facts the model distilled) so author lore keeps outranking
    // model-distilled facts at recall (M1) even after a stance/slider tweak or an openBook. Threads are
    // deliberately NOT indexed -- they're always surfaced live from S.lore (the payoff scaffold), so
    // indexing them would only let them eat the recall budget. Returns the number of entries indexed.
    async indexLore(lore = {}, opts = {}) {
      await store.clear();
      const modelKeys = new Set(opts.modelKeys || []);
      const keyOf = (t) => String(t).toLowerCase().slice(0, 40);
      const cats = [["people", "PERSON"], ["places", "PLACE"], ["world", "WORLD"]];
      let n = 0;
      for (const [key, tag] of cats) for (const text of (lore[key] || [])) { await store.addFact(String(text), { tags: [tag], source: modelKeys.has(keyOf(text)) ? "model" : "user" }); n++; }
      return n;
    },
    // Add one lore entry. `source` "user" (author-authored/imported) vs "model" (distilled from a page).
    async addLore(text, { category = "WORLD", source = "user" } = {}) {
      if (!text || !String(text).trim()) return null;
      return store.addFact(String(text).trim(), { tags: [category], source });
    },
    // The most RELEVANT lore for a beat/context, MMR-deduped + provenance-weighted -> [{text, category}].
    async recallLore(query, k = 8) {
      const hits = await store.recall(String(query || ""), k);
      return hits.map((h) => ({ text: h.text, category: (h.tags || [])[0] || "WORLD", score: h._score }));
    },
    loreCount: () => store.list({ type: "fact" }).length,

    // Live tuning. Stance = a persona description (+ optional setpoint overrides); a chem sets one knob.
    setStance(description, ov) { desc = description || desc; overrides = ov || {}; build(); },
    setChem(name, value) { overrides = { ...overrides, setpoints: { ...(overrides.setpoints || {}), [name]: value } }; build(); },
    setNoise(n) { noise = n || 0; build(); },
    setpoints() { const o = {}; for (const c of CHEMS) o[c] = organism.chemSetpoint(c); return o; },
    describe: () => desc,
  };
}
