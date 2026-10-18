/**
 * Marinara parent-frame client for perchance.org generators that import
 * marinara-bridge-plugin and load with ?marinara=1.
 *
 * Perchance sets X-Frame-Options: sameorigin — you cannot embed generators from
 * file://, localhost, or Marinara's web origin unless a browser extension strips
 * that header. For local testing, run bridge-console-snippet.js in DevTools on
 * the top perchance.org tab (same model as weld.skybridge / Weld Companion).
 *
 * Usage (Marinara extension parent frame / perchance.org shell):
 *
 *   const client = new MarinaraPerchanceBridge(iframeEl);
 *   await client.waitForReady();
 *   const { dataUrl, inputs } = await client.generateImage({
 *     prompt: 'fantasy tavern at dusk',
 *     resolution: '768x768',
 *     guidanceScale: 7,
 *     seed: -1,
 *     referenceImage: {
 *       url: 'https://user.uploads.dev/file/abc123.jpeg', // character portrait
 *       blur: 0.35,  // 0–1; lower = stronger likeness (default 0.35 if omitted)
 *     },
 *   });
 *
 * This is reference code for Marinara Engine — not executed on Perchance.
 */

const CHANNEL = 'marinara.bridge';
const DEFAULT_TIMEOUT_MS = 180_000;

function nonce() {
  return 'mb_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

export class MarinaraPerchanceBridge {
  /**
   * @param {HTMLIFrameElement} iframe - Perchance generator iframe (?marinara=1)
   * @param {{ timeoutMs?: number }} [opts]
   */
  constructor(iframe, opts = {}) {
    this.iframe = iframe;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this._pending = new Map();
    this._ready = null;
    this._onMessage = this._onMessage.bind(this);
    window.addEventListener('message', this._onMessage);
  }

  dispose() {
    window.removeEventListener('message', this._onMessage);
    for (const [, entry] of this._pending) clearTimeout(entry.timer);
    this._pending.clear();
  }

  _targetWindow() {
    return this.iframe?.contentWindow ?? null;
  }

  _onMessage(ev) {
    const d = ev?.data;
    if (!d || d.channel !== CHANNEL) return;

    if (d.type === 'ready') {
      const win = this._targetWindow();
      if (win && ev.source !== win) return;
      this._ready = {
        proto: d.proto,
        build: d.build,
        generatorName: d.generatorName,
        capabilities: d.capabilities ?? [],
      };
      return;
    }

    if (d.type === 'status') {
      const win = this._targetWindow();
      if (win && ev.source !== win) return;
      const msg = d.message ?? '';
      if (d.level === 'error') {
        console.error('[marinara.bridge]', msg, d.detail ?? '');
      } else if (d.level === 'info') {
        console.log('[marinara.bridge]', msg, d.detail ?? '');
      } else {
        console.log('[marinara.bridge] status', d.level, msg, d.detail ?? '');
      }
      return;
    }

    if (d.type === 'reply') {
      const id = String(d.nonce ?? '');
      const entry = this._pending.get(id);
      if (!entry) return;
      clearTimeout(entry.timer);
      this._pending.delete(id);
      entry.resolve(d.result ?? { ok: false, reason: 'malformed reply' });
    }
  }

  _post(obj) {
    const win = this._targetWindow();
    if (!win) throw new Error('iframe not loaded');
    win.postMessage(obj, '*');
  }

  waitForReady(timeoutMs = 30_000) {
    if (this._ready) return Promise.resolve(this._ready);
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        if (this._ready) return resolve(this._ready);
        if (Date.now() - started > timeoutMs) return reject(new Error('marinara.bridge ready timeout'));
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  request(cap, payload) {
    return new Promise((resolve, reject) => {
      const id = nonce();
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error('marinara.bridge request timeout'));
      }, this.timeoutMs);
      this._pending.set(id, { resolve, reject, timer });
      this._post({ channel: CHANNEL, type: 'request', cap, nonce: id, payload: payload ?? {} });
    });
  }

  async generateImage(payload) {
    // payload.referenceImage?: { url: string, blur?: number } — Perchance t2i character ref
    const result = await this.request('image', payload);
    if (!result?.ok) {
      const reason = result?.reason ?? 'image generation failed';
      console.error('[marinara.bridge] generate failed:', reason);
      throw new Error(reason);
    }
    return result.value;
  }

  async ping() {
    const id = nonce();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error('ping timeout'));
      }, 10_000);
      this._pending.set(id, {
        resolve,
        reject,
        timer,
      });
      this._post({ channel: CHANNEL, type: 'ping', nonce: id });
    });
  }
}
