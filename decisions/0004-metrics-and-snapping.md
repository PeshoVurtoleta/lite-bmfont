# 0004 -- metrics coherence and the pixel-snap promise

Status: accepted
Session: M4 (v1.4.0)
Findings: F-06, F-07, F-34, F-35, F-36
Date: 2026-08-18
Frozen baseline sha256: `11ca9228102dc595532f001fc472e323681feff7c700919c3b343af075d4f9bf`

## The question

`measure('AA\nAA')` returns 32 on an advance-8 font. The widest line is 16.
`draw` aligns each line independently, so centring a multi-line string with the
obvious call -- `draw(ctx, s, cx, y, 1, 1)` after sizing a box with `measure(s)`
-- is wrong by the width of every line that is not the longest. Two functions in
a four-function package, disagreeing about the package's central noun.

And the second half of the pixel-snap promise is not kept. `draw` documents
"Pixel-snapped baseline for crisp pixel fonts" and rounds once, at
`cursorY = Math.round(y)`. Then the per-line step accumulates
`cursorY += this.lineHeight * scale` raw. On `FONT_SNAP` at scale 1.1 the five
baselines land at `0, 18.7, 37.4, 56.1, 74.8` -- four of five lines off-grid,
which is exactly the blur the promise exists to prevent. `drawWrapped` has the
identical shape.

M4 widens the measure surface. The M3 lesson is that widening a surface
publishes whatever that surface already does wrong, and the probe found three
things: an unkillable loop reachable from the public `measure` (F-34), an index
disagreement with the renderer (F-35), and a family with no fail signal at all
(F-36).

## Measured behaviour table (v1.3.0, BEFORE)

Measured at M4-T03 against the frozen copy of `BitmapFont.js` whose sha256 is in
the front matter. Fixture `FONT_SNAP` (advance 8, `lineHeight` 17, `base` 16)
unless another is named.

| # | Input | v1.3.0 measured |
| --- | --- | --- |
| 1 | `measure('AA\nAA')` on `FONT_SNAP` | **32**; widest line **16** |
| 2 | `measure('A\nAAAAAA')` on `FONT_SNAP` | **56**; widest line **48** |
| 3 | `measure('AA\nAA')` on `FONT_ASCII` | **48**; widest **24** |
| 4 | `measure('A\nAAAAAA')` on `FONT_ASCII` | **84**; widest **72** |
| 5 | `draw(ctx,'A\nB\nC\nD\nE',0,0,1.1)`, baseline column | **0, 18.700000000000003, 37.400000000000006, 56.10000000000001, 74.80000000000001** |
| 6 | same at `scale = 1` | **0, 17, 34, 51, 68** -- all integers |
| 7 | same at `scale = 1/3` | **0, 5.666666666666666, 11.333333333333332, 17, 22.666666666666664** |
| 8 | same at `y = 0.6`, `scale = 1.1` | **1, 19.700000000000003, 38.400000000000006, 57.10000000000001, 75.80000000000001** |
| 9 | `drawWrapped` 5 lines, `y = 0`, `scale = 1.1`, `base = 16`, `vAlign = 0` | **18, 36.7, 55.400000000000006, 74.10000000000001, 92.80000000000001**; offset from row 5 is **18** = `Math.round(base*scale)`, NOT `base*scale` = 17.6 |
| 10 | `drawWrapped` line-0 anchor, `vAlign = 1`, `boxHeight = 101`, `y = 0.6`, `scale = 1.1` | **22** -- two composed rounds, `Math.round(0.6 + 17.6) = 18` plus `Math.round(3.75) = 4` |
| 11 | glyph x column, `scale = 1.1`, `draw` | **0, 8.8, 17.6, 26.400000000000002** -- X is NOT snapped per glyph |
| 12 | `f._measureRange('AAAA', -Infinity, Infinity, 1)` | **SIGKILL at 6003 ms**, `status=null signal=SIGKILL` |
| 13 | `f.measure({length: Infinity, charCodeAt(){return 65}})` | **SIGKILL at 6002 ms**, `status=null signal=SIGKILL` |
| 14 | the same unbounded range through `drawWrapped`'s layout buffer | **returns in 25 ms**, 4 drawImage calls (M2's clamp) |
| 15 | range `[-0.5, 2)` on `'AAAA'`, advance 8 | `drawWrapped` draws **2** glyphs; `_measureRange` returns **24** (3 glyphs) |
| 16 | range `[0.5, 2.7)` | `drawWrapped` draws **3** glyphs; `_measureRange` returns **24** (3 glyphs) -- see the correction note below |
| 17 | range `[1.9, 3.1)` | `drawWrapped` draws **2** glyphs; `_measureRange` returns **16** (2 glyphs) |
| 18 | `measure('AA', -1)` | **-16** (a negative width) |
| 19 | `measure('AA', NaN)` / `('AA', Infinity)` | **NaN** / **NaN** |
| 20 | `measure(123)` / `([])` / `({})` / `(true)` | **0** / **0** / **0** / **0** (fail-open) |
| 21 | `measure(null)` / `measure(undefined)` | raw **`TypeError: Cannot read properties of null (reading 'length')`** / the same for `undefined` |
| 22 | `scale` 0 / -1 / NaN / Infinity through `draw` | **0, 0, 0, 0** drawImage calls (M3's F-11 door) |
| 23 | after `destroy()`: `measure`, `_measureRange`, `hasGlyph` | raw **`TypeError`** each, not `BitmapFontError` |
| 24 | `measure('AA', 1e-45)` / `measure('')` | **1.6e-44** / **0** |
| 25 | `_measureRange('AAAA', 0, 99, 1)` | **32** (`charCodeAt` yields NaN past the end and the guard skips) |
| 26 | `draw('A', 0, 0.6, 1.1)` single line, baseline | **1** |

### Correction 1 to the session plan, applied here in place (2026-08-18)

`SESSION-M4.md` section 4 row 29, DONE WHEN row 14 and section 8.3.5 row R2 all
record `measureLine('AAAA', 0.5, 2.7, 1)` as **16**, with the 1.3.0 column also
reading 16 and the row annotated "agrees today". **Both numbers are wrong, and
the second one mattered.**

The 1.3.0 value is **24**. The raw walk visits `i = 0.5, 1.5, 2.5`, all below
2.7, and `charCodeAt` truncates them to indices 0, 1, 2 -- three glyphs. The
count half of the plan (section 0.6: "`[0.5, 2.7)` -> 3 and 3") is right and
reproduces; the width half is not.

**16 is only reachable by a door that pre-truncates both ends, and such a door
violates fork (3)'s own ratified criterion.** The first implementation clamped
AND truncated, and it measured:

| range | `drawWrapped` | clamp+truncate | clamp-only |
| --- | --- | --- | --- |
| `[-0.5, 2)` | 2 glyphs | 16 (agrees) | 16 (agrees) |
| `[0.5, 2.7)` | **3 glyphs** | **16 -- DISAGREES** | **24 (agrees)** |
| `[1.9, 3.1)` | 2 glyphs | 16 (agrees) | 16 (agrees) |

Fork (3) is ratified on one sentence -- "A is the ONLY option under which
`measureLine` agrees with what `drawWrapped` renders for the same range" -- and
clamp-plus-truncate fails it on one of the three cases the finding names. A
record that states a criterion while pinning a row that violates it is the F-24
shape, and the user-visible consequence is F-35 relocated rather than removed: a
caller measures a line at 16, `drawWrapped` renders 24 px of glyphs, and the
alignment is off by a glyph.

**The cause is the truncation, not the clamp.** `drawWrapped` clamps its indices
and does NOT pre-truncate them: it walks a fractional `i` and lets `charCodeAt`
truncate per ITERATION. **The door is therefore CLAMP-ONLY**, both `Math.trunc`
calls are gone, and row 29 / R2 flips from 16 to **24**. It is the only row that
moves; rows 24-28 and 30-33 keep their values, and termination is untouched --
after the clamp both bounds are finite and in `[0, len]` and the counter
increments by 1, which is the whole of F-34.

### Correction 2 to the session plan, applied here in place (2026-08-18)

`SESSION-M4.md` section 4 row 39, section 8.3.4 row Y2 and assertion A12 give
the B1 sequence at `y = 0.6` as `[1, 20, 39, 57, 76]`. The ratified B1 form is
`Math.round(y) + Math.round(i * lineHeight * scale)`, and at `i = 2` that is
`1 + Math.round(2 * 18.700000000000003)` = `1 + Math.round(37.400000000000006)`
= `1 + 37` = **38**, not 39. The correct B1 sequence is **`[1, 20, 38, 57, 76]`**
-- the `y = 0` row plus one, which is what B1 means. Every other cell of the row
is right, and B2's `[1, 19, 38, 57, 75]` reproduces exactly. The discriminating
indices between B1 and B2 are therefore **1** (20 vs 19) and **4** (76 vs 75);
indices 0, 2 and 3 agree. The formula is authoritative over the table, the
tables in this record carry the computed values, and the discriminator is still
a discriminator.

### Correction 3 to the session plan, applied here in place (2026-08-18)

`SESSION-M4.md` section 2.4 and assertion A15 state the cross-method relation as
exact "for every `i`, **every fractional `y`** and every fractional scale":

```
wrappedBaseline(i) === drawBaseline(i) + Math.round(this.base * scale)
```

**The fractional-`y` half is false, and it is false for exactly the reason B1 was
chosen.** `draw`'s line-0 anchor is `Math.round(y)`; `drawWrapped`'s is
`Math.round(y + base*scale)` -- one round of a composite -- and B1 changes
neither. `Math.round(y + base*scale)` equals `Math.round(y) +
Math.round(base*scale)` only when the two roundings do not compose. Measured on
`FONT_SNAP` at `scale` 1.1, `vAlign` 0:

| `y` | `draw` baselines | `drawWrapped` baselines | offset |
| --- | --- | --- | --- |
| 0 | 0, 19, 37, 56, 75 | 18, 37, 55, 74, 93 | **18** = `Math.round(base*scale)` |
| 0.6 | 1, 20, 38, 57, 76 | 18, 37, 55, 74, 93 | **17** |

**The relation that IS exact under B1, at every `y`, every scale and every
`vAlign`, and the one this session asserts:**

```
wrappedBaseline(i) - wrappedBaseline(0) === drawBaseline(i) - drawBaseline(0)
```

-- the two methods' per-line increments are identical, because both are
`anchor + Math.round(i * step)` with the same `step`. The offset between the two
anchors is `Math.round(y + base*scale) - Math.round(y)`, which is
`Math.round(base*scale)` at integer `y` and may be one less at a fractional one.
A15's original form is asserted at integer `y` (where PROBE (e) measured it) and
the constant-offset form is asserted at every `y` in the sweep. Writing the
assertion the plan's way at `y = 0.6` would have reddened a correct
implementation.

### Correction 4 -- a plan gap found during implementation (2026-08-18)

`SESSION-M4.md` section 0.10 and M4-T20 name `test/torture/t1-degenerate.mjs:130-139`
as "the primary casualty of this session" and section 12 lists exactly that file.
**It is not the only casualty.** `test/torture/t3-descriptor.mjs` row 44 carries
the same six measure pins, written by M3 under the heading "measure keeps ALL
FIVE degenerate answers -- no door in the pure fn", and fork (4) falsifies three
of them there too. The plan did not notice the duplicate, `t3-descriptor.mjs` is
absent from the files-touched table, and following the plan literally would have
left row 44 red at the final gate with no task owning it.

Row 44 is therefore inverted in place under the same discipline as T1 -- never
deleted, never demoted to `test.todo`, with an `M4` comment naming this record --
and it gains two things T1's block also gains: a valid-scale twin
(`measure('ABC', 2) === 2 * baseW`), so a door that rejects everything cannot
pass the row, and two explicit `_measureRange` no-door assertions, so "the public
faces gained a door" can never be misread as "the shared helper gained one".

Recorded as a plan gap rather than a coder improvisation, because the next
session's planner needs to know that a behaviour pin in this package can live in
two tiers at once.

### Correction 5 -- DONE WHEN row 9's method (2026-08-18)

Row 9 pins `_measureRange`'s body with `sed -n '370,391p' BitmapFont.js | shasum
-a 256` against the same range of the frozen copy. `BitmapFont.js` grew from 798
to 1001 lines and the method moved, so the literal line range no longer names the
method and the row as written compares two unrelated slices. **The row is
amended, in place, to extract both bodies BY CONTENT** -- locate
`_measureRange(text, start, end, scale) {` and take the 22 lines from it -- and
under that form the two shas are identical:

```
ba94f3bf4b9267fa55fc9d17c23aa4c7541edf2b9dac89e21c86d2ed335c5504
```

The guarantee it exists to prove is unchanged and it holds: fork (3) A2 shipped,
and `_measureRange`'s body did not change by one byte. Its JSDoc above the body
did change, to carry the F-34 precondition A2 owes; that is outside the pinned
range in both files.

### Correction 6 -- the A26 detector did not exist (2026-08-18, measured)

`SESSION-M4.md` assertion A26 and risk (d) both name **T6 window E's
`maxBytesPerCall: 0`** as -- explicitly -- "the only detector" of a
`measureWidest` implemented with `text.split()`. **Measured: it detects
nothing.** The split mutant passes window E's retained-bytes lane, passes its GC
lane, passes T0's residual law and T5's oracle differential (the oracle splits
too, and is allowed to), and leaves `npm run torture` green.

Three mechanisms compose, and none of them is a bug in this package:

1. `measureAllocs` / `maxBytesPerCall` is a **retention** lane by definition --
   `lite-gc-profiler/llms.txt`: `measureOps` "sees transient garbage that
   `measureAllocs` settles away". Garbage the scavenger reclaims measures as
   exactly 0 bytes per call.
2. `checkNoGc`'s `maxBytesPerOp` reads `summary.bytesPerOp`, but `measureOps`
   puts `bytesPerOp` on the **result**, not the summary. The rule reads
   `undefined` and **cannot fail at any threshold for any body.**
3. `stabilize: 'deep'`, which `runOpsGate` hardcodes because
   `maxArrayBuffersGrowth` requires it, additionally converts `bytesPerOp` from
   transient allocation into retention. The two rules cannot both be gated in one
   stabilize mode.

Recorded as **F-37** in `ROADMAP.md`. **The general fix belongs to M9** with
F-27/F-31/F-32; M4 does not half-fix a gate, because a row closed on a partial
fix is the F-33 shape.

**What M4 adds, scoped to its own two new bodies:** an allocation-VOLUME check on
windows E and F. Between collections `heapUsed` rises monotonically with
allocation and a scavenge shows as a negative delta, so the sum of the POSITIVE
deltas approximates total bytes allocated -- the quantity a retention lane throws
away. It is synchronous, which matters because the tier is synchronous: a
`PerformanceObserver` on `'gc'` delivers its entries on a later turn and
`takeRecords()` returns 0 from inside the loop.

| Body | allocation volume over 200,000 calls |
| --- | --- |
| shipped single-pass `measureWidest` | **0 B typical, 63,040 B worst** (8 reps, after a 20,000-call warmup) |
| the same body written with `split()` | **28,042,664 B** standalone; **32,884,736 B** measured through the gate |
| shipped `measureLine` | **0 B typical, 46,048 B worst** |

Limit: **1,000,000 bytes**, 15.9x above the worst zero-alloc observation and 28x
below the mutant. It is a GC-adjacent number and therefore environment sensitive,
which is why the margin is this wide and why it is stated rather than tuned
quietly. **Proven in both directions:** the shipped body passes on three seeds,
and the split mutant fails with
`T6/E: measureWidest allocated 32884736 bytes over 200000 calls (limit 1000000)`.

**The lesson, recorded because it is the one worth keeping:** the risk was
correctly identified before any code was written, and the mitigation named for it
was blind. A gate can be present, named in the plan, cited in a decision record,
and still measure nothing. The only thing that separated the two cases was
running the mutation.

## Fork (1) -- `measure()` semantics (F-06)

Options: **A** leave `measure` alone and add the missing two. **B** change
`measure` to return the widest line. **C** make `measure` throw on an embedded
newline.

**Decision: A now, B in M9. RATIFIED.**

New surface, both additive:

```
measureWidest(text, scale = 1.0) -> number              // max per-line width
measureLine(text, start, end, scale = 1.0) -> number    // one range, doored
```

**B is rejected for 1.4.0 on one ground and it is decisive: it is a SILENT
numeric change.** Every caller measuring a single-line string is unaffected;
every caller measuring a multi-line string gets a different number and nothing
throws, nothing warns, no test in their suite covers it, and the symptom is a
box that is the wrong size in a layout they will debug for an hour. Silent
numeric changes are the worst class of breaking change available, and a minor
version may not carry one. B is right, and it is right in 2.0.0 with a migration
note and a `Breaking` heading.

**C is rejected because it is hostile to the majority.** Most `measure` callers
pass strings that happen to be single-line. Making the common case throw to
force a decision the caller does not have to make is a tax on correct code.

**A's real cost, stated so it is not discovered later: the package now has THREE
width functions and a caller must choose.** That is answered with documentation,
not with cleverness: README, `llms.txt` and the d.ts each carry a "which width do
I want" table, and `measure`'s own JSDoc states plainly that it sums across
newlines and is a total advance, not a layout width -- a sentence that appears
nowhere in this package before 1.4.0.

**The M9 promotion, recorded verbatim for M9's planner:** in 2.0.0 `measure`
returns the widest line, `measureWidest` becomes an alias retained for source
compatibility, and the CHANGELOG carries a `Breaking` section naming
`measure('AA\nAA')` 32 -> 16 on an advance-8 font with the exact before/after
numbers. **Nothing in M4 may make that flip harder** -- in particular, no doc
sentence may describe the cross-newline sum as a *feature*, and no test may
assert it as a *desired* value rather than as a *pinned current* value with an
M9 comment beside it.

## Fork (2) -- where to round (F-07), and the B1/B2 sub-fork

Options: **A** accumulate rounded (`cursorY = Math.round(cursorY + lineHeight *
scale)` per line). **B** round at the use site from an exact accumulator.

**Decision: B, sub-fork B1. RATIFIED.**

The form, stated exactly so the coder implements the requirement and not a
paraphrase of it:

```
baseline(i) = Math.round(y) + Math.round(i * lineHeight * scale)
```

with `i` a per-line integer counter, `lineHeight * scale` never accumulated into
a running float, and `Math.round(y)` computed once per call.

**A is rejected because its error compounds.** Each line's rounding error feeds
the next line's input, so spacing wobbles between floor and ceil and after N
lines the block sits up to a full pixel from where the metrics say it should be.
Measured on `FONT_SNAP` at `lineHeight` 17, `scale` 1.1, from `y = 0`:

| Variant | Five baselines |
| --- | --- |
| today (1.3.0), no round | 0, 18.7, 37.4, 56.1, 74.8 |
| **B (ratified)** | **0, 19, 37, 56, 75** |
| A (accumulating) | 0, 19, **38, 57, 76** -- diverges from line 2 on |

A and B agree on lines 0 and 1 and diverge from line 2. A reviewer can tell which
implementation shipped by reading two arrays, and T9 control 11 ships A so the
claim is falsifiable rather than asserted.

### The B1-vs-B2 sub-fork, and why B1

Both satisfy the five-line table at `y = 0`. They diverge only at a fractional
`y`:

| Variant | `y = 0.6`, five baselines | Anchor semantics |
| --- | --- | --- |
| today (1.3.0) | 1, 19.7, 38.4, 57.1, 75.8 | one round, then raw accumulate |
| **B1 (ratified)** | **1, 20, 38, 57, 76** | measure from the SNAPPED first baseline |
| B2 | 1, 19, 38, 57, 75 | measure from the caller's RAW `y` |

(Correction 2 above: the plan's table wrote 39 at index 2. The formula gives 38.)

**Three reasons, in order of force:**

1. **B1 keeps `drawWrapped`'s existing two-round anchor legal, so the
   cross-method assertion costs ZERO behaviour delta.** B1's per-line term is
   `Math.round(i * step)` added to whatever the method's own line-0 anchor
   already is. `drawWrapped`'s line-0 anchor -- `Math.round(y + base*scale)`
   plus, for vAlign 1/2, `Math.round((boxHeight - totalHeight)/2)` -- is
   untouched, because B1 never re-derives line 0 from a raw `y`. Under B2 the
   whole anchor must collapse into one round, and that changes line 0 at
   fractional vAlign terms: measured, `y = 1.0`, `boxHeight = 104.7`,
   `vAlign = 1`, 5 lines, `lineHeight` 17, `scale` 1.1 -- composed gives **25**,
   collapsed gives **24**. B2 costs a declared line-0 delta in `drawWrapped`;
   B1 costs none. This is the fork's price tag and it is not close.
2. **The block's geometry becomes a function of what was actually drawn.** Under
   B1, line `i` sits exactly `Math.round(i * step)` pixels below the baseline the
   renderer *actually used* for line 0. Under B2 it sits relative to a `y` the
   renderer already discarded, so the visible gap between line 0 and line 1 can
   differ from the gap between line 1 and line 2 even though `step` is constant.
   B1's inter-line gaps are `round(i*step) - round((i-1)*step)`, the correct
   discretisation of a constant step; B2's line 0 is snapped by a *different*
   rule from its lines 1..N.
3. **B1 is one fewer float in flight in the hot body.** `Math.round(y)` is
   already computed. B1 reuses it. B2 requires keeping the raw `y` alive across
   the whole glyph loop to re-round per line.

**Rejected explicitly, with the consequence recorded:** B2 is defensible and is
arguably the more "honest" reading of the caller's `y`. It loses because it
forces a `drawWrapped` line-0 delta at vAlign 1/2 that buys nothing, and because
its inter-line spacing is less uniform. B2 ships as T9 control 12: a variant
computing `Math.round(y + i * step)` must make the fractional-`y` row go red. A
losing variant that cannot fail is decorative.

### The `drawWrapped` double-round resolution, stated as a settlement

`drawWrapped` rounds TWICE today on line 0 whenever `vAlign` is 1 or 2 --
`Math.round(y + base*scale)` and then `+ Math.round((boxHeight - totalHeight)/2)`
-- and `round(a) + round(b) !== round(a + b)` whenever both fractions round up.

**`drawWrapped`'s line-0 anchor is UNCHANGED in 1.4.0.** It keeps its exact
current arithmetic, including the two composed rounds at vAlign 1/2. What changes
is the per-line step: the raw accumulator `cursorY += this.lineHeight * scale;`
is deleted and replaced by a per-line `Math.round(l * this.lineHeight * scale)`
term added to a hoisted anchor.

Consequence, declared: at `vAlign === 0` the relation to `draw` is exact --

```
wrappedBaseline(i) === drawBaseline(i) + Math.round(this.base * scale)
```

-- for every `i`, every fractional `y` and every fractional scale. At `vAlign` 1
or 2 the same relation holds with the vertical centring term added, and that term
is rounded separately, exactly as it is today. There is **no line-0 behaviour
delta in `drawWrapped`**, and the declared-delta table says so as a positive
statement, not by omission.

## Fork (3) -- the range door on `measureLine` (F-34, F-35)

Options: **A** clamp exactly as `drawWrapped` does. **B** throw on any
non-integer or out-of-range index. **C** forward raw.

**Decision: A, sub-fork A2. RATIFIED.**

The door, stated exactly:

```
start and end are read with the NaN-safe idiom, and CLAMPED ONLY:
  if (!(start >= 0)) start = 0;          // rejects NaN and negatives
  if (!(start <= len)) start = len;
  if (!(end <= len)) end = len;          // NaN lands HERE, and becomes len
  if (!(end > start)) return 0;
NO truncation, and NO `end >= 0` leg. See the two subsections below.
```

**C is rejected on measurement, not on taste.** It publishes F-34 (an unkillable
loop -- row 12, SIGKILL at 6003 ms) and F-35 (a width `drawWrapped` will not
render -- row 15, 24 against 2 rendered glyphs) as supported API.

**B is rejected because it is hostile to the one caller this method exists
for.** A `layoutBuffer` is a `Float32Array`. Its indices are already
Float32-rounded, and `2.9999999` is a normal value there, not an error. A method
whose entire purpose is "measure the line my layout engine just produced" may not
throw on the representation that engine emits. A throw here is also a throw in a
per-frame path, which is the argument M1's option C and M2's fork (1) both lost
on.

**A is the ONLY option under which `measureLine` agrees with what `drawWrapped`
renders for the same range**, which is the finding stated as a requirement:
`[-0.5, 2)` reports two glyphs' width, matching the two glyphs `drawWrapped`
draws -- not the three `_measureRange` counts today. Correction 1 above records
the one implementation of A that failed this criterion and why it was replaced.

### The A1-vs-A2 sub-fork: where the clamp lives

- **A1:** at the head of `_measureRange`. One site, kills every path including
  `measure`'s and `draw`'s per-line align calls. Costs `draw` two comparisons and
  two truncations per align call, and `draw` makes one align call per line at
  `align` 1 or 2.
- **A2:** at the public faces only (`measure`, `measureLine`, `measureWidest`),
  leaving `_measureRange` an explicitly-unsafe internal carrying a comment that
  names F-34 and states the precondition its callers keep.

**Decision: A2. RATIFIED.**

1. **A1 taxes a path that has no bug.** `draw`'s align calls pass `0` and a
   computed `lineEnd`, both provably in `[0, len]` by construction. Every
   comparison A1 adds there is provably never taken. That is ROADMAP law 6
   exactly: bytes in a hot body to defend against a mistake made somewhere else.
2. **A1 changes the frozen body.** `_measureRange` is the one hot body M3 proved
   untouched and the one this session's DONE WHEN row 9 pins with a range sha.
   A1 makes that pin impossible and removes the cheapest structural guarantee in
   the plan.
3. **A2's boundary is provable, and the proof is not a comment.** T9 control 13
   drives an unbounded range through every public face in a child process that is
   killed if it does not exit. The comment on `_measureRange` documents the
   precondition; the control proves the boundary that keeps it.

A1 remained acceptable only on a measured T6 number showing A2 no cheaper. The
number did not call for it; A2 shipped and `_measureRange` is byte-for-byte
unchanged.

### Correction 7 -- the door had FOUR legs where the renderer has TWO (F-38)

The door as ratified and as first shipped read `!(start >= 0)`,
`!(start <= len)`, `!(end >= 0)`, `!(end <= len)`. **`drawWrapped`'s clamp has
only two legs:** `!(startIdx >= 0) -> 0` and `!(endIdx <= tlen) -> tlen`. The
extra `!(end >= 0) -> 0` leg fires FIRST on a NaN `end` and drives it to 0, where
the renderer's single leg drives NaN to `tlen` and draws the whole line.
Measured on `'AAAA'` at advance 8, before the fix:

| range | `measureLine` | `drawWrapped` | |
| --- | --- | --- | --- |
| `[0, NaN)` | 0 | 4 quads (32) | **DISAGREE** |
| `[NaN, NaN)` | 0 | 4 quads (32) | **DISAGREE** |
| `[1, NaN)` | 0 | 3 quads (24) | **DISAGREE** |
| `[0, 4)` | 32 | 4 quads (32) | agree |

This is fork (3)'s own criterion left unclosed, on the exact input the method
exists for: **a `layoutBuffer` is a `Float32Array`, and NaN is what it holds when
a layout pass failed or never ran.** It survived ratification because no tier
enumerated a NaN `end` -- every row in the plan's F-35 series uses a finite one.

**Fix: the `!(end >= 0)` leg is deleted.** A NaN `end` now falls to
`!(end <= len)` and becomes `len`. A negative `end` needs no leg: it stays
negative, hits `!(end > start)` and returns 0, and `drawWrapped`'s loop never
runs either -- both 0. Verified across nineteen ranges, all agreeing, including
`[0, -5)`, `[5, 2)`, `[-3, -1)`, `[Infinity, Infinity)` and `[-Infinity, NaN)`.
**Matrix row 32 flips from 0 to 32** and is the only row that moves.

Termination is unaffected, which is the whole of F-34: whatever reaches the walk
satisfies `0 <= start < end <= len` with both ends finite. NaN and both
infinities are absorbed by the three remaining legs.

### Why the door does NOT truncate, pinned so it cannot be improvised

The first implementation of this door clamped and then truncated both ends
toward zero, on the reasoning that after the clamp `start` and `end` are
non-negative and in `[0, len]`, so truncation toward zero and `Math.floor` agree
on every value the door can produce. **That reasoning is true and it is beside
the point.** The question fork (3) is decided on is not whether two rounding
modes agree with each other; it is whether `measureLine` walks the same indices
`drawWrapped` walks. Truncation makes it not.

`charCodeAt` applies `ToIntegerOrInfinity`, which truncates **toward zero** --
that is why `charCodeAt(-0.5)` reads index 0 and F-35 exists. `drawWrapped`
exploits that: it clamps once, up front, and then walks a **fractional** `i`,
letting `charCodeAt` truncate per ITERATION. So `[0.5, 2.7)` visits `i = 0.5,
1.5, 2.5` and renders three glyphs. A door that truncates both ends first
collapses that range to `[0, 2)` and reports two -- a width the renderer will not
draw.

**The door is CLAMP-ONLY.** Measured on `'AAAA'` at advance 8, clamp-only agrees
with `drawWrapped` on all three of `[-0.5, 2)`, `[0.5, 2.7)` and `[1.9, 3.1)`;
clamp-plus-truncate agrees on only two. Fork (3)'s criterion now actually holds
on every case the finding names, and T5 asserts it as the criterion -- for each
fractional range, `measureLine === (glyphs drawWrapped renders) * advance --
rather than as three unrelated literals.

`len` is `text.length` **after** the fork (4) text door has proven `text` is a
string. Order matters: the text door runs first, the range door second. A range
door that reads `.length` off a non-string is F-36 with extra steps.

## Fork (4) -- the measure family's fail signal (F-36)

Options: **A** full F-11 parity, silent -- reject and return 0. **B** the new
methods throw, `measure` unchanged. **C** NaN is the measure family's fail
signal, across all four.

**Decision: C. RATIFIED, with declared behaviour deltas.**

**A is rejected by the Law.** `null is not zero`. A 0 width is a value a layout
will happily act on -- it centres a box of width 0, it lays out a table column of
width 0, and nothing anywhere reports a problem. This is the exact case the Law's
sentence exists for.

**B is rejected because it is F-06's disease in a fresh surface.** Two policies
for one question, in a family of four functions, is how this package got here:
`measure` sums newlines and `draw` does not; `_measureRange` guards NaN one way
and `draw` guarded it the other. A four-function family gets one answer.

**C is a WIDENING of what `measure` already does**, not a new invention:
`measure('AA', NaN)` is already NaN today (row 19), and `measure('AA', Infinity)`
is already NaN. C makes the remaining three answers honest.

| Entry point | Door |
| --- | --- |
| `measure(text, scale)` | text door + scale door -> NaN |
| `measureWidest(text, scale)` | text door + scale door -> NaN |
| `measureLine(text, start, end, scale)` | text door + scale door + fork (3) range door -> NaN (text/scale) or 0 (empty range) |
| `_measureRange(text, start, end, scale)` | **NONE.** Explicitly-unsafe internal, fork (3) A2, unchanged body |

**Door ORDER is part of the contract:** text door, then scale door, then the
range door. A bad `scale` with an empty range returns **NaN**, not 0 -- the scale
door fires first and NaN wins.

**The text door:** `typeof text !== 'string'` -> return NaN. Not "array-like",
not "has a numeric length". `{length: Infinity, charCodeAt(){return 65}}` has a
numeric length and a `charCodeAt`, and it is exactly the input that hangs today
(row 13). `typeof text === 'string'` rejects it, and it is one test.

**The scale door:** `!(scale > 0 && scale < Infinity)` -> return NaN. The
identical predicate M3 shipped in the three draw bodies, in the identical
NaN-safe idiom (ROADMAP law 4). It rejects NaN (both comparisons false),
`Infinity` (upper bound), `0` and negatives (lower bound). **It is a RANGE test,
not a NaN test.** A door written `if (scale !== scale)` leaves `measure('AA', -1)`
returning -16 forever with no NaN anywhere for any scan to find.

**Amendment, CORRECTED 2026-08-18 (F-40).** This record originally claimed that
"a font that constructs cannot produce a NaN width from valid input", and used
that to argue NaN is unambiguously the fail signal. **The claim is false and it
was never true, in 1.3.0 either.** With mixed-sign Int16 advances at an extreme
but IN-DOOR scale:

| call | result |
| --- | --- |
| advances `32767` and `-32768`, `measure('AB', Number.MAX_VALUE)` | **NaN** (`+Infinity + -Infinity`) |
| advance `32767`, `measure('A', Number.MAX_VALUE)` | **Infinity** |

`Number.MAX_VALUE` passes `!(scale > 0 && scale < Infinity)`, so the door accepts
it; the overflow happens in the arithmetic downstream. **Both behaviours are
identical in 1.3.0, so there is no 1.4.0 delta and the door is NOT changed here**
-- narrowing it needs a magnitude bound nobody has derived, and inventing one in
a session that did not measure it is how a fail-closed door becomes a fail-wrong
one.

**The honest statement of the fail signal, which replaces the amendment:** NaN is
what the measure family returns for an argument it cannot use, and it is the only
thing the DOORS produce. It is not a unique signal in the absolute: mixed-sign
Int16 advances at an extreme in-door scale can also produce NaN or Infinity by
arithmetic. A caller distinguishing the two cases must check the scale itself.
**The magnitude question -- whether the scale door should carry an upper bound
below `Infinity`, and what it should be -- is M9's**, alongside F-08's storage
half, since both are about what the Int16 store can represent.

**The asymmetry with the renderers is deliberate and documented, not hidden.**
`draw`/`drawFast`/`drawWrapped` answer a bad `scale` by drawing nothing; the
measure family answers by returning NaN. The reason, in one sentence: **a
renderer can decline to act, a query cannot decline to answer.** A caller who
passes `scale: NaN` to both in one frame gets zero pixels and a NaN width, and
both are honest.

## Fork (5) -- what `measureLine` returns for an EMPTY range

Not asked anywhere in the brief. It must be settled, because fork (3)'s clamp
produces empty ranges routinely: `[-0.5, -0.5)`, `[5, 2)`, `[len, len)`.

Options: **A** return `0`. **B** return NaN, on the grounds that the caller asked
for something meaningless.

**Decision: A -- an empty range measures 0. RATIFIED.**

(i) It is arithmetically correct: the sum of an empty set of advances is 0, and
`_measureRange('AAAA', 2, 2, 1)` returns 0 today. (ii) It matches what
`drawWrapped` renders, which is fork (3)'s whole criterion: an `endIdx` below
`startIdx` draws an empty line, and its width is 0. (iii) It keeps NaN meaning
exactly one thing -- "you gave me an argument I cannot use" -- which is fork (4)'s
value. An empty range is a usable argument with a boring answer.

Consequence for the matrix: rows 24-27 return **0**, not NaN, and each carries
its non-vacuity twin (a one-glyph range returning a non-zero width), because a
`measureLine` that returns 0 for everything passes every empty-range row.

## Fork (6) -- does `measureWidest` count the newline character itself?

M2 settled `\n` by zeroing all seven glyph slots for id 10 at construction and
stripping id 10 from the kerning table. So id 10 advances 0 and kerns 0 in
`_measureRange` for every font, including a descriptor that maps it.

Options: **A** `measureWidest` splits at id 10 and measures each segment with the
same walk `_measureRange` uses, resetting the kerning chain at the break --
matching `draw`. **B** one continuous walk with a running max, letting the
kerning chain cross the break.

**Decision: A -- split at id 10, reset the kerning chain at the break, matching
`draw`. RATIFIED.**

`measureWidest` exists to answer "how wide is the widest line that `draw` will
render". `draw` resets `prevId = -1` at every newline. A `measureWidest` that
carries the kerning chain across the break answers a question about a string
nobody draws, and it would disagree with `draw`'s own per-line align calls --
F-06's disease reproduced inside the fix for F-06.

**The implementation constraint that falls out, and it is the whole hot-path
story of this method:** A is expressible as a single pass with no allocation, no
`split`, no `slice`. Walk `i` from 0 to `len`; on `id === 10`, compare the running
line width against the max, reset the line width to 0 and `prevId` to -1;
otherwise apply the same kerning-plus-advance step `_measureRange` applies. One
pass, two extra locals, zero allocation. **A `text.split('\n')` inside this method
is a REJECTED, not a discussion** -- it allocates an array plus a string per line,
per call. **What forbids it is T6 window E's allocation-VOLUME check, not its
`maxBytesPerCall: 0` lane** -- see correction 6 below, which measured the
difference.

Equivalence, asserted rather than assumed: for every corpus string,
`measureWidest(s, k) === Math.max(...s.split('\n').map(l => measure(l, k)))`,
where the right-hand side is the allocating oracle, computed in T5 outside every
measured window. The oracle may allocate; the library may not. **On a kerningless
font both fork (6) options are arithmetically identical**, so the assertion runs
on `FONT_SNAP_KERN` as well -- the only fixture that can see the difference.

## Fork (7) -- does `measureWidest` get the fork (3) range door?

`measureWidest` has no `start`/`end` parameters, so F-35 does not touch it. But
F-34 does, through the text door.

**Decision: `measureWidest` gets the fork (4) text door and scale door, and NO
range door, because it has no range. RATIFIED.**

Recorded because it looks like an omission and is not: the F-34 control drives
all three public faces, including `measureWidest`, and it is the text door -- not
a range door -- that makes `measureWidest` terminate. A coder who "harmonises" by
adding a range door to a method with no range has added dead bytes to a hot body.

## Fork (8) -- `measureLine`'s signature, and M6 compatibility

**Decision: `measureLine(text, start, end, scale = 1.0)`. RATIFIED.**

The order matches `_measureRange(text, start, end, scale)` exactly, and it
matches the shape M6 will add to `draw` (`text, start, end` after the
ctx/geometry arguments). `scale` is last and defaulted, so a caller writing
`measureLine(t, a, b)` gets scale 1, matching `measure(t)`.

**Rejected: `measureLine(text, lineIndex, layoutBuffer)` or any form that takes
the layout buffer.** It looks convenient and it couples this package's measure
surface to the cross-package `Float32Array` stride (ROADMAP law 1), which is a
format contract and a major-version hostage. The caller reads `layoutBuffer[l*4]`
and `[l*4+1]` themselves; the README recipe already shows that read.

## Forks at a glance

| Fork | Question | Decision | Rejected |
| --- | --- | --- | --- |
| **(1)** | `measure` semantics (F-06) | **A now, B in M9. RATIFIED** | B (silent numeric break in a minor), C (hostile to single-line callers) |
| **(2)** | Where to round (F-07) | **B, sub-fork B1. RATIFIED** | A (compounding drift), B2 (forces a `drawWrapped` line-0 delta) |
| **(3)** | `measureLine` range door (F-34/F-35) | **A, sub-fork A2. RATIFIED** | B (throws on Float32 indices), C (publishes a hang), A1 (taxes `draw`'s align calls) |
| **(4)** | Measure-family fail signal (F-36) | **C, NaN across all four. RATIFIED** | A (`null is not zero`), B (two policies for one question) |
| **(5)** | Empty range's return | **0, not NaN. RATIFIED** | NaN (an empty range is a usable argument) |
| **(6)** | Does `measureWidest` cross `\n`? | **A: split at id 10, reset the kerning chain. RATIFIED** | B (measures a string nobody draws) |
| **(7)** | Range door on `measureWidest`? | **No range door; text + scale doors only. RATIFIED** | adding one (dead bytes in a hot body) |
| **(8)** | `measureLine` signature | **`(text, start, end, scale = 1.0)`. RATIFIED** | a layout-buffer-taking form |

**RATIFIED count: 8. Unsettled count: 0. Undecided count: 0.**

## The accept/reject matrix -- one row per input, every row routed

Fixture for every literal below: **`FONT_SNAP`** (advance 8, `lineHeight` 17,
`base` 16).

### The measure family

| # | Entry point | Input | Lane | 1.4.0 result | 1.3.0 result | Asserted by |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `measure` | `('AA\nAA')` | ACCEPT | **32** | 32 | T5, node:test |
| 2 | `measure` | `('A\nAAAAAA')` | ACCEPT | **56** | 56 | T5, node:test |
| 3 | `measure` | `('AA', 2)` | ACCEPT | **32** | 32 | T0 (scale law) |
| 4 | `measure` | `('')` | ACCEPT | **0** | 0 | T0, T1 |
| 5 | `measure` | `('AA', 1e-45)` | ACCEPT | **>= 0**, finite | 1.6e-44 | T1 (unchanged) |
| 6 | `measure` | `('AA', 0)` | **REJECT -> NaN** | **NaN** | **0** | T1 (inverted), T5 |
| 7 | `measure` | `('AA', -1)` | **REJECT -> NaN** | **NaN** | **-16** | T1 (inverted), declared delta |
| 8 | `measure` | `('AA', NaN)` | REJECT -> NaN | NaN | NaN | T1 (unchanged, now by policy) |
| 9 | `measure` | `('AA', Infinity)` | REJECT -> NaN | **NaN** | NaN (non-finite) | T1 (tightened to exact NaN) |
| 10 | `measure` | `(123)` | **REJECT -> NaN** | **NaN** | **0** | T5, node:test, declared delta |
| 11 | `measure` | `(null)` / `(undefined)` | **REJECT -> NaN** | **NaN** | raw `TypeError` | T5, node:test, declared delta |
| 12 | `measure` | `({length: Infinity, charCodeAt(){return 65}})` | **REJECT -> NaN** | **NaN, returns** | **HANGS (SIGKILL 6 s)** | T9 control 13, T5 |
| 13 | `measure` | `([])` / `({})` / `(true)` | REJECT -> NaN | NaN | 0 / 0 / 0 | T5 |
| 13b | all three | `(new String('AAA'))` -- a BOXED String | REJECT -> NaN | **NaN** (F-41: `typeof` is exact, and the looser array-like test admits the input that hangs) | 24 | node:test, T5 |
| 14 | `measureWidest` | `('AA\nAA')` | ACCEPT | **16** | -- (new) | T5, node:test |
| 15 | `measureWidest` | `('A\nAAAAAA')` | ACCEPT | **48** | -- | T5, node:test |
| 16 | `measureWidest` | `('AA')` (no newline) | ACCEPT | **16** -- equals `measure` | -- | T0 (equivalence law) |
| 17 | `measureWidest` | `('')` | ACCEPT | **0** | -- | T0, T5 |
| 17b | `measureWidest` | a font with NEGATIVE advances, `('AAA')` | ACCEPT | **-30**, negative (F-39: the accumulator seeds at `-Infinity`, not 0; an all-positive fixture cannot see this) | -- | T5, node:test |
| 18 | `measureWidest` | `('\n')` | ACCEPT | **0** (two empty lines) | -- | T5 |
| 19 | `measureWidest` | `('\n\n\nAAA')` | ACCEPT | **24** | -- | T5 |
| 20 | `measureWidest` | `('AAA\n')` (trailing) | ACCEPT | **24** | -- | T5 |
| 21 | `measureWidest` | bad `scale` (0, -1, NaN, Infinity) | REJECT -> NaN | **NaN**, four cases | -- | T5, node:test |
| 22 | `measureWidest` | non-string text (123, null, `{length:Infinity,...}`) | REJECT -> NaN | **NaN, returns** | -- | T9 control 13, T5 |
| 23 | `measureLine` | `('AAAA', 0, 4, 1)` | ACCEPT | **32** | -- | T0, T5 |
| 24 | `measureLine` | `('AAAA', 2, 2, 1)` | ACCEPT (empty) | **0** (fork 5) | -- | T5 |
| 25 | `measureLine` | `('AAAA', 5, 2, 1)` | ACCEPT (empty after clamp) | **0** | -- | T5 |
| 26 | `measureLine` | `('AAAA', 4, 4, 1)` | ACCEPT (empty) | **0** | -- | T5 |
| 27 | `measureLine` | `('AAAA', -3, -1, 1)` | ACCEPT (empty after clamp) | **0** | -- | T5 |
| 27b | **twin** `measureLine` | `('AAAA', 0, 1, 1)` | ACCEPT | **8**, non-zero | -- | T5 (proves 24-27 are not vacuous) |
| 28 | `measureLine` | `('AAAA', -0.5, 2, 1)` | CLAMP | **16** (2 glyphs, matching `drawWrapped`) | `_measureRange` -> **24** | T5 (F-35 kill), node:test |
| 29 | `measureLine` | `('AAAA', 0.5, 2.7, 1)` | CLAMP (no trunc) | **24** -- the 3 quads `drawWrapped` renders (correction 1; the plan's 16 came from a truncating door and violated fork (3)'s criterion) | `_measureRange` -> **24**, `drawWrapped` 3 quads | T5 |
| 30 | `measureLine` | `('AAAA', 1.9, 3.1, 1)` | CLAMP (no trunc) | **16** (agrees today) | 16 | T5 |
| 31 | `measureLine` | `('AAAA', -Infinity, Infinity, 1)` | CLAMP | **32, RETURNS** | **HANGS** | T9 control 13, T5 |
| 32 | `measureLine` | `('AAAA', NaN, NaN, 1)` | CLAMP -> WHOLE LINE | **32** (corrected by F-38: NaN start -> 0, NaN end -> len, which is what `drawWrapped` renders for the same pair. The plan's 0 came from a four-leg door) | hangs/garbage | T5, node:test |
| 33 | `measureLine` | `('AAAA', 0, 99, 1)` (`end` past len) | CLAMP to len | **32** | 32 | T5 |
| 34 | `measureLine` | bad `scale`, four values | REJECT -> NaN | **NaN** (scale door fires BEFORE the range door) | -- | T5, node:test |
| 35 | `measureLine` | non-string text | REJECT -> NaN | **NaN** | -- | T5 |
| 36 | `_measureRange` | any input | **NO DOOR (A2)** | **unchanged, byte-for-byte** | unchanged | DONE WHEN row 9 (range sha) |
| 37 | all four | after `destroy()` | unchanged | raw `TypeError` | raw `TypeError` | T5, node:test |

### The two multi-line renderers (F-07)

| # | Method | Input | Lane | 1.4.0 result | 1.3.0 result | Asserted by |
| --- | --- | --- | --- | --- | --- | --- |
| 38 | `draw` | `('A\nB\nC\nD\nE', 0, 0, 1.1)` baseline column | FIXED | **0, 19, 37, 56, 75** | 0, 18.7, 37.4, 56.1, 74.8 | T5 Y table, node:test |
| 39 | `draw` | same at `y = 0.6` | FIXED (B1) | **1, 20, 38, 57, 76** (correction 2) | 1, 19.7, 38.4, 57.1, 75.8 | T5 discriminator, T9 controls 11/12 |
| 40 | `draw` | same at `scale = 1` | unchanged | **0, 17, 34, 51, 68** | identical | T5 (proves the fix is narrow) |
| 41 | `draw` | same at `scale = 1/3` | FIXED | every baseline `Number.isInteger` | drift 0.333 px | T5 |
| 42 | `draw` | single-line `('A', 0, 0.6, 1.1)` | unchanged | **baseline 1** | 1 | T5 (B1 and B2 agree -- NOT a discriminator) |
| 43 | `draw` | glyph x column at `scale = 1.1` | **unchanged, NOT snapped** | **0, 8.8, 17.6, 26.400000000000002** | identical | T0 law 1, T5 |
| 44 | `drawWrapped` | 5 lines, `y = 0`, `scale = 1.1`, `vAlign = 0` | FIXED | **18, 37, 55, 74, 93** | 18, 36.7, 55.4, 74.1, 92.8 | T5, node:test |
| 45 | `drawWrapped` | line-0 anchor at `vAlign` 1/2, fractional centring | **UNCHANGED** | same as 1.3.0 (**25** on the pinned fixture) | 25 | T5, positive statement |
| 46 | `drawWrapped` | vs `draw`, same lines, fractional `y`, `vAlign = 0` | FIXED | `wrapped(i) - wrapped(0) === draw(i) - draw(0)` at every `y`; the offset is `Math.round(base*scale)` at integer `y` (correction 3) | offset varies per line | T5 |
| 47 | `drawFast` | any | **UNTOUCHED** | single line, `Math.round(y)` | identical | DONE WHEN row 8 (zero hunks) |
| 48 | all three | bad `scale` (0, -1, NaN, Infinity) | unchanged (M3) | **0 drawImage calls** | 0 calls | T3 (unchanged) |
| 49 | `draw` / `drawWrapped` | `align` outside {0,1,2} | unchanged (M3) | renders LEFT | LEFT | T1 (unchanged) |
| 50 | `drawWrapped` | `vAlign` outside {0,1,2} | unchanged (M3) | renders TOP | TOP | T3 (unchanged) |

**Row count: 50 plus one twin. Lanes: 51. Undecided: 0.**

## The hot-path section of the record

### The committed per-glyph number is ZERO, in all six bodies

| Body | Per-glyph before | Per-glyph after | Per-line before | after | Per-call before | after |
| --- | --- | --- | --- | --- | --- | --- |
| `_measureRange` | 2 | **2 (untouched)** | 0 | **0** | 0 | **0** |
| `measure` | -- | -- | -- | -- | 0 | **+1 `typeof`, +2 comparisons** |
| `measureWidest` (new) | -- | **2 + 1 id-10 compare** | -- | **1 max compare, 2 resets** | -- | **the two doors** |
| `measureLine` (new) | -- | **2 (via `_measureRange`)** | -- | -- | -- | **the two doors + 4 clamp compares + 2 truncs** |
| `draw` | 2 + 1 `&&` + 1 `!` | **unchanged** | 0 | **+1 multiply, +1 round, +1 add, +1 increment; -1 add** | +1 round | **+1 multiply (hoisted `step`)** |
| `drawFast` | -- | **unchanged** | -- | **unchanged** | 3 + 2 (M3) | **unchanged** |
| `drawWrapped` | 2 + 1 `&&` + 1 `!` | **unchanged** | +2 (M2) + flags (M3) | **+1 multiply, +1 round, +1 add; -1 add** | 2 + 2 (M3) | **+1 multiply (hoisted `step`)** |

**THE COMMITTED BUDGET, as one sentence: ZERO new per-glyph instructions in every
body; one multiply hoisted per call in `draw` and `drawWrapped`; a net +2 per LINE
in each; and two new methods whose per-glyph cost is the same 2-comparison step
`_measureRange` already pays.**

The per-line change is a near-substitution. `cursorY += lineHeight * scale` (one
multiply, one add) becomes `anchorY + Math.round(i * step)` (one multiply, one
round, one add) with `step` hoisted. Net: one `Math.round` and one integer
increment per LINE. A 12-line paragraph pays 12 rounds where it previously paid
1, against several hundred glyph iterations. "Obviously negligible" is not a
measurement, so the number is below.

### "assertOps" -- what the gate actually is

`OpsRules` has no throughput rule in the installed profiler v1.15.0, so
"assertOps" cannot mean a throughput gate. It resolves into four things, three
gated and one recorded:

1. **GATED** -- `runOpsGate` / `checkNoGc`, `RULES = { maxMajor: 0,
   maxPauseMs: 4, maxArrayBuffersGrowth: 0 }`, on T6's **six** windows,
   `stabilize: 'deep'`.
2. **GATED** -- `runAllocGate` / `checkAllocs`, `ALLOC_RULES =
   { maxBytesPerCall: 0 }`, on the same six. Gate on `verdict !== 'pass'`; there
   is no `.ok` on that lane. **This is a RETENTION lane and it cannot see
   transient per-call allocation** (correction 6, F-37).
3. **GATED, windows E and F only** -- the allocation-VOLUME check: the sum of
   positive `heapUsed` deltas across 200,000 calls, limit 1,000,000 bytes. This
   is what actually forbids a `split()`-based `measureWidest`.
3. **GATED** -- the exact `rec.total` integers. Windows A-D unchanged; E and F
   are 0 (neither method draws).
4. **RECORDED, not gated** -- the four paired child-process `measureOps` medians,
   verdict rule `>= 0.97` on each, `drawFast` acting as the negative control.

### The four paired `measureOps` medians (verdict rule `>= 0.97`)

Five reps per variant, interleaved `old,new,old,new`, each rep in its own child
process, identical measured body, only the imported module path differs.
`ops/sec`, higher is better.

**The bench's own noise floor, measured FIRST and recorded because it changes how
the ratios are read:** the identical-code control (both variants pointing at the
frozen file, 5 reps) produced ratios of 0.9648, 0.9639, 0.9824 and 0.9698. A
`>= 0.97` rule on a 5-rep run is therefore inside this machine's noise, and every
number below is an 11-rep run with the sub-threshold body re-measured at 21.

| Body | v1.3.0 median [min..max] | v1.4.0 median [min..max] | ratio | verdict |
| --- | --- | --- | --- | --- |
| `draw` (3 lines, 62 glyphs, `y = 0.6`, `scale = 1.1`) | 1,843,264 [1,680,139..1,872,541] | 1,895,545 [1,884,280..1,913,390] | **1.0284** | pass |
| `drawWrapped` (8 lines x 8 glyphs, `y = 0.6`, `scale = 1.1`) | 2,093,571 [2,046,372..2,117,947] | 2,074,952 [2,042,425..2,124,310] | **0.9911** | pass |
| `measure` (S64, 64 chars) | 8,107,407 [7,395,761..8,262,756] | 7,485,394 [7,328,974..8,212,878] | **0.9233** | **below 0.97 -- see below** |
| `drawFast` (negative control -- takes no new instruction) | 13,016,526 [12,822,876..13,630,478] | 13,126,913 [12,655,224..13,740,708] | **1.0085** | pass, and the control behaved as a control |

Re-measured after the fork (3) door was changed to clamp-only (correction 1),
which removed two `Math.trunc` calls per `measureLine` call. `measure` does not
call `measureLine`, so its ratio did not move: 0.9122 before, **0.9233** after,
both inside the spread of the other. The number is recorded as measured and was
not tuned toward a threshold. **Four other `measure` ratios appear below, from
runs at different rep counts and against deliberately-broken variants; they are
reconciled in the table under "`measure`'s 0.91-0.93" so no reader has to guess
which one is the shipped figure.** The shipped figure is this row.

`bytesPerOp`: `draw` 0.00256 both sides, `drawWrapped` 0.0024 both sides,
`measure` 0 both sides, `drawFast` 0 both sides. `gc.major` 0 and `gc.maxMs` 0.00
on every run, both sides.

**The F-07 fix is free on the two bodies it touches.** `draw` and `drawWrapped`
are the sites that gained a multiply, a round, an add and an increment per LINE,
and both measured at or above parity. `drawFast`, which takes no new instruction,
came in at 1.0006 -- so the harness is measuring what it claims to.

### `measure`'s 0.91-0.93, run to ground rather than explained away

Risk (f) says a ratio below 0.97 triggers a re-measure with more reps and a
recorded number, and NEVER reverts a correctness fix. Both were done.

Re-measured at 21 reps: **0.9276**. The cost is real, not noise. So the next
question is *what* costs it, and the answer is not the thing that looks guilty.

**Reading the five `measure` figures in this record, since they are all
different and none of them contradicts another.** Every one is `v1.4.0 median /
v1.3.0 median` on the same body, and they differ only in rep count and in which
variant of 1.4.0 was built:

| figure | what it is | reps |
| --- | --- | --- |
| **0.9122** | shipped 1.4.0, the truncating door | 11 |
| **0.9276** | shipped 1.4.0, the truncating door, re-measured to rule out noise | 21 |
| **0.9233** | shipped 1.4.0, the final clamp-only door (the headline table above) | 11 |
| **0.9064** / **0.9082** | shipped 1.4.0 inside the two isolation runs below | 9 each |

The spread across all five is 2.3 percentage points and each figure's min-max
range overlaps the others', so the honest summary is **`measure` runs at roughly
0.91-0.93 of its 1.3.0 throughput**, and the single-figure precision of any one
row is not real. What IS stable across every run is the SHAPE: the doors are
free, and the cost appears only when both new methods are present. The isolation
tables below are the evidence for that, and they were all taken in one sitting
against one frozen baseline, so their ratios are comparable to each other even
where they are not identical to the headline row.

Four variants, 9 reps each, all against the same frozen baseline:

| Variant | ratio |
| --- | --- |
| v1.3.0 frozen | 1.0000 |
| v1.3.0 **plus `measure`'s two doors and nothing else** | **1.0013** |
| v1.4.0 **with `measure`'s two doors removed** | **0.9098** |
| v1.4.0 shipped | 0.9064 |

**The doors are free.** The per-call budget this record commits -- one `typeof`
and two comparisons -- costs nothing measurable, and removing them from the
1.4.0 file does not recover the throughput. The cost is elsewhere in the file.
Narrowing again:

| Variant | ratio |
| --- | --- |
| v1.4.0 without `measureWidest` | **0.9910** |
| v1.4.0 without `measureLine` | **0.9887** |
| v1.4.0 with both | **0.9082** |

**Neither method costs anything on its own; only both together do.** That is a V8
tiering threshold -- the class crosses an inlining budget once both bodies are
present, and `_measureRange` stops being inlined into `measure`'s call site --
not an algorithmic cost and not an instruction this session added to `measure`.
The per-glyph budget is met exactly as committed: zero new per-glyph instructions
in every body, and `_measureRange`'s body is byte-for-byte unchanged.

**It is recorded as the price of the surface and the promise stands.** Dropping
either method is not available -- F-06 needs `measureWidest` and F-34/F-35 need
`measureLine`, and shipping one without the other is the two-policies-for-one-
question shape fork (4) exists to prevent. The honest sentence: **1.4.0 costs
7-9% of `measure`'s throughput on a 64-character string, roughly 10 ns per call,
to buy a measure family that terminates, answers a bad argument honestly, and can
tell a caller how wide their box needs to be.** M9, which collapses
`measure` into `measureWidest`, is the session that can win it back; a note to
that effect belongs in M9's brief.

### Structural cost

**Zero.** M4 adds no per-font typed array and no per-font field. `_charScratch`
24, `glyphs` 3584, `kerning` 131072, `_mapped` 32, total **134,712** -- unchanged
from `decisions/0002` and pinned at four equalities in `t6-alloc.mjs`. If the
structural total moves in this session, something was added that the plan did not
authorise, and `destroy()` needs no change.

### GC budget

`gc_maxMajor: 0`, `gc_maxPauseMs: 4`, `alloc_bytes_per_op: 0`,
`leak_cycles: 4096`.

## Declared behaviour deltas -- 1.3.0 -> 1.4.0

### The measure family (fork 4)

| # | Call | 1.3.0 | 1.4.0 | Class |
| --- | --- | --- | --- | --- |
| D1 | `measure(123)` | **0** | **NaN** | fail-open -> fail-closed |
| D2 | `measure(null)` / `measure(undefined)` | raw `TypeError` | **NaN** | raw throw -> fail signal |
| D3 | `measure('AA', -1)` | **-16** | **NaN** | negative width -> fail signal |
| D4 | `measure('AA', 0)` | **0** | **NaN** | 0-is-a-value -> fail signal |
| D5 | `measure('AA', Infinity)` | NaN (non-finite by arithmetic) | NaN (by policy) | **NOT a value delta.** Declared because the *reason* changes and the T1 pin tightens from "non-finite" to "exactly NaN" |
| D6 | `measure([])`, `({})`, `(true)` | **0** | **NaN** | same class as D1 |
| D7 | `measure({length: Infinity, charCodeAt(){return 65}})` | **HANGS (SIGKILL)** | **NaN, returns** | S1 -> fixed. F-34 |

### The renderers (fork 2)

| # | Call | 1.3.0 | 1.4.0 | Class |
| --- | --- | --- | --- | --- |
| D8 | `draw`, multi-line, fractional `lineHeight * scale`, line index >= 1 | off-grid (`18.7, 37.4, ...`) | **snapped** (`19, 37, ...`) | F-07 fixed. Up to 0.5 px per line |
| D9 | `drawWrapped`, same condition, line index >= 1 | off-grid (`36.7, 55.4, ...`) | **snapped** (`37, 55, ...`) | same |
| D10 | `draw` / `drawWrapped`, **line 0** | `Math.round(y)` / `Math.round(y + base*scale)` (+ the vAlign rounds) | **IDENTICAL** | **NOT a delta.** Stated positively because B1 was chosen to make it so |
| D11 | `draw` / `drawWrapped` at integer `lineHeight * scale` | integers | **IDENTICAL** | **NOT a delta.** Blast radius is fractional scales only |
| D12 | glyph X at any scale | not snapped per glyph | **not snapped per glyph** | **NOT a delta.** Stated because "pixel-snapped" invites the assumption |
| D13 | `drawFast` | any | **IDENTICAL** | **NOT a delta.** Single-line; zero hunks |

### Additions (not deltas)

| # | Surface | 1.3.0 | 1.4.0 |
| --- | --- | --- | --- |
| D14 | `measureWidest(text, scale)` | absent | present |
| D15 | `measureLine(text, start, end, scale)` | absent | present |
| D16 | `VERSION` | `'1.3.0'` | `'1.4.0'` |

### Explicitly NOT changing

| Surface | Status |
| --- | --- |
| `measure(s)` for a valid multi-line string | **32 stays 32.** M9's breaking change, deliberately not taken here |
| `_measureRange`'s body and its behaviour on any input | **byte-for-byte identical**, including the `(-Infinity, Infinity)` hang (fork 3 A2) |
| Post-destroy error type on the measure family | raw `TypeError`, unchanged |
| The `scale` / `align` / `vAlign` / `flags` contracts | M3's, unchanged |
| The constructor, `hasGlyph`, `destroy` | unchanged |
| Structural bytes per font | **134,712, unchanged** |

## X is not snapped per glyph, and the reason is measured

At `scale = 1.1` the glyph x column is `0, 8.8, 17.6, 26.400000000000002` in both
`draw` and `drawFast`; only the line **origin** is rounded. Rounding each glyph's
x would break **T0 law 1**, which asserts `walk === _measureRange === oracle`
exactly, with no epsilon anywhere in the tier. A per-glyph round makes `walk` a
different number from the advance sum, and the law dies. It is also per-glyph
bytes in a hot body to serve a cosmetic preference (ROADMAP law 6).

**The promise is therefore per-line-origin in X, per-baseline in Y**, and the
docs say exactly that instead of leaving a reader to infer the stronger claim
from the words "pixel-snapped".

## Semver

**1.4.0 -- additive plus declared deltas, and the one genuinely breaking change
is deliberately NOT in it.**

The additions (`measureWidest`, `measureLine`) are pure additions. The deltas are
D1-D9. **The claim, stated AS a claim: no working call site changes.**

The argument for it: D1, D2, D6 and D7 replace a fail-open answer, a raw
`TypeError` and a hang with a fail signal, and none of the four can be part of a
call site that produces correct output. D3 and D4 replace a negative and a zero
width; a layout acting on either produces a box of impossible or invisible size.
D8 and D9 move text by at most 0.5 px per line, **onto** the pixel grid, which is
the documented promise the method already made.

**The reason it is a claim and not a fact:** a caller may be pre-clamping `scale`
to 0 to hide text and reading `measure`'s 0 as a valid "hidden" width -- D4 turns
that into NaN and their layout arithmetic becomes NaN too. A caller may be
compensating for F-07's drift by pre-rounding their own `y` -- D8 makes the two
corrections compose and their text moves a pixel. A caller may be catching
`TypeError` around `measure(userInput)` -- D2 makes that catch stop firing. None
of these render correct pixels today; all of them are call sites that exist.

**Why not 2.0.0:** because the change that would justify it -- fork (1)'s
`measure` returning the widest line -- is explicitly not taken here, and a major
bump should collect every breaking change in one release rather than dribbling
them across four.

**Why not 1.3.1:** because a patch may not add public methods, and it may not
change a documented return value from `-16` to `NaN`.

---

MIT (c) Zahary Shinikchiev <shinikchiev@yahoo.com>
