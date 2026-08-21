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
    check, nanScan, rec, resetRec, die, ATLAS,
    FONT_ASCII, FONT_NL, JSON_ASCII, WRAP_TEXT, WRAP_LAYOUT,
} from './harness.mjs';
import { BitmapFont } from '../../BitmapFont.js';
import { spawnSync } from 'node:child_process';
import {
    PEER_VERSION, PARAGRAPH, BOX_WIDTH, SCALES, ROWS,
} from './fixtures/wrap-lineWidth.mjs';

const TEXT = 'HELLO';
const CLEAN_DX = [0, 12, 24, 36, 48];
// A { checked: true } sibling of FONT_ASCII, built ONCE at module scope (harness
// rule 1). Only row 14b uses it -- the checked lane throws on unknown flag bits.
const FONT_ASCII_CHECKED = new BitmapFont(ATLAS, JSON_ASCII, { checked: true });
// 0012 fork 6: checked defaults ON, so FONT_ASCII (the shared fixture) now THROWS
// on an unknown flag bit. Rows 14/14a assert the SILENT-IGNORE lane, which is now
// the opt-out; this is its font. Built once at module scope (harness rule 1).
const FONT_ASCII_UNCHECKED = new BitmapFont(ATLAS, JSON_ASCII, { checked: false });
function wrapU(layout, lineCount) {
    resetRec(ATLAS);
    FONT_ASCII_UNCHECKED.drawWrapped(rec, TEXT, layout, lineCount, 1000, 1000, 0, 0, 1, 0, 0);
}

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
/** Run a drawWrapped with the base scalars and a given layout/lineCount.
 * `scale`/`align` default to 1/0 so every pre-M2a row stays byte-identical --
 * the align matrix below (F-45) is the only caller that passes anything else. */
function wrap(layout, lineCount, boxW = 1000, boxH = 1000, scale = 1, align = 0) {
    resetRec(ATLAS);
    FONT_ASCII.drawWrapped(rec, TEXT, layout, lineCount, boxW, boxH, 0, 0, scale, align, 0);
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

    // row 14: flags = 2 and NaN -> 5 calls each on the UNCHECKED font. `2 & 1 === 0`
    // and `NaN | 0 === 0`, so neither sets the ellipsis bit. 0012 fork 6: the DEFAULT
    // font (checked) now THROWS on the unknown bit 2 (row 14b); silent-ignore is the
    // opt-out lane, so this row moved to FONT_ASCII_UNCHECKED. NaN carries no unknown
    // bit (NaN|0 === 0) so it is silent in BOTH lanes.
    for (const f of [2, NaN]) {
        wrapU(Float32Array.of(0, 5, 60, f), 1);
        check(rec.calls === 5, () => 'T2/14: flags ' + f + ' (unchecked) drew ' + rec.calls + ' != 5');
        invariants('14[' + f + ']');
    }

    // row 14a: flags = -1 -> 8 calls (was 5 on 1.2.3). DECLARED BEHAVIOUR DELTA
    // (decisions/0003 fork 8, CHANGELOG "Changed"): -1 | 0 === -1 and -1 & 1 === 1,
    // so the ellipsis now fires. MEASURED before 5 / after 8. Killed by reverting
    // the mask.
    // UNCHECKED: -1 | 0 === -1, -1 & 1 === 1, ellipsis fires. Under checked the same
    // -1 THROWS now (F-49: -1 has bits outside the mask), so this is the opt-out lane.
    wrapU(Float32Array.of(0, 5, 60, -1), 1);
    check(rec.calls === 8, () => 'T2/14a: flags -1 (unchecked) drew ' + rec.calls + ' != 8 (declared delta, ellipsis fires)');
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
        // F-49 (0012 fork 4): flags = 3 has bit 0 SET (ellipsis) AND bit 1 unknown.
        // The mask test used to sit in the `else` of the ellipsis branch, so odd
        // flags skipped it and 3 was SILENT. Hoisted, it throws. Killed by moving
        // the mask test back into the else -- 3 goes silent, this reddens.
        let msg3 = null;
        try {
            resetRec(ATLAS);
            FONT_ASCII_CHECKED.drawWrapped(rec, TEXT, Float32Array.of(0, 5, 60, 3), 1, 1000, 1000, 0, 0, 1, 0, 0);
        } catch (e) { msg3 = e instanceof RangeError ? e.message : String(e); }
        check(msg3 !== null && msg3.includes('mask'),
            () => 'T2/14b/F-49: checked flags 3 (bit 0 set) did not throw -- the else-if hole is back, got ' + msg3);
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

    // rows 23a-23i: THE F-45 ALIGN MATRIX -- {scale 0.5, 1, 2} x {align 0, 1, 2}.
    // Before M2a this whole surface was UNCOVERED: wrap() hardcoded align 0, so
    // every centre/right line at scale != 1 was double-scaled and unseen. The
    // oracle is the per-line `draw`: drawWrapped centres a line inside `boxWidth`
    // at container x, and draw centres a line AROUND its x by subtracting half
    // its own measured width -- so `draw(TEXT, x + [0, BW/2, BW][align], ...)`
    // lands the same glyphs iff drawWrapped compares rendered px to rendered px.
    // `draw` reads NO buffer lineWidth (F-45: 0 occurrences in its body), so
    // reinstating `lineWidth * scale` moves drawWrapped and NOT the oracle -- the
    // detector reddens. align 0 is UNCHANGED by the fix at every scale; asserting
    // it is what lets the matrix tell "alignment fixed" from "all X shifted".
    const MBOX = 200;                 // rendered-px box for the matrix
    const MLINE = TEXT.length * 12;   // HELLO: 5 glyphs advance 12, scale-1 width
    const XOFF = [0, MBOX / 2, MBOX]; // draw-oracle x per align: left/centre/right
    for (const scale of [0.5, 1, 2]) {
        const lineWidth = MLINE * scale;   // the RENDERED-scale width the producer emits
        const buf = Float32Array.of(0, TEXT.length, lineWidth, 0);
        for (let align = 0; align < 3; align++) {
            // drawWrapped: one centred/aligned line in the box.
            resetRec(ATLAS);
            FONT_ASCII.drawWrapped(rec, TEXT, buf, 1, MBOX, 1000, 0, 0, scale, align, 0);
            const got = rec.dx.slice(0, rec.calls);
            const gotCalls = rec.calls;
            // oracle: the same slice through draw at the matching origin.
            resetRec(ATLAS);
            FONT_ASCII.draw(rec, TEXT, XOFF[align], 0, scale, align);
            const lbl = 'scale ' + scale + ' align ' + align;
            check(rec.calls === gotCalls,
                () => 'T2/matrix ' + lbl + ': drawWrapped drew ' + gotCalls +
                      ' glyphs, draw oracle drew ' + rec.calls);
            for (let g = 0; g < rec.calls; g++) {
                check(got[g] === rec.dx[g],
                    () => 'T2/matrix ' + lbl + ': dx[' + g + '] drawWrapped ' + got[g] +
                          ' != draw oracle ' + rec.dx[g] +
                          ' (reinstated lineWidth * scale? see F-45)');
            }
            invariants('matrix ' + lbl);
        }
    }
    // The two named detector cells, pinned as literals so a reader sees the
    // numbers directly (first glyph dst x, xoffset 0; HELLO rendered width at
    // scale 2 is 120 in a 200-px box). Before the fix the double-scale gave
    // (200 - 240)/2 = -20 centre and 200 - 240 = -40 right; the fix gives
    // (200 - 120)/2 = 40 and 200 - 120 = 80, matching the draw oracle.
    wrap(Float32Array.of(0, TEXT.length, MLINE * 2, 0), 1, MBOX, 1000, 2, 1);
    check(rec.dx[0] === 40, () => 'T2/matrix scale 2 align 1: first dx ' + rec.dx[0] + ' != 40');
    wrap(Float32Array.of(0, TEXT.length, MLINE * 2, 0), 1, MBOX, 1000, 2, 2);
    check(rec.dx[0] === 80, () => 'T2/matrix scale 2 align 2: first dx ' + rec.dx[0] + ' != 80');

    // rows 24: LANE 1 (F-45, decisions/0006 D-3) -- END TO END against the FROZEN
    // computeWrap fixture. For every committed layout at scale 0.5/1/2, centre and
    // right, drawWrapped must be glyph-for-glyph identical to the per-line `draw`
    // oracle. `draw` reads no buffer lineWidth, so a reinstated `* scale` moves
    // drawWrapped and not the oracle. This lane ALWAYS runs -- no dependency.
    {
        // A3 twin: at least one MULTI-line layout at scale != 1, or the per-line
        // loop is never exercised and the fixture proves nothing about wrapping.
        check(ROWS[2].length >= 2,
            () => 'T2/lane1: the scale-2 fixture is single-line (' + ROWS[2].length +
                  ' rows) -- the multi-line path is uncovered');
        const OX = [0, BOX_WIDTH / 2, BOX_WIDTH];   // draw-oracle x per align
        for (const scale of SCALES) {
            const rows = ROWS[scale];
            const flat = new Float32Array(rows.length * 4);
            for (let l = 0; l < rows.length; l++) {
                flat[l * 4] = rows[l][0]; flat[l * 4 + 1] = rows[l][1];
                flat[l * 4 + 2] = rows[l][2]; flat[l * 4 + 3] = rows[l][3];
            }
            for (const align of [1, 2]) {
                resetRec(ATLAS);
                FONT_ASCII.drawWrapped(rec, PARAGRAPH, flat, rows.length, BOX_WIDTH, 1000, 0, 0, scale, align, 0);
                const wCalls = rec.calls;
                const wdx = rec.dx.slice(0, wCalls);
                // Rebuild the oracle: each committed line drawn on its own at the
                // matching container origin.
                let k = 0;
                let ok = true;
                for (const [s, e] of rows) {
                    resetRec(ATLAS);
                    FONT_ASCII.draw(rec, PARAGRAPH.slice(s, e), OX[align], 0, scale, align);
                    for (let g = 0; g < rec.calls; g++) {
                        if (k >= wCalls || wdx[k] !== rec.dx[g]) ok = false;
                        k++;
                    }
                }
                const lbl = 'scale ' + scale + ' align ' + align;
                check(ok && k === wCalls,
                    () => 'T2/lane1 ' + lbl + ': drawWrapped disagrees with the per-line ' +
                          'draw oracle (fixture ' + PEER_VERSION + '; reinstated lineWidth * scale?)');
                invariants('lane1 ' + lbl);
            }
        }
    }

    // rows 24b: LANE 2 (the peer DRIFT GUARD) is DEFERRED TO M9b (0012 fork 8).
    // Measured 2026-08-21: `@zakkster/lite-text-layout` resolves to an npm-INSTALLED
    // `@zakkster/lite-bmfont@1.6.0`, NOT this working tree, and its devDependency is
    // `^1.6.0`, which will NOT accept 2.0.0. So the 2.0.0 store format cannot reach
    // the peer through semver, and there is no cross-repo breakage to guard in M9a.
    // Feeding a 2.0.0-format font (this tree) through the installed 1.x peer -- which
    // reads `glyphs[id*7+6] * scale` raw at 5 hot sites -- is a deliberately
    // mismatched pair that drifts by design (the peer sees 16x advances). M9b rebuilds
    // BOTH lanes: lane 1 a stamped export fixture (FORMAT_VERSION/GLYPH_STRIDE/
    // GLYPH_ADVANCE_SCALE/kern key/quad stride) that always runs, lane 2 the installed
    // peer read that FAILS -- never skips -- if absent or disagreeing. This is NOT a
    // silent skip: the guard is explicitly owned by M9b's fork 8 and named here so it
    // cannot be forgotten. Lane 1 (rows 24, above) still runs against the frozen
    // fixture every session.

    // Tier-wide budget (row 25).
    const elapsed = Date.now() - t2start;
    check(elapsed < 3000, () => 'T2: tier wall clock ' + elapsed + ' ms >= 3000 (row 7 unclamped loop?)');
}
