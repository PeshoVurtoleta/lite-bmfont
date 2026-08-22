# @zakkster/lite-bmfont

> Zero-GC BMFont bitmap-text renderer for Canvas2D. O(1) kerning via a 64K Int16 LUT, multi-line H/V alignment, a zero-alloc numeric HUD path, and pre-laid-out wrapped text with ellipsis. Every draw call allocates nothing -- no string splitting, no substring, no per-frame array. Built for game HUDs, score counters and long-running canvas tools that cannot afford a GC pause mid-frame.

[![npm version](https://img.shields.io/npm/v/@zakkster/lite-bmfont.svg?style=for-the-badge&color=latest)](https://www.npmjs.com/package/@zakkster/lite-bmfont)
[![sponsor](https://img.shields.io/badge/sponsor-PeshoVurtoleta-ea4aaa.svg?logo=github)](https://github.com/sponsors/PeshoVurtoleta)
![Zero-GC](https://img.shields.io/badge/Zero--GC-Engine-00C853?style=for-the-badge&logo=leaf&logoColor=white)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/@zakkster/lite-bmfont?style=for-the-badge)](https://bundlephobia.com/result?p=@zakkster/lite-bmfont)
[![npm downloads](https://img.shields.io/npm/dm/@zakkster/lite-bmfont?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-bmfont)
[![npm total downloads](https://img.shields.io/npm/dt/@zakkster/lite-bmfont?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-bmfont)
![TypeScript](https://img.shields.io/badge/TypeScript-Types-informational)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

## The bitmap-text renderer the ecosystem was missing

`lite-bmfont` is the text-drawing end of the `@zakkster` zero-GC canvas stack. Existing BMFont renderers allocate a line array and a clutch of substrings on every `draw` -- fine for a static label, a GC-pause generator in a 60fps HUD. This one indexes `charCodeAt()` straight into an `Int16Array` glyph table and reads kerning out of a flat 64K LUT, so a frame that draws a thousand glyphs, sixty numeric readouts and a wrapped paragraph allocates **nothing** after the font is built. It renders standard BMFont JSON, so the fonts you already have just work.

```bash
npm i @zakkster/lite-bmfont
```

Optional peer for word-wrapping (not bundled; install it only if you want automatic wrapping):

```bash
npm i @zakkster/lite-text-layout
```

```js
import { BitmapFont } from '@zakkster/lite-bmfont';

const font = new BitmapFont(atlasImage, fontJson);

// Multi-line, alignment-aware draw (align: 0=left, 1=center, 2=right).
font.draw(ctx, 'SCORE: 1000', 10, 30);
font.draw(ctx, 'GAME OVER', canvas.width / 2, 200, 2.0, 1);   // centered, 2x

// Kerning-aware width of the widest line -- the number to centre a box with.
const w = font.measure('Hello', 1.5);

// Zero-alloc number rendering -- ideal per-frame HUD output.
font.drawFast(ctx, fps, 10, 20);                        // "60.0"
font.drawFast(ctx, 33.49, 10, 40);                      // "33.5" (rounded)
font.drawFastInt(ctx, score, canvas.width / 2, 60, 1, 1); // integer, centered

font.destroy();   // release the atlas + typed arrays
```

**[-> Live interactive playground](https://cdpn.io/pen/debug/dPpVZyR)**

Three width faces, three renderers, a numeric fast path and a re-usable wrapped-layout path -- one class, zero allocations on every hot call.

---

## Table of contents

- [Why this exists](#why-this-exists)
- [What you get](#what-you-get)
- [The surface up close](#the-surface-up-close)
- [API reference](#api-reference)
- [Layout buffer format](#layout-buffer-format)
- [Composability with the ecosystem](#composability-with-the-ecosystem)
- [Zero-GC design notes](#zero-gc-design-notes)
- [Comparison](#comparison)
- [Design decisions worth knowing](#design-decisions-worth-knowing)
- [Testing](#testing)
- [What ships](#what-ships)
- [What this is not](#what-this-is-not)
- [Ecosystem](#ecosystem)

---

## Why this exists

Bitmap text on a canvas has one problem that no convenient API solves: **drawing it every frame must not allocate.** A game HUD redraws score, timer, FPS, ammo and a dozen labels sixty times a second. `ctx.fillText` reflows and shapes on every call; a typical BMFont wrapper does `text.split('\n')` and a `substring` per line; `value.toFixed(1)` mints a fresh string per readout. Each of those is a few bytes -- and a few bytes times a few thousand calls per second is a minor GC every couple of seconds, landing as a visible hitch in exactly the smooth thing you were trying to build.

`lite-bmfont` removes the allocation instead of hiding it:

- Glyphs are seven `Int16` values in a flat `Int16Array`, addressed as `id * 7 + offset` from `charCodeAt(i)`. No per-glyph object, no lookup map.
- Kerning is a 64K flat `Int16Array` LUT -- 128 KB of memory bought once, for O(1) pair lookup with no hashing and no allocation.
- `drawFast` / `drawFastInt` convert a `number` to ASCII char codes inside a pre-allocated 24-byte scratch buffer, so a per-frame numeric readout produces no string at all.
- `drawWrapped` renders a paragraph from a `Float32Array` you compute once and reuse -- no `split`, no `substring`, no per-frame measurement.

The result is a renderer whose steady state is integer and float arithmetic over typed arrays plus `ctx.drawImage`, proven at 0 B/op by an allocation-volume torture gate (not merely a retained-bytes rule, which cannot see per-call garbage the collector reclaims).

---

## What you get

- **`new BitmapFont(atlas, json, opts?)`** -- the renderer. Validates the descriptor at construction (fail-closed, named errors), builds the glyph and kerning tables once, and exposes every method below. Build it at load; reuse it forever.
- **Three width faces**, because a multi-line string has three honest widths:
  - **`measure(text, scale?)`** and **`measureWidest(text, scale?)`** -- the width of the *widest line*, the number to size or centre a box with.
  - **`measureLine(text, start, end, scale?)`** -- the width of one explicit `[start, end)` range, exactly what `drawWrapped` renders.
- **Three renderers**: **`draw`** (multi-line, `\n`-aware, H-aligned), **`drawWrapped`** (a pre-laid-out `Float32Array` into a box with H/V alignment and an optional `...` ellipsis), and the layout seam **`layoutGlyphs`** + **`drawQuads`** (lay glyphs into a caller buffer, then blit a subset -- the per-letter animation idiom).
- **A zero-alloc numeric path**: **`drawFast`** (one decimal place, correctly rounded at every magnitude) and **`drawFastInt`** (integer counts, truncating toward zero).
- **Metric queries**: **`hasGlyph`**, **`advanceOf`**, **`kernOf`** -- decode the 1/16 fixed-point store to pixels, fail-closed on any bad id.
- **Contract constants** -- `GLYPH_STRIDE`, `DRAWFAST_MAX`, `DRAWFASTINT_MAX`, `VERSION`, `FORMAT_VERSION` -- and two option keys, `missingAdvance` and `checked`.
- **An optional atlas generator** on a subpath -- `generateAtlas` synthesizes a runnable mock BMFont atlas from a CSS font (the one ratified allocating helper, called at boot).

Full types ship in [`BitmapFont.d.ts`](./BitmapFont.d.ts) and [`Atlas.d.ts`](./Atlas.d.ts). Every export is documented.

---

## The surface up close

<details>
<summary>Which width to call, which number renderer, and the one deliberate asymmetry.</summary>

**Which width do I want?** The package has three width functions because a multi-line string has three honest widths. Pick by the question, not the shortest name.

| Question | Call | `'AA\nAA'` at advance 8 |
|---|---|---|
| How wide is this one range? | `measureLine(text, start, end, scale?)` | `measureLine(s, 0, 2)` -> `16` |
| How wide must a box be to hold every line? | `measureWidest(text, scale?)` | `16` |
| How wide must a box be to hold every line (alias of `measureWidest`)? | `measure(text, scale?)` | `16` |

**`measure` returns the widest line (2.0.0, breaking).** Earlier it added the lines together, so centring a multi-line string with it was wrong by the width of every line that is not the longest. It is now an exact alias of `measureWidest` -- the number `draw` aligns each line against -- and a newline-free string is unchanged.

**One deliberate asymmetry:** `measure` / `measureWidest` take the MAX over lines, but `measureLine` **sums** whatever is inside the explicit `[start, end)` range you give it, including a `\n` if you include one. On an advance-12 font `measureLine('A\nA', 0, 3)` is `24` while `measure('A\nA')` is `12`. That is intended: a range is the caller's assertion about what one line is, and `drawWrapped` never hands it a range that spans a break.

**Which number renderer?** Counts, scores, coins, seconds -> `drawFastInt` (integer, truncates toward zero). FPS, timers, fractional meters -> `drawFast` (one decimal place, rounds to the nearest tenth). Both write ASCII char codes into a shared 24-byte scratch and allocate nothing.

**How failure is signalled.** The measure family answers a bad argument with `NaN`; the renderers answer by drawing nothing and returning. A renderer can decline to act; a query cannot decline to answer. To DETECT a bad `text`, gate on `Number.isNaN(measureWidest(text))` -- a renderer's silence is not an error signal.

</details>

---

## API reference

### `new BitmapFont(imageAtlas, fontJson, opts?)`
- `imageAtlas`: loaded `HTMLImageElement` or `HTMLCanvasElement`
- `fontJson`: standard BMFont JSON with `common`, `chars`, and optional `kernings`
- `opts.missingAdvance`, `opts.checked`: optional. See the options table below.

**The descriptor is validated at construction (F-10).** `imageAtlas`, `common`,
`common.lineHeight`, `common.base`, `chars` and (when present) `kernings` are
checked, and a malformed one throws a **`BitmapFontError`** naming the field --
no raw `TypeError` escapes. `BitmapFontError` extends `RangeError`, so a
`catch (e) { if (e instanceof RangeError) }` still fires; `e.field` and `e.value`
are own properties. `chars: []` is **legal** -- a coherent zero-glyph font whose
`measure` is 0 and whose `hasGlyph` is false for every id.

Two lanes: inputs with no correct reading (a null atlas, a NaN metric, a
non-number id, a fractional kerning key) **always throw**; lossy-but-interpretable
inputs (an atlas coord past Int16, an id outside
`[0, 256)`) are skipped or truncated silently by default and throw only under
`{ checked: true }`, which reports the exact drift (F-08 detection). Storage is
changed in 2.0.0: `xadvance` and kerning `amount` are stored as
`Math.round(value * 16)` in 1/16 fixed point. Use `advanceOf(id)` / `kernOf(a, b)`
to decode; `glyphs[id * 7 + 6]` read raw is now 16x the pixel advance.

A descriptor entry for id 10 (`\n`) is **discarded** at construction -- width,
height, offsets, advance, and any kerning pair naming it. A newline is a layout
instruction, not a glyph.

### Which width do I want?

The package has three width functions because a multi-line string has three
honest widths. Pick by the question you are asking, not by the shortest name.

| Question | Call | `'AA\nAA'` at advance 8 |
|---|---|---|
| How wide is this one range? | `measureLine(text, start, end, scale?)` | `measureLine(s, 0, 2)` -> `16` |
| How wide must a box be to hold every line? | `measureWidest(text, scale?)` | `16` |
| How wide must a box be to hold every line (alias of `measureWidest`)? | `measure(text, scale?)` | `16` |

### `measure(text, scale?) -> number`
Kerning-aware width of the **widest line** of `text`. **Breaking in 2.0.0**
(F-06): `measure('AA\nAA')` on an advance-8 font is `16`; earlier it added the
lines together and returned `32`. Now an exact alias of `measureWidest`.

Returns **`NaN`** if `text` is not a string, or if `scale` is outside
`(0, Infinity)` -- `NaN`, `0`, a negative, or `Infinity`. Throws after
`destroy()`.

There is no `measureTotalAdvance`: the old cross-newline total had no consumer.
See the CHANGELOG's 2.0.0 Breaking section for the migration table.

### `measureWidest(text, scale?) -> number`
Width of the **widest line** -- the number to size or centre a box with.
`measureWidest('AA\nAA')` is `16`, and since 2.0.0 `measure` returns that same
number (it delegates here).

Lines split at `\n` only, and the kerning chain **resets at the break**, matching
`draw`. A trailing newline yields a final empty line of width 0, so `'AAA\n'` is
`24`, not `0`. One pass, no `split`, no `slice`, zero allocation -- gated by an
allocation-volume check over 200,000 calls, not merely by a retained-bytes rule
(a retention lane cannot see per-call garbage the collector reclaims).

**Can return a negative width.** A negative `xadvance` or kerning `amount` is a
valid Int16 the constructor accepts, so a line can legitimately measure negative
and the result is the greatest (least negative) line. An empty line measures `0`,
which is wider than any negative line.

Returns **`NaN`** on a non-string `text` or a `scale` outside `(0, Infinity)`.

### `measureLine(text, start, end, scale?) -> number`
Width of **one range**. `start` and `end` are clamped into `[0, text.length]` and
are otherwise left alone -- exactly what `drawWrapped` does to the indices it
reads out of a layout buffer, which is what makes this report what `drawWrapped`
**renders** instead of what a raw index walk counts. Fractional indices are read
as `charCodeAt` reads them, truncated per iteration, not rounded at the boundary.

```js
// the width of the line your layout engine just produced
const w = font.measureLine(text, layout[l * 4], layout[l * 4 + 1], scale);
```

- `[-0.5, 2)` on `'AAAA'` at advance 8 -> `16`, the two glyphs `drawWrapped`
  draws (a raw range walk reports `24`).
- `[0.5, 2.7)` -> `24`, the three glyphs `drawWrapped` draws.
- `[-Infinity, Infinity)` -> `32`, and it **returns**.
- A `NaN` bound behaves as the renderer treats it: `NaN` `start` -> `0`, `NaN`
  `end` -> `text.length`, so `[0, NaN)` measures the **whole line**. `NaN` is
  what a `Float32Array` holds when a layout pass failed or never ran.
- An empty range after clamping, or a negative `end` -> `0`, not `NaN`.
- Non-string `text` or a `scale` outside `(0, Infinity)` -> **`NaN`**. Door order
  is text, then scale, **then** the range, so a bad `scale` with an empty range
  is `NaN`, not `0`.

### The measure family answers with `NaN`; the renderers answer by drawing nothing

`draw`, `drawFast` and `drawWrapped` respond to a bad `scale` by emitting zero
`drawImage` calls. `measure`, `measureWidest` and `measureLine` respond by
returning `NaN`. The asymmetry is deliberate: **a renderer can decline to act, a
query cannot decline to answer.** A caller who passes `scale: NaN` to both in one
frame gets zero pixels and a `NaN` width, and both are honest.

The scale door is a **range** test -- `!(scale > 0 && scale < Infinity)` -- so
`0` and `-1`, which are finite, are rejected too. The text door is
`typeof text === 'string'`, not an "array-like" test, so a **boxed** `String`
object (`new String('AA')`) is rejected and returns `NaN`. That is deliberate:
the looser test admits `{length: Infinity, charCodeAt(){...}}`, which never
terminates.

Since 1.4.1 the **same text door guards all five text-taking faces** (F-42):
`draw` and `drawWrapped` reject a non-string `text` -- `null`, `undefined`, a
number, an array, a boxed `String`, or the `{length: Infinity, charCodeAt}`
object that hung both renderers before 1.4.1 -- by drawing **nothing** and
returning, while `measure`, `measureWidest` and `measureLine` return `NaN`.
`drawFast` takes a number and carries no text door. A renderer's silence is not
an error signal; to DETECT a bad `text`, gate on the measure family with
`Number.isNaN(measureWidest(text))`.

`NaN` is what the doors produce, and it is not unique in the absolute: a font
with mixed-sign Int16 advances at an extreme but in-range `scale` can also
produce `NaN` or `Infinity` by arithmetic. That behaviour is unchanged from
1.3.0.

### `hasGlyph(id) -> boolean`
Does the descriptor cover this glyph id? Fail-closed on every non-integer: `NaN`,
`-1`, `256`, `65.5` are all `false`. Id 10 is always `false`. Throws after
`destroy()`. Use it to detect coverage gaps at load time instead of as
overlapping text at runtime.

### `advanceOf(id) -> number`
Decoded pixel advance of glyph `id` at scale 1 (2.0.0). The store holds
`Math.round(xadvance * 16)` in 1/16 fixed point, so an `xadvance: 8.6` font
reports `advanceOf(65) === 8.625`. Fail-closed: a non-integer or out-of-range id
returns `0`. Throws after `destroy()`.

### `kernOf(a, b) -> number`
Decoded pixel kerning between glyphs `a` and `b` at scale 1 (2.0.0), `stored *
0.0625`. Fail-closed: a non-integer or out-of-range key returns `0`. Throws after
`destroy()`.

### `draw(ctx, text, x, y, scale?, align?) -> void`
Multi-line `\n`-aware renderer. `align`: `0` = left, `1` = center, `2` = right;
any value outside `{0, 1, 2}` (`NaN`, negatives, fractionals) renders **left**.
A `scale` outside `(0, Infinity)` -- `NaN`, `0`, a negative, or `Infinity` --
draws **nothing** and returns (F-11). `x, y` is the **baseline anchor** of the
first line.

**Pixel-snapped per line origin in X and per baseline in Y.** That is the exact
scope of the promise, and it is worth stating precisely because "pixel-snapped"
invites the stronger reading:

- **Y: every baseline is snapped**, not just the first. Line `i` lands at
  `Math.round(y) + Math.round(i * lineHeight * scale)`. Before 1.4.0 only line 0
  was rounded and the rest accumulated raw, so at `lineHeight` 17 and
  `scale` 1.1 the five baselines were `0, 18.7, 37.4, 56.1, 74.8`; they are now
  `0, 19, 37, 56, 75`.
- **X: only the line origin is snapped, never the individual glyph.** At
  `scale` 1.1 a glyph column reads `0, 8.8, 17.6, 26.4...` and that is
  deliberate. Rounding each glyph's x would break the advance conservation law
  the whole test suite rests on, and would cost bytes in the glyph loop to serve
  a cosmetic preference.

`drawWrapped` snaps the same way, from its own line-0 anchor.

### `drawFast(ctx, value, x, y, scale?, align?) -> void`
Zero-alloc number renderer with one decimal place.

- `NaN`, `+Infinity`, `-Infinity` -> silently skipped (returns).
- `|value| > DRAWFAST_MAX` (`1e21`) -> silently skipped (returns); draws nothing.
- Negative values inside the door -> clamped to `0` (so `-5` renders `"0.0"`).
- Decimal -> rounded to the nearest tenth, **exactly** (`8.45 -> "8.4"`, not
  `"8.5"`): the tenth is derived by Fast2Sum, not a `value * 10` product, so the
  guarantee holds at every magnitude (F-23 closed).
- Requires `'0'`-`'9'` (codes 48-57) and `'.'` (code 46) in the atlas.

Above 2^53 (9007199254740992) every double is an integer and its digits are
rendered **exactly** -- the true value of the double stored, which is **not**
necessarily the literal you typed: `762638538843020900000` renders
`"762638538843020853248.0"`, the double that literal actually became. Values
outside `[-DRAWFAST_MAX, DRAWFAST_MAX]` draw nothing. A `scale` outside
`(0, Infinity)` draws **nothing** and returns (F-11), same as `draw`.

### `drawFastInt(ctx, value, x, y, scale?, align?) -> void`
Zero-alloc INTEGER renderer for counts -- coins, kills, score, seconds. No
decimal point.

- `NaN`, `+Infinity`, `-Infinity` -> silently skipped (returns).
- `|value| > DRAWFASTINT_MAX` (`Number.MAX_SAFE_INTEGER`) -> silently skipped
  (returns); draws nothing.
- Negative values inside the door -> clamped to `0` (so `-5` renders `"0"`).
- Requires `'0'`-`'9'` (codes 48-57) in the atlas ONLY. It does NOT require the
  `'.'` (code 46) glyph `drawFast` requires, so a digits-only atlas can use it.
- A `scale` outside `(0, Infinity)` draws **nothing** and returns (F-11), same
  as `draw`.

`drawFastInt` TRUNCATES toward zero: `1.9` renders `"1"`, not `"2"`. `drawFast`
ROUNDS to the nearest tenth. This is deliberate -- `drawFast` renders a
measurement, `drawFastInt` renders a count, and a count must never display a
threshold it has not crossed.

`DRAWFASTINT_MAX` is `Number.MAX_SAFE_INTEGER`, the **correctness** boundary, not
`DRAWFAST_MAX`'s buffer boundary: above 2^53 a double is not integer-exact, so
`drawFastInt` refuses the range (above `DRAWFAST_MAX`, `drawFast` renders the
double's exact integer value by decimal doubling), and is exact by construction
for every value it admits.

**Allocation (F-44 was a misdiagnosis):** the digit loop keeps its loop variables
under 2^31 via a hi/lo split (`lo = n % 1e7`, `hi = (n - lo) / 1e7`), so the
**body** boxes no HeapNumber in any V8 tier -- Smi discipline that also holds in
the pre-warmup Ignition tier the throughput gates cannot reach. This does **not**
make a large call zero-alloc: passing an argument above 2^31 (`2147483648`) boxes
the double at the **call boundary**, about 16 B/call, and that cost is caller-side
-- identical before and after, and removable by no change to this library.
F-44's original claim of boxing *inside* the digit loop was wrong: the box is at
the call site, not the loop. `drawFast` uses the same split for the same reason.

**Which one do I want?** Counts, scores, coins, seconds -> `drawFastInt`. FPS,
timers, fractional meters -> `drawFast`.

**Contract:** `ctx.drawImage` must not re-enter the font. `drawFast` and
`drawFastInt` share one 24-byte scratch buffer; a re-entrant ctx corrupts the
outer call's digits. True for a `CanvasRenderingContext2D`, not for an arbitrary
object with a `drawImage` method.

### Constants and options

| Name | Value | Meaning |
|------|-------|---------|
| `GLYPH_STRIDE` | `6` | float count per glyph record in a `layoutGlyphs` / `drawQuads` buffer (`[sx, sy, sw, sh, dx, dy]`); size the buffer with the safe upper bound `text.length * GLYPH_STRIDE` |
| `DRAWFAST_MAX` | `1e21` | largest magnitude `drawFast` renders; outside `[-DRAWFAST_MAX, DRAWFAST_MAX]` it draws nothing (both endpoints inclusive) |
| `DRAWFASTINT_MAX` | `Number.MAX_SAFE_INTEGER` | largest magnitude `drawFastInt` renders; outside `[-DRAWFASTINT_MAX, DRAWFASTINT_MAX]` it draws nothing (both endpoints inclusive). The correctness boundary, not a buffer boundary |
| `opts.missingAdvance` | `0` (default) | xadvance written into every glyph id the descriptor did not cover, so an absent glyph leaves a gap instead of overprinting the next. Opt-in; the default is byte-identical to 1.2.x. Must be finite in `[0, 2047.9375]` -- the 1/16 fixed-point advance range (2.0.0, `decisions/0012` fork 1) -- or the constructor throws `BitmapFontError` (which is a `RangeError`). Stored as `Math.round(value * 16)`. Id 10 is never given a missing advance |
| `opts.checked` | **`true` (default, 2.0.0)** | must be a boolean; pass `{ checked: false }` to opt out. Opens the lossy validation lane: an atlas coord past Int16, or an id/kerning key outside `[0, 256)`, throws a `BitmapFontError` naming the exact drift instead of being skipped silently. **A fractional `xadvance`/`amount` NO LONGER throws** -- 1/16 is the format's declared resolution, so a value it is designed to round is not lossy (`decisions/0012` forks 1 and 6). Out-of-RANGE advances still throw. Inputs with no correct reading throw in both lanes |

### `drawWrapped(ctx, text, layoutBuffer, lineCount, boxWidth, boxHeight, x, y, scale?, align?, vAlign?) -> void`
Renders a pre-laid-out `Float32Array` of lines into a box. See [Layout buffer format](#layout-buffer-format) below for the slot layout and a layout helper recipe.

- `x, y` is the box's **top-left corner**.
- A `scale` outside `(0, Infinity)` draws **nothing** and returns (F-11).
- `align`: `0` = left, `1` = center, `2` = right; outside `{0, 1, 2}` renders **left**.
- `vAlign`: `0` = top, `1` = middle, `2` = bottom; outside `{0, 1, 2}` renders **top**.
- `flags` is a bitfield read via ToInt32 -- `(flags | 0) & 1` appends a `"..."`
  ellipsis, so `1.0000001` (a `Float32Array` rounding artifact) and `-1` both fire
  it (F-13); `2`, `0` and `NaN` do not. A bit outside the mask throws under
  `{ checked: true }` and is ignored otherwise.

**Contract, enforced (1.2.3):**
- `lineCount` is floored to an integer and clamped at 0. `NaN`, a negative, and any
  value below 1 draw nothing and return (`0.5` drew a full line in 1.2.2).
- The buffer MUST hold at least `lineCount * 4` floats. A short buffer throws a
  `RangeError` naming both numbers (surplus lines vanished silently in 1.2.2).
- `startIdx` below 0, or `NaN`, clamps to 0. `endIdx` above `text.length`, or `NaN`,
  clamps to `text.length`. `endIdx < startIdx` draws an empty line. Fractional
  indices are truncated, not floored.
- `layoutBuffer` may be any indexable with a numeric `length` (`Float64Array` and a
  plain `Array` behave identically); no type check is performed.
- Id 10 (`\n`) inside a line range is NOT a line break here -- it advances 0 and
  draws nothing.

### `layoutGlyphs(text, outBuffer, x, y, scale?, align?) -> number`
Lays out `text` into a caller-owned `outBuffer` as one stride-`GLYPH_STRIDE`
record per **visible** glyph -- `[sx, sy, sw, sh, dx, dy]` -- and returns the
record count. Pair it with `drawQuads` to blit; between the two calls the buffer
IS the mutation seam -- edit `dx`/`dy` to move a letter, or narrow `first`/`count`
to draw a subset (`decisions/0010`, no per-glyph closure).

It reproduces `draw`'s arithmetic **exactly** at the same `x`/`y` origin, `scale`
and `align`: the same per-line-origin/per-baseline `Math.round` snap (F-07, B1),
the same NaN-safe id gate, the same `gw > 0 && gh > 0` gate. `dx`/`dy` are
**absolute** with `scale` already folded in; `sw`/`sh` are the **unscaled**
source dimensions (`drawQuads` multiplies them by its own `scale`).

- `outBuffer` is a `Float64Array` or a plain `Array` -- **not** a `Float32Array`,
  which rounds the double cursor and breaks round-trip identity with `draw`.
  `.length`, not `byteLength`, is checked.
- A short buffer throws a plain `RangeError` (**not** `BitmapFontError`) naming
  the capacity, glyph index and need, checked **per emitted record**. The **safe
  upper bound** is `text.length * GLYPH_STRIDE` -- the exact record count is NOT
  derivable in advance, because spaces and out-of-range ids advance the cursor
  and occupy no record.
- A non-string `text`, or a `scale` outside `(0, Infinity)`, returns `NaN` (not
  `0`, which is the honest answer for `''`); nothing is written.

### `drawQuads(ctx, buffer, first, count, offX?, offY?, scale?) -> void`
Blits `count` glyph records from `buffer` starting at record `first`, one
`ctx.drawImage` each. `offX`/`offY` are added **raw** to `dx`/`dy` -- never
re-snapped, so a sub-pixel shake or scroll offset stays smooth. `scale`
multiplies **only** the source dimensions to size the destination and MUST equal
the layout scale; `dx`/`dy` are already absolute and scaled.

`first`/`count` follow `drawWrapped`'s fork (1) idiom (`decisions/0010` fork 10):
they are **clamped** (a `NaN`, negative or below-one `count` draws nothing; a
negative `first` clamps to 0; fractionals floored), and a range whose last record
exceeds the buffer **throws** a plain `RangeError` (not `BitmapFontError`) -- one
check per call, none per glyph.

**Pinned hazard:** a buffer length cannot know how many records `layoutGlyphs`
actually **wrote**, so a `count` larger than the returned count but still within
the buffer draws from **unwritten** slots. Pass `drawQuads` the exact count
`layoutGlyphs` returned -- the caller's responsibility, in the same spirit
`drawFast`'s shared-scratch reentrancy is a documented hazard, not a guarded case.

### `destroy() -> void`
Releases the atlas reference and typed arrays. Every method throws a named error
after `destroy()` -- a use-after-free is a loud failure, never a silent bad draw.

## Atlas generation (subpath `@zakkster/lite-bmfont/atlas`)

A COLD, boot-time helper for synthesizing a runnable mock BMFont atlas from a CSS
font -- the playground's font source, shipped so you do not have to copy it. It is
the ONE allocating function in the package (one canvas + one descriptor + ~95
char entries per call); a RATIFIED exception (`decisions/0009`), called once per
theme at boot, never in a frame loop, and not precedent for allocating elsewhere.
The core `BitmapFont.js` never imports it, so the main module stays DOM-free and
`sideEffects: false`.

```js
import { generateAtlas } from '@zakkster/lite-bmfont/atlas';
import { BitmapFont } from '@zakkster/lite-bmfont';

const { atlas, json } = generateAtlas(36, "bold 36px monospace", '#39ff85', '#001a0a');
const font = new BitmapFont(atlas, json);
```

#### `generateAtlas(size, fontCSS, fillColor, shadowColor?) -> { atlas, json }`
- `size`: integer px in `[4, 512]` (feeds `common.base`; the lower bound is derived from `cellH - 4 >= 1`, not picked)
- `fontCSS`: a CSS `font` shorthand, e.g. `"bold 36px monospace"`
- `fillColor`: glyph fill color
- `shadowColor`: optional drop-shadow color

Fails closed with a named `AtlasError`, never a bare `Error`/`TypeError`: a
missing DOM (`globalThis.document.createElement`), a null/unusable
`getContext('2d')`, and a hostile DOM whose
`createElement`/`getContext`/`measureText`/`fillText` throws are all re-thrown as
`AtlasError` with `field: 'dom'` (carrying the original). A bug inside
`generateAtlas`'s own glyph arithmetic throws `AtlasError` with `field:
'internal'` instead, so a library bug is never mislabeled a caller DOM fault (the
`field` values are examples, not an exhaustive set). A non-integer or
out-of-range `size` throws rather than being normalized -- `size` feeds
`common.base`, which `{ checked: true }` would reject, so a silent snap would
launder a caller bug.

---

## Layout buffer format

`drawWrapped` renders multi-line text **into a bounding box** with both horizontal and vertical alignment, plus an optional ellipsis-on-overflow flag. To stay zero-alloc it does not word-wrap for you -- you hand it a `Float32Array` describing the lines, and it does the rest. That separation lets you compute the layout once and re-render it every frame for free.

Each line is **4 consecutive Float32 values**:

| Slot | Meaning |
|------|---------|
| `[0]` | `startIdx` -- char index in `text` where this line begins (inclusive) |
| `[1]` | `endIdx` -- char index in `text` where this line ends (exclusive) |
| `[2]` | `lineWidth` -- measured pixel width of this line **at the rendered scale** |
| `[3]` | `flags` -- `0` = normal line; `1` = append `...` ellipsis after content |

The buffer must hold at least `lineCount * 4` floats; surplus capacity is ignored, so you can reuse one fat buffer across many strings without reallocating.

```js
font.drawWrapped(
  ctx, text, layoutBuffer, lineCount,
  boxWidth, boxHeight, boxX, boxY,
  scale,   // default 1
  align,   // 0 = left,  1 = center, 2 = right
  vAlign   // 0 = top,   1 = middle, 2 = bottom
);
```

`(boxX, boxY)` is the container's **top-left corner**, not a baseline. The renderer positions line 1's visual top edge at `boxY` when `vAlign = 0`. If a line is truncated and you want `...` appended, set its `flags` slot to `1` (the renderer draws three `'.'` glyphs after the content, so keep `'.'` in your atlas).

<details>
<summary>A tiny greedy word-break helper that fills this buffer (drop into your own code).</summary>

For a production, zero-GC, kerning-aware wrapper that outputs this exact buffer, use [`@zakkster/lite-text-layout`](https://www.npmjs.com/package/@zakkster/lite-text-layout). If you would rather own the wrap, keep one buffer alive and reuse it:

```js
// Greedy word-wrap. Returns the number of lines written into `out`.
// `out` must hold at least Math.ceil(text.length / 4) * 4 floats (worst case: every char a line).
function layoutWrap(font, text, maxWidth, out) {
    let line = 0, i = 0, len = text.length;

    while (i < len) {
        let lineStart = i;
        let lastBreak = -1;          // index of last whitespace seen
        let lastBreakWidth = 0;
        let width = 0;
        let prevId = -1;

        while (i < len) {
            const id = text.charCodeAt(i);
            if (id === 10) break;                       // \n
            if (id === 32) { lastBreak = i; lastBreakWidth = width; }

            const advance = font.advanceOf(id);          // decodes the 1/16 store
            const kern = prevId === -1 ? 0 : font.kernOf(prevId, id);
            const nextWidth = width + kern + advance;

            if (nextWidth > maxWidth && i > lineStart) {
                // Wrap at last whitespace, else hard-break.
                if (lastBreak !== -1) { i = lastBreak + 1; width = lastBreakWidth; }
                break;
            }

            width = nextWidth;
            prevId = id;
            i++;
        }

        const lineEnd = (lastBreak !== -1 && i === lastBreak + 1) ? lastBreak : i;
        const o = line * 4;
        out[o]     = lineStart;
        out[o + 1] = lineEnd;
        out[o + 2] = width;
        out[o + 3] = 0;          // set to 1 to draw "..." after this line
        line++;

        if (i < len && text.charCodeAt(i) === 10) i++;  // skip the \n
    }
    return line;
}

// Use it:
const layout = new Float32Array(64);          // room for 16 lines, allocated once
const lines  = layoutWrap(font, story, 300, layout);
font.drawWrapped(ctx, story, layout, lines, 300, 200, 20, 20, 1, 1, 1); // center/center
```

</details>

---

## Composability with the ecosystem

From a CSS font to per-letter animated, wrapped, HUD-annotated canvas text, every stage passing flat typed arrays and allocating nothing per frame:

```js
import { BitmapFont, GLYPH_STRIDE } from '@zakkster/lite-bmfont';
import { generateAtlas }            from '@zakkster/lite-bmfont/atlas';

// 1. Build a font once, at boot. generateAtlas is the one ratified allocation.
const { atlas, json } = generateAtlas(36, 'bold 36px monospace', '#39ff85', '#001a0a');
const font = new BitmapFont(atlas, json);

// 2. Pre-allocate every per-frame buffer ONCE, outside the loop.
const title    = 'ZERO-GC BITMAP TEXT';
const glyphBuf = new Float64Array(title.length * GLYPH_STRIDE);   // layout seam scratch
const wrapBuf  = new Float32Array(64);                            // up to 16 wrapped lines

// 3. Lay the title out once; the per-glyph x is already the prefix width.
const baseX = 600 - font.measureLine(title, 0, title.length, 1) / 2;
const n = font.layoutGlyphs(title, glyphBuf, baseX, 120, 1, 0);

function frame(now, score, story) {
  // 3a. Per-letter wave: edit dy in the buffer, blit one glyph at a time. No alloc.
  for (let i = 0; i < n; i++) {
    const flatDy = glyphBuf[i * GLYPH_STRIDE + 5];
    glyphBuf[i * GLYPH_STRIDE + 5] = flatDy + Math.sin(now * 0.004 + i * 0.4) * 18;
    font.drawQuads(ctx, glyphBuf, i, 1, 0, 0, 1);
  }

  // 3b. A zero-padded score and a wrapped paragraph, both allocation-free.
  font.drawFastInt(ctx, score, 40, 40, 1, 0);              // count, no string
  const lines = layoutWrap(font, story, 300, wrapBuf);     // reuses wrapBuf
  font.drawWrapped(ctx, story, wrapBuf, lines, 300, 200, 20, 200, 1, 1, 1);
}
```

Every stage is deterministic, every stage is zero-GC on the hot path, and every stage hands a flat `Float64Array` / `Float32Array` to the next -- no format translation, no allocation between stages. The wrapping half of step 3b becomes a single `@zakkster/lite-text-layout` call when you want kerning-aware breaks and truncation; its output buffer is byte-compatible with `drawWrapped`'s by contract.

---

## Zero-GC design notes

<details>
<summary>What the hot path allocates (nothing), and how it stays that way.</summary>

`new BitmapFont` allocates every table it will ever use at construction: the stride-7 `Int16Array` glyph table, the 64K flat `Int16Array` kerning LUT, and the 24-byte `Uint8Array` numeric scratch. Every method afterward does integer and float arithmetic on those pre-allocated arrays plus `ctx.drawImage` and byte writes -- no string, no substring, no per-call array or object.

| Operation | Steady-state allocations |
| --------- | ------------------------ |
| `draw` / `drawWrapped` main loop | **0** |
| `drawFast` / `drawFastInt` | **0** (digits go into a reused 24-byte scratch) |
| `measure` / `measureWidest` / `measureLine` | **0** (single pass, no `split`) |
| `layoutGlyphs` / `drawQuads` | **0** (writes into the caller's buffer) |
| `new BitmapFont(...)` | once, at construction (glyph + kerning tables, then reused) |
| `generateAtlas(...)` | once, at boot -- the ratified exception (`decisions/0009`) |

Two facts make the numeric path subtle and both are gated. First, the digit loop keeps its loop variables under 2^31 with a hi/lo split, so the loop **body** boxes no HeapNumber in any V8 tier; a value passed above 2^31 boxes once at the **call boundary** (~16 B/call), caller-side and removable by no change here (F-44 was a misdiagnosis -- see `drawFastInt`). Second, a retention lane cannot see per-call garbage the collector reclaims (F-37), so the torture harness carries a separate **allocation-VOLUME** lane -- summed positive `heapUsed` deltas over 200,000 strided calls per body -- that DOES see transient strings.

That lane is a coarse transient detector, not a byte-accurate proof: on single-method library bodies its working-set floor is ~0, so a mutant that starts allocating separates by orders of magnitude and the gate is sharp. The torture run (`@zakkster/lite-leak` + `@zakkster/lite-gc-profiler`, under `--expose-gc`) proves 0 retained bytes, 0 major GCs, and no transient-allocation regression across twelve volume windows -- one per hot body -- and prints exactly `ok`.

</details>

---

## Comparison

| Library | Size (gzip) | Allocations | Kerning | Multi-line | Wrap + align |
|---------|-------------|-------------|---------|------------|--------------|
| bmfont-text | ~4 KB | Arrays per draw | Slow | Basic | Some |
| msdf-bmfont-xml | ~8 KB | High | Yes | Yes | Yes |
| **lite-bmfont** | **~1.3 KB** | **Zero** | **O(1) LUT** | **Yes + alignment** | **Yes (bring your own layout)** |

---

## Design decisions worth knowing

- **`measure` returns the widest line, not the sum (2.0.0, breaking).** A multi-line string has three honest widths and the shortest-named function must answer the one callers actually centre with. The old cross-newline total had no consumer and silently mis-centred every multi-line label; it is gone, `measure` is an exact alias of `measureWidest`, and `measureLine` is the range face. Newline-free strings are unchanged.
- **The measure family answers with `NaN`; the renderers draw nothing.** A renderer can decline to act, a query cannot decline to answer. Both are honest fail signals; to DETECT a bad input, gate on `Number.isNaN(measureWidest(text))` -- never on a renderer's silence.
- **Advances are 1/16 fixed point (2.0.0).** `xadvance` and kerning `amount` are stored as `Math.round(value * 16)` in `Int16`, giving a 2047.9375 px advance ceiling at a 1/16 px resolution. Decode with `advanceOf` / `kernOf`; a raw `glyphs[id * 7 + 6]` is 16x the pixel advance. This is what lets `draw`, `layoutGlyphs` and the measure family agree to the last pixel under one conservation law.
- **Only the line origin snaps in X, never the glyph.** Per-glyph rounding would break the advance conservation law the whole suite rests on and cost bytes in the hot loop for a cosmetic gain. Every baseline snaps in Y; every line origin snaps in X; glyph columns stay sub-pixel by design.
- **`checked: true` is the default (2.0.0).** Lossy-but-interpretable inputs (an atlas coord past Int16, an id outside `[0, 256)`) throw a named `BitmapFontError` reporting the exact drift, instead of being silently truncated. A fractional advance no longer throws -- 1/16 is the format's declared resolution -- but an out-of-range one still does. Opt out with `{ checked: false }`.
- **Fail closed, name the field.** The constructor validates the whole descriptor and throws `BitmapFontError` (a `RangeError`) naming the offending field; `null` is rejected as `null`, never coerced to zero. `generateAtlas` distinguishes a hostile DOM (`field: 'dom'`) from its own internal bug (`field: 'internal'`), so a library fault is never blamed on the caller's environment.

---

## Testing

`npm test` runs the full `node:test` suite and must report **0 failures**.
`npm run torture` must print exactly `ok` and exit 0. Those two commands are the
gate; absolute test counts are deliberately not published here, because a count
no gate can read drifts silently (F-43). `npm run torture` runs the ten-tier
zero-GC gate (`node --expose-gc test/torture.mjs`): the descriptor door is proven
by T3's 50-row abuse matrix and T9's control 10, the pixel-snap promise by T5's
allocating reference renderer plus two T9 controls that rebuild the rejected
rounding variants and require the numbers to move, and the zero-allocation claim
by T6's twelve allocation-volume windows -- one per hot body -- with T9's control
injecting a retained allocation to prove the gate can fail.

```bash
npm test        # full node:test suite -- must report 0 failures
npm run torture # @zakkster/lite-leak + lite-gc-profiler -- must print exactly "ok"
npm run smoke   # DOM-free import of both entry points through the exports map
npm run verify  # test + torture, the publish gate
```

---

## What ships

The published package is a single core module plus its optional atlas subpath -- no build step, no bundler.

| File | Subpath | Role |
|------|---------|------|
| `BitmapFont.js` / `BitmapFont.d.ts` | `@zakkster/lite-bmfont` | the zero-GC renderer (core) |
| `Atlas.js` / `Atlas.d.ts` | `@zakkster/lite-bmfont/atlas` | COLD boot-time `generateAtlas` |
| `README.md`, `CHANGELOG.md`, `FORMAT.md`, `llms.txt`, `LICENSE` | -- | docs + license |

Full TypeScript declarations ship in `BitmapFont.d.ts` and `Atlas.d.ts`; the `Align`, `VAlign`, `BMFontJson`, `BMFontChar`, `BMFontKerning` and `BitmapFontOptions` types plus the `BitmapFontError` class are exported for typing layout helpers, JSON loaders and `catch` blocks. The binary layout every kernel reads is specified in [`FORMAT.md`](./FORMAT.md), machine-readable metadata is in [`llms.txt`](./llms.txt), and the release history is in [`CHANGELOG.md`](./CHANGELOG.md).

---

## What this is not

- **Not a font shaper.** No bidi, no complex-script shaping, no OpenType features, no ligature substitution. It renders a BMFont atlas glyph by glyph, left to right, with kerning pairs. For Latin/CJK-fixed HUD and game text it is exact; for Arabic or Devanagari shaping, shape upstream.
- **Not a word wrapper.** `drawWrapped` renders a layout you provide; it does not decide line breaks. Bring the greedy helper above, or `@zakkster/lite-text-layout` for a kerning-aware, truncating wrap. The split keeps the renderer zero-alloc.
- **Not a font loader or atlas packer.** It consumes a loaded image and BMFont JSON. Pack your atlas with the tool of your choice (or use `generateAtlas` for a mock ASCII font at boot).
- **Not an SDF / MSDF renderer.** It draws bitmap glyphs at their native resolution with a per-line pixel snap. For resolution-independent vector-crisp text at any scale, an MSDF pipeline is the different tool.
- **Not a DOM text layout engine.** No line boxes, no flow, no CSS. It is a canvas draw primitive: glyphs, metrics, alignment, wrap-from-a-buffer.
- **Not a GUI.** No components, no canvas wiring, no input handling. Bring your own render loop; call these methods inside it.

---

## Ecosystem

Part of the **@zakkster** zero-GC stack:

- [`lite-text-layout`](https://www.npmjs.com/package/@zakkster/lite-text-layout) -- zero-GC kerning-aware word wrap + truncation, emitting `drawWrapped`'s buffer format
- [`lite-signal`](https://www.npmjs.com/package/@zakkster/lite-signal) -- zero-GC reactive graph for hot paths
- [`lite-leak`](https://www.npmjs.com/package/@zakkster/lite-leak) -- retention torture kernels (this package's dev peer)
- [`lite-gc-profiler`](https://www.npmjs.com/package/@zakkster/lite-gc-profiler) -- allocation + GC budget gate (this package's dev peer)
- **`lite-bmfont`** -- this package

---

## License

MIT (c) Zahary Shinikchiev <shinikchiev@yahoo.com>
