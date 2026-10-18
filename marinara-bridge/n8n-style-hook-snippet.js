// Snippet to add when forking https://perchance.org/n8n-style for Marinara.
// 1) Top editor (DSL) — add alongside existing imports:
//    marinaraBridge = {import:marinara-bridge-plugin}
//
// 2) HTML panel — run once during init (near other plugin bootstrapping):
//
// Optional: if the fork uses a non-standard prompt field id, set before start():
//   window.MARINARA_BRIDGE_PROMPT_SELECTOR = '#positivePromptInput';
// Do not set MARINARA_BRIDGE_MIRROR_EVENTS = true unless you know the fork
// tolerates synthetic input/change events (they can reload the page).

try {
  if (typeof root !== 'undefined' && typeof root.marinaraBridge === 'function') {
    root.marinaraBridge();
  }
  // Plugin import may run before ?marinara=1 is visible in the iframe query string,
  // or an older plugin build may miss &marinara=1 when __generatorLastEditTime is first.
  if (window.marinara && window.marinara.bridge && typeof window.marinara.bridge.start === 'function') {
    window.marinara.bridge.start();
  }
} catch (e) {
  console.warn('[marinara.bridge] init failed', e);
}

// Marinara embed URL for the forked generator:
//   https://perchance.org/YOUR-FORK-SLUG?marinara=1
//
// The bridge reuses the same textToImagePlugin path n8n-style already calls in
// addImages() / regenSameSeed() — no need to replace the workflow UI.
// Marinara only needs the iframe + marinara-bridge-client.js (see sibling file).
