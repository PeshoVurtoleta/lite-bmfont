# 0013 -- the demo tells the truth

Status: accepted
Session: M10 (v2.0.1 -- docs + demo; no shipped library byte changed)
Findings: F-51 (folded into F-53), F-52, F-53 closed; F-54 filed
Date: 2026-08-21
Host: darwin arm64, Node v26.3.1

## Why this exists

The library is zero-allocation and the torture gate (T6) proves it. None of that
instrumentation can see `demo/`: it is a browser file excluded from `files[]`. So
the one artifact with NO gate was the one a prospective user actually looks at,
and it rendered the words **"zero alloc"** over a frame path that allocated ~42
strings per frame (F-53). This record is the decision trail for the fix.

## Two things that were PROVEN NOT to be problems (do not re-litigate)

1. **`checked: true` default is safe for the demo.** All four demo fonts come
   from `generateAtlas`, and `Atlas.js:106` is `Math.ceil(m.width) + 4`, so every
   synthesized `xadvance` is an integer regardless of the browser's fractional
   `measureText`. Constructed under 2.0.0's `checked: true` default at sizes
   36/28/18/48: all four OK, no throw.
2. **F-06 is inert here.** `grep -c '\n'` over the demo is 0 -- not one drawn
   string contains a newline, so `measure`'s widest-line flip returns the
   identical number at every call site.

## The five allocating sites (F-53), and the forks that closed them

The bodies moved to `demo/scenes.mjs` (ZERO static imports; fonts injected via the
mutable state object `S`), imported by the HTML and by `test/demo.test.js`.

### Fork 1 -- wave (`:517`, `:531`): layoutGlyphs + per-glyph drawQuads
Old: `font.draw(ch, baseX + font.measure(msg.substring(0,i), scale), ...)` per
glyph -- ~38 substrings/frame plus an O(n^2) prefix re-walk. New: `layoutGlyphs`
ONCE per message into a module `Float64Array`, then per glyph set `dy` ABSOLUTELY
(baseline + wave; never `+=`, or the wave integrates across frames) and blit one
`drawQuads(ctx, buf, i, 1)` with a per-glyph `globalAlpha` between calls -- the
exact per-letter idiom decisions/0010 shipped the seam for. A space emits no
record, so the loop bound is the count `layoutGlyphs` RETURNED, not `msg.length`.

### Fork 2 -- score (`:540`): ZEROS[] run + drawFastInt
Old: `Math.round(scoreDisplay).toString().padStart(8, '0')` -- two allocations a
frame -- plus a six-element array literal built inside the orbit loop, six more.
New: a constant `ZEROS = ['', '0', ... '00000000']` built once at module load;
draw `ZEROS[8 - digits]`, then `drawFastInt` the number after it, centred by the
exact eight-character width (`padded8Width`, from `advanceOf`/`kernOf` so a
non-monospace digit run measures correctly). Identical look, zero per-frame
allocation. The orbit labels are the module-scope `SCORE_ORBIT` constant.

### Fork 3 -- typewriter (`:573`): layout-once + prefix drawQuads + measureLine
Old: `twText.substring(0, ...)` every frame. New: lay the WHOLE phrase out ONCE on
the phrase change (not per frame) into `TW_BUF`, and blit a growing prefix with
`drawQuads(ctx, buf, 0, n)`. `n` is the record count from a per-phrase `Uint16Array`
prefix map (built from the injected font, since a space emits no record and the
public surface has no char->record relation -- `layoutGlyphs` returns only a
total). The cursor X is `measureLine(twText, 0, visibleChars, 0.7)`. This is what
the CUT range-render session (M6) would have shipped; the prefix map made it
unnecessary. `TW_LAID = -1` fail-closes the blit until a phrase is actually laid.

### T-6 -- stress (`:611`): drawFastInt + constant label
Old: `count + ' LIVE STRINGS'` -- one concat/frame. New: `drawFastInt` the count,
then draw the constant ` LIVE STRINGS` after it, centred by the combined width so
the block does not jitter as the digit count changes.

### Fork 5 -- F-52: the only shipped bytes that moved
Deleted three stale forward-references that shipped inside the 2.0.0 tarball:
"2.0.0 may re-parent this type" (`llms.txt`, `BitmapFont.d.ts`) and "F-08's
storage half stays open (M9)" (`llms.txt`). A `packaging.test.js` gate now reddens
on any shipped consumer file (files[] MINUS CHANGELOG.md, LICENSE, BitmapFont.js)
carrying a roadmap session name or a scheduling phrase, proven in both directions.

## The control (T-2 vs T-9) -- and why two scenes are NOT volume-gated

MANDATORY control: the OLD bodies were measured through the NEW seam BEFORE the
rewrite (T-2), then the NEW bodies after (T-9). Instrument: `harness.allocVolume`
(VOL_OPS=200,000, VOL_WARMUP=20,000, stride `i&1023`). Fresh process, 6 reps,
hard-warmed; a plain descriptor whose space is zero-size (record != char) with
non-uniform digit advances.

| scene       | T-2 OLD (min..max)        | T-9 NEW (min..max)        | verdict            |
|-------------|---------------------------|---------------------------|--------------------|
| wave        | 21,257,144 .. 21,300,936  |  6,291,488 ..  6,337,808  | GATEABLE (3.35x)   |
| typewriter  |  3,442,512 ..  3,488,664  |    743,312 ..    790,224  | GATEABLE (4.36x)   |
| stress      | 12,387,080 .. 12,432,664* | 12,386,368 .. 15,402,088  | BLIND (overlap)    |
| score       | 38,707,928 .. 38,764,432  | 58,392,864 .. 58,450,000  | BLIND (NEW > OLD)  |

*stress OLD is non-reproducible across runs (12.4 MB one run, 24.0 MB another).

Two facts this table forces:
- On Node v26.3.1 the NEW floor is NOT the ~0 a clean script measures; it is a
  deterministic V8 new-space-working-set growth after allocVolume's internal
  `gc()`. A heap-sampling profiler attributes ~504 B to the NEW wave body over
  400k frames -- it IS zero-alloc. The floor does not correlate with real garbage
  (stress OLD 24 MB for ONE concat > wave OLD 21 MB for 38 substrings).
- Only wave and typewriter separate OLD from NEW, and even they are UNDER the 10x
  the derivation rule requires. That is reported as a finding (F-54), not tuned.
  SCORE and STRESS are volume-blind: their OLD and NEW ranges overlap (score NEW
  is HIGHER than score OLD).

### Limits (derived, not guessed)
LIMIT = round(sqrt(FLOOR*MUTANT)) to 2 sig figs, FLOOR = max NEW, MUTANT = min OLD.

| scene       | FLOOR      | MUTANT      | OLD/NEW | LIMIT       | margin new / old |
|-------------|------------|-------------|---------|-------------|------------------|
| wave        |  6,337,808 | 21,257,144  | 3.35x   | 12,000,000  | 1.89x / 1.77x    |
| typewriter  |    790,224 |  3,442,512  | 4.36x   |  1,600,000  | 2.02x / 2.15x    |

Both margins are under 10x -- F-54.

## The score/stress coverage, stated plainly

Because the volume lane is BLIND to a ~2-string-per-frame regression (F-54), the
score scene is covered by (i) a BEHAVIOURAL row that decodes the drawn glyph
sequence off the recording ctx and asserts it equals the 2.0.0
`padStart(8, '0')` string for v in {0, 7, 99, 1234567, 99999999}, plus (ii) a
SOURCE-TEXT pin that no `substring` / `padStart` / `.toString(` / string-concat /
string-array-literal token appears in any render body.

**The source-text pin is a SOURCE-TEXT GATE and is NOT behavioural coverage of
zero allocation.** It proves the allocating tokens are gone from the source; it
proves nothing about runtime bytes. The reason it stands in for a volume row is
F-54: the only instrument that can see transient garbage cannot resolve a
2-string-per-frame regression. Nothing in this session proves the score or stress
scenes allocate zero per frame; the heap-sampling profiler is the evidence they
do, and it is not a CI gate.

Retention IS gated, portably -- with a CANARY, because a plain drain-to-0 is the
F-27 defect itself. A8 tracks 256 dropped stub ctxs (each driven 64 frames through
`renderTypewriter`) with `@zakkster/lite-leak`, module-NOOP cleanup and a numeric
tag that do not close over the ctx. A naive `size -> 0` would PASS even if the row
tracked a throwaway object instead of the ctx: 256 throwaways arm at 256 and, being
unreachable, drain to 0 -- both halves green while the ctx was never watched. That
is F-27 reproduced inside the assertion meant to prevent it. So the row RETAINS one
ctx (the canary) alive to the end of the test and requires the tracker to settle to
EXACTLY 1. Three outcomes, told apart: size 1 -> correct (255 collected, the tracked
canary survives because it is reachable); size 0 -> the canary was collected though
still held, so the witness tracked the WRONG object (F-27) -> RED; size 256 -> a
module sink retained every ctx -> RED. All three were applied in a sandbox and
watched: the F-27 mutation (`track({throwaway:1}, ...)`) reddens "A8 CANARY GONE ...
size 0 != 1", and a `__seen.push(ctx)` module sink reddens "A8 LEAK: 256 scene ctxs
retained ...". F-54 is why this lane exists at all: the volume rows cannot see
retention, so without A8 a demo leak would ship unseen.
