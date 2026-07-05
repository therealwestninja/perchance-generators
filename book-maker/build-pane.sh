#!/usr/bin/env bash
# build-pane.sh - assemble the paste-ready Perchance HTML pane (perchance-pane.html).
#
# The brain libs + the app are big and full of minified {word}/[word] patterns that the
# Perchance template parser would mangle. So we base64 the whole payload (base64 alphabet =
# A-Za-z0-9+/= -> contains none of [ ] { } | < , so it is trap-proof) into an inert
# <script type="text/plain"> island, then a tiny loader decodes it UTF-8-correctly and
# injects it as ONE live script (which the template parser never re-scans). Same idea as the
# rook-ai bridge's text/plain island, but base64 removes the hand-audit entirely.
set -e
cd "$(dirname "$0")"

# Rebuild the brain bundle from the LATEST brain src (esbuild: ESM story-brain.mjs -> one classic IIFE
# global window.RookBrain). Re-run whenever D:\Claude\brain changes -- this is book-maker's "vendor" step.
npx --yes esbuild story-brain.mjs --bundle --format=iife --global-name=RookBrain --outfile=lib/brain-core.bundle.js

LIBS="lib/brain-core.bundle.js lib/rook-weld-client.js"
OUT="perchance-pane.html"

{
  # live CSS + mount points (CSS is safe: rules are {prop:val}, never bare {word})
  sed -n '/<style>/,/<\/style>/p' book-maker.html
  echo '<div id="app"></div>'
  echo '<div class="toast" id="toast"></div>'

  # inert, base64-encoded payload: brain libs (in load order) then the app, each ;-terminated
  echo '<script type="text/plain" id="bm-payload">'
  { for f in $LIBS; do cat "$f"; printf '\n;\n'; done; cat book-maker.js; } | base64 | tr -d '\n'
  printf '\n'
  echo '</script>'

  # loader: decode (UTF-8 safe) + inject as a live script, then it self-boots
  cat <<'LOADER'
<script>
(function () {
  try { if (typeof window.root === 'undefined') window.root = window; } catch (e) {}   // off-platform shim; on Perchance the real root proxy stays
  var node = document.getElementById('bm-payload');
  var b64 = (node ? node.textContent : '').replace(/\s+/g, '');
  var bin = atob(b64), n = bin.length, bytes = new Uint8Array(n), i = 0;
  for (i = 0; i < n; i++) bytes[i] = bin.charCodeAt(i);
  var src = (typeof TextDecoder !== 'undefined') ? new TextDecoder('utf-8').decode(bytes) : decodeURIComponent(escape(bin));
  var s = document.createElement('script'); s.textContent = src;
  (document.body || document.documentElement).appendChild(s);
})();
</script>
LOADER
} > "$OUT"

# audit: the live (non-payload) part must be free of DSL traps; the payload is base64 so it is clean by construction
HEAD="$(sed -n '/<script type="text\/plain"/q;p' "$OUT")"
fail=0
echo "$HEAD" | grep -qE '\[\[' && { echo "AUDIT FAIL: [[ in live head"; fail=1; }
echo "$HEAD" | grep -qF '{import' && { echo "AUDIT FAIL: {import in live head"; fail=1; }
# confirm the payload is pure base64 (no stray < { [ | that would trip the parser)
PAYLOAD="$(sed -n '/id="bm-payload"/,/<\/script>/p' "$OUT" | sed '1d;$d')"
echo "$PAYLOAD" | grep -qE '[<{[|]' && { echo "AUDIT FAIL: non-base64 char in payload"; fail=1; }
[ "$fail" = 1 ] && { echo "build aborted"; exit 1; }
echo "built $OUT ($(wc -c < "$OUT") bytes); payload base64-clean; libs: $(echo $LIBS | wc -w)+app"
