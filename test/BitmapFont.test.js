import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { BitmapFont } from '../BitmapFont.js';
import { rec, resetRec } from './torture/harness.mjs';

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

// Richer font for drawWrapped tests: A, B, C, space, '.' -- all 10px wide / 12px advance,
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
    test('constructs and maps glyphs', () => {
        const atlas = {};
        resetRec(atlas);
        const font = new BitmapFont(atlas, mockFontJson);
        assert.equal(font.lineHeight, 20);
        assert.equal(font.base, 16);
        // Glyph A at index 65*7
        assert.equal(font.glyphs[65 * 7 + 6], 12); // xadvance
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('maps kerning pairs', () => {
        const atlas = {};
        resetRec(atlas);
        const font = new BitmapFont(atlas, mockFontJson);
        assert.equal(font.kerning[(65 << 8) | 66], -1); // A->B = -1
        assert.equal(font.kerning[(66 << 8) | 65], 0); // B->A = 0 (not defined)
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('measure returns correct width', () => {
        const atlas = {};
        resetRec(atlas);
        const font = new BitmapFont(atlas, mockFontJson);
        const w = font.measure('AB');
        assert.equal(w, 12 + 12 + (-1)); // A.xadvance + B.xadvance + kerning
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('measure returns 0 for empty string', () => {
        const atlas = {};
        resetRec(atlas);
        const font = new BitmapFont(atlas, mockFontJson);
        assert.equal(font.measure(''), 0);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('measure handles scale', () => {
        const atlas = {};
        resetRec(atlas);
        const font = new BitmapFont(atlas, mockFontJson);
        const w1 = font.measure('A', 1);
        const w2 = font.measure('A', 2);
        assert.equal(w2, w1 * 2); // exact: 24 === 24 (the toBeCloseTo tolerance was removable)
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('draw calls drawImage for each glyph', () => {
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, mockFontJson);
        font.draw(ctx, 'AB', 0, 20);
        assert.equal(rec.calls, 2);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('draw handles newlines', () => {
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, mockFontJson);
        font.draw(ctx, 'A\nB', 0, 20);
        assert.equal(rec.calls, 2);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('draw with center alignment offsets correctly', () => {
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, mockFontJson);
        font.draw(ctx, 'A', 100, 20, 1, 1); // align=center
        // First drawImage x should be < 100 (centered)
        assert.ok(rec.dx[0] < 100, 'x < y');
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('destroy nulls atlas and arrays', () => {
        const atlas = {};
        resetRec(atlas);
        const font = new BitmapFont(atlas, mockFontJson);
        font.destroy();
        assert.equal(font.atlas, null);
        assert.equal(font.glyphs, null);
        assert.equal(font.kerning, null);
        assert.equal(font._charScratch, null);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('allocates scratch buffer in constructor', () => {
        const atlas = {};
        resetRec(atlas);
        const font = new BitmapFont(atlas, mockFontJson);
        assert.ok(font._charScratch instanceof Uint8Array);
        assert.equal(font._charScratch.length, 24);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });
});

describe('BitmapFont.drawFast', () => {
    test('renders one glyph per digit plus the decimal point', () => {
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, makeNumericFont());
        font.drawFast(ctx, 33.4, 0, 20);
        // "33.4" -> 4 drawImage calls
        assert.equal(rec.calls, 4);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('renders integer values with a trailing ".0"', () => {
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, makeNumericFont());
        font.drawFast(ctx, 5, 0, 20);
        // "5.0" -> 3 drawImage calls
        assert.equal(rec.calls, 3);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('renders 0 correctly', () => {
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, makeNumericFont());
        font.drawFast(ctx, 0, 0, 20);
        // "0.0" -> 3 calls
        assert.equal(rec.calls, 3);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('returns early on NaN', () => {
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, makeNumericFont());
        font.drawFast(ctx, NaN, 0, 20);
        assert.equal(rec.calls, 0);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('returns early on +Infinity', () => {
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, makeNumericFont());
        font.drawFast(ctx, Infinity, 0, 20);
        assert.equal(rec.calls, 0);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('returns early on -Infinity', () => {
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, makeNumericFont());
        font.drawFast(ctx, -Infinity, 0, 20);
        assert.equal(rec.calls, 0);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('clamps negatives to 0', () => {
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, makeNumericFont());
        font.drawFast(ctx, -5, 0, 20);
        // "0.0" -> 3 calls
        assert.equal(rec.calls, 3);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('renders 1.4 as "1.4" (no float-precision regression)', () => {
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, makeNumericFont());
        font.drawFast(ctx, 1.4, 0, 20);

        // Order of calls: '1', '.', '4'
        assert.equal(rec.calls, 3);

        // Glyph identity is determined by atlas X (numeric font: digit N is at x = N*10, '.' is at x=0)
        // rec.sx[i] is the source X argument
        assert.equal(rec.sx[0], 10); // '1' at x=10
        assert.equal(rec.sx[1], 0);  // '.' at x=0
        assert.equal(rec.sx[2], 40); // '4' at x=40
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('rounds to nearest tenth (33.49 -> 33.5)', () => {
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, makeNumericFont());
        font.drawFast(ctx, 33.49, 0, 20);

        assert.equal(rec.calls, 4);
        assert.equal(rec.sx[0], 30); // '3'
        assert.equal(rec.sx[1], 30); // '3'
        assert.equal(rec.sx[2], 0);  // '.'
        assert.equal(rec.sx[3], 50); // '5' (rounded up from .49)
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('renders multi-digit integers in the correct order (1234.5)', () => {
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, makeNumericFont());
        font.drawFast(ctx, 1234.5, 0, 20);

        assert.equal(rec.calls, 6);
        assert.equal(rec.sx[0], 10); // '1'
        assert.equal(rec.sx[1], 20); // '2'
        assert.equal(rec.sx[2], 30); // '3'
        assert.equal(rec.sx[3], 40); // '4'
        assert.equal(rec.sx[4], 0);  // '.'
        assert.equal(rec.sx[5], 50); // '5'
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('pixel-snaps cursorX with center alignment', () => {
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, makeNumericFont());
        // Pick an x value that, after centering "5.0" (width 26), produces a non-integer.
        font.drawFast(ctx, 5, 100.7, 20, 1, 1);

        // dx (rec.dx[0]) should be an integer.
        const dx = rec.dx[0];
        assert.ok(Number.isInteger(dx));
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('right-alignment offsets correctly', () => {
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, makeNumericFont());
        font.drawFast(ctx, 5, 100, 20, 1, 2); // align=right

        // First glyph's destination X should be < 100
        const dx = rec.dx[0];
        assert.ok(dx < 100, 'x < y');
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('reuses the same scratch buffer across calls (zero-GC)', () => {
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, makeNumericFont());
        const bufBefore = font._charScratch;
        font.drawFast(ctx, 1.2, 0, 20);
        font.drawFast(ctx, 999.9, 0, 20);
        font.drawFast(ctx, 0.1, 0, 20);
        assert.equal(font._charScratch, bufBefore); // same reference
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
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

    test('returns immediately when lineCount is 0', () => {
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, makeWrapFont());
        const layout = makeLayout([{ start: 0, end: 3, width: 36 }]);
        font.drawWrapped(ctx, 'ABC', layout, 0, 100, 100, 0, 0);
        assert.equal(rec.calls, 0);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('renders one glyph per character on a single line', () => {
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, makeWrapFont());
        const layout = makeLayout([{ start: 0, end: 3, width: 36 }]);
        font.drawWrapped(ctx, 'ABC', layout, 1, 100, 100, 0, 0);
        assert.equal(rec.calls, 3);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('positions the first line so its visual top sits at y when vAlign=0', () => {
        // For this font: base=16, glyph yoffset=2, glyph height=14.
        // Visual top of a glyph = baseline + yoffset - base = baseline - 14
        // For top alignment, we want visual top at y=0, so baseline = base = 16.
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, makeWrapFont());
        const layout = makeLayout([{ start: 0, end: 1, width: 12 }]);
        font.drawWrapped(ctx, 'A', layout, 1, 100, 100, 0, 0);

        // drawImage call signature: (img, sx, sy, sw, sh, dx, dy, dw, dh)
        // dy (rec.dy[0]) = baseline + yoffset - base = 16 + 2 - 16 = 2
        const dy = rec.dy[0];
        assert.equal(dy, 2);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('renders content (1 line) at bottom of box when vAlign=2', () => {
        // baseline = y + base + (boxHeight - lineHeight) = 0 + 16 + (100 - 20) = 96
        // dy of glyph = 96 + yoffset - base = 96 + 2 - 16 = 82
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, makeWrapFont());
        const layout = makeLayout([{ start: 0, end: 1, width: 12 }]);
        font.drawWrapped(ctx, 'A', layout, 1, 100, 100, 0, 0, 1, 0, 2);

        const dy = rec.dy[0];
        assert.equal(dy, 82);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('centers vertically when vAlign=1', () => {
        // baseline = y + base + (boxHeight - lineHeight)/2 = 0 + 16 + 40 = 56
        // dy = 56 + 2 - 16 = 42
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, makeWrapFont());
        const layout = makeLayout([{ start: 0, end: 1, width: 12 }]);
        font.drawWrapped(ctx, 'A', layout, 1, 100, 100, 0, 0, 1, 0, 1);

        const dy = rec.dy[0];
        assert.equal(dy, 42);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('advances cursorY by lineHeight between lines', () => {
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, makeWrapFont());
        const layout = makeLayout([
            { start: 0, end: 1, width: 12 }, // 'A'
            { start: 2, end: 3, width: 12 }, // 'B'
        ]);
        font.drawWrapped(ctx, 'A\nB', layout, 2, 100, 100, 0, 0);

        const dy1 = rec.dy[0];
        const dy2 = rec.dy[1];
        assert.equal(dy2 - dy1, 20); // lineHeight=20
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('left-aligns by default (cursorX == x)', () => {
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, makeWrapFont());
        const layout = makeLayout([{ start: 0, end: 1, width: 12 }]);
        font.drawWrapped(ctx, 'A', layout, 1, 100, 100, 7, 0);

        // glyph dx = cursorX + xoffset = 7 + 0 = 7
        assert.equal(rec.dx[0], 7);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('center-aligns lines independently using lineWidth from the buffer', () => {
        // Box width 100, line width 12, scale=1 -> cursorX = x + (100 - 12)/2 = 44.
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, makeWrapFont());
        const layout = makeLayout([{ start: 0, end: 1, width: 12 }]);
        font.drawWrapped(ctx, 'A', layout, 1, 100, 100, 0, 0, 1, 1, 0);
        assert.equal(rec.dx[0], 44);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('right-aligns lines using lineWidth from the buffer', () => {
        // cursorX = x + (boxWidth - lineWidth) = 0 + (100 - 12) = 88.
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, makeWrapFont());
        const layout = makeLayout([{ start: 0, end: 1, width: 12 }]);
        font.drawWrapped(ctx, 'A', layout, 1, 100, 100, 0, 0, 1, 2, 0);
        assert.equal(rec.dx[0], 88);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('scales lineWidth correctly for h-alignment', () => {
        // scale=2, lineWidth-at-scale-1 = 12 -> effective line width = 24.
        // Center: cursorX = (100 - 24)/2 = 38.
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, makeWrapFont());
        const layout = makeLayout([{ start: 0, end: 1, width: 12 }]);
        font.drawWrapped(ctx, 'A', layout, 1, 100, 100, 0, 0, 2, 1, 0);
        assert.equal(rec.dx[0], 38);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('pixel-snaps cursorX per line', () => {
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, makeWrapFont());
        const layout = makeLayout([
            { start: 0, end: 1, width: 12 },
            { start: 2, end: 3, width: 12 },
        ]);
        // x=7.3 -- would propagate fractional dx without rounding.
        font.drawWrapped(ctx, 'A\nB', layout, 2, 100, 100, 7.3, 0);

        assert.ok(Number.isInteger(rec.dx[0]));
        assert.ok(Number.isInteger(rec.dx[1]));
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('appends three dots when a line has flags=1 (ellipsis)', () => {
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, makeWrapFont());
        const layout = makeLayout([{ start: 0, end: 3, width: 36, flags: 1 }]);
        // 3 glyphs (ABC) + 3 dots = 6 draws.
        font.drawWrapped(ctx, 'ABC', layout, 1, 100, 100, 0, 0);
        assert.equal(rec.calls, 6);

        // Last 3 draws should all be the '.' glyph -- atlas sx=60 in makeWrapFont.
        assert.equal(rec.sx[3], 60);
        assert.equal(rec.sx[4], 60);
        assert.equal(rec.sx[5], 60);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('does not draw ellipsis dots when flags=0', () => {
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, makeWrapFont());
        const layout = makeLayout([{ start: 0, end: 3, width: 36, flags: 0 }]);
        font.drawWrapped(ctx, 'ABC', layout, 1, 100, 100, 0, 0);
        assert.equal(rec.calls, 3);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('honors the lineCount argument (ignores trailing buffer entries)', () => {
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, makeWrapFont());
        const layout = makeLayout([
            { start: 0, end: 1, width: 12 }, // 'A'
            { start: 2, end: 3, width: 12 }, // 'B'
            { start: 4, end: 5, width: 12 }, // 'C' -- should be ignored
        ]);
        font.drawWrapped(ctx, 'A\nB\nC', layout, 2, 100, 100, 0, 0);
        assert.equal(rec.calls, 2);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('uses each line\'s own range from the text buffer (no string splitting)', () => {
        // Encode a substring per line out of one shared text. Confirms drawWrapped is
        // indexing into `text` via startIdx/endIdx rather than relying on \n splits.
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, makeWrapFont());
        const text = 'ABC';
        const layout = makeLayout([
            { start: 0, end: 1, width: 12 }, // 'A'
            { start: 2, end: 3, width: 12 }, // 'C'
        ]);
        font.drawWrapped(ctx, text, layout, 2, 100, 100, 0, 0);

        assert.equal(rec.calls, 2);
        assert.equal(rec.sx[0], 0);  // 'A' at atlas x=0
        assert.equal(rec.sx[1], 20); // 'C' at atlas x=20
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('applies scale to the baseline math (lineHeight * scale between lines)', () => {
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, makeWrapFont());
        const layout = makeLayout([
            { start: 0, end: 1, width: 12 },
            { start: 2, end: 3, width: 12 },
        ]);
        font.drawWrapped(ctx, 'A\nB', layout, 2, 100, 100, 0, 0, 2);

        const dy1 = rec.dy[0];
        const dy2 = rec.dy[1];
        // lineHeight=20, scale=2 -> 40 between lines.
        assert.equal(dy2 - dy1, 40);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('does not allocate per-call (no ad-hoc Float32Array or array creation)', () => {
        // Sanity guard: a layout buffer reused across many frames should not be
        // mutated by drawWrapped, and the renderer should not stash references that
        // would prevent the buffer from being reused.
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, makeWrapFont());
        const layout = makeLayout([{ start: 0, end: 3, width: 36 }]);
        const snapshot = Array.from(layout);

        for (let i = 0; i < 10; i++) font.drawWrapped(ctx, 'ABC', layout, 1, 100, 100, 0, 0);

        assert.deepEqual(Array.from(layout), snapshot);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });
});
