# @zakkster/lite-bmfont

[![npm version](https://img.shields.io/npm/v/@zakkster/lite-bmfont.svg?style=for-the-badge&color=latest)](https://www.npmjs.com/package/@zakkster/lite-bmfont)
[![sponsor](https://img.shields.io/badge/sponsor-PeshoVurtoleta-ea4aaa.svg?logo=github)](https://github.com/sponsors/PeshoVurtoleta)
![Zero-GC](https://img.shields.io/badge/Zero--GC-Engine-00C853?style=for-the-badge&logo=leaf&logoColor=white)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/@zakkster/lite-bmfont?style=for-the-badge)](https://bundlephobia.com/result?p=@zakkster/lite-bmfont)
[![npm downloads](https://img.shields.io/npm/dm/@zakkster/lite-bmfont?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-bmfont)
[![npm total downloads](https://img.shields.io/npm/dt/@zakkster/lite-bmfont?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-bmfont)
![TypeScript](https://img.shields.io/badge/TypeScript-Types-informational)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

**[→ Live Interactive Playground](https://cdpn.io/pen/debug/dPpVZyR)**

## 🔤 What is lite-bmfont?

`@zakkster/lite-bmfont` renders BMFont-format bitmap text to Canvas2D with zero allocations.

It gives you:

- 🔤 BMFont JSON format support
- ⚡ O(1) kerning lookup via 64K `Int16Array` LUT
- 📏 Multi-line `\n` text with left / center / right alignment
- 📐 `measure()` for kerning-aware width calculation
- 🔢 `drawFast()` — zero-alloc number renderer (1 decimal place) for HUDs, scores, timers
- 📦 `drawWrapped()` — render a pre-laid-out `Float32Array` of lines into a bounding box, with H/V alignment and an optional `…` ellipsis flag
- 🧹 Zero allocation on every hot-path call — no string splitting, no array creation
- 🎯 Pixel-snapped rendering for crisp pixel fonts
- 🪶 ~1.3 KB gzipped

> **Note:** Supports ASCII characters 0–255. Unicode is intentionally excluded for zero-GC performance.

Part of the [@zakkster/lite-*](https://www.npmjs.com/org/zakkster) ecosystem — micro-libraries built for deterministic, cache-friendly game development.

## 🚀 Install

```bash
npm i @zakkster/lite-bmfont
```

## 🕹️ Quick Start

```javascript
import { BitmapFont } from '@zakkster/lite-bmfont';

const font = new BitmapFont(atlasImage, fontJson);

// Draw left-aligned at the baseline.
font.draw(ctx, 'SCORE: 1000', 10, 30);

// Draw centered (align: 0=left, 1=center, 2=right).
font.draw(ctx, 'GAME OVER', canvas.width / 2, 200, 2.0, 1);

// Measure width.
const w = font.measure('Hello', 1.5);

// Zero-alloc number drawing — ideal for per-frame HUDs.
font.drawFast(ctx, fps,   10, 20);                      // "60.0"
font.drawFast(ctx, 33.49, 10, 40);                      // "33.5"  (rounded)
font.drawFast(ctx, score, canvas.width / 2, 60, 1, 1);  // centered
```

## 📦 Wrapped Text (`drawWrapped`)

`drawWrapped` renders multi-line text **into a bounding box** with both horizontal and
vertical alignment, plus an optional ellipsis-on-overflow flag. To stay zero-alloc, it
does not do word-wrapping itself — you hand it a `Float32Array` describing the lines, and
it does the rest. That separation lets you compute the layout once and re-render it every
frame for free.

### Layout buffer format

Each line is **4 consecutive Float32 values**:

| Slot | Meaning |
|------|---------|
| `[0]` | `startIdx` — char index in `text` where this line begins (inclusive) |
| `[1]` | `endIdx` — char index in `text` where this line ends (exclusive) |
| `[2]` | `lineWidth` -- measured pixel width of this line **at the rendered scale** |
| `[3]` | `flags` — `0` = normal line; `1` = append `…` ellipsis after content |

The buffer must hold at least `lineCount * 4` floats; surplus capacity is ignored, so you
can reuse one fat buffer across many strings without reallocating.

### Drawing a layout

```javascript
font.drawWrapped(
  ctx, text, layoutBuffer, lineCount,
  boxWidth, boxHeight, boxX, boxY,
  scale,   // default 1
  align,   // 0 = left,  1 = center, 2 = right
  vAlign   // 0 = top,   1 = middle, 2 = bottom
);
```

`(boxX, boxY)` is the container's **top-left corner**, not a baseline. The renderer
positions line 1's visual top edge at `boxY` when `vAlign=0`.

### Producing the layout

**Ecosystem Companion:** For a zero-GC, kerning-aware word wrapper with truncation/ellipsis support that natively outputs this exact buffer format, see [`@zakkster/lite-text-layout`](https://www.npmjs.com/package/@zakkster/lite-text-layout).

Here is a tiny greedy word-break helper you can drop into your own code — keep one buffer alive and reuse it:

`font.glyphs` (Int16Array, stride 7) and `font.kerning` (Int16Array, 64K flat LUT)
are part of the public surface and are declared in `BitmapFont.d.ts`. The stride is
a cross-package contract; changing it is a major.

```javascript
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

            const advance = font.glyphs[id * 7 + 6];
            const kern = prevId === -1 ? 0 : font.kerning[(prevId << 8) | id];
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

### Ellipsis on overflow

If your layout truncates a line and you want `…` appended, set its `flags` slot to `1`.
The renderer will draw three `'.'` glyphs after the line's content (so make sure `'.'`
is in your atlas).

```javascript
// Line 0 was truncated by your wrap logic — ask the renderer to draw an ellipsis.
layout[3] = 1;
```

## 🧠 Why This Exists

Existing BMFont renderers allocate line arrays and substring objects per draw call.
lite-bmfont uses `charCodeAt()` to index directly into an `Int16Array` glyph table —
7 values per glyph, accessed via `id * 7 + offset`. The 64K kerning LUT trades 128 KB of
memory for O(1) lookup speed.

`drawFast()` extends the same philosophy to numeric output: it converts a `number` to
ASCII char codes inside a pre-allocated `Uint8Array` scratch buffer, never producing a
string. Drawing `value.toFixed(1)` per frame in a HUD allocates a fresh string every
call; `drawFast()` allocates nothing.

`drawWrapped()` extends it again to wrapped paragraphs: the layout (lines, widths,
ellipsis state) is computed once into a `Float32Array` and re-rendered every frame
with zero per-frame work — no `String.split('\n')`, no per-line `substring()`, no
per-frame measurement.

## 📊 Comparison

| Library | Size (gzip) | Allocations | Kerning | Multi-line | Wrap + align | Install |
|---------|------|-------------|---------|------------|----|---------|
| bmfont-text | ~4 KB | Arrays per draw | Slow | Basic | Some | `npm i bmfont-text` |
| msdf-bmfont-xml | ~8 KB | High | Yes | Yes | Yes | `npm i msdf-bmfont-xml` |
| **lite-bmfont** | **~1.3 KB** | **Zero** | **O(1) LUT** | **Yes + alignment** | **Yes (BYO layout)** | **`npm i @zakkster/lite-bmfont`** |

## ⚙️ API

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
inputs (an atlas coord past Int16, a fractional `xadvance`, an id outside
`[0, 256)`) are skipped or truncated silently by default and throw only under
`{ checked: true }`, which reports the exact drift (F-08 detection). Storage is
unchanged in 1.3.0: unchecked output is byte-identical.

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
| What is the total advance of the whole string, newlines included? | `measure(text, scale?)` | `32` |

**`measure` sums across newlines.** It is a total advance, not a layout width.
Centring a multi-line string with `measure` is wrong by the width of every line
that is not the longest -- use `measureWidest`, which is the number `draw`
aligns each line against.

### `measure(text, scale?) → number`
Kerning-aware **total advance** of `text`. **Sums across newlines**:
`measure('AA\nAA')` on an advance-8 font is `32`, not `16`.

Returns **`NaN`** if `text` is not a string, or if `scale` is outside
`(0, Infinity)` -- `NaN`, `0`, a negative, or `Infinity`. Throws after
`destroy()`.

The cross-newline sum is pinned current behaviour, not a feature: 2.0.0 promotes
`measure` to the widest line, with a migration note.

### `measureWidest(text, scale?) -> number`
Width of the **widest line** -- the number to size or centre a box with.
`measureWidest('AA\nAA')` is `16` where `measure` is `32`; for a newline-free
string the two are equal.

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

### `draw(ctx, text, x, y, scale?, align?) → void`
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

### `drawFast(ctx, value, x, y, scale?, align?) → void`
Zero-alloc number renderer with one decimal place.

- `NaN`, `+Infinity`, `-Infinity` → silently skipped (returns).
- `|value| > DRAWFAST_MAX` (`1e21`) → silently skipped (returns); draws nothing.
- Negative values inside the door → clamped to `0` (so `-5` renders `"0.0"`).
- Decimal → rounded to nearest tenth (`33.49 → "33.5"`).
- Requires `'0'`–`'9'` (codes 48–57) and `'.'` (code 46) in the atlas.

Above 2^53 (9007199254740992) the rendered integer digits are approximate -- the
value is scaled through a double before digit extraction. Exact below that. Values
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
`drawFastInt` refuses the range instead of rendering approximate digits, and is
exact by construction for every value it admits.

**Allocation caveat (F-44):** zero-alloc holds only for values below 2^31; larger
values box one HeapNumber per call in the digit loop (`drawFast` has the same
property, routed to a follow-up session).

**Which one do I want?** Counts, scores, coins, seconds -> `drawFastInt`. FPS,
timers, fractional meters -> `drawFast`.

**Contract:** `ctx.drawImage` must not re-enter the font. `drawFast` and
`drawFastInt` share one 24-byte scratch buffer; a re-entrant ctx corrupts the
outer call's digits. True for a `CanvasRenderingContext2D`, not for an arbitrary
object with a `drawImage` method.

### Constants and options

| Name | Value | Meaning |
|------|-------|---------|
| `DRAWFAST_MAX` | `1e21` | largest magnitude `drawFast` renders; outside `[-DRAWFAST_MAX, DRAWFAST_MAX]` it draws nothing (both endpoints inclusive) |
| `DRAWFASTINT_MAX` | `Number.MAX_SAFE_INTEGER` | largest magnitude `drawFastInt` renders; outside `[-DRAWFASTINT_MAX, DRAWFASTINT_MAX]` it draws nothing (both endpoints inclusive). The correctness boundary, not a buffer boundary |
| `opts.missingAdvance` | `0` (default) | xadvance written into every glyph id the descriptor did not cover, so an absent glyph leaves a gap instead of overprinting the next. Opt-in; the default is byte-identical to 1.2.x. Must be finite in `[0, 32767]` or the constructor throws `BitmapFontError` (which is a `RangeError`). Id 10 is never given a missing advance |
| `opts.checked` | `false` (default) | must be a boolean. Opens the lossy validation lane: an atlas coord past Int16, a fractional `xadvance`/`amount`, or an id/kerning key outside `[0, 256)` throws a `BitmapFontError` naming the exact drift instead of being truncated/skipped silently (F-08 detection). Inputs with no correct reading throw in both lanes. Storage is unchanged in 1.3.0; unchecked output is byte-identical |

### `drawWrapped(ctx, text, layoutBuffer, lineCount, boxWidth, boxHeight, x, y, scale?, align?, vAlign?) → void`
Renders a pre-laid-out `Float32Array` of lines into a box. See the **Wrapped Text** section above for buffer format and a layout helper recipe.

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

### `destroy() → void`
Releases the atlas reference and typed arrays.

## 🧪 Benchmark

```
Rendering 1000 characters per frame:
  bmfont-text:  Allocates line arrays per draw
  lite-bmfont:  Zero allocation, charCodeAt() + Int16Array lookup per glyph

Rendering 60 numeric HUD values per frame:
  value.toFixed(1) + draw():  allocates a new String each call
  drawFast(value):            zero allocation — char codes go into a reused Uint8Array

Rendering a 12-line wrapped paragraph at 60 fps:
  ctx.measureText + split('\n'): allocates arrays + TextMetrics each frame
  drawWrapped(layout):           zero allocation — layout buffer is reused
```

## 📦 TypeScript

Full TypeScript declarations included in `BitmapFont.d.ts`. The `Align`, `VAlign`,
`BMFontJson`, `BMFontChar`, `BMFontKerning` and `BitmapFontOptions` types, plus the
`BitmapFontError` class, are exported for downstream typing of layout helpers, JSON
loaders and `catch` blocks.

## 🧪 Testing

`npm test` runs the full `node:test` suite and must report **0 failures**.
`npm run torture` must print exactly `ok` and exit 0. Those two commands are
the gate; absolute test counts are deliberately not published here, because a
count no gate can read drifts silently (F-43). `npm run torture` runs the ten-tier zero-GC gate
(`node --expose-gc test/torture.mjs`) and prints exactly `ok`; the descriptor door
is proven by T3's 50-row abuse matrix and T9's control 10, and the pixel-snap
promise by T5's allocating reference renderer plus two T9 controls that rebuild
the rejected rounding variants and require the numbers to move.

## 📚 LLM-Friendly Documentation

See `llms.txt` for AI-optimized metadata and usage examples.

## 🗒️ Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

MIT
