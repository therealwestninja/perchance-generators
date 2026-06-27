'use strict';
/* book-maker.js — a brain-steered storybook builder (perchance.org/book-maker).
 *
 * Merges the character-chat idea (bring your cast) with the narration-engine's
 * wizard -> phase -> motif-spine architecture, re-aimed at FICTION. The Chloe/Rook
 * council steers each chapter's emotional beat; the "mouth" (Perchance aiTextPlugin,
 * or any adapter) writes the prose, streaming live. Runs standalone or on Perchance.
 *
 * Pipeline:  Story type  ->  Cast (roles + fates)  ->  Narrator (type + voice)  ->  Write the book.
 * Each chapter: brain picks the beat-tilt + a rotating motif, the prompt is assembled
 * from the wizard, the mouth STREAMS it in. Add / continue-from-cursor / regenerate /
 * edit / export. Books save to a kv-backed library (My Books).
 */
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var el = function (tag, attrs, kids) {
    var n = document.createElement(tag); attrs = attrs || {};
    for (var k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  };

  // ---------------------------------------------------------------- catalogue ----
  // Each story type carries: a default narrator, a beat arc (the chapter skeleton),
  // and a small voice-matched motif bank (its spine images). Motifs rotate via HNE's
  // pickFromBank when imported, else a local shuffle.
  var STORY_TYPES = [
    { id: 'cozy', label: 'Cozy Slice-of-Life', emoji: '🏡', blurb: 'Warm, low stakes, found-family. Tea, small wins, gentle growth.',
      narrator: { type: 'third-close', voice: 'warm' },
      beats: ['An ordinary morning, gently drawn', 'A small wrinkle disturbs the calm', 'Reaching out; a hand offered', 'A shared effort, an awkward stumble', 'It comes right, and a warm seed of more'],
      motifs: [{ id: 'kettle', image: 'a kettle just beginning to murmur', essence: 'small comforts gathering' }, { id: 'window', image: 'rain tapping a warm-lit window', essence: 'safe inside while the world is wet' }, { id: 'loaf', image: 'bread cooling on a board', essence: 'something made by hand, for someone' }] },
    { id: 'fantasy', label: 'Epic Fantasy', emoji: '⚔️', blurb: 'High stakes, old magic, a journey that changes everyone on it.',
      narrator: { type: 'third-omniscient', voice: 'grand' },
      beats: ['The ordinary world, and a shadow on its edge', 'The call, and the refusing of it', 'Crossing the threshold; the road begins', 'Trials, allies, and a true cost', 'The dark before; everything is risked', 'The turning, paid for in full', 'Home, but changed forever'],
      motifs: [{ id: 'beacon', image: 'a far beacon lit on a black ridge', essence: 'a promise kept across distance' }, { id: 'blade', image: 'a notched blade, honest about its work', essence: 'what survival actually costs' }, { id: 'root', image: 'roots older than the kingdom, drinking deep', essence: 'powers that predate the throne' }] },
    { id: 'noir', label: 'Noir Mystery', emoji: '🕵️', blurb: 'Rain, secrets, a crooked city. Everyone is lying about something.',
      narrator: { type: 'hardboiled', voice: 'wry' },
      beats: ['A case walks in out of the rain', 'The easy story, and the crack in it', 'Pulling the thread; the city pushes back', 'A body, a betrayal, a warning', 'The lie unspools; the cost lands close', 'The truth, ugly and complete'],
      motifs: [{ id: 'neon', image: 'neon bleeding pink into a wet gutter', essence: 'beauty rented by the hour' }, { id: 'smoke', image: 'smoke held a beat too long before the answer', essence: 'the pause where the lie lives' }, { id: 'rain', image: 'rain that never quite washes the street clean', essence: 'guilt that does not rinse off' }] },
    { id: 'romance', label: 'Romance', emoji: '💞', blurb: 'Two people, one collision, all the wrong reasons to resist it.',
      narrator: { type: 'third-close', voice: 'intimate' },
      beats: ['Two orbits that should not cross', 'The meeting, and the spark denied', 'Forced together; the wall thins', 'A real moment, then fear of it', 'The break, sharp and avoidable', 'The reach back, braver this time', 'Chosen, out loud'],
      motifs: [{ id: 'hands', image: 'two hands not quite touching on a shared armrest', essence: 'the inch that means everything' }, { id: 'coat', image: 'a coat given up without comment', essence: 'care that will not announce itself' }, { id: 'song', image: 'a song that now belongs to two people', essence: 'a private world, two citizens' }] },
    { id: 'scifi', label: 'Sci-Fi Adventure', emoji: '🚀', blurb: 'Far places, hard choices, a crew that becomes a reason to come home.',
      narrator: { type: 'third-omniscient', voice: 'grand' },
      beats: ['A routine run, one wrong reading', 'The anomaly that will not be ignored', 'In too deep; the crew splinters', 'A discovery that rewrites the stakes', 'The sacrifice play', 'A new sky, and who they are under it'],
      motifs: [{ id: 'signal', image: 'a signal older than the system it crossed', essence: 'a message from before us' }, { id: 'hull', image: 'frost spidering across a cooling hull', essence: 'how thin the wall to the void is' }, { id: 'earth', image: 'a pale familiar dot held in the viewport', essence: 'the small reason for all of it' }] },
    { id: 'fairytale', label: 'Fairy Tale', emoji: '🌟', blurb: 'Once upon a time, a clear lesson, a teller who winks at you.',
      narrator: { type: 'storyteller', voice: 'warm' },
      beats: ['Once upon a time, a small wrongness', 'A wish, a bargain, a road into the wood', 'Three trials, three kindnesses or cruelties', 'The trap closes; cleverness over strength', 'The turn, and the price of the wish paid', 'And so, the lesson, gently'],
      motifs: [{ id: 'key', image: 'a small key warm from being held', essence: 'something that opens, already in hand' }, { id: 'thread', image: 'a red thread tied at the wrist', essence: 'a promise the wood remembers' }, { id: 'crumb', image: 'crumbs the birds have nearly finished', essence: 'a way home, vanishing' }] },
    { id: 'horror', label: 'Gothic Horror', emoji: '🕯️', blurb: 'A house that watches, a dread that grows, a truth better left shut.',
      narrator: { type: 'lyrical', voice: 'eerie' },
      beats: ['Arrival at a place that is wrong, quietly', 'Small impossibilities, explained away', 'The house asserts itself', 'The history surfaces; it wants something', 'The descent; the rules break', 'What was always true, faced at last'],
      motifs: [{ id: 'door', image: 'a door that is open a finger-width more each morning', essence: 'patient, certain wrongness' }, { id: 'damp', image: 'a damp that smells faintly of before', essence: 'the past, not staying past' }, { id: 'mirror', image: 'a mirror a half-second slow', essence: 'something wearing your reflection' }] },
    { id: 'comedy', label: 'Comedy / Whimsy', emoji: '🎭', blurb: 'A small disaster, escalating beautifully, hearts intact at the end.',
      narrator: { type: 'drywit', voice: 'breezy' },
      beats: ['A perfectly reasonable plan', 'The first thing goes wrong, harmlessly', 'A cascade of dignified panic', 'The scheme to fix it makes it worse', 'Rock bottom, with excellent timing', 'It all lands, somehow, and nobody learns much'],
      motifs: [{ id: 'cake', image: 'a cake committed to before it was wise', essence: 'optimism exceeding ability' }, { id: 'list', image: 'a to-do list growing faster than it shrinks', essence: 'control, gloriously losing' }, { id: 'hat', image: 'a hat retrieved with too much ceremony', essence: 'dignity, defended past all reason' }] }
  ];
  // THEME = a setting/subject overlaid on the genre (orthogonal). TONE = the overall vibe.
  // Both optional; the genre supplies the structural backbone (narrator + beats + motifs).
  var THEMES = [
    { id: 'space', label: '🚀 Space', text: 'deep space — starships, stations, the silent void' },
    { id: 'pirates', label: '🏴 Pirates', text: 'the high seas — plunder, mutiny, salt and rope' },
    { id: 'dungeon', label: '🗡 Dungeon-crawler RPG', text: 'a dungeon-crawler RPG — a party, loot, levels, a deadly descent' },
    { id: 'heist', label: '💰 Heist', text: 'a heist — a crew, a score, a plan that goes sideways' },
    { id: 'court', label: '⚖ Courtroom', text: 'a courtroom — trials, testimony, the truth on the line' },
    { id: 'western', label: '🤠 Wild West', text: 'the frontier — dust, a quick draw, a reckoning coming' },
    { id: 'cyberpunk', label: '🌃 Cyberpunk', text: 'a cyberpunk city — neon, megacorps, chrome and rain' },
    { id: 'academy', label: '🎓 Magic academy', text: 'a school of magic — students, rivalries, forbidden study' },
    { id: 'survival', label: '🏝 Survival', text: 'the wilderness — scarcity, the elements, the will to last' },
    { id: 'mythic', label: '🐉 Mythic / gods', text: 'an age of myth — gods, monsters, prophecy and fate' }
  ];
  var TONES = [
    { id: 'surprise', label: '🎲 Surprise me!', text: '' },   // default: leave it open, the brain chooses the vibe
    { id: 'dark', label: 'Dark', text: 'dark and serious' },
    { id: 'hopeful', label: 'Hopeful', text: 'warm and hopeful' },
    { id: 'epic', label: 'Epic', text: 'sweeping and epic' },
    { id: 'cozy', label: 'Cozy', text: 'gentle and cozy' },
    { id: 'comedic', label: 'Comedic', text: 'comedic and light' },
    { id: 'romantic', label: 'Romantic', text: 'tender and romantic' },
    { id: 'gritty', label: 'Gritty', text: 'gritty and unflinching' },
    { id: 'whimsical', label: 'Whimsical', text: 'whimsical and playful' },
    { id: 'bittersweet', label: 'Bittersweet', text: 'bittersweet' }
  ];
  var NARRATOR_TYPES = [
    { id: 'third-omniscient', label: 'Third person — omniscient', hint: 'Knows every heart; sweeping, can step back.' },
    { id: 'third-close', label: 'Third person — close', hint: 'Tight over the hero’s shoulder.' },
    { id: 'first', label: 'First person', hint: '“I” — the hero tells it themselves.' },
    { id: 'storyteller', label: 'Fairy-tale teller', hint: 'Addresses the reader; “once upon a time…”' },
    { id: 'drywit', label: 'Dry & wry', hint: 'Deadpan, ironic asides.' },
    { id: 'lyrical', label: 'Lyrical / literary', hint: 'Image-rich, slow, beautiful.' },
    { id: 'hardboiled', label: 'Hardboiled', hint: 'Clipped, cynical, rain-slicked.' }
  ];
  var VOICES = ['warm', 'wry', 'grand', 'intimate', 'eerie', 'breezy', 'somber'];
  var ROLES = [
    { id: 'protagonist', label: 'Protagonist / Hero' },
    { id: 'sidekick', label: 'Side-character (ventures with the hero)' },
    { id: 'antagonist', label: 'Antagonist / Villain' },
    { id: 'background', label: 'Background character' }
  ];
  // Fate options are role-aware (the user's spec): heroes can be immortal or mortal,
  // villains must fall or may survive, background may or may not make it.
  var FATES = {
    protagonist: [{ id: 'mortal', label: 'Can die (real stakes / a sad ending is allowed)' }, { id: 'immortal', label: 'Never dies (immortal / guaranteed survival)' }],
    sidekick: [{ id: 'mortal', label: 'Can die (real stakes)' }, { id: 'immortal', label: 'Never dies' }, { id: 'noble-death', label: 'Dies nobly for the hero' }],
    antagonist: [{ id: 'must-fall', label: 'Must fall / die by the end' }, { id: 'survives', label: 'May survive (sequel-ready)' }, { id: 'redeemed', label: 'Redeemed, not killed' }],
    background: [{ id: 'bg-survives', label: 'Survives' }, { id: 'bg-dies', label: 'Doesn’t survive' }, { id: 'bg-either', label: 'Up to the story' }]
  };
  // ---- character library: fun, story-ready cast you can drop in ----
  // The Rook crew (the project's themeable personas) + house archetypes. Each persona is written
  // with a VOICE and a quirk, so they read as living characters in the prose - not flat labels.
  var ROOK_CREW = [
    { name: 'Chloe', persona: 'Warm, quick-witted, a little mischievous; talks like your favourite person in the group chat. Deflects real feelings with a joke, then says the true thing anyway.' },
    { name: 'Rook', persona: 'A calm, sharp, loyal agent who has your back before you ask. Says little and means all of it; the dry humour surfaces at the worst possible moment.' },
    { name: 'Jeeves', persona: 'An impeccable valet: composed, precise, quietly devastating with a single raised eyebrow. Solves the problem before you finish describing it, and never lets you see him hurry.' },
    { name: 'Sage', persona: 'A grounded, plain-spoken advisor who asks the one question you were avoiding. Never preachy; somehow always right, which is mildly infuriating.' },
    { name: 'Spark', persona: 'High-energy, decisive, allergic to standing still. Turns a setback into a montage and gets everyone moving before they can argue.' }
  ];
  var SAMPLE_CAST = [
    { name: 'Wren', persona: 'A quick-witted courier with a stubborn streak and a soft spot for strays. Mouths off to anyone in charge, then quietly does the right thing and hates being thanked for it.' },
    { name: 'Neon', persona: 'A neon-lit information broker who trades in secrets and terrible puns. Knows everyone, trusts no one, tips well and lies beautifully. Flirts with danger, literally and otherwise.' },
    { name: 'Master Aldous', persona: 'An aging scholar who knows one dangerous thing too many and cannot stop poking it. Speaks in tangents that turn out to matter; hoards tea and secrets in equal measure.' },
    { name: 'The Hollow Man', persona: 'A patient antagonist who never raises his voice, because he never needs to. Unfailingly polite, which is the most frightening thing about him.' },
    { name: 'Pip', persona: 'Small, brave, and chronically underestimated, which Pip uses without mercy. Asks the question everyone else is too proud to ask.' },
    { name: 'Captain Vance', persona: 'A weary leader carrying one regret like ballast. Gruff, fair, and quietly terrified of losing one more person on her watch.' }
  ];
  // folklore & mythic figures — drop a legend straight into the cast (the brain already knows their lore)
  var MYTH_CAST = [
    { name: 'Merlin', persona: 'The old enchanter who remembers the future and forgets the present. Speaks in riddles that turn out to be instructions.' },
    { name: 'Baba Yaga', persona: 'The witch of the wood whose hut walks on chicken legs. Tests every visitor; eats those who answer wrong, rewards those who answer true.' },
    { name: 'Anansi', persona: 'The spider-trickster who won all the world’s stories by outwitting gods. Charming, lazy, and always three steps ahead.' },
    { name: 'Loki', persona: 'The shape-shifting mischief of the Norse gods — silver-tongued, loyal to no one, and never quite the villain you expect.' },
    { name: 'The Morrígan', persona: 'The crow-goddess of war and fate who appears at fords before a battle. Knows who will fall and tells them anyway.' },
    { name: 'Scheherazade', persona: 'The storyteller who stays alive one cliffhanger at a time. Brilliant, brave, and never finishes a tale before dawn.' },
    { name: 'Robin Hood', persona: 'The outlaw of the greenwood with a quick bow and a quicker grin. Steals from the cruel, gives to the forgotten, laughs at the law.' },
    { name: 'The Fisher King', persona: 'A wounded king whose hurt has sickened the whole land; only the right question, asked by the right fool, can heal him.' }
  ];

  // ---------------------------------------------------------------- state ----
  var S = {
    view: 'wizard',          // 'wizard' | 'library'
    step: 0,                 // 0 type, 1 cast, 2 narrator, 3 write
    bookId: null,            // kv id once saved
    typeId: null,            // genre id (or 'custom')
    title: '',               // explicit book name (rename); else derived from page 1 / genre
    customGenre: '',         // free-text genre when typeId === 'custom'
    themeId: 'none', theme: '',   // setting/subject overlay (optional)
    toneId: 'surprise', tone: '', // overall vibe ('' = surprise / brain decides)
    cast: [],                // {name, persona, role, fate, romantic}
    narrator: null,          // {type, voice}
    pages: [],               // {n, title, beat, body, motifId, intent, vote, streaming, chapterMark:{title,subtitle}, footnote}
    pageIdx: 0,              // which page the pager is showing
    summary: '',             // running one-line digest, fed back into each page
    usedMotifs: [],          // rotation memory
    stance: 'balanced',      // brain stance preset (weights + frame)
    weights: {},             // per-faculty vote-weight multipliers (1 = default)
    noise: 0,                // spontaneity 0..40 (council deliberation noise)
    lore: { people: [], places: [], world: [], threads: [] },  // structured world-memory the brain builds
    grounds: [],             // real-world facts the brain looked up (Almanac) to ground the fiction
    compass: { place: '', heading: '' },   // where the action is + which way is "forward" (North stays North)
    calendar: { label: '', day: 0 },       // in-story date/time the brain advances (consistency, not real time)
    plan: { end: '', target: 0 },   // the SECRET destination + target length (end-in-mind)
    resolving: false,        // author hit "head to the ending" -> converge the threads now
    brainOpen: false,        // is the Story Brain panel expanded
    busy: false
  };
  var STEPS = ['Story type', 'Characters', 'Narrator', 'Write the book'];

  // brain (optional): the council picks an emotional tilt for each chapter's beat.
  // THE BRAIN: the deterministic Council (faculties: heart/reason/play/voice/...) steers each chapter.
  // council.decide(beat) -> {intent, directive, vibe}; council.feedback('up'|'down', toward) learns;
  // council.status() -> {vibe, avgMood, standings} (introspection); setWeights/noise/frame tune it.
  var CORE_FACULTIES = (window.RookBrain && window.RookBrain.CORE) || ['heart', 'reason', 'memory', 'instinct', 'voice', 'conscience', 'play'];
  // narrative stances: a frame + a per-faculty weight profile, mapped from Rook's STANCES to story moods.
  var STANCES = {
    balanced:   { label: '📖 Balanced', frame: 'storytelling', w: {}, blurb: 'Even-handed narration.' },
    tender:     { label: '💗 Tender', frame: 'storytelling', w: { heart: 1.6, play: 1.2 }, blurb: 'Warm, intimate, close.' },
    dramatic:   { label: '⚔ Dramatic', frame: { stature: 'commands' }, w: { voice: 1.4, instinct: 1.4 }, blurb: 'High stakes, momentum.' },
    ominous:    { label: '🕯 Ominous', frame: { alignment: 'adversary' }, w: { instinct: 1.5, conscience: 0.5, heart: 0.7 }, blurb: 'Dread, menace, unease.' },
    playful:    { label: '🎭 Playful', frame: 'storytelling', w: { play: 1.6, voice: 1.2 }, blurb: 'Wit, mischief, levity.' },
    reflective: { label: '🌙 Reflective', frame: 'storytelling', w: { reason: 1.4, memory: 1.4, conscience: 1.2 }, blurb: 'Inward, contemplative.' }
  };
  var council = null;
  function rebuildCouncil() {
    if (!(window.RookBrain && window.RookBrain.Council)) { council = null; return; }
    try {
      var st = STANCES[S.stance] || STANCES.balanced;
      council = new window.RookBrain.Council({ frame: st.frame || 'storytelling', noise: (S.noise || 0) / 100, weights: S.weights || {}, user: { name: 'Author', description: 'writing a book chapter by chapter' } });
    } catch (e) { council = null; }
  }
  rebuildCouncil();
  function hasBrain() { return !!council; }
  function applyStance(id) { var st = STANCES[id]; if (!st) return; S.stance = id; S.weights = {}; for (var k in (st.w || {})) S.weights[k] = st.w[k]; rebuildCouncil(); autoSave(); render(); refreshBrainReadout(); }
  function setFacultyWeight(id, mult) { S.weights = S.weights || {}; S.weights[id] = mult; S.stance = 'custom'; rebuildCouncil(); autoSave(); refreshBrainReadout(); }
  function setNoise(v) { S.noise = v; rebuildCouncil(); autoSave(); refreshBrainReadout(); }
  // run one deliberation on the current beat so the live readout reflects the new wiring immediately
  function refreshBrainReadout() {
    if (!council || !council.decide || !S.brainOpen) return;
    var beat = (S.pages[S.pageIdx] && S.pages[S.pageIdx].beat) || (typeOf() && typeOf().beats[0]) || 'the story';
    Promise.resolve(council.decide(beat)).then(function () { var n = document.querySelector('.brainp-read'); if (n) n.textContent = '🧠 ' + statusReadout(); }).catch(function () {});
  }
  function brainStatus() { if (!council || !council.status) return null; try { return council.status(); } catch (e) { return null; } }
  function statusReadout() {
    var st = brainStatus(); if (!st) return 'brain offline';
    var v = st.vibe || {}, lead = (st.standings || []).slice(0, 3).map(function (s) { return s.id; }).join(', ');
    function r(x) { return (x == null ? '?' : Math.round(x * 100) / 100); }
    return 'vibe ' + (v.tone || '?') + ' · warmth ' + r(v.warmth) + ' · tension ' + r(v.tension) + ' · mood ' + r(st.avgMood) + ' · leading: ' + (lead || '—');
  }

  // ------------------------------------------------- in-page modals (no native prompt/confirm) ----
  // Replaces window.prompt/confirm: nicer, themed, and avoids the native dialog that wedges some hosts.
  function modalAsync(o) {
    o = o || {};
    return new Promise(function (resolve) {
      var inp = null;
      var box = el('div', { class: 'bm-modal-box' });
      if (o.message) box.appendChild(el('div', { class: 'bm-modal-msg', text: o.message }));
      if (o.input) { inp = el(o.multiline ? 'textarea' : 'input', { class: 'bm-modal-input', value: o.value || '' }); if (o.placeholder) inp.setAttribute('placeholder', o.placeholder); if (o.multiline) inp.setAttribute('rows', '5'); box.appendChild(inp); }
      var rowEl = el('div', { class: 'bm-modal-row' });
      if (o.extra && o.extra.fn && inp) {   // optional "✨ Auto" button: runs a fn and fills the input
        var xb = el('button', { class: 'btn ghost sm', style: 'margin-right:auto', onclick: function () { xb.disabled = true; var t = xb.textContent; xb.textContent = '…'; Promise.resolve(o.extra.fn()).then(function (r) { if (r) inp.value = r; xb.disabled = false; xb.textContent = t; }).catch(function () { xb.disabled = false; xb.textContent = t; }); } }, [o.extra.label || '✨ Auto']);
        rowEl.appendChild(xb);
      }
      if (!o.hideCancel) rowEl.appendChild(el('button', { class: 'btn ghost sm', onclick: function () { done(o.input ? null : false); } }, [o.cancelText || 'Cancel']));
      rowEl.appendChild(el('button', { class: 'btn sm', onclick: function () { done(o.input ? (inp ? inp.value : '') : true); } }, [o.okText || 'OK']));
      box.appendChild(rowEl);
      var ov = el('div', { class: 'bm-modal' }, [box]);
      document.body.appendChild(ov);
      if (inp) setTimeout(function () { try { inp.focus(); inp.select && inp.select(); } catch (e) {} }, 20);
      function done(v) { document.removeEventListener('keydown', onKey); ov.remove(); resolve(v); }
      function onKey(e) { if (e.key === 'Escape') done(o.input ? null : false); else if (e.key === 'Enter' && inp && !o.multiline) done(inp.value); }
      ov.addEventListener('mousedown', function (e) { if (e.target === ov) done(o.input ? null : false); });
      document.addEventListener('keydown', onKey);
    });
  }
  function askAsync(message, value, opts) { opts = opts || {}; return modalAsync({ message: message, input: true, value: value, placeholder: opts.placeholder, multiline: opts.multiline, okText: opts.okText }); }
  function confirmAsync(message, opts) { opts = opts || {}; return modalAsync({ message: message, okText: opts.okText || 'Yes', hideCancel: opts.hideCancel }); }

  // ------------------------------------------------- structured world-memory (the brain learns) ----
  // Like a rolling chat, the brain files what it learns into People / Places / World-lore / Threads
  // (open questions & clues). Recent pages ride the treadmill verbatim; everything older is remembered
  // here. THREADS are the unresolved tensions a mystery must pay off — always surfaced toward the end.
  var LORE_CAP = { people: 24, places: 16, world: 24, threads: 16 };
  function loreInit() { if (!S.lore || !S.lore.threads) S.lore = { people: [], places: [], world: [], threads: [] }; }
  function loreCount() { loreInit(); return S.lore.people.length + S.lore.places.length + S.lore.world.length + S.lore.threads.length; }
  function allLore() { loreInit(); return [].concat(S.lore.people, S.lore.places, S.lore.world, S.lore.threads); }
  function mergeLore(cat, facts) {
    loreInit(); if (!S.lore[cat]) cat = 'world';
    var arr = S.lore[cat], have = {}; arr.forEach(function (f) { have[f.toLowerCase().slice(0, 40)] = 1; });
    (facts || []).forEach(function (f) { f = String(f).trim(); var k = f.toLowerCase().slice(0, 40); if (f.length > 6 && !have[k]) { have[k] = 1; arr.push(f); } });
    if (arr.length > (LORE_CAP[cat] || 20)) S.lore[cat] = arr.slice(-LORE_CAP[cat]);
  }
  function resolveThreads(texts) {   // drop threads the model says a page paid off (the clue is answered)
    loreInit(); (texts || []).forEach(function (t) {
      var qs = String(t).toLowerCase().split(/\W+/).filter(function (w) { return w.length > 3; });
      S.lore.threads = S.lore.threads.filter(function (th) { var tl = th.toLowerCase(); return qs.filter(function (w) { return tl.indexOf(w) >= 0; }).length < 2; });
    });
  }
  function extractFactsRegex(text, names) {   // offline fallback (no model): cast-name + state-verb sentences
    var out = [], seen = {};
    var sents = String(text || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s/);
    var sv = /\b(discovered|learned|found|became|turned out|died|killed|arrived|left|betrayed|revealed|swore|vowed|lost|won|escaped|destroyed|created|married|named|carried|wore|hid|kept|is|was|are|were|has|had)\b/i;
    sents.forEach(function (s) { s = s.trim(); if (s.length < 14 || s.length > 200) return; var hasName = (names || []).some(function (n) { return n && s.indexOf(n) >= 0; }); if (hasName && sv.test(s)) { var k = s.toLowerCase().slice(0, 44); if (!seen[k]) { seen[k] = 1; out.push(s); } } });
    return out;
  }
  function editingBody() { var a = document.activeElement; return !!(a && a.classList && a.classList.contains('body') && a.getAttribute('contenteditable') === 'true'); }
  // background learning may finish while a page is streaming or being edited — never re-render over either
  function afterLearn() { autoSave(); if (S.brainOpen && S.view === 'wizard' && S.step === 3 && !S.busy && !editingBody()) render(); }
  // The brain reads each finished page like a chat turn and files what it learned (background, no
  // added latency). With a model it categorizes + tracks clues; offline it falls back to the regex.
  function learnFromPage(body) {
    if (hasAi()) {
      var prompt = [
        'Read the PAGE and update the story knowledge-base. Output ONLY lines, each  CATEGORY: text  where CATEGORY is one of:',
        '  PERSON  - a durable fact about a character (use real names)',
        '  PLACE   - a location and what is true of it',
        '  WORLD   - a rule, history, or fact about the world',
        '  THREAD  - a NEW open question, mystery, clue, or unresolved tension this page raised',
        '  RESOLVED - an earlier thread/clue this page paid off (quote it briefly)',
        '  WHERE   - where the action stands at the END of this page + facing direction (e.g.  the harbor | NE)',
        '  TIME    - how in-story time moved (e.g.  the next morning | +1day ; same scene |  | +0)',
        'Up to 8 lines. Skip temporary states (e.g. "is tired"). If nothing durable, output the single word none.',
        '\nPAGE:\n' + String(body || '').slice(0, 1800)
      ].join('\n');
      var CAT = { PERSON: 'people', PLACE: 'places', WORLD: 'world', THREAD: 'threads' };
      writeWithModel(prompt).then(function (txt) {
        if (/^\s*none\s*$/i.test(txt || '')) { afterLearn(); return; }
        var resolved = [];
        String(txt || '').split(/\n+/).forEach(function (l) {
          var mw = l.match(/^\s*WHERE\s*[:\-]\s*(.+)$/i); if (mw) { var pp = mw[1].split('|'); S.compass = { place: (pp[0] || '').trim(), heading: (pp[1] || S.compass.heading || '').trim() }; return; }
          var mt = l.match(/^\s*TIME\s*[:\-]\s*(.+)$/i); if (mt) { var tp = mt[1].split('|'); var lbl = (tp[0] || '').trim(), dlt = parseInt(String(tp[1] || '').replace(/[^\d-]/g, ''), 10) || 0; S.calendar = { label: lbl || S.calendar.label, day: (S.calendar.day || 0) + Math.max(0, dlt) }; return; }
          var m = l.match(/^\s*(PERSON|PLACE|WORLD|THREAD|RESOLVED)\s*[:\-]\s*(.+)$/i);
          if (!m) return; var cat = m[1].toUpperCase(), fact = m[2].trim();
          if (cat === 'RESOLVED') resolved.push(fact); else mergeLore(CAT[cat], [fact]);
        });
        if (resolved.length) resolveThreads(resolved);
        afterLearn();
      }).catch(function () { mergeLore('world', extractFactsRegex(body, S.cast.map(function (c) { return c.name; }))); afterLearn(); });
    } else { mergeLore('world', extractFactsRegex(body, S.cast.map(function (c) { return c.name; }))); afterLearn(); }
  }
  function relevantLore(query) {
    loreInit(); if (!loreCount()) return '';
    var q = String(query || '').toLowerCase().split(/\W+/).filter(function (w) { return w.length > 3; });
    function pick(arr, n, always) {
      if (always) return arr.slice(-n);   // threads: take the most recent N (all of them matter for payoff)
      var scored = arr.map(function (f) { var ft = f.toLowerCase(), s = 0; q.forEach(function (t) { if (ft.indexOf(t) >= 0) s++; }); return { f: f, s: s }; }).sort(function (a, b) { return b.s - a.s; });
      var top = scored.filter(function (x) { return x.s > 0; }).slice(0, n); if (!top.length) top = scored.slice(0, Math.min(2, n));
      return top.map(function (x) { return x.f; });
    }
    var parts = [], pe = pick(S.lore.people, 5), pl = pick(S.lore.places, 3), wo = pick(S.lore.world, 5), th = pick(S.lore.threads, 8, true);
    if (pe.length) parts.push('People: ' + pe.join(' | '));
    if (pl.length) parts.push('Places: ' + pl.join(' | '));
    if (wo.length) parts.push('World: ' + wo.join(' | '));
    if (th.length) parts.push('Open threads / clues (advance these; pay them off near the end): ' + th.join(' | '));
    return parts.join('\n');
  }

  // ------------------------------------------------- end-in-mind: a planned destination + arc ----
  // What a plain LLM can't do: hold an ENDING and build toward it. The brain keeps a SECRET
  // destination (for a mystery: culprit/method/motive/misdirection) and steers each page by where it
  // sits in the arc — planting clues early, converging late, paying off the threads at the resolution.
  function planTarget() { return S.plan.target || (typeOf() ? typeOf().beats.length : 8) || 8; }
  function arcPhase(n) {
    var pos = n / Math.max(2, planTarget());
    if (S.resolving || pos > 0.85) return { key: 'resolution', note: 'RESOLUTION: deliver the destination. Pay off the open threads and clues; make the ending land and feel inevitable in hindsight.' };
    if (pos <= 0.25) return { key: 'setup', note: 'SETUP: establish the people, the place, and the central question. Plant seeds quietly; show, do not explain.' };
    if (pos <= 0.6) return { key: 'rising', note: 'RISING: complicate and deepen. Plant ONE genuine clue toward the destination AND one plausible misdirection. Raise the stakes.' };
    return { key: 'converge', note: 'CONVERGE: tighten toward the destination. Begin paying off planted threads; narrow the possibilities. No full reveal yet.' };
  }
  function destinationBlock(n) {
    if (!S.plan || !S.plan.end) return '';
    return '\nSECRET DESTINATION — the story is secretly built toward this; NEVER state it outright, reach it through clues and consequence:\n' + S.plan.end +
      '\nPACING: this is page ' + n + ' of about ' + planTarget() + ' — ' + arcPhase(n).note;
  }
  // the navigation compass + in-story calendar the brain tracks (consistency of place & time)
  function bearingsBlock() {
    var c = S.compass || {}, cal = S.calendar || {}, parts = [];
    if (c.place || c.heading) parts.push('Place: ' + (c.place || '?') + (c.heading ? ', heading ' + c.heading : '') + ' — North stays North; keep compass directions and travel consistent.');
    if (cal.label || cal.day) parts.push('Time: ' + (cal.label || ('day ' + cal.day)) + (cal.day && cal.label ? ' (story day ' + cal.day + ')' : '') + ' — keep weekdays/dates consistent and advance time naturally.');
    return parts.length ? '\nBEARINGS & TIME (the brain is tracking these — stay consistent):\n' + parts.map(function (p) { return '- ' + p; }).join('\n') : '';
  }
  function genPlan() {
    var t = typeOf(); if (!t) return Promise.resolve('');
    var mystery = /noir/.test(S.typeId) || /myster/i.test(t.label) || /myster|detective|whodunit|crime|murder/i.test((S.theme || '') + ' ' + (S.tone || ''));
    var ask = mystery
      ? 'Devise the SECRET solution this ' + t.label + ' is built toward: who is truly responsible, the method, the motive, and the key misdirection that hides it. 2-4 sentences. Author-only destination, never shown to the reader.'
      : 'Devise the SECRET destination this ' + t.label + ' is built toward: the climax and how it resolves — the turn, the cost, the final state. 2-4 sentences. Author-only, never shown to the reader.';
    var ctx = (S.theme ? ' Setting: ' + S.theme + '.' : '') + (S.cast.length ? ' Cast: ' + S.cast.map(function (c) { return c.name + ' (' + c.role + ')'; }).join(', ') + '.' : '');
    return writeWithModel(ask + ctx).then(function (txt) { return String(txt || '').trim(); });
  }
  function setPlan() {
    modalAsync({
      message: 'The SECRET destination the story builds toward — for a mystery: who is responsible, the method, the motive, and the misdirection. The reader never sees it; the brain steers every page toward it. Leave blank to clear.',
      input: true, multiline: true, value: (S.plan && S.plan.end) || '', okText: 'Set ending',
      placeholder: 'e.g. The lighthouse keeper drowned the heir for an inheritance; the stopped clock is the true clue, the limp a red herring.',
      extra: hasAi() ? { label: '✨ Let the brain devise it', fn: genPlan } : null
    }).then(function (v) { if (v == null) return; S.plan = S.plan || { end: '', target: 0 }; S.plan.end = String(v).trim(); autoSave(); render(); refreshBrainReadout(); });
  }
  function loreToText() {
    loreInit(); var lines = [];
    (S.lore.people || []).forEach(function (f) { lines.push('PERSON: ' + f); });
    (S.lore.places || []).forEach(function (f) { lines.push('PLACE: ' + f); });
    (S.lore.world || []).forEach(function (f) { lines.push('WORLD: ' + f); });
    (S.lore.threads || []).forEach(function (f) { lines.push('THREAD: ' + f); });
    return lines.join('\n');
  }
  function editLore() {
    askAsync('World-memory — one per line as  CATEGORY: fact  (PERSON / PLACE / WORLD / THREAD). Threads are open questions or clues the ending pays off.', loreToText(), { multiline: true, okText: 'Save' }).then(function (v) {
      if (v == null) return;
      var L = { people: [], places: [], world: [], threads: [] }, CAT = { PERSON: 'people', PLACE: 'places', WORLD: 'world', THREAD: 'threads' };
      String(v).split(/\n+/).forEach(function (l) { var m = l.match(/^\s*(PERSON|PLACE|WORLD|THREAD)\s*[:\-]\s*(.+)$/i); if (m) L[CAT[m[1].toUpperCase()]].push(m[2].trim()); else if (l.trim()) L.world.push(l.trim()); });
      S.lore = L; autoSave(); render();
    });
  }

  // ------------------------------------------------- foresee: simulate a move before committing ----
  // The brain's structural foresight (ported from Rook's foresee): score a proposed story move
  // against what a plain LLM can't hold — the planned ending, the fate rules, the arc phase, and the
  // open threads. Returns {net, score, confidence, outcomes, risks}.
  function foreseeStory(action) {
    var a = String(action || '').toLowerCase().trim();
    var outcomes = [], risks = [], score = 0;
    var phase = arcPhase(S.pages.length || 1).key, planned = !!(S.plan && S.plan.end);
    var isDeath = /\b(kill|dies?|death|murder|execute|sacrifice|slay)\b/.test(a);
    var isReveal = /\b(reveal|expose|unmask|confess|solve|culprit|the truth|whodunit|who did it)\b/.test(a);
    var isEnd = /\b(end|finale|conclude|wrap up|final page|last page|cliffhanger)\b/.test(a);
    var isIntro = /\b(introduce|new (character|suspect|villain|player)|bring in|arrives?)\b/.test(a);
    var isTwist = /\b(twist|betray|double.?cross|reversal|turn on)\b/.test(a);
    var reversible = !(isDeath || isReveal || /\b(destroy|burn|permanent)\b/.test(a));
    if (!reversible) { outcomes.push('a permanent, irreversible turn'); risks.push('no undo — it reshapes everything after'); score -= 0.1; }
    else { outcomes.push('a reversible beat you can walk back'); score += 0.05; }
    if (isDeath) {
      var named = S.cast.filter(function (c) { return a.indexOf(c.name.toLowerCase()) >= 0; });
      named.forEach(function (c) {
        if (c.fate === 'immortal') { risks.push(c.name + ' is set to NEVER die — this breaks a fate rule'); score -= 0.4; }
        else if (c.role === 'antagonist' && c.fate === 'must-fall' && phase !== 'resolution') { risks.push(c.name + ' (the antagonist) is meant to fall at the finale — killing them now ends the engine early'); score -= 0.25; }
        else if (c.fate === 'redeemed') { risks.push(c.name + ' is slated for redemption, not death'); score -= 0.3; }
        else { outcomes.push(c.name + '’s death raises real stakes'); score += 0.1; }
      });
      if (phase === 'setup') { risks.push('a death this early can feel unearned'); score -= 0.15; }
      else if (phase === 'converge' || phase === 'resolution') { outcomes.push('well-timed for the climax'); score += 0.1; }
    }
    if (isReveal && planned) {
      if (phase === 'resolution') { outcomes.push('this lands the planned destination'); score += 0.25; }
      else { risks.push('revealing now SPOILS the planned ending — the clues haven’t paid off yet (you’re in ' + phase + ')'); score -= 0.35; }
      var openT = ((S.lore && S.lore.threads) || []).length;
      if (openT && phase !== 'resolution') { risks.push(openT + ' open thread' + (openT > 1 ? 's' : '') + ' would be left dangling'); score -= 0.05 * Math.min(4, openT); }
    } else if (isReveal && !planned) { risks.push('no planned destination yet — a reveal may not be earned. Consider 🎯 Plan ending first'); score -= 0.1; }
    if (isEnd) {
      var near = S.pages.length >= planTarget() * 0.7;
      if (near || S.resolving) { outcomes.push('you’re near the target length — a good place to land'); score += 0.15; }
      else { risks.push('it’s early (page ' + S.pages.length + ' of ~' + planTarget() + ') — ending now may feel abrupt'); score -= 0.2; }
      if (/cliffhanger/.test(a)) { if (near) risks.push('a cliffhanger as the FINAL page can frustrate'); else outcomes.push('a cliffhanger here is a strong hook'); }
    }
    if (isIntro) { if (phase === 'converge' || phase === 'resolution') { risks.push('introducing someone new this late can muddy the convergence'); score -= 0.15; } else { outcomes.push('room to develop a new player'); score += 0.05; } }
    if (isTwist) { outcomes.push('a twist can re-energize the middle'); if (phase === 'setup') risks.push('a twist before the stakes are set may not land'); score += 0.05; }
    if (!isDeath && !isReveal && !isEnd && !isIntro && !isTwist) outcomes.push('a routine beat — low risk, low disruption');
    var net = score > 0.12 ? 'serves the story' : (score < -0.12 ? 'works against it' : 'mixed');
    return { net: net, score: Math.round(score * 100) / 100, confidence: Math.round(Math.min(0.9, 0.45 + 0.08 * (outcomes.length + risks.length) + (planned ? 0.1 : 0)) * 100) / 100, outcomes: outcomes, risks: risks };
  }
  function foreseeSketch(action) {   // optional model texture: likely narrative consequences
    if (!hasAi()) return Promise.resolve('');
    var recent = treadmill(S.pages.length - 1).map(function (r) { return r.body; }).join('\n').slice(-1200);
    return writeWithModel('In this story, the author is CONSIDERING this move (not committing): "' + action + '". Given the recent pages, sketch the 2-3 most likely narrative consequences if they did it. One line each, concise, no preamble.\n\nRECENT:\n' + recent).then(function (t) { return String(t || '').trim(); });
  }
  function openForesee(prefill) {
    var box = el('div', { class: 'bm-modal-box', style: 'max-width:min(94vw,540px)' });
    box.appendChild(el('div', { class: 'bm-modal-msg', text: '🔮 Foresee — try a story move before you commit. The brain weighs it against your ending, the fate rules, the arc, and the open threads.' }));
    var inp = el('input', { class: 'bm-modal-input', value: prefill || '' }); inp.setAttribute('placeholder', 'e.g. Reveal the culprit · Kill the villain now · End on a cliffhanger');
    box.appendChild(inp);
    var foil = (S.cast.filter(function (c) { return c.role === 'antagonist'; })[0] || {}).name;
    var hero = (S.cast.filter(function (c) { return c.role === 'protagonist'; })[0] || S.cast[0] || {}).name;
    var sug = el('div', { class: 'row', style: 'margin-top:6px' });
    [planned() ? 'Reveal the culprit now' : 'Reveal a big secret', foil ? ('Kill ' + foil + ' now') : 'Kill the villain now', hero ? ('Put ' + hero + ' in real danger') : 'Endanger the hero', 'End the book here', 'Introduce a new suspect', 'A sudden betrayal'].forEach(function (s) { sug.appendChild(el('button', { class: 'chip', style: 'cursor:pointer', onclick: function () { inp.value = s; } }, [s])); });
    box.appendChild(sug);
    var res = el('div', { class: 'foresee-res' }); box.appendChild(res);
    var rowEl = el('div', { class: 'bm-modal-row' });
    var writeBtn = el('button', { class: 'btn ghost sm', style: 'margin-right:auto;display:none', onclick: function () { var a = inp.value.trim(); done(); if (a) generatePage(a); } }, ['Write this as the next page']);
    rowEl.appendChild(writeBtn);
    rowEl.appendChild(el('button', { class: 'btn ghost sm', onclick: function () { done(); } }, ['Close']));
    rowEl.appendChild(el('button', { class: 'btn sm', onclick: run } , ['🔮 Foresee']));
    box.appendChild(rowEl);
    var ov = el('div', { class: 'bm-modal' }, [box]); document.body.appendChild(ov);
    setTimeout(function () { try { inp.focus(); } catch (e) {} }, 20);
    function done() { document.removeEventListener('keydown', onKey); ov.remove(); }
    function onKey(e) { if (e.key === 'Escape') done(); else if (e.key === 'Enter' && document.activeElement === inp) run(); }
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) done(); });
    document.addEventListener('keydown', onKey);
    function run() {
      var a = inp.value.trim(); if (!a) return;
      var f = foreseeStory(a); res.innerHTML = '';
      res.appendChild(el('div', { class: 'foresee-verdict ' + (f.score > 0.12 ? 'good' : (f.score < -0.12 ? 'bad' : 'mixed')) }, ['Verdict: ' + f.net + '  ·  ' + Math.round(f.confidence * 100) + '% confident']));
      f.outcomes.forEach(function (o) { res.appendChild(el('div', { class: 'foresee-li ok', text: '✓ ' + o })); });
      f.risks.forEach(function (r) { res.appendChild(el('div', { class: 'foresee-li risk', text: '⚠ ' + r })); });
      writeBtn.style.display = 'inline-block';
      if (hasAi()) { var sk = el('div', { class: 'muted', style: 'margin-top:8px', text: '…thinking through consequences' }); res.appendChild(sk); foreseeSketch(a).then(function (t) { if (!t) { sk.remove(); return; } sk.textContent = 'Likely consequences:'; t.split(/\n+/).forEach(function (l) { l = l.replace(/^[-•\d.\s]+/, '').trim(); if (l) res.appendChild(el('div', { class: 'foresee-li', text: '• ' + l })); }); }).catch(function () { sk.remove(); }); }
    }
    if (prefill) run();
  }
  function planned() { return !!(S.plan && S.plan.end); }

  // ------------------------------------------------- context treadmill + token budget ----
  // Long books can't fit every page in the prompt. So the recent context is a TREADMILL: the newest
  // pages ride verbatim (newest always; older added until the token budget; the oldest fall off),
  // while the brain's bible carries the durable facts from pages that have scrolled away. No lossy
  // rolling summary — pages are pruned, not compressed, and remembered as facts instead.
  function tokenMeta() { try { var ai = grab('aiTextPlugin'); if (typeof ai === 'function') { var m = ai({ getMetaObject: true }); if (m && m.countTokens) return m; } } catch (e) {} return null; }
  function countTok(s) { var m = tokenMeta(); if (m && m.countTokens) { try { return m.countTokens(String(s || '')); } catch (e) {} } return Math.ceil(String(s || '').length / 4); }
  function tokBudget() { var m = tokenMeta(); return ((m && m.idealMaxContextTokens) || 6000) - 900; }
  function trimToTokens(s, budget) {
    s = String(s || ''); if (budget <= 0) return ''; if (countTok(s) <= budget) return s;
    var lo = 0, hi = s.length;
    while (lo < hi) { var mid = Math.ceil((lo + hi) / 2); if (countTok(s.slice(0, mid)) <= budget) lo = mid; else hi = mid - 1; }
    var cut = s.slice(0, lo), p = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    if (p > cut.length * 0.5) cut = cut.slice(0, p + 1);
    return cut.trim() + ' …';
  }
  function treadmill(lastIdx) {     // up to 3 most-recent pages, newest always, older until ~45% of budget
    var budget = Math.floor(tokBudget() * 0.45), acc = [], used = 0;
    for (var i = lastIdx; i >= 0 && acc.length < 3; i--) {
      var p = S.pages[i]; if (!p || !p.body) continue;
      var body = String(p.body).trim();
      if (acc.length === 0) { if (countTok(body) > budget) body = trimToTokens(body, budget); acc.unshift({ n: p.n, body: body }); used += countTok(body); }
      else { var t = countTok(body); if (used + t > budget) break; acc.unshift({ n: p.n, body: body }); used += t; }
    }
    return acc;
  }
  function recentBeats(lastIdx) { return S.pages.slice(Math.max(0, lastIdx - 4), lastIdx + 1).map(function (p) { return p.beat; }).filter(Boolean).join(' → '); }

  function customGenre() {
    return { id: 'custom', label: S.customGenre || 'Custom', emoji: '✎', blurb: 'A genre of your own.',
      narrator: { type: 'third-close', voice: 'warm' },
      beats: ['An opening that sets the world and the want', 'A complication arrives', 'The stakes deepen; a choice', 'The low point, a real cost', 'A turn toward resolution', 'An ending that lands'],
      motifs: [] };
  }
  function typeOf() { if (S.typeId === 'custom') return customGenre(); return STORY_TYPES.filter(function (t) { return t.id === S.typeId; })[0] || null; }
  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 1800); }

  // ------------------------------------------------------ the mouth (model) ----
  // Perchance gives us aiTextPlugin; off-platform we fall back to a deterministic
  // "stub narrator" so the whole pipeline is demonstrable without a live model.
  // Reach a Perchance plugin: try the DSL `root` proxy first (the documented path), then window.
  // Off-platform both miss -> undefined -> we use the offline stub. NEVER call root() itself.
  function grab(name) { try { if (typeof root !== 'undefined' && root[name] !== undefined) return root[name]; } catch (e) {} try { if (window[name] !== undefined) return window[name]; } catch (e) {} return undefined; }
  function hasAi() { return typeof grab('aiTextPlugin') === 'function'; }
  // STREAMING: aiTextPlugin emits incremental chunks via onChunk; the resolved value is a BOXED
  // String. onToken(tk) gets each delta so chapters render live. Resolves to the canonical text.
  function writeWithModel(prompt, onToken) {
    var ai = grab('aiTextPlugin');
    return Promise.resolve(ai({
      instruction: prompt,
      onChunk: function (d) { try { if (onToken && d && d.textChunk != null) onToken(d.textChunk); } catch (e) {} }
    })).then(function (r) { return (r && (r.generatedText != null ? r.generatedText : String(r))) || ''; });   // r is a boxed String - never === it
  }
  // Stream a known string token-by-token (used by the offline stub so the preview also feels live).
  function streamTokens(text, onToken, done) {
    if (!onToken) return Promise.resolve(text);
    var toks = String(text).split(/(\s+)/), i = 0;   // keep whitespace tokens for exact reassembly
    return new Promise(function (resolve) {
      (function step() {
        if (i >= toks.length) { if (done) done(); resolve(text); return; }
        try { onToken(toks[i]); } catch (e) {}
        i++; setTimeout(step, 16);
      })();
    });
  }
  function composeStub(ctx) {
    // a readable placeholder that PROVES the assembly: it threads the cast, beat and motif.
    var hero = ctx.cast.filter(function (c) { return c.role === 'protagonist'; })[0] || ctx.cast[0] || { name: 'the traveller' };
    var foil = ctx.cast.filter(function (c) { return c.role === 'antagonist'; })[0];
    var lines = [];
    lines.push((ctx.narrator.type === 'first' ? 'I remember it began here. ' : '') + cap(ctx.beat) + '.');
    lines.push('There was ' + (ctx.motif ? ctx.motif.image : 'a quiet sign') + ' — ' + (ctx.motif ? ctx.motif.essence : 'a thing easy to miss') + '.');
    var hp = hero.persona ? hero.persona.replace(/\.$/, '') : ''; if (hp) hp = hp.charAt(0).toLowerCase() + hp.slice(1);
    lines.push(hero.name + ' moved through it ' + (hp ? 'like ' + hp : 'the only way they knew how') + '.');
    if (foil) lines.push('Somewhere not far off, ' + foil.name + ' was listening, in no hurry at all.');
    if (ctx.steer && (ctx.steer.intent || ctx.steer.vibe)) lines.push('(The story brain steers this toward ' + (ctx.steer.intent || ctx.steer.vibe) + '.)');
    lines.push('And when it ended, nothing was settled — which was, of course, the point.');
    return lines.join('\n\n');
  }
  function stubNarrator(ctx, onToken) { return streamTokens(composeStub(ctx), onToken); }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

  // ------------------------------------------------------ chapter assembly ----
  function pickMotif() {
    var t = typeOf(); if (!t) return null;
    try {
      var hne = grab('hne');
      if (hne && hne.pickFromBank) {
        var got = hne.pickFromBank({ bank: t.motifs, n: 1, excludeSet: S.usedMotifs, excludeField: 'id' });
        if (got && got[0]) return got[0];
      }
    } catch (e) {}
    var pool = t.motifs.filter(function (m) { return S.usedMotifs.indexOf(m.id) < 0; });
    if (!pool.length) pool = t.motifs;
    return pool[Math.floor(Math.random() * pool.length)] || null;
  }
  function fateConstraints() {
    var out = [];
    S.cast.forEach(function (c) {
      var note = null;
      if (c.fate === 'immortal') note = c.name + ' must survive the whole book (never dies).';
      else if (c.fate === 'must-fall') note = c.name + ' (the antagonist) must fall or die by the end — not before the finale.';
      else if (c.fate === 'survives') note = c.name + ' should still be alive at the end (left open for more).';
      else if (c.fate === 'redeemed') note = c.name + ' is redeemed rather than killed.';
      else if (c.fate === 'noble-death') note = c.name + ' dies meaningfully in service of the hero, late in the book.';
      else if (c.fate === 'mortal') note = c.name + ' faces genuine mortal stakes (may die).';
      else if (c.fate === 'bg-dies') note = c.name + ' does not survive the story.';
      else if (c.fate === 'bg-survives') note = c.name + ' survives.';
      if (c.romantic) note = (note ? note + ' ' : '') + c.name + ' is a romantic interest for the protagonist.';
      if (note) out.push(note);
    });
    return out;
  }
  // THE BRAIN STEP: the council deliberates on this beat and returns an intent + a directive
  // (a real steering instruction) + a vibe (tone/warmth/tension). Optional + graceful.
  function beatSteer(beat) {
    if (!council) return Promise.resolve(null);
    return Promise.resolve(council.decide(beat)).then(function (d) {
      if (!d) return null;
      var v = d.vibe || {};
      var vibe = [v.tone, isFinite(v.warmth) && v.warmth > 0.6 ? 'warm' : null, isFinite(v.tension) && v.tension > 0.6 ? 'taut' : null].filter(Boolean).join(', ');
      return { intent: d.intent || null, directive: d.directive || '', vibe: vibe };
    }).catch(function () { return null; });
  }
  function buildPrompt(ctx) {
    var t = typeOf(), nt = NARRATOR_TYPES.filter(function (x) { return x.id === ctx.narrator.type; })[0] || NARRATOR_TYPES[0];
    var cast = ctx.cast.map(function (c) {
      var role = (ROLES.filter(function (r) { return r.id === c.role; })[0] || {}).label || c.role;
      return '  - ' + c.name + ' — ' + role + (c.persona ? ': ' + c.persona : '');
    }).join('\n');
    var cons = fateConstraints();
    return [
      'You are the NARRATOR of a ' + t.label + ' book. ' + t.blurb,
      S.theme ? 'SETTING / THEME: ' + S.theme + '.' : '',
      S.tone ? 'OVERALL TONE: keep it ' + S.tone + '.' : '',
      'Narration: ' + nt.label + ' (' + nt.hint + '), in a ' + ctx.narrator.voice + ' voice. Hold this voice consistently.',
      '',
      'CHARACTERS:', cast,
      cons.length ? '\nFATE RULES (honor these across the book):\n' + cons.map(function (x) { return '  - ' + x; }).join('\n') : '',
      ctx.motif ? '\nRECURRING MOTIF (thread it lightly, 1–2 touches): "' + ctx.motif.image + '" — ' + ctx.motif.essence + '.' : '',
      (function () { var g = relevantGrounds(ctx.beat + ' ' + (S.theme || '')); return g ? '\nREAL-WORLD GROUNDING (the brain looked these up; use only what fits, keep the fiction):\n' + g : ''; })(),
      bearingsBlock(),
      destinationBlock(ctx.n),
      (function () { var b = relevantLore(ctx.beat + ' ' + (ctx.recentText || '')); return b ? '\nSTORY KNOWLEDGE — what the brain has tracked; keep it consistent:\n' + b : ''; })(),
      ctx.recentBeats ? '\nTHE ARC SO FAR (recent beats): ' + ctx.recentBeats : '\nThis is the opening page.',
      (ctx.recent && ctx.recent.length) ? '\nRECENT PAGES — continue seamlessly in tense and voice, do NOT repeat them:\n' + ctx.recent.map(function (r) { return '[Page ' + r.n + ']\n' + r.body; }).join('\n\n') : '',
      ctx.steer && ctx.steer.directive ? '\nNARRATIVE DIRECTION (from the story brain): ' + ctx.steer.directive : '',
      '\nWRITE Page ' + ctx.n + ': "' + ctx.title + '".',
      'Its beat: ' + ctx.beat + (ctx.steer && ctx.steer.vibe ? ' Tone: ' + ctx.steer.vibe + '.' : ''),
      'Length: 500–800 words of prose (no headings, no lists). Stay fully in the narrator’s voice. End on a small hook into the next chapter.'
    ].filter(Boolean).join('\n');
  }
  function chapterTitle(beat, n) {
    var words = String(beat).replace(/[,.;].*$/, '').split(' ').filter(function (w) { return w.length > 3; });
    return words.slice(0, 3).map(cap).join(' ') || ('Chapter ' + n);
  }

  function lastPageBody() { var n = document.querySelectorAll('.page .body'); return n.length ? n[n.length - 1] : null; }
  function autoScroll(node) { try { (node || lastPageBody()).scrollIntoView({ behavior: 'smooth', block: 'end' }); } catch (e) {} }

  function generatePage(customBeat) {
    if (S.busy) return; S.busy = true;
    var t = typeOf();
    var n = S.pages.length + 1;
    var beat = customBeat || t.beats[Math.min(S.pages.length, t.beats.length - 1)];
    var motif = pickMotif(); if (motif) S.usedMotifs.push(motif.id);
    var title = chapterTitle(beat, n);
    var lastIdx = S.pages.length - 1;                           // last existing page (treadmill anchor)
    var recent = treadmill(lastIdx), recentText = recent.length ? recent[recent.length - 1].body : '', beats = recentBeats(lastIdx);
    var ch = { n: n, title: title, beat: beat, body: '', motifId: motif && motif.id, engine: hasAi() ? 'perchance' : 'stub', streaming: true };
    S.pages.push(ch); S.pageIdx = S.pages.length - 1; render();   // jump the pager to the new page; it fills live
    var node = lastPageBody();
    beatSteer(beat).then(function (steer) {
      ch.intent = steer && steer.intent;   // remember what the brain aimed for (shown in the meta)
      var ctx = { n: n, title: title, beat: beat, steer: steer, motif: motif, cast: S.cast, narrator: S.narrator, recent: recent, recentText: recentText, recentBeats: beats };
      var prompt = buildPrompt(ctx);
      var onTok = function (tk) { ch.body += tk; if (node) { node.textContent = ch.body; autoScroll(node); } };
      return (hasAi() ? writeWithModel(prompt, onTok) : stubNarrator(ctx, onTok)).then(function (body) {
        ch.body = (body || ch.body || '').trim(); ch.streaming = false;
        S.busy = false; render(); autoSave();
        learnFromPage(ch.body);   // the brain remembers timeless facts (story bible) - background, post-render
      });
    }).catch(function (e) { ch.streaming = false; S.busy = false; toast('Could not write: ' + (e && e.message || e)); render(); });
  }
  function regenerate(i) {
    if (S.busy) return; var ch = S.pages[i]; if (!ch) return;
    S.busy = true; ch.body = ''; ch.streaming = true; render();
    var node = document.querySelector('.page .body');   // only the current page is shown in the pager
    var recent = treadmill(i - 1), recentText = recent.length ? recent[recent.length - 1].body : '';
    var ctx = { n: ch.n, title: ch.title, beat: ch.beat, motif: motifById(ch.motifId), cast: S.cast, narrator: S.narrator, recent: recent, recentText: recentText, recentBeats: recentBeats(i - 1) };
    var onTok = function (tk) { ch.body += tk; if (node) { node.textContent = ch.body; } };
    (hasAi() ? writeWithModel(buildPrompt(ctx), onTok) : stubNarrator(ctx, onTok)).then(function (body) {
      ch.body = (body || ch.body || '').trim(); ch.streaming = false; S.busy = false; render(); autoSave();
    }).catch(function (e) { ch.streaming = false; S.busy = false; toast('Regen failed: ' + (e && e.message || e)); render(); });
  }
  // CONTINUE-FROM-CURSOR: extend a chapter from the exact caret point (text after the caret is dropped).
  function continueFromCaret(node, before, idx) {
    if (S.busy) return; var ch = S.pages[idx]; if (!ch) return;
    S.busy = true; ch.streaming = true; var add = '';
    var nt = NARRATOR_TYPES.filter(function (x) { return x.id === S.narrator.type; })[0] || NARRATOR_TYPES[0];
    var prompt = [
      'You are the NARRATOR of a ' + typeOf().label + ' book, ' + nt.label + ' in a ' + S.narrator.voice + ' voice.',
      'Continue the prose seamlessly, directly after where it stops. Do NOT repeat or summarize. Match voice and tense. Write 2-4 sentences.',
      '\nTHE TEXT SO FAR (continue immediately after it):\n' + before.slice(-1200)
    ].join('\n');
    var onTok = function (tk) { add += tk; if (node) { node.textContent = before + add; } };
    var stubAdd = ' And then the moment turned, quietly, and ' + ((S.cast[0] || {}).name || 'they') + ' knew it could not be taken back.';
    (hasAi() ? writeWithModel(prompt, onTok) : streamTokens(stubAdd, onTok)).then(function (full) {
      var tail = hasAi() ? (full || add) : add;
      ch.body = (before.replace(/\s+$/, '') + ' ' + String(tail).replace(/^\s+/, '')).trim();
      ch.streaming = false; S.busy = false; render(); autoSave();
    }).catch(function (e) { ch.streaming = false; S.busy = false; toast('Continue failed'); render(); });
  }
  function motifById(id) { var t = typeOf(); return t ? (t.motifs.filter(function (m) { return m.id === id; })[0] || null) : null; }
  function pagesBefore(i) { return S.pages.slice(0, i).map(function (c) { return c.beat; }).join(' Then: '); }

  // ------------------------------------------------- pager: navigate + CRUD pages ----
  function clampIdx() { if (S.pageIdx == null || S.pageIdx >= S.pages.length) S.pageIdx = S.pages.length - 1; if (S.pageIdx < 0) S.pageIdx = 0; }
  function gotoPage(i) { S.pageIdx = Math.max(0, Math.min(i, S.pages.length - 1)); render(); }
  function nextOrGenerate() {                                   // flip to the next page, or write a new one if we're at the end
    if (S.busy) return;
    if (S.pageIdx < S.pages.length - 1) gotoPage(S.pageIdx + 1); else generatePage();
  }
  function deletePage(i) {
    if (!S.pages[i]) return;
    S.pages.splice(i, 1); S.pages.forEach(function (x, k) { x.n = k + 1; });
    if (S.pageIdx >= S.pages.length) S.pageIdx = Math.max(0, S.pages.length - 1);
    autoSave(); render();
  }
  function setChapterMark(i) {
    var p = S.pages[i]; if (!p) return;
    askAsync('Chapter title that begins on this page (blank to remove):', (p.chapterMark && p.chapterMark.title) || '').then(function (title) {
      if (title === null) return;
      if (!title.trim()) { p.chapterMark = null; autoSave(); render(); return; }
      askAsync('Subtitle (optional):', (p.chapterMark && p.chapterMark.subtitle) || '').then(function (sub) {
        p.chapterMark = { title: title.trim(), subtitle: (sub == null ? '' : sub).trim() }; autoSave(); render();
      });
    });
  }
  function setFootnote(i) {
    var p = S.pages[i]; if (!p) return;
    askAsync('Footnote for this page (blank to remove):', p.footnote || '').then(function (f) { if (f === null) return; p.footnote = f.trim(); autoSave(); render(); });
  }
  function researchPrompt() { openKnowledge(); }

  // ------------------------------------------------- voting -> the brain learns ----
  // 👍/👎 on a chapter feeds the council's reward signal (kind 'up'/'down') AND a local
  // preference tally, so future chapters lean toward what you liked (voice + intent).
  function voteChapter(i, dir) {
    var ch = S.pages[i]; if (!ch) return;
    ch.vote = (ch.vote === dir ? null : dir);   // toggle
    if (council && ch.vote) { try { council.feedback(ch.vote, { about: 'chapter', voice: S.narrator.voice, intent: ch.intent || null, beat: ch.beat }); } catch (e) {} }
    if (ch.vote) {
      S.prefs = S.prefs || { voice: {}, intent: {} };
      var d = ch.vote === 'up' ? 1 : -1;
      S.prefs.voice[S.narrator.voice] = (S.prefs.voice[S.narrator.voice] || 0) + d;
      if (ch.intent) S.prefs.intent[ch.intent] = (S.prefs.intent[ch.intent] || 0) + d;
    }
    autoSave(); render();
  }
  function bestVoice() {   // the voice with the highest net upvotes, if any pulls clearly ahead
    if (!S.prefs || !S.prefs.voice) return null;
    var best = null, bv = 0; for (var k in S.prefs.voice) { if (S.prefs.voice[k] > bv) { bv = S.prefs.voice[k]; best = k; } }
    return (best && best !== S.narrator.voice && bv >= 2) ? best : null;
  }

  // ------------------------------------------------- superFetch: brain looks things up ----
  // The brain grounds a chapter in real facts. On Perchance: root.superFetch (CORS proxy). With
  // the Rook extension linked: borrow the anchor's hands (weld.skybridge fetch). Else a direct
  // fetch (may be CORS-blocked) -> graceful. Result is stashed as optional GROUNDING context.
  function fetchVia(url) {
    var sf = grab('superFetch');
    if (typeof sf === 'function') return Promise.resolve(sf(url)).then(function (r) { return r.text(); });
    try { var sb = (window.weld && window.weld.skybridge); if (sb && sb.connected && sb.request) return sb.request('fetch', { url: url }).then(function (r) { return (r && r.ok && (r.body || r.text)) || ''; }); } catch (e) {}
    return fetch(url).then(function (r) { return r.text(); });   // off-platform fallback (CORS permitting)
  }
  function kbJSON(url) { return fetchVia(url).then(function (t) { try { return JSON.parse(t); } catch (e) { return null; } }).catch(function () { return null; }); }
  var WMO = { 0: 'clear', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'rime fog', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow', 80: 'rain showers', 95: 'thunderstorm', 96: 'thunderstorm with hail' };
  // ------------------------------------------------- embedded lore the brain knows ----
  // Things the brain just KNOWS (no network): the classical pantheon and its planet/day links,
  // the night sky for star/sea navigation, the compass & wayfinding, and the great mythic realms.
  // Each entry leads with keywords for relevance matching. Surfaced via the Almanac + auto-by-genre.
  var LOREBANKS = {
    pantheon: [
      'Sun · Sol / Helios, later Apollo — the Sun; day SUNDAY; gold, kingship, truth, the all-seeing eye.',
      'Moon · Luna / Selene, also Diana/Artemis — the Moon; day MONDAY; silver, tides, the hunt, madness, the feminine.',
      'Mercury · Mercury / Hermes — the planet Mercury; day WEDNESDAY (Woden); messengers, thieves, travel, trade, trickery, the crossing into death.',
      'Venus · Venus / Aphrodite — the planet Venus, the morning & evening star; day FRIDAY (Frigg/Freya); love, beauty, desire.',
      'Mars · Mars / Ares — the red planet; day TUESDAY (Tiw/Týr); war, courage, iron, blood. Its moons Phobos (fear) and Deimos (dread) are his sons.',
      'Jupiter · Jupiter / Zeus — the greatest planet; day THURSDAY (Thor); the sky-father, thunder, law, kingship. Its great moons: Io, Europa, Ganymede, Callisto.',
      'Saturn · Saturn / Cronus — the ringed planet; day SATURDAY; time, harvest, age, limitation, the lost Golden Age.',
      'Neptune · Neptune / Poseidon — god of the sea, earthquakes and horses; the trident; storms and safe passage.',
      'Pluto · Pluto / Hades — lord of the underworld and its riches; unseen; brother of Zeus and Poseidon.',
      'Minerva · Minerva / Athena — wisdom, strategy, craft; the owl, the olive; born from Jupiter’s head.',
      'Vulcan · Vulcan / Hephaestus — the forge, fire, smithing; lame; maker of the gods’ wonders.',
      'Ceres · Ceres / Demeter — grain and the harvest; her grief makes winter while Persephone is below.',
      'Bacchus · Bacchus / Dionysus — wine, ecstasy, theatre, madness and release.',
      'Juno · Juno / Hera — queen of the gods, marriage and the hearth-kingdom; the peacock.'
    ],
    celestial: [
      'Polaris · Polaris, the North Star — sits almost exactly over true North and barely moves; the whole sky wheels around it. Find it off the Plough’s two Pointer stars.',
      'Ursa Major · the Great Bear / the Plough / Big Dipper — its two end stars (the Pointers) line up straight on Polaris. Never sets in the far north.',
      'Orion · Orion the Hunter — three stars for his belt; a winter constellation; Sirius the Dog Star follows at his heel, the brightest star in the sky.',
      'zodiac · the twelve houses the Sun passes through over a year: Aries, Taurus, Gemini, Cancer, Leo, Virgo, Libra, Scorpio, Sagittarius, Capricorn, Aquarius, Pisces.',
      'Moon phases · new → waxing crescent → first quarter → waxing gibbous → full → waning gibbous → last quarter → waning crescent, about 29.5 days; tides follow it.',
      'planets · the naked-eye wandering stars: Mercury (low at dusk/dawn), Venus (brightest, the morning/evening star), Mars (red), Jupiter, Saturn.',
      'Southern Cross · Crux — in the southern hemisphere there is no bright south star; the long arm of the Southern Cross points toward the south celestial pole.',
      'Milky Way · the pale river of stars across the sky — the galaxy seen edge-on; darkest skies show it best.',
      'Sirius · the Dog Star, brightest in the night sky; its dawn rising once marked the Nile’s flood (the "dog days").',
      'comet · a "hairy star" with a tail that always points away from the sun; long held an omen of upheaval or a king’s death.',
      'eclipse · the Moon between Sun and Earth (solar) or Earth’s shadow on the Moon (lunar, blood-red); dreaded as portents.'
    ],
    navigation: [
      'compass rose · N, NE, E, SE, S, SW, W, NW. A BEARING is degrees clockwise from North: 0°=N, 90°=E, 180°=S, 270°=W. A HEADING is the way you face/travel.',
      'find North by day · at local noon the Sun is due south (northern hemisphere); a stick’s shadow then points true North. The Sun rises roughly east, sets roughly west.',
      'find North by night · find Polaris off the Plough’s Pointers — that is true North. In the south, use the Southern Cross.',
      'dead reckoning · from a known point, track heading + speed + time to estimate where you are — the sailor’s method before satellites; error grows with distance.',
      'sea chart · marks depths (soundings in fathoms), shoals and reefs, currents, lighthouses, and compass bearings between landmarks.',
      'latitude & longitude · latitude (north–south) came from the noon Sun’s height or Polaris’s angle by sextant; longitude (east–west) needed an accurate clock.',
      'points of sail · a ship cannot sail straight into the wind; it beats close-hauled and tacks in a zig-zag, or runs free with the wind behind.',
      'tides · the sea rises and falls about twice a day with the Moon; spring tides (high) at new/full Moon, neap tides (low) at the quarters.',
      'log & knots · speed was the "log" — a weighted board on a knotted line paid out for a timed count; hence speed in KNOTS (nautical miles per hour).',
      'lee & windward · windward is toward the wind, leeward away from it; a "lee shore" downwind is a danger — the wind drives you onto it.'
    ],
    places: [
      'Olympus · Mount Olympus — the cloud-wreathed peak that is home of the Greek gods.',
      'Asgard · the Norse realm of the Æsir, joined to mortal Midgard by Bifröst, the rainbow bridge.',
      'Valhalla · Odin’s hall in Asgard where the worthy slain (the einherjar) feast and fight, awaiting Ragnarök.',
      'Niflheim · Hel and Niflheim — the cold Norse underworld of those who die of age or sickness.',
      'Elysium · the Elysian Fields — the blessed afterlife reserved for heroes in Greek myth.',
      'Tartarus · the deep abyss beneath Hades, prison of the defeated Titans.',
      'Underworld · the realm of Hades — reached across the river Styx by Charon’s ferry, its gate guarded by three-headed Cerberus.',
      'Avalon · the misty isle where Excalibur was forged and the wounded King Arthur was borne away to heal.',
      'Camelot · King Arthur’s court and the seat of the Round Table.',
      'Atlantis · Plato’s great island power that sank beneath the sea in a single day and night.',
      'El Dorado · the lost city of gold sought by explorers across the New World.',
      'Shangri-La · a hidden Himalayan valley of perpetual peace and long life.',
      'Tír na nÓg · the Irish Otherworld, the Land of the Young, beyond the western sea where no one ages.',
      'Faerie · the perilous Otherworld of the fae — time runs strange there, and one must never eat its food.',
      'Hyperborea · a sunlit paradise beyond the north wind.',
      'Yggdrasil · the World-Tree whose roots and branches bind the Nine Realms of Norse myth.'
    ]
  };
  function lorebank(name, query, n) {
    var bank = LOREBANKS[name] || []; n = n || 5;
    var q = String(query || '').toLowerCase().split(/\W+/).filter(function (w) { return w.length > 2; });
    if (!q.length) return name.charAt(0).toUpperCase() + name.slice(1) + ' — ' + bank.slice(0, n).join('  ·  ');
    var scored = bank.map(function (e) { var el2 = e.toLowerCase(), s = 0; q.forEach(function (t) { if (el2.indexOf(t) >= 0) s++; }); return { e: e, s: s }; }).sort(function (a, b) { return b.s - a.s; });
    var top = scored.filter(function (x) { return x.s > 0; }).slice(0, n); if (!top.length) top = scored.slice(0, 2);
    return name.charAt(0).toUpperCase() + name.slice(1) + ' — ' + top.map(function (x) { return x.e; }).join('  ·  ');
  }

  // ------------------------------------------------- the brain's real-world knowledge base ----
  // Ported from RookAi's web-tool layer (so the brain knows REAL things, grounding the fiction in
  // fact) + new sources + embedded lore banks. Each tool -> Promise<string|null>. The fetch ones ride
  // fetchVia (superFetch on Perchance / the Rook anchor / direct off-platform); the lore is local.
  var KB = {
    wiki: function (t) { return kbJSON('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(String(t).trim().replace(/\s+/g, '_'))).then(function (j) { return (j && j.extract && j.type !== 'disambiguation') ? ('Wikipedia — ' + (j.title || t) + ': ' + j.extract) : null; }); },
    search: function (q) { return kbJSON('https://api.duckduckgo.com/?format=json&no_html=1&skip_disambig=1&q=' + encodeURIComponent(q)).then(function (j) { if (!j) return null; if (j.AbstractText) return 'Web — ' + (j.Heading || q) + ': ' + j.AbstractText; var rel = (j.RelatedTopics || []).map(function (x) { return x && x.Text; }).filter(Boolean).slice(0, 3); return rel.length ? ('Web — ' + q + ': ' + rel.join(' · ')) : null; }); },
    define: function (w) { return kbJSON('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(String(w).toLowerCase().replace(/[^a-z'-]/g, ''))).then(function (j) { if (!Array.isArray(j) || !j[0]) return null; var e = j[0], defs = []; (e.meanings || []).slice(0, 2).forEach(function (m) { var d = m.definitions && m.definitions[0]; if (d && d.definition) defs.push((m.partOfSpeech ? '(' + m.partOfSpeech + ') ' : '') + d.definition); }); return defs.length ? ('Define — ' + (e.word || w) + (e.phonetic ? ' ' + e.phonetic : '') + ': ' + defs.join(' · ')) : null; }); },
    words: function (w, mode) { var p = mode === 'sounds' ? 'sl' : mode === 'rhyme' ? 'rel_rhy' : mode === 'assoc' ? 'rel_trg' : 'ml'; return kbJSON('https://api.datamuse.com/words?max=14&' + p + '=' + encodeURIComponent(w)).then(function (j) { if (!Array.isArray(j) || !j.length) return null; var lbl = mode === 'sounds' ? 'sound like' : mode === 'rhyme' ? 'rhyme with' : mode === 'assoc' ? 'associate with' : 'mean like'; return 'Words that ' + lbl + ' “' + w + '”: ' + j.map(function (x) { return x.word; }).slice(0, 12).join(', '); }); },
    country: function (n) { return kbJSON('https://restcountries.com/v3.1/name/' + encodeURIComponent(n) + '?fields=name,capital,currencies,languages,region,subregion,population,demonyms').then(function (j) { var c = Array.isArray(j) && j[0]; if (!c) return null; var langs = c.languages ? Object.keys(c.languages).map(function (k) { return c.languages[k]; }).join(', ') : ''; var curr = c.currencies ? Object.keys(c.currencies).map(function (k) { return c.currencies[k].name; }).join(', ') : ''; return 'Country — ' + ((c.name && c.name.common) || n) + ': ' + (c.subregion || c.region || '') + (c.capital ? ', capital ' + c.capital[0] : '') + (langs ? ', language ' + langs : '') + (curr ? ', currency ' + curr : '') + '.'; }); },
    onthisday: function (arg) { var d = new Date(), mm = String(d.getMonth() + 1), dd = String(d.getDate()); var m = /(\d{1,2})\D(\d{1,2})/.exec(String(arg || '')); if (m) { mm = m[1]; dd = m[2]; } return kbJSON('https://byabbe.se/on-this-day/' + mm + '/' + dd + '/events.json').then(function (j) { var ev = j && j.events; if (!ev || !ev.length) return null; var pick = ev.slice().sort(function () { return Math.random() - 0.5; }).slice(0, 3).map(function (e) { return e.year + ': ' + e.description; }); return 'On this day (' + mm + '/' + dd + ') in history: ' + pick.join(' · '); }); },
    quote: function (topic) { var u = topic ? 'https://api.quotable.io/search/quotes?limit=3&query=' + encodeURIComponent(topic) : 'https://api.quotable.io/quotes/random?limit=1'; return kbJSON(u).then(function (j) { var arr = (j && j.results) || j; if (!Array.isArray(arr) || !arr.length) return null; var q = arr[0]; return 'Quote — “' + q.content + '” — ' + q.author; }); },
    translate: function (arg) { var parts = String(arg).split('|'), text = (parts[0] || '').trim(), target = (parts[1] || 'en').trim(); if (!text) return Promise.resolve(null); return kbJSON('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' + encodeURIComponent(target) + '&dt=t&q=' + encodeURIComponent(text)).then(function (d) { if (!Array.isArray(d) || !Array.isArray(d[0])) return null; var out = ''; for (var i = 0; i < d[0].length; i++) { if (d[0][i] && d[0][i][0] != null) out += d[0][i][0]; } var src = d[2] || 'auto'; return out ? ('Translation (' + src + ' → ' + target + ') — “' + text + '” = “' + out + '”') : null; }); },
    weather: function (place) { return kbJSON('https://geocoding-api.open-meteo.com/v1/search?count=1&name=' + encodeURIComponent(place)).then(function (g) { var r = g && g.results && g.results[0]; if (!r) return null; return kbJSON('https://api.open-meteo.com/v1/forecast?current=temperature_2m,weather_code,wind_speed_10m&latitude=' + r.latitude + '&longitude=' + r.longitude).then(function (f) { var c = f && f.current; if (!c) return null; return 'Weather — ' + r.name + (r.country ? ', ' + r.country : '') + ': ' + Math.round(c.temperature_2m) + '°C, ' + (WMO[c.weather_code] || '') + ', wind ' + Math.round(c.wind_speed_10m) + ' km/h.'; }); }); },
    calc: function (expr) { try { var cf = window.RookBrain && window.RookBrain.calcOf; if (cf) { var f = cf(expr); if (f && f.value != null) return Promise.resolve('Calc — ' + (f.note || (f.formula + ' = ' + f.value))); } } catch (e) {} return Promise.resolve(null); },
    // ---- embedded lore the brain KNOWS (no fetch): query a bank by keyword, get the matching facts ----
    pantheon: function (q) { return Promise.resolve(lorebank('pantheon', q, 5)); },
    celestial: function (q) { return Promise.resolve(lorebank('celestial', q, 5)); },
    places: function (q) { return Promise.resolve(lorebank('places', q, 5)); },
    navigation: function (q) { return Promise.resolve(lorebank('navigation', q, 5)); }
  };
  // KB tool catalog for the Almanac UI (id, emoji label, hint, whether it needs a CORS proxy off-platform).
  var KB_TOOLS = [
    { id: 'wiki', label: '📖 Wikipedia', hint: 'a place, person, era, craft, creature…' },
    { id: 'search', label: '🌐 Web', hint: 'a broader question (needs Perchance/anchor off-platform)', proxy: true },
    { id: 'define', label: '📕 Define', hint: 'a word — archaic, technical, exact meaning' },
    { id: 'words', label: '🔤 Word-tools', hint: 'words that mean / sound like / rhyme with…' },
    { id: 'country', label: '🌍 Country', hint: 'capital, languages, currency, region', proxy: true },
    { id: 'onthisday', label: '🗓 On this day', hint: 'real history (blank = today, or MM/DD)' },
    { id: 'quote', label: '❝ Quote', hint: 'a real quote (topic optional) — for epigraphs', proxy: true },
    { id: 'translate', label: '🌎 Translate', hint: 'text | lang  (e.g.  good evening | fr)', proxy: true },
    { id: 'weather', label: '⛅ Weather', hint: 'real current weather of a place' },
    { id: 'calc', label: '🧮 Calc', hint: 'guarded math: 12.5% of 80, 5km in mi' },
    { id: 'pantheon', label: '🏛 Gods', hint: 'Greek/Roman gods + their planet & weekday (blank = all)', local: true },
    { id: 'celestial', label: '✦ Sky', hint: 'stars, planets, moons, constellations, the zodiac', local: true },
    { id: 'navigation', label: '🧭 Navigation', hint: 'compass, bearings, finding North, sea-charts', local: true },
    { id: 'places', label: '🗺 Mythic places', hint: 'Olympus, Asgard, Avalon, Atlantis, Faerie…', local: true }
  ];
  function addGround(text) {
    if (!text) return; S.grounds = S.grounds || [];
    var k = text.toLowerCase().slice(0, 50); if (S.grounds.some(function (g) { return g.toLowerCase().slice(0, 50) === k; })) { toast('Already in grounding'); return; }
    S.grounds.push(text.length > 500 ? text.slice(0, 500) + '…' : text); if (S.grounds.length > 12) S.grounds = S.grounds.slice(-12);
    autoSave(); toast('📎 Added to grounding'); render();
  }
  function relevantGrounds(query) {
    if (!S.grounds || !S.grounds.length) return '';
    var q = String(query || '').toLowerCase().split(/\W+/).filter(function (w) { return w.length > 3; });
    var scored = S.grounds.map(function (g) { var gl = g.toLowerCase(), n = 0; q.forEach(function (t) { if (gl.indexOf(t) >= 0) n++; }); return { g: g, n: n }; }).sort(function (a, b) { return b.n - a.n; });
    var top = scored.filter(function (x) { return x.n > 0; }).slice(0, 3); if (!top.length) top = scored.slice(0, 2);
    return top.map(function (x) { return '- ' + x.g; }).join('\n');
  }
  // auto-load the embedded lore the brain should KNOW for this kind of story (genre + theme).
  function autoKnowWorld() {
    var t = typeOf(), g = (S.typeId || '') + ' ' + ((t && t.label) || '') + ' ' + (S.theme || '') + ' ' + (S.tone || '');
    var banks = [];
    if (/fantasy|fairy|myth|legend|epic|gods?/i.test(g)) banks.push('pantheon', 'places');
    if (/sea|pirate|ocean|naval|sail|maritime|voyage|island|harbor|ship/i.test(g)) banks.push('navigation', 'celestial');
    if (/space|sci-?fi|star|cosmic|astro|void|planet|moon/i.test(g)) banks.push('celestial');
    if (/noir|myster|histor|ancient|rome|greek|medieval|frontier|west/i.test(g)) banks.push('navigation');
    if (!banks.length) banks.push('places', 'celestial');
    banks = banks.filter(function (b, i) { return banks.indexOf(b) === i; });
    banks.forEach(function (b) { addGround(lorebank(b, S.theme || '', 5)); });
    toast('Brain now knows: ' + banks.join(', '));
  }
  function openKnowledge() {
    var tool = 'wiki';
    var box = el('div', { class: 'bm-modal-box', style: 'max-width:min(94vw,560px)' });
    box.appendChild(el('div', { class: 'bm-modal-msg', text: '📚 Almanac — the brain looks up REAL facts to ground the fiction. Pick a source, look it up, then 📎 add it to the story’s grounding.' }));
    var chips = el('div', { class: 'row' });
    var hintEl = el('div', { class: 'muted', style: 'margin-top:4px;font-size:12px' });
    var inp = el('input', { class: 'bm-modal-input' });
    KB_TOOLS.forEach(function (t) { chips.appendChild(el('button', { class: 'chip' + (tool === t.id ? ' on' : ''), style: 'cursor:pointer', onclick: function () { tool = t.id; [].slice.call(chips.children).forEach(function (c) { c.classList.remove('on'); }); this.classList.add('on'); hintEl.textContent = t.hint; inp.setAttribute('placeholder', t.hint); } }, [t.label])); });
    box.appendChild(chips); box.appendChild(hintEl);
    inp.setAttribute('placeholder', KB_TOOLS[0].hint); box.appendChild(inp);
    var res = el('div', { class: 'foresee-res' }); box.appendChild(res);
    var rowEl = el('div', { class: 'bm-modal-row' });
    rowEl.appendChild(el('button', { class: 'btn ghost sm', style: 'margin-right:auto', title: 'Auto-load the lore the brain should know for this genre/theme', onclick: function () { autoKnowWorld(); done(); } }, ['🌐 Know this world']));
    var addBtn = el('button', { class: 'btn ghost sm', style: 'display:none', onclick: function () { if (res._fact) addGround(res._fact); } }, ['📎 Add to grounding']);
    rowEl.appendChild(addBtn);
    rowEl.appendChild(el('button', { class: 'btn ghost sm', onclick: function () { done(); } }, ['Close']));
    rowEl.appendChild(el('button', { class: 'btn sm', onclick: run }, ['Look up']));
    box.appendChild(rowEl);
    var ov = el('div', { class: 'bm-modal' }, [box]); document.body.appendChild(ov);
    setTimeout(function () { try { inp.focus(); } catch (e) {} }, 20);
    function done() { document.removeEventListener('keydown', onKey); ov.remove(); }
    function onKey(e) { if (e.key === 'Escape') done(); else if (e.key === 'Enter' && document.activeElement === inp) run(); }
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) done(); });
    document.addEventListener('keydown', onKey);
    function run() {
      var a = inp.value.trim(), t = KB_TOOLS.filter(function (x) { return x.id === tool; })[0];
      if (!a && !t.local && tool !== 'onthisday' && tool !== 'quote') return;
      res.innerHTML = ''; res._fact = null; addBtn.style.display = 'none';
      res.appendChild(el('div', { class: 'muted', text: '…looking up' }));
      var fn;
      if (tool === 'words') { var pp = a.split('|'); var mode = (pp[1] || 'means').trim().toLowerCase(); mode = /sound/.test(mode) ? 'sounds' : /rhym/.test(mode) ? 'rhyme' : /assoc|relat|trig/.test(mode) ? 'assoc' : 'means'; fn = KB.words((pp[0] || '').trim(), mode); }
      else fn = KB[tool](a);
      Promise.resolve(fn).then(function (fact) {
        res.innerHTML = '';
        if (!fact) { res.appendChild(el('div', { class: 'foresee-li risk', text: '⚠ Nothing found' + (t.proxy ? ' — this source needs Perchance superFetch or the Rook extension when off-platform.' : '.') })); return; }
        res._fact = fact; res.appendChild(el('div', { class: 'foresee-li ok', text: fact })); addBtn.style.display = 'inline-block';
      }).catch(function () { res.innerHTML = ''; res.appendChild(el('div', { class: 'foresee-li risk', text: '⚠ Lookup failed.' })); });
    }
  }

  // ------------------------------------------------- skybridge / Rook anchor ----
  function skybridge() { try { return window.weld && window.weld.skybridge; } catch (e) { return null; } }
  function anchorLinked() { var sb = skybridge(); return !!(sb && sb.connected); }

  // ------------------------------------------------------ character import ----
  function importPasted(text) {
    text = String(text || '').trim(); if (!text) return;
    var added = 0;
    // try AICC / character-card JSON first
    try {
      var j = JSON.parse(text);
      var cards = Array.isArray(j) ? j : (j.characters || j.cast || [j]);
      cards.forEach(function (c) {
        var nm = c.name || c.char_name || c.title; if (!nm) return;
        var persona = c.persona || c.description || c.personality || c.scenario || '';
        addCast(nm, String(persona).slice(0, 240)); added++;
      });
    } catch (e) {
      // plain text: "Name: description" per line, or just names
      text.split(/\r?\n/).forEach(function (line) {
        line = line.trim(); if (!line) return;
        var m = line.match(/^([^:\-—]{1,40})\s*[:\-—]\s*(.+)$/);
        if (m) { addCast(m[1].trim(), m[2].trim()); added++; }
        else if (line.length < 40) { addCast(line, ''); added++; }
      });
    }
    toast(added ? 'Added ' + added + ' character' + (added > 1 ? 's' : '') : 'Nothing recognized to import');
    render();
  }
  function addCast(name, persona) {
    if (S.cast.some(function (c) { return c.name.toLowerCase() === name.toLowerCase(); })) return;
    var role = S.cast.length === 0 ? 'protagonist' : (S.cast.length === 1 ? 'antagonist' : 'sidekick');
    S.cast.push({ name: name, persona: persona || '', role: role, fate: FATES[role][0].id, romantic: false });
  }

  // ------------------------------------------------------ export / files ----
  function bookTitle() { var t = typeOf(); return S.title || (S.pages[0] && S.pages[0].title) || (t ? t.label : 'Untitled'); }
  function slug(s) { return (String(s || 'book').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()) || 'book'; }
  function downloadFile(name, content, mime) {
    try { var a = el('a', { href: URL.createObjectURL(new Blob([content], { type: mime || 'text/plain' })), download: name }); document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); }, 0); }
    catch (e) { toast('Download failed'); }
  }
  function castLines(b) { return (b.cast || []).map(function (c) { return c.name + ' (' + c.role + (c.romantic ? ', romantic interest' : '') + ')'; }); }
  // The story memories appendix — lore + facts so the book can be continued later (human-readable;
  // .book.json carries the full machine-readable state). `withMem` gated by the "Attach memories?" ask.
  function bookLore(b) { var L = b.lore || { people: [], places: [], world: (b.bible || []), threads: [] }; return L; }
  function bookLoreFlat(b) { var L = bookLore(b); return [].concat(L.people || [], L.places || [], L.world || [], L.threads || []); }
  function memoriesBlock(b, md) {
    var L = bookLore(b), groups = [['People', L.people], ['Places', L.places], ['World-lore', L.world], ['Open threads / clues', L.threads]];
    if (!bookLoreFlat(b).length && !(b.cast || []).length) return '';
    if (md) {
      var s = '\n\n---\n\n## Story memories (lore & facts)\n_Attach this when continuing the book later._\n\n';
      if ((b.cast || []).length) s += '**Cast:** ' + castLines(b).join(', ') + '\n\n';
      if (b.theme) s += '**Setting:** ' + b.theme + '\n\n';
      if (b.plan && b.plan.end) s += '**Destination (author-only):** ' + b.plan.end + '\n\n';
      groups.forEach(function (g) { if ((g[1] || []).length) { s += '**' + g[0] + ':**\n'; g[1].forEach(function (f) { s += '- ' + f + '\n'; }); s += '\n'; } });
      return s;
    }
    var t = '\n\n' + '='.repeat(40) + '\nSTORY MEMORIES (lore & facts — attach when continuing later)\n' + '='.repeat(40) + '\n\n';
    if ((b.cast || []).length) t += 'Cast: ' + castLines(b).join(', ') + '\n';
    if (b.theme) t += 'Setting: ' + b.theme + '\n';
    if (b.plan && b.plan.end) t += 'Destination (author-only): ' + b.plan.end + '\n';
    groups.forEach(function (g) { if ((g[1] || []).length) { t += '\n' + g[0] + ':\n' + g[1].map(function (f) { return '  • ' + f; }).join('\n') + '\n'; } });
    return t;
  }
  // Render a book SNAPSHOT (any book, not just the current one) to plain text or markdown.
  function bookToText(b, fmt, withMem) {
    var title = b.title || 'Untitled';
    if (fmt === 'md') {
      var m = '# ' + title + '\n\n';
      if ((b.cast || []).length) m += '*Cast: ' + castLines(b).join(', ') + '*\n\n';
      (b.pages || []).forEach(function (p) {
        if (p.chapterMark) m += '\n## ' + (p.chapterMark.title || '') + '\n' + (p.chapterMark.subtitle ? '*' + p.chapterMark.subtitle + '*\n' : '') + '\n';
        m += (p.body || '') + '\n\n';
        if (p.footnote) m += '> ' + p.footnote + '\n\n';
      });
      if (withMem) m += memoriesBlock(b, true);
      return m;
    }
    var out = title + '\n' + '='.repeat(title.length) + '\n\n';
    if ((b.cast || []).length) out += 'Cast:\n' + castLines(b).map(function (x) { return '  ' + x; }).join('\n') + '\n\n\n';
    (b.pages || []).forEach(function (p) {
      if (p.chapterMark) out += '\n\n' + (p.chapterMark.title || '').toUpperCase() + (p.chapterMark.subtitle ? '\n' + p.chapterMark.subtitle : '') + '\n' + '—'.repeat(8) + '\n\n';
      out += '[ Page ' + p.n + (p.title ? ' — ' + p.title : '') + ' ]\n\n' + (p.body || '') + '\n';
      if (p.footnote) out += '\n  ⸻ ' + p.footnote + '\n';
      out += '\n\n';
    });
    if (withMem) out += memoriesBlock(b, false);
    return out;
  }
  function exportBookFile(b, fmt, withMem) {
    if (fmt === 'json') { downloadFile(slug(b.title) + '.book.json', JSON.stringify(b, null, 2), 'application/json'); }   // re-importable: carries the full state incl. memories
    else downloadFile(slug(b.title) + (fmt === 'md' ? '.md' : '.txt'), bookToText(b, fmt, withMem), fmt === 'md' ? 'text/markdown' : 'text/plain');
    toast('Exported .' + (fmt || 'txt'));
  }
  // Prose exports (txt/md) ask whether to attach the story memories; .json always carries them.
  function exportBookAsk(b, fmt) {
    if (fmt === 'json') { exportBookFile(b, 'json'); return; }
    var hasMem = bookLoreFlat(b).length || (b.cast || []).length;
    if (!hasMem) { exportBookFile(b, fmt, false); return; }
    confirmAsync('Attach memories? Lore and important facts about this story so you may continue editing it later.', { okText: 'Attach', cancelText: 'No, just the prose' }).then(function (ok) { exportBookFile(b, fmt, !!ok); });
  }
  function exportBook(fmt) { if (!S.pages.length) { toast('Write a page first'); return; } exportBookAsk(snapshot(), fmt || 'txt'); }
  // Import a previously-exported .book.json (single book or an array of them) into the library.
  function importBookFile() {
    var inp = document.getElementById('bm-import');
    if (!inp) { inp = el('input', { id: 'bm-import', type: 'file', accept: '.json,application/json', style: 'display:none' }); document.body.appendChild(inp); }
    inp.value = '';
    inp.onchange = function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var parsed = JSON.parse(r.result), arr = Array.isArray(parsed) ? parsed : [parsed], added = 0;
          arr.forEach(function (bk) { if (bk && (bk.pages || bk.cast)) { bk.id = 'bk_' + Date.now() + '_' + (added++); bk.date = new Date().toISOString(); STORE.set(bk.id, bk); } });
          toast(added ? 'Imported ' + added + ' book' + (added === 1 ? '' : 's') : 'No books in that file'); setTimeout(render, 80);
        } catch (e) { toast('Not a valid book file'); }
      };
      r.readAsText(f);
    };
    inp.click();
  }
  function duplicateBook(b) { var c = JSON.parse(JSON.stringify(b)); c.id = 'bk_' + Date.now(); c.name = (b.title || 'Book') + ' (copy)'; c.title = c.name; c.date = new Date().toISOString(); STORE.set(c.id, c).then(function () { render(); }); }
  function renameBook(b) { askAsync('Rename book:', b.title || '').then(function (nm) { if (nm == null) return; b.name = nm.trim(); b.title = b.name || b.title; STORE.set(b.id, b).then(function () { render(); }); }); }

  // ------------------------------------------------- saved library (kv) ----
  // Perchance gives us kv-plugin (kv.books namespace). Off-platform: a localStorage shim,
  // same interface — so My Books works everywhere and a finished book survives a reload.
  function kvNs() { try { var k = grab('kv'); if (k && k.books) return k.books; } catch (e) {} return null; }
  var LS = 'bookmaker:books';
  function lsAll() { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { return {}; } }
  function lsPut(o) { try { localStorage.setItem(LS, JSON.stringify(o)); } catch (e) {} }
  var STORE = {
    set: function (id, v) { var ns = kvNs(); if (ns) return Promise.resolve(ns.set(id, v)); var o = lsAll(); o[id] = v; lsPut(o); return Promise.resolve(); },
    delete: function (id) { var ns = kvNs(); if (ns) return Promise.resolve(ns.delete(id)); var o = lsAll(); delete o[id]; lsPut(o); return Promise.resolve(); },
    values: function () { var ns = kvNs(); if (ns) return Promise.resolve(ns.values()); var o = lsAll(); return Promise.resolve(Object.keys(o).map(function (k) { return o[k]; })); }
  };
  function snapshot() {
    return { id: S.bookId, title: bookTitle(), name: S.title, typeId: S.typeId, customGenre: S.customGenre, themeId: S.themeId, theme: S.theme, toneId: S.toneId, tone: S.tone, cast: S.cast, narrator: S.narrator, pages: S.pages, summary: S.summary, usedMotifs: S.usedMotifs, prefs: S.prefs, grounds: S.grounds, compass: S.compass, calendar: S.calendar, stance: S.stance, weights: S.weights, noise: S.noise, lore: S.lore, plan: S.plan, resolving: S.resolving, date: new Date().toISOString() };
  }
  function rememberLast() { try { if (S.bookId) localStorage.setItem('bookmaker:last', S.bookId); } catch (e) {} }
  function autoSave() { if (!S.pages.length) return; if (!S.bookId) S.bookId = 'bk_' + Date.now(); rememberLast(); try { STORE.set(S.bookId, snapshot()); } catch (e) {} }
  function saveBook() { if (!S.pages.length) { toast('Write a page first'); return; } if (!S.bookId) S.bookId = 'bk_' + Date.now(); rememberLast(); STORE.set(S.bookId, snapshot()).then(function () { toast('Saved to My Books'); }); }
  function openBook(b) { S.bookId = b.id; S.title = b.name || ''; S.typeId = b.typeId; S.customGenre = b.customGenre || ''; S.themeId = b.themeId || 'none'; S.theme = b.theme || ''; S.toneId = b.toneId || 'surprise'; S.tone = b.tone || ''; S.cast = b.cast || []; S.narrator = b.narrator || null; S.pages = b.pages || []; S.pageIdx = Math.max(0, (b.pages || []).length - 1); S.summary = b.summary || ''; S.usedMotifs = b.usedMotifs || []; S.prefs = b.prefs || null; S.grounds = b.grounds || (b.research ? [b.research] : []); S.compass = b.compass || { place: '', heading: '' }; S.calendar = b.calendar || { label: '', day: 0 }; S.stance = b.stance || 'balanced'; S.weights = b.weights || {}; S.noise = b.noise || 0; S.lore = b.lore || { people: [], places: [], world: (b.bible || []), threads: [] }; loreInit(); S.plan = b.plan || { end: '', target: 0 }; S.resolving = !!b.resolving; rebuildCouncil(); rememberLast(); S.view = 'wizard'; S.step = 3; render(); }
  function deleteBook(id) { STORE.delete(id).then(function () { if (S.bookId === id) S.bookId = null; render(); }); }
  function newBook() { S.bookId = null; S.title = ''; S.typeId = null; S.customGenre = ''; S.themeId = 'none'; S.theme = ''; S.toneId = 'surprise'; S.tone = ''; S.cast = []; S.narrator = null; S.pages = []; S.pageIdx = 0; S.summary = ''; S.usedMotifs = []; S.prefs = null; S.grounds = []; S.compass = { place: '', heading: '' }; S.calendar = { label: '', day: 0 }; S.stance = 'balanced'; S.weights = {}; S.noise = 0; S.lore = { people: [], places: [], world: [], threads: [] }; S.plan = { end: '', target: 0 }; S.resolving = false; rebuildCouncil(); S.view = 'wizard'; S.step = 0; render(); }

  // ------------------------------------------------- AI-assist: invent a character ----
  var INVENT_POOL = [
    { name: 'Sable', persona: 'A cartographer who maps places that do not exist yet, and is never wrong for long. Calm, curious, faintly smug about being early to everything.' },
    { name: 'Brother Quill', persona: 'A defrocked monk with a gambler’s memory and a confessor’s patience. Quotes scripture and card odds in the same breath, and means both.' },
    { name: 'Nine', persona: 'A child who answers only to a number and forgets nothing, ever. Unnervingly polite; remembers what you said three scenes ago and holds you to it.' },
    { name: 'Dr. Mara Voss', persona: 'A xenobiologist who trusts data over people, to her cost. Dry, brilliant, secretly desperate to be proven wrong about the universe being cold.' },
    { name: 'The Tallow Widow', persona: 'She sells candles and knows whose were lit last. Speaks softly, charges dearly, and always collects, sooner or later.' },
    { name: 'Castor Finch', persona: 'A charming liar one favour deep in the wrong debt. Could sell you your own coat and have you thank him; running low on people left to charm.' },
    { name: 'Juniper', persona: 'A hedge-witch who fixes small things and breaks large ones, usually by accident. Cheerful about catastrophe and means terribly well.' },
    { name: 'Grit', persona: 'An old watchdog of a man who has buried better friends and expects to bury more. Few words, all of them load-bearing.' }
  ];
  function inventCharacter() {
    var t = typeOf();
    if (hasAi()) {
      S.busy = true; render();
      var prompt = 'Invent one original, vivid character for a ' + (t ? t.label : 'story') + '. Return ONLY compact JSON: {"name":"...","persona":"one vivid sentence"}';
      writeWithModel(prompt).then(function (txt) {
        try { var m = String(txt).match(/\{[\s\S]*\}/); var o = JSON.parse(m[0]); if (o && o.name) addCast(o.name, o.persona || ''); else toast('No valid card'); }
        catch (e) { toast('AI returned no valid card'); }
        S.busy = false; render();
      }).catch(function () { S.busy = false; toast('Invent failed'); render(); });
    } else {
      var pool = INVENT_POOL.filter(function (p) { return !S.cast.some(function (c) { return c.name === p.name; }); });
      var pick = (pool.length ? pool : INVENT_POOL)[Math.floor(Math.random() * (pool.length || INVENT_POOL.length))];
      addCast(pick.name, pick.persona); render();
    }
  }

  // ------------------------------------------------------ render ----
  function go(step) { S.step = step; render(); }
  function canAdvance() { return [!!S.typeId, S.cast.length > 0, !!S.narrator][S.step]; }

  function render() {
    var app = $('#app'); app.innerHTML = '';
    app.appendChild(el('header', { class: 'sf' }, [
      el('span', { class: 'logo', text: '📖' }),
      el('h1', { text: 'Book-maker' }),
      el('span', { class: 'tag', text: (hasBrain() ? 'brain-steered' : 'preview') + (hasAi() ? ' · Perchance' : '') + (anchorLinked() ? ' · ⚓ Rook' : '') }),
      el('span', { class: 'sp', style: 'margin-left:auto' }),
      el('button', { class: 'btn ghost sm', onclick: function () { S.view = (S.view === 'library' ? 'wizard' : 'library'); render(); } }, [S.view === 'library' ? '← Back' : '📚 My Books'])
    ]));
    if (S.view === 'library') { renderLibrary(); hideCont(); return; }
    var steps = el('div', { class: 'steps' });
    STEPS.forEach(function (label, i) {
      steps.appendChild(el('div', { class: 'st' + (i === S.step ? ' on' : (i < S.step ? ' done' : '')), onclick: function () { if (S.pages.length || i <= S.step || (i === S.step + 1 && canAdvance())) go(i); } }, [String(i + 1) + '. ' + label]));
    });
    app.appendChild(steps);
    [renderType, renderCast, renderNarrator, renderWrite][S.step]();
    if (S.step !== 3) hideCont();
  }

  function renderLibrary() {
    var a = $('#app');
    a.appendChild(el('h2', { class: 'sec', text: '📚 My Books' }));
    a.appendChild(el('div', { class: 'row' }, [
      el('button', { class: 'btn', onclick: newBook }, ['＋ New book']),
      el('button', { class: 'btn ghost sm', onclick: importBookFile }, ['⬆ Import (.json)'])
    ]));
    var list = el('div', { class: 'cast', style: 'margin-top:14px' });
    a.appendChild(list);
    STORE.values().then(function (books) {
      books = (books || []).filter(Boolean).sort(function (x, y) { return (y.date || '').localeCompare(x.date || ''); });
      if (!books.length) { list.appendChild(el('div', { class: 'muted', text: 'No saved books yet. Write one, then “💾 Save”. Or ⬆ Import a .book.json.' })); return; }
      books.forEach(function (b) {
        var t = STORY_TYPES.filter(function (x) { return x.id === b.typeId; })[0] || (b.typeId === 'custom' ? { emoji: '✎', label: b.customGenre || 'Custom' } : null);
        var np = (b.pages || []).length;
        var actions = el('div', { class: 'sel' }, [
          el('button', { class: 'btn sm', onclick: function () { openBook(b); } }, ['Open']),
          el('button', { class: 'chip', style: 'cursor:pointer', onclick: function () { renameBook(b); } }, ['✎ rename']),
          el('button', { class: 'chip', style: 'cursor:pointer', onclick: function () { duplicateBook(b); } }, ['⎘ duplicate']),
          el('button', { class: 'chip', style: 'cursor:pointer', onclick: function () { exportBookAsk(b, 'txt'); } }, ['↓ txt']),
          el('button', { class: 'chip', style: 'cursor:pointer', onclick: function () { exportBookAsk(b, 'md'); } }, ['↓ md']),
          el('button', { class: 'chip', style: 'cursor:pointer', onclick: function () { exportBookFile(b, 'json'); } }, ['↓ json']),
          el('button', { class: 'chip', style: 'cursor:pointer', onclick: function () { confirmAsync('Delete “' + (b.title || 'this book') + '”? This cannot be undone.', { okText: 'Delete' }).then(function (ok) { if (ok) deleteBook(b.id); }); } }, ['🗑 delete'])
        ]);
        list.appendChild(el('div', { class: 'cm' }, [
          el('div', { class: 'h' }, [el('span', { class: 'nm', text: b.title || 'Untitled' })]),
          el('div', { class: 'muted', text: (t ? t.emoji + ' ' + t.label + ' · ' : '') + np + ' page' + (np === 1 ? '' : 's') + (bookLoreFlat(b).length ? ' · 📓 ' + bookLoreFlat(b).length + ' memories' : '') + ((b.plan && b.plan.end) ? ' · 🎯 planned' : '') + ' · ' + ((b.date || '').slice(0, 10)) }),
          actions
        ]));
      });
    });
  }

  function nav(backTo, nextLabel, nextFn, nextOk) {
    var row = el('div', { class: 'row', style: 'margin-top:22px' });
    if (backTo != null) row.appendChild(el('button', { class: 'btn ghost', onclick: function () { go(backTo); } }, ['← Back']));
    if (nextLabel) { var b = el('button', { class: 'btn', onclick: nextFn }, [nextLabel]); if (!nextOk) b.disabled = true, b.style.opacity = .5; row.appendChild(b); }
    $('#app').appendChild(row);
  }

  function themeChip(th) { return el('button', { class: 'chip' + (S.themeId === th.id ? ' on' : ''), style: 'cursor:pointer', title: th.text || '', onclick: function () { S.themeId = th.id; S.theme = th.text; render(); } }, [th.label]); }
  function toneChip(to) { return el('button', { class: 'chip' + (S.toneId === to.id ? ' on' : ''), style: 'cursor:pointer', onclick: function () { S.toneId = to.id; S.tone = to.text; render(); } }, [to.label]); }
  function renderType() {
    var a = $('#app');
    a.appendChild(el('h2', { class: 'sec', text: 'What kind of book are we making?' }));
    a.appendChild(el('div', { class: 'muted', text: 'Mix a genre, a theme, and a vibe. The genre sets the narrator + chapter arc; theme and tone flavour it. All editable later.' }));
    if (S._lastBook && !S.pages.length && !S.typeId) {
      a.appendChild(el('div', { class: 'row', style: 'margin-top:10px' }, [
        el('button', { class: 'btn', onclick: function () { openBook(S._lastBook); } }, ['📖 Continue “' + (S._lastBook.title || 'your book') + '” · ' + (S._lastBook.pages || []).length + ' pages']),
        el('button', { class: 'btn ghost sm', onclick: function () { S.view = 'library'; render(); } }, ['📚 My Books'])
      ]));
    }

    // GENRE (required) — cards
    a.appendChild(el('div', { class: 'sublbl', text: 'Genre' }));
    var grid = el('div', { class: 'grid', style: 'margin-top:8px' });
    STORY_TYPES.forEach(function (t) {
      grid.appendChild(el('div', { class: 'card' + (S.typeId === t.id ? ' on' : ''), onclick: function () { S.typeId = t.id; if (!S.narrator) S.narrator = { type: t.narrator.type, voice: t.narrator.voice }; render(); } }, [
        el('div', { class: 't', text: t.emoji + '  ' + t.label }),
        el('div', { class: 'b', text: t.blurb })
      ]));
    });
    grid.appendChild(el('div', { class: 'card' + (S.typeId === 'custom' ? ' on' : ''), onclick: function () { askAsync('Name your genre:', S.customGenre || '').then(function (g) { if (g && g.trim()) { S.customGenre = g.trim(); S.typeId = 'custom'; if (!S.narrator) S.narrator = { type: 'third-close', voice: 'warm' }; render(); } }); } }, [
      el('div', { class: 't', text: '✎  ' + (S.typeId === 'custom' && S.customGenre ? S.customGenre : 'Custom genre…') }),
      el('div', { class: 'b', text: 'A genre of your own.' })
    ]));
    a.appendChild(grid);

    // THEME (optional) — chips
    a.appendChild(el('div', { class: 'sublbl', text: 'Theme / setting' }));
    var tr = el('div', { class: 'row', style: 'margin-top:6px' });
    tr.appendChild(themeChip({ id: 'none', label: '— none —', text: '' }));
    THEMES.forEach(function (th) { tr.appendChild(themeChip(th)); });
    tr.appendChild(el('button', { class: 'chip' + (S.themeId === 'custom' ? ' on' : ''), style: 'cursor:pointer', onclick: function () { askAsync('Custom theme / setting:', S.themeId === 'custom' ? S.theme : '').then(function (x) { if (x && x.trim()) { S.theme = x.trim(); S.themeId = 'custom'; render(); } }); } }, ['✎ Custom' + (S.themeId === 'custom' && S.theme ? ': ' + S.theme.slice(0, 18) : '')]));
    a.appendChild(tr);

    // TONE / VIBE (default Surprise me!) — chips
    a.appendChild(el('div', { class: 'sublbl', text: 'Tone / vibe' }));
    var vr = el('div', { class: 'row', style: 'margin-top:6px' });
    TONES.forEach(function (to) { vr.appendChild(toneChip(to)); });
    vr.appendChild(el('button', { class: 'chip' + (S.toneId === 'custom' ? ' on' : ''), style: 'cursor:pointer', onclick: function () { askAsync('Custom tone / vibe:', S.toneId === 'custom' ? S.tone : '').then(function (x) { if (x && x.trim()) { S.tone = x.trim(); S.toneId = 'custom'; render(); } }); } }, ['✎ Custom' + (S.toneId === 'custom' && S.tone ? ': ' + S.tone.slice(0, 18) : '')]));
    a.appendChild(vr);

    nav(null, 'Next: characters →', function () { S.narrator = S.narrator || { type: typeOf().narrator.type, voice: typeOf().narrator.voice }; go(1); }, !!S.typeId);
  }

  function renderCast() {
    var a = $('#app');
    a.appendChild(el('h2', { class: 'sec', text: 'Who is in this story?' }));
    a.appendChild(el('div', { class: 'muted', text: 'Add characters, then set each one’s role and fate. The fate rules are honored across the whole book.' }));
    // add controls
    var add = el('div', { class: 'row', style: 'margin-top:10px' });
    var nameIn = el('input', { placeholder: 'Name', style: 'width:140px' });
    var persIn = el('input', { placeholder: 'One-line persona (optional)', style: 'flex:1;min-width:160px' });
    add.appendChild(nameIn); add.appendChild(persIn);
    add.appendChild(el('button', { class: 'btn sm', onclick: function () { if (nameIn.value.trim()) { addCast(nameIn.value.trim(), persIn.value.trim()); render(); } } }, ['+ Add']));
    a.appendChild(add);
    // import + samples
    var imp = el('div', { class: 'row' });
    var ta = el('textarea', { rows: '2', placeholder: 'Paste characters — AICC/character-card JSON, or "Name: description" per line', style: 'flex:1;min-width:220px' });
    imp.appendChild(ta);
    imp.appendChild(el('button', { class: 'btn sm ghost', onclick: function () { importPasted(ta.value); } }, ['Import pasted']));
    a.appendChild(imp);
    function chipRow(label, bank, extra) {
      var row = el('div', { class: 'row' });
      row.appendChild(el('span', { class: 'muted', text: label }));
      bank.forEach(function (s) { row.appendChild(el('button', { class: 'chip', style: 'cursor:pointer', title: s.persona, onclick: function () { addCast(s.name, s.persona); render(); } }, ['+ ' + s.name])); });
      if (extra) row.appendChild(extra);
      a.appendChild(row);
    }
    chipRow('Rook crew:', ROOK_CREW);   // the project's own personas - fun to write with
    chipRow('Archetypes:', SAMPLE_CAST, el('button', { class: 'btn sm', style: 'margin-left:6px', onclick: inventCharacter }, [S.busy ? '…' : '✨ Invent one']));
    chipRow('Myth & legend:', MYTH_CAST);   // folklore figures the brain already knows the lore of
    // the cast list
    var list = el('div', { class: 'cast', style: 'margin-top:14px' });
    S.cast.forEach(function (c, i) {
      var card = el('div', { class: 'cm' });
      var head = el('div', { class: 'h' }, [
        el('span', { class: 'nm', text: c.name }),
        el('button', { class: 'chip', style: 'cursor:pointer', onclick: function () { S.cast.splice(i, 1); render(); } }, ['remove'])
      ]);
      card.appendChild(head);
      if (c.persona) card.appendChild(el('div', { class: 'muted', text: c.persona }));
      var sel = el('div', { class: 'sel' });
      var roleSel = el('select', { onchange: function () { c.role = roleSel.value; c.fate = FATES[c.role][0].id; render(); } });
      ROLES.forEach(function (r) { roleSel.appendChild(el('option', { value: r.id, text: r.label, selected: c.role === r.id ? 'selected' : null })); });
      var fateSel = el('select', { onchange: function () { c.fate = fateSel.value; } });
      (FATES[c.role] || []).forEach(function (f) { fateSel.appendChild(el('option', { value: f.id, text: f.label, selected: c.fate === f.id ? 'selected' : null })); });
      sel.appendChild(roleSel); sel.appendChild(fateSel);
      sel.appendChild(el('label', { class: 'ck' }, [el('input', { type: 'checkbox', onchange: function (e) { c.romantic = e.target.checked; }, checked: c.romantic ? 'checked' : null }), 'Romantic interest']));
      card.appendChild(sel);
      list.appendChild(card);
    });
    a.appendChild(list);
    nav(0, 'Next: narrator →', function () { go(2); }, S.cast.length > 0);
  }

  function renderNarrator() {
    var a = $('#app');
    a.appendChild(el('h2', { class: 'sec', text: 'Who tells it, and how?' }));
    a.appendChild(el('div', { class: 'muted', text: 'The narrator’s type and voice shape every chapter. Defaulted from your story type — change freely.' }));
    var grid = el('div', { class: 'grid', style: 'margin-top:12px' });
    NARRATOR_TYPES.forEach(function (nt) {
      grid.appendChild(el('div', { class: 'card' + (S.narrator.type === nt.id ? ' on' : ''), onclick: function () { S.narrator.type = nt.id; render(); } }, [
        el('div', { class: 't', text: nt.label }), el('div', { class: 'b', text: nt.hint })
      ]));
    });
    a.appendChild(grid);
    var vr = el('div', { class: 'row', style: 'margin-top:14px' });
    vr.appendChild(el('span', { class: 'muted', text: 'Voice:' }));
    VOICES.forEach(function (v) { vr.appendChild(el('button', { class: 'card' + (S.narrator.voice === v ? ' on' : ''), style: 'padding:6px 12px;cursor:pointer', onclick: function () { S.narrator.voice = v; render(); } }, [v])); });
    a.appendChild(vr);
    nav(1, 'Start the book →', function () { go(3); }, !!(S.narrator && S.narrator.type && S.narrator.voice));
  }

  // The Story Brain panel: live council introspection + the controls that tune it (stance, faculty
  // weights, spontaneity) + the story bible it has learned. This is the brain's "wiring" made visible.
  function renderBrainPanel() {
    var p = el('div', { class: 'brainp' });
    p.appendChild(el('div', { class: 'brainp-read', text: '🧠 ' + statusReadout() }));
    // stance presets
    var sr = el('div', { class: 'row', style: 'margin-top:8px' }, [el('span', { class: 'muted', text: 'Stance:' })]);
    Object.keys(STANCES).forEach(function (id) { sr.appendChild(el('button', { class: 'chip' + (S.stance === id ? ' on' : ''), style: 'cursor:pointer', title: STANCES[id].blurb, onclick: function () { applyStance(id); } }, [STANCES[id].label])); });
    p.appendChild(sr);
    // faculty weight sliders
    var fl = el('div', { class: 'brainp-facs' });
    CORE_FACULTIES.forEach(function (id) {
      var val = Math.round(((S.weights && S.weights[id]) || 1) * 100);
      var lab = el('span', { class: 'brainp-fac-lab', text: id });
      var rng = el('input', { type: 'range', min: '0', max: '200', step: '10', value: String(val) });
      var num = el('span', { class: 'brainp-fac-val', text: (val / 100).toFixed(1) + '×' });
      rng.addEventListener('input', function () { num.textContent = (rng.value / 100).toFixed(1) + '×'; });
      rng.addEventListener('change', function () { setFacultyWeight(id, rng.value / 100); });
      fl.appendChild(el('label', { class: 'brainp-fac' }, [lab, rng, num]));
    });
    p.appendChild(fl);
    // spontaneity dial
    var spon = el('div', { class: 'row', style: 'margin-top:6px' }, [el('span', { class: 'muted', text: 'Spontaneity:' })]);
    var sn = el('input', { type: 'range', min: '0', max: '40', step: '5', value: String(S.noise || 0), style: 'flex:1' });
    var snv = el('span', { class: 'brainp-fac-val', text: (S.noise || 0) + '%' });
    sn.addEventListener('input', function () { snv.textContent = sn.value + '%'; });
    sn.addEventListener('change', function () { setNoise(parseInt(sn.value, 10)); });
    spon.appendChild(sn); spon.appendChild(snv);
    p.appendChild(spon);

    // END-IN-MIND: the secret destination + arc
    loreInit();
    var planRow = el('div', { class: 'row', style: 'margin-top:10px' }, [el('span', { class: 'muted', text: '🎯 Ending:' })]);
    if (S.plan && S.plan.end) {
      var ph = arcPhase(S.pages.length || 1);
      planRow.appendChild(el('span', { class: 'muted', style: 'flex:1', text: 'planned · page ' + (S.pages.length) + ' of ~' + planTarget() + ' · ' + ph.key }));
      planRow.appendChild(el('button', { class: 'chip', style: 'cursor:pointer', title: S.plan.end, onclick: function () { setPlan(); } }, ['view / edit']));
      planRow.appendChild(el('button', { class: 'chip' + (S.resolving ? ' on' : ''), style: 'cursor:pointer', title: 'Tell the brain to converge the threads and land the ending now', onclick: function () { S.resolving = !S.resolving; autoSave(); render(); refreshBrainReadout(); } }, [S.resolving ? '🏁 resolving' : '🏁 head to ending']));
    } else {
      planRow.appendChild(el('span', { class: 'muted', style: 'flex:1', text: 'none — give the brain an end to build toward (makes mysteries possible)' }));
      planRow.appendChild(el('button', { class: 'btn sm', onclick: function () { setPlan(); } }, ['🎯 Plan the ending']));
    }
    p.appendChild(planRow);

    // structured world-memory (People / Places / World / Threads)
    var L = S.lore, counts = [['👤', (L.people || []).length], ['📍', (L.places || []).length], ['🌍', (L.world || []).length], ['🧵', (L.threads || []).length]];
    var loreRow = el('div', { class: 'row', style: 'margin-top:8px' }, [
      el('span', { class: 'muted', text: '📓 World-memory: ' + counts.map(function (c) { return c[0] + ' ' + c[1]; }).join('  ') + (counts[3][1] ? '  (🧵 = open threads/clues)' : '') }),
      el('button', { class: 'chip', style: 'cursor:pointer', onclick: editLore }, [loreCount() ? 'view / edit' : 'add'])
    ]);
    p.appendChild(loreRow);
    // bearings (compass) + in-story calendar
    var c = S.compass || {}, cal = S.calendar || {};
    var navText = (c.place || c.heading) ? ('at ' + (c.place || '?') + (c.heading ? ', heading ' + c.heading : '')) : 'not set';
    var timeText = (cal.label || cal.day) ? ((cal.label || ('day ' + cal.day)) + (cal.day ? ' · day ' + cal.day : '')) : 'not set';
    p.appendChild(el('div', { class: 'row', style: 'margin-top:8px' }, [
      el('span', { class: 'muted', text: '🧭 Bearings: ' + navText }),
      el('button', { class: 'chip', style: 'cursor:pointer', onclick: function () { askAsync('Where the action stands — “place | heading”  (heading: N, NE, E, SE, S, SW, W, NW, or a bearing). North stays North.', (c.place || '') + (c.heading ? ' | ' + c.heading : '')).then(function (v) { if (v == null) return; var pp = String(v).split('|'); S.compass = { place: (pp[0] || '').trim(), heading: (pp[1] || '').trim() }; autoSave(); render(); }); } }, ['set'])
    ]));
    p.appendChild(el('div', { class: 'row', style: 'margin-top:4px' }, [
      el('span', { class: 'muted', text: '🗓 Story time: ' + timeText }),
      el('button', { class: 'chip', style: 'cursor:pointer', onclick: function () { askAsync('The current in-story date/time the brain tracks (e.g. “Tuesday, the 14th of Marrowmonth” or “Spring, Year 312”). Real or fantasy calendar.', cal.label || '').then(function (v) { if (v == null) return; S.calendar = { label: String(v).trim(), day: cal.day || (String(v).trim() ? 1 : 0) }; autoSave(); render(); }); } }, ['set'])
    ]));
    // treadmill / memory status
    var ride = treadmill(S.pages.length - 1).length, off = Math.max(0, S.pages.length - ride);
    p.appendChild(el('div', { class: 'muted', style: 'margin-top:4px', text: '🎞 Treadmill: the last ' + ride + ' page' + (ride === 1 ? '' : 's') + ' ride verbatim' + (off ? ' · ' + off + ' older page' + (off === 1 ? '' : 's') + ' pruned, remembered as bible facts' : '') }));
    p.appendChild(el('div', { class: 'muted', style: 'margin-top:6px;font-size:11px', text: 'Stance + sliders reweight the council that picks each page’s intent; spontaneity adds variance. Recent pages ride a token-budgeted treadmill; older ones are distilled into bible facts the brain keeps.' }));
    return p;
  }

  function renderWrite() {
    var a = $('#app'); var t = typeOf();
    a.appendChild(el('h2', { class: 'sec', text: t.emoji + '  ' + t.label }));
    var sub = el('div', { class: 'muted' });
    sub.innerHTML = 'Narrator: ' + (NARRATOR_TYPES.filter(function (x) { return x.id === S.narrator.type; })[0] || {}).label + ' · ' + S.narrator.voice + ' voice' + (S.theme ? ' · ' + (THEMES.filter(function (x) { return x.id === S.themeId; })[0] || { label: S.theme }).label : '') + ' · ' + (S.tone ? S.tone : 'surprise vibe') + ' · ' + S.cast.length + ' characters' + ((S.plan && S.plan.end) ? ' · 🎯 ' + arcPhase(S.pages.length || 1).key : '') + (hasAi() ? '' : ' <span class="pill">preview narrator</span>');
    a.appendChild(sub);
    // top controls (book-level)
    var ctl = el('div', { class: 'row', style: 'margin-top:12px' });
    ctl.appendChild(el('button', { class: 'btn ghost sm' + ((S.grounds || []).length ? ' on' : ''), title: 'Look up real facts to ground the fiction', onclick: openKnowledge }, ['📚 Almanac']));
    if (hasBrain()) ctl.appendChild(el('button', { class: 'btn ghost sm' + (S.brainOpen ? ' on' : ''), onclick: function () { S.brainOpen = !S.brainOpen; render(); if (S.brainOpen) refreshBrainReadout(); } }, ['🧠 Story Brain']));
    ctl.appendChild(el('button', { class: 'btn ghost sm' + (S.plan && S.plan.end ? ' on' : ''), title: 'Give the brain a secret ending to build toward (makes mysteries possible)', onclick: setPlan }, [S.plan && S.plan.end ? '🎯 Ending set' : '🎯 Plan ending']));
    if (S.pages.length) ctl.appendChild(el('button', { class: 'btn ghost sm', title: 'Simulate a story move before committing', onclick: function () { openForesee(); } }, ['🔮 Foresee']));
    if (S.pages.length) {
      ctl.appendChild(el('button', { class: 'btn ghost sm', onclick: function () { askAsync('Custom beat for a new page (what happens?):', '', { placeholder: 'e.g. They find a hidden door' }).then(function (b) { if (b && b.trim()) generatePage(b.trim()); }); } }, ['＋ Custom page…']));
      ctl.appendChild(el('button', { class: 'btn ghost sm', onclick: saveBook }, ['💾 Save']));
      ctl.appendChild(el('button', { class: 'btn ghost sm', onclick: function () { exportBook('txt'); } }, ['↓ txt']));
      ctl.appendChild(el('button', { class: 'btn ghost sm', onclick: function () { exportBook('md'); } }, ['↓ md']));
      ctl.appendChild(el('button', { class: 'btn ghost sm', onclick: function () { exportBook('json'); } }, ['↓ json']));
    }
    a.appendChild(ctl);
    if (S.brainOpen && hasBrain()) a.appendChild(renderBrainPanel());
    if ((S.grounds || []).length) a.appendChild(el('div', { class: 'row', style: 'margin-top:6px' }, [
      el('span', { class: 'muted', text: '📎 Grounding: ' + S.grounds.length + ' real fact' + (S.grounds.length === 1 ? '' : 's') + ' the brain is using' }),
      el('button', { class: 'chip', style: 'cursor:pointer', onclick: function () { askAsync('Real-world grounding — one fact per line (the brain weaves these into the prose):', (S.grounds || []).join('\n\n'), { multiline: true, okText: 'Save' }).then(function (v) { if (v == null) return; S.grounds = String(v).split(/\n{2,}|\n/).map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 12); autoSave(); render(); }); } }, ['view / edit'])
    ]));
    var bv = bestVoice();
    if (bv) a.appendChild(el('div', { class: 'muted', style: 'margin-top:6px', text: '✨ Your 👍 lean toward a ' + bv + ' voice — switch in step 3 to follow it.' }));

    // EMPTY: nothing written yet
    if (!S.pages.length) {
      var nextBeat = t.beats[0];
      a.appendChild(el('div', { class: 'muted', style: 'margin-top:10px', text: 'First beat: ' + nextBeat }));
      a.appendChild(el('div', { class: 'row', style: 'margin-top:8px' }, [el('button', { class: 'btn', onclick: function () { generatePage(); } }, [S.busy ? 'Writing…' : 'Write Page 1'])]));
      nav(2, null, null, false); return;
    }

    // PAGER: one page at a time
    clampIdx();
    var i = S.pageIdx, ch = S.pages[i];
    var c = el('div', { class: 'page' });
    if (ch.chapterMark) {
      var cm = el('div', { class: 'chmark' }, [el('div', { class: 'cht', text: ch.chapterMark.title })]);
      if (ch.chapterMark.subtitle) cm.appendChild(el('div', { class: 'chs', text: ch.chapterMark.subtitle }));
      c.appendChild(cm);
    }
    c.appendChild(el('h3', { text: 'Page ' + ch.n + (ch.title ? ' — ' + ch.title : '') }));
    c.appendChild(el('div', { class: 'meta', text: 'beat: ' + ch.beat + (ch.motifId ? ' · motif: ' + ch.motifId : '') + (ch.intent ? ' · brain: ' + ch.intent : '') + (ch.engine === 'stub' ? ' · preview' : '') + (ch.streaming ? ' · writing…' : '') }));
    var body = el('div', { class: 'body' + (ch.streaming ? ' streaming' : ''), contenteditable: ch.streaming ? 'false' : 'true', text: ch.body });
    body.addEventListener('blur', function () { ch.body = body.textContent; autoSave(); });
    c.appendChild(body);
    if (ch.footnote) c.appendChild(el('div', { class: 'foot', text: ch.footnote }));
    var acts = el('div', { class: 'acts' });
    acts.appendChild(el('button', { class: 'rk-vote' + (ch.vote === 'up' ? ' on' : ''), title: 'Good — the brain learns from this', onclick: function () { voteChapter(i, 'up'); } }, ['👍']));
    acts.appendChild(el('button', { class: 'rk-vote' + (ch.vote === 'down' ? ' on down' : ''), title: 'Not it — the brain adjusts', onclick: function () { voteChapter(i, 'down'); } }, ['👎']));
    acts.appendChild(el('button', { class: 'btn ghost sm', onclick: function () { regenerate(i); } }, ['↻ Regenerate']));
    acts.appendChild(el('button', { class: 'btn ghost sm', onclick: function () { setChapterMark(i); } }, [ch.chapterMark ? '✎ Chapter' : '＋ Chapter mark']));
    acts.appendChild(el('button', { class: 'btn ghost sm', onclick: function () { setFootnote(i); } }, [ch.footnote ? '✎ Footnote' : '＋ Footnote']));
    acts.appendChild(el('button', { class: 'chip', style: 'cursor:pointer', onclick: function () { confirmAsync('Delete page ' + ch.n + '? This cannot be undone.', { okText: 'Delete' }).then(function (ok) { if (ok) deletePage(i); }); } }, ['🗑 delete']));
    c.appendChild(acts);
    a.appendChild(c);
    a.appendChild(el('div', { class: 'muted', style: 'margin-top:6px', text: 'Tip: 👍/👎 teach the brain · click into the page text for a ▶ to continue from the cursor.' }));

    // BOTTOM pagination
    var atLast = i >= S.pages.length - 1;
    var pag = el('div', { class: 'pager' });
    var prev = el('button', { class: 'btn ghost', onclick: function () { gotoPage(i - 1); } }, ['← Prev']);
    if (i <= 0) { prev.disabled = true; prev.style.opacity = .4; }
    pag.appendChild(prev);
    pag.appendChild(el('div', { class: 'pcount', text: 'Page ' + (i + 1) + ' of ' + S.pages.length }));
    var next = el('button', { class: 'btn', onclick: nextOrGenerate }, [S.busy && atLast ? 'Writing…' : (atLast ? 'Next Page → (write)' : 'Next Page →')]);
    if (S.busy) { next.disabled = true; next.style.opacity = .6; }
    pag.appendChild(next);
    a.appendChild(pag);

    // chapter jump-nav (creature comfort): the chapter markers across the book
    var marks = S.pages.map(function (p, k) { return p.chapterMark ? { k: k, title: p.chapterMark.title } : null; }).filter(Boolean);
    if (marks.length) {
      var jn = el('div', { class: 'row', style: 'margin-top:10px' }, [el('span', { class: 'muted', text: 'Chapters:' })]);
      marks.forEach(function (m) { jn.appendChild(el('button', { class: 'chip' + (m.k === i ? ' on' : ''), style: 'cursor:pointer', onclick: function () { gotoPage(m.k); } }, [m.title])); });
      a.appendChild(jn);
    }
    nav(2, null, null, false);
  }

  // ---- continue-from-cursor: a floating button that follows the caret in a chapter body ----
  var contBtn = null;
  function ensureCont() {
    if (contBtn) return;
    contBtn = el('button', { class: 'contbtn', html: '▶ continue' });
    contBtn.addEventListener('mousedown', function (e) {   // mousedown (not click) so the caret/selection survives
      e.preventDefault();
      if (!contBtn._node) return;
      continueFromCaret(contBtn._node, contBtn._before, contBtn._idx);
      hideCont();
    });
    document.body.appendChild(contBtn);
  }
  function hideCont() { if (contBtn) { contBtn.style.display = 'none'; contBtn._node = null; } }
  function activeBody() { var a = document.activeElement; return (a && a.classList && a.classList.contains('body') && a.getAttribute('contenteditable') === 'true' && a.closest('.page')) ? a : null; }
  function caretBefore(node) {
    var sel = window.getSelection(); if (!sel || !sel.rangeCount) return null;
    var r = sel.getRangeAt(0); if (!node.contains(r.startContainer)) return null;
    var pre = document.createRange(); pre.selectNodeContents(node); pre.setEnd(r.startContainer, r.startOffset);
    var before = pre.toString();
    return { before: before, rect: r.getBoundingClientRect(), after: node.textContent.slice(before.length) };
  }
  function updateCont() {
    if (S.busy) { hideCont(); return; }
    var node = activeBody(); if (!node) { hideCont(); return; }
    var ci = caretBefore(node); if (!ci || !/^\s*$/.test(ci.after) || !ci.before.trim()) { hideCont(); return; }   // only when cursor is at the live end
    ensureCont();
    contBtn._node = node; contBtn._before = ci.before; contBtn._idx = S.pageIdx;   // only the current page is shown
    contBtn.style.left = (ci.rect.left + window.scrollX + 8) + 'px';
    contBtn.style.top = (ci.rect.top + window.scrollY - 4) + 'px';
    contBtn.style.display = 'block';
  }
  document.addEventListener('selectionchange', updateCont);
  document.addEventListener('scroll', function () { if (contBtn && contBtn.style.display === 'block') updateCont(); }, true);

  // ---- comments plugin: a pinned button (upper-right) that toggles the Perchance reader comments ----
  var commentsMounted = false;
  function placeComments(panel, out) {
    if (!out) return;
    if (typeof out === 'string') panel.innerHTML = out;
    else if (out.nodeType) panel.appendChild(out);
    else if (out.toString) panel.innerHTML = String(out);
  }
  function mountComments(panel) {
    var cp = grab('commentsPlugin');
    if (typeof cp !== 'function') { panel.innerHTML = '<div style="color:#bcae98;font-size:13px;padding:10px;">💬 Reader comments appear here once this is published on Perchance.</div>'; return; }
    try { var out = cp({}); if (out && typeof out.then === 'function') out.then(function (r) { placeComments(panel, r); }); else placeComments(panel, out); }
    catch (e) { panel.innerHTML = '<div style="color:#bcae98;font-size:13px;padding:10px;">Comments could not load.</div>'; }
  }
  function initComments() {
    if (document.getElementById('bm-comments-btn')) return;
    var panel = el('div', { id: 'bm-comments' });
    var btn = el('button', { id: 'bm-comments-btn', title: 'Reader comments', onclick: function () {
      var open = panel.classList.toggle('open');
      btn.textContent = open ? '✕ Comments' : '💬 Comments';
      if (open && !commentsMounted) { commentsMounted = true; mountComments(panel); }
    } }, ['💬 Comments']);
    document.body.appendChild(panel); document.body.appendChild(btn);
  }

  // resume: remember the last book you touched and offer to continue it on the landing
  function loadLast() {
    var id; try { id = localStorage.getItem('bookmaker:last'); } catch (e) {}
    if (!id) return;
    STORE.values().then(function (books) {
      var b = (books || []).filter(Boolean).filter(function (x) { return x.id === id; })[0];
      if (b && (b.pages || []).length) { S._lastBook = b; if (S.view === 'wizard' && S.step === 0 && !S.pages.length) render(); }
    });
  }

  // boot
  function boot() { render(); initComments(); loadLast(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.Bookmaker = { state: S };
})();
