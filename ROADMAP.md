# lite-bmfont -- enriched roadmap

Ten BRIEF sessions for one package, plus a torture-suite spec built around a
recording Canvas2D context. Supersedes `ROADMAP.md` (four additive feature
sessions, no harness, no findings).

**Why it grew.** The old roadmap assumed lite-bmfont was small, correct and
finished, and that the remaining work was four additive features with a named
consumer. The features are real and they survive below. The premise did not.
I pulled the package and ran it. Eighteen findings are listed in section 2 and
**every one of them was reproduced** -- three of them are silent corruption and
one of them is an unkillable infinite loop inside a per-frame render call.

| Axis | State today |
| --- | --- |
| Version | `1.2.0`, published, installable right now |
| Source | 365 lines, one class, four public methods, no `VERSION` |
| Tests | 40 `it()` blocks under **vitest, which is not installed** -- `npm test` cannot run |
| Gate | none: no torture, no `lite-gc-profiler`, no `lite-leak`, no coverage floor |
| Docs | README carries an inline changelog; no `CHANGELOG.md`, no `LICENSE` |
| Claim | "zero allocation" asserted in seven places, proven in zero |

The package is in the state lite-aabb and lite-bvh were in before their A0/B0:
plausible source, no executable proof, and a set of bugs that only running the
code can see. None of the sessions below are padding. Each one is anchored to a
finding ID, and the four inherited feature sessions keep their original
triggering signals verbatim -- they are re-ordered behind the harness and the
correctness work, not replaced by it.

---

## 0. Scope and metadata check (do this first, it is five minutes)

The published scope is **`@zakkster`** (one `s`). Verified in `package.json`:
`@zakkster/lite-bmfont@1.2.0`. No `@zakksters` anywhere in the tree.

**The repo metadata is NOT cross-wired.** Unlike lite-arena -- whose published
`homepage`/`repository`/`bugs` all pointed at `lite-scheduler` -- this package's
three URLs all resolve to `PeshoVurtoleta/lite-bmfont`. Verified, not assumed.
There is no "Karadjov" in the tree. This section exists because the check was
run and came back clean; that is worth recording, because the next package might
not.

What IS wrong is packaging, and all of it is F-16:

| Law requirement | State |
| --- | --- |
| `CHANGELOG.md` per package | missing -- README carries an inline changelog instead |
| `LICENSE` file, MIT (c) Zahary Shinikchiev | missing (`license` field only) |
| README ships in `files[]` | `files[]` is `[BitmapFont.js, BitmapFont.d.ts, llms.txt]` |
| `node:test` only | `devDependencies: { vitest }`, `"test": "vitest run"` |
| `engines` | absent |
| Torture gate | absent |
| `prepublishOnly` that can pass | `npm run test && npm run bundle-check` -- the first half exits 127 |
| Three-place version sync | two places (`package.json`, README changelog heading) |

One extra hygiene item that is not a finding, so it is a task and not a table
row: `bundle-check` shells out to `npx esbuild` (a network fetch inside
`prepublishOnly`) and writes `test-bundle.js` into the package root without
cleaning it up. Pin it or drop it in M0, and make sure the artifact cannot leak
into a tarball.

---

## 1. The law (holds across every session)

1. **The FORMAT is a two-package contract.** The layout buffer is
   `Float32Array`, stride 4, `[startIdx, endIdx, lineWidth@render-scale, flags]`,
   and `@zakkster/lite-text-layout` emits exactly that shape -- `lineWidth` is at
   the RENDERED scale, compared DIRECTLY against `boxWidth` (F-45, 1.6.0; the old
   `@scale1` claim was false and cost every centre/right line at `scale != 1`).
   The glyph table is
   `Int16Array`, stride 7, `[x, y, w, h, xoff, yoff, xadvance]`, and the README
   publishes `font.glyphs[id * 7 + 6]` as a supported read. Both strides are
   load-bearing outside this repo. Changing either is a major.
2. **The advance conservation law is the centrepiece.** For any string, any
   range and any scale, the cursor walk `draw()` performs, the value
   `_measureRange()` returns, and an oracle computed from the original BMFont
   descriptor must agree **exactly**, in double arithmetic, with no tolerance.
   Section 2 states it formally. It catches F-03, F-04, F-06 and F-12 at once
   and it is the invariant every tier leans on.
3. **Fail closed means draw NOTHING, not draw NaN.** For a renderer, a
   fail-closed door emits zero `drawImage` calls. Today four separate paths
   emit `drawImage` at `NaN` destination coordinates and call it success. A
   `NaN` coordinate is not a visual glitch -- it is a silent per-frame lie that
   costs a full draw call and produces nothing on screen.
4. **The NaN-safe guard idiom is `!(x <= max)` / `!(x >= min)`.** One comparison
   rejects NaN, and the polarity cannot be written backwards by accident. F-03
   is the same predicate written two ways with opposite NaN behaviour; the
   idiom exists so that cannot happen again. Every door added below uses it, and
   the reviewer's job is to reject any `x < a || x >= b` that a NaN can slip
   through.
5. **The 8-bit ceiling is structural, not a limitation to fix.** The 64K kerning
   LUT is keyed `(first << 8) | second`. That is why lookup is O(1) and why the
   package is 1.3 KB. Unicode is a different data structure, not an addition.
   It stays in the rejection ledger.
6. **Bytes in a hot body, not instructions.** The hot bodies are exactly four:
   `draw`, `drawFast`, `drawWrapped` and `_measureRange`. Every guard added
   below must be shown absent from all four by diff, or measured with
   `measureOps`/`assertOps` and the number recorded. A per-glyph branch to
   defend against a per-call mistake is a rejected design. Per-CALL and
   per-LINE guards are cheap -- a 40-glyph line pays a per-line compare 1/40 as
   often as a per-glyph one -- and the briefs say which tier a guard lives in.
7. **The constructor is cold and there is no tradeoff to argue about there.**
   It runs once per font per process. Anything that can be validated at
   construction should be, and moving a check from the render loop into the
   constructor is always the right answer when it is possible (F-12 is fixable
   entirely this way).
8. **Every gate must be provably able to fail.** Every torture tier ships a
   deliberately-broken control, and `BMFONT_TORTURE_BREAK=1` must exit non-zero.
9. **A measuring harness that allocates is not a measurement.** See section 3;
   this package's harness has a real design problem and it is solved before any
   session leans on it.

---

## 2. Verified findings

Reproduced by running `BitmapFont.js` on 2026-08-17. Probe scripts `probe.mjs`,
`bound.mjs`, `hang.mjs`. Severity: **S1** = silent corruption or hang, **S2** =
broken documented guarantee, **S3** = hygiene / contract gap.

| ID | Sev | Finding | Reproduction |
| --- | --- | --- | --- |
| **F-01** | **S1** | **`drawFast` HANGS FOREVER on any finite value above ~1.797e307.** The top guard rejects `Infinity`, but the very next line computes `value * 10`, which overflows to `Infinity` for `value > MAX_VALUE/10`. Then `intPart = Math.floor(Infinity/10) = Infinity`, and the digit loop is `do { ... temp = Math.floor(temp/10) } while (temp > 0)` -- `Infinity/10` is `Infinity`, so the condition is never false. This is an unkillable infinite loop inside a per-frame render call. In a browser it freezes the tab; there is no stack overflow to catch. The package's headline use case is a per-frame HUD counter fed by caller arithmetic. | `drawFast(ctx, Number.MAX_VALUE, 0, 0)` -> never returns; child process killed by SIGTERM after 6s **[M8b 1.7.0 update: this hang mechanism no longer exists -- decisions/0007 fork 6 DELETED `value * 10`, so every loop in the new body is bounded by a finite exponent and Number.MAX_VALUE now RETURNS. F-01 stays closed by the M1 magnitude door, but the door's justification shifts from "prevents this hang" to "prevents silent scratch truncation"; T9 control 9 is re-derived from a hang proof into a corruption proof accordingly.]** |
| **F-02** | **S1** | **`_charScratch` is 24 bytes and `drawFast` overruns it silently from 1e22 up.** Layout is 1 decimal digit + `'.'` + N integer digits, so 22 integer digits exactly fills it. At 1e21 the output is still correct (24 glyphs). At 1e22 `len` keeps incrementing past 24 while the `Uint8Array` writes are discarded; the render loop then reads `buf[i] === undefined`, `glyphs[undefined*7+6]` is `undefined`, and `cursorX` becomes `NaN` for every glyph. It still issues 24 `drawImage` calls per frame, all at `NaN` coordinates. No throw, no warning. | `drawFast(ctx, 1e22, 0, 0)` -> 24 drawImage calls, every dst x is `NaN`; `1e21` -> correct `"1000000000000000000000.0"` |
| **F-03** | **S1** | **The NaN guard polarity is inverted between the measure path and both draw paths.** `_measureRange` uses `if (id >= 0 && id < 256)` -- `NaN` fails it, fail-closed, correct. `draw()` and `drawWrapped()` use `if (id < 0 \|\| id >= 256) continue;` -- `NaN` fails *that* too, so the glyph is **accepted**. The same predicate, written two ways, with opposite behaviour on the one value that matters. Downstream, `glyphs[NaN*7+6]` is `undefined` and `cursorX += undefined * scale` poisons the cursor for the rest of the line. | `(NaN >= 0 && NaN < 256)` -> `false` (rejects); `(NaN < 0 \|\| NaN >= 256)` -> `false` (accepts) |
| **F-04** | **S1** | **A `startIdx < 0` in the layout buffer renders an entire line at `NaN`.** `charCodeAt(-1)` is `NaN`, which passes the F-03 guard, so every glyph on that line is drawn at `NaN` x. This is the exact hand-off shape from lite-text-layout (roadmap Session 2 makes it the public contract), and it is the same failure class as lite-bvh B-03: one bad value enters once and the output is silently wrong with no signal. Note a *fractional* start is harmless -- `charCodeAt(0.5)` truncates -- so the bug is not uniform across bad indices, which makes it harder to spot. | `drawWrapped(ctx, 'HELLO', new Float32Array([-1,5,40,0]), 1, ...)` -> 5 drawImage calls, all dst x `NaN`. Same buffer with start `0` -> `0,8,16,24,32` |
| **F-05** | S2 | **`drawWrapped` never bounds-checks `layoutBuffer` against `lineCount * 4`.** A `lineCount` larger than the buffer holds reads `undefined` for every field; the inner loop `for (i = undefined; i < undefined; ...)` never runs and the line silently vanishes. The doc comment says "Buffer must contain at least `lineCount * 4` floats" and nothing enforces it. Fail-open on unverified state. | `drawWrapped(ctx,'HELLO', new Float32Array(4), 3, ...)` -> no throw, draws only line 0 |
| **F-06** | S2 | **`measure()` sums across newlines; `draw()` aligns per line.** The two disagree on what "the width of this text" means, and centring a multi-line string using `measure()` -- the obvious thing to do -- is wrong by the width of every other line. | **Owner: M4 (the missing function) / M9 (the semantics)** -- M4 (v1.4.0) ships `measureWidest`, which returns the widest line, and documents `measure` as the total advance it actually is; `measure`'s own return value is UNCHANGED because promoting it is a silent numeric change and a minor may not carry one. M9 makes `measure` return the widest line in 2.0.0. | `measure('AA\nAA')` -> `32`; the longest line is `16`. `measure('A\nAAAAAA')` -> `56`; longest line is `48` |
| **F-07** | S2 | **Only the first line is pixel-snapped in Y.** `draw()` documents "Pixel-snapped baseline for crisp pixel fonts" and does `cursorY = Math.round(y)` once, then accumulates `cursorY += this.lineHeight * scale` unrounded. At any fractional `lineHeight * scale` every line after the first lands off-grid, which is precisely the blur the promise exists to prevent. `drawWrapped` has the identical shape. **Fixed in 1.4.0 (M4)**: every baseline is snapped from an exact per-line product, `Math.round(y) + Math.round(i * lineHeight * scale)` (decisions/0004 fork 2 sub-fork B1); `drawWrapped` snaps the same way from its own, unchanged, line-0 anchor. | `draw(ctx,'A\nB\nC',0,0,1.1)` -> dst Y `-13.200000000000001`, `4.4`, `22` |
| **F-08** | S2 | **`Int16Array` truncation and wrap in the constructor are silent.** Glyph fields are stored into `Int16Array` with no range check: an atlas coordinate of `40000` wraps to `-25536`, and a fractional `xadvance` of `8.6` truncates to `8` -- a 0.6px-per-glyph drift that accumulates across a string. BMFont exporters do emit fractional advances. **Owner: M3 (detection) / M9 (storage)** -- M3 (v1.3.0) makes the drift DETECTABLE under `{ checked: true }` with its exact numbers; the storage behaviour itself is unchanged and is M9's. | `char.x = 40000` -> `glyphs[65*7] === -25536`; `xadvance 8.6` -> `8`, so `measure('AA')` is `16` where exact is `17.2` |
| **F-09** | S3 | **Kerning keys are checked only on the upper bound.** `if (k.first < 256 && k.second < 256)` admits negatives: `first = -1` computes index `-191` and the write is silently discarded by the typed array; `second = -1` computes index `-1`, same. `k.amount` is also silently truncated (`-1.7` -> `-1`). | `kernings:[{first:-1,second:65,amount:-2}]` -> no write, no error; `amount -1.7` -> stored `-1` |
| **F-10** | S2 | **The constructor accepts three malformed descriptors and rejects three others with raw `TypeError`s.** `{chars: 7}` constructs a font with zero glyphs (`7.length` is `undefined`, loop never runs) so every `measure` returns 0 forever. `{common:{lineHeight:NaN}}` constructs and every line lands at `NaN` Y. `atlas = null` constructs and `draw()` happily calls `drawImage(null, ...)`. Meanwhile `null`, `{}` and a missing `chars` each throw a raw `TypeError` naming an internal property. Neither half is a policy. | see `probe.mjs` F-10 block |
| **F-11** | S3 | **`align` / `vAlign` / `scale` are unvalidated.** `align: 3` and `align: -1` both silently render left-aligned. `scale: NaN` issues drawImage calls at `NaN`. `scale: -1` issues them with a negative destination width. | `draw(ctx,'AAAA',100,0,1,3)` -> same x as `align:0`; `scale:NaN` -> 4 calls, dst x `NaN` |
| **F-12** | S3 | **A glyph absent from the atlas advances by zero, so the next glyph overprints it.** Undocumented; the visible symptom is overlapping text, not a missing character. | `draw(ctx,'A\u00C8A',0,0)` on a font whose glyphs advance 12 (the T1 fixture `JSON_ASCII`) -> dst xs `0,12`; the second `A` should sit at `24` |
| **F-13** | S3 | **`flags` is strict-compared to `1` through a `Float32Array`.** `flags === 1` misses `1.0000001` (stored as `1.0000001192092896`), and any unknown flag value is silently ignored rather than rejected -- so a layout engine emitting a bitfield gets no ellipsis and no error. | `flags = 1` -> 8 calls; `flags = 1.0000001` -> 5; `flags = 2` -> 5 |
| **F-14** | S3 | **No `VERSION` export; `BitmapFont.prototype` is not frozen; instance methods are monkey-patchable.** Two-place version sync, not three. | `Object.isFrozen(BitmapFont.prototype)` -> `false`; `'VERSION' in module` -> `false` |
| **F-15** | S3 | **`npm test` does not run at all.** The script is `vitest run`, `node_modules` is empty, and `vitest` is not installed: `sh: vitest: command not found`. The suite is 40 `it()` blocks in 3 `describe`s that nobody can execute. This also violates the suite Law directly ("`node:test` only"). | `npm test` -> `sh: vitest: command not found` |
| **F-16** | S3 | **Packaging gaps against the suite Law.** No `CHANGELOG.md`, no `LICENSE` file, no `engines` field, no torture gate, no `prepublishOnly` gate that can pass. `files[]` is `[BitmapFont.js, BitmapFont.d.ts, llms.txt]` -- the Law requires README to ship. The README carries an inline changelog instead of a `CHANGELOG.md`. | `package.json`, `ls` |
| **F-17** | S2 | **Every "zero allocation" claim in README and llms.txt is unproven.** README asserts it in seven places; there is no `measureAllocs`, no `measureOps`, no gate, and no devDep on `lite-gc-profiler` or `lite-leak`. The claim may well be true -- nothing in the repo can tell. | `grep -n "allocat" README.md llms.txt`; `devDependencies` is `{vitest}` |
| **F-18** | S3 | **CLOSED in 1.8.0 (M7, decisions/0009).** Was: `generateAtlas` duplicated inline in `demo/demo-lite-bmfont.html` and called four times. Now shipped as the `@zakkster/lite-bmfont/atlas` subpath (`Atlas.js` + `Atlas.d.ts`); the demo imports it, defines it zero times. Closed by the extraction plus `test/findings.test.js` (F-18 closed-state + A2/A3/A6 behavioural proofs) and torture tier T8 (pack contents, DOM-free import through the exports map in a clean child, docs-drift guard). The core changed exactly one line (VERSION). | `test/findings.test.js` "F-18 CLOSED"; `node --expose-gc test/torture.mjs` T8 |
| **F-19** | S3 | **CLOSED 2026-08-20 (verified at 1.9.0).** `grep -c -P '[^\x00-\x7F]'` over `BitmapFont.js` `BitmapFont.d.ts` `Atlas.js` `Atlas.d.ts` `README.md` `llms.txt` returns **0 0 0 0 0 0**. M2b (1.6.1) discharged the whole row, source included, and the keeping gate is `packaging.test.js:28-97`, which enumerates from `git ls-files -z` rather than a filename list -- so a NEW file carrying a non-ASCII byte reddens on the day it is added. The routing below ("rides M9's hardening pass") is therefore moot; M9 schedules no work for this. Was: **Non-ASCII bytes in shipped `files[]`, violating the Law's ASCII-only rule** (U+00D7 and U+00B5 excepted). `BitmapFont.d.ts` is now CLEAN (de-Unicoded by M1: em dash, plus-minus, en dash in comments). Remaining debt: `BitmapFont.js` (10 lines -- U+2014 x10 plus one U+2026 at `:856`, so the char count is 11, not 10), `README.md` (47 lines: emoji, U+2192, U+2014, U+2026, en dash), `llms.txt` (10 lines: U+2014 x7, U+2026 x2, U+2013 x1). Docs (`README.md`, `llms.txt`) are de-Unicodeable in any session. No single behaviour fix touches all the affected source lines (the file header at line 1, and the `drawWrapped` doc block at 242-275), so the source de-Unicoding rides M9's hardening pass alongside the F-14 prototype freeze rather than being smeared across the behaviour sessions. | `grep -c -P '[^\x00-\x7F]' BitmapFont.js BitmapFont.d.ts README.md llms.txt` -> `10 / 0 / 47 / 10` |
| **F-20** | S3 | **`draw()`/`drawFast()` center/right-align math is asserted only by directional inequality**, so an off-by-constant regression in the divisor is invisible to `npm test` and every wired torture tier. `drawWrapped()`'s align tests assert exact pixels (44, 88, 38) and are load-bearing; `draw`'s (`rec.dx[0] < 100`) are not. Closed prospectively by qa's `test/boundary.test.js`; the ported `BitmapFont.test.js` still carries the weak assertions. | scratch-edit `draw()`'s `... / 2` to `... / 3` -> `npm test` passes and `npm run torture` prints `ok`, exit 0 |
| **F-21** | S3 | **T0 law 4 is vacuous -- the only kerning check in the torture gate never tests kerning (AR-02).** `FONT_KERN` kerns 3 pairs (A-B, B-A, A-A); the corpus is ASCII 33..126, so a random seam is 3/8836 = 0.034%. Under both shipped seeds ZERO eligible seams carry non-zero kerning, so law 4 degenerates to `left + right === full`. **Routed to M2**, which revises `t0-laws.mjs` and its corpus and builds the conservation law on top of it; fix by a seeded corpus planting A/B seams or a dense `FONT_KERN`, BEFORE the law leans on it. | default seed -> eligible 246, seams 0; seed 12345 -> eligible 247, seams 0. Deleting the kern term from `_measureRange` passes `npm run torture` clean |
| **F-22** | S3 | **The documented word-wrap recipe does not type-check.** `README.md:124-125` and `llms.txt:75-76` read `font.glyphs[id * 7 + 6]` and `font.kerning[(prevId << 8) \| id]`; both are real `Int16Array` members at runtime and neither was declared in `BitmapFont.d.ts`. A TypeScript consumer copying the package's own answer to "compute the layoutBuffer yourself" cannot compile the primary integration path. Fixed in 1.2.2 (M1): `readonly glyphs` / `readonly kerning` declared, stride marked a cross-package contract. | `tsc` on the README recipe -> `Property 'glyphs' does not exist on type 'BitmapFont'` |
| **F-23** | S2 | **`drawFast`'s digit loop is inexact in two bands (originally routed to M8, which was believed to reopen the body).** **[RE-ROUTED 2026-08-18 to M8b by decisions/0005 fork 1: P-4 proved M8's `drawFastInt` shares NO arithmetic with `drawFast` -- only the 24-byte scratch buffer -- so M8 does not reopen `drawFast`. M8 shipped `drawFastInt` (1.5.0) with `drawFast` byte-frozen; F-23's fix moves to M8b (1.6.0, status next), a MINOR with both bands as declared `### Changed (behaviour)` rows. See the M8 amendment in decisions/0001.]** Band 1 (`\|value\| < 2^53`): off-by-one-tenth on near-ties -- `Math.round(value * 10)` rounds the float product, not the real value, breaking the documented "rounded to nearest tenth" guarantee. Band 2 (`2^53 < \|value\| <= 1e21`): the integer digits themselves are wrong and silent -- the value is scaled through a double before extraction, so it prints digits the value does not have. 15,858/191,255 in-door samples diverge (1,738 band 1, 14,120 band 2). The 1.2.2 door ceiling `DRAWFAST_MAX = 1e21` is the buffer boundary; 2^53 is the correctness boundary, chosen deliberately (see `decisions/0001`). Ground truth is a bit-exact mantissa oracle; `toFixed(1)` is exact below 1e21, the plan's `BigInt(Math.round(v*10))` oracle was rejected because it shares the library's float multiply. **CLOSED in 1.7.0 (M8b) by decisions/0007:** band 1 now derives the tenth by Fast2Sum (no `value * 10` product), band 2 renders the double's exact integer value by decimal doubling. Validated against a BigInt oracle on 400,023 values, 0 mismatches; the six T4 pins now assert `s === ex`. `8.45` -> `"8.4"`, `762638538843020900000` -> `"762638538843020853248.0"`. | `drawFast(ctx, 8.45, 0, 0)` -> `"8.5"` (exact `8.4`); `drawFast(ctx, 762638538843020900000, 0, 0)` -> `"762638538843020800088.0"` (exact `762638538843020853248.0`) |
| **F-24** | S3 | **The harness oracle's pinned missing-glyph policy is NOT what the implementation does, and M2's centrepiece law is a three-way equality against that oracle.** `harness.mjs:314` documents "a character with no descriptor entry advances by ZERO **and does not become the kerning `prev`**", claiming it pins "today's implementation behaviour". The second half is false: all three walk sites (`BitmapFont.js:86`, `:168`, `:357`) set `prevId = id` for any id in `[0, 256)` regardless of whether the descriptor covered it, so an unmapped glyph DOES break the kerning chain in the library and does NOT in the oracle. Invisible under every shipped fixture because `JSON_KERN` kerns only mapped ids -- the same vacuity shape as F-21. Wire T0's law as written and it fails on day one for a reason that is not F-03/F-04/F-05/F-12. The underlying question -- does a missing glyph break the kerning chain? -- is a second, independent policy fork that M2's decision (2) does not ask. | font `{65:adv 12, 66:adv 12}`, `kern(65,66) = -5`, text `'A\u00C8B'`: `_measureRange` -> `24`, `oracleAdvance` -> `19` |
| **F-25** | S2 | **`_measureRange` treats `\n` as a renderable glyph and runs the kerning chain THROUGH it; `draw` skips it and resets the chain.** `draw` special-cases `id === 10` (`BitmapFont.js:135`) and sets `prevId = -1`; `_measureRange` has no newline case at all, so `10` passes the `[0, 256)` guard, contributes `glyphs[10*7+6]` to the width, and stays in the kerning chain across the line break. Distinct from F-06, which is about summing line widths -- this is the newline character itself carrying advance and kerning. Silent under every shipped fixture (id 10 unmapped -> advance 0, kerning 0), so it surfaces only against a descriptor that maps id 10 (some exporters emit one) or kerns against it. M2 owns T0's newline residual assertion and must state which of the two walks is correct before it can assert the residual exactly. **Third face, measured 2026-08-17:** `drawWrapped` has no `id === 10` case at all, so against a descriptor mapping id 10 it RENDERS the newline as a visible glyph mid-line -- 3 draw calls where `draw` makes 2 on separate lines. Section 3's T0 law "drawWrapped with a one-line layout covering `[0, len)` produces the byte-identical `dx` column that `draw` produces" is therefore false for any font mapping id 10, which is a precondition of M2's centrepiece that nobody stated. | descriptor maps `{id: 10, xadvance: 7}`: `measure('A\nA')` -> `31`, `draw` dx -> `[0, 0]`, `drawWrapped` over `[0,3)` dx -> `[0, 12, 19]` |
| **F-26** | S3 | **The F-03 guard reshape in `draw` and `drawWrapped` is unfalsifiable through the public API, and M2 shipped it anyway -- deliberately.** Revert BOTH reshaped guards to the NaN-accepting `if (id < 0 \|\| id >= 256) continue;` and `npm test` (93 blocks) and `npm run torture` (10 tiers) both stay green. The reason is structural: `draw` has no range parameters, so `charCodeAt` over `[0, len)` can never yield NaN; and after M2's H13 per-line clamp, `drawWrapped`'s indices can no longer reach the guard as NaN either. **The load-bearing F-04 fix is the clamp, not the reshape** -- reverting `if (!(startIdx >= 0)) startIdx = 0;` reddens T2 row 9 instantly. The third site, `_measureRange`, IS falsifiable, because it takes `start`/`end` as parameters: T0 law 11 kills its inversion. So one of three sites is pinned behaviourally and two are pinned only by DONE WHEN rows 7/8, which are a source-text gate a human runs, not something `npm test` or CI can see. ~~**Routed to M6**, which promotes `start`/`end` to the public surface and thereby creates the first NaN-capable call path into `draw`'s guard; M6 must add the behavioural kill and this row closes there.~~ **RE-ROUTED 2026-08-20 to M9pre. M6 was CUT** (see THE CUT in its brief), so the public range API that would have made this guard falsifiable is never built and the reshape is unfalsifiable through the public API PERMANENTLY, not until M6. The question changes with the owner: M9 must either DELETE the two unfalsifiable reshapes and let `_measureRange`'s falsifiable one stand alone, or keep them and pin them in the ASCII/source-text gate M2b built, recording that a source-text pin is all they will ever have. Deciding not to decide is what put this row here twice. **TWO FURTHER CORRECTIONS, 2026-08-20, both verified against 1.9.0.** (a) **This row says TWO reshaped sites. There are THREE**: `BitmapFont.js:732` (draw), `:1233` (drawWrapped) and **`:1360` (layoutGlyphs)**, the third added by M5/1.9.0 by a session not thinking about F-26 at all -- which is itself the argument against deletion. (b) **The answer is KEEP + a source-text pin, not delete.** Deleting does not remove a guard; it writes the NaN-ACCEPTING form `id < 0 || id >= 256` back into three hot bodies, and that form is false for NaN, i.e. it ACCEPTS NaN -- F-03's silent-corruption mechanism restored by hand on the theory that no CURRENT call path reaches it, which is an unverified state about all FUTURE call paths. Cost of keeping is zero: `BitmapFont.js:731` already records "Two comparisons before, two after". What keeping costs instead, recorded as weaker than every other assertion in this repo: these three sites will never have a behavioural test, their only gate is a source-text pin, and that must never be described anywhere as behavioural coverage. The pin must be proven in BOTH directions -- `:423` and `:729` contain the forbidden string inside comments warning against it, so a naive grep matches its own docs. Recorded rather than "fixed" because the honest options today are a synthetic test of a private path or nothing, and F-20/F-21 are both in this ledger because someone preferred a comfortable assertion to an absent one. | revert both guards -> `npm test` exit 0, `npm run torture` -> `ok` exit 0. Invert `_measureRange`'s -> `torture: FAIL -- T0.law11: _measureRange("A",0,2) NaN != 12 (NaN id leaked past the guard)` |
| **F-27** | S3 | **T7's "second independent witness" does not witness anything. The retention tier cannot see a leaked font.** `t7-soak.mjs:49` tracks a fresh throwaway `{cycle: c}` object and `:57` untracks it in the SAME iteration, unconditionally. The font is never tracked, so `tracker.size() === 0` is true by construction whether or not fonts leak. The tier's own docstring claims "a typed-array leak and a JS-object leak must not be able to hide behind each other" -- as implemented, the JS-object half is unmanned. Proven by qa: injecting a genuine owner-cascade leak into the constructor that retains all 4096 font shells forever left `npm run torture` at exit 0, `ok`, `tracker.size() === 0`, and heap growth still inside 512 KB -- because `destroy()` nulls the typed arrays, so the retained shells are tiny. Introduced by M0, not by M2; M2 found it. Every session between M0 and the fix reports a T7 retention number that proves typed-array nulling only. **Routed to M9pre** (2026-08-20; was M9). **THE PRESCRIBED FIX CONTRADICTED THE TIER'S OWN HEADER, AND THE HEADER IS THE HALF THAT IS WRONG.** `t7-soak.mjs:13-16` states that "tracking the font itself, or a cleanup that closes over the font, violates lite-leak's held-value contract and pins the very object it watches", which is why the tracked target is a throwaway. The actual contract (`@zakkster/lite-leak` `llms.txt:125-129`) reads in full: "Neither `cleanup` nor `tag` may close over `target`. Both are retained on the internal record until FR fires or untrack; capturing the target via either defeats finalization." It constrains `cleanup` and `tag`. **It does not forbid tracking the target** -- `track(target, cleanup, tag?, options?)` exists to watch exactly that object. So the second clause of the comment is right and the first is false, and the false clause is the rationalisation that produced the blind witness. The fix is `tracker.track(font, NOOP, c)` -- `NOOP` is already module-level and `c` is a number, so both legs of the REAL contract were already satisfied by the code that was there. Correcting the comment is part of the fix; an uncorrected one makes the next session re-derive the same false constraint. Fix: track the font itself, or a proxy whose lifetime is provably tied to it, with a cleanup that does not close over the target, and read `tracker.size()`/`audit()` after a real `gc()` + settle tick -- never a same-iteration track/untrack pair. | plant a module-level retainer in the constructor -> 4096 fonts retained -> `npm run torture` -> `ok`, exit 0, `tracker.size()` 0 |
| **F-28** | S2 | **The `opts` bag M2 introduced fails OPEN, and M3's entire design hangs off it.** The constructor reads `opts.missingAdvance` and validates that one value hard, but never validates `opts` itself and never rejects an unknown key. `new BitmapFont(atlas, json, { missingAdvanc: 6 })` -- one dropped `e` -- constructs silently with `missingAdvance` 0 and no error, which is the exact F-12 gap the option exists to close. `opts` of `7` or `'x'` also construct: the `opts !== undefined && opts !== null` door admits every primitive, and `(7).missingAdvance` is `undefined`. This matters beyond the typo: M3 proposes `{ checked: true }` in the same bag, so a caller who typos the flag gets the unchecked lane with no signal -- a validator most callers never run, defeated by a keystroke. Opened by M2 (the bag is M2's), found in the M3 precondition probe. Fix belongs in M3, ahead of any `checked` work: reject non-object `opts`, and reject unknown own keys against a frozen allowlist. Cold path; cost is irrelevant. | `new BitmapFont(ATLAS, OK, { missingAdvanc: 6 })` -> constructs, `glyphs[65*7+6]` unchanged; `new BitmapFont(ATLAS, OK, 7)` -> constructs; `new BitmapFont(ATLAS, OK, { checked: true })` -> constructs |
| **F-29** | S2 | **A non-number `id` coerces through the range test, writes the glyph table, and is never marked in `_mapped` -- so `hasGlyph` disagrees with the table it describes.** M2 shipped `_mapped` with the stated invariant that it "keeps the two structures consistent with each other," and scoped the integrality test to `id === (id \| 0)`, which is correct for a fractional number and wrong for every other type. `id: '65'` passes `id >= 0 && id < 256` by string-to-number coercion, `ptr = '65' * 7` is `455`, four slots are written, `measure('A')` returns 12 -- the glyph renders -- and `hasGlyph(65)` is `false`. `id: null` coerces to 0 and writes glyph id 0; `id: true` coerces to 1 and writes glyph id 1. Three silent writes to ids the descriptor never named, each invisible to `hasGlyph`. This is the coverage-detection API from M2 lying in the direction that matters: a caller checking `hasGlyph` at load time to find gaps is told a glyph is missing that will in fact draw. | `new BitmapFont(ATLAS, {chars:[{id:'65',...}]})` -> 4 non-zero slots, `measure('A') === 12`, `hasGlyph(65) === false`; `id: null` -> writes ptr 0; `id: true` -> writes ptr 7 |
| **F-30** | S2 | **A non-finite glyph field stores as 0 and the glyph is reported covered.** `x: NaN`, `x: Infinity` and `x: -Infinity` each write `glyphs[65*7] === 0` -- the Int16 store maps every non-finite to zero -- and `hasGlyph(65)` returns `true`. `null is not zero`: an atlas x of NaN is an unverified state, and the table now claims the glyph sits at the top-left corner of the sheet with full confidence. Distinct from F-08, whose two cases (wrap and fractional truncation) are both LOSSY-but-interpretable and therefore belong in the checked lane: there is no reading of `x: NaN` that renders the intended glyph, so it belongs in the always-throw lane. Recording it separately so the M3 accept/reject matrix cannot route it by analogy to F-08. | `chars:[{id:65,x:NaN,...}]` -> `glyphs[455] === 0`, `hasGlyph(65) === true` |
| **F-31** | S2 | **T6's structural gate pins four NAMED arrays and cannot see a fifth, so any new per-font allocation is invisible to the whole suite.** `t6-alloc.mjs:39-53` asserts `_charScratch.byteLength === 24`, `glyphs === 3584`, `kerning === 131072` and `_mapped === 32` -- four independent equalities and no total. Nothing asserts that the font has no OTHER typed array. Proven in M3: adding `this._bloat = new Float64Array(512)` (4096 bytes) to every font left `npm run torture` at `ok` exit 0 and `npm test` at 103/100/0/3, with all four named checks green. T7 builds 4096 fonts, so that mutation adds 16.7 MB across the soak and no tier notices; the package publishes 134,712 bytes per font as a headline number in README and `decisions/0002`, and that number is unguarded. This is the AR-02 question answered NO: the plan's assertion A29 named this gate as the detector for exactly this mutation and the attribution does not reproduce. Distinct from F-27 (which blinds the RETENTION witness): this blinds the STRUCTURAL witness, and the two together mean a per-font allocation added in any future session is caught by nothing. Fix: assert the sum, derived by walking the instance's own typed-array properties, so an unlisted array raises the total and fails. **Routed to M9** alongside F-27. | `this._bloat = new Float64Array(512)` in the constructor -> `npm run torture` `ok`, `npm test` 103/100/0/3, all four structural equalities green |
| **F-32** | S2 | **The zero-alloc and retention gates never drive the REJECT branch of the three new per-call `scale` doors, so a leak or an allocation planted there is invisible end to end.** T6's alloc/ops windows all call with `scale = 1` (window A passes it explicitly at `t6-alloc.mjs:80`; B and C take the default), which is the ACCEPT branch. The reject branch is exercised only by T1's correctness sweep and T3 rows 41-43, and neither gates allocation or retention. Proven twice, independently, in M3: replacing `draw`'s `if (!(scale > 0 && scale < Infinity)) return;` with a body that does `this._rejectLog = (this._rejectLog || []).concat(scale); return;` -- an unbounded per-instance leak AND a per-call allocation on the session's headline new code -- left `npm test` at 103/100/0/3 and `npm run torture` at `ok` exit 0. Third instance of the class that F-27 (retention witness tracks a throwaway) and F-31 (structural gate has no total) belong to: each blinds a different witness, and together they mean the zero-GC claim is unenforced on every path the measured windows do not happen to take. **Routed to M9** with F-27 and F-31. Fix: drive each door's reject branch inside a measured window, or record that fail-closed branches are correctness-tested only and never alloc-gated. | plant `this._rejectLog = (this._rejectLog \|\| []).concat(scale)` in `draw`'s scale-door reject -> `npm test` 103/100/0/3, `npm run torture` `ok` exit 0 |
| **F-33** | S3 | **T3 row 56 claims every CHECKED row runs in BOTH lanes; row 26 runs only one.** The tier-wide contract (`SESSION-M3.md` section 6.2 row 56, restated in `decisions/0003`) is that each checked-lane row is asserted twice -- once with `{checked: true}` and once without -- because a row asserted in a single lane cannot see a door that migrated to the wrong lane. Row 26 (`xadvance: -8.6`) asserts only the CHECKED throw (`t3-descriptor.mjs:174-178`, duplicated at `BitmapFont.test.js:1013-1014`); the UNCHECKED half -- that the Int16 store truncates toward ZERO and stores `-8`, not `-9` -- is asserted nowhere executable and survives only as prose in `decisions/0003` and the ROADMAP PROBE. The checked half is genuine, so F-08's message-wording requirement (must say "toward zero", never "floor") is really pinned; what is unpinned is the storage behaviour that wording DESCRIBES. Same shape as F-24: a record asserting a property no gate checks. Found by qa in M3, fixed in M3. | before the fix, no executable assertion in `test/` pinned `glyphs[65*7+6] === -8`, while row 56's both-lanes claim appears in three files |
| **F-34** | **S1** | **`_measureRange` NEVER TERMINATES on an unbounded range, and `measure` reaches it from the public surface.** The walk is `for (let i = start; i < end; i++)`; at `start === -Infinity` the increment never advances (`-Infinity + 1 === -Infinity`) and the loop is unkillable, exactly F-01's shape one function over. `measure(text, scale)` forwards `0` and `text.length`, so a string can never reach it -- but `measure` has no text door (F-36), and `measure({length: Infinity, charCodeAt(){return 65}})` hangs today, in 1.3.0, with no throw. `drawWrapped` is IMMUNE: M2's F-04 clamp (`if (!(startIdx >= 0)) startIdx = 0;` plus the `endIdx` clamp) runs first, which is the third confirmation that the clamp, not the guard reshape, is the load-bearing fix (F-26). This is a hard PRECONDITION of M4, not something M4 may discover: the brief prescribes `measureLine(text, start, end, scale)` as "a thin forward to `_measureRange`", which publishes an unbounded hang as a supported API on a render-adjacent path. T9 control 9 already owns out-of-process hang machinery (`t9-hang-child.mjs`) and is the ready-made gate. **Fixed in 1.4.0 (M4)** at the PUBLIC faces only: `measure`/`measureWidest` gain a `typeof text === 'string'` door and `measureLine` gains the `drawWrapped` clamp, so all three terminate. `_measureRange` keeps NO door and its body is byte-for-byte the 1.3.0 body (decisions/0004 fork 3 sub-fork A2) -- clamping it would tax `draw`'s per-line align calls, which cannot be out of range by construction. The boundary is proven by T9 control 13, which kills a door-removed child. | `f._measureRange('AAAA', -Infinity, Infinity, 1)` -> SIGKILL after 6 s (exit 137); `f.measure({length: Infinity, charCodeAt(){return 65}})` -> SIGKILL after 6 s; same input through `drawWrapped`'s layout buffer -> returns |
| **F-35** | S2 | **`_measureRange` and `drawWrapped` disagree about what a fractional or negative index means, so a public `measureLine` would report a width `drawWrapped` does not render.** `drawWrapped` CLAMPS its indices once, up front, then walks a fractional `i` and lets `charCodeAt` truncate per ITERATION -- exactly as `_measureRange` does, so the ONLY difference between the two walks is the clamp. The two readings coincide for positive fractions and diverge for a negative one, because `charCodeAt(-0.5)` is `ToIntegerOrInfinity(-0.5) === -0`, which reads index **0** -- so a negative fractional start ADDS a glyph instead of being rejected, the exact opposite of what the F-04 clamp exists to do. A caller computing `layoutBuffer[2]` (lineWidth) with `measureLine` and handing it to `drawWrapped` gets an alignment one glyph too wide, silently. This is F-06's own disease -- two functions in a four-function package disagreeing about a width -- in the surface M4 proposes to ADD, so M4 must settle the index policy before it publishes the method. **Fixed in 1.4.0 (M4)**: `measureLine` CLAMPS and deliberately does NOT truncate, exactly as `drawWrapped` does not, so it reports what the renderer draws on every measured range -- `[-0.5, 2)` 16 / 2 quads, `[0.5, 2.7)` 24 / 3 quads, `[1.9, 3.1)` 16 / 2 quads, `[0, 99)` 32 / 4 quads. A clamp-PLUS-truncate door was ratified first and reversed mid-session on measurement: truncating collapses `[0.5, 2.7)` to two glyphs and reintroduces F-35 one method over. T5 pins the agreement itself (`measureLine === drawn * advance`), not three literals, and `BitmapFont.js` carries a DO-NOT-ADD-Math.trunc comment at the door. | range `[-0.5, 2)` on `'AAAA'`, advance 8: `drawWrapped` draws **2** glyphs, `_measureRange` returns **24** (3 glyphs). `[0.5, 2.7)` -> 3 and 3; `[1.9, 3.1)` -> 2 and 2 |
| **F-36** | S2 | **`measure` has no scale door and no text door, so M3's F-11 fail-closed policy is installed on the renderers only.** All three draw methods now reject a `scale` outside `(0, Infinity)` and draw nothing; `measure` propagates it -- `measure('AA', NaN)` -> `NaN`, `measure('AA', Infinity)` -> `NaN`, `measure('AA', -1)` -> `-16` (a negative width). The text argument has no door either: `measure(123)` -> `0` (fails open, `(123).length` is `undefined`) and `measure(null)` / `measure(undefined)` -> a raw `TypeError` naming an internal property, the shape M3 spent its whole budget removing from the constructor. One bad `scale` therefore produces TWO different failure modes in one frame: the caller sizes a box at `NaN` and `draw` silently declines to render, so the text vanishes and the layout is poisoned, with no throw at either site. Compounds with F-34: it is the absent text door that makes the hang publicly reachable. M4 adds `measureWidest` and `measureLine` to this family and must settle the policy for all four at once -- including whether `measure`'s own frozen `NaN` return changes, which is a behaviour delta on a public method and belongs in a declared row, not a footnote. **Fixed in 1.4.0 (M4)**: one fail signal -- NaN -- across all three public measure faces, with the same range-test scale door the three draw bodies carry and a `typeof text === 'string'` door, in that order. Seven declared deltas (D1-D7 in CHANGELOG). The asymmetry with the renderers is deliberate and documented: a renderer can decline to act, a query cannot decline to answer. | `measure('AA', NaN)` -> `NaN`; `measure('AA', -1)` -> `-16`; `measure(123)` -> `0`; `measure(null)` -> `TypeError: Cannot read properties of null (reading 'length')`; the same `scale` values through `draw` -> 0 drawImage calls |
| **F-37** | **S2** | **Nothing in the gate can see TRANSIENT allocation, so "zero allocation on any hot path" is unproven on all six T6 windows -- and the one rule that would catch it is structurally vacuous.** Three independent mechanisms compose: (i) `measureAllocs` / `maxBytesPerCall` is a RETENTION lane by the profiler's own definition -- `lite-gc-profiler/llms.txt:179` says it is "Distinct from `measureOps`, which reports an allocation RATE (`maxBytesPerOp`) and sees transient garbage that `measureAllocs` settles away" -- so per-call garbage that the scavenger reclaims measures as exactly 0 bytes; (ii) `checkNoGc`'s `maxBytesPerOp` rule reads `summary.bytesPerOp`, but `measureOps` puts `bytesPerOp` on the RESULT, not the summary (`summary.bytesPerOp` is `undefined`), and `checkNoGc` cannot be handed the result instead because it dereferences `summary.gc.major` and throws -- **so `maxBytesPerOp` passes at every threshold for every body, including `0` and `0.0001` against a measured 0.0638 B/op**; (iii) `stabilize: 'deep'`, which `harness.mjs:157-164` hardcodes because `maxArrayBuffersGrowth` requires it, additionally converts `bytesPerOp` from transient allocation into retention (`Gc.d.ts:822-826`). Proven in M4 by planting the plan's own A26 mutation -- `measureWidest` reimplemented with `text.split('\n')`, allocating one array plus three strings per call across 505,000 calls in window E: `npm run torture` printed `ok`, exit 0, with `measureAllocs` reporting `bytesPerCall = 0`, `checkAllocs` `verdict = pass`, and `checkNoGc` `ok = true`. A direct `perf_hooks` GC observer over the same loop separates the two bodies unambiguously -- **shipped 1 GC event, split mutant 82 (81 scavenges)**, heap delta 35,184 B vs 73,912 B -- so the signal exists and no gated rule reads it. Fourth member of the class F-27 (retention witness tracks a throwaway), F-31 (structural gate has no total) and F-32 (reject branches never measured) belong to, and the broadest: those blind one witness each, this one means the package's headline claim, asserted in README seven times (F-17) and in `llms.txt`, has never been gated by anything that can observe it. **M4 corrects its own false comment and adds an ALLOCATION-VOLUME detector to the two windows it introduces (E and F) -- the sum of positive `heapUsed` deltas over 200,000 strided calls, limit 1,000,000 B, measured 21,384-26,432 B on the shipped bodies and 32,881,040 B on the split mutant. **CLAUSE (ii) HAS NO REFERENT IN THIS GATE (verified 2026-08-20).** `harness.mjs:44` reads `RULES = { maxMajor: 0, maxPauseMs: 4, maxArrayBuffersGrowth: 0 }`; `grep -rn maxBytesPerOp test/` returns only two COMMENTS (`t6-alloc.mjs:91`, `:392`). The rule has never been in `RULES`, so there is nothing vacuous to delete -- the vacuity is a property of `checkNoGc` IF the rule were added, and M9pre records that as a reason not to add it. **THIS ROW'S MUTANT NUMBER IS WRONG. RESOLVED BY MEASUREMENT 2026-08-21 (M9pre).** The row said 32,881,040 B; `t6-alloc.mjs:112` said "28,042,664 B, every rep". Re-measured on this host at Node v26.3.1: **28,042,592 B isolated** (72 B from the gate's figure -- GC noise) and **30,795,416 B inside the full-run context**. The gate's number reproduces; **this row's 32,881,040 does not**, and is retained above only as the M4-era reading it was. The lesson is the row's own: a number quoted from a finding is not a measurement, and two tracked files disagreed by 17% for four releases with nothing able to notice. A `PerformanceObserver` on `'gc'` was prescribed first and measured UNUSABLE: its entries are delivered on a later turn and `takeRecords()` returns 0 from inside the loop; the general fix -- all six windows, the vacuous rule, and the `maxArrayBuffersGrowth`-vs-transient conflict, which cannot both be gated in one `stabilize` mode and therefore need two passes -- is routed to M9** alongside F-27/F-31/F-32. | plant `measureWidest(t,s){ const L=t.split('\n'); let m=0; for(...) m=Math.max(m,this._measureRange(L[l],0,L[l].length,s)); return m; }` -> `npm run torture` `ok` exit 0; `measureAllocs` `bytesPerCall=0` `verdict=pass`; `checkNoGc` `ok=true`; `checkNoGc(summary,{maxBytesPerOp:0.0001})` -> `pass` at a measured `result.bytesPerOp` of `0.0638`; `checkNoGc(result,...)` -> `TypeError: Cannot read properties of undefined (reading 'major')`; perf_hooks GC events shipped **1** vs mutant **82** |
| **F-38** | **S2** | **`measureLine`'s clamp has FOUR legs where `drawWrapped`'s has TWO, so the two disagree on a NaN `end` -- fork (3)'s own criterion, unclosed, on the exact value a failed layout produces.** `drawWrapped` clamps with `if (!(startIdx >= 0)) startIdx = 0;` and `if (!(endIdx <= tlen)) endIdx = tlen;` (`BitmapFont.js:919-920`) -- a NaN `endIdx` fails `<=`, becomes `tlen`, and the WHOLE line renders. `measureLine` adds `if (!(end >= 0)) end = 0;`, which fires first on NaN and drives `end` to 0, so it returns 0 px for a range the renderer draws in full. Measured on an advance-8 font: `[0, NaN)` -> `measureLine` **0** vs `drawWrapped` **4 quads (32)**; `[NaN, NaN)` -> 0 vs 32; `[1, NaN)` -> 0 vs 24. A `layoutBuffer` is a `Float32Array` and NaN is precisely what it holds when a layout pass fails or was never run, which is the caller this method exists for. The two surplus legs were added for symmetry and one of them is not symmetric: dropping `!(end >= 0) -> 0` makes the doors agree on NaN AND on negatives (a negative `end` then falls to `!(end > start)` and returns 0, matching the renderer's never-entered loop), while `!(start <= len) -> len` is harmless and can stay. Found by qa in M4, fixed in M4. Same shape as F-35, one method further on, and the reason it survived fork (3)'s ratification is that no tier enumerated a NaN `end`. | `measureLine('AAAA', 0, NaN, 1)` -> `0`; the same range through `drawWrapped` -> 4 drawImage calls |
| **F-39** | S3 | **`measureWidest` floors its answer at 0, so it disagrees with `measure` and with its own oracle law on any font whose widest line is negative.** The body opens `let max = 0` and closes `return width > max ? width : max`, so a negative line width can never be returned. A negative `xadvance` is a valid `Int16` the constructor accepts in BOTH lanes -- `{ checked: true }` included, because a negative advance is neither lossy nor non-finite -- and negative kerning reaches the same state with non-negative advances. Measured: `xadvance: -5` gives `measure('AAA') === -15` and `measureWidest('AAA') === 0`; `xadvance: 0` with `kernings: [{first: 65, second: 65, amount: -3}]` gives `measure('AAA') === -6`, oracle max `-6`, `measureWidest` `0`. This falsifies assertion A3 (`measureWidest(s) === measure(s)` for newline-free `s`) and A5 (the allocating-oracle law) for that whole class, and both assertions are VACUOUS with respect to it because T5's corpus runs only `FONT_SNAP` and `FONT_SNAP_KERN`, which are all-positive by construction. Fix: initialise the accumulator to `-Infinity`; the empty string still returns 0 because the final comparison sees `width === 0`. Found by qa in M4, fixed in M4. | `xadvance: -5` -> `measure('AAA')` `-15`, `measureWidest('AAA')` `0` |
| **F-40** | S3 | **The fork (4) amendment claims a constructed font cannot produce a NaN width from valid input; it can, so NaN is not an unambiguous fail signal.** `decisions/0004` and `SESSION-M4.md` 2.6 both record "every advance is a value out of an `Int16Array` multiplied by a finite scale, so a font that constructs cannot produce a NaN width from valid input", which is what makes NaN readable as "you gave me an argument I cannot use". Mixed-sign Int16 advances defeat it: with `xadvance: 32767` and `xadvance: -32768`, `measure('AB', Number.MAX_VALUE)` is **NaN** (`+Infinity + -Infinity`), indistinguishable from the door's fail signal, and `measure('A', Number.MAX_VALUE)` is **Infinity** -- a non-finite width from a scale the door ACCEPTS, since `Number.MAX_VALUE` passes `!(scale > 0 && scale < Infinity)`. Both behaviours are pre-existing (1.3.0 is identical) and neither is a semver delta; what is new in M4 is the record asserting they cannot happen. Recorded rather than fixed: narrowing the scale door to exclude `MAX_VALUE` would need a magnitude bound nobody has derived, and the honest repair is to state the limit. Same class as F-24 -- a record claiming a property the code does not have. Found by qa in M4; the claim is corrected in M4, the behaviour is left to M9 alongside F-08's storage half. | `chars` advances `32767` and `-32768`: `measure('AB', Number.MAX_VALUE)` -> `NaN`; `measure('A', Number.MAX_VALUE)` -> `Infinity` |
| **F-42** | **S1** | **The F-34 hang is still reachable through `draw` and `drawWrapped`; M4 doored the measure family and left both renderers open.** `measure` (`:432`), `measureWidest` (`:467`) and `measureLine` (`:542`) each open with `typeof text !== 'string'`, and the comment at `:432` names the culprit exactly -- "`{length: Infinity, charCodeAt(){return 65}}` ... is exactly the input that hung 1.3.0 forever (F-34)". Two hundred lines below, `draw:628` and `drawWrapped:892` read `text.length` with no door at all. `draw` hangs in the line scan at `:657` (`while (lineEnd < len && text.charCodeAt(lineEnd) !== 10) lineEnd++`); `drawWrapped` hangs in the glyph walk at `:959`, because `tlen` is `Infinity` and the F-04 clamp leg `if (!(endIdx <= tlen)) endIdx = tlen;` **passes** an `Infinity` `endIdx` -- that clamp is sound only while `text.length` is finite. The 1.4.0 CHANGELOG's F-34 row reads "All three public faces now terminate", which is true of the three it means (the three MEASURE faces) and false of the package: **FIVE** public faces take `text` -- `measure`, `measureWidest`, `measureLine`, `draw`, `drawWrapped` -- two still hang, and the hanging pair is the one a caller reaches first. (`drawFast` is a renderer but takes a number; `_measureRange` is private and deliberately doorless per fork (3) A2. This row said SIX in its first draft, which was the coordinator's miscount and propagated into the M4a plan and four shipped files before M4a's reviewer caught it.) Beyond the hang the two families disagree on every non-string: `draw` RENDERS a boxed `String` and a duck-typed `{length: 2, charCodeAt}` (two glyphs), silently draws nothing for `123`, and throws a raw `TypeError` for `null`, `undefined` and `[65]` -- while all six of those return `NaN` from the measure family. So a caller who gates on `Number.isNaN(measureWidest(t))` is protected and a caller who simply calls `draw` is not. Found in the M5 precondition probe, 2026-08-18, against published 1.4.0. **Fixed in 1.4.1 (M4a)**: `draw` and `drawWrapped` gain the SAME `typeof text !== 'string'` door the measure family has carried since 1.4.0, one per CALL and zero per glyph, immediately above the scale door; both now draw nothing and return on a non-string. Five text-taking faces, one text door, two fail signals by family -- renderers draw nothing, measure faces return `NaN`. Proven out of process by T9 controls 14 and 15, each of which SIGKILLs a door-removed twin so the hang control is not vacuous (decisions/0004 fork 9). The two declared behaviour deltas (boxed `String` 1->0 glyphs; `null`/`undefined` raw `TypeError`->return) ship under CHANGELOG `Changed (behaviour)`. | out-of-process, 6 s SIGKILL: `draw(ctx, {length: Infinity, charCodeAt(){return 65}}, 0, 0)` -> `signal=SIGKILL ms=6004`; `drawWrapped(ctx, SAME, new Float32Array([0, Infinity, 8, 0]), 1, 100, 100, 0, 0)` -> `signal=SIGKILL ms=6003`; the same object through `measure` / `measureWidest` / `measureLine` -> `status=0 ms=22 RETURNED`. `draw(ctx, new String('A'), 0, 0)` -> 1 `drawImage`; `measureWidest(new String('A'))` -> `NaN` |
| **F-43** | S3 | **Both shipped doc files state a test count that 1.4.0 itself falsified, and no gate can see it.** `llms.txt` Testing says "116 tests, 114 pass, 0 fail, 2 todo -- 85 in BitmapFont.test.js, 1 version-sync block in packaging.test.js, 27 in boundary.test.js, 3 in findings.test.js"; `README.md:418` says "**116 tests** (114 pass, 0 fail, 2 finding-watch todos". `npm test` reports **119 / 117 / 0 / 2**, with **88** in `BitmapFont.test.js` -- M4 added three assertions and rewrote the prose around these two sentences without touching either number, so the release gate passed with both files lying. Adjacent to F-14 (docs drift) but distinct: `packaging.test.js`'s sync block pins the VERSION string, which is why the drift that IS gated stayed correct and the drift that is not shipped. Nothing in `npm test` or the torture run reads either figure; closing this means a doc gate that does, not a careful re-edit. **Fixed in 1.4.1 (M4a)**: the two counts are DELETED from `README.md` and `llms.txt` and replaced with the gated statement -- `npm test` -> 0 failures, `npm run torture` -> exactly `ok`. Ratified in decisions/0004 fork 9: a count no gate can read is a liability, and pinning it behind a test that asserts its own suite's size is circular. The T8 docs-drift guard is deliberately NOT extended to counts. | `npm test` -> `tests 119 pass 117 todo 2`; per file `88 / 27 / 3 / 1`; `grep -n "116 tests" README.md llms.txt` -> two hits |
| **F-44** | S2 | **The zero-allocation guarantee holds only below 2^31: both number renderers box one HeapNumber per call above the Smi cliff, and no shipped gate could see it.** The Law "zero allocation on any hot path" and the README/llms.txt "zero-GC" headline are the package positioning, and both are true only while the digit-loop variable stays a Smi. Above 2^31 an integer-valued double is a boxed HeapNumber, so `temp % 10` and `Math.floor(temp / 10)` each allocate a fresh box; measured deterministically at ~16 B/call (one box per call). This is the same cliff decisions/0005 section 0.4b documents for THROUGHPUT (the 11-digit knee where `temp` leaves Smi range) -- there it costs time, here it costs allocation, one mechanism. **`drawFastInt` (M8) and `drawFast` (M1) BOTH have it; `drawFast` is PRE-EXISTING, carried since it was written, and no gate ever saw it** -- T6 window B drives a 5-digit cycle (10000+) that never leaves Smi range, the retention lanes cannot see transient garbage (F-37), and the profiler maxBytesPerCall lane is itself a retention lane. M8 window G, pointed at a 16-digit cycle for the first time, is what surfaced it. `DRAWFASTINT_MAX = Number.MAX_SAFE_INTEGER` DELIBERATELY admits the 16-digit regime, so the ceiling and this caveat are linked: the constant that makes drawFastInt exact by construction is the same one that admits the allocating range. Severity **S2, the same shape as F-23**: a DOCUMENTED guarantee -- the headline zero-allocation claim -- is broken across a range the API explicitly admits. Not a crash and not a wrong pixel, but a positioning promise that is false for every value above 2^31 (2,147,483,648). **The boundary is 2^31 exactly, not an approximation** -- measured sharp: 2^31-300 allocates 0.00 B/call, 2^31+1 allocates 15.99. Values in (9e8, 2^31) are still Smi and still zero-alloc. It is not S3 because it contradicts the package lead selling point over a supported input range, not a stale count or an internal record. Found by the coder in M8 while re-calibrating T6 window G for the B2 blocker, 2026-08-19; boundary confirmed sharp by the coordinator. **NOT M8 to fix**: M8 is frozen on `drawFast` by decisions/0005 fork (1) and A7, and any repair here reopens the exact body that freeze exists to keep shut. **Routed to M8b**, which already owns `drawFast` digit extraction (F-23) and must reopen both loops anyway -- a Smi-safe integer path (an int32 fast lane below 2^31, or documenting the boundary as the honest repair if no allocation-free 16-digit algorithm exists) belongs in the one session that rewrites the arithmetic. Recorded, not fixed. **MISDIAGNOSED -- corrected in 1.7.0 (M8b) by decisions/0007:** F-44 closes because its STATED MECHANISM WAS WRONG, not because anything was removed. The claim was that `temp % 10` / `Math.floor(temp / 10)` box a HeapNumber INSIDE the digit loop above 2^31, ~16 B/call. Measured 2026-08-19 (M8b, and independently by the reviewer): old vs new is 15.93 vs 15.93 B/call on a 16-digit cycle -- the hi/lo split changed nothing observable -- and on the OLD code a CONSTANT argument already measured ~0 B/call, so the old digit loop never boxed either. The ~16 B/call is the CALLER boxing the >2^31 argument at the call boundary (one box per CALL, flat in digit count: old code 10-digit 15.89, 16-digit 15.89); it is caller-side, identical before and after, and removable by no change to this library. The hi/lo split is KEPT for source-level Smi discipline (which holds in the pre-warmup Ignition tier T6 cannot reach) and the throughput Smi-knee (decisions/0005 0.4b), not as an allocation fix. T6 window H gates gross regime-B allocation (a BigInt-doubling mutant measures ~40.8 MB vs a ~6.2 MB shipped transient floor). | correct code, NO mutation, `allocVolume(fn)` = 20000-call warmup then 200000 calls sampling `process.memoryUsage().heapUsed` every 1024, summing positive deltas. drawFastInt 5-digit (10000+, Smi) 74,984 B / 0.4 B-per-call; 9-digit (1e8+, Smi) 27,128 B / 0.1; 11-digit (1e10+, boxed) 3,190,208 B / 16.0; 16-digit (1e15+, boxed) 3,206,720 B / 16.0; drawFast 5-digit 24,200 B / 0.1; drawFast 16-digit 3,178,544 B / 15.9. Cycle: 256 doubles `base+i`; `hot=(i)=>{rec.calls=0; FONT_NUM.drawFastInt(rec, cyc[i&255], 0, 0)}` |
| **F-45** | S2 | **`drawWrapped` re-scales a width the producer already scaled, so every centre/right-aligned wrapped line is mispositioned at any `scale != 1`.** `BitmapFont.js:1123-1124` computes `cursorX += (boxWidth - lineWidth * scale) / 2` (and the `align === 2` twin) on the Law at ROADMAP section 3 item 1: the buffer is `[startIdx, endIdx, lineWidth@scale1, flags]` and "`@zakkster/lite-text-layout` emits exactly that shape". **That claim is false.** `LiteTextLayout/TextLayout.js:442-443` accumulates `advance += kerning * scale` and `advance += xadvance * scale`, `:515` re-seeds `cursorX = xadvance * scale`, and that `cursorX` is what lands in the `lineWidth` slot; its drift-guarded RANGE-CONTRACT (`TextLayout.js:289`, pinned byte-identical across four surfaces) states "lineWidth is at **the rendered scale**". `boxWidth` is already rendered px by bmfont's own doc (`BitmapFont.js:1027`). So the two operands disagree by a factor of `scale`. Closed form: the centre error is `lineWidth * (scale - 1) / 2`, the right error `lineWidth * (scale - 1)`. **Invisible to the whole suite because no test renders `drawWrapped` with `align` 1 or 2 at `scale != 1`** -- `t2-layout.mjs` fixes scale at 1 in its helper (`:48`) and every direct call (`:189,196,239,249,252`), and every non-unit-scale call in the repo (`scale 1.1`) passes `align = 0`. At `scale = 1` the double-scale is identically invisible, which is why it shipped. Reported by the `@zakkster/lite-text-layout` TL5 session (its "detector passes at scale 0.5, 1 and 2" assertion fails against bmfont 1.5.0) and filed here because the defect is bmfont's; independently reproduced by the coordinator, 2026-08-19, and the producer's convention confirmed BY EXECUTION rather than by reading: `computeWrap` run at 0.5/1/2 on an advance-10 font emits `w=75` for a 15-glyph line at 0.5x and `w=140` for a 7-glyph line at 2x -- render scale on every line at every scale. End to end at 2x with centre align, `drawWrapped` puts the first glyph at **-40**, off the left edge of the box, where the per-line `draw` oracle puts it at 30. **Fixed in 1.6.0 (M2a)**: adopted the producer's convention (`lineWidth@render-scale`) and dropped the `* scale` on both align terms (`BitmapFont.js:1128-1131`, pure per-LINE deletion, glyph loop byte-identical to `8348bd0`). All five `lineWidth` doc sites now say render scale; decisions/0006 records D-1/D-2/D-3. Coverage that hid it for three versions is closed: T2 now runs a `{0.5,1,2} x {align 0,1,2}` matrix against the per-line `draw` oracle, a frozen `computeWrap` fixture (lane 1, always runs) plus a `spawnSync` drift guard (lane 2, dies on producer drift, TODO when the peer is unwired), and T6 window C2 gates the align path at zero bytes. Repaired cells (first glyph dst x, `'AAA BBB CCC DDD'`, box 200): scale 0.5 centre 80->60, right 160->119; scale 2 centre -56->22, right -112->44; every scale-1 cell and every align-0 cell byte-unchanged. `draw` is NOT affected -- it measures its own glyphs and reads no buffer `lineWidth` (verified: 0 occurrences in its body). | advance-10 font, `'ABCD'`, `layout = [0, 4, 40*scale, 0]`, `boxWidth = 200`. First glyph dst x, `drawWrapped` vs the `draw` oracle: scale 0.5 align 1 -> `95` vs `90` (+5); scale 0.5 align 2 -> `190` vs `180` (+10); scale 1 -> identical both aligns; scale 2 align 1 -> `20` vs `60` (**-40**); scale 2 align 2 -> `40` vs `120` (**-80**). Every delta equals the closed form exactly |

| **F-46** | S3 | **The suite Law's ASCII-only rule is enforced by nothing, and three of the six shipped files break it -- the main source file among them.** `../CLAUDE.md` Law reads "ASCII-only source (U+00D7 and U+00B5 excepted)". Measured by a full walk of the repo (excluding `node_modules` and `.git`), 2026-08-19 against published 1.6.0: **75 non-ASCII characters ship inside the npm tarball** -- `README.md` **56** (15 U+2014 em dash, 11 U+2192 arrow, 3 U+2026 ellipsis, 3 U+2013 en dash, and 24 emoji-region code points -- 21 pictograph glyphs plus 3 U+FE0F variation selectors -- over 18 distinct values, U+1F524 / U+1F680 / U+1FAB6 / U+1F5D2 among them; the punctuation above accounts for the other 32), `BitmapFont.js` **10** (9 U+2014, 1 U+2026 at `:1019`), `llms.txt` **9** (6 U+2014, 2 U+2026, 1 U+2013). `demo/demo-lite-bmfont.html` carries **1,121** more -- 1,062 U+2550 and 48 U+2500 in comment banners, 9 U+2014, 2 U+00B7 in visible markup -- but is absent from `package.json` `files[]`, so it breaks the Law without reaching a consumer. **Neither excepted code point appears anywhere in the repo**: all 1,196 characters are outside the exception, so the exception carries no weight here and the rule is simply unmet. Everything else is CLEAN -- `BitmapFont.d.ts`, `CHANGELOG.md`, `ROADMAP.md`, `LICENSE`, every file under `test/` and `decisions/`, and all nine `SESSION-*.md` -- which is the diagnostic detail: the discipline has held in every file authored since M0 and failed only in the three that predate it, the exact profile a missing gate produces rather than a lapse in care. **No character is behavioural.** The single one inside a source string position is `BitmapFont.js:1019`, and it is in a JSDoc sentence describing the ellipsis flag; the flag's implementation appends three ASCII '.' (code 46) and is untouched -- verified by reading the body, not inferred from the comment. Same class as F-14 and F-43 (a documented property no gate reads), but the property is the LAW rather than a count, and unlike F-43 the honest repair is a gate rather than a deletion: "every byte of every shipped file is < 0x80, except U+00D7 and U+00B5" is byte-checkable in one pass with no judgement in it. **CLOSED in 1.6.1 (M2b, `fd5aa35`).** The census went 1,196 -> **0** across all 39 tracked files, and the repair is a gate, not a sweep: `test/packaging.test.js` enumerates scope from `git ls-files` (never a filename list), reads each file as a Buffer, and fails closed on a broken enumeration, a NUL byte or invalid UTF-8 -- so a new TRACKED file carrying a non-ASCII byte reddens `npm test` on the day it is added, with no test edit. Proven non-vacuous in the wild: the 1.6.1 commit moved `decisions/0008-ascii-gate.md` from untracked to tracked, the scope went 38 -> 39 files, and the gate scanned the new file with no edit. `decisions/0008`. | full-repo `python3` walk: `README.md` 56, `BitmapFont.js` 10, `llms.txt` 9, `demo/demo-lite-bmfont.html` 1121, every other file 0; `grep -n "ascii\|ASCII\|charCodeAt\|0x7f" test/packaging.test.js` -> **0 hits**, so no gate exists to fail |

| **F-47** | S3 | **`README.md` is not built on the blueprint the suite Law names, and the divergence is structural, not cosmetic.** The Docs Law in `../CLAUDE.md` says every README follows `LiteSepforge/README.md` "same spine, in order". Measured against it: bmfont has **no one-line blockquote tagline** under the title (the blueprint's line 3; bmfont goes straight from `# @zakkster/lite-bmfont` to the badge block), **no table of contents**, **no "What you get"**, **no `<details>` deep-dive** (blueprint has **2**, bmfont has **0**), **no Composability section with an end-to-end pipeline**, **no `<details>` Zero-GC design notes with an allocation table**, **no "Design decisions worth knowing"**, **no "What this is not"**, and **no Ecosystem section** -- nine of the spine's rows absent. In their place sit four headings the spine does not have: `What is lite-bmfont?` (where the spine wants the positioning H2 "The X the ecosystem was missing"), `Comparison`, `LLM-Friendly Documentation` and `Changelog`. Every H2 carries a leading emoji, which the blueprint has none of -- the same 24 emoji-region code points F-46 counts, so the two findings overlap on the emoji and nowhere else: F-46 is satisfied by deleting them, F-47 is not. The file also disagrees with ITSELF on the arrow convention the Law fixes as `->`: **11 U+2192 and 17 ASCII `->`, mixed inside one API reference** -- `measure(text, scale?) U+2192 number` at `:240` sits eleven lines above `measureWidest(text, scale?) -> number` at `:251`. That split is the dating evidence: sections written later followed the Law and nothing went back for the earlier ones, the identical profile F-46 shows across files. The peer `LiteTextLayout/README.md` and the blueprint itself both measure **0** non-ASCII, so bmfont is the outlier in the suite and not the norm. **NOT routed to M2b.** M2b is a mechanical byte sweep with a gate behind it and a proof that no executable byte moved; a spine rewrite is an authoring session with different risk, different review, and no byte-level acceptance test, and folding it in would destroy M2b's one clean claim. Filed for its own session, unscheduled. | `grep -n "^#\{1,3\} " README.md` -> 30 headings, 21 of the blueprint's spine rows unmatched; `grep -c "<details>" README.md` -> **0** vs blueprint **2**; `grep -n -i "table of contents\|Composability\|Design decisions\|What this is not\|^## Ecosystem" README.md` -> **0 hits**; `README.md` line 2 is blank where the blueprint's line 3 is the tagline; U+2192 x11 vs `->` x17 in one file |
| **F-48** | S4 | **`Atlas.js` door 3c re-labels a genuine internal bug as a caller DOM failure.** M7's fix for a real fail-open (hostile `createElement`/`getContext` throws escaping as a bare `Error`/`TypeError`, contradicting the `AtlasError` promise shipped in four files) wraps the WHOLE DOM interaction -- `createElement`, `getContext`, and the per-glyph `measureText`/`fillText` loop -- in one `try`. That `try` also spans the pure-JS glyph arithmetic, so a defect INSIDE `generateAtlas` is caught and re-thrown as `AtlasError { field: 'dom' }` reading "generateAtlas failed while building the atlas from the DOM", when the DOM is healthy. Found by qa 2026-08-20 on a probe the coordinator asked for specifically, on the theory that the fix for a narrow fail-open had traded it for a broad mis-attribution -- it had. **S4, not S3**: it is a debuggability defect, not a correctness or safety one. The call still FAILS CLOSED and LOUDLY (nothing is swallowed or returned), no shipped doc claims the `field` values are exhaustive (`Atlas.d.ts` says "e.g."), and any such regression still reddens `A6`, which calls `generateAtlas` unguarded. **NOT fixed in 1.8.0, deliberately.** The repair carries a design choice -- which operations count as "the DOM" -- and inventing that narrowing after qa had already returned PASS would be an unreviewed late edit to the one file the whole session's review chain was built around. The honest move is to record it and let it be scoped. Fix shape when scheduled: narrow the `try` to the three DOM calls only, leaving the glyph math outside it, or pin the allowed `field` values so a mis-attribution reddens. Cheap either way -- the subpath ships with zero consumers. Unscheduled. | Under a HEALTHY `makeDocStub`, inject a reference to an undefined variable inside the per-glyph loop of `Atlas.js` -> throws `AtlasError`, `field: 'dom'`, message `generateAtlas failed while building the atlas from the DOM: totallyUndefinedInternalVar is not defined` -- a library bug reported as a caller-environment bug |

(Every non-ASCII code point named in the F-46 row above is written as a `U+XXXX`
escape, never as the character itself, so this file stays ASCII while describing
the ones that do not. The F-12 and F-24 reproduction strings contain one
non-ASCII character; it is
written here as the JS escape `'A\u00C8A'` / `'A\u00C8B'` so this file stays
ASCII. The strings under test are unchanged.)

### F-01 and F-02 are the same bug at two scales

`drawFast` trusts the magnitude of a caller-supplied double, exactly as
lite-aabb's A-01/A-07 both came down to trusting a float32 ulp. One door at the
top fixes both, and the digit loop needs a `len < buf.length` bound regardless
as a structural backstop. The current top guard is three comparisons
(`value !== value`, `=== Infinity`, `=== -Infinity`); a single range test in the
NaN-safe idiom does strictly more work in **fewer** bytes. This is the rare fix
that makes a hot body smaller, which is why M1 is early and cheap.

### F-03 is the single highest-leverage line in the package

One predicate, written twice, with opposite polarity on the one value that
matters. It is what makes F-04 silent instead of loud. Fixing F-03 does not by
itself fix F-04's bad index, but it converts the symptom from `NaN` coordinates
into a skipped glyph -- from silent corruption into visible absence.

### F-04 blocks the range-addressable session

Session M6 promotes `start`/`end` to the public surface. Shipping it over
F-03/F-04 bakes the poisoning into the lite-text-layout contract, where a
negative index from a wrap engine becomes a whole line of `NaN` draws in every
downstream app. Same ordering argument as the blueprint's "A1 before X1,
always".

### The one law that catches four of these at once

**The advance conservation law.** For any string `S`, any range `[a, b)`, any
scale `s`, and any font `F`:

```
walk(draw, S, a, b, s)  ===  F._measureRange(S, a, b, s)  ===  oracle(F.json, S, a, b, s)
```

where:

- `walk` is recovered from the recording ctx: with `x = 0`, `align = 0` and a
  test font whose `xoffset` is 0, the recorded destination x of glyph `k` IS
  `cursor_k`, so
  `walk = dx[last] + advance(g_last) * s - dx[0]`.
- `oracle` sums `(xadvance + kerning)` straight out of the **original BMFont
  JSON**, in doubles, never touching the `Int16Array` store, with an explicit
  documented value for a character that has no descriptor entry.

Stated as three-way equality rather than two-way, because a two-way check
(`draw` vs `_measureRange`) is exactly the check that would pass today on F-12:
both sides agree that a missing glyph advances 0, and both are wrong together.
The oracle is the independent witness. Consequences:

- **F-03**: a NaN id accepted into the walk makes `dx` NaN; NaN equals nothing,
  so the law fails immediately.
- **F-04**: `startIdx = -1` makes every `dx` NaN; same failure.
- **F-06**: apply the law per line and to the whole string, and the newline
  disagreement is the residual -- `measure('AA\nAA')` is 32 while the two line
  walks are 16 and 16.
- **F-12**: the oracle carries the decided missing-glyph policy; the
  implementation must match it, so "advance 0" becomes a pinned contract or a
  failing test, never an accident.
- **F-08** falls out as a bonus: `oracle` reads the float JSON, `_measureRange`
  reads the truncated Int16 store, so the residual between them IS the
  truncation drift -- 1.2 px on `measure('AA')` with `xadvance: 8.6`. The law
  measures the bug instead of tolerating it.

The law is O(glyphs) and belongs in T0 and T5, never in a hot path. Make it the
centrepiece of M2 the way the free-list invariant was the centrepiece of B1.

---

## 3. The torture suite (`test/torture.mjs`) -- spec

One harness, ten tiers, built once in M0 and extended by every later session.
The DONE-WHEN of every session below is a single command:

```
node --expose-gc test/torture.mjs     -> prints exactly "ok", exit 0
npm run torture
```

### Layout

```
test/
  BitmapFont.test.js       # the 40 ported node:test blocks
  torture.mjs              # entry: tiers in order, prints exactly "ok", exit 0/1
  torture/
    harness.mjs            # recording ctx, scratch pool, zero-alloc asserts, PRNG, gate wrappers
    t0-laws.mjs            # the advance conservation law + metric metamorphics
    t1-degenerate.mjs      # the simple nasty values, crossed with every entry point
    t2-layout.mjs          # the layout-buffer abuse matrix (drawWrapped contract)
    t3-descriptor.mjs      # the malformed-BMFont-JSON matrix (constructor door)
    t4-numeric.mjs         # drawFast digit oracle across a magnitude sweep
    t5-fuzz.mjs            # differential fuzz vs an allocating reference renderer
    t6-alloc.mjs           # the zero-alloc gate (measureOps + measureAllocs)
    t7-soak.mjs            # 4096 build/destroy cycles + lite-leak retention
    t8-packaging.mjs       # DOM-free core import, files[], docs-drift guard
    t9-controls.mjs        # every gate above, deliberately broken, must fail
```

`test/` **never** enters `package.json` `files[]`. `npm pack --dry-run` proves
it, and T8 asserts it.

### The harness problem this package has and lite-bvh did not

lite-bvh's hot body calls methods on a tree it owns. lite-bmfont's hot body
calls `ctx.drawImage` -- a foreign object, nine arguments, up to hundreds of
times per call. The harness must supply that object, and a naive recording ctx
allocates **more than the code under test** and will fail your own gate before
the library gets a chance to.

Three rules, all load-bearing:

1. **One ctx shape in the entire suite, constructed once.** Not "a counting ctx
   for T6 and a recording ctx for T0". Two hidden classes flowing through
   `draw()`'s single `ctx.drawImage(...)` call site makes it polymorphic, and
   the numbers stop describing a real app that only ever passes a
   `CanvasRenderingContext2D`. Build one object, freeze its shape, use it
   everywhere.
2. **`drawImage` takes nine named parameters. Never a rest parameter.**
   `drawImage(...args)` allocates an array per glyph. That single character is
   the difference between a zero-alloc harness and a harness that reports
   megabytes per frame and blames the library. This library only ever uses the
   9-argument overload, so the recording signature is exact.
3. **Parallel typed-array columns, reset by index.** Eight `Float64Array(CAP)`
   columns (`sx, sy, sw, sh, dx, dy, dw, dh`), an `img` identity mismatch
   counter, and three integers:

   - `calls` -- write index into the columns, reset by `rec.calls = 0` (one
     integer store). Never `arr.length = 0` on an array-of-arrays; never
     `push`.
   - `total` -- monotonic call count for conservation assertions.
   - `dropped` -- incremented when `calls >= CAP`; every tier asserts
     `dropped === 0`, so a silently truncated recording can never be read as a
     clean run.

   `CAP = 4096`. NaN detection is a post-window scan over `[0, calls)`, not a
   per-call `Number.isNaN` branch: the branch would cost the hot loop bytes to
   serve the harness, which is exactly the thing this document forbids.

**The atlas is opaque.** `draw` reads nothing out of `this.atlas`; it passes the
reference to `drawImage`. So `{}` is a valid atlas for every non-visual test,
and the harness asserts identity (`img === expectedAtlas`) rather than pixels.
No canvas, no DOM, no jsdom, in any tier.

### Harness rules (inherited from lite-bvh, verbatim in spirit)

- All scratch -- fonts, layout buffers, strings, the ctx -- allocated **once**,
  outside every loop.
- `check(cond, msgThunk)` builds its message only on failure. A template literal
  per iteration is an allocation and would fail T6.
- Seeded xorshift32 PRNG, `SEED = 0x9e3779b9`, overridable with `TORTURE_SEED`.
  On failure print the seed and the op index; replay is
  `TORTURE_SEED=... npm run torture`.
- lite-gc-profiler is **one measurement at a time**. `measureOps`,
  `measureAllocs`, `measureFrames` and `measureOpsAsync` share the heap and
  throw "already in flight" if nested. Tiers run **strictly sequentially**.
- **Unknown rule keys throw** as of profiler v1.10.0, on every lane including
  `checkNoGc`. Do not pass a lane a key it does not implement. There is no
  `maxExternalGrowth`.
- `maxArrayBuffersGrowth` requires `stabilize: 'deep'` on `measureOps`,
  otherwise `summary.arrayBuffers.settled` is false and the rule is
  inconclusive -- never a silent pass.
- Never resolve an unexpected `inconclusive` with `allowInconclusive`. Triage
  via the profiler's shipped `INCONCLUSIVE.md`.
- Read `node_modules/@zakkster/lite-gc-profiler/llms.txt` and
  `node_modules/@zakkster/lite-leak/llms.txt` for the exact current surface.
  Do not write `measureOps`/`checkNoGc`/`createLeakTracker` calls from memory.

### Why `maxArrayBuffersGrowth` stays in the gate here

lite-bvh needed it because its query stack reallocated inside the loop.
lite-bmfont allocates all four of its buffers in the constructor and never
grows them, so the rule looks decorative. It is not, and the reason is F-02:
**the obvious fix to the 1e22 overrun is to grow `_charScratch`**, and a fix
that grows it lazily inside `drawFast` would be invisible to a `heapUsed` gate
(the profiler documents a measured 152x blind spot on ArrayBuffer backing
stores) and caught instantly by this rule. The gate is aimed at the wrong fix,
which is what a gate is for. T6 also pins `_charScratch.byteLength === 24`,
`glyphs.byteLength === 3584` and `kerning.byteLength === 131072` directly, since
no heap gate can substitute for an equality.

### Tier T0 -- the advance conservation law and the metric metamorphics

The law from section 2, checked over the whole fuzz corpus, plus:

- `measure(t, s) === measure(t, 1) * s` exactly, for `s` a power of two.
- `measure('') === 0`; `measure(t) >= 0` for every corpus string with
  non-negative advances.
- `_measureRange(t, a, b) + _measureRange(t, b, c)` differs from
  `_measureRange(t, a, c)` by exactly the kerning pair across the seam --
  pinned as an equation, not as an inequality. This is the property M6's public
  range API sells, and it must be true before the API exists.
- Per-line walks sum to the multi-line `draw` layout; the residual against
  `measure` is the F-06 number and is asserted to be exactly the sum of the
  non-longest lines.
- `drawWrapped` with a one-line layout covering `[0, len)` produces the
  byte-identical `dx` column that `draw` produces for the same string at the
  same origin. Two renderers, one law.

### Tier T1 -- degenerate values

Cross every entry point with: `0`, `-0`, `+Infinity`, `-Infinity`, `NaN`,
`1e21`, `1e22`, `Number.MAX_VALUE`, `Number.MIN_VALUE`, `2**53`, `-1`, `0.5`,
`-0.5`, `1e10`, and the empty string. For `scale`: `0`, `-1`, `NaN`,
`Infinity`, `1e-45`. For `align`/`vAlign`: `-1`, `3`, `1.5`, `NaN`. For each,
pin **the actual answer**, including the ugly ones. "This draws nothing" is a
valid contract. "This draws 24 quads at NaN" is not, and T1 is where that gets
decided rather than discovered.

Every case in this tier asserts `dropped === 0` and `nanCount === 0` over the
recorded columns. `nanCount > 0` is a failure in every tier, always: there is no
input for which drawing at a NaN coordinate is the right answer.

### Tier T2 -- the layout-buffer abuse matrix (the F-04/F-05 tier)

| Case | Status today |
| --- | --- |
| exact `lineCount * 4` buffer | correct |
| oversized buffer, surplus ignored | correct (documented) |
| `lineCount === 0` | correct (early return) |
| `lineCount * 4 > layoutBuffer.length` | **BROKEN (F-05)** -- silent vanish |
| `startIdx < 0` | **BROKEN (F-04)** -- whole line at NaN |
| `startIdx` fractional (`0.5`) | survives by truncation -- pin it |
| `endIdx > text.length` | reads NaN char codes past the end |
| `endIdx < startIdx` | empty line, no draws -- pin it |
| `startIdx`/`endIdx` NaN | passes the F-03 guard |
| `flags` = `0`, `1`, `1.0000001`, `2`, `-1`, `NaN` | **F-13** -- only exact `1` fires |
| `layoutBuffer` a `Float64Array` or plain `Array` | undecided |
| `lineCount` fractional / negative / NaN | undecided |

Every row gets a named test and a decided policy: **throw**, **documented
clamp**, or **documented no-op**. "Silently draws a line at NaN" is not one of
the three.

### Tier T3 -- the descriptor matrix (the constructor door)

`{chars: 7}`, `{chars: []}`, `chars` missing, `chars` a Set, `common` missing,
`lineHeight: NaN`, `base: NaN`, `lineHeight: -1`, `atlas: null`,
`atlas: undefined`, `fontJson: null`, `fontJson: {}`, char with `id: -1`,
`id: 256`, `id: NaN`, `id: 65.5`, `x: 40000` (the F-08 wrap), `xadvance: 8.6`
(the F-08 truncation), kerning with `first: -1`, `second: -1`, `amount: -1.7`,
`amount: 40000`. Each gets a decided policy and a named test. Today three of
these construct a font that is broken forever and three throw a raw `TypeError`
naming an internal property; neither half is a policy.

### Tier T4 -- the numeric oracle (the F-01/F-02 tier)

Sweep `value` across `0`, `0.04`, `0.05`, `0.5`, `1.4`, `33.49`, `9.99`,
`999999.95`, `1e6`, `1e15`, `1e20`, `1e21`, `1e21 + 1`, `1e22`, `1e100`,
`Number.MAX_VALUE`, `-0`, `-1e21`, `NaN`, `+/-Infinity`, plus 10k seeded random
magnitudes. For every accepted value, the recorded glyph sequence must equal
`String(value.toFixed(1))` character for character -- `toFixed` allocates, which
is fine, because the oracle is allowed to allocate and the library is not. For
every rejected value, `total` must be exactly 0.

**This tier has a wall-clock assertion**: the whole tier must complete in under
5 seconds. F-01 is an infinite loop, and the only gate that catches an infinite
loop is a clock.

### Tier T5 -- differential fuzz against a reference renderer

A deliberately naive, allocating reference: split on `\n`, `slice` each line,
build an array of `{code, x, y}` per glyph from the descriptor JSON. Run 50k
seeded random (font, string, scale, align, x, y) tuples through both and compare
the recorded columns element-wise, exactly. Strings drawn from: ASCII 32-126,
codes 0-255 including unmapped ones, embedded `\n` runs, leading/trailing
newlines, `\n\n\n`, lone `\n`, 1-char, 4096-char. Any divergence prints the
seed, the tuple index and a minimal replay. This is the tier that finds the bug
nobody thought to name; F-07's per-line Y drift is one it will find on its own.

### Tier T6 -- the zero-alloc gate (the F-17 tier)

```js
// shape only -- read node_modules/@zakkster/lite-gc-profiler/llms.txt for the
// exact current surface before writing this.
const res = measureOps(hot, { ops: OPS, warmup: WARMUP, stabilize: 'deep' });
const report = checkNoGc(res.summary, {
  maxMajor: 0,
  maxPauseMs: 4,
  maxArrayBuffersGrowth: 0,
});
```

Four hot bodies, four windows, run sequentially:

| Window | Body | Ops |
| --- | --- | --- |
| A | `draw(ctx, S64, x, y, 1, align)` on a 64-char 3-line string | 200,000 |
| B | `drawFast(ctx, v, x, y)` with `v` cycling a 256-entry Float64Array | 200,000 |
| C | `drawWrapped(ctx, S, layout, 8, ...)` over a fixed 8-line layout | 100,000 |
| D | `measure(S64)` alone | 500,000 |

Plus `measureAllocs(fn, { maxBytesPerCall: 0 })` on each of the four -- the
retained-bytes lane, which is the literal form of the README's claim and is
what the seven "zero allocation" sentences actually promise. It requires
`--expose-gc`, which the torture entry already enforces.

Plus the structural equalities no heap gate can make:

```js
assert(font._charScratch.byteLength === 24);
assert(font.glyphs.byteLength === 3584);      // 256 * 7 * 2
assert(font.kerning.byteLength === 131072);   // 65536 * 2
assert(ctx.total === (OPS + WARMUP) * GLYPHS_PER_CALL);
assert(ctx.dropped === 0 && ctx.imgMismatch === 0);
```

The `ctx.total` equality is exact and it is the cheapest regression detector in
the suite: a guard that starts skipping a glyph changes an integer.

### Tier T7 -- soak and retention

`leak_cycles: 4096`. Each cycle: construct a `BitmapFont` from a 200-glyph
descriptor with 500 kerning pairs, draw a 64-char string, `drawFast` a value,
`drawWrapped` an 8-line layout, then `destroy()`. Each font is 134,680 bytes of
typed array, so the soak churns roughly 552 MB -- if any of it is retained, this
tier is where it shows.

After each cycle assert `font.atlas === null`, `font.glyphs === null`,
`font.kerning === null`, `font._charScratch === null`. A second, independent
witness runs alongside: a `createLeakTracker({ name: 'bmfont-soak' })` tracks one
resource per cycle and untracks it at teardown, and **`tracker.size()` must be
exactly 0 after 4096 cycles**. Two witnesses, because a typed-array leak and a
JS-object leak must not be able to hide behind each other. Sample
`process.memoryUsage().heapUsed` at cycle boundaries only, after
`globalThis.gc()`, and assert growth under 512 KB across the whole run.

### Tier T8 -- packaging and DOM-free conformance

- `npm pack --dry-run` output contains `README.md`, `CHANGELOG.md`, `LICENSE`,
  `llms.txt`, `BitmapFont.js`, `BitmapFont.d.ts` -- and **no** `test/`, no
  `demo/`, no `test-bundle.js`.
- The core imports cleanly with no `document`, no `window`, no `HTMLCanvasElement`
  in scope. From M7 forward, the same assertion runs against the core while the
  `/atlas` subpath is present in the package.
- Version sync: `VERSION` exported from `BitmapFont.js` equals
  `package.json.version` equals the top heading of `CHANGELOG.md`. Three places,
  one assertion.
- Docs-drift guard: every method on `BitmapFont.prototype` appears in
  `llms.txt` and in `README.md`'s API section, and every method named in
  `llms.txt` exists on the prototype. Both directions. Cheap, and it makes the
  next drift fail CI instead of aging quietly.

### Tier T9 -- controls (the gate must be able to fail)

Whole-suite control: `BMFONT_TORTURE_BREAK=1 npm run torture` injects a retained
allocation into the T6 hot body and **must exit non-zero**. Reaching the end of
the run with `BREAK` set is itself a failure.

In-process controls, each of which must be detected:

1. An allocating hot loop passes through `runOpsGate` -> must be rejected.
2. A recording ctx built with a rest parameter -> must fail its own gate
   (proving rule 2 of the harness design is load-bearing, not folklore).
3. A hand-corrupted `dx` column containing one NaN -> the NaN scan must find it.
4. A deliberately wrong oracle (advance off by one on a single glyph) -> the
   conservation law must diverge. If a wrong oracle passes, the law is
   decorative.
5. A font whose `_measureRange` is monkey-patched to sum across a newline ->
   the F-06 residual assertion must fire.
6. A `drawFast` variant with the magnitude door removed, driven with `1e22`
   under a 2-second watchdog -> the T4 clock must trip.
7. A layout buffer shorter than `lineCount * 4` -> the T2 bounds assertion must
   fire, and the same-shaped correct buffer must NOT fire, so the check is not
   vacuous.
8. A tracker handle deliberately never untracked -> `tracker.size()` must be
   non-zero, proving the retention witness can see a leak at all.

### Which tier catches which finding

| Finding | Caught by |
| --- | --- |
| F-01 | T4 (wall-clock), T1, T9 control 6 |
| F-02 | T4 (digit oracle), T6 (`_charScratch.byteLength`), T1 |
| F-03 | T0 (conservation law), T5, T1 |
| F-04 | T2 (layout matrix), T0, T1 |
| F-05 | T2, T9 control 7 |
| F-06 | T0 (three-way law residual), T5 |
| F-07 | T5 (differential), T0 |
| F-08 | T3 (descriptor matrix), T0 (oracle vs store residual) |
| F-09 | T3 |
| F-10 | T3 |
| F-11 | T1 (scale/align sweep) |
| F-12 | T0 (oracle carries the policy), T5 |
| F-13 | T2 (flags row) |
| F-14 | T8 (version sync, docs drift) |
| F-15 | `npm test` exits 0 at all -- M0's first assertion |
| F-16 | T8 (`npm pack --dry-run`) |
| F-17 | T6 (`measureOps` + `measureAllocs`), T7 |
| F-18 | T8 (DOM-free core with the subpath present) |

---

## 4. Session order

```
M0 --> M1 --> M2 --> M3 --> M4 --> M4a ----------------+
       |      |                     |                  |
       |      +--> M2a              |                  |
       |      |                     |                  |
       |      +--------------------> M5 --> M6 ------x |   (M6 CUT 2026-08-20)
       |                                             | |
       +--> M8 --> M8b --------------------------------+ |
                                                     | |
M0 --> M7 -------------------------------------------+-+--> M9  (2.0.0)
```

M2b appears in no arrow above on purpose: it carries `depends_on: []` and
`blocks: []`, touches no executable byte, and could have been done at any point
since M0. It has a position in ship order and no position in lineage.

SHIP ORDER is not lineage order. Shipped: M0..M4a, M8 (1.5.0), M2a (1.6.0),
M2b (1.6.1), M8b (1.7.0). M2a depended on M2 but was scheduled ahead of M8b because it
BLOCKED a peer package (`@zakkster/lite-text-layout` TL5); its brief is filed
next to M8b's, in ship order, not next to M2's. M2b (1.6.1, F-46) shipped the
ASCII gate the Law had never had, taken before M8b because it is cheap,
behaviour-free, and because M8b rewrites the very comment block that carried
9 of the 10 offending characters in `BitmapFont.js`. That ordering paid:
**M8b's T20 ("strip the 11 non-ASCII characters") is now DISCHARGED before the
session opens**, and M8b
authors into a file that already enforces the rule instead of being re-edited
after. M8b then SHIPPED (1.7.0, 2026-08-20), re-baselined onto `fd5aa35` --
see `SESSION-M8b.md` section 0.7. It closed the package's only open S2 (F-23)
and closed F-44 as MISDIAGNOSED rather than fixed, which is the more useful of
the two results: a measured cost was real and its stated mechanism was not.

M7 then SHIPPED (1.8.0, 2026-08-20, published). It closed F-18 and FILLED T8,
the tier that had been registered-but-empty since M0 -- so the torture run now
carries **zero TODO lines for the first time in the package's history**, and
`npm test` carries one todo (F-14, M9's). It opened F-48 (S4) in the file it
created, deliberately unfixed; see that row.

Four sessions remained after M8b -- M5, M6, M7, M9 -- and **none was forced by
an open finding**: every S1 and S2 in section 2 is now closed. So the next one
was a CHOICE, not a queue pop. Next: **M7** (1.8.0, F-18), planned 2026-08-20 --
see `SESSION-M7.md`. Chosen over M5 on three grounds, recorded because "we
picked the next one" is not a reason:

1. **It is the only remaining session whose dependencies were satisfied on day
   one** (`depends_on: [M0]`). M5 blocks M6 and starts the chain that ends in
   M9; M7 hangs off nothing.
2. **It closes the last hole in the gate itself.** T8 is REGISTERED BUT EMPTY
   and has been since M0 -- the torture run's one remaining TODO line. A
   registered-empty tier reports as passing while proving nothing, which is the
   fail-closed Law's own failure mode sitting inside the harness that enforces
   it. M7 is the session that owns filling it.
3. **It closes the last watch-todo in `npm test`** (F-18) that any session
   short of M9 can close. Afterwards `npm test` carries one todo (F-14, M9's)
   and the torture run carries zero.

M5 and M6 keep their order behind it; M9 still depends on all of them.
(SUPERSEDED 2026-08-20: M6 was CUT after M5 shipped. M9 depends on M5 only
through the quad format it already consumes, and on nothing M6 would have made.)

**Next after M7: M5** (1.9.0), planned 2026-08-20 -- see `SESSION-M5.md`. This
one was NOT a choice in the sense M7 was: with M7 shipped, M5 is the **only
remaining roadmap session whose dependencies are satisfied** (`depends_on:
[M2, M4a]`, both shipped). M6 is blocked by M5 and M9 by everything, so the
only alternatives were the two unscheduled finding sessions, and both were
declined on record: F-47 (the README spine) stays an authoring session with no
byte-level acceptance test, deliberately not folded into a session that has
one; F-48 (S4, Atlas.js) fails closed and loudly, and folding an unrelated
COLD-path repair into the session that creates a public buffer format would
muddy the one diff that most needs to stay readable.

M5 SHIPPED 2026-08-20 (1.9.0, published, commit c030089). Its
plan-time rebaseline was the largest yet -- thirteen rows -- because its brief
is the oldest unexecuted one in this document and eight releases have landed on
it. Two of its shipped assertions turned out to be UNSATISFIABLE as
written, both proven with numbers rather than argued (SESSION-M5.md R-3 and
R-5), and one of its two signatures reproduces F-45 -- one float, two sources
of truth, two entry points -- in a place F-45 was never looked for (R-4).

WHAT M5 ACTUALLY COST, AND WHERE. The two new methods were correct on their
first submission and never changed behaviourally: every body sha of the nine
shipped methods stayed byte-identical, `draw` included. **All three blocking
findings were defects in the GATE, not in the feature** -- which is the useful
result, because a gate defect is invisible by construction:

1. **T6 windows I and J were blind to transient per-call allocation** (reviewer).
   They ran only the two RETENTION lanes; the file's own comment says those "do
   NOT gate transient allocation", which is why E/F/G/H each carry a third
   `allocVolume` leg. The new windows shipped without it, and their comments
   claimed a mutation reddened them that provably did not. Injecting real
   per-glyph garbage into `layoutGlyphs` left the whole run printing `ok`. This
   is the THIRD time this blindness has been closed one window at a time (M8 for
   `drawFastInt`, M8b for `drawFast` regime B, M5 here) -- a standing argument
   that the volume leg belongs in the window helper, not in each window.
2. **The A8 hostile-input assertion was structurally INERT** (qa). Its comment
   said the door-removal mutation was "caught by the wall clock"; the wall-clock
   line sits AFTER the call, so under the mutation it is never reached. Worse,
   `layoutGlyphs` is SYNCHRONOUS, so the hang blocks the event loop and no
   in-process timeout could ever catch it -- `node:test` has no default timeout
   and a per-test `timeout` option cannot interrupt a blocked loop either. Fixed
   the way this repo already proves F-34: out of process, in T9 control 13, with
   a SIGKILL and a non-vacuity self-test.
3. **`drawQuads` failed OPEN on `first`/`count`** (qa). Drawing past the written
   records blitted real `ctx.drawImage` calls with NaN geometry, undocumented on
   every surface -- while `layoutGlyphs` threw a `RangeError` rather than
   truncate on the write side. One buffer contract, failing closed on write and
   open on read. Fixed with `drawWrapped` fork (1)'s existing idiom (clamp the
   index-likes, throw on the buffer length, zero per glyph) and recorded as
   fork (10). The residual -- a length cannot know how many records were
   WRITTEN -- is pinned in `drawFast`'s "PINNED hazard, not a fix" framing
   rather than papered over.

A fourth defect was found and REFUTED rather than fixed: qa reported that window
J's comment cites a mutation (an inline `ctx.drawImage(...[8 floats])` spread)
that allocates and reddens, contradicting the comment's "V8 scalar-replaces it"
claim. Reproduced exactly as written and it does NOT redden -- the comment is
right, and qa had most likely materialized the array into a variable first,
which defeats scalar replacement. The comment now records the Node version and
that the spread must be written INLINE. Recorded here because a refuted finding
is evidence too, and the next reader will otherwise re-open it.

VERSION TARGETS COLLIDE AND ARE NOT RESERVATIONS EITHER. Whichever session is
PLANNED first takes the number; the other is re-stamped at plan time. Do not
renumber an unscheduled session speculatively -- that is how M8b's 1.6.0 became
wrong. Current state of the three unscheduled sessions:

| session | stamped | reality |
|---|---|---|
| M5 | `1.9.0` | RE-STAMPED 2026-08-20 at plan time. Was `1.5.0`, CONSUMED by M8 on 2026-08-18; M5 was left stale deliberately until it was planned, which is the rule working as written (the same path M7 took). |
| M6 | `unassigned` | was `1.6.0`, CONSUMED by M2a. Cleared 2026-08-19 rather than guessed. **SUPERSEDED 2026-08-20 -- never re-stamped, which is the rule paying off: a session that is cut costs no version number at all.** |
| M7 | `1.8.0` | SHIPPED 2026-08-20. Was `1.7.0`, CONSUMED by M8b; M7 was planned the same day, so it re-stamped instead of aging stale. |

A stamped-but-consumed number is worse than none: it reads as a reservation and
it is not one. M6 now carries `unassigned` for exactly that reason -- and M6 was
then CUT (2026-08-20) without ever taking a number, which is the cleanest
demonstration this rule has produced: had it been speculatively re-stamped to
`1.7.0` on 2026-08-19, that number would have been burned by a session that
never shipped.

DECISION NUMBERS ARE ISSUED AT PLAN TIME, NOT RESERVED. The reservations below
are stale: M6 reserves `0006-range-parameters.md`, M7 `0007-atlas-subpath.md`,
M8 `0008-drawfastint.md` -- but M8 shipped `0005-drawfastint.md`. Issued so far:
0001-0009 shipped (0006 = M2a, **0008 = M2b**, **0007 = M8b, written and
shipped 2026-08-20 in 1.7.0**, **0009 = M7, shipped 2026-08-20 in 1.8.0** --
note M7's brief reserved `0007`, which was already M8b's, so M7 issued the next
free number instead; **M5 does the same and issues `0010`**, its reserved
`0005` having been M8's since 1.5.0. Three consecutive sessions have now been
bitten by this, which is the rule earning its place) -- so 0008 shipped BEFORE 0007 existed, and the
directory now sorts by plan order while the CHANGELOG sorts by ship order. That
gap is recorded, not closed: renumbering 0007 to make filenames sort by ship date would be the
reservation habit this very rule condemns, in tidier clothes. M2b issued 0008
because it is planned AFTER M8b was, so it takes the next free number, not the
next ship-order one; decision numbers follow plan order and ship order is free
to differ. **M5 issued `0010` (`0010-glyph-quads.md`, shipped 1.9.0), so the
next free number is `0011`** -- M9's brief still names `decisions/0009-two-oh.md`
and that reservation is VOID: `0009` shipped as `0009-atlas-subpath.md` (M7).
M6 re-issues nothing: it was cut before plan time and took no number. M9
re-issues when planned.

Why each edge exists:

- **M0 blocks everything.** No session below can state a DONE WHEN until
  `npm test` runs and `npm run torture` exists. Today neither does.
- **M1 before M2** only because M1 is smaller, higher severity and independent.
  A hang beats a wrong pixel.
- **M2 blocks M5.** The glyph quad buffer's `dx`/`dy` **is** the cursor walk.
  Shipping a public buffer contract over a cursor that a NaN can poison bakes
  F-03 into a format, which is the most expensive kind of mistake available
  here.
- ~~**M2 blocks M6**~~ **EDGE DELETED 2026-08-20 -- M6 was CUT.** The reason it
  existed (M6 makes `start`/`end` public, and F-04 is the negative-start failure
  in its exact hand-off shape) is now the reason M6 does not ship: with the
  motivation discharged, the exposure buys nothing. Kept visible rather than
  deleted because it is the clearest ordering argument in this document and it
  is worth reusing.
- **M4a blocks M5.** `layoutGlyphs` is a seventh public face that walks `text`,
  and F-42 is the proof that this package installs a text door one family at a
  time. Shipping the quad buffer over an undoored walk gives the hang a third
  site on the day the buffer becomes a public format contract. M4a is also the
  cheapest session in this document -- two predicates -- and an S1 hang has no
  business waiting behind a feature.
- ~~**M5 blocks M6**~~ **EDGE DELETED 2026-08-20.** M5 shipped `layoutGlyphs`
  and `drawQuads` in 1.9.0 and M6 was cut the same day, so this edge was
  satisfied and then discharged within hours. Ranges on `layoutGlyphs` were
  always contingent; nothing asked for them.
- **M1 blocks M8, and that edge has been satisfied since 1.2.2.** `drawFastInt`
  is the same digit loop and the same scratch buffer; shipping it before the
  magnitude door would have meant writing the door twice, or worse, once. M1
  shipped that door, so **M8 has been runnable ever since** -- its 1.8.0 label
  was queue order and nothing else. Pulled forward to run after M4a
  (2026-08-18); M5/M6/M7 each shift one minor later. Nothing in the graph
  changes, because M8 never depended on them.
- **M8 blocks M8b, and M8b blocks M9.** `decisions/0005` fork (1) re-routed
  F-23 out of M8: `drawFastInt` shares no arithmetic with `drawFast`, so M8
  froze `drawFast` byte-for-byte and left F-23 open. M8b is the session that
  rewrites `drawFast`'s digit extraction; it depends on M8 (the freeze and the
  ADR that routes it) and blocks M9 (which must not ship 2.0.0 with the only
  open S2 still open). This edge is the mitigation the fork rests on -- F-23
  drifted the first time because its routing lived in a decision doc, not a
  brief.
- **M7 depends only on M0.** The atlas subpath touches no hot body and no core
  file. It can be done any time after the gate exists, and it is the best
  session to hand to someone who wants a self-contained win.
- **M3 and M4 are serial** because M4's `measureWidest` needs to know what a
  font with a rejected descriptor even is, and both edit the constructor and the
  doc set.
- **M9 depends on all of it.** A major bump should collect every breaking change
  in one release, not dribble them across four. **As of 2026-08-20 every edge
  into M9 is satisfied**: M4 (1.4.0), M7 (1.8.0), M8 (1.5.0), M8b (1.7.0)
  shipped, and M6 -- its last outstanding blocker -- is superseded. M9 is the
  only session left in this document.

---

## 5. The briefs

===============================================================================
# M0 -- lite-bmfont v1.2.1 -- node:test, the recording ctx, the torture skeleton
===============================================================================

```markdown
---
package: "@zakkster/lite-bmfont"
version_target: 1.2.1
status: done          # shipped 2026-08-17; 66 tests, torture ok, published
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
peers: ["@zakkster/lite-gc-profiler", "@zakkster/lite-leak"]
findings: [F-14, F-15, F-16, F-17]
blocks: [M1, M2, M3, M4, M5, M6, M7, M8, M9]
---

# lite-bmfont -- make the suite runnable and the zero-GC claim falsifiable

PURPOSE
  `npm test` exits 127. Forty test blocks exist and nobody can execute them,
  under a runner the suite Law forbids. Seven sentences in the README promise
  zero allocation and nothing in the repo can check one of them. Every session
  below leans on one command that does not exist yet.

  This session adds no behaviour. It adds the ability to tell whether behaviour
  is correct.

TASKS
  - Port test/BitmapFont.test.js from vitest to node:test. All 40 `it()` blocks
    in all 3 `describe`s survive, with the same assertions.
    `import { test, describe } from 'node:test'`,
    `import assert from 'node:assert/strict'`. Replace `vi.fn()` with the
    harness recording ctx (see below) -- do NOT hand-roll a second mock shape.
    Set `"test": "node --expose-gc --test test/*.test.js"`.
    Remove `vitest` from devDependencies entirely.
  - Add `engines: { node: ">=18" }`. `node --test` does not exist below it and
    the absent field is a lie by omission.
  - Add `CHANGELOG.md`, move the README's inline changelog into it, and leave a
    link behind. Add `LICENSE` -- MIT (c) Zahary Shinikchiev
    <shinikchiev@yahoo.com>. Never "Karadjov".
  - Export `VERSION` from BitmapFont.js (F-14). Three-place version sync from
    this release forward: package.json, VERSION, CHANGELOG heading.
  - `files[]` becomes
    [BitmapFont.js, BitmapFont.d.ts, README.md, CHANGELOG.md, llms.txt, LICENSE].
    `test/` and `demo/` never enter it.
  - Fix the prepublish gate. `"torture": "node --expose-gc test/torture.mjs"`,
    `"verify": "npm test && npm run torture"`,
    `"prepublishOnly": "npm run verify && npm run bundle-check"`. Pin esbuild as
    a devDep or delete bundle-check -- `npx` inside prepublishOnly is a network
    fetch in the release path. Make sure `test-bundle.js` cannot reach a tarball.
  - devDeps `@zakkster/lite-gc-profiler` and `@zakkster/lite-leak`. Read both
    llms.txt files before writing a single profiler call.
  - **Build test/torture/harness.mjs.** The recording ctx per section 3: nine
    named params on `drawImage`, parallel Float64Array columns, `calls`/`total`/
    `dropped` integers, `imgMismatch` counter, reset by index. One shape, built
    once, exported once, used by every tier AND by the node:test file. Plus
    `check()` with a message thunk, seeded xorshift32, `runOpsGate`, and the
    shared test fonts.
  - Build test/torture.mjs with T0, T1, T6, T7, T9 wired now. Register T2, T3,
    T4, T5, T8 as empty tiers that later sessions fill -- an empty registered
    tier is a visible TODO; an unregistered one is a forgotten one.
  - Record the 21 findings in CHANGELOG under "Known issues", each with its
    reproduction, each pointing at the session that fixes it.

HOT PATH
  Zero diff in BitmapFont.js except the added `VERSION` export. Prove it:
  `git diff --stat BitmapFont.js` shows only the export line. This session
  establishes the baseline that every later `assertOps` compares against, so it
  must not move the thing it is measuring.

ASSERTIONS
  - `npm test` exits 0 with 40 passing, 0 failing. `grep -r vitest .` returns
    nothing outside node_modules.
  - `node --expose-gc test/torture.mjs` prints exactly "ok" and exits 0.
  - `BMFONT_TORTURE_BREAK=1 npm run torture` exits non-zero.
  - T6 window A reports `maxMajor: 0`, `maxPauseMs <= 4`,
    `maxArrayBuffersGrowth: 0` over 200,000 `draw` calls with
    `stabilize: 'deep'`; `measureAllocs(draw, { maxBytesPerCall: 0 })` passes.
    If either does NOT pass, that is a finding, not a reason to relax the rule --
    record it and route it to a session.
  - T7: 4096 cycles, `tracker.size() === 0`, heap growth < 512 KB.
  - T9 control 2: a recording ctx written with `drawImage(...args)` fails the
    alloc gate. If it passes, the harness rules are folklore and the gate is
    blind.
  - `npm pack --dry-run` includes README.md, CHANGELOG.md, LICENSE; excludes
    test/, demo/, test-bundle.js.
  - `VERSION === '1.2.1'` and equals package.json and the CHANGELOG heading.

NON-GOALS
  No bug fixes. No API change. No behaviour change of any kind. Every finding
  gets a reproduction in the CHANGELOG's Known Issues and is fixed later. The
  point of this session is that the bugs become reproducible on demand by
  anyone, in one command.

DONE WHEN
  `npm test` green under node:test; `npm run torture` prints "ok";
  `BMFONT_TORTURE_BREAK=1 npm run torture` exits non-zero;
  `npm pack --dry-run` excludes test/
```

===============================================================================
# M1 -- lite-bmfont v1.2.2 -- the drawFast magnitude door (the hang)
===============================================================================

```markdown
---
package: "@zakkster/lite-bmfont"
version_target: 1.2.2
status: done          # 2026-08-17; 82 tests, torture ok; F-01/F-02 closed, F-22/F-23 opened
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
peers: ["@zakkster/lite-gc-profiler"]
findings: [F-01, F-02]
depends_on: [M0]
blocks: [M8]
---

# lite-bmfont -- a HUD counter must not be able to freeze the tab

PURPOSE
  `drawFast(ctx, Number.MAX_VALUE, 0, 0)` never returns. The top guard rejects
  Infinity, and the very next line computes `value * 10`, which overflows to
  Infinity for anything above MAX_VALUE/10. `Math.floor(Infinity / 10)` is
  Infinity, and `while (temp > 0)` never ends. There is no stack to overflow and
  nothing to catch. In a browser the tab is gone.

  Below that ceiling and above 1e22 the same trust in caller magnitude overruns
  the 24-byte scratch: `len` keeps incrementing while the Uint8Array discards
  the writes, the render loop reads `undefined`, and 24 drawImage calls go out
  per frame at NaN coordinates. Correct at 1e21, silently garbage at 1e22.

  This is the one bug in this document that a user can hit by feeding a HUD an
  accumulator that ran away -- which is the package's advertised use case.

THE DECISION (record it before coding)
  What does drawFast do with a magnitude it cannot render?
  A. **SILENT NO-DRAW above a documented ceiling.** Extend the existing door:
     the method already documents "NaN / +Infinity / -Infinity -> returns
     silently". An unrenderable magnitude joins that set. Cost: the door gets
     CHEAPER, see HOT PATH. Consistent with three behaviours already shipped.
  B. **CLAMP to the ceiling and draw it.** A HUD shows the ceiling instead of
     nothing. Cost: same, but it renders a number the caller never had, which
     is a lie in a package whose job is displaying numbers.
  C. **THROW.** Loudest, and correct in a library that is not called 60 times a
     second. In a render loop a throw is a dropped frame and, uncaught, a dead
     rAF chain -- turning a wrong pixel into a stopped game.
  D. **WIDEN the scratch to hold every double.** 310+ bytes. Doubles above 1e21
     have no meaningful decimal tail anyway, so this buys digits that are
     already noise, and it puts a growth path near a hot buffer that the T6
     gate exists to forbid.
  Recommendation: **A**, with the loop bound from D's instinct kept as a
  structural backstop. Ceiling `DRAWFAST_MAX = 1e21` -- exactly the largest
  value whose "d.d" form fits 24 bytes (22 integer digits + '.' + 1 decimal),
  verified: 1e21 renders correctly today, 1e22 does not.

TASKS
  - Write decisions/0001-drawfast-magnitude.md BEFORE coding, with the measured
    boundary table (1e20 / 1e21 / 1e21+1 / 1e22 / MAX_VALUE -> glyphs, NaN?,
    returns?).
  - Replace the three-comparison top guard with the NaN-safe range idiom:
    one compound test that rejects NaN, +Infinity, -Infinity and every
    out-of-range finite magnitude while leaving the documented negative clamp
    intact. -Infinity must still return, NOT clamp to 0 and draw "0.0" -- that
    is a documented behaviour and the new door must preserve it exactly.
  - Export `DRAWFAST_MAX` as a named constant so callers can pre-clamp instead
    of guessing, and so the test can assert the boundary by name.
  - Bound the digit loop unconditionally: `while (temp > 0 && len < buf.length)`.
    The door makes it unreachable; it stays because "unreachable" is a claim
    about today's code, and a silent 24-call NaN storm is what happens when the
    claim expires.
  - Fill torture T4 completely per section 3, including the 5-second wall-clock
    assertion on the tier.
  - Update README, llms.txt and BitmapFont.d.ts with the ceiling. The d.ts gets
    the constant.

HOT PATH
  `drawFast` is a hot body -- 60 HUD values per frame is the advertised
  workload. This fix makes it SMALLER: today's door is three comparisons
  (`value !== value`, `=== Infinity`, `=== -Infinity`); the replacement is a
  two-comparison range test that subsumes all three and adds the ceiling. That
  is a rare shape -- a correctness fix that removes bytes from a hot body --
  and it must be verified rather than assumed. `assertOps` on `drawFast` with a
  256-value cycle must be within noise of the v1.2.1 baseline or better; record
  the number in the decision file either way. The loop bound adds one compare
  per DIGIT (at most 24 per call, typically 3-5) and is measured in the same
  window.

ASSERTIONS
  - `drawFast(ctx, Number.MAX_VALUE, 0, 0)` returns in under 1 ms with
    `ctx.total === 0`. The whole T4 tier completes in under 5 seconds.
  - `drawFast(ctx, 1e21, 0, 0)` -> exactly 24 drawImage calls spelling
    "1000000000000000000000.0", every dx finite. `1e21 + 1` and `1e22` -> 0
    calls.
  - Sweep 10k seeded magnitudes: every accepted value's glyph sequence equals
    `value.toFixed(1)` character for character; every rejected value produces
    `ctx.total === 0`; `nanCount === 0` across the entire tier.
  - `NaN`, `+Infinity`, `-Infinity`, `-1e21`, `-Number.MAX_VALUE` each -> 0
    calls (documented behaviour preserved, asserted individually by name).
  - `-5` still renders "0.0" -- the negative clamp is untouched.
  - `font._charScratch.byteLength === 24` after the whole T6 window. A "fix"
    that grows the scratch fails both this and `maxArrayBuffersGrowth: 0`.
  - `assertOps` on drawFast within noise of v1.2.1 or faster, recorded.
  - `npm run torture` prints "ok"; T9 control 6 (door removed, 1e22 in, 2s
    watchdog) exits non-zero.

NON-GOALS
  No `drawFastInt` (M8). No integer-only path. No thousands separators. No
  configurable decimal places -- that is a feature request with no consumer,
  and this session is a door.

DONE WHEN
  decision recorded with the boundary table; the hang is a named
  failing-before/passing-after test with a wall-clock bound;
  drawFast measured no slower than v1.2.1; `npm run torture` prints "ok"
```

===============================================================================
# M2 -- lite-bmfont v1.2.3 -- the advance conservation law (the NaN cursor)
===============================================================================

```markdown
---
package: "@zakkster/lite-bmfont"
version_target: 1.2.3
status: done          # 2026-08-17; 93 tests, torture ok; F-03/F-04/F-05/F-12/F-21/F-24/F-25 closed, F-26/F-27 opened
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
peers: ["@zakkster/lite-gc-profiler", "@zakkster/lite-text-layout"]
findings: [F-03, F-04, F-05, F-12, F-21, F-24, F-25]
depends_on: [M0]      # M1 precedes it in the order but does not gate it
blocks: [M5, M6]
frozen_baseline: BitmapFont.js@1.2.2 sha256 ead84b59fe58993b3f743703755bc5dccb40fd80078723bd3ea6bfa754a5300c
---

# lite-bmfont -- one predicate, written twice, with opposite NaN behaviour

PURPOSE
  `_measureRange` writes `if (id >= 0 && id < 256)` and rejects NaN.
  `draw` and `drawWrapped` write `if (id < 0 || id >= 256) continue;` and
  ACCEPT it. The same intent, expressed two ways, disagreeing on the one value
  that matters. Downstream, `glyphs[NaN * 7 + 6]` is `undefined` and
  `cursorX += undefined * scale` poisons the cursor for every remaining glyph
  on the line.

  That is what makes F-04 silent. A `startIdx` of -1 in a layout buffer --
  precisely the hand-off shape lite-text-layout produces -- makes
  `charCodeAt(-1)` return NaN, which sails through the inverted guard, and the
  entire line renders at NaN x. Five drawImage calls, no output, no warning.
  A *fractional* start truncates and works fine, so the failure is not even
  uniform across bad indices.

  This is lite-bvh's B-03 in a renderer: one bad value enters once and the
  output is wrong forever after, with no signal.

WHY THESE FOUR TOGETHER
  They are one property in four costumes: nothing in this package can state
  where the cursor is supposed to be, so nothing can notice when it stops being
  there. The fix is the law, and the guards fall out of it.

THE DECISION (record it before coding)
  Two forks, both real.

  (1) The layout-buffer index door (F-04, F-05).
  A. **NORMALIZE, per line.** `startIdx` and `endIdx` are read with the
     NaN-safe idiom and clamped into `[0, text.length]`; `lineCount` is clamped
     to `layoutBuffer.length >> 2`. Cost: four comparisons per LINE, zero per
     glyph. A bad index becomes a short or empty line, never a NaN.
  B. **THROW at the door.** `lineCount * 4 > layoutBuffer.length` throws; a
     negative or NaN index throws. Loudest, catches the layout engine's bug at
     the source. Cost: identical. Risk: this is a per-frame render call, and a
     throw in one is a stopped rAF chain (see M1's option C).
  C. Status quo, documented. Rejected outright: "the caller must not do that"
     is not a policy when the failure mode is invisible.
  Recommendation: **A for the per-line indices, B for the buffer length.** The
  split is not a compromise, it is the severity difference: a short buffer is a
  caller bug that cannot produce correct output under any interpretation, while
  an out-of-range index has an obvious, cheap, correct interpretation (clamp)
  that keeps the frame alive. Record that reasoning; a reviewer will ask.

  (2) The missing-glyph advance (F-12).
  A. **Status quo, documented.** Advance 0, so the next glyph overprints. Free.
  B. **Fill unmapped ids at construction.** The glyph table already has all 256
     slots. A `missingAdvance` constructor option (default 0 -- today's exact
     behaviour) writes an advance into every id the descriptor did not cover.
     Cost: **zero hot-path bytes.** The render loop still reads
     `glyphs[id * 7 + 6]` and does not know anything changed.
  C. **A hot-path branch** on "is this glyph mapped". Rejected: bytes in a hot
     body to serve a cold-path mistake.
  Recommendation: **B.** It is the cleanest illustration of law 7 -- the
  constructor is cold, so a fix that fits there costs nothing. Default 0 keeps
  1.x behaviour byte-identical; a caller who wants visible tofu opts in.
  Ship `hasGlyph(id)` alongside it so a loader can detect coverage gaps at boot
  instead of discovering them as overlapping text.

  (3) Does a missing glyph BREAK THE KERNING CHAIN? (F-24 -- added 2026-08-17,
      measured, not in the original brief.)
  This is independent of (2) and the brief never asks it. The library says yes
  implicitly -- all three walk sites set `prevId = id` for any id in `[0, 256)`,
  mapped or not -- and the harness oracle says no explicitly, in a comment that
  claims to pin the implementation. They disagree by the kerning amount:
  for `'A' + <unmapped id 200> + 'B'`, `_measureRange` is 24 and the oracle
  is 19.
  A. **Missing glyph BREAKS the chain** (library's current behaviour): the
     unmapped id becomes `prev`, so `kern(prev, next)` is looked up against a
     glyph that was never drawn and is 0 in the LUT. Kerning silently vanishes
     across any gap.
  B. **Missing glyph is TRANSPARENT to kerning** (oracle's current claim): skip
     it entirely, so `kern(A, B)` still applies across the gap.
  Note the interaction with (2): under `missingAdvance > 0` the glyph occupies
  real width, and B would then kern two glyphs that are no longer adjacent.
  A and B are defensible; what is not defensible is shipping a three-way law
  whose two independent sides were written to different answers. Decide it,
  then make `harness.mjs`'s comment true or change the oracle -- and add a
  fixture that kerns ACROSS an unmapped id, or the choice stays untested for the
  same reason F-21 is vacuous.

  (4) Is `\n` a renderable glyph? (F-25 -- added 2026-08-17, measured.)
  `draw` says no and resets the kerning chain at the break; `_measureRange`
  says yes, adds `glyphs[10*7+6]`, and carries `prev` through. Against a
  descriptor that maps id 10 with `xadvance: 7`, `measure('A\nA')` is 31 for
  two glyphs' worth of text. M2 must state which walk is correct before T0 can
  assert the newline residual as an exact number, which is a DONE WHEN below.
  Recommendation: **`draw` is correct** -- a newline is a layout instruction,
  not a glyph -- so `_measureRange` grows the same `id === 10` case. That is
  per-GLYPH, so it is the one place in this session where the per-glyph budget
  below is genuinely at risk; measure it rather than asserting it, and consider
  hoisting the newline test into the existing loop's structure rather than
  adding a branch.

TASKS
  - Write decisions/0002-cursor-conservation.md BEFORE coding, containing the
    three-way law from section 2 in full, both decisions above, and the
    measured hot-path numbers.
  - **F-03.** Make every id guard identical and NaN-rejecting. One idiom, three
    sites (`draw`, `drawWrapped`, `_measureRange`). Add a comment at each naming
    F-03, because the inverted form reads perfectly natural and someone will
    "simplify" it back.
  - **F-04.** Normalize `startIdx`/`endIdx` per line per the decision.
  - **F-05.** Bounds-check `layoutBuffer.length` against `lineCount * 4` once
    per CALL, throwing a library error naming both numbers.
  - **F-12.** `missingAdvance` constructor option + `hasGlyph(id)` accessor.
  - **Build the law into T0.** The oracle reads the original BMFont JSON, never
    the Int16 store. The walk is recovered from the recording ctx's `dx` column.
    All three sides must agree exactly -- no epsilon. Where they cannot (F-08's
    truncation), the residual is asserted as an exact expected number and
    labelled with its finding ID, not tolerated.
  - **F-21.** The corpus revision this session already performs is the fix.
    `FONT_KERN` kerns 3 of 8836 possible seams, and under both shipped seeds
    ZERO eligible seams carry non-zero kerning -- so T0's additivity law
    degenerates to `left + right === full` and deleting the kern term from
    `_measureRange` passes the whole torture gate. Plant A/B seams in the
    seeded corpus or densify `FONT_KERN`, then prove it: delete the kern term
    and the tier must go red. Do that BEFORE building the law on top of it, or
    the law inherits the vacuity.
  - **F-24.** Decide fork (3), then make `harness.mjs:314`'s comment and
    `oracleAdvance` agree with the implementation -- or change the
    implementation. Add a fixture kerning across an unmapped id.
  - **F-25.** Decide fork (4) and make the two walks agree on `\n`. Add a
    fixture mapping id 10.
  - Fill torture T2 completely per section 3. Every row named, every row with a
    decided policy. `lineCount` fractional/negative/NaN are measured above and
    are no longer "undecided" rows -- they are pending policies.
  - Update README, llms.txt, d.ts: the layout buffer contract now says what
    happens on a bad index and a short buffer, in the same words the code
    enforces.

HOT PATH
  Three of the four hot bodies are edited. The budget is explicit:
  - Per GLYPH: **zero new instructions.** The id guard changes shape, not count
    -- two comparisons before, two after. Diff it. `missingAdvance` adds nothing
    at all; it is a constructor-time table fill.
  - Per LINE: at most four comparisons for index normalization.
  - Per CALL: one comparison for the layout-buffer length.
  A 40-glyph line therefore pays 4 comparisons where it previously paid 0, over
  80 glyph iterations -- unmeasurable, but measure it anyway. `assertOps` on all
  four bodies against the v1.2.2 baseline, numbers in the decision file.

ASSERTIONS
  - The three-way conservation law holds for 50k seeded (font, string, range,
    scale) tuples: `walk === _measureRange === oracle`, exactly.
  - `drawWrapped(ctx, 'HELLO', Float32Array.of(-1, 5, 40, 0), 1, ...)` produces
    the same 5 dx values as the same buffer with start 0 -- `0, 12, 24, 36, 48`
    under the harness fixture. (The brief originally said `0, 8, 16, 24, 32`;
    `JSON_ASCII` advances 12, not 8. Measured 2026-08-17. Today the bad buffer
    produces five NaNs and the good one produces `0, 12, 24, 36, 48`.) Prove
    both directions.
  - `drawWrapped(ctx, 'HELLO', new Float32Array(4), 3, ...)` throws a library
    error naming 4 and 12. The same call with `lineCount: 1` does not throw --
    the check is not vacuous. Today the short-buffer call does NOT throw: it
    draws line 0's five glyphs and silently vanishes lines 1 and 2.
  - `lineCount` degenerates are MEASURED, not undecided (2026-08-17):
    `-1` -> 0 calls, `NaN` -> 0 calls, `0.5` -> 5 calls, `1.5` -> 5 calls. A
    fractional `lineCount` renders a whole extra line today. Each of the four
    gets a decided policy and a named test; `0.5` drawing a full line is the
    row most likely to be wrong under any reading.
  - `nanCount === 0` across every tier, on every input in T1 and T2. There is no
    input for which a NaN destination coordinate is correct.
  - A char code that fails the range guard is skipped identically by `draw`,
    `drawWrapped` and `_measureRange` -- asserted by walking the same string
    through all three and comparing.
  - `new BitmapFont(atlas, json, { missingAdvance: 6 })`:
    `draw(ctx, 'A\u00C8A', 0, 0)` -> **2 calls, dx `0, 18`** under the
    harness fixture. Note the call COUNT does not change with `missingAdvance`:
    the unmapped glyph has width 0 and height 0, so `gw > 0 && gh > 0` is false
    and it is never passed to `drawImage` -- it only advances the cursor. The
    brief's `0, 8, 14` (and its mechanical rescaling to `0, 12, 18`) listed
    three dx entries for two drawn glyphs and was wrong on both counts.
    With the default: 2 calls, dx `0, 12` -- the second A overprints the first
    at 12. Both measured 2026-08-17 and pinned.
  - The F-24 fork is asserted BOTH ways: a fixture that kerns across an
    unmapped id, with `_measureRange`, the walk and the oracle all agreeing on
    the decided answer. Deleting the chosen policy from either side must turn
    the tier red -- otherwise the decision is decorative (AR-02).
  - The F-25 fork is asserted against a descriptor that MAPS id 10 with a
    non-zero `xadvance`. Under `JSON_ASCII` the newline is unmapped and the
    assertion is vacuous in exactly the way F-21 is.
  - `hasGlyph(65) === true`, `hasGlyph(200) === false`, `hasGlyph(NaN) === false`,
    `hasGlyph(-1) === false`, `hasGlyph(256) === false`.
  - `assertOps` on draw / drawWrapped / _measureRange within noise of v1.2.2.
  - `npm run torture` prints "ok"; T9 controls 3, 4, 5 and 7 each exit non-zero.

NON-GOALS
  No public `start`/`end` parameters (M6 -- and M6 is blocked on exactly this).
  No measure() semantic change (M4). No descriptor validation (M3). No glyph
  quads (M5).

DONE WHEN
  the conservation law is executable and green over the fuzz corpus;
  every one of F-03/F-04/F-05/F-12/F-21/F-24/F-25 has a named
  failing-before/passing-after test; the corpus is proven non-vacuous by
  deleting the kern term and watching T0 go red; forks (3) and (4) are recorded
  in decisions/0002 with the measured numbers; the per-glyph body is
  diff-identical in instruction count except the decided `\n` case, whose cost
  is measured and recorded; `npm run torture` prints "ok"
```

===============================================================================
# M3 -- lite-bmfont v1.3.0 -- the descriptor door
===============================================================================

```markdown
---
package: "@zakkster/lite-bmfont"
version_target: 1.3.0
status: done          # shipped 2026-08-18 (9ce50b7, published); 103 tests, torture ok; F-08(detection)/F-09/F-10/F-11/F-13/F-28/F-29/F-30/F-33 closed, F-31/F-32 opened
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
peers: ["@zakkster/lite-gc-profiler"]
findings: [F-08, F-09, F-10, F-11, F-13, F-28, F-29, F-30]
depends_on: [M2]
blocks: [M4]
frozen_baseline: v1.2.3 (f1d4796, published 2026-08-17)
---

PRECONDITION PROBE -- measured against the shipped 1.2.3, 2026-08-17.
Everything below this line that contradicts the prose above it WINS. The prose
was written against 1.2.1 and three of its prescriptions do not survive
measurement. Do not plan against an unmeasured number in this brief.

  (a) THE F-10 FIX AS WRITTEN DOES NOT CLOSE F-10. "array-like with a numeric
      `length`" admits `chars: 'AB'` -- a string has a numeric length, the loop
      runs twice, `'A'.id` is `undefined`, `undefined >= 0` is false, and you
      get the zero-glyph font F-10 exists to prevent, now with a validator in
      front of it. `chars: {length: -1}` passes too (0 glyphs). And
      `chars: {length: 3}` with no elements still throws the raw
      `TypeError: Cannot read properties of undefined (reading 'id')` from
      inside the loop -- the precise failure mode the task says must stop.
      The test is not "has a numeric length", it is "every index in [0,length)
      yields an object". Decide whether that is validated up front (a cold
      pre-pass) or per element as the loop runs, and record which.

  (b) THE F-09 FIX AS WRITTEN CLOSES ONLY THE NEGATIVE HOLE. Measured, every
      one of these passes `first >= 0 && first < 256 && second >= 0 &&
      second < 256` and writes:
        first 65.5  -> writes 16706  (the INTEGER A-B slot; a fractional first
                                      silently kerns a pair it does not name)
        first '65'  -> writes 16706
        first 255.9 -> writes 65346
        first true  -> writes 322    (kerns id 1 against id 66)
      The bound is not the whole contract. Integrality and type are, and they
      are the same requirement F-29 raises for `char.id`. Fix both keys with
      one predicate or they will drift apart.

  (c) A NaN-SAFE RANGE TEST ON `scale` DOES NOT COVER `scale`. Measured on
      `draw(ctx,'AAAA',0,0,scale,0)`:
        scale NaN       -> 4 calls, dx0 NaN,  dw0 NaN
        scale -1        -> 4 calls, dx0 0,    dw0 -10      <- finite, not NaN
        scale 0         -> 4 calls, dx0 0,    dw0 0        <- finite, not NaN
        scale Infinity  -> 4 calls, dx0 NaN,  dw0 Infinity
      Only two of the four produce NaN. The door is `scale > 0 &&
      scale < Infinity`, not a NaN test.

  (d) `scale` HAS A THIRD HOT BODY: `drawFast`. Measured `drawFast(rec, 1234,
      0, 0, NaN, 0)` -> 6 calls at dx NaN. The brief says "each draw method"
      and the HOT PATH section reasons about draw/drawWrapped only. M2
      committed to zero new instructions in all four hot bodies and shipped
      that. Adding a `scale` door to `drawFast` breaks that commitment
      deliberately or not at all -- decide it in the record with the assertOps
      number, do not let it arrive as a side effect of "each draw method".

  (e) THE F-13 CALL COUNTS IN THE F-13 LEDGER ROW (8 / 5 / 5) ARE FROM A
      RETIRED PROBE FIXTURE and reproduce nothing in the current suite. Against
      a 64-char 'B' run in a 40px box the same six flag values measure
      20 / 23 / 20 / 20 / 20 / 20 for 0 / 1 / 1.0000001 / 2 / -1 / NaN. The
      DIRECTION is confirmed and is the finding: exact `1` fires, `1.0000001`
      (stored 1.0000001192092896) does not. Re-derive every count against the
      fixture the assertion will actually use. This is the M2 failure repeated
      -- that brief asserted an advance of 8 against a fixture whose advance
      is 12, and every dx column downstream of it was wrong.

  (f) `common.base` IS UNGUARDED TOO AND IS NOT IN THE ASSERTION LIST.
      `{ common: { lineHeight: 20, base: NaN } }` constructs; `lineHeight` is
      the only one the ASSERTIONS name. `base` feeds every dy.

  (g) `vAlign` HAS NO ASSERTION ROW even though TASKS names it. Measured,
      `vAlign` of 3, -1 and NaN all fall through to top (dy0 2), identically to
      `align`. Whatever policy `align` gets, `vAlign` gets, with its own cases.

  (h) `kernings: 7` CONSTRUCTS -- `7.length` is `undefined`, the loop never
      runs, every kern pair in the descriptor is silently dropped. Same shape
      as `chars: 7`, and the brief never mentions it. Validate `kernings` on
      the same predicate as `chars` when it is present.

  (i) CONFIRMED UNCHANGED from the 1.2.1 prose, re-measured on 1.2.3:
      `atlas` null and undefined construct (and `draw` issues real drawImage
      calls with a null image -- 2 calls, imgMismatch 2); `chars: 7` and
      `chars: []` construct with 0 glyphs; `{common:{lineHeight:NaN}}`
      constructs; `fontJson` null, `fontJson {}`, `common: null` and missing
      `chars` each throw a raw `TypeError` -- FOUR distinct messages, not
      three, each naming an internal property; `x: 40000` -> `-25536`;
      `xadvance: 8.6` -> stored 8, `measure('AA') === 16` against an exact
      17.2, residual exactly 1.2; `xadvance: -8.6` -> stored -8 (the Int16
      store truncates toward ZERO, not floor -- the checked-mode message must
      not say "floor"); kerning `first: -1` / `second: -1` write nowhere;
      `amount: -1.7` -> -1; `amount: 40000` -> -25536; `align` 3, -1, 1.5 and
      NaN all render left.

# lite-bmfont -- a font that cannot render should not construct

PURPOSE
  `new BitmapFont(atlas, { chars: 7 })` succeeds. `7.length` is `undefined`, the
  loop never runs, and you get a font with zero glyphs whose every `measure()`
  returns 0 for the rest of the process. `{ common: { lineHeight: NaN } }`
  succeeds and puts every line at NaN Y. `atlas = null` succeeds and `draw()`
  calls `drawImage(null, ...)` sixty times a second.

  Meanwhile `null`, `{}` and a missing `chars` each throw a raw `TypeError`
  naming an internal property the caller has never heard of.

  Three malformed inputs accepted, three rejected with a stack trace pointing
  at the wrong place. That is not a policy in either direction, and the
  constructor is COLD -- there is no performance argument on either side of
  this. The only real question is compatibility.

THE DECISION (record it before coding)
  A. **VALIDATE EVERYTHING, ALWAYS.** Every malformed descriptor throws a
     library error naming the offending field and what was passed. Honest, and
     it is what "fail closed on every unverified state" says. But it rejects
     real-world exporter output: fractional `xadvance` (F-08) is emitted by
     actual BMFont tools, and hard-failing on it turns a 0.6px drift into a
     crash at load.
  B. **CHECKED MODE.** `new BitmapFont(atlas, json, { checked: true })`. Off by
     default in 1.x, on in tests and in the torture suite, default ON in 2.0.0.
     Nothing changes for anyone until they ask. But a default-off validator is
     a validator most callers never run, which is how the descriptor stayed
     unvalidated for three minor versions in the first place.
  C. **SPLIT BY WHETHER THE INPUT CAN POSSIBLY WORK.** Always throw for inputs
     that cannot produce correct output under any interpretation: `atlas`
     null/undefined, `fontJson` null, `common` missing, `chars` not array-like,
     `lineHeight`/`base` non-finite. Route everything that is merely LOSSY --
     an `xadvance` of 8.6 truncating to 8, an atlas x of 40000 wrapping, a
     kerning amount of -1.7 truncating -- through `{ checked: true }`, where it
     throws with the exact drift named.
  Recommendation: **C.** The dividing line is not severity, it is
  interpretability: there is no reading of `atlas: null` that renders anything,
  and there is a perfectly good reading of `xadvance: 8.6` that renders text
  0.6px per glyph too narrow. The first is a bug; the second is a tradeoff the
  caller is entitled to make -- once they are told it exists. C also gives
  M9 a clean promotion path: in 2.0.0 the lossy lane becomes default-on and the
  option flips to `{ checked: false }`.

  Note explicitly in the record: **throwing from the constructor is a behaviour
  change**, and it is why this is 1.3.0 and not 1.2.4. Three descriptors that
  construct today will stop constructing. All three produce a font that renders
  nothing or renders at NaN, so no working call site changes -- but "no working
  call site" is a claim, and the CHANGELOG must state it as one under a
  "Changed (behaviour)" heading rather than burying it under Fixed.

TASKS
  - Write decisions/0003-descriptor-door.md BEFORE coding, with the full
    accept/reject matrix and the always/checked split for each row.
  - **F-10.** Validate `imageAtlas` (non-null object), `fontJson`, `common`,
    `common.lineHeight` and `common.base` (finite numbers), and `chars`
    (array-like with a numeric `length`). Library errors naming the field and
    the received value -- never a raw TypeError naming an internal property.
    Decide and record whether `chars: []` is legal (recommendation: yes, a font
    with no glyphs is degenerate but coherent, and `hasGlyph` from M2 reports
    it).
  - **F-08.** In checked mode, reject any glyph field outside
    `[-32768, 32767]` and any non-integer field, with the exact value and the
    exact stored result in the message ("xadvance 8.6 stores as 8: 0.6px per
    glyph, 24px over a 40-glyph line"). Unchecked, behaviour is byte-identical
    to today and the truncation is documented in README with that number.
  - **F-09.** Fix the kerning key bound to check BOTH ends:
    `first >= 0 && first < 256 && second >= 0 && second < 256`, in the NaN-safe
    idiom. Today a `first` of -1 computes index -191 and the write is silently
    swallowed by the typed array. In checked mode, an out-of-range pair throws;
    unchecked, it is skipped -- which is what the caller already thinks happens.
    Truncation of `amount` follows the F-08 lane.
  - **F-11.** Validate `align`, `vAlign` and `scale`. `align`/`vAlign` outside
    {0,1,2} and any non-finite or non-positive `scale` currently produce NaN
    coordinates or negative destination widths. This one IS on a hot path --
    see HOT PATH.
  - **F-13.** Decide the `flags` contract. It arrives through a `Float32Array`,
    so `flags === 1` misses `1.0000001`, and every unknown value is silently
    ignored. Options: exact bitfield with `(flags | 0)` and a validated mask
    (recommended -- a layout engine emitting bit 1 for ellipsis and bit 2 for
    something later needs the mask to exist before it needs bit 2), or keep the
    strict compare and reject anything that is not exactly 0 or 1. Either way
    an unknown flag must stop being silent.
  - Fill torture T3 completely per section 3. Extend T2's flags row.
  - Update d.ts (the options bag, the new errors), llms.txt, README.

HOT PATH
  The constructor is cold: validate freely, cost is irrelevant, and the decision
  record should say so plainly so nobody re-litigates it.

  `align`/`vAlign`/`scale` are the exception -- they are arguments to hot
  bodies. Validating them per CALL is one comparison each on a call that draws
  tens of glyphs; validating them per GLYPH is forbidden. The cheapest correct
  form is a single NaN-safe range test on `scale` at the top of each draw method
  (which also subsumes the `scale: NaN` case that currently reaches drawImage),
  and normalizing `align` with a range test that falls through to 0 -- which is
  what the code already effectively does, except silently. Decide whether an
  out-of-range `align` throws or documents-as-left; recommendation: document as
  left-aligned, because it already is and changing it helps nobody, but make
  `scale` fail closed since a NaN scale draws nothing useful at any align.
  `assertOps` on all four hot bodies against the v1.2.3 baseline; record.

ASSERTIONS
  - `{ chars: 7 }`, `{ common: { lineHeight: NaN } }`, `atlas: null`,
    `atlas: undefined`, `fontJson: null`, `fontJson: {}`, `chars` missing --
    each throws a library error whose message names the offending field. Seven
    named tests. Today three of these succeed.
  - Every error thrown by the constructor is an instance of the package's error
    type, and no raw TypeError escapes. Assert `err.constructor.name` and that
    the message contains the field name.
  - `{ x: 40000 }` unchecked stores `-25536` (pinned, documented);
    checked, throws naming 40000 and -25536.
  - `xadvance: 8.6` unchecked -> `measure('AA') === 16`, exact oracle 17.2,
    residual 1.2 asserted by number; checked, throws naming the per-glyph and
    per-40-glyph drift.
  - `kernings: [{ first: -1, second: 65, amount: -2 }]` unchecked -> no write,
    `kerning[(255 << 8) | 65] === 0` and every neighbouring slot 0 (proving the
    negative index wrote nowhere); checked, throws.
  - `scale: NaN`, `scale: -1`, `scale: 0`, `scale: Infinity` each -> 0
    drawImage calls, on all three draw methods. Twelve named cases.
  - `align: 3`, `align: -1`, `align: 1.5`, `align: NaN` behave per the recorded
    policy, each with a named test.
  - `flags` in {0, 1, 1.0000001, 2, -1, NaN} behaves per the recorded policy;
    `1.0000001` must no longer silently mean "no ellipsis".
  - `assertOps` on all four hot bodies within noise of v1.2.3.
  - `npm run torture` prints "ok" with T3 complete.

NON-GOALS
  No fix for the Int16 truncation itself -- detection only; the storage decision
  is M9. No measure() semantics (M4). No new rendering API.

DONE WHEN
  every row of the T3 matrix has a decided policy and a named test;
  no raw TypeError escapes the constructor; the always/checked split is
  recorded with a stated reason; hot bodies measured unchanged
```

===============================================================================
# M4 -- lite-bmfont v1.4.0 -- metrics coherence and the pixel-snap promise
===============================================================================

```markdown
---
package: "@zakkster/lite-bmfont"
version_target: 1.4.0
status: done          # 2026-08-18; 119 tests, torture ok; F-07/F-34/F-35/F-36/F-38/F-39/F-41 closed, F-06 half-closed (measureWidest ships; measure semantics stay M9's), F-37/F-40 opened
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
peers: ["@zakkster/lite-gc-profiler"]
findings: [F-06, F-07, F-34, F-35, F-36]
frozen_baseline: v1.3.0 (9ce50b7, published 2026-08-18), BitmapFont.js sha256 11ca9228102dc595532f001fc472e323681feff7c700919c3b343af075d4f9bf
depends_on: [M3]
blocks: [M9]
---

# lite-bmfont -- the two functions disagree about what a width is

PURPOSE
  `measure('AA\nAA')` returns 32. The widest line is 16. `draw()` aligns each
  line independently, so centring a multi-line string with the obvious call --
  `draw(ctx, s, cx, y, 1, 1)` after checking `measure(s)` -- is wrong by the
  width of every line that is not the longest. Two functions in a four-function
  package, disagreeing about the package's central noun.

  And the second half of the pixel-snap promise is not kept. `draw()` documents
  "Pixel-snapped baseline for crisp pixel fonts" and rounds ONCE:
  `cursorY = Math.round(y)`, then accumulates `cursorY += lineHeight * scale`
  raw. At scale 1.1 with lineHeight 20 the lines land at -13.200000000000001,
  4.4, 22 -- which is exactly the blur the promise exists to prevent, on every
  line after the first. `drawWrapped` has the identical shape.

  M4 widens the measure surface. The M3 lesson is that widening a surface
  publishes whatever that surface already does wrong, so the probe below runs
  first and three of this brief's original prescriptions do not survive it.

PRECONDITION PROBE
  Measured 2026-08-18 against the published 1.3.0 (`9ce50b7`, sha256
  `11ca9228`), scratch `m4-probe.mjs` / `m4-hang.mjs`. Authoritative where it
  contradicts anything else in this brief.

  (a) THE BRIEF'S FOUR LITERAL NUMBERS NEED A FIXTURE THAT DOES NOT EXIST.
      32 / 16 and 56 / 48 hold for an advance-8 font. Every harness font
      advances 12 with lineHeight 20, where the same strings give
      `measure('AA\nAA') = 48` (widest 24) and `measure('A\nAAAAAA') = 84`
      (widest 72). The F-07 table additionally needs lineHeight 17. M4 adds ONE
      fixture -- `JSON_SNAP` / `FONT_SNAP`, lineHeight 17, base 16, advance 8,
      ASCII 32..126, no kernings -- and asserts the literal numbers against it.
      A coder who asserts 32 against `FONT_ASCII` is measuring nothing.

  (b) F-07 REPRODUCES EXACTLY, on that fixture, at scale 1.1:
        today   0, 18.7, 37.4, 56.1, 74.8      (7 of 8 lines off-grid)
        B form  0, 19, 37, 56, 75
        A form  0, 19, 38, 57, 76
      At scale 1 nothing is off-grid; at 1/3 the drift reaches 0.333 px.

  (c) THE PINNED FIVE-LINE TABLE DOES NOT DISCRIMINATE (AR-02). Decision (2)'s
      B has a sub-fork the brief never names, and at `y = 0` both halves produce
      the pinned row, so the headline assertion passes for BOTH:
        B1 rounded anchor  `Math.round(y) + Math.round(i * lineHeight * scale)`
        B2 raw anchor      `Math.round(y + i * lineHeight * scale)`
      They diverge at a fractional `y`. At `y = 0.6`, lineHeight 17, scale 1.1:
        today  1, 19.7      B1  1, 20      B2  1, 19
      Both agree with today on line 0 (`Math.round(y)`), so single-line output
      is unchanged under either and that is NOT the discriminator. Every
      assertion in this session that claims to pin the rounding form must carry
      a fractional `y`.

  (d) `drawWrapped` ROUNDS TWICE TODAY and the brief's own cross-method
      assertion is not free. `:677` is `Math.round(y + base * scale)`, then
      `:682`/`:683` add `Math.round((boxHeight - totalHeight) / 2)` (or the
      bottom form) for vAlign 1/2. Collapsing to one round per line from a raw
      accumulator changes line 0 whenever both fractions round up
      (`round(0.5) + round(0.5)` is 2, `round(1.0)` is 1). So "drawWrapped
      produces the identical baseline sequence as draw" forces a choice:
      either a declared line-0 delta in `drawWrapped` at vAlign 1/2, or B1 in
      both methods. Settle it in the decision file, not in review.

  (e) THE TWO METHODS' ANCHORS DIFFER BY A ROUNDED TERM. At `y = 0`, scale 1.1,
      base 16, `drawWrapped` gives 18, 36.7, 55.4, 74.1, 92.8: the offset from
      `draw`'s sequence is `Math.round(base * scale)` = 18, not `base * scale`
      = 17.6. State that relation in the assertion or it compares nothing.

  (f) X IS NOT SNAPPED INSIDE A LINE AND MUST NOT BE. At scale 1.1 the glyph
      x column is `0, 8.8, 17.6, 26.400000000000002` in both `draw` and
      `drawFast`; only the line ORIGIN is rounded (`:451`, `:467`, `:576`,
      `:717`). Rounding each glyph would break T0 law 1, which asserts
      `walk === mr === oracle` EXACTLY with no epsilon anywhere in the tier.
      The promise is therefore per-line-origin in X and per-baseline in Y, and
      the docs must say so rather than leaving a reader to infer the stronger
      claim from "pixel-snapped".

  (g) THREE NEW LEDGER ROWS, ALL BLOCKING THIS SESSION -- F-34 (the
      `_measureRange` non-termination, publicly reachable through `measure`
      today), F-35 (the index-semantics disagreement with `drawWrapped`, which
      diverges on a negative fractional start), F-36 (`measure` has neither a
      scale door nor a text door). The brief's "`measureLine` is a thin forward
      to `_measureRange`" is therefore REJECTED as written: it publishes a hang
      and an alignment disagreement as supported API.

  (h) THE README FOOTGUN THE BRIEF DESCRIBES IS NOT THERE. The quick-start
      (`README.md:40-60`) shows a SINGLE-line centred `draw` and a separate
      `measure('Hello', 1.5)`; no multi-line `draw` appears in it. The real gap
      is that no document anywhere states that `measure` sums through newlines.
      Fix that, and do not go hunting for an example that does not exist.

  (i) T5 IS AN EMPTY REGISTERED STUB (`test/torture/t5-fuzz.mjs`,
      `TODO = 'M4'`). It is the one tier M4 builds from nothing. T9 control 9
      already runs a child process and asserts it RETURNS
      (`t9-hang-child.mjs`); that is the ready-made mechanism for F-34's
      control, and no new machinery is needed.

  (j) AFTER `destroy()`, `measure`, `_measureRange` and `hasGlyph` all throw a
      raw `TypeError` -- not a `BitmapFontError`. Whatever the new methods do,
      they match the family; changing the family's post-destroy error type is
      not this session's job.

THE DECISION (record it before coding)
  (1) measure() semantics (F-06).
  A. **LEAVE `measure` ALONE, ADD THE MISSING TWO.** `measureLine(text, start,
     end, scale)` and `measureWidest(text, scale)`. Document the cross-newline
     sum as what it is -- a total advance, useful for nothing the package does
     -- and point callers at `measureWidest` for layout. Additive, 1.4.0, zero
     risk.
  B. **CHANGE `measure` to return the widest line.** Correct, obvious, and
     breaking: every existing caller that measures a single-line string is
     unaffected, and every caller that measures a multi-line string silently
     gets a different number. Silent numeric changes are the worst kind of
     breaking change because nothing throws.
  C. **`measure` throws on an embedded newline.** Forces the caller to choose.
     Loud, and hostile to the many callers measuring strings that happen to be
     single-line.
  Recommendation: **A now, B in M9.** A is additive and unblocks the real use
  case today; B is the right long-run answer and gets a major bump, a migration
  note and a CHANGELOG "Breaking" section rather than being smuggled into a
  minor. Record the promotion explicitly so M9 does not have to re-derive it.

  (2) Where to round (F-07).
  A. **ACCUMULATE ROUNDED.** `cursorY = Math.round(cursorY + lineHeight * scale)`
     each line. One round per line, and every line is on-grid. But the rounding
     error compounds: line spacing wobbles between floor and ceil, and after N
     lines the block can sit a full pixel away from where the metrics say.
  B. **ROUND AT THE USE SITE FROM AN EXACT ACCUMULATOR.** Keep a line index and
     round once per line. Same one round per line, no drift, and the block's
     total height is exactly right. Sub-fork, from probe (c) -- B1 measures
     from the SNAPPED first baseline (`Math.round(y) + Math.round(i * step)`),
     B2 from the caller's RAW `y` (`Math.round(y + i * step)`).
  Recommendation: **B**, and per probe (c) the session must also ratify B1 vs
  B2 and pin it at a fractional `y`, because the five-line table at `y = 0`
  cannot tell them apart. Lean **B1**: it keeps `drawWrapped`'s existing
  two-round anchor legal (probe (d)) so the cross-method assertion costs no
  behaviour delta, and it makes the block's geometry a function of what was
  actually drawn rather than of a `y` the renderer already discarded. With
  `lineHeight: 17` and `scale: 1.1` (step 18.7), five lines from `y = 0`:
     B (no drift):      0, 19, 37, 56, 75
     A (accumulating):  0, 19, 38, 57, 76   <- diverges from line 2 on
     today (no round):  0, 18.7, 37.4, 56.1, 74.8
  and from `y = 0.6`, which is the row that actually decides the sub-fork:
     B1:  1, 20        B2:  1, 19        today: 1, 19.7
  A reviewer can tell which implementation shipped by reading two arrays.

  (3) The range door on `measureLine` (F-34, F-35). NEW -- this fork did not
  exist before the probe.
  A. **CLAMP EXACTLY AS `drawWrapped` DOES.** Truncate both indices, clamp
     `start` to `[0, len]` and `end` to `[0, len]`, return 0 when `end <=
     start`. Terminates by construction, and it is the only option under which
     `measureLine` agrees with what `drawWrapped` will render for the same
     range -- including `[-0.5, 2)`, where they differ by a glyph today.
  B. **THROW on any non-integer or out-of-range index.** Loud, but hostile to
     the one caller this method exists for: a `layoutBuffer` is a
     `Float32Array`, its indices are already Float32-rounded, and 2.9999999 is
     a normal value there, not an error.
  C. **FORWARD RAW** (the brief as written). Publishes F-34 and F-35. Rejected
     on measurement, not on taste.
  Sub-fork -- WHERE the clamp lives:
     A1 at the head of `_measureRange`: one site, kills every path including
        `measure`'s, and costs `draw`'s per-line align calls two comparisons
        and two truncations each.
     A2 at the PUBLIC faces only (`measure`, `measureLine`, `measureWidest`),
        leaving `_measureRange` an explicitly-unsafe internal carrying a
        comment that names F-34 and states the precondition its callers keep.
  Recommendation: **A2**. Fail closed at the boundary, keep the shared hot body
  free, and prove the boundary holds with the T9 child-process control rather
  than trusting the comment. If the coder finds A1 measures free in T6 window
  C, A1 is also acceptable -- but the number decides it, not the argument.

  (4) The measure family's fail signal (F-36). NEW.
  A. **FULL F-11 PARITY, SILENT.** Reject a bad `scale`/`text` and return 0.
     Rejected: a 0 width is a value a layout will happily act on, and "null is
     not zero" is the Law that exists for this exact case.
  B. **NEW METHODS THROW, `measure` UNCHANGED.** Preserves 1.3.0 byte for byte
     and gives the new surface a defensible policy -- at the cost of two
     policies for one question, which is F-06's disease in a fresh surface.
  C. **NaN IS THE MEASURE FAMILY'S FAIL SIGNAL, ACROSS ALL FOUR.** A width has
     to have a value, and NaN is the only value that cannot be mistaken for a
     real one: it propagates through every downstream comparison and fails
     closed. This is a WIDENING of what `measure` already does for a NaN scale,
     not a new policy -- and it turns three current fail-open answers into
     honest ones: `measure(123)` 0 -> NaN, `measure(null)` raw TypeError ->
     NaN, `measure('AA', -1)` -16 -> NaN.
  Recommendation: **C**, with the three changes above written into CHANGELOG
  "Changed (behaviour)" as declared deltas and driven through the qa
  differential -- never as a footnote. The renderers keep drawing nothing for
  the same input (that is F-11 and it is shipped); state plainly in the docs
  that the two halves of the package signal a bad `scale` differently and why:
  a renderer can decline to act, a query cannot decline to answer.

TASKS
  - Write `decisions/0004-metrics-and-snapping.md` BEFORE coding: both Y tables
    from probes (b)/(c), the B1/B2 ratification, the `drawWrapped` double-round
    resolution from probe (d), forks (3) and (4), the M9 promotion of
    `measure()`, and the measured reason X is not snapped (probe (f)).
  - `FONT_SNAP` fixture in `harness.mjs` (probe (a)) -- lineHeight 17, base 16,
    advance 8. Every literal number in this session is asserted against it.
  - `measureWidest(text, scale)` -- one pass, tracks the max per-line width,
    zero allocation, no split, no slice.
  - `measureLine(text, start, end, scale)` -- the public face of
    `_measureRange`, WITH the fork (3) door. Not a thin forward. Note that this
    partly anticipates M6; keep the signatures compatible so M6 is a widening,
    not a rename.
  - The fork (4) door on all four measure-family entry points.
  - **F-07** in `draw` and in `drawWrapped`, per decision (2) including the
    sub-fork. Both have the identical bug and must get the identical fix; a
    shared comment naming F-07 at both sites.
  - Extend T0 with the per-line-vs-total residual law. BUILD T5 (it is empty):
    the allocating reference renderer, the exact five-line Y table, and the
    fractional-`y` discriminator.
  - T9: the A-form control, the B-losing-sub-fork control, and the F-34
    child-process non-termination control on the pattern of control 9.
  - **T6 gets a window per new method.** F-31 and F-32 are in the ledger
    because a body outside every measured window is guarded by nothing;
    `measureWidest` and `measureLine` are two new hot bodies and must not ship
    the same way. Record window C's delta for the F-07 fix.
  - README, llms.txt, d.ts: the new methods, the "which width do I want" note,
    the newline-summing statement probe (h) says is missing everywhere, and the
    precise scope of the pixel-snap promise from probe (f).

HOT PATH
  `measureWidest` is a new hot body -- same shape as `_measureRange`, indexed
  reads only, no allocation, no slicing. `measureLine` is `_measureRange` plus
  the fork (3) door; the brief's original "thin forward" is dead, so its cost
  is a real number that T6 must produce rather than a rounding error someone
  asserts. If fork (3) lands as A1, `draw`'s per-line align calls pay it too --
  measure that separately in window C and record both.

  The F-07 fix adds one multiply and one round per LINE and removes one add per
  line. A 12-line paragraph pays 12 rounds where it previously paid 1, against
  several hundred glyph iterations. Measure it in the T6 window C anyway and
  record the delta -- "obviously negligible" is not a measurement.

ASSERTIONS
  - On `FONT_SNAP`: `measure('AA\nAA') === 32` (pinned, unchanged);
    `measureWidest('AA\nAA') === 16`; `measure('A\nAAAAAA') === 56`;
    `measureWidest('A\nAAAAAA') === 48`. All four literal.
  - `measureWidest(s) === Math.max(...s.split('\n').map(l => measure(l)))` for
    the whole T5 corpus, where the right-hand side is the allocating oracle,
    run outside every measured window.
  - `measureLine(t, a, b, s) === _measureRange(t, a, b, s)` for 50k seeded
    IN-RANGE tuples, exactly -- and, for the out-of-range corpus, `measureLine`
    equals the width `drawWrapped` actually renders for the same range,
    including `[-0.5, 2)` where the raw helper reports one glyph too many.
  - `draw(ctx, 'A\nB\nC\nD\nE', 0, 0, 1.1)` on `FONT_SNAP` produces baselines
    exactly `[0, 19, 37, 56, 75]`, and at `y = 0.6` exactly the ratified one of
    `[1, 20, ...]` (B1) or `[1, 19, ...]` (B2). The accumulating variant gives
    `[0, 19, 38, 57, 76]` and the losing sub-fork gives the other fractional-y
    row; T9 ships BOTH as controls and proves the tests discriminate.
  - Every recorded baseline in T5, across every multi-line case and every
    fractional scale, satisfies `Number.isInteger`.
  - `drawWrapped` produces the baseline sequence `draw` produces, offset by the
    anchor relation from probe (e), at a fractional `y` AND at a vAlign whose
    centring term is fractional -- the case probe (d) says is not free.
  - `measureLine`, `measure` and `measureWidest` RETURN on
    `[-Infinity, Infinity]` and on `{length: Infinity}`: asserted in process,
    and gated by a child process that is killed if it does not exit (F-34).
  - The fork (4) fail-signal table asserted literally, every cell, both the
    unchanged rows and the three declared deltas.
  - `assertOps` on draw / drawWrapped within noise of v1.3.0; `assertAllocs`
    at `maxBytesPerCall: 0` on `measureWidest` and `measureLine`; T6 window C
    recorded.
  - qa runs the 1.3.0 differential: every declared delta driven through the
    comparator to prove it is non-vacuous, and no undeclared fifth delta.
  - `npm run torture` prints "ok"; every control above fails when it should.

NON-GOALS
  No change to `measure`'s return value for a valid multi-line string (that is
  M9, and it is breaking). No X snapping -- probe (f) gives the measured reason
  and it is a T0 law, not a preference. No vertical metrics accessors -- still
  in the rejection ledger, still no consumer. No baseline-vs-top anchor change.
  F-31/F-32/F-27 stay M9's; M4 must not quietly half-fix a gate it depends on.

DONE WHEN
  `measureWidest` / `measureLine` shipped, doored per forks (3) and (4), and
  oracle-verified;
  every line's baseline is an integer at every fractional scale in T5;
  the five-line Y table AND the fractional-y sub-fork row are asserted
  literally, and both losing variants fail as T9 controls;
  the measure family terminates on an unbounded range, proven by a child
  process that gets killed if it does not;
  both new methods sit inside a measured T6 window;
  every behaviour delta is declared and driven through the 1.3.0 differential
```

===============================================================================
# M4a -- lite-bmfont v1.4.1 -- the renderer text door (the second hang)
===============================================================================

```markdown
---
package: "@zakkster/lite-bmfont"
version_target: 1.4.1
status: done          # 2026-08-18; 119 tests (0 fail, 2 todo), torture ok; F-42 (S1 renderer hang) and F-43 closed in 1.4.1
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
peers: ["@zakkster/lite-gc-profiler"]
findings: [F-42, F-43]
frozen_baseline: v1.4.0 (bbf87d1, published 2026-08-18), BitmapFont.js sha256 2e1b03b25d9d605d60a83c58a45deeacfbbc83d87d434af9ba304b3c6e85316a, 1039 lines
depends_on: [M4]
blocks: [M5]
---

# lite-bmfont -- the door was installed on three of five faces

PURPOSE
  M4 closed F-34 by putting `typeof text !== 'string'` on `measure`,
  `measureWidest` and `measureLine`, and the comment it left at `BitmapFont.js:432`
  names the offending input by hand: `{length: Infinity, charCodeAt(){return 65}}`
  "is exactly the input that hung 1.3.0 forever". Two hundred lines below that
  comment, `draw:628` and `drawWrapped:892` read `text.length` with no door at
  all, and the same object hangs both of them -- unkillably, SIGKILL at 6 s.
  The 1.4.0 CHANGELOG says "All three public faces now terminate". Five public
  faces take `text`. Two of them do not terminate, and they are the two a caller
  reaches first.

  This session gives "what is `text`?" ONE answer across all five.

TRIGGERING SIGNAL
  A HUD that renders `font.draw(ctx, state.label, ...)` where `state.label` came
  out of a JSON parse, a `TextDecoder`, or another library's object. Nothing in
  the type system stops it; nothing in the package stops it; the tab freezes and
  the stack shows a `while` loop with no frame to blame.

WHY IT COMES BEFORE M5
  `layoutGlyphs(text, outBuffer, scale)` is a seventh face that walks `text`. Ship
  it over an undoored walk and F-42 acquires a third site on the day the buffer
  format becomes a public contract. M5 must not be the session that decides what
  `text` is, because M5's reviewer is auditing a stride and an overflow policy.

THE DECISIONS (record them before coding)

  (1) WHAT IS THE RENDERER'S TEXT DOOR?
      A. **`typeof text !== 'string'` -> return.** The same predicate the measure
         family already carries three times. One answer for five faces.
      B. A length RANGE door: `const len = text.length; if (!(len >= 0 && len <
         Infinity)) return;`. Closes the hang and nothing else -- `draw(ctx, null)`
         still throws a raw `TypeError`, a boxed `String` still renders where
         `measureWidest` returns `NaN`, and a duck-typed `{length: 2, charCodeAt}`
         still draws two glyphs.
      C. Relax the measure family to a duck-type test so both sides accept the
         same wide set. Rejected in writing in M4 and rejected again here: the
         loose "has a length and a charCodeAt" test is precisely what admits the
         object that never terminates. Do not reopen this without reading F-34.
      Recommendation: **A**. B is a second door that A will have to replace, which
      is the mistake the M1 -> M8 edge exists to prevent -- "shipping it before the
      door means writing the door twice, or worse, once". A also deletes the raw
      `TypeError` that M3 spent a whole session removing from the constructor, and
      it costs one `typeof` per CALL, zero per glyph.
      Declared deltas A carries, both of which belong in the CHANGELOG:
        * `draw(ctx, new String('A'), ...)` renders 1 glyph today, 0 after.
        * `draw(ctx, null, ...)` throws `TypeError` today, returns after.

  (2) FAIL SIGNAL: RETURN OR THROW?
      **Return.** M4's stated asymmetry is the rule: a renderer can decline to act,
      a query cannot decline to answer. `draw`'s scale door at `:627` already
      returns silently on `NaN`, `0` and a negative, and `draw(ctx, 123)` returns
      silently today. Drawing nothing IS the closed state for a renderer (F-11).
      The counter-argument, which someone will raise: turning a `TypeError` into
      silence is a fail-OPEN direction and the Law says fail closed. Answer it in
      the record rather than by changing the answer -- the closed state of a
      renderer is an empty canvas, and a throw here would make `draw` the only
      method in the package that reports a bad argument by throwing.

  (3) DOOR ORDER.
      Text first, then scale, matching the measure family. Unobservable for the
      renderers (both paths return `undefined`), so choose it for uniformity: one
      order, five faces, nothing to remember.

  (4) VERSION: 1.4.1 OR 1.5.0?
      **1.4.1.** Direct precedent: M1 shipped the `drawFast` magnitude door -- a
      hang fix that also changed behaviour on out-of-range values -- as **1.2.2, a
      patch**. Same shape, same severity, same kind of delta. 1.5.0 would shift
      M5 through M8 one minor each and buy nothing. Both deltas from (1) go in the
      CHANGELOG under `### Changed (behaviour)` regardless of the number.

  Record all four as fork (9) of `decisions/0004-metrics-and-snapping.md`, not a
  new ADR. The door being decided IS fork (4)'s door applied to three more faces;
  splitting one policy across two records is how the two families drifted apart
  in the first place.

TASKS
  - Amend `decisions/0004-metrics-and-snapping.md` with fork (9) BEFORE coding,
    including C's second rejection and the two declared deltas.
  - `draw` (`:626`): insert the text door ahead of `const len = text.length`.
  - `drawWrapped` (`:875`): insert the same door ahead of `const tlen = text.length`.
    Note WHY the existing F-04 clamp does not already cover this: the leg
    `if (!(endIdx <= tlen)) endIdx = tlen;` PASSES an `Infinity` `endIdx` when
    `tlen` is itself `Infinity`. The clamp is sound only while `text.length` is
    finite, and nothing said so.
  - `drawFast` takes a number and changes NOT AT ALL. Prove it by body sha.
  - T1: a text-door sweep, one row per renderer, over the same seven inputs the
    measure family is already swept with -- `null`, `undefined`, `123`, `[65]`,
    `new String('A')`, `{length: 2, charCodeAt}`, `{length: Infinity, charCodeAt}`.
  - T9: controls **14** and **15**. Delete the door from `draw` / `drawWrapped` in
    a child process and the tier must fail. Out-of-process with a 6 s `SIGKILL`,
    reusing M4's `t9-measure-hang-child.mjs` shape. **The control must self-test
    the doorless child** -- assert the child ACTUALLY hangs -- exactly as control
    13 does. A hang control that never hangs proves nothing, and this package has
    F-20/F-21/F-26 in the ledger because someone shipped an assertion that could
    not fail.
  - F-43: the two stale counts. Recommendation is NOT to re-pin them: **delete the
    absolute test counts from `README.md:418` and `llms.txt`** and state what is
    gated instead. A number a reader cannot verify and no gate can check is a
    liability; two of them drifted in a single session. If the count stays, it
    needs a gate that reads the real total, and a test asserting its own suite's
    size is circular -- say so in the record either way.
  - No new T6 window. The door is a per-call predicate on four existing bodies;
    re-measure windows A-D and prove the numbers did not move.

HOT PATH
  One `typeof` per CALL on two methods, zero per glyph, zero per line. If the
  measured `draw` window in T6 moves at all, the door was written in the wrong
  place -- inside a loop, or as a helper call.

ASSERTIONS
  - Out-of-process, 6 s `SIGKILL` budget: all FIVE public text faces return in
    under 100 ms on `{length: Infinity, charCodeAt(){return 65}}`. Today `draw`
    and `drawWrapped` are killed at 6 s; the other four return in ~22 ms.
  - The five-face x seven-input table has exactly two answers: every renderer draws
    0 and returns, every measure face returns `NaN`. No raw `TypeError` anywhere
    in the table -- that assertion is what makes A distinguishable from B.
  - **`'A'` is untouched.** T5's full fuzz corpus produces ctx columns
    byte-identical to v1.4.0's recording. A door that also moved a real string is
    the failure mode this session must be unable to hide.
  - Body-sha freeze against `git show bbf87d1:BitmapFont.js`: `drawFast`,
    `measure`, `measureWidest`, `measureLine`, `_measureRange`, `hasGlyph`,
    `destroy` and the constructor are byte-identical. The whole diff is two
    predicates and their comments.
  - Controls 14 and 15 fail when the door is removed, and the doorless child is
    proven to hang.
  - `npm test` 0 fail; `node --expose-gc test/torture.mjs` prints `ok`, exit 0.
  - T6 windows A-D: `maxBytesPerCall: 0` still, and the structural totals unmoved.

NON-GOALS
  No change to what a real string renders. No change to the measure family. No
  new public method. NOT F-19's de-Unicoding, NOT F-37's transient-allocation
  gate, NOT F-40's scale-magnitude bound (all M9). NOT F-26's guard falsifiability
  (M6). Do not touch `draw`'s F-07 baseline arithmetic.

DONE WHEN
  no public face can be made to hang, proven by a control that itself hangs when
  the door is deleted; the five-face x seven-input table has one answer per family
  and no raw TypeError in it; T5's corpus is byte-identical to v1.4.0; the two
  doc test counts are gone or gated

PRECONDITION PROBE (run 2026-08-18 against published 1.4.0, bbf87d1)
  Already measured -- do not rediscover it, and do not trust the line numbers
  after the first insertion. Locate every site by CONTENT.

  1. Hang, out-of-process, `{length: Infinity, charCodeAt(){return 65}}`:
       draw          status=null signal=SIGKILL ms=6004
       drawWrapped   status=null signal=SIGKILL ms=6003
       measure       status=0    ms=22   RETURNED
       measureWidest status=0    ms=21   RETURNED
       measureLine   status=0    ms=21   RETURNED
     `drawWrapped` with a REAL string and `endIdx = Infinity` returns in 21 ms --
     the clamp works; it is `tlen` itself going infinite that defeats it.

  2. The asymmetry, `draw` vs `measureWidest`:
       'A'                      draw 1 glyph        measureWidest 8
       new String('A')          draw 1 glyph        measureWidest NaN
       123                      draw 0, silent      measureWidest NaN
       [65]                     draw THREW TypeError measureWidest NaN
       {length:2,charCodeAt}    draw 2 glyphs       measureWidest NaN
       null / undefined         draw THREW TypeError measureWidest NaN

  3. Sites, at v1.4.0 line numbers:
       `_measureRange` :383   `measure` :432   `measureWidest` :467
       `measureLine`   :542   `hasGlyph` :596  `draw` :626 (len at :628)
       `drawFast`      :737   `drawWrapped` :875 (tlen at :892)
     The two hang loops: `draw:657` `while (lineEnd < len && text.charCodeAt(lineEnd) !== 10) lineEnd++;`
     and `drawWrapped:959` `for (let i = startIdx; i < endIdx; i++)`.

  4. Current gate: `npm test` 119 tests / 117 pass / 0 fail / 2 todo;
     `npm run torture` `ok`, exit 0, one TODO line (T8 = M7).
     Per file: BitmapFont.test.js 88, boundary.test.js 27, findings.test.js 3,
     packaging.test.js 1. `README.md:418` and `llms.txt` both still say 116/114.
```

===============================================================================
# M5 -- lite-bmfont v1.9.0 -- glyph quads (`layoutGlyphs` + `drawQuads`)
===============================================================================

```markdown
---
package: "@zakkster/lite-bmfont"
version_target: 1.9.0  # RE-STAMPED 2026-08-20 at plan time; was 1.5.0, which
                       # M8 consumed on 2026-08-18. Two additive methods plus
                       # one named export, no shipped behaviour changed -> MINOR.
status: done           # shipped 2026-08-20 (published, commit c030089).
                       # Baseline 1ab66eb (1.8.0).
                       # Pipeline: planner -> coder -> reviewer (REJECTED, 1
                       # blocker) -> coder -> qa (FAIL, 2 blockers) -> coder ->
                       # qa (PASS). Gate at PASS: 136 tests / 135 pass / 0 fail
                       # / 1 todo (F-14, M9's); torture ok, exit 0, ZERO TODO
                       # lines. All TEN body shas byte-identical to 1ab66eb
                       # (diffed against a pre-edit capture AND re-fetched from
                       # git by qa). Tarball 9 files, no test/ or demo/.
                       # THREE gate defects were found and fixed IN the gate
                       # itself, not in the feature: see the M5 status note.
                       # Read SESSION-M5.md section 0 FIRST: this brief predates
                       # M0 and eight releases have landed on it. THIRTEEN drift
                       # rows (R-1..R-13) override the body below, including TWO
                       # assertions that are UNSATISFIABLE as written -- R-3
                       # (a Float32Array buffer cannot hold the draw cursor:
                       # 4 of 6 columns differ at scale 1.1) and R-5 (the origin
                       # snap does not commute: 16 of 24 cases differ, so
                       # "byte-identical to draw" is unreachable until the
                       # rounding point is pinned) -- plus R-4, which is F-45's
                       # exact shape in a new place: `scale` is baked into the
                       # buffer by layoutGlyphs and passed AGAIN to drawQuads.
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
peers: ["@zakkster/lite-gc-profiler"]
findings: []          # F-03 closed in M2, F-12 closed in M2/M3 -- this is a
                      # feature session that closes no finding. It INHERITS the
                      # M4a text door and the M4 measure family; re-verify both
                      # in its precondition probe before writing a line.
depends_on: [M2, M4a]
blocks: [M6]
---

# lite-bmfont -- give the caller the cursor walk, not just its pixels

TRIGGERING SIGNAL (unchanged from the original roadmap)
  tripple win banners. Letters must stagger, bounce and fade individually.
  Today `draw()` rasterises a whole string with no way to touch one letter.

PURPOSE
  Two methods, mirroring the `computeWrap` idiom already used across the suite
  -- compute into a caller-owned buffer, then render it:

      font.layoutGlyphs(text, outBuffer, scale = 1) -> glyphCount
      font.drawQuads(ctx, buffer, first, count, x, y, scale = 1)

  (This signature is the one THE DECISION below lands on. The brief originally
  carried `drawQuads(ctx, buffer, glyphCount, x, y, scale)` here and the
  `first`/`count` form in the recommendation -- two signatures in one document.
  Corrected 2026-08-18; the subset form is the whole reason B was rejected.)

  Stride 6 per glyph: `[sx, sy, sw, sh, dx, dy]` -- source rect in the atlas,
  destination offset relative to the origin. Kerning and `xoffset`/`yoffset`
  are already folded into `dx`/`dy`, so the caller never touches the kerning
  LUT.

  The animation seam is that the caller MUTATES the buffer between the two
  calls -- displace `dx`/`dy`, skip a glyph, or draw subsets with different
  `globalAlpha`. No callback, so no per-glyph indirect call and no risk of a
  megamorphic call site.

WHY IT COMES AFTER M2
  The `dx` column IS the cursor walk. Every finding M2 fixes is a way the cursor
  becomes NaN, and this session promotes that cursor to a public buffer format
  that lite-text-layout and tripple will both read. Shipping this first would
  bake F-03 into a format contract, which is the most expensive mistake
  available in this document. The conservation law from M2 is what makes the
  quad buffer verifiable at all: `dx[k]` must equal the cursor the reference
  walk computes, exactly, for every k.

THE DECISION (record it before coding)
  Stride 6 or stride 8?
  A. **STRIDE 6** `[sx, sy, sw, sh, dx, dy]`, uniform `scale` passed to
     `drawQuads`. Destination size is `sw * scale`, `sh * scale`. 24 bytes per
     glyph. Per-letter scale requires drawing subsets.
  B. **STRIDE 8** adding `dw, dh`. Per-letter scale falls out for free. 32
     bytes per glyph -- 33% more buffer traffic for every caller, to serve the
     subset who animate scale.
  C. Stride 6 plus a parallel per-glyph scale array. Two buffers to keep in
     sync; the worst of both.
  Recommendation: **A, with `drawQuads` taking `first` and `count`** so a caller
  can render any contiguous subset with its own scale, alpha or transform:
  `drawQuads(ctx, buf, first, count, x, y, scale)`. That is the same primitive
  B offers, expressed as N draw calls for the N letters that actually need
  independent scale, instead of 33% more bytes for the whole string forever.
  Record B's rejection with the byte number; someone will propose it again the
  first time they want a bouncing letter.

  Export `GLYPH_STRIDE = 6` as a named constant. A caller who hardcodes 6 is a
  caller who breaks when M9 revisits this.

TASKS
  - Write decisions/0005-glyph-quads.md BEFORE coding, with the stride decision
    and the rejected callback form.
  - `layoutGlyphs(text, outBuffer, scale)` -> glyphCount. Writes stride-6
    records. Skips newlines and unmapped glyphs by the SAME rule as `draw`
    (the M2 idiom, asserted identical). Advances the cursor by the SAME
    arithmetic. Returns the count actually written and **stops at buffer
    capacity**, returning the count written and never writing past
    `outBuffer.length` -- with the overflow reported, not swallowed. Decide and
    record: throw on overflow, or return a count smaller than the glyph count
    and expose it. Recommendation: throw, because a silently truncated banner is
    F-05 in a new costume.
  - `drawQuads(ctx, buffer, first, count, x, y, scale)`.
  - **Do not touch `draw()`.** It stays exactly as it is. `layoutGlyphs` is a
    separate method so the common path keeps its current monomorphic shape and
    current numbers. Diff `draw` to prove zero change.
  - Extend T0's conservation law to a fourth witness: the quad buffer's `dx`
    column must equal the `draw` walk for the same string, element for element.
  - Extend T6 with a layoutGlyphs + drawQuads window.
  - README, llms.txt, d.ts: buffer format table, the mutation seam, the
    constant.

HOT PATH
  Both new methods are hot -- a banner lays out every frame. Indexed typed-array
  reads and writes only, no closures, no per-glyph objects, no `subarray` inside
  the loop. `drawQuads` reads six floats and issues one `drawImage`; that is the
  entire body.

ASSERTIONS
  - Round-trip: for the whole T5 corpus, `layoutGlyphs` + `drawQuads` produces
    a recorded ctx column set byte-identical to `draw` for the same string,
    origin, scale and left alignment. Not "visually equivalent" -- identical
    Float64 columns.
  - `layoutGlyphs` returns the same glyph count that `draw` issues drawImage
    calls for, over the whole corpus (`ctx.total` equality).
  - The `dx` column satisfies the M2 conservation law against the descriptor
    oracle.
  - Mutating `buf[i * 6 + 5] += 10` between the calls moves exactly one glyph
    by exactly 10 in y and nothing else -- asserted on all six columns.
  - `drawQuads(ctx, buf, 2, 3, ...)` draws exactly glyphs 2, 3, 4 and issues
    exactly 3 calls.
  - An `outBuffer` one record too small behaves per the recorded overflow
    policy, with a named test, and the exactly-large-enough buffer does not
    trip it.
  - `measureAllocs` reports `maxBytesPerCall: 0` for both methods.
  - `git diff BitmapFont.js` shows zero change inside `draw`.
  - `npm run torture` prints "ok".

NON-GOALS
  No per-glyph callback -- rejected in writing (an indirect call per glyph, and
  a megamorphic call site the moment two callers pass different closures). No
  rotation or per-glyph transform matrix. No range parameters yet (M6). No
  change to `draw`.

DONE WHEN
  quad round-trip is byte-identical to draw() across the fuzz corpus;
  0 bytes/call on both methods under measureAllocs;
  a mutation between the calls moves exactly one letter; draw() diff-clean
```

===============================================================================
# M6 -- lite-bmfont vUNASSIGNED -- range-addressable text (SUPERSEDED 2026-08-20)
===============================================================================

```markdown
---
package: "@zakkster/lite-bmfont"
version_target: unassigned   # was 1.6.0, CONSUMED by M2a on 2026-08-19. Not
                             # renumbered speculatively -- see the ledger rule
                             # "decision numbers and version targets are issued
                             # at PLAN time, not reserved". A guessed number is
                             # how M8b's 1.6.0 became wrong.
status: superseded           # CUT 2026-08-20 at the keep-or-cut decision that
                             # the AMENDMENT and the DONE WHEN both required.
                             # RE-SCOPED 2026-08-19 first; see AMENDMENT below.
                             # Three of four premises had expired; the fourth
                             # was not justified. See THE CUT, below.
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
peers: ["@zakkster/lite-gc-profiler", "@zakkster/lite-text-layout"]
findings: []                 # was [F-04]. F-04 CLOSED in 1.2.3 (M2). The
                             # "why it comes after M2" argument below is
                             # discharged, not pending.
depends_on: [M5]             # was [M2, M5]. M2 shipped 1.2.3; M5 shipped
                             # 1.9.0 on 2026-08-20. BOTH EDGES SATISFIED -- this
                             # session was unblocked and was cut on merit, not
                             # abandoned because it could not run.
blocks: []                   # was [M9]. Released 2026-08-20 by the cut: M9's
                             # depends_on drops M6 and is now fully satisfied.
---

# lite-bmfont -- close the last allocation in the lite-text-layout pipeline

## THE CUT -- 2026-08-20 -- this session does not ship

The AMENDMENT below re-scoped this session down to ONE live item and then
required a keep-or-cut decision at plan time; the DONE WHEN named
`status: superseded` as an admissible outcome, on the condition that the
reasoning be written down. This is that reasoning. Taken 2026-08-20, after M5
shipped 1.9.0 and cleared the last blocking edge.

CUT. The surviving item -- `start`/`end` on single-line `draw` -- is not built.

The four premises this session rested on, and where each stands today:

| premise | state 2026-08-20 | evidence |
|---|---|---|
| the measure half is missing | **SHIPPED, by a contradicting design** | `measureLine(text, start, end, scale)` in 1.4.0, `BitmapFont.js:569`, ratified `decisions/0004:253` |
| `layoutGlyphs` needs ranges | **NOT THIS SESSION'S** | M5 shipped `layoutGlyphs` + `drawQuads` in 1.9.0; ranges on it were always contingent and were never asked for |
| every wrapped line needs `text.slice()` per frame | **DISCHARGED** | `drawWrapped` renders each `[start, end)` out of the layout buffer; lite-text-layout TL5 runs the wrapped pipeline at 0 bytes/frame |
| `1.6.0` is reserved for it | **CONSUMED** | M2a took 1.6.0 on 2026-08-19 (F-45) |

Three expired on their own. The fourth is the decision, and it goes against
shipping, on the grounds the AMENDMENT set (convenience, not necessity):

1. **No consumer.** TL5's render path is `drawWrapped`. No caller in this repo,
   in `lite-text-layout`, or in the demo asks for a range-addressable
   single-line `draw`. The rejection ledger's own standard -- "revisit when a
   named consumer appears, not before" -- is the standard applied here.
2. **The cost lands on the most-used method in the package.** Option A (the
   recommended one) takes `draw` to EIGHT positional parameters, the last two
   being a swappable index pair. Options B and C were already rejected in
   writing: B allocates one object per call per frame in the package whose
   identity is that drawing does not allocate; C duplicates a hot body or adds a
   frame to it.
3. **It multiplies F-04's reach by design.** This session's own load-bearing
   sentence says making `startIdx` public "multiplies its reach from one method
   to four and writes it into a cross-package contract". That argument was
   written to justify ORDERING it after M2. With the motivation discharged, the
   same sentence reads as a reason not to take the exposure at all.
4. **Two range-measure surfaces with different argument orders already nearly
   happened here** (AMENDMENT item 1). Adding a third range convention -- range
   params trailing `scale`/`align` on `draw`, against `measureLine`'s leading
   pair -- widens exactly the inconsistency that item flagged.

WHAT THE CUT COSTS, RECORDED SO IT IS NOT REDISCOVERED AS A SURPRISE:

- **F-26 loses its owner.** The F-26 row routes to this session on the theory
  that a public range API creates the first NaN-capable call path into `draw`'s
  guard, making the reshape falsifiable at last. No such path is now ever built,
  so the guard stays unfalsifiable through the public API **permanently**, not
  temporarily. F-26 is RE-ROUTED to M9's hardening pass with a changed question:
  not "add the behavioural kill" (impossible now) but "delete the unfalsifiable
  reshape, or pin it in the source-text gate and say that is all it has". See
  the F-26 row, amended 2026-08-20.
- **A caller who wants a substring drawn still allocates** a `text.slice()` per
  call. That cost is real, it is one call per SUBSTRING draw and not one per
  line per frame, and no shipped or peer consumer pays it today.

REOPENING CONDITION (so this is a decision and not a door nailed shut): a named
consumer that draws substrings per frame on a hot path, with the per-frame
allocation measured. Then re-plan it, issue a fresh decision number, and take
option A with `end` defaulting to `text.length`.

## AMENDMENT 2026-08-19 -- read this before the body below

Raised by the `@zakkster/lite-text-layout` TL5 session and verified here against
the shipped source, not against the brief's own prose. THREE of this session's
premises expired while it sat unscheduled:

1. **The measure half ALREADY SHIPPED, by a design that contradicts this brief.**
   The body below plans `measure(text, scale, start, end)`. `decisions/0004:253`
   ratified the opposite -- "Options: **A** leave `measure` alone and add the
   missing two" -- and 1.4.0 shipped `measureLine(text, start, end, scale)`
   (`BitmapFont.js:569`) plus `measureWidest`. Note the argument ORDER differs
   too. Taken literally this task would RE-OPEN a ratified ADR, which is why it
   is struck below rather than quietly edited.
2. **Its version is gone.** `1.6.0` was consumed by M2a (F-45) on 2026-08-19.
3. **Its motivation is discharged.** The TRIGGERING SIGNAL was "every line needs
   `text.slice()` per frame". `measureLine` removed the measure-side slice in
   1.4.0 and `drawWrapped` renders each `[start, end)` straight out of the
   layout buffer with no slice at all. lite-text-layout TL5 runs the wrapped
   pipeline at 0 bytes/frame with NO range-aware single-line `draw`.

What SURVIVES is one item, and it is now a convenience rather than a necessity:
range parameters on single-line `draw`. No shipped consumer needs it; TL5's
render path is `drawWrapped`. Keep-or-cut is a REAL decision to be taken when
this is scheduled, on convenience grounds, and recorded as such -- not inherited
as a default from a motivation that no longer holds.

`layoutGlyphs` is NOT this session's to add: it is M5's deliverable (source
count today: 0 occurrences), and M6 only ADDS ranges to it. That half is
contingent on M5 shipping first.

M5 is untouched by this amendment and stands on its own batching justification.
(Its own `version_target: 1.5.0` is separately stale -- consumed by M8 -- and is
left for its plan time under the same no-speculative-renumbering rule.)

TRIGGERING SIGNAL (DISCHARGED -- kept for the record, see AMENDMENT item 3)
  Wrapped animated text. `computeWrap` reports `[startIdx, endIdx]` into the
  ORIGINAL string; without range parameters every line needs `text.slice()`,
  which allocates once per line per frame.

PURPOSE (RE-SCOPED)
  ~~Add `start`/`end` to `measure`, `draw` and `layoutGlyphs`.~~ Add `start`/`end`
  to single-line `draw` ONLY, if the convenience case is made at plan time. The
  `measure` half shipped as `measureLine` in 1.4.0; the `layoutGlyphs` half
  belongs to M5.

  The original claim -- "this makes the lite-text-layout contract
  allocation-free end to end" -- is FALSE as of 1.4.0/1.6.0: that pipeline is
  already allocation-free through `measureLine` and `drawWrapped`.

WHY IT COMES AFTER M2 (this is the load-bearing sentence of the session)
  F-04 is a negative `startIdx` producing a whole line of NaN draws, and this
  session makes `startIdx` a **public parameter of the most-used method in the
  package**. Every bad index that a wrap engine can compute -- a negative from
  an off-by-one, a NaN from a division, an end past the string from a stale
  buffer -- arrives here. Shipping the public range API over the un-normalized
  index door does not just leave F-04 unfixed; it multiplies its reach from one
  method to four and writes it into a cross-package contract. Same ordering
  argument as "A1 before X1, always".

THE DECISION (record it before coding)
  How is the range passed?
  A. **APPENDED POSITIONAL PARAMETERS.**
     `draw(ctx, text, x, y, scale, align, start, end)`. Eight parameters, which
     is a lot, and the last two are easy to pass in the wrong order.
  B. **AN OPTIONS OBJECT.** `draw(ctx, text, x, y, { start, end, scale, align })`.
     Readable, self-documenting, and **it allocates one object per call per
     frame**. In the package whose entire identity is that drawing does not
     allocate. Sixty HUD values plus twelve paragraph lines is 72 object
     literals per frame, every frame.
  C. **A SEPARATE `drawRange` METHOD.** Keeps `draw`'s arity, adds surface, and
     duplicates the body or adds a forwarding frame to the hot path.
  Recommendation: **A**, and B's rejection goes in the ledger with the number,
  because B is what every reviewer's instinct will suggest and it is the exact
  mistake this package exists to avoid. Mitigate A's ordering hazard by making
  `end` default to `text.length` and by asserting the swapped-argument case
  (`start > end`) renders nothing rather than something surprising.

TASKS
  - Write the range-parameters decision record BEFORE coding, with B's rejection
    and its per-frame allocation count. NUMBER ISSUED AT PLAN TIME -- the old
    reservation `decisions/0006-range-parameters.md` is void: 0006 shipped as
    `0006-layout-buffer-scale.md` (M2a) and 0008 as `0008-ascii-gate.md` (M2b).
  - ~~`measure(text, scale, start, end)`~~ **SUPERSEDED -- do not implement.**
    Shipped instead as `measureLine(text, start, end, scale)` in 1.4.0 per
    `decisions/0004:253`. Implementing the struck signature would re-open a
    ratified ADR and would give the package two range-measure surfaces with
    different argument orders.
  - `draw(ctx, text, x, y, scale, align, start, end)` -- the only live item.
  - ~~`layoutGlyphs(text, outBuffer, scale, start, end)`~~ contingent on M5
    shipping `layoutGlyphs` at all (source count today: 0).
    Defaults `start = 0`, `end = text.length`, so every existing call site is
    unchanged.
  - Normalize both indices with the M2 idiom -- the SAME code path, not a copy.
    If M2's normalization is not already factored so this session can reuse it,
    factoring it is part of this session and must not add a per-glyph frame.
  - Multi-line semantics inside a range: decide and record whether `\n` inside
    `[start, end)` still breaks the line (recommendation: yes, identical to
    `draw` on the sliced string -- the whole assertion below depends on it).
  - Extend T0's conservation law to the public range surface. Extend T2 with
    ranges arriving from a layout buffer.
  - README, llms.txt, d.ts. Add an end-to-end lite-text-layout example that
    renders a wrapped paragraph line by line with zero allocation, and gate it
    in T6.

HOT PATH
  Two extra parameters on three hot bodies. Parameter count affects the
  register allocation and the call sequence, so this is not free by inspection
  -- `assertOps` on `measure` and `draw` against the v1.5.0 baseline, with the
  numbers in the decision file. Index normalization happens ONCE per call (or
  per line), never per glyph. Diff the per-glyph loops to prove they are
  untouched.

ASSERTIONS
  - `draw(ctx, text, x, y, s, a, i, j)` produces a byte-identical recorded
    column set to `draw(ctx, text.slice(i, j), x, y, s, a)` for 50k seeded
    (string, i, j) pairs -- including i === j, i > j, i < 0, j > length,
    i or j NaN or fractional. The slicing version is the allocating oracle.
  - ~~`measure(t, s, i, j) === measure(t.slice(i, j), s)`~~ MOOT: this is the
    shipped `measureLine` law, already gated by T5 since 1.4.0.
  - Rendering a 12-line wrapped paragraph line by line, 100,000 frames:
    `measureAllocs` reports `maxBytesPerCall: 0`, and `checkNoGc` reports
    `maxMajor: 0`, `maxPauseMs <= 4`, `maxArrayBuffersGrowth: 0`.
  - The same paragraph rendered with the `slice()` oracle allocates a non-zero,
    reported number -- so the comparison is a measurement and not a claim. Put
    that number in the README's benchmark block, stamped with the version and
    machine.
  - A negative `start` from a layout buffer produces 0 NaN coordinates
    (`nanCount === 0`) and the clamped, correct glyph sequence. Failing before
    M2, passing after; prove both directions.
  - `assertOps` on measure / draw / layoutGlyphs within noise of v1.5.0.
  - `npm run torture` prints "ok".

NON-GOALS
  No options-object API -- rejected in writing. No `drawWrapped` signature
  change (it already takes ranges through the buffer). No bidi, no shaping.

DONE WHEN
  range draw is byte-identical to the slice() oracle across the fuzz corpus;
  a 12-line paragraph renders at 0 bytes/frame with the oracle's number
  recorded beside it. (The old third clause -- "the negative-start case is
  proven fixed in both directions" -- is DISCHARGED: F-04 closed in 1.2.3 and
  T2 has gated the clamp since. It is not a DONE WHEN for this session.)

  FIRST, THOUGH: the keep-or-cut decision from the AMENDMENT. If range-`draw`
  cannot be justified against a real consumer at plan time, the honest DONE WHEN
  is `status: superseded` with the reasoning written down, not a session that
  ships an API nothing asked for.
```

===============================================================================
# M7 -- lite-bmfont v1.8.0 -- atlas generation as a subpath export
===============================================================================

```markdown
---
package: "@zakkster/lite-bmfont"
version_target: 1.8.0  # RE-STAMPED 2026-08-20 at plan time; was 1.7.0, which
                       # M8b consumed. Additive subpath export -> MINOR.
status: done           # shipped 2026-08-20 (published, 1.8.0).
                       # Baseline 32b5304 (1.7.0).
                       # Pipeline: planner -> coder -> reviewer (APPROVED, 2
                       # nits, both closed) -> qa (FAIL, 4 findings, all fixed)
                       # -> qa (PASS). Gate at PASS: 126 tests / 125 pass /
                       # 0 fail / 1 todo (F-14, M9's); torture ok, exit 0,
                       # ZERO TODO lines -- T8 is filled, so the run carries no
                       # TODO for the first time since M0. All 11 body shas
                       # identical to 32b5304; BitmapFont.js diff is one line.
                       # F-18 CLOSED. F-48 OPENED by qa (S4, Atlas.js door 3c
                       # mis-attributes an internal bug as a DOM failure) and
                       # deliberately NOT fixed here -- see its row.
                       # Read SESSION-M7.md section 0 FIRST: this brief predates
                       # M0 and five releases have landed on it. Nine drift rows
                       # (R-1..R-9) override the body below, including an
                       # assertion that is UNSATISFIABLE as written (R-3: "git
                       # diff --stat BitmapFont.js is empty" cannot hold when
                       # VERSION lives in that file) and a decision number that
                       # is already taken (R-2: 0007 is M8b's; M7 issues 0009).
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
peers: []
findings: [F-18]      # CLOSED in 1.8.0. F-48 opened by this session's qa.
depends_on: [M0]
blocks: [M9]
---

PUBLISH-WINDOW EXPOSURE (recorded 2026-08-20, M7 -- NO gate in this repo can see it)
  The demo now imports `https://cdn.jsdelivr.net/npm/@zakkster/lite-bmfont/Atlas.js/+esm`.
  That URL 404s from the moment this lands until 1.8.0 is published to npm and
  jsDelivr fetches it -- a live but broken demo for the whole window. This is
  UNGATED and unavoidable (the same is true of any CDN-consuming demo on a
  release), and it is dated so it is not mistaken for a code fault. It closes on
  publish. The demo uses the CDN FILE path (`Atlas.js/+esm`), not `/atlas/+esm`:
  jsDelivr resolves file paths reliably but not package `exports` subpaths (R-7,
  decisions/0009). The npm-consumer contract stays `@zakkster/lite-bmfont/atlas`.

CORRECTION (recorded 2026-08-20, M5): the demo import above was changed to the
BARE path `.../Atlas.js` (no `/+esm`) in commit 1ab66eb -- `/+esm` is jsDelivr's
CJS->ESM transform and Atlas.js is already zero-dep ESM, so the suffix converts
nothing. Appended, not edited: the dated block above is evidence. The
`test/findings.test.js` pin tracks the bare spelling.

# lite-bmfont -- three copies of generateAtlas is a missing feature

TRIGGERING SIGNAL (unchanged from the original roadmap)
  Every consumer copy-pastes it. `demo/demo-lite-bmfont.html:261` has a 40-line
  `generateAtlas(size, fontCSS, fillColor, shadowColor)` that returns
  `{ atlas, json }` and is called four times (lines 309, 313, 317, 321), and
  tripple needs the same function. Two copies is a coincidence; three is a
  missing feature.

PURPOSE
  Ship it as a subpath export so the core stays free of any DOM reference:

      import { generateAtlas } from '@zakkster/lite-bmfont/atlas';

  Browser-only by construction (it needs `document.createElement`). The core
  module must remain importable in Node -- tripple's headless tests depend on
  that, and so does every node:test file in this repo.

  This also removes the only real argument for a tinting API: a themed atlas per
  colour is generated at boot and costs nothing per frame.

THE DECISION (record it before coding)
  The suite Law says "single PascalCase main file". A subpath export is a second
  file. That tension is real and must be resolved on the record, not by
  shrugging.
  A. **SUBPATH `Atlas.js` + `Atlas.d.ts`.** The core stays one file, imports
     nothing, and keeps `sideEffects: false`. Two files ship; the core is still
     a single file and the second is never loaded unless asked for.
  B. **FOLD IT INTO BitmapFont.js** behind a `typeof document` check. One file,
     but the core now contains a DOM reference, a dead branch in every Node
     bundle, and a `sideEffects` story that needs explaining.
  C. **A SEPARATE PACKAGE** `@zakkster/lite-bmfont-atlas`. Cleanest boundary,
     and a whole package's worth of overhead for 40 lines with one consumer.
  Recommendation: **A.** The Law's intent is one module, no build step, no
  bundler required -- and A satisfies all three. Write that reading down;
  it will be cited by the next package that wants a subpath.

  Second decision: the return shape. `{ atlas, json }` allocates one object and
  two sub-objects per call. That is correct and it needs to be said out loud:
  `generateAtlas` is a **boot-time cold path**, called once per theme, and it is
  the only function in this package permitted to allocate. Mark it in the source
  header, in llms.txt and in the d.ts so nobody "optimizes" it into an out
  parameter, and so nobody cites it as precedent.

TASKS
  - Write decisions/0007-atlas-subpath.md BEFORE coding, with the Law reading.
  - Extract `generateAtlas(size, fontCSS, fillColor, shadowColor)` from the demo
    into `Atlas.js` verbatim first, then clean it. Verbatim first so the diff
    that changes behaviour is separate from the diff that moves code.
  - `exports` gains `"./atlas": { "types": "./Atlas.d.ts", "import":
    "./Atlas.js" }`. `files[]` gains both. `sideEffects: false` stays true and
    is asserted.
  - The generated `json` must satisfy the M3 descriptor door -- generate a font
    from it and construct a `BitmapFont` in checked mode. A generator whose
    output its own validator rejects is a bug in one of them, and this test
    finds out which.
  - Update the demo to import it instead of defining it, and delete the local
    copy. That is the finding's closure condition.
  - T8 gains the DOM-free core assertion with the subpath present, and a
    conformance test: `generateAtlas` output -> `new BitmapFont(..., { checked:
    true })` -> `measure` and `draw` produce sane, asserted numbers.
  - README section, llms.txt entry, d.ts.

HOT PATH
  None. `generateAtlas` is explicitly cold and labelled as such at every
  mention. Nothing in this session touches BitmapFont.js -- `git diff` proves
  it.

ASSERTIONS
  - `import { BitmapFont } from '../BitmapFont.js'` succeeds under
    `node --test` with no DOM globals defined, with `Atlas.js` present in the
    package. Assert `typeof document === 'undefined'` in the same file so the
    test cannot pass by accident under a polyfill.
  - `grep -n "document\|window\|HTMLCanvas" BitmapFont.js` returns nothing
    outside JSDoc type annotations.
  - `git diff --stat BitmapFont.js` is empty for this session.
  - `npm pack --dry-run` includes Atlas.js and Atlas.d.ts and still excludes
    test/ and demo/.
  - The demo file contains no local `generateAtlas` definition and imports the
    subpath; all four call sites still work.
  - A font built from `generateAtlas` output constructs in checked mode,
    `hasGlyph(65)` is true, and `measure('A')` equals the descriptor oracle.
  - `npm run torture` prints "ok" with T8 complete.

NON-GOALS
  No tinting API at runtime -- generate a themed atlas at boot instead, and
  record that as the reason tinting stays rejected. No SDF/MSDF generation
  (ledger). No font loading, no fetch, no async surface in the core.

DONE WHEN
  `import ... from '@zakkster/lite-bmfont/atlas'` works; the demo imports it
  and defines nothing; the core imports under node --test with no DOM;
  generated output constructs in checked mode
```

===============================================================================
# M8 -- lite-bmfont v1.5.0 -- `drawFastInt`
===============================================================================

```markdown
---
package: "@zakkster/lite-bmfont"
version_target: 1.5.0  # was 1.8.0; PULLED FORWARD 2026-08-18 at the user's request.
                       # M8 only ever depended on M1 (shipped 1.2.2), so its
                       # position in the numbering was queue order, not a
                       # constraint. It now takes the next minor and M5/M6/M7
                       # each shift one later. M9 stays 2.0.0.
status: done           # 2026-08-18; drawFastInt + DRAWFASTINT_MAX shipped in 1.5.0.
                       # drawFast byte-frozen (A7, body sha == 1a962c5). F-23 NOT
                       # fixed here -- RE-ROUTED to M8b by decisions/0005 fork 1.
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
peers: ["@zakkster/lite-gc-profiler"]
findings: [F-23]      # RE-CORRECTED 2026-08-18 by the precondition probe (P-2).
                       # Was [F-01, F-02] (both closed by M1 in 1.2.2), which I
                       # then over-corrected to []. Wrong: M1 OPENED F-23 and
                       # routed it HERE. F-23 is the only open S2 in the package.
                       # M8 is NOT a pure feature session. See P-1.
depends_on: [M1]       # satisfied since 1.2.2 -- nothing blocks this session
blocks: [M9]
---

# lite-bmfont -- an integer counter should not read "120.0"

TRIGGERING SIGNAL (unchanged from the original roadmap)
  tripple's credit/score counter. `drawFast` always renders one decimal place
  (`33.4`), so an integer counter shows `120.0`.

PURPOSE
  `drawFastInt(ctx, value, x, y, scale, align)` -- same zero-allocation
  char-code path, no decimal point. Small and self-contained.

WHY IT COMES AFTER M1
  It is the same digit loop over the same 24-byte scratch, and it therefore has
  the same two bugs before it is even written. Shipping it before M1 means
  writing the magnitude door twice, or -- far more likely -- writing it once and
  forgetting the copy. The original roadmap said "bundle it with whichever
  session has room"; the answer to which session has room is the one that
  already owns the door.

THE DECISION (record it before coding)
  Scratch buffer: share `_charScratch` with `drawFast`, or allocate a second?
  A. **SHARE.** Zero extra bytes per font. Safe because neither method is
     re-entrant: `ctx.drawImage` is the only foreign call, and a real
     `CanvasRenderingContext2D` cannot call back into user code.
  B. **A SECOND 24-byte SCRATCH.** 24 bytes per font, and re-entrancy stops
     being an assumption.
  Recommendation: **A, with the assumption written down as a contract line.**
  It is true for Canvas2D and it is NOT true for an arbitrary object with a
  `drawImage` method -- including the torture harness's recording ctx, which
  could be made to re-enter. So the contract says "ctx.drawImage must not
  re-enter the font", the harness obeys it, and T9 gains a control that violates
  it and proves the corruption is real rather than theoretical. An undocumented
  assumption that a test could break by accident is how a green suite hides a
  bug.

  Second decision: the integer ceiling. `drawFastInt` has 24 bytes for digits
  and no '.' , so it fits 24 integer digits -- but doubles are only
  integer-exact to 2^53. Above that, `value % 10` returns digits that are
  arithmetic noise. Recommendation: ceiling at `Number.MAX_SAFE_INTEGER`
  (9007199254740991, 16 digits), exported as `DRAWFASTINT_MAX`, with the same
  silent-no-draw policy as M1. Rendering 18 confident digits of a number that
  only has 16 is a lie the package should not tell.

PRECONDITION PROBE (2026-08-18, run before the planner saw this brief)
  This brief predates M0 and was written before M1 measured F-23. Five defects
  in the brief itself, every one verified by command, not by reading:

  P-1 SCOPE CONTRADICTION -- blocker, and the fork the planner must ratify.
      This brief says "`git diff BitmapFont.js` shows zero change inside
      `drawFast`" and DONE WHEN says "drawFast diff-clean".
      `decisions/0001` (RATIFIED) says F-23's "digit-extraction rewrite belongs
      there [M8] ... which already reopens `drawFast`", and
      `test/torture/t4-numeric.mjs:176-187` pins BOTH bands with the literal
      operator message "(M8 will change this)", constructed so M8's arithmetic
      fix forces the tier RED rather than passing either way. The brief and the
      ledger cannot both be obeyed. This is fork (1) of `decisions/0005`.

  P-2 `findings: []` was WRONG, and it was my own over-correction. F-01/F-02
      are closed, but M1 OPENED F-23 and routed it here. F-23 is the only open
      S2 in the package. Corrected to [F-23] in the front matter above.
      (F-22, opened by the same session, was fixed in 1.2.2 and is closed.)

  P-3 THE SWEEP'S ORACLE CONTRADICTS THE SWEEP'S OWN CLAMP RULE. ASSERTIONS
      require every accepted value to match `String(Math.trunc(v))`, and the
      sweep includes -1. Negatives clamp to 0, so -1 renders "0" while that
      oracle demands "-1": 1 clash in 20 rows, measured. The oracle is
      `String(Math.trunc(v < 0 ? 0 : v))`. Separately, the sweep lists both
      `2^53 - 1` and `MAX_SAFE_INTEGER`; they are the SAME number, so the
      sweep has 19 distinct rows, not 20.

  P-4 "the same two bugs before it is even written" is FALSE as specified, and
      this is the probe's most useful result. F-23 band 1 needs the
      `Math.round(value * 10)` that `drawFastInt` does not have; band 2 needs
      |v| > 2^53, which the `MAX_SAFE_INTEGER` ceiling excludes by
      construction. 600,059 samples through the verbatim shape of the shipped
      loop (every power of ten and its two neighbours, 2^31, 2^32, 2^52,
      MAX-1, the top decade dense, 300k uniform across the whole admitted
      range) -- ZERO mismatches against `String(v)`. `drawFastInt` is EXACT BY
      CONSTRUCTION, and the ceiling is the thing that makes it so. That is the
      reason for the ceiling, not a side effect of it, and the docs should say
      so. It also means "duplicate the loop" copies a body that is sound at
      the new ceiling even while it is defective at drawFast's.

  P-5 The decision doc is `decisions/0005-drawfastint.md`, NOT 0008. Slots
      0005-0007 were reserved for M5/M6/M7 back when those preceded M8; they
      now land after it. Existing: 0001-0004.

  CONFIRMED SOUND, so the planner need not re-probe these: `_charScratch` is
  24 bytes (`BitmapFont.js:187`) with exactly two touch points today
  (`drawFast` :771, `destroy` :1057), so option A is a 2-way share.
  `MAX_SAFE_INTEGER` is 16 digits into a 24-byte scratch. The harness
  recording ctx exposes a plain `drawImage` method
  (`test/torture/harness.mjs:102`), so the T9 re-entrancy control is writable
  rather than hypothetical. Baseline suite at 1.4.1: 119 tests, 117 pass,
  0 fail, 2 todo; torture ok.

TASKS
  - Write decisions/0008-drawfastint.md BEFORE coding.
  - `drawFastInt(ctx, value, x, y, scale, align)`. Same door idiom as M1, same
    loop bound, no decimal digit, no '.', ceiling at MAX_SAFE_INTEGER, negatives
    clamped to 0 exactly as `drawFast` does.
  - Export `DRAWFASTINT_MAX`.
  - Add the ctx re-entrancy line to the contract in README, llms.txt and the
    source header.
  - T4 gains a full `drawFastInt` sweep with `String(Math.trunc(v))` as the
    oracle. T6 gains a `drawFastInt` window. T9 gains the re-entrancy control.
  - README, llms.txt, d.ts.

HOT PATH
  A new hot body, and a cheaper one than `drawFast` -- one fewer glyph, no
  decimal arithmetic, no `Math.round(value * 10)`. It must be measurably faster
  per rendered digit than `drawFast`; if it is not, something was copied that
  should not have been. Record both numbers.

  `drawFast` itself must be diff-clean. Do not "share" the digit loop by
  extracting a helper that both call: an extracted helper is a call frame on
  two hot paths to save twelve lines of source, and this package's law is bytes
  in a hot body, not fewer lines in a file. Duplicate the loop, comment both
  copies with each other's location, and let the T9 control catch a divergence.

ASSERTIONS
  - `drawFastInt(ctx, 120, 0, 0)` renders exactly "120" -- 3 calls, no '.'.
    `drawFast(ctx, 120, 0, 0)` still renders "120.0" -- 5 calls. Both pinned.
  - Sweep: 0, 1, 9, 10, 99, 100, 2^31, 2^53 - 1, MAX_SAFE_INTEGER,
    MAX_SAFE_INTEGER + 1, 1e21, MAX_VALUE, NaN, +/-Infinity, -1, -0, 0.4, 0.5,
    1.9. Every accepted value matches `String(Math.trunc(v))` exactly; every
    rejected value gives `ctx.total === 0`. Decide and pin whether 1.9 renders
    "1" or "2" -- truncation or rounding -- and say which in the docs.
  - The whole tier completes in under 5 seconds (the F-01 clock, applied to the
    new method before it can regress).
  - `_charScratch.byteLength === 24` after a 200k-op mixed
    `drawFast`/`drawFastInt` window; `maxArrayBuffersGrowth: 0`;
    `measureAllocs` `maxBytesPerCall: 0`.
  - Alternating `drawFast` and `drawFastInt` 100,000 times produces the same
    per-call output as calling each in isolation -- the shared scratch is
    proven safe by exercise, not by argument.
  - T9 re-entrancy control: a ctx whose `drawImage` calls back into
    `drawFastInt` corrupts the output, and the control asserts it does. If it
    does not, the contract line is decorative and should be deleted rather than
    believed.
  - `git diff BitmapFont.js` shows zero change inside `drawFast`.
  - `npm run torture` prints "ok".

NON-GOALS
  No thousands separators, no padding, no radix option, no sign rendering.
  Negatives clamp to 0 exactly as `drawFast` does today; changing that is a
  different decision and it is not this one.

DONE WHEN
  drawFastInt matches String(Math.trunc(v)) across the sweep;
  0 bytes/call under measureAllocs; the shared-scratch contract is documented
  and its violation is a passing control; drawFast diff-clean
```

===============================================================================
# M2a -- lite-bmfont v1.6.0 -- the layout buffer's lineWidth scale (F-45)
===============================================================================

```markdown
---
package: "@zakkster/lite-bmfont"
version_target: 1.6.0
status: done           # shipped 2026-08-19 (published); 120 tests (118 pass, 0
                       # fail, 2 todo), torture ok. F-45 closed; F-46 opened by
                       # the post-release sweep. Raised by the
                       # @zakkster/lite-text-layout TL5 session, which could not
                       # start against bmfont 1.5.0. Scheduled AHEAD of M8b
                       # because it blocks a peer package; M8b moved to 1.7.0.
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
peers: ["@zakkster/lite-gc-profiler", "@zakkster/lite-leak", "@zakkster/lite-text-layout"]
findings: [F-45]
depends_on: [M2]       # M2 established the layout-buffer contract this corrects
blocks: ["lite-text-layout TL5", M9]
---

# lite-bmfont -- two packages shipped contradictory contracts for one float

THE DEFECT
  See the F-45 row. `drawWrapped` multiplies the buffer's `lineWidth` by `scale`
  to compare against `boxWidth`; the producer already baked `scale` into that
  float, and `boxWidth` is already rendered px. Centre/right alignment is off by
  `lineWidth * (scale - 1) / 2` and `lineWidth * (scale - 1)` respectively.
  Reproduced by the coordinator at 0.5x, 1x and 2x: every delta matches the
  closed form exactly, and at 1x the error is identically zero.

THE DECISION (write decisions/0006-layout-buffer-scale.md BEFORE any code)
  A. lineWidth@render-scale -- adopt the producer's contract, drop the `* scale`.
  B. lineWidth@scale1 -- keep bmfont's Law, make lite-text-layout stop scaling.

  RECOMMENDED: A. Three reasons, in weight order.
  1. lite-text-layout's buffer is INTRINSICALLY scale-specific: `computeWrap`
     takes `scale` and bakes the line-BREAK positions at that scale, so the
     buffer already describes "the layout at scale S" and cannot be re-rendered
     at another scale correctly. Storing `lineWidth` at that same scale is the
     only coherent choice. bmfont's "one buffer, any render scale" model never
     actually worked against this producer.
  2. The producer's contract is drift-guarded and pinned byte-identical across
     four surfaces (TextLayout.js:289). bmfont's is a single Law line that also
     carries a factually wrong claim about the peer.
  3. lite-text-layout is the canonical producer; bmfont is the consumer that
     documented a mismatched assumption.

  B's cost is the reason it is rejected, and the rejection must be written down:
  B breaks a shipped, drift-guarded contract in another package to preserve an
  unshipped assumption in this one.

WHY MINOR AND NOT PATCH (ratify; do not inherit)
  M4a shipped a behaviour change as a PATCH (1.4.1) because it only altered
  inputs that were already broken. This is NOT that. Under A, a caller who
  hand-rolled a scale-1-width buffer and used centre/right align at scale != 1
  was getting CORRECT output under bmfont's documented contract and will now
  regress. That population is out-of-contract only if you accept that the
  canonical producer is broken today -- which it is, so nobody pairing
  text-layout with bmfont at scale != 1 is getting correct pixels. Minor, with a
  loud `Changed (behaviour)` row. Folding into M9/2.0.0 is the clean
  alternative and is REJECTED here for one reason only: TL5 would wait for the
  major.

TASKS
  - decisions/0006-layout-buffer-scale.md first: convention A, B's rejection,
    the semver ruling, the closed-form error, AND the no-published-devDependency
    ruling with the two-lane test design (the dev cycle is the reason).
  - BitmapFont.js:1122-1125 -- drop `* scale` on both align terms. Rewrite the
    comment: `lineWidth` arrives at the RENDERED scale per the lite-text-layout
    contract, `boxWidth` is rendered px, compare directly. Add a
    DO-NOT-REINTRODUCE note in the M2/M4 house style so the next editor cannot
    "restore symmetry".
  - Correct the Law, ROADMAP section 3 item 1: `lineWidth@scale1` ->
    `lineWidth@render-scale`, and repair the false "emits exactly that shape".
  - Reconcile the doc set: BitmapFont.d.ts, README.md, llms.txt and the
    drawWrapped doc block. `grep -rniE "scale ?1|lineWidth" BitmapFont.d.ts
    README.md llms.txt` -- none may still claim scale-1.
  - test/torture/t2-layout.mjs -- a drawWrapped align matrix at scale != 1, AND
    WIRED INTO THE TIER MANIFEST. An unwired lane passes by not running; that is
    this repo's standing vacuity trap.
  - Generate and commit lane 1's frozen fixture (buffers + producer version
    stamp), and add lane 2's optional-resolve guard. package.json devDeps are
    NOT touched.
  - CHANGELOG `Changed (behaviour)` with the closed form, before/after pixels at
    scale 2, and the semver rationale.

HOT PATH
  Pure deletion on the per-line align path: two fewer multiplies per aligned
  line, zero per glyph. The glyph loop is untouched -- diff it to prove
  byte-identity. No new allocation, no new parameter, no arity change.

ASSERTIONS (each watched RED before the fix and GREEN after)
  1. THE DETECTOR. One-line layout `[0, n, W, 0]`, `align = 1`, `scale = 2`:
     the first glyph's dst x equals the `draw(ctx, text, x, y, 2, 1)` oracle.
     RED today by exactly `-W * (scale - 1) / 2`. Repeat for `align = 2`.
     Measured today: scale 2 align 1 -> 20 vs oracle 60; align 2 -> 40 vs 120.
  2. NO REGRESSION AT UNITY. Every existing scale = 1 align row in
     t2-layout.mjs and BitmapFont.test.js stays green UNCHANGED. The fix is a
     no-op at scale 1 by construction and this is what proves it.
  3. END TO END, THE REAL TL-25 KILL -- TWO LANES, see TEST WIRING below.
     A wrapped paragraph laid out by `computeWrap` and drawn through
     `drawWrapped` at scale 0.5, 1 and 2, centre and right align, is
     pixel-identical to per-line `draw(ctx, text.slice(startIdx, endIdx), ...)`.
     This is TL5's assertion proven from the bmfont side. MEASURED TODAY on the
     real pairing (bmfont 1.5.0 + text-layout 1.2.2, advance-10 font,
     'AAA BBB CCC DDD', boxWidth 200, centre): scale 1 identical (12 glyphs);
     scale 0.5 first glyph 81 vs oracle 63; scale 2 first glyph **-40** vs
     oracle 30 -- centre-aligned wrapped text at 2x starts OFF THE LEFT EDGE.

TEST WIRING -- NO PUBLISHED devDependency (ratified; the cycle is real)
  `@zakkster/lite-text-layout` already devDeps `@zakkster/lite-bmfont` (^1.2.3).
  Adding the reverse edge to bmfont's package.json makes the dev cycle explicit
  and lets a version-floor bump on either side deadlock the other's CI. bmfont's
  devDeps stay exactly `lite-gc-profiler` + `lite-leak`. Assertion 3 runs as two
  lanes instead:

  LANE 1 -- FROZEN FIXTURE, ALWAYS RUNS. Commit the exact `Float32Array` rows
  `computeWrap` emits for the test paragraphs at 0.5, 1 and 2, together with the
  producer VERSION that generated them (1.2.2). No dependency, deterministic,
  runs in CI forever. This lane is what proves bmfont renders correctly against
  what the producer actually emits.

  LANE 2 -- LIVE, RUNS ONLY WHEN THE PEER IS LOCALLY WIRED. Resolve
  `@zakkster/lite-text-layout` (a local symlink into node_modules, or an npm
  link -- never a package.json entry). Regenerate the buffers with the real
  `computeWrap` and assert they are BYTE-IDENTICAL to lane 1's fixture.
  - Buffers differ  -> the producer's contract moved and the fixture is stale.
    DIE, loudly, naming both versions. This is the whole point of lane 2.
  - Peer not resolvable -> print a TODO line in the T8 style naming exactly what
    did not run. **A silent skip is forbidden**: an unwired lane that passes by
    not running is this repo's standing vacuity trap, and the fixture it guards
    is precisely the thing that rots without it.

  The frozen fixture is a mockup with a provenance stamp, not a guess: it is
  generated BY the producer, and lane 2 is the drift guard that keeps it honest.
  4. NON-VACUITY. Revert the fix in a SANDBOX COPY -> assertions 1 and 3 go RED
     and torture exits non-zero. A green never watched go red is not evidence.
  5. torture prints exactly `ok`; every existing control still exits non-zero.

NON-GOALS
  - No drawWrapped signature change. Range parameters are M6.
  - No touch to draw/drawFast/measure align math. VERIFIED: `draw` reads no
    buffer `lineWidth` (0 occurrences in its body) because it measures its own
    glyphs, so it has no double-scale. Say so; do not "fix" it.
  - No per-glyph snapping change. X snap stays per line origin (M4 B1).
  - No lite-text-layout edit. Its contract is authoritative here. If a text-side
    change ever proves necessary, that is a text-layout finding, filed there.

DONE WHEN
  A wrapped paragraph from `computeWrap` at scale 0.5, 1 and 2 with centre and
  right align renders through `drawWrapped` pixel-identical to the per-line
  slice oracle; the Law and the whole doc set state `lineWidth@render-scale`
  with no surviving scale-1 claim; the behaviour delta is declared in CHANGELOG;
  npm test 0 fail; torture `ok`. lite-text-layout TL5 is unblocked the moment
  this publishes and text-layout raises its bmfont devDep floor to 1.6.0.
```

===============================================================================
# M2b -- lite-bmfont v1.6.1 -- the ASCII Law gets a gate (F-46)
===============================================================================

```markdown
---
package: "@zakkster/lite-bmfont"
version_target: 1.6.1
status: done           # shipped 2026-08-19 (published, commit fd5aa35); 121
                       # tests (119 pass, 0 fail, 2 todo), torture ok. F-46
                       # CLOSED. Filed by the post-1.6.0 sweep, taken BEFORE
                       # M8b deliberately: M8b rewrites the drawFast comment
                       # block that holds 9 of BitmapFont.js's 10 offenders, so
                       # gating first means M8b authors into an enforced file
                       # instead of being re-edited after.
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
peers: ["@zakkster/lite-gc-profiler", "@zakkster/lite-leak"]
findings: [F-46]
depends_on: []         # touches no executable byte; orders before M8b by
                       # convenience, not by dependency
blocks: []
decision: decisions/0008-ascii-gate.md
---

THE PROBLEM
  See the F-46 row. 75 non-ASCII characters ship in the tarball across three
  files, 1,121 more sit in the unshipped demo, the Law forbids all of them, and
  nothing in `npm test` or the torture run can see any of it. F-47 (the README
  spine) is filed separately and is NOT this session.

THE DECISION (D-1): THE GATE ENUMERATES, IT DOES NOT LIST
  The gate derives its file set from `git ls-files`, never from a literal array
  and never from `package.json` `files[]`. A hardcoded list is precisely the
  F-31 shape -- a structural gate that pins four named arrays and cannot see a
  fifth -- and this package has already been bitten by it once. A new file with
  an em dash in it must redden the gate on the day it is added, with no edit to
  the test. That property is itself an assertion (A4), not a hope.

  Scope is EVERY tracked file, demo included, not just the six in `files[]`.
  The Law says "source", and the demo is source. It is also where 94 percent of
  the characters are.

D-2: FAIL CLOSED WHEN THE ENUMERATION FAILS
  If `git ls-files` errors, returns empty, or the repo is not a git checkout,
  the gate FAILS. It does not skip and it does not pass. An enumerating gate
  that silently enumerates nothing is a gate that always passes, which is worse
  than no gate because it reads as coverage. Same rule the T2 lane-2 drift
  guard follows.

D-3: THE TWO EXCEPTED CODE POINTS ARE ALLOWED AND TESTED
  U+00D7 and U+00B5 pass, by the Law. Neither appears anywhere in the repo
  today, so the allowance is dormant on arrival -- which means a gate written as
  "reject every byte >= 0x80" would pass every assertion about rejection and
  still be wrong. The twin direction is mandatory: a file containing exactly
  those two characters must PASS (A5), or the exception is untested prose.

D-4: PATCH, AND THE PATCH CLAIM IS PROVEN, NOT ASSERTED
  Ships 1.6.1. Comments and prose only. The proof is byte-level: strip comments
  from `BitmapFont.js` before and after the sweep and the two must be
  IDENTICAL (A6). "I only touched comments" is a claim about a diff a reviewer
  reads; this is a claim a command decides. If A6 does not hold, the session is
  not a patch and stops.

D-5: TRANSLITERATE PROSE, DELETE EMOJI
  `--` for U+2014/U+2013, `->` for U+2192, `...` for U+2026, `=`/`-` for the
  demo's U+2550/U+2500 banners, `&middot;` for the demo's two visible U+00B7
  (an HTML entity keeps the source ASCII and the rendered page unchanged). The
  21 README emoji glyphs (24 code points with their 3 U+FE0F variation
  selectors) are DELETED, not transliterated: the blueprint
  `LiteSepforge/README.md` carries none, and so does the peer
  `LiteTextLayout/README.md`. Both measure 0 non-ASCII. Removing the emoji moves
  the headings toward the blueprint; inventing ASCII substitutes would move them
  further away and pre-empt F-47's session with a worse answer.

TASKS
  T00  Record the BEFORE state: the full per-file, per-code-point census, and
       the comment-stripped hash of `BitmapFont.js`. Nothing after this is
       measurable without it.
  T01  Write the gate in `test/packaging.test.js`: `git ls-files` -> read each
       tracked text file -> report every offending file with line, column and
       code point. The failure message must NAME the characters; "non-ASCII
       found" costs the next author ten minutes.
  T02  Run the gate on the untouched tree and watch it FAIL on all four files
       (A1). Non-vacuity is observed here, before any fix, or not at all.
  T03  Sweep `BitmapFont.js` (10), `llms.txt` (9), `README.md` (56).
  T04  Sweep `demo/demo-lite-bmfont.html` (1,121); check the rendered page still
       shows the middot separator.
  T05  Re-run the gate: PASS.
  T06  A6: comment-stripped `BitmapFont.js` byte-identical to the T00 hash.
  T07  Mutation battery in a SANDBOX COPY, never the live tree: A3 (plant one
       U+2014), A4 (add a NEW tracked file carrying one), A5 (U+00D7 and U+00B5
       pass), A7 (break `git ls-files` -> gate fails, does not skip).
  T08  CHANGELOG 1.6.1, version triple, decisions/0008.
  T09  `npm test`, torture, `npm pack --dry-run`. Confirm the live tree is clean
       of every sandbox artefact.

ASSERTIONS
  A1  The gate FAILS on the tree as it stands at T02, naming README.md,
      BitmapFont.js, llms.txt and demo/demo-lite-bmfont.html.
  A2  The gate PASSES after T03-T04.
  A3  One U+2014 planted in any tracked file reddens it. APPLIED, not cited.
  A4  A newly added tracked file carrying one non-ASCII character reddens the
      gate with NO edit to the test. This is the F-31 lesson as an executable.
  A5  A file containing only U+00D7 and U+00B5 PASSES.
  A6  `BitmapFont.js` stripped of comments is byte-identical before and after.
  A7  `git ls-files` made to fail -> the gate FAILS. It never skips.
  A8  `npm test` 0 fail; torture exactly `ok`; `npm pack --dry-run` still 7
      files with no test, fixture, session or decision entry.

NON-GOALS
  The README spine (F-47) -- filed, unscheduled, a different kind of session.
  Any executable change at all. Any change to `test/` content beyond adding the
  gate. Extending the gate to the other ~169 packages in the suite: this
  session proves the gate on one package; propagating it is a suite decision
  and the user's call, not a bmfont task.

DONE WHEN
  `git ls-files` yields zero files containing a byte outside ASCII other than
  U+00D7 and U+00B5; the gate that decides this is in `npm test` and has been
  watched to fail on today's tree, on a planted character, on a newly added
  file, and on a broken enumeration; comment-stripped `BitmapFont.js` is
  unchanged to the byte; CHANGELOG declares 1.6.1 as a docs/comment patch with
  no behaviour row; npm test 0 fail; torture `ok`.
```

===============================================================================
# M8b -- lite-bmfont v1.7.0 -- drawFast's digit extraction (F-23)
===============================================================================

```markdown
---
package: "@zakkster/lite-bmfont"
version_target: 1.7.0  # was 1.6.0; M2a (F-45) took 1.6.0 on 2026-08-19
status: done           # shipped 2026-08-20 (published, commit 32b5304); 121
                       # tests (119 pass, 0 fail, 2 todo), torture ok, one TODO
                       # (T8, M7's). F-23 CLOSED, F-44 CLOSED as MISDIAGNOSED.
                       # decisions/0007 written and shipped. Created 2026-08-18
                       # by M8 (decisions/0005 fork 1). F-23 was the only open S2
                       # in the package; it was re-routed here with its own brief
                       # rather than left as a sentence in a decision doc, which
                       # is how it drifted the first time. Re-baselined onto
                       # fd5aa35 before the coder started (SESSION-M8b.md 0.7,
                       # rows R-1..R-8): two intervening releases had moved the
                       # sha freeze, discharged T20, and invalidated an assertion
                       # twin. Without that pass A12 would have been red before a
                       # line was written.
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
peers: ["@zakkster/lite-gc-profiler"]
findings: [F-23, F-44]  # F-23 RE-ROUTED here from M8 by decisions/0005 fork 1.
                       # P-4 proved drawFastInt shares no arithmetic with drawFast,
                       # only the scratch buffer, so M8 did not reopen drawFast.
                       # F-44 (S2, HeapNumber boxing above 2^31) is routed here by
                       # M8 too: both loops box, this session reopens both, and
                       # the boxing is inseparable from the digit arithmetic. It
                       # forces a reckoning with alloc_bytes_per_op: 0 below --
                       # that budget holds only in the Smi range and M8b must
                       # either derive a Smi-safe path or document the boundary.
depends_on: [M8]       # needs M8's frozen drawFast (the before-side of the fix)
                       # and decisions/0005 (which routes F-23 here)
blocks: [M9]           # 2.0.0 must not ship with the only open S2 still open
---

# lite-bmfont -- drawFast must stop printing digits the value does not have

WHY THIS IS A MINOR, NOT A MAJOR OR A PATCH (decisions/0005 fork 4, ratified)
  M1 shipped the drawFast magnitude door as a PATCH (1.2.2) even though it
  removed output a caller could see, because that class of change -- confined to
  inputs that were already broken -- ships without a major. F-23's two bands sit
  on opposite sides of that line and both land minor-side:
    - Band 1 is CONFORMANCE, not a behaviour change: 8.45 renders "8.5" where the
      exact tenth is "8.4", violating the published "rounded to nearest tenth"
      guarantee. Making it conform is a fix a caller cannot have pinned.
    - Band 2 changes digits the docs already declare "approximate" (llms.txt,
      the .d.ts). A caller cannot pin a value the documentation disowns.
  Unlike M1's patch, this delta lands on in-door values that render TODAY and
  will render DIFFERENTLY, so it earns a MINOR. Both bands ship as declared rows
  under `### Changed (behaviour)` with a before/after value in each row.

PRECONDITION PROBE (run 2026-08-19 by the coordinator, before the planner)
  Every row below was measured against the working tree at 1.5.0 (HEAD 8348bd0),
  npm test 118/0, torture ok. Rows marked FALSIFIED contradict the brief text
  above; the brief is left intact and the correction is stated here.

  P-1  CONFIRMED. All four DONE WHEN "today" values reproduce byte-for-byte from
       drawFast's live digit scheme: 8.45 -> "8.5", 999999.95 -> "1000000.0",
       762638538843020900000 -> "762638538843020800088.0", and
       4858154237736017000 -> "4858154237736017846.0". The six T4 pins are at
       t4-numeric.mjs:219-234 and read as the brief describes (per band: a
       `s === today` leg, an oracle-agreement leg, and a `s !== ex` leg).

  P-2  FALSIFIED. "drawFastInt (M8) is the proven-exact reference for the integer
       digits" holds only for |v| < 2^53. drawFastInt's door is
       DRAWFASTINT_MAX = 9007199254740991, so it REFUSES every band-2 value; its
       `% 10` loop is exact BECAUSE the door guarantees integer-exactness, not
       because the loop is exact in general. Band 2 needs an algorithm
       drawFastInt never had to solve. Copying drawFastInt's loop fixes band 1
       only -- and only if the `value * 10` product is also removed.

  P-3  UNDER-SPECIFIED -- the planner must ratify this as a fork. "The exact
       digits" has two defensible readings above 2^53 and they DISAGREE:
         true-value expansion   762638538843020900000 -> "762638538843020853248.0"
         shortest round-trip    762638538843020900000 -> "762638538843020900000.0"
       T4's `oracleExact` (t4-numeric.mjs:63) already implements the FIRST, and
       DONE WHEN rows 5-6 assert `s === ex` against it, so the roadmap as written
       has already chosen the true-value expansion. State it out loud: after M8b
       a caller who writes 762638538843020900000 sees ...853248.0 on screen, NOT
       the literal they typed. That is exact and it will read as a bug to a human.
       The alternative costs a 17-digit shortest-round-trip search per call.
       Ratify explicitly, in decisions/, with the on-screen consequence quoted.

  P-4  FEASIBLE, MEASURED. Exact band-2 digits are reachable with no BigInt, no
       string, no allocation: decompose v = mant * 2^e (mant < 2^53, e >= 0),
       emit mant's decimal digits, then DOUBLE the decimal digit array e times
       in place. Verified on 300,014 values (14 fixed + a seeded sweep across
       1..21 digits) against oracleExact: 0 mismatches. Bounds measured, not
       assumed: e <= 17 for every v <= DRAWFAST_MAX, so <= 17 doublings of at
       most 22 digits (~374 inner iterations worst case -- a real per-call cost
       at the top of the range, and A11's recorded timing will move there).

  P-5  FEASIBLE, MEASURED. Band 1 needs no multiply-then-round at all:
       f = v - Math.floor(v) is exact; f*8 and f*2 are exact (powers of two);
       Fast2Sum recovers f*10 = s + err exactly (err = b - (s - a)), and the tie
       is broken against err. Verified on 200,012 values (12 fixed + a seeded
       sweep) against oracleExact: 0 mismatches. ~6 flops, zero allocation.

  P-6  F-44 IS FIXABLE BY THE SAME CHANGE, which is what reconciles
       `alloc_bytes_per_op: 0` above. Splitting the mantissa lo = m % 1e7,
       hi = (m - lo) / 1e7 (both exact) keeps EVERY loop variable inside Smi
       range: max intermediate measured 898,871,303 < 2^31. The doubling loop
       operates on Uint8Array digits, never above 19. So the exact scheme is
       zero-alloc at ALL magnitudes -- it does not merely document F-44's
       boundary, it removes it for drawFast. The same hi/lo split removes it
       from drawFastInt. Do NOT let F-44 be closed by documentation alone
       without first disproving this.

       SUPERSEDED 2026-08-19 by M8b, exactly as this row's last sentence
       demanded -- F-44 was NOT closed by documentation, it was DISPROVED by
       measurement. The measurement above stands: the split does keep every
       loop variable Smi (max intermediate 898,871,303 < 2^31), and that is
       why the split shipped. The INFERENCE drawn from it does not. "Zero-alloc
       at ALL magnitudes" and "it removes it for drawFast" are false: old and
       new both measure 15.93 B/call on a 16-digit cycle, and on the OLD code a
       CONSTANT argument already measured ~0 B/call, so the digit loop never
       boxed. The ~16 B/call is the caller boxing the argument at the call
       boundary and no change to this library removes it. Loop-variable
       magnitude (what P-6 measured) and call-boundary boxing (what F-44
       counted) are two different things; P-6 proved the first and was read as
       proving the second. Status: F-44 row `:167`, MISDIAGNOSED. Kept verbatim
       above because a dated probe is evidence, and evidence is not edited when
       it turns out to have been read wrong.

  P-7  CONFIRMED, NO HEADROOM. The exact form of DRAWFAST_MAX is
       "1000000000000000000000.0" = 24 chars, and `_charScratch` is 24 bytes.
       It fits EXACTLY. Any scheme that needs one guard byte does not fit, and
       the do..while's `len < buf.length` backstop is the only thing between a
       mis-sized scheme and a silent truncation.

  P-8  CONFIRMED. Control 17's band-2 exclusion is t9-controls.mjs:414-420 with
       SET at :422-424 topping out at 4503599627370496. The comment already
       names its own removal as an M8b DONE WHEN row.

  P-9  CONFIRMED. The A7 freeze list is SESSION-M8.md:793 and names drawFast
       first, then nine others. M8b drops drawFast from it and keeps the nine.
       Note A8 (SESSION-M8.md:794) pins the SAME six values from the behaviour
       side and A12 (:798) declares T6 window B unmoved BECAUSE drawFast was
       frozen -- all three assertions unfreeze together or the session is
       inconsistent. Track them as one edit, not three.

  P-11 THE SESSION'S REAL RANK-1 RISK, and it is NOT the one the brief names.
       T9 control 9 proves drawFast's magnitude door is load-bearing by REMOVING
       it and requiring the body to HANG (parent kills on a 2s SIGTERM;
       t9-controls.mjs:160-163 dies with "the hang control is vacuous" if the
       body returns). The hang mechanism is written down at
       t9-hang-child.mjs:11-13: "value*10 overflows to Infinity and
       `while (temp > 0)` never ends". M8b DELETES `value * 10`. Measured on the
       candidate shape: with the door stripped, Number.MAX_VALUE decomposes to
       e = 971 and RETURNS -- every loop in the new body is bounded by a finite
       exponent, so no input hangs it. Control 9 therefore goes vacuous and dies
       loudly (correct: it fails closed). M8b must RE-DERIVE control 9, not
       re-anchor a marker: the door's justification changes from "prevents a
       hang" (F-01) to "prevents silent scratch truncation". decisions/0001 and
       the F-01 row both state the hang rationale and both go stale.
       The BOUND marker at t9-hang-child.mjs:56-58 is a SYMPTOM of this, not the
       disease -- and note :67-70 REWRITES the anchored line, so an assertion
       that only checks boundCount === 1 passes vacuously.

  P-12 THE FULL SOURCE SHAPE IS VALIDATED, AND IT NEEDS NO NEW INSTANCE FIELD.
       Regime A (v < 2^53) = Fast2Sum tenth + hi/lo Smi split. Regime B
       (v >= 2^53) = mantissa by halving, digits by hi/lo Smi split, then
       in-place decimal doubling ON THE CHAR CODES already in `_charScratch`
       ((buf[k] - 48) * 2 + carry). No second array, so the CONSTRUCTOR stays
       byte-frozen and A7 keeps nine of its ten entries untouched. Verified end
       to end against oracleExact on 400,023 values spanning both regimes and
       their boundary: 0 mismatches, max scratch use 24/24 bytes (it fills the
       buffer exactly at DRAWFAST_MAX -- no headroom, as P-7 warned), max Smi
       loop variable 900,719,925, max 17 doublings.

  P-10 OUT OF SCOPE BUT OPEN. BitmapFont.js carries 11 non-ASCII characters
       (10x U+2014 em dash, 1x U+2026 ellipsis) at lines 1, 761, 983, 986,
       988-991, 1018, 1069 -- all inside comments. The suite Law allows only
       U+00D7 and U+00B5. Line 761 sits in drawFast's JSDoc, which M8b reopens
       anyway. Flag it; do not let it expand the diff beyond those characters.

THE FIX
  Replace drawFast's `Math.round(value * 10)` / `Math.floor(scaled / 10)` digit
  extraction with an exact scheme (the approach drawFastInt already uses for the
  integer part, extended to the one decimal place). The multiply is the entire
  defect: band 1 is Math.round on a float PRODUCT rather than the real value;
  band 2 is `value * 10` overflowing the 53-bit significand. drawFastInt (M8) is
  the proven-exact reference for the integer digits.

DONE WHEN (the six M8 T4 pins INVERT -- they pin the DEFECT today; M8b flips each)
  1. drawFast(ctx, 8.45, 0, 0)          -> "8.4"  (today "8.5"; band 1)
  2. drawFast(ctx, 999999.95, 0, 0)     -> the exact tenth (today "1000000.0")
  3. drawFast(ctx, 762638538843020900000, 0, 0) -> the exact digits
                                            (today "762638538843020800088.0"; band 2)
  4. drawFast(ctx, 4858154237736017000, 0, 0)   -> the exact digits
                                            (today "4858154237736017846.0"; band 2)
  5-6. the two T4 `check(s !== ex, ...)` legs (band 1 and band 2) now assert
     `s === ex` -- the library output EQUALS the bit-exact oracle. Rewrite the
     pin messages from "re-routed fix ... landed early? re-open the pin" to the
     positive conformance assertion.
  Also: t9-controls.mjs control 17's set extends UP to DRAWFAST_MAX (the band-2
     exclusion comment is removed, since drawFast is exact everywhere after M8b).
  And: drawFast's body sha is NO LONGER frozen against 1a962c5 -- update the M8
     A7 freeze list to drop drawFast (the other nine bodies stay frozen).
  npm test 0 fail; node --expose-gc test/torture.mjs prints "ok"; both bands as
  `### Changed (behaviour)` rows in CHANGELOG 1.6.0 with before/after values.
```

===============================================================================
# M9pre -- lite-bmfont -- the gate witnesses (UNRELEASED)
===============================================================================

```markdown
---
package: "@zakkster/lite-bmfont"
version_target: none         # UNRELEASED, RECOMMENDED. Zero shipped-byte delta:
                             # files[] excludes test/, so a tarball would differ
                             # from 1.9.0 only in package.json, BitmapFont.js's
                             # VERSION const and CHANGELOG.md, and every runtime
                             # byte a consumer executes would be identical.
                             # Folded into 2.0.0's CHANGELOG under Tests/gate.
                             # IF THE USER PREFERS A RELEASE it is 1.9.1 and the
                             # only extra edits are package.json, the VERSION
                             # const, the CHANGELOG heading and
                             # test/packaging.test.js's VERSION pin. A11 stays
                             # green either way -- it extracts METHOD BODIES
                             # only and VERSION is top-level, so a bump moves
                             # no sha. Open decision, recorded not guessed.
status: complete-unreleased  # WORK COMPLETE 2026-08-21. Pipeline: planner ->
                             # coder -> reviewer (REJECTED, 2 blockers, both
                             # false-RED paths) -> coder -> reviewer (APPROVED,
                             # 2 nits, both closed) -> qa (PASS). Gate green:
                             # npm test 137/136/0/1, torture ok exit 0, ZERO
                             # TODO, BREAK exit 1, A11's ten shas frozen,
                             # BitmapFont.js 0 lines changed. NOT RELEASED --
                             # see version_target above; the publish-or-land
                             # decision is the user's and is open.
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
peers: ["@zakkster/lite-gc-profiler", "@zakkster/lite-leak"]
findings: [F-26, F-27, F-31, F-32, F-37, F-40]   # F-40 DOCS HALF ONLY
depends_on: [M5]
blocks: [M9]
baseline_commit: c030089
---

# lite-bmfont -- repair the instrument before the only session allowed to move a hot body uses it

WHY THIS IS A SESSION AND NOT A CHAPTER OF M9
  M9's own rule is "if option C's shift costs more than 2% on `_measureRange`,
  that is a FINDING". That rule is a MEASUREMENT and the instrument is T6.
  F-31, F-32 and F-37 each say the instrument is blind in a specific way.

  An instrument repaired in the same commit as the subject it measures cannot
  adjudicate that subject: a RED result has two candidate causes -- the format
  change regressed, or the new lane is mis-calibrated -- and a GREEN result has
  none that can be trusted, because the lane that would have caught the
  regression was authored in the same commit by the same hand. That is
  F-31/F-32/F-37 reproduced at the session level.

  Second, independent reason: the gate rebuild's own calibration is a
  measurement with an unknown answer. `VOL_MAX` (1,000,000) was calibrated for
  measure-family bodies that emit no `drawImage`; windows A/C/C2 drive 62/64/64
  recording `drawImage` calls per op, and the file already needed
  `VOL16_MAX = 4,750,000` and `REGB_MAX = 15,000,000` for windows whose
  correct-code floors were 3.19 MB and ~6.2 MB. Having the "what is this
  window's floor" conversation while 20 hot-body sites are half-converted is
  how a threshold gets tuned quietly -- the exact phrase `t6-alloc.mjs:115`
  uses to explain why its own margin is stated out loud.

THE ONE RULE
  ZERO SHIPPED-BYTE DELTA. `BitmapFont.js` is not opened -- not for a comment,
  not for the stale `_measureRange:76` cross-reference at `:728` (real, and
  deferred to 2.0.0 for exactly this reason). The proof is A11: its ten
  method-body sha256s come out unchanged from their 1.8.0 pins.

TASKS
  Full text in `SESSION-M9pre.md` section 3. In brief:
  - F-27: track the FONT in T7, not a throwaway `{cycle: c}`; untrack only
    after `destroy()` is observed; read `size()` after `gc()` + settle. AND
    correct `t7-soak.mjs:13-16`, whose false constraint produced the bug.
  - F-31: add a `Reflect.ownKeys` typed-array sum asserted `=== 134712`,
    RETAINING the four named equalities (sum localises nothing; parts do).
  - F-37: volume lanes on windows A/B/C/C2/D, each floor MEASURED first, each
    margin stated in-file. Two passes, with each pass's blind spots written
    down. No limit copied by analogy.
  - F-32: new window K driving all 13 enumerated reject-branch doors.
  - F-26: KEEP all three reshaped guards + a source-text pin. See below.
  - F-40 docs half: amend `decisions/0004` and `SESSION-M4.md`, leaving the
    superseded text verbatim under a dated marker.
  - F-19: CLOSE on sight. 0 non-ASCII in all six shipped files.
  - `decisions/0011-gate-witnesses.md`, all eight forks.

THREE CORRECTIONS THIS SESSION MAKES TO ITS OWN FINDING ROWS
  1. **F-26 says TWO reshape sites. There are THREE** -- `BitmapFont.js:732`
     (draw), `:1233` (drawWrapped), `:1360` (layoutGlyphs, added by M5/1.9.0
     after the row was written). And the chosen answer REVERSES the obvious
     one: KEEP, do not delete. Deleting does not remove a guard, it writes the
     NaN-ACCEPTING form back into three hot bodies at zero byte saving --
     `BitmapFont.js:731` already records "Two comparisons before, two after".
     What KEEP costs, recorded as weaker than every other assertion here: these
     three sites will never have a behavioural test, their only gate is a
     source-text pin, and that must never be described as behavioural coverage.
  2. **F-37 clause (ii) has NO REFERENT in this gate.** `harness.mjs:44` reads
     `RULES = { maxMajor: 0, maxPauseMs: 4, maxArrayBuffersGrowth: 0 }` -- there
     has never been a `maxBytesPerOp` key. The vacuity is a property of
     `checkNoGc` IF the rule were added, not a defect present here. Nothing to
     delete; `0011` records why adding it would be inert.
  3. **F-27's prescribed fix contradicted `t7-soak.mjs:13-16`**, which claims
     tracking the font "violates lite-leak's held-value contract". The contract
     (`lite-leak/llms.txt:125-129`) says only that neither `cleanup` nor `tag`
     may close over `target`. It does not forbid tracking the target -- that is
     `track()`'s designed use. The comment is half wrong, and the wrong half is
     what argued for the throwaway target that IS the defect.

TWO NUMBERS FOR ONE MUTANT (re-measure before quoting either)
  The split-`measureWidest` mutant is recorded as **28,042,664 B**
  (`t6-alloc.mjs:112`) and **32,881,040 B** (the F-37 row). 17% apart, both
  tracked, both pre-existing.

NON-GOALS
  No change to any shipped file. No F-08 storage decision. No `measure`
  semantics. No `FORMAT.md` (that is M9's). No prototype freeze.

DONE WHEN
  A11's ten method-body shas unchanged from their 1.8.0 pins; the F-31 total
  asserted at 134712 with the four named equalities retained; T7's witness tied
  to font lifetime and its header comment corrected; windows A/B/C/C2/D each
  carrying a volume lane whose floor was measured on this host with its margin
  stated in-file; window K driving all 13 doors; `decisions/0011` written;
  `decisions/0004` amended; A1-A5 each applied in a sandbox and watched go red,
  with A2 recorded GREEN-BEFORE and RED-AFTER.
```

===============================================================================
# M9 -- lite-bmfont v2.0.0 -- the breaking consolidation
===============================================================================

```markdown
---
package: "@zakkster/lite-bmfont"
version_target: 2.0.0
status: planned
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
peers: ["@zakkster/lite-gc-profiler", "@zakkster/lite-leak", "@zakkster/lite-text-layout"]
findings: [F-06, F-08, F-09, F-13, F-14, F-40]
                              # SPLIT 2026-08-20 at plan time. F-40 is the
                              # BEHAVIOUR half only (the scale-magnitude bound,
                              # which needs F-08 to settle what an advance can
                              # be); its DOCS half is M9pre's. F-19 CLOSED on
                              # sight -- M2b (1.6.1) discharged it and all six
                              # shipped files measure 0 non-ASCII. The five GATE
                              # findings F-26/F-27/F-31/F-32/F-37 moved to
                              # M9pre. An audit on 2026-08-20 found seven rows
                              # carrying "routed to M9" in their BODIES that had
                              # never been in this list; the frontmatter and the
                              # rows had disagreed for eight releases.
depends_on: [M4, M7, M8, M8b, M9pre]
                                # M6 REMOVED 2026-08-20: superseded, not shipped
                                # (see THE CUT in its brief). M9pre ADDED the
                                # same day: the instrument that must adjudicate
                                # this session's 2%-on-_measureRange rule is the
                                # one F-31/F-32/F-37 say is blind. M4 1.4.0,
                                # M7 1.8.0, M8 1.5.0, M8b 1.7.0 all shipped.
---

# lite-bmfont -- collect every breaking change into one major

WHY A 2.0.0 IS WARRANTED (argue it before doing it)
  Most of this roadmap ships as patches and minors, and that is correct: a call
  that used to hang and now returns has no working call site to break, and a
  descriptor that used to construct a font rendering nothing but now throws has
  no working call site either. Those are bug fixes, they ship early, and their
  CHANGELOG entries say "Changed (behaviour)" so nobody has to guess.

  Four things left over are genuinely breaking, and every one of them changes a
  number a working call site reads:

  1. **`measure()` returning the widest line instead of the cross-newline sum**
     (F-06). A caller measuring `'AA\nAA'` gets 16 where they got 32. Nothing
     throws. Silent numeric changes are the most expensive kind, and they are
     precisely what a major exists to announce.
  2. **Sub-pixel advances** (F-08). Fixing the truncation changes the output of
     `measure()` and the position of every glyph after the first, for every font
     with a fractional `xadvance`. That is every font produced by several real
     exporters.
  3. **Checked mode on by default** (M3's option C, promoted). Descriptors that
     construct today with a lossy warning start throwing. That is the whole
     point, and it is breaking.
  4. **`Object.freeze(BitmapFont.prototype)`** (F-14). Anyone monkey-patching a
     method -- and monkey-patching a renderer method is a real, if unwise,
     pattern -- stops working.

  Four breaking changes dribbled across four minors is four migrations. One
  major with one migration note is one. That is the argument.

THE DECISION (record it before coding)
  Sub-pixel advances (F-08). The glyph table is `Int16Array`, stride 7, and the
  README publishes `font.glyphs[id * 7 + 6]` as a supported read, so this is a
  format change in public.
  A. **KEEP Int16, DOCUMENT THE TRUNCATION.** Free. Drift stays at up to 0.5px
     per glyph -- 24px across a 40-glyph line with `xadvance: 8.6`. For a pixel
     font this is invisible; for a scaled or anti-aliased atlas it is a
     visibly wrong line length.
  B. **A PARALLEL `Float32Array(256)` FOR ADVANCES.** Exact. 1 KB per font.
     One extra typed-array load in the innermost loop of all four hot bodies,
     from a second cache line. This is the option that costs bytes in a hot
     body, and it must be measured before it is chosen, not after.
  C. **1/16-PIXEL FIXED POINT IN THE EXISTING SLOT.** Store
     `Math.round(xadvance * 16)` in slot 6 and shift right by 4 at read.
     Zero extra memory, zero extra loads, one shift per glyph. Error drops from
     0.6px/glyph to 0.025px/glyph -- 24px to 1px across 40 glyphs. Range: the
     advance slot then tops out at 2047.9375px, which is far beyond any real
     advance. **The same trick cannot apply to x/y/width/height** in slots 0-3,
     because those legitimately reach four digits and F-08's 40000 case would
     overflow immediately -- so C changes the meaning of exactly one slot, and
     the kerning LUT alongside it.
  Recommendation: **C**, contingent on the measurement. It is the only option
  that improves accuracy by 24x while adding zero bytes of memory and one
  integer shift per glyph. Its cost is that `font.glyphs[id * 7 + 6]` changes
  meaning for every external reader -- including the layout helper printed in
  this package's own README and llms.txt, and including lite-text-layout. That
  is a cross-package format change, which is exactly what a major is for.
  Ship `FORMAT.md`, a `GLYPH_ADVANCE_SHIFT` constant, an `advanceOf(id)`
  accessor so nobody has to know, and a conformance test that runs from both
  repos.

TASKS
  - Write decisions/**0012**-two-oh.md BEFORE coding, with the four breaking
    changes, the fixed-point measurement, and the migration table.
    NUMBER RE-STAMPED 2026-08-20: the reserved `0009` shipped as
    `0009-atlas-subpath.md` (M7), `0010` as `0010-glyph-quads.md` (M5), and
    `0011` is M9pre's. Fourth consecutive session bitten by a reservation.
  - **FORMAT.md**: the glyph stride and slot meanings including the new fixed
    point, the kerning key derivation, the layout-buffer stride 4 including the
    F-13 flags mask, the quad stride 6, and a `FORMAT_VERSION` constant that
    both this package and lite-text-layout assert.
  - **F-06.** `measure` returns the widest line. `measureWidest` stays as an
    alias so M4-era code keeps working. Add `measureTotalAdvance` if anyone
    actually wants the old number -- and if nobody does, do not add it, and say
    so in the ledger.
  - **F-08 + F-09.** Implement the chosen storage. Kerning amounts go to the
    same fixed point. `advanceOf(id)` and `kernOf(a, b)` accessors so external
    readers stop indexing raw.
  - **F-13.** The flags bitfield becomes real: a validated mask, bit 0 =
    ellipsis, unknown bits rejected. Reserve and document the remaining bits.
  - **F-14.** `Object.freeze(BitmapFont.prototype)`. One line; a renderer's
    method table is a law, not a mutable bag.
  - Checked mode defaults on; the option becomes `{ checked: false }`.
  - Update every doc surface, including the layout helper recipes in README and
    llms.txt, which index `glyphs[id * 7 + 6]` directly and are wrong the
    instant C lands. Grep for `* 7 + 6` across the whole ecosystem, not just
    this repo.
  - Migration section in CHANGELOG under Breaking, with a before/after table per
    change.
  - Three-place version sync **1.9.0** -> 2.0.0 (was written 1.8.0; M5
    shipped 1.9.0 on 2026-08-20).

HOT PATH
  This is the one session permitted to change a hot body's instruction count,
  and it must therefore be the most carefully measured. `assertOps` on **all
  EIGHT bodies that read an advance or a kerning amount** -- `_measureRange`,
  `measure`, `draw`, `drawFast`, `drawFastInt`, `drawWrapped`, `layoutGlyphs`,
  `drawQuads` -- before and after, on the same machine in the same run, with the
  numbers in the decision record and in the README benchmark block stamped with
  version and machine. (Was "all four hot bodies plus `layoutGlyphs`"; written
  before `drawFastInt`, `layoutGlyphs` and `drawQuads` existed.)
  DESIGN NOTE HANDED FORWARD BY M9pre, an untested hypothesis written down so
  the measurement is aimed at the right implementation rather than the naive
  one: every advance/kerning read site already multiplies by `scale`. If the
  1/16 is folded into a per-CALL constant computed once at the top of each body,
  option C costs ZERO extra per-glyph operations and one extra multiply per
  call -- a per-CALL cost, which law 6 prices as cheap, not the per-glyph shift
  this fork assumes. If option C's shift costs more than
  2% on `_measureRange`, that is a finding: write it down and re-open the
  decision rather than shipping a number nobody looked at.

ASSERTIONS
  - `measure('AA\nAA') === 16` and `measure('A\nAAAAAA') === 48` -- the exact
    inversion of the v1.x pinned values, with both old numbers quoted in the
    migration note.
  - With `xadvance: 8.6`: `measure('AA')` is **exactly 17.25** under option C,
    against 16 in v1.x. **ASSERT THE EXACT LITERAL, NOT A TOLERANCE.** Measured
    2026-08-20: the true gap to 17.2 IS 0.05, and "within 0.05" holds only
    because `17.25 - 17.2` evaluates to `0.049999999999997158`. An assertion
    resting on float representation luck is the F-38 shape.
  - Over a 40-glyph line: v1.x drift is **exactly 24.00px** (measured 320 vs an
    exact 344). Option C gives `8.625 * 40 = 345.0` against 344.0 -- an error of
    **exactly -1.0000px, an OVERSHOOT**, where this brief's "<= 1.0px" implied
    an undershoot with margin. `<= 1.0` passes by EQUALITY ALONE; `< 1.0` fails.
    Assert the exact literals, or pick a probe advance that is not boundary-
    exact and state why.
  - The M2 conservation law holds with the oracle now reading fractional
    advances -- the residual that F-08 forced T0 to tolerate is gone, and the
    three-way equality is exact. Delete the tolerance and prove the law tightens.
  - `Object.isFrozen(BitmapFont.prototype)` is true; assigning to
    `BitmapFont.prototype.draw` throws in strict mode.
  - `FORMAT_VERSION` asserted in this package and in lite-text-layout's
    conformance test; both green.
  - Every v1.x test still present, either passing or explicitly migrated with a
    comment naming the breaking change and its decision record. **Named
    migration site inside the gate: `t6-alloc.mjs:298` pins
    `measure(S64) === 744` and flips to `252` under F-06.**
  - `assertOps` on all **eight** bodies recorded against **v1.9.0**.
  - `npm run torture` prints "ok"; every T9 control exits non-zero;
    `BMFONT_TORTURE_BREAK=1 npm run torture` exits non-zero.
  - `npm pack --dry-run` includes FORMAT.md and excludes test/.

NON-GOALS
  No Unicode beyond 8-bit -- see the ledger; it is a different data structure
  and a different package. No SDF/MSDF. No rich text. No 3D. No WebGL backend.
  No change to the layout-buffer stride 4 or the quad stride 6.

DONE WHEN
  FORMAT.md + FORMAT_VERSION shipped and asserted from both repos;
  the four breaking changes each have a before/after migration row;
  the conservation law is exact with no tolerance;
  all five hot bodies measured and recorded; /release 2.0.0 clean
```

---

## 6. How to run it

In order. `status: planned -> shipped` after each `/release`. Author the brief
in the package, then `Use the planner subagent on BRIEF.md`, then coder,
reviewer, qa, then `/release`. Reviewer REJECTED goes back to coder, not
forward.

The budget frontmatter is identical in every brief and never moves. This
package has exactly one identity -- zero allocation per rendered frame -- and
`gc_maxMajor: 0`, `alloc_bytes_per_op: 0` and `leak_cycles: 4096` are that
identity written as numbers. `gc_maxPauseMs: 4` is the frame budget's quarter,
which is the largest pause a 60 fps renderer can absorb without a visible hitch.

Every session's DONE WHEN is a command you can run or an assertion you can name.
None of them is a feeling.

### If you only do a subset

1. **M0 first, regardless.** Everything else in this document leans on one
   command that does not exist. And `npm test` currently exits 127 in a
   published package, which means the suite Law's "no gate output is a FAIL"
   rule has been failing quietly for three minor versions.
2. **M1 today after that.** `drawFast(ctx, Number.MAX_VALUE, 0, 0)` freezes the
   tab, forever, with no stack to catch, in a method whose documented purpose is
   a per-frame HUD counter fed by caller arithmetic. The trigger is one runaway
   accumulator. The fix makes the hot body smaller. Nothing else here has that
   ratio.
3. **M2 is non-negotiable.** One predicate written twice with opposite NaN
   behaviour, and a layout hand-off shape that turns a wrap engine's off-by-one
   into a whole line of invisible draw calls. It blocks both feature sessions
   for a reason.
4. ~~**M2 before M6, always.**~~ **MOOT 2026-08-20 -- M6 was CUT.** The
   argument stands and is worth keeping: M6 would have made `startIdx` a public
   parameter of the most-used method in the package, and F-04 is what a bad
   `startIdx` does. Shipping the API first writes the bug into a cross-package
   contract. The cut is the strongest form of the same conclusion.
5. **M7 is the free win.** It touches no hot body, has a named consumer, closes
   a finding, and is the only session in this document that can be done in
   parallel with anything else.
6. **Do not start M9 until M4, M6, M7 and M8 have all shipped.** A major that
   collects three breaking changes and then discovers a fourth is two majors.
   **SATISFIED 2026-08-20**: M4/M7/M8/M8b shipped, M6 superseded. A cut edge
   counts only because the cut is recorded with its reasoning -- an unscheduled
   session left `planned` would NOT have satisfied this line.

### The rejection ledger

Carried forward from the old roadmap's "Deferred indefinitely" section, with a
reason attached to each, plus the rejections this roadmap generated. A rejection
without a reason gets re-proposed every six months.

| Rejected | Reason |
| --- | --- |
| **Unicode beyond ASCII 0-255** | The 64K kerning LUT (`first << 8 \| second`) is why the package is fast and why it is 1.3 KB. It is structurally 8-bit. Unicode is a different data structure, not an addition -- and it would be a different package, because the memory profile stops being 128 KB flat. |
| **SDF / MSDF atlases** | A different renderer with a different shader contract, not a feature of this one. |
| **Rich text (per-run styling)** | Solvable by the caller once M5 lands: lay out once, draw subsets with different contexts. Shipping it here would duplicate what `drawQuads(first, count)` already gives away. |
| **Vertical metrics (ascent/descent accessors)** | No consumer has asked; `lineHeight` and `base` have covered every case so far. Revisit when a named consumer appears, not before. |
| **A per-glyph callback in `layoutGlyphs`/`drawQuads`** | An indirect call per glyph, and a megamorphic call site the moment two callers pass different closures. The mutable-buffer seam gives the same power with none of the cost. |
| **An options object for range parameters** | One object literal per call per frame -- 72 of them for a HUD plus a paragraph -- in the package whose identity is that drawing does not allocate. |
| **Growing `_charScratch` to fix F-02** | Puts a growth path next to a hot buffer and buys decimal digits that are already floating-point noise above 1e21. The T6 `maxArrayBuffersGrowth: 0` rule exists specifically to catch this fix. |
| **A runtime tinting API** | M7 makes a themed atlas a boot-time cost. Per-frame tinting would be a `globalCompositeOperation` dance in a package that issues exactly one `drawImage` per glyph and nothing else. |
| **DOM in the core module** | tripple's headless tests and every node:test file in this repo import the core. A `typeof document` branch in the core is a dead branch in every Node bundle. |
| **A second ctx shape in the torture harness** | Two hidden classes through `draw`'s single `drawImage` call site makes it polymorphic, and the measurement stops describing a real app. One shape, built once. |
| **`measure()` throwing on an embedded newline** | Hostile to the many callers measuring strings that merely happen to be single-line. M9 changes the return value instead, with a major bump. |
| **Extracting the shared digit loop from `drawFast`/`drawFastInt`** | A call frame on two hot paths to save twelve lines of source. Duplicate, cross-reference in comments, and let a control catch divergence. |

### The habit this roadmap is built around

Every finding in section 2 came from running the code. F-01 was found by a probe
that had to be killed with SIGTERM after six seconds -- there is no amount of
reading that produces that result, and there is no code review that catches
`while (temp > 0)` when `temp` is `Infinity`, because the line looks correct and
is correct for every value anyone would type into a test.

F-03 is the sharpest lesson in the set and it is worth keeping in front of the
reviewer subagent. The package contains the same predicate twice, forty lines
apart, written two different ways. Both look right. Both ARE right for every
value except one. The measure path rejects NaN and the draw path accepts it, and
the disagreement has been shipping since 1.0.0 in a package with 40 tests --
none of which ever passed a NaN through `draw`, because why would you.

Coverage is not the same as exercise. Forty tests, three describes, and not one
of them could execute, which meant nobody noticed that not one of them crossed
a guard with the value the guard exists for. When the reviewer subagent reads a
test, the question is not "does this test the feature" -- it is **"would this
test fail if the feature were broken"**. Every ASSERTIONS block above is written
to be answerable in that form, and every T9 control exists to answer it out
loud.

MIT (c) Zahary Shinikchiev
