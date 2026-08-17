/**
 * T2 -- the layout-buffer abuse matrix (M2). Every decided policy for drawWrapped
 * under a hostile layout buffer: a clamp, a throw, or a documented no-op -- never
 * "silently draws a line at NaN".
 *
 * Base fixture: FONT_ASCII, text 'HELLO' (5 glyphs, advance 12, no kerning),
 * layout Float32Array.of(0, 5, 60, 0), lineCount 1,
 * drawWrapped(rec, text, layout, lineCount, 1000, 1000, 0, 0, 1, 0, 0).
 * Clean dx: 0, 12, 24, 36, 48. Every row asserts nanScan()===0, rec.dropped===0,
 * rec.imgMismatch===0. No profiler call, no new ctx shape. Every `assert.throws`
 * carries its non-vacuity twin (a throwing case AND a non-throwing case), because
 * an always-throwing door passes a throws-assertion and silently breaks row 1.
 * Tier budget < 3000 ms -- row 7's unclamped endIdx loop is what it catches.
 *
 * NOTE where a measured number corrects the brief: row 12's ellipsis dots land at
 * dx 60, 72, 84, not 60, 66, 72. The brief assumed a dot xadvance of 6; FONT_ASCII
 * gives id 46 (like every id 33..126) xadvance 12. The measurement is authoritative.
 */

import {
    check, nanScan, rec, resetRec, ATLAS,
    FONT_ASCII, FONT_NL, JSON_ASCII, WRAP_TEXT, WRAP_LAYOUT,
} from './harness.mjs';
import { BitmapFont } from '../../BitmapFont.js';

const TEXT = 'HELLO';
const CLEAN_DX = [0, 12, 24, 36, 48];
// A { checked: true } sibling of FONT_ASCII, built ONCE at module scope (harness
// rule 1). Only row 14b uses it -- the checked lane throws on unknown flag bits.
const FONT_ASCII_CHECKED = new BitmapFont(ATLAS, JSON_ASCII, { checked: true });

/** Assert the clean 5-glyph column and the three tier-wide invariants. */
function cleanColumn(label) {
    check(rec.calls === 5, () => 'T2/' + label + ': calls ' + rec.calls + ' != 5');
    for (let g = 0; g < 5; g++) {
        check(rec.dx[g] === CLEAN_DX[g],
            () => 'T2/' + label + ': dx[' + g + '] ' + rec.dx[g] + ' != ' + CLEAN_DX[g]);
    }
}
function invariants(label) {
    check(nanScan() === 0, () => 'T2/' + label + ': nanScan ' + nanScan() + ' != 0');
    check(rec.dropped === 0 && rec.imgMismatch === 0,
        () => 'T2/' + label + ': dropped ' + rec.dropped + ' imgMismatch ' + rec.imgMismatch);
}
/** Run a drawWrapped with the base scalars and a given layout/lineCount. */
function wrap(layout, lineCount, boxW = 1000, boxH = 1000) {
    resetRec(ATLAS);
    FONT_ASCII.drawWrapped(rec, TEXT, layout, lineCount, boxW, boxH, 0, 0, 1, 0, 0);
}

export function run() {
    const t2start = Date.now();

    // row 1: exact lineCount*4 buffer -- the happy path.
    wrap(Float32Array.of(0, 5, 60, 0), 1);
    cleanColumn('1'); invariants('1');

    // row 2: oversized buffer (32 floats, lineCount 1) -- surplus IGNORED, no throw.
    // Killed by a bounds check written `!==` instead of `>` (rejects every reusable
    // buffer, the package's own documented pattern).
    {
        const big = new Float32Array(32); big[0] = 0; big[1] = 5; big[2] = 60; big[3] = 0;
        let threw = false;
        try { wrap(big, 1); } catch { threw = true; }
        check(!threw, () => 'T2/2: oversized buffer threw');
        check(big.length === 32, () => 'T2/2: buffer length changed');
        cleanColumn('2'); invariants('2');
    }

    // row 3: lineCount === 0 -- early return, 0 calls.
    wrap(Float32Array.of(0, 5, 60, 0), 0);
    check(rec.calls === 0, () => 'T2/3: lineCount 0 drew ' + rec.calls);
    invariants('3');

    // row 4: lineCount*4 > layoutBuffer.length -- THROW naming both numbers, with
    // its non-vacuity twin (the SAME buffer at lineCount 1 does NOT throw and draws
    // 5). Killed either way: throw deleted -> row goes silent; throw made
    // unconditional -> the twin's assert fails.
    {
        const shortBuf = Float32Array.of(0, 5, 60, 0);   // length 4
        let msg = null;
        try { wrap(shortBuf, 3); } catch (e) { msg = e instanceof RangeError ? e.message : String(e); }
        check(msg !== null && msg.includes('4') && msg.includes('12'),
            () => 'T2/4: expected RangeError naming 4 and 12, got ' + msg);
        // twin: same buffer, lineCount 1 -> no throw, 5 glyphs.
        let threw = false;
        try { wrap(shortBuf, 1); } catch { threw = true; }
        check(!threw, () => 'T2/4-twin: correctly-sized call threw');
        cleanColumn('4-twin'); invariants('4-twin');
    }

    // row 5: startIdx = -1 -> CLAMP to 0. 5 calls, clean column, and the same
    // buffer with start 0 gives the identical column.
    wrap(Float32Array.of(-1, 5, 40, 0), 1);
    cleanColumn('5'); invariants('5');
    const dxNeg = Array.from(rec.dx.slice(0, 5));
    wrap(Float32Array.of(0, 5, 40, 0), 1);
    for (let g = 0; g < 5; g++) {
        check(rec.dx[g] === dxNeg[g], () => 'T2/5: start -1 column != start 0 column at ' + g);
    }
    invariants('5b');

    // row 6: startIdx = 0.5 -> TRUNCATED (not floored), identical to start 0.
    // Killed by a Math.floor "for tidiness" -- harmless output, but the row proves
    // the contract is truncation so docs and code cannot drift.
    wrap(Float32Array.of(0.5, 5, 60, 0), 1);
    cleanColumn('6'); invariants('6');

    // row 7: endIdx = 1e9 (> text.length) -> CLAMP to text.length. 5 calls, and the
    // whole tier finishes inside its 3000 ms budget. Deleting the endIdx clamp turns
    // this into a billion-iteration loop -- the budget assertion at tier end is the
    // ONLY thing that sees it (the F-03 guard already skips the out-of-range codes,
    // so a call-count assertion cannot).
    wrap(Float32Array.of(0, 1e9, 60, 0), 1);
    cleanColumn('7'); invariants('7');

    // row 8: endIdx < startIdx (4, 1) -> empty line, 0 calls, no throw.
    // Killed by rewriting the glyph loop as a do..while.
    {
        let threw = false;
        try { wrap(Float32Array.of(4, 1, 60, 0), 1); } catch { threw = true; }
        check(!threw, () => 'T2/8: empty line threw');
        check(rec.calls === 0, () => 'T2/8: endIdx<startIdx drew ' + rec.calls);
        invariants('8');
    }

    // row 9: startIdx = NaN -> CLAMP to 0. Killed by writing the clamp `startIdx < 0`
    // (NaN passes `< 0` as false, so NaN leaks through).
    wrap(Float32Array.of(NaN, 5, 60, 0), 1);
    cleanColumn('9'); invariants('9');

    // row 10: endIdx = NaN -> CLAMP to text.length. Killed by writing `endIdx > tlen`.
    wrap(Float32Array.of(0, NaN, 60, 0), 1);
    cleanColumn('10'); invariants('10');

    // row 11: flags = 0 -> no ellipsis, 5 calls.
    wrap(Float32Array.of(0, 5, 60, 0), 1);
    check(rec.calls === 5, () => 'T2/11: flags 0 drew ' + rec.calls);
    invariants('11');

    // row 12: flags = 1 -> 8 calls (5 letters + 3 dots). Dots at dx 60, 72, 84
    // (FONT_ASCII '.' xadvance 12). Killed by deleting the ellipsis block or the
    // prevId kern-to-dot.
    wrap(Float32Array.of(0, 5, 60, 1), 1);
    check(rec.calls === 8, () => 'T2/12: flags 1 drew ' + rec.calls + ' != 8');
    check(rec.dx[5] === 60 && rec.dx[6] === 72 && rec.dx[7] === 84,
        () => 'T2/12: dots at ' + rec.dx[5] + ',' + rec.dx[6] + ',' + rec.dx[7] + ' != 60,72,84');
    invariants('12');

    // row 13: flags = 1.0000001 -> 8 calls. FIXED in M3 (F-13, decisions/0003
    // fork 8): the flags word is ToInt32'd, so (1.0000001192092896 | 0) === 1 and
    // the ellipsis now FIRES where a strict `=== 1` missed it. Dots land at
    // 60, 72, 84 (row 12's numbers). MEASURED before 5 / after 8. Killed by
    // reverting (flags|0) & FLAG_ELLIPSIS to a strict compare against 1.
    wrap(Float32Array.of(0, 5, 60, 1.0000001), 1);
    check(rec.calls === 8, () => 'T2/13: flags 1.0000001 drew ' + rec.calls + ' != 8 (ellipsis must fire, F-13/M3)');
    check(rec.dx[5] === 60 && rec.dx[6] === 72 && rec.dx[7] === 84,
        () => 'T2/13: dots at ' + rec.dx[5] + ',' + rec.dx[6] + ',' + rec.dx[7] + ' != 60,72,84');
    invariants('13');

    // row 14: flags = 2 and NaN -> 5 calls each, UNCHANGED. `2 & 1 === 0` and
    // `NaN | 0 === 0`, so neither sets the ellipsis bit. SPLIT from `-1` (row 14a)
    // deliberately: folding all three into one loop with -1's new count would stop
    // pinning 2 and NaN at all -- that is risk (f), and the split is the fix.
    for (const f of [2, NaN]) {
        wrap(Float32Array.of(0, 5, 60, f), 1);
        check(rec.calls === 5, () => 'T2/14: flags ' + f + ' drew ' + rec.calls + ' != 5');
        invariants('14[' + f + ']');
    }

    // row 14a: flags = -1 -> 8 calls (was 5 on 1.2.3). DECLARED BEHAVIOUR DELTA
    // (decisions/0003 fork 8, CHANGELOG "Changed"): -1 | 0 === -1 and -1 & 1 === 1,
    // so the ellipsis now fires. MEASURED before 5 / after 8. Killed by reverting
    // the mask.
    wrap(Float32Array.of(0, 5, 60, -1), 1);
    check(rec.calls === 8, () => 'T2/14a: flags -1 drew ' + rec.calls + ' != 8 (declared delta, ellipsis fires)');
    check(rec.dx[5] === 60 && rec.dx[6] === 72 && rec.dx[7] === 84,
        () => 'T2/14a: dots at ' + rec.dx[5] + ',' + rec.dx[6] + ',' + rec.dx[7] + ' != 60,72,84');
    invariants('14a');

    // row 14b: the checked lane. A { checked: true } font THROWS on an unknown
    // flag bit (2), naming the mask and the value; the same font with flags 1 does
    // not (the twin). Unknown flags stop being silent under checked (decisions/0003
    // fork 8). Killed by deleting the checked mask test in drawWrapped.
    {
        let msg = null;
        try {
            resetRec(ATLAS);
            FONT_ASCII_CHECKED.drawWrapped(rec, TEXT, Float32Array.of(0, 5, 60, 2), 1, 1000, 1000, 0, 0, 1, 0, 0);
        } catch (e) { msg = e instanceof RangeError ? e.message : String(e); }
        check(msg !== null && msg.includes('2') && msg.includes('mask'),
            () => 'T2/14b: checked flags 2 did not throw naming the mask and value, got ' + msg);
        let threw = false;
        try {
            resetRec(ATLAS);
            FONT_ASCII_CHECKED.drawWrapped(rec, TEXT, Float32Array.of(0, 5, 60, 1), 1, 1000, 1000, 0, 0, 1, 0, 0);
        } catch { threw = true; }
        check(!threw, () => 'T2/14b-twin: checked flags 1 threw');
        check(rec.calls === 8, () => 'T2/14b-twin: checked flags 1 drew ' + rec.calls + ' != 8');
        invariants('14b-twin');
    }

    // row 15: lineCount = 0.5 -> floor to 0, draw NOTHING. Killed by deleting Math.floor.
    wrap(Float32Array.of(0, 5, 60, 0), 0.5);
    check(rec.calls === 0, () => 'T2/15: lineCount 0.5 drew ' + rec.calls + ' != 0');
    invariants('15');

    // row 16: lineCount = 1.5 -> floor to 1 line (unchanged output). Killed by Math.ceil.
    wrap(Float32Array.of(0, 5, 60, 0), 1.5);
    cleanColumn('16'); invariants('16');

    // row 17: lineCount = -1 -> clamp to 0. Killed by writing `!(lineCount >= 1)` as
    // `lineCount === 0` (a negative would fall through to the loop).
    wrap(Float32Array.of(0, 5, 60, 0), -1);
    check(rec.calls === 0, () => 'T2/17: lineCount -1 drew ' + rec.calls + ' != 0');
    invariants('17');

    // row 18: lineCount = NaN -> clamp to 0. Same kill as 17 (NaN === 0 is false).
    wrap(Float32Array.of(0, 5, 60, 0), NaN);
    check(rec.calls === 0, () => 'T2/18: lineCount NaN drew ' + rec.calls + ' != 0');
    invariants('18');

    // row 19: layoutBuffer a Float64Array -> accepted, dx identical to row 1.
    // Killed by `.length` replaced with `byteLength / 4` (halves Float64 capacity).
    wrap(Float64Array.of(0, 5, 60, 0), 1);
    cleanColumn('19'); invariants('19');

    // row 20: layoutBuffer a plain Array -> accepted, dx identical to row 1. This is
    // what makes row 4's throw HONEST: `.length` replaced by `byteLength` (undefined
    // on an Array) makes `n*4 > undefined` false, the door goes vacuous, and row 4
    // passes for the wrong reason.
    wrap([0, 5, 60, 0], 1);
    cleanColumn('20'); invariants('20');

    // row 21: id 10 inside a line range (FONT_NL, 'AB\nC', [0,4,36,0]) -> advance 0,
    // draws nothing, NOT a line break. 3 calls, dx 0,12,24. Killed by not zeroing
    // id 10's width/height (H6) -> the newline draws and calls go to 4.
    resetRec(ATLAS);
    FONT_NL.drawWrapped(rec, 'AB\nC', Float32Array.of(0, 4, 36, 0), 1, 1000, 1000, 0, 0, 1, 0, 0);
    check(rec.calls === 3 && rec.dx[0] === 0 && rec.dx[1] === 12 && rec.dx[2] === 24,
        () => 'T2/21: FONT_NL AB\\nC ' + rec.calls + ' [' + rec.dx[0] + ',' + rec.dx[1] + ',' + rec.dx[2] + '] != 3 [0,12,24]');
    invariants('21');

    // row 22: 8-line WRAP_LAYOUT, vAlign 2, lineCount 7.5 -> floor to 7 for BOTH the
    // loop AND totalHeight (the H12 third edit). 7 lines x 8 glyphs = 56 calls, and
    // dy[0] equals the lineCount 7 value exactly. Killed by leaving totalHeight
    // reading lineCount -> every line shifts by half a lineHeight.
    resetRec(ATLAS);
    FONT_ASCII.drawWrapped(rec, WRAP_TEXT, WRAP_LAYOUT, 7.5, 100, 200, 0, 0, 1, 0, 2);
    const calls75 = rec.calls, dy75 = rec.dy[0];
    resetRec(ATLAS);
    FONT_ASCII.drawWrapped(rec, WRAP_TEXT, WRAP_LAYOUT, 7, 100, 200, 0, 0, 1, 0, 2);
    check(calls75 === 56, () => 'T2/22: lineCount 7.5 drew ' + calls75 + ' != 56 (7 lines x 8)');
    check(dy75 === rec.dy[0],
        () => 'T2/22: lineCount 7.5 dy[0] ' + dy75 + ' != lineCount 7 dy[0] ' + rec.dy[0] + ' (totalHeight used 7.5?)');
    invariants('22');

    // Tier-wide budget (row 25).
    const elapsed = Date.now() - t2start;
    check(elapsed < 3000, () => 'T2: tier wall clock ' + elapsed + ' ms >= 3000 (row 7 unclamped loop?)');
}
