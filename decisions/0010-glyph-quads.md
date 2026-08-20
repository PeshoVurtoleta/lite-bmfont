# 0010 -- the glyph-quad buffer (`layoutGlyphs` + `drawQuads`)

Status: accepted
Session: M5 (v1.9.0)
Findings: F-45 (its shape recurs here and is closed a second way -- fork 3),
  F-42 (the sixth inline text door), F-05 (the overflow taxonomy -- fork 6)
Relates-to: decisions/0004-metrics-and-snapping.md (the B1 snap this reproduces),
  decisions/0006-layout-buffer-scale.md (the scale-in-two-places finding),
  decisions/0003-descriptor-door.md (why the overflow error is NOT BitmapFontError)
Date: 2026-08-20

## The question

`draw` walks a string and issues one `ctx.drawImage` per visible glyph in a
single monomorphic loop. Callers who want to animate individual letters, cull
off-screen glyphs, or hand the quad list to a batching renderer cannot reach
inside that loop -- they can only re-measure and re-walk. M5 splits the walk in
two: `layoutGlyphs(text, outBuffer, x, y, scale, align)` fills a caller-owned
buffer with one placed quad per glyph and returns the count, and
`drawQuads(ctx, buffer, first, count, offX, offY, scale)` blits a contiguous
range of that buffer. Between the two calls the buffer IS the mutation seam: the
caller edits `dx`/`dy` to move a letter, or slices `first`/`count` to draw a
subset.

Nine forks had to be settled before a line was written, because this is the
package's first PUBLIC buffer format and every one of them is a contract a
caller will build on and a future session cannot silently change.

The one sentence for the whole decision: **the record is a stride-6
`[sx, sy, sw, sh, dx, dy]` of Float64 (or plain-Array) floats with `dx`/`dy`
ABSOLUTE and scale ALREADY folded into them, laid out at a caller-supplied
`x`/`y` origin so `draw`'s exact per-line/per-baseline `Math.round` order is
reproduced byte-for-byte, overflowing with a plain `RangeError` per emitted
record and answering a bad door with `NaN` -- and `drawQuads` applies its
`scale` only to the source dimensions and adds `offX`/`offY` raw.**

## Fork (1) -- STRIDE 6, not 8, not a parallel array. RATIFIED.

The record is six floats: `[sx, sy, sw, sh, dx, dy]` -- source x/y, source w/h,
destination x/y. At Float64 that is **48 bytes per glyph**.

- **Rejected B (stride 8, adding `dw`/`dh`).** Carrying the destination size in
  the buffer is **64 bytes per glyph -- 33% more buffer traffic for every caller
  forever** -- to serve only the subset who animate per-letter destination
  scale. That need is already served: `drawQuads(ctx, buffer, first, count, ...)`
  is N draw calls for the N letters that actually want a different size, at
  no cost to the callers who do not. Record the byte number here, because this
  proposal returns the first time someone wants a bouncing letter, and the answer
  is "draw those letters in their own call", not "widen every record".
- **Rejected C (a parallel per-glyph scale array).** Two buffers to keep in sync,
  one indexed by record and one by glyph, with no compiler help when they drift.
  The worst of both: B's width plus a second allocation the caller must size.

The destination SIZE is therefore `sw * scale` / `sh * scale`, computed by
`drawQuads` at blit time (fork 3), and `sw`/`sh` in the buffer are the UNSCALED
source dimensions -- the same `gw`/`gh` `draw` reads straight out of `glyphs`.

## Fork (2) -- Float64Array or a plain Array, NEVER Float32Array. RATIFIED.

`dx`/`dy` are the cursor, and `draw` computes the cursor in doubles. Storing it
through a `Float32Array` rounds it, and the headline round-trip assertion (the
recorded-ctx columns identical to `draw`) then cannot hold. MEASURED at plan
time -- xadvance 8, kerning -1, scale 1.1, 6 glyphs:

    f64: 0 7.700000000000001 15.4 23.1 30.8 38.5
    f32: 0 7.699999809265137 15.399999618530273 23.100000381469727 30.799999237060547 38.5
    columns where Float32 != the draw cursor: 4 of 6

So the buffer is a `Float64Array` or a plain `Array`, and the overflow guard
tests `outBuffer.length`, **not** `byteLength` -- the same idiom `drawWrapped`
uses for its layout buffer, and for the same stated reason: `.length` is what
makes a plain `Array` and a `Float64Array` both work, which the contract
promises. Someone will propose `Float32Array` for the halved bandwidth exactly
as someone proposes stride 8; the number above is why the answer is no.

This buffer is NOT `@zakkster/lite-text-layout`'s `computeWrap` buffer, which is
a `Float32Array` of line records. The two are different formats with different
strides and different element types and must not be described as
interchangeable.

## Fork (3) -- scale is folded into `dx`/`dy`; `drawQuads`'s scale applies ONLY to `sw`/`sh`. RATIFIED (R-4 option b).

This is F-45's exact shape in a new place: `layoutGlyphs` bakes `scale` into the
cursor (kerning, xoffset/yoffset and the advance are all `* scale`, matching
`draw`), and `drawQuads` is ALSO handed a `scale`. One float, two entry points.
decisions/0006 is the record of what that costs when the two disagree, so it is
named here and settled the same way:

- `drawQuads`'s `scale` multiplies ONLY the source dimensions to produce the
  destination size (`sw * scale`, `sh * scale`). It does NOT touch `dx`/`dy`,
  which are already absolute and already scaled. It MUST equal the layout scale;
  a mismatch is **detectable, not impossible** -- it renders every glyph at the
  wrong size against correctly-placed origins, which is visible immediately and
  is the caller's contract violation, not a silent corruption.
- **Rejected A (`drawQuads` takes no scale; the destination size rides in the
  buffer).** That is fork 1's stride 8 -- it needs `dw`/`dh` columns to carry the
  size, and stride 8 was rejected on its byte count. The single source of truth
  it would buy is not worth 33% on every record.

## Fork (4) -- `x`/`y` are parameters of `layoutGlyphs`; the buffer is origin-specific. RATIFIED.

`draw` computes `cursorX = Math.round(x + alignAdjust)` per line origin and
`cursorY = anchorY + Math.round(++lineIndex * step)` per baseline, with
`anchorY = Math.round(y)` captured once. The snap does NOT commute: a buffer laid
out at origin 0 and re-anchored at draw time computes `Math.round(0 + adj) + x`,
a different function. MEASURED at plan time over 6 x-values and 4 align
adjustments:

    origin-snap mismatches: 16 of 24
      x=10.5 adj=0      draw=11  quad=10.5
      x=10.5 adj=-13.2  draw=-3  quad=-2.5

This is M4's B1 fork (decisions/0004), already litigated once and pinned by T9
controls 11 and 12, which ship the rejected B2 and A rounding forms and REQUIRE
them to fail. M5 may not pick a convenient round order. So `x`/`y` are
parameters of `layoutGlyphs`, the round happens there in `draw`'s exact order,
and the buffer is origin-specific. This weakens the "lay out once, re-anchor
cheaply" reuse story -- the caller re-lays-out to move the origin -- but that
story was never reachable without reopening B1, and `drawQuads`'s raw
`offX`/`offY` (fork 9) cover the cheap unsnapped nudge callers actually want.

## Fork (5) -- a bad door returns `NaN`, never `0`. RATIFIED (R-7).

`layoutGlyphs` returns a count, which makes it a QUERY, and the Law is explicit:
a renderer can decline to act, a query cannot decline to answer, and null is not
zero. Returning `0` for a non-string `text` is indistinguishable from the honest
answer for `''`. So it returns `NaN`, matching the measure family
(`measure`/`measureWidest`/`measureLine`) that already returns `NaN` on exactly
these two doors. It stays fail-closed downstream: `drawQuads(ctx, buf, 0, NaN,
...)` has loop bound `first + count = NaN`, `0 < NaN` is false, and nothing is
drawn. The `-> number` return type covers `NaN` with no `.d.ts` change; the
`.d.ts` prose says so.

## Fork (6) -- overflow throws a plain `RangeError`, per emitted record. RATIFIED (R-11).

A buffer too short cannot produce correct output under any interpretation, so it
throws rather than truncates -- a silently short banner is F-05 in a new costume.
`drawWrapped` set the precedent: a short buffer throws a plain **`RangeError`**,
deliberately NOT a `BitmapFontError`. `BitmapFontError` is the descriptor door's
error (decisions/0003) and extends `RangeError` for catch-compatibility; the
buffer-size error is not a descriptor error and must not masquerade as one, so
`err instanceof BitmapFontError` is `false` for it. The message shape is pinned:

    lite-bmfont: outBuffer holds <N> floats, glyph <G> needs <K>

The check is PER EMITTED RECORD (`p + 6 > cap` at the point of writing), NOT one
up-front test of `text.length * 6`. Spaces and out-of-range ids emit no record,
so an up-front test would reject a buffer that would have fit -- a guard that
blames a correct caller is its own finding. The compare is `>`, so a buffer
holding exactly `6 * count` floats does not trip; `>=` would reject the exact
fit and is the mutation the boundary test reddens.

## Fork (7) -- the caller sizing bound is `text.length * GLYPH_STRIDE`. RATIFIED.

The exact record count is not derivable by the caller in advance -- it depends on
which glyphs are spaces, newlines or out-of-range, which the caller would have to
walk the font to know. The SAFE UPPER BOUND is `text.length * GLYPH_STRIDE`
(every code unit its own visible glyph). `GLYPH_STRIDE = 6` is EXPORTED so a
caller never hardcodes the stride and never desizes when M9 revisits the format;
it carries a `## Export: GLYPH_STRIDE` heading in `llms.txt`. The bound is
documented in the `.d.ts`, `llms.txt` and README beside the throw.

## Fork (8) -- NO per-glyph callback. RATIFIED.

A `forEachGlyph(cb)` shape was rejected: an indirect call per glyph, and a
megamorphic call site the moment two callers pass different closures -- the exact
hot-path cost the split exists to avoid. The mutation seam is the buffer itself.
The caller edits `dx`/`dy` between `layoutGlyphs` and `drawQuads`, or passes a
narrower `first`/`count`. No indirection, no allocation, no shape pollution.

## Fork (9) -- `offX`/`offY` are added RAW, never snapped. RATIFIED.

`drawQuads` adds `offX`/`offY` to the already-snapped `dx`/`dy` without a second
`Math.round`. The origin snap already happened in `layoutGlyphs` (fork 4); re-
snapping the offset here would double-round and would deny the caller the smooth
sub-pixel nudge (a shake, a scroll, a parallax offset) that is the whole reason a
raw per-blit offset exists. `offX`/`offY` default to `0`, so the round-trip
against `draw` runs at `drawQuads(..., 0, 0, scale)` and the offset never
perturbs it.

## Fork (10) -- `drawQuads` CLAMPS `first`/`count` and THROWS on the buffer length. RATIFIED.

The first cut of `drawQuads` had no bounds check at all: `for (let g = first; g <
first + count; g++)`. A caller passing `count` larger than the buffer holds drew
real `ctx.drawImage` calls with `NaN` for every source and destination field --
fail-OPEN, through the real canvas API. That is indefensible next to fork (6),
where `layoutGlyphs` throws rather than silently truncate: the same buffer
contract cannot fail closed on write and open on read.

The policy is not invented -- it is `drawWrapped`'s F-05 fork (1), applied
verbatim: **CLAMP the index-like value, THROW on the buffer length, both PER
CALL and zero per glyph.**

- **10a -- the buffer bound THROWS.** `first`/`count` are clamped NaN-safe
  (`!(first >= 0) ? 0`, `!(count >= 1) ? 0`, `Math.floor` for fractionals -- the
  exact idiom `drawWrapped` uses for `lineCount`), then ONE check:
  `if ((f + n) * 6 > buffer.length) throw new RangeError(...)`, in fork (6)'s
  message shape (`lite-bmfont: buffer holds N floats, quads F..E need K`, a plain
  `RangeError`, never `BitmapFontError`). One compare per call; the loop body is
  untouched and still six indexed reads plus one `drawImage`.
- **10b -- the WRITTEN-count residual is the caller's PINNED HAZARD.** A buffer
  length can prove the range fits the buffer; it CANNOT prove the range fits what
  `layoutGlyphs` actually wrote, because spaces and out-of-range ids emit no
  record (fork 1/6) so the written count is <= the record capacity and is not
  derivable from `.length`. A `count` past the written total but within the
  buffer draws from UNWRITTEN slots. This is left as the caller's responsibility
  -- pass `drawQuads` the count `layoutGlyphs` RETURNED -- and is recorded as a
  pinned hazard, not guarded, in the same spirit `drawFast`'s shared-`_charScratch`
  reentrancy is a labelled hazard rather than a fix. Guarding it would mean
  carrying a written-count field per buffer, which the stride-6 format (fork 1)
  deliberately does not, and re-deriving it would mean re-walking the text the
  split exists to avoid.

## Consequences

- **There are now SIX inline text doors** in `BitmapFont.js` -- `measure`,
  `measureWidest`, `measureLine`, `draw`, `drawWrapped` and now `layoutGlyphs`.
  Each is `if (typeof text !== 'string')` then `if (!(scale > 0 && scale <
  Infinity))`, text first then scale, the NaN-safe predicate that admits none of
  F-42's hostile `{length: Infinity, charCodeAt(){return 65}}`. `layoutGlyphs`
  is the sixth, and it returns `NaN` (fork 5), not the renderers' bare `return`.
  `drawQuads` has no text door: it takes a buffer, not a string, but it DOES
  carry an index/length door (fork 10) -- clamp `first`/`count`, throw on the
  buffer, one check per call.
- **T8/A4's `privates` pin stays exactly `['_measureRange']`.** M5 adds no
  `_`-prefixed helper; `layoutGlyphs` and `drawQuads` are public and appear in
  the enumeration, so both need a column-0 `llms.txt` signature and a backticked
  README heading or the gate reddens by design.
- **T6's window-count header goes SEVEN -> ELEVEN.** The header was already stale
  (it read SEVEN with nine windows A-H shipped); M5 adds windows I
  (`layoutGlyphs`) and J (`drawQuads`) and corrects the count to eleven in the
  same diff.
- **M6's range parameters attach to `layoutGlyphs`.** A future `start`/`end`
  sub-range of the text is a parameter addition to this method, not a new one;
  the buffer format above is what M6 fills.
