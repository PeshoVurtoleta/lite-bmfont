/**
 * T0 -- the advance conservation law (M0 subset).
 *
 * The subset of ROADMAP section 3's T0 that is GREEN on unmodified v1.2.0. The
 * corpus is 256 seeded strings over ASCII 33..126 -- no newlines, no unmapped
 * ids, no bad indices -- so the missing-glyph divergence (F-12) and the Int16
 * truncation drift (F-08) never enter M0's law: with integer advances and no
 * kerning in JSON_ASCII, the oracle (doubles) and the Int16 store agree exactly.
 *
 * The tiers call font._measureRange(...) directly (ROADMAP 7(d)): law 2 states a
 * THREE-way equality with _measureRange as one term, and expressing it only
 * through measure() collapses to the two-way check that passes today on F-12.
 *
 * Correctness only -- T0 makes no profiler call. Corpus strings and buffers are
 * built ONCE, before the loops; the loops use check() thunks only.
 */

import {
    makePrng, SEED, check, oracleAdvance,
    rec, resetRec, FONT_ASCII, FONT_KERN, JSON_ASCII, ATLAS,
} from './harness.mjs';

const N = 256;
const SCALES = [0.25, 0.5, 1, 2, 4];

export function run() {
    const prng = makePrng(SEED);

    // Build the corpus once. 33..126 inclusive (94 codes), length 1..48.
    const corpus = new Array(N);
    for (let i = 0; i < N; i++) {
        const len = 1 + (prng() % 48);
        let s = '';
        for (let j = 0; j < len; j++) s += String.fromCharCode(33 + (prng() % 94));
        corpus[i] = s;
    }

    // Law 1 -- three-way conservation. walk (rendered) === _measureRange
    // (library) === oracleAdvance (doubles), EXACTLY, for every scale.
    for (let i = 0; i < N; i++) {
        const t = corpus[i];
        const len = t.length;
        for (let k = 0; k < SCALES.length; k++) {
            const s = SCALES[k];
            resetRec(ATLAS);
            FONT_ASCII.draw(rec, t, 0, 0, s, 0);
            check(rec.calls === len,
                () => 'T0.law1: draw drew ' + rec.calls + ' of ' + len + ' glyphs (seed=' + SEED + ' i=' + i + ')');
            // Every tier asserts the recording never truncated (dropped) or drew the
            // wrong atlas (imgMismatch) -- a widened corpus must not silently overrun CAP.
            check(rec.dropped === 0 && rec.imgMismatch === 0,
                () => 'T0.law1: dropped ' + rec.dropped + ' imgMismatch ' + rec.imgMismatch + ' (i=' + i + ')');
            check(rec.dx[0] === 0, () => 'T0.law1: dx[0] ' + rec.dx[0] + ' != 0 (i=' + i + ')');
            // walk = last cursor + last advance - first cursor (x=0, align=0, xoffset=0).
            const walk = rec.dx[rec.calls - 1] + oracleAdvance(JSON_ASCII, t, len - 1, len, s) - rec.dx[0];
            const mr = FONT_ASCII._measureRange(t, 0, len, s);
            const orc = oracleAdvance(JSON_ASCII, t, 0, len, s);
            check(mr === orc,
                () => 'T0.law1: _measureRange ' + mr + ' != oracle ' + orc + ' (seed=' + SEED + ' i=' + i + ' s=' + s + ')');
            check(walk === mr,
                () => 'T0.law1: walk ' + walk + ' != _measureRange ' + mr + ' (seed=' + SEED + ' i=' + i + ' s=' + s + ')');
        }
    }

    // Law 2 -- scale homogeneity. measure(t, s) === measure(t, 1) * s exactly,
    // s a power of two (product by a power of two is an exact float scaling).
    const POW2 = [0.25, 0.5, 2, 4];
    for (let i = 0; i < N; i++) {
        const t = corpus[i];
        const base = FONT_ASCII.measure(t, 1);
        for (let k = 0; k < POW2.length; k++) {
            const s = POW2[k];
            const got = FONT_ASCII.measure(t, s);
            check(got === base * s,
                () => 'T0.law2: measure(t,' + s + ') ' + got + ' != measure(t,1)*' + s + ' ' + (base * s) + ' (i=' + i + ')');
        }
    }

    // Law 3 -- measure('') === 0 and measure(t) >= 0 for every corpus string.
    check(FONT_ASCII.measure('') === 0, () => 'T0.law3: measure("") != 0');
    for (let i = 0; i < N; i++) {
        const w = FONT_ASCII.measure(corpus[i]);
        check(w >= 0, () => 'T0.law3: measure(corpus[' + i + ']) ' + w + ' < 0');
    }

    // Law 4 -- the seam equation (on FONT_KERN, whose seam kerning is non-zero).
    // _measureRange(a,b) + _measureRange(b,c) === _measureRange(a,c) - kern(b-1,b)*s
    // as an EQUATION: _measureRange(a,c) carries the seam kern; the two halves do
    // not (the second half restarts prevId), so the seam kern is exactly the gap.
    const SEAM_SCALES = [0.5, 1, 2, 4];
    for (let i = 0; i < N; i++) {
        const t = corpus[i];
        const len = t.length;
        if (len < 3) continue;
        const a = 0, c = len;
        const b = 1 + (prng() % (len - 1));           // 1 <= b <= len-1
        for (let k = 0; k < SEAM_SCALES.length; k++) {
            const s = SEAM_SCALES[k];
            const left = FONT_KERN._measureRange(t, a, b, s);
            const right = FONT_KERN._measureRange(t, b, c, s);
            const full = FONT_KERN._measureRange(t, a, c, s);
            const seam = FONT_KERN.kerning[(t.charCodeAt(b - 1) << 8) | t.charCodeAt(b)] * s;
            check(left + right === full - seam,
                () => 'T0.law4: seam broke: ' + (left + right) + ' != ' + (full - seam) +
                    ' (seed=' + SEED + ' i=' + i + ' b=' + b + ' s=' + s + ')');
        }
    }

    // Law 5 -- two renderers, one law. drawWrapped with a one-line layout produces
    // a byte-identical dx column to draw, same integer origin, align=0. Compare dx
    // ONLY: draw uses cursorY=round(y) and drawWrapped uses round(y+base*scale), so
    // the dy columns differ BY DESIGN, not by bug -- do not "fix" that.
    const drawDx = new Float64Array(64);
    const layout = new Float32Array(4);
    for (let i = 0; i < 32; i++) {
        const t = corpus[i];
        const len = t.length;
        resetRec(ATLAS);
        FONT_ASCII.draw(rec, t, 0, 0, 1, 0);
        const dn = rec.calls;
        for (let g = 0; g < dn; g++) drawDx[g] = rec.dx[g];
        layout[0] = 0; layout[1] = len; layout[2] = 96; layout[3] = 0;
        resetRec(ATLAS);
        FONT_ASCII.drawWrapped(rec, t, layout, 1, 1000, 1000, 0, 0, 1, 0, 0);
        check(rec.calls === dn,
            () => 'T0.law5: drawWrapped drew ' + rec.calls + ' vs draw ' + dn + ' (i=' + i + ')');
        check(rec.dropped === 0 && rec.imgMismatch === 0,
            () => 'T0.law5: dropped ' + rec.dropped + ' imgMismatch ' + rec.imgMismatch + ' (i=' + i + ')');
        for (let g = 0; g < dn; g++) {
            check(rec.dx[g] === drawDx[g],
                () => 'T0.law5: dx[' + g + '] drawWrapped ' + rec.dx[g] + ' != draw ' + drawDx[g] + ' (i=' + i + ')');
        }
    }

    // Law 6 -- the F-06 residual, pinned as today's WRONG answer. measure() sums
    // across newlines instead of taking the widest line; M4's measureWidest lands
    // the fix and updates this pin. NOTE: the plan's literals (32/16/56/48) assumed
    // an A-xadvance-8 font; JSON_ASCII uses xadvance 12 with no kerning, so the
    // concrete numbers below are the JSON_ASCII values (A=12).
    const m1 = FONT_ASCII.measure('AA\nAA');
    const l1a = FONT_ASCII._measureRange('AA\nAA', 0, 2, 1);
    const l1b = FONT_ASCII._measureRange('AA\nAA', 3, 5, 1);
    check(m1 === 48, () => 'T0/F-06: measure("AA\\nAA") ' + m1 + ' != 48');
    check(l1a === 24 && l1b === 24, () => 'T0/F-06: per-line walks ' + l1a + ',' + l1b + ' != 24,24');
    check(m1 === l1a + l1b, () => 'T0/F-06: measure is not the cross-line SUM');
    check(m1 > (l1a > l1b ? l1a : l1b), () => 'T0/F-06: sum not greater than widest line -- bug gone?');
    const m2 = FONT_ASCII.measure('A\nAAAAAA');
    const longest = FONT_ASCII._measureRange('A\nAAAAAA', 2, 8, 1);
    check(m2 === 84, () => 'T0/F-06: measure("A\\nAAAAAA") ' + m2 + ' != 84');
    check(longest === 72, () => 'T0/F-06: longest line ' + longest + ' != 72');
}
