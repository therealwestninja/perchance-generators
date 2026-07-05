var RookBrain = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // story-brain.mjs
  var story_brain_exports = {};
  __export(story_brain_exports, {
    CHEMS: () => CHEMS,
    makeBackup: () => makeBackup,
    makeMemorySink: () => makeMemorySink,
    makeStoryBrain: () => makeStoryBrain,
    toDirective: () => toDirective,
    toVibe: () => toVibe
  });

  // ../../brain/src/neuron.js
  var NEURON_TYPES = {
    RS: { a: 0.02, b: 0.2, c: -65, d: 8 },
    // regular spiking (excitatory cortex)
    FS: { a: 0.1, b: 0.2, c: -65, d: 2 },
    // fast spiking (inhibitory)
    IB: { a: 0.02, b: 0.2, c: -55, d: 4 },
    // intrinsically bursting
    CH: { a: 0.02, b: 0.2, c: -50, d: 2 }
    // chattering
  };
  function makeDendrite({ size = 0, lr = 0.05, leak = 0.01, gain = 0.5 } = {}) {
    const w = new Array(size).fill(0);
    return {
      w,
      lr,
      leak,
      gain,
      predict(x) {
        let s = 0;
        for (let i = 0; i < w.length; i++) s += w[i] * (x[i] || 0);
        return s;
      },
      // Leaky Widrow-Hoff: nudge w to reduce (target - prediction) error, then decay toward 0 (forgetting).
      adapt(x, target) {
        const err = target - this.predict(x);
        for (let i = 0; i < w.length; i++) w[i] = (1 - leak) * w[i] + lr * err * (x[i] || 0);
      },
      reset() {
        for (let i = 0; i < w.length; i++) w[i] = 0;
      }
    };
  }
  function makeNeuron(type = NEURON_TYPES.RS, { dendrite = null } = {}) {
    const p = { ...type };
    const dend = dendrite ? makeDendrite(dendrite) : null;
    const neuron = {
      a: p.a,
      b: p.b,
      c: p.c,
      d: p.d,
      v: -65,
      u: p.b * -65,
      dendrite: dend,
      // null unless opted in
      // Advance by dt ms; returns true if a spike was emitted this step.
      // v is integrated in two half-steps for numerical stability (Izhikevich's recipe). Optional `context`
      // drives the apical dendrite: its prediction is added to the somatic current, then it learns (LMS)
      // to predict this step's feedforward drive from that context.
      step(I, dt = 1, { context = null } = {}) {
        let drive = I;
        if (dend && context) drive += dend.gain * dend.predict(context);
        const half = dt / 2;
        this.v += half * (0.04 * this.v * this.v + 5 * this.v + 140 - this.u + drive);
        this.v += half * (0.04 * this.v * this.v + 5 * this.v + 140 - this.u + drive);
        this.u += dt * (this.a * (this.b * this.v - this.u));
        if (dend && context) dend.adapt(context, I);
        if (this.v >= 30) {
          this.v = this.c;
          this.u += this.d;
          return true;
        }
        return false;
      },
      reset() {
        this.v = -65;
        this.u = this.b * -65;
      }
    };
    return neuron;
  }

  // ../../brain/src/synapse.js
  function makeSynapse({ source, target, weight, delay = 1 }) {
    return {
      source,
      target,
      weight,
      delay,
      // On a source spike, schedule `weight` of current to the target after `delay`.
      transmit(delayQueue) {
        delayQueue.schedule(this.target, this.delay, this.weight);
      }
    };
  }

  // ../../brain/src/delayQueue.js
  function makeDelayQueue(maxDelay = 20) {
    const size = maxDelay + 1;
    const slots = Array.from({ length: size }, () => []);
    let head = 0;
    return {
      schedule(target, delay, amount) {
        const d = Math.max(1, Math.min(maxDelay, delay | 0));
        const idx = (head + d) % size;
        slots[idx].push({ target, amount });
      },
      // Advance one tick: return everything due now, then clear that slot.
      popDue() {
        head = (head + 1) % size;
        const due = slots[head];
        slots[head] = [];
        return due;
      },
      // Drop all pending deliveries (used when settling activation between turns).
      clear() {
        for (let i = 0; i < size; i++) slots[i] = [];
      }
    };
  }

  // ../../brain/src/rng.js
  function makeRng(seed = 1) {
    let s = seed >>> 0;
    function next() {
      s |= 0;
      s = s + 1831565813 | 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
    function gaussian(mean = 0, std = 1) {
      let u = 0, v = 0;
      while (u === 0) u = next();
      while (v === 0) v = next();
      return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }
    return { next, gaussian };
  }

  // ../../brain/src/network.js
  function makeNetwork({ seed = 1, maxDelay = 20, noiseStd = 0 } = {}) {
    const neurons = [];
    const synapses = [];
    const outgoing = [];
    const incoming = [];
    const delayQueue = makeDelayQueue(maxDelay);
    const rng = makeRng(seed);
    const net = {
      get neuronCount() {
        return neurons.length;
      },
      get synapseCount() {
        return synapses.length;
      },
      addNeuron(type) {
        neurons.push(makeNeuron(type));
        outgoing.push([]);
        incoming.push([]);
        return neurons.length - 1;
      },
      connect(source, target, weight, delay = 1) {
        const s = makeSynapse({ source, target, weight, delay });
        synapses.push(s);
        const idx = synapses.length - 1;
        outgoing[source].push(idx);
        incoming[target].push(idx);
        return idx;
      },
      // inputs: { neuronIndex: externalCurrent }. Returns indices that spiked this tick.
      // gain scales the net input current (volume-transmission neuromodulation, e.g. norepinephrine
      // arousal -> excitability); noiseScale scales the intrinsic noise (NE also adds jitter).
      tick(inputs = {}, { gain = 1, noiseScale = 1 } = {}) {
        const due = delayQueue.popDue();
        const I = new Array(neurons.length).fill(0);
        for (const { target, amount } of due) I[target] += amount;
        for (const k in inputs) I[+k] += inputs[k];
        if (gain !== 1) for (let i = 0; i < I.length; i++) I[i] *= gain;
        if (noiseStd > 0) for (let i = 0; i < I.length; i++) I[i] += rng.gaussian(0, noiseStd * noiseScale);
        const spiked = [];
        for (let i = 0; i < neurons.length; i++) {
          if (neurons[i].step(I[i], 1)) spiked.push(i);
        }
        for (const i of spiked) {
          for (const sIdx of outgoing[i]) synapses[sIdx].transmit(delayQueue);
        }
        return spiked;
      },
      // Return neurons to rest and drop in-flight synaptic currents, WITHOUT touching weights.
      // Used to settle transient activation between conversational turns (prevents refractory
      // carry-over from suppressing the next turn).
      resetActivation() {
        for (const n of neurons) n.reset();
        delayQueue.clear();
      },
      // Accessors used by plasticity/governance later.
      _neurons: neurons,
      _synapses: synapses,
      _outgoing: outgoing,
      _incoming: incoming
    };
    return net;
  }

  // ../../brain/src/neuromodulation.js
  var CHEMICALS = {
    DOPAMINE: "dopamine",
    NOREPINEPHRINE: "norepinephrine",
    SEROTONIN: "serotonin",
    ACETYLCHOLINE: "acetylcholine"
  };
  var DEFAULTS = {
    dopamine: { setpoint: 0.2, k: 0.18, reactivity: 1 },
    norepinephrine: { setpoint: 0.3, k: 0.05, reactivity: 1 },
    serotonin: { setpoint: 0.5, k: 0.02, reactivity: 1 },
    acetylcholine: { setpoint: 0.3, k: 0.05, reactivity: 1 }
  };
  var DEFAULT_SETPOINTS = {
    dopamine: DEFAULTS.dopamine.setpoint,
    norepinephrine: DEFAULTS.norepinephrine.setpoint,
    serotonin: DEFAULTS.serotonin.setpoint,
    acetylcholine: DEFAULTS.acetylcholine.setpoint
  };
  var VALENCE_CENTER = DEFAULT_SETPOINTS.dopamine + DEFAULT_SETPOINTS.serotonin - 0.5 * DEFAULT_SETPOINTS.norepinephrine;
  function makeNeuromodulation({ setpoints = {}, reactivity = {} } = {}) {
    const chem = {};
    for (const name of Object.keys(DEFAULTS)) {
      const d = DEFAULTS[name];
      chem[name] = {
        setpoint: setpoints[name] ?? d.setpoint,
        k: d.k,
        reactivity: reactivity[name] ?? d.reactivity,
        level: setpoints[name] ?? d.setpoint,
        // start at rest
        phasic: 0
      };
    }
    return {
      setpoint(name) {
        return chem[name].setpoint;
      },
      level(name) {
        return chem[name].level;
      },
      // Inject a phasic event (e.g. reward -> dopamine, threat -> norepinephrine).
      burst(name, magnitude) {
        chem[name].phasic += magnitude * chem[name].reactivity;
      },
      // Advance the field one tick: apply phasic input, then homeostatic decay.
      tick() {
        for (const name of Object.keys(chem)) {
          const c = chem[name];
          c.level += c.phasic;
          c.phasic = 0;
          c.level += -c.k * (c.level - c.setpoint);
        }
      },
      // Live trait update (personality edits): change setpoint/reactivity, keep current level.
      setTrait({ setpoints: setpoints2 = {}, reactivity: reactivity2 = {} } = {}) {
        for (const name in setpoints2) if (chem[name]) chem[name].setpoint = setpoints2[name];
        for (const name in reactivity2) if (chem[name]) chem[name].reactivity = reactivity2[name];
      },
      // Plasticity gate (three-factor): how far dopamine is above its setpoint, >= 0.
      plasticityGate() {
        const c = chem.dopamine;
        return Math.max(0, c.level - c.setpoint);
      },
      // Human-facing gauge derived from the chemistry, BOUNDED to a usable range. The raw chem levels are
      // unbounded (bursts outpace the weak homeostatic decay -> dopamine climbs toward ~4 under sustained
      // reward), so the raw sums saturate; tanh squashes them to valence in (-1,1) and arousal in (0,1) --
      // near-linear near rest, saturating at the extremes -- so mood is an ACTUAL usable control signal
      // (before this, valence sat pinned at ~2-4 and describeMood's v>0.3 test read "positive" every turn).
      // Only the readout is bounded; level()/plasticityGate()/gain read raw levels, so learning is untouched.
      readout() {
        const vRaw = chem.dopamine.level + chem.serotonin.level - 0.5 * chem.norepinephrine.level - VALENCE_CENTER;
        const aRaw = chem.norepinephrine.level + 0.5 * chem.acetylcholine.level;
        return { valence: Math.tanh(vRaw), arousal: Math.tanh(aRaw) };
      },
      snapshot() {
        return JSON.parse(JSON.stringify(chem));
      },
      restore(state) {
        Object.assign(chem, JSON.parse(JSON.stringify(state)));
      }
    };
  }

  // ../../brain/src/math.js
  var clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));

  // ../../brain/src/plasticity.js
  function makeLedger({ cap = 5e3 } = {}) {
    const events = [];
    let nextId = 0;
    return {
      append({ tags = [], trigger = null, deltas = [], chemState = {}, timestamp = 0 }) {
        const id = nextId++;
        events.push({ id, tags: [...tags], trigger, deltas: deltas.map((d) => ({ ...d })), chemState: { ...chemState }, timestamp });
        if (events.length > cap) events.shift();
        return id;
      },
      all() {
        return events;
      },
      byTag(tag) {
        return events.filter((e) => e.tags.includes(tag));
      },
      byId(id) {
        return events.find((e) => e.id === id) ?? null;
      },
      // Snapshot boundary as a monotonic ID (not array length -- eviction shifts positions but never ids).
      mark() {
        return nextId;
      },
      // Drop every event appended at/after `m` (governance restore). Id-based so it survives FIFO eviction.
      truncateTo(m) {
        for (let i = events.length - 1; i >= 0; i--) if (events[i].id >= m) events.splice(i, 1);
      },
      // Restore from a serialized event list, resuming the monotonic id counter past the highest id.
      load(evts = []) {
        events.length = 0;
        for (const e of evts) events.push(e);
        nextId = events.reduce((m, e) => Math.max(m, (e.id ?? -1) + 1), 0);
      }
    };
  }
  function makeStdp({
    synapses,
    incoming,
    outgoing,
    ledger,
    aPlus = 1,
    aMinus = 1,
    tau = 20,
    learningRate = 0.1,
    gateEpsilon = 1e-3,
    commitEpsilon = 1e-6,
    maxWeight = 30,
    traceEpsilon = 1e-3
  } = {}) {
    const decay = Math.exp(-1 / tau);
    const preTrace = [];
    const postTrace = [];
    const grow = (arr, i) => {
      while (arr.length <= i) arr.push(0);
    };
    return {
      // Zero the eligibility traces. Called when settling between turns so a turn's spike-timing
      // eligibility does not leak into the next turn's STDP or feedback credit assignment.
      clearTraces() {
        preTrace.length = 0;
        postTrace.length = 0;
      },
      // Call once per tick with the indices that spiked this tick + context.
      observeSpikes(spikedIndices, { gate = 0, chemState = {}, timestamp = 0, tags = [] } = {}) {
        for (let i = 0; i < preTrace.length; i++) preTrace[i] *= decay;
        for (let i = 0; i < postTrace.length; i++) postTrace[i] *= decay;
        const open = gate > gateEpsilon;
        const deltas = [];
        for (const idx of spikedIndices) {
          const seen = /* @__PURE__ */ new Set();
          const incident = [];
          const out = outgoing[idx] || [];
          const inc = incoming[idx] || [];
          for (const s of out) if (!seen.has(s)) {
            seen.add(s);
            incident.push(s);
          }
          for (const s of inc) if (!seen.has(s)) {
            seen.add(s);
            incident.push(s);
          }
          incident.sort((a, b) => a - b);
          for (const s of incident) {
            const syn = synapses[s];
            let dw = 0;
            if (syn.source === idx) {
              grow(postTrace, syn.target);
              dw -= aMinus * postTrace[syn.target];
            }
            if (syn.target === idx) {
              grow(preTrace, syn.source);
              dw += aPlus * preTrace[syn.source];
            }
            if (dw !== 0 && open) {
              const applied = learningRate * gate * dw;
              if (Math.abs(applied) > commitEpsilon) {
                syn.weight += applied;
                deltas.push({ synapse: s, delta: applied });
              }
            }
          }
        }
        for (const idx of spikedIndices) {
          grow(preTrace, idx);
          preTrace[idx] += aPlus;
          grow(postTrace, idx);
          postTrace[idx] += aMinus;
        }
        if (deltas.length > 0) {
          ledger.append({ tags, trigger: chemState.trigger ?? null, deltas, chemState, timestamp });
        }
        return deltas;
      },
      // One-shot neuromodulated credit assignment from explicit feedback. Uses the LIVE eligibility
      // traces to find the synapses that drove the just-finished response: reward (sign +1) amplifies
      // them, punishment (sign -1) attenuates them. This is how the brain learns from criticism, not
      // just reward (the gated-STDP path above is dopamine/reward-only). Magnitude-only: a synapse's
      // SIGN is preserved (excitatory stays excitatory, never flips), and |weight| is bounded by
      // maxWeight. Deltas are ledgered with the given tags, so a feedback episode is undoable.
      modulate(sign, magnitude = 1, { tags = [], timestamp = 0, targets = null } = {}) {
        const restrict = targets ? new Set(targets) : null;
        const deltas = [];
        for (let s = 0; s < synapses.length; s++) {
          const syn = synapses[s];
          if (restrict && !restrict.has(syn.target)) continue;
          const elig = restrict ? preTrace[syn.source] || 0 : (preTrace[syn.source] || 0) * (postTrace[syn.target] || 0);
          if (elig <= traceEpsilon) continue;
          const polarity = syn.weight < 0 ? -1 : 1;
          const mag = clamp(Math.abs(syn.weight) + sign * learningRate * magnitude * elig, 0, maxWeight);
          const newW = polarity * mag;
          const delta = newW - syn.weight;
          if (Math.abs(delta) > commitEpsilon) {
            syn.weight = newW;
            deltas.push({ synapse: s, delta });
          }
        }
        if (deltas.length > 0) ledger.append({ tags, trigger: "feedback", deltas, chemState: {}, timestamp });
        return deltas;
      }
    };
  }

  // ../../brain/src/governance.js
  function makeGovernance({ synapses, ledger }) {
    let baseline = null;
    const captureWeights = () => synapses.map((s) => s.weight);
    const applyWeights = (w) => {
      for (let i = 0; i < synapses.length; i++) synapses[i].weight = w[i];
    };
    return {
      captureBaseline() {
        baseline = captureWeights();
      },
      snapshot(name = null) {
        return { name, weights: captureWeights(), ledgerMark: ledger.mark ? ledger.mark() : ledger.all().length };
      },
      restore(snap) {
        applyWeights(snap.weights);
        if (ledger.truncateTo && snap.ledgerMark !== void 0) ledger.truncateTo(snap.ledgerMark);
        else ledger.all().length = snap.ledgerLength ?? ledger.all().length;
      },
      factoryReset() {
        if (!baseline) throw new Error("no baseline captured");
        applyWeights(baseline);
        ledger.all().length = 0;
      },
      undoTag(tag) {
        const toUndo = ledger.byTag(tag);
        for (let i = toUndo.length - 1; i >= 0; i--) {
          for (const d of toUndo[i].deltas) synapses[d.synapse].weight -= d.delta;
        }
        const undoneIds = new Set(toUndo.map((e) => e.id));
        const remaining = ledger.all().filter((e) => !undoneIds.has(e.id));
        ledger.all().length = 0;
        for (const e of remaining) ledger.all().push(e);
      }
    };
  }

  // ../../brain/src/region.js
  function makeRegion({
    network,
    size,
    excitatoryRatio = 0.8,
    recurrence = 0.1,
    rng,
    excWeight = 8,
    inhWeight = 12,
    delay = 1
  }) {
    const start = network.neuronCount;
    const nExc = Math.round(size * excitatoryRatio);
    const ids = [];
    for (let i = 0; i < size; i++) {
      ids.push(network.addNeuron(i < nExc ? NEURON_TYPES.RS : NEURON_TYPES.FS));
    }
    const isExc = (id) => id - start < nExc;
    for (const src of ids) {
      for (const dst of ids) {
        if (src === dst) continue;
        if (rng.next() < recurrence) {
          network.connect(src, dst, isExc(src) ? excWeight : -inhWeight, delay);
        }
      }
    }
    return {
      start,
      size,
      ids,
      excitatory: ids.filter(isExc),
      inhibitory: ids.filter((id) => !isExc(id)),
      isExc,
      contains: (id) => id >= start && id < start + size
    };
  }

  // ../../brain/src/connectome.js
  function buildConnectome(network, rng, cfg = {}) {
    const sizes = { sensory: 60, memory: 40, association: 200, salience: 60, decision: 60, ...cfg.sizes || {} };
    const sensory = makeRegion({ network, size: sizes.sensory, recurrence: 0.02, rng });
    const memory = makeRegion({ network, size: sizes.memory, recurrence: 0.02, rng });
    const association = makeRegion({ network, size: sizes.association, recurrence: 0.08, rng });
    const salience = makeRegion({ network, size: sizes.salience, recurrence: 0.04, rng });
    const decision = makeRegion({ network, size: sizes.decision, recurrence: 0.05, rng });
    const driveTo = (srcIds, dstIds, prob, weight, delay) => {
      for (const s of srcIds) for (const d of dstIds) {
        if (rng.next() < prob) network.connect(s, d, weight, delay);
      }
    };
    const half = Math.floor(salience.excitatory.length / 2);
    const rewardPop = salience.excitatory.slice(0, half);
    const threatPop = salience.excitatory.slice(half);
    const channels = {
      sensory: sensory.ids,
      memory: memory.ids,
      reward: rewardPop,
      threat: threatPop
    };
    driveTo(sensory.excitatory, rewardPop, 0.3, 9, 1);
    driveTo(sensory.excitatory, association.ids, 0.06, 3, 2);
    driveTo(memory.excitatory, association.ids, 0.35, 8, 1);
    const actionNames = ["RESPOND", "ESCALATE", "REFLEX_REPLY", "HOLD"];
    const exc = decision.excitatory;
    const per = Math.floor(exc.length / actionNames.length);
    const actions = {};
    actionNames.forEach((name, i) => {
      actions[name] = i === actionNames.length - 1 ? exc.slice(i * per) : exc.slice(i * per, (i + 1) * per);
    });
    driveTo(rewardPop, actions.REFLEX_REPLY, 0.55, 8, 1);
    driveTo(association.excitatory, actions.RESPOND, 0.62, 9, 2);
    driveTo(threatPop, actions.ESCALATE, 0.7, 9, 1);
    driveTo(salience.excitatory, actions.HOLD, 0.08, 4, 1);
    return { regions: { sensory, memory, association, salience, decision }, channels, actions };
  }

  // ../../brain/src/codec.js
  function makeCodec({ channels, actions, driveScale = 12, rateDecay = 0.9, quietFloor = 0.5 }) {
    const drive = {};
    const rates = {};
    const neuronAction = {};
    for (const [name, ids] of Object.entries(actions)) {
      rates[name] = 0;
      for (const id of ids) neuronAction[id] = name;
    }
    return {
      inject(name, value) {
        const ids = channels[name];
        if (!ids) throw new Error(`unknown channel: ${name}`);
        const current = value * driveScale;
        for (const id of ids) drive[id] = current;
      },
      driveInputs() {
        return drive;
      },
      // Clear external drive and the decaying action rates (used when settling between turns).
      reset() {
        for (const id in drive) drive[id] = 0;
        for (const name in rates) rates[name] = 0;
      },
      // Call once per tick with the indices that spiked.
      observe(spiked) {
        for (const name in rates) rates[name] *= rateDecay;
        for (const id of spiked) {
          const a = neuronAction[id];
          if (a !== void 0) rates[a] += 1;
        }
      },
      readAction() {
        let topName = null, top = -1, second = 0;
        for (const name in rates) {
          const v = rates[name];
          if (v > top) {
            second = top;
            top = v;
            topName = name;
          } else if (v > second) {
            second = v;
          }
        }
        if (topName === null || top < quietFloor) return { action: "QUIET", confidence: 0, rates: { ...rates } };
        const confidence = top > 0 ? (top - second) / top : 0;
        return { action: topName, confidence, rates: { ...rates } };
      }
    };
  }

  // ../../brain/src/organism.js
  function makeOrganism({
    seed = 1,
    maxDelay = 8,
    noiseStd = 0,
    personality = {},
    sizes = {},
    ablation = {},
    feedbackPunishScale = 0.5,
    // Context-gated credit: criticism of an action whose justifying context is genuinely active is
    // discounted, so a contextually-correct response (e.g. ESCALATE during a real threat) is not
    // trained away by user annoyance. Map of action -> the chemical that justifies it.
    contextGate = { ESCALATE: "norepinephrine" },
    contextGateScale = 1,
    // Tonic-setpoint neuromodulation of behaviour (driven from setpoints, not phasic level, to avoid
    // feedback runaway). Norepinephrine -> neuron gain + noise (arousal raises excitability + jitter).
    // Acetylcholine -> attention/SNR (raises gain on signal, LOWERS noise -> a "focused" persona is
    // sharper). Serotonin -> behavioural inhibition via NEGATIVE gain (a "calm/patient" persona is less
    // excitable, so weak input doesn't trigger a reaction; "irritable" is more reactive). All default
    // to no-op at the reference setpoints, so a default persona behaves exactly as before.
    // Gain leverage bumped (chemistry harness finding): the tonic-setpoint gain effect was too weak to
    // tip routing at production noise. These are INERT at the reference setpoints (gain = 1 for the
    // default persona), so raising them amplifies persona deviations WITHOUT changing default behaviour.
    // Gain references default to the shared DEFAULT_SETPOINTS so the "inert at the default persona"
    // guarantee (gain = 1) can't silently break if a default setpoint is retuned in one place.
    gainK = 0.7,
    gainRef = DEFAULT_SETPOINTS.norepinephrine,
    gainMin = 0.6,
    gainMax = 1.8,
    noiseK = 0.6,
    achGainK = 0.55,
    achNoiseK = 0.5,
    achRef = DEFAULT_SETPOINTS.acetylcholine,
    seroGainK = 0.8,
    seroRef = DEFAULT_SETPOINTS.serotonin
  } = {}) {
    const net = makeNetwork({ seed, maxDelay, noiseStd });
    const conn = buildConnectome(net, makeRng(seed * 7 + 1), { sizes });
    const chem = makeNeuromodulation(personality);
    const ledger = makeLedger();
    const stdp = makeStdp({ synapses: net._synapses, incoming: net._incoming, outgoing: net._outgoing, ledger });
    const gov = makeGovernance({ synapses: net._synapses, ledger });
    const codec = makeCodec({ channels: conn.channels, actions: conn.actions });
    const rewardSet = new Set(conn.channels.reward);
    const threatSet = new Set(conn.channels.threat);
    let clock = 0;
    let lastAction = "QUIET";
    const spikeAccum = /* @__PURE__ */ new Map();
    return {
      ledger,
      regions: conn.regions,
      channels: conn.channels,
      actions: conn.actions,
      inject: (name, value) => codec.inject(name, value),
      readAction: () => {
        const r = codec.readAction();
        lastAction = r.action;
        return r;
      },
      // Let the host correct which action feedback credits (mind may remap the routed action to HOLD/
      // clarify, or short-circuit to a fact) so a thumbs-up/down attenuates the pathway that actually
      // produced the reply, not the raw winner-take-all winner.
      setLastAction: (a) => {
        lastAction = a;
      },
      // Settle transient activation between turns: neurons back to rest, in-flight currents + action
      // rates cleared, and STDP eligibility traces zeroed so a turn's spike timing doesn't leak into
      // the next turn's learning/feedback. Weights, chemistry (mood), ledger and clock are preserved.
      // Fixes the every-other-turn refractory collapse observed on the persistent (live) organism.
      settle: () => {
        net.resetActivation();
        codec.reset();
        stdp.clearTraces();
        spikeAccum.clear();
      },
      // RM4: the current turn's activation signature — the most-active neurons (a sparse fingerprint) plus a
      // `focus` concentration score (high = a few neurons carry the firing; low = diffuse). Reset by settle().
      activationSignature: ({ top = 24 } = {}) => {
        const entries = [...spikeAccum.entries()].sort((a, b) => b[1] - a[1]);
        const total = entries.reduce((s, [, c]) => s + c, 0);
        const topEntries = entries.slice(0, top);
        const topMass = topEntries.reduce((s, [, c]) => s + c, 0);
        return { ids: topEntries.map(([id]) => id), focus: total ? +(topMass / total).toFixed(3) : 0, active: entries.length };
      },
      mood: () => chem.readout(),
      // Top-down regulation hook (Personhood P6): apply a corrective delta to a chemical's phasic level
      // and fold it in immediately, so a prefrontal-style controller can actively damp its own affect
      // (self-calm / self-soothe) rather than only waiting for passive homeostatic decay.
      nudgeChem: (name, delta) => {
        if (!ablation.noMood) {
          chem.burst(name, delta);
          chem.tick();
        }
      },
      chemLevel: (name) => chem.level(name),
      chemSetpoint: (name) => chem.setpoint(name),
      setTraits: (traits) => chem.setTrait(traits),
      // Intrinsic curiosity: novelty is mildly rewarding -> a small dopamine burst (applied on the next
      // tick) that opens the plasticity gate (learn more from novel input) and lifts valence.
      curiosity: (mag = 1) => {
        if (!ablation.noMood) chem.burst(CHEMICALS.DOPAMINE, mag);
      },
      // Predictive-coding surprise: an unexpected turn opens the plasticity gate (dopamine -> learn more
      // from prediction errors) AND rouses arousal (norepinephrine -> attend). Applied before the turn's
      // ticks so learning is elevated during them.
      surprise: (mag = 1) => {
        if (ablation.noMood) return;
        chem.burst(CHEMICALS.DOPAMINE, 0.6 * mag);
        chem.burst(CHEMICALS.NOREPINEPHRINE, 0.3 * mag);
      },
      // Feedback as a real chemical event AND a learning signal. Credit is LOCALIZED to the action
      // that was actually chosen (its decision-layer population), so criticising one response
      // REDIRECTS the brain to another action rather than collapsing general responsiveness into
      // silence (the "death-vs-taxes" trap). The economy is ASYMMETRIC -- punishment is scaled down
      // by feedbackPunishScale so praise can recover a pathway faster than criticism suppresses it.
      // Praise -> dopamine burst + amplify the chosen pathway; criticism -> norepinephrine burst +
      // dopamine dip + attenuate it. Pass { action } to credit a specific action; defaults to the
      // last one read. The chemistry sets mood; stdp.modulate does the trace-based credit assignment.
      feedback: (kind, mag = 1, { action } = {}) => {
        const target = action || lastAction;
        const targets = conn.actions[target] || null;
        if (kind === "up" || kind === "positive") {
          chem.burst(CHEMICALS.DOPAMINE, mag);
          if (targets) stdp.modulate(1, mag, { tags: ["feedback", "up"], timestamp: clock, targets });
        } else if (kind === "down" || kind === "negative") {
          let scale = feedbackPunishScale;
          const justChem = contextGate[target];
          if (justChem && targets) {
            const j = clamp((chem.level(justChem) - chem.setpoint(justChem)) / contextGateScale);
            scale *= 1 - j;
          }
          chem.burst(CHEMICALS.NOREPINEPHRINE, mag);
          chem.burst(CHEMICALS.DOPAMINE, -0.5 * mag);
          if (targets) stdp.modulate(-1, mag * scale, { tags: ["feedback", "down"], timestamp: clock, targets });
        }
        chem.tick();
      },
      // noLearn forces the plasticity gate shut for this tick -- for READ-ONLY probes (fitness measurement,
      // imagination rehearsal, the chem harness) that must not stamp weight changes into the network.
      tick({ tags = [], noLearn = false } = {}) {
        if (!ablation.noMood) chem.tick();
        let gain = 1, noiseScale = 1;
        if (!ablation.noMood) {
          const ne = chem.setpoint(CHEMICALS.NOREPINEPHRINE) - gainRef;
          const ach = chem.setpoint(CHEMICALS.ACETYLCHOLINE) - achRef;
          const sero = chem.setpoint(CHEMICALS.SEROTONIN) - seroRef;
          gain = Math.max(gainMin, Math.min(gainMax, 1 + gainK * ne + achGainK * ach - seroGainK * sero));
          noiseScale = Math.max(0, 1 + noiseK * ne - achNoiseK * ach);
        }
        const spiked = net.tick(codec.driveInputs(), { gain, noiseScale });
        codec.observe(spiked);
        for (const id of spiked) spikeAccum.set(id, (spikeAccum.get(id) || 0) + 1);
        if (!ablation.noMood) {
          let rewardFire = 0, threatFire = 0;
          for (const id of spiked) {
            if (rewardSet.has(id)) rewardFire++;
            if (threatSet.has(id)) threatFire++;
          }
          if (rewardFire > 0) chem.burst(CHEMICALS.DOPAMINE, rewardFire * 0.2);
          if (threatFire > 0) chem.burst(CHEMICALS.NOREPINEPHRINE, threatFire * 0.2);
        }
        stdp.observeSpikes(spiked, {
          gate: ablation.noLearning || noLearn ? 0 : chem.plasticityGate(),
          chemState: {
            dopamine: chem.level(CHEMICALS.DOPAMINE),
            norepinephrine: chem.level(CHEMICALS.NOREPINEPHRINE),
            serotonin: chem.level(CHEMICALS.SEROTONIN),
            acetylcholine: chem.level(CHEMICALS.ACETYLCHOLINE)
          },
          timestamp: clock++,
          tags
        });
        return spiked;
      },
      captureBaseline: () => gov.captureBaseline(),
      snapshot: (name) => ({ ...gov.snapshot(name), chem: chem.snapshot() }),
      restore: (snap) => {
        gov.restore(snap);
        if (snap.chem) chem.restore(snap.chem);
      },
      undoTag: (tag) => gov.undoTag(tag),
      factoryReset: () => gov.factoryReset(),
      // Complete state for persistence: only the LEARNED parts (topology is reproduced from
      // seed+sizes at construction, so it is not serialized). `ledger:false` omits the audit log -- the
      // per-turn save uses this (the ledger is in-memory governance state, not continuity state, and
      // deep-copying the growing log every turn was the dominant persist cost); export keeps it full.
      serialize: ({ ledger: includeLedger = true } = {}) => {
        const state = { weights: net._synapses.map((s) => s.weight), chem: chem.snapshot(), clock };
        if (includeLedger) state.ledger = JSON.parse(JSON.stringify(ledger.all()));
        return state;
      },
      deserialize: (state) => {
        state.weights.forEach((w, i) => {
          if (net._synapses[i]) net._synapses[i].weight = w;
        });
        if (state.ledger) ledger.load(state.ledger);
        if (state.chem) chem.restore(state.chem);
        clock = state.clock || 0;
      },
      _net: net
    };
  }

  // ../../brain/src/text.js
  var tokenize = (s) => String(s).toLowerCase().match(/[a-z']+/g) || [];
  var QUESTION_OPENERS = ["who", "what", "when", "where", "why", "how", "is", "are", "do", "does", "can", "could", "would", "will"];

  // ../../brain/src/persona.js
  var SETPOINT_DEFAULTS = { ...DEFAULT_SETPOINTS };
  var REACTIVITY_DEFAULTS = { dopamine: 1, norepinephrine: 1, serotonin: 1, acetylcholine: 1 };
  var MAX_SCALE = 1.5;
  var clampSet = clamp;
  var clampReact = (x) => clamp(x, 0, 3);
  var INTENSIFIERS = {
    slightly: 0.5,
    somewhat: 0.5,
    mildly: 0.5,
    faintly: 0.5,
    fairly: 1.1,
    quite: 1.2,
    rather: 1.2,
    really: 1.3,
    super: 1.4,
    overly: 1.4,
    very: 1.5,
    deeply: 1.5,
    incredibly: 1.6,
    intensely: 1.6,
    profoundly: 1.6,
    extremely: 1.7
  };
  var AXES = [
    {
      name: "warmth",
      words: ["warm", "kind", "gentle", "caring", "affectionate", "compassionate", "friendly", "loving", "tender", "nurturing"],
      set: { serotonin: 0.15 }
    },
    {
      name: "calm",
      words: ["calm", "relaxed", "serene", "easygoing", "mellow", "content", "patient", "placid", "tranquil", "chill", "unflappable"],
      set: { serotonin: 0.15, norepinephrine: -0.12 }
    },
    {
      name: "energy",
      words: ["energetic", "lively", "playful", "enthusiastic", "spirited", "bubbly", "cheerful", "upbeat", "vivacious", "exuberant"],
      set: { dopamine: 0.18, norepinephrine: 0.05 }
    },
    {
      name: "curiosity",
      words: ["curious", "inquisitive", "driven", "ambitious", "motivated", "exploratory", "eager", "interested", "keen"],
      set: { dopamine: 0.2, acetylcholine: 0.08 }
    },
    {
      name: "anxiety",
      words: ["anxious", "nervous", "tense", "wary", "jumpy", "jittery", "uneasy", "fearful", "worried", "apprehensive", "alert", "skittish"],
      set: { norepinephrine: 0.18, serotonin: -0.08 },
      react: { norepinephrine: 0.6 }
    },
    {
      name: "focus",
      words: ["focused", "attentive", "sharp", "precise", "careful", "meticulous", "diligent", "thorough", "observant", "methodical"],
      set: { acetylcholine: 0.22 }
    },
    {
      name: "confidence",
      words: ["confident", "secure", "steady", "grounded", "resilient", "stoic", "assured", "bold", "unshakable"],
      set: { serotonin: 0.12, norepinephrine: -0.05 }
    },
    {
      name: "shy",
      words: ["shy", "timid", "reserved", "hesitant", "withdrawn", "bashful", "meek", "retiring"],
      set: { norepinephrine: 0.1, dopamine: -0.08 }
    },
    {
      name: "impulsive",
      words: ["impulsive", "excitable", "reactive", "volatile", "spontaneous", "restless", "erratic", "mercurial"],
      set: { dopamine: 0.1 },
      react: { dopamine: 0.5, norepinephrine: 0.5 }
    },
    {
      name: "melancholy",
      words: ["melancholy", "gloomy", "sad", "depressed", "weary", "listless", "downcast", "morose", "glum", "despondent"],
      set: { serotonin: -0.15, dopamine: -0.1 }
    },
    {
      name: "irritable",
      words: ["irritable", "grumpy", "snappy", "prickly", "cranky", "testy", "brusque", "curt"],
      set: { norepinephrine: 0.12, serotonin: -0.12 },
      react: { norepinephrine: 0.4 }
    },
    {
      name: "scattered",
      words: ["scattered", "distracted", "absentminded", "forgetful", "dreamy", "unfocused", "flighty"],
      set: { acetylcholine: -0.18 }
    }
  ];
  var WORD_AXIS = /* @__PURE__ */ new Map();
  AXES.forEach((ax, i) => ax.words.forEach((w) => WORD_AXIS.set(w, i)));
  function describePersona(text = "", overrides = {}) {
    const setpoints = { ...SETPOINT_DEFAULTS };
    const reactivity = { ...REACTIVITY_DEFAULTS };
    const toks = tokenize(text);
    const evidence = new Array(AXES.length).fill(0);
    for (let i = 0; i < toks.length; i++) {
      const ai = WORD_AXIS.get(toks[i]);
      if (ai === void 0) continue;
      evidence[ai] += i > 0 && INTENSIFIERS[toks[i - 1]] || 1;
    }
    const traits = {};
    AXES.forEach((ax, i) => {
      if (evidence[i] <= 0) return;
      const scale = Math.min(MAX_SCALE, evidence[i]);
      traits[ax.name] = +scale.toFixed(3);
      for (const k in ax.set || {}) setpoints[k] += ax.set[k] * scale;
      for (const k in ax.react || {}) reactivity[k] += ax.react[k] * scale;
    });
    for (const k in setpoints) setpoints[k] = clampSet(setpoints[k]);
    for (const k in reactivity) reactivity[k] = clampReact(reactivity[k]);
    if (overrides.setpoints) for (const k in overrides.setpoints) setpoints[k] = clampSet(overrides.setpoints[k]);
    if (overrides.reactivity) for (const k in overrides.reactivity) reactivity[k] = clampReact(overrides.reactivity[k]);
    return { systemPrompt: String(text).trim(), setpoints, reactivity, traits };
  }

  // ../../brain/data/intentPatterns.js
  var INTENT_PATTERNS = {
    comfort: ["sad", "hurt", "alone", "lonely", "tired", "exhausted", "awful", "worried", "scared", "cry", "depressed", "upset", "anxious"],
    ground: ["explain", "clarify", "confused", "understand", "unclear", "lost"],
    own: ["wrong", "mistake", "sorry", "fault", "apology", "apologise", "apologize"],
    lighten: ["joke", "funny", "lol", "haha", "kidding", "playful", "silly"],
    greet: ["hi", "hello", "hey", "yo", "morning", "evening", "howdy"],
    ack: ["thanks", "thank", "ok", "okay", "cool", "great", "awesome", "nice"],
    code: ["code", "bug", "error", "function", "variable", "compile", "syntax", "python", "javascript", "debug", "program"],
    task: ["remind", "reminder", "schedule", "todo", "list", "calendar", "note", "summarize", "organize", "task"],
    roleplay: ["roleplay", "pretend", "wizard", "dragon", "cast", "spell", "roll", "dice", "character", "campaign", "dungeon", "quest"]
  };

  // ../../brain/src/intent.js
  function classifyIntent(message, patterns = INTENT_PATTERNS) {
    const lower = String(message).toLowerCase().trim();
    const toks = tokenize(lower);
    if (lower.endsWith("?") || QUESTION_OPENERS.includes(toks[0]) || /\b(tell me|describe|explain)\b/.test(lower)) return "question";
    const set = new Set(toks);
    let best = "respond", bestScore = 0;
    for (const intent in patterns) {
      let score = 0;
      for (const w of patterns[intent]) if (set.has(w)) score++;
      if (score > bestScore) {
        bestScore = score;
        best = intent;
      }
    }
    return best;
  }

  // ../../brain/src/features.js
  var POSITIVE = /* @__PURE__ */ new Set(["thanks", "thank", "love", "great", "good", "yes", "awesome", "nice", "happy", "cool", "please", "appreciate", "perfect", "excellent", "brilliant", "amazing", "wonderful", "helpful", "clear", "fixed", "works", "working", "solved", "right", "correct", "beautiful", "fantastic", "glad", "enjoy", "like", "best", "better"]);
  var NEGATIVE = /* @__PURE__ */ new Set(["no", "stop", "hate", "bad", "angry", "terrible", "awful", "wrong", "annoying", "stupid", "idiot", "broken", "bug", "buggy", "error", "fail", "failed", "crash", "crashed", "slow", "confusing", "useless", "dislike", "frustrated", "frustrating", "disappointing", "worse", "worst", "hurts", "painful", "sucks", "garbage", "nonsense"]);
  var REWARD_CUES = /* @__PURE__ */ new Set(["thanks", "thank", "love", "great", "awesome", "yes", "appreciate", "perfect", "nice", "excellent", "brilliant", "amazing", "wonderful", "helpful", "works", "solved", "fixed", "glad"]);
  var THREAT_CUES = /* @__PURE__ */ new Set(["stop", "no", "hate", "angry", "stupid", "idiot", "now", "hurry", "emergency", "help", "danger", "careful", "warning", "urgent", "mad", "furious", "wrong"]);
  var NEGATORS = /* @__PURE__ */ new Set(["not", "no", "never", "isn't", "wasn't", "don't", "doesn't", "didn't", "won't", "can't", "cannot", "aren't", "ain't", "hardly", "barely", "without"]);
  function countCues(tokens, cues) {
    let plain = 0, negated = 0;
    for (let i = 0; i < tokens.length; i++) {
      if (!cues.has(tokens[i])) continue;
      if (i > 0 && NEGATORS.has(tokens[i - 1]) || i > 1 && NEGATORS.has(tokens[i - 2])) negated++;
      else plain++;
    }
    return { plain, negated };
  }
  function extractFeatures(message, context = {}) {
    const recent = context.recent || [];
    const raw = String(message);
    const lower = raw.toLowerCase();
    const tokens = tokenize(lower);
    const ntok = Math.max(1, tokens.length);
    const set = new Set(tokens);
    const p = countCues(tokens, POSITIVE), n = countCues(tokens, NEGATIVE);
    const posScore = p.plain + n.negated;
    const negScore = n.plain + p.negated;
    const valence = clamp((posScore - negScore) / Math.sqrt(ntok), -1, 1);
    const caps = (raw.match(/[A-Z]/g) || []).length / Math.max(1, raw.length);
    const bangs = (raw.match(/!/g) || []).length;
    const arousal = clamp(0.3 + caps + 0.15 * bangs + 0.2 * Math.min(1, ntok / 40), 0, 1);
    const isQuestion = lower.trim().endsWith("?") || QUESTION_OPENERS.includes(tokens[0]) ? 1 : 0;
    const rw = countCues(tokens, REWARD_CUES), th = countCues(tokens, THREAT_CUES);
    const reward = clamp((rw.plain - rw.negated) / 2, 0, 1);
    const threat = clamp((th.plain - th.negated) / 2, 0, 1);
    let maxSim = 0;
    for (const m of recent) {
      const setB = new Set(tokenize(m));
      const inter = [...set].filter((x) => setB.has(x)).length;
      const uni = (/* @__PURE__ */ new Set([...set, ...setB])).size || 1;
      maxSim = Math.max(maxSim, inter / uni);
    }
    const novelty = clamp(1 - maxSim, 0, 1);
    return { valence, arousal, novelty, isQuestion, reward, threat };
  }

  // ../../brain/src/salience.js
  function structuralSalience(text) {
    const raw = String(text);
    const words = raw.match(/[A-Za-z0-9']+/g) || [];
    if (!words.length) return 0;
    const propers = (raw.match(/\b[A-Z][a-z]{2,}/g) || []).length;
    const numbers = (raw.match(/\b\d+/g) || []).length;
    const questions = (raw.match(/\?/g) || []).length;
    const emphatic = (raw.match(/!/g) || []).length;
    const lengthScore = Math.min(1, words.length / 30);
    let score = 0;
    score += Math.min(4, propers * 1.2);
    score += Math.min(2, numbers * 1);
    score += Math.min(1.5, questions * 0.75);
    score += Math.min(1, emphatic * 0.5);
    score += 1.5 * lengthScore;
    return Math.min(10, score);
  }
  var ENTITY_STOP = /* @__PURE__ */ new Set([
    "the",
    "what",
    "when",
    "where",
    "why",
    "how",
    "who",
    "which",
    "whose",
    "is",
    "are",
    "was",
    "were",
    "do",
    "does",
    "did",
    "can",
    "could",
    "would",
    "should",
    "will",
    "hello",
    "hi",
    "hey",
    "thanks",
    "thank",
    "yes",
    "no",
    "please",
    "let",
    "tell",
    "okay",
    "and",
    "but",
    "this",
    "that",
    "these",
    "those",
    "you",
    "your",
    "i've",
    "i'm"
  ]);
  function entities(text, { limit = 5 } = {}) {
    const hits = String(text).match(/\b[A-Z][a-z]{2,}/g) || [];
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const h of hits) {
      const key = h.toLowerCase();
      if (ENTITY_STOP.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push(h);
      if (out.length >= limit) break;
    }
    return out;
  }

  // ../../brain/src/workingMemory.js
  function makeWorkingMemory({ capacity = 7, decay = 0.6, boost = 1, threshold = 0.15 } = {}) {
    let items = [];
    let turn = 0;
    const sortDesc = () => items.sort((a, b) => b.activation - a.activation);
    const trim = () => {
      if (items.length > capacity) items = items.slice(0, capacity);
    };
    function decayStep() {
      turn++;
      for (const it of items) it.activation *= decay;
      items = items.filter((it) => it.activation >= threshold);
      sortDesc();
      trim();
      return items;
    }
    function note(list) {
      const arr = Array.isArray(list) ? list : [list];
      for (const raw of arr) {
        const isObj = raw && typeof raw === "object";
        const text = String(isObj ? raw.text ?? "" : raw ?? "").trim();
        if (!text) continue;
        const target = boost * (isObj && raw.weight != null ? raw.weight : 1);
        const existing = items.find((it) => it.text.toLowerCase() === text.toLowerCase());
        if (existing) {
          existing.activation = Math.max(existing.activation, target);
          existing.turn = turn;
        } else items.push({ text, activation: target, turn });
      }
      sortDesc();
      trim();
      return items;
    }
    return {
      note,
      decay: decayStep,
      items: () => items.map((it) => ({ ...it })),
      // A prompt segment naming what's currently in focus (most-active first). Working memory is meant to
      // carry a train of thought FORWARD from prior turns -- so `exclude` (the current message) drops items
      // that just echo what the user said this turn, which is redundant clutter (and hurt the judge in the
      // R2-vs-R3 ablation). Empty when nothing distinct is held.
      block: ({ exclude = "" } = {}) => {
        const ex = String(exclude).toLowerCase();
        const carried = items.filter((it) => {
          const t = it.text.replace(/\.\.\.$/, "").toLowerCase();
          return t.length > 1 && !ex.includes(t);
        });
        return carried.length ? "Currently in focus: " + carried.map((it) => it.text).join("; ") + "." : "";
      },
      load: () => Math.min(1, items.length / capacity),
      // how "full" the mind is, in [0,1]
      clear: () => {
        items = [];
      }
    };
  }

  // ../../brain/src/metacognition.js
  function makeMetacognition({ groundThreshold = 0.2, certaintyFloor = 0.35, confuseSurprise = 0.6, confuseConfidence = 0.1, ema = 0.2 } = {}) {
    let avgCertainty = null, confusion = 0, turns = 0;
    function assess({ intent = "respond", factHit = false, relevance = 0, confidence = 0, surprise = 0 } = {}) {
      const isKnowledgeQ = intent === "question";
      const basis = factHit ? "fact" : relevance >= groundThreshold ? "memory" : isKnowledgeQ ? "none" : "social";
      const known = basis !== "none";
      const groundScore = basis === "fact" ? 1 : basis === "memory" ? clamp(0.5 + relevance) : basis === "social" ? 0.7 : 0.12;
      const decisiveness = clamp(confidence * 2.5);
      const certainty = clamp(0.5 * groundScore + 0.3 * decisiveness + 0.2 * (1 - clamp(surprise)));
      const confused = surprise >= confuseSurprise && confidence < confuseConfidence;
      const hedge = isKnowledgeQ && basis === "none" && certainty < certaintyFloor;
      return { certainty: +certainty.toFixed(2), known, confused, basis, hedge };
    }
    function observe(a) {
      turns += 1;
      avgCertainty = avgCertainty == null ? a.certainty : avgCertainty + (a.certainty - avgCertainty) * ema;
      confusion += ((a.confused ? 1 : 0) - confusion) * ema;
      return state();
    }
    function state() {
      return { avgCertainty: avgCertainty == null ? null : +avgCertainty.toFixed(2), confusionRate: +confusion.toFixed(2), turns };
    }
    return { assess, observe, state };
  }

  // ../../brain/src/regulation.js
  function makeRegulation({ arousalHigh = 0.75, valenceFloor = -0.4, calmK = 0.5, sootheK = 0.4, maxStep = 1 } = {}) {
    return {
      // Called after the turn's affect is set. Returns what it did (for the trace).
      regulate(organism) {
        const m = organism.mood() || {};
        const a = m.arousal ?? 0, v = m.valence ?? 0;
        let calmed = 0, soothed = 0;
        if (a > arousalHigh) {
          calmed = Math.min(maxStep, calmK * (a - arousalHigh));
          organism.nudgeChem("norepinephrine", -calmed);
        }
        if (v < valenceFloor) {
          soothed = Math.min(maxStep, sootheK * (valenceFloor - v));
          organism.nudgeChem("dopamine", 0.6 * soothed);
          organism.nudgeChem("serotonin", soothed);
        }
        return { calmed: +calmed.toFixed(3), soothed: +soothed.toFixed(3), applied: calmed > 0 || soothed > 0 };
      }
    };
  }

  // ../../brain/src/imagination.js
  function makeImagination({ organism, ticks = 20 } = {}) {
    return {
      // Rehearse a hypothetical message; return the predicted action + affect, leaving the brain exactly
      // as it was (weights, chemistry, ledger, clock all restored).
      simulate(message) {
        const saved = organism.serialize({ ledger: false });
        organism.settle();
        const f = extractFeatures(message);
        organism.inject("sensory", clamp(0.5 + 0.4 * f.arousal));
        organism.inject("reward", f.reward);
        organism.inject("threat", f.threat);
        for (let t = 0; t < ticks; t++) organism.tick({ tags: ["imagine"], noLearn: true });
        organism.inject("sensory", 0);
        organism.inject("reward", 0);
        organism.inject("threat", 0);
        const routed = organism.readAction();
        const mood = organism.mood();
        organism.deserialize(saved);
        organism.settle();
        return {
          action: routed.action,
          confidence: +Number(routed.confidence || 0).toFixed(2),
          mood: { valence: +(mood.valence || 0).toFixed(2), arousal: +(mood.arousal || 0).toFixed(2) }
        };
      }
    };
  }

  // ../../brain/src/think.js
  var THINK_RE = /^\s*<think>([\s\S]*?)(<\/think>|$)/;
  function splitThink(text) {
    const s = String(text);
    const m = s.match(THINK_RE);
    if (!m) return { thinking: "", answer: s.trim() };
    return { thinking: m[1].trim(), answer: s.slice(m[0].length).trim() };
  }

  // ../../brain/src/self.js
  var asText = (out) => typeof out === "string" ? out : out && out.text || "";
  function makeSelf({ backend, maxEpisodes = 8 } = {}) {
    let narrative = "";
    let updatedTurn = 0;
    async function update(episodes = [], { turn = 0 } = {}) {
      if (!backend) return { narrative, changed: false };
      const salient = [...episodes].sort((a, b) => (b.salience || 0) - (a.salience || 0)).slice(0, maxEpisodes);
      if (!salient.length && !narrative) return { narrative, changed: false };
      const digest = salient.map((e) => `- ${e.message || e.text || ""}${e.reply ? " -> " + e.reply : ""}`).join("\n");
      try {
        const out = await backend.generate({
          system: "You maintain the first-person self-note of an AI companion named Rook -- a short, evolving sense of who Rook is and what has passed between Rook and the user, carried forward for continuity. Write 2 to 4 sentences in first person ('I ...'), grounded ONLY in the notes given. Do not invent facts or people. No preamble, no quotes.",
          messages: [{ role: "user", content: `Prior self-note:
${narrative || "(none yet)"}

Recent memorable moments:
${digest || "(none)"}

Rewrite the self-note, evolving it to reflect these.` }]
        });
        const text = splitThink(asText(out)).answer.trim();
        if (text) {
          narrative = text;
          updatedTurn = turn;
          return { narrative, changed: true };
        }
      } catch {
      }
      return { narrative, changed: false };
    }
    return {
      update,
      get: () => narrative,
      block: () => narrative ? "What I carry from our history:\n" + narrative : "",
      serialize: () => ({ narrative, updatedTurn }),
      restore: (s) => {
        if (s) {
          narrative = s.narrative || "";
          updatedTurn = s.updatedTurn || 0;
        }
      }
    };
  }

  // ../../brain/src/embedder.js
  function cosine(a, b) {
    let dot = 0, na = 0, nb = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }
  function makeHashEmbedder({ dim = 128 } = {}) {
    const fnv = (str) => {
      let h = 2166136261;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    };
    return {
      name: "hash",
      async embed(text) {
        const v = new Array(dim).fill(0);
        for (const t of tokenize(text)) {
          v[fnv(t) % dim] += 1;
          if (t.length > 4) v[fnv(t.slice(0, 4)) % dim] += 0.5;
        }
        let n = 0;
        for (const x of v) n += x * x;
        n = Math.sqrt(n) || 1;
        return v.map((x) => x / n);
      }
    };
  }

  // ../../brain/src/declarativeStore.js
  function makeDeclarativeStore({ storage, embedder, now = () => 0, id, key = "memories", maxEpisodes = 200, modelSourceWeight = 0.5, mmrLambda = 0.7 }) {
    let counter = 0;
    const genId = id || (() => `m${counter++}`);
    let records = [];
    let episodesEver = 0;
    const tokCache = /* @__PURE__ */ new Map();
    const toksOf = (r) => {
      let s = tokCache.get(r.id);
      if (!s) {
        s = new Set(tokenize(r.text || ""));
        tokCache.set(r.id, s);
      }
      return s;
    };
    const persist = () => storage.set(key, records);
    const safeEmbed = async (text) => {
      if (!embedder) return void 0;
      const v = await embedder.embed(text);
      return Array.isArray(v) ? v : void 0;
    };
    const keywordScore = (queryToks, set) => {
      if (set.size === 0 || queryToks.length === 0) return 0;
      let hit = 0;
      for (const t of queryToks) if (set.has(t)) hit++;
      return hit / queryToks.length;
    };
    function pruneEpisodes() {
      const eps = records.filter((r) => r.type === "episode");
      if (eps.length <= maxEpisodes) return;
      const maxTs = Math.max(1, ...eps.map((r) => r.timestamp || 0));
      const value = (r) => (r.salience || 0) + 3 * ((r.timestamp || 0) / maxTs) + 1.5 * (r.surprise || 0);
      const droppable = eps.filter((r) => !r.pinned).sort((a, b) => value(a) - value(b));
      const remove = new Set(droppable.slice(0, eps.length - maxEpisodes).map((r) => r.id));
      if (remove.size) {
        records = records.filter((r) => !remove.has(r.id));
        for (const rid of remove) tokCache.delete(rid);
      }
    }
    const srcWeight = (r) => r.source === "model" ? modelSourceWeight : 1;
    const recSim = (a, b) => {
      if (a.type === "theme" && Array.isArray(a.members) && a.members.includes(b.id) || b.type === "theme" && Array.isArray(b.members) && b.members.includes(a.id)) return 1;
      if (a.vector && b.vector) return Math.max(0, cosine(a.vector, b.vector));
      const sa = toksOf(a), sb = toksOf(b);
      if (sa.size === 0 || sb.size === 0) return 0;
      let inter = 0;
      for (const t of sa) if (sb.has(t)) inter++;
      return inter / (sa.size + sb.size - inter);
    };
    async function add(rec) {
      const vector = await safeEmbed(rec.text);
      const full = { id: genId(), tags: [], pinned: false, source: "user", stateRole: "current", timestamp: now(), vector, ...rec };
      if (full.type === "episode") episodesEver++;
      records.push(full);
      if (full.type === "episode") pruneEpisodes();
      await persist();
      return full;
    }
    return {
      add,
      // expose the low-level writer so the hierarchy layer can write L2 theme nodes (explicit centroid vector + members)
      async load() {
        const saved = await storage.get(key);
        records = Array.isArray(saved) ? saved : [];
        episodesEver = records.filter((r) => r.type === "episode").length;
        tokCache.clear();
        return records;
      },
      episodesEver: () => episodesEver,
      async remember(episode) {
        const text = episode.message ?? "";
        const rec = { type: "episode", text, reply: episode.reply ?? "", tags: episode.tags || [], salience: structuralSalience(text) };
        if (Array.isArray(episode.sig) && episode.sig.length) rec.sig = episode.sig;
        if (episode.surprise != null) rec.surprise = +episode.surprise;
        return add(rec);
      },
      async addFact(text, { tags = [], pinned = false, source = "user", sig = null } = {}) {
        const rec = { type: "fact", text, tags, pinned, source };
        if (Array.isArray(sig) && sig.length) rec.sig = sig;
        return add(rec);
      },
      // NM2a: supersede a fact instead of deleting it — the old record is kept but marked "historical" (with
      // a supersededBy link + timestamp), so default recall no longer serves the stale version alongside the
      // new one ("ghost memory"), while the history stays auditable + reversible. Returns the new record.
      async supersede(oldId, { text, tags = [], source = "user", sig = null } = {}) {
        const rec = { type: "fact", text, tags, pinned: false, source };
        if (Array.isArray(sig) && sig.length) rec.sig = sig;
        const added = await add(rec);
        const old = records.find((r) => r.id === oldId);
        if (old) {
          old.stateRole = "historical";
          old.supersededBy = added.id;
          old.supersededAt = now();
          await persist();
        }
        return added;
      },
      get(id_) {
        return records.find((r) => r.id === id_) || null;
      },
      list({ type, tag } = {}) {
        return records.filter((r) => (!type || r.type === type) && (!tag || r.tags.includes(tag)));
      },
      async update(id_, patch) {
        const r = records.find((x) => x.id === id_);
        if (!r) return null;
        Object.assign(r, patch);
        if (patch.text !== void 0) {
          r.vector = await safeEmbed(r.text);
          tokCache.delete(id_);
        }
        await persist();
        return r;
      },
      async remove(id_) {
        const i = records.findIndex((x) => x.id === id_);
        if (i < 0) return false;
        tokCache.delete(id_);
        records.splice(i, 1);
        await persist();
        return true;
      },
      async clear() {
        records = [];
        episodesEver = 0;
        tokCache.clear();
        await persist();
      },
      async recall(query, k = 3, { querySig = null, sample = false, rng = null, temp = 1, state = "current", sharp = false, sharpMargin = 0.25, includeThemes = true } = {}) {
        if (records.length === 0) return [];
        const gauss = () => {
          if (!rng) return 0;
          const u1 = Math.max(1e-9, rng()), u2 = rng();
          return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        };
        const qvec = await safeEmbed(query);
        const qToks = tokenize(query);
        const qSet = new Set(qToks);
        const qSig = querySig && querySig.length ? new Set(querySig) : null;
        const inState = state === "all" ? records : records.filter((r) => (r.stateRole || "current") === state);
        const candidates = includeThemes ? inState : inState.filter((r) => r.type !== "theme");
        if (candidates.length === 0) return [];
        const maxTs = Math.max(1, ...candidates.map((r) => r.timestamp || 0));
        const scored = candidates.map((r) => {
          const sem = qvec && r.vector ? cosine(qvec, r.vector) : 0;
          const kw = keywordScore(qToks, toksOf(r));
          const meta = r.tags && r.tags.length ? r.tags.filter((t) => qSet.has(t)).length / r.tags.length : 0;
          const recency = (r.timestamp || 0) / maxTs * 0.1;
          const pin = r.pinned ? 0.2 : 0;
          const sw = srcWeight(r);
          const sim = (qvec ? sem : kw) * sw;
          let act = 0;
          if (qSig && Array.isArray(r.sig) && r.sig.length) {
            let inter = 0;
            for (const id2 of r.sig) if (qSig.has(id2)) inter++;
            const uni = qSig.size + r.sig.length - inter;
            act = uni ? inter / uni : 0;
          }
          const std = qvec ? +(Math.abs(sem - kw) * 0.5 * sw).toFixed(4) : 0;
          let score = (0.55 * sem + 0.3 * kw + 0.15 * meta) * sw + 0.2 * act + recency + pin;
          if (sample && rng && std > 0) score += gauss() * temp * std;
          return { r, sim, std, score };
        });
        scored.sort((a, b) => b.score - a.score);
        const picked = [];
        const pool = scored.slice();
        while (picked.length < k && pool.length) {
          let bestI = 0, bestVal = -Infinity;
          for (let i = 0; i < pool.length; i++) {
            let maxSim = 0;
            for (const p of picked) {
              const s = recSim(pool[i].r, p.r);
              if (s > maxSim) maxSim = s;
            }
            const val = mmrLambda * pool[i].score - (1 - mmrLambda) * maxSim;
            if (val > bestVal) {
              bestVal = val;
              bestI = i;
            }
          }
          const chosen = pool.splice(bestI, 1)[0];
          picked.push(chosen);
          const cr = chosen.r;
          for (let i = pool.length - 1; i >= 0; i--) {
            const rr = pool[i].r;
            if (cr.type === "theme" && cr.members && cr.members.includes(rr.id) || rr.type === "theme" && rr.members && rr.members.includes(cr.id)) pool.splice(i, 1);
          }
        }
        if (sharp && picked.length >= 2 && picked[0].score - picked[1].score > sharpMargin) picked.length = 1;
        return picked.map((s) => ({ ...s.r, _score: s.score, _sim: s.sim, _std: s.std }));
      },
      // RM5 (ReContext): recursive evidence replay. A single flat recall only surfaces what matches the
      // query directly. Here the first-pass hits become an ASSOCIATIVE CUE — we recall again against
      // query+evidence, then blend the two rankings — so a memory strongly linked to a top hit (but not to
      // the bare query) can surface, and a record confirmed by BOTH passes is boosted. Training-free; each
      // pass already applies hybrid scoring + MMR + provenance. `passes:1` degrades to plain recall (the
      // ablation knob for measuring the gain via the RM3 drift probe).
      async recallDeep(query, k = 3, { passes = 2, expandTop = 2, blend = 0.5, querySig = null, sample = false, rng = null, temp = 1, state = "current", includeThemes = true } = {}) {
        const wide = Math.max(k, 6);
        const pass = { querySig, sample, rng, temp, state, includeThemes };
        const first = await this.recall(query, wide, pass);
        const seeds = first.filter((r) => (r._sim ?? 0) > 0).slice(0, expandTop);
        if (passes < 2 || seeds.length === 0) return first.slice(0, k);
        const cue = query + " " + seeds.map((r) => r.text || "").join(" ");
        const second = await this.recall(cue, wide, pass);
        const byId = /* @__PURE__ */ new Map();
        for (const r of first) byId.set(r.id, { r, s: r._score });
        for (const r of second) {
          const e = byId.get(r.id);
          if (e) e.s += blend * r._score;
          else byId.set(r.id, { r, s: blend * r._score });
        }
        return [...byId.values()].sort((a, b) => b.s - a.s).slice(0, k).map((x) => ({ ...x.r, _score: +x.s.toFixed(4) }));
      },
      export() {
        return JSON.parse(JSON.stringify(records));
      },
      async import(recs) {
        records = JSON.parse(JSON.stringify(recs));
        episodesEver = records.filter((r) => r.type === "episode").length;
        tokCache.clear();
        await persist();
      }
    };
  }

  // ../../brain/src/backup.js
  function makeMemorySink() {
    const store = /* @__PURE__ */ new Map();
    return {
      async write(version, payload, meta) {
        store.set(version, { payload, meta });
      },
      async read(version) {
        const e = store.get(version);
        return e ? e.payload : null;
      },
      async list() {
        return [...store.values()].map((e) => e.meta).sort((a, b) => b.version - a.version);
      },
      async remove(version) {
        store.delete(version);
      }
    };
  }
  function fnv1a(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
    }
    return ("00000000" + h.toString(16)).slice(-8);
  }
  function makeBackup({ getState, sink, now = () => 0, keep = 10, everyTurns = 100, everyMs = 24 * 60 * 60 * 1e3, cipher = null, hash = fnv1a, verifyOnRestore = true }) {
    let seq = null;
    let lastSecuredAt = null;
    let lastTurns = 0;
    async function nextVersion() {
      if (seq == null) {
        const v = await sink.list();
        seq = v.reduce((m, r) => Math.max(m, r.version || 0), 0);
      }
      return ++seq;
    }
    const enc = async (s) => cipher ? await cipher.encrypt(s) : s;
    const dec = async (s) => cipher ? await cipher.decrypt(s) : s;
    async function prune() {
      const all = await sink.list();
      for (const meta of all.slice(keep)) await sink.remove(meta.version);
    }
    async function snapshot({ reason = "manual", turns = lastTurns } = {}) {
      const state = await getState();
      const payload = await enc(state);
      const version = await nextVersion();
      const at = now();
      const prevDigest = (await sink.list())[0]?.digest || null;
      const digest = await hash(payload);
      const meta = { version, at, bytes: state.length, turns, reason, encrypted: !!cipher, digest, prevDigest };
      await sink.write(version, payload, meta);
      await prune();
      lastSecuredAt = at;
      lastTurns = turns;
      return meta;
    }
    async function maybeSnapshot({ turns = lastTurns } = {}) {
      const dueByTurns = everyTurns > 0 && turns - lastTurns >= everyTurns;
      const dueByTime = everyMs > 0 && lastSecuredAt != null && now() - lastSecuredAt >= everyMs;
      const first = lastSecuredAt == null;
      if (first || dueByTurns || dueByTime) return snapshot({ reason: first ? "initial" : dueByTurns ? "turns" : "time", turns });
      return null;
    }
    async function verify() {
      const all = (await sink.list()).slice().sort((a, b) => a.version - b.version);
      let prev = null;
      for (const m of all) {
        const payload = await sink.read(m.version);
        if (payload == null || await hash(payload) !== m.digest) return { ok: false, brokenAt: m.version, reason: "payload digest mismatch" };
        if ((m.prevDigest || null) !== prev) return { ok: false, brokenAt: m.version, reason: "chain link broken" };
        prev = m.digest;
      }
      return { ok: true, length: all.length };
    }
    return {
      snapshot,
      maybeSnapshot,
      verify,
      async list() {
        return sink.list();
      },
      // Return the decrypted state string for a version. NM4: fail-CLOSED — if the stored payload no longer
      // matches its recorded digest (tampered/corrupt), refuse to restore it (return null) rather than
      // re-hydrate the companion from poisoned state. Disable with verifyOnRestore:false.
      async restore(version) {
        const p = await sink.read(version);
        if (p == null) return null;
        if (verifyOnRestore) {
          const meta = (await sink.list()).find((m) => m.version === version);
          if (meta && meta.digest && await hash(p) !== meta.digest) return null;
        }
        return dec(p);
      },
      // "Your companion is safe" card data. `chainOk` runs a full verify (reads every payload).
      async status({ audit = false } = {}) {
        const versions = await sink.list();
        const base = { lastSecuredAt, versionCount: versions.length, latest: versions[0] || null, healthy: versions.length > 0 };
        return audit ? { ...base, chain: await verify() } : base;
      }
    };
  }

  // story-brain.mjs
  var CHEMS = ["dopamine", "norepinephrine", "serotonin", "acetylcholine"];
  function memStorage() {
    const m = /* @__PURE__ */ new Map();
    return { async get(k) {
      return m.has(k) ? m.get(k) : null;
    }, async set(k, v) {
      m.set(k, v);
    } };
  }
  function toVibe(mood = {}, setpoints = {}) {
    const sero = setpoints.serotonin ?? 0.5, ne = setpoints.norepinephrine ?? 0.3;
    const warmth = clamp(0.5 + 1 * (sero - 0.5) + 0.15 * Math.tanh(0.5 * (mood.valence || 0)));
    const tension = clamp(0.35 + 1 * (ne - 0.3) + 0.15 * Math.tanh(0.5 * (mood.arousal || 0)));
    const tone = warmth > 0.62 ? tension > 0.6 ? "bright, charged" : "warm" : warmth < 0.4 ? tension > 0.6 ? "dark, tense" : "somber" : tension > 0.6 ? "taut" : "even";
    return { tone, warmth: +warmth.toFixed(2), tension: +tension.toFixed(2) };
  }
  function toDirective(vibe = {}, action = "RESPOND") {
    const tilt = [];
    if (vibe.warmth > 0.62) tilt.push("lean warm and hopeful");
    else if (vibe.warmth < 0.4) tilt.push("let the shadow and cost show");
    if (vibe.tension > 0.6) tilt.push("keep the tension high");
    else if (vibe.tension < 0.35) tilt.push("let it breathe, unhurried");
    if (action === "ESCALATE") tilt.push("raise the stakes");
    return tilt.length ? tilt.join("; ") + "." : "keep the narration even and true to the scene.";
  }
  function makeStoryBrain(opts = {}) {
    const seed = opts.seed || 7;
    const now = opts.now || (() => typeof Date !== "undefined" ? Date.now() : 0);
    let desc = opts.description || "an even-handed narrator";
    let overrides = opts.overrides || {};
    let noise = opts.noise || 0;
    let organism, persona, workingMemory, metacognition, regulation, imagination, self;
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
    function process(text) {
      organism.settle();
      const f = extractFeatures(text);
      const intent = classifyIntent(text);
      workingMemory.decay();
      workingMemory.note(entities(text));
      organism.inject("sensory", clamp(0.5 + 0.4 * f.arousal));
      organism.inject("reward", f.reward);
      organism.inject("threat", f.threat);
      organism.inject("memory", clamp(0.5 + 0.3 * Math.min(1, text.length / 100)));
      for (let t = 0; t < 30; t++) organism.tick();
      organism.inject("sensory", 0);
      organism.inject("reward", 0);
      organism.inject("threat", 0);
      organism.inject("memory", 0);
      const routed = organism.readAction();
      const mood = organism.mood();
      regulation.regulate(organism);
      return { intent, action: routed.action, confidence: routed.confidence || 0, mood, features: f };
    }
    const readChem = () => CHEMS.map((c) => ({ id: c, level: +organism.chemLevel(c).toFixed(2), setpoint: +organism.chemSetpoint(c).toFixed(2) }));
    const setpointObj = () => {
      const o = {};
      for (const c of CHEMS) o[c] = organism.chemSetpoint(c);
      return o;
    };
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
          working: workingMemory.items().map((i) => i.text)
        };
      },
      // A vote teaches the brain (reward economy / aversive learning on the last action).
      feedback(kind) {
        try {
          organism.feedback(kind === "up" || kind === "positive" ? "up" : "down");
        } catch (e) {
        }
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
          self: self.get()
        };
      },
      // Forward simulation (P7): preview a hypothetical move's affect without committing anything.
      imagine(move) {
        const p = imagination.simulate(String(move || ""));
        return { action: p.action, confidence: p.confidence, mood: p.mood, vibe: toVibe(p.mood, setpointObj()) };
      },
      // Self-narrative (P2a): weave an evolving sense of the story from its chapters (needs a backend).
      async reflect(episodes) {
        return self.update(episodes || [], { turn: (episodes || []).length });
      },
      getSelf: () => self.get(),
      // ---- durable lore memory (declarativeStore) ----
      // Rebuild the semantic index from the book's structured lore. Provenance is preserved across rebuilds
      // via opts.modelKeys (the 40-char keys of facts the model distilled) so author lore keeps outranking
      // model-distilled facts at recall (M1) even after a stance/slider tweak or an openBook. Threads are
      // deliberately NOT indexed -- they're always surfaced live from S.lore (the payoff scaffold), so
      // indexing them would only let them eat the recall budget. Returns the number of entries indexed.
      async indexLore(lore = {}, opts2 = {}) {
        await store.clear();
        const modelKeys = new Set(opts2.modelKeys || []);
        const keyOf = (t) => String(t).toLowerCase().slice(0, 40);
        const cats = [["people", "PERSON"], ["places", "PLACE"], ["world", "WORLD"]];
        let n = 0;
        for (const [key, tag] of cats) for (const text of lore[key] || []) {
          await store.addFact(String(text), { tags: [tag], source: modelKeys.has(keyOf(text)) ? "model" : "user" });
          n++;
        }
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
      setStance(description, ov) {
        desc = description || desc;
        overrides = ov || {};
        build();
      },
      setChem(name, value) {
        overrides = { ...overrides, setpoints: { ...overrides.setpoints || {}, [name]: value } };
        build();
      },
      setNoise(n) {
        noise = n || 0;
        build();
      },
      setpoints() {
        const o = {};
        for (const c of CHEMS) o[c] = organism.chemSetpoint(c);
        return o;
      },
      describe: () => desc
    };
  }
  return __toCommonJS(story_brain_exports);
})();
