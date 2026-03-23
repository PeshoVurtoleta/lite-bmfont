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
});
