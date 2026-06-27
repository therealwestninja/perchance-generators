// ==UserScript==
// @name         Rook Skybridge — Perchance Monitor fallback
// @namespace    rook.perchance.monitor
// @version      2.0
// @description  Answers Rook's weld.skybridge `fetch` capability for users WITHOUT the Rook extension, so the Perchance Platform Monitor can read the true status of CORS-blocked / down hosts (server-plugin 526, posts-plugin 522, generated-images …). If you already have the Rook extension installed, you do NOT need this — Rook's anchor serves the same protocol. Do not run both at once.
// @author       Rook
// @match        https://perchance.org/*
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-start
// @noframes
// ==/UserScript==

/*
  Identical wire protocol to extension/rook-skybridge-anchor.js (channel 'weld.skybridge'):

    page → bridge   { channel:'weld.skybridge', type:'hello', protoMax }
    bridge → page   { channel, type:'here', agent, version, proto, capabilities:['fetch'], caps }

    page → bridge   { channel, type:'request', cap:'fetch', nonce, payload:{ url, method } }
    bridge → page   { channel, type:'reply', nonce, result:{ ok, status, body, ms } }

  This fallback exposes ONLY the `fetch` cap (no ai/page/storage), and — unlike the Rook
  anchor — it does not consent-gate, since installing the userscript IS the opt-in.
  @noframes keeps one instance on the top perchance.org frame; the sandboxed monitor iframe
  posts to window.top, this script answers via event.source.
*/

(function () {
  'use strict';
  var SB = 'weld.skybridge', AGENT = 'userscript-bridge', VERSION = '2.0', CAPS = ['fetch'];
  var CAPDESC = { fetch: { v: 1, features: ['method'] } };

  function originOk(o) {
    if (o === 'null') return true;
    try { var h = new URL(o).hostname.toLowerCase(); return h === 'perchance.org' || /\.perchance\.org$/.test(h); }
    catch (e) { return false; }
  }
  function send(src, origin, msg) { try { src.postMessage(msg, origin && origin !== 'null' ? origin : '*'); } catch (e) {} }
  function replyResult(src, origin, nonce, result) { send(src, origin, { channel: SB, type: 'reply', nonce: nonce, result: result }); }

  function doFetch(src, origin, d) {
    var t0 = (performance && performance.now) ? performance.now() : Date.now();
    var ms = function () { return Math.round(((performance && performance.now) ? performance.now() : Date.now()) - t0); };
    var p = d.payload || {}, url = String(p.url || '');
    if (!/^https?:\/\//i.test(url)) { replyResult(src, origin, d.nonce, { ok: false, reason: 'bad-url' }); return; }
    try {
      GM_xmlhttpRequest({
        method: p.method || 'GET', url: url, timeout: 12000,
        onload: function (r) { replyResult(src, origin, d.nonce, { ok: r.status >= 200 && r.status < 400, status: r.status, body: String(r.responseText || '').slice(0, 200000), ms: ms() }); },
        onerror: function () { replyResult(src, origin, d.nonce, { ok: false, status: 0, body: '', reason: 'fetch-error', ms: ms() }); },
        ontimeout: function () { replyResult(src, origin, d.nonce, { ok: false, status: 0, body: '', reason: 'timeout', ms: ms() }); }
      });
    } catch (e) { replyResult(src, origin, d.nonce, { ok: false, status: 0, body: '', reason: String(e && e.message || e) }); }
  }

  window.addEventListener('message', function (ev) {
    var d = ev && ev.data;
    if (!d || d.channel !== SB || !originOk(ev.origin)) return;
    var src = ev.source || window;
    if (d.type === 'hello') { send(src, ev.origin, { channel: SB, type: 'here', agent: AGENT, version: VERSION, proto: 2, protoMin: 1, protoMax: 2, capabilities: CAPS, caps: CAPDESC }); return; }
    if (d.type === 'request') {
      var cap = String(d.cap || '');
      if (cap === 'ping') { replyResult(src, ev.origin, d.nonce, { ok: true, agent: AGENT, proto: 2, ts: Date.now() }); return; }
      if (cap === 'describe') { replyResult(src, ev.origin, d.nonce, { ok: true, agent: AGENT, version: VERSION, proto: 2, protoMin: 1, protoMax: 2, capabilities: CAPS, caps: CAPDESC }); return; }
      if (cap === 'fetch') { doFetch(src, ev.origin, d); return; }
      replyResult(src, ev.origin, d.nonce, { ok: false, code: 'unsupported', reason: 'unsupported capability: ' + cap });
    }
  }, false);

  // announce to child frames so an already-open monitor connects without waiting for its next hello
  try { for (var i = 0; i < window.frames.length; i++) { try { window.frames[i].postMessage({ channel: SB, type: 'here', agent: AGENT, version: VERSION, protoMin: 1, protoMax: 2, capabilities: [], probe: true }, '*'); } catch (e) {} } } catch (e) {}
})();
