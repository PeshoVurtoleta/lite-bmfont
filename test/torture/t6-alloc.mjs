/**
 * T6 -- the zero-alloc gate (F-17).
 *
 * ELEVEN windows (A-D from M0/M2, C2 added in M2a for the F-45 align path, E and
 * F added in M4, G added in M8 for drawFastInt, H added in M8b for drawFast
 * regime B, I and J added in M5 for layoutGlyphs and drawQuads), run STRICTLY
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
import { GLYPH_STRIDE } from '../../BitmapFont.js';

// Windows I and J (M5). S64 is 62 visible 'A' glyphs over 3 lines, so
// layoutGlyphs emits 62 records. QUADBUF is sized to the EXACT fit (no slack)
// so window I also proves the `p + 6 > cap` guard does not trip an exact
// buffer, and window J re-blits the SAME buffer built once at module scope.
const QUAD_GLYPHS = 62;
const QUADBUF = new Float64Array(QUAD_GLYPHS * GLYPH_STRIDE);

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
// REGB_CYCLE: 256 doubles 1e20 + 16384*i -- ALL >= 2^53, so drawFast takes its
// REGIME B path (decisions/0007): mantissa by halving, digits by the hi/lo Smi
// split, then decimal doubling in place (e ~ 14 here). All render 23 glyphs
// ("<21 digits>.0"), a clean multiple for the rec.total equality. Window B's
// 5-digit cycle is regime A and cannot exercise this path -- window H exists for
// exactly the reason window G exists for drawFastInt (M8b-T13).
const REGB_CYCLE = (() => {
    const a = new Float64Array(256);
    for (let i = 0; i < 256; i++) a[i] = 1e20 + 16384 * i;   // >= 2^53, 21 digits
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
// Window H ONLY (M8b, F-44 / regime B). drawFast's regime B does transient work
// the scavenger reclaims -- the mantissa halving loop creates large doubles, and
// the caller boxes the >2^31 argument once per call -- so its allocVolume floor
// is NOT zero. Measured on this host (7 reps each, 20,000-iteration warmup, the
// 1e20 REGB_CYCLE, e ~ 14):
//   shipped regime-B body:            6.19-6.30 MB
//   BigInt in the doubling loop (A8): 40.8-41.0 MB
// REGB_MAX (15 MB) sits 2.4x above the shipped floor and 2.7x below the mutant.
// It gates GROSS per-call allocation (BigInt/String arithmetic in the doubling
// loop), NOT the transient floor -- the standard runOpsGate/runAllocGate lanes
// PASS on the BigInt mutant because its garbage is collectable, exactly the F-37
// blindness window G documents. Environment sensitive, hence the wide margin.
const REGB_MAX = 15000000;

// ---- F-37: volume lanes for windows A, B, C, C2, D (M9pre) ------------------
//
// M5 added allocVolume to E-J but NOT to the M0/M2 windows, so draw / drawFast /
// drawWrapped / measure were still blind to transient per-call allocation. R-18:
// VOL_MAX (calibrated on measure-family bodies E/F that emit no drawImage) MUST
// NOT be reused by analogy -- A/C/C2 drive 62/64/64 recording drawImage calls per
// op. So EACH floor was MEASURED on this host (Node v26.3.1), 6 reps, 20,000-iter
// warmup, and EACH mutant was applied in a cp -R sandbox and watched. The
// realistic regression for a renderer is the "materialize the 8 drawImage args
// into an array per glyph" mistake (window J:537 records V8 elides the INLINE
// spread; only a materialized/escaping array is a real regression) -- an 8-float
// array per glyph, escaping to a module slot. For measure(), the split('\n')
// mistake window E documents. Measured (B = bytes over VOL_OPS):
//   window   shipped floor (max/6)   mutant (min/6)                separation
//   A draw          65,376 B         97,732,272 B  (8-float/glyph)   ~1495x
//   B drawFast      37,152 B         81,443,776 B  (8-float/glyph)   ~2192x
//   C drawWrapped        0 B        102,969,888 B  (8-float/glyph)   inf
//   C2 align-path        0 B        102,969,936 B  (8-float/glyph)   inf
//   D measure        5,024 B         28,042,592 B  (text.split)      ~5582x
// R-15 RESOLVED: the split mutant measures 28,042,592 B here, confirming the
// 28,042,664 B pinned at :112 (72 B apart, GC-noise); it does NOT reproduce the
// ROADMAP F-37 row's 32,881,040 B, which is stale for this host/Node.
// Each limit sits between its own floor and its own mutant -- none is copied.
// C and C2 measure the SAME body (drawWrapped, align 0 vs align 1); the identical
// value is an independent measurement of each, not an analogy.
const VOLA_MAX = 2500000;    // A: floor 65,376 -> 38x margin; mutant 97.7M -> 39x below
const VOLB_MAX = 1700000;    // B: floor 37,152 -> 46x margin; mutant 81.4M -> 48x below
const VOLC_MAX = 3000000;    // C: floor 0 (drawWrapped self-collects); mutant 103.0M -> 34x below
const VOLC2_MAX = 3000000;   // C2: floor 0 (same body, own measurement); mutant 103.0M -> 34x below
const VOLD_MAX = 400000;     // D: floor 5,024 -> 80x margin; mutant 28.0M -> 70x below
// Window K (F-32) drives only REJECT branches -- they return before any glyph
// work, so the floor is JIT-warmup residue, not per-call allocation. Measured
// cold in a fresh process (rep 0 is what the single in-run allocVolume call
// sees): 320,136-369,624 B; warm reps 0-28,160 B. A4's retention leak
// (`_rejectLog = (this._rejectLog||[]).concat(scale)` at the draw scale door)
// reddens the retention lane first (bytesPerCall 7.67, verdict fail, ~1.2s) and
// the volume lane too (3.1M B by op 2000); the ops lane is BLIND (major=0, the
// F-37 shape). VOLK_MAX sits 5.4x above the worst cold floor.
const VOLK_MAX = 2000000;

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
    // F-31 (M9pre): the four equalities above name WHICH array moved; this SUM
    // catches a FIFTH typed array they cannot name. RETAIN both -- a compensating
    // pair (one array shrinks, another grows by the same bytes) passes the sum and
    // is caught only by the named rows; a brand-new array passes every named row
    // and is caught only by the sum. The mutation that reddens it: a
    // `this._bloat = new Float64Array(512)` in the constructor makes the total
    // 134712 + 4096 = 138808 while all four named rows stay green (A1, watched).
    const taTotal = typedArrayTotal(font);
    check(taTotal === 134712,
        () => 'T6/' + label + ': typed-array total ' + taTotal + ' != 134712 (a typed' +
            ' array was added, dropped or resized; decisions/0002)');
    check(rec.dropped === 0 && rec.imgMismatch === 0,
        () => 'T6/' + label + ': dropped ' + rec.dropped + ' imgMismatch ' + rec.imgMismatch);
}

/**
 * F-31 (M9pre): sum byteLength over every ArrayBuffer view held in an OWN slot
 * of `font`, on a LIVE (non-destroyed) instance. Reflect.ownKeys -- not
 * Object.keys -- so a non-enumerable or symbol-keyed backing store is still
 * seen; the value is read from the property DESCRIPTOR, never through the slot,
 * so an accessor is not invoked. KNOWN LIMIT, recorded honestly: a typed array
 * reachable only through a closure or a WeakMap sits behind no own property, so
 * no walk can see it -- this gate pins the instance's own slots, nothing more.
 * Called from structural(), which runs OUTSIDE every measured window, so the
 * keys-array allocation here is not on any gated hot path.
 */
function typedArrayTotal(font) {
    const keys = Reflect.ownKeys(font);
    let total = 0;
    for (let i = 0; i < keys.length; i++) {
        const d = Object.getOwnPropertyDescriptor(font, keys[i]);
        if (!d || !('value' in d)) continue;        // accessor slot: skip, do not invoke
        const v = d.value;
        if (ArrayBuffer.isView(v) && typeof v.byteLength === 'number') total += v.byteLength;
    }
    return total;
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
        // F-37 volume lane (M9pre): the two gates above are RETENTION lanes and
        // are blind to per-glyph transient. Floor 65,376 B, mutant 97.7 MB.
        const volA = allocVolume(hot);
        check(volA <= VOLA_MAX,
            () => 'T6/A: draw allocated ' + volA + ' bytes over ' + VOL_OPS +
                ' calls (limit ' + VOLA_MAX + ') -- a per-glyph allocation escaping' +
                ' the draw loop (a materialized array, not a spread literal V8 elides)');
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
        // F-37 volume lane (M9pre). Floor 37,152 B, mutant 81.4 MB (8-float/glyph).
        const volB = allocVolume(hot);
        check(volB <= VOLB_MAX,
            () => 'T6/B: drawFast allocated ' + volB + ' bytes over ' + VOL_OPS +
                ' calls (limit ' + VOLB_MAX + ') -- a per-glyph allocation escaping' +
                ' the digit loop (a materialized array, not a spread literal)');
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
        // F-37 volume lane (M9pre). Floor 0 B, mutant 103.0 MB (8-float/glyph).
        const volC = allocVolume(hot);
        check(volC <= VOLC_MAX,
            () => 'T6/C: drawWrapped allocated ' + volC + ' bytes over ' + VOL_OPS +
                ' calls (limit ' + VOLC_MAX + ') -- a per-glyph allocation escaping' +
                ' the wrapped draw loop (a materialized array, not a spread literal)');
    }

    // --- Window C2 (M2a): drawWrapped() on the ALIGN path, scale 2, align 1 -----
    // Window C above runs align 0, so the per-line centring block (F-45) has NO
    // alloc coverage. Same 8 x 8 = 64-glyph layout, but scale 2 / align 1 /
    // boxWidth > 0 so `if (align > 0 && boxWidth > 0)` fires every line. The fix
    // is pure deletion (two fewer multiplies on the per-LINE path, zero per
    // glyph), so this window must gate at zero bytes exactly as C does.
    {
        const OPS = 100000, WARMUP = 2500, GLYPHS = 64;
        resetRec(ATLAS); resetTotals();
        const hot = (i) => {
            rec.calls = 0;
            FONT_ASCII.drawWrapped(rec, WRAP_TEXT, WRAP_LAYOUT, 8, 200, 200, 0, 0, 2, 1, 0);
        };
        const { report, summary } = runOpsGate(hot, { ops: OPS, warmup: WARMUP });
        check(rec.total === (OPS + WARMUP) * GLYPHS,
            () => 'T6/C2: rec.total ' + rec.total + ' != ' + ((OPS + WARMUP) * GLYPHS));
        structural(FONT_ASCII, 'C2');
        gateOps(report, summary, 'C2');
        const { report: aReport, result } = runAllocGate(hot, { iterations: 5000, batches: 8 });
        gateAlloc(aReport, result, 'C2');
        // F-37 volume lane (M9pre). Floor 0 B, mutant 103.0 MB -- same body as C,
        // own measurement (align 1 / scale 2 path).
        const volC2 = allocVolume(hot);
        check(volC2 <= VOLC2_MAX,
            () => 'T6/C2: drawWrapped(align) allocated ' + volC2 + ' bytes over ' + VOL_OPS +
                ' calls (limit ' + VOLC2_MAX + ') -- a per-glyph allocation escaping' +
                ' the wrapped/align draw loop (a materialized array, not a spread literal)');
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
        // F-37 volume lane (M9pre). Floor 5,024 B, mutant 28.0 MB (text.split in
        // the measure walk -- the R-15 mutant, re-measured on this host: it is
        // 28,042,592 B, confirming :112's 28,042,664 and NOT the ROADMAP 32.9 MB).
        const volD = allocVolume(hot);
        check(volD <= VOLD_MAX,
            () => 'T6/D: measure allocated ' + volD + ' bytes over ' + VOL_OPS +
                ' calls (limit ' + VOLD_MAX + ') -- a per-call allocation shipped,' +
                ' most likely a text.split() or slice in the measure walk');
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

    // --- Window H (M8b): drawFast() on a REGIME-B cycle, 23 glyphs --------------
    // drawFast's REGIME B (value >= 2^53) renders the double's exact integer value
    // by decimal doubling (decisions/0007) -- a path window B (5-digit, regime A)
    // never reaches. Without this window a regime-B allocation is invisible: the
    // same blindness M8's window G closed for drawFastInt.
    //
    // The standard lanes (runOpsGate deep + runAllocGate maxBytesPerCall:0) are the
    // A-F-comparable baseline. They PASS on a BigInt-doubling mutant because its
    // garbage is transient and scavenged (the F-37 blindness). The A8 detector is
    // allocVolume: BigInt in the doubling loop turns the shipped ~6.2 MB transient
    // floor into ~40.8 MB, and REGB_MAX (15 MB) sits between. The 6.2 MB floor is
    // mantissa-halving and argument-boxing garbage the scavenger reclaims -- NOT
    // zero -- so this window gates GROSS per-call allocation, not that floor.
    {
        const OPS = 200000, WARMUP = 5000, GLYPHS = 23;
        resetRec(ATLAS); resetTotals();
        // A8 twin: the driven values MUST be regime B (>= 2^53), or window B's
        // 5-digit regime-A cycle silently answers for this window.
        check(REGB_CYCLE[0] >= 9007199254740992 && REGB_CYCLE[255] >= 9007199254740992,
            () => 'T6/H: REGB_CYCLE is not entirely regime B (>= 2^53) -- window B would answer for it');
        const hot = (i) => {
            rec.calls = 0;
            FONT_NUM.drawFast(rec, REGB_CYCLE[i & 255], 0, 0);
        };
        const { report, summary } = runOpsGate(hot, { ops: OPS, warmup: WARMUP });
        check(rec.total === (OPS + WARMUP) * GLYPHS,
            () => 'T6/H: rec.total ' + rec.total + ' != ' + ((OPS + WARMUP) * GLYPHS));
        structural(FONT_NUM, 'H');
        gateOps(report, summary, 'H');
        const { report: aReport, result } = runAllocGate(hot, { iterations: 5000, batches: 8 });
        gateAlloc(aReport, result, 'H');
        const volH = allocVolume(hot);
        check(volH <= REGB_MAX,
            () => 'T6/H: drawFast regime-B allocated ' + volH + ' bytes over ' + VOL_OPS +
                ' calls (limit ' + REGB_MAX + ') -- gross per-call allocation in the' +
                ' doubling loop, most likely BigInt or String arithmetic (A8)');
    }

    // --- Window I (M5): layoutGlyphs() -- fills QUADBUF, 0 drawImage ------------
    // layoutGlyphs writes indexed floats into a caller-owned buffer and returns a
    // count; it issues NO drawImage, so GLYPHS = 0 for the rec.total equality and
    // the count is checked through `sink`. THREE lanes, because layoutGlyphs has
    // no drawImage anchor to constrain its body:
    //   - gateOps (RULES) + gateAlloc (ALLOC_RULES) are the RETENTION guard --
    //     they catch bytes that survive the call (e.g. retaining DISTINCT buffers
    //     into a pre-sized store, which allocVolume would settle away).
    //   - allocVolume / VOL_MAX (the F-37 transient detector windows E-H carry)
    //     catches PER-CALL allocation, transient or churning. This is the lane the
    //     retention pair is blind to.
    // Both worst mutations were WATCHED to turn window I RED via the volume lane:
    // A9 (writing the record through a 6-float array literal + `outBuffer.set`)
    // measured 329 MB over VOL_OPS; A10 (pushing `outBuffer` into a module sink)
    // measured ~4.6 MB (the growing sink array's churn) -- both far above the
    // 1 MB floor, and layoutGlyphs itself is zero, so no special floor is needed.
    // The exact-fit QUADBUF also proves the `p + 6 > cap` guard passes a tight buffer.
    {
        const OPS = 200000, WARMUP = 5000, GLYPHS = 0;
        resetRec(ATLAS); resetTotals();
        const hot = (i) => {
            rec.calls = 0;
            sink = FONT_ASCII.layoutGlyphs(S64, QUADBUF, 0, 0, 1, 0);
        };
        const { report, summary } = runOpsGate(hot, { ops: OPS, warmup: WARMUP });
        check(rec.total === (OPS + WARMUP) * GLYPHS,
            () => 'T6/I: rec.total ' + rec.total + ' != ' + ((OPS + WARMUP) * GLYPHS));
        check(sink === QUAD_GLYPHS,
            () => 'T6/I: layoutGlyphs(S64) returned ' + sink + ' != ' + QUAD_GLYPHS);
        structural(FONT_ASCII, 'I');
        gateOps(report, summary, 'I');
        const { report: aReport, result } = runAllocGate(hot, { iterations: 5000, batches: 8 });
        gateAlloc(aReport, result, 'I');
        const volI = allocVolume(hot);
        check(volI <= VOL_MAX,
            () => 'T6/I: layoutGlyphs allocated ' + volI + ' bytes over ' + VOL_OPS +
                ' calls (limit ' + VOL_MAX + ') -- a per-record allocation shipped, most' +
                ' likely a 6-float array literal + outBuffer.set(), or a retained' +
                ' outBuffer reference (A9/A10)');
    }

    // --- Window J (M5): drawQuads() -- 62 drawImage from a prebuilt buffer ------
    // The buffer is laid out ONCE below (outside the hot body), then re-blit every
    // iteration -- drawQuads reads only, so GLYPHS = 62 and rec.total gates it.
    // THREE lanes, same reasoning as window I: gateOps + gateAlloc are the
    // retention guard; allocVolume / VOL_MAX catches PER-CALL allocation. WATCHED
    // RED: a genuine per-glyph array escaping the loop measured 329 MB over
    // VOL_OPS on the volume lane. NOTE the negative result that proves this lane
    // earns its place -- `ctx.drawImage(...[8 floats])` per glyph, written INLINE
    // (the literal spread straight into the call, NOT materialized into a variable
    // first), does NOT redden: V8 scalar-replaces it and allocates nothing, so
    // torture exits 0. Verified on Node v26.3.1. Only a materialized/escaping
    // allocation is a real regression, and only a real regression should redden.
    {
        const OPS = 200000, WARMUP = 5000, GLYPHS = QUAD_GLYPHS;
        resetRec(ATLAS); resetTotals();
        const count = FONT_ASCII.layoutGlyphs(S64, QUADBUF, 0, 0, 1, 0);
        check(count === QUAD_GLYPHS,
            () => 'T6/J: layoutGlyphs seeded ' + count + ' records, expected ' + QUAD_GLYPHS);
        const hot = (i) => {
            rec.calls = 0;
            FONT_ASCII.drawQuads(rec, QUADBUF, 0, count, 0, 0, 1);
        };
        const { report, summary } = runOpsGate(hot, { ops: OPS, warmup: WARMUP });
        check(rec.total === (OPS + WARMUP) * GLYPHS,
            () => 'T6/J: rec.total ' + rec.total + ' != ' + ((OPS + WARMUP) * GLYPHS));
        structural(FONT_ASCII, 'J');
        gateOps(report, summary, 'J');
        const { report: aReport, result } = runAllocGate(hot, { iterations: 5000, batches: 8 });
        gateAlloc(aReport, result, 'J');
        const volJ = allocVolume(hot);
        check(volJ <= VOL_MAX,
            () => 'T6/J: drawQuads allocated ' + volJ + ' bytes over ' + VOL_OPS +
                ' calls (limit ' + VOL_MAX + ') -- a per-glyph allocation shipped that' +
                ' escapes the loop (a materialized array/object, not a spread literal' +
                ' V8 elides) (A9)');
    }

    // --- Window K (M9pre): the REJECT branches of every per-call door (F-32) ----
    // F-32: the reject branches of the scale/text doors were exercised by T5 and
    // by T9 control 13, but never INSIDE a measured window, so a reject path that
    // allocated was invisible. Window K drives ALL FOURTEEN enumerated doors of
    // the eight public bodies that take a scale or text -- the SESSION-M9pre list
    // says "thirteen" but enumerates fourteen; fail closed, cover all fourteen:
    //   scale doors (8): measure :471, measureWidest :500, measureLine :575,
    //     layoutGlyphs :1309, draw :670, drawFast :808, drawFastInt :974,
    //     drawWrapped :1129 -- driven with scale = NaN.
    //   text  doors (6): measure :470, measureWidest :499, measureLine :574,
    //     layoutGlyphs :1308, draw :669, drawWrapped :1128 -- driven with a
    //     non-string text (drawFast/drawFastInt take a numeric value, no text door).
    // The measure/query faces (measure/measureWidest/measureLine/layoutGlyphs)
    // answer a bad door with NaN (decisions/0004 fork 4) -- accumulated into
    // `sink` so V8 cannot DCE the calls; a NaN sink cannot be ===-asserted, so K
    // asserts `sink !== sink`. The void draw faces (draw/drawFast/drawFastInt/
    // drawWrapped) return after drawing nothing, so `rec.total === 0` is their
    // DCE-proof and their reject proof at once. GLYPHS = 0.
    //
    // THREE lanes, VOLK_MAX. Mutation A4 (watched): `this._rejectLog =
    // (this._rejectLog || []).concat(scale); return;` at the draw scale door
    // (:670) -- a materialized, escaping, retained array. It reddens the RETENTION
    // lane first (bytesPerCall 7.67, verdict fail) and the VOLUME lane too; the
    // ops lane is blind (major = 0), which is exactly the F-37 shape this session
    // is about. `_rejectLog` is an Array, not an ArrayBuffer view, so F-31's
    // typed-array walk does not see it -- the two assertions stay independent.
    {
        const OPS = 200000, WARMUP = 5000, GLYPHS = 0;
        const BAD = 12345;                 // a non-string, to trip the text doors
        resetRec(ATLAS); resetTotals();
        const hot = (i) => {
            rec.calls = 0;
            // eight scale doors -- scale = NaN
            sink = FONT_ASCII.measure(S64, NaN)
                 + FONT_ASCII.measureWidest(S64, NaN)
                 + FONT_ASCII.measureLine(S64, 0, 21, NaN)
                 + FONT_ASCII.layoutGlyphs(S64, QUADBUF, 0, 0, NaN, 0);
            FONT_ASCII.draw(rec, S64, 0, 0, NaN, 0);
            FONT_NUM.drawFast(rec, 123.4, 0, 0, NaN, 0);
            FONT_NUM.drawFastInt(rec, 1234, 0, 0, NaN, 0);
            FONT_ASCII.drawWrapped(rec, WRAP_TEXT, WRAP_LAYOUT, 8, 100, 200, 0, 0, NaN, 0, 0);
            // six text doors -- non-string text
            sink += FONT_ASCII.measure(BAD, 1)
                 + FONT_ASCII.measureWidest(BAD, 1)
                 + FONT_ASCII.measureLine(BAD, 0, 21, 1)
                 + FONT_ASCII.layoutGlyphs(BAD, QUADBUF, 0, 0, 1, 0);
            FONT_ASCII.draw(rec, BAD, 0, 0, 1, 0);
            FONT_ASCII.drawWrapped(rec, BAD, WRAP_LAYOUT, 8, 100, 200, 0, 0, 1, 0, 0);
        };
        const { report, summary } = runOpsGate(hot, { ops: OPS, warmup: WARMUP });
        check(rec.total === (OPS + WARMUP) * GLYPHS,
            () => 'T6/K: rec.total ' + rec.total + ' != 0 (a reject door drew a glyph)');
        check(sink !== sink,
            () => 'T6/K: sink ' + sink + ' is not NaN -- a measure/query reject door failed to return NaN');
        structural(FONT_ASCII, 'K');
        gateOps(report, summary, 'K');
        const { report: aReport, result } = runAllocGate(hot, { iterations: 5000, batches: 8 });
        gateAlloc(aReport, result, 'K');
        const volK = allocVolume(hot);
        check(volK <= VOLK_MAX,
            () => 'T6/K: reject doors allocated ' + volK + ' bytes over ' + VOL_OPS +
                ' calls (limit ' + VOLK_MAX + ') -- a reject branch allocated, most' +
                ' likely a log/collect of the rejected argument (A4)');
    }
}
