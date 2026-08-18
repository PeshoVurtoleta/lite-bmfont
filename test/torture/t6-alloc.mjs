/**
 * T6 -- the zero-alloc gate (F-17).
 *
 * SIX windows (A-D from M0/M2, E and F added in M4), run STRICTLY
 * SEQUENTIALLY (the profiler is one-measurement-at-a-time and throws
 * "already in flight" if nested). Each window is gated on TWO lanes:
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

/**
 * Window G cycles (M8). Both built ONCE at module scope.
 *
 * INT5_CYCLE: 256 integers 10000..10255 -- ALL exactly 5 digits, so GLYPHS = 5
 * is a clean integer for the rec.total equality and the window measures a BODY,
 * not a distribution. Matched to window B (drawFast, GLYPHS = 5) on purpose:
 * G and B are directly comparable ONLY because both are pinned at 5 glyphs.
 *
 * INT16_CYCLE: 256 integers 1e15..1e15+255 -- ALL exactly 16 digits, drawFastInt's
 * WORST case, which DRAWFASTINT_MAX (Number.MAX_SAFE_INTEGER) puts inside the
 * super-linear regime (0.4b, knee at 11 digits). Its throughput is RECORDED, never
 * gated -- a slower worst case is an observation, not a reason to move the ceiling.
 */
const INT5_CYCLE = (() => {
    const a = new Float64Array(256);
    for (let i = 0; i < 256; i++) a[i] = 10000 + i;   // 5 digits, no '.'
    return a;
})();
const INT16_CYCLE = (() => {
    const a = new Float64Array(256);
    for (let i = 0; i < 256; i++) a[i] = 1e15 + i;    // 16 digits, <= MAX_SAFE
    return a;
})();

/** DCE guard for windows D, E and F (no drawImage side effect to anchor them). */
let sink = 0;

// ---- F-37: the transient-allocation detector, windows E and F ONLY ----------
//
// WHY IT EXISTS. Neither profiler lane can see a body that allocates per call
// and lets the scavenger reclaim it:
//   - measureAllocs / maxBytesPerCall is a RETENTION lane by definition
//     (lite-gc-profiler llms.txt: measureOps "sees transient garbage that
//     measureAllocs settles away"). Per-call garbage measures as exactly 0.
//   - checkNoGc's maxBytesPerOp reads summary.bytesPerOp, but measureOps puts
//     bytesPerOp on the RESULT, not the summary -- so the rule reads undefined
//     and cannot fail at any threshold for any body.
//   - stabilize:'deep', which runOpsGate hardcodes because maxArrayBuffersGrowth
//     requires it, additionally converts bytesPerOp from transient allocation
//     into retention. The two rules cannot both be gated in one stabilize mode.
// Measured: a `measureWidest` implemented with `text.split('\n')` passes ALL of
// window E's profiler lanes. That is F-37, it is recorded in ROADMAP.md, and the
// GENERAL fix belongs to M9 with F-27/F-31/F-32. M4 does not half-fix a gate --
// it adds the one detector its own two new bodies need.
//
// HOW IT WORKS. Between collections `heapUsed` rises monotonically with
// allocation; a scavenge shows up as a negative delta. Summing only the POSITIVE
// deltas therefore approximates total bytes allocated by the body, which is the
// quantity a retention lane throws away. It is synchronous, so it works inside a
// sync tier -- a PerformanceObserver on 'gc' does not: those entries are
// delivered on a later turn and takeRecords() returns 0 from inside the loop.
//
// THE THRESHOLD AND ITS MARGIN, measured on this host, 8 reps each, after a
// 20,000-iteration warmup:
//   shipped single-pass measureWidest:      0 B typical, 63,040 B worst
//   the same body written with split():    28,042,664 B, every rep
// The limit below sits 15.9x above the worst zero-alloc observation and 28x
// below the mutant. It is a GC-adjacent number and therefore environment
// sensitive, which is exactly why the margin is this wide and why it is stated
// here rather than tuned quietly. The floor is not 0 because
// process.memoryUsage() itself allocates; that is why sampling is strided.
const VOL_OPS = 200000;
const VOL_WARMUP = 20000;
const VOL_MAX = 1000000;
// Window G ONLY (C-4b). The 5-digit VOL_MAX cannot gate drawFastInt: at 5 digits
// the String(value)+charCodeAt mutant allocates only ~84 KB (under VOL_MAX) and
// SURVIVES, indistinguishable from the ~76 KB correct-body floor. The mutant is
// separable only on the 16-DIGIT cycle -- but there, correct code is NOT 0
// either: every double above 2^31 is a boxed HeapNumber (the Smi cliff, 0.4b),
// so `temp % 10` / `Math.floor(temp / 10)` allocate genuine, collectable
// transient garbage the language forces. Measured, deterministic across runs on
// this host (5 reps each, 20,000-iteration warmup):
//   correct 16-digit body:                 3,192,568 B
//   String(value)+charCodeAt mutant:       6,314,312 B
// The correct floor is a real 3.2 MB, so VOL_MAX (1 MB) would false-positive the
// shipped body. VOL16_MAX sits at the midpoint: 49% above the correct floor and
// 25% below the mutant. This is NOT VOL_MAX widened -- it is a SEPARATE lane
// whose correct-code floor is 3.2 MB, not 76 KB, because the arithmetic boxes.
const VOL16_MAX = 4750000;

function allocVolume(fn) {
    for (let i = 0; i < VOL_WARMUP; i++) fn(i);
    globalThis.gc();
    let prev = process.memoryUsage().heapUsed;
    let sum = 0;
    for (let i = 0; i < VOL_OPS; i++) {
        fn(i);
        if ((i & 1023) === 0) {
            const h = process.memoryUsage().heapUsed;
            if (h > prev) sum += h - prev;
            prev = h;
        }
    }
    return sum;
}

/** RECORDED-only wall-clock, ns/call. Not a gate: no threshold, no die(). */
function timeNs(fn, ops, warmup) {
    for (let i = 0; i < warmup; i++) fn(i);
    const a = performance.now();
    for (let i = 0; i < ops; i++) fn(i);
    const b = performance.now();
    return (b - a) * 1e6 / ops;
}

function structural(font, label) {
    check(font._charScratch.byteLength === 24,
        () => 'T6/' + label + ': _charScratch grew to ' + font._charScratch.byteLength + ' (F-02 door)');
    check(font.glyphs.byteLength === 3584,
        () => 'T6/' + label + ': glyphs byteLength ' + font.glyphs.byteLength + ' != 3584');
    check(font.kerning.byteLength === 131072,
        () => 'T6/' + label + ': kerning byteLength ' + font.kerning.byteLength + ' != 131072');
    // M2: the 256-bit coverage bitmap. 8 words x 4 bytes = 32. Per-font structural
    // total 24 + 3584 + 131072 + 32 = 134,712 (decisions/0002). This is the only
    // structural baseline that moved this session; the four rec.total windows below
    // do NOT, because missingAdvance defaults to 0 and no glyph changed drawing.
    check(font._mapped.byteLength === 32,
        () => 'T6/' + label + ': _mapped byteLength ' + font._mapped.byteLength + ' != 32');
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

    // --- Window E (M4): measureWidest() -- no drawImage, 0 glyphs ---------------
    // S64 is the SAME string window D measures -- 64 chars, 3 lines, 2 newlines --
    // so E and D are directly comparable and E's cost over D is exactly what
    // fork (6)'s per-line max-tracking costs. A single-line string would leave the
    // newline branch never taken and the window would measure a body the method
    // does not have.
    //
    // WHAT THIS WINDOW'S PROFILER LANES ACTUALLY GATE, stated correctly after
    // measurement (F-37): maxMajor:0, maxPauseMs:4, maxArrayBuffersGrowth:0 and
    // RETAINED bytes per call. They do NOT gate transient allocation -- a
    // measureWidest written with `text.split('\n')` passes every one of them, and
    // it passes T0's residual law and T5's oracle differential too, because the
    // oracle does exactly the same thing and is allowed to. The detector that
    // forbids it is the allocation-VOLUME check appended below, not
    // maxBytesPerCall:0.
    {
        const OPS = 500000, WARMUP = 5000, GLYPHS = 0;
        resetRec(ATLAS); resetTotals();
        const hot = (i) => {
            rec.calls = 0;
            sink = FONT_ASCII.measureWidest(S64); // assigned so V8 cannot DCE the call
        };
        const { report, summary } = runOpsGate(hot, { ops: OPS, warmup: WARMUP });
        check(rec.total === (OPS + WARMUP) * GLYPHS,
            () => 'T6/E: rec.total ' + rec.total + ' != 0 (measureWidest must not draw)');
        check(sink === 252, () => 'T6/E: measureWidest(S64) sink ' + sink + ' != 252');
        structural(FONT_ASCII, 'E');
        gateOps(report, summary, 'E');
        const { report: aReport, result } = runAllocGate(hot, { iterations: 5000, batches: 8 });
        gateAlloc(aReport, result, 'E');
        // F-37: the transient-allocation detector. THIS is what forbids a
        // split()-based measureWidest; the two lanes above cannot see it.
        const volE = allocVolume(hot);
        check(volE <= VOL_MAX,
            () => 'T6/E: measureWidest allocated ' + volE + ' bytes over ' + VOL_OPS +
                ' calls (limit ' + VOL_MAX + ') -- a per-call allocation shipped, most likely ' +
                'text.split() or a slice in the widest walk');
    }

    // --- Window F (M4): measureLine() -- the fork (3) door + a 21-glyph walk ----
    // (S64, 0, 21, 1) is line 0 of S64 exactly -- 21 'A's, no newline -- so this
    // window measures the range door plus a _measureRange walk. It is directly
    // comparable to nothing, so its throughput is RECORDED rather than compared;
    // what it GATES is maxBytesPerCall:0 and maxMajor:0, which are absolute.
    //
    // Both new windows drive the ACCEPT branch (scale defaults to 1, indices in
    // range). That is F-32's exact shape and this comment states it rather than
    // pretending otherwise: the REJECT branches -- a NaN scale, a non-string
    // text, an unbounded range -- are exercised by T5's correctness rows and by
    // T9 control 13, and they are NOT alloc-gated. F-32 stays M9's. What M4 does
    // do is put both new bodies inside a measured window from the day they ship,
    // which is the thing F-31/F-32 say is missing for the existing bodies.
    {
        const OPS = 500000, WARMUP = 5000, GLYPHS = 0;
        resetRec(ATLAS); resetTotals();
        const hot = (i) => {
            rec.calls = 0;
            sink = FONT_ASCII.measureLine(S64, 0, 21, 1);
        };
        const { report, summary } = runOpsGate(hot, { ops: OPS, warmup: WARMUP });
        check(rec.total === (OPS + WARMUP) * GLYPHS,
            () => 'T6/F: rec.total ' + rec.total + ' != 0 (measureLine must not draw)');
        check(sink === 252, () => 'T6/F: measureLine(S64,0,21,1) sink ' + sink + ' != 252');
        structural(FONT_ASCII, 'F');
        gateOps(report, summary, 'F');
        const { report: aReport, result } = runAllocGate(hot, { iterations: 5000, batches: 8 });
        gateAlloc(aReport, result, 'F');
        // F-37, same detector: measureLine's door must not allocate either -- a
        // `text.slice(start, end)` before the walk would be the natural mistake.
        const volF = allocVolume(hot);
        check(volF <= VOL_MAX,
            () => 'T6/F: measureLine allocated ' + volF + ' bytes over ' + VOL_OPS +
                ' calls (limit ' + VOL_MAX + ') -- a per-call allocation shipped' +
                ' in the range door');
    }

    // --- Window G (M8): drawFastInt() on a FIXED 5-digit cycle, 5 glyphs --------
    // A NEW hot body. Gated exactly like window B (its digit-matched sibling):
    // maxBytesPerCall:0, maxMajor:0, maxPauseMs:4, maxArrayBuffersGrowth:0, an
    // exact rec.total, and structural() (which pins _charScratch at 24 -- KILLS a
    // scratch grown to hold 24 digits).
    //
    // allocVolume() runs here too, and it is JUSTIFIED, not reflexive: drawFastInt
    // is a new body whose most plausible wrong implementation -- String(value)
    // then a charCodeAt walk -- is EXACTLY the transient-allocation class F-37
    // proves the two profiler lanes cannot see (M4 measured a 28 MB split()
    // mutant passing every lane). This is NOT a partial F-37 fix; the general fix,
    // all six existing windows plus the vacuous maxBytesPerOp rule, stays M9's.
    //
    // C-4b: the gated allocVolume runs on the 16-DIGIT cycle against VOL16_MAX,
    // NOT the 5-digit `hot` against VOL_MAX. Measured on a full sandbox copy, a
    // String(value)+charCodeAt mutant on 5-char strings allocates only ~84 KB
    // (under VOL_MAX) and SURVIVES -- too small and short-lived to accumulate
    // between the strided heapUsed samples. On 16-char strings it piles up
    // 6.31 MB. But correct 16-digit code is NOT 0 either: 1e15+i is a boxed
    // HeapNumber and every `% 10` / `Math.floor(/10)` above 2^31 allocates a
    // fresh box (the Smi cliff, 0.4b), so the shipped body itself measures a
    // deterministic 3.19 MB of forced, collectable garbage. VOL_MAX (1 MB) would
    // false-positive it; VOL16_MAX (4.75 MB) sits between 3.19 and 6.31 and kills
    // the mutant while passing the shipped body. The OpsGate / rec.total /
    // structural / runAllocGate lanes keep the fixed 5-glyph `hot` -- they need
    // GLYPHS = 5 and window-B comparability, and at 5 digits the loop stays in
    // Smi range so those lanes see a true zero-alloc body.
    {
        const OPS = 200000, WARMUP = 5000, GLYPHS = 5;
        resetRec(ATLAS); resetTotals();
        const hot = (i) => {
            rec.calls = 0;
            FONT_NUM.drawFastInt(rec, INT5_CYCLE[i & 255], 0, 0);
        };
        const { report, summary } = runOpsGate(hot, { ops: OPS, warmup: WARMUP });
        check(rec.total === (OPS + WARMUP) * GLYPHS,
            () => 'T6/G: rec.total ' + rec.total + ' != ' + ((OPS + WARMUP) * GLYPHS));
        structural(FONT_NUM, 'G');
        gateOps(report, summary, 'G');
        const { report: aReport, result } = runAllocGate(hot, { iterations: 5000, batches: 8 });
        gateAlloc(aReport, result, 'G');
        const hotVol16 = (i) => { rec.calls = 0; FONT_NUM.drawFastInt(rec, INT16_CYCLE[i & 255], 0, 0); };
        const volG = allocVolume(hotVol16);
        check(volG <= VOL16_MAX,
            () => 'T6/G: drawFastInt allocated ' + volG + ' bytes over ' + VOL_OPS +
                ' calls (limit ' + VOL16_MAX + ') on the 16-digit cycle -- a per-call' +
                ' allocation shipped, most likely String(value) + charCodeAt' +
                ' instead of the digit loop (C-4b)');

        // --- RECORDED, NOT GATED (A11, 0.4b). A slower number here is an
        // observation and does NOT move the ceiling. Timed in-process, so read
        // against the coordinator's 9.91% self-noise spread (drawFast vs itself,
        // 18 runs) -- a difference smaller than that is noise, not signal.
        const nsFastInt5 = timeNs(hot, VOL_OPS, VOL_WARMUP);
        const hot16 = (i) => { rec.calls = 0; FONT_NUM.drawFastInt(rec, INT16_CYCLE[i & 255], 0, 0); };
        const nsFastInt16 = timeNs(hot16, VOL_OPS, VOL_WARMUP);
        // Digit-matched pair: the SAME displayed integer through both faces.
        // drawFastInt(1234) -> 4 glyphs; drawFast(123.4) -> 5 glyphs (4 + '.').
        const hotInt4 = (i) => { rec.calls = 0; FONT_NUM.drawFastInt(rec, 1234, 0, 0); };
        const hotFast5 = (i) => { rec.calls = 0; FONT_NUM.drawFast(rec, 123.4, 0, 0); };
        const nsInt4 = timeNs(hotInt4, VOL_OPS, VOL_WARMUP);
        const nsFast5 = timeNs(hotFast5, VOL_OPS, VOL_WARMUP);
        process.stderr.write(
            'torture: RECORDED (A11, not gated; self-noise spread ~9.91%) -- ' +
            'drawFastInt 5-digit ' + nsFastInt5.toFixed(2) + ' ns/call; ' +
            'drawFastInt 16-digit (worst case) ' + nsFastInt16.toFixed(2) + ' ns/call; ' +
            'digit-matched: drawFastInt(1234)=' + nsInt4.toFixed(2) + ' ns/4glyphs vs ' +
            'drawFast(123.4)=' + nsFast5.toFixed(2) + ' ns/5glyphs\n');
    }
}
