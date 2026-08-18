# 0005 -- drawFastInt, and the F-23 routing decision

Status: accepted
Session: M8 (v1.5.0)
Findings: F-23 (re-routed, not fixed)
Relates-to: decisions/0001-drawfast-magnitude.md (amends its F-23 routing sentence)
Date: 2026-08-18

## The question

`drawFast` renders one decimal place from char codes, zero-alloc. Game HUDs also
need to render integer COUNTS -- coins, kills, score, seconds -- where the ".0"
is noise and where the atlas may not even carry a '.' glyph. M8 adds a sixth
public method, `drawFastInt`, a second hot body. That raises five forks that
`decisions/0004`'s one policy applied to more faces does not cover, because this
is a NEW body with a NEW ceiling, not a new door on an old body.

The one sentence for the whole decision: **`drawFastInt` ships as a second,
independent hot body that is EXACT BY CONSTRUCTION at its own ceiling, `drawFast`
is byte-for-byte frozen, F-23 is re-routed to a named successor session, and the
shared `_charScratch` stops being an assumption and becomes a contract with a
control that violates it.**

## Fork (1) -- SCOPE. Does M8 fix F-23? NO. RE-ROUTED to M8b.

Three documents disagreed and could not all be obeyed: the brief wanted
`drawFast` diff-clean; `decisions/0001:190` (ratified) routed F-23's
digit-extraction rewrite to M8 "which already reopens `drawFast` for
`drawFastInt`"; `test/torture/t4-numeric.mjs` pinned both F-23 bands with the
message "(M8 will change this)".

Options:

- **A. Fix F-23 in `drawFast` AND ship `drawFastInt`, one diff.** What
  `decisions/0001` literally routed.
- **B. Fix F-23 in `drawFast` AND ship `drawFastInt`, as two separately
  reviewable ordered diffs in one session.**
- **C. Ship `drawFastInt` alone, freeze `drawFast`, re-route F-23 to a named
  successor.**

**Decision: C. RATIFIED.** F-23 is re-routed to a new session `M8b -- drawFast's
digit extraction (F-23)`, created in `ROADMAP.md` with `depends_on: [M8]`,
`blocks: [M9]`, `status: next`.

**A is rejected by `decisions/0001`'s own argument, turned around.** `0001`
refused to mix the arithmetic rewrite into M1's door diff because "mixing an
arithmetic rewrite into the door diff makes the diff unreviewable." That is a
general principle about diffs. M8's diff is a new ~130-line hot body, a new
export, a new ADR, three doc surfaces, a new T6 window, two new T9 controls and a
19-row T4 sweep. Adding a rewrite of the one body that must stay frozen to prove
the new body is independent makes M8's diff strictly less reviewable than M1's
was. The routing sentence in `0001` was written when M8 was believed to "already
reopen `drawFast`". P-4 proved it does not: `drawFastInt` shares zero arithmetic
with `drawFast`, only a buffer. **The premise of the routing failed, so the
routing does not bind** -- see the Amendment block in `decisions/0001`.

**B is the serious alternative and is rejected on a checkable ground.** Two
ordered diffs in one session sounds like it gets both properties; it does not,
because the second diff destroys the first one's proof. M8's central structural
claim is `drawFast`'s body sha equal to `git show 1a962c5:BitmapFont.js`'s. Under
B that sha moves by design, and the reviewer loses the only cheap instrument that
can tell "the coder touched `drawFast`" from "the coder harmonised the two loops
and carried `value * 10` into the exact one." B also forces a version decision M8
does not otherwise have to make (fork 4), and forces T4's six F-23 pins to be
rewritten in the same commit that changes the behaviour they pin -- the F-43
circularity in a new costume.

**What happens to the T4 pins:** they STAY, behaviour unchanged, prose corrected.
The two operator messages go from `(M8 will change this)` to `(M8b will change
this -- re-routed by decisions/0005 fork 1)`, and the third leg from `F-23 band N
fixed? re-open the pin` to `... M8b landed early? re-open the pin`. No polarity,
threshold or value changes. The pins go from "a countdown to M8" to "a freeze on
`drawFast` until M8b", which is a strictly stronger gate for this session.

**Residual cost, stated so it is not discovered later:** F-23 is the only open S2
in the package and C leaves it open for one more session. The mitigation is that
M8b is written into the ROADMAP as `status: next` with its own brief, not left as
a sentence in a decision doc -- which is how F-23 was routed the first time, and
it drifted.

## Fork (2) -- SCRATCH. SHARE `_charScratch`. RATIFIED (option A).

Options: **A** share the existing 24-byte `_charScratch`; **B** a second 24-byte
`Uint8Array` per font.

**Decision: A.** `_charScratch` is 24 bytes with two touch points today
(`drawFast`, `destroy`), so A is a clean share. B costs 24 bytes per font and, more
importantly, 24 bytes that T6's structural check would have to be taught about --
and F-31 says T6 cannot see an unlisted array at all. A second buffer is a
per-font allocation added in the exact session that F-31 proves the gate is blind
to. **The suite cannot currently prove B is only 24 bytes**, and that is the
argument that decides it.

**A's assumption, made a contract.** A is safe only because neither body is
re-entrant: `ctx.drawImage` is the only foreign call, and a real
`CanvasRenderingContext2D` cannot call back into user code. That is false for an
arbitrary object with a `drawImage` method -- including this suite's own recording
ctx. So:

1. The contract line goes in the source header, `README.md`, `llms.txt` and
   `BitmapFont.d.ts`: "`ctx.drawImage` must not re-enter the font. `drawFast` and
   `drawFastInt` share one 24-byte scratch buffer; a re-entrant ctx corrupts the
   outer call's digits."
2. T9 control 16 VIOLATES it and asserts the corruption is real. A contract
   nobody can violate in a test is decorative.
3. T4 asserts the interleaving that IS safe: 100,000 alternating
   `drawFast`/`drawFastInt` calls produce byte-identical output to calling each
   in isolation. The share is proven by exercise, not by argument.

**B is not rejected as unreasonable -- it is rejected as unprovable-cheaper
today.** If M9's F-31 fix lands a structural TOTAL, B becomes a 24-byte question
again and may be revisited. Recorded so M9 does not treat A as immovable.

## Fork (3) -- TRUNCATION vs ROUNDING. TRUNCATE. `1.9` -> `"1"`. RATIFIED.

Options: **A** truncate toward zero (`1.9` -> `"1"`); **B** round to nearest
(`1.9` -> `"2"`), matching `drawFast`'s "rounded to nearest tenth".

**Decision: A, and the in-kind disagreement with `drawFast` is DELIBERATE.**

A counter must never appear to reach a value it has not reached. Under B, a score
of 99.6 renders `"100"` -- the player sees the target hit before it is hit, and
the number goes backwards to `"99"` if recomputed slightly lower. Every integer
counter in a HUD is a floor: coins, seconds, kills, level. `Math.floor` is what a
counter means, and for the non-negative range `drawFastInt` admits (negatives
clamp to 0) `Math.trunc` and `Math.floor` coincide -- which is why the oracle can
be written as `Math.trunc` without smuggling in a second policy.

The two methods answer two different questions: `drawFast` renders a MEASUREMENT
(33.4 FPS, 12.7 s) where the nearest tenth is the best representation of a
genuinely fractional quantity; `drawFastInt` renders a COUNT, where 99.6 is 99
and there is a threshold not yet crossed.

**B is rejected on a second, independent ground: it would reintroduce F-23 band 1
into a body that is currently exact by construction.** Rounding needs a
comparison against the fractional part, and the natural implementations
(`Math.round(value)`, `Math.floor(value + 0.5)`) are inexact near the ceiling:
`Math.floor(v + 0.5)` for `v` close to 2^53 adds a quantity below the ulp and can
round the wrong way. `Math.trunc` on an admitted value is exact for every input
in the door, with no argument required. Fork (3) B costs the property fork (1) C
was ratified to protect. That is decisive.

Pinned, in three places, in these exact words: "`drawFastInt` TRUNCATES toward
zero: `1.9` renders `"1"`, not `"2"`. `drawFast` ROUNDS to the nearest tenth.
This is deliberate -- `drawFast` renders a measurement, `drawFastInt` renders a
count, and a count must never display a threshold it has not crossed."

The sweep oracle is `String(Math.trunc(v < 0 ? 0 : v))`, NOT `String(Math.trunc(v))`:
negatives clamp to 0, so `-1` renders `"0"`, and `-0` renders `"0"` (verified by
measurement, not assumed: `-0 < 0` is false so the clamp does not fire,
`Math.trunc(-0)` is `-0`, `-0 % 10` is `-0`, `48 + -0` is 48 = '0'). `2^53 - 1`
and `Number.MAX_SAFE_INTEGER` are the same number, so the fixed sweep is 19 rows.

## Fork (4) -- VERSION. 1.5.0, a MINOR. RATIFIED.

**Decision: 1.5.0.** Under fork (1) C, M8 changes the rendered output of exactly
zero existing inputs: `drawFast` is byte-frozen; the only new observable
behaviour is a method that did not exist. Textbook minor.

Recorded for M8b, so M8b does not relitigate it: **if F-23 were fixed, that would
be a MINOR, not a major and not a patch.** M1 shipped the `drawFast` magnitude
door as 1.2.2, a PATCH, even though it removed output a caller could see, because
that class of change -- confined to inputs that were already broken -- ships
without a major, with a declared row under `### Changed (behaviour)`. Band 1 is
CONFORMANCE (the shipped output violates the published "rounded to nearest tenth"
guarantee; conforming is a fix a caller cannot have pinned). Band 2 changes
digits the `.d.ts`/`llms.txt` already declare "approximate" (a caller cannot pin a
value the docs disown). Both land minor-side; but because F-23's delta lands on
in-door values that render today and will render differently, M8b earns a minor
even though M1's precedent would tolerate a patch.

## Fork (5) -- DOOR ORDER. MAGNITUDE, THEN SCALE. RATIFIED.

`drawFastInt` takes a NUMBER, so the F-42 `typeof text !== 'string'` door is
WRONG here and must not be copied. The correct idiom is `drawFast`'s, in this
order:

```
if (!(value >= -DRAWFASTINT_MAX && value <= DRAWFASTINT_MAX)) return;
if (!(scale > 0 && scale < Infinity)) return;
if (value < 0) value = 0;
```

1. **Magnitude door FIRST.** F-11 fork 5 put the scale door second in `drawFast`
   so `decisions/0001`'s pinned magnitude behaviour keeps first-guard position.
   `drawFastInt` matches. The order is unobservable through the public API (both
   doors return `undefined` and draw nothing), which is exactly why uniformity is
   free -- the same argument fork (9c) used in `decisions/0004`.
2. **The magnitude door is the NaN-safe `!(x >= min && x <= max)` form.** NaN
   fails both comparisons, `+Infinity` the upper bound, `-Infinity` the lower.
   One predicate covers NaN, both infinities and both out-of-range tails, and its
   polarity cannot be written backwards by accident. A door written
   `if (value > DRAWFASTINT_MAX || value < -DRAWFASTINT_MAX) return;` is one NaN
   walks straight through (F-03's shape); T4 row 9 kills it.
3. **The scale door is a RANGE test, not a NaN test.** `0` and `-1` are finite
   and would draw zero-width and negative-width quads a `scale !== scale` check
   cannot see. `!(scale > 0 && scale < Infinity)` rejects NaN as a side effect of
   being a range test; the range is the point.

Both `DRAWFASTINT_MAX` endpoints INCLUSIVE, matching `DRAWFAST_MAX`:
`MAX_SAFE_INTEGER` renders, `MAX_SAFE_INTEGER + 1` (=== 9007199254740992, a
representable double genuinely outside the door) does not. `>=` vs `>` is a
one-character mutation; T4 rows 5/6 are the only things that catch it.

## Settled without a fork

- **`DRAWFASTINT_MAX = Number.MAX_SAFE_INTEGER` (9007199254740991, 16 digits).**
  The ceiling is the CORRECTNESS boundary, not the buffer boundary, which inverts
  `decisions/0001`'s choice for `drawFast` -- deliberately. `drawFast` chose the
  buffer boundary because a HUD showing blank above 9e15 is worse than one showing
  an approximation; `drawFastInt` chooses the correctness boundary because it has
  no approximation to offer -- above 2^53, `v % 10` returns arithmetic noise, and
  rendering 18 confident digits of a number that only has 16 is a lie the package
  should not tell. Two answers, one principle, different facts.
- **`drawFastInt` does NOT require the '.' glyph.** It writes no 46 into the
  scratch, so its atlas requirement is '0'-'9' (48-57) only, a difference from
  `drawFast` stated positively in all four doc surfaces because it is a reason to
  choose it. A9 pins it with a digits-only font.
- **The loop bound `len < buf.length` stays**, unconditionally, exactly as
  `decisions/0001` ratified for `drawFast`. The ceiling makes it unreachable
  TODAY; "unreachable" is a claim about today's code. Do not delete it because you
  can prove 16 < 24.
- **`do..while`, not `while`.** `0` must render `"0"`, one glyph. T4 row 4 kills
  the conversion.

## Consequences

- `drawFast`'s body sha is frozen (A7); the six T4 F-23 pins are unchanged in
  value (A8) and now name M8b.
- The two digit loops are DUPLICATED, never merged. Each carries a comment naming
  the other's location and stating why (one is exact, the other is not).
- The non-ASCII count of `BitmapFont.js` is unchanged at 10 (F-19 is M9's).
