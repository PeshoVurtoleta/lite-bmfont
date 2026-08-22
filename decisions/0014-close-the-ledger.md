# 0014 -- close the ledger (F-47, F-48, F-54)

Status: accepted
Session: M11 (v2.0.2 -- PATCH)
Findings: F-47 (README spine) closed; F-48 (atlas mis-attribution) closed;
          F-54 (volume-lane blindness) NARROWED + MISDIAGNOSED, corrected on
          measurement
Date: 2026-08-22
Host: darwin arm64, Node v26.3.1

This is the decision trail for the four forks the M11 brief raised and for the
F-54 diagnosis, which the roadmap forbids closing by prose alone.

## Fork 1 -- F-47 API section shape: per-method backticked H3s under `## API reference`

The suite Law's blueprint groups the API under a few headings. FOUR live gates
read `README.md` (`t8-packaging.mjs:188-203` in BOTH directions;
`packaging.test.js:327` / `:358` claim pins; `packaging.test.js:35` F-52 gate;
the ASCII gate). T8/A4 requires that EVERY exported method and atlas export have
a heading matching `^#{2,4} \`ident\`` AND that every such backticked heading name
a real export. So the API reference keeps ~13-14 per-method backticked H3s under
a single `## API reference` H2.

CONSTANTS STAY A TABLE, not backticked headings. T8/A4's `allowed` set is (the
exported methods + `new` + the atlas exports) ONLY -- a backticked H2-H4 naming a
CONSTANT (e.g. `### \`GLYPH_STRIDE\``) names a non-export and REDDENS the gate.
Verified by reading `t8-packaging.mjs:188-203`. A constants table has no backticked
heading, so it is safe.

## Fork 2 -- F-47 Testing section: NO test count (deviation from the Law's spine)

The Law's spine says "Testing (test count + npm scripts)". README publishes NO
count, by the F-43 precedent: a count no gate reads drifts silently, and 1.4.0
shipped two doc files each stating a count the release itself falsified. Re-adding
an ungated number to satisfy a style rule trades a real guarantee for a cosmetic
one. DEVIATION RECORDED HERE, deliberately: the Testing section states the GATED
facts instead -- `npm test` -> 0 failures, `npm run torture` -> exactly `ok`.

## Fork 3 -- F-48 repair: an `inDom` flag marking the PURE-JS regions

The `try` in `Atlas.js` spans both hostile-DOM calls and generateAtlas's own
pure-JS glyph arithmetic, so a bug in OUR arithmetic was re-thrown as
`AtlasError { field: 'dom' }` -- a library bug blamed on the caller's DOM. The
"pin the allowed field values" option from the F-48 row is INERT: the
mis-attribution reports `'dom'`, a legal value, so pinning the set cannot tell a
real DOM fault from an internal bug wearing its label.

Repair: a `let inDom = true;` that the PURE-JS regions turn OFF
(grid arithmetic, per-glyph arithmetic, descriptor-record assembly), read in the
`catch` to choose `field: 'dom'` vs `field: 'internal'`. Marking the PURE regions,
not the DOM regions, is the fail-closed direction: an unmarked region defaults to
`'dom'` -- the pre-2.0.2 status quo -- so a MISSED mark can never emit a false
`'internal'` that blames the library for a real environment fault; only the
reverse risk exists, and only for arithmetic explicitly marked pure. `generateAtlas`
is COLD (a boot-time helper), so the extra stores are free. `field: 'internal'`
added to `Atlas.d.ts` and `llms.txt` (both already say the values are examples,
so this is not a breaking change).

Proven both directions in `test/findings.test.js` and by applied mutation
(sandbox): (a) forcing the catch to always label `'dom'` reddens the internal
direction ("got dom"); (b) mis-marking the canvas-dimension region as pure-JS
reddens the property-setter direction ("got internal"). The test covers a
throwing METHOD (fillText), a throwing PROPERTY SETTER (`c.width`), AND an
injected undefined-variable reference in the loop's pure-JS region (imported as a
fault-injected copy, since no stub can corrupt a library-controlled value).

## Fork 4 -- F-54 disposition: NARROWED, and the stated mechanism MISDIAGNOSED

F-54's headline -- "the volume lane resolves ~19 strings/frame and is BLIND at
~2" -- is FALSE. Re-measured 2026-08-22 with every allocation CONSUMED and every
claim carried on a monotone 1/2/4/8 ladder (two prior probes in this package's
history reported garbage because a discarded `parts[i] + '#'` was dead-code
eliminated and a `(a+b).length` never materialised the string; both looked
plausible).

### The numbers (allocVolume: VOL_OPS=200,000, VOL_WARMUP=20,000, stride i&1023)

Isolated `Math.round(v).toString().padStart(8,'0')` per call, CONSUMED via draw,
ladder over k allocations/call -- MONOTONE:

| k | min bytes |
|---|---|
| 0 | 28,320 (floor) |
| 1 | 22,610,040 |
| 2 | 42,516,720 |
| 4 | 73,728,480 |
| 8 | 102,237,120 |

One padStart/call is 22.6 MB -- 770x the noop floor. It is not invisible.

DCE is NOT the mechanism: a DISCARDED padStart (result never consumed) measures
22,610,040 B, byte-identical to a consumed one. V8 does not elide it.

Real score scene, driven exactly as `test/demo.test.js` drives it, min over 6
reps, reproducible TO THE BYTE across 4 fresh processes and invariant under
measurement order:

| body | floor (B) |
|---|---|
| renderScore NEW (still allocates ~291 B/frame; see mechanism) | 58,392,864 |
| renderScore OLD (2 strings + 6 array literals/frame) | 69,387,384 |
| OLD - NEW | 10,994,520 |
| ratio OLD/NEW | 1.19x |

The signal passes through the REAL carrier monotonically (NEW + k consumed
padStart/frame): 58.4M / 84.9M / 96.5M / 121.3M / 166.9M for k=0/1/2/4/8.

### The mechanism (established: one variable toggles it)

The score scene's OLD and NEW bodies SEPARATE -- deterministically, by 11.0 MB.
What defeats a GATE is the RATIO, not invisibility. The corrected mechanism:
**the NEW body is NOT zero-alloc.** Its ~58 MB floor is its OWN real transient
garbage, not a working-set artifact. Proof by op-count scaling (state set once,
harness excluded), min over 5 reps:

| body | 200k ops | 800k ops | ratio | B/frame |
|---|---|---|---|---|
| renderScore NEW | 58,392,928 | 233,210,208 | **3.99x** | 291.5 |
| control: 1 substring/op | 23,223,784 | 94,618,288 | 4.07x | 118.3 |
| control: harness only (now/dt) | 28,224 | 0 | 0.00 | 0.0 |
| control: noop | 0 | 0 | -- | 0.0 |

Real garbage scales LINEARLY with op-count; a bounded working-set plateau is flat
(the noop and harness-only controls are). renderScore tracks the string control,
not the flat controls, so the floor is real CUMULATIVE garbage of ~291 B/frame,
dominated by the scene body's own float arithmetic (double stores into `S` fields
and the orbit/width helpers -- V8 boxes a HeapNumber where it no longer unboxes a
double field), NOT by any library call (the library draw path is gated at 0 by
T6). This is filed as its own finding, F-55 (the demo scene bodies allocate per
frame despite the 2.0.1 "allocate nothing per frame" claim); it is UNSCHEDULED.

A 10x volume gate is therefore unbuildable for score/stress because a small
STRING-garbage delta cannot beat a large REAL FLOAT-garbage floor: the 11.0 MB
OLD-NEW string delta is only 19% of the 58 MB float floor -> 1.19x SNR, far under
the 10x a derived limit needs, and a host/Node-version drift could swamp it.

The IDENTIFIED toggle is the scene body's own per-frame float-garbage magnitude,
set by how much float-on-object-field arithmetic it does:

| scene | NEW floor (200k) | B/frame | mutant | ratio | gateable? |
|---|---|---|---|---|---|
| wave | 6.29M | 31.5 | 21.3M (38 substrings) | 3.35x | borderline yes |
| score | 58.4M | 291.5 | 69.4M | 1.19x | no |

Same-class real string garbage is gateable against a 6 MB float floor and
ungateable against a 58 MB float floor. That is the whole finding, corrected.

### M10's contradictory numbers, explained

- "OLD min=24" (AMP=1/AMP=10, KB scale): a defect of M10's own amplification
  probe (24 B is the noop floor). It is NOT DCE of the padStart -- proven above --
  and it is NOT evidence the lane is blind.
- "score NEW 58 MB > OLD 38 MB" (NEW higher): the 58 MB reproduces exactly; the
  38 MB does not (a clean reconstruction of OLD gives 69.4 MB). M10 compared two
  bodies whose own float-garbage floors differ for reasons the ~11 MB string signal could not
  overcome at 1.19x SNR, so the sign flipped.

### The t6 generalisation is DISCHARGED

The finding warned this "GENERALISES to t6-alloc.mjs's eleven volume windows,
NONE checked for its own floor." Measured: single-method library windows floor at
min=0 (max in tens of KB) -- 3-4 orders of magnitude below the 58 MB composite
scene floor. So all TWELVE volume windows (A, B, C, C2, D, E, F, G, H, I, J, K --
the row said "eleven (A..K)" and missed C2) separate cleanly (recorded: C2
0->103M, B 37K->81M). The blindness is a property of COMPOSITE multi-draw frame
carriers only, never these windows. The t6 tier header now states a PASS means
"no large transient regression", never "zero allocation".

### A7 is STRUCK -- reason recorded (not silently dropped)

Assertion A7 required "a regression at the recorded boundary reddens that lane and
one just below it does not." No NEW gateable boundary was established for the
score/stress scenes: their SNR is 1.19x, below the 10x rule -- the diagnosis is
precisely that they are ungateable, so there is no boundary to pin. The
wave/typewriter lanes KEEP their existing mutation-proven boundaries in
`test/demo.test.js` (A1/A6), unchanged. A7 is therefore struck as inapplicable,
by measurement, not omission.
