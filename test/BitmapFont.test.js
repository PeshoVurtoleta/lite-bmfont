import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { BitmapFont, BitmapFontError, DRAWFAST_MAX } from '../BitmapFont.js';
import {
    rec, resetRec, ATLAS,
    FONT_ASCII, FONT_NUM, FONT_GAP, FONT_NL, JSON_ASCII, JSON_GAP, oracleAdvance,
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
        // finite out of range is CHECKED, not always-throw.
        assert.doesNotThrow(() => new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ id: 3000 })] })));
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

    test('F-08: unchecked, x 40000 stores -25536 and xadvance 8.6 gives measure(AA) === 16 against an exact 17.2', () => {
        // The semver guarantee in test form: unchecked storage is byte-identical to 1.2.x.
        resetRec(ATLAS);
        const fx = new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ x: 40000 })] }));
        assert.equal(fx.glyphs[65 * 7], -25536);
        const fa = new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ xadvance: 8.6 })] }));
        assert.equal(fa.measure('AA'), 16);
        assert.equal(8.6 * 2, 17.2);            // exact double the store loses
        // F-33: the checked-lane message says "truncates toward zero" (block below);
        // pin the BEHAVIOUR that wording describes, or the message could lie if the
        // store ever floored. -8.6 stores -8 (toward zero), never -9 (floor).
        const fn = new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ xadvance: -8.6 })] }));
        assert.equal(fn.glyphs[65 * 7 + 6], -8);
        clean();
    });

    test('F-08: checked, the same two throw naming the exact stored value and the drift', () => {
        // Not constructible on 1.2.3 (no checked mode).
        resetRec(ATLAS);
        assert.throws(() => new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ x: 40000 })] }), { checked: true }),
            (e) => e instanceof BitmapFontError && e.message.includes('40000') && e.message.includes('-25536'));
        assert.throws(() => new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ xadvance: -8.6 })] }), { checked: true }),
            (e) => e instanceof BitmapFontError && e.message.includes('toward zero') && !e.message.includes('floor'));
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
        const f = new BitmapFont(ATLAS, mkFont({ kernings: [{ first: -1, second: 65, amount: -2 }] }));
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
        clean();
    });
});
