/**
 * Paste into DevTools on the TOP perchance.org tab while viewing your fork,
 * e.g. https://perchance.org/bh3yiwwq00?marinara=1
 *
 * Perchance blocks cross-origin iframes (X-Frame-Options: sameorigin), so a
 * local file:// harness cannot load generators. The generator sandbox is already
 * a child iframe on perchance.org — this snippet attaches the bridge client to
 * that frame from the parent shell (same model as weld.skybridge).
 *
 * Usage:
 *   1. Open your fork with ?marinara=1
 *   2. DevTools → Console on the perchance.org tab (not inside the iframe)
 *   3. Paste this whole file, Enter
 *   4. await marinaraBridgeTest.connect()
 *   5. await marinaraBridgeTest.ping()
 *   6. await marinaraBridgeTest.generate({ prompt: 'a red apple on wood' })
 *   7. await marinaraBridgeTest.generate({
 *        prompt: 'same character in a forest',
 *        referenceImage: { url: 'https://user.uploads.dev/file/…', blur: 0.35 },
 *      })
 */
(function () {
  const CHANNEL = 'marinara.bridge';
  const DEFAULT_TIMEOUT_MS = 180_000;

  function nonce() {
    return 'mb_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  function findGeneratorFrame() {
    const iframes = document.querySelectorAll('iframe');
    for (const f of iframes) {
      const src = f.src || '';
      if (/^https:\/\/[a-f0-9]+\.perchance\.org\//i.test(src)) return f;
    }
    for (const f of iframes) {
      if ((f.src || '').includes('.perchance.org')) return f;
    }
    return null;
  }

  class MarinaraPerchanceBridge {
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
      if (!win) throw new Error('generator iframe not loaded');
      win.postMessage(obj, '*');
    }

    waitForReady(timeoutMs = 30_000) {
      if (this._ready) return Promise.resolve(this._ready);
      return new Promise((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
          if (this._ready) return resolve(this._ready);
          if (Date.now() - started > timeoutMs) {
            return reject(new Error('marinara.bridge ready timeout'));
          }
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
      const result = await this.request('image', payload);
      if (!result?.ok) throw new Error(result?.reason ?? 'image generation failed');
      return result.value;
    }

    ping() {
      const id = nonce();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this._pending.delete(id);
          reject(new Error('ping timeout'));
        }, 10_000);
        this._pending.set(id, { resolve, reject, timer });
        this._post({ channel: CHANNEL, type: 'ping', nonce: id });
      });
    }
  }

  let client = null;

  async function connect({ reload = false, force = false } = {}) {
    const frame = findGeneratorFrame();
    if (
      !force &&
      client &&
      client.iframe === frame &&
      client._ready
    ) {
      console.log('[marinara.bridge test] already connected', client._ready);
      return client._ready;
    }
    if (client) client.dispose();
    if (!frame) {
      throw new Error(
        'No generator iframe found. Open a generator on perchance.org (with ?marinara=1) and run this on the top tab.',
      );
    }

    client = new MarinaraPerchanceBridge(frame);
    console.log('[marinara.bridge test] attached to', frame.src);

    if (reload) {
      const src = frame.src;
      frame.src = 'about:blank';
      frame.src = src;
      console.log('[marinara.bridge test] reloaded generator iframe (pass { reload: true } if needed)');
    }

    try {
      const ready = await client.waitForReady(60_000);
      console.log('[marinara.bridge test] ready', ready);
      return ready;
    } catch (err) {
      const pong = await client.ping().catch(() => null);
      if (pong?.ok) {
        client._ready = {
          proto: 1,
          build: pong.value?.build,
          generatorName: null,
          capabilities: ['image'],
        };
        console.log('[marinara.bridge test] ready via ping fallback', client._ready);
        return client._ready;
      }
      throw err;
    }
  }

  async function ping() {
    if (!client) throw new Error('call connect() first');
    const result = await client.ping();
    const build = result?.value?.build;
    console.log(
      '[marinara.bridge test] ping',
      result?.ok ? 'ok' : 'failed',
      build ? 'build ' + build : result,
    );
    return result;
  }

  async function generate(payload = {}) {
    if (!client) throw new Error('call connect() first');
    const prompt = payload.prompt ?? 'a cozy fantasy tavern interior, warm light';
    console.log('[marinara.bridge test] generating (typically 15–45s; do not re-run connect())…', { prompt });
    try {
      const value = await client.generateImage({
        prompt,
        resolution: payload.resolution ?? '512x512',
        guidanceScale: payload.guidanceScale ?? 7,
        seed: payload.seed ?? -1,
        ...payload,
      });
      const dataUrl = value?.dataUrl || (typeof value?.text === 'string' && value.text.startsWith('data:') ? value.text : null);
      console.log('[marinara.bridge test] image', { inputs: value?.inputs });
      if (dataUrl) {
        console.log('%c ', `font-size:1px;padding:120px 200px;background:url(${dataUrl}) no-repeat;background-size:contain;`);
        console.log('[marinara.bridge test] dataUrl length', dataUrl.length);
      } else {
        console.warn('[marinara.bridge test] no dataUrl in response — republish plugin build mb-plugin/2026-06-21.3+', value);
      }
      return value;
    } catch (err) {
      console.error('[marinara.bridge test] generate failed:', err && err.message ? err.message : err);
      throw err;
    }
  }

  function diagnose() {
    const frame = findGeneratorFrame();
    const src = frame?.src || '';
    const q = src.includes('?') ? src.split('?')[1].split('#')[0] : '';
    const hasMarinara = /(^|&)marinara=(1|true)(&|$)/.test(q);
    console.log('[marinara.bridge test] diagnose', {
      frameFound: !!frame,
      iframeSrc: src,
      marinaraInIframeUrl: hasMarinara,
      hint: hasMarinara
        ? 'URL looks correct — if ping fails, republish marinara-bridge-plugin (build mb-plugin/2026-06-21.3+)'
        : 'Add ?marinara=1 to the perchance.org tab URL and reload',
    });
    return { frame, hasMarinara };
  }

  window.marinaraBridgeTest = {
    findGeneratorFrame,
    MarinaraPerchanceBridge,
    get client() {
      return client;
    },
    connect,
    ping,
    generate,
    diagnose,
    dispose() {
      client?.dispose();
      client = null;
    },
  };

  console.log(
    '%c marinara.bridge console tester loaded ',
    'background:#3d8bfd;color:#fff;padding:2px 6px;border-radius:4px',
    '\n→ await marinaraBridgeTest.connect()\n→ await marinaraBridgeTest.ping()\n→ await marinaraBridgeTest.generate({ prompt: "..." })',
  );
})();
