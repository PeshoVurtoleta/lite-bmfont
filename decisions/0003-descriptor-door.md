# 0003 -- the descriptor door

Status: accepted
Session: M3 (v1.3.0)
Findings: F-08, F-09, F-10, F-11, F-13, F-28, F-29, F-30
Date: 2026-08-18
Frozen baseline sha256: `f196ddc84fd8694132a8272950d8c65faef78975f67d29c7fb0039c9f9e4e281`

## The question

Three of the four things a `BitmapFont` needs in order to render are unchecked,
and the fourth is checked in a way that admits four types that are not numbers.
`new BitmapFont(atlas, { chars: 7 })` returns a font whose every `measure()` is
0 for the life of the process. `atlas: null` returns a font that calls
`drawImage(null, ...)` sixty times a second. `{ common: { lineHeight: NaN } }`
returns a font that puts every line at NaN Y. Meanwhile `fontJson: null`,
`fontJson: {}`, `common: null` and a missing `chars` each throw a raw
`TypeError` naming an internal property the caller has never heard of -- four
distinct messages, not three (PROBE i).

Three malformed inputs accepted, four rejected with a stack trace pointing at
the wrong place. That is not a policy in either direction, and the constructor
is cold, so there is no performance argument on either side of it. The only real
question is compatibility, and the second question -- the one the brief does not
ask -- is what happens to the option bag that the compatibility answer depends
on.

## Measured behaviour table (v1.2.3, BEFORE)

Measured out of process against the frozen copy by
`<scratch>/descriptor-probe.mjs` (never committed) on 2026-08-17. Every row
reproduces exactly, which confirms the frozen sha and confirms M3-T00 did not
lie.

| # | Input | v1.2.3 measured | Source |
| --- | --- | --- | --- |
| 1 | `chars: 7` | constructs, 0 glyphs | PROBE (i) |
| 2 | `chars: []` | constructs, 0 glyphs | PROBE (i) |
| 3 | `chars: 'AB'` | constructs, 0 glyphs (`'A'.id` undefined) | PROBE (a) |
| 4 | `chars: {length: -1}` | constructs, 0 glyphs | PROBE (a) |
| 5 | `chars: {length: 3}`, no elements | raw `TypeError: Cannot read properties of undefined (reading 'id')` | PROBE (a) |
| 6 | `chars` missing | raw `TypeError` (reading 'length') | PROBE (i) |
| 7 | `kernings: 7` | constructs, every kerning pair silently dropped | PROBE (h) |
| 8 | `atlas: null` / `undefined` | construct; `draw` -> 2 calls, imgMismatch 2 | PROBE (i) |
| 9 | `fontJson: null` / `{}` / `common: null` | raw `TypeError`, four distinct messages with row 6 | PROBE (i) |
| 10 | `common.lineHeight: NaN` | constructs | PROBE (i) |
| 11 | `common.base: NaN` | constructs | PROBE (f) |
| 12 | `char.x = 40000` | `glyphs[65*7] === -25536` | PROBE (i) |
| 13 | `xadvance: 8.6` | stored 8; `measure('AA') === 16`; exact 17.2; residual 1.1999999999999993 (1.2px drift) | PROBE (i) |
| 14 | `xadvance: -8.6` | stored -8 -- the Int16 store truncates toward ZERO, not floor | PROBE (i) |
| 15 | `x: NaN` / `Infinity` / `-Infinity` | each stores `glyphs[65*7] === 0`, and `hasGlyph(65) === true` | F-30 |
| 16 | `id: '65'` | 4 non-zero slots, `measure('A') === 12`, `hasGlyph(65) === false` | F-29 |
| 17 | `id: null` -> writes ptr 0; `id: true` -> writes ptr 7 | silent writes to ids the descriptor never named | F-29 |
| 18 | kerning `first: -1` / `second: -1` | write nowhere, no error | PROBE (i) |
| 19 | kerning `first: 65.5` -> 16706; `'65'` -> 16706; `255.9` -> 65346; `true` -> 322 | each writes a pair the descriptor does not name | PROBE (b) |
| 20 | `amount: -1.7` -> -1; `amount: 40000` -> -25536 | silent | PROBE (i) |
| 21 | `opts: {missingAdvanc: 6}` (one dropped `e`) | constructs, `missingAdvance` 0, no error | F-28 |
| 22 | `opts: 7` / `'x'` / `{checked: true}` | each constructs | F-28 |
| 23 | `align` 3, -1, 1.5, NaN | all render LEFT (dx0 0) | PROBE (i) |
| 24 | `vAlign` 3, -1, NaN | all fall through to TOP, dy0 2 | PROBE (g) |
| 25 | `draw` scale NaN / -1 / 0 / Infinity | 4 calls each; dx0/dw0 = NaN/NaN, 0/-10, 0/0, NaN/Infinity | PROBE (c) |
| 26 | `drawFast(rec,1234,0,0,NaN,0)` | 6 calls at dx NaN | PROBE (d) |
| 27 | T2 flags fixture, `flags` 0/1/1.0000001/2/-1/NaN | 5 / 8 / 5 / 5 / 5 / 5; dots at dx 60, 72, 84 | `t2-layout.mjs:132-157` |

## Fork (1) -- the lane split: always-throw versus checked

Options as the brief framed them: **A** validate everything, always. **B**
checked mode only, off by default. **C** split by whether the input can possibly
work.

**Decision: C, with two named amendments -- RATIFIED, and the recommendation is
challenged before it is accepted.**

The challenge C has to survive is this: a default-off lane is a lane most
callers never run, which is precisely how the descriptor stayed unvalidated for
three minor versions (the brief's own objection to B). C inherits that objection
for everything it routes to the checked lane. Two things answer it and they are
why C is ratified rather than merely adopted:

1. **C's checked lane holds only LOSSY-but-interpretable inputs.** Every input
   with no correct interpretation under any reading is in the always-throw lane,
   where the default-off objection cannot reach it. A caller who never sets
   `checked` still cannot construct a font that renders nothing.
2. **The lane is reachable, because fork (2) makes the bag fail closed.** A
   `checked` flag guarded by a bag that silently swallows `{ cheked: true }` is a
   validator that cannot be turned on reliably. F-28 is therefore not an adjacent
   cleanup, it is C's precondition, and fork (2) is settled before fork (1) is
   implemented.

**Rejected alternatives.** A is rejected on the brief's own ground: fractional
`xadvance` is emitted by real BMFont exporters (F-08), and hard-failing at load
turns a 0.6px-per-glyph drift into a crash for a font that renders correctly
enough to ship. B is rejected because it leaves `atlas: null` constructing by
default, which is the finding.

**Amendment 1 (F-30 does not follow F-08 by analogy).** F-08's two cases -- a
40000 wrap and an 8.6 truncation -- are lossy but interpretable: there is a
reading of each that renders the intended glyph slightly wrong. There is no
reading of `x: NaN` that renders the intended glyph. It stores 0 and reports
covered (row 15), so the table asserts with full confidence that the glyph sits
at the sheet's top-left corner. `null is not zero`. **Non-finite goes to
ALWAYS-THROW; out-of-range-but-finite and non-integer go to CHECKED.**

**Amendment 2 (type is not lossiness).** `id: '65'` and `first: true` are not
lossy readings of a number; they are not numbers. A string that coerces to a
valid id is indistinguishable at the store from a correct descriptor and
invisible to `hasGlyph` (row 16). **Type violations go to ALWAYS-THROW in both
the chars loop and the kernings loop, under one shared predicate.**

**The M9 promotion path, recorded so it is not re-derived:** in 2.0.0 the lossy
lane becomes default-on and the option flips to `{ checked: false }`. Nothing in
M3 may make that flip harder -- in particular, no message text and no error type
may encode the word "optional".

## Fork (2) -- the `opts` bag (F-28). Settled HERE, ahead of any `checked` work

Options: **A** leave it (status quo: any non-null non-undefined value accepted;
unknown keys ignored). **B** validate the bag's type only. **C** validate type
AND reject unknown own keys against a frozen allowlist.

**Decision: C -- RATIFIED. `opts` must be a plain object or `undefined`/`null`;
every own key must be in the frozen allowlist `['missingAdvance', 'checked']`;
an unknown own key THROWS, naming the key and listing the allowed ones.**

Recorded reasons:

1. **The typo is the finding.** `{ missingAdvanc: 6 }` constructs today with
   `missingAdvance` 0 and no error (row 21) -- the exact F-12 gap the option
   exists to close, silently reopened by one dropped character.
2. **`checked` cannot be default-off AND typo-swallowing.** Those two properties
   together make a validator that a caller believes is on and that is off. That
   is worse than no validator.
3. **`opts: 7` constructing is not a compatibility surface** (row 22).
   `(7).missingAdvance` is `undefined`, so every caller passing a primitive today
   is getting the default and could equally have passed nothing.
4. **Cold path. Cost is irrelevant.** Two type tests and a loop over
   `Object.keys(opts)` -- which allocates, and that is fine, because the
   constructor is not a hot body and no measured window constructs a font
   (`decisions/0002:283-284`).

**Rejected alternatives.** A is the status quo -- the finding itself. B closes
`opts: 7` but still swallows `{ missingAdvanc: 6 }`, leaving the typo hole open,
so a default-off `checked` remains unturnable-on.

**Allowlist mechanics.** A module-level `Object.freeze(['missingAdvance',
'checked'])`, iterated with `Object.prototype.hasOwnProperty`, so a caller who
has put `missingAdvance` on a prototype gets the same "unknown key" answer as a
caller who misspelled it. Inherited keys are not own keys and are not accepted.

**The `checked` flag itself:** `checked` must be exactly `true` or `false` or
absent. **`checked: 1` throws**, on the same reasoning as amendment 2 -- a
truthiness test on a validator's own switch is the last place to accept a
coercion. Default `false`.

## Fork (3) -- is `chars: []` legal?

Options: **A** legal, a font with no glyphs is degenerate but coherent. **B**
illegal, a font that can render nothing should not construct.

**Decision: A -- legal, RATIFIED, and the brief's recommendation is upheld.**

Three reasons: (i) it is **coherent** -- every method has a defined, correct
answer (`measure` 0, `draw` draws nothing, `hasGlyph(id)` false for every id),
which is not true of `chars: 7`, whose 0-glyph font is an accident of `7.length`
being `undefined`; (ii) it is **detectable** -- M2 shipped `hasGlyph` precisely
so a loader can find coverage gaps at boot, and an empty font is the limiting
case of a coverage gap, reported honestly; (iii) **rejecting it would forbid a
legitimate composition** -- a font assembled incrementally, or a
deliberately-empty placeholder swapped for a real atlas after load.

**Rejected alternative.** B forbids a coherent, detectable, composable input for
no gain: the accident it means to catch (`chars: 7`) is a NON-array and is caught
by fork (4)'s predicate, not a length test. `chars: []` is an empty ARRAY;
`chars: 7` is not an array at all. Under a length test they are the same input,
which is exactly why the brief's prescription fails.

## Fork (4) -- how `chars` (and `kernings`) is validated: pre-pass or per-element

Options: **A** a cold pre-pass that walks `[0, length)` before the store loop and
throws before writing anything. **B** per-element validation inside the existing
loop.

**Decision: A -- the pre-pass, RATIFIED.**

Reasons: (i) **atomicity.** B writes glyphs for elements 0..k-1 and then throws
at k, leaving a partially-populated `glyphs`/`_mapped` on an object the caller may
still hold. A constructor that throws must leave no half-built font; (ii)
**error quality.** The pre-pass reports the first bad index with its index, which
is what a caller needs to fix a 200-entry descriptor; (iii) **cost is
irrelevant** -- cold path, one extra pass over an array the constructor already
walks once.

**Rejected alternative.** B is non-atomic and reports the raw `TypeError` from
inside the store loop rather than a named index, which is the very F-10 symptom
this session closes.

**The predicate, in prose:** `chars` is valid iff it is **not a string**, has an
integer `length` in `[0, 2^32)`, and **every index in `[0, length)` yields a
non-null object**. The "not a string" clause is explicit and separate because a
string satisfies every other clause. `kernings`, **when present**
(`undefined`/`null` remain legal), is validated by the same predicate.
`kernings: 7` currently drops every pair silently; after M3 it throws.

## Fork (5) -- where the `scale` door lives, and what it costs `drawFast`

Options: **A** door in `draw`, `drawWrapped`, `drawFast` AND
`measure`/`_measureRange`. **B** door in the three DRAW bodies only. **C** door
in `draw` and `drawWrapped` only, leaving `drawFast` at M2's committed zero.

**Decision: B -- the three draw bodies, and M2's `drawFast` commitment is
deliberately broken. RATIFIED.**

Reasons, in order of force:

1. **`drawFast` has the bug** (row 26): 6 calls at dx NaN with `scale: NaN`.
   Leaving it out (option C) would mean the session's headline fix does not cover
   the package's headline use case -- a per-frame HUD counter.
2. **`measure` must NOT get one** (option A rejected). `measure` returns a number
   and writes no pixel. FIVE T1 pins assert its degenerate answers today. Those
   are honest arithmetic on a pure function, and a door there would redden five
   rows to change a return value nobody complained about. `_measureRange` keeps
   ZERO executable change in this session.
3. **The commitment is broken openly, with a number.** `decisions/0002:241` and
   `SESSION-M2.md:187` say `drawFast` costs zero. M3 adds ONE per-call test to
   it. Recorded here so the next reader finds the reversal in the decision record
   and not by diffing two sessions.

**Rejected alternatives.** A reddens five documented `measure` pins to change a
pure function's return value. C leaves the HUD counter as the one renderer that
draws at NaN -- an omission, not a tradeoff.

**The door's form:** `if (!(scale > 0 && scale < Infinity)) return;` -- NaN
fails both comparisons, so the negation returns; `0` and `-1` fail the lower
bound (which a NaN test cannot see); `Infinity` fails the upper. One test, two
comparisons, per call, in each of the three draw bodies. Fail-closed policy:
**draw NOTHING** (ROADMAP law 3), consistent with `drawFast`'s existing magnitude
door (`decisions/0001`, option C) rather than with `drawWrapped`'s short-buffer
throw: a bad `scale` has a correct silent answer -- draw nothing -- and a short
layout buffer has none.

`scale === Infinity` is inside the door and rejected, so it draws nothing.

## Fork (6) -- out-of-range `align`: throw or document-as-left?

Options: **A** throw. **B** document as left-aligned.

**Decision: B -- document as left. RATIFIED.**

Reasons: (i) **it already is left, in every path** -- `align: 3` and `align: -1`
render identically to `align: 0` (row 23); (ii) **there is no NaN and no
corruption** -- the `align === 1` / `align === 2` chain falls through, which is
the correct answer, merely undocumented; (iii) **T1 `:76-83` already asserts it
with an equality**, so choosing A means reddening a committed torture row to
change a behaviour that is not a defect; (iv) **`align` is per-call in a
per-frame renderer** and a throw would kill a live frame over a cosmetic
argument.

**Rejected alternative.** A throws on a per-call argument that already produces
correct pixels, killing a live frame; it also reddens a committed T1 equality
that pins the existing correct behaviour.

**What "document" means:** the JSDoc, `BitmapFont.d.ts`, `llms.txt` and README
each state that any `align` outside `{0, 1, 2}` -- including `NaN`, negatives and
fractionals -- renders LEFT, and T1 `:76-83` is re-commented from
"unvalidated (F-11)" to "the documented contract (M3, decisions/0003 fork 6)".

**Not harmonised with `scale`:** `align: 3` has a correct interpretation (fall
through to left) and produces valid pixels; `scale: NaN` has none and produces
NaN destination coordinates. One rule -- interpretable -> documented fallback;
uninterpretable -> fail closed -- applied twice with different answers because the
inputs differ.

## Fork (7) -- `vAlign` (the question the brief never asks)

**Decision: identical to fork (6) -- out-of-range `vAlign` documents as TOP.
RATIFIED.**

`vAlign` of 3, -1 and NaN all fall through to top today (row 24, dy0 2).
`BitmapFont.js:450` guards the whole vertical-alignment block with
`if (vAlign > 0 && boxHeight > 0)`, which NaN already fails -- so a NaN `vAlign`
is `Math.round`-free and produces no NaN `dy`. The behaviour is correct and
undocumented; M3 documents it, with its own cases in T3 and its own row in T1.

**Rejected alternative.** A throw on `vAlign` kills a live frame for a cosmetic
argument, exactly as fork (6)'s A does, and additionally has no committed pin to
invert because the brief never measured it -- which is the F-24 shape and the
reason `vAlign` gets its own measured row (row 24) rather than an assumed policy.

Recorded because the brief never asked: a policy stated for `align` and assumed
for `vAlign` is the F-24 shape.

## Fork (8) -- the `flags` contract (F-13)

Options: **A** exact bitfield: `(flags | 0)`, validated against a known mask.
**B** strict 0/1: reject anything not exactly 0 or 1. **C** status quo
(`flags === 1`, everything else silently ignored).

**Decision: A -- the validated bitfield, RATIFIED**, with the failure mode
named.

Reasons: (i) **`flags` arrives through a `Float32Array`, so exact equality
against `1` is the wrong tool by construction** -- a layout engine that computes
a flag arithmetically can produce `1.0000001192092896` and lose its ellipsis with
no signal; (ii) **the mask must exist before bit 2 does** --
`@zakkster/lite-text-layout` emits this buffer as a cross-package contract, and a
second flag arriving against a strict-0/1 door is a breaking change for the
consumer at exactly the wrong moment; (iii) B is a policy that has to be revisited
the first time anyone adds a flag.

**Rejected alternatives.** C is the finding (a Float32 strict-compare miss). B
breaks the cross-package buffer contract the first time a second flag ships.

**The contract, stated exactly:**

- `const f = flags | 0;` -- ToInt32, so `1.0000001192092896 | 0` is `1` and the
  ellipsis fires.
- `FLAG_ELLIPSIS = 1`. `if (f & FLAG_ELLIPSIS)` replaces `if (flags === 1)`.
- **Unknown bits must stop being silent.** `FLAG_MASK = 1`. A `flags` value with
  a bit outside the mask is a caller error, **routed to the CHECKED lane** -- so
  `checked` fonts throw naming the value and the unknown bits, and unchecked fonts
  ignore the unknown bits exactly as today. `flags: 2` therefore stays at its
  measured call count in the default lane and throws under `checked: true`.

**The consequence, measured (MEASURE FIRST, M3-T13):** `flags = -1` is
`-1 | 0 === -1`, and `-1 & 1 === 1`, so `-1` fires the ellipsis after the change
and did not before. `flags = NaN` is `NaN | 0 === 0` -> no ellipsis, unchanged.
`flags = 2` -> `2 & 1 === 0` -> no ellipsis, unchanged. `-1`'s delta is a
declared behaviour delta (CHANGELOG `Changed (behaviour)`).

## The accept/reject matrix -- one row per malformed input, every row routed

| # | Input | Today (2.2) | Lane | Answer | Reason for the lane |
| --- | --- | --- | --- | --- | --- |
| 1 | `imageAtlas` `null` | constructs; `draw` -> 2 calls, imgMismatch 2 | ALWAYS-THROW | throws naming `imageAtlas` | No reading of a null atlas renders anything |
| 2 | `imageAtlas` `undefined` | same | ALWAYS-THROW | same | same |
| 3 | `imageAtlas` a primitive (`7`, `'x'`) | constructs | ALWAYS-THROW | throws naming `imageAtlas` | Not an image; `drawImage` cannot take it |
| 4 | `fontJson` `null` | raw `TypeError` | ALWAYS-THROW | library error naming `fontJson` | Already fatal; only the error type and message change |
| 5 | `fontJson` `{}` | raw `TypeError` | ALWAYS-THROW | library error naming `common` | same |
| 6 | `fontJson` a primitive | raw `TypeError` | ALWAYS-THROW | library error naming `fontJson` | same |
| 7 | `common` missing / `null` | raw `TypeError` | ALWAYS-THROW | library error naming `common` | Metrics are not optional |
| 8 | `common.lineHeight` non-finite | constructs; every line at NaN Y | ALWAYS-THROW | throws naming `common.lineHeight` + value | NaN Y renders nothing anywhere |
| 9 | `common.lineHeight` non-number (`'20'`, `true`) | coerces | ALWAYS-THROW | same | Amendment 2: type is not lossiness |
| 10 | `common.base` non-finite | constructs (PROBE f) | ALWAYS-THROW | throws naming `common.base` + value | Feeds every `dy` in three bodies |
| 11 | `common.base` non-number | coerces | ALWAYS-THROW | same | Amendment 2 |
| 12 | `chars` missing | raw `TypeError` | ALWAYS-THROW | library error naming `chars` | A font needs a glyph table, even an empty one |
| 13 | `chars: 7` | 0-glyph font | ALWAYS-THROW | throws naming `chars`, `typeof` received | Fork (4): not array-like |
| 14 | `chars: 'AB'` | 0-glyph font | ALWAYS-THROW | throws naming `chars`, "string" | Fork (4): the explicit string clause |
| 15 | `chars: {length: -1}` | 0-glyph font | ALWAYS-THROW | throws naming `chars.length` + value | Not an integer length in `[0, 2^32)` |
| 16 | `chars: {length: 3}`, no elements | raw `TypeError` from inside the loop | ALWAYS-THROW | throws naming `chars[0]` | Fork (4) pre-pass: the index is in the message |
| 17 | `chars: []` | 0-glyph font | ACCEPT | constructs; `hasGlyph(id)` false for all | Fork (3): degenerate but coherent |
| 18 | `chars` element `null`/non-object | raw `TypeError` | ALWAYS-THROW | throws naming `chars[i]` | Fork (4) pre-pass |
| 19 | `char.id` non-number (`'65'`, `null`, `true`) | writes; `hasGlyph` lies | ALWAYS-THROW | throws naming `chars[i].id` + value | F-29. Amendment 2. A silent write to an id the descriptor never named, invisible to the coverage API |
| 20 | `char.id` non-integer OR non-finite -- `65.5`, `NaN`, `Infinity`, `-Infinity` | `65.5` writes nothing; `NaN` writes nothing | ALWAYS-THROW | throws naming `chars[i].id` + value | Same predicate as row 19 (`typeof === 'number' && id === (id\|0)`, which rejects every non-finite by construction). A fractional or non-finite id names no glyph under any reading -- amendment 1, identically to `x: NaN` at row 22. `NaN` lives HERE and only here |
| 21 | `char.id` FINITE integer outside `[0, 256)` -- `-1`, `256`, `3000` | silently skipped | CHECKED | unchecked: skipped, `hasGlyph` false, no throw. checked: throws naming the id and the 8-bit ceiling | The 8-bit ceiling is structural (ROADMAP law 5). A Unicode descriptor is a legitimate input whose upper plane this font cannot hold; skipping is the correct lossy reading, and `hasGlyph` reports the gap. Scoped to FINITE ids deliberately: `NaN` is row 20's, always-throw, and is NOT in this row's case list. Row 32's kerning-key twin is scoped the same way and the two must not diverge |
| 22 | glyph field non-finite (`x: NaN`, `+/-Infinity`) | stores 0, reports covered | ALWAYS-THROW | throws naming the field + value | F-30. Amendment 1: no reading of `x: NaN` renders the intended glyph |
| 23 | glyph field non-number (`x: '10'`) | coerces | ALWAYS-THROW | throws naming field + value | Amendment 2 |
| 24 | glyph field out of `[-32768, 32767]` (`x: 40000`) | stores `-25536` | CHECKED | unchecked: wraps (pinned, documented). checked: throws naming 40000 and -25536 | Lossy but interpretable; a real exporter targeting a huge sheet produces it |
| 25 | glyph field non-integer (`xadvance: 8.6`) | stores 8; `measure('AA') === 16` vs exact 17.2, residual 1.2 | CHECKED | unchecked: truncates (pinned, documented). checked: throws naming the per-glyph and per-40-glyph drift | Lossy but interpretable; BMFont exporters emit fractional advances |
| 26 | negative non-integer (`xadvance: -8.6`) | stores -8 | CHECKED | same lane; message must say "truncates toward zero", never "floor". **Both lanes asserted (F-33):** the unchecked store `-8` is pinned in T3 row 26 and the F-08 node:test block, so the "toward zero" wording cannot outlive the behaviour it describes | PROBE (i): the store truncates toward zero. A message saying "floor" would be wrong for every negative. F-33 (T3 row 26 asserted only the checked lane) was found by qa and closed in M3 -- the unchecked `-8` (never `-9`/floor) is now executable |
| 27 | `kernings` absent / `null` | loop skipped | ACCEPT | unchanged | Kerning is optional in BMFont |
| 28 | `kernings: 7` | every pair silently dropped | ALWAYS-THROW | throws naming `kernings`, `typeof` | PROBE (h). Fork (4)'s predicate. Silent total loss of a descriptor section |
| 29 | `kernings` element non-object | raw `TypeError` | ALWAYS-THROW | throws naming `kernings[i]` | Fork (4) pre-pass |
| 30 | `k.first`/`k.second` non-number (`'65'`, `true`) | writes 16706 / 322 | ALWAYS-THROW | throws naming the key + value | F-09 + PROBE (b). Kerns a pair the descriptor does not name |
| 31 | `k.first`/`k.second` non-integer (`65.5`, `255.9`) | writes 16706 / 65346 | ALWAYS-THROW | same predicate as 30 | Same: a fractional key silently kerns the integer pair |
| 32 | `k.first`/`k.second` finite and out of `[0, 256)` (`-1`, `300`) | `-1` writes nowhere | CHECKED | unchecked: skipped. checked: throws naming the key | Row 21's twin, scoped identically: finite out-of-range keys are CHECKED; a non-finite key is row 34's ALWAYS-THROW. The two rows are the two halves of one policy and must not diverge |
| 33 | `k.first`/`k.second` `>= 256` | skipped (upper bound already checked) | CHECKED | same as 32 | Same reason; this is the half already implemented |
| 34 | `k.amount` non-finite / non-number | stores 0 / coerces | ALWAYS-THROW | throws naming `kernings[i].amount` | Rows 22/23 applied to the kerning table |
| 35 | `k.amount` non-integer (`-1.7` -> `-1`) | silent | CHECKED | F-08 lane, same message shape | The brief routes `amount` truncation to the F-08 lane explicitly |
| 36 | `k.amount` out of Int16 (`40000` -> `-25536`) | silent | CHECKED | F-08 lane | Same as row 24 |
| 37 | `opts` a primitive (`7`, `'x'`) | constructs | ALWAYS-THROW | throws naming `opts` | F-28. Fork (2) |
| 38 | `opts` unknown own key (`missingAdvanc`) | constructs, default 0 | ALWAYS-THROW | throws naming the key + the allowlist | F-28. Fork (2). A default-off flag behind a typo-swallowing bag is unturnable-on |
| 39 | `opts.checked` non-boolean (`1`, `'yes'`) | ignored | ALWAYS-THROW | throws naming `opts.checked` | Fork (2): no coercion on the validator's own switch |
| 40 | `opts.missingAdvance` out of `[0, 32767]` / NaN | already throws `RangeError` (M2) | ALWAYS-THROW | unchanged behaviour, new error type (section 9) | M2's door; only the type changes |
| 41 | `scale` `NaN` / `Infinity` / `0` / `-1` in `draw` | 4 calls; NaN or negative/zero `dw` | ALWAYS (per call) | draw nothing, return | Fork (5). ROADMAP law 3: fail closed = zero `drawImage` calls |
| 42 | same in `drawWrapped` | 5/5/5/5 calls (MEASURE FIRST) | ALWAYS (per call) | same | same |
| 43 | same in `drawFast` | 6 calls at dx NaN for `scale: NaN` | ALWAYS (per call) | same | Fork (5); M2's zero-cost commitment broken deliberately |
| 44 | `scale` in `measure` / `_measureRange` | `0` -> 0, `-1` -> `-baseW`, `NaN` -> NaN | ACCEPT (no door) | unchanged | Fork (5) reason 2: pure function, no pixels, five T1 pins |
| 45 | `align` outside `{0,1,2}` (3, -1, 1.5, NaN) | renders LEFT | ACCEPT (documented) | renders LEFT, now documented | Fork (6) |
| 46 | `vAlign` outside `{0,1,2}` (3, -1, NaN) | falls through to TOP, dy0 2 | ACCEPT (documented) | renders TOP, now documented | Fork (7) |
| 47 | `flags` `1.0000001` | no ellipsis (5 calls) | FIXED (always) | `\| 0` -> `1` -> ellipsis fires | Fork (8) |
| 48 | `flags` with unknown bits (`2`) | silently ignored | CHECKED | unchecked: ignored. checked: throws naming value + unknown bits | Fork (8): unknown flags stop being silent, without killing a frame by default |
| 49 | `flags` `-1` | 5 calls | FIXED (always), delta | `-1 & 1 === 1` -> ellipsis now fires. MEASURE FIRST | Consequence of the bitfield; declared as a behaviour delta |
| 50 | `flags` `NaN` | 5 calls | unchanged | `NaN \| 0 === 0` -> no ellipsis | Confirms the change is narrow |

**Unfilled cells: 0. Undecided count: 0. Fifty rows, fifty lanes.**

## The hot-path section of the record

### The constructor is COLD.

It runs once per font per process (ROADMAP law 7). Every validation in the
matrix rows 1-40 lives there. It may allocate (`Object.keys(opts)`), it may walk
`chars` twice, it may build an error message with template concatenation. No
measured window in the suite constructs a font -- T6's four windows use fonts
built at module scope in `harness.mjs:289-295` (`decisions/0002:283-284`). T7
constructs 4096 fonts, and that tier measures retention, not throughput.

### The per-call budget

| Body | Per-glyph before | Per-glyph after | Per-line before | after | Per-call before | after |
| --- | --- | --- | --- | --- | --- | --- |
| `_measureRange` | 2 | 2 (untouched) | 0 | 0 | 0 | 0 |
| `measure` | -- | -- | -- | -- | 0 | 0 |
| `draw` | 2 + 1 `&&` + 1 `!` | unchanged | 0 | 0 | 0 | +2 comparisons, +1 `&&`, +1 `!` |
| `drawFast` | -- | unchanged | -- | -- | 3 (magnitude door) | +2 comparisons, +1 `&&`, +1 `!` |
| `drawWrapped` | 2 + 1 `&&` + 1 `!` | unchanged | +2 (M2) | +2, +1 `\|0`, +1 `&` (flags) | 2 + `Math.floor` + multiply (M2) | +2 comparisons, +1 `&&`, +1 `!` |

**THE COMMITTED BUDGET, as one number: ZERO new per-glyph instructions in all
four hot bodies; ONE new per-call range test (2 comparisons) in each of the three
DRAW bodies; ONE new per-line ToInt32 + mask in `drawWrapped` replacing an
existing strict compare.** The per-line flags change is a substitution, not an
addition: `flags === 1` (one comparison) becomes `(flags | 0) & 1`.

### "assertOps" -- what the gate actually is

`OpsRules` has no throughput rule in the installed profiler v1.15.0, so
"assertOps" is not a throughput gate. It resolves into four things, three gated
and one recorded:

1. GATED -- `runOpsGate` / `checkNoGc`, `RULES = { maxMajor: 0, maxPauseMs: 4,
   maxArrayBuffersGrowth: 0 }`, on T6's four windows, `stabilize: 'deep'`.
2. GATED -- `runAllocGate` / `checkAllocs`, `ALLOC_RULES = { maxBytesPerCall: 0 }`
   on the same four. Gate on `verdict !== 'pass'`.
3. GATED -- the four exact `rec.total` integers. Every window drives `scale = 1`,
   inside the new door, so all four totals must be unchanged.
4. RECORDED, not gated -- the four paired child-process `measureOps` medians,
   verdict rule `>= 0.97` on each, `measure` as the negative control.

### Structural cost

No new typed array. `_charScratch` 24, `glyphs` 3584, `kerning` 131072,
`_mapped` 32, total **134,712** -- unchanged from `decisions/0002:270-271`, and
this is what T6's four structural equalities pin.

**One new per-font field is added: `this.checked` (a boolean).** It is required
because `flags` is per-line runtime data consumed only in `drawWrapped`, so the
checked-mode unknown-bit throw (fork 8) cannot hoist to construction; the font
must carry its lane at draw time. This corrects plan 7(k)'s "M3 adds no per-font
field": M3 adds exactly one, a boolean. Its cost is recorded honestly so nobody
re-derives it:

- It does NOT move the structural typed-array total (134,712), so **T6's four
  byteLength equalities cannot see it** (F-31 shape).
- It is a primitive, retains nothing, and needs no `destroy()` change, so **T7's
  retention witness cannot see it either** (and T7 is F-27-blind regardless).
- It is the LAST own property assigned in the constructor, so the object shape
  stays monomorphic and the hot bodies stay in the same map.

A reviewer looking for the cost of `this.checked` will find no gate that reports
it; that is stated here rather than left for someone to discover.

### Error type (the two M2 throws, and the short-buffer deviation)

`BitmapFontError extends RangeError`, so `instanceof RangeError` is preserved for
every throw. M2 shipped two bare `RangeError`s; M3 treats them differently and
NOT uniformly:

- **`missingAdvance` range door** (constructor): widened to `BitmapFontError`,
  `field: 'opts.missingAdvance'`. Its message text CHANGED -- 1.2.x said
  `lite-bmfont: missingAdvance must be ...`, M3 says
  `lite-bmfont: opts.missingAdvance must be ...` -- because T3 row 51 asserts
  `e.message.includes(e.field)` and the field is the full path. This is a shipped
  1.2.x message change, declared in the CHANGELOG's `Changed (behaviour)`.
- **`drawWrapped` short-buffer door**: deliberately LEFT a bare `RangeError`.
  Plan section 9 aspired to widen it to `BitmapFontError` (`field: 'layoutBuffer'`),
  but M3-T14 forbade touching that throw, and the two constraints conflict. M3-T14
  wins: the pinned "4 / 12" message assertions (`t1-degenerate.mjs:175`,
  `t2-layout.mjs` row 4) stay green with no edit, T3's row-51 sweep is scoped to
  the constructor and does not reach `drawWrapped`, and `instanceof RangeError`
  still holds. Section 9's aspiration is therefore SUPERSEDED for this one throw;
  widening it belongs to a session that also revises those two pins. The two M2
  throws are not handled uniformly, on purpose, and this is the record of why.

### The four paired `measureOps` medians (verdict rule `>= 0.97`)

Paired child-process runs, five alternating reps (`old,new,old,new`), fresh child
per rep. `OpsRules` has no throughput rule so these are recorded numbers, not a
gate. `measure` is the negative control (takes no new instruction).

Baseline (v1.2.3, M3-T04, taken before any edit):

| Body | v1.2.3 median ops/s | min | max |
| --- | --- | --- | --- |
| `draw` | 1,662,020 | 1,638,484 | 1,669,085 |
| `drawWrapped` | 2,084,964 | 2,073,278 | 2,111,512 |
| `drawFast` | 15,175,418 | 15,100,989 | 15,193,672 |
| `measure` | 8,270,637 | 7,520,880 | 8,508,110 |

All variants: `bytesPerOp` 0 (draw, drawFast) / ~0.039 (drawWrapped) / ~0.017
(measure) -- noise; `gc.major` 0, `gc.maxMs` 0.000.

Paired old vs new (M3-T20, edited tree; 5 alternating reps, fresh child per rep):

| Body | v1.2.3 median | min | max | v1.3.0 median | min | max | ratio |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `draw` | 1,613,955 | 1,570,382 | 1,656,791 | 1,645,480 | 1,614,604 | 1,672,261 | 1.0195 |
| `drawWrapped` | 2,050,106 | 2,021,851 | 2,071,562 | 2,055,257 | 2,025,115 | 2,105,585 | 1.0025 |
| `drawFast` | 14,814,174 | 14,348,790 | 15,120,919 | 14,714,538 | 14,539,331 | 15,496,567 | 0.9933 |
| `measure` | 8,134,237 | 7,361,055 | 8,262,318 | 8,108,081 | 7,335,053 | 8,175,690 | 0.9968 |

All four ratios are `>= 0.97` (1.0195 / 1.0025 / 0.9933 / 0.9968). Each of the
three DRAW bodies carries one new per-call range test and lands inside the
bench's noise band: a per-call comparison against a body whose own loop runs many
times is free at this resolution. `measure` is the negative control -- its code
is byte-identical -- and across three back-to-back paired runs its ratio read
0.9294 / 1.1244 / 0.9968, so the bench's own noise floor on this host is about
+/-7% and no DRAW-body ratio moved outside it. No risk-(b) fallback needed. All
variants: `bytesPerOp` 0 / ~0.036 / 0 / ~0.017, `gc.major` 0, `gc.maxMs` 0.000.

### Mutation-sweep note: A19a's first detector

The scale door's "invert the bound" mutation (A19a: write
`!(scale > 0 && scale < Infinity)` as `(scale > 0 && scale < Infinity)`) is
attributed by the plan to **T6/A,B,C** (the three non-zero `rec.total` windows
drop to 0). That reproduces IN ISOLATION -- running T6 alone reddens
`T6/A: rec.total 0 != 12710000`. But in a FULL torture run the mutation reddens
**T0 law 1** first (`T0.law1: draw drew 0 of 42`), six tiers earlier, because
inverting the door makes `scale = 1` return and `draw` draws nothing, which T0's
conservation law catches before T6 runs. The plan is not wrong that T6 detects
it; it is wrong about which row fires FIRST. Recorded so nobody re-derives it.

## Semver

The criterion: 1.2.3 is byte-identical for every call whose inputs satisfy the
documented contract. This is a **minor** bump (1.3.0): a minor is the smallest
bump that can carry a new throw, and the descriptor door adds throws.

**The claim, stated AS a claim: no working call site changes.** Every
newly-rejected descriptor produces a font that renders nothing (`chars: 7`,
`chars: 'AB'`, `kernings: 7`), renders at NaN (`lineHeight: NaN`, `base: NaN`),
renders a glyph the caller never named (`id: '65'`, `first: 65.5`), or renders
through a null image (`atlas: null`). Every newly-rejected `scale` produced NaN
coordinates or zero/negative destination widths. Neither category can be part of
a working call site.

**The reason it is a claim and not a fact:** a caller may be constructing a font
from a user-supplied descriptor inside a `try` that today never fires, and M3
makes it fire. A caller may be passing `{checked: true}` today, harmlessly (row
22, it constructs), and M3 turns it into a validator. A caller may be pre-clamping
`scale` to 0 to hide text and relying on the four zero-width draw calls being
issued. None render correct pixels today; all are call sites that exist. The
CHANGELOG carries this under `Changed (behaviour)`, not `Fixed`.

The behaviour deltas, enumerated: `atlas: null`/`undefined`, `chars: 7`/`'AB'`/
`{length:-1}`, `kernings: 7`, `lineHeight: NaN`, `base: NaN`, `id: '65'`/`null`/
`true`/`65.5`/`NaN`, `x: NaN`, `first: '65'`/`65.5`/`true`, `opts: 7`, any `opts`
unknown key now throw; `scale` NaN/0/-1/Infinity now draw nothing on three
methods; `flags: 1.0000001` now draws an ellipsis; `flags: -1` now draws one;
`{checked:true}` fonts can throw where nothing threw before.

**F-08 is NOT in the `Fixed` table.** M3 makes F-08 detectable (checked mode
names the drift with its exact number); the storage behaviour is unchanged and is
M9's. F-08 appears under `Added` (detection-only) and takes the split-owner
ledger cell `M3 (detection) / M9 (storage)`, precedent F-14 at `CHANGELOG.md:184`.
