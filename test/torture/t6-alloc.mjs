/**
 * T6 -- the zero-alloc gate (F-17).
 *
 * Four windows, run STRICTLY SEQUENTIALLY (the profiler is one-measurement-at-a-
 * time and throws "already in flight" if nested). Each window is gated on TWO
 * lanes:
 *   - measureOps + checkNoGc (RULES): an allocation RATE gate. maxMajor:0,
 *     maxPauseMs:4, maxArrayBuffersGrowth:0. The last rule needs stabilize:'deep'
 *     (runOpsGate supplies it) because typed-array backing stores live OUTSIDE
 *     the V8 heap and are invisible to a heapUsed gate (documented 152x blind).
 *   - measureAllocs + checkAllocs (ALLOC_RULES): a RETAINED-bytes gate.
 *     maxBytesPerCall:0. checkAllocs reports { verdict } and NO `ok` field, so
 *     the alloc lane is gated on `verdict !== 'pass'`.
 *
 * The hot body of every window BEGINS with `rec.calls = 0;` -- one integer store.
 * Without it, calls runs past CAP within a few iterations and `dropped` reaches
 * the millions: a harness mistake mis-blamed on the library.
 *
 * Structural equalities no heap gate can make are asserted after every window:
 * the scratch/glyph/kerning byte sizes (F-02's growth door) and the exact
 * `rec.total` -- the cheapest regression detector in the suite, since a guard
 * that starts skipping a glyph changes an integer.
 *
 * BMFONT_TORTURE_BREAK=1 injects a retained allocation into window A's hot body;
 * the gate must then reject the window. That is the T9 control, exercisable here.
 */

import {
    rec, resetRec, resetTotals, runOpsGate, runAllocGate, BREAK, check, die,
    FONT_ASCII, FONT_NUM, S64, WRAP_TEXT, WRAP_LAYOUT, NUM_CYCLE, ATLAS,
} from './harness.mjs';

/** Retained sink for the BREAK control -- survives GC so arrayBuffers grows. */
const leak = [];

/** DCE guard for window D (measure has no drawImage side effect to anchor it). */
let sink = 0;

function structural(font, label) {
    check(font._charScratch.byteLength === 24,
        () => 'T6/' + label + ': _charScratch grew to ' + font._charScratch.byteLength + ' (F-02 door)');
    check(font.glyphs.byteLength === 3584,
        () => 'T6/' + label + ': glyphs byteLength ' + font.glyphs.byteLength + ' != 3584');
    check(font.kerning.byteLength === 131072,
        () => 'T6/' + label + ': kerning byteLength ' + font.kerning.byteLength + ' != 131072');
    check(rec.dropped === 0 && rec.imgMismatch === 0,
        () => 'T6/' + label + ': dropped ' + rec.dropped + ' imgMismatch ' + rec.imgMismatch);
}

function gateOps(report, summary, label) {
    if (!report.ok) {
        const g = summary.gc;
        die('T6/' + label + ' zero-alloc/GC gate rejected -- verdict=' + report.verdict +
            ' source=' + summary.source + ' major=' + g.major + ' maxMs=' + g.maxMs.toFixed(3) +
            (BREAK ? ' (BMFONT_TORTURE_BREAK control -- expected)' : ''));
    }
}

function gateAlloc(report, result, label) {
    // checkAllocs carries no `ok`; a non-'pass' verdict is the failure signal.
    if (report.verdict !== 'pass') {
        die('T6/' + label + ' retained-bytes gate rejected -- verdict=' + report.verdict +
            ' source=' + result.source + ' bytesPerCall=' + result.bytesPerCall);
    }
}

export function run() {
    // --- Window A: draw() on a 3-line, 62-glyph string --------------------------
    {
        const OPS = 200000, WARMUP = 5000, GLYPHS = 62;
        resetRec(ATLAS); resetTotals();
        const hot = (i) => {
            rec.calls = 0;
            FONT_ASCII.draw(rec, S64, 0, 0, 1, 0);
            if (BREAK) leak.push(new Float64Array(64)); // control: retained growth
        };
        const { report, summary } = runOpsGate(hot, { ops: OPS, warmup: WARMUP });
        check(rec.total === (OPS + WARMUP) * GLYPHS,
            () => 'T6/A: rec.total ' + rec.total + ' != ' + ((OPS + WARMUP) * GLYPHS));
        structural(FONT_ASCII, 'A');
        gateOps(report, summary, 'A');
        const { report: aReport, result } = runAllocGate(hot, { iterations: 5000, batches: 8 });
        gateAlloc(aReport, result, 'A');
        // In BREAK mode the gate above was SUPPOSED to reject and exit. Reaching
        // here with BREAK set means the control silently passed -- a failure.
        if (BREAK) die('T6: BMFONT_TORTURE_BREAK injected allocations but the gate passed');
    }

    // --- Window B: drawFast() on the numeric cycle, 5 glyphs --------------------
    {
        const OPS = 200000, WARMUP = 5000, GLYPHS = 5;
        resetRec(ATLAS); resetTotals();
        const hot = (i) => {
            rec.calls = 0;
            FONT_NUM.drawFast(rec, NUM_CYCLE[i & 255], 0, 0);
        };
        const { report, summary } = runOpsGate(hot, { ops: OPS, warmup: WARMUP });
        check(rec.total === (OPS + WARMUP) * GLYPHS,
            () => 'T6/B: rec.total ' + rec.total + ' != ' + ((OPS + WARMUP) * GLYPHS));
        structural(FONT_NUM, 'B');
        gateOps(report, summary, 'B');
        const { report: aReport, result } = runAllocGate(hot, { iterations: 5000, batches: 8 });
        gateAlloc(aReport, result, 'B');
    }

    // --- Window C: drawWrapped() on 8 lines x 8 glyphs = 64 ----------------------
    {
        const OPS = 100000, WARMUP = 2500, GLYPHS = 64;
        resetRec(ATLAS); resetTotals();
        const hot = (i) => {
            rec.calls = 0;
            FONT_ASCII.drawWrapped(rec, WRAP_TEXT, WRAP_LAYOUT, 8, 100, 200, 0, 0);
        };
        const { report, summary } = runOpsGate(hot, { ops: OPS, warmup: WARMUP });
        check(rec.total === (OPS + WARMUP) * GLYPHS,
            () => 'T6/C: rec.total ' + rec.total + ' != ' + ((OPS + WARMUP) * GLYPHS));
        structural(FONT_ASCII, 'C');
        gateOps(report, summary, 'C');
        const { report: aReport, result } = runAllocGate(hot, { iterations: 5000, batches: 8 });
        gateAlloc(aReport, result, 'C');
    }

    // --- Window D: measure() -- no drawImage, 0 glyphs --------------------------
    {
        const OPS = 500000, WARMUP = 5000, GLYPHS = 0;
        resetRec(ATLAS); resetTotals();
        const hot = (i) => {
            rec.calls = 0;
            sink = FONT_ASCII.measure(S64); // assigned so V8 cannot DCE the call
        };
        const { report, summary } = runOpsGate(hot, { ops: OPS, warmup: WARMUP });
        check(rec.total === (OPS + WARMUP) * GLYPHS,
            () => 'T6/D: rec.total ' + rec.total + ' != 0 (measure must not draw)');
        check(sink === 744, () => 'T6/D: measure(S64) sink ' + sink + ' != 744');
        structural(FONT_ASCII, 'D');
        gateOps(report, summary, 'D');
        const { report: aReport, result } = runAllocGate(hot, { iterations: 5000, batches: 8 });
        gateAlloc(aReport, result, 'D');
    }
}
