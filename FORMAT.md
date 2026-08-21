# @zakkster/lite-bmfont binary format

`FORMAT_VERSION = 2`.

This document is the source of truth for the in-memory binary layout a
`BitmapFont` reads and writes. A peer that persists, exchanges or reaches into
these buffers pins `FORMAT_VERSION` and fails closed when it moves. The version
bumps only on a breaking change to any structure below; version `2` is the
C-folded 1/16 fixed-point store introduced in 2.0.0 (decisions/0012 forks 1 and
8). The prior shipped shape (raw Int16 advances, no fixed point) was version 1.

All integer arrays are little-endian `Int16Array` as the host produces them; the
format is defined by the SLOT MEANINGS below, not by a byte serialization.

## Glyph table -- `font.glyphs`, `Int16Array(256 * 7)`

One 7-slot record per character id `0..255`. `GLYPH_STRIDE` (6) is the LAYOUT
buffer stride, NOT this one -- the glyph record is 7 wide. Address a slot as
`glyphs[id * 7 + slot]`:

| slot | field     | units                | decode                          |
|------|-----------|----------------------|---------------------------------|
| 0    | x         | raw Int16 px         | `x * scale`                     |
| 1    | y         | raw Int16 px         | `y * scale`                     |
| 2    | width     | raw Int16 px         | `width * scale`                 |
| 3    | height    | raw Int16 px         | `height * scale`                |
| 4    | xoffset   | raw Int16 px         | `xoffset * scale`               |
| 5    | yoffset   | raw Int16 px         | `yoffset * scale`               |
| 6    | xadvance  | **1/16 fixed point** | `stored * GLYPH_ADVANCE_SCALE`  |

Slots 0-5 are RAW pixel Int16 and are multiplied by `scale` directly. Slot 6 is
the ONLY glyph slot in fixed point: it is stored as `Math.round(xadvance * 16)`
(`GLYPH_ADVANCE_SHIFT = 4`, i.e. `value * 16`, since `16 === 1 << 4`; the store is
`Math.round(value * 16)` and NOT a shift -- a fractional advance cannot be shifted) and recovered as
`stored * GLYPH_ADVANCE_SCALE` where `GLYPH_ADVANCE_SCALE = 0.0625`. In a hot
body the 1/16 is folded into a per-call constant `s16 = scale * 0.0625` and slot
6 is read as `glyphs[id * 7 + 6] * s16`. Routing any of slots 0-5 through `s16`
would shrink that dimension 16x -- do not.

`advanceOf(id)` returns `glyphs[id * 7 + 6] * GLYPH_ADVANCE_SCALE` in pixels.
Valid stored advance range is `[-32768, 32767]`, i.e. `[-2048, 2047.9375]` px.
Id 10 (`\n`) has all seven slots zeroed: it advances 0, kerns 0 and draws nothing.

## Kerning table -- `font.kerning`, `Int16Array(65536)`

A flat 64K lookup keyed by `(first << 8) | second`, where `first` and `second`
are character ids `0..255`. The stored value is the kerning amount in the SAME
1/16 fixed point as slot 6: `Math.round(amount * 16)`, decoded
`stored * GLYPH_ADVANCE_SCALE` (or `* s16` in a hot body). `kernOf(a, b)` returns
the pixel amount. An absent pair reads 0. Any pair naming id 10 is dropped at
construction.

## Coverage bitmap -- `font._mapped`, `Uint32Array(8)`

A 256-bit map, 8 words x 4 bytes = 32 bytes. Bit `id` is set when a descriptor
mapped that id. `hasGlyph(id)` reads it. Coverage is independent of advance: a
mapped glyph may still advance 0.

## Layout buffer -- caller-owned, stride 4

`layoutGlyphs`-adjacent renderers (`drawWrapped`) read `lineCount` consecutive
4-tuples of float:

| slot | field     | meaning                                            |
|------|-----------|----------------------------------------------------|
| 0    | startIdx  | start char index into `text` (inclusive)           |
| 1    | endIdx    | end char index into `text` (exclusive)             |
| 2    | lineWidth | pixel width of this line AT THE RENDERED SCALE      |
| 3    | flags     | bitfield, see below                                |

### Layout flags word (slot 3)

- **bit 0** -- `FLAG_ELLIPSIS`: append "..." after the line's content. Requires
  ASCII '.' (id 46) in the atlas.
- **bits 1-31** -- RESERVED. A set reserved bit is a CALLER ERROR: under
  `{ checked: true }` (the default) `drawWrapped` throws naming the mask; an odd
  `flags` value such as `3` (ellipsis + a reserved bit) throws, it does not
  silently take the ellipsis path. The flags word is read as ToInt32 (`f | 0`),
  so a float like `1.0000001` reads as `1`.

## Glyph-quad buffer -- caller-owned, stride `GLYPH_STRIDE` (6)

`layoutGlyphs` fills, and `drawQuads` blits, one 6-float record per VISIBLE
glyph:

| slot | field | meaning                                            |
|------|-------|----------------------------------------------------|
| 0    | sx    | source x in the atlas (UNSCALED)                   |
| 1    | sy    | source y in the atlas (UNSCALED)                   |
| 2    | sw    | source width (UNSCALED)                            |
| 3    | sh    | source height (UNSCALED)                           |
| 4    | dx    | destination x, ABSOLUTE, `scale` folded in         |
| 5    | dy    | destination y, ABSOLUTE, `scale` folded in         |

The safe buffer upper bound is `text.length * GLYPH_STRIDE`; the exact record
count is the `layoutGlyphs` return value (a zero-size glyph emits no record).

## Version history

- **2** (2.0.0) -- C-folded 1/16 fixed-point advance and kerning (slot 6 +
  kerning table); the reserved-bit close on the layout flags word; `measure`
  returns the widest line. See `decisions/0012-two-oh.md`.
- **1** (<= 1.9.0 published) -- raw Int16 advances, no fixed point. Never carried
  a `FORMAT_VERSION` constant.
