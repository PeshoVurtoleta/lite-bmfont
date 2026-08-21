import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { BitmapFont, BitmapFontError, DRAWFAST_MAX } from '../BitmapFont.js';
import {
    rec, resetRec, ATLAS,
    FONT_ASCII, FONT_NUM, FONT_GAP, FONT_NL, JSON_ASCII, JSON_GAP, oracleAdvance,
    FONT_SNAP, FONT_SNAP_KERN, FONT_SNAP_NEG, JSON_SNAP,
} from './torture/harness.mjs';

// The next representable double above v (v >= 0). 1e21's ulp is 2^17 = 131072.
const DF_NEXT = new DataView(new ArrayBuffer(8));
function dfNextUp(v) { DF_NEXT.setFloat64(0, v); DF_NEXT.setBigUint64(0, DF_NEXT.getBigUint64(0) + 1n); return DF_NEXT.getFloat64(0); }
// Decode the shared recording ctx into the rendered string. makeNumericFont puts
// '.' at sx 0 width 4 and digit N at sx N*10 width 8, so '0' and '.' collide on
// sx -- width (sw) disambiguates: sw === 4 is '.'.
function numSpell() { let s = ''; for (let i = 0; i < rec.calls; i++) s += String.fromCharCode(rec.sw[i] === 4 ? 46 : 48 + rec.sx[i] / 10); return s; }

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
        // Glyph A at index 65*7. 0012 fork 1 (C-folded): xadvance is stored in
        // 1/16 fixed point, so 12 -> round(12*16) = 192; advanceOf decodes it.
        assert.equal(font.glyphs[65 * 7 + 6], 192); // xadvance * 16
        assert.equal(font.advanceOf(65), 12);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('maps kerning pairs', () => {
        const atlas = {};
        resetRec(atlas);
        const font = new BitmapFont(atlas, mockFontJson);
        // 0012 fork 1/3 (C-folded): kerning amount stored in 1/16 fixed point,
        // -1 -> round(-1*16) = -16; kernOf decodes it.
        assert.equal(font.kerning[(65 << 8) | 66], -16); // A->B = -1 * 16
        assert.equal(font.kernOf(65, 66), -1);
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

    // ---- M1: the magnitude door (F-01, F-02) -------------------------------
    // These six are the failing-before / passing-after tests for the door.

    test('drawFast: DRAWFAST_MAX is exported and equals 1e21', () => {
        // v1.2.1 has no such export -- the module property is undefined there.
        assert.equal(DRAWFAST_MAX, 1e21);
    });

    test('drawFast: 1e21 renders 24 glyphs spelling 1000000000000000000000.0', () => {
        const atlas = {};
        resetRec(atlas);
        const font = new BitmapFont(atlas, makeNumericFont());
        font.drawFast(rec, 1e21, 0, 20);
        assert.equal(rec.calls, 24);
        assert.equal(numSpell(), '1000000000000000000000.0');
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('drawFast: the next double above 1e21 draws nothing', () => {
        // FAILS on v1.2.1: it draws 24 glyphs of a silently wrong number (F-02).
        // 1e21's ulp is 131072, so this value is > DRAWFAST_MAX and the door rejects it.
        const atlas = {};
        resetRec(atlas);
        const font = new BitmapFont(atlas, makeNumericFont());
        assert.equal(1e21 + 1, 1e21);            // the ulp identity, pinned
        font.drawFast(rec, dfNextUp(1e21), 0, 20);
        assert.equal(rec.calls, 0);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('drawFast: 1e22, 1e100 and Number.MAX_VALUE each draw nothing', () => {
        // Number.MAX_VALUE HANGS v1.2.1 FOREVER (F-01): value*10 overflows to
        // Infinity and `while (temp > 0)` never ends. Safe in process ONLY because
        // the shipped door now returns before the multiply -- proven out of process
        // by T9 control 9 before this call was ever authorised.
        const atlas = {};
        resetRec(atlas);
        const font = new BitmapFont(atlas, makeNumericFont());
        for (const v of [1e22, 1e100, Number.MAX_VALUE]) {
            resetRec(atlas);
            font.drawFast(rec, v, 0, 20);
            assert.equal(rec.calls, 0, 'drawFast(' + v + ') drew ' + rec.calls);
        }
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('drawFast: -DRAWFAST_MAX clamps to 0.0; below it draws nothing', () => {
        const atlas = {};
        const font = new BitmapFont(atlas, makeNumericFont());
        // -1e21 is inside the door -> negative clamp -> "0.0", 3 glyphs.
        resetRec(atlas);
        font.drawFast(rec, -DRAWFAST_MAX, 0, 20);
        assert.equal(rec.calls, 3);
        assert.equal(numSpell(), '0.0');
        // Just below -1e21 (more negative) is outside the door -> draws nothing.
        resetRec(atlas);
        font.drawFast(rec, -dfNextUp(1e21), 0, 20);
        assert.equal(rec.calls, 0);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('drawFast: Number.MAX_VALUE returns in under 1 ms with zero draw calls', () => {
        // The direct F-01 regression test: it must RETURN (the assertion after the
        // call is only reachable if it does) and draw nothing.
        const atlas = {};
        resetRec(atlas);
        const font = new BitmapFont(atlas, makeNumericFont());
        const t0 = process.hrtime.bigint();
        font.drawFast(rec, Number.MAX_VALUE, 0, 20);
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        assert.ok(ms < 1, 'drawFast(MAX_VALUE) took ' + ms + ' ms');
        assert.equal(rec.calls, 0);
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

    test('does NOT re-scale lineWidth for h-alignment (F-45)', () => {
        // F-45, 1.6.0: `lineWidth` arrives at the RENDERED scale (the
        // text-layout producer already baked `scale` in), so `drawWrapped`
        // compares it DIRECTLY to `boxWidth` and does NOT multiply by `scale`.
        // scale=2, lineWidth=12 (already rendered px). Center:
        // cursorX = (100 - 12)/2 = 44. (Before the fix this asserted 38, which
        // encoded the double-scale defect as intent -- see decisions/0006.)
        const atlas = {};
        resetRec(atlas);
        const ctx = rec;
        const font = new BitmapFont(atlas, makeWrapFont());
        const layout = makeLayout([{ start: 0, end: 1, width: 12 }]);
        font.drawWrapped(ctx, 'A', layout, 1, 100, 100, 0, 0, 2, 1, 0);
        assert.equal(rec.dx[0], 44);
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

// ---- M2: the cursor conservation session (F-03/04/05/12/24/25) -------------
// Twelve blocks, each named for the finding it lands and tagged whether v1.2.2
// fails it. They share the harness `rec`; each resets it and ends by asserting
// the two fault counters. The F-24/F-25 non-ASCII test chars are written
// String.fromCharCode(200), never a literal byte (ASCII-only source Law).
describe('BitmapFont M2: cursor conservation', () => {
    const E = String.fromCharCode(200); // id 200, unmapped in JSON_ASCII

    test('F-03: a NaN char code is rejected identically by draw, drawWrapped and measure', () => {
        // v1.2.2 FAILS: the drawWrapped NaN vector (a bad index) drew five glyphs
        // at NaN x. The three sites now share one guard idiom. _measureRange is the
        // one site a NaN id reaches through the public surface (an out-of-range end
        // -> charCodeAt NaN); draw has no range and drawWrapped clamps, so an
        // out-of-range CODE (>=256) exercises their guard instead.
        resetRec(ATLAS);
        assert.equal(FONT_ASCII._measureRange('A', 0, 2, 1), 12); // NaN id at index 1 skipped
        resetRec(ATLAS);
        FONT_ASCII.drawWrapped(rec, 'HELLO', Float32Array.of(-1, 5, 60, 0), 1, 1000, 1000, 0, 0, 1, 0, 0);
        let nan = 0; for (let i = 0; i < rec.calls; i++) if (rec.dx[i] !== rec.dx[i]) nan++;
        assert.equal(nan, 0); // FAILS on 1.2.2 (five NaN)
        const s = 'A' + String.fromCharCode(300) + 'B'; // id 300 out of range
        assert.equal(FONT_ASCII.measure(s), 24);
        resetRec(ATLAS); FONT_ASCII.draw(rec, s, 0, 0);
        const dCalls = rec.calls;
        assert.equal(dCalls, 2);
        resetRec(ATLAS); FONT_ASCII.drawWrapped(rec, s, Float32Array.of(0, 3, 24, 0), 1, 1000, 1000, 0, 0, 1, 0, 0);
        assert.equal(rec.calls, dCalls); // draw and drawWrapped skip the same id
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('F-04: startIdx -1 renders the same five glyphs as startIdx 0', () => {
        // v1.2.2 FAILS: five NaN dx. H13 clamps startIdx to 0.
        resetRec(ATLAS);
        FONT_ASCII.drawWrapped(rec, 'HELLO', Float32Array.of(-1, 5, 40, 0), 1, 1000, 1000, 0, 0, 1, 0, 0);
        assert.equal(rec.calls, 5);
        assert.deepEqual(Array.from(rec.dx.slice(0, 5)), [0, 12, 24, 36, 48]);
        resetRec(ATLAS);
        FONT_ASCII.drawWrapped(rec, 'HELLO', Float32Array.of(0, 5, 40, 0), 1, 1000, 1000, 0, 0, 1, 0, 0);
        assert.deepEqual(Array.from(rec.dx.slice(0, 5)), [0, 12, 24, 36, 48]);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('F-04: a NaN startIdx clamps to 0; a NaN endIdx clamps to text.length', () => {
        // v1.2.2 FAILS: both drew a NaN line.
        resetRec(ATLAS);
        FONT_ASCII.drawWrapped(rec, 'HELLO', Float32Array.of(NaN, 5, 60, 0), 1, 1000, 1000, 0, 0, 1, 0, 0);
        assert.equal(rec.calls, 5);
        assert.deepEqual(Array.from(rec.dx.slice(0, 5)), [0, 12, 24, 36, 48]);
        resetRec(ATLAS);
        FONT_ASCII.drawWrapped(rec, 'HELLO', Float32Array.of(0, NaN, 60, 0), 1, 1000, 1000, 0, 0, 1, 0, 0);
        assert.equal(rec.calls, 5);
        assert.deepEqual(Array.from(rec.dx.slice(0, 5)), [0, 12, 24, 36, 48]);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('F-05: a layoutBuffer shorter than lineCount * 4 throws naming both numbers', () => {
        // v1.2.2 FAILS: no throw, surplus lines vanished. Float32Array.of(...) is
        // length 4; lineCount 3 needs 12.
        resetRec(ATLAS);
        assert.throws(
            () => FONT_ASCII.drawWrapped(rec, 'HELLO', Float32Array.of(0, 5, 60, 0), 3, 1000, 1000, 0, 0, 1, 0, 0),
            (e) => e instanceof RangeError && e.message.includes('4') && e.message.includes('12'));
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('F-05: the same short buffer with lineCount 1 does not throw', () => {
        // The non-vacuity twin -- passes on both versions. A correctly-sized call
        // (length 4, lineCount 1 needs 4) draws its five glyphs.
        resetRec(ATLAS);
        assert.doesNotThrow(
            () => FONT_ASCII.drawWrapped(rec, 'HELLO', Float32Array.of(0, 5, 60, 0), 1, 1000, 1000, 0, 0, 1, 0, 0));
        assert.equal(rec.calls, 5);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('F-05: lineCount 0.5 draws nothing; 1.5 draws one line', () => {
        // v1.2.2 FAILS on 0.5 (drew a whole line). H11 floors and clamps at 0.
        resetRec(ATLAS);
        FONT_ASCII.drawWrapped(rec, 'HELLO', Float32Array.of(0, 5, 60, 0), 0.5, 1000, 1000, 0, 0, 1, 0, 0);
        assert.equal(rec.calls, 0);
        resetRec(ATLAS);
        FONT_ASCII.drawWrapped(rec, 'HELLO', Float32Array.of(0, 5, 60, 0), 1.5, 1000, 1000, 0, 0, 1, 0, 0);
        assert.equal(rec.calls, 5);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('F-12: missingAdvance defaults to 0 and 1.2.x output is unchanged', () => {
        // The semver guarantee in test form: byte-identical to 1.2.2 for the
        // documented inputs. draw('A' + chr(200) + 'A') -> dx 0,12 (overprint).
        resetRec(ATLAS);
        FONT_ASCII.draw(rec, 'A' + E + 'A', 0, 0);
        assert.equal(rec.calls, 2);
        assert.deepEqual(Array.from(rec.dx.slice(0, 2)), [0, 12]);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('F-12: missingAdvance 6 gives the absent glyph real width', () => {
        // NOT constructible on 1.2.2. 2 calls, dx 0,18 -- the absent glyph has
        // width 0 / height 0, so it is never passed to drawImage; it only advances
        // the cursor, moving the second A from 12 to 18. Call count matches the
        // default exactly.
        const atlas = {};
        const font = new BitmapFont(atlas, JSON_ASCII, { missingAdvance: 6 });
        resetRec(atlas);
        font.draw(rec, 'A' + E + 'A', 0, 0);
        assert.equal(rec.calls, 2);
        assert.deepEqual(Array.from(rec.dx.slice(0, 2)), [0, 18]);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('F-12: hasGlyph is fail-closed on NaN, -1, 256, 65.5 and 10', () => {
        // NOT constructible on 1.2.2 (no hasGlyph).
        resetRec(ATLAS);
        assert.equal(FONT_ASCII.hasGlyph(65), true);
        for (const bad of [NaN, -1, 256, 65.5, 10]) {
            assert.equal(FONT_ASCII.hasGlyph(bad), false, 'hasGlyph(' + bad + ')');
        }
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('F-24: an unmapped glyph breaks the kerning chain, and the oracle agrees', () => {
        // 34 on both sides (12 + kern(65,200)=3 + 0 + kern(200,66)=7 + 12). The
        // v1.2.2 oracle's adv[id] skip gave 19 -- this is the assertion that makes
        // fork (3) non-decorative.
        resetRec(ATLAS);
        const s = 'A' + E + 'B';
        assert.equal(FONT_GAP._measureRange(s, 0, 3, 1), 34);
        assert.equal(oracleAdvance(JSON_GAP, s, 0, 3, 1), 34);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('F-25: a descriptor mapping id 10 is discarded; measure is 24, not 31', () => {
        // v1.2.2 FAILS: measure was 31 (it charged 7px for the newline).
        resetRec(ATLAS);
        assert.equal(FONT_NL.measure('A\nA'), 24);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });

    test('F-25: drawWrapped never renders a newline as a glyph', () => {
        // v1.2.2 FAILS: 4 calls (it drew the 9x9 newline mid-line). H6 zeroes the
        // size so gw>0 && gh>0 is false.
        resetRec(ATLAS);
        FONT_NL.drawWrapped(rec, 'AB\nC', Float32Array.of(0, 4, 36, 0), 1, 1000, 1000, 0, 0, 1, 0, 0);
        assert.equal(rec.calls, 3);
        assert.deepEqual(Array.from(rec.dx.slice(0, 3)), [0, 12, 24]);
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    });
});

// M3: the descriptor door (F-08 detection / F-09 / F-10 / F-11 / F-13 / F-28 /
// F-29 / F-30). Fourteen blocks per SESSION-M3.md section 6.5. The starting
// numbers -- 3 of 5 construct, 4 throw raw TypeErrors -- are annotated so a
// reader sees what 1.2.3 did. Every block ends by asserting the shared ctx is
// clean (dropped/imgMismatch 0). Design record: decisions/0003-descriptor-door.md.
describe('BitmapFont M3: the descriptor door', () => {
    const mkChar = (o) => Object.assign(
        { id: 65, x: 0, y: 0, width: 10, height: 14, xoffset: 0, yoffset: 2, xadvance: 12 }, o);
    const mkFont = (o) => Object.assign({ common: { lineHeight: 20, base: 16 }, chars: [mkChar()] }, o);
    const clean = () => { assert.equal(rec.dropped, 0); assert.equal(rec.imgMismatch, 0); };
    const ASCII_CHECKED = new BitmapFont(ATLAS, JSON_ASCII, { checked: true });

    test('F-10: chars 7, "AB", {length:-1}, {length:3} and missing each throw a BitmapFontError naming chars', () => {
        // 3 of 5 construct on 1.2.3 (7, "AB", {length:-1} -> 0-glyph fonts).
        resetRec(ATLAS);
        for (const chars of [7, 'AB', { length: -1 }, { length: 3 }]) {
            assert.throws(() => new BitmapFont(ATLAS, { common: { lineHeight: 20, base: 16 }, chars }),
                (e) => e instanceof BitmapFontError && e.field.includes('chars'), 'chars ' + JSON.stringify(chars));
        }
        assert.throws(() => new BitmapFont(ATLAS, { common: { lineHeight: 20, base: 16 } }),
            (e) => e instanceof BitmapFontError && e.field.includes('chars'));
        clean();
    });

    test('F-10: chars [] is legal and constructs a coherent zero-glyph font', () => {
        resetRec(ATLAS);
        const f = new BitmapFont(ATLAS, { common: { lineHeight: 20, base: 16 }, chars: [] });
        assert.equal(f.measure('A'), 0);
        assert.equal(f.hasGlyph(65), false);
        clean();
    });

    test('F-10: atlas null/undefined, fontJson null/{}, common null, lineHeight NaN, base NaN each throw naming the field', () => {
        // 3 construct on 1.2.3 (atlas null, lineHeight NaN, base NaN); 4 throw raw TypeErrors.
        resetRec(ATLAS);
        const cases = [
            [() => new BitmapFont(null, mkFont()), 'imageAtlas'],
            [() => new BitmapFont(undefined, mkFont()), 'imageAtlas'],
            [() => new BitmapFont(ATLAS, null), 'fontJson'],
            [() => new BitmapFont(ATLAS, {}), 'common'],
            [() => new BitmapFont(ATLAS, { common: null, chars: [mkChar()] }), 'common'],
            [() => new BitmapFont(ATLAS, { common: { lineHeight: NaN, base: 16 }, chars: [mkChar()] }), 'common.lineHeight'],
            [() => new BitmapFont(ATLAS, { common: { lineHeight: 20, base: NaN }, chars: [mkChar()] }), 'common.base'],
        ];
        for (const [fn, field] of cases) {
            assert.throws(fn, (e) => e instanceof BitmapFontError && e.field.includes(field), field);
        }
        clean();
    });

    test('F-10: no raw TypeError escapes the constructor', () => {
        resetRec(ATLAS);
        const bad = [
            () => new BitmapFont(null, mkFont()),
            () => new BitmapFont(ATLAS, null),
            () => new BitmapFont(ATLAS, {}),
            () => new BitmapFont(ATLAS, { common: { lineHeight: 20, base: 16 } }),
            () => new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ id: '65' })] })),
            () => new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ x: NaN })] })),
            () => new BitmapFont(ATLAS, mkFont({ kernings: [{ first: '65', second: 66, amount: 1 }] })),
            () => new BitmapFont(ATLAS, mkFont(), { missingAdvanc: 6 }),
        ];
        for (const fn of bad) {
            assert.throws(fn, (e) => {
                assert.equal(e.constructor.name, 'BitmapFontError', 'raw ' + e.constructor.name + ': ' + e.message);
                assert.ok(!(e.constructor === TypeError));
                return true;
            });
        }
        clean();
    });

    test('F-28: an unknown opts key throws and names the allowlist', () => {
        resetRec(ATLAS);
        assert.throws(() => new BitmapFont(ATLAS, mkFont(), { missingAdvanc: 6 }),
            (e) => e instanceof BitmapFontError && e.message.includes('missingAdvanc') &&
                e.message.includes('missingAdvance') && e.message.includes('checked'));
        clean();
    });

    test('F-28: opts must be an object; checked must be a boolean', () => {
        resetRec(ATLAS);
        assert.throws(() => new BitmapFont(ATLAS, mkFont(), 7),
            (e) => e instanceof BitmapFontError && e.field.includes('opts'));
        assert.throws(() => new BitmapFont(ATLAS, mkFont(), { checked: 1 }),
            (e) => e instanceof BitmapFontError && e.field.includes('opts.checked'));
        // twins: these all construct.
        for (const opts of [{}, undefined, null, { missingAdvance: 6 }, { checked: true }, { checked: false }]) {
            assert.doesNotThrow(() => new BitmapFont(ATLAS, mkFont(), opts), 'opts ' + JSON.stringify(opts));
        }
        clean();
    });

    test('F-29: a non-number or non-integer char.id throws instead of writing an unnamed glyph', () => {
        // On 1.2.3 id '65' wrote 4 slots but hasGlyph(65) stayed false (the lie).
        resetRec(ATLAS);
        for (const id of ['65', null, true, 65.5, NaN, Infinity]) {
            assert.throws(() => new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ id })] })),
                (e) => e instanceof BitmapFontError && e.field === 'chars[0].id', 'id ' + String(id));
        }
        // finite out of range is CHECKED, not always-throw. 0012 fork 6: checked
        // now defaults ON, so the unchecked lane must be opted into explicitly.
        assert.doesNotThrow(() => new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ id: 3000 })] }), { checked: false }));
        clean();
    });

    test('F-30: a non-finite glyph field throws in BOTH lanes', () => {
        // On 1.2.3 x NaN stored 0 and hasGlyph(65) reported true.
        resetRec(ATLAS);
        for (const x of [NaN, Infinity, -Infinity]) {
            assert.throws(() => new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ x })] })),
                (e) => e instanceof BitmapFontError && e.field === 'chars[0].x', 'unchecked x ' + x);
            assert.throws(() => new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ x })] }), { checked: true }),
                (e) => e instanceof BitmapFontError && e.field === 'chars[0].x', 'checked x ' + x);
        }
        clean();
    });

    test('F-08 (0012 fork 1, C-folded): xadvance 8.6 stores 1/16 fixed point exactly', () => {
        // BREAKING (0012 fork 1): 2.0.0 stores xadvance in 1/16 fixed point, so
        // 8.6 -> round(8.6*16) = 138, advanceOf 8.625, measure('AA') = 17.25.
        // v1.x truncated to 8 (measure 16, drift 24.0000px over 40 glyphs). The
        // slot 0 x wrap is unchanged -- x stays raw Int16 (checked opt-out).
        resetRec(ATLAS);
        const fx = new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ x: 40000 })] }), { checked: false });
        assert.equal(fx.glyphs[65 * 7], -25536);
        const fa = new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ xadvance: 8.6 })] }));
        assert.equal(fa.glyphs[65 * 7 + 6], 138);      // round(8.6 * 16), EXACT literal (S-4)
        assert.equal(fa.advanceOf(65), 8.625);         // 138 / 16
        assert.equal(fa.measure('AA'), 17.25);         // 8.625 * 2, NEVER a tolerance
        // A 40-glyph line: C 8.625*40 = 345 vs exact 344 = -1.0000px overshoot,
        // where v1.x drift was exactly 24.0000px (320). Exact literal (S-5).
        assert.equal(fa.measure('A'.repeat(40)), 345);
        // Non-boundary probe: 8.7 -> round(139.2) = 139, advanceOf 8.6875,
        // 40 glyphs 347.5, all exactly representable.
        const fp = new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ xadvance: 8.7 })] }));
        assert.equal(fp.glyphs[65 * 7 + 6], 139);
        assert.equal(fp.advanceOf(65), 8.6875);
        assert.equal(fp.measure('A'.repeat(40)), 347.5);
        // Toward-zero is retired for this slot: -8.6 is a valid sub-pixel advance,
        // stores round(-8.6*16) = -138 (NOT -8), and CONSTRUCTS under checked.
        const fn = new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ xadvance: -8.6 })] }));
        assert.equal(fn.glyphs[65 * 7 + 6], -138);
        assert.equal(fn.advanceOf(65), -8.625);
        clean();
    });

    test('F-08 (0012 fork 6): a fractional-advance font CONSTRUCTS by default -- the blocker', () => {
        // THE BLOCKER (0012 forks 1+6): checked defaults ON in 2.0.0. Under the OLD
        // integrality test this xadvance would throw "is not an integer" and every
        // fractional-advance font would fail to load. C changes what "lossy" means:
        // a declared 1/16 resolution does not throw on a value it rounds. This
        // assertion is what proves the contradiction was RESOLVED, not discussed.
        resetRec(ATLAS);
        assert.doesNotThrow(() => new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ xadvance: 8.6 })] })));
        const f = new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ xadvance: 8.6 })] }));
        assert.equal(f.measure('AA'), 17.25);
        clean();
    });

    test('F-08 (0012 fork 1/6): slot 0 wrap still throws checked; advance out of fixed-point range throws', () => {
        resetRec(ATLAS);
        // Slot 0 (x) keeps the Int16 integrality/range lane: 40000 wraps to -25536.
        assert.throws(() => new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ x: 40000 })] }), { checked: true }),
            (e) => e instanceof BitmapFontError && e.message.includes('40000') && e.message.includes('-25536'));
        // Advance lane: a value OUTSIDE the 1/16 fixed-point range [-2048, 2047.9375]
        // throws under checked (its store would wrap the Int16). 3000 is in range for
        // v1.x Int16 but not for the *16 fixed-point store.
        assert.throws(() => new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ xadvance: 3000 })] }), { checked: true }),
            (e) => e instanceof BitmapFontError && e.field === 'chars[0].xadvance' &&
                e.message.includes('2047.9375'));
        // But a fractional in-range advance does NOT throw under checked (blocker).
        assert.doesNotThrow(() => new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ xadvance: -8.6 })] }), { checked: true }));
        clean();
    });

    test('F-09: a kerning key that is negative, fractional, a string or a boolean does not write a pair the descriptor never named', () => {
        // On 1.2.3 first '65' wrote slot 16706, first true wrote 322.
        resetRec(ATLAS);
        for (const first of ['65', 65.5, true]) {
            assert.throws(() => new BitmapFont(ATLAS, mkFont({ kernings: [{ first, second: 66, amount: 1 }] })),
                (e) => e instanceof BitmapFontError && e.field === 'kernings[0].first', 'first ' + String(first));
        }
        // negative finite key: skipped unchecked (writes nowhere), throws checked.
        // 0012 fork 6: checked defaults ON, so opt into the skip lane explicitly.
        const f = new BitmapFont(ATLAS, mkFont({ kernings: [{ first: -1, second: 65, amount: -2 }] }), { checked: false });
        assert.equal(f.kerning[(255 << 8) | 65], 0);
        assert.throws(() => new BitmapFont(ATLAS, mkFont({ kernings: [{ first: -1, second: 65, amount: -2 }] }), { checked: true }),
            (e) => e instanceof BitmapFontError && e.field === 'kernings[0].first');
        clean();
    });

    test('F-11: scale NaN, 0, -1 and Infinity draw nothing on draw, drawFast and drawWrapped', () => {
        // 12 cases; all drew on 1.2.3 (draw 4, drawFast 6, drawWrapped 5 apiece).
        for (const s of [NaN, 0, -1, Infinity]) {
            resetRec(ATLAS); FONT_ASCII.draw(rec, 'AAAA', 0, 0, s, 0);
            assert.equal(rec.calls, 0, 'draw scale ' + s);
            resetRec(ATLAS); FONT_NUM.drawFast(rec, 1234, 0, 0, s, 0);
            assert.equal(rec.calls, 0, 'drawFast scale ' + s);
            resetRec(ATLAS); FONT_ASCII.drawWrapped(rec, 'AAAA', Float32Array.of(0, 4, 48, 0), 1, 100, 100, 0, 0, s, 0, 0);
            assert.equal(rec.calls, 0, 'drawWrapped scale ' + s);
        }
        clean();
    });

    test('F-11: align and vAlign outside {0,1,2} render left and top, as documented', () => {
        resetRec(ATLAS); FONT_ASCII.draw(rec, 'ABC', 0, 0, 1, 0);
        const ref = Array.from(rec.dx.slice(0, rec.calls)); const refCalls = rec.calls;
        for (const a of [3, -1, 1.5, NaN]) {
            resetRec(ATLAS); FONT_ASCII.draw(rec, 'ABC', 0, 0, 1, a);
            assert.equal(rec.calls, refCalls, 'align ' + a);
            assert.deepEqual(Array.from(rec.dx.slice(0, rec.calls)), ref, 'align ' + a + ' column');
        }
        resetRec(ATLAS); FONT_ASCII.drawWrapped(rec, 'ABC', Float32Array.of(0, 3, 36, 0), 1, 100, 100, 0, 0, 1, 0, 0);
        const vref = Array.from(rec.dy.slice(0, rec.calls));
        assert.equal(vref[0], 2);
        for (const va of [3, -1, NaN]) {
            resetRec(ATLAS); FONT_ASCII.drawWrapped(rec, 'ABC', Float32Array.of(0, 3, 36, 0), 1, 100, 100, 0, 0, 1, 0, va);
            assert.deepEqual(Array.from(rec.dy.slice(0, rec.calls)), vref, 'vAlign ' + va + ' column');
        }
        clean();
    });

    test('F-13: flags 1.0000001 fires the ellipsis; an unknown bit throws under checked', () => {
        // On 1.2.3 flags 1.0000001 was silently ignored (5 calls, no ellipsis).
        resetRec(ATLAS);
        FONT_ASCII.drawWrapped(rec, 'HELLO', Float32Array.of(0, 5, 60, 1.0000001), 1, 1000, 1000, 0, 0, 1, 0, 0);
        assert.equal(rec.calls, 8);
        assert.deepEqual([rec.dx[5], rec.dx[6], rec.dx[7]], [60, 72, 84]);
        // unknown bit (2) under checked throws; the twin (flags 1) does not.
        assert.throws(() => { resetRec(ATLAS); ASCII_CHECKED.drawWrapped(rec, 'HELLO', Float32Array.of(0, 5, 60, 2), 1, 1000, 1000, 0, 0, 1, 0, 0); },
            (e) => e instanceof BitmapFontError && e.message.includes('mask') && e.message.includes('2'));
        resetRec(ATLAS);
        assert.doesNotThrow(() => ASCII_CHECKED.drawWrapped(rec, 'HELLO', Float32Array.of(0, 5, 60, 1), 1, 1000, 1000, 0, 0, 1, 0, 0));
        assert.equal(rec.calls, 8);
        // F-49 (M9a): flags 3 -- bit 0 SET plus an unknown bit. Until M9a the
        // mask test lived in the `else` of the ellipsis branch, so any odd flags
        // value took the ellipsis path and the unknown bit was never seen: this
        // threw for 2 and was SILENT for 3, over half the flag space. qa 2026-08-21
        // found that F-49's only regression witness was in TORTURE (T2/14b,
        // T3/48) -- `npm test` exercised 1 and 2 and never 3, so a fast-only run
        // could not see the hole come back. This row is that witness.
        assert.throws(() => { resetRec(ATLAS); ASCII_CHECKED.drawWrapped(rec, 'HELLO', Float32Array.of(0, 5, 60, 3), 1, 1000, 1000, 0, 0, 1, 0, 0); },
            (e) => e instanceof BitmapFontError && e.message.includes('mask') && e.message.includes('3'),
            'flags 3 (bit 0 set + unknown bit) must throw -- the F-49 else-if hole');
        clean();
    });
});

/**
 * M4 (v1.4.0) -- metrics coherence and the pixel-snap promise.
 * F-06, F-07, F-34, F-35, F-36. Design record:
 * `decisions/0004-metrics-and-snapping.md`.
 *
 * Every literal below is asserted against FONT_SNAP: advance 8, lineHeight 17,
 * base 16. No other fixture in this repo has those numbers -- FONT_ASCII
 * advances 12 with lineHeight 20 -- and asserting 32/16/56/48 against it would
 * be measuring nothing while staying green.
 */
describe('BitmapFont M4: metrics coherence and the pixel-snap promise', () => {
    // Recover the integer baseline from a recorded dy. Every drawn FONT_SNAP
    // glyph has yoffset 2 and the font has base 16, and `draw` computes
    // `dy = (cursorY + yoffset*scale) - base*scale`, so this round-trips exactly.
    const baselineOf = (dy, scale) => Math.round(dy - (2 * scale - 16 * scale));
    const baselines = (scale) => {
        const out = [];
        for (let i = 0; i < rec.calls; i++) out.push(baselineOf(rec.dy[i], scale));
        return out;
    };
    const clean = () => {
        assert.equal(rec.dropped, 0);
        assert.equal(rec.imgMismatch, 0);
    };
    const FIVE = 'A\nB\nC\nD\nE';
    const LAY5 = (() => {
        const b = new Float32Array(20);
        for (let l = 0; l < 5; l++) { b[l * 4] = l * 2; b[l * 4 + 1] = l * 2 + 1; b[l * 4 + 2] = 8; b[l * 4 + 3] = 0; }
        return b;
    })();

    test('F-06: measureWidest returns the widest line where measure returns the sum', () => {
        assert.equal(FONT_SNAP.measure('AA\nAA'), 32);
        assert.equal(FONT_SNAP.measureWidest('AA\nAA'), 16);
        assert.equal(FONT_SNAP.measure('A\nAAAAAA'), 56);
        assert.equal(FONT_SNAP.measureWidest('A\nAAAAAA'), 48);
        // 'A\nAAAAAA' is the string that catches a measureWidest returning the
        // FIRST line instead of the max: the first line is 8, not 48.
        assert.notEqual(FONT_SNAP.measureWidest('A\nAAAAAA'), 8);
        // ...and 'AAA\n' catches one that drops the final (empty) line, which
        // 'AA\nAA' cannot see.
        assert.equal(FONT_SNAP.measureWidest('AAA\n'), 24);
        assert.equal(FONT_SNAP.measureWidest('\n\n\nAAA'), 24);
        assert.equal(FONT_SNAP.measureWidest('\n'), 0);
        assert.equal(FONT_SNAP.measureWidest(''), 0);
        // The residual IS the F-06 number, asserted as an exact value.
        assert.equal(FONT_SNAP.measure('AA\nAA') - FONT_SNAP.measureWidest('AA\nAA'), 16);
        assert.equal(FONT_SNAP.measure('A\nAAAAAA') - FONT_SNAP.measureWidest('A\nAAAAAA'), 8);
    });

    test('F-06: measure still sums across newlines, unchanged in 1.4.0', () => {
        // PINNED CURRENT BEHAVIOUR, NOT DESIRED BEHAVIOUR. 2.0.0 promotes
        // `measure` to the widest line (decisions/0004 fork 1); this block exists
        // so that flip lands visibly instead of silently, and it is expected to
        // go red in that session, which will own updating it.
        assert.equal(FONT_SNAP.measure('AA\nAA'), 32);
        assert.equal(FONT_SNAP.measure('A\nAAAAAA'), 56);
        assert.equal(FONT_ASCII.measure('AA\nAA'), 48);
        assert.equal(FONT_ASCII.measure('A\nAAAAAA'), 84);
    });

    test('F-06: measureWidest equals measure for a newline-free string', () => {
        // The twin. A measureWidest that "fixes" measure too would redden the
        // block above; one that resets its running max at every glyph dies here.
        for (const s of ['AAAA', 'A', 'Hello world', '~', ' ', 'The quick brown fox']) {
            assert.equal(FONT_SNAP.measureWidest(s), FONT_SNAP.measure(s), s);
            assert.equal(FONT_SNAP_KERN.measureWidest(s), FONT_SNAP_KERN.measure(s), s);
        }
        assert.equal(FONT_SNAP.measureWidest('AAAA'), 32);
    });

    test('F-06: measureWidest resets the kerning chain at a line break', () => {
        // Fails under decisions/0004 fork (6) option B (one continuous walk).
        // FONT_SNAP_KERN is the ONLY fixture that can see this: on a kerningless
        // font both options are arithmetically identical for every string.
        const s = 'AB\nBA';
        // Each line measured independently, chain starting fresh.
        const l0 = FONT_SNAP_KERN.measure('AB');
        const l1 = FONT_SNAP_KERN.measure('BA');
        assert.equal(FONT_SNAP_KERN.measureWidest(s), Math.max(l0, l1));
        // Non-vacuity: the seam glyphs really do carry a kern, so a walk that
        // crossed the break would produce a different number.
        const seam = FONT_SNAP_KERN.kerning[(66 << 8) | 66];
        assert.notEqual(seam, 0);
        // And the widest is NOT what a continuous walk would report.
        assert.equal(FONT_SNAP_KERN.measureWidest(s), FONT_SNAP_KERN.measureWidest('AB\nBA'));
    });

    test('F-35: measureLine agrees with drawWrapped on [-0.5, 2), where the raw helper reports one glyph too many', () => {
        // Diverges on 1.3.0: the raw walk returns 24.
        assert.equal(FONT_SNAP.measureLine('AAAA', -0.5, 2, 1), 16);
        assert.equal(FONT_SNAP._measureRange('AAAA', -0.5, 2, 1), 24);
        // ...and 16 is the RENDERER's number, not an invention.
        resetRec(ATLAS);
        FONT_SNAP.drawWrapped(rec, 'AAAA', Float32Array.of(-0.5, 2, 32, 0), 1, 1000, 1000, 0, 0, 1, 0, 0);
        assert.equal(rec.calls, 2);
        assert.deepEqual(Array.from(rec.dx.slice(0, 2)), [0, 8]);
        clean();
    });

    test('F-35: measureLine clamps but does NOT truncate, so it reports what drawWrapped renders', () => {
        // Fork (3)'s whole justification is that the door is the only option
        // under which measureLine agrees with the renderer. That is asserted
        // here, on every fractional range, rather than described: 8 px a glyph.
        for (const [a, b, quads] of [[-0.5, 2, 2], [0.5, 2.7, 3], [1.9, 3.1, 2], [0, 4, 4]]) {
            resetRec(ATLAS);
            FONT_SNAP.drawWrapped(rec, 'AAAA', Float32Array.of(a, b, 32, 0), 1, 1000, 1000, 0, 0, 1, 0, 0);
            assert.equal(rec.calls, quads, 'drawWrapped [' + a + ',' + b + ')');
            assert.equal(FONT_SNAP.measureLine('AAAA', a, b, 1), quads * 8, 'measureLine [' + a + ',' + b + ')');
        }
        // [0.5, 2.7) is the row that forbids a truncating door. A `Math.trunc` on
        // both ends collapses it to [0, 2) and reports 16 -- a width the renderer
        // will not draw, which is F-35 relocated from _measureRange to
        // measureLine. The raw walk already agrees here; only the door can break it.
        assert.equal(FONT_SNAP.measureLine('AAAA', 0.5, 2.7, 1), 24);
        assert.equal(FONT_SNAP._measureRange('AAAA', 0.5, 2.7, 1), 24);
        assert.notEqual(FONT_SNAP.measureLine('AAAA', 0.5, 2.7, 1), 16);
        clean();
    });

    test('F-07: draw snaps every baseline, not just the first', () => {
        // 1.3.0 gave 0, 18.7, 37.4, 56.1, 74.8.
        resetRec(ATLAS);
        FONT_SNAP.draw(rec, FIVE, 0, 0, 1.1, 0);
        assert.equal(rec.calls, 5);
        assert.deepEqual(baselines(1.1), [0, 19, 37, 56, 75]);
        // Narrow: at an integer step nothing moves.
        resetRec(ATLAS);
        FONT_SNAP.draw(rec, FIVE, 0, 0, 1, 0);
        assert.deepEqual(baselines(1), [0, 17, 34, 51, 68]);
        // Every baseline is an integer at a third-scale too (1.3.0 drifted 0.333).
        resetRec(ATLAS);
        FONT_SNAP.draw(rec, FIVE, 0, 0, 1 / 3, 0);
        assert.deepEqual(baselines(1 / 3), [0, 6, 11, 17, 23]);
        clean();
    });

    test('F-07: the snap is measured from the snapped first baseline (B1)', () => {
        // THE DISCRIMINATOR. At y = 0 the ratified B1 form and the rejected B2
        // form produce identical baselines, so the block above pins nothing about
        // the sub-fork. At y = 0.6 B1 gives 1,20,38,57,76 and B2 gives
        // 1,19,38,57,75 -- they differ at indices 1 and 4 only, so the WHOLE
        // array is asserted. 1.3.0 gave 1, 19.7, 38.4, 57.1, 75.8.
        resetRec(ATLAS);
        FONT_SNAP.draw(rec, FIVE, 0, 0.6, 1.1, 0);
        assert.deepEqual(baselines(1.1), [1, 20, 38, 57, 76]);
        // A negative fractional anchor: Math.round(-0.5) is -0.
        resetRec(ATLAS);
        FONT_SNAP.draw(rec, FIVE, 0, -0.5, 1.1, 0);
        assert.deepEqual(baselines(1.1), [0, 19, 37, 56, 75]);
        // Explicitly NOT a discriminator, recorded so nobody cites it as one:
        // single-line output is identical under B1, B2 and 1.3.0 alike.
        resetRec(ATLAS);
        FONT_SNAP.draw(rec, 'A', 0, 0.6, 1.1, 0);
        assert.deepEqual(baselines(1.1), [1]);
        clean();
    });

    test('F-07: drawWrapped snaps every baseline and keeps its line-0 anchor', () => {
        resetRec(ATLAS);
        FONT_SNAP.drawWrapped(rec, FIVE, LAY5, 5, 100, 200, 0, 0, 1.1, 0, 0);
        assert.deepEqual(baselines(1.1), [18, 37, 55, 74, 93]);
        // The offset from draw's sequence is Math.round(base*scale) = 18, NOT
        // base*scale = 17.6. An assertion written with the raw product compares
        // nothing and is off by 0.4 px on every line.
        assert.equal(Math.round(16 * 1.1), 18);
        assert.notEqual(16 * 1.1, 18);
        // THE LINE-0 ANCHOR IS UNCHANGED FROM 1.3.0, including the two composed
        // rounds at vAlign 1/2. The fixture is chosen so they do NOT compose:
        // Math.round(1.0 + 17.6) + Math.round(5.5999...) is 19 + 6 = 25, while a
        // single round of 24.199... is 24. This is the only detector of a
        // reviewer collapsing them "for consistency".
        const bh = 104.7;
        assert.equal(Math.round(1.0 + 16 * 1.1) + Math.round((bh - 5 * 17 * 1.1) / 2), 25);
        assert.equal(Math.round(1.0 + 16 * 1.1 + (bh - 5 * 17 * 1.1) / 2), 24);
        resetRec(ATLAS);
        FONT_SNAP.drawWrapped(rec, FIVE, LAY5, 5, 100, bh, 0, 1.0, 1.1, 0, 1);
        assert.deepEqual(baselines(1.1), [25, 44, 62, 81, 100]);
        clean();
    });

    test('F-07: draw and drawWrapped keep identical per-line increments at a fractional y', () => {
        // What B1 makes exact at EVERY y. The plan's stronger form --
        // wrapped(i) === draw(i) + Math.round(base*scale) -- holds at integer y
        // only, because drawWrapped's line-0 anchor rounds a composite
        // (Math.round(y + base*scale)) and B1 deliberately leaves that alone. At
        // y = 0.6 the anchors differ by 17, not 18.
        resetRec(ATLAS);
        FONT_SNAP.draw(rec, FIVE, 0, 0.6, 1.1, 0);
        const d = baselines(1.1);
        resetRec(ATLAS);
        FONT_SNAP.drawWrapped(rec, FIVE, LAY5, 5, 100, 200, 0, 0.6, 1.1, 0, 0);
        const w = baselines(1.1);
        for (let i = 1; i < 5; i++) assert.equal(w[i] - w[0], d[i] - d[0], 'increment ' + i);
        assert.equal(w[0] - d[0], 17);
        // At an integer y the offset IS Math.round(base*scale), on every line.
        resetRec(ATLAS);
        FONT_SNAP.draw(rec, FIVE, 0, 0, 1.1, 0);
        const d0 = baselines(1.1);
        resetRec(ATLAS);
        FONT_SNAP.drawWrapped(rec, FIVE, LAY5, 5, 100, 200, 0, 0, 1.1, 0, 0);
        const w0 = baselines(1.1);
        for (let i = 0; i < 5; i++) assert.equal(w0[i] - d0[i], 18, 'line ' + i);
        clean();
    });

    test('F-07: X is snapped per line origin, never per glyph', () => {
        // Passes on 1.3.0 and 1.4.0 alike: it pins a CONTRACT, not a fix. The
        // mutation it exists for -- `cursorX = Math.round(cursorX)` in the glyph
        // loop -- is the one most likely to be proposed as an improvement, and it
        // would kill the advance conservation law's exact three-way equality.
        resetRec(ATLAS);
        FONT_SNAP.draw(rec, 'AAAA', 0, 0, 1.1, 0);
        assert.deepEqual(Array.from(rec.dx.slice(0, 4)), [0, 8.8, 17.6, 26.400000000000002]);
        assert.equal(Number.isInteger(rec.dx[1]), false);
        // The line ORIGIN is snapped: a fractional x rounds once per line.
        resetRec(ATLAS);
        FONT_SNAP.draw(rec, 'AA\nAA', 13.5, 0, 1, 0);
        assert.equal(rec.dx[0], 14);
        assert.equal(rec.dx[2], 14);
        clean();
    });

    test('F-34: the measure family returns on an unbounded range', () => {
        // Two of these three never return on 1.3.0. In process they prove the
        // door works; T9 control 13 proves out of process that the gate can SEE a
        // door that does not, and neither substitutes for the other.
        const hangy = { length: Infinity, charCodeAt() { return 65; } };
        const t0 = Date.now();
        assert.equal(FONT_SNAP.measureLine('AAAA', -Infinity, Infinity, 1), 32);
        assert.ok(Number.isNaN(FONT_SNAP.measure(hangy)));
        assert.ok(Number.isNaN(FONT_SNAP.measureWidest(hangy)));
        assert.ok(Number.isNaN(FONT_SNAP.measureLine(hangy, 0, 4, 1)));
        assert.ok(Date.now() - t0 < 250);
        // The clamp's other corners. NaN does not reach the walk -- but it
        // clamps to the WHOLE line, not to an empty one (F-38): NaN start -> 0,
        // NaN end -> len, which is what drawWrapped renders for the same pair.
        assert.equal(FONT_SNAP.measureLine('AAAA', NaN, NaN, 1), 32);
        assert.equal(FONT_SNAP.measureLine('AAAA', 0, 99, 1), 32);
        // An empty range measures 0 (fork 5), with its non-vacuity twin: a
        // measureLine returning 0 unconditionally passes the four zeros.
        assert.equal(FONT_SNAP.measureLine('AAAA', 2, 2, 1), 0);
        assert.equal(FONT_SNAP.measureLine('AAAA', 5, 2, 1), 0);
        assert.equal(FONT_SNAP.measureLine('AAAA', 4, 4, 1), 0);
        assert.equal(FONT_SNAP.measureLine('AAAA', -3, -1, 1), 0);
        assert.equal(FONT_SNAP.measureLine('AAAA', 0, 1, 1), 8);
        // The internal keeps NO door (fork 3 A2) -- that is the boundary, stated.
        assert.equal(FONT_SNAP._measureRange('AAAA', 0, 4, 1), 32);
    });

    test('F-36: the measure family answers a bad scale or a non-string text with NaN', () => {
        // Three cells differ on 1.3.0: measure(123) was 0, measure(null) threw a
        // raw TypeError, measure('AA', -1) was -16.
        for (const bad of [123, null, undefined, [], {}, true]) {
            assert.ok(Number.isNaN(FONT_SNAP.measure(bad)), 'measure ' + String(bad));
            assert.ok(Number.isNaN(FONT_SNAP.measureWidest(bad)), 'measureWidest ' + String(bad));
            assert.ok(Number.isNaN(FONT_SNAP.measureLine(bad, 0, 1, 1)), 'measureLine ' + String(bad));
        }
        // The twin: a text door that rejects strings passes every row above.
        assert.equal(FONT_SNAP.measure('AA'), 16);
        assert.equal(FONT_SNAP.measure('AA\nAA'), 32);
        assert.equal(FONT_SNAP.measureWidest('AA\nAA'), 16);
        assert.equal(FONT_SNAP.measureLine('AAAA', 0, 4, 1), 32);
        // The scale door is a RANGE test, not a NaN test: 0 and -1 are finite,
        // and `scale !== scale` cannot see them.
        for (const s of [0, -1, NaN, Infinity]) {
            assert.ok(Number.isNaN(FONT_SNAP.measure('AA', s)), 'measure scale ' + s);
            assert.ok(Number.isNaN(FONT_SNAP.measureWidest('AA', s)), 'measureWidest scale ' + s);
            assert.ok(Number.isNaN(FONT_SNAP.measureLine('AA', 0, 2, s)), 'measureLine scale ' + s);
        }
        // The twin for that: a SUBNORMAL scale is a VALID scale. It renders
        // nothing visible and returns a correct width, and a door widened to
        // reject it passes all twelve rows above.
        for (const v of [FONT_SNAP.measure('AA', 1e-45), FONT_SNAP.measureWidest('AA', 1e-45),
            FONT_SNAP.measureLine('AA', 0, 2, 1e-45)]) {
            assert.ok(Number.isFinite(v) && v >= 0, 'subnormal scale -> ' + v);
        }
        // Door ORDER: text, then scale, THEN the range. A bad scale with an empty
        // range is NaN, not 0.
        assert.ok(Number.isNaN(FONT_SNAP.measureLine('AAAA', 2, 2, -1)));
        // The renderers answer the same bad scale by drawing nothing, and the
        // asymmetry is deliberate: a renderer can decline to act, a query cannot
        // decline to answer.
        for (const s of [0, -1, NaN, Infinity]) {
            resetRec(ATLAS);
            FONT_SNAP.draw(rec, 'AAAA', 0, 0, s, 0);
            assert.equal(rec.calls, 0, 'draw scale ' + s);
        }
        // After destroy() the family throws a raw TypeError, unchanged in 1.4.0.
        const dead = new BitmapFont(ATLAS, JSON_SNAP);
        dead.destroy();
        assert.throws(() => dead.measure('AA'), TypeError);
        assert.throws(() => dead.measureWidest('AA'), TypeError);
        assert.throws(() => dead.measureLine('AA', 0, 2, 1), TypeError);
    });

    test('F-38: measureLine clamps with drawWrapped\'s TWO legs, so a NaN end measures the whole line', () => {
        // The first version of this door had FOUR legs. The extra
        // `!(end >= 0) -> 0` fired on a NaN end and drove it to 0, where the
        // renderer drives NaN to text.length and draws the whole line. A
        // layoutBuffer is a Float32Array; NaN is exactly what it holds when a
        // layout pass failed or never ran -- the caller this method exists for.
        for (const [a, b, quads] of [
            [0, NaN, 4], [NaN, NaN, 4], [1, NaN, 3], [2, NaN, 2], [NaN, 4, 4],
            [-Infinity, NaN, 4], [-Infinity, Infinity, 4], [Infinity, Infinity, 0],
            [0, -5, 0], [5, 2, 0], [-3, -1, 0], [0, 99, 4], [0, 4, 4]]) {
            resetRec(ATLAS);
            FONT_SNAP.drawWrapped(rec, 'AAAA', Float32Array.of(a, b, 32, 0), 1, 1000, 1000, 0, 0, 1, 0, 0);
            assert.equal(rec.calls, quads, 'drawWrapped [' + a + ',' + b + ')');
            assert.equal(FONT_SNAP.measureLine('AAAA', a, b, 1), quads * 8,
                'measureLine [' + a + ',' + b + ')');
        }
        // The twin: the NaN rows must not be satisfiable by "always return the
        // whole string". A negative end still measures 0, and so does the renderer.
        assert.equal(FONT_SNAP.measureLine('AAAA', 0, -5, 1), 0);
        assert.equal(FONT_SNAP.measureLine('AAAA', 2, 2, 1), 0);
        clean();
    });

    test('F-39: measureWidest can return a NEGATIVE width, because a font can have negative advances', () => {
        // A negative xadvance or kerning amount is a valid Int16 the descriptor
        // door accepts in BOTH lanes -- neither lossy nor non-finite -- so a line
        // legitimately measures negative. An accumulator seeded at 0 floored
        // every such font at 0 and made measureWidest disagree with measure on a
        // single-line string, which is the one equivalence it promises.
        assert.equal(FONT_SNAP_NEG.measure('AAA'), -30);
        assert.equal(FONT_SNAP_NEG.measureWidest('AAA'), -30);
        assert.equal(FONT_SNAP_NEG.measureWidest('AAA'), FONT_SNAP_NEG.measure('AAA'));
        // The max really is a max, not the first or the last line.
        assert.equal(FONT_SNAP_NEG.measureWidest('A\nAAA'), FONT_SNAP_NEG.measure('A'));
        // The -Infinity seed must never escape as a width, and an empty line is
        // 0 -- which is WIDER than any negative line, so these stay 0.
        assert.equal(FONT_SNAP_NEG.measureWidest(''), 0);
        assert.equal(FONT_SNAP_NEG.measureWidest('\n'), 0);
        assert.equal(FONT_SNAP_NEG.measureWidest('AAA\n'), 0);
        assert.equal(Number.isFinite(FONT_SNAP_NEG.measureWidest('AAA')), true);
        // The all-positive fixture is unaffected -- this is the twin that would
        // catch a fix which broke the ordinary case.
        assert.equal(FONT_SNAP.measureWidest('AAA\n'), 24);
        assert.equal(FONT_SNAP.measureWidest(''), 0);
    });

    test('F-41: the text door is `typeof`, so a BOXED String is rejected', () => {
        // Deliberate, not an oversight. The looser "has a length and a
        // charCodeAt" test admits {length: Infinity, charCodeAt(){...}}, which
        // does not terminate -- so the door is exact and a String OBJECT is a
        // non-string. Documented rather than merely intended.
        assert.ok(Number.isNaN(FONT_SNAP.measure(new String('AAA'))));
        assert.ok(Number.isNaN(FONT_SNAP.measureWidest(new String('AAA'))));
        assert.ok(Number.isNaN(FONT_SNAP.measureLine(new String('AAA'), 0, 3, 1)));
        // The primitive twin, so the row cannot be passed by rejecting everything.
        assert.equal(FONT_SNAP.measure('AAA'), 24);
        assert.equal(FONT_SNAP.measureWidest('AAA'), 24);
        assert.equal(FONT_SNAP.measureLine('AAA', 0, 3, 1), 24);
    });
});
