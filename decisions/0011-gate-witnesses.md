# 0011 -- the gate witnesses

Status: accepted
Session: M9pre (UNRELEASED landing on 1.9.0; 2.0.0 carries it forward)
Findings: F-19, F-26, F-27, F-31, F-32, F-37, F-40 (docs half)
Date: 2026-08-21
Baseline: `c030089` (1.9.0, published)

## Why this session exists, and why it ships no runtime byte

2.0.0 is the only session permitted to change a hot body, and its own admission
rule is a measurement -- "if option C's shift costs more than 2% on
`_measureRange`, that is a FINDING" -- read by the T6 instrument. F-31, F-32 and
F-37 each say that instrument is blind in a specific way. An instrument repaired
in the same commit as the subject it measures cannot adjudicate that subject: a
RED result has two candidate causes and a GREEN result trusts a lane authored by
the same hand in the same commit. So the instrument is repaired FIRST, against a
library whose bytes do not move.

**Zero shipped-byte delta.** `BitmapFont.js` is not opened. The mechanical proof
is A11 (`test/packaging.test.js`): the ten method-body sha256s stay at their
1.8.0 pins. Every edit this session is in `test/` and `decisions/`. `files[]`
excludes `test/`, so no consumer executes a changed byte. Only fork 1 below
turns on that fact.

## Fork 1 -- release 1.9.1, or land UNRELEASED

Options: **A** cut 1.9.1 (version-sync `package.json` + `VERSION` + CHANGELOG +
`packaging.test.js:14`). **B** land unreleased; 2.0.0 carries it.

**Decision: B, land UNRELEASED.** A 1.9.1 tarball would differ from 1.9.0 only in
`package.json`, the `VERSION` const and `CHANGELOG.md`; every runtime byte a
consumer executes is byte-identical (A11 is the proof). Asking every consumer to
take an install for a change none can observe is a cost exported outward; the
version-sync bookkeeping is a cost paid once, internally, when 2.0.0 lands. A is
available at any time and costs four edits -- A11 stays green either way, because
it hashes method bodies only and `export const VERSION` is top-level.

## Fork 2 -- F-26: delete the two unfalsifiable reshapes, or KEEP and pin

The F-03 guard reshape `if (!(id >= 0 && id < 256)) continue;` lives in three hot
bodies -- `draw` (:732), `drawWrapped` (:1233) and, since M5, `layoutGlyphs`
(:1360). None takes a range parameter, so no public call can drive a NaN id into
the guard: the reshape is unfalsifiable through the public API, permanently (M6,
which would have built the range API, was cut 2026-08-20).

Options: **A** delete the two (or three) unfalsifiable reshapes, letting
`_measureRange`'s falsifiable one stand alone. **B** KEEP all three and pin them
by source text, recording that a source pin is all they will ever have.

**Decision: B, KEEP.** Deleting the reshape does not delete a guard -- it writes
the NaN-ACCEPTING `id < 0 || id >= 256` form back into three bodies. That form is
false for NaN, so it ACCEPTS NaN: F-03's silent-corruption mechanism, restored by
hand, on the theory that no current call path reaches it. "No current call path"
is an unverified state about all FUTURE call paths, and the Law fails closed on
every unverified state. The package has been taught this twice (F-42 found two
more text-taking faces than M4 counted; R-17 found a THIRD reshape site,
`layoutGlyphs`, arrived from a session not thinking about F-26 at all). Cost of
KEEP: zero -- `BitmapFont.js:731` already records "two comparisons before, two
after".

What KEEP costs instead, recorded honestly: these three sites will never have a
behavioural test. Their only gate is the source-text pin added this session
(`packaging.test.js`, "F-26 source pin"). That is a WEAKER class of assertion
than every other in this repo, it is recorded here as weaker, and it must NOT be
described anywhere as behavioural coverage. The pin excludes comment lines
(BitmapFont.js:423 and :729 both quote the forbidden form inside `//` prose
warning against it) and is proven in BOTH directions:
- true positive: `:732` -> accepting form reddens the pin (A11's draw pin was
  re-captured first to isolate it from preemption); deleting a site reddens it
  with "found 2".
- false positive: on shipped code the accepting count is 0 despite the two
  comment occurrences -- the strip removes them, so the pin is not a grep
  matching its own docs.

The behavioural twin that DOES redden: `_measureRange`'s guard (:426) takes
`start`/`end`, so T0 law 11 kills its inversion -- re-confirmed at 1.9.0, message
`T0.law11: _measureRange("A",0,2) NaN != 12 (NaN id leaked past the guard)`.

## Fork 3 -- F-27: what the retention tier tracks

The prior T7 tracked a throwaway `{cycle: c}` and untracked it in the same
iteration, so `tracker.size()` returned to 0 whether or not a font leaked. Its
`:13-16` comment argued FOR the throwaway, claiming "tracking the font itself ...
violates lite-leak's held-value contract."

Options: **B1** track the font itself. **B2** carry a WeakRef fallback for the
contract the comment feared.

**Decision: B1, and B2 is NOT carried.** `lite-leak/llms.txt:127-128`: a record
is retained "until FR fires OR untrack"; the held-value contract forbids the
`cleanup` closure or the `tag` from closing over `target` -- it does NOT forbid
passing the target AS `target`, which is the designed use (the
FinalizationRegistry watches exactly that object). `NOOP` is module-level and the
tag is a number, so both legs of the real contract are already satisfied.
Carrying B2 would re-file the same mistake -- a fallback for a constraint that
does not exist.

The untrack is REMOVED ENTIRELY, not made conditional. A conditional untrack on
"destroy() nulled all five refs" is unconditional in effect -- destroy() ALWAYS
nulls them -- so the guard is always true and the witness goes blind again.
Measured on this host (`--expose-gc`, 4096 cycles, gc() + two settle ticks) with
a module-level `KEEP.push(this)` retainer applied in a sandbox:
- track font + untrack: `size()` 0 -- BLIND (the old defect, in new clothes).
- track font, NO untrack: `size()` 4096 -- the witness fires.
A collected font decrements `size()` via its FR callback; a retained one never
does, and THAT difference is the test. Consequence, load-bearing for the whole
tier: FR callbacks fire on a later turn, so `size()` is read ONCE, after the
loop, after `gc()` and two `await` settle ticks -- and `test/torture.mjs` now
`await`s each tier (sync tiers return undefined, unaffected). Green-before /
red-after both watched; red-after string:
`T7: lite-leak tracker leaked 4096 resources`.

FRAME-LIVENESS PRECONDITION (a non-obvious property of this design, recorded so
the next hand does not re-derive it under JIT where it is invisible): the FR
witness works only if the tracked objects' CREATING FRAME has returned before the
drain. A live stack slot holds the last `const font` for as long as its frame is
on the stack, so a loop that drains in its own frame leaves the final font
uncollectable and false-REDs with "leaked 1 resources" -- 10/10 stranded under
`--jitless`, 0/10 under JIT (the JIT frees the dead slot early, hiding the bug).
The 4096-cycle loop therefore lives in a `fill(tracker)` that RETURNS before the
`gc()` + settle + `size()` read; a bounded retry does NOT fix it (still 20/20
stranded under `--jitless`) because the straggler is retained by the frame, not
slow to finalize. Separately, the SECONDARY heap bound is now RECORDED, NOT GATED.

**Superseded rationale, left verbatim under a dated marker (M9pre 2026-08-21).**
This record first claimed the false-RED was ELIMINATED by reading the MINIMUM of
three (gc, read) samples: "A single post-`gc()` read false-REDs ~1/120 under
24-way contention (`heap grew 526.1 KB`, 2.7% over -- pure settle-tick residue a
second or third `gc()` collects). The min of three post-`gc()` reads can never
exceed a single read at the same point, so it strictly narrows the false-RED path
and costs the true-RED nothing (4096 retained fonts exceed 512 KB in every
sample); 120/120 concurrent exit 0 after. The 512 KB bound is NOT widened -- the
measurement is fixed, not the threshold." A dated measurement is evidence and is
not edited when read wrong -- so it stays above.

**CORRECTED (M9pre 2026-08-21).** The construction argument is TRUE and does not
matter: at 120 runs on the live tree the min-of-3 gate still false-REDs **3/120,
up to 646.8 KB (26% over)**. Under contention the heap genuinely sits above
512 KB at every sample -- the growth is contention noise, not a residue a further
`gc()` reclaims -- so no sampling strategy rescues a gate on this quantity. The
bound is therefore DE-GATED: the min-of-3 measurement is kept (strictly the
tightest honest number, costs nothing) and PRINTED as a `torture: RECORDED (T7
heap, not gated ...)` line, never `die()`d on. This is not a threshold tuned
quietly -- it is the removal of a check that provably cannot do its job, said in
writing. Justification: (1) the bound was never a leak witness FOR THE CLASS IT
WAS THERE TO CATCH -- F-27's row records 4096 genuinely-retained fonts leaving it
GREEN inside 512 KB, because destroy() nulls the typed arrays and the shells are
small. STATED PRECISELY, BECAUSE THIS IS A NARROWING AND NOT A FREE REMOVAL
(reviewer, 2026-08-21): the whole-heap bound was a coarse catch-all that would
also have seen cross-cycle growth in things `tracker.size()` cannot see at all --
module-level caches, tracker internals, or a side effect a font creates that
destroy() cannot null because it is not the font. That class is EMPTY for the
current library (no module-level per-instance accumulation; no timers, listeners
or global registries, which the retain-outside-owner Law forbids; `rec` and
`ATLAS` are shared, reset per cycle, and reference the atlas image rather than
the font; lite-cleanup's `issued` set is a WeakSet). It is empty for TODAY'S
code, not by construction. What makes the narrowing acceptable rather than merely
convenient is that the bound could not have covered that class anyway at this
granularity: it false-REDs at 646.8 KB against a 512 KB bound from pure
contention noise, so its noise floor already exceeded the signal a ~200 KB
untracked leak would produce. The designed instrument for that class is
lite-leak's orphan kernels (TimerOrphan / ListenerOrphan / ObserverOrphan /
EmitterOrphan), and T7 should wire one if the class ever becomes non-empty --
NOT restore a heap-delta gate; (2) the real witness,
`tracker.size()`, now exists and reddens `leaked 4096 resources`; (3) a check
that cannot catch its target and fires on healthy code is negative value;
(4) 512 KB / 4096 cycles is 128 B/cycle, but one retained font is 134,712 B, so
any real per-cycle leak is 551 MB and is caught by everything -- the bound is
"tight" only in the regime where contention noise swamps it. Tuning it to 700 KB
would be the dishonest version; de-gating with the reasoning recorded is the
honest one.

## Fork 4 -- F-31: a total, or the four named equalities

T6's `structural()` pinned four NAMED typed arrays (`glyphs` 3584, `kerning`
131072, `_charScratch` 24, `_mapped` 32) with no total, so a fifth typed array
was invisible.

Options: **A** replace the four with one total. **B** ADD a total, retain all
four.

**Decision: B.** The sum says "134712 became 138808"; the named rows say WHICH
array moved. A compensating pair (one array shrinks, another grows by the same
bytes) passes the sum and is caught only by the named rows; a brand-new array
passes every named row and is caught only by the sum. The total walks
`Reflect.ownKeys(font)` (not `Object.keys`, so non-enumerable and symbol keys are
seen) and reads each value from its property descriptor (never through the slot,
so an accessor is not invoked), summing `byteLength` over every ArrayBuffer view,
on a LIVE (non-destroyed) font. Coordinator-verified total: **134712**. Known
limit, recorded in-file: an array reachable only through a closure or a WeakMap
sits behind no own property and no walk can see it. Reddening mutation (A1,
watched): `this._bloat = new Float64Array(512)` -> total 138808, all four named
rows green. String: `T6/A: typed-array total 138808 != 134712`.

## Fork 5 -- F-32: the reject branches, inside a measured window

The reject branches of the per-call scale/text doors were exercised by T5 and T9
control 13, but never inside a measured window. New window K drives ALL FOURTEEN
enumerated doors of the eight public bodies that take a scale or text (the
session brief said "thirteen" but enumerated fourteen; the window covers all
fourteen -- fail closed, cover more not fewer). Measure/query faces return NaN
into `sink` (so V8 cannot DCE the call; a NaN sink cannot be `===`-asserted, so K
asserts `sink !== sink`); void draw faces are proven by `rec.total === 0`.
Reddening mutation (A4, watched): `this._rejectLog = (this._rejectLog ||
[]).concat(scale); return;` at the draw scale door (:670) -- materialized,
escaping, retained. It reddens the RETENTION lane first (the ops lane is blind,
major = 0 -- the F-37 shape); `_rejectLog` is an Array, not an ArrayBuffer view,
so fork 4's typed-array walk does not see it and the two assertions stay
independent. String: `T6/K retained-bytes gate rejected -- verdict=fail
source=gc bytesPerCall=7.824`.

## Fork 6 -- F-37: volume lanes on A/B/C/C2/D, and how each floor is set

M5 gave windows E-J a transient-allocation volume lane against `VOL_MAX`
(1000000), calibrated on measure-family bodies that emit no `drawImage`. R-18:
that limit MUST NOT be applied to A-D by analogy -- A/C/C2 drive 62/64/64
recording `drawImage` calls per op. So each floor was MEASURED on this host (Node
v26.3.1, 6 reps, 20,000-iteration warmup) and each mutant was applied in a
sandbox and watched. Per-window limits, none copied:

| window | shipped floor | mutant | limit | mutant class |
| --- | --- | --- | --- | --- |
| A draw | 65,376 B | 97,732,272 B | VOLA_MAX 2,500,000 | 8-float array/glyph |
| B drawFast | 37,152 B | 81,443,776 B | VOLB_MAX 1,700,000 | 8-float array/glyph |
| C drawWrapped | 0 B | 102,969,888 B | VOLC_MAX 3,000,000 | 8-float array/glyph |
| C2 align path | 0 B | 102,969,936 B | VOLC2_MAX 3,000,000 | 8-float array/glyph |
| D measure | 5,024 B | 28,042,592 B | VOLD_MAX 400,000 | text.split('\n') |
| K reject | 320-370 KB cold | retention leak | VOLK_MAX 2,000,000 | A4 concat |

R-15 RESOLVED: the split mutant measures **28,042,592 B** on this host,
confirming the **28,042,664 B** pinned at `t6-alloc.mjs:112` (72 B apart, GC
noise). It does NOT reproduce the ROADMAP F-37 row's **32,881,040 B**, which is
stale for this host/Node. C and C2 measure the same body (drawWrapped, align 0
vs align 1); the identical limit is an independent measurement of each, not an
analogy. The realistic renderer regression is materializing the eight
`drawImage` args into an array per glyph -- window J:537 records V8 elides the
INLINE spread, so only a materialized/escaping array reddens, which is what the
mutant does.

WHICH LANE FIRES IS DECIDED BY THE MUTATION'S SHAPE, NOT ITS SIZE. Established
2026-08-21 by qa and the coordinator while independently re-proving all five
lanes, after two false starts that each reddened the WRONG lane and would have
left the volume lane unproven -- inert-assertion shape (2), preemption:

- A mutation that PUSHES into a growing array is RETAINED, so it reddens the
  RETENTION lane first: `T6/A retained-bytes gate rejected -- verdict=fail
  source=gc bytesPerCall=7439.6`. The volume lane never runs.
- A mutation allocating a TYPED ARRAY is an ArrayBuffer, so it trips
  `maxArrayBuffersGrowth: 0` on the OPS lane first: `T6/B zero-alloc/GC gate
  rejected -- verdict=fail source=gc major=0 maxMs=0.000`. The volume lane
  never runs.
- Only a PLAIN JS ARRAY, built fresh per call and overwritten in a module-level
  slot, is genuinely transient AND escapes: it does not accumulate (retention
  stays green), it is not an ArrayBuffer (arrayBuffers growth stays green), and
  it is not scalar-replaceable (V8 does not elide it). That is the ONLY shape
  that proves a volume lane.

ALL FIVE LANES PROVEN WITH THAT SHAPE, each watched red in a sandbox with the
ops and retention lanes green ahead of it:

| window | mutant | limit | over |
| --- | --- | --- | --- |
| A draw | 137,244,168 B | 2,500,000 | 55x |
| B drawFast | 81,458,432 B | 1,700,000 | 48x |
| C drawWrapped | 94,440,952 B | 3,000,000 | 31x |
| C2 align path | 102,311,160 B | 3,000,000 | 34x |
| D measure | 81,443,824 B | 400,000 | 204x |

Anyone adding a sixth volume lane must use this shape, or they will prove
nothing and believe they proved something.

## Fork 7 -- F-40 docs half: is NaN a unique fail signal

Already corrected by M4a (2026-08-18) in `decisions/0004` and `SESSION-M4.md`:
NaN is the fail signal the DOORS emit, but it is NOT unique -- a constructed font
CAN produce NaN (`measure('AB', Number.MAX_VALUE)` with advances 32767/-32768) or
Infinity (`measure('A', Number.MAX_VALUE)`) from mixed-sign advances at extreme
in-door scale. This session appends a dated M9pre supersession marker to both
records confirming the correction and leaving the superseded text VERBATIM -- a
dated measurement is evidence, and evidence is not edited when it turns out to
have been read wrong. The behaviour half (a magnitude bound on the scale door
below Infinity) is deferred to 2.0.0, alongside F-08's storage half.

## Fork 8 -- T-4 WITHDRAWN: why adding `maxBytesPerOp` to RULES is inert

R-14: `harness.mjs:44` carries `RULES = { maxMajor: 0, maxPauseMs: 4,
maxArrayBuffersGrowth: 0 }`. There is no vacuous `maxBytesPerOp` rule to delete;
`grep -rn maxBytesPerOp test/` returns only comments. And ADDING it would be
inert: `checkNoGc` reads `summary.bytesPerOp`, which is `undefined` because
`measureOps` puts `bytesPerOp` on the RESULT, not the summary -- so the rule
reads undefined and cannot fail at any threshold. `checkNoGc` cannot be handed
the result instead, because it dereferences `summary.gc.major` and throws on a
result object. A future per-op byte gate must read `result.bytesPerOp` directly,
not via a `checkNoGc` rule. The volume lanes of fork 6 are that gate's stand-in
until it exists.

## F-19 -- closed on sight

All six shipped files measure 0 non-ASCII (`grep -c -P '[^\x00-\x7F]'`). The
keeping gate is the ASCII-only Law test (`packaging.test.js`), enumerating from
`git ls-files -z`. No work; the gate stays.
