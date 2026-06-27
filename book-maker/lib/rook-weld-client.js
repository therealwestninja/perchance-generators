'use strict';
/* rook-weld-client.js - the PAGE-SIDE Weld client we own.
 *
 * Installs window.weld.skybridge as a full protocol-v2 client: it runs the
 * hello->here handshake with an anchor (extension content script / App Engine
 * injection / Tampermonkey), negotiates the version, and exposes ONE object for
 * everything - request/reply (with nonce matching + timeout), ai() streaming,
 * the v2 manifest (agent/instance/proto/features/capabilities/caps), describe()/
 * ping()/subscribe(), and an on()/off() event bus fed by the anchor's push.
 *
 * It is a drop-in replacement for the external weld-skybridge-plugin: same
 * .connected/.protocol/.has/.request/.ai surface, so existing callers keep
 * working, plus the proto-2 surface the external plugin never had. Self-
 * installing + idempotent. With no anchor present, .connected stays false and
 * every request resolves { ok:false, code:'no-anchor' } - never throws.
 *
 * Embedded in the bridge (build-bridge.sh LIBS) and the standalone demo. Lives
 * in the generator frame; the anchor lives in the top frame, reached by
 * postMessage to window.top. Protocol spec: docs/weld-protocol.md.
 */
(function () {
  var W;
  try { W = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window; } catch (e) { W = window; }
  if (W.weld && W.weld.skybridge && W.weld.skybridge.__rookClient) return;   // idempotent: don't re-install over ourselves

  var CH = 'weld.skybridge', MIN = 1, MAX = 2;
  var pending = {}, listeners = {}, seq = 0, helloTries = 0, helloIv = null;

  var client = {
    __rookClient: '1.0',
    connected: false,
    protocol: 0,            // negotiated proto once linked
    agent: null,            // which anchor build answered (rook-extension / rook-app-engine / ...)
    instance: null,         // this anchor run's id
    version: null,
    features: [],           // optional mechanisms the anchor supports (events/codes/describe/ping)
    capabilities: [],       // flat cap list (proto 1 compatible)
    caps: {}                // machine-readable descriptor map (proto 2)
  };

  // ---- transport: the anchor lives in window.top (it stands down in sub-frames). Posting to a
  //      specific window with targetOrigin '*' delivers ONLY to that window, not a broadcast. ----
  function anchorWin() { try { return window.top || window; } catch (e) { return window; } }
  function post(msg) { try { anchorWin().postMessage(msg, '*'); } catch (e) {} }
  function fromAnchor(ev) { try { return ev.source === window.top || ev.source === window.parent || ev.source === window; } catch (e) { return false; } }

  // ---- handshake ----
  function hello() { post({ channel: CH, type: 'hello', protoMax: MAX }); }
  function adopt(d) {
    var wasConnected = client.connected;
    client.connected = !d.blocked;
    // defensive: keep prior values when a refresh omits a field (a partial describe must not wipe the manifest)
    client.protocol = d.proto || d.protoMax || client.protocol || 1;
    client.agent = d.agent || client.agent;
    client.instance = d.instance || client.instance;
    client.version = d.version || client.version;
    if (d.features) client.features = d.features;
    if (d.capabilities) client.capabilities = d.capabilities;
    if (d.caps) client.caps = d.caps;
    if (helloIv) { clearInterval(helloIv); helloIv = null; }
    if (client.connected && client.features.indexOf('events') >= 0) { try { request('subscribe', { topics: ['caps-changed'] }); } catch (e) {} }
    if (!wasConnected && client.connected) fire('connect', { agent: client.agent, proto: client.protocol });
    try { console.log('[RookWeldClient] linked to ' + (client.agent || 'anchor') + ' proto ' + client.protocol + '; caps: ' + client.capabilities.join(', ')); } catch (e) {}
  }

  // ---- request / reply (nonce-matched, timeout-guarded, streaming-aware) ----
  function request(cap, payload, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var nonce = 'rwc-' + (++seq) + '-' + Date.now().toString(36);
      var ms = opts.timeout || 30000;
      var rec = { resolve: resolve, onChunk: opts.onChunk, timer: null, ms: ms };
      rec.arm = function () { rec.timer = setTimeout(function () { if (pending[nonce]) { delete pending[nonce]; resolve({ ok: false, code: 'timeout', reason: 'no reply from anchor' }); } }, ms); };   // (re)arm the idle timeout; streaming refreshes it so a slow local model isn't cut mid-reply
      pending[nonce] = rec;
      rec.arm();
      post({ channel: CH, type: 'request', cap: String(cap), nonce: nonce, payload: payload || {} });
    });
  }

  // ---- events ----
  function fire(topic, data) {
    var a = listeners[topic] || [], b = listeners['*'] || [], i;
    for (i = 0; i < a.length; i++) { try { a[i](data, topic); } catch (e) {} }
    for (i = 0; i < b.length; i++) { try { b[i](data, topic); } catch (e) {} }
  }
  function on(topic, fn) { (listeners[topic] = listeners[topic] || []).push(fn); return function () { off(topic, fn); }; }
  function off(topic, fn) { var arr = listeners[topic]; if (!arr) return; var i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1); }

  // ---- inbound messages from the anchor ----
  function onMessage(ev) {
    var d = ev && ev.data;
    if (!d || d.channel !== CH || !fromAnchor(ev)) return;
    if (d.type === 'here') {
      // a probe / capability-less announce is PRESENCE only (an anchor won't broadcast its
      // caps to '*'); re-handshake to fetch the real manifest, never latch onto empty caps.
      if (d.probe || !(d.capabilities && d.capabilities.length)) { if (!client.connected) hello(); return; }
      adopt(d);
      return;
    }
    if (d.type === 'reply' && d.nonce && pending[d.nonce]) {
      var rec = pending[d.nonce], res = d.result || {};
      if (res.partial) { if (typeof rec.onChunk === 'function') { try { rec.onChunk(res.chunk); } catch (e) {} } if (rec.timer) { clearTimeout(rec.timer); if (rec.arm) rec.arm(); } return; }   // streaming chunk: keep the request open + refresh the idle timeout
      clearTimeout(rec.timer); delete pending[d.nonce]; rec.resolve(res);
      return;
    }
    if (d.type === 'event') {
      fire(String(d.topic || 'event'), d.data);
      if (d.topic === 'caps-changed') { describe().then(function (m) { if (m) adopt(m); }); }   // refresh the manifest on a cap change
      return;
    }
  }

  // ---- public API (drop-in for the external plugin + the proto-2 surface) ----
  client.has = function (cap) { return client.capabilities.indexOf(cap) >= 0; };
  client.supports = function (cap, feat) {
    var c = client.caps[cap]; if (!c) return false;
    if (!feat) return true;
    return (c.features && c.features.indexOf(feat) >= 0) || (c.ops && c.ops.indexOf(feat) >= 0);
  };
  client.request = function (cap, payload, opts) {
    if (!client.connected && cap !== 'ping' && cap !== 'describe') return Promise.resolve({ ok: false, code: 'no-anchor', reason: 'no Weld anchor present' });
    return request(cap, payload, opts);
  };
  client.ai = function (prompt, opts) {
    opts = opts || {};
    // AI generation is slow (a local model can take a minute+, plus first-load); give it a generous
    // idle timeout that streaming refreshes per token. Fast cloud models still return in seconds.
    return client.request('ai', { prompt: String(prompt == null ? '' : prompt), system: opts.system, stream: !!opts.onChunk }, { onChunk: opts.onChunk, timeout: opts.timeout || 120000 });
  };
  function describe() { return request('describe', {}, { timeout: 8000 }).then(function (r) { return (r && r.ok) ? r : null; }, function () { return null; }); }
  client.describe = describe;
  client.ping = function () { return request('ping', {}, { timeout: 6000 }); };
  client.subscribe = function (topics) { return request('subscribe', { topics: topics || ['caps-changed'] }); };
  client.unsubscribe = function () { return request('unsubscribe', {}); };
  client.on = on;
  client.off = off;
  // re-handshake on demand (e.g. after the anchor reloads)
  client.relink = function () { client.connected = false; hello(); };

  // ---- install + start the handshake ----
  W.weld = W.weld || {};
  W.weld.skybridge = client;

  window.addEventListener('message', onMessage, false);
  hello();
  helloIv = setInterval(function () { if (client.connected || ++helloTries >= 20) { clearInterval(helloIv); helloIv = null; return; } hello(); }, 500);
  try { console.log('[RookWeldClient] installed (proto ' + MAX + '); awaiting anchor...'); } catch (e) {}
})();
