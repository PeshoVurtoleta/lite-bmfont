# 0012 -- the 2.0.0 format

Status: accepted (fork 1 ratified by the user 2026-08-21, +248% on the record)
Session: M9a lands the FORMAT unreleased on 1.9.0; M9b takes 2.0.0
Findings: F-08, F-09, F-13, F-49, F-40 (behaviour half); F-50 filed and cited
Date: 2026-08-21
Baseline: `8ad758d` (M9pre, landed unreleased; npm 1.9.0)

## Why this record is written WHOLE, before any code, and carries M9b's forks too

Two reasons. First, forks 1 and 6 CONTRADICT unless decided together: checked mode
defaulting ON (fork 6) plus the old Int16 integrality test would make every font
with a fractional `xadvance` fail to construct -- the exact fonts fork 1 exists to
serve. They are one decision (section "The blocker"). Second, M9pre silently
dropped a fork its own plan specified (the F-08 deferral handoff, BRIEF S-12); the
file was internally consistent so four agents missed it. So this record carries a
LITERAL fork roster [1..9], gated by `test/packaging.test.js` (fork 9), and every
fork M9b executes is written here now rather than discovered missing later.

No version bump. `package.json`, `VERSION` and the CHANGELOG heading stay 1.9.0.
M9b bumps to 2.0.0.

## Fork (1) -- F-08 storage: how a sub-pixel advance is stored and read

`xadvance` and kerning `amount` are stored `Int16` today. `8.6` truncates to `8`;
over a 40-glyph line the drift is exactly 24.0000px (measured 320 vs an exact 344).
BMFont exporters emit fractional advances, so this is data loss on real input.

Options measured on the REAL bodies, isolated one-body-per-process, 10-12 reps,
median ns/call, Node v26.3.1:

- **A -- keep Int16, document.** Rejected: the information is destroyed at
  construction; no accessor recovers it. 24.0000px on a 40-glyph line is not a
  documentation problem.
- **B -- parallel `Float32Array(256)` for advances.** Rejected on the byte AND on
  measured throughput: +1,024 B/font (134,712 -> 135,736, reddening T6's structural
  total by design) and a second cache line / second index in seven bodies. On the
  arithmetic probe at scale 1.0 B is 564ns vs today 182ns -- a Float32 read yields a
  double, losing the same fast path folded loses, for MORE bytes. It buys 0.03125px
  over C and does not rescue the throughput.
- **C-naive (`>> 4` per glyph).** Rejected as LOSSY. `138 >> 4 = 8` -- the shift
  drops the whole 0.625 fraction, and it floors toward negative infinity so a
  negative advance reads one 1/16 low. It is a THROUGHPUT PROXY ONLY (it happens to
  be ~113ns fast because it keeps `* scale`), never a correctness peer. The ROADMAP
  conflates this shift with a per-glyph divide; `0012` does not.
- **C-deferred -- accumulate raw fixed-point with integer adds, scale ONCE at
  return.** Rejected ON THE LAW, not on speed. It is the FASTEST correct option
  (~132ns, faster than today) and looks strictly better on every number except the
  one that matters. It rounds ONCE where the render path rounds per glyph, so it
  produces a DIFFERENT float: fuzz over 3000 fonts x 12 scales = 36000 cases found
  **7213 mismatches vs the folded per-glyph value**, first at scale=1.1 --
  `deferred 395.65625000000006` vs `folded 395.65624999999994`, diff 1.14e-13. T0
  law 1 is a four-way EXACT, no-epsilon equality tying `_measureRange` to `draw`'s
  dx-walk and `layoutGlyphs`' quad-walk; those render bodies maintain a per-glyph
  cursor and CANNOT defer. On the real bodies deferred `_measureRange` != draw's
  walk at scale 1.1 (158.4 vs 158.40000000000003) where folded is exact. The
  measure/render idiom split IS the break; it cannot be worked around.
- **C-folded -- store `Math.round(v * 16)`; read `value * (scale * 0.0625)` per
  glyph, the 1/16 folded into a per-CALL constant `s16`.** RATIFIED, ALL SEVEN
  direct readers AND the store. Per-glyph op count is identical to today (one load,
  one multiply, one add); cost is one multiply per call plus one live local. It
  preserves T0's exact four-way equality because every body -- measure helpers,
  render bodies, and the migrated oracle -- rounds per glyph with the identical
  idiom. 0.0625 is a power of two, so it carries exactly one rounding and agrees
  bit-for-bit with a per-glyph `(v*0.0625)*scale` at every normal scale.

**Decision: C-folded.** **Rejected: A (24px destroyed), B (+1KB, no throughput
win, measured 564ns), C-naive (`>> 4` LOSSY -- drops the fraction), C-deferred
(breaks the T0 conservation law: 7213/36000 mismatches).**

### The cost, on the record (F-50)

C-folded costs a MEASURED +248% on `_measureRange` at scale 1.0 (today 155.6ns ->
folded 540.9ns) and +330% on `measureWidest` (104.5 -> 449.4). This is the
opposite of the plan's hypothesis ("folding costs ZERO extra ops"), which was
falsified by measuring the real body. Four numbers per window, scale 1.0:

```
window          today    C-naive(>>4,LOSSY)  C-folded    C-deferred(law-broken)
_measureRange   155.6    113.1               540.9       132.3
measureWidest   104.5    104.7               449.4       ~132
draw            588.4    588.5               364.7       n/a (render=folded)
drawWrapped     401.0    402.7               251.8       n/a
layoutGlyphs    604.7    n/a                 475.3       n/a
```

At scale 1.1 folded is FASTER on the measure helpers (mr 107.3 vs today 137.3) and
the render bodies are FASTER-or-par at BOTH scales (draw -38% at 1.0). The
regression is confined to the two pure advance-sum helpers at INTEGER scales.

**Mechanism.** It is a V8 codegen artifact, not an op-count increase. At integer
scale every advance+kerning product is integer-valued, and V8 speculates the
accumulator is an integer, paying an int<->double round-trip per glyph in the
two-accumulation-site loop (advance + kerning). A fractional constant `s16 =
scale*0.0625` still yields integer-valued products at integer scale (192*0.0625 =
12.0), so folded pays it too; a fractional scale breaks the speculation and both
are fast. Two escapes were tried and BOTH FAILED, do not re-run them: (i) a
synthetic probe showed a double-seeded accumulator collapsing 238ns->91ns, but
`let width = 0 * scale` on the real body was 560.1 vs 560.0 -- no effect; (ii) the
idiom split (deferred measure + folded render) breaks T0 as above. Filed as F-50.

**Ratified anyway because:** the regression is on non-frame measure helpers (called
O(lines), not O(glyphs)/frame); the render path is faster under folded; and the
alternative is shipping 24px of destroyed data. Absolute cost is ~9ns/glyph vs
~2.5ns on a helper.

### Resolution numbers, quoted correctly

C improves worst-case rounding error from **0.5px to 0.03125px -- 16x**, not the
24x the ROADMAP claims. 24 is the ratio of two measured DRIFTS at `xadvance: 8.6`
(v1.x 24.0000px over 40 glyphs -> C's 1.0000px), not the resolution ratio. At
`xadvance: 8.6`: v1.x stores 8 (measure('AA')=16, 40 glyphs=320, drift 24.0000);
C stores `round(8.6*16)=138`, `advanceOf=8.625`, `measure('AA')=17.25`, 40 glyphs
`8.625*40=345` vs exact 344 = **-1.0000px, an OVERSHOOT** (assert the exact
literals, never `<= 1.0`).

### Fork 7 input, and the overflow bound

Folded evaluates `scale * 0.0625` first, which UNDERFLOWS to 0 at
`Number.MIN_VALUE` (5e-324), returning 0 where today's `Int16 * scale` preserves a
subnormal (6e-323). Folded's lower scale bound is therefore
`scale >= 16 * Number.MIN_VALUE = 8e-323`, below which the measure/render paths
silently return 0. (Left-associative `w16 * scale * 0.0625` WOULD preserve it --
6e-323 -- but that is C-deferred's associativity and C-deferred is rejected; the
folded per-glyph form is parenthesised through `s16`.) This is the first hard input
for a scale LOWER bound; see fork 7.

The integer accumulator (fixed-point advance up to 32767 + kerning up to 32767 =
65534/glyph) is bit-exact until floor(2^53/65534) = **137,443,147,904 glyphs** and
leaves Smi range at floor(2^31/65534) = **32,769 glyphs**, remaining exact as a
double beyond that. No realistic precision loss (20k glyphs: 172500 === 8.625*20000).

### The store keeps the OTHER five slots raw

`s16` multiplies ONLY slot 6 (advance) and the kerning table. `x`, `y`, `width`,
`height`, `xoffset`, `yoffset` (slots 0-5) stay raw Int16 with `* scale`. A
"simplification" that routes them through `s16` shrinks every glyph 16x. This is
commented in all seven bodies.

### WHICH FIXTURES ACTUALLY WITNESS THIS FORK -- measured by qa, 2026-08-21

Established by mutation, not by reading, and recorded because the answer is
narrower than it looks and the next session will otherwise prune the witnesses.

**Mutation: `Math.round` -> `Math.floor` at all three store sites.** Integer
advances quantize IDENTICALLY under both (`12 * 16 = 192`, `-1 * 16 = -16` are
exact multiples of 16), so **every integer-advance assertion in the suite stays
GREEN**. Confirmed: `npm test` 139/136/2 -- only the two 8.6-based F-08 rows fired;
torture stopped at `T3/25: xadvance 8.6 stored 137/137 != 138`. The
"constructs and maps glyphs" (advance 12) and "maps kerning pairs" (amount -1)
rows, which DO read `glyphs`/`kerning` directly, were blind to it.

**Therefore the fractional fixtures -- `8.6`, `8.7`, `-8.6`, `-1.7` -- are
LOAD-BEARING for this entire fork.** They are the only witnesses that `Math.round`
is being called at all. A future session that trims them as "redundant coverage of
the same code path" deletes the only proof the rounding mode is correct, and every
gate stays green while it does so. Do not remove them; if the fixture set is
reorganised, carry at least one non-multiple-of-16 advance AND one non-multiple-of-16
kerning amount, positive and negative.

**Mutation: `GLYPH_ADVANCE_SCALE` 0.0625 -> 0.125 (a one-bit shift error).** Well
covered by contrast -- three `npm test` rows fire (`advanceOf(65) === 12`,
`kernOf(65,66) === -1`, `advanceOf(65) === 8.625`) plus torture
`T3/25: advanceOf 17.25 != 8.625`. The decode constant is witnessed by integer
fixtures; only the ROUNDING MODE depends on the fractional ones.

## Fork (2) -- F-06: `measure` semantics (EXECUTED IN M9b)

`measure` today sums across newlines (`measure('AA\nAA')` = 32); `measureWidest`
(shipped M4) returns the widest line (16). 2.0.0 promotes `measure` to the widest
line and keeps `measureWidest` as an alias.

**Decision: promote `measure` to widest-line; `measureWidest` becomes an alias;
`measureTotalAdvance` is NOT added.** **Rejected: adding `measureTotalAdvance`** --
the ROADMAP is explicit that if nobody wants the old cross-newline number it must
not be added, and no caller in the suite consumes it. Recorded so the omission is
deliberate, not forgotten. Executed in M9b (it is a semantic flip on a hot door,
not a storage change, and does not belong in the same tarball as the format).

## Fork (3) -- F-09: kerning keys and amount

The negative-key hole (`first: -1`) was CLOSED by M3 (`BitmapFont.js:380` tests
BOTH bounds on BOTH keys via the shared integer predicate). What remained was
`amount`'s storage, which fork 1 sends to the SAME 1/16 fixed point as `xadvance`
-- fixing the bound and the encoding in one release, not two migrations for one
field.

**Decision: `amount` rides fork 1's C-folded lane** -- stored `Math.round(amount *
16)`, validated by `_requireAdvanceField` (range `[-2048, 2047.9375]`, no
integrality test), read `* s16`. **Rejected: a separate 2.1.0 for the amount
encoding** -- it is the same field class as `xadvance` and splitting them is two
migrations for one conceptual change (ROADMAP F-09 pairing).

## Fork (4) -- F-13 flags mask, reserved bits, and F-49

The validated flags mask shipped in M3 (`FLAG_ELLIPSIS`/`FLAG_MASK` at :77-79,
`f | 0` ToInt32, `_throwField` under checked). **F-49 (S2, NEW):** the unknown-bit
test sits in the `else` of the ellipsis branch (`else if (checked && (f &
~FLAG_MASK))`), so any `flags` with bit 0 set takes the ellipsis path and never
reaches it. Reproduced under `{checked:true}`: `flags=2` throws, **`flags=3` is
SILENT** -- exactly the defect F-13 was filed to close, still open in the fix that
closed it.

**Decision: hoist the unknown-bit test OUT of the `else`, so it runs before the
ellipsis path and fires for every odd `flags` too; document bits 1-31 as reserved
(a set reserved bit is a caller error under checked).** **Rejected: leaving it in
the `else` and only documenting** -- publishing "a reserved bit set is a caller
error" while the check cannot see them on odd values is a promise the code does not
keep. Closed HERE (M9a), before M9b writes the reserved-bit docs.

## Fork (5) -- F-14: freeze the prototype (EXECUTED IN M9b)

`Object.isFrozen(BitmapFont.prototype)` is false; the class has 12 own prototype
names an adversary can monkey-patch.

**Decision: `Object.freeze(BitmapFont.prototype)` once at module scope, closing
`npm test`'s remaining todo.** **Rejected: freezing instances too** -- instances
carry the typed-array fields and are per-font; freezing the prototype is the whole
of the exposure. Executed in M9b (a one-line freeze that does not belong in the
format tarball).

## Fork (6) -- checked mode defaults ON (ONE record with fork 1: the blocker)

Today `checked` defaults `false`. 2.0.0 defaults it `true`; the opt-out is
`{ checked: false }`.

**THE BLOCKER, reproduced 2026-08-21:** `_requireNumField` tests the INPUT field
for integrality under `checked`. With `checked` ON and the OLD integrality test,
`xadvance: 8.6` throws `chars[0].xadvance is not an integer` -- every
fractional-advance font, the exact fonts fork 1 serves, fails to construct.

**Decision: default `checked` ON, AND under fork 1's C-folded the meaning of
"lossy" changes for the advance/amount slot.** A format with a DECLARED 1/16
RESOLUTION does not throw on the values it is designed to round. Slot 6 and
`amount` are validated by a NEW `_requireAdvanceField`: a RANGE test only,
`[-2048, 2047.9375]` (the Int16 fixed-point range /16). **The integrality test is
RETIRED for this slot** -- round-to-nearest-1/16 keeps every in-range value within
1/32px by construction, so a residual `> 1/32` branch could never redden and this
repo does not ship guards that cannot redden (inert shape 1). **Slots 0-5 keep
their Int16 range + integrality test verbatim** -- C changes exactly one slot.
**Rejected: default `checked` ON with the old integrality test** -- that is the
blocker; a fractional-advance font would not load. Assertion 8.4 (a
fractional-advance font CONSTRUCTS by default) is what proves this was RESOLVED
rather than merely discussed.

## Fork (7) -- F-40: a magnitude bound on the scale door

`Number.MAX_VALUE` PASSES the scale door (`!(scale > 0 && scale < Infinity)` is
false for it) and yields Infinity widths; mixed-sign Int16 advances give NaN. Fork
1 changes what an advance CAN be (bounded to `[-2048, 2047.9375]`), so a magnitude
bound is derivable for the first time.

**Decision: DERIVE and RECORD the bound from the format; DO NOT sweep for it**
(`decisions/0004` fork 7 rejects the sweep reflex). Fork 1 bounds a single-glyph
advance to `[-2048, 2047.9375]`px, so the derived limits are: an UPPER scale bound
`scale < Infinity / 2047.9375 = 8.78e304`, above which a single bounded advance
overflows to Infinity (this is where `Number.MAX_VALUE` fails F-40 today); and a
LOWER bound `scale >= 16 * Number.MIN_VALUE = 8e-323` (fork 1's S-18), below which
folded's `scale * 0.0625` underflows to 0. The honest repair for F-40 is to STATE
the limit (its historical resolution was "recorded rather than fixed"): these
numbers are now derivable for the first time because fork 1 bounds the advance.
ENFORCEMENT in the scale doors -- a per-call bound in up to ten doors -- is
DEFERRED: M9a's hot-body budget is spent on fork 1, and tightening ten doors is a
separable per-call change that M9b lands with the rest of the behaviour surface.
**Rejected: a swept magnitude constant** -- an empirical number nobody can rederive
is exactly the F-40 defect (a record claiming a property no gate re-derives).
**Rejected: enforcing the bound in M9a** -- it is orthogonal to the storage format
this session lands and would move ten per-call doors under the same tarball.

## Fork (8) -- FORMAT.md + FORMAT_VERSION (EXECUTED IN M9b)

**Decision: ship `FORMAT.md` and a `FORMAT_VERSION` constant, asserted from BOTH
this repo AND lite-text-layout, designed to FAIL (not skip) when the peer is
absent.** The suite has been bitten by a peer-asserted contract that silently skips
when unwired, turning the drift guard into a no-op. **Rejected: a skip-when-absent
assertion** -- a silent skip is an unverified state, and the Law fails closed.
Executed in M9b (the peer wiring and doc surface are not the hot-body format).

## Fork (9) -- the roster gate

M9pre dropped a fork its own plan specified; the file was internally consistent so
two review passes missed it. **Decision: `test/packaging.test.js` extracts every
`^## Fork \((\d+)\)` at column 0 (outside fenced code blocks) from
`decisions/0012-*.md` and asserts the set is exactly [1..9], each with a
`Decision:` and a `Rejected` line.** Proven in BOTH directions: deleting `## Fork
(7)` reddens it, and prose quoting `## Fork (n)` inside a fenced block does NOT
(a grep matching its own docs is a shipped failure mode here). **Rejected: trusting
review to catch a dropped fork** -- it did not, twice.

## S-22 note: T0 has no tolerance to delete

The ROADMAP says "delete the tolerance and prove the law tightens." **There is no
numeric tolerance.** T0 states (`t0-laws.mjs:11`) "there is no epsilon anywhere in
this tier," because its fonts use integer advances and its scales are powers of
two, so every product is an exact float. The "residual F-08 forced T0 to tolerate"
is that DESIGN CONSTRAINT, and its value was exactly 0 for the fonts under test.
**CORRECTED 2026-08-21 in review -- the paragraph this replaces described a
migration that never happened.** It said "the oracle migrates from reading the
original fractional JSON to reading `Math.round(xadvance*16)` and multiplying by
`s16` per glyph ... so `mr === oracle` stays exact for FRACTIONAL fonts too."
`test/torture/harness.mjs` is **byte-unchanged in this diff** and its oracle still
reads the original JSON `c.xadvance * scale`. That is a record claiming a property
the code does not have -- the F-24/F-40 shape -- and it is corrected rather than
made true, because the unmigrated oracle is the BETTER design and the note had the
virtue backwards:

- An oracle that mirrors the store would agree with the implementation BY
  CONSTRUCTION. T0's four-way law would then be circular and could not witness a
  decode bug at all. Reading original JSON keeps the oracle INDEPENDENT, which is
  what makes `mr === oracle` evidence. Confirmed in review: the law is exact and
  non-circular, and a render-only mutation (`draw`'s `* s16` -> `* scale`, 16x and
  invisible to `measure()`) reddens `T0.law1` with `walk 31536 != _measureRange 2016`.
- The law is exact TODAY because every T0 font uses integer advances, which
  quantize losslessly into 1/16, and every T0 scale is a power of two, and 0.0625
  is a power of two -- so every product is an exact float.
- **THE STANDING HAZARD, which the old note would have hidden:** adding a T0 font
  whose advances are NOT exact multiples of 1/16 breaks the no-epsilon law, because
  the store rounds and the oracle does not. Anyone adding such a font must either
  quantize the oracle at that point or accept that the law is no longer exact --
  and must not "fix" it by widening a tolerance T0 has never had. OLD tolerance value recorded: NONE (no epsilon; residual 0 on
integer fonts at power-of-two scales).
