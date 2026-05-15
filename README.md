# @zakkster/lite-bmfont

[![npm version](https://img.shields.io/npm/v/@zakkster/lite-bmfont.svg?style=for-the-badge&color=latest)](https://www.npmjs.com/package/@zakkster/lite-bmfont)
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
| `[2]` | `lineWidth` — measured pixel width of this line **at `scale=1`** |
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

### `new BitmapFont(imageAtlas, fontJson)`
- `imageAtlas`: loaded `HTMLImageElement` or `HTMLCanvasElement`
- `fontJson`: standard BMFont JSON with `common`, `chars`, and optional `kernings`

### `measure(text, scale?) → number`
Returns kerning-aware pixel width.

### `draw(ctx, text, x, y, scale?, align?) → void`
Multi-line `\n`-aware renderer. `align`: `0` = left, `1` = center, `2` = right.
`x, y` is the **baseline anchor** of the first line.

### `drawFast(ctx, value, x, y, scale?, align?) → void`
Zero-alloc number renderer with one decimal place.

- `NaN`, `+Infinity`, `-Infinity` → silently skipped (returns).
- Negative values → clamped to `0`.
- Decimal → rounded to nearest tenth (`33.49 → "33.5"`).
- Requires `'0'`–`'9'` (codes 48–57) and `'.'` (code 46) in the atlas.

### `drawWrapped(ctx, text, layoutBuffer, lineCount, boxWidth, boxHeight, x, y, scale?, align?, vAlign?) → void`
Renders a pre-laid-out `Float32Array` of lines into a box. See the **Wrapped Text** section above for buffer format and a layout helper recipe.

- `x, y` is the box's **top-left corner**.
- `align`: `0` = left, `1` = center, `2` = right.
- `vAlign`: `0` = top, `1` = middle, `2` = bottom.
- A line with `flags === 1` is rendered followed by an `…` ellipsis.

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
`BMFontJson`, `BMFontChar`, and `BMFontKerning` types are also exported for downstream
typing of layout helpers and JSON loaders.

## 📚 LLM-Friendly Documentation

See `llms.txt` for AI-optimized metadata and usage examples.

## 🗒️ Changelog

### 1.2.0
- **Added:** `drawWrapped(ctx, text, layoutBuffer, lineCount, boxWidth, boxHeight, x, y, scale?, align?, vAlign?)` — renders pre-laid-out wrapped text into a bounding box with horizontal **and** vertical alignment, plus an optional `…` ellipsis flag per line. Layout consumed as a `Float32Array` for zero per-frame allocation.
- **Added:** Exported types `Align`, `VAlign`, `BMFontJson`, `BMFontChar`, `BMFontKerning` from `BitmapFont.d.ts`.

### 1.1.0
- **Added:** `drawFast(ctx, value, x, y, scale?, align?)` — zero-alloc number renderer with one decimal place. Built for per-frame HUD output (FPS, score, time) without producing GC pressure.
- **Internal:** scratch buffer for `drawFast` is allocated once in the constructor and released by `destroy()`.

### 1.0.x
- Initial release: `draw`, `measure`, multi-line alignment, O(1) kerning LUT.

## License

MIT
