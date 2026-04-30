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
