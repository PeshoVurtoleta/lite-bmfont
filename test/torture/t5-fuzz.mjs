/**
 * T5 -- the differential fuzz tier vs an ALLOCATING reference renderer (M4).
 *
 * Built from nothing in M4. The tier is a whole second implementation of `draw`,
 * deliberately naive and deliberately allocating, plus the corpus and the two
 * 50,000-tuple sweeps that drive the library against it element-wise, exactly,
 * with no epsilon anywhere.
 *
 * THREE PROPERTIES OF THE REFERENCE ARE LOAD-BEARING and the reviewer checks each:
 *
 *   1. It reads the ORIGINAL BMFont JSON, never `font.glyphs`. A two-way check
 *      between `draw` and the Int16 store would agree with itself on an F-08
 *      truncation and be wrong together. JSON_SNAP has no fractional field, so
 *      the residual is exactly 0 -- and ASSERTING that it is 0 is the proof the
 *      reference is reading the right side, so this tier asserts it rather than
 *      assuming it.
 *   2. It implements B1 (decisions/0004 fork 2) and says so at the line. A
 *      reference that mirrors the code under test is a mirror, not a reference;
 *      the defence is T9 controls 11 and 12, which mutate the LIBRARY and require
 *      this tier to go red. A mirror would follow the mutation and stay green.
 *   3. It NEVER rounds X per glyph. If it did, this tier would be green against a
 *      library that broke T0 law 1, and the "X is not snapped" assertion would
 *      have two detectors that agree with each other and disagree with the law.
 *
 * Y2 and Y9 are the two rows that make this session's headline decision
 * falsifiable, and both carry a FRACTIONAL `y`. At `y = 0` the ratified B1 form
 * and the rejected B2 form produce the identical five baselines, so a table
 * asserted only at `y = 0` pins nothing about the sub-fork that was chosen.
 *
 * Correctness only -- T5 makes NO profiler call and defines NO second recording
 * ctx (harness rule 1 and 4). The corpus, the layout buffers and the scratch
 * arrays are built ONCE, before every loop; check() takes thunks only. Tier
 * budget < 5000 ms is asserted: a clock is the only gate that catches a loop
 * that does not end.
 *
 * @license MIT
 */

import { BitmapFont, GLYPH_STRIDE } from '../../BitmapFont.js';
import {
    makePrng, SEED, check, nanScan,
    rec, resetRec, CAP,
    ATLAS,
    FONT_SNAP, FONT_SNAP_KERN, FONT_ASCII, FONT_SNAP_NEG,
    JSON_SNAP, JSON_SNAP_KERN, JSON_ASCII,
} from './harness.mjs';

// F-42 / M4a byte-identity pin (section 8.2). Sweep A already compares every
// recorded dx/dy element-wise against an INDEPENDENT allocating reference; this
// row folds every recorded dx and dy across the WHOLE 50k-tuple corpus into one
// deterministic 32-bit checksum and pins it to a literal recorded from the
// v1.4.0 build. The F-42 door returns early ONLY for non-strings, and the corpus
// holds only real strings, so the door never fires here and this checksum is
// byte-identical to v1.4.0's. It was cross-checked against the frozen 1.4.0 copy
// BEFORE the door landed; the two agreed. If a future edit moves it -- a door
// placed after cursorX, a `typeof text !== 'string' || !text.length` that eats a
// first glyph, a "tidied" line scan -- the session has ALREADY regressed and
// this literal must NOT be updated to match. The pin is guarded to the default
// seed because the corpus and tuple stream are seed-dependent.
const T5_DEFAULT_SEED = 0x9e3779b9;
const T5_DXDY_CKSUM = 0xcecd9814;
const _ckBuf = new ArrayBuffer(8);
const _ckF64 = new Float64Array(_ckBuf);
const _ckU32 = new Uint32Array(_ckBuf);

// A1 (M5) round-trip scratch, built ONCE. RT_QUADBUF holds up to CAP records;
// sweep A skips t.length > 512, so rtN <= 512 <= CAP. The eight RT_* columns
// snapshot draw's recording so layoutGlyphs + drawQuads can be compared to it
// element-wise after rec is reset -- no per-tuple allocation.
const RT_QUADBUF = new Float64Array(CAP * GLYPH_STRIDE);
const RT_SX = new Float64Array(CAP), RT_SY = new Float64Array(CAP);
const RT_SW = new Float64Array(CAP), RT_SH = new Float64Array(CAP);
const RT_DX = new Float64Array(CAP), RT_DY = new Float64Array(CAP);
const RT_DW = new Float64Array(CAP), RT_DH = new Float64Array(CAP);

// ---- the allocating reference renderer (8.3.1) -----------------------------
// Records instead of drawing: it returns arrays, it never calls drawImage, and
// it never touches `rec`. It may allocate -- T5 makes no measured window at all,
// and the library is what is being gated, not this.

/** Per-json advance/kerning/metric maps, built from the ORIGINAL descriptor. */
const refCache = new WeakMap();
function refMaps(json) {
    let m = refCache.get(json);
    if (m !== undefined) return m;
    const g = Object.create(null);
    const kern = Object.create(null);
    for (let i = 0; i < json.chars.length; i++) {
        const c = json.chars[i];
        // Id 10 is a layout instruction, not a glyph -- its descriptor entry is
        // discarded at construction (F-25), so the reference must not see it.
        if (c.id >= 0 && c.id < 256 && c.id !== 10) g[c.id] = c;
    }
    if (json.kernings) {
        for (let i = 0; i < json.kernings.length; i++) {
            const k = json.kernings[i];
            if (k.first >= 0 && k.first < 256 && k.second >= 0 && k.second < 256 &&
                k.first !== 10 && k.second !== 10) {
                kern[(k.first << 8) | k.second] = k.amount;
            }
        }
    }
    m = { g, kern, lineHeight: json.common.lineHeight, base: json.common.base };
    refCache.set(json, m);
    return m;
}

/** Sum of (xadvance + kerning) over [start, end) straight out of the JSON. */
function refLineWidth(m, text, start, end, scale) {
    let w = 0;
    let prev = -1;
    for (let i = start; i < end; i++) {
        const id = text.charCodeAt(i);
        if (id >= 0 && id < 256) {
            if (prev !== -1) {
                const kk = m.kern[(prev << 8) | id];
                if (kk !== undefined) w += kk * scale;
            }
            const c = m.g[id];
            w += (c === undefined ? 0 : c.xadvance) * scale;
            prev = id;
        }
    }
    return w;
}

/**
 * The reference `draw`. Returns an array of {code, dx, dy, dw, dh} records in
 * emission order, plus the per-line baselines it used.
 */
function refDraw(json, text, x, y, scale, align) {
    const m = refMaps(json);
    const out = [];
    const baselines = [];
    if (!(scale > 0 && scale < Infinity)) return { out, baselines };
    const len = text.length;
    if (len === 0) return { out, baselines };

    const lines = text.split('\n');            // allocates; that is allowed here
    const anchorY = Math.round(y);
    const step = m.lineHeight * scale;

    let at = 0;
    for (let li = 0; li < lines.length; li++) {
        // decisions/0004 fork (2) sub-fork B1: ONE round per line, from the
        // SNAPPED first baseline plus an exact per-line product. NOT
        // Math.round(y + li * step) (B2), NOT Math.round(prev + step) (A).
        const baseline = anchorY + Math.round(li * step);
        baselines.push(baseline);

        const line = lines[li];
        const lineW = refLineWidth(m, text, at, at + line.length, scale);
        let cursorX = x;
        if (align === 1) cursorX -= lineW / 2;
        else if (align === 2) cursorX -= lineW;
        cursorX = Math.round(cursorX);         // per LINE ORIGIN only

        let prev = -1;
        for (let j = 0; j < line.length; j++) {
            const id = text.charCodeAt(at + j);
            if (!(id >= 0 && id < 256)) continue;
            if (prev !== -1) {
                const kk = m.kern[(prev << 8) | id];
                if (kk !== undefined) cursorX += kk * scale;
            }
            const c = m.g[id];
            if (c !== undefined && c.width > 0 && c.height > 0) {
                out.push({
                    code: id,
                    dx: cursorX + c.xoffset * scale,
                    dy: baseline + c.yoffset * scale - m.base * scale,
                    dw: c.width * scale,
                    dh: c.height * scale,
                });
            }
            cursorX += (c === undefined ? 0 : c.xadvance) * scale;  // X NEVER rounded here
            prev = id;
        }
        at += line.length + 1;                 // +1 for the consumed newline
    }
    return { out, baselines };
}

/**
 * The allocating oracle for measureWidest (fork 6, assertion A5).
 *
 * Seeded at -Infinity, NOT 0 (F-39). The first version of this oracle seeded at
 * 0 -- mirroring the library -- so on a font with negative advances it floored
 * at 0 exactly as the library did and AGREED with the bug. `split()` always
 * yields at least one element and `measure('')` is 0, so the empty string still
 * comes out 0; the seed can never escape as a width.
 */
function refWidest(font, s, k) {
    const parts = s.split('\n');
    let max = -Infinity;
    for (let i = 0; i < parts.length; i++) {
        const w = font.measure(parts[i], k);
        if (w > max) max = w;
    }
    return max;
}

// ---- fixtures used by the literal tables ----------------------------------
const FIVE = 'A\nB\nC\nD\nE';
const SNAP_YOFF = 2;        // every drawn JSON_SNAP glyph
const SNAP_BASE = 16;

/**
 * The baseline the library used, recovered from a recorded dy. `draw` computes
 * `dy = (cursorY + yoffset*scale) - base*scale`; this reproduces that expression
 * in the SAME order from an expected baseline, so the comparison is exact rather
 * than reconstructed through a lossy inverse.
 */
function expectDy(baseline, scale) {
    return baseline + SNAP_YOFF * scale - SNAP_BASE * scale;
}

/**
 * Recover the integer baseline the library used from a recorded dy, and PROVE
 * the recovery is exact by reproducing the recorded dy from it bit-for-bit.
 *
 * Subtracting two recorded dy values directly does NOT give the baseline delta:
 * `(b + c)` is computed at two different magnitudes, so `(37 + c) - (18 + c)` is
 * 19.000000000000004, not 19. Rounding to the nearest integer and then asserting
 * the round-trip is exact keeps the comparison free of any epsilon.
 */
function recoverBaseline(dy, scale, label) {
    const b = Math.round(dy - (SNAP_YOFF * scale - SNAP_BASE * scale));
    check(dy === expectDy(b, scale),
        () => 'T5/' + label + ': dy ' + dy + ' does not round-trip through baseline ' + b +
            ' (got ' + expectDy(b, scale) + ') -- the recovery is not exact');
    return b;
}

function checkBaselines(label, expected, scale) {
    check(rec.calls === expected.length,
        () => 'T5/' + label + ': drew ' + rec.calls + ' glyphs, expected ' + expected.length);
    for (let i = 0; i < expected.length; i++) {
        const want = expectDy(expected[i], scale);
        check(rec.dy[i] === want,
            () => 'T5/' + label + ': dy[' + i + '] ' + rec.dy[i] + ' != ' + want +
                ' (baseline ' + expected[i] + ')');
    }
    check(rec.dropped === 0 && rec.imgMismatch === 0 && nanScan() === 0,
        () => 'T5/' + label + ': dropped ' + rec.dropped + ' imgMismatch ' + rec.imgMismatch +
            ' nanScan ' + nanScan());
}

export function run() {
    const t5start = Date.now();
    const prng = makePrng(SEED);

    // ---- the corpus, built ONCE (8.3.2) ------------------------------------
    // Every string is ASCII by construction; any code above 126 is produced with
    // String.fromCharCode, never written as a literal byte.
    const CORPUS = [];
    for (let i = 0; i < 200; i++) {                       // printable runs
        const len = 1 + (prng() % 64);
        let s = '';
        for (let j = 0; j < len; j++) s += String.fromCharCode(32 + (prng() % 95));
        CORPUS.push(s);
    }
    for (let i = 0; i < 120; i++) {                       // full byte range, unmapped ids included
        const len = 1 + (prng() % 48);
        let s = '';
        for (let j = 0; j < len; j++) s += String.fromCharCode(prng() % 256);
        CORPUS.push(s);
    }
    for (let i = 0; i < 200; i++) {                       // embedded newline runs
        const nl = 1 + (prng() % 6);
        let s = '';
        for (let l = 0; l < nl; l++) {
            if (l > 0) s += '\n';
            const len = prng() % 25;
            for (let j = 0; j < len; j++) s += String.fromCharCode(32 + (prng() % 95));
        }
        CORPUS.push(s);
    }
    for (let i = 0; i < 20; i++) {                        // leading newline
        const len = 1 + (prng() % 24);
        let s = '';
        for (let j = 0; j < len; j++) s += String.fromCharCode(65 + (prng() % 26));
        CORPUS.push('\n' + s);
    }
    for (let i = 0; i < 20; i++) {                        // trailing newline
        const len = 1 + (prng() % 24);
        let s = '';
        for (let j = 0; j < len; j++) s += String.fromCharCode(65 + (prng() % 26));
        CORPUS.push(s + '\n');
    }
    CORPUS.push('\n\n\n');
    CORPUS.push('\n');
    CORPUS.push('');
    CORPUS.push('A'); CORPUS.push('.'); CORPUS.push(' '); CORPUS.push('~');
    CORPUS.push(String.fromCharCode(0));
    CORPUS.push(String.fromCharCode(200));
    CORPUS.push(String.fromCharCode(255));
    // The two long strings. rec holds CAP=4096 columns and every row asserts
    // dropped === 0, so a 4096-'A' string at align 0 emits exactly CAP quads --
    // the boundary, not past it. They are swept through the measure lanes and
    // through drawWrapped in slices, never drawn whole (see the slice row below).
    const LONG_A = 'A'.repeat(4096);
    let longNl = '';
    for (let i = 0; i < 4096; i++) longNl += (i % 64 === 63) ? '\n' : 'A';
    CORPUS.push(LONG_A);
    CORPUS.push(longNl);
    check(CORPUS.length >= 560 && CORPUS.length <= 590,
        () => 'T5: corpus is ' + CORPUS.length + ' strings, expected ~573');

    const FONTS = [FONT_SNAP, FONT_SNAP_KERN, FONT_ASCII];
    const JSONS = [JSON_SNAP, JSON_SNAP_KERN, JSON_ASCII];
    const T5_SCALES = [1, 1.1, 0.5, 1 / 3, 2, 0.25, 3.7, 1e-3];
    const T5_ALIGNS = [0, 1, 2];
    const T5_X = [0, 100, -7, 13.5];
    // y carries THREE fractional entries deliberately. A sweep with only integer
    // y cannot see the B1/B2 sub-fork, which is the whole point of this tier.
    const T5_Y = [0, 0.6, -0.5, 10, 10.5, 1e-3];

    // =====================================================================
    // 1. The exact five-line Y table and the fractional-y discriminator (8.3.4)
    // =====================================================================

    // Y1 -- the headline. GREEN UNDER B1 AND B2 ALIKE: not a discriminator, and
    // labelled so nobody cites it as evidence of the sub-fork.
    resetRec(ATLAS);
    FONT_SNAP.draw(rec, FIVE, 0, 0, 1.1, 0);
    checkBaselines('Y1 draw y=0 s=1.1', [0, 19, 37, 56, 75], 1.1);

    // Y2 -- THE DISCRIMINATOR. B1 gives [1, 20, 38, 57, 76]; B2 gives
    // [1, 19, 38, 57, 75]; 1.3.0 gave [1, 19.7, 38.4, 57.1, 75.8]. The two forms
    // differ at index 1 and index 4 only -- indices 0, 2 and 3 agree -- so the
    // WHOLE array is asserted, never a prefix.
    //
    // NOTE, corrected against SESSION-M4.md section 4 row 39 / 8.3.4 Y2 / A12,
    // which give index 2 as 39: the ratified B1 form is
    // Math.round(y) + Math.round(i * lineHeight * scale), and at i = 2 that is
    // 1 + Math.round(37.400000000000006) = 38. The formula is authoritative over
    // the table; 39 is unreachable from it under any rounding mode.
    resetRec(ATLAS);
    FONT_SNAP.draw(rec, FIVE, 0, 0.6, 1.1, 0);
    checkBaselines('Y2 draw y=0.6 s=1.1 (B1 DISCRIMINATOR)', [1, 20, 38, 57, 76], 1.1);

    // Y3 -- unchanged from 1.3.0. Proves the fix is narrow: at an integer step
    // nothing moves.
    resetRec(ATLAS);
    FONT_SNAP.draw(rec, FIVE, 0, 0, 1, 0);
    checkBaselines('Y3 draw y=0 s=1', [0, 17, 34, 51, 68], 1);

    // Y4 -- the ROADMAP's second measured scale. 1.3.0 drifted 0.333 px per line.
    resetRec(ATLAS);
    FONT_SNAP.draw(rec, FIVE, 0, 0, 1 / 3, 0);
    checkBaselines('Y4 draw y=0 s=1/3', [0, 6, 11, 17, 23], 1 / 3);

    // Y5 -- a NEGATIVE fractional anchor. Math.round(-0.5) is -0, and the row
    // pins what that produces.
    resetRec(ATLAS);
    FONT_SNAP.draw(rec, FIVE, 0, -0.5, 1.1, 0);
    checkBaselines('Y5 draw y=-0.5 s=1.1', [0, 19, 37, 56, 75], 1.1);

    // Y6 -- single line at a fractional y. EXPLICITLY NOT A DISCRIMINATOR: B1 and
    // B2 agree here and so does 1.3.0. Recorded so no one cites it as evidence.
    resetRec(ATLAS);
    FONT_SNAP.draw(rec, 'A', 0, 0.6, 1.1, 0);
    checkBaselines('Y6 draw single line y=0.6 (NOT a discriminator)', [1], 1.1);

    // Y7 -- drawWrapped, five one-glyph lines. Offset from Y1 is exactly
    // Math.round(base * scale) = 18, NOT base * scale = 17.6. An assertion
    // written with the raw product compares nothing and is off by 0.4 px per line.
    const LAY5 = new Float32Array(20);
    for (let l = 0; l < 5; l++) {
        LAY5[l * 4] = l * 2; LAY5[l * 4 + 1] = l * 2 + 1; LAY5[l * 4 + 2] = 8; LAY5[l * 4 + 3] = 0;
    }
    const wrapOffset = Math.round(SNAP_BASE * 1.1);
    check(wrapOffset === 18, () => 'T5/Y7: Math.round(base*scale) ' + wrapOffset + ' != 18');
    check(SNAP_BASE * 1.1 !== 18,
        () => 'T5/Y7: base*scale equals 18 -- the fixture can no longer tell the rounded offset from the raw one');
    resetRec(ATLAS);
    FONT_SNAP.drawWrapped(rec, FIVE, LAY5, 5, 100, 200, 0, 0, 1.1, 0, 0);
    checkBaselines('Y7 drawWrapped y=0 s=1.1 vAlign=0', [18, 37, 55, 74, 93], 1.1);

    // Y8 -- the cross-method relation at a FRACTIONAL y.
    //
    // CORRECTED against SESSION-M4.md 2.4 / A15, which claim
    // wrapped(i) === draw(i) + Math.round(base*scale) holds at "every fractional
    // y". It does not, and the reason is the thing B1 was chosen to preserve:
    // draw's line-0 anchor is Math.round(y), drawWrapped's is
    // Math.round(y + base*scale) -- one round of a composite -- and B1 changes
    // NEITHER. At y = 0.6 the two anchors differ by 17, not 18.
    //
    // What IS exact under B1 at every y, every scale and every vAlign, and what
    // this row asserts, is that the two methods' per-line INCREMENTS are
    // identical. The plan's form is asserted at integer y, where PROBE (e)
    // measured it.
    const drawBl = [], wrapBl = [];
    resetRec(ATLAS);
    FONT_SNAP.draw(rec, FIVE, 0, 0.6, 1.1, 0);
    for (let i = 0; i < rec.calls; i++) drawBl.push(recoverBaseline(rec.dy[i], 1.1, 'Y8 draw'));
    resetRec(ATLAS);
    FONT_SNAP.drawWrapped(rec, FIVE, LAY5, 5, 100, 200, 0, 0.6, 1.1, 0, 0);
    for (let i = 0; i < rec.calls; i++) wrapBl.push(recoverBaseline(rec.dy[i], 1.1, 'Y8 wrapped'));
    check(drawBl.length === 5 && wrapBl.length === 5,
        () => 'T5/Y8: got ' + drawBl.length + '/' + wrapBl.length + ' glyphs, expected 5/5');
    for (let i = 1; i < 5; i++) {
        check(wrapBl[i] - wrapBl[0] === drawBl[i] - drawBl[0],
            () => 'T5/Y8: increment ' + i + ' wrapped ' + (wrapBl[i] - wrapBl[0]) +
                ' != draw ' + (drawBl[i] - drawBl[0]) + ' at a fractional y');
    }
    // The anchors DIFFER by 17 here, not by Math.round(base*scale) = 18 -- that
    // is the measured consequence of drawWrapped keeping its single round of a
    // composite, and it is asserted so nobody "fixes" the relation by collapsing
    // that anchor.
    check(wrapBl[0] - drawBl[0] === 17,
        () => 'T5/Y8: fractional-y anchor offset ' + (wrapBl[0] - drawBl[0]) + ' != 17');
    // ...and at an INTEGER y the offset IS the plan's literal, on every line.
    const drawBl0 = [], wrapBl0 = [];
    resetRec(ATLAS);
    FONT_SNAP.draw(rec, FIVE, 0, 0, 1.1, 0);
    for (let i = 0; i < rec.calls; i++) drawBl0.push(recoverBaseline(rec.dy[i], 1.1, 'Y8 draw y=0'));
    resetRec(ATLAS);
    FONT_SNAP.drawWrapped(rec, FIVE, LAY5, 5, 100, 200, 0, 0, 1.1, 0, 0);
    for (let i = 0; i < rec.calls; i++) wrapBl0.push(recoverBaseline(rec.dy[i], 1.1, 'Y8 wrapped y=0'));
    for (let i = 0; i < 5; i++) {
        check(wrapBl0[i] - drawBl0[i] === wrapOffset,
            () => 'T5/Y8: integer-y offset at line ' + i + ' is ' + (wrapBl0[i] - drawBl0[i]) +
                ' != Math.round(base*scale) ' + wrapOffset);
    }

    // Y9 -- drawWrapped's LINE-0 ANCHOR at vAlign 1, with BOTH a fractional y and
    // a fractional centring term. This is the falsifiable form of B1's
    // "zero line-0 delta" claim, and it is the ONLY detector of a reviewer
    // collapsing the two composed rounds "for consistency".
    //
    // The fixture is chosen so the two rounds do NOT compose: line-0 raw is
    // 1.0 + 17.6 = 18.6 (rounds UP to 19) and the centring term is
    // (104.7 - 93.5)/2 = 5.5999... (rounds UP to 6), so composed gives 25 while a
    // single round of 24.199... gives 24. The 1.3.0 value is 25 and it must stay 25.
    const bh = 104.7, yv = 1.0;
    const totalH = 5 * 17 * 1.1;
    const composed = Math.round(yv + SNAP_BASE * 1.1) + Math.round((bh - totalH) / 2);
    const collapsed = Math.round(yv + SNAP_BASE * 1.1 + (bh - totalH) / 2);
    check(composed === 25 && collapsed === 24,
        () => 'T5/Y9: the fixture stopped discriminating -- composed ' + composed +
            ' collapsed ' + collapsed + ' (expected 25 and 24)');
    resetRec(ATLAS);
    FONT_SNAP.drawWrapped(rec, FIVE, LAY5, 5, 100, bh, 0, yv, 1.1, 0, 1);
    checkBaselines('Y9 drawWrapped vAlign=1 fractional y and centring', [25, 44, 62, 81, 100], 1.1);
    // The vAlign 2 twin, same shape.
    const composed2 = Math.round(yv + SNAP_BASE * 1.1) + Math.round(bh - totalH);
    resetRec(ATLAS);
    FONT_SNAP.drawWrapped(rec, FIVE, LAY5, 5, 100, bh, 0, yv, 1.1, 0, 2);
    check(rec.dy[0] === expectDy(composed2, 1.1),
        () => 'T5/Y9b: vAlign 2 line-0 dy ' + rec.dy[0] + ' != ' + expectDy(composed2, 1.1));

    // =====================================================================
    // 2. The F-35 and F-34 rows, enumerated (8.3.5)
    // =====================================================================
    const T = 'AAAA';
    const LAY1 = new Float32Array(4);
    function wrapQuads(a, b) {
        LAY1[0] = a; LAY1[1] = b; LAY1[2] = 32; LAY1[3] = 0;
        resetRec(ATLAS);
        FONT_SNAP.drawWrapped(rec, T, LAY1, 1, 1000, 1000, 0, 0, 1, 0, 0);
        return rec.calls;
    }

    // R1 -- the F-35 kill. The raw helper returns 24 (three glyphs) because
    // charCodeAt(-0.5) truncates TOWARD ZERO and reads index 0; the door clamps
    // first, so measureLine reports the two glyphs drawWrapped actually draws.
    check(FONT_SNAP.measureLine(T, -0.5, 2, 1) === 16,
        () => 'T5/R1: measureLine(-0.5,2) ' + FONT_SNAP.measureLine(T, -0.5, 2, 1) + ' != 16');
    check(FONT_SNAP._measureRange(T, -0.5, 2, 1) === 24,
        () => 'T5/R1: _measureRange(-0.5,2) ' + FONT_SNAP._measureRange(T, -0.5, 2, 1) +
            ' != 24 -- the internal grew a door (fork 3 A2 broken)');
    // R1b -- R1's number is the RENDERER's, not an invention.
    check(wrapQuads(-0.5, 2) === 2, () => 'T5/R1b: drawWrapped [-0.5,2) drew ' + rec.calls + ' != 2');
    check(rec.dx[0] === 0 && rec.dx[1] === 8,
        () => 'T5/R1b: dx ' + rec.dx[0] + ',' + rec.dx[1] + ' != 0,8');

    // R2 -- [0.5, 2.7) -- THE ROW THAT FORBIDS A TRUNCATING DOOR.
    // SESSION-M4.md row 29 / DONE WHEN 14 record 16 here. That is wrong twice
    // over: the 1.3.0 value is 24, not 16 (the raw walk visits i = 0.5, 1.5 and
    // 2.5, all below 2.7, and charCodeAt truncates them to indices 0, 1, 2 --
    // THREE glyphs), and 16 is only reachable by a door that pre-truncates both
    // ends, which makes measureLine report a width drawWrapped will not draw.
    // Fork (3)'s entire ratified justification is "the ONLY option under which
    // measureLine agrees with what drawWrapped renders", so the door is
    // CLAMP-ONLY and this row is 24. All three columns agree.
    check(FONT_SNAP.measureLine(T, 0.5, 2.7, 1) === 24,
        () => 'T5/R2: measureLine(0.5,2.7) ' + FONT_SNAP.measureLine(T, 0.5, 2.7, 1) +
            ' != 24 -- a Math.trunc crept into the range door and F-35 is back');
    check(FONT_SNAP._measureRange(T, 0.5, 2.7, 1) === 24,
        () => 'T5/R2: _measureRange(0.5,2.7) is not 24 -- the 1.3.0 baseline moved');
    check(wrapQuads(0.5, 2.7) === 3,
        () => 'T5/R2: drawWrapped [0.5,2.7) drew ' + rec.calls + ' != 3');
    // The criterion itself, asserted rather than described: for every range in
    // the domain, measureLine equals the width drawWrapped renders. 8 px a glyph.
    //
    // THE NaN-`end` ROWS ARE F-38 AND THEY ARE THE REASON THIS IS A LOOP OVER A
    // TABLE RATHER THAN THREE HAND-PICKED LITERALS. drawWrapped's clamp has TWO
    // legs; the first version of this door had FOUR, and the extra
    // `!(end >= 0) -> 0` leg fired on a NaN `end` and drove it to 0 where the
    // renderer drives it to `tlen` and draws the whole line. A layoutBuffer is a
    // Float32Array and NaN is exactly what it holds when a layout pass failed,
    // so this is the caller the method exists for. No tier enumerated a NaN
    // `end` before, which is how it survived ratification.
    for (const rg of [[-0.5, 2, 2], [0.5, 2.7, 3], [1.9, 3.1, 2], [0, 4, 4],
        [0, NaN, 4], [NaN, NaN, 4], [1, NaN, 3], [2, NaN, 2], [NaN, 4, 4],
        [-Infinity, NaN, 4], [-Infinity, Infinity, 4], [Infinity, Infinity, 0],
        [0, 99, 4], [0, -5, 0], [5, 2, 0], [-3, -1, 0], [0, 1, 1]]) {
        const drawn = wrapQuads(rg[0], rg[1]);
        check(drawn === rg[2],
            () => 'T5/F-35: drawWrapped [' + rg[0] + ',' + rg[1] + ') drew ' + drawn + ' != ' + rg[2]);
        check(FONT_SNAP.measureLine(T, rg[0], rg[1], 1) === drawn * 8,
            () => 'T5/F-35: measureLine [' + rg[0] + ',' + rg[1] + ') ' +
                FONT_SNAP.measureLine(T, rg[0], rg[1], 1) + ' != the ' + (drawn * 8) +
                ' px drawWrapped renders -- fork (3) criterion broken');
    }

    // R3 -- [1.9, 3.1). Door, raw helper and renderer all agree: two glyphs.
    check(FONT_SNAP.measureLine(T, 1.9, 3.1, 1) === 16,
        () => 'T5/R3: measureLine(1.9,3.1) != 16');
    check(FONT_SNAP._measureRange(T, 1.9, 3.1, 1) === 16, () => 'T5/R3: _measureRange(1.9,3.1) != 16');
    check(wrapQuads(1.9, 3.1) === 2, () => 'T5/R3: drawWrapped [1.9,3.1) drew ' + rec.calls + ' != 2');

    // R4 -- F-34 IN PROCESS. On 1.3.0 this call never returns; the whole gate
    // hangs with no output. Out of process is T9 control 13; neither substitutes
    // for the other.
    {
        const t = Date.now();
        const r4 = FONT_SNAP.measureLine(T, -Infinity, Infinity, 1);
        const ms = Date.now() - t;
        check(r4 === 32, () => 'T5/R4: measureLine(-Inf,Inf) ' + r4 + ' != 32');
        check(ms < 100, () => 'T5/R4: measureLine(-Inf,Inf) took ' + ms + ' ms');
    }
    // R5 -- CORRECTED by F-38. The plan (matrix row 32) expects 0 here. That was
    // derived from a four-leg door; drawWrapped renders the WHOLE line for a NaN
    // pair -- NaN start clamps to 0, NaN end clamps to tlen -- so the criterion
    // makes this 32, not 0. What the row really pins is that NaN never reaches
    // the walk: a clamp that let it through would read charCodeAt(NaN) forever.
    check(FONT_SNAP.measureLine(T, NaN, NaN, 1) === 32,
        () => 'T5/R5: measureLine(NaN,NaN) ' + FONT_SNAP.measureLine(T, NaN, NaN, 1) +
            ' != 32 -- an `end >= 0` leg is back and NaN is being driven to 0 (F-38)');
    check(FONT_SNAP.measureLine(T, 0, NaN, 1) === 32,
        () => 'T5/R5: measureLine(0,NaN) ' + FONT_SNAP.measureLine(T, 0, NaN, 1) + ' != 32 (F-38)');
    // The twin that keeps the NaN rows from being satisfied by "always return the
    // whole string": a NEGATIVE end still measures 0, and so does the renderer.
    check(FONT_SNAP.measureLine(T, 0, -5, 1) === 0,
        () => 'T5/R5: measureLine(0,-5) != 0');
    // R6 -- a missing end clamp.
    check(FONT_SNAP.measureLine(T, 0, 99, 1) === 32, () => 'T5/R6: measureLine(0,99) != 32');
    // R7/R8 -- F-34 through the TEXT door, in process. This object has a numeric
    // length AND a charCodeAt, so an "array-like" text door admits exactly the
    // input that hangs.
    {
        const hangy = { length: Infinity, charCodeAt() { return 65; } };
        const t = Date.now();
        const r7 = FONT_SNAP.measure(hangy);
        const r8 = FONT_SNAP.measureWidest(hangy);
        const r8b = FONT_SNAP.measureLine(hangy, 0, 4, 1);
        const ms = Date.now() - t;
        check(Number.isNaN(r7) && Number.isNaN(r8) && Number.isNaN(r8b),
            () => 'T5/R7-R8: the array-like text returned ' + r7 + '/' + r8 + '/' + r8b + ', expected NaN x3');
        check(ms < 100, () => 'T5/R7-R8: took ' + ms + ' ms');
    }
    // R9 -- the three declared deltas plus three twins, six faces of one policy.
    for (const bad of [123, null, undefined, [], {}, true]) {
        check(Number.isNaN(FONT_SNAP.measure(bad)),
            () => 'T5/R9: measure(' + String(bad) + ') is not NaN');
        check(Number.isNaN(FONT_SNAP.measureWidest(bad)),
            () => 'T5/R9: measureWidest(' + String(bad) + ') is not NaN');
        check(Number.isNaN(FONT_SNAP.measureLine(bad, 0, 1, 1)),
            () => 'T5/R9: measureLine(' + String(bad) + ') is not NaN');
    }
    // R10 -- THE TWIN FOR R9. A text door that rejects strings passes every R9 row.
    check(FONT_SNAP.measure('AA') === 16 && FONT_SNAP.measure('AA\nAA') === 32,
        () => 'T5/R10: measure("AA")/"AA\\nAA" ' + FONT_SNAP.measure('AA') + '/' +
            FONT_SNAP.measure('AA\nAA') + ' != 16/32');
    check(FONT_SNAP.measureWidest('AA\nAA') === 16 && FONT_SNAP.measureLine('AAAA', 0, 4, 1) === 32,
        () => 'T5/R10: measureWidest/measureLine twin failed');
    // R11 -- twelve cases. A NaN-only door passes the NaN and Infinity rows and
    // leaves 0 and -1 returning 0 and a NEGATIVE width forever.
    for (const s of [0, -1, NaN, Infinity]) {
        check(Number.isNaN(FONT_SNAP.measure('AA', s)), () => 'T5/R11: measure scale ' + s + ' not NaN');
        check(Number.isNaN(FONT_SNAP.measureWidest('AA', s)), () => 'T5/R11: measureWidest scale ' + s + ' not NaN');
        check(Number.isNaN(FONT_SNAP.measureLine('AA', 0, 2, s)), () => 'T5/R11: measureLine scale ' + s + ' not NaN');
    }
    // R12 -- THE TWIN FOR R11. A subnormal scale is a VALID scale: it renders
    // nothing visible and returns a correct width. A door widened to reject it
    // passes every R11 row.
    for (const face of ['measure', 'measureWidest']) {
        const v = FONT_SNAP[face]('AA', 1e-45);
        check(Number.isFinite(v) && v >= 0, () => 'T5/R12: ' + face + '(1e-45) ' + v + ' is not finite and >= 0');
    }
    {
        const v = FONT_SNAP.measureLine('AA', 0, 2, 1e-45);
        check(Number.isFinite(v) && v >= 0, () => 'T5/R12: measureLine(1e-45) ' + v + ' is not finite and >= 0');
    }
    // Empty ranges (fork 5) with their non-vacuity twin. Four rows returning 0
    // are all passed by a measureLine that returns 0 for everything; only the
    // twin can see that.
    check(FONT_SNAP.measureLine(T, 2, 2, 1) === 0, () => 'T5/fork5: [2,2) != 0');
    check(FONT_SNAP.measureLine(T, 5, 2, 1) === 0, () => 'T5/fork5: [5,2) != 0');
    check(FONT_SNAP.measureLine(T, 4, 4, 1) === 0, () => 'T5/fork5: [4,4) != 0');
    check(FONT_SNAP.measureLine(T, -3, -1, 1) === 0, () => 'T5/fork5: [-3,-1) != 0');
    check(FONT_SNAP.measureLine(T, 0, 1, 1) === 8,
        () => 'T5/fork5 TWIN: [0,1) ' + FONT_SNAP.measureLine(T, 0, 1, 1) + ' != 8 -- ' +
            'measureLine may be returning 0 unconditionally');
    // Door ORDER: a bad scale with an empty range is NaN, not 0.
    check(Number.isNaN(FONT_SNAP.measureLine(T, 2, 2, -1)),
        () => 'T5/door order: measureLine(2,2,-1) is not NaN -- the range door fired before the scale door');
    // Post-destroy: the family matches, and M4 did not change the error type.
    {
        const dead = new BitmapFont(ATLAS, JSON_SNAP);
        dead.destroy();
        for (const face of ['measure', 'measureWidest']) {
            let threw = null;
            try { dead[face]('AA'); } catch (e) { threw = e; }
            check(threw instanceof TypeError,
                () => 'T5/destroy: ' + face + ' threw ' + threw + ', expected a raw TypeError (unchanged in 1.4.0)');
        }
        let threwL = null;
        try { dead.measureLine('AA', 0, 2, 1); } catch (e) { threwL = e; }
        check(threwL instanceof TypeError,
            () => 'T5/destroy: measureLine threw ' + threwL + ', expected a raw TypeError');
    }

    // =====================================================================
    // 3. Sweep A -- draw vs the reference renderer, 50,000 tuples (8.3.3)
    // =====================================================================
    const SWEEP = 50000;
    let sweptGlyphs = 0, sweptMultiLine = 0, sweptFractionalY = 0;
    let rtDrawTotal = 0, rtQuadTotal = 0;   // A1 corpus-level count equality
    let ckAcc = 0 >>> 0;                                  // F-42 byte-identity fold
    for (let i = 0; i < SWEEP; i++) {
        const fi = prng() % 3;
        const font = FONTS[fi];
        const json = JSONS[fi];
        const si = prng() % CORPUS.length;
        const t = CORPUS[si];
        // The two 4096-char strings emit exactly CAP quads at align 0, which is
        // the boundary and not past it -- but at a scale that changes nothing
        // about the count. They stay out of the DRAW sweep and are exercised in
        // slices below, so `dropped` can never be non-zero here.
        if (t.length > 512) continue;
        const scale = T5_SCALES[prng() % T5_SCALES.length];
        const align = T5_ALIGNS[prng() % 3];
        const x = T5_X[prng() % T5_X.length];
        const y = T5_Y[prng() % T5_Y.length];

        resetRec(ATLAS);
        font.draw(rec, t, x, y, scale, align);
        const ref = refDraw(json, t, x, y, scale, align);

        check(rec.calls === ref.out.length,
            () => 'T5/sweepA: drew ' + rec.calls + ' vs reference ' + ref.out.length +
                ' (seed=' + SEED + ' i=' + i + ' fi=' + fi + ' si=' + si + ' scale=' + scale +
                ' align=' + align + ' x=' + x + ' y=' + y +
                ')  replay: TORTURE_SEED=' + SEED + ' npm run torture');
        for (let g = 0; g < ref.out.length; g++) {
            const r = ref.out[g];
            check(rec.dx[g] === r.dx && rec.dy[g] === r.dy && rec.dw[g] === r.dw && rec.dh[g] === r.dh,
                () => 'T5/sweepA: glyph ' + g + ' [' + rec.dx[g] + ',' + rec.dy[g] + ',' + rec.dw[g] +
                    ',' + rec.dh[g] + '] != reference [' + r.dx + ',' + r.dy + ',' + r.dw + ',' + r.dh +
                    '] (seed=' + SEED + ' i=' + i + ' fi=' + fi + ' si=' + si + ' scale=' + scale +
                    ' align=' + align + ' x=' + x + ' y=' + y +
                    ')  replay: TORTURE_SEED=' + SEED + ' npm run torture');
        }
        check(rec.dropped === 0, () => 'T5/sweepA: dropped ' + rec.dropped + ' (i=' + i + ')');
        check(rec.imgMismatch === 0, () => 'T5/sweepA: imgMismatch ' + rec.imgMismatch + ' (i=' + i + ')');
        check(nanScan() === 0, () => 'T5/sweepA: nanScan ' + nanScan() + ' (i=' + i + ')');

        // F-42 fold: every recorded dx/dy bit pattern into the running checksum.
        for (let g = 0; g < rec.calls; g++) {
            _ckF64[0] = rec.dx[g];
            ckAcc = (Math.imul(ckAcc ^ _ckU32[0], 0x01000193) ^ _ckU32[1]) >>> 0;
            _ckF64[0] = rec.dy[g];
            ckAcc = (Math.imul(ckAcc ^ _ckU32[0], 0x01000193) ^ _ckU32[1]) >>> 0;
        }

        // Y10 / A14 -- THE BROADEST DETECTOR IN THE SESSION. Every baseline the
        // reference used is an integer, and the exact dy equality above transfers
        // that to the library: a library that rounded only the first line would
        // have already diverged.
        for (let b = 0; b < ref.baselines.length; b++) {
            check(Number.isInteger(ref.baselines[b]),
                () => 'T5/Y10: reference baseline ' + ref.baselines[b] + ' is not an integer (i=' + i + ')');
        }
        sweptGlyphs += rec.calls;
        if (ref.baselines.length > 1) sweptMultiLine++;
        if (y !== Math.round(y)) sweptFractionalY++;

        // A1 (M5) -- THE ROUND TRIP. Snapshot draw's recording, then rebuild it
        // with layoutGlyphs + drawQuads(..., 0, 0, scale) and compare all eight
        // recorded columns element-wise plus the emitted count. layoutGlyphs
        // folds x/y/scale/align exactly as draw does, so the two recordings are
        // byte-identical. The newline-branch mutation `cursorX = x` -> `= 0`
        // moves dx on every line after the first at x != 0 and reddens here.
        const rtN = rec.calls;
        for (let g = 0; g < rtN; g++) {
            RT_SX[g] = rec.sx[g]; RT_SY[g] = rec.sy[g];
            RT_SW[g] = rec.sw[g]; RT_SH[g] = rec.sh[g];
            RT_DX[g] = rec.dx[g]; RT_DY[g] = rec.dy[g];
            RT_DW[g] = rec.dw[g]; RT_DH[g] = rec.dh[g];
        }
        resetRec(ATLAS);
        const rtCount = font.layoutGlyphs(t, RT_QUADBUF, x, y, scale, align);
        check(rtCount === rtN,
            () => 'T5/A1: layoutGlyphs emitted ' + rtCount + ' records, draw drew ' + rtN +
                ' (seed=' + SEED + ' i=' + i + ' fi=' + fi + ' si=' + si + ' scale=' + scale +
                ' align=' + align + ' x=' + x + ' y=' + y + ')');
        font.drawQuads(rec, RT_QUADBUF, 0, rtCount, 0, 0, scale);
        check(rec.calls === rtN,
            () => 'T5/A1: drawQuads blit ' + rec.calls + ' glyphs, draw drew ' + rtN + ' (i=' + i + ')');
        for (let g = 0; g < rtN; g++) {
            check(rec.sx[g] === RT_SX[g] && rec.sy[g] === RT_SY[g] &&
                  rec.sw[g] === RT_SW[g] && rec.sh[g] === RT_SH[g] &&
                  rec.dx[g] === RT_DX[g] && rec.dy[g] === RT_DY[g] &&
                  rec.dw[g] === RT_DW[g] && rec.dh[g] === RT_DH[g],
                () => 'T5/A1: quad glyph ' + g + ' [' + rec.sx[g] + ',' + rec.sy[g] + ',' +
                    rec.sw[g] + ',' + rec.sh[g] + ',' + rec.dx[g] + ',' + rec.dy[g] + ',' +
                    rec.dw[g] + ',' + rec.dh[g] + '] != draw [' + RT_SX[g] + ',' + RT_SY[g] + ',' +
                    RT_SW[g] + ',' + RT_SH[g] + ',' + RT_DX[g] + ',' + RT_DY[g] + ',' +
                    RT_DW[g] + ',' + RT_DH[g] + '] (seed=' + SEED + ' i=' + i + ' fi=' + fi +
                    ' si=' + si + ' scale=' + scale + ' align=' + align + ' x=' + x + ' y=' + y + ')');
        }
        check(rec.imgMismatch === 0 && rec.dropped === 0 && nanScan() === 0,
            () => 'T5/A1: imgMismatch ' + rec.imgMismatch + ' dropped ' + rec.dropped +
                ' nanScan ' + nanScan() + ' (i=' + i + ')');
        rtDrawTotal += rtN;
        rtQuadTotal += rec.calls;
    }
    // Non-vacuity: the sweep must actually have drawn, actually have crossed a
    // newline, and actually have used a fractional y -- or it proves nothing
    // about the fork this session ratified.
    check(sweptGlyphs > 200000,
        () => 'T5/sweepA: only ' + sweptGlyphs + ' glyphs compared -- the sweep went vacuous');
    check(sweptMultiLine > 5000,
        () => 'T5/sweepA: only ' + sweptMultiLine + ' multi-line tuples -- F-07 is barely exercised');
    check(sweptFractionalY > 10000,
        () => 'T5/sweepA: only ' + sweptFractionalY + ' fractional-y tuples -- the B1/B2 sub-fork is INVISIBLE');
    // A1 corpus-level count equality (DONE-WHEN "rec.total equality"): every draw
    // glyph over the whole sweep has exactly one quad record, and the round trip
    // actually drew (non-vacuity).
    check(rtQuadTotal === rtDrawTotal,
        () => 'T5/A1: drawQuads total ' + rtQuadTotal + ' != draw total ' + rtDrawTotal);
    check(rtQuadTotal > 200000,
        () => 'T5/A1: only ' + rtQuadTotal + ' quad glyphs round-tripped -- the round trip went vacuous');
    // F-42 byte-identity pin. Guarded to the default seed (the corpus and tuple
    // stream are seed-dependent). A moved checksum means a real string's dx or dy
    // changed -- the one failure mode this session must be unable to hide. DO NOT
    // edit T5_DXDY_CKSUM to match a regression (section 8.2).
    if (process.env.T5_CKSUM_PRINT === '1') process.stderr.write('T5_DXDY_CKSUM ' + (ckAcc >>> 0) + ' 0x' + (ckAcc >>> 0).toString(16) + '\n');
    if (SEED === T5_DEFAULT_SEED) {
        check((ckAcc >>> 0) === (T5_DXDY_CKSUM >>> 0),
            () => 'T5/F-42: dx/dy checksum 0x' + (ckAcc >>> 0).toString(16) + ' != pinned 0x' +
                (T5_DXDY_CKSUM >>> 0).toString(16) + ' -- a real string moved. DO NOT update the literal to match.');
    }

    // The long strings, drawn in drawWrapped slices of at most 512 chars, with
    // dropped asserted after each. A tier that silently drops recordings and
    // reads them as clean is the exact failure `dropped` exists to prevent.
    {
        const slice = new Float32Array(4);
        for (let start = 0; start + 512 <= LONG_A.length; start += 512) {
            slice[0] = start; slice[1] = start + 512; slice[2] = 512 * 8; slice[3] = 0;
            resetRec(ATLAS);
            FONT_SNAP.drawWrapped(rec, LONG_A, slice, 1, 10000, 10000, 0, 0, 1, 0, 0);
            check(rec.calls === 512, () => 'T5/long: slice at ' + start + ' drew ' + rec.calls + ' != 512');
            check(rec.dropped === 0, () => 'T5/long: dropped ' + rec.dropped + ' at ' + start);
            check(nanScan() === 0, () => 'T5/long: nanScan at ' + start);
        }
        check(CAP === 4096, () => 'T5/long: CAP moved to ' + CAP + ' -- re-derive the slice size');
    }

    // =====================================================================
    // 4. Sweep B -- measureLine vs _measureRange, 50,000 IN-RANGE tuples (A6)
    // =====================================================================
    // In-range integer tuples only: the door must be TRANSPARENT when it has
    // nothing to do. Out-of-range indices are policy, not arithmetic, and have
    // their enumerated rows above.
    let mlSeen = 0;
    for (let i = 0; i < SWEEP; i++) {
        const fi = prng() % 3;
        const font = FONTS[fi];
        const t = CORPUS[prng() % CORPUS.length];
        const len = t.length;
        if (len === 0) continue;
        const a = prng() % (len + 1);
        const b = a + (prng() % (len - a + 1));
        const scale = T5_SCALES[prng() % T5_SCALES.length];
        const ml = font.measureLine(t, a, b, scale);
        const mr = font._measureRange(t, a, b, scale);
        check(ml === mr,
            () => 'T5/sweepB: measureLine ' + ml + ' != _measureRange ' + mr +
                ' (seed=' + SEED + ' i=' + i + ' fi=' + fi + ' a=' + a + ' b=' + b + ' scale=' + scale +
                ')  replay: TORTURE_SEED=' + SEED + ' npm run torture');
        mlSeen++;
    }
    check(mlSeen > 45000, () => 'T5/sweepB: only ' + mlSeen + ' tuples compared');

    // =====================================================================
    // 5. measureWidest vs the ALLOCATING oracle (A5, fork 6)
    // =====================================================================
    // The oracle splits and measures each line -- it allocates, and it is allowed
    // to; the library may not, which is T6 window E's job. FONT_SNAP_KERN is the
    // fixture that can SEE the decision: on a kerningless font a measureWidest
    // that carries the kerning chain across the newline is arithmetically
    // identical to one that resets it.
    let widestSeen = 0, widestMultiLine = 0;
    for (let ci = 0; ci < CORPUS.length; ci++) {
        const t = CORPUS[ci];
        for (let fi = 0; fi < 3; fi++) {
            const font = FONTS[fi];
            for (let k = 0; k < T5_SCALES.length; k++) {
                const scale = T5_SCALES[k];
                const got = font.measureWidest(t, scale);
                const want = refWidest(font, t, scale);
                check(got === want,
                    () => 'T5/widest: measureWidest ' + got + ' != oracle ' + want +
                        ' (seed=' + SEED + ' ci=' + ci + ' fi=' + fi + ' scale=' + scale +
                        ')  replay: TORTURE_SEED=' + SEED + ' npm run torture');
                widestSeen++;
            }
            if (t.indexOf('\n') !== -1) widestMultiLine++;
        }
    }
    check(widestSeen > 13000, () => 'T5/widest: only ' + widestSeen + ' comparisons');
    check(widestMultiLine > 600,
        () => 'T5/widest: only ' + widestMultiLine + ' multi-line strings -- fork (6) is vacuous');

    // =====================================================================
    // 5b. measureWidest on a NEGATIVE-metric font (F-39)
    // =====================================================================
    // A negative xadvance or kerning amount is a valid Int16 the descriptor door
    // accepts in BOTH lanes, so a line can legitimately measure negative. The
    // whole sweep above runs on all-positive fixtures, which makes it VACUOUS
    // for that class: an accumulator seeded at 0 floors every line at 0 and
    // every all-positive assertion stays green. This block is the detector.
    let negSeen = 0, negNegative = 0;
    for (let ci = 0; ci < CORPUS.length; ci++) {
        const t = CORPUS[ci];
        for (let k = 0; k < T5_SCALES.length; k++) {
            const scale = T5_SCALES[k];
            const got = FONT_SNAP_NEG.measureWidest(t, scale);
            const want = refWidest(FONT_SNAP_NEG, t, scale);
            check(got === want,
                () => 'T5/F-39: measureWidest ' + got + ' != oracle ' + want +
                    ' on a negative-metric font (seed=' + SEED + ' ci=' + ci + ' scale=' + scale +
                    ')  replay: TORTURE_SEED=' + SEED + ' npm run torture');
            negSeen++;
            if (got < 0) negNegative++;
        }
    }
    // A3's negative half: measureWidest === measure for a newline-free string,
    // including when both are NEGATIVE. An accumulator seeded at 0 dies here.
    for (let ci = 0; ci < CORPUS.length; ci++) {
        const t = CORPUS[ci];
        if (t.indexOf('\n') !== -1) continue;
        const a = FONT_SNAP_NEG.measureWidest(t, 1);
        const b = FONT_SNAP_NEG.measure(t, 1);
        check(a === b,
            () => 'T5/F-39: measureWidest ' + a + ' != measure ' + b +
                ' on a newline-free negative-metric string (ci=' + ci + ')');
    }
    // NON-VACUITY: the fixture must actually produce negative widths, or this
    // whole section is the same blind spot in a new costume.
    check(negNegative > 2000,
        () => 'T5/F-39: only ' + negNegative + ' of ' + negSeen + ' negative-font widths were < 0 -- ' +
            'the negative fixture went positive and F-39 is unguarded again');
    // The literal rows, so a failure reads as a number.
    check(FONT_SNAP_NEG.measure('AAA') === -30 && FONT_SNAP_NEG.measureWidest('AAA') === -30,
        () => 'T5/F-39: negative font AAA measure/widest ' + FONT_SNAP_NEG.measure('AAA') + '/' +
            FONT_SNAP_NEG.measureWidest('AAA') + ' != -30/-30');
    // The empty-string family still returns 0, because an empty line IS 0 and
    // 0 > every negative -- the -Infinity seed must not leak out as a width.
    check(FONT_SNAP_NEG.measureWidest('') === 0 && FONT_SNAP_NEG.measureWidest('\n') === 0,
        () => 'T5/F-39: negative font empty/newline widest != 0 -- the -Infinity seed leaked');
    check(FONT_SNAP_NEG.measureWidest('AAA\n') === 0,
        () => 'T5/F-39: negative font "AAA\\n" widest != 0 (its trailing EMPTY line is the widest at 0)');
    check(Number.isFinite(FONT_SNAP_NEG.measureWidest('AAA')),
        () => 'T5/F-39: negative font widest is not finite -- -Infinity escaped');

    // =====================================================================
    // 6. The reference reads the RIGHT SIDE (8.3.1 property 1)
    // =====================================================================
    // JSON_SNAP has no fractional field, so the residual between the JSON-side
    // reference and the Int16-store library is EXACTLY 0. Asserting that is the
    // proof the reference is an independent witness rather than a second reader
    // of the same array -- it is asserted, not assumed.
    for (let ci = 0; ci < 64; ci++) {
        const t = CORPUS[ci];
        if (t.length === 0 || t.length > 512) continue;
        const m = refMaps(JSON_SNAP);
        const refW = refLineWidth(m, t, 0, t.length, 1);
        const libW = FONT_SNAP._measureRange(t, 0, t.length, 1);
        check(refW === libW,
            () => 'T5/witness: reference ' + refW + ' != library ' + libW +
                ' on an all-integer descriptor (ci=' + ci + ') -- the residual must be exactly 0');
    }

    // =====================================================================
    // 7. X is NOT snapped per glyph (A18, PROBE f)
    // =====================================================================
    // Passes on 1.3.0 and on 1.4.0 alike: it pins a CONTRACT, not a fix. The
    // mutation it exists for -- `cursorX = Math.round(cursorX)` inside the glyph
    // loop -- is the one most likely to be proposed as an improvement, and it is
    // rejected because it kills T0 law 1's exact three-way equality.
    resetRec(ATLAS);
    FONT_SNAP.draw(rec, 'AAAA', 0, 0, 1.1, 0);
    check(rec.calls === 4, () => 'T5/X: drew ' + rec.calls + ' != 4');
    check(rec.dx[0] === 0 && rec.dx[1] === 8.8 && rec.dx[2] === 17.6 &&
        rec.dx[3] === 26.400000000000002,
        () => 'T5/X: dx column [' + rec.dx[0] + ',' + rec.dx[1] + ',' + rec.dx[2] + ',' + rec.dx[3] +
            '] != [0, 8.8, 17.6, 26.400000000000002] -- glyph X must NOT be snapped');
    check(!Number.isInteger(rec.dx[1]),
        () => 'T5/X: dx[1] is an integer -- per-glyph X rounding shipped, and T0 law 1 is dead');

    // ---- Tier budget (8.3) -------------------------------------------------
    const elapsed = Date.now() - t5start;
    check(elapsed < 5000, () => 'T5: tier wall clock ' + elapsed + ' ms >= 5000');
}
