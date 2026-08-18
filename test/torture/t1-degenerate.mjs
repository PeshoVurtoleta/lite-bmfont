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
 *     0 calls / nanScan 0. As of M4 (F-36, decisions/0004 fork 4) the PUBLIC
 *     measure family carries the same range door plus a `typeof text` door and
 *     answers a rejected argument with NaN, so three of the six measure pins
 *     below are INVERTED or TIGHTENED. `_measureRange` alone keeps NO door --
 *     it is an explicitly-unsafe internal (fork 3 A2) whose body is
 *     byte-for-byte the 1.3.0 body.
 *   - As of M4a (F-42, decisions/0004 fork 9) the text door is no longer a
 *     measure-family story: `draw` and `drawWrapped` carry the SAME
 *     `typeof text !== 'string'` predicate. FIVE text-taking faces, ONE text
 *     door, TWO fail signals by family -- the two text renderers draw nothing and
 *     return, the three measure faces return NaN. The F-42 lane below sweeps all
 *     five against the seven not-a-string inputs and asserts exactly those two
 *     answers. `drawFast` takes a NUMBER and is deliberately absent from the
 *     sweep. The unbounded {length: Infinity, charCodeAt} row is survivable in
 *     process only because the door exists; the out-of-process hang proof is
 *     T9 controls 14/15.
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

// F-42 (M4a, decisions/0004 fork 9): the seven not-a-string inputs the six-face
// text-door sweep crosses. Built ONCE (harness rule 1), never inside the loop.
//
// !! DANGER -- the LAST row, {length: Infinity, charCodeAt}, is safe IN PROCESS
// ONLY because draw/drawWrapped/measure* all carry `typeof text !== 'string'`.
// Against a DOORLESS build draw(rec, that, ...) is an UNKILLABLE loop -- `len`
// is Infinity and the line scan `while (lineEnd < len ...)` never terminates,
// with NO watchdog in this tier. The out-of-process proof of the door lives in
// T9 controls 14 and 15 (spawnSync + SIGKILL), exactly as the drawFast /
// Number.MAX_VALUE column is deferred there. DO NOT run this tier against a
// build with either door removed.
const NOT_A_STRING = [
    null, undefined, 123, [65], new String('A'),
    { length: 2, charCodeAt() { return 65; } },
    { length: Infinity, charCodeAt() { return 65; } },
];

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
    // SIX pins. M4 (F-36, decisions/0004 fork 4) inverts two, tightens one and
    // leaves three exactly as they were. INVERTED IN PLACE, never deleted, never
    // demoted to test.todo -- the pin must fail in both directions.
    const baseW = FONT_ASCII.measure('ABC', 1);
    check(baseW === 36, () => 'T1: measure("ABC",1) ' + baseW + ' != 36 (fixture moved)');
    // INVERTED by M4: was `=== 0`. The scale door is a RANGE test, so 0 -- which
    // is finite and which a `scale !== scale` door cannot see -- is rejected.
    // Killed by writing the door as a NaN test: this row goes back to 0.
    check(Number.isNaN(FONT_ASCII.measure('ABC', 0)),
        () => 'T1/M4: measure(scale 0) ' + FONT_ASCII.measure('ABC', 0) + ' is not NaN (door written as a NaN test?)');
    // INVERTED by M4: was `=== -baseW`, a NEGATIVE WIDTH returned to a layout.
    // -1 is finite; same detector as the row above, opposite side of the range.
    check(Number.isNaN(FONT_ASCII.measure('ABC', -1)),
        () => 'T1/M4: measure(scale -1) ' + FONT_ASCII.measure('ABC', -1) + ' is not NaN (negative width still shipping?)');
    // UNCHANGED: an empty string at a VALID scale is 0, not NaN. This is the
    // twin that fails if the text door starts rejecting strings.
    check(FONT_ASCII.measure('', 1) === 0, () => 'T1: measure("") != 0');
    // UNCHANGED, and load-bearing: A SUBNORMAL SCALE IS A VALID SCALE. It
    // renders nothing visible and returns a correct width, and it is inside
    // (0, Infinity). A door "cleaned up" to reject subnormals reddens here and
    // nowhere else -- it is the only detector of that mutation.
    check(FONT_ASCII.measure('ABC', 1e-45) >= 0, () => 'T1: measure(subnormal scale) < 0');
    check(Number.isFinite(FONT_ASCII.measure('ABC', 1e-45)),
        () => 'T1: measure(subnormal scale) is not finite');
    // TIGHTENED by M4: was `!Number.isFinite(...)`, which NaN and +/-Infinity
    // both satisfy. The door now makes it exactly NaN, by policy rather than by
    // arithmetic accident (declared delta D5).
    check(Number.isNaN(FONT_ASCII.measure('ABC', Infinity)),
        () => 'T1/M4: measure(scale Infinity) ' + FONT_ASCII.measure('ABC', Infinity) + ' is not exactly NaN');
    // UNCHANGED in value, changed in REASON: NaN was arithmetic in 1.3.0 and is
    // policy in 1.4.0. Kept because a door that stops firing must still redden.
    check(Number.isNaN(FONT_ASCII.measure('ABC', NaN)),
        () => 'T1: measure(scale NaN) is not NaN (F-11 via measure)');
    // M4: `_measureRange` keeps NO door (fork 3 A2). Its 1.3.0 answers are
    // pinned HERE so "the public faces gained a door" cannot be mistaken for
    // "the shared helper gained one" -- the frozen-body guarantee, expressed as
    // an executable row rather than only as a source-text sha.
    check(FONT_ASCII._measureRange('ABC', 0, 3, 0) === 0,
        () => 'T1/M4: _measureRange(scale 0) is not 0 -- the internal grew a door');
    check(FONT_ASCII._measureRange('ABC', 0, 3, -1) === -baseW,
        () => 'T1/M4: _measureRange(scale -1) is not -width -- the internal grew a door');

    // --- F-42 lane: the six-face x seven-input text-door sweep (M4a) -------------
    // decisions/0004 fork (9). The table has exactly TWO answers now: every
    // renderer draws 0 and returns; every measure face returns NaN. No raw
    // TypeError anywhere. This is the assertion that distinguishes door form A
    // (typeof) from form B (a length-range door): under B, draw(null) throws,
    // draw(new String('A')) draws 1 and draw({length:2,charCodeAt}) draws 2.
    for (let i = 0; i < NOT_A_STRING.length; i++) {
        const T = NOT_A_STRING[i];
        // Row 1 -- draw: no throw, 0 draws, no NaN, nothing dropped.
        resetRec(ATLAS);
        let threw = false;
        try { FONT_ASCII.draw(rec, T, 0, 0, 1, 0); } catch { threw = true; }
        check(!threw, () => 'T1/F-42 draw[' + i + ']: threw (door below const len, or door form B?)');
        check(rec.calls === 0, () => 'T1/F-42 draw[' + i + ']: expected 0 draws, got ' + rec.calls);
        check(nanScan() === 0, () => 'T1/F-42 draw[' + i + ']: nanScan ' + nanScan() + ' != 0');
        check(rec.dropped === 0, () => 'T1/F-42 draw[' + i + ']: dropped ' + rec.dropped);
        // Row 2 -- drawWrapped: same three, second body.
        resetRec(ATLAS);
        threw = false;
        try { FONT_ASCII.drawWrapped(rec, T, LAYOUT_OK, 1, 100, 100, 0, 0, 1, 0, 0); } catch { threw = true; }
        check(!threw, () => 'T1/F-42 drawWrapped[' + i + ']: threw');
        check(rec.calls === 0, () => 'T1/F-42 drawWrapped[' + i + ']: expected 0 draws, got ' + rec.calls);
        check(nanScan() === 0, () => 'T1/F-42 drawWrapped[' + i + ']: nanScan ' + nanScan() + ' != 0');
        check(rec.dropped === 0, () => 'T1/F-42 drawWrapped[' + i + ']: dropped ' + rec.dropped);
        // Rows 3-5 -- the measure family answers NaN (drawFast is NOT swept: it
        // takes a number and must NOT carry a text door).
        check(Number.isNaN(FONT_ASCII.measure(T)),
            () => 'T1/F-42 measure[' + i + ']: ' + FONT_ASCII.measure(T) + ' is not NaN');
        check(Number.isNaN(FONT_ASCII.measureWidest(T)),
            () => 'T1/F-42 measureWidest[' + i + ']: ' + FONT_ASCII.measureWidest(T) + ' is not NaN');
        check(Number.isNaN(FONT_ASCII.measureLine(T, 0, 2, 1)),
            () => 'T1/F-42 measureLine[' + i + ']: ' + FONT_ASCII.measureLine(T, 0, 2, 1) + ' is not NaN');
    }
    // Non-vacuity twins -- without these every row above passes for a door that
    // rejects EVERYTHING. A real string must still render / measure.
    resetRec(ATLAS);
    FONT_ASCII.draw(rec, 'ABC', 0, 0, 1, 0);
    check(rec.calls === 3, () => 'T1/F-42 twin: draw("ABC") ' + rec.calls + ' != 3 (door rejects real strings?)');
    check(rec.dx[0] === 0, () => 'T1/F-42 twin: draw("ABC") dx[0] ' + rec.dx[0] + ' != 0');
    resetRec(ATLAS);
    FONT_ASCII.drawWrapped(rec, 'ABC', LAYOUT_OK, 1, 100, 100, 0, 0, 1, 0, 0);
    check(rec.calls === 3, () => 'T1/F-42 twin: drawWrapped("ABC") ' + rec.calls + ' != 3');
    check(FONT_ASCII.measure('ABC', 1) === 36,
        () => 'T1/F-42 twin: measure("ABC",1) ' + FONT_ASCII.measure('ABC', 1) + ' != 36 (fixture moved under the sweep)');
    // Order row (A6) -- text door is ABOVE the buffer-length throw. null returns
    // WITHOUT the F-05 RangeError (nothing to draw, no line count to honour); a
    // real under-length string still throws it, naming 4 and 12.
    resetRec(ATLAS);
    let orderThrew = false;
    try { FONT_ASCII.drawWrapped(rec, null, LAYOUT_F05, 3, 100, 100, 0, 0, 1, 0, 0); }
    catch { orderThrew = true; }
    check(!orderThrew, () => 'T1/F-42 order: drawWrapped(null, F05, 3) threw -- text door is BELOW the buffer throw');
    check(rec.calls === 0, () => 'T1/F-42 order: drawWrapped(null,...) drew ' + rec.calls);
    resetRec(ATLAS);
    let stillThrew = false;
    try { FONT_ASCII.drawWrapped(rec, 'HELLO', LAYOUT_F05, 3, 100, 100, 0, 0, 1, 0, 0); }
    catch (e) { stillThrew = e instanceof RangeError && e.message.includes('4') && e.message.includes('12'); }
    check(stillThrew, () => 'T1/F-42 order: drawWrapped("HELLO", F05, 3) did not still throw naming 4 and 12 (door ate the throw)');

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
