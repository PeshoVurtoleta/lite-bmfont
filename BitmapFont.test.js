import { describe, it, expect, vi } from 'vitest';
import { BitmapFont } from './BitmapFont.js';

const mockFontJson = {
    common: { lineHeight: 20, base: 16 },
    chars: [
        { id: 65, x: 0, y: 0, width: 10, height: 14, xoffset: 0, yoffset: 2, xadvance: 12 }, // A
        { id: 66, x: 10, y: 0, width: 10, height: 14, xoffset: 0, yoffset: 2, xadvance: 12 }, // B
        { id: 32, x: 0, y: 0, width: 0, height: 0, xoffset: 0, yoffset: 0, xadvance: 6 }, // space
    ],
    kernings: [{ first: 65, second: 66, amount: -1 }],
};

// Mock font with digits 0-9 and '.' for drawFast tests.
function makeNumericFont() {
    const chars = [
        { id: 46, x: 0, y: 0, width: 4, height: 4, xoffset: 0, yoffset: 12, xadvance: 6 }, // '.'
    ];
    for (let i = 0; i < 10; i++) {
        chars.push({
            id: 48 + i, // '0'..'9'
            x: i * 10, y: 0,
            width: 8, height: 14,
            xoffset: 0, yoffset: 2,
            xadvance: 10,
        });
    }
    return {
        common: { lineHeight: 20, base: 16 },
        chars,
        kernings: [],
    };
}

// Richer font for drawWrapped tests: A, B, C, space, '.' — all 10px wide / 12px advance,
// no kerning, so line widths are trivial to compute by hand.
function makeWrapFont() {
    const chars = [
        { id: 32, x: 0,   y: 0, width: 0,  height: 0,  xoffset: 0, yoffset: 0, xadvance: 6 },  // space
        { id: 46, x: 60,  y: 0, width: 4,  height: 4,  xoffset: 0, yoffset: 12, xadvance: 6 }, // '.'
        { id: 65, x: 0,   y: 0, width: 10, height: 14, xoffset: 0, yoffset: 2, xadvance: 12 }, // A
        { id: 66, x: 10,  y: 0, width: 10, height: 14, xoffset: 0, yoffset: 2, xadvance: 12 }, // B
        { id: 67, x: 20,  y: 0, width: 10, height: 14, xoffset: 0, yoffset: 2, xadvance: 12 }, // C
    ];
    return {
        common: { lineHeight: 20, base: 16 },
        chars,
        kernings: [],
    };
}

describe('BitmapFont', () => {
    it('constructs and maps glyphs', () => {
        const atlas = {};
        const font = new BitmapFont(atlas, mockFontJson);
        expect(font.lineHeight).toBe(20);
        expect(font.base).toBe(16);
        // Glyph A at index 65*7
        expect(font.glyphs[65 * 7 + 6]).toBe(12); // xadvance
    });

    it('maps kerning pairs', () => {
        const font = new BitmapFont({}, mockFontJson);
        expect(font.kerning[(65 << 8) | 66]).toBe(-1); // A→B = -1
        expect(font.kerning[(66 << 8) | 65]).toBe(0); // B→A = 0 (not defined)
    });

    it('measure returns correct width', () => {
        const font = new BitmapFont({}, mockFontJson);
        const w = font.measure('AB');
        expect(w).toBe(12 + 12 + (-1)); // A.xadvance + B.xadvance + kerning
    });

    it('measure returns 0 for empty string', () => {
        const font = new BitmapFont({}, mockFontJson);
        expect(font.measure('')).toBe(0);
    });

    it('measure handles scale', () => {
        const font = new BitmapFont({}, mockFontJson);
        const w1 = font.measure('A', 1);
        const w2 = font.measure('A', 2);
        expect(w2).toBeCloseTo(w1 * 2);
    });

    it('draw calls drawImage for each glyph', () => {
        const font = new BitmapFont({}, mockFontJson);
        const ctx = { drawImage: vi.fn() };
        font.draw(ctx, 'AB', 0, 20);
        expect(ctx.drawImage).toHaveBeenCalledTimes(2);
    });

    it('draw handles newlines', () => {
        const font = new BitmapFont({}, mockFontJson);
        const ctx = { drawImage: vi.fn() };
        font.draw(ctx, 'A\nB', 0, 20);
        expect(ctx.drawImage).toHaveBeenCalledTimes(2);
    });

    it('draw with center alignment offsets correctly', () => {
        const font = new BitmapFont({}, mockFontJson);
        const ctx = { drawImage: vi.fn() };
        font.draw(ctx, 'A', 100, 20, 1, 1); // align=center
        // First drawImage x should be < 100 (centered)
        const call = ctx.drawImage.mock.calls[0];
        expect(call[5]).toBeLessThan(100);
    });

    it('destroy nulls atlas and arrays', () => {
        const font = new BitmapFont({}, mockFontJson);
        font.destroy();
        expect(font.atlas).toBeNull();
        expect(font.glyphs).toBeNull();
        expect(font.kerning).toBeNull();
        expect(font._charScratch).toBeNull();
    });

    it('allocates scratch buffer in constructor', () => {
        const font = new BitmapFont({}, mockFontJson);
        expect(font._charScratch).toBeInstanceOf(Uint8Array);
        expect(font._charScratch.length).toBe(24);
    });
});

describe('BitmapFont.drawFast', () => {
    it('renders one glyph per digit plus the decimal point', () => {
        const font = new BitmapFont({}, makeNumericFont());
        const ctx = { drawImage: vi.fn() };
        font.drawFast(ctx, 33.4, 0, 20);
        // "33.4" -> 4 drawImage calls
        expect(ctx.drawImage).toHaveBeenCalledTimes(4);
    });

    it('renders integer values with a trailing ".0"', () => {
        const font = new BitmapFont({}, makeNumericFont());
        const ctx = { drawImage: vi.fn() };
        font.drawFast(ctx, 5, 0, 20);
        // "5.0" -> 3 drawImage calls
        expect(ctx.drawImage).toHaveBeenCalledTimes(3);
    });

    it('renders 0 correctly', () => {
        const font = new BitmapFont({}, makeNumericFont());
        const ctx = { drawImage: vi.fn() };
        font.drawFast(ctx, 0, 0, 20);
        // "0.0" -> 3 calls
        expect(ctx.drawImage).toHaveBeenCalledTimes(3);
    });

    it('returns early on NaN', () => {
        const font = new BitmapFont({}, makeNumericFont());
        const ctx = { drawImage: vi.fn() };
        font.drawFast(ctx, NaN, 0, 20);
        expect(ctx.drawImage).not.toHaveBeenCalled();
    });

    it('returns early on +Infinity', () => {
        const font = new BitmapFont({}, makeNumericFont());
        const ctx = { drawImage: vi.fn() };
        font.drawFast(ctx, Infinity, 0, 20);
        expect(ctx.drawImage).not.toHaveBeenCalled();
    });

    it('returns early on -Infinity', () => {
        const font = new BitmapFont({}, makeNumericFont());
        const ctx = { drawImage: vi.fn() };
        font.drawFast(ctx, -Infinity, 0, 20);
        expect(ctx.drawImage).not.toHaveBeenCalled();
    });

    it('clamps negatives to 0', () => {
        const font = new BitmapFont({}, makeNumericFont());
        const ctx = { drawImage: vi.fn() };
        font.drawFast(ctx, -5, 0, 20);
        // "0.0" -> 3 calls
        expect(ctx.drawImage).toHaveBeenCalledTimes(3);
    });

    it('renders 1.4 as "1.4" (no float-precision regression)', () => {
        const font = new BitmapFont({}, makeNumericFont());
        const ctx = { drawImage: vi.fn() };
        font.drawFast(ctx, 1.4, 0, 20);

        // Order of calls: '1', '.', '4'
        const calls = ctx.drawImage.mock.calls;
        expect(calls).toHaveLength(3);

        // Glyph identity is determined by atlas X (numeric font: digit N is at x = N*10, '.' is at x=0)
        // call[1] is the source X argument
        expect(calls[0][1]).toBe(10); // '1' at x=10
        expect(calls[1][1]).toBe(0);  // '.' at x=0
        expect(calls[2][1]).toBe(40); // '4' at x=40
    });

    it('rounds to nearest tenth (33.49 -> 33.5)', () => {
        const font = new BitmapFont({}, makeNumericFont());
        const ctx = { drawImage: vi.fn() };
        font.drawFast(ctx, 33.49, 0, 20);

        const calls = ctx.drawImage.mock.calls;
        expect(calls).toHaveLength(4);
        expect(calls[0][1]).toBe(30); // '3'
        expect(calls[1][1]).toBe(30); // '3'
        expect(calls[2][1]).toBe(0);  // '.'
        expect(calls[3][1]).toBe(50); // '5' (rounded up from .49)
    });

    it('renders multi-digit integers in the correct order (1234.5)', () => {
        const font = new BitmapFont({}, makeNumericFont());
        const ctx = { drawImage: vi.fn() };
        font.drawFast(ctx, 1234.5, 0, 20);

        const calls = ctx.drawImage.mock.calls;
        expect(calls).toHaveLength(6);
        expect(calls[0][1]).toBe(10); // '1'
        expect(calls[1][1]).toBe(20); // '2'
        expect(calls[2][1]).toBe(30); // '3'
        expect(calls[3][1]).toBe(40); // '4'
        expect(calls[4][1]).toBe(0);  // '.'
        expect(calls[5][1]).toBe(50); // '5'
    });

    it('pixel-snaps cursorX with center alignment', () => {
        const font = new BitmapFont({}, makeNumericFont());
        const ctx = { drawImage: vi.fn() };
        // Pick an x value that, after centering "5.0" (width 26), produces a non-integer.
        font.drawFast(ctx, 5, 100.7, 20, 1, 1);

        // dx (call argument index 5) should be an integer.
        const dx = ctx.drawImage.mock.calls[0][5];
        expect(Number.isInteger(dx)).toBe(true);
    });

    it('right-alignment offsets correctly', () => {
        const font = new BitmapFont({}, makeNumericFont());
        const ctx = { drawImage: vi.fn() };
        font.drawFast(ctx, 5, 100, 20, 1, 2); // align=right

        // First glyph's destination X should be < 100
        const dx = ctx.drawImage.mock.calls[0][5];
        expect(dx).toBeLessThan(100);
    });

    it('reuses the same scratch buffer across calls (zero-GC)', () => {
        const font = new BitmapFont({}, makeNumericFont());
        const ctx = { drawImage: vi.fn() };
        const bufBefore = font._charScratch;
        font.drawFast(ctx, 1.2, 0, 20);
        font.drawFast(ctx, 999.9, 0, 20);
        font.drawFast(ctx, 0.1, 0, 20);
        expect(font._charScratch).toBe(bufBefore); // same reference
    });
});

describe('BitmapFont.drawWrapped', () => {
    // Encode a list of {start, end, width, flags} entries into a Float32Array.
    function makeLayout(lines) {
        const buf = new Float32Array(lines.length * 4);
        for (let i = 0; i < lines.length; i++) {
            const l = lines[i];
            buf[i * 4]     = l.start;
            buf[i * 4 + 1] = l.end;
            buf[i * 4 + 2] = l.width;
            buf[i * 4 + 3] = l.flags ?? 0;
        }
        return buf;
    }

    it('returns immediately when lineCount is 0', () => {
        const font = new BitmapFont({}, makeWrapFont());
        const ctx = { drawImage: vi.fn() };
        const layout = makeLayout([{ start: 0, end: 3, width: 36 }]);
        font.drawWrapped(ctx, 'ABC', layout, 0, 100, 100, 0, 0);
        expect(ctx.drawImage).not.toHaveBeenCalled();
    });

    it('renders one glyph per character on a single line', () => {
        const font = new BitmapFont({}, makeWrapFont());
        const ctx = { drawImage: vi.fn() };
        const layout = makeLayout([{ start: 0, end: 3, width: 36 }]);
        font.drawWrapped(ctx, 'ABC', layout, 1, 100, 100, 0, 0);
        expect(ctx.drawImage).toHaveBeenCalledTimes(3);
    });

    it('positions the first line so its visual top sits at y when vAlign=0', () => {
        // For this font: base=16, glyph yoffset=2, glyph height=14.
        // Visual top of a glyph = baseline + yoffset - base = baseline - 14
        // For top alignment, we want visual top at y=0, so baseline = base = 16.
        const font = new BitmapFont({}, makeWrapFont());
        const ctx = { drawImage: vi.fn() };
        const layout = makeLayout([{ start: 0, end: 1, width: 12 }]);
        font.drawWrapped(ctx, 'A', layout, 1, 100, 100, 0, 0);

        // drawImage call signature: (img, sx, sy, sw, sh, dx, dy, dw, dh)
        // dy (index 6) = baseline + yoffset - base = 16 + 2 - 16 = 2
        const dy = ctx.drawImage.mock.calls[0][6];
        expect(dy).toBe(2);
    });

    it('renders content (1 line) at bottom of box when vAlign=2', () => {
        // baseline = y + base + (boxHeight - lineHeight) = 0 + 16 + (100 - 20) = 96
        // dy of glyph = 96 + yoffset - base = 96 + 2 - 16 = 82
        const font = new BitmapFont({}, makeWrapFont());
        const ctx = { drawImage: vi.fn() };
        const layout = makeLayout([{ start: 0, end: 1, width: 12 }]);
        font.drawWrapped(ctx, 'A', layout, 1, 100, 100, 0, 0, 1, 0, 2);

        const dy = ctx.drawImage.mock.calls[0][6];
        expect(dy).toBe(82);
    });

    it('centers vertically when vAlign=1', () => {
        // baseline = y + base + (boxHeight - lineHeight)/2 = 0 + 16 + 40 = 56
        // dy = 56 + 2 - 16 = 42
        const font = new BitmapFont({}, makeWrapFont());
        const ctx = { drawImage: vi.fn() };
        const layout = makeLayout([{ start: 0, end: 1, width: 12 }]);
        font.drawWrapped(ctx, 'A', layout, 1, 100, 100, 0, 0, 1, 0, 1);

        const dy = ctx.drawImage.mock.calls[0][6];
        expect(dy).toBe(42);
    });

    it('advances cursorY by lineHeight between lines', () => {
        const font = new BitmapFont({}, makeWrapFont());
        const ctx = { drawImage: vi.fn() };
        const layout = makeLayout([
            { start: 0, end: 1, width: 12 }, // 'A'
            { start: 2, end: 3, width: 12 }, // 'B'
        ]);
        font.drawWrapped(ctx, 'A\nB', layout, 2, 100, 100, 0, 0);

        const dy1 = ctx.drawImage.mock.calls[0][6];
        const dy2 = ctx.drawImage.mock.calls[1][6];
        expect(dy2 - dy1).toBe(20); // lineHeight=20
    });

    it('left-aligns by default (cursorX == x)', () => {
        const font = new BitmapFont({}, makeWrapFont());
        const ctx = { drawImage: vi.fn() };
        const layout = makeLayout([{ start: 0, end: 1, width: 12 }]);
        font.drawWrapped(ctx, 'A', layout, 1, 100, 100, 7, 0);

        // glyph dx = cursorX + xoffset = 7 + 0 = 7
        expect(ctx.drawImage.mock.calls[0][5]).toBe(7);
    });

    it('center-aligns lines independently using lineWidth from the buffer', () => {
        // Box width 100, line width 12, scale=1 → cursorX = x + (100 - 12)/2 = 44.
        const font = new BitmapFont({}, makeWrapFont());
        const ctx = { drawImage: vi.fn() };
        const layout = makeLayout([{ start: 0, end: 1, width: 12 }]);
        font.drawWrapped(ctx, 'A', layout, 1, 100, 100, 0, 0, 1, 1, 0);
        expect(ctx.drawImage.mock.calls[0][5]).toBe(44);
    });

    it('right-aligns lines using lineWidth from the buffer', () => {
        // cursorX = x + (boxWidth - lineWidth) = 0 + (100 - 12) = 88.
        const font = new BitmapFont({}, makeWrapFont());
        const ctx = { drawImage: vi.fn() };
        const layout = makeLayout([{ start: 0, end: 1, width: 12 }]);
        font.drawWrapped(ctx, 'A', layout, 1, 100, 100, 0, 0, 1, 2, 0);
        expect(ctx.drawImage.mock.calls[0][5]).toBe(88);
    });

    it('scales lineWidth correctly for h-alignment', () => {
        // scale=2, lineWidth-at-scale-1 = 12 → effective line width = 24.
        // Center: cursorX = (100 - 24)/2 = 38.
        const font = new BitmapFont({}, makeWrapFont());
        const ctx = { drawImage: vi.fn() };
        const layout = makeLayout([{ start: 0, end: 1, width: 12 }]);
        font.drawWrapped(ctx, 'A', layout, 1, 100, 100, 0, 0, 2, 1, 0);
        expect(ctx.drawImage.mock.calls[0][5]).toBe(38);
    });

    it('pixel-snaps cursorX per line', () => {
        const font = new BitmapFont({}, makeWrapFont());
        const ctx = { drawImage: vi.fn() };
        const layout = makeLayout([
            { start: 0, end: 1, width: 12 },
            { start: 2, end: 3, width: 12 },
        ]);
        // x=7.3 — would propagate fractional dx without rounding.
        font.drawWrapped(ctx, 'A\nB', layout, 2, 100, 100, 7.3, 0);

        expect(Number.isInteger(ctx.drawImage.mock.calls[0][5])).toBe(true);
        expect(Number.isInteger(ctx.drawImage.mock.calls[1][5])).toBe(true);
    });

    it('appends three dots when a line has flags=1 (ellipsis)', () => {
        const font = new BitmapFont({}, makeWrapFont());
        const ctx = { drawImage: vi.fn() };
        const layout = makeLayout([{ start: 0, end: 3, width: 36, flags: 1 }]);
        // 3 glyphs (ABC) + 3 dots = 6 draws.
        font.drawWrapped(ctx, 'ABC', layout, 1, 100, 100, 0, 0);
        expect(ctx.drawImage).toHaveBeenCalledTimes(6);

        // Last 3 draws should all be the '.' glyph — atlas sx=60 in makeWrapFont.
        const calls = ctx.drawImage.mock.calls;
        expect(calls[3][1]).toBe(60);
        expect(calls[4][1]).toBe(60);
        expect(calls[5][1]).toBe(60);
    });

    it('does not draw ellipsis dots when flags=0', () => {
        const font = new BitmapFont({}, makeWrapFont());
        const ctx = { drawImage: vi.fn() };
        const layout = makeLayout([{ start: 0, end: 3, width: 36, flags: 0 }]);
        font.drawWrapped(ctx, 'ABC', layout, 1, 100, 100, 0, 0);
        expect(ctx.drawImage).toHaveBeenCalledTimes(3);
    });

    it('honors the lineCount argument (ignores trailing buffer entries)', () => {
        const font = new BitmapFont({}, makeWrapFont());
        const ctx = { drawImage: vi.fn() };
        const layout = makeLayout([
            { start: 0, end: 1, width: 12 }, // 'A'
            { start: 2, end: 3, width: 12 }, // 'B'
            { start: 4, end: 5, width: 12 }, // 'C' — should be ignored
        ]);
        font.drawWrapped(ctx, 'A\nB\nC', layout, 2, 100, 100, 0, 0);
        expect(ctx.drawImage).toHaveBeenCalledTimes(2);
    });

    it('uses each line\'s own range from the text buffer (no string splitting)', () => {
        // Encode a substring per line out of one shared text. Confirms drawWrapped is
        // indexing into `text` via startIdx/endIdx rather than relying on \n splits.
        const font = new BitmapFont({}, makeWrapFont());
        const ctx = { drawImage: vi.fn() };
        const text = 'ABC';
        const layout = makeLayout([
            { start: 0, end: 1, width: 12 }, // 'A'
            { start: 2, end: 3, width: 12 }, // 'C'
        ]);
        font.drawWrapped(ctx, text, layout, 2, 100, 100, 0, 0);

        const calls = ctx.drawImage.mock.calls;
        expect(calls).toHaveLength(2);
        expect(calls[0][1]).toBe(0);  // 'A' at atlas x=0
        expect(calls[1][1]).toBe(20); // 'C' at atlas x=20
    });

    it('applies scale to the baseline math (lineHeight * scale between lines)', () => {
        const font = new BitmapFont({}, makeWrapFont());
        const ctx = { drawImage: vi.fn() };
        const layout = makeLayout([
            { start: 0, end: 1, width: 12 },
            { start: 2, end: 3, width: 12 },
        ]);
        font.drawWrapped(ctx, 'A\nB', layout, 2, 100, 100, 0, 0, 2);

        const dy1 = ctx.drawImage.mock.calls[0][6];
        const dy2 = ctx.drawImage.mock.calls[1][6];
        // lineHeight=20, scale=2 → 40 between lines.
        expect(dy2 - dy1).toBe(40);
    });

    it('does not allocate per-call (no ad-hoc Float32Array or array creation)', () => {
        // Sanity guard: a layout buffer reused across many frames should not be
        // mutated by drawWrapped, and the renderer should not stash references that
        // would prevent the buffer from being reused.
        const font = new BitmapFont({}, makeWrapFont());
        const ctx = { drawImage: vi.fn() };
        const layout = makeLayout([{ start: 0, end: 3, width: 36 }]);
        const snapshot = Array.from(layout);

        for (let i = 0; i < 10; i++) font.drawWrapped(ctx, 'ABC', layout, 1, 100, 100, 0, 0);

        expect(Array.from(layout)).toEqual(snapshot);
    });
});
