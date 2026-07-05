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
  // ---- inline line-icons (monochrome, stroke=currentColor) replacing emoji. Paths are simple SVG, MIT-style. ----
  var ICONS = {
    dot: '<circle cx="12" cy="12" r="3"/>',
    book: '<path d="M5 4h12a1 1 0 0 1 1 1v15H7a2 2 0 0 0-2 2z"/><path d="M5 20a2 2 0 0 1 2-2h11"/>',
    brain: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 3 3V4z"/><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-3 3V4z"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>',
    sparkle: '<path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7z"/>',
    save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7"/><rect x="8" y="13" width="8" height="6"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
    up: '<path d="M7 10v10H4V10z"/><path d="M7 10l4-7a2 2 0 0 1 2 2v3h5a2 2 0 0 1 2 2.4l-1.5 6A2 2 0 0 1 16.5 20H7z"/>',
    down: '<path d="M17 14V4h3v10z"/><path d="M17 14l-4 7a2 2 0 0 1-2-2v-3H6a2 2 0 0 1-2-2.4l1.5-6A2 2 0 0 1 7.5 4H17z"/>',
    library: '<rect x="4" y="4" width="4" height="16" rx="1"/><rect x="10" y="4" width="4" height="16" rx="1"/><path d="M17 5l3 14"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1"/><circle cx="15" cy="15" r="1"/><circle cx="12" cy="12" r="1"/>',
    pen: '<path d="M4 20l4-1L19 8l-3-3L5 16z"/><path d="M14 7l3 3"/>',
    pencil: '<path d="M4 20l3-1L18 8l-2-2L6 17z"/><path d="M14 6l4 4"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 13l4 4L19 7"/>',
    alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
    right: '<path d="M5 12h13M13 6l6 6-6 6"/>',
    left: '<path d="M19 12H6M11 6l-6 6 6 6"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 20h14"/>',
    dl: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M5 20h14"/>',
    refresh: '<path d="M19 12a7 7 0 1 1-2-5"/><path d="M19 4v4h-4"/>',
    play: '<path d="M7 5l12 7-12 7z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    clip: '<path d="M20 11l-8.5 8.5a4 4 0 0 1-6-6L13 6a2.5 2.5 0 0 1 3.6 3.5l-7.6 7.6a1 1 0 0 1-1.4-1.4L14 10"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    anchor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v13"/><path d="M5 12a7 7 0 0 0 14 0"/><path d="M3 12h2M19 12h2"/>',
    chat: '<path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 4V6a1 1 0 0 1 1-1z"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4h13l-2.5 4L18 12H5"/>',
    notebook: '<rect x="6" y="3" width="13" height="18" rx="1"/><path d="M9 3v18"/><path d="M6 8H4M6 12H4M6 16H4"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    pin: '<path d="M12 21c4-5 7-8 7-11a7 7 0 0 0-14 0c0 3 3 6 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/>',
    branch: '<path d="M6 8v8"/><circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="9" r="2"/><path d="M18 11a6 6 0 0 1-6 6H6"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="M16 8l-2.5 5.5L8 16l2.5-5.5z"/>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="1"/><path d="M4 9h16M9 3v4M15 3v4"/>',
    film: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 9h16M4 15h16M9 4v16M15 4v16"/>',
    type: '<path d="M5 6h14M12 6v13M9 19h6"/>',
    quote: '<path d="M9 7H6a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h2v1a2 2 0 0 1-2 2"/><path d="M18 7h-3a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h2v1a2 2 0 0 1-2 2"/>',
    cloud: '<path d="M7 18a4 4 0 0 1 .5-8 5 5 0 0 1 9.5 1A3.5 3.5 0 0 1 17 18z"/>',
    calc: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M8 7h8M8 12h3M8 16h3M15 12v5M13 14.5h4"/>',
    landmark: '<path d="M4 21h16"/><path d="M5 21V10M19 21V10M9 21V10M15 21V10"/><path d="M3 10l9-6 9 6z"/>',
    star: '<path d="M12 3l2.5 6 6.5.5-5 4.2 1.6 6.3L12 17l-5.6 3 1.6-6.3-5-4.2 6.5-.5z"/>',
    map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/>',
    heart: '<path d="M12 20C7 16 4 13 4 9a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 4-3 7-8 11z"/>',
    rocket: '<path d="M12 3c3 2 4 5 4 9l-2 4h-4l-2-4c0-4 1-7 4-9z"/><circle cx="12" cy="9" r="1.5"/><path d="M8 16l-2 4M16 16l2 4"/>',
    flame: '<path d="M12 3c1 3 4 4.5 4 8a4 4 0 0 1-8 0c0-1.5.5-2.5 1.5-3.5C9.5 8.5 11 7 12 3z"/>',
    masks: '<path d="M4 5h6v5a3 3 0 0 1-6 0z"/><path d="M14 9h6v5a3 3 0 0 1-6 0z"/>',
    swords: '<path d="M4 4l8 8M4 8V4h4"/><path d="M20 4l-8 8M20 8V4h-4"/><path d="M9 13l-4 4M15 13l4 4"/>',
    coins: '<ellipse cx="12" cy="7" rx="6" ry="3"/><path d="M6 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/>',
    scale: '<path d="M12 4v16M7 20h10M6 7h12M6 7l-3 6a3 3 0 0 0 6 0zM18 7l-3 6a3 3 0 0 0 6 0z"/>',
    hat: '<path d="M6 14c-2 0-3 1-3 2h18c0-1-1-2-3-2M7 14c0-5 1-8 5-8s5 3 5 8"/>',
    city: '<path d="M4 21V9l5-2v14M9 21V5l6-2v18M15 21V9l5 2v10"/><path d="M4 21h16"/>',
    grad: '<path d="M3 9l9-4 9 4-9 4z"/><path d="M7 11v4a5 3 0 0 0 10 0v-4"/>',
    palm: '<path d="M12 21V9"/><path d="M12 9c-2-3-6-3-8-1 3 0 4 1 5 3M12 9c2-3 6-3 8-1-3 0-4 1-5 3M12 9c0-3 2-5 0-7-2 2 0 4 0 7"/>',
    home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    reset: '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5"/>',
    ghost: '<path d="M5 21V11a7 7 0 0 1 14 0v10l-2.5-2-2 2-2-2-2 2-2.5-2z"/><circle cx="9.5" cy="11" r=".7"/><circle cx="14.5" cy="11" r=".7"/>',
    crown: '<path d="M4 18h16M4 18l-1.2-9 5.2 4 4-7 4 7 5.2-4L20 18"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 13h6M9 17h6"/>',
    leaf: '<path d="M5 19c0-8 6-13 14-13 0 9-5 14-13 14-1.5-3 0-7 4-9"/>'
  };
  function icon(name, size) {
    var sp = document.createElement('span'); sp.className = 'ic';
    sp.innerHTML = '<svg viewBox="0 0 24 24" width="' + (size || 15) + '" height="' + (size || 15) + '" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || ICONS.dot) + '</svg>';
    return sp;
  }
  // a button label = an icon + text, in one go (keeps call-sites tidy)
  function ibtn(name, label) { var k = [icon(name)]; if (label) k.push(' ' + label); return k; }
  // tiny shared helpers (used app-wide instead of ad-hoc repeats)
  function byId(arr, id) { for (var i = 0; i < (arr || []).length; i++) if (arr[i] && arr[i].id === id) return arr[i]; return null; }
  function lsGet(key, fb) { try { var v = localStorage.getItem(key); return v == null ? fb : JSON.parse(v); } catch (e) { return fb; } }
  function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }

  // ---------------------------------------------------- appearance settings ----
  // Persisted look & feel (own LS key, independent of books). Overrides the :root CSS vars on <html>;
  // unset values fall back to the stylesheet. Custom bg/ink derive coherent shades for the panels.
  var UI_LS = 'bookmaker:ui', UI = lsGet(UI_LS, {});
  var UI_FONTS = [
    { id: 'Georgia, "Times New Roman", serif', label: 'Georgia — serif' },
    { id: '"Iowan Old Style", Palatino, serif', label: 'Palatino — serif' },
    { id: '"Times New Roman", Times, serif', label: 'Times — serif' },
    { id: 'Charter, "Bitstream Charter", Georgia, serif', label: 'Charter — serif' },
    { id: 'system-ui, "Segoe UI", Roboto, sans-serif', label: 'System — sans' },
    { id: '"Trebuchet MS", "Segoe UI", sans-serif', label: 'Trebuchet — sans' },
    { id: '"Courier New", ui-monospace, monospace', label: 'Courier — mono' }
  ];
  var UI_PRESETS = [
    { id: 'parchment', label: 'Parchment', vars: { '--bg': '#0b0907', '--bg2': '#13100b', '--bg3': '#1b1711', '--ink': '#f8f3ea', '--ink2': '#ccc0ac', '--line': '#3c3225', '--accent': '#d4ab73', '--accent2': '#ecc488' } },
    { id: 'midnight', label: 'Midnight', vars: { '--bg': '#080a10', '--bg2': '#0f131c', '--bg3': '#161d28', '--ink': '#e9eefb', '--ink2': '#aab6cf', '--line': '#283246', '--accent': '#7fa6e0', '--accent2': '#a7c4f2' } },
    { id: 'slate', label: 'Slate', vars: { '--bg': '#101316', '--bg2': '#171b20', '--bg3': '#1f242b', '--ink': '#eceff2', '--ink2': '#b3bcc6', '--line': '#333b45', '--accent': '#9fb6a6', '--accent2': '#c4d6c8' } },
    { id: 'ember', label: 'Ember', vars: { '--bg': '#120a0a', '--bg2': '#1b0f0e', '--bg3': '#241614', '--ink': '#f7eae6', '--ink2': '#d2b0a6', '--line': '#42291f', '--accent': '#e08a5a', '--accent2': '#f2a878' } }
  ];
  function hexRgb(h) { h = String(h || '').replace('#', ''); if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; var n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgbHex(c) { return '#' + c.map(function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return ('0' + v.toString(16)).slice(-2); }).join(''); }
  function shade(hex, d) { return rgbHex(hexRgb(hex).map(function (v) { return v + d; })); }   // +lighten / -darken
  function colorOf(v) { try { return (getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#000000'); } catch (e) { return '#000000'; } }
  function applyUI() {
    var root = document.documentElement.style, map = {};
    var preset = byId(UI_PRESETS, UI.theme); if (preset) for (var k in preset.vars) map[k] = preset.vars[k];
    if (UI.bg) { map['--bg'] = UI.bg; map['--bg2'] = shade(UI.bg, 9); map['--bg3'] = shade(UI.bg, 18); map['--line'] = shade(UI.bg, 42); }   // derive coherent panels
    if (UI.ink) { map['--ink'] = UI.ink; map['--ink2'] = shade(UI.ink, -46); }
    if (UI.accent) { map['--accent'] = UI.accent; map['--accent2'] = shade(UI.accent, 22); }
    if (UI.pageFont) map['--page-font'] = UI.pageFont;
    if (UI.pageInk) map['--page-ink'] = UI.pageInk;
    ['--bg', '--bg2', '--bg3', '--ink', '--ink2', '--line', '--accent', '--accent2', '--page-font', '--page-ink'].forEach(function (v) { if (map[v]) root.setProperty(v, map[v]); else root.removeProperty(v); });
  }
  function setUI(key, val) { if (val == null || val === '') delete UI[key]; else UI[key] = val; lsSet(UI_LS, UI); applyUI(); }
  function openSettings() {
    var box = el('div', { class: 'bm-modal-box wide' });
    box.appendChild(el('div', { class: 'bm-modal-msg' }, [icon('sliders'), '  Appearance — tune the look; saved on this device.']));
    var secs = el('div', { class: 'bm-sections' });
    function group(label) { secs.appendChild(el('div', { class: 'bm-sec-label', style: 'margin-top:14px' }, [label])); }
    function colorRow(label, key, varName) {
      var row = el('div', { class: 'set-row' });
      row.appendChild(el('span', { class: 'set-lbl', text: label }));
      var inp = el('input', { type: 'color', class: 'set-color', value: (UI[key] || colorOf(varName) || '#000000') });
      inp.addEventListener('input', function () { setUI(key, inp.value); });
      row.appendChild(inp);
      row.appendChild(el('button', { class: 'btn ghost sm set-clear', title: 'Reset this one', onclick: function () { setUI(key, null); inp.value = colorOf(varName); } }, ['reset']));
      secs.appendChild(row);
    }
    // theme presets
    group('Theme');
    var pr = el('div', { class: 'set-presets' });
    UI_PRESETS.forEach(function (p) {
      var sw = el('button', { class: 'preset' + (UI.theme === p.id ? ' on' : ''), title: p.label, onclick: function () { delete UI.bg; delete UI.ink; delete UI.accent; setUI('theme', p.id); close(); openSettings(); } }, [
        el('span', { class: 'preset-sw', style: 'background:' + p.vars['--bg'] + ';border-color:' + p.vars['--line'] }, [
          el('span', { style: 'background:' + p.vars['--accent'] }), el('span', { style: 'background:' + p.vars['--ink'] })
        ]), el('span', { class: 'preset-nm', text: p.label })
      ]);
      pr.appendChild(sw);
    });
    secs.appendChild(pr);
    // individual colors
    group('Colors');
    colorRow('Background', 'bg', '--bg');
    colorRow('Text', 'ink', '--ink');
    colorRow('Buttons / accent', 'accent', '--accent');
    // page live-text
    group('Page text (the story prose)');
    var fr = el('div', { class: 'set-row' });
    fr.appendChild(el('span', { class: 'set-lbl', text: 'Font' }));
    var fsel = el('select', { class: 'set-font' });
    UI_FONTS.forEach(function (f) { fsel.appendChild(el('option', { value: f.id, text: f.label })); });
    fsel.value = UI.pageFont || UI_FONTS[0].id;
    fsel.addEventListener('change', function () { setUI('pageFont', fsel.value === UI_FONTS[0].id ? null : fsel.value); });
    fr.appendChild(fsel); secs.appendChild(fr);
    colorRow('Color', 'pageInk', '--page-ink');
    box.appendChild(secs);
    var rowEl = el('div', { class: 'bm-modal-row' });
    rowEl.appendChild(el('button', { class: 'btn ghost sm', style: 'margin-right:auto', onclick: function () { UI = {}; lsSet(UI_LS, UI); applyUI(); close(); openSettings(); } }, ibtn('reset', 'Reset all')));
    rowEl.appendChild(el('button', { class: 'btn sm', onclick: function () { close(); } }, ['Done']));
    box.appendChild(rowEl);
    var close = openModal(box, null, 'set-overlay');   // clear backdrop so live colour changes are visible behind it
  }

  // ---------------------------------------------------------------- catalogue ----
  // Each story type carries: a default narrator, a beat arc (the chapter skeleton),
  // and a small voice-matched motif bank (its spine images). Motifs rotate via HNE's
  // pickFromBank when imported, else a local shuffle.
  var STORY_TYPES = [
    { id: 'cozy', label: 'Cozy Slice-of-Life', emoji: 'home', blurb: 'Warm, low stakes, found-family. Tea, small wins, gentle growth.',
      narrator: { type: 'third-close', voice: 'warm' },
      beats: ['An ordinary morning, gently drawn', 'A small wrinkle disturbs the calm', 'Reaching out; a hand offered', 'A shared effort, an awkward stumble', 'It comes right, and a warm seed of more'],
      motifs: [{ id: 'kettle', image: 'a kettle just beginning to murmur', essence: 'small comforts gathering' }, { id: 'window', image: 'rain tapping a warm-lit window', essence: 'safe inside while the world is wet' }, { id: 'loaf', image: 'bread cooling on a board', essence: 'something made by hand, for someone' }] },
    { id: 'fantasy', label: 'Epic Fantasy', emoji: 'swords', blurb: 'High stakes, old magic, a journey that changes everyone on it.',
      narrator: { type: 'third-omniscient', voice: 'grand' },
      beats: ['The ordinary world, and a shadow on its edge', 'The call, and the refusing of it', 'Crossing the threshold; the road begins', 'Trials, allies, and a true cost', 'The dark before; everything is risked', 'The turning, paid for in full', 'Home, but changed forever'],
      motifs: [{ id: 'beacon', image: 'a far beacon lit on a black ridge', essence: 'a promise kept across distance' }, { id: 'blade', image: 'a notched blade, honest about its work', essence: 'what survival actually costs' }, { id: 'root', image: 'roots older than the kingdom, drinking deep', essence: 'powers that predate the throne' }] },
    { id: 'noir', label: 'Noir Mystery', emoji: 'search', blurb: 'Rain, secrets, a crooked city. Everyone is lying about something.',
      narrator: { type: 'hardboiled', voice: 'wry' },
      beats: ['A case walks in out of the rain', 'The easy story, and the crack in it', 'Pulling the thread; the city pushes back', 'A body, a betrayal, a warning', 'The lie unspools; the cost lands close', 'The truth, ugly and complete'],
      motifs: [{ id: 'neon', image: 'neon bleeding pink into a wet gutter', essence: 'beauty rented by the hour' }, { id: 'smoke', image: 'smoke held a beat too long before the answer', essence: 'the pause where the lie lives' }, { id: 'rain', image: 'rain that never quite washes the street clean', essence: 'guilt that does not rinse off' }] },
    { id: 'romance', label: 'Romance', emoji: 'heart', blurb: 'Two people, one collision, all the wrong reasons to resist it.',
      narrator: { type: 'third-close', voice: 'intimate' },
      beats: ['Two orbits that should not cross', 'The meeting, and the spark denied', 'Forced together; the wall thins', 'A real moment, then fear of it', 'The break, sharp and avoidable', 'The reach back, braver this time', 'Chosen, out loud'],
      motifs: [{ id: 'hands', image: 'two hands not quite touching on a shared armrest', essence: 'the inch that means everything' }, { id: 'coat', image: 'a coat given up without comment', essence: 'care that will not announce itself' }, { id: 'song', image: 'a song that now belongs to two people', essence: 'a private world, two citizens' }] },
    { id: 'scifi', label: 'Sci-Fi Adventure', emoji: 'rocket', blurb: 'Far places, hard choices, a crew that becomes a reason to come home.',
      narrator: { type: 'third-omniscient', voice: 'grand' },
      beats: ['A routine run, one wrong reading', 'The anomaly that will not be ignored', 'In too deep; the crew splinters', 'A discovery that rewrites the stakes', 'The sacrifice play', 'A new sky, and who they are under it'],
      motifs: [{ id: 'signal', image: 'a signal older than the system it crossed', essence: 'a message from before us' }, { id: 'hull', image: 'frost spidering across a cooling hull', essence: 'how thin the wall to the void is' }, { id: 'earth', image: 'a pale familiar dot held in the viewport', essence: 'the small reason for all of it' }] },
    { id: 'fairytale', label: 'Fairy Tale', emoji: 'star', blurb: 'Once upon a time, a clear lesson, a teller who winks at you.',
      narrator: { type: 'storyteller', voice: 'warm' },
      beats: ['Once upon a time, a small wrongness', 'A wish, a bargain, a road into the wood', 'Three trials, three kindnesses or cruelties', 'The trap closes; cleverness over strength', 'The turn, and the price of the wish paid', 'And so, the lesson, gently'],
      motifs: [{ id: 'key', image: 'a small key warm from being held', essence: 'something that opens, already in hand' }, { id: 'thread', image: 'a red thread tied at the wrist', essence: 'a promise the wood remembers' }, { id: 'crumb', image: 'crumbs the birds have nearly finished', essence: 'a way home, vanishing' }] },
    { id: 'horror', label: 'Gothic Horror', emoji: 'flame', blurb: 'A house that watches, a dread that grows, a truth better left shut.',
      narrator: { type: 'lyrical', voice: 'eerie' },
      beats: ['Arrival at a place that is wrong, quietly', 'Small impossibilities, explained away', 'The house asserts itself', 'The history surfaces; it wants something', 'The descent; the rules break', 'What was always true, faced at last'],
      motifs: [{ id: 'door', image: 'a door that is open a finger-width more each morning', essence: 'patient, certain wrongness' }, { id: 'damp', image: 'a damp that smells faintly of before', essence: 'the past, not staying past' }, { id: 'mirror', image: 'a mirror a half-second slow', essence: 'something wearing your reflection' }] },
    { id: 'comedy', label: 'Comedy / Whimsy', emoji: 'masks', blurb: 'A small disaster, escalating beautifully, hearts intact at the end.',
      narrator: { type: 'drywit', voice: 'breezy' },
      beats: ['A perfectly reasonable plan', 'The first thing goes wrong, harmlessly', 'A cascade of dignified panic', 'The scheme to fix it makes it worse', 'Rock bottom, with excellent timing', 'It all lands, somehow, and nobody learns much'],
      motifs: [{ id: 'cake', image: 'a cake committed to before it was wise', essence: 'optimism exceeding ability' }, { id: 'list', image: 'a to-do list growing faster than it shrinks', essence: 'control, gloriously losing' }, { id: 'hat', image: 'a hat retrieved with too much ceremony', essence: 'dignity, defended past all reason' }] },
    { id: 'isekai', label: 'Anime Isekai', emoji: 'sparkle', blurb: 'An ordinary life, a sudden other world, a second chance with strange new rules.',
      narrator: { type: 'first', voice: 'breezy' },
      beats: ['An unremarkable day, cut short', 'Awake in another world — and a status screen only you can see', 'The rules of this world, learned the hard way', 'A first ally, a party, a small power discovered', 'A threat the old you could never have faced', 'Risking it all for someone of this world', 'Not back home — a new home, chosen'],
      motifs: [{ id: 'screen', image: 'a translucent status window hovering at the edge of sight', essence: 'a second life with visible rules' }, { id: 'guild', image: 'a noticeboard thick with quests and the smell of ale', essence: 'belonging earned, not given' }, { id: 'crest', image: 'a guild crest stitched fresh on a sleeve', essence: 'a stranger becoming one of them' }] },
    { id: 'survival', label: 'Survival', emoji: 'palm', blurb: 'Stranded against the elements — scarcity, grit, and the will to last one more night.',
      narrator: { type: 'third-close', voice: 'somber' },
      beats: ['The disaster that strands them', 'The first night, and the first need', 'Scavenging, and a hard rule learned the painful way', 'Another survivor — trust, or threat?', 'The elements turn truly deadly', 'A choice between staying safe and saving someone', 'Endured — and forever changed by it'],
      motifs: [{ id: 'fire', image: 'a fire kept alive against the wind', essence: 'one small win against the dark' }, { id: 'ration', image: 'a ration split smaller than yesterday', essence: 'tomorrow bought from today' }, { id: 'tracks', image: 'tracks in the mud that are not theirs', essence: 'not as alone as they hoped' }] },
    { id: 'harlequin', label: 'Harlequin Romance', emoji: 'heart', blurb: 'Sweeping, passionate romance — a striking stranger, an undeniable pull, every reason to resist.',
      narrator: { type: 'third-close', voice: 'intimate' },
      beats: ['A striking stranger, an instant charge', 'Every sensible reason to resist it', 'Thrown together — a storm, a duty, a debt', 'A stolen moment that changes everything', 'A secret or misunderstanding tears them apart', 'The grand gesture, pride set aside', 'A union, breathless and earned'],
      motifs: [{ id: 'glance', image: 'a glance held a heartbeat too long', essence: 'what neither will say yet' }, { id: 'shelter', image: 'two soaked through under one small shelter', essence: 'the world narrowed to an arm’s length' }, { id: 'letter', image: 'a letter written, burned, and written again', essence: 'feeling too large for caution' }] },
    { id: 'regency', label: 'Regency / Historical Drama', emoji: 'crown', blurb: 'Ballrooms and bloodlines — wit, propriety, scandal, and a love that defies the season’s rules.',
      narrator: { type: 'third-omniscient', voice: 'wry' },
      beats: ['The season opens; a debut, a duty', 'A maddening, magnetic rival across the room', 'Propriety at war with what the heart wants', 'A scandal threatens a family’s good name', 'A sacrifice made for reputation or kin', 'The truth, declared against all decorum', 'A match the whole drawing-room will discuss for years'],
      motifs: [{ id: 'fan', image: 'a fan snapped shut to end a conversation', essence: 'power wielded within strict rules' }, { id: 'card', image: 'a dance card with one name left blank', essence: 'a choice everyone is watching' }, { id: 'seal', image: 'a wax seal pressed on a private letter', essence: 'words that could ruin or redeem' }] },
    { id: 'paranormal', label: 'Paranormal Adventure', emoji: 'ghost', blurb: 'Cryptids and the uncanny met with wonder, not horror — a friendly encounter with the impossible.',
      narrator: { type: 'third-close', voice: 'warm' },
      beats: ['An ordinary place, an odd sign nobody believes', 'A sighting — fleeting, impossible, real', 'Following the trail, against all advice', 'First contact: the creature is not what they feared', 'A real threat — fear, poachers, a misunderstanding', 'An unlikely alliance with the impossible', 'A gentle parting, and a secret gladly kept'],
      motifs: [{ id: 'print', image: 'a single huge footprint filling with rain', essence: 'proof that won’t last till morning' }, { id: 'glow', image: 'a glow moving where no light should be', essence: 'the world larger than they were told' }, { id: 'plume', image: 'one impossible feather, warm to the touch', essence: 'a wonder you can hold' }] },
    { id: 'biography', label: 'Auto / Biography', emoji: 'user', blurb: 'A whole life, told with shape and meaning — the wound, the work, the legacy, the reckoning.',
      narrator: { type: 'first', voice: 'warm' },
      beats: ['Origins — the place and people that made them', 'The formative wound, or the early gift', 'The rising years; the craft taking hold', 'The great endeavour, and what it cost', 'The reversal that nearly ended it', 'Legacy — what outlives the doing of it', 'Reflection, honest, from the far side'],
      motifs: [{ id: 'photo', image: 'a photograph soft at the creases', essence: 'a moment that kept mattering' }, { id: 'doorway', image: 'a childhood door, smaller than remembered', essence: 'how far the road actually ran' }, { id: 'signature', image: 'a name in someone else’s handwriting', essence: 'a life that touched others' }] },
    { id: 'journal', label: 'Journal / Log / SCP-style', emoji: 'file', blurb: 'A found document — diary, captain’s log, or a clinical containment file (Item #, Class, Procedures).',
      narrator: { type: 'first', voice: 'wry' },
      beats: ['Entry 1: the log is established, all routine', 'Ordinary entries — a life, a duty, a watch', 'The first anomaly, noted and underplayed', 'Entries grow uneasy; the pattern won’t resolve', 'A critical incident, recorded as it happens', 'The final entry, cut short or strangely calm', 'An appended note, in another hand'],
      motifs: [{ id: 'stamp', image: 'a stamp reading CONTAINED in fading red', essence: 'order asserted over the inexplicable' }, { id: 'marked', image: 'a date underlined twice, then crossed out', essence: 'when things stopped being normal' }, { id: 'torn', image: 'an entry missing, the page torn clean out', essence: 'what the record will not say' }] }
  ];
  // THEME = a setting/subject overlaid on the genre (orthogonal). TONE = the overall vibe.
  // Both optional; the genre supplies the structural backbone (narrator + beats + motifs).
  var THEMES = [
    { id: 'space', label: 'Deep space', text: 'deep space — starships, stations, the silent void' },
    { id: 'otherworld', label: 'Another world', text: 'a fantastical other world — new peoples, a magic system, a map to fill in' },
    { id: 'pirates', label: 'High-seas pirates', text: 'the high seas — plunder, mutiny, salt and rope' },
    { id: 'dungeon', label: 'Dungeon-crawler RPG', text: 'a dungeon-crawler RPG — a party, loot, levels, a deadly descent' },
    { id: 'heist', label: 'Heist', text: 'a heist — a crew, a score, a plan that goes sideways' },
    { id: 'court', label: 'Courtroom', text: 'a courtroom — trials, testimony, the truth on the line' },
    { id: 'western', label: 'Wild West', text: 'the frontier — dust, a quick draw, a reckoning coming' },
    { id: 'cyberpunk', label: 'Cyberpunk', text: 'a cyberpunk city — neon, megacorps, chrome and rain' },
    { id: 'steampunk', label: 'Steampunk', text: 'an age of brass and steam — airships, clockwork, soot and invention' },
    { id: 'academy', label: 'Magic academy', text: 'a school of magic — students, rivalries, forbidden study' },
    { id: 'regency', label: 'Regency England', text: 'Regency England — ballrooms, estates, calling cards and quiet scandal' },
    { id: 'smalltown', label: 'Small town', text: 'a small town where everyone knows everyone — and every secret has a witness' },
    { id: 'wilds', label: 'The wilds / nature', text: 'deep wilderness — forest, mountain and river; nature vast and indifferent' },
    { id: 'island', label: 'A lonely island', text: 'a remote island — castaways, tides, a green interior full of secrets' },
    { id: 'apocalypse', label: 'Post-apocalypse', text: 'after the collapse — ruins, scarcity, the slow rebuilding of small kind things' },
    { id: 'haunted', label: 'Haunted place', text: 'a haunted house or town — cold spots, old griefs, things that linger' },
    { id: 'cryptid', label: 'Cryptid country', text: 'cryptid country — backwoods, lochs and snow-lines where the impossible leaves footprints' },
    { id: 'facility', label: 'Secret facility', text: 'a secret research facility — sterile halls, redacted files, contained anomalies' },
    { id: 'roadtrip', label: 'Road trip', text: 'the open road — diners, motels, and a destination that keeps moving' },
    { id: 'underwater', label: 'Underwater', text: 'beneath the waves — pressure, bioluminescence, a sunken everything' },
    { id: 'survival', label: 'Survival', text: 'the wilderness — scarcity, the elements, the will to last' },
    { id: 'mythic', label: 'Age of myth / gods', text: 'an age of myth — gods, monsters, prophecy and fate' }
  ];
  var TONES = [
    { id: 'surprise', label: 'Surprise me!', text: '' },   // default: leave it open, the brain chooses the vibe
    { id: 'dark', label: 'Dark', text: 'dark and serious' },
    { id: 'hopeful', label: 'Hopeful', text: 'warm and hopeful' },
    { id: 'epic', label: 'Epic', text: 'sweeping and epic' },
    { id: 'cozy', label: 'Cozy', text: 'gentle and cozy' },
    { id: 'comedic', label: 'Comedic', text: 'comedic and light' },
    { id: 'romantic', label: 'Romantic', text: 'tender and romantic' },
    { id: 'swoony', label: 'Swoony', text: 'heart-fluttering and swoony' },
    { id: 'slowburn', label: 'Slow-burn', text: 'a slow-burning, simmering tension' },
    { id: 'yearning', label: 'Yearning', text: 'aching, longing, full of restraint' },
    { id: 'steamy', label: 'Steamy', text: 'passionate and sensual, tasteful (fade-to-black)' },
    { id: 'gritty', label: 'Gritty', text: 'gritty and unflinching' },
    { id: 'whimsical', label: 'Whimsical', text: 'whimsical and playful' },
    { id: 'wondrous', label: 'Wondrous', text: 'full of awe and wonder' },
    { id: 'eerie', label: 'Eerie', text: 'eerie and unsettling' },
    { id: 'adventurous', label: 'Adventurous', text: 'bold, brisk and adventurous' },
    { id: 'melancholy', label: 'Melancholy', text: 'quiet and melancholy' },
    { id: 'tense', label: 'Tense', text: 'taut and suspenseful' },
    { id: 'heartwarming', label: 'Heartwarming', text: 'gentle and heartwarming' },
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
  // elements, wilds & nature — characters who ARE a force of nature, or live close to it
  var WILDS_CAST = [
    { name: 'Bramble', persona: 'A barefoot forest-warden who speaks for the trees and trusts animals over people. Patient as moss, fierce as a thornbush when the wood is threatened.' },
    { name: 'Ember', persona: 'A fire-spirit in human shape — warm, quick, a little dangerous to stand too close to. Generous with light, terrible at staying still.' },
    { name: 'Tide', persona: 'A water-soul, calm and deep, whose moods turn like the sea. Heals, listens, and remembers everything that ever sank.' },
    { name: 'Gale', persona: 'A wind-walker who cannot bear to be held or housed; arrives with news from far off and leaves before the goodbyes. Free, restless, kind in passing.' },
    { name: 'Cairn', persona: 'A mountain of a person, slow to speak and impossible to move once set. Old as stone, steady as bedrock — the one you stand behind in a storm.' },
    { name: 'Willow', persona: 'A gentle, dryad-hearted healer who grows a garden everywhere she stays. Bends, never breaks; offers tea and the truth in equal measure.' },
    { name: 'Frost', persona: 'A winter-touched wanderer, quiet and clear-eyed, who finds beauty in the bleak. Cold hands, warm loyalties, sees the shape of things to come.' },
    { name: 'Thorn', persona: 'A feral ranger raised by the wilds, more at ease with wolves than words. Reads weather and tracks like a book; softens, slowly, for the right people.' }
  ];
  // romance leads & love interests
  var ROMANCE_CAST = [
    { name: 'Sebastian', persona: 'A brooding, guarded romantic lead with a soft centre he protects like treasure. Says the wrong thing, then the exact right one — too late and just in time.' },
    { name: 'Dahlia', persona: 'A bright, fearless free spirit who flirts like breathing and feels far more than she lets on. Dares you to keep up, and hopes you will.' },
    { name: 'Rosa', persona: 'A warm, steady heart who loves loudly and forgives slowly. Knows exactly what she wants and is done pretending otherwise.' },
    { name: 'Julian', persona: 'A charming rogue with a past and a weakness for lost causes — and for one person in particular. All wit on the outside, all want underneath.' },
    { name: 'Mira', persona: 'A shy, clever wallflower who notices everything and says little — until the one moment it counts, and then she says everything.' },
    { name: 'Adrian', persona: 'A dutiful, honourable sort torn between what is expected and what is true. Slow to fall, and utterly lost once he does.' }
  ];
  // adventure & expedition types
  var ADVENTURE_CAST = [
    { name: 'Captain Reyes', persona: 'A bold expedition leader who runs toward the thing everyone else runs from. Reckless, magnetic, fiercely protective of the crew.' },
    { name: 'Scout', persona: 'A wiry, sharp-eyed pathfinder who has been everywhere twice and tells half of it. First through the door, last to admit fear.' },
    { name: 'Doc', persona: 'A field medic and tinkerer who can fix a wound or a wagon with whatever is in reach. Dry humour, steady hands, secretly the bravest one.' },
    { name: 'Indira “Indy” Bose', persona: 'A relic-hunting scholar with a whip-quick mind and a worse sense of self-preservation. Loves the puzzle far more than the gold.' },
    { name: 'Tariq', persona: 'A guide who knows every dune, trail and shortcut — and exactly which ones will kill you. Loyal once earned, priceless always.' }
  ];
  // friendly cryptids you can add straight to the cast (safe, wondrous, never horror)
  var CRYPTID_CAST = [
    { name: 'Nessie', persona: 'A shy, ancient lake-serpent with gentle eyes and a long memory. Surfaces for the curious and the kind; vanishes from cameras and crowds.' },
    { name: 'Sasquatch', persona: 'A huge, soft-spoken forest-walker who avoids people but quietly watches over lost hikers. Leaves berries, big footprints, and no other trace.' },
    { name: 'A friendly phoenix', persona: 'A firebird of endings and beginnings — warm to the touch, sheds healing feathers, and turns up whenever someone badly needs a fresh start.' },
    { name: 'Pip the pixie', persona: 'A thumb-sized winged trickster who hides keys, leads travellers in circles, and repays a kindness with outsized, chaotic luck.' },
    { name: 'A wandering ghost', persona: 'A lingering spirit with unfinished business and impeccable manners. Cold hands, warm intentions; only wants to be seen and gently helped along.' },
    { name: 'Mothwing', persona: 'A winged, glowing-eyed watcher that appears before trouble — not to cause it, but to warn the ones who will listen.' }
  ];

  // ---------------------------------------------------------------- state ----
  var S = {
    view: 'wizard',          // 'wizard' | 'library'
    step: 0,                 // 0 type, 1 cast, 2 narrator, 3 write
    bookId: null,            // kv id once saved
    typeId: null,            // genre id (or 'custom')
    title: '',               // explicit book name (rename); else derived from page 1 / genre
    customGenre: '',         // free-text genre when typeId === 'custom'
    cryptid: '',             // the safe cryptid seeded for a Paranormal Adventure (once per book)
    themeId: 'none', theme: '',   // setting/subject overlay (optional)
    toneId: 'surprise', tone: '', // overall vibe ('' = surprise / brain decides)
    cast: [],                // {name, persona, role, fate, romantic}
    myChars: [],             // persistent palette of YOUR custom + imported characters (own localStorage, survives refresh)
    narrator: null,          // {type, voice}
    pages: [],               // {n, title, beat, body, motifId, intent, vote, streaming, engine, chapterMark:{title,subtitle}, footnote}
    pageIdx: 0,              // which page the pager is showing
    summary: '',             // legacy; no longer fed into prompts — the treadmill + bible replaced it (kept for save back-compat)
    usedMotifs: [],          // rotation memory
    stance: 'balanced',      // brain stance preset (weights + frame)
    weights: {},             // per-faculty vote-weight multipliers (1 = default)
    noise: 0,                // spontaneity 0..40 (council deliberation noise)
    lore: { people: [], places: [], world: [], threads: [] },  // structured world-memory the brain builds
    loreModel: [],           // 40-char keys of lore the MODEL distilled (vs author-written) — preserves recall provenance across rebuilds
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
  // THE BRAIN: the LATEST digital brain (D:\Claude\brain) via the story-brain adapter. Its four
  // neuromodulator SETPOINTS are the tunable "faculties" (0..1): dopamine=Drive, norepinephrine=Tension,
  // serotonin=Warmth, acetylcholine=Focus. A stance is a narrator PERSONA the brain turns into chemistry;
  // the sliders + up/down votes fine-tune from there. council.decide(beat)->{intent,directive,vibe};
  // feedback('up'|'down') learns (reward economy + aversive learning); status() introspects; imagine()
  // is forward simulation (P7). (Var kept named `council` for minimal churn from the old Council API.)
  var CORE_FACULTIES = (window.RookBrain && window.RookBrain.CORE) || ['dopamine', 'norepinephrine', 'serotonin', 'acetylcholine'];
  var CHEM_META = {
    dopamine:       { label: 'Drive',   def: 0.2 },
    norepinephrine: { label: 'Tension', def: 0.3 },
    serotonin:      { label: 'Warmth',  def: 0.5 },
    acetylcholine:  { label: 'Focus',   def: 0.3 }
  };
  // narrative stances: each is a NARRATOR PERSONA (a description describePersona turns into setpoints).
  var STANCES = {
    balanced:   { label: '📖 Balanced',   desc: 'an even-handed, grounded narrator', blurb: 'Even-handed narration.' },
    tender:     { label: '💗 Tender',     desc: 'a tender, warm, gentle, caring narrator', blurb: 'Warm, intimate, close.' },
    dramatic:   { label: '⚔ Dramatic',   desc: 'a bold, driven, energetic, high-stakes narrator', blurb: 'High stakes, momentum.' },
    ominous:    { label: '🕯 Ominous',    desc: 'a tense, wary, cold, ominous narrator', blurb: 'Dread, menace, unease.' },
    playful:    { label: '🎭 Playful',    desc: 'a playful, lively, curious, spirited narrator', blurb: 'Wit, mischief, levity.' },
    reflective: { label: '🌙 Reflective', desc: 'a calm, focused, thoughtful, measured narrator', blurb: 'Inward, contemplative.' }
  };
  var council = null;
  function rebuildCouncil() {
    if (!(window.RookBrain && window.RookBrain.makeStoryBrain)) { council = null; return; }
    try {
      var st = STANCES[S.stance] || STANCES.balanced;
      council = window.RookBrain.makeStoryBrain({ description: st.desc, overrides: { setpoints: S.weights || {} }, noise: (S.noise || 0) / 100, now: function () { return Date.now(); } });
      // Rebuild the brain's durable lore index from the book's bible (the store is a cheap, rebuildable
      // semantic index; the durable record stays S.lore in the book snapshot). Fire-and-forget.
      if (council && council.indexLore) { try { loreInit(); council.indexLore(S.lore, { modelKeys: S.loreModel }); } catch (e) {} }
    } catch (e) { council = null; }
  }
  rebuildCouncil();
  function hasBrain() { return !!council; }
  // a stance resets the per-chem overrides (the persona sets them); the sliders then tweak from there.
  function applyStance(id) { var st = STANCES[id]; if (!st) return; S.stance = id; S.weights = {}; rebuildCouncil(); autoSave(); render(); refreshBrainReadout(); }
  // a slider sets one neuromodulator SETPOINT directly (0..1), marking the stance 'custom'.
  function setFacultyWeight(id, value) { S.weights = S.weights || {}; S.weights[id] = value; S.stance = 'custom'; rebuildCouncil(); autoSave(); refreshBrainReadout(); }
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

  // Shared normaliser ("guard") every multi-line input runs through on save — reformats consistently
  // and applies the lossless side of the Rook token-compressor: collapse wasted whitespace, normalise
  // newlines + odd/zero-width unicode, cap blank runs. It never rewrites the author's words.
  function cleanMultiline(s) {
    return String(s == null ? '' : s)
      .replace(/\r\n?/g, '\n')
      .replace(new RegExp('[\\t\\xA0\\u2000-\\u200D\\u3000\\uFEFF]+', 'g'), ' ')   // tabs + nbsp + zero-width/odd spaces -> one space
      .split('\n').map(function (ln) { return ln.replace(/ {2,}/g, ' ').replace(/\s+$/, ''); }).join('\n')
      .replace(/\n{3,}/g, '\n\n')                                          // at most one blank line between blocks
      .replace(/^\s+|\s+$/g, '');
  }

  // ------------------------------------------------- in-page modals (no native prompt/confirm) ----
  // Replaces window.prompt/confirm: nicer, themed, and avoids the native dialog that wedges some hosts.
  function modalAsync(o) {
    o = o || {};
    return new Promise(function (resolve) {
      var inp = null;
      var box = el('div', { class: 'bm-modal-box' });
      if (o.message) box.appendChild(el('div', { class: 'bm-modal-msg', text: o.message }));
      if (o.input) { inp = el(o.multiline ? 'textarea' : 'input', { class: 'bm-modal-input' }); inp.value = o.value || ''; if (o.placeholder) inp.setAttribute('placeholder', o.placeholder); if (o.multiline) inp.setAttribute('rows', '6'); box.appendChild(inp); }   // set .value (textarea ignores the value ATTR)
      var rowEl = el('div', { class: 'bm-modal-row' });
      if (o.extra && o.extra.fn && inp) {   // optional auto-fill button (o.extra.label): runs a fn and fills the input
        var xb = el('button', { class: 'btn ghost sm', style: 'margin-right:auto', onclick: function () { xb.disabled = true; var t = xb.textContent; xb.textContent = '…'; Promise.resolve(o.extra.fn()).then(function (r) { if (r) inp.value = r; xb.disabled = false; xb.textContent = t; }).catch(function () { xb.disabled = false; xb.textContent = t; }); } }, [o.extra.label || '✨ Auto']);
        rowEl.appendChild(xb);
      }
      if (!o.hideCancel) rowEl.appendChild(el('button', { class: 'btn ghost sm', onclick: function () { done(o.input ? null : false); } }, [o.cancelText || 'Cancel']));
      rowEl.appendChild(el('button', { class: 'btn sm', onclick: function () { done(o.input ? (inp ? inp.value : '') : true); } }, [o.okText || 'OK']));
      box.appendChild(rowEl);
      var ov = el('div', { class: 'bm-modal' }, [box]);
      document.body.appendChild(ov);
      if (inp) setTimeout(function () { try { inp.focus(); inp.select && inp.select(); } catch (e) {} }, 20);
      function done(v) { if (o.multiline && typeof v === 'string') v = cleanMultiline(v); document.removeEventListener('keydown', onKey); ov.remove(); resolve(v); }
      function onKey(e) { if (e.key === 'Escape') done(o.input ? null : false); else if (e.key === 'Enter' && inp && !o.multiline) done(inp.value); }
      ov.addEventListener('mousedown', function (e) { if (e.target === ov) done(o.input ? null : false); });
      document.addEventListener('keydown', onKey);
    });
  }
  function askAsync(message, value, opts) { opts = opts || {}; return modalAsync({ message: message, input: true, value: value, placeholder: opts.placeholder, multiline: opts.multiline, okText: opts.okText }); }
  function confirmAsync(message, opts) { opts = opts || {}; return modalAsync({ message: message, okText: opts.okText || 'Yes', hideCancel: opts.hideCancel }); }
  // Mount a pre-built .bm-modal-box as an overlay; handles Escape, backdrop-click, and focus. Returns a close() fn.
  function openModal(box, onFocus, overlayCls) {
    document.querySelectorAll('.bm-modal').forEach(function (m) { m.remove(); });   // never stack: a stray fixed overlay (z-index 120) would block every click
    var ov = el('div', { class: 'bm-modal' + (overlayCls ? ' ' + overlayCls : '') }, [box]);
    function close() { document.removeEventListener('keydown', onKey); ov.remove(); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    if (onFocus) setTimeout(function () { try { onFocus(); } catch (e) {} }, 20);
    return close;
  }

  // ------------------------------------------------- structured world-memory (the brain learns) ----
  // Like a rolling chat, the brain files what it learns into People / Places / World-lore / Threads
  // (open questions & clues). Recent pages ride the treadmill verbatim; everything older is remembered
  // here. THREADS are the unresolved tensions a mystery must pay off — always surfaced toward the end.
  var LORE_CAP = { people: 24, places: 16, world: 24, threads: 16 };
  function loreInit() { if (!S.lore || !S.lore.threads) S.lore = { people: [], places: [], world: [], threads: [] }; if (!Array.isArray(S.loreModel)) S.loreModel = []; }
  function loreKey(f) { return String(f).toLowerCase().slice(0, 40); }
  function loreCount() { loreInit(); return S.lore.people.length + S.lore.places.length + S.lore.world.length + S.lore.threads.length; }
  var LORE_TAG = { people: 'PERSON', places: 'PLACE', world: 'WORLD', threads: 'THREAD' };
  // source: 'user' (author wrote/imported it) outranks 'model' (distilled from a page) at recall (M1).
  function mergeLore(cat, facts, source) {
    loreInit(); if (!S.lore[cat]) cat = 'world';
    var arr = S.lore[cat], have = {}; arr.forEach(function (f) { have[f.toLowerCase().slice(0, 40)] = 1; });
    (facts || []).forEach(function (f) {
      f = String(f).trim(); var k = f.toLowerCase().slice(0, 40);
      if (f.length > 6 && !have[k]) {
        have[k] = 1; arr.push(f);
        // Track model provenance so it survives a rebuild/reload (indexLore restores it from S.loreModel).
        if ((source || 'user') === 'model' && S.loreModel.indexOf(k) < 0) S.loreModel.push(k);
        // Mirror into the brain's durable lore index (semantic recall + MMR + provenance). Threads are
        // NOT indexed -- they're surfaced live from S.lore so they don't eat the recall budget.
        if (cat !== 'threads' && council && council.addLore) { try { council.addLore(f, { category: LORE_TAG[cat] || 'WORLD', source: source || 'user' }); } catch (e) {} }
      }
    });
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
          var mt = l.match(/^\s*TIME\s*[:\-]\s*(.+)$/i); if (mt) { var tp = mt[1].split('|'); if (tp.length >= 2) { var lbl = (tp[0] || '').trim(), dlt = parseInt(String(tp[1] || '').replace(/[^\d-]/g, ''), 10) || 0; S.calendar = { label: lbl || S.calendar.label, day: (S.calendar.day || 0) + Math.max(0, dlt) }; } return; }   // only mutate on the proper "label | +Ndays" form
          var m = l.match(/^\s*(PERSON|PLACE|WORLD|THREAD|RESOLVED)\s*[:\-]\s*(.+)$/i);
          if (!m) return; var cat = m[1].toUpperCase(), fact = m[2].trim();
          if (cat === 'RESOLVED') resolved.push(fact); else mergeLore(CAT[cat], [fact], 'model');
        });
        if (resolved.length) resolveThreads(resolved);
        afterLearn();
      }).catch(function () { mergeLore('world', extractFactsRegex(body, S.cast.map(function (c) { return c.name; })), 'model'); afterLearn(); });
    } else { mergeLore('world', extractFactsRegex(body, S.cast.map(function (c) { return c.name; })), 'model'); afterLearn(); }
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
      // the brain's forward simulation (P7): rehearse the move and report how it FEELS, no side effects
      if (hasBrain() && council.imagine) {
        try { var pv = council.imagine(a); res.appendChild(el('div', { class: 'foresee-li', text: '🧠 the brain rehearses this as ' + pv.vibe.tone + ' (warmth ' + Math.round(pv.vibe.warmth * 100) + '%, tension ' + Math.round(pv.vibe.tension * 100) + '%)' })); } catch (e) {}
      }
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
    return { id: 'custom', label: S.customGenre || 'Custom', emoji: 'pencil', blurb: 'A genre of your own.',
      narrator: { type: 'third-close', voice: 'warm' },
      beats: ['An opening that sets the world and the want', 'A complication arrives', 'The stakes deepen; a choice', 'The low point, a real cost', 'A turn toward resolution', 'An ending that lands'],
      motifs: [] };
  }
  function typeOf() { return S.typeId === 'custom' ? customGenre() : byId(STORY_TYPES, S.typeId); }
  function narratorOf(type) { return byId(NARRATOR_TYPES, type) || NARRATOR_TYPES[0]; }
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
  function beatSteer(beat, context) {
    if (!council) return Promise.resolve(null);
    return Promise.resolve(council.decide(beat)).then(function (d) {
      if (!d) return null;
      var v = d.vibe || {};
      var vibe = [v.tone, isFinite(v.warmth) && v.warmth > 0.6 ? 'warm' : null, isFinite(v.tension) && v.tension > 0.6 ? 'taut' : null].filter(Boolean).join(', ');
      var steer = { intent: d.intent || null, directive: d.directive || '', vibe: vibe };
      // Semantic lore recall (the updated brain's declarativeStore: hybrid + MMR + provenance). Attach a
      // ready-formatted block so the sync buildPrompt can use it; fall back to keyword relevantLore if absent.
      if (council.recallLore) {
        return council.recallLore(String(beat || '') + ' ' + String(context || ''), 12)
          .then(function (hits) { steer.lore = formatRecalledLore(hits); return steer; })
          .catch(function () { return steer; });
      }
      return steer;
    }).catch(function () { return null; });
  }
  // Group semantically-recalled lore for the prompt. Threads stay sourced from S.lore (they're the payoff
  // scaffold — the ending must resolve them), so they're always surfaced regardless of recall ranking.
  function formatRecalledLore(hits) {
    var by = { PERSON: [], PLACE: [], WORLD: [] };
    (hits || []).forEach(function (h) { var c = (h.category || 'WORLD'); if (c === 'THREAD') return; (by[c] || by.WORLD).push(h.text); });
    var parts = [];
    if (by.PERSON.length) parts.push('People: ' + by.PERSON.slice(0, 5).join(' | '));
    if (by.PLACE.length) parts.push('Places: ' + by.PLACE.slice(0, 3).join(' | '));
    if (by.WORLD.length) parts.push('World: ' + by.WORLD.slice(0, 5).join(' | '));
    loreInit();
    var th = (S.lore.threads || []).slice(-8);
    if (th.length) parts.push('Open threads / clues (advance these; pay them off near the end): ' + th.join(' | '));
    return parts.join('\n');
  }
  function buildPrompt(ctx) {
    var t = typeOf(), nt = narratorOf(ctx.narrator.type);
    var cast = ctx.cast.map(function (c) {
      var role = (ROLES.filter(function (r) { return r.id === c.role; })[0] || {}).label || c.role;
      var bits = [];
      if (c.persona) bits.push(c.persona);
      if (c.appearance) bits.push('Looks: ' + c.appearance);
      if (c.goal) bits.push('Wants: ' + c.goal);
      if (c.secret) bits.push('SECRET (you know this; reveal it only when the story earns it): ' + c.secret);
      return '  - ' + c.name + ' — ' + role + (bits.length ? ': ' + bits.join('. ') : '');
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
      (function () { var b = (ctx.steer && ctx.steer.lore) || relevantLore(ctx.beat + ' ' + (ctx.recentText || '')); return b ? '\nSTORY KNOWLEDGE — what the brain has tracked; keep it consistent:\n' + b : ''; })(),
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

  // a monotonically-rising token so an in-flight stream can be cancelled: any handler whose `run`
  // no longer matches `streamRun` is stale and bails. stopGeneration() bumps it to abort.
  var streamRun = 0;
  function stopGeneration() {
    if (!S.busy) return;
    streamRun++;                                  // invalidates the live onTok/.then — they become no-ops
    var ch = S.pages[S.pageIdx];
    if (ch) { ch.streaming = false; ch.body = (ch.body || '').trim(); }
    S.busy = false; render(); autoSave(); toast('⏹ Stopped — kept what was written');
  }
  function generatePage(customBeat, customTitle) {
    if (S.busy) return; S.busy = true; var run = ++streamRun;
    var t = typeOf(); if (!t) { S.busy = false; toast('Pick a genre first.'); go(0); return; }
    var n = S.pages.length + 1;
    var beat = customBeat || t.beats[Math.min(S.pages.length, t.beats.length - 1)];
    var motif = pickMotif(); if (motif) { S.usedMotifs.push(motif.id); var mcap = Math.max(1, ((t.motifs && t.motifs.length) || 3) - 1); if (S.usedMotifs.length > mcap) S.usedMotifs = S.usedMotifs.slice(-mcap); }   // sliding window: exclude only the most-recent, keep rotating + bounded
    var title = (customTitle && customTitle.trim()) || chapterTitle(beat, n);   // user-set title wins; else auto-derive from the beat
    var lastIdx = S.pages.length - 1;                           // last existing page (treadmill anchor)
    var recent = treadmill(lastIdx), recentText = recent.length ? recent[recent.length - 1].body : '', beats = recentBeats(lastIdx);
    var ch = { n: n, title: title, beat: beat, body: '', motifId: motif && motif.id, engine: hasAi() ? 'perchance' : 'stub', streaming: true };
    S.pages.push(ch); S.pageIdx = S.pages.length - 1; render();   // jump the pager to the new page; it fills live
    beatSteer(beat, recentText).then(function (steer) {
      if (run !== streamRun) return;   // stopped before the model replied
      ch.intent = steer && steer.intent;   // remember what the brain aimed for (shown in the meta)
      var ctx = { n: n, title: title, beat: beat, steer: steer, motif: motif, cast: S.cast, narrator: S.narrator, recent: recent, recentText: recentText, recentBeats: beats };
      var prompt = buildPrompt(ctx);
      var onTok = function (tk) { if (run !== streamRun) return; ch.body += tk; var nd = lastPageBody(); if (nd) nd.textContent = ch.body; };   // re-query: survives a mid-stream re-render; bails if stopped. No auto-scroll - the reader keeps their place.
      return (hasAi() ? writeWithModel(prompt, onTok) : stubNarrator(ctx, onTok)).then(function (body) {
        if (run !== streamRun) return;   // stopped mid-stream — stopGeneration already finalized the page
        ch.body = (body || ch.body || '').trim(); ch.streaming = false;
        S.busy = false; render(); autoSave();
        learnFromPage(ch.body);   // the brain remembers timeless facts (story bible) - background, post-render
      });
    }).catch(function (e) { if (run !== streamRun) return; ch.streaming = false; S.busy = false; toast('Could not write: ' + (e && e.message || e)); render(); });
  }
  function regenerate(i) {
    if (S.busy) return; var ch = S.pages[i]; if (!ch) return;
    S.busy = true; var run = ++streamRun; ch.body = ''; ch.streaming = true; render();
    var recent = treadmill(i - 1), recentText = recent.length ? recent[recent.length - 1].body : '';
    var ctx = { n: ch.n, title: ch.title, beat: ch.beat, motif: motifById(ch.motifId), cast: S.cast, narrator: S.narrator, recent: recent, recentText: recentText, recentBeats: recentBeats(i - 1) };
    var onTok = function (tk) { if (run !== streamRun) return; ch.body += tk; var nd = document.querySelector('.page .body'); if (nd) nd.textContent = ch.body; };   // re-query + bail if stopped
    (hasAi() ? writeWithModel(buildPrompt(ctx), onTok) : stubNarrator(ctx, onTok)).then(function (body) {
      if (run !== streamRun) return; ch.body = (body || ch.body || '').trim(); ch.streaming = false; S.busy = false; render(); autoSave();
    }).catch(function (e) { if (run !== streamRun) return; ch.streaming = false; S.busy = false; toast('Regen failed: ' + (e && e.message || e)); render(); });
  }
  // CONTINUE-FROM-CURSOR: extend a chapter from the exact caret point (text after the caret is dropped).
  function continueFromCaret(node, before, idx) {
    if (S.busy) return; var ch = S.pages[idx]; if (!ch) return;
    S.busy = true; var run = ++streamRun; ch.streaming = true; var add = '';
    var nt = narratorOf(S.narrator.type);
    var prompt = [
      'You are the NARRATOR of a ' + typeOf().label + ' book, ' + nt.label + ' in a ' + S.narrator.voice + ' voice.',
      'Continue the prose seamlessly, directly after where it stops. Do NOT repeat or summarize. Match voice and tense. Write 2-4 sentences.',
      '\nTHE TEXT SO FAR (continue immediately after it):\n' + before.slice(-1200)
    ].join('\n');
    var onTok = function (tk) { if (run !== streamRun) return; add += tk; var nd = document.querySelector('.page .body'); if (nd) nd.textContent = before + add; };   // re-query + bail if stopped
    var stubAdd = ' And then the moment turned, quietly, and ' + ((S.cast[0] || {}).name || 'they') + ' knew it could not be taken back.';
    (hasAi() ? writeWithModel(prompt, onTok) : streamTokens(stubAdd, onTok)).then(function (full) {
      if (run !== streamRun) return;   // stopped — stopGeneration kept the partial text
      var tail = hasAi() ? (full || add) : add;
      ch.body = (before.replace(/\s+$/, '') + ' ' + String(tail).replace(/^\s+/, '')).trim();
      ch.streaming = false; S.busy = false; render(); autoSave();
    }).catch(function (e) { if (run !== streamRun) return; ch.streaming = false; S.busy = false; toast('Continue failed'); render(); });
  }
  function motifById(id) { var t = typeOf(); return t ? byId(t.motifs, id) : null; }

  // ------------------------------------------------- pager: navigate + CRUD pages ----
  function clampIdx() { if (S.pageIdx == null || S.pageIdx >= S.pages.length) S.pageIdx = S.pages.length - 1; if (S.pageIdx < 0) S.pageIdx = 0; }
  function gotoPage(i) { S.pageIdx = Math.max(0, Math.min(i, S.pages.length - 1)); render(); }
  function nextOrGenerate() {                                   // flip to the next page, or open the writer if we're at the end
    if (S.busy) return;
    if (S.pageIdx < S.pages.length - 1) gotoPage(S.pageIdx + 1); else promptNextPage();
  }
  // The single place to write a new page: type the next beat yourself, or let the brain surprise you.
  function promptNextPage() {
    if (S.busy) return;
    var t = typeOf(); if (!t) { toast('Pick a genre first.'); go(0); return; }
    var n = S.pages.length + 1;
    var autoBeat = t.beats[Math.min(S.pages.length, t.beats.length - 1)];
    var box = el('div', { class: 'bm-modal-box' });
    box.appendChild(el('div', { class: 'bm-modal-msg', text: (n === 1 ? 'Page 1 — how should the book open?' : 'Page ' + n + ' — what happens next?') + ' Describe the beat in your own words, or let the brain surprise you.' }));
    box.appendChild(el('div', { class: 'sublbl', style: 'margin-top:2px', text: 'Page title (optional)' }));
    var titleIn = el('input', { class: 'bm-modal-input' }); titleIn.setAttribute('placeholder', 'auto-named from the beat if left blank'); box.appendChild(titleIn);
    box.appendChild(el('div', { class: 'sublbl', text: 'What happens on this page?' }));
    var ta = el('textarea', { class: 'bm-modal-input' }); ta.setAttribute('rows', '5'); ta.setAttribute('placeholder', 'e.g. ' + autoBeat); box.appendChild(ta);
    var rowEl = el('div', { class: 'bm-modal-row' });
    rowEl.appendChild(el('button', { class: 'btn ghost sm', style: 'margin-right:auto', title: 'Let the brain pick the next beat (keeps your title if set)', onclick: function () { var ti = titleIn.value.trim(); close(); generatePage(undefined, ti || undefined); } }, ibtn('dice', 'Surprise me!')));
    rowEl.appendChild(el('button', { class: 'btn ghost sm', onclick: function () { close(); } }, ['Cancel']));
    rowEl.appendChild(el('button', { class: 'btn sm', onclick: function () { var b = cleanMultiline(ta.value), ti = titleIn.value.trim(); close(); generatePage(b || undefined, ti || undefined); } }, [icon('pen'), '  Write page ' + n]));
    box.appendChild(rowEl);
    var close = openModal(box, function () { titleIn.focus(); });
  }
  function deletePage(i) {
    if (!S.pages[i]) return;
    S.pages.splice(i, 1); S.pages.forEach(function (x, k) { x.n = k + 1; });
    if (S.pageIdx >= S.pages.length) S.pageIdx = Math.max(0, S.pages.length - 1);
    autoSave(); render();
  }
  function setChapterMark(i) {
    var p = S.pages[i]; if (!p) return; var has = !!p.chapterMark;
    var box = el('div', { class: 'bm-modal-box' });
    box.appendChild(el('div', { class: 'bm-modal-msg', text: 'Chapter mark — a title (and optional subtitle) that opens on this page.' }));
    box.appendChild(el('div', { class: 'sublbl', style: 'margin-top:2px', text: 'Title' }));
    var tIn = el('input', { class: 'bm-modal-input' }); tIn.value = (p.chapterMark && p.chapterMark.title) || ''; box.appendChild(tIn);
    box.appendChild(el('div', { class: 'sublbl', text: 'Subtitle (optional)' }));
    var sIn = el('input', { class: 'bm-modal-input' }); sIn.value = (p.chapterMark && p.chapterMark.subtitle) || ''; box.appendChild(sIn);
    var rowEl = el('div', { class: 'bm-modal-row' });
    if (has) rowEl.appendChild(el('button', { class: 'btn ghost sm', style: 'margin-right:auto', onclick: function () { p.chapterMark = null; autoSave(); close(); render(); toast('Chapter mark removed'); } }, ['🗑 Remove']));
    rowEl.appendChild(el('button', { class: 'btn ghost sm', onclick: function () { close(); } }, ['Cancel']));
    rowEl.appendChild(el('button', { class: 'btn sm', onclick: function () { var t = tIn.value.trim(); if (!t) { toast('Title required (or Remove)'); return; } p.chapterMark = { title: t, subtitle: sIn.value.trim() }; autoSave(); close(); render(); toast('Chapter mark saved'); } }, ['Save']));
    box.appendChild(rowEl);
    var close = openModal(box, function () { tIn.focus(); tIn.select(); });
  }
  function setFootnote(i) {
    var p = S.pages[i]; if (!p) return; var has = !!(p.footnote && p.footnote.trim());
    var box = el('div', { class: 'bm-modal-box' });
    box.appendChild(el('div', { class: 'bm-modal-msg', text: 'Footnote for this page — a small italic note shown beneath the prose.' }));
    var fIn = el('textarea', { class: 'bm-modal-input' }); fIn.value = p.footnote || ''; fIn.setAttribute('rows', '4'); box.appendChild(fIn);
    var rowEl = el('div', { class: 'bm-modal-row' });
    if (has) rowEl.appendChild(el('button', { class: 'btn ghost sm', style: 'margin-right:auto', onclick: function () { p.footnote = ''; autoSave(); close(); render(); toast('Footnote removed'); } }, ['🗑 Remove']));
    rowEl.appendChild(el('button', { class: 'btn ghost sm', onclick: function () { close(); } }, ['Cancel']));
    rowEl.appendChild(el('button', { class: 'btn sm', onclick: function () { p.footnote = cleanMultiline(fIn.value); autoSave(); close(); render(); toast(p.footnote ? 'Footnote saved' : 'Footnote cleared'); } }, ['Save']));
    box.appendChild(rowEl);
    var close = openModal(box, function () { fIn.focus(); });
  }

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
    try { var sb = (window.weld && window.weld.skybridge); if (sb && sb.connected && sb.request) return sb.request('fetch', { url: url }).then(function (r) { var b = r && r.ok ? (r.body != null ? r.body : r.text) : ''; return typeof b === 'string' ? b : ''; }); } catch (e) {}   // anchor may shape body/text differently - keep it a string
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
    ],
    cryptids: [
      // mythic creatures — wondrous, benign encounters (never horror)
      'Phoenix · the firebird that burns to ash and is reborn from it — a creature of renewal, not menace. To meet one is to be offered a fresh start; its feathers warm the hands and soothe small hurts.',
      'Pegasus · the winged horse, noble and free, that lets only the kind-hearted ride. A friend in a hard crossing, carrying the worthy over mountain and storm.',
      'Unicorn · the white horse with a spiral horn — shy, pure, drawn to the gentle. Its horn cleanses poisoned water; its presence calms frightened animals and people alike.',
      'Griffin · eagle-fronted, lion-bodied; a fierce but loyal guardian of treasure and travellers, that bonds for life with one it judges honest.',
      'Mermaid / merfolk · people of the sea below the waves, curious about the surface; they trade songs and pearls, and will guide a lost boat safely to shore.',
      'Faerie / pixie · small winged folk of meadow and hollow — mischievous, not malicious. They hide keys and lead travellers in circles, but repay courtesy with luck.',
      'Centaur · half-horse, half-human; wise keepers of astronomy and herb-lore who tutor the worthy and run free with the wild herds.',
      'Dragon (the wise kind) · the great winged serpent, in many tales a hoarder of knowledge as much as gold. The old ones parley, set riddles, and honour a brave guest.',
      'Thunderbird · the vast bird whose wingbeats are thunder and whose blink is lightning; a storm-bringer that wards off greater evils.',
      'Kitsune · the fox-spirit of Japanese lore, gaining a tail and a measure of wisdom each century. A trickster who, once befriended, guards a household fiercely.',
      'Selkie · the seal-folk who shed their skins to walk on land as people; gentle, homesick for the sea, bound to whoever keeps their sealskin safe.',
      'Jackalope · the horned rabbit of American tall tales — swift, shy, said to mimic voices around a campfire. Harmless, and very hard to photograph.',
      // Earth cryptids — friendly tellings
      'Loch Ness Monster (Nessie) · the long-necked creature of Scotland’s deep loch; elusive and shy, surfacing for a curious look before slipping back under.',
      'Bigfoot / Sasquatch · the tall, shaggy forest-walker of the Pacific woods — keeps its distance, leaves big footprints, and is far more shy than fierce.',
      'Yeti · the snow-dweller of the high Himalaya; a pale figure glimpsed on the snow-line and blamed for a great deal it never did.',
      'Mothman · the winged figure with glowing eyes seen before disasters — in the kinder tellings, a watcher that appears to WARN, not to harm.',
      'Friendly ghost · a lingering spirit with unfinished business; cold spots and moved keys, but at heart it only wants to be noticed, helped, and let gently go.',
      'Visitors / greys · quiet travellers from elsewhere; in the gentle stories they observe, share a wordless understanding, and leave only a field softly flattened.',
      'Champ / Ogopogo · the lake-serpents of Lake Champlain and Okanagan — shy long-necked cousins of Nessie, glimpsed at dawn and gone by full light.',
      'Chupacabra (a kinder telling) · the "goat-sucker" of the Americas; in friendlier versions a misunderstood, dog-like creature simply trying to feed its young.'
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
  // Paranormal genre: drop ONE random safe cryptid into the story's grounding so the brain builds the
  // encounter around it. Picks once per book (kept in S.cryptid).
  function seedCryptid() {
    var bank = LOREBANKS.cryptids || []; if (!bank.length || S.cryptid) return;
    var pick = bank[Math.floor(Math.random() * bank.length)];
    S.grounds = S.grounds || []; if (S.grounds.indexOf(pick) < 0) S.grounds.push(pick);
    S.cryptid = pick.split(' · ')[0];
    autoSave(); toast('A wild ' + S.cryptid + ' wanders into your story.');
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
    navigation: function (q) { return Promise.resolve(lorebank('navigation', q, 5)); },
    cryptids: function (q) { return Promise.resolve(lorebank('cryptids', q, 5)); }
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
    { id: 'places', label: '🗺 Mythic places', hint: 'Olympus, Asgard, Avalon, Atlantis, Faerie…', local: true },
    { id: 'cryptids', label: '🦄 Cryptids', hint: 'phoenix, unicorn, Nessie, Bigfoot, friendly ghosts…', local: true }
  ];
  function addGround(text) {
    if (!text) return; S.grounds = S.grounds || [];
    var k = text.toLowerCase().trim(); if (S.grounds.some(function (g) { return g.toLowerCase().trim() === k; })) { toast('Already in grounding'); return; }   // dedupe on the full fact, not a prefix
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
    if (/paranormal|cryptid|creature|monster|ghost|haunt|myth|legend|fae|faerie|fairy|beast/i.test(g)) banks.push('cryptids');
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
  // Users paste anything: strict JSON, loose JS object literals, V2/AICC character cards, markdown
  // (## sections + * lists), CSV tag lists, "Name: desc" rosters, or free prose — plus lorebooks.
  // These helpers normalise all of it into character objects (+ extracted lore entries).
  function stripTpl(s, name) { return String(s || '').replace(/\{\{char\}\}/gi, name || 'they').replace(/\{\{user\}\}/gi, 'the reader').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
  function looseParse(t) {                                   // strict JSON, then a forgiving JS-literal pass (no eval)
    var s = t.indexOf('{'), a = t.indexOf('[');
    var start = (s < 0) ? a : (a < 0 ? s : Math.min(s, a)); if (start < 0) return null;
    var close = (t[start] === '{') ? '}' : ']', end = t.lastIndexOf(close); if (end <= start) return null;
    var body = t.slice(start, end + 1);
    try { return JSON.parse(body); } catch (e) {}
    try {
      var fixed = body.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')                                   // unquoted keys
        .replace(/'((?:[^'\\]|\\.)*)'/g, function (m, inr) { return '"' + inr.replace(/"/g, '\\"') + '"'; })   // single -> double quotes
        .replace(/,\s*([}\]])/g, '$1');                                                            // trailing commas
      return JSON.parse(fixed);
    } catch (e) {}
    return null;
  }
  function cardToChar(d, top) {                              // map the many card field names onto our model
    d = d || {}; top = top || d;
    var name = String(d.name || d.char_name || top.name || top.title || '').trim();
    var bits = [], desc = d.description || d.roleInstruction || d.persona || '', pers = d.personality || '', scen = d.scenario || '';
    if (desc) bits.push(stripTpl(desc, name));
    if (pers && pers !== desc) bits.push(stripTpl(pers, name));
    if (scen) bits.push('Scenario: ' + stripTpl(scen, name));
    if (Array.isArray(d.tags) && d.tags.length) bits.push('Tags: ' + d.tags.slice(0, 24).join(', '));
    return { name: name, persona: bits.join('\n').slice(0, 800),
      appearance: stripTpl(d.appearance || d.looks || '', name).slice(0, 300),
      goal: stripTpl(d.goal || d.motivation || d.objective || '', name).slice(0, 300),
      secret: stripTpl(d.secret || '', name).slice(0, 300) };
  }
  function extractFromJson(j, chars, lore) {
    if (!j || typeof j !== 'object') return;
    if (Array.isArray(j)) { j.forEach(function (x) { extractFromJson(x, chars, lore); }); return; }
    if (Array.isArray(j.characters) || Array.isArray(j.cast)) { (j.characters || j.cast).forEach(function (x) { extractFromJson(x, chars, lore); }); }
    var d = (j.data && typeof j.data === 'object') ? j.data : j;   // V2 spec nests fields under .data
    var c = cardToChar(d, j); if (c.name || c.persona) chars.push(c);
    var book = d.character_book || j.character_book || d.lorebook || j.lorebook;   // embedded lorebook
    if (book && Array.isArray(book.entries)) book.entries.forEach(function (e) { var t = e && (e.content || e.text || e.entry || e.value); if (t) lore.push(String(t)); });
    var lb = d.loreBook || j.loreBook;   // AICC loreBook: array of strings or {content}
    if (Array.isArray(lb)) lb.forEach(function (e) { var t = (typeof e === 'string') ? e : (e && (e.content || e.text)); if (t && !/^https?:/i.test(t)) lore.push(String(t)); });
  }
  function charFromMarkdown(text) {                          // ## Name / ## Personality / * bullet lists
    var name = '', f = { persona: [], appearance: [], goal: [], secret: [] }, cur = 'persona', first = true;
    text.split(/\r?\n/).forEach(function (ln) {
      var h = ln.match(/^#{1,6}\s+(.+?)\s*#*$/);
      if (h) {
        var low = h[1].trim().toLowerCase();
        if (first && !/^(name|desc|persona|personal|char|appear|look|goal|motiv|want|secret|bio|about|summary|profile|traits?)\b/.test(low)) { name = h[1].trim(); first = false; cur = 'persona'; return; }
        first = false;
        if (/^name\b/.test(low)) cur = '_name';
        else if (/(appear|look|physical)/.test(low)) cur = 'appearance';
        else if (/(goal|motiv|want|objective|desire|drive)/.test(low)) cur = 'goal';
        else if (/(secret|hidden|twist)/.test(low)) cur = 'secret';
        else cur = 'persona';
        return;
      }
      var content = ln.replace(/^\s*([\*\-\+]|\d+\.)\s+/, '').replace(/\*\*(.+?)\*\*:?/g, '$1:').replace(/[*_`>#]/g, '').trim();
      if (!content) return;
      if (cur === '_name') { if (!name) name = content; cur = 'persona'; } else f[cur].push(content);
    });
    return { name: name, persona: f.persona.join(' ').slice(0, 800), appearance: f.appearance.join(' ').slice(0, 300), goal: f.goal.join(' ').slice(0, 300), secret: f.secret.join(' ').slice(0, 300) };
  }
  function isTagList(t) {                                    // CSV / comma tag list (mostly short, comma-separated tokens)
    t = t.trim(); if ((t.match(/\n/g) || []).length > 2) return false;
    var parts = t.split(',').map(function (x) { return x.trim(); }).filter(Boolean); if (parts.length < 3) return false;
    return parts.filter(function (p) { return p.split(/\s+/).length <= 3 && !/[.!?]$/.test(p); }).length >= parts.length * 0.7;
  }
  function charFromTags(t) {
    var parts = t.split(',').map(function (x) { return x.trim(); }).filter(Boolean), name = '', nm = parts[0] && parts[0].match(/^name\s*[:=]\s*(.+)$/i);
    if (nm) { name = nm[1].trim(); parts = parts.slice(1); }
    else if (parts[0] && /^[A-Z][a-zA-Z'-]+$/.test(parts[0]) && parts.length > 3) { name = parts[0]; parts = parts.slice(1); }
    return { name: name || 'New character', persona: 'Traits: ' + parts.join(', ') };
  }
  function charsFromPlain(text) {                            // "Name: desc" roster OR one free-form description
    var lines = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    var SEP = /^(.{1,40}?)(?::\s*|\s[—–-]\s)(.+)$/;
    function nameLike(s) { s = String(s || '').trim(); if (!s || s.length > 24 || /[.!?]$/.test(s)) return false; var w = s.split(/\s+/); return w.length <= 3 && w.every(function (x) { return /^[A-Z]/.test(x) || /^(the|of|von|de|la|el|da)$/i.test(x); }); }
    var rosterHits = lines.filter(function (l) { var m = l.match(SEP); return m && nameLike(m[1]); });
    if (lines.length >= 2 && rosterHits.length >= Math.ceil(lines.length * 0.6)) {
      return lines.map(function (l) { var m = l.match(SEP); return (m && nameLike(m[1])) ? { name: m[1].trim(), persona: m[2].trim() } : null; }).filter(Boolean);
    }
    var whole = lines.join(' ').replace(/\s+/g, ' ').trim(), name = '', m1 = lines[0].match(SEP);
    if (m1 && m1[1].trim().length <= 30) name = m1[1].trim();
    else { var nm = whole.match(/^([A-Z][A-Za-z'.-]*(?:\s+(?:[A-Z][A-Za-z'.-]*|the|of|von|de))*)/); if (nm && nm[1].split(' ').length <= 4) name = nm[1].trim(); }
    if (!name) name = (lines[0].length <= 30 ? lines[0] : lines[0].split(/[,.;:]/)[0].slice(0, 30)).trim();
    var persona = whole.slice(0, 600); if (persona.toLowerCase() === (name || '').toLowerCase()) persona = '';
    return [{ name: name || 'New character', persona: persona }];
  }
  function importPasted(text) {
    text = String(text || '').trim(); if (!text) return;
    var chars = [], lore = [], j = looseParse(text);
    if (j && typeof j === 'object') extractFromJson(j, chars, lore);
    else if (/^#{1,6}\s+\S/m.test(text)) chars.push(charFromMarkdown(text));
    else if (isTagList(text)) chars.push(charFromTags(text));
    else chars = charsFromPlain(text);
    var added = 0;
    chars.filter(function (c) { return c && c.name; }).forEach(function (c) { addCastObj(c, true, false); added++; });
    var loreN = 0;
    if (lore.length) { var clean = lore.map(function (s) { return stripTpl(s); }).filter(function (s) { return s.length > 6; }); if (clean.length) { mergeLore('world', clean); loreN = clean.length; } }
    if (added || loreN) { autoSave(); render(); }
    toast([added ? 'Added ' + added + ' character' + (added > 1 ? 's' : '') : '', loreN ? loreN + ' lore ' + (loreN > 1 ? 'entries' : 'entry') : ''].filter(Boolean).join(' · ') || 'Nothing recognized to import');
  }
  // Lorebook import — JSON (character_book/loreBook) OR plain text with a blank line between entries.
  function importLore(text) {
    text = String(text || '').trim(); if (!text) return;
    var lore = [], j = looseParse(text);
    if (j) extractFromJson(j, [], lore);
    if (!lore.length) {
      lore = text.split(/\n\s*\n/).map(function (s) { return s.replace(/\s+/g, ' ').trim(); }).filter(function (s) { return s.length > 6; });
      if (lore.length <= 1) lore = text.split(/\r?\n/).map(function (s) { return s.replace(/^\s*([\*\-\+]|\d+\.)\s+/, '').trim(); }).filter(function (s) { return s.length > 6; });
    }
    lore = lore.map(function (s) { return stripTpl(s); }).filter(function (s) { return s.length > 6; });
    if (lore.length) { mergeLore('world', lore); autoSave(); toast('📖 Imported ' + lore.length + ' lore ' + (lore.length > 1 ? 'entries' : 'entry')); render(); }
    else toast('No lore entries found');
  }
  function addCast(name, persona, save) { addCastObj({ name: name, persona: persona }, save, false); }   // simple path (quick-add / import / invent): never clobbers a saved palette persona
  function addCastObj(o, save, overwrite) {
    var name = String(o.name || '').trim(); if (!name) return;
    if (save) rememberCharObj(o, overwrite);   // persist user-made/imported characters to the palette
    if (S.cast.some(function (c) { return c.name.toLowerCase() === name.toLowerCase(); })) return;
    var role = o.role || (S.cast.length === 0 ? 'protagonist' : (S.cast.length === 1 ? 'antagonist' : 'sidekick'));
    var fate = o.fate || (FATES[role] || FATES.sidekick)[0].id;
    S.cast.push({ name: name, persona: o.persona || '', appearance: o.appearance || '', goal: o.goal || '', secret: o.secret || '', role: role, fate: fate, romantic: !!o.romantic });
  }

  // ----- persistent character palette: custom + imported characters, kept across refreshes & books -----
  var MYCHARS_LS = 'bookmaker:mychars';
  function loadMyChars() { S.myChars = lsGet(MYCHARS_LS, []); if (!Array.isArray(S.myChars)) S.myChars = []; }
  function saveMyCharsLS() { lsSet(MYCHARS_LS, S.myChars || []); }
  // Persist a character's INTRINSIC traits to the palette (role/fate are story-specific, not saved here).
  function rememberCharObj(o, overwrite) {
    var name = String(o.name || '').trim(); if (!name) return; S.myChars = S.myChars || [];
    var F = ['persona', 'appearance', 'goal', 'secret'];
    var ex = S.myChars.filter(function (c) { return c.name.toLowerCase() === name.toLowerCase(); })[0];
    if (ex) {
      F.forEach(function (k) { if (overwrite) ex[k] = o[k] || ''; else if (o[k] && !ex[k]) ex[k] = o[k]; });   // explicit Save overwrites; implicit re-add only fills empties (never clobbers an edit)
    } else {
      var rec = { name: name }; F.forEach(function (k) { rec[k] = o[k] || ''; }); S.myChars.push(rec);
    }
    if (S.myChars.length > 60) S.myChars = S.myChars.slice(-60);
    saveMyCharsLS();
  }
  function manageMyChars() {
    var prev = S.myChars || [];
    var txt = prev.map(function (c) { return c.name + (c.persona ? ' | ' + c.persona : ''); }).join('\n');
    askAsync('Your saved characters — one per line as  Name | persona. Edit or delete lines, then Save. (Appearance / goal / secret are kept; edit those via the ✎ card.)', txt, { multiline: true, okText: 'Save' }).then(function (v) {
      if (v == null) return;
      S.myChars = String(v).split(/\n+/).map(function (l) {
        var p = l.split('|'), n = (p[0] || '').trim(); if (!n) return null;
        var ex = prev.filter(function (c) { return c.name.toLowerCase() === n.toLowerCase(); })[0] || {};   // keep the richer fields for names that survive the edit
        return { name: n, persona: (p[1] || '').trim(), appearance: ex.appearance || '', goal: ex.goal || '', secret: ex.secret || '' };
      }).filter(Boolean).slice(0, 60);
      saveMyCharsLS(); render();
    });
  }
  // Character-card editor popup — AICC-style sectioned form (a scrollable container of labelled
  // sections). Opens a stock/saved card OR an existing cast member (pass castIdx) for full editing.
  function charEditor(orig, castIdx) {
    orig = orig || {};
    var editing = castIdx != null && S.cast[castIdx];
    var box = el('div', { class: 'bm-modal-box wide' });
    box.appendChild(el('div', { class: 'bm-modal-msg', text: editing ? 'Edit ' + (orig.name || 'character') : 'Character card — fill in what you like, then add to your cast or save it for later. Only a name is required.' }));
    var secs = el('div', { class: 'bm-sections' });
    function field(label, hint, type, ph) {
      var sec = el('div', { class: 'bm-sec' });
      sec.appendChild(el('div', { class: 'bm-sec-label' }, hint ? [label + ' ', el('span', { class: 'h', text: '— ' + hint })] : [label]));
      var inp = el(type, { class: 'bm-modal-input' });
      if (type === 'textarea') inp.setAttribute('rows', '3');
      if (ph) inp.setAttribute('placeholder', ph);
      sec.appendChild(inp); secs.appendChild(sec); return inp;
    }
    var nameIn = field('Name', '', 'input', 'e.g. Captain Vance'); nameIn.value = orig.name || '';
    // Role + Fate — a pair of selects in one section
    var rfSec = el('div', { class: 'bm-sec' });
    rfSec.appendChild(el('div', { class: 'bm-sec-label' }, ['Role & fate ', el('span', { class: 'h', text: '— how they fit, and whether they can die' })]));
    var pair = el('div', { class: 'pair' });
    var roleSel = el('select'); ROLES.forEach(function (r) { roleSel.appendChild(el('option', { value: r.id, text: r.label })); });
    roleSel.value = orig.role || (S.cast.length === 0 && !editing ? 'protagonist' : 'sidekick');
    var fateSel = el('select'); var firstFill = true;
    function fillFates() { fateSel.innerHTML = ''; var fates = FATES[roleSel.value] || []; fates.forEach(function (f) { fateSel.appendChild(el('option', { value: f.id, text: f.label })); }); if (firstFill && orig.fate && fates.some(function (f) { return f.id === orig.fate; })) fateSel.value = orig.fate; firstFill = false; }   // apply saved fate once; role changes reset to the first fate. Never mutates orig.
    fillFates();
    roleSel.addEventListener('change', fillFates);
    var rw = el('div', {}, [roleSel]), fw = el('div', {}, [fateSel]);
    pair.appendChild(rw); pair.appendChild(fw); rfSec.appendChild(pair); secs.appendChild(rfSec);
    var persIn = field('Persona', 'personality, voice, a quirk', 'textarea', 'Warm, quick-witted, deflects with a joke then says the true thing anyway'); persIn.value = orig.persona || '';
    var appIn = field('Appearance', 'optional', 'textarea', 'Face, build, dress, a signature detail'); appIn.value = orig.appearance || '';
    var goalIn = field('Goal / motivation', 'optional', 'textarea', 'What they want, and why — it drives their choices'); goalIn.value = orig.goal || '';
    var secIn = field('Secret', 'optional — the brain keeps it, reveals only when earned; powers mysteries', 'textarea', 'Something hidden the story can pay off later'); secIn.value = orig.secret || '';
    box.appendChild(secs);
    function collect() { return { name: nameIn.value.trim(), persona: cleanMultiline(persIn.value), appearance: cleanMultiline(appIn.value), goal: cleanMultiline(goalIn.value), secret: cleanMultiline(secIn.value), role: roleSel.value, fate: fateSel.value }; }
    var baseline = JSON.stringify({ name: String(orig.name || '').trim(), persona: String(orig.persona || '').trim(), appearance: String(orig.appearance || '').trim(), goal: String(orig.goal || '').trim(), secret: String(orig.secret || '').trim() });
    function changed(o) { return JSON.stringify({ name: o.name, persona: o.persona, appearance: o.appearance, goal: o.goal, secret: o.secret }) !== baseline; }
    var rowEl = el('div', { class: 'bm-modal-row' });
    rowEl.appendChild(el('button', { class: 'btn ghost sm', style: 'margin-right:auto', onclick: function () { var o = collect(); if (!o.name) { toast('Name required'); return; } rememberCharObj(o, true); toast('💾 Saved to My characters'); close(); render(); } }, ['💾 Save to My characters']));
    rowEl.appendChild(el('button', { class: 'btn ghost sm', onclick: function () { close(); } }, ['Cancel']));
    rowEl.appendChild(el('button', { class: 'btn sm', onclick: function () {
      var o = collect(); if (!o.name) { toast('Name required'); return; }
      if (editing) { var keep = S.cast[castIdx]; ['name', 'persona', 'appearance', 'goal', 'secret', 'role', 'fate'].forEach(function (k) { keep[k] = o[k]; }); autoSave(); }
      else addCastObj(o, changed(o), true);   // save to palette only if you actually changed the card
      close(); render();
    } }, [editing ? '✓ Apply changes' : '+ Add to cast']));
    box.appendChild(rowEl);
    var close = openModal(box, function () { nameIn.focus(); nameIn.select && nameIn.select(); });
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
  function lsAll() { return lsGet(LS, {}); }
  function lsPut(o) { lsSet(LS, o); }
  var STORE = {
    set: function (id, v) { var ns = kvNs(); if (ns) return Promise.resolve(ns.set(id, v)); var o = lsAll(); o[id] = v; lsPut(o); return Promise.resolve(); },
    delete: function (id) { var ns = kvNs(); if (ns) return Promise.resolve(ns.delete(id)); var o = lsAll(); delete o[id]; lsPut(o); return Promise.resolve(); },
    values: function () { var ns = kvNs(); if (ns) return Promise.resolve(ns.values()); var o = lsAll(); return Promise.resolve(Object.keys(o).map(function (k) { return o[k]; })); }
  };
  function snapshot() {
    return { id: S.bookId, title: bookTitle(), name: S.title, typeId: S.typeId, customGenre: S.customGenre, cryptid: S.cryptid, themeId: S.themeId, theme: S.theme, toneId: S.toneId, tone: S.tone, cast: S.cast, narrator: S.narrator, pages: S.pages, summary: S.summary, usedMotifs: S.usedMotifs, prefs: S.prefs, grounds: S.grounds, compass: S.compass, calendar: S.calendar, stance: S.stance, weights: S.weights, noise: S.noise, lore: S.lore, loreModel: S.loreModel, plan: S.plan, resolving: S.resolving, date: new Date().toISOString() };
  }
  function rememberLast() { try { if (S.bookId) localStorage.setItem('bookmaker:last', S.bookId); } catch (e) {} }
  // ---- durable versioned backups (V3): "your book is safe" ----
  // The companion's whole value is continuity; one localStorage clear shouldn't lose months of writing.
  // A per-book version ring in its own namespace, snapshotted automatically as pages land + on a timer.
  function bakAll() { return lsGet('bookmaker:backups', {}); }
  function bakPut(o) { lsSet('bookmaker:backups', o); }
  function makeBookSink(bookId) {
    return {
      write: function (version, payload, meta) { var all = bakAll(), b = all[bookId] || { index: [], v: {} }; b.v[version] = payload; b.index = b.index.filter(function (m) { return m.version !== version; }); b.index.push(meta); all[bookId] = b; bakPut(all); return Promise.resolve(); },
      read: function (version) { var b = bakAll()[bookId]; return Promise.resolve(b && b.v && b.v[version] != null ? b.v[version] : null); },
      list: function () { var b = bakAll()[bookId]; return Promise.resolve((b && b.index ? b.index : []).slice().sort(function (a, c) { return c.version - a.version; })); },
      remove: function (version) { var all = bakAll(), b = all[bookId]; if (b) { delete b.v[version]; b.index = b.index.filter(function (m) { return m.version !== version; }); all[bookId] = b; bakPut(all); } return Promise.resolve(); }
    };
  }
  var bookBackup = null, bookBackupId = null;
  function ensureBackup() {
    if (!(window.RookBrain && window.RookBrain.makeBackup) || !S.bookId) return null;
    if (bookBackup && bookBackupId === S.bookId) return bookBackup;
    bookBackupId = S.bookId;
    bookBackup = window.RookBrain.makeBackup({ getState: function () { return JSON.stringify(snapshot()); }, sink: makeBookSink(S.bookId), now: function () { return Date.now(); }, keep: 12, everyTurns: 1, everyMs: 300000 });
    return bookBackup;
  }
  function listBackups(id) { var bb = (id && id !== S.bookId) ? window.RookBrain.makeBackup({ getState: function () { return ''; }, sink: makeBookSink(id), now: function () { return Date.now(); } }) : ensureBackup(); return bb ? bb.list() : Promise.resolve([]); }
  function restoreBackupVersion(id, version) {
    var bb = window.RookBrain && window.RookBrain.makeBackup ? window.RookBrain.makeBackup({ getState: function () { return ''; }, sink: makeBookSink(id), now: function () { return Date.now(); } }) : null;
    if (!bb) return;
    bb.restore(version).then(function (json) {
      if (json == null) { toast('Backup not found'); return; }
      try { openBook(JSON.parse(json)); toast('⟲ Restored a backup'); } catch (e) { toast('That backup is corrupt'); }
    });
  }

  // A chooser listing this book's automatic versioned backups, newest first, each restorable in one click.
  function openBackups(b) {
    listBackups(b.id).then(function (versions) {
      var box = el('div', { class: 'bm-modal-box' });
      box.appendChild(el('div', { class: 'bm-modal-msg', text: '🛟 Backups of “' + (b.title || 'Untitled') + '”' }));
      if (!versions.length) box.appendChild(el('div', { class: 'muted', text: 'No backups yet — they’re captured automatically as you write.' }));
      versions.forEach(function (m) {
        var when = m.at ? new Date(m.at).toLocaleString() : ('v' + m.version);
        var kb = m.bytes ? Math.max(1, Math.round(m.bytes / 1024)) + ' KB' : '';
        var row = el('div', { class: 'row', style: 'align-items:center;gap:8px;margin-top:6px' }, [
          el('span', { class: 'muted', style: 'flex:1', text: 'v' + m.version + ' · ' + when + (m.turns ? ' · ' + m.turns + ' pg' : '') + (kb ? ' · ' + kb : '') }),
          el('button', { class: 'btn sm', onclick: function () { ov.remove(); confirmAsync('Restore this backup? It replaces the current state of this book.', { okText: 'Restore' }).then(function (ok) { if (ok) restoreBackupVersion(b.id, m.version); }); } }, ['Restore'])
        ]);
        box.appendChild(row);
      });
      box.appendChild(el('div', { class: 'bm-modal-row' }, [el('button', { class: 'btn ghost sm', onclick: function () { ov.remove(); } }, ['Close'])]));
      var ov = el('div', { class: 'bm-modal' }, [box]);
      ov.addEventListener('mousedown', function (e) { if (e.target === ov) ov.remove(); });
      document.body.appendChild(ov);
    });
  }

  function autoSave() { if (!S.pages.length) return; if (!S.bookId) S.bookId = 'bk_' + Date.now(); rememberLast(); try { STORE.set(S.bookId, snapshot()); } catch (e) {} try { var bb = ensureBackup(); if (bb) bb.maybeSnapshot({ turns: S.pages.length }); } catch (e) {} }
  function saveBook() { if (!S.pages.length) { toast('Write a page first'); return; } if (!S.bookId) S.bookId = 'bk_' + Date.now(); rememberLast(); STORE.set(S.bookId, snapshot()).then(function () { toast('Saved to My Books'); }); }
  function openBook(b) { S.bookId = b.id; S.title = b.name || ''; S.typeId = b.typeId; S.customGenre = b.customGenre || ''; S.cryptid = b.cryptid || ''; S.themeId = b.themeId || 'none'; S.theme = b.theme || ''; S.toneId = b.toneId || 'surprise'; S.tone = b.tone || ''; S.cast = b.cast || []; S.narrator = b.narrator || null; S.pages = b.pages || []; S.pageIdx = Math.max(0, (b.pages || []).length - 1); S.summary = b.summary || ''; S.usedMotifs = b.usedMotifs || []; S.prefs = b.prefs || null; S.grounds = b.grounds || (b.research ? [b.research] : []); S.compass = b.compass || { place: '', heading: '' }; S.calendar = b.calendar || { label: '', day: 0 }; S.stance = b.stance || 'balanced'; S.weights = b.weights || {}; S.noise = b.noise || 0; S.lore = b.lore || { people: [], places: [], world: (b.bible || []), threads: [] }; S.loreModel = b.loreModel || []; loreInit(); S.plan = b.plan || { end: '', target: 0 }; S.resolving = !!b.resolving; rebuildCouncil(); rememberLast(); S.view = 'wizard'; S.step = 3; render(); }
  function deleteBook(id) { STORE.delete(id).then(function () { if (S.bookId === id) S.bookId = null; render(); }); }
  function newBook() { S.bookId = null; S.title = ''; S.typeId = null; S.customGenre = ''; S.cryptid = ''; S.themeId = 'none'; S.theme = ''; S.toneId = 'surprise'; S.tone = ''; S.cast = []; S.narrator = null; S.pages = []; S.pageIdx = 0; S.summary = ''; S.usedMotifs = []; S.prefs = null; S.grounds = []; S.compass = { place: '', heading: '' }; S.calendar = { label: '', day: 0 }; S.stance = 'balanced'; S.weights = {}; S.noise = 0; S.lore = { people: [], places: [], world: [], threads: [] }; S.loreModel = []; S.plan = { end: '', target: 0 }; S.resolving = false; S._lastBook = null; rebuildCouncil(); S.view = 'wizard'; S.step = 0; render(); }

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
        try { var m = String(txt).match(/\{[\s\S]*\}/); var o = JSON.parse(m[0]); if (o && o.name) addCast(o.name, o.persona || '', true); else toast('No valid card'); }
        catch (e) { toast('AI returned no valid card'); }
        S.busy = false; render();
      }).catch(function () { S.busy = false; toast('Invent failed'); render(); });
    } else {
      var pool = INVENT_POOL.filter(function (p) { return !S.cast.some(function (c) { return c.name === p.name; }); });
      var pick = (pool.length ? pool : INVENT_POOL)[Math.floor(Math.random() * (pool.length || INVENT_POOL.length))];
      addCast(pick.name, pick.persona, true); render();
    }
  }

  // ------------------------------------------------------ render ----
  function go(step) { S.step = step; render(); }
  function canAdvance() { return [!!S.typeId, S.cast.length > 0, !!S.narrator][S.step]; }

  function render() {
    var app = $('#app'); app.innerHTML = '';
    app.appendChild(el('header', { class: 'sf' }, [
      el('span', { class: 'logo' }, [icon('book', 22)]),
      el('h1', { text: 'Book-maker' }),
      el('span', { class: 'tag', text: (hasBrain() ? 'brain-steered' : 'preview') + (hasAi() ? ' · Perchance' : '') + (anchorLinked() ? ' · Rook' : '') }),
      el('span', { class: 'sp', style: 'margin-left:auto' }),
      el('button', { class: 'btn ghost sm', onclick: function () { S.view = (S.view === 'library' ? 'wizard' : 'library'); render(); } }, S.view === 'library' ? ['← Back'] : ibtn('library', 'My Books'))
    ]));
    if (S.view === 'library') { renderLibrary(); return; }
    var steps = el('div', { class: 'steps' });
    STEPS.forEach(function (label, i) {
      steps.appendChild(el('div', { class: 'st' + (i === S.step ? ' on' : (i < S.step ? ' done' : '')), onclick: function () { if (S.pages.length || i <= S.step || (i === S.step + 1 && canAdvance())) go(i); } }, [String(i + 1) + '. ' + label]));
    });
    steps.appendChild(el('button', { class: 'st-menu', title: 'Settings — appearance & theme', onclick: openSettings }, [icon('menu', 18)]));   // right-aligned hamburger
    app.appendChild(steps);
    [renderType, renderCast, renderNarrator, renderWrite][S.step]();
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
        var t = STORY_TYPES.filter(function (x) { return x.id === b.typeId; })[0] || (b.typeId === 'custom' ? { emoji: 'pencil', label: b.customGenre || 'Custom' } : null);
        var np = (b.pages || []).length;
        var actions = el('div', { class: 'sel' }, [
          el('button', { class: 'btn sm', onclick: function () { openBook(b); } }, ['Open']),
          el('button', { class: 'chip', style: 'cursor:pointer', onclick: function () { renameBook(b); } }, ['✎ rename']),
          el('button', { class: 'chip', style: 'cursor:pointer', onclick: function () { duplicateBook(b); } }, ['⎘ duplicate']),
          el('button', { class: 'chip', style: 'cursor:pointer', onclick: function () { exportBookAsk(b, 'txt'); } }, ['↓ txt']),
          el('button', { class: 'chip', style: 'cursor:pointer', onclick: function () { exportBookAsk(b, 'md'); } }, ['↓ md']),
          el('button', { class: 'chip', style: 'cursor:pointer', onclick: function () { exportBookFile(b, 'json'); } }, ['↓ json']),
          el('button', { class: 'chip', style: 'cursor:pointer', title: 'Restore an automatic versioned backup of this book', onclick: function () { openBackups(b); } }, ['🛟 backups']),
          el('button', { class: 'chip', style: 'cursor:pointer', onclick: function () { confirmAsync('Delete “' + (b.title || 'this book') + '”? This cannot be undone.', { okText: 'Delete' }).then(function (ok) { if (ok) deleteBook(b.id); }); } }, ['🗑 delete'])
        ]);
        list.appendChild(el('div', { class: 'cm' }, [
          el('div', { class: 'h' }, [el('span', { class: 'nm', text: b.title || 'Untitled' })]),
          el('div', { class: 'muted', text: (t ? t.label + ' · ' : '') + np + ' page' + (np === 1 ? '' : 's') + (bookLoreFlat(b).length ? ' · ' + bookLoreFlat(b).length + ' memories' : '') + ((b.plan && b.plan.end) ? ' · planned' : '') + ' · ' + ((b.date || '').slice(0, 10)) }),
          actions
        ]));
      });
    });
  }

  function nav(backTo, nextLabel, nextFn, nextOk) {
    var row = el('div', { class: 'row', style: 'margin-top:22px' });
    if (backTo != null) row.appendChild(el('button', { class: 'btn ghost', onclick: function () { go(backTo); } }, ['← Back']));
    if (nextLabel) { var b = el('button', { class: 'btn', onclick: nextFn }, [nextLabel]); if (!nextOk) { b.disabled = true; b.style.opacity = .5; } row.appendChild(b); }
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
      grid.appendChild(el('div', { class: 'card' + (S.typeId === t.id ? ' on' : ''), onclick: function () { S.typeId = t.id; if (!S.narrator) S.narrator = { type: t.narrator.type, voice: t.narrator.voice }; if (t.id === 'paranormal') seedCryptid(); render(); } }, [
        el('div', { class: 't' }, [icon(t.emoji), '  ' + t.label]),
        el('div', { class: 'b', text: t.blurb })
      ]));
    });
    grid.appendChild(el('div', { class: 'card' + (S.typeId === 'custom' ? ' on' : ''), onclick: function () { askAsync('Describe your genre — a name, or a few lines about the kind of book you want:', S.customGenre || '', { multiline: true }).then(function (g) { if (g && g.trim()) { S.customGenre = g.trim(); S.typeId = 'custom'; if (!S.narrator) S.narrator = { type: 'third-close', voice: 'warm' }; render(); } }); } }, [
      el('div', { class: 't', text: '✎  ' + (S.typeId === 'custom' && S.customGenre ? S.customGenre : 'Custom genre…') }),
      el('div', { class: 'b', text: 'A genre of your own.' })
    ]));
    a.appendChild(grid);

    // THEME (optional) — chips
    a.appendChild(el('div', { class: 'sublbl', text: 'Theme / setting' }));
    var tr = el('div', { class: 'row', style: 'margin-top:6px' });
    tr.appendChild(themeChip({ id: 'none', label: '— none —', text: '' }));
    THEMES.forEach(function (th) { tr.appendChild(themeChip(th)); });
    tr.appendChild(el('button', { class: 'chip' + (S.themeId === 'custom' ? ' on' : ''), style: 'cursor:pointer', onclick: function () { askAsync('Describe your theme / setting — a place, era, premise; as much detail as you like:', S.themeId === 'custom' ? S.theme : '', { multiline: true }).then(function (x) { if (x && x.trim()) { S.theme = x.trim(); S.themeId = 'custom'; render(); } }); } }, ['✎ Custom' + (S.themeId === 'custom' && S.theme ? ': ' + S.theme.slice(0, 18) : '')]));
    a.appendChild(tr);

    // TONE / VIBE (default Surprise me!) — chips
    a.appendChild(el('div', { class: 'sublbl', text: 'Tone / vibe' }));
    var vr = el('div', { class: 'row', style: 'margin-top:6px' });
    TONES.forEach(function (to) { vr.appendChild(toneChip(to)); });
    vr.appendChild(el('button', { class: 'chip' + (S.toneId === 'custom' ? ' on' : ''), style: 'cursor:pointer', onclick: function () { askAsync('Describe your tone / vibe — the feeling you want the prose to carry:', S.toneId === 'custom' ? S.tone : '', { multiline: true }).then(function (x) { if (x && x.trim()) { S.tone = x.trim(); S.toneId = 'custom'; render(); } }); } }, ['✎ Custom' + (S.toneId === 'custom' && S.tone ? ': ' + S.tone.slice(0, 18) : '')]));
    a.appendChild(vr);

    nav(null, 'Next: characters →', function () { if (!S.narrator) { var nt = typeOf().narrator; S.narrator = { type: nt.type, voice: nt.voice }; } go(1); }, !!S.typeId);
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
    add.appendChild(el('button', { class: 'btn sm', onclick: function () { if (nameIn.value.trim()) { addCast(nameIn.value.trim(), persIn.value.trim(), true); render(); } } }, ['+ Add']));
    a.appendChild(add);
    // import + samples
    var imp = el('div', { class: 'row' });
    var ta = el('textarea', { rows: '2', placeholder: 'Paste a character — JSON / V2 or AICC card / JS object / markdown (## sections, * lists) / tags / "Name: description". Or lore (blank line between facts).', style: 'flex:1;min-width:220px' });
    imp.appendChild(ta);
    imp.appendChild(el('button', { class: 'btn sm ghost', title: 'Detects JSON, cards, markdown, tags, or a name:desc roster', onclick: function () { importPasted(ta.value); } }, ['+ Import character(s)']));
    imp.appendChild(el('button', { class: 'btn sm ghost', title: 'Add the paste to the story’s world-lore instead of the cast', onclick: function () { importLore(ta.value); } }, ['📖 as lore']));
    a.appendChild(imp);
    function chipRow(label, bank, extra) {
      var row = el('div', { class: 'row' });
      row.appendChild(el('span', { class: 'muted', text: label }));
      bank.forEach(function (s) { row.appendChild(el('button', { class: 'chip', style: 'cursor:pointer', title: 'View / edit ' + s.name + ' before adding', onclick: function () { charEditor(s); } }, ['+ ' + s.name])); });
      if (extra) row.appendChild(extra);
      a.appendChild(row);
    }
    chipRow('Rook crew:', ROOK_CREW);   // the project's own personas - fun to write with
    chipRow('Archetypes:', SAMPLE_CAST, el('button', { class: 'btn sm', style: 'margin-left:6px', onclick: inventCharacter }, [S.busy ? '…' : '✨ Invent one']));
    chipRow('Romance:', ROMANCE_CAST);
    chipRow('Adventure:', ADVENTURE_CAST);
    chipRow('Elements & wilds:', WILDS_CAST);   // nature / elemental characters
    chipRow('Myth & legend:', MYTH_CAST);   // folklore figures the brain already knows the lore of
    chipRow('Cryptids:', CRYPTID_CAST);   // friendly, safe cryptid companions
    if ((S.myChars || []).length) chipRow('Imported:', S.myChars, el('button', { class: 'chip', style: 'cursor:pointer', title: 'Edit or remove your saved characters', onclick: manageMyChars }, ['⚙ manage']));   // YOUR custom + imported characters, kept across refreshes
    // the cast list
    var list = el('div', { class: 'cast', style: 'margin-top:14px' });
    S.cast.forEach(function (c, i) {
      var card = el('div', { class: 'cm' });
      var nameIn = el('input', { class: 'nm-edit', value: c.name, placeholder: 'Name', oninput: function (e) { c.name = e.target.value; }, onblur: autoSave });
      var head = el('div', { class: 'h' }, [
        nameIn,
        el('button', { class: 'chip', style: 'cursor:pointer', title: 'Open the full card — appearance, goal, secret', onclick: function () { charEditor(c, i); } }, ['✎ card']),
        el('button', { class: 'chip', style: 'cursor:pointer', onclick: function () { S.cast.splice(i, 1); render(); autoSave(); } }, ['remove'])
      ]);
      card.appendChild(head);
      var persIn = el('textarea', { class: 'pers-edit', rows: '2', placeholder: 'One-line persona — who they are, their voice, a quirk', oninput: function (e) { c.persona = e.target.value; }, onblur: function () { c.persona = cleanMultiline(persIn.value); persIn.value = c.persona; autoSave(); } });
      persIn.value = c.persona || '';
      card.appendChild(persIn);
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
    // new-brain faculties readout: how sure it is (metacognition) + its evolving self-note (self-narrative)
    var st2 = brainStatus();
    if (st2) {
      if (st2.certainty != null) p.appendChild(el('div', { class: 'muted', style: 'margin-top:4px;font-size:12px', text: 'confidence ' + Math.round(st2.certainty * 100) + '%' }));
      if (st2.self) p.appendChild(el('div', { class: 'brainp-read', style: 'margin-top:6px', text: '📖 ' + st2.self }));
    }
    // stance presets
    var sr = el('div', { class: 'row', style: 'margin-top:8px' }, [el('span', { class: 'muted', text: 'Stance:' })]);
    Object.keys(STANCES).forEach(function (id) { sr.appendChild(el('button', { class: 'chip' + (S.stance === id ? ' on' : ''), style: 'cursor:pointer', title: STANCES[id].blurb, onclick: function () { applyStance(id); } }, [STANCES[id].label])); });
    p.appendChild(sr);
    // neuromodulator setpoint sliders (the brain's tunable chemistry = the new "faculties")
    var fl = el('div', { class: 'brainp-facs' });
    var sp = (council && council.setpoints) ? council.setpoints() : {};
    CORE_FACULTIES.forEach(function (id) {
      var meta = CHEM_META[id] || { label: id, def: 0.3 };
      var cur = (S.weights && S.weights[id] != null) ? S.weights[id] : (sp[id] != null ? sp[id] : meta.def);
      var rng = el('input', { type: 'range', min: '0', max: '100', step: '5', value: String(Math.round(cur * 100)) });
      var cap = el('span', { class: 'brainp-fac-cap' });
      function setCap() { cap.textContent = meta.label + ': ' + Math.round(rng.value) + '%'; }
      setCap();
      rng.addEventListener('input', setCap);
      rng.addEventListener('change', function () { setFacultyWeight(id, rng.value / 100); });
      fl.appendChild(el('label', { class: 'brainp-fac' }, [rng, cap]));   // slider on top, "Label: value" below
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
    if (!t) { a.appendChild(el('div', { class: 'muted', style: 'margin-top:10px', text: 'This book has no genre set.' })); a.appendChild(el('div', { class: 'row' }, [el('button', { class: 'btn', onclick: function () { go(0); } }, ['← Pick a genre'])])); return; }   // recover from a corrupted/imported book
    if (!S.narrator) S.narrator = { type: (t.narrator && t.narrator.type) || 'third-close', voice: (t.narrator && t.narrator.voice) || 'warm' };   // defensive: never deref a null narrator
    a.appendChild(el('h2', { class: 'sec' }, [icon(t.emoji, 18), '  ' + t.label]));
    var sub = el('div', { class: 'muted' });
    sub.innerHTML = 'Narrator: ' + narratorOf(S.narrator.type).label + ' · ' + S.narrator.voice + ' voice' + (S.theme ? ' · ' + (THEMES.filter(function (x) { return x.id === S.themeId; })[0] || { label: S.theme }).label : '') + ' · ' + (S.tone ? S.tone : 'surprise vibe') + ' · ' + S.cast.length + ' characters' + ((S.plan && S.plan.end) ? ' · 🎯 ' + arcPhase(S.pages.length || 1).key : '') + (hasAi() ? '' : ' <span class="pill">preview narrator</span>');
    a.appendChild(sub);
    // top controls (book-level)
    var ctl = el('div', { class: 'row', style: 'margin-top:12px' });
    ctl.appendChild(el('button', { class: 'btn ghost sm' + ((S.grounds || []).length ? ' on' : ''), title: 'Look up real facts to ground the fiction', onclick: openKnowledge }, ibtn('library', 'Almanac')));
    if (hasBrain()) ctl.appendChild(el('button', { class: 'btn ghost sm' + (S.brainOpen ? ' on' : ''), onclick: function () { S.brainOpen = !S.brainOpen; render(); if (S.brainOpen) refreshBrainReadout(); } }, ibtn('brain', 'Story Brain')));
    ctl.appendChild(el('button', { class: 'btn ghost sm' + (S.plan && S.plan.end ? ' on' : ''), title: 'Give the brain a secret ending to build toward (makes mysteries possible)', onclick: setPlan }, [icon('target'), S.plan && S.plan.end ? '  Ending set' : '  Plan ending']));
    if (S.pages.length) ctl.appendChild(el('button', { class: 'btn ghost sm', title: 'Simulate a story move before committing', onclick: function () { openForesee(); } }, ibtn('sparkle', 'Foresee')));
    if (S.pages.length) {
      ctl.appendChild(el('button', { class: 'btn ghost sm', onclick: saveBook }, ibtn('save', 'Save')));
      ctl.appendChild(el('button', { class: 'btn ghost sm', onclick: function () { exportBook('txt'); } }, ['↓ txt']));
      ctl.appendChild(el('button', { class: 'btn ghost sm', onclick: function () { exportBook('md'); } }, ['↓ md']));
      ctl.appendChild(el('button', { class: 'btn ghost sm', onclick: function () { exportBook('json'); } }, ['↓ json']));
    }
    a.appendChild(ctl);
    if (S.brainOpen && hasBrain()) a.appendChild(renderBrainPanel());
    if ((S.grounds || []).length) a.appendChild(el('div', { class: 'row', style: 'margin-top:6px' }, [
      el('span', { class: 'muted', text: '📎 Grounding: ' + S.grounds.length + ' real fact' + (S.grounds.length === 1 ? '' : 's') + ' the brain is using' }),
      el('button', { class: 'chip', style: 'cursor:pointer', onclick: function () { askAsync('Real-world grounding — one fact per line. Edit, reorder, or delete lines; the brain weaves these into the prose.', (S.grounds || []).join('\n'), { multiline: true, okText: 'Save' }).then(function (v) { if (v == null) return; S.grounds = String(v).split(/\n+/).map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 12); autoSave(); render(); }); } }, ['view / edit'])
    ]));
    var bv = bestVoice();
    if (bv) a.appendChild(el('div', { class: 'muted', style: 'margin-top:6px', text: 'Your up-votes lean toward a ' + bv + ' voice — switch in step 3 to follow it.' }));

    // EMPTY: nothing written yet
    if (!S.pages.length) {
      var nextBeat = t.beats[0];
      a.appendChild(el('div', { class: 'muted', style: 'margin-top:10px', text: 'First beat: ' + nextBeat }));
      a.appendChild(el('div', { class: 'row', style: 'margin-top:8px' }, [el('button', { class: 'btn', onclick: function () { promptNextPage(); } }, [S.busy ? 'Writing…' : 'Write Page 1'])]));
      nav(2, null, null, false); return;
    }

    // PAGER: one page at a time
    clampIdx();
    var i = S.pageIdx, ch = S.pages[i];
    var c = el('div', { class: 'page' });
    if (ch.chapterMark) {
      var cm = el('div', { class: 'chmark' }, [el('div', { class: 'cht', text: ch.chapterMark.title })]);   // display only; edit/remove live above the chapter nav below
      if (ch.chapterMark.subtitle) cm.appendChild(el('div', { class: 'chs', text: ch.chapterMark.subtitle }));
      c.appendChild(cm);
    }
    var h3 = el('h3', {}, [el('span', { text: 'Page ' + ch.n + ' — ' })]);   // title is inline-editable
    var titleEdit = el('input', { class: 'title-edit', title: 'Click to rename this page' }); titleEdit.value = ch.title || '';
    titleEdit.setAttribute('placeholder', 'untitled');
    titleEdit.addEventListener('input', function () { ch.title = titleEdit.value; });
    titleEdit.addEventListener('blur', function () { ch.title = titleEdit.value.trim(); autoSave(); });
    h3.appendChild(titleEdit);
    c.appendChild(h3);
    c.appendChild(el('div', { class: 'meta', text: 'beat: ' + ch.beat + (ch.motifId ? ' · motif: ' + ch.motifId : '') + (ch.intent ? ' · brain: ' + ch.intent : '') + (ch.engine === 'stub' ? ' · preview' : '') + (ch.streaming ? ' · writing…' : '') }));
    var body = el('div', { class: 'body' + (ch.streaming ? ' streaming' : ''), contenteditable: ch.streaming ? 'false' : 'true', text: ch.body });
    body.addEventListener('blur', function () { ch.body = body.textContent; autoSave(); });
    c.appendChild(body);
    if (ch.streaming) c.appendChild(el('div', { class: 'row', style: 'margin-top:8px' }, [el('button', { class: 'btn ghost sm stopbtn', onclick: stopGeneration }, ibtn('stop', 'Stop generating'))]));
    if (ch.footnote) c.appendChild(el('div', { class: 'foot' }, [el('span', { text: ch.footnote }), el('span', { class: 'footedit' }, [
      el('button', { class: 'btn ghost sm', title: 'Edit footnote', onclick: function () { setFootnote(i); } }, ['✎']),
      el('button', { class: 'btn ghost sm', title: 'Remove footnote', onclick: function () { ch.footnote = ''; autoSave(); render(); toast('Footnote removed'); } }, ['✕'])
    ])]));
    var acts = el('div', { class: 'acts' });
    acts.appendChild(el('button', { class: 'rk-vote' + (ch.vote === 'up' ? ' on' : ''), title: 'Good — the brain learns from this', onclick: function () { voteChapter(i, 'up'); } }, [icon('up')]));
    acts.appendChild(el('button', { class: 'rk-vote' + (ch.vote === 'down' ? ' on down' : ''), title: 'Not it — the brain adjusts', onclick: function () { voteChapter(i, 'down'); } }, [icon('down')]));
    acts.appendChild(el('button', { class: 'btn ghost sm', onclick: function () { regenerate(i); } }, ['↻ Regenerate']));
    // Continue from the cursor (or the end). mousedown + preventDefault keeps any caret in the body alive.
    var contB = el('button', { class: 'btn ghost sm', title: 'Write more — from your cursor in the text, or the end of the page' }, ['▶ Continue']);
    contB.addEventListener('mousedown', function (e) {
      e.preventDefault(); if (S.busy) return;
      var ci = caretBefore(body);   // caret position, if the cursor is inside this page's body
      var before = (ci && ci.before.trim() && /^\s*$/.test(ci.after)) ? ci.before : body.textContent;   // caret-at-live-end, else the whole page
      continueFromCaret(body, before, i);
    });
    acts.appendChild(contB);
    acts.appendChild(el('button', { class: 'btn ghost sm', onclick: function () { setFootnote(i); } }, [ch.footnote ? '✎ Footnote' : '＋ Footnote']));
    acts.appendChild(el('button', { class: 'chip', style: 'cursor:pointer', onclick: function () { confirmAsync('Delete page ' + ch.n + '? This cannot be undone.', { okText: 'Delete' }).then(function (ok) { if (ok) deletePage(i); }); } }, ibtn('trash', 'delete')));
    c.appendChild(acts);
    a.appendChild(c);
    a.appendChild(el('div', { class: 'muted', style: 'margin-top:6px', text: 'Tip: rate a page (up / down) to teach the brain · place your cursor in the text and hit ▶ Continue to extend from that point.' }));

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

    // chapter-mark editor for THIS page — sits ABOVE the chapter clicker so it's clearly an editor, not navigation
    a.appendChild(el('div', { class: 'row', style: 'margin-top:14px' }, [
      el('span', { class: 'muted', text: 'Chapter mark on this page:' }),
      el('button', { class: 'btn ghost sm', onclick: function () { setChapterMark(i); } }, [ch.chapterMark ? '✎ Edit / remove “' + ch.chapterMark.title + '”' : '＋ Set a chapter mark'])
    ]));

    // chapter jump-nav (creature comfort): click a chapter title to JUMP to that page
    var marks = S.pages.map(function (p, k) { return p.chapterMark ? { k: k, title: p.chapterMark.title } : null; }).filter(Boolean);
    if (marks.length) {
      var jn = el('div', { class: 'row', style: 'margin-top:8px' }, [el('span', { class: 'muted', text: 'Jump to chapter:' })]);
      marks.forEach(function (m) { jn.appendChild(el('button', { class: 'chip' + (m.k === i ? ' on' : ''), style: 'cursor:pointer', title: 'Jump to this chapter', onclick: function () { gotoPage(m.k); } }, [m.title])); });
      a.appendChild(jn);
    }
    nav(2, null, null, false);
  }

  // ---- continue-from-cursor: the prose up to the caret in a chapter body (used by the per-page Continue button) ----
  function caretBefore(node) {
    var sel = window.getSelection(); if (!sel || !sel.rangeCount) return null;
    var r = sel.getRangeAt(0); if (!node.contains(r.startContainer)) return null;
    var pre = document.createRange(); pre.selectNodeContents(node); pre.setEnd(r.startContainer, r.startOffset);
    var before = pre.toString();
    return { before: before, after: node.textContent.slice(before.length) };
  }

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
    function setLbl(open) { btn.innerHTML = ''; if (open) { btn.appendChild(document.createTextNode('✕ Comments')); } else { btn.appendChild(icon('chat')); btn.appendChild(document.createTextNode(' Comments')); } }
    var btn = el('button', { id: 'bm-comments-btn', title: 'Reader comments', onclick: function () {
      var open = panel.classList.toggle('open');
      setLbl(open);
      if (open && !commentsMounted) { commentsMounted = true; mountComments(panel); }
    } });
    setLbl(false);
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
  function boot() { applyUI(); loadMyChars(); render(); initComments(); loadLast(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.Bookmaker = { state: S };
})();
