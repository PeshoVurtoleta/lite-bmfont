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
- ⚡ O(1) kerning lookup via 64K Int16Array LUT
- 📏 Multi-line text with left/center/right alignment
- 📐 `measure()` for text width calculation
- 🔢 `drawFast()` for zero-alloc number rendering (1 decimal place) — perfect for HUDs, scores, timers
- 🧹 Zero allocation during `draw()` and `drawFast()` — no string splitting, no array creation
- 🎯 Pixel-snapped rendering for crisp pixel fonts
- 🪶 < 1.5 KB minified

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

// Draw left-aligned
font.draw(ctx, 'SCORE: 1000', 10, 30);

// Draw centered (align: 0=left, 1=center, 2=right)
font.draw(ctx, 'GAME OVER', canvas.width / 2, 200, 2.0, 1);

// Measure width
const w = font.measure('Hello', 1.5);

// Zero-alloc number drawing — ideal for per-frame HUDs (FPS counters, timers, scores)
font.drawFast(ctx, fps,    10, 20);            // "60.0"
font.drawFast(ctx, 33.49,  10, 40);            // "33.5"  (rounded)
font.drawFast(ctx, score,  canvas.width / 2, 60, 1, 1); // centered
```

## 🧠 Why This Exists

Existing BMFont renderers allocate line arrays and substring objects per draw call. lite-bmfont uses `charCodeAt()` to index directly into an Int16Array glyph table — 7 values per glyph, accessed via `id * 7 + offset`. The 64K kerning LUT trades 128KB of memory for O(1) lookup speed.

`drawFast()` extends the same philosophy to numeric output: it converts a `number` to ASCII char codes inside a pre-allocated `Uint8Array` scratch buffer, never producing a string. Drawing `value.toFixed(1)` per frame in a HUD allocates a fresh string every call; `drawFast()` allocates nothing.

## 📊 Comparison

| Library | Size | Allocations | Kerning | Multi-line | Install |
|---------|------|-------------|---------|------------|---------|
| bmfont-text | ~4 KB | Arrays per draw | Slow | Basic | `npm i bmfont-text` |
| msdf-bmfont-xml | ~8 KB | High | Yes | Yes | `npm i msdf-bmfont-xml` |
| **lite-bmfont** | **< 1.5 KB** | **Zero** | **O(1) LUT** | **Yes + alignment** | **`npm i @zakkster/lite-bmfont`** |

## ⚙️ API

### `new BitmapFont(imageAtlas, fontJson)`
- `imageAtlas`: Loaded `HTMLImageElement` or `HTMLCanvasElement`
- `fontJson`: Standard BMFont JSON with `common`, `chars`, and optional `kernings`

### `measure(text, scale?)` — Returns pixel width

### `draw(ctx, text, x, y, scale?, align?)`
Renders text to canvas. Align: `0`=left, `1`=center, `2`=right.

### `drawFast(ctx, value, x, y, scale?, align?)`
Zero-alloc number renderer. Draws `value` with one decimal place (e.g. `33.4`).

- `NaN`, `+Infinity`, `-Infinity` → silently skipped (returns).
- Negative values → clamped to `0`.
- Decimal → rounded to nearest tenth (`33.49 → "33.5"`).
- Requires the font atlas to contain glyphs for `'0'`–`'9'` (codes 48–57) and `'.'` (code 46).
- Align: `0`=left, `1`=center, `2`=right.

### `destroy()`
Releases the atlas reference and typed arrays.

## 🧪 Benchmark

```
Rendering 1000 characters per frame:
  bmfont-text:  Allocates line arrays per draw
  lite-bmfont:  Zero allocation, charCodeAt() + Int16Array lookup per glyph

Rendering 60 numeric HUD values per frame:
  value.toFixed(1) + draw(): allocates a new String each call
  drawFast(value):           zero allocation — char codes go into a reused Uint8Array
```

## 📦 TypeScript

Full TypeScript declarations included in `BitmapFont.d.ts`.

## 📚 LLM-Friendly Documentation

See `llms.txt` for AI-optimized metadata and usage examples.

## 🗒️ Changelog

### 1.1.0
- **Added:** `drawFast(ctx, value, x, y, scale?, align?)` — zero-alloc number renderer with one decimal place. Built for per-frame HUD output (FPS, score, time) without producing GC pressure.
- **Internal:** scratch buffer for `drawFast` is allocated once in the constructor and released by `destroy()`.

### 1.0.x
- Initial release: `draw`, `measure`, multi-line alignment, O(1) kerning LUT.

## License

MIT
