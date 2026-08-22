# Changelog

All notable changes to `@zakkster/lite-bmfont`.

## 2.0.2 -- 2026-08-22

A docs + attribution release. No hot body moved; the twelve method SHAs are
unchanged. One shipped runtime byte changes -- an error attribution on a path
that is only reachable when `generateAtlas` is itself broken.

### Changed

- **`generateAtlas` now attributes an INTERNAL bug to itself, not the caller's
  DOM** (F-48). The single `try` in `Atlas.js` spans both the hostile-DOM calls
  and generateAtlas's own pure-JS glyph arithmetic, so a bug in that arithmetic
  used to be re-thrown as `AtlasError { field: 'dom' }` -- a library fault blamed
  on the caller's environment. An `inDom` flag now marks the pure-JS regions, so
  a hostile DOM call still throws `field: 'dom'` while an internal arithmetic bug
  throws `field: 'internal'` with a message that says so. `field: 'internal'` is
  documented in `Atlas.d.ts` and `llms.txt` (both already state the `field`
  values are examples, so this is not breaking). Marking the pure regions rather
  than the DOM regions is the fail-closed direction: an unmarked region defaults
  to `'dom'`, the pre-2.0.2 label, so a real DOM fault can never be mislabeled
  `'internal'`. Covered both directions in `test/findings.test.js`, including a
  throwing property setter, a throwing method, and a fault-injected copy.

### Docs

- **`README.md` rebuilt on the suite blueprint spine** (F-47). Adds the one-line
  tagline, positioning H2 with an inline runnable quick-start, table of contents,
  "What you get", a core-surface deep-dive, a Composability pipeline, a Zero-GC
  design-notes block with an allocation table, "Design decisions worth knowing",
  "What this is not", and "Ecosystem". The per-method API reference keeps one
  backticked heading per export (the T8/A4 contract); constants stay a table. The
  Unicode/emoji half of F-47 was already closed in 1.6.1; no test count is
  published, by the F-43 precedent (`decisions/0014` records the deviation).
- **F-54 diagnosed and NARROWED, not closed by prose** (`decisions/0014`). The
  volume lane's "blind at ~2 strings/frame" mechanism was a MISDIAGNOSIS: the
  score scene's OLD (string-allocating) and NEW bodies separate deterministically
  by ~11 MB (58.4M vs 69.4M, reproducible to the byte). A 10x gate is not
  buildable for it because the NEW body itself carries ~58 MB of its OWN real
  per-frame float garbage (LINEAR in op-count: 233M at 800k, ~291 B/frame -- not
  a working-set artifact), so a small string-garbage delta cannot beat a large
  real float-garbage floor (SNR ~1.19x). Score/stress stay behaviourally +
  source-text covered, for the corrected reason. Single-method torture windows
  floor at ~0, so the twelve volume windows are unaffected.
- **Retraction of a 2.0.1 overclaim (F-55, filed, unscheduled).** The 2.0.1
  entry below says the four demo scene bodies "were rewritten to allocate nothing
  per frame". Measured under op-count scaling, that is FALSE: all four allocate
  real per-frame float garbage (wave 31.5, score 291.5, typewriter 7.4, stress
  62.0 B/frame), from the scenes' OWN float-on-object-field arithmetic, not from
  any library call. What 2.0.1 actually removed is the per-frame STRING garbage
  (substring / padStart / concat) the scenes were built to shed. The honest claim
  is scoped to the library: the LIBRARY draw path is zero-alloc and gated at 0 by
  the torture tier; a JS scene body doing float math on object fields is not, on
  this V8. Recorded, not fixed here (F-55 owns the fix).

## 2.0.1 -- 2026-08-21

No shipped library byte behaviour changed. This is a docs + demo release.

### Docs

- The demo (`demo/demo-lite-bmfont.html`) rendered the words "zero alloc" over a
  frame path that allocated ~42 strings/frame (F-53). The four per-frame scene
  bodies moved to `demo/scenes.mjs` and were rewritten to allocate nothing per
  frame: the wave uses `layoutGlyphs` + per-glyph `drawQuads`, the score draws a
  constant `ZEROS[]` run + `drawFastInt`, the typewriter lays a phrase out once
  and blits a growing prefix, and the stress counter uses `drawFastInt` + a
  constant label. `test/demo.test.js` gates the wave and typewriter scenes on the
  allocation-volume lane and the score scene behaviourally against the old
  padStart output (F-54 records the lane's resolution floor). `demo/` is not in
  `files[]` and ships to nobody; no published library byte moved.
- Removed three stale forward-references from the shipped docs (F-52): the
  "may re-parent this type" speculation in `llms.txt` and `BitmapFont.d.ts`, and
  the "F-08 storage half stays open" scheduling note in `llms.txt`, all of which
  described 2.0.0 as unfinished from inside the 2.0.0 tarball. A packaging gate
  now reddens on a shipped consumer file carrying a roadmap session name or a
  scheduling phrase.

## 2.0.0 -- 2026-08-21

The 1/16 fixed-point advance format, the `measure` semantics flip, checked mode
on by default, the reserved-bit close, a frozen prototype, and a documented
binary format with a version stamp. See `decisions/0012-two-oh.md` (nine forks)
and `FORMAT.md`. The storage format landed in git on 1.9.0 UNRELEASED; this is
its first published version, hence the major bump.

### Breaking

- **`measure` returns the WIDEST line, not the cross-newline sum** (F-06,
  decisions/0012 fork 2). It is now an exact alias of `measureWidest`. A
  newline-free string is UNCHANGED. There is no `measureTotalAdvance`: the old
  cross-newline total had no consumer. For a single explicit range use
  `measureLine`, which still sums (it is the ranged face of the internal walk).

  | call (advance-8 font) | 1.x | 2.0.0 |
  |---|---|---|
  | `measure('ABC')` (no newline) | 24 | 24 (unchanged) |
  | `measure('AA\nAA')` | 32 | 16 |
  | `measure('A\nAAAAAA')` | 56 | 48 |
  | `measureLine('A\nA', 0, 3)` (adv-12 font) | 24 | 24 (unchanged) |

- **Advance and kerning are stored as 1/16 fixed point** (F-08/F-09,
  decisions/0012 fork 1, C-folded): `Math.round(value * 16)`, read back as
  `stored * GLYPH_ADVANCE_SCALE`. A fractional `xadvance` such as `8.6` is now
  preserved to 1/16px (`advanceOf(id) === 8.625`) where 1.x truncated it to `8`
  and lost 24px over a 40-glyph line. Worst-case rounding error improves from
  0.5px to 0.03125px (16x). Slots 0-5 (`x/y/width/height/xoffset/yoffset`) stay
  raw Int16.

- **`checked` defaults to `true`** (decisions/0012 fork 6). The opt-out is
  `{ checked: false }`. Under the new format a DECLARED 1/16 resolution does not
  throw on the values it is designed to round: slot 6 and kerning `amount` are
  validated by a RANGE test only, `[-2048, 2047.9375]` -- the integrality test is
  retired for that slot. Slots 0-5 keep their Int16 range + integrality test.

- **`BitmapFont.prototype` is FROZEN** (F-14, decisions/0012 fork 5), and the
  break is WIDER than "no monkey-patching". Freezing a prototype makes its
  inherited methods non-writable, and assignment-shadowing on an INSTANCE
  resolves through that same writable flag -- so **both** of these now throw in
  strict mode:

  | operation | 1.x | 2.0.0 |
  |---|---|---|
  | `BitmapFont.prototype.draw = fn` (shared patch) | works | **throws `TypeError`** |
  | `font.draw = fn` (per-instance shadow) | works | **throws `TypeError`** |
  | `class Sub extends BitmapFont { draw() {} }` | works | works (unchanged) |
  | `Object.defineProperty(font, 'draw', { value: fn })` | works | works (unchanged) |
  | `font.anyOwnField = x` | works | works (unchanged) |

  If you shadowed a method on an instance -- which needed no knowledge of the
  prototype and so may have been done inadvertently -- **migrate to subclassing**,
  or to `Object.defineProperty` on the instance if you must patch in place. Own
  data fields on instances are unaffected. The per-instance case was NOT
  anticipated when fork 5 was ratified; it was measured during implementation and
  the fork carries the full radius.

- **A reserved layout-flags bit now throws under `checked`** (F-13/F-49,
  decisions/0012 fork 4). Bit 0 is the ellipsis flag; bits 1-31 are RESERVED and
  a set reserved bit is a caller error. In 1.x an odd `flags` value took the
  ellipsis path and never reached the unknown-bit test, so `flags = 3` was
  silently accepted; it now throws.

### Added

- `FORMAT_VERSION` (currently `2`) and a `FORMAT.md` describing the glyph stride
  (7), the seven slot meanings including slot 6's fixed point, the kerning key
  `(first << 8) | second`, the layout-buffer 4-tuple with its flags mask and
  reserved bits, and the quad stride (6). A persisting/exchanging peer pins the
  stamp and fails closed when it moves (decisions/0012 fork 8).

## 1.9.0 -- 2026-08-20

Glyph quads: two additive methods and one new export split `draw`'s single loop
so callers can animate, cull or batch individual letters. `draw` itself is NOT
touched -- its body sha is frozen and unchanged.

- `layoutGlyphs(text, outBuffer, x, y, scale = 1.0, align = 0) -> number` fills a
  caller-owned buffer with one stride-`GLYPH_STRIDE` record per VISIBLE glyph --
  `[sx, sy, sw, sh, dx, dy]` -- and returns the record count. It reproduces
  `draw`'s arithmetic EXACTLY (same per-line-origin/per-baseline `Math.round`
  snap, same NaN-safe id gate, same `gw > 0 && gh > 0` gate). `dx`/`dy` are
  ABSOLUTE with `scale` folded in; `sw`/`sh` are the UNSCALED source dims.
- `drawQuads(ctx, buffer, first, count, offX = 0, offY = 0, scale = 1.0) -> void`
  blits a contiguous range of that buffer, one `drawImage` each. `offX`/`offY`
  are added RAW; `scale` sizes only the source dims and must equal the layout
  scale. `first`/`count` are CLAMPED (NaN/negative/fractional) and a range past
  the buffer THROWS a plain `RangeError` (fork 10) -- one check per call, zero per
  glyph. Drawing past the count `layoutGlyphs` RETURNED (but within the buffer) is
  a documented caller hazard, not a guarded case.
- `GLYPH_STRIDE = 6` is exported. Size a buffer with the safe upper bound
  `text.length * GLYPH_STRIDE` -- the exact record count is not derivable in
  advance (spaces and out-of-range ids advance the cursor and emit no record).

`outBuffer` is a `Float64Array` or a plain `Array`, never a `Float32Array` (which
rounds the double cursor and breaks round-trip identity with `draw`). A short
buffer throws a plain `RangeError` per emitted record (NOT `BitmapFontError`); a
non-string `text` or a `scale` outside `(0, Infinity)` returns `NaN`. Decision
record: `decisions/0010-glyph-quads.md`.

Tests/docs: `test/findings.test.js`'s demo-import pin was corrected to match the
demo, which already imports the BARE CDN file path
`https://cdn.jsdelivr.net/npm/@zakkster/lite-bmfont/Atlas.js`. The demo itself did
not change this release -- it was set to the bare path in 1.8.0's commit; only the
test pin (which still expected the old `/+esm` spelling) caught up here. `/+esm` is
jsDelivr's CommonJS-to-ESM transform and `Atlas.js` is already zero-dependency
ESM, so the suffix converted nothing. A dated correction is appended to
`decisions/0009-atlas-subpath.md`.

## 1.8.0 -- 2026-08-20

The atlas generator ships as a subpath export. `generateAtlas` -- previously
duplicated inline in the demo -- is now `@zakkster/lite-bmfont/atlas` (`Atlas.js`
+ `Atlas.d.ts`). F-18 closes. The core `BitmapFont.js` changes exactly one line
(the `VERSION` literal): no draw or measure body moves. Decision record:
`decisions/0009-atlas-subpath.md`.

`generateAtlas` is the package's ONE allocating function -- a boot-time COLD path
(one canvas + one descriptor + ~95 char entries per call), called once per theme,
labelled COLD in every doc surface and NOT precedent for allocating elsewhere. It
fails closed with a named `AtlasError`, never a bare `Error`/`TypeError`: a
missing DOM, a null `getContext('2d')`, OR a hostile `document` whose
`createElement`/`getContext`/`measureText`/`fillText` throws are all re-thrown as
`AtlasError` (carrying the original). A non-integer or out-of-range `size` (must
be an integer in `[4, 512]`) throws rather than being normalized -- `size` feeds
`common.base`, which `{ checked: true }` rejects; the lower bound 4 is derived
from `cellH - 4 >= 1` (below it, glyph heights go non-positive).

Note (publish window, 2026-08-20): the demo's `Atlas.js/+esm` CDN import 404s
until 1.8.0 is published; the demo starts working the moment it is live.

### Added

- `@zakkster/lite-bmfont/atlas` subpath: `generateAtlas(size, fontCSS, fillColor, shadowColor?) -> { atlas, json }` and the `AtlasError` class.
- T8 (packaging / docs-drift) torture tier filled: pack-contents check, a
  DOM-free import of both entry points through the `exports` map in a clean
  child, and a docs-drift guard that enumerates `BitmapFont.prototype` at runtime
  and requires every method in `llms.txt` and `README.md`, both directions.

### Closed (findings)

- F-18: the duplicated demo helper is now a shipped, tested utility.

## 1.7.0 -- 2026-08-19

`drawFast` renders exact digits at every magnitude. F-23 (inexact digit
extraction, both bands) is fixed. F-44 (the alleged Smi-cliff boxing) closes as a
MISDIAGNOSIS -- its stated mechanism was wrong, see below. Decision record:
`decisions/0007-drawfast-exact-digits.md`.

The tenth now comes from a Fast2Sum recovery of `f * 10` instead of a
`Math.round(value * 10)` product, and integers at or above 2^53 are rendered by
emitting the mantissa's digits and doubling them in place -- so the digits are
the exact value of the double, computed without a float multiply. Validated end
to end against a BigInt oracle on 400,023 values spanning both regimes and their
boundary: 0 mismatches, the 24-byte scratch filling to exactly 24 of 24 at
`DRAWFAST_MAX`.

### Changed (behaviour)
- **`drawFast` decimal rounding is now exact at a tenth-tie.** Near a half-tenth
  the old `value * 10` product rounded the wrong way; the Fast2Sum tenth does
  not. `drawFast(ctx, 8.45, ...)` renders `"8.4"` (was `"8.5"`);
  `drawFast(ctx, 999999.95, ...)` renders `"999999.9"` (was `"1000000.0"`). This
  makes the published "rounded to nearest tenth" guarantee hold; a caller cannot
  have pinned the old off-by-one-tenth.
- **`drawFast` integer digits above 2^53 are now the exact value of the double.**
  `drawFast(ctx, 762638538843020900000, ...)` renders `"762638538843020853248.0"`
  (was `"762638538843020800088.0"`); `drawFast(ctx, 4858154237736017000, ...)`
  renders `"4858154237736016896.0"` (was `"4858154237736017846.0"`). Note the
  consequence: a caller who writes the literal `762638538843020900000` now sees
  the digits of the double that literal actually became, not the literal typed --
  exact, but not the shortest round-trip. The docs previously disowned these
  digits as approximate.

### Fixed
- **F-23 (inexact digit extraction), both bands.** See above; re-routed here by
  `decisions/0005` fork 1.

### Corrected (finding attribution)
- **F-44 was a misdiagnosis, not a boxing bug this release removes.** F-44
  claimed `drawFast`/`drawFastInt` boxed a HeapNumber *inside* the digit loop
  (`temp % 10`, `Math.floor(temp / 10)`) above 2^31, at ~16 B/call. Measured old
  vs new: **15.93 B/call before, 15.93 B/call after** on a 16-digit cycle -- the
  split changed nothing observable. The ~16 B/call is the CALLER boxing the
  argument at the call boundary (every double above 2^31 is boxed to be passed);
  it is caller-side, identical before and after, and removable by no change to
  this library. On the OLD code a constant argument already measured ~0 B/call,
  so the digit loop never boxed. The hi/lo split is KEPT for two real reasons --
  source-level Smi discipline that also holds in the pre-warmup Ignition tier the
  optimized-tier gates cannot see, and the throughput Smi-knee of
  `decisions/0005` section 0.4b -- but neither is an allocation fix.
- `drawFast`'s regime-B path gains a T6 allocation window (window H) that gates
  gross per-call allocation (a BigInt-doubling mutant measures ~40.8 MB vs a
  ~6.2 MB shipped transient floor and is rejected).

## 1.6.1 -- 2026-08-19

The ASCII-only Law acquires an executable witness, and the four files that
predate the discipline are swept clean -- 1,196 non-ASCII code points, 75 of them
inside the published tarball. No runtime behaviour changes: the sweep touches
only comments, prose and demo text, proven line-by-line against the
transliteration table -- every differing line is the original with only the
declared substitution applied, the sole exceptions being the two version literals
(`BitmapFont.js`, `llms.txt`) that any release moves. F-46. Decision record:
`decisions/0008-ascii-gate.md`.

### Changed
- **`test/packaging.test.js` gains an ASCII-only gate.** It enumerates every
  tracked file via `git ls-files` -- never a filename list, never
  `package.json` files[] -- reads each one as a Buffer with NO binary skip at
  all: a NUL byte or a strict-UTF-8 decode failure is itself a gate FAILURE (the
  package tracks zero binaries, so a skip would only open a bypass -- an
  extension allowlist slips a renamed text file past, a NUL sniff slips a UTF-16
  text file past). It then reports `path:line:col
  U+XXXX` for every code point >= 0x80 other than the two Law exceptions
  (U+00D7, U+00B5). It fails closed: a git error, a non-zero status, an empty
  enumeration or a read throw is a FAILURE, asserted before any byte is judged.
  A new TRACKED file carrying a non-ASCII byte reddens the gate the day it is
  added, with no edit to the test. Scope is deliberately `git ls-files`:
  untracked working-tree files are not scanned, so the rule binds what the repo
  actually carries rather than whatever happens to be sitting on one machine.

### Docs
- Swept `BitmapFont.js`, `llms.txt`, `README.md` and
  `demo/demo-lite-bmfont.html` to ASCII: em/en dashes, arrows and ellipses
  transliterated (`--`, `-`, `->`, `...`), the demo's box-drawing banners to
  `=`/`-`, the demo's two visible U+00B7 separators to the `&middot;` entity
  (source ASCII, rendered page unchanged), and the 21 README heading/bullet
  emoji deleted toward the blueprint README shape.
- **Corrected a self-contradiction in the ellipsis-flag docs.** `README.md`,
  `BitmapFont.js:1019` and `llms.txt` described the wrap flag as appending the
  U+2026 ellipsis GLYPH; the implementation appends three ASCII `.` (code 46),
  as `BitmapFont.js:72`/`:992` already stated. The prose now matches the code.
  The `llms.txt` runnable snippet's `'Hello world<ellipsis>'` string became
  `'Hello world...'`, the first version of that example the ASCII-only atlas can
  actually render.

## 1.6.0 -- 2026-08-19

`drawWrapped` and its canonical producer shipped contradictory contracts for one
float, and every centre/right-aligned wrapped line was mispositioned at any
`scale != 1`. `@zakkster/lite-text-layout`'s `computeWrap` emits `lineWidth` at
the RENDERED scale (its RANGE-CONTRACT says so, drift-guarded across four
surfaces); bmfont's Law claimed scale=1 and multiplied by `scale` again before
comparing to the already-rendered-px `boxWidth`. The two operands disagreed by a
factor of `scale`. F-45. Decision record: `decisions/0006-layout-buffer-scale.md`.

### Changed (behaviour)
- **`drawWrapped` no longer re-scales the layout buffer's `lineWidth`.** It now
  compares `lineWidth` DIRECTLY to `boxWidth`, both rendered px, adopting the
  producer's `lineWidth@render-scale` convention (decision D-1). Centre/right
  alignment was off by the closed form **`lineWidth * (scale - 1) / 2`** (centre)
  and **`lineWidth * (scale - 1)`** (right) -- identically zero at `scale = 1`,
  which is why it shipped through three versions.
  - Worked example, advance-12 font, one 5-glyph line (rendered width 120) in a
    200-px box at **scale 2**, centre align: the first glyph's dst x was **-20**
    (`(200 - 240)/2`, off the LEFT edge of the box) and is now **40**
    (`(200 - 120)/2`). Right align: **-40** -> **80**.
  - Who regresses: a caller who hand-rolled a scale-1-width buffer and used
    centre/right align at `scale != 1` was getting correct pixels under the old
    documented contract and now shifts. That population is out-of-contract only
    because the canonical producer is broken today, so this ships MINOR (D-2) with
    this loud row rather than as a patch. `draw`/`drawFast`/`drawFastInt`/`measure`
    are UNAFFECTED -- only `drawWrapped` reads the layout buffer.

### Docs
- All five `lineWidth` sites (`BitmapFont.js`, `BitmapFont.d.ts`, `README.md`,
  `llms.txt`, `ROADMAP.md`) now state render scale; the old scale=1 claim is gone.

## 1.5.0 -- 2026-08-18

`drawFastInt`, a second zero-alloc number renderer for integer COUNTS -- coins,
kills, score, seconds -- where `drawFast`'s decimal point is noise and a `.`
glyph may not even be in the atlas. It is a NEW hot body, exact by construction
at its own ceiling. Nothing existing moves: `drawFast` is byte-identical to
1.4.1, proven by body sha, and F-23 is re-routed (not fixed) to M8b. Decision
record: `decisions/0005-drawfastint.md`.

### Added
- `drawFastInt(ctx, value, x, y, scale, align)` -- integer-only zero-alloc
  number renderer. No decimal point, no `.` glyph required in the atlas.
  TRUNCATES toward zero (1.9 -> "1"), unlike `drawFast` which rounds to the
  nearest tenth: `drawFast` renders a measurement, `drawFastInt` renders a count,
  and a count must never display a threshold it has not crossed.
- `DRAWFASTINT_MAX` -- `Number.MAX_SAFE_INTEGER`. Both endpoints inclusive.
  The CORRECTNESS boundary, not the buffer boundary: above 2^53 a double is
  not integer-exact and `v % 10` returns noise. `drawFastInt` is exact by
  construction for every value it admits (`decisions/0005`).

### Changed (behaviour)
- **None.** `drawFast` is byte-identical to 1.4.1, proven by body sha. F-23
  (`drawFast`'s inexact digit extraction, both bands) is NOT fixed here; it is
  re-routed to M8b by `decisions/0005` fork (1), which amends `decisions/0001`'s
  routing. Both T4 band pins are unchanged in value and now name M8b.

### Contract
- `ctx.drawImage` MUST NOT re-enter the font. `drawFast` and `drawFastInt`
  share one 24-byte scratch buffer; a re-entrant ctx corrupts the outer call's
  digits. True for `CanvasRenderingContext2D`, not true for an arbitrary object
  with a `drawImage` method. Proven violable by T9 control 16.

## 1.4.1 -- 2026-08-18

The renderer text door. `draw` and `drawWrapped` carried the two `text.length`
reads that feed their unkillable line scans, but -- unlike the measure family
since 1.4.0 -- neither rejected a non-string first. `{length: Infinity,
charCodeAt(){return 65}}` has a numeric `length` and a `charCodeAt`, so `len`
(and `tlen`) became `Infinity` and the scan never terminated: SIGKILL after 6 s,
an S1 hang reachable from the public API (F-42). The fix is the SAME
`typeof text !== 'string'` predicate the measure family already carries, one per
CALL and zero per glyph, ahead of the scale door. Five text-taking faces now share
one door and two fail signals by family: the two text renderers draw nothing and return,
the measure family returns `NaN`. Design record: `decisions/0004-metrics-and-snapping.md`
fork (9). No other logic in `BitmapFont.js` changed.

### Fixed
- **F-42 (S1):** `draw` and `drawWrapped` now TERMINATE on an unbounded
  array-like `text`. `draw(ctx, {length: Infinity, charCodeAt(){return 65}})`
  and the `drawWrapped` equivalent were SIGKILLed after 6 s in 1.4.0; both now
  draw nothing and return in under 1 ms. Proven out of process by T9 controls 14
  and 15, each of which also SIGKILLs a door-removed twin to prove the control is
  not vacuous.
- **F-43:** the two unverifiable absolute test counts were removed from
  `README.md` and `llms.txt`. A count no gate can read drifts silently -- both
  numbers were stale by 1.4.0. The gate is `npm test` reporting 0 failures and
  `npm run torture` printing exactly `ok`.

### Changed (behaviour)

Both deltas change `draw`/`drawWrapped` ONLY on inputs that were already broken
(one hung, one threw) or already unsupported, consistent with M1's `drawFast`
magnitude door shipping as a patch (1.2.2).

| Input | 1.4.0 | 1.4.1 |
| --- | --- | --- |
| `draw(ctx, new String('A'), ...)` / `drawWrapped` with a boxed `String` | renders **1 glyph** | renders **0** and returns |
| `draw(ctx, null, ...)` / `draw(ctx, undefined, ...)` / `drawWrapped` with either | throws a raw **`TypeError`** | returns, draws **0** |

The two rows cover four inputs. `[65]` is an instance of row 2 -- it threw a raw
`TypeError` in 1.4.0 for the same reason `null` did (an internal `.length` read
escaping), and now returns. `{length: 2, charCodeAt(){return 65}}` is an instance
of row 1 -- it drew 2 glyphs in 1.4.0 for the same reason a boxed `String` drew,
duck-typing, and now draws 0. A caller who relied on the old `TypeError` from
`draw(ctx, null)` detects a bad `text` via `Number.isNaN(measureWidest(text))`,
which is the measure family's fail signal.

## 1.4.0 -- 2026-08-18

Metrics coherence and the pixel-snap promise. `measure()` sums across newlines
and `draw()` aligns per line, so the two disagreed about the package's central
noun and centring a multi-line string with the obvious call was wrong by the
width of every line that is not the longest. `draw()` documented a
"pixel-snapped baseline" and rounded exactly once, then accumulated
`lineHeight * scale` raw, so at any fractional step every line after the first
landed off-grid -- the blur the promise exists to prevent. And the measure family
had no fail signal at all: one input returned a negative width, one returned 0
for a number, one threw a raw `TypeError`, and one never returned. Design record:
`decisions/0004-metrics-and-snapping.md`.

### Added
- **`measureWidest(text, scale = 1)`** -- the width of the WIDEST line, which is
  the number to size or centre a box with. `measureWidest('AA\nAA')` is 16 on an
  advance-8 font where `measure` is 32; for a newline-free string the two are
  equal. Lines split at `\n` only and the kerning chain RESETS at the break,
  matching `draw`. One pass, no `split`, no `slice`, no array -- zero allocation,
  gated at `maxBytesPerCall: 0`.
- **`measureLine(text, start, end, scale = 1)`** -- the width of one explicit
  range, with `start`/`end` clamped into `[0, text.length]` and otherwise left
  alone -- the same TWO-leg clamp `drawWrapped` applies to the indices it reads
  out of a layout buffer, so the number is the width the renderer will actually
  draw. Fractional indices are read as `charCodeAt` reads them, truncated per
  iteration; a `NaN` `start` becomes 0 and a `NaN` `end` becomes `text.length`,
  so `[0, NaN)` measures the whole line -- `NaN` is what a `Float32Array` holds
  when a layout pass failed or never ran. An empty range, or a negative `end`,
  measures 0. Built for the caller who has a layout buffer and wants the width of
  the line it just produced.
- **Which width do I want:** `measureLine` for one range, `measureWidest` for a
  box that will hold every line, `measure` for the total advance of the whole
  string including its newlines.
- All three answer a `scale` outside `(0, Infinity)` or a non-string `text` with
  **`NaN`**. The text door is `typeof text === 'string'`, so a **boxed** `String`
  object is rejected -- deliberate, because the looser "has a length and a
  charCodeAt" test admits an object that never terminates. `NaN` is what the
  doors produce; it is not unique in the absolute, since a font with mixed-sign
  Int16 advances at an extreme but in-range `scale` can also produce `NaN` or
  `Infinity` by arithmetic, exactly as it did in 1.3.0.
- `measureWidest` **can return a negative width**: a negative `xadvance` or
  kerning `amount` is a valid Int16 the constructor accepts, so a line can
  legitimately measure negative and the result is the greatest (least negative)
  line. An empty line measures 0, which is wider than any negative line.

### Fixed

| ID | Sev | Finding | Reproduction | Fixed in |
| --- | --- | --- | --- | --- |
| **F-07** | S2 | **Only the first line was pixel-snapped in Y.** `draw` ran `cursorY = Math.round(y)` once and then accumulated `cursorY += lineHeight * scale` unrounded, so at any fractional step every line after the first landed off the pixel grid. `drawWrapped` had the identical shape. Every baseline is now snapped, from an exact per-line product rather than a running float: `Math.round(y) + Math.round(i * lineHeight * scale)`. | `draw(ctx,'A\nB\nC\nD\nE',0,0,1.1)` at `lineHeight` 17 -> baselines were `0, 18.7, 37.4, 56.1, 74.8`; now `0, 19, 37, 56, 75` | 1.4.0 |
| **F-34** | **S1** | **The measure walk never terminated on an unbounded range, and the public `measure` could reach it.** The walk is `for (let i = start; i < end; i++)`; at `start === -Infinity` the increment never advances and the loop is unkillable. `measure` forwards `0` and `text.length`, so a real string was safe -- but `measure` had no text door, and an object with a numeric `length` and a `charCodeAt` reached it. All three public faces now terminate. [corrected in 1.4.1: the three faces meant here are the three MEASURE faces; `draw` and `drawWrapped` are two further text-taking faces -- five in all -- and neither terminated until 1.4.1 (F-42)] | `measure({length: Infinity, charCodeAt(){return 65}})` -> was SIGKILL after 6 s; now returns `NaN`. `measureLine('AAAA', -Infinity, Infinity, 1)` -> `32` | 1.4.0 |
| **F-35** | S2 | **The raw range walk and `drawWrapped` disagreed about a negative fractional index**, so a public range measure would have reported a width the renderer does not draw. `drawWrapped` clamps once, up front; the raw walk let `charCodeAt` truncate per iteration, and `charCodeAt(-0.5)` reads index 0 -- adding a glyph instead of rejecting one. `measureLine` clamps first -- and clamps ONLY, because `drawWrapped` does not pre-truncate either: it walks a fractional index and lets `charCodeAt` truncate per iteration. A door that rounded the bounds would report a width the renderer does not draw, which is the same defect one method over. | range `[-0.5, 2)` on `'AAAA'` at advance 8 -> `drawWrapped` draws 2 glyphs; the raw walk returned 24 (three glyphs); `measureLine` returns **16**. `[0.5, 2.7)` -> 3 glyphs and **24** from both | 1.4.0 |
| **F-36** | S2 | **`measure` had neither a scale door nor a text door**, so M3's fail-closed policy was installed on the renderers only. One bad `scale` produced two different failure modes in one frame: the caller sized a box at a negative or zero width and `draw` silently declined to render. All three public measure faces now carry the same range door the three draw bodies carry, plus a `typeof text === 'string'` door. | `measure('AA', -1)` -> was `-16`; now `NaN`. `measure(123)` -> was `0`; now `NaN`. `measure(null)` -> was a raw `TypeError`; now `NaN` | 1.4.0 |
| **F-06** | S2 (half) | **`measure()` sums across newlines while `draw()` aligns per line.** 1.4.0 adds `measureWidest` and documents `measure` as what it is -- a total advance, not a layout width. `measure`'s own return value is UNCHANGED; promoting it to the widest line is a silent numeric change and lands in 2.0.0. | `measure('AA\nAA')` -> `32` (unchanged); `measureWidest('AA\nAA')` -> `16` | 1.4.0 (half); 2.0.0 (semantics) |

### Changed (behaviour)

**We believe no working call site changes.** It is stated as a claim, not a fact,
and the call sites that can notice are named below.

| # | Call | 1.3.0 | 1.4.0 |
| --- | --- | --- | --- |
| D1 | `measure(123)` | `0` | **`NaN`** |
| D2 | `measure(null)` / `measure(undefined)` | raw `TypeError` | **`NaN`** |
| D3 | `measure('AA', -1)` | `-16` | **`NaN`** |
| D4 | `measure('AA', 0)` | `0` | **`NaN`** |
| D5 | `measure('AA', Infinity)` | `NaN` by arithmetic | `NaN` **by policy** -- not a value change, but the reason changed |
| D6 | `measure([])` / `({})` / `(true)` | `0` | **`NaN`** |
| D7 | `measure({length: Infinity, charCodeAt(){return 65}})` | **hung forever** | **`NaN`, returns** |
| D8 | `draw`, multi-line, fractional `lineHeight * scale`, line index >= 1 | off-grid (`18.7, 37.4, ...`) | **snapped** (`19, 37, ...`) |
| D9 | `drawWrapped`, same condition, line index >= 1 | off-grid (`36.7, 55.4, ...`) | **snapped** (`37, 55, ...`) |

D1, D2, D6 and D7 replace a fail-open answer, a raw throw and a hang with a fail
signal, and none of the four can be part of a call site that produces correct
output. **D3 and D4 are different and the honest sentence is different: a
negative or zero width is a value a caller may have been acting on
deliberately**, and it now reads `NaN`. If you were pre-clamping `scale` to 0 to
hide text and reading `measure`'s `0` as a valid "hidden" width, that arithmetic
becomes `NaN`; use a real conditional instead. If you were catching `TypeError`
around `measure(userInput)`, that catch stops firing.

**D8/D9 migration note, because this is the one call site that can regress
visually: if you were compensating for the Y drift by pre-rounding your own `y`,
stop.** The renderer now does it and the two corrections compose.

**Not changed, stated positively so a differential that finds otherwise is a
bug:** line 0 of `draw` and of `drawWrapped` is byte-identical to 1.3.0,
including `drawWrapped`'s two composed rounds at `vAlign` 1/2; at an integer
`lineHeight * scale` nothing moves at all; glyph X is still not snapped per
glyph -- only the line origin is rounded, and the promise is **per line origin in
X, per baseline in Y**; `drawFast` is untouched; `measure`'s value for a valid
multi-line string is unchanged; and the internal range walk keeps no door, since
clamping it would tax `draw`'s per-line align calls, which cannot be out of range
by construction.

**The measure family answers a bad argument with `NaN` while the renderers answer
it by drawing nothing.** That asymmetry is deliberate: a renderer can decline to
act, a query cannot decline to answer.

## 1.3.0 -- 2026-08-18

The descriptor door. Three of the four things a `BitmapFont` needs in order to
render were unchecked, and the fourth admitted four types that are not numbers:
`new BitmapFont(atlas, { chars: 7 })` returned a font whose every `measure()` was
0 forever, `atlas: null` returned a font that called `drawImage(null, ...)` sixty
times a second, and a fractional or string `char.id` silently wrote a glyph the
descriptor never named. This release validates the descriptor once, at
construction, in a cold body, and fails closed on every input with no correct
reading. Design record: `decisions/0003-descriptor-door.md`.

### Added
- `BitmapFontError` -- the one error type the constructor throws (F-10). It
  EXTENDS `RangeError`, so a `catch (e) { if (e instanceof RangeError) }` around a
  `new BitmapFont(...)` still fires; `e.name` is `'BitmapFontError'`, and
  `e.field` / `e.value` are own properties so a caller can branch on the field
  without parsing English. Every message starts `lite-bmfont: ` and names the
  field and the received value.
- `opts.checked` (default **false**, must be a boolean): opens the LOSSY lane.
  Two lanes -- inputs with no correct reading (a null atlas, a NaN metric, a
  non-number id, a fractional kerning key) ALWAYS throw; lossy-but-interpretable
  inputs (an atlas coordinate past Int16, a fractional `xadvance`, an id outside
  `[0, 256)`) are skipped or truncated silently by default and throw only under
  `{ checked: true }`. An unknown own key on the `opts` bag throws (F-28), so
  `{ missingAdvanc: 6 }` -- one dropped letter -- is an error, not a silent
  default.
- **F-08 detection (detection only).** `{ checked: true }` reports the Int16
  store's lossy cases with their exact numbers -- an atlas coordinate of `40000`
  stores as `-25536`, an `xadvance` of `8.6` stores as `8` (0.6px per glyph, 24px
  over a 40-glyph line), and a negative field truncates toward zero. **The storage
  behaviour itself is unchanged in 1.3.0**; unchecked output is byte-identical.
  The unchecked pins (`x: 40000` -> `-25536`, `measure('AA') === 16` against an
  exact `17.2`) are documented contracts with a T3 row each, so an M9 storage
  change lands visibly, not silently.
- `chars: []` is now explicitly LEGAL: a coherent zero-glyph font whose `measure`
  is 0 and whose `hasGlyph` is false for every id.
- T3 filled: the 50-row descriptor abuse matrix plus six tier-wide rows (the
  error-type sweep, the message-quality sweep, lane symmetry), every throwing row
  carrying its non-vacuity twin.

### Fixed

| ID | Sev | Finding | Reproduction | Fixed in |
| --- | --- | --- | --- | --- |
| **F-09** | S3 | Kerning keys were checked only on the upper bound, so a negative computed a discarded negative index and a non-number or fractional key silently kerned a pair the descriptor never named. Both keys now use the SAME integer predicate as `char.id`; a finite key outside `[0, 256)` is skipped (checked: throws), a non-number or fractional key always throws. `amount` rides the F-08 lane. | `kernings:[{first:'65',second:66,amount:5}]` -> was written to slot 16706; now throws naming `kernings[0].first`. `first:-1` -> writes nowhere, checked throws | 1.3.0 |
| **F-10** | S2 | The constructor accepted three malformed descriptors and rejected four others with raw `TypeError`s naming internal properties. `imageAtlas`, `fontJson`, `common`, `common.lineHeight`, `common.base`, `chars` and `kernings` are now validated and throw a `BitmapFontError` naming the field. No raw `TypeError` escapes. | `new BitmapFont(atlas,{chars:7})` -> was a 0-glyph font; now throws naming `chars`. `new BitmapFont(atlas,null)` -> was raw `TypeError`; now `BitmapFontError` naming `fontJson` | 1.3.0 |
| **F-11** | S3 | `scale` was unvalidated in the three draw bodies: `NaN` reached `drawImage`, `0` and `-1` produced zero and negative destination widths. A per-call range door `if (!(scale > 0 && scale < Infinity)) return;` now draws NOTHING for `NaN`, `0`, a negative or `Infinity`. Out-of-range `align` (renders LEFT) and `vAlign` (renders TOP) are now documented contracts. | `draw(ctx,'AAAA',100,0,NaN,0)` -> was 4 NaN quads; now 0 calls. `scale:-1` -> was 4 negative-width quads; now 0 | 1.3.0 |
| **F-13** | S3 | `flags` was strict-compared to `1` through a `Float32Array`, so `1.0000001` missed the ellipsis and unknown flag values were silently ignored. `flags` is now ToInt32'd and masked -- `(flags\|0) & FLAG_ELLIPSIS` -- and an unknown bit throws under `checked`. | `flags = 1.0000001` -> was 5 calls (no ellipsis); now 8. `flags = 2` under `{checked:true}` -> throws naming the unknown bit | 1.3.0 |
| **F-28** | S2 | The `opts` bag accepted any non-null value and silently ignored unknown keys, so `{ missingAdvanc: 6 }` -- one dropped letter -- constructed with the default. `opts` must now be a plain object; every own key must be in the frozen allowlist `['missingAdvance','checked']`; an unknown or inherited key throws; `checked` must be an exact boolean. | `{missingAdvanc:6}` -> was default 0, no error; now throws naming the key and the allowlist. `{checked:1}` -> throws | 1.3.0 |
| **F-29** | S2 | A non-number or non-integer `char.id` silently wrote a glyph the descriptor never named -- `id: '65'` wrote four slots but `hasGlyph(65)` stayed false, so `_mapped` and `glyphs` disagreed and the coverage API lied. `char.id` now requires an integer number; a finite id outside `[0, 256)` is skipped (checked: throws), everything else throws. | `id:'65'` -> was 4 slots written, `hasGlyph(65) === false`; now throws naming `chars[0].id` | 1.3.0 |
| **F-30** | S2 | A non-finite glyph field (`x: NaN`, `+/-Infinity`) stored 0 and reported the glyph covered, asserting with full confidence that it sat at the sheet's top-left corner. `null is not zero`: a non-finite field now ALWAYS throws, in both lanes -- there is no reading of `x: NaN` that renders the intended glyph. | `char.x = NaN` -> was `glyphs[65*7] === 0`, `hasGlyph(65) === true`; now throws naming `chars[0].x` | 1.3.0 |

### Changed (behaviour)

**We believe no working call site changes: every newly-rejected input produced a
font that renders nothing, renders at NaN, or renders a glyph the descriptor
never named.** If you are constructing fonts from user-supplied descriptors, this
release can make a previously-silent path throw. `{ checked: true }` is opt-in in
1.x and becomes the default in 2.0.0.

Descriptors that constructed on 1.2.3 and now throw: `atlas: null` / `undefined`,
`chars: 7` / `'AB'` / `{length:-1}`, `kernings: 7`, `common.lineHeight: NaN`,
`common.base: NaN`, `id: '65'` / `null` / `true` / `65.5` / `NaN`, `x: NaN`,
kerning `first: '65'` / `65.5` / `true`, `opts: 7`, and any `opts` with an unknown
own key. Each produced a font that renders nothing, renders at NaN, or renders a
glyph the descriptor never named.

Per-call deltas: `scale` `NaN` / `0` / `-1` / `Infinity` now draw NOTHING on
`draw`, `drawFast` and `drawWrapped` (they produced NaN coordinates or
zero/negative destination widths). `flags: 1.0000001` now draws the ellipsis it
always should have. `flags: -1` now draws an ellipsis too (`-1 | 0 === -1` and
`-1 & 1 === 1`) -- measured 5 calls before, 8 after; if you relied on `-1` meaning
"no ellipsis", that is the one delta here that a working call site could notice.

The four inputs that threw a raw `TypeError` on 1.2.3 and now throw a
`BitmapFontError` (which is NOT a `TypeError`): **`fontJson: null`,
`fontJson: {}`, `common: null`, and a missing `chars`.** A `catch (e) { if (e
instanceof TypeError) }` around a constructor stops firing for these -- grep your
own `catch` blocks. `instanceof RangeError` is preserved for every throw,
including M2's `missingAdvance` and short-buffer `RangeError`s.

The `missingAdvance` range error's **message text** changed: 1.2.x said
`lite-bmfont: missingAdvance must be a finite number in [0, 32767], got ...`; it
now says `lite-bmfont: opts.missingAdvance must be ...`, so the message names the
field (`e.field === 'opts.missingAdvance'`) that a caller can branch on. The
range and NaN rejection are unchanged. The `drawWrapped` short-buffer throw keeps
its exact 1.2.x message and stays a bare `RangeError`.

## 1.2.3 -- 2026-08-17

The advance conservation law (the NaN cursor). Nothing in the package could
state where the cursor was supposed to be, so nothing could notice when a NaN
char code, a bad layout index, an unmapped glyph or a mapped newline moved it off
the rails. This release lands the three-way conservation law (T0) and fixes the
seven findings the law exposes. Design record: `decisions/0002-cursor-conservation.md`.

### Added
- `missingAdvance` constructor option (default **0**): the xadvance written into
  every uncovered glyph id at construction, so an absent glyph leaves a gap
  instead of letting the next glyph overprint it (F-12). Opt-in; the default is
  byte-identical to 1.2.x. Must be a finite number in `[0, 32767]` or the
  constructor throws `RangeError`.
- `hasGlyph(id): boolean` -- fail-closed coverage query. `NaN`, `-1`, `256`,
  `65.5` and id `10` are all `false`. Detect coverage gaps at load time instead
  of as overlapping text at runtime.
- T0's advance conservation law in full: 50,000 seeded three-way tuples
  (`walk === _measureRange === oracle`), the fork fixtures, and a law-4
  non-vacuity assertion that detects its own vacuity (F-21).
- T2 filled: the 22-row layout-buffer abuse matrix, each row a decided policy
  (clamp / throw / documented no-op) with its killing mutation.
- 12 named `node:test` blocks pinning F-03/04/05/12/24/25 as real assertions.

### Fixed

| ID | Sev | Finding | Reproduction | Fixed in |
| --- | --- | --- | --- | --- |
| **F-03** | S1 | The NaN guard polarity was inverted between `_measureRange` (`id >= 0 && id < 256`, rejects NaN) and both draw paths (`id < 0 \|\| id >= 256`, accepts NaN). All three sites now share the reference form; the two draw guards are reshaped to `!(id >= 0 && id < 256)`. | `(NaN < 0 \|\| NaN >= 256)` -> `false` (accepted); now `!(NaN >= 0 && NaN < 256)` -> `true` (skipped) | 1.2.3 |
| **F-04** | S1 | A `startIdx < 0` or `NaN` in the layout buffer rendered a whole line at `NaN` x (`charCodeAt(-1)` is NaN, which passed the inverted guard) -- the exact hand-off shape `@zakkster/lite-text-layout` emits. Per-line indices are now clamped: `startIdx` to 0, `endIdx` to `text.length`. | `drawWrapped(ctx,'HELLO',Float32Array.of(-1,5,40,0),1,...)` -> was 5 NaN dx; now dx `0,12,24,36,48` | 1.2.3 |
| **F-05** | S2 | `drawWrapped` never bounds-checked `layoutBuffer` against `lineCount * 4`; surplus lines vanished silently. A short buffer now throws a `RangeError` naming both numbers; `lineCount` below 1, or `NaN`, or fractional is floored and clamped at 0. | `drawWrapped(ctx,'HELLO',Float32Array.of(0,5,60,0),3,...)` -> was no throw, 2 lines dropped; now `RangeError` naming 4 and 12. `lineCount 0.5` -> was 5 calls; now 0 | 1.2.3 |
| **F-12** | S3 | A glyph absent from the atlas advanced by zero, so the next glyph overprinted it -- undocumented. Now documented, opt-in-correctable via `missingAdvance`, and detectable at load via `hasGlyph`. | `draw(ctx,'A'+chr(200)+'A',0,0)` -> dx `0,12` (second A overprints); with `{missingAdvance:6}` -> dx `0,18` | 1.2.3 |
| **F-21** | S3 | T0 law 4 (the seam-kerning equation) was the only kerning check in the gate and it was vacuous: `FONT_KERN` shipped 3 pairs against an 8836-seam corpus, so 0 seams carried non-zero kerning under either shipped seed. `JSON_KERN` is densified to ~85% non-zero seams, and law 4 now counts and asserts its own non-zero seam count. | default seed -> eligible 246, non-zero 0; seed 12345 -> 247, 0. Mutation: deleting the kerning term from `_measureRange` now turns T0 red (it passed clean before) | 1.2.3 |
| **F-24** | S3 | The advance oracle claimed an unmapped id "advances 0 AND does not become the kerning prev" and called it the implementation's behaviour; it was never true. The library kerns across an unmapped id and the oracle now agrees (fork (3): the oracle changed, not the library). | `FONT_GAP._measureRange('A'+chr(200)+'B',0,3,1)` -> 34; v1.2.2 oracle gave 19 | 1.2.3 |
| **F-25** | S1 | A descriptor entry for id 10 (`\n`) charged advance in `_measureRange`, ran kerning through the line break, and -- because `drawWrapped` has no id-10 case -- drew the newline as a visible 9x9 glyph mid-line. A descriptor entry for id 10 is now DISCARDED (width, height, offsets, advance, and any kerning pair naming it). | `FONT_NL.measure('A\nA')` -> was 31, now 24; `drawWrapped('AB\nC',...)` -> was 4 calls, now 3 | 1.2.3 |

### Changed (behaviour)

Three deltas, each confined to inputs that were already producing undefined or
silently-wrong output. Every other call is byte-identical to 1.2.2.

- **A `layoutBuffer` shorter than `lineCount * 4` now throws `RangeError`** instead
  of dropping the surplus lines. This input previously produced undefined or
  silently-wrong output.
- **`drawWrapped` with `lineCount = 0.5` now draws nothing** (floored to 0)
  instead of drawing a full line. This input previously produced undefined or
  silently-wrong output.
- **A descriptor entry mapping id 10 (`\n`) is now discarded.** This input
  previously produced undefined or silently-wrong output (an advance-charging,
  kerning-through, mid-line-drawn newline that no two of the three code paths
  agreed on).

### Structural
- Each font gains a 32-byte `Uint32Array(8)` glyph-coverage bitmap (`_mapped`),
  moving the per-font structural total from 134,680 to 134,712 bytes. Pinned by
  T6. The four T6 `rec.total` windows are unchanged (12,710,000 / 1,025,000 /
  6,560,000 / 0): no glyph started or stopped being drawn.

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
| **F-08** | S2 | `Int16Array` truncation and wrap in the constructor are silent: an atlas coordinate of `40000` wraps, and a fractional `xadvance` truncates into an accumulating drift. M3 makes the drift DETECTABLE under `{ checked: true }` with its exact numbers; the storage behaviour itself is M9's. | `char.x = 40000` -> `glyphs[65*7] === -25536`; `xadvance 8.6` -> `8`, so `measure('AA')` is `16` where exact is `17.2` | M3 (detection) / M9 (storage) |
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
