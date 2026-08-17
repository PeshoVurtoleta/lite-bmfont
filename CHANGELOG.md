# Changelog

All notable changes to `@zakkster/lite-bmfont`.

## 1.2.2 -- 2026-08-17

The `drawFast` magnitude door. Fixes an unkillable infinite loop and a silent
24-byte scratch overrun, both reachable from the package's advertised use case
(a per-frame HUD counter fed by caller arithmetic).

### Added
- `DRAWFAST_MAX` export (`1e21`) -- the largest magnitude `drawFast` renders.
  BOTH endpoints of `[-DRAWFAST_MAX, DRAWFAST_MAX]` are inclusive, so
  `Math.max(-DRAWFAST_MAX, Math.min(DRAWFAST_MAX, v))` always produces a value
  the method draws. Declared in `BitmapFont.d.ts`.
- Torture tier T4 (the drawFast digit oracle and magnitude sweep) is now wired: a
  fixed table, a rejection table, seeded magnitudes against a bit-exact oracle
  (`oracleExact`, with `toFixed(1)` as an independent witness below 1e21), and a
  5-second tier budget.
- T9 control 9: the door-removed body driven with `Number.MAX_VALUE` under a
  2-second `spawnSync` watchdog, asserted killed by `SIGTERM`, with the shipped
  body asserted to return with zero draws on the same input. Out of process,
  because an in-process watchdog cannot interrupt the loop it is watching. It
  adds about 2.2 s to `npm run torture` -- the cost of the only gate in the suite
  that can see an infinite loop.
- Six named `drawFast` boundary tests in `test/BitmapFont.test.js`. Four fail on
  1.2.1; one hangs 1.2.1 forever.

### Fixed

| ID | Sev | Finding | Reproduction | Fixed in |
| --- | --- | --- | --- | --- |
| **F-01** | S1 | `drawFast` hung forever on any finite value above ~1.797e307: the top guard rejected Infinity, then `value * 10` overflowed to Infinity and `while (temp > 0)` never ended. | `drawFast(ctx, Number.MAX_VALUE, 0, 0)` -> never returned; child killed by SIGTERM | 1.2.2 |
| **F-02** | S1 | `_charScratch` is 24 bytes and `drawFast` overran it silently from 1e22 up, emitting 24 `drawImage` calls at `NaN` coordinates. Just above the ceiling the failure was quieter still: `nextUp(1e21)` drew 24 finite glyphs spelling a confidently wrong number. | `drawFast(ctx, 1e22, 0, 0)` -> 24 calls, every dst x `NaN`; `nextUp(1e21)` -> 24 calls spelling `1000000000000000424684.0` | 1.2.2 |

### Changed
- `drawFast` now draws nothing for `|value| > 1e21`, joining the three silent
  returns it already documented for `NaN`, `+Infinity` and `-Infinity`. The
  three-comparison door became a two-comparison NaN-safe range test.
- **Behaviour change worth reading twice:** large negative magnitudes used to
  clamp to 0 and render "0.0" (they never hung -- the clamp preceded the
  multiply). `-1e21` still renders "0.0" because it is inside the door; `-1e22`
  and `-Number.MAX_VALUE` now draw nothing.
- The digit loop carries an unconditional `len < buf.length` bound. The door
  makes it unreachable today; it stays because "unreachable" is a claim about
  today's code.
- `_charScratch` is still exactly 24 bytes, pinned by T6 and T4. Growing it was
  the rejected fix.
- Corrected the 1.2.1 rationale for the dev-time Node >= 20 floor: it cited
  `FinalizationRegistry`, which has shipped since Node 14.6 and cannot justify a
  Node-20 floor. The true reason is `@zakkster/lite-leak@1.8.1`'s own
  `engines: { node: ">=20.0.0" }`. Only that false causal clause was changed; the
  1.2.1 reproductions and finding rows are untouched.

### Known issues (delta since 1.2.1)

The 1.2.1 table remains authoritative for every finding not listed here. F-01 and
F-02 are fixed above. Two findings are new:

| ID | Sev | Finding | Reproduction | Fixed in |
| --- | --- | --- | --- | --- |
| **F-22** | S3 | The word-wrap recipe shipped in `README.md` and `llms.txt` reads `font.glyphs[id * 7 + 6]` and `font.kerning[(prevId << 8) \| id]`. Both are real `Int16Array` members at runtime; neither was declared in `BitmapFont.d.ts`, so a TypeScript consumer copying the package's own documented recipe could not compile it. | `tsc` on the README recipe -> `Property 'glyphs' does not exist on type 'BitmapFont'` | 1.2.2 |
| **F-23** | S2 | `drawFast`'s digit loop is inexact in two bands. Band 1 (`\|value\| < 2^53`): off-by-one-tenth on near-ties, because `Math.round(value * 10)` rounds the float product rather than the real value -- breaking the documented "rounded to nearest tenth" guarantee. Band 2 (`2^53 < \|value\| <= 1e21`): the integer digits themselves are wrong and silent, because the value is scaled through a double before digit extraction. Measured 15,858 of 191,255 in-door samples (1,738 band 1, 14,120 band 2). Documented in `llms.txt`, `README.md` and the `.d.ts`; the 1e21 ceiling was chosen on the buffer boundary knowing 2^53 is the correctness boundary (see `decisions/0001`). | `drawFast(ctx, 8.45, 0, 0)` -> `"8.5"` (exact `8.4`); `drawFast(ctx, 762638538843020900000, 0, 0)` -> `"762638538843020800088.0"` (exact `762638538843020853248.0`) | M8 |

## 1.2.1 -- 2026-08-17

No behaviour change. This release makes the test suite runnable and the zero-GC
claim falsifiable.

### Added
- `VERSION` export from `BitmapFont.js` (F-14). Version is now synced in three
  places: `package.json`, `VERSION`, and this file's top heading.
- `CHANGELOG.md` (this file) and `LICENSE` (F-16). The changelog previously
  lived inline in `README.md`; that section is now a link.
- `engines: { node: ">=18" }` (F-16). `node --test` does not exist below it.
  Note: the dev-time torture gate additionally needs Node >= 20, because
  `@zakkster/lite-leak@1.8.1` declares `engines: { node: ">=20.0.0" }` in its own
  package.json. That is a devDependency and does not constrain consumers.
- Torture gate: `npm run torture` -> `node --expose-gc test/torture.mjs`, prints
  exactly `ok` and exits 0. Ten tiers registered; T0, T1, T6, T7 and T9 are
  wired in this release. T2, T3, T4, T5 and T8 are registered and empty.
- `npm run verify` -> `npm test && npm run torture`.
- devDependencies `@zakkster/lite-gc-profiler` and `@zakkster/lite-leak`.
- `test/findings.test.js` and `test/boundary.test.js` (contributed by qa):
  node:test suites of exact-value assertions pinning the reproductions of the
  known issues and the align-divisor constants that `BitmapFont.test.js` checked
  only by inequality (F-20). `test/boundary.test.js` closes F-20 prospectively.

### Changed
- `npm test` now runs `node --expose-gc --test test/*.test.js`. The suite was
  written for vitest, which was never installed, so `npm test` exited 127 and
  the 40 test blocks could not be executed by anyone (F-15). All 40 blocks are
  ported to `node:test` with the same assertions, plus one new version-sync
  block in `test/packaging.test.js`.
- `files[]` now ships `README.md`, `CHANGELOG.md` and `LICENSE` (F-16).
  `test/` and `demo/` are not shipped and never will be.
- Removed the `bundle-check` script. It ran `npx esbuild` -- a network fetch
  inside `prepublishOnly` -- and wrote `test-bundle.js` into the package root.
  It is replaced by `npm run smoke`, a zero-dependency import check.

### Removed
- devDependency `vitest`.

### Known issues

Every row below was REPRODUCED by running `BitmapFont.js` on 2026-08-17, not
inferred from reading. They are recorded, not fixed: this release changes no
behaviour. `S1` = silent corruption or hang, `S2` = broken documented
guarantee, `S3` = hygiene or contract gap.

| ID | Sev | Finding | Reproduction | Fixed in |
| --- | --- | --- | --- | --- |
| **F-01** | S1 | `drawFast` hangs forever on any finite value above ~1.797e307: the top guard rejects Infinity, then `value * 10` overflows to Infinity and `while (temp > 0)` never ends. An unkillable infinite loop inside a per-frame render call. | `drawFast(ctx, Number.MAX_VALUE, 0, 0)` -> never returns; child process killed by SIGTERM after 6s | M1 |
| **F-02** | S1 | `_charScratch` is 24 bytes and `drawFast` overruns it silently from 1e22 up: `len` keeps incrementing while the `Uint8Array` writes are discarded, and 24 `drawImage` calls go out at `NaN` coordinates. | `drawFast(ctx, 1e22, 0, 0)` -> 24 drawImage calls, every dst x is `NaN`; `1e21` -> correct `"1000000000000000000000.0"` | M1 |
| **F-03** | S1 | The NaN guard polarity is inverted between the measure path and both draw paths. `_measureRange` rejects a NaN id; `draw` and `drawWrapped` accept it, and `cursorX += undefined * scale` poisons the cursor for the rest of the line. | `(NaN >= 0 && NaN < 256)` -> `false` (rejects); `(NaN < 0 \|\| NaN >= 256)` -> `false` (accepts) | M2 |
| **F-04** | S1 | A `startIdx < 0` in the layout buffer renders an entire line at `NaN`, because `charCodeAt(-1)` is `NaN` and passes the F-03 guard. This is the exact hand-off shape from `@zakkster/lite-text-layout`. | `drawWrapped(ctx, 'HELLO', new Float32Array([-1,5,40,0]), 1, ...)` -> 5 drawImage calls, all dst x `NaN`. Same buffer with start `0` -> `0,8,16,24,32` | M2 |
| **F-05** | S2 | `drawWrapped` never bounds-checks `layoutBuffer` against `lineCount * 4`. A `lineCount` larger than the buffer holds reads `undefined` for every field and the line silently vanishes. | `drawWrapped(ctx,'HELLO', new Float32Array(4), 3, ...)` -> no throw, draws only line 0 | M2 |
| **F-06** | S2 | `measure()` sums across newlines while `draw()` aligns per line, so centring a multi-line string with `measure()` is wrong by the width of every other line. | `measure('AA\nAA')` -> `32`; the longest line is `16`. `measure('A\nAAAAAA')` -> `56`; longest line is `48` | M4 |
| **F-07** | S2 | Only the first line is pixel-snapped in Y. `cursorY = Math.round(y)` runs once, then `cursorY += lineHeight * scale` accumulates unrounded. | `draw(ctx,'A\nB\nC',0,0,1.1)` -> dst Y `-13.200000000000001`, `4.4`, `22` | M4 |
| **F-08** | S2 | `Int16Array` truncation and wrap in the constructor are silent: an atlas coordinate of `40000` wraps, and a fractional `xadvance` truncates into an accumulating drift. | `char.x = 40000` -> `glyphs[65*7] === -25536`; `xadvance 8.6` -> `8`, so `measure('AA')` is `16` where exact is `17.2` | M3 |
| **F-09** | S3 | Kerning keys are checked only on the upper bound, so negatives compute a negative index whose write the typed array silently discards. `amount` is truncated too. | `kernings:[{first:-1,second:65,amount:-2}]` -> no write, no error; `amount -1.7` -> stored `-1` | M3 |
| **F-10** | S2 | The constructor accepts three malformed descriptors and rejects three others with raw `TypeError`s naming internal properties. Neither half is a policy. | `new BitmapFont(atlas, {chars: 7})` -> constructs; every `measure` returns 0 forever | M3 |
| **F-11** | S3 | `align` / `vAlign` / `scale` are unvalidated: out-of-range aligns render left, `scale: NaN` reaches `drawImage`, `scale: -1` produces a negative destination width. | `draw(ctx,'AAAA',100,0,1,3)` -> same x as `align:0`; `scale:NaN` -> 4 calls, dst x `NaN` | M3 |
| **F-12** | S3 | A glyph absent from the atlas advances by zero, so the next glyph overprints it. The visible symptom is overlapping text, not a missing character. | `draw(ctx,'A\u00C8A',0,0)` on a font whose glyphs advance 12 (the T1 fixture `JSON_ASCII`) -> dst xs `0,12`; the second `A` should sit at `24` | M2 |
| **F-13** | S3 | `flags` is strict-compared to `1` through a `Float32Array`, so `1.0000001` misses and every unknown flag value is silently ignored rather than rejected. | `flags = 1` -> 8 calls; `flags = 1.0000001` -> 5; `flags = 2` -> 5 | M3 |
| **F-14** | S3 | No `VERSION` export; `BitmapFont.prototype` is not frozen and instance methods are monkey-patchable. | `Object.isFrozen(BitmapFont.prototype)` -> `false`; `'VERSION' in module` -> `false` | M0 (VERSION) / M9 (freeze) |
| **F-15** | S3 | `npm test` did not run at all: the script was `vitest run`, `node_modules` was empty, and `vitest` was not installed. 40 test blocks nobody could execute. | `npm test` -> `sh: vitest: command not found` | M0 |
| **F-16** | S3 | Packaging gaps against the suite Law: no `CHANGELOG.md`, no `LICENSE`, no `engines`, no torture gate, and a `prepublishOnly` whose first half exited 127. | `cat package.json`; `ls` | M0 |
| **F-17** | S2 | Every "zero allocation" claim in `README.md` and `llms.txt` was unproven -- asserted in seven places, measured in none. | `grep -n "allocat" README.md llms.txt`; `devDependencies` was `{vitest}` | M0 |
| **F-18** | S3 | `generateAtlas` is duplicated: the demo defines a 40-line copy and calls it four times, and downstream consumers need the same function. | `demo/demo-lite-bmfont.html:261,309,313,317,321` | M7 |
| **F-19** | S3 | Shipped `files[]` carry non-ASCII bytes, violating the Law's ASCII-only rule (U+00D7 and U+00B5 excepted). `BitmapFont.d.ts` is now CLEAN (de-Unicoded by M1: em dash, plus-minus, en dash in comments). Remaining debt: `BitmapFont.js` (10 lines, U+2014 em dashes), `README.md` (47: emoji, U+2192, U+2014, U+2026, en dash) and `llms.txt` (10). `README.md` and `llms.txt` are docs and may be de-Unicoded in any session. No single behaviour fix touches all the affected source lines (the file header at line 1, and the `drawWrapped` doc block at 242-275), so the source de-Unicoding rides M9's hardening pass alongside the F-14 prototype freeze rather than being smeared across the behaviour sessions. | `grep -c -P '[^\x00-\x7F]' BitmapFont.js BitmapFont.d.ts README.md llms.txt` -> `10 / 0 / 47 / 10` | M9 (source); README/llms.txt any session |
| **F-20** | S3 | `draw()` and `drawFast()` center/right-align math is asserted only by directional inequality (`rec.dx[0] < 100`, true for any positive divisor), so an off-by-constant regression in the divisor is invisible to `npm test` AND to every wired torture tier. `drawWrapped()`'s align tests, by contrast, assert exact pixels (44, 88, 38) and are load-bearing. | scratch-edit `draw()`'s `... / 2` to `... / 3` -> `npm test` still passes and `npm run torture` prints `ok`, exit 0 (both gates blind). Closed prospectively by the exact-value assertions in `test/boundary.test.js`; the ported `BitmapFont.test.js` still carries the weak `assert.ok(... < 100)` assertions. | session that next revises `BitmapFont.test.js` |
| **F-21** | S3 | T0 law 4 (the seam-kerning equation) is vacuous, and it is the only kerning check in the torture gate. `FONT_KERN` defines kerning for only 3 pairs (A-B, B-A, A-A) while the corpus draws ASCII 33..126, so a random seam boundary is 3 of 94x94 = 8836 (0.034% per string). Under both seeds this session ships, ZERO eligible seams carry non-zero kerning, so the check degenerates to `left + right === full` and never once tests kerning -- the AR-02 pattern (a check named for a hazard it never touches) in the harness M0 just built. | default seed 2654435769 -> eligible 246, non-zero-kern seams 0; replay seed 12345 -> eligible 247, seams 0. Mutation: deleting the kerning term from `_measureRange` passes `npm run torture` clean (caught only by `npm test`'s "maps kerning pairs" block). | M2 (with F-06's T0 update) |

## 1.2.0
- **Added:** `drawWrapped(ctx, text, layoutBuffer, lineCount, boxWidth, boxHeight, x, y, scale?, align?, vAlign?)` -- renders pre-laid-out wrapped text into a bounding box with horizontal **and** vertical alignment, plus an optional `...` ellipsis flag per line. Layout consumed as a `Float32Array` for zero per-frame allocation.
- **Added:** Exported types `Align`, `VAlign`, `BMFontJson`, `BMFontChar`, `BMFontKerning` from `BitmapFont.d.ts`.

## 1.1.0
- **Added:** `drawFast(ctx, value, x, y, scale?, align?)` -- zero-alloc number renderer with one decimal place. Built for per-frame HUD output (FPS, score, time) without producing GC pressure.
- **Internal:** scratch buffer for `drawFast` is allocated once in the constructor and released by `destroy()`.

## 1.0.x
- Initial release: `draw`, `measure`, multi-line alignment, O(1) kerning LUT.
