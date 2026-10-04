# Rule X — Force the Wire

The active twin of Rule P (Prove the Wire). Rule P proves a connection by checking the real
result *after* it runs. Rule X goes first and on purpose: **force the wire to fail, and force it
to fire** — before you trust it. The Perchance sandbox swallows errors: a wire that silently does
nothing looks identical to one that works. So don't wait for it to break in the wild — break it
yourself and confirm the failure is **loud**, then drive it and confirm the result is **real**.

**The failure it prevents:** a `catch` that eats the error so you never learn the plugin call,
the DOM update, or the Dexie write quietly stopped working — and a handler that *runs* but is
wired to the wrong field/element/shape, so it changes nothing and never complains.

## Two directions — force both

- **Force it to FAIL (the error wire).** Make the connection throw on purpose. Does **your** error
  show in the browser console? If the console is silent, the failure is being swallowed — that is
  the bug you would never see in production. Surface it, then restore the break.
- **Force it to FIRE (the effect wire).** Drive the connection with a real value on the path that
  really runs. Did the **observable** actually change — the preview text, the image, the DOM, the
  stored row? If it runs but nothing changes, the wire is dead (wrong shape, wrong field, wrong
  element). "No error" is not success.

## Steps

1. **Name the wire.** One connection at a time: a plugin call (`root.aiTextPlugin`,
   `textToImagePlugin`), a DOM update, a Dexie/IndexedDB read or write, a DSL value reaching your
   JS, an `addEventListener`.

2. **Break it once, on purpose.** Feed `null`, mistype the key, point the selector at a missing
   element, call the plugin before it loads. Reload and watch the console. Does **your** message
   appear — the `catch` fired and logged? If the console is **silent**, the sandbox swallowed it:
   wrap the risky line `try { … } catch (e) { console.error('[wire: X]', e) }` and re-test until
   the forced failure is loud. Then undo the break.

3. **Drive it with a real value.** Run the genuine path — click the button, generate, load the
   table. Log what the wire produced and **look** at the preview: did the output change, the image
   render, the row land in Dexie, the DSL value arrive with the shape you assumed? Verify the
   result, not the absence of an error.

4. **If it runs but nothing changes, match the pattern** (dead wire, not a crash):
   - plugin returned a different **shape** than you assumed → log it; read the real fields.
   - selector matched `null` → **timing**: the element wasn't rendered yet.
   - field name is off → `item.tag` vs `item.tags`, string id vs number id.
   - handler bound **before** the element existed, or was an inline `onclick` the sandbox stripped.

5. **Investigate every silence — name why, don't guess.** A forced failure that doesn't show is
   EITHER a swallow to surface OR your break never reached the wire (an earlier guard returned
   first, a cached value, a dedupe). A drive that changes nothing is EITHER a dead wire OR you
   didn't actually run the real path. Confirm which one — the swallow often sits a **layer deeper**
   than the `catch` you were looking at.

6. **Leave the hook in.** Keep the `console.error` (or a small toggleable debug line showing the
   last error + key state), so the next failure is one glance, and the wire can be re-forced when
   you touch it again.

## Close-out checklist

- [ ] Each wire's forced failure prints **your** error in the console — no silent swallow.
- [ ] Each wire, driven with a real value, produces a **visible** result (preview / DOM / table / DSL).
- [ ] Every silence was explained (swallow to fix · break didn't reach · path not run) — not assumed.
- [ ] Debug hooks left in place; the final reload shows a clean console.

## In one line

Don't wait for the wire to fail — **force it both ways**: break it and confirm the error is loud,
drive it and confirm the result is real.
