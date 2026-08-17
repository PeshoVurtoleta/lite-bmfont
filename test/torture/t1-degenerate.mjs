/**
 * T1 -- the degenerate sweep. Pins the ACTUAL answer today, including the ugly
 * ones, for every entry point crossed with degenerate inputs.
 *
 * The nanScan rule (ROADMAP section 3: nanScan()===0 always) is FALSE on
 * unmodified v1.2.0 for a handful of inputs, and M0 may not fix them. So T1
 * splits:
 *   - CLEAN lane: every NaN-free degenerate input asserts nanScan()===0,
 *     dropped===0, imgMismatch===0.
 *   - FINDING lane: an enumerated table of pinned-bad cases, each an EQUALITY on
 *     its exact NaN/call count so the pin fails in BOTH directions -- red if the
 *     bug worsens, red again when the owning session fixes it.
 *
 * Two hazards drive what the CLEAN lane may contain:
 *   - drawFast(value) MUST NEVER see a magnitude above 1e21 (section 7(a)):
 *     Number.MAX_VALUE triggers F-01, an UNKILLABLE infinite loop (value*10
 *     overflows to Infinity, `while (temp > 0)` never ends -- no stack to
 *     overflow, no timeout to save the run). 1e22 does not hang but emits 24 NaN
 *     quads (F-02). Both are excluded here and deferred to M1's T4, which ships
 *     the magnitude door + a 2s watchdog. DO NOT "complete" this column.
 *   - scale === Infinity and scale === NaN poison a draw's dx/dy/dw/dh
 *     (xoffset*Infinity = NaN, Inf-Inf = NaN). As of M3 (F-11, decisions/0003
 *     fork 5) the three draw bodies carry a per-call range door
 *     `if (!(scale > 0 && scale < Infinity)) return;`, so a NaN, 0, negative or
 *     Infinity scale now draws NOTHING and the F-11 pin below is INVERTED to
 *     0 calls / nanScan 0. measure()/_measureRange keep NO door (five pins
 *     below), so scale===Infinity there still returns a non-finite number.
 *
 * The value arrays are module-level typed arrays; the layout buffers are
 * pre-built Float32Arrays. T1 makes no profiler call.
 */

import { rec, resetRec, nanScan, check, FONT_ASCII, FONT_NUM, ATLAS } from './harness.mjs';

// Degenerate positions (x / y). No NaN: x===NaN poisons dx and is not an
// enumerated finding. 1e22 / MAX_VALUE are safe AS A POSITION (only drawFast's
// VALUE hangs), so they stay in.
const CLEAN_XY = Float64Array.of(
    0, -0, Infinity, -Infinity, 1e21, 1e22, Number.MAX_VALUE, Number.MIN_VALUE,
    2 ** 53, -1, 0.5, -0.5, 1e10,
);

// Draw-safe scales: no NaN (F-11), no Infinity (0*Infinity = NaN).
const CLEAN_SCALE = Float64Array.of(0, -1, 0.5, 1e-45, 1e10);

// Unvalidated aligns (F-11): all render LEFT, none produce a NaN (NaN!==1 and
// NaN!==2, so NaN falls through to the left branch too).
const ALIGN_VALS = Float64Array.of(-1, 3, 1.5, NaN);

// drawFast values that DRAW: finite, magnitude <= 1e21. NEVER 1e22 / MAX_VALUE.
const DRAWFAST_VALS = Float64Array.of(0, -0, -1, -5, 0.5, 1.4, 33.49, 1e6, 1e15, 1e20, 1e21);
// drawFast values that RETURN EARLY (0 calls).
const DRAWFAST_EARLY = Float64Array.of(NaN, Infinity, -Infinity);

// Pre-built layout buffers.
const LAYOUT_OK = Float32Array.of(0, 3, 36, 0);           // one line, 'ABC'
const LAYOUT_F04 = Float32Array.of(-1, 5, 40, 0);         // startIdx < 0 (F-04)
const LAYOUT_F05 = Float32Array.of(0, 5, 40, 0);          // one line only, used with lineCount 3

function clean(label) {
    check(nanScan() === 0, () => 'T1/clean ' + label + ': nanScan ' + nanScan() + ' != 0');
    check(rec.dropped === 0, () => 'T1/clean ' + label + ': dropped ' + rec.dropped);
    check(rec.imgMismatch === 0, () => 'T1/clean ' + label + ': imgMismatch ' + rec.imgMismatch);
}

export function run() {
    // --- CLEAN lane: draw() position sweeps (scale 1, align 0) ------------------
    for (let i = 0; i < CLEAN_XY.length; i++) {
        resetRec(ATLAS); FONT_ASCII.draw(rec, 'ABC', CLEAN_XY[i], 0, 1, 0); clean('x[' + i + ']');
        resetRec(ATLAS); FONT_ASCII.draw(rec, 'ABC', 0, CLEAN_XY[i], 1, 0); clean('y[' + i + ']');
    }

    // --- CLEAN lane: draw() scale sweep -----------------------------------------
    // M3 (F-11, decisions/0003 fork 5): CLEAN_SCALE is [0, -1, 0.5, 1e-45, 1e10].
    // With the scale door, 0 and -1 now draw 0 calls (were 3 each on 1.2.3) and
    // 0.5 / 1e-45 / 1e10 still draw 3. clean() only asserts NaN-freedom, which
    // holds either way, so this row does not redden -- but the count changed, and
    // that shift is pinned with equalities in T3 rows 41-43 and 43b, not here.
    for (let i = 0; i < CLEAN_SCALE.length; i++) {
        resetRec(ATLAS); FONT_ASCII.draw(rec, 'ABC', 0, 0, CLEAN_SCALE[i], 0); clean('scale[' + i + ']');
    }

    // --- CLEAN lane: draw() align sweep -- all render LEFT, all NaN-free ---------
    // M3 (decisions/0003 fork 6): out-of-range align is the DOCUMENTED CONTRACT,
    // not a defect. `align` 3, -1, 1.5 and NaN all fall through to the left branch
    // (NaN !== 1 and NaN !== 2), render 3 glyphs at dx[0] === 0, and produce no
    // NaN. This row is now the pin OF THAT CONTRACT: choosing "throw" for
    // out-of-range align reddens it, which is fork 6's cheapest evidence.
    for (let i = 0; i < ALIGN_VALS.length; i++) {
        resetRec(ATLAS);
        FONT_ASCII.draw(rec, 'ABC', 0, 0, 1, ALIGN_VALS[i]);
        clean('align[' + i + ']');
        check(rec.calls === 3, () => 'T1/clean align[' + i + ']: calls ' + rec.calls + ' != 3');
        check(rec.dx[0] === 0, () => 'T1/clean align[' + i + ']: out-of-range align did not render left');
    }

    // --- CLEAN lane: empty string draws nothing ---------------------------------
    resetRec(ATLAS); FONT_ASCII.draw(rec, '', 0, 0, 1, 0);
    check(rec.calls === 0, () => 'T1/clean empty: draw("") drew ' + rec.calls);
    clean('empty');

    // --- CLEAN lane: drawFast finite values (magnitude <= 1e21) ------------------
    for (let i = 0; i < DRAWFAST_VALS.length; i++) {
        resetRec(ATLAS);
        FONT_NUM.drawFast(rec, DRAWFAST_VALS[i], 0, 0);
        clean('drawFast[' + i + ']');
        check(rec.calls >= 3, () => 'T1/clean drawFast[' + i + ']: only ' + rec.calls + ' glyphs');
    }
    // drawFast early-return values: no draw at all.
    for (let i = 0; i < DRAWFAST_EARLY.length; i++) {
        resetRec(ATLAS);
        FONT_NUM.drawFast(rec, DRAWFAST_EARLY[i], 0, 0);
        check(rec.calls === 0, () => 'T1/clean drawFastEarly[' + i + ']: drew ' + rec.calls);
        clean('drawFastEarly[' + i + ']');
    }
    // _charScratch never grew: 1e21 is the exact-fit boundary (24 chars into 24 bytes).
    check(FONT_NUM._charScratch.byteLength === 24,
        () => 'T1: _charScratch grew to ' + FONT_NUM._charScratch.byteLength + ' (F-02 door)');

    // --- CLEAN lane: drawWrapped align / vAlign sweeps on a valid layout --------
    for (let i = 0; i < ALIGN_VALS.length; i++) {
        resetRec(ATLAS);
        FONT_ASCII.drawWrapped(rec, 'ABC', LAYOUT_OK, 1, 100, 100, 0, 0, 1, ALIGN_VALS[i], 0);
        clean('wrapAlign[' + i + ']');
        resetRec(ATLAS);
        FONT_ASCII.drawWrapped(rec, 'ABC', LAYOUT_OK, 1, 100, 100, 0, 0, 1, 0, ALIGN_VALS[i]);
        clean('wrapVAlign[' + i + ']');
    }

    // --- CLEAN lane: measure() degenerate scale pins (return value, not rec) -----
    const baseW = FONT_ASCII.measure('ABC', 1);
    check(FONT_ASCII.measure('ABC', 0) === 0, () => 'T1: measure(scale 0) != 0');
    check(FONT_ASCII.measure('ABC', -1) === -baseW, () => 'T1: measure(scale -1) != -width');
    check(FONT_ASCII.measure('', 1) === 0, () => 'T1: measure("") != 0');
    check(FONT_ASCII.measure('ABC', 1e-45) >= 0, () => 'T1: measure(subnormal scale) < 0');
    check(!Number.isFinite(FONT_ASCII.measure('ABC', Infinity)),
        () => 'T1: measure(scale Infinity) is finite');
    check(Number.isNaN(FONT_ASCII.measure('ABC', NaN)),
        () => 'T1: measure(scale NaN) is not NaN (F-11 via measure)');

    // --- FINDING lane: exactly four pinned-bad cases ----------------------------
    // Each is an EQUALITY on the exact count, so the pin fails in both directions.
    // NOTE where the counts differ from the plan's stated figures:
    //   * F-11 nanScan is 16, not 4: scale===NaN poisons dx, dy, dw AND dh, and
    //     nanScan scans all eight columns (4 calls x 4 poisoned columns = 16).
    //   * F-12 dx is 0,12 not 0,8: JSON_ASCII uses xadvance 12 (the plan's 0,8
    //     assumed an A-xadvance-8 font). The pinned property is the OVERPRINT
    //     (2 draws for a 3-char string), which holds.

    // F-12 (M2): a glyph absent from the atlas advances 0 -> the next glyph
    // overprints it. 'A\u00C8A' -> 2 draws, no NaN.
    resetRec(ATLAS);
    FONT_ASCII.draw(rec, 'A\u00C8A', 0, 0, 1, 0);
    check(rec.calls === 2, () => 'T1/F-12: expected 2 draws (overprint), got ' + rec.calls);
    check(nanScan() === 0, () => 'T1/F-12: expected no NaN, got ' + nanScan());
    check(rec.dx[0] === 0 && rec.dx[1] === 12,
        () => 'T1/F-12: dx ' + rec.dx[0] + ',' + rec.dx[1] + ' != 0,12');

    // F-04 (FIXED in M2, contract now): startIdx < 0 is CLAMPED to 0 (H13), so
    // the line renders the same five glyphs as startIdx 0 -- 5 draws, dx
    // 0,12,24,36,48, and nanScan 0. This block used to pin the DEFECT (5 NaN dx);
    // it now pins the CONTRACT. Killed by removing the `if (!(startIdx >= 0))`
    // clamp -> the NaN column returns and nanScan goes to 5.
    resetRec(ATLAS);
    FONT_ASCII.drawWrapped(rec, 'HELLO', LAYOUT_F04, 1, 100, 100, 0, 0, 1, 0, 0);
    check(rec.calls === 5, () => 'T1/F-04: expected 5 draws, got ' + rec.calls);
    check(nanScan() === 0, () => 'T1/F-04: expected nanScan 0 (clamped), got ' + nanScan());
    check(rec.dx[0] === 0 && rec.dx[1] === 12 && rec.dx[2] === 24 && rec.dx[3] === 36 && rec.dx[4] === 48,
        () => 'T1/F-04: clamped dx != 0,12,24,36,48');

    // F-11 (FIXED in M3, contract now): scale===NaN fails the per-call range door
    // `if (!(scale > 0 && scale < Infinity)) return;`, so draw() emits ZERO
    // drawImage calls and no NaN reaches any column. This block used to pin the
    // DEFECT (4 draws, nanScan 16); it now pins the CONTRACT (0 draws, nanScan 0).
    // INVERTED, not deleted, per decisions/0003 fork 5. Killed by deleting the
    // scale door from draw -> the four NaN quads return and calls goes back to 4.
    resetRec(ATLAS);
    FONT_ASCII.draw(rec, 'AAAA', 100, 0, NaN, 0);
    check(rec.calls === 0, () => 'T1/F-11: expected 0 draws (scale door), got ' + rec.calls);
    check(nanScan() === 0, () => 'T1/F-11: expected nanScan 0 (scale door), got ' + nanScan());

    // F-05 (FIXED in M2, contract now): drawWrapped now bounds-checks the buffer
    // against lineCount*4 and THROWS a RangeError naming both numbers (H11).
    // LAYOUT_F05 holds ONE line (4 floats) but lineCount is 3, so 3*4=12 > 4 and
    // the call throws instead of silently dropping lines 1 and 2. This block used
    // to pin the DEFECT (!threw, 5 draws); it now pins the CONTRACT. Killed by
    // deleting the buffer-length throw -> the surplus lines vanish silently again.
    resetRec(ATLAS);
    let threw = false;
    try { FONT_ASCII.drawWrapped(rec, 'HELLO', LAYOUT_F05, 3, 100, 100, 0, 0, 1, 0, 0); }
    catch (e) { threw = e instanceof RangeError && e.message.includes('4') && e.message.includes('12'); }
    check(threw, () => 'T1/F-05: drawWrapped did not throw a RangeError naming 4 and 12 on an under-length buffer');
    check(rec.calls === 0, () => 'T1/F-05: expected 0 draws (threw before drawing), got ' + rec.calls);
    check(nanScan() === 0, () => 'T1/F-05: expected no NaN, got ' + nanScan());
}
