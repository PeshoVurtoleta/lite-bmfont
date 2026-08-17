# 0002 -- cursor conservation and the NaN cursor

Status: accepted
Session: M2 (v1.2.3)
Findings: F-03, F-04, F-05, F-12, F-21, F-24, F-25
Date: 2026-08-17
Frozen baseline sha256: `ead84b59fe58993b3f743703755bc5dccb40fd80078723bd3ea6bfa754a5300c`

## The question

Nothing in this package can state where the cursor is supposed to be, so nothing
can notice when it stops being there. `draw`, `drawWrapped` and `_measureRange`
each walk a glyph run advancing a cursor by `xadvance + kerning`, but the three
walks disagree on the degenerate inputs -- a NaN char code, a negative or NaN
layout index, an id 10, an unmapped glyph -- and there is no independent witness
that pins the agreement. ROADMAP section 2 states the conservation law that
supplies the witness:

> For a newline-free, fully renderable range, the pixel advance is conserved
> across three independent computations. `walk` = the rendered cursor delta,
> `dx[calls-1] + advance(last) - dx[0]`, read straight out of the recording ctx.
> `_measureRange` = the library's own width helper. `oracle` = a sum of
> `(xadvance + kerning)` taken from the ORIGINAL BMFont JSON in doubles, never
> touching the Int16 store. The law is `walk === _measureRange === oracle`,
> EXACTLY, at every scale. It is O(glyphs) and belongs in T0 and T5.

If any of the three drifts, the law goes red and names the drift. F-03/F-04/F-05
are the ways the *rendered* walk drifts; F-12/F-24/F-25 are the ways the
*oracle* and the *helper* drift; F-21 is the reason the law was blind to
kerning drift for two sessions.

## Measured behaviour table (v1.2.2, BEFORE)

Measured out of process against the frozen copy by `<scratch>/fork-probe.mjs`
(never committed). Every row reproduces exactly, which confirms the frozen sha.

| Finding | Input | v1.2.2 measured |
| --- | --- | --- |
| F-03 (guard polarity) | `NaN >= 0 && NaN < 256` (measure form) | `false` -> REJECTS (fail-closed) |
| F-03 (guard polarity) | `NaN < 0 \|\| NaN >= 256` (draw/drawWrapped form) | `false` -> ACCEPTS NaN (the bug) |
| F-04 | `drawWrapped('HELLO', [-1,5,40,0], 1)` | 5 calls, all 5 dx `NaN` |
| F-05 | `drawWrapped('HELLO', [0,5,60,0] (len 4), 3)` | 5 calls, no throw, lines 1-2 vanish |
| F-05 | `drawWrapped('HELLO', new Float32Array(4) (zeros), 3)` | 0 calls, no throw (all-zero line 0 draws nothing) |
| F-12 | `draw('A' + chr(200) + 'A')` on FONT_ASCII | 2 calls, dx `[0, 12]` (second A overprints) |
| F-24 | `FONT_GAP._measureRange('A'+chr(200)+'B',0,3,1)` vs v1.2.2 oracle | **34** vs **19** |
| F-24 | `FONT_GAP._measureRange('AB',0,2,1)` (genuine adjacency) | 19 (`12 - 5 + 12`) |
| F-25 (measure face) | `FONT_NL.measure('A\nA')` | 31 (charges 7 for the newline) |
| F-25 (draw face) | `FONT_NL.draw('A\nA')` | 2 calls, dx `[0, 0]` |
| F-25 (drawWrapped face) | `FONT_NL.drawWrapped('A\nA',[0,3,31,0],1)` | 3 calls, dx `[0, 12, 19]` (newline drawn mid-line) |
| F-25 (kerning face) | `FONT_NLK.measure('A\nA')` | 32 (id-10 kernings apply) |
| F-25 (negative fixture) | `FONT_NL.draw('AB\nC')` / `.drawWrapped('AB\nC',[0,4,36,0],1)` | 3 calls `[0,12,0]` / 4 calls `[0,12,24,31]` |
| F-21 (seam vacuity) | law-4 loop, N=256 corpus, seed 2654435769 | eligible 246, non-zero seams **0** |
| F-21 (seam vacuity) | seed 12345 | eligible 247, non-zero seams **0** |
| F-21 (seam vacuity) | seed 1 | eligible 242, non-zero seams **0** |
| lineCount degenerate | `-1` / `NaN` / `0.5` / `1.5` | 0 / 0 / **5** / **5** calls |

**A note on the F-24 number, recorded because it corrects the brief.** The M2
brief's before-table stated `_measureRange 24 vs oracle 19`. The measured value
is **34** vs 19, and 34 is the value the brief's own section-4.7 row 10 and the
AFTER state (34 vs 34) require: fork (3) does NOT change `_measureRange`, so its
value is 34 before AND after. The `24` was a transcription error in the brief;
the measurement is 34 and it is used everywhere below.

## Fork (1) -- the layout-buffer index door (F-04, F-05)

Options as the brief framed them: **A** clamp an out-of-range index to a legal
one; **B** throw a `RangeError`; **C** silently draw nothing.

**Decision: A for the per-LINE indices, B for the buffer LENGTH -- RATIFIED.**

The split is a severity difference, not a compromise. A `startIdx` of -1 or NaN
has an obvious, cheap, correct interpretation (clamp to 0 / to `text.length`)
that keeps the frame alive; the frame that produced it -- the exact hand-off
shape `@zakkster/lite-text-layout` emits -- must not be killed for a one-glyph
index error. A `layoutBuffer` shorter than `lineCount * 4` has NO correct
interpretation under any policy AND its failure is undetectable by the caller
(the surplus lines vanish silently), so it is the one case that throws. C is
rejected outright: "silently draw nothing" is the failure mode F-05 already is.

Extension the brief left open: **`lineCount` is index-like, so it clamps (floor
to 0) rather than throwing.** `n = !(lineCount >= 1) ? 0 : Math.floor(lineCount)`
rejects NaN, negatives and everything below one line in a single NaN-safe test,
then floors the fractional case. The four degenerate values, before -> after:
`-1` 0->0, `NaN` 0->0, `0.5` **5->0** (a whole extra line in 1.2.2; a defect),
`1.5` 5->5 (floors to 1, unchanged).

Recorded so the next reader does not "harmonise" this throw with `drawFast`'s
silent no-draw (decisions/0001 option C): the two are DIFFERENT on purpose.
`drawFast`'s rejected input (a huge magnitude) has a correct silent answer --
draw nothing. A layout buffer too short for its `lineCount` has none. The throw's
blast radius is bounded by T2 row 4's non-vacuity twin: a correctly-sized buffer
never reaches it.

## Fork (2) -- the missing-glyph advance (F-12)

Options: **A** leave absent glyphs at advance 0; **B** a caller-set
`missingAdvance` written into every uncovered id at construction; **C** a
per-glyph fallback in the render loop.

**Decision: B with default 0 -- RATIFIED, and the default is the semver contract.**

A non-zero default would change the rendered output of every font with a
coverage gap on `npm update`, which is not available in a patch release.
`missingAdvance` is opt-in; 1.2.3 is byte-identical for every call whose inputs
satisfy the documented contract. The fill runs ONCE, in the constructor, so the
render loop reads `glyphs[id*7+6]` unchanged and pays zero hot-path bytes; with
the default 0 the fill loop does not even run. C is rejected: bytes in a hot body
to serve a cold-path mistake. `hasGlyph(id)` ships alongside so a loader can
detect the gap at boot instead of discovering it as overlapping text at runtime.
F-12 is fixed by making the gap correctable and detectable, not by changing the
default.

## Fork (3) -- does a missing glyph break the kerning chain? (F-24)

Options: **A** the unmapped id advances (by its 0/`missingAdvance`) AND becomes
the kerning `prev`, exactly as all three walk sites do; **B** the unmapped id is
transparent -- skipped, chain unbroken.

**Decision: A -- the library is right and the ORACLE changes. RATIFIED.**

Three reasons, recorded: (i) all three walk sites in `BitmapFont.js` already
agree with each other (an id in `[0,256)` advances and becomes `prev`
regardless of coverage), so A is the only answer that edits no hot body; (ii)
under fork (2) with `missingAdvance > 0` the unmapped glyph occupies real width,
and B would kern two glyphs that are no longer adjacent -- the interaction the
brief flagged and did not resolve, and A dissolves it (T0 row 12:
`FONT_GAP6._measureRange('A'+chr(200)+'B') === 40`); (iii) B is not even
self-consistent under fork (2), since a caller who opts into visible tofu would
get kerning computed as if the tofu were not there.

The `harness.mjs:314` comment ("no descriptor -> advances 0 AND does not become
prev") was the ONLY place in the repo where the oracle was written to a
different answer than the implementation, in a comment claiming to pin the
implementation (F-24). The settlement is a change to `oracleAdvance` (drop the
`adv[id] !== undefined` clause; an unmapped id contributes `missingAdvance`,
passed in, not `font.glyphs[...]`, so the oracle still reads the JSON side),
NOT to `BitmapFont.js`.

The row/col-zeroing alternative for unmapped ids was considered and **REJECTED**:
the kerning LUT is already 0 at `(200 << 8) | 66`, so zeroing does no work; the
divergence was always in the oracle. Zeroing survives only for id 10, where it
is fork (4)'s mechanism.

## Fork (4) -- is `\n` a glyph? (F-25)

Options: **(a)** `_measureRange` grows an `id === 10` branch (the brief's
recommendation); **(b)** the constructor discards id 10's descriptor entry --
width, height, offsets, advance -- and drops kernings naming it; **(c)** status
quo.

**Decision: (b) -- the brief's recommendation is OVERTURNED on cost. RATIFIED.**

(a) costs a comparison on every glyph of every measure to serve a cold-path
fact, and is the one place the brief thought the per-glyph budget was at risk.
(b) costs ZERO per-glyph instructions and additionally fixes the third face --
`drawWrapped` rendering a visible newline -- which (a) does not touch at all.
A newline whose seven glyph slots are all zero, and whose kerning row and column
are empty, is arithmetically identical to a newline that is skipped and resets
`prevId`, for the width walk; and width 0 / height 0 make `gw > 0 && gh > 0`
false so no renderer ever passes it to `drawImage`.

**Policy, stated plainly: a descriptor entry for id 10 is DISCARDED, including
its width, height, offsets, and any kerning pair naming it.** Some BMFont
exporters emit one; the library refuses it.

What (b) does NOT fix, recorded: `draw` and `drawWrapped` still produce
different dx columns across a newline, because only `draw` breaks the line.
Nothing can make them agree across a newline. T0 law 5 is therefore scoped to
newline-free ranges, and law 5 row 9 proves the exclusion is real by asserting
the DIVERGENCE (`draw('AB\nC')` dx `[0,12,0]` vs `drawWrapped` dx `[0,12,24]`,
differing at index 2), rather than assuming it.

## The F-21 ordering constraint

T0 law 4 (the seam equation) was the only kerning check in the torture gate, and
it was vacuous: `FONT_KERN` shipped three kerning pairs against a 94x94 = 8836
seam corpus, so under both seeds that shipped, ZERO eligible seams carried
non-zero kerning (seed 2654435769: eligible 246, non-zero 0; seed 12345:
eligible 247, non-zero 0; seed 1, never before measured: eligible 242, non-zero
0). The law degenerated to `left + right === full` and never tested kerning.

**The corpus fix (M2-T04) precedes the law rewrite -- ROADMAP's explicit
ordering constraint.** A law written on top of a vacuous corpus inherits the
vacuity. `JSON_KERN` is densified to ~85% non-zero seams BEFORE any T0 law is
touched, and the fix is proven by falsification: with the densified corpus and
the UNCHANGED M0 law 4, deleting the kerning term from `_measureRange`
(`BitmapFont.js:82-84`) turns the gate red and names the law. Transcript,
verbatim:

```
=== densified, unchanged t0 ===
ok
exit=0
=== FALSIFICATION: delete kern term from _measureRange ===
exit=1
torture: FAIL -- T0.law4: seam broke: 252 != 251 (seed=2654435769 i=0 b=20 s=0.5)
=== RESTORE ===
ead84b59fe58993b3f743703755bc5dccb40fd80078723bd3ea6bfa754a5300c  BitmapFont.js
```

Before densification the same deletion passed clean. That is the vacuity, and
its removal is the direct answer to AR-02 for this tier: law 4 row 6 counts its
own eligible and non-zero seams and asserts `nonZero >= 128`, the only assertion
in the suite that can detect its own vacuity.

Against the FINAL (rewritten) T0, the same mutation is caught earlier, by law 1's
50,000-tuple differential:

```
exit=1
torture: FAIL -- T0.law1: _measureRange 9 != oracle 9.5 (seed=2654435769 i=2 a=0 b=3 s=0.25)
```

Same mutation, same corpus; law 1 reaches the offending tuple before law 4 runs.

### A note on the guard reshape's falsifiability (recorded finding)

The two guard reshapes (H9 `draw`, H14 `drawWrapped`) are correct but
UNFALSIFIABLE through the public surface, and the mutation sweep proves it:
reverting either to `id < 0 || id >= 256` leaves the whole gate GREEN. The two
forms differ only on a NaN id, and after the H13 per-line index CLAMP no NaN id
can reach either guard -- `draw` has no range parameter (its indices are always
`0..len-1`), and `drawWrapped` clamps `startIdx`/`endIdx` before the glyph loop.
The clamp (H13) is the load-bearing F-04 fix: reverting `if (!(startIdx >= 0))
startIdx = 0;` reddens T2 row 9 (`calls 0 != 5`), and deleting the `endIdx` clamp
reddens T2 row 10. The guard reshape is defense-in-depth, kept for the day a new
call path can feed a NaN id; `_measureRange`'s guard (reachable via an
out-of-range `end`) is pinned directly in T0 law 11. The 7(c) attribution of the
guard revert to "T0 rows 2, 4, 20" is therefore aspirational -- those rows use
valid inputs and are reddened by reverting the CLAMP, not the guard.

## Hot-path measurement

The per-glyph instruction budget, committed and re-derivable from the diff:

| Body | Per-glyph comparisons before | after | Per-line adds | Per-call adds |
| --- | --- | --- | --- | --- |
| `_measureRange` | 2 (`id >= 0`, `id < 256`) | **2** (unchanged text) | 0 | 0 |
| `draw` | 2 (`id < 0`, `id >= 256`) + 1 `\|\|` | **2** + 1 `&&` + 1 `!` folded into branch polarity | 0 | 0 |
| `drawWrapped` | 2 + 1 `\|\|` | **2** + 1 `&&` + 1 `!` folded | +2 | +2 comparisons, +1 `Math.floor`, +1 multiply |
| `drawFast` | -- | -- | 0 | 0 |

Zero new per-glyph instructions in all four hot bodies. `assertOps`/`OpsRules`
has NO throughput rule (profiler v1.15.0), so this is a recorded number, not a
gate: paired child-process `measureOps` medians, 5 alternating reps
(`old,new,old,new`), each rep a fresh child so the three `drawImage` call sites
never share a polymorphic ctx. Verdict rule `>= 0.97` on each of the three, same
as decisions/0001.

Numbers are the M2-T12 PAIRED run (old and new measured back-to-back, alternating
`old,new,old,new`, five reps each, fresh child per rep). The standalone M2-T03
baseline taken before any edit was `draw` 1,736,936 / `drawWrapped` 2,336,048 /
`measure` 8,233,496 -- consistent with the paired `old` column below to within the
run-to-run band, and recorded here so the pre-edit measurement is on the record too.

| Body | v1.2.2 median ops/s | min | max | v1.2.3 median | min | max | ratio |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `draw` | 1,790,176 | 1,754,838 | 1,802,185 | 1,790,649 | 1,774,212 | 1,827,217 | 1.0003 |
| `drawWrapped` | 2,405,882 | 2,372,521 | 2,414,055 | 2,390,038 | 2,358,504 | 2,407,142 | 0.9934 |
| `measure` | 8,465,113 | 8,325,586 | 8,527,403 | 8,507,995 | 8,412,504 | 8,577,580 | 1.0051 |

All three ratios are `>= 0.97` (1.0003 / 0.9934 / 1.0051), so the guard reshape and
the constructor-only fixes are a no-op on throughput as predicted -- the reshape is
2 comparisons before and 2 after. No 7(b) fallback needed. All variants:
`bytesPerOp` 0, `gc.major` 0, `gc.maxMs` 0.000.

## Structural cost

`_mapped` is a `Uint32Array(8)` = 32 bytes: a 256-bit glyph-coverage bitmap.
Per-font structural total `24 + 3584 + 131072` becomes
`24 + 3584 + 131072 + 32 = 134,712`.

The 256-byte `Uint8Array` alternative was the obvious form and was rejected:
this package already publishes 134,680 bytes per font, and 32 is the smallest
honest way to answer `hasGlyph()`. The consequence, recorded: `hasGlyph` must
test integrality explicitly (`id === (id | 0)`), which a byte-per-id map would
have got for free. T6 pins the 32 bytes so the choice cannot silently drift.

The four T6 `rec.total` windows do NOT move -- 12,710,000 / 1,025,000 /
6,560,000 / 0 -- because with `missingAdvance` defaulting to 0 and the guards
reshaped rather than retuned, no glyph starts or stops being drawn. If any of
those four integers changes, a hot body changed behaviour and the session is
wrong. `maxArrayBuffersGrowth: 0` is unaffected: fonts are constructed at module
scope, outside every measured window.

## Semver

The criterion: 1.2.3 is byte-identical for every call whose inputs satisfy the
documented contract. Three behaviour deltas, each confined to inputs that were
already producing undefined or silently-wrong output:

1. **the short-buffer throw** -- a `layoutBuffer` shorter than `lineCount * 4`
   threw nothing and dropped lines in 1.2.2; now a `RangeError`.
2. **`lineCount 0.5`** -- drew a whole line in 1.2.2; now floors to 0 and draws
   nothing.
3. **the discarded id-10 descriptor entry** -- a descriptor mapping id 10 charged
   advance, ran kerning through the break, and let `drawWrapped` draw a visible
   glyph in 1.2.2; now discarded.

Each input previously produced undefined or silently-wrong output. Changing the
`missingAdvance` default is a 1.3.0 decision and M3 is the session that opens the
descriptor door.
