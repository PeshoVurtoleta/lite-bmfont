# 0007 -- drawFast exact digits, and the F-44 Smi split

Status: accepted
Session: M8b (v1.7.0)
Findings: F-23 (fixed, both bands), F-44 (misdiagnosed; attribution corrected)
Relates-to: decisions/0005-drawfastint.md (its fork 1 re-routed F-23 here; its
  fork 3 "one loop is exact, the other is not" rationale expires here)
Date: 2026-08-19

## The question

`decisions/0005` fork 1 froze `drawFast` and re-routed F-23 (inexact digit
extraction) to a named successor session. This is that session. `drawFast`
multiplied by 10 and rounded (`Math.round(value * 10)`), which is wrong two
ways: near a tenth-tie below 2^53 it rounds the wrong direction (band 1,
`8.45 -> "8.5"` where the exact tenth is `"8.4"`), and above 2^53 the product
`value * 10` is not representable so the integer digits themselves are wrong
(band 2, `762638538843020900000 -> "762638538843020800088.0"`). Separately,
F-44 CLAIMED both `drawFast` and `drawFastInt` boxed one HeapNumber per call
above 2^31 because `temp % 10` / `Math.floor(temp / 10)` on a value above Smi
range escapes the tagged-integer fast path. That mechanism is FALSE (fork 2): the
box is at the call boundary, not in the loop, and is identical before and after.

Six forks fell out of fixing this. Each is ratified below with the alternative
that was rejected and why.

## Fork 1 -- what "exact" MEANS above 2^53. RATIFIED: true-value expansion.

Above 2^53 every double is an integer, but the literal a caller typed and the
double actually stored diverge. The two defensible readings disagree on screen:

    drawFast(ctx, 762638538843020900000, 0, 0)
      true-value expansion    -> "762638538843020853248.0"   RATIFIED
      shortest round-trip     -> "762638538843020900000.0"   rejected

`oracleExact` (`test/torture/t4-numeric.mjs:63`) implements the first, and the
roadmap's DONE WHEN rows already assert `s === ex` against it -- so the roadmap
had chosen without saying so. Ratified here out loud, with the consequence
quoted: after M8b a caller who writes the literal `762638538843020900000` sees
digits they did not type. Those digits are the exact value of the double they
actually passed. It is the only reading that is a property of the VALUE rather
than of a printing convention, but it will read as a bug in a screenshot, so the
docs say so in the same breath as the fix.

**Rejected: shortest round-trip.** It is what `String(v)` gives and what a human
expects, but reproducing it requires a shortest-representation search
(Ryu / Grisu-class) per call: a table-driven algorithm an order of magnitude
larger than this whole library, and it cannot run in a 24-byte scratch.
Rejecting it is a capability decision, not a preference.

## Fork 2 -- scope: is `drawFastInt` touched? RATIFIED: yes, and F-44 is MISDIAGNOSED.

`drawFastInt` is already exact and its digits do not move. The hi/lo split
(`lo = m % 1e7`, `hi = (m - lo) / 1e7`) is applied to BOTH bodies -- but for
Smi-discipline and throughput reasons, NOT as an allocation fix, because F-44's
premise turned out to be false.

**The correction, measured (M8b, 2026-08-19, and confirmed by the reviewer).**
F-44 claimed the digit loop boxed a HeapNumber per operation above 2^31, ~16
B/call. It does not. Old vs new is 15.93 vs 15.93 B/call on a 16-digit cycle, and
on the OLD code a CONSTANT argument already measured ~0 B/call -- so the old loop
never boxed either. The ~16 B/call is the CALLER boxing the argument at the call
boundary (one box per call, flat in digit count), which is caller-side and
removable by no change to this library. P-6 measured the loop's intermediate
magnitude staying under 2^31 (`898,871,303`), which is TRUE -- but "loop variables
stay in Smi range" is not the same claim as "the measured box is removed." P-6
proved the former; the box the finding names is the latter, and it is unaffected.

**Why keep the split anyway.** Two real justifications, neither an allocation fix:
(1) source-level Smi discipline -- in the pre-warmup Ignition tier, before
TurboFan unboxes the locals, `Math.floor(m / 10)` on a >2^31 double genuinely
does box; the split holds the invariant in every tier, which T6 (20k-call warmup
into the optimized tier) cannot observe. (2) The throughput Smi-knee of
`decisions/0005` section 0.4b -- keeping the loop variable a Smi avoids the
super-linear cost above the 11-digit knee.

**Rejected: "one session, one body."** Overridden because the edit is the same
edit; both bodies get the same Smi discipline.
**Rejected: document F-44's boundary as a live allocation limit.** There is no
allocation limit to document in the body -- the finding's mechanism was wrong.
What is documented instead (README, llms.txt, `.d.ts`, ROADMAP) is the honest
caller-side box: a >2^31 argument costs ~16 B/call at the call site, unremovable.

## Fork 3 -- do the two digit loops stay duplicated? RATIFIED: yes, for a NEW reason.

`decisions/0005`'s reason ("one is exact and the other is not") EXPIRES the
moment this fix lands, and the cross-reference comment in `BitmapFont.js` stated
it in those words. The new reason is different and weaker but sufficient:
`drawFast` now carries two regimes and a decimal digit; `drawFastInt` carries
neither. A merged helper would push a regime branch and a tenth-computation into
a body whose door guarantees neither is reachable -- bytes in a hot body for a
branch that never fires, which the suite Law names explicitly. The cross-
reference comment is rewritten to state this new reason; leaving the old
sentence in place is not an option because it is now false.

**Rejected: merge the two loops into one helper.** It would add a call frame to
two hot paths to save a dozen source lines (ROADMAP law 6 inverted) and carry
dead branches in each caller.

## Fork 4 -- the perf budget. RATIFIED: RECORDED, not gated.

The distribution is bimodal, so a single gate on it is meaningless. Regime A --
every HUD value anyone actually renders -- goes FASTER: it drops `Math.round`, a
divide and a multiply for about six flops. Regime B's worst case is 17 decimal
doublings over at most 22 digits (~374 inner iterations at the top of the range,
against ~22 today). Recorded with an explicit rejection threshold stated in
prose rather than code: **a regime-A regression above 15% over the 1.5.0
recorded 5-digit number, or a regime-B worst case above 5 microseconds per call,
is a reviewer REJECT.**

**Rejected: a single per-call time gate.** It would average two regimes with
opposite cost signs and pass on a fault in either.

## Fork 5 -- SemVer. RATIFIED: MINOR (1.7.0).

Band 1 is conformance to a published guarantee ("rounded to nearest tenth");
band 2 changes digits the docs already disown as approximate. Neither is
pinnable. But both land on in-door values that render TODAY and will render
DIFFERENTLY, which is more than a patch carries. Both ship as
`### Changed (behaviour)` rows with before/after values; F-44 is recorded under a `### Corrected (finding attribution)` heading, not `### Fixed`, since nothing was removed (fork 2).

**Rejected: PATCH.** A patch may not move a rendered value a caller could be
looking at, and both bands do.
**Rejected: MAJOR.** No documented guarantee is withdrawn; the "rounded to
nearest tenth" contract is now HONOURED, not broken.

## Fork 6 -- T9 control 9. RATIFIED: re-derive it as a CORRUPTION control.

This is the session's real centrepiece. Control 9 proved `drawFast`'s magnitude
door is load-bearing by stripping it and requiring the body to HANG: the old
mechanism was `value * 10 -> Infinity` feeding `while (temp > 0)`, and the parent
killed the child on a 2s SIGTERM. **M8b deletes `value * 10`.** Measured: with
the door stripped, `Number.MAX_VALUE` decomposes to `e = 971` and RETURNS --
every loop in the new body is bounded by a finite exponent, so no input hangs it.

The door's justification therefore CHANGES: it no longer prevents a hang (F-01),
it prevents silent scratch truncation. Control 9 is re-derived: with the door
removed, `Number.MAX_VALUE` must RETURN but must produce OBSERVABLY WRONG output
(a truncated digit string that does not equal the oracle), and the shipped body
(door present) must draw nothing. That is still a load-bearing proof of the
door; it is a different proof. A marker that merely matches once proves nothing
about a control whose premise is gone.

**Rejected: keep the hang control by adding an artificial unbounded loop.**
Writing a hang into a hot body so a test can find it is self-parody.
**Rejected: delete control 9.** The door would then have no non-vacuous proof.

**Implementation note (qa G-2, G-3).** "Observably wrong output" resolved into
TWO distinct observables, because `Number.MAX_VALUE` fills the 24-byte scratch and
then the regime-B carry backstop returns before the render pass:
- the DOOR is load-bearing on the SCRATCH: door removed writes 24 truncated bytes
  (`touched=1`), door present never touches the scratch (`touched=0`). Restoring
  the door in the reconstruction collapses the two and reddens (A7).
- the regime-B carry backstop is load-bearing on the DRAW: with it present
  MAX_VALUE returns `calls=0`; drop it and the same door-removed body draws 24
  corrupted glyphs (`calls=24`). The parent asserts `calls=0` on the corrupt leg,
  which is the only coverage of that backstop (the door hides it in normal use).
The regime-A do..while bound is NOT part of either proof -- rewriting it is inert,
because MAX_VALUE takes regime B. It survives only as an A5 source-integrity
tripwire (renaming `temp` moves its match count to 0 and the child exits 3).

## The shape shipped

Regime A (`value < 2^53`): `f = value - floor(value)` is exact; `f*8` and `f*2`
are exact (powers of two); Fast2Sum recovers `f*10 = s + err` exactly
(`err = b - (s - a)`) and the tie is broken against `err`. Integer digits by the
hi/lo Smi split. Regime B (`value >= 2^53`): every double is an integer so the
tenth is 0 by construction; emit the mantissa's digits by the same Smi split,
then double the DECIMAL digits `e` times in place on the char codes already in
`_charScratch` -- no second array, so the constructor does not move. Validated
end to end against `oracleExact` on 400,023 values spanning both regimes and
their boundary: 0 mismatches, max scratch use 24/24 bytes (it fills exactly at
`DRAWFAST_MAX`, no headroom), max Smi loop variable 900,719,925, max 17
doublings. The `if (carry)` backstop RETURNS rather than truncating because the
scratch has no guard byte to spare.
