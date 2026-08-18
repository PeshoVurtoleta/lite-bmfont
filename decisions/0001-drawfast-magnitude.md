# 0001 -- drawFast and magnitudes it cannot render

Status: accepted
Session: M1 (v1.2.2)
Findings: F-01 (S1, hang), F-02 (S1, silent 24-byte overrun)
Date: 2026-08-17

## The question

`drawFast` renders a non-negative double with one decimal into a fixed 24-byte
scratch buffer. What does it do with a magnitude that does not fit?

## Measured boundary table (v1.2.1, BEFORE the change)

Every row measured out of process via `spawnSync(..., { timeout: 2000 })`
against the frozen v1.2.1 copy: `timeout(1)` is not available on this host and
above ~1.797e307 the call never returns. `_charScratch.byteLength` is 24,
confirmed, and must still be 24 after the fix.

| value | calls | NaN dx? | glyphs emitted | returned? |
| --- | --- | --- | --- | --- |
| `0` | 3 | no | `0.0` | yes |
| `-5` | 3 | no | `0.0` (negative clamp, documented) | yes |
| `1e15` | 18 | no | `1000000000000000.0` | yes |
| `2**53` | 18 | no | `9007199254740992.0` | yes |
| `1e20` | 23 | no | `100000000000000000000.0` | yes |
| `1e21` | 24 | no | `1000000000000000000000.0` | yes |
| `1e21 + 1` (=== `1e21`) | 24 | no | `1000000000000000000000.0` | yes |
| `nextUp(1e21)` = `1e21 + 131072` | 24 | no | `1000000000000000424684.0` -- **WRONG: a confidently-wrong finite number (true value is ...131072; `value*10` float error yields ...424684), no NaN** | yes |
| `1e22` | 24 | **yes** | `0000000000000000000000.0`, every dst x NaN | yes |
| `-1e21` | 3 | no | `0.0` (inside the door, then the negative clamp) | yes |
| `-1e22` | 3 | no | `0.0` (v1.2.1 clamps before the multiply; M1 makes this a no-draw) | yes |
| `Number.MAX_VALUE` | -- | -- | -- | **never returns (F-01), killed by SIGTERM** |
| `-Number.MAX_VALUE` | 3 | no | `0.0` (v1.2.1 clamps before the multiply; M1 makes this a no-draw) | yes |

Two facts worth their own lines.

1. **Just above the ceiling the current code does not produce NaN -- it produces
   a confidently wrong number.** `nextUp(1e21)` (true value ...131072) emits 24
   finite glyphs spelling `1000000000000000424684.0` -- the `value*10` step loses
   precision beyond 2^53 and the wrong digits look plausible. That is a distinct
   failure mode from F-02's NaN storm, and it is strictly worse to debug: nothing
   looks broken. The door closes both.
2. **Negative magnitudes never hung.** The clamp to 0 precedes `value * 10`, so
   `-Number.MAX_VALUE` renders "0.0" today. F-01 is a positive-magnitude hang.

## Options considered

- **A. Silent no-draw above a documented ceiling.** The method already documents
  three silent returns (NaN, +/-Infinity); an unrenderable magnitude joins that
  set. The door gets CHEAPER: four comparisons on the accepted path become three.
- **B. Clamp to the ceiling and draw it.** Renders a number the caller never had,
  in a package whose job is displaying numbers.
- **C. Throw.** Correct in a library not called 60 times a second. In a render
  loop an uncaught throw is a dead rAF chain: a wrong pixel becomes a stopped game.
- **D. Widen the scratch to hold every double (310+ bytes).** Doubles above 1e21
  have no meaningful decimal tail, so this buys digits that are already noise, and
  it puts a growth path beside the buffer T6 exists to pin.

## Decision

**A**, with D's instinct kept as an unconditional structural backstop.

`DRAWFAST_MAX = 1e21` -- the largest magnitude whose "d.d" form fits 24 bytes
(22 integer digits + '.' + 1 decimal), confirmed by the table above.

### The ceiling is the buffer boundary, and a different boundary exists

The M1-T03 re-measurement (see Oracle-parity / F-23 below) proved the library's
digits are already wrong in band 2 (`2^53 < |v| <= 1e21`), so there are TWO
candidate ceilings and they are different numbers:

- **1e21 -- the buffer boundary.** Where the 24-byte `_charScratch` runs out.
  Chosen. `drawFast` renders up to here.
- **2^53 = 9007199254740992 -- the correctness boundary.** Where the rendered
  integer digits stop being true (band 2). Above it `drawFast` prints digits the
  value does not have.

**The question was put to the user and answered: 1e21 stands, band 2 ships as a
known defect (F-23, routed to M8).** The alternative -- a 2^53 ceiling that makes
everything drawn exact -- was given its due and rejected: it would draw *nothing*
for the entire `9.0e15..1e21` range, and a HUD fed a runaway accumulator showing
blank is not obviously better than one showing an approximate number. The defect
is documented in `llms.txt`, `README.md` and the `.d.ts` so a caller can choose
against `drawFast` for that range, and pinned in T4 so M8's fix forces the tier
red. This choice was made deliberately, not missed.

**Both endpoints INCLUSIVE.** 1e21 renders; `nextUp(1e21)` does not. The constant
is exported so callers can pre-clamp, and
`Math.max(-DRAWFAST_MAX, Math.min(DRAWFAST_MAX, v))` must produce a value the
library will draw -- an exclusive endpoint would make it refuse the exact output
of its own documented pre-clamp. `>` vs `>=` here is a one-character mutation
that only T4 rows 2, 6 and 12 catch.

Consequence, recorded as a deliberate behaviour change: `-1e21` renders "0.0"
(inside the door, then the documented clamp), while `-1e22` and
`-Number.MAX_VALUE`, which used to render "0.0", now draw nothing.

The loop bound `while (temp > 0 && len < buf.length)` stays even though the door
makes it unreachable. "Unreachable" is a claim about today's code. With the door
removed and the bound present, 1e22 draws 24 glyphs spelling a wrong number with
no NaN and no hang -- which is exactly why the door, not the bound, is the fix.

## Hot-path measurement

The claim under test: a correctness fix that makes a hot body SMALLER. Measured,
not assumed. `assertOps` has no throughput rule on any lane (profiler v1.15.0),
so this is `measureOps` medians from paired child processes, 5 alternating reps,
200,000 ops of `drawFast(ctx, NUM_CYCLE[i & 255], 0, 0)`, `warmup: 5000`,
`stabilize: 'deep'`.

| variant | median opsPerSec | min | max | bytesPerOp | gc.major | gc.maxMs |
| --- | --- | --- | --- | --- | --- | --- |
| v1.2.1 (frozen copy) | 16975587 | 16441229 | 17251355 | 0 | 0 | 0.000 |
| v1.2.2 (door + bound) | 16953103 | 16356908 | 17395842 | 0 | 0 | 0.000 |

Ratio new/old: **0.9987** (within noise; `>= 0.97` is within noise or faster).
Three full paired runs gave ratios 0.9759, 1.0045, 0.9987 -- the two variants'
min/max bands overlap almost entirely (~16.4M..17.4M each), so the door is a
no-op on throughput, as predicted (the accepted path lost one comparison; the
loop bound added one compare per digit). No `7(b)` fallback needed; the door is
NOT reverted for speed under any outcome. The paired reps alternate
`old,new,old,new` (5 each), every rep a fresh child process so the two
`drawImage` call sites never share a polymorphic ctx. The frozen copy is the
re-derivable baseline now that the old body is gone from the tree.

Comparison arithmetic, for the record: the accepted path was `value !== value`,
`value === Infinity`, `value === -Infinity`, `value < 0` (4) and is now
`value >= -DRAWFAST_MAX`, `value <= DRAWFAST_MAX`, `value < 0` (3). The loop bound
adds one compare per digit, at most 24 per call and typically 3-5.

## Oracle parity (measured, M1-T03)

**The brief's `oracleBig` was REJECTED on measurement.** The plan proposed
`oracleBig(v) = BigInt(Math.round(v*10))` as a "BigInt oracle exact across the
whole accepted range." It is not independent of the thing it checks: it shares
the library's `value * 10` float multiply, and above 2^53 that product loses
precision, so slicing the last digit off invents a tenth from float noise. The
witness that kills it:

```
v = 13333333333333334   (an integer double; its true tenth is 0)
  library digit loop  13333333333333334.0     correct
  plan oracleBig      13333333333333334.4     WRONG -- .4 is float noise
  exact               13333333333333334.0     correct
```

Ground truth is `oracleExact`: it reads the IEEE mantissa/exponent and does the
`x10` in BigInt with **no float multiply anywhere**. A tie at a tenth is
impossible for a double (a tie needs denominator 20, which is not dyadic), so its
half-away rule is unambiguous.

Measured over 20 curated fixed values plus 200,000 seeded magnitudes from
`makePrng(0x9e3779b9)` spanning 1e-21..1e22 with random sign
(`<scratch>/parity-probe.mjs`, which re-implements the digit split with the loop
bound and NEVER calls `drawFast`; cross-checked byte-for-byte against the real
`drawFast` out of process), over 191,255 in-door samples:

| oracle vs `oracleExact` (ground truth) | disagreements |
| --- | --- |
| `toFixed(1)` (|v| < 1e21) | **0** |
| the library's own digit loop | 15858 |
| the brief's `oracleBig` | 16884 |

**Conclusion: `toFixed(1)` is exact below 1e21 and is T4's PRIMARY oracle there.**
Its only defect is that it switches to exponential at |v| >= 1e21
(`(1e21).toFixed(1)` is `"1e+21"`) -- a formatting fact, not an accuracy one. For
the `>= 1e21` band T4 uses `oracleExact`, not `oracleBig`. `oracleBig` is gone.

## F-23 (S2, routed to M8) -- drawFast's digit loop is inexact, two bands

The 15,858 library-vs-exact disagreements are the library's defect, not the
oracle's, and they split cleanly at 2^53:

- **Band 1, `|v| < 2^53` (1,738 samples): off-by-one-tenth on near-ties.**
  `8.45 -> "8.5"` (exact `8.4`), `999999.95 -> "1000000.0"` (exact `999999.9`).
  Cause: `Math.round(value * 10)` rounds the float *product*, not the real value.
  Cosmetic for a HUD, but "rounded to nearest tenth" is a documented guarantee.
- **Band 2, `2^53 < |v| <= 1e21` (14,120 samples): the integer digits themselves
  are wrong, silently.** `762638538843020900000 -> "762638538843020800088.0"`;
  exact is `762638538843020853248.0`. The library prints digits the value does
  not have. Smallest band-2 `|v|` observed: `14472930389456450` (~1.4e16); the
  correctness boundary is exactly 2^53 = 9007199254740992.

F-23 is **not fixed in M1.** M1 is the magnitude door (F-01 hang, F-02 overrun);
this is arithmetic. Mixing an arithmetic rewrite into the door diff makes the diff
unreviewable. It is **rated S2** -- a documented guarantee ("rounded to nearest
tenth") is broken in band 1, and band 2 is silent corruption of the primary
output. Recorded in BOTH ledgers this session (CHANGELOG 1.2.2 Known-issues delta
and `ROADMAP.md` section 2), and **routed to M8**, which already reopens `drawFast`
for `drawFastInt` -- the digit-extraction rewrite belongs there, not smeared
across a door session. Ledger arithmetic: CHANGELOG F-rows 24 -> 25, ROADMAP
22 -> 23; the T4 tier pins band 2 as current measured behaviour so M8's fix forces
the tier red rather than passing either way.

Consequence for the ceiling (see the Decision section, which is settled): band 2
means the **correctness** boundary (2^53) and the **buffer** boundary (1e21) are
different numbers. The brief chose 1e21 on the buffer argument alone, because its
defective oracle could not see band 2. Once band 2 was measured the choice was
made deliberately: **`DRAWFAST_MAX = 1e21` stands, on the buffer boundary, with
band 2 shipping as a documented known defect (F-23).** A 2^53 ceiling that would
make everything drawn exact was considered and rejected -- it would draw *nothing*
for the entire `9.0e15..1e21` range, and a HUD fed a runaway accumulator showing
blank is not obviously better than one showing an approximate number. The constant
is exported public API a caller is told to pre-clamp against; it is NOT provisional
and must not be moved without a major. This is a decision made with band 2 known,
not a boundary chosen in ignorance of it.

## Amendment (M8, 2026-08-18)

The routing sentence above (":190", "routed to M8, which already reopens
`drawFast` for `drawFastInt`") assumed M8 would reopen `drawFast`. **It does
not.** The M8 PRECONDITION PROBE (P-4) proved that `drawFastInt` shares zero
arithmetic with `drawFast` -- only the 24-byte `_charScratch` buffer. Band 1 is
`Math.round` applied to `value * 10`; band 2 is `value * 10` overflowing the
53-bit significand. `drawFastInt` computes no product: it extracts digits from
`Math.trunc(value)` with `temp % 10` / `Math.floor(temp / 10)`, which is exact by
construction for every value the door admits (|n| <= 2^53 - 1). The premise of
the routing failed, so the routing does not bind.

**F-23 is therefore RE-ROUTED to a new session `M8b -- drawFast's digit
extraction (F-23)`** (`decisions/0005-drawfastint.md` fork 1, ratified;
`ROADMAP.md` M8b brief, `status: next`, `depends_on: [M8]`, `blocks: [M9]`).
`drawFast` ships in 1.5.0 **byte-identical to 1.4.1** -- proven by body sha
(M8 assertion A7) -- and both F-23 bands ship unchanged. The T4 band pins stay,
unchanged in value, and now name M8b as their owner. The original sentence above
is left intact; this block annotates it, it does not rewrite it.
