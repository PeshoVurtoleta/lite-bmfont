/**
 * T0 -- the advance conservation law, in full (M2).
 *
 * ROADMAP section 2's three-way law: for a newline-free, fully-renderable range
 * the pixel advance is conserved across three independent computations --
 *   walk  = dx[calls-1] + advance(last) - dx[0]   (the rendered cursor delta)
 *   mr    = font._measureRange(t, a, b, s)          (the library helper)
 *   oracle = sum of (xadvance + kerning) from the ORIGINAL JSON, in doubles.
 * `walk === mr === oracle`, EXACTLY, at every scale. All SCALES are powers of
 * two, advances and kernings are integers, so every product is an exact float
 * and there is no epsilon anywhere in this tier.
 *
 * Laws 1-6 carry M0's intent forward; laws 7-11 are M2's. Law 4 gains its own
 * non-vacuity assertion (F-21). Law 5 is scoped to newline-free ranges (0.3) and
 * proves the exclusion with a negative fixture. Laws 7/8 settle fork (3) (F-24),
 * laws 9/10 settle fork (4) (F-25), law 11 pins the guard predicate across the
 * three sites (F-03).
 *
 * Correctness only -- T0 makes no profiler call. Corpora, layout buffers and the
 * dx snapshots are built ONCE, before every loop; check() thunks only. Tier
 * budget < 8000 ms is asserted: it is the only thing in T0 that catches a
 * bounded-but-superlinear regression (e.g. an unclamped endIdx loop).
 */

import {
    makePrng, SEED, check, nanScan,
    rec, resetRec,
    oracleAdvance,
    ATLAS,
    FONT_ASCII, FONT_KERN, JSON_ASCII, JSON_KERN,
    FONT_GAP, FONT_GAP6, JSON_GAP, JSON_GAP6,
    FONT_NL, FONT_NLK, JSON_NL, JSON_NLK,
    FONT_SNAP, FONT_SNAP_KERN,
} from './harness.mjs';
import { GLYPH_STRIDE } from '../../BitmapFont.js';

const SCALES = [0.25, 0.5, 1, 2, 4];
// Law 1's FOURTH witness (M5). CORPUS strings are <= 48 renderable glyphs, so
// layoutGlyphs emits exactly `len` records; QUAD dx joins walk/_measureRange/
// oracle. Built ONCE at module scope -- no per-iteration allocation.
const LAW1_QUADBUF = new Float64Array(48 * GLYPH_STRIDE);

export function run() {
    const t0start = Date.now();
    const prng = makePrng(SEED);

    // ---- Corpora, built ONCE (4.3) -----------------------------------------
    // CORPUS: 33..126 (all width 10, all renderable), length 1..48. The WALK is
    // only recoverable when every glyph issues a drawImage, so this corpus is
    // newline-free and gap-free. Laws 1,2,3,4,5.
    const CORPUS = new Array(512);
    for (let i = 0; i < 512; i++) {
        const len = 1 + (prng() % 48);
        let s = '';
        for (let j = 0; j < len; j++) s += String.fromCharCode(33 + (prng() % 94));
        CORPUS[i] = s;
    }
    // CORPUS_GAP: ids 65, 66, 200 (200 unmapped), length 2..32. Contains glyphs
    // that draw nothing, so it gets the TWO-way law (mr === oracle) plus pins,
    // never the walk. Laws 7, 8.
    const GAP_IDS = [65, 66, 200];
    const CORPUS_GAP = new Array(256);
    for (let i = 0; i < 256; i++) {
        const len = 2 + (prng() % 31);
        let s = '';
        for (let j = 0; j < len; j++) s += String.fromCharCode(GAP_IDS[prng() % 3]);
        CORPUS_GAP[i] = s;
    }
    // CORPUS_NL: ids 65, 66, 10, length 2..32. id 10 draws nothing and breaks the
    // line. Two-way law plus per-line-sum pin. Laws 9, 10.
    const NL_IDS = [65, 66, 10];
    const CORPUS_NL = new Array(256);
    for (let i = 0; i < 256; i++) {
        const len = 2 + (prng() % 31);
        let s = '';
        for (let j = 0; j < len; j++) s += String.fromCharCode(NL_IDS[prng() % 3]);
        CORPUS_NL[i] = s;
    }

    const FONTS = [FONT_ASCII, FONT_KERN];
    const JSONS = [JSON_ASCII, JSON_KERN];

    // ---- Law 1 -- three-way conservation, 50,000 tuples (4.4) --------------
    // Exactly the first 8,192 tuples carry the WALK (a === 0 && b === len); the
    // rest are seeded partial ranges checked two ways. All 50,000 check
    // mr === oracle exactly -- the F-21 falsification target (vacuous before
    // M2-T04, lethal after).
    const WALK_TUPLES = 8192;
    for (let i = 0; i < 50000; i++) {
        const fi = prng() & 1;
        const font = FONTS[fi];
        const json = JSONS[fi];
        const t = CORPUS[prng() % 512];
        const len = t.length;
        const s = SCALES[prng() % 5];

        let a, b;
        const fullRange = i < WALK_TUPLES;
        if (fullRange) {
            a = 0; b = len;
        } else {
            a = prng() % len;
            b = a + 1 + (prng() % (len - a));   // a < b <= len
        }

        const mr = font._measureRange(t, a, b, s);
        const orc = oracleAdvance(json, t, a, b, s);
        check(mr === orc,
            () => 'T0.law1: _measureRange ' + mr + ' != oracle ' + orc +
                ' (seed=' + SEED + ' i=' + i + ' a=' + a + ' b=' + b + ' s=' + s + ')');

        if (fullRange) {
            resetRec(ATLAS);
            font.draw(rec, t, 0, 0, s, 0);
            check(rec.calls === len,
                () => 'T0.law1: draw drew ' + rec.calls + ' of ' + len + ' (seed=' + SEED + ' i=' + i + ')');
            check(rec.dropped === 0 && rec.imgMismatch === 0,
                () => 'T0.law1: dropped ' + rec.dropped + ' imgMismatch ' + rec.imgMismatch + ' (i=' + i + ')');
            check(rec.dx[0] === 0, () => 'T0.law1: dx[0] ' + rec.dx[0] + ' != 0 (i=' + i + ')');
            check(nanScan() === 0, () => 'T0.law1: nanScan ' + nanScan() + ' != 0 (i=' + i + ')');
            const walk = rec.dx[rec.calls - 1] + oracleAdvance(json, t, len - 1, len, s) - rec.dx[0];
            check(walk === mr,
                () => 'T0.law1: walk ' + walk + ' != _measureRange ' + mr + ' (seed=' + SEED + ' i=' + i + ' s=' + s + ')');

            // FOURTH WITNESS (M5, A2): the quad dx column. layoutGlyphs folds
            // scale into dx exactly as draw does, so its walk is a fourth
            // independent path to the SAME conserved advance -- exact, no
            // epsilon. Confined to layoutGlyphs: dropping `* scale` from its
            // kerning term reddens this at kerning != 0 and scale != 1, and the
            // mr === oracle check above is untouched so it cannot preempt.
            const qn = font.layoutGlyphs(t, LAW1_QUADBUF, 0, 0, s, 0);
            check(qn === len,
                () => 'T0.law1: layoutGlyphs emitted ' + qn + ' of ' + len + ' (seed=' + SEED + ' i=' + i + ')');
            const base = 4;
            const qWalk = LAW1_QUADBUF[(qn - 1) * GLYPH_STRIDE + base] +
                oracleAdvance(json, t, len - 1, len, s) - LAW1_QUADBUF[base];
            check(qWalk === mr,
                () => 'T0.law1: quad walk ' + qWalk + ' != _measureRange ' + mr + ' (seed=' + SEED + ' i=' + i + ' s=' + s + ')');
        }
    }

    // ---- Law 2 -- scale homogeneity (4.5) ----------------------------------
    const POW2 = [0.25, 0.5, 2, 4];
    for (let i = 0; i < 512; i++) {
        const t = CORPUS[i];
        const base = FONT_ASCII.measure(t, 1);
        for (let k = 0; k < POW2.length; k++) {
            const s = POW2[k];
            const got = FONT_ASCII.measure(t, s);
            check(got === base * s,
                () => 'T0.law2: measure(t,' + s + ') ' + got + ' != measure(t,1)*' + s + ' ' + (base * s) + ' (i=' + i + ')');
        }
    }

    // ---- Law 3 -- measure('') === 0 and non-negative (4.5) ------------------
    check(FONT_ASCII.measure('') === 0, () => 'T0.law3: measure("") != 0');
    for (let i = 0; i < 512; i++) {
        const w = FONT_ASCII.measure(CORPUS[i]);
        check(w >= 0, () => 'T0.law3: measure(CORPUS[' + i + ']) ' + w + ' < 0');
    }

    // ---- Law 4 -- the seam equation on FONT_KERN, WITH non-vacuity (4.5) ----
    // left + right === full - seam, and (row 6) the loop counts its own eligible
    // and non-zero seams so it can DETECT ITS OWN VACUITY -- the direct answer to
    // AR-02 and the F-21 fix expressed as a check, not a hope.
    const SEAM_SCALES = [0.5, 1, 2, 4];
    let eligible = 0, nonZero = 0;
    for (let i = 0; i < 512; i++) {
        const t = CORPUS[i];
        const len = t.length;
        if (len < 3) continue;
        const a = 0, c = len;
        const b = 1 + (prng() % (len - 1));
        eligible++;
        // 0012 fork 1 (C-folded): the kerning store holds amount * 16 (1/16 fixed
        // point). The seam must decode it with GLYPH_ADVANCE_SCALE and fold in the
        // scale exactly as _measureRange does -- `raw * (s * 0.0625)` -- or it is
        // 16x too large. This reads the RAW store, so the *16 is the seam's to undo.
        const seamKern = FONT_KERN.kerning[(t.charCodeAt(b - 1) << 8) | t.charCodeAt(b)];
        if (seamKern !== 0) nonZero++;
        for (let k = 0; k < SEAM_SCALES.length; k++) {
            const s = SEAM_SCALES[k];
            const left = FONT_KERN._measureRange(t, a, b, s);
            const right = FONT_KERN._measureRange(t, b, c, s);
            const full = FONT_KERN._measureRange(t, a, c, s);
            const seam = seamKern * (s * 0.0625);
            check(left + right === full - seam,
                () => 'T0.law4: seam broke: ' + (left + right) + ' != ' + (full - seam) +
                    ' (seed=' + SEED + ' i=' + i + ' b=' + b + ' s=' + s + ')');
        }
    }
    check(eligible >= 200,
        () => 'T0.law4: only ' + eligible + ' eligible seams (< 200) -- corpus too short');
    check(nonZero >= 128,
        () => 'T0.law4: only ' + nonZero + ' non-zero seams (< 128) -- JSON_KERN went vacuous again (F-21)');

    // ---- Law 5 -- two renderers, one law, WITH its precondition (4.6) -------
    const drawDx = new Float64Array(64);
    const layout = new Float32Array(4);
    for (let i = 0; i < 32; i++) {
        const t = CORPUS[i];
        const len = t.length;
        // row 7: the precondition -- CORPUS is newline-free, asserted so nobody
        // widens it to include id 10 and turns law 5 into a mystery.
        check(t.indexOf('\n') === -1,
            () => 'T0.law5: CORPUS[' + i + '] contains a newline -- law 5 is scoped to newline-free ranges');
        resetRec(ATLAS);
        FONT_ASCII.draw(rec, t, 0, 0, 1, 0);
        const dn = rec.calls;
        for (let g = 0; g < dn; g++) drawDx[g] = rec.dx[g];
        layout[0] = 0; layout[1] = len; layout[2] = 96; layout[3] = 0;
        resetRec(ATLAS);
        FONT_ASCII.drawWrapped(rec, t, layout, 1, 1000, 1000, 0, 0, 1, 0, 0);
        // row 8: byte-identical dx column, same length.
        check(rec.calls === dn,
            () => 'T0.law5: drawWrapped drew ' + rec.calls + ' vs draw ' + dn + ' (i=' + i + ')');
        check(rec.dropped === 0 && rec.imgMismatch === 0,
            () => 'T0.law5: dropped ' + rec.dropped + ' imgMismatch ' + rec.imgMismatch + ' (i=' + i + ')');
        for (let g = 0; g < dn; g++) {
            check(rec.dx[g] === drawDx[g],
                () => 'T0.law5: dx[' + g + '] drawWrapped ' + rec.dx[g] + ' != draw ' + drawDx[g] + ' (i=' + i + ')');
        }
    }
    // row 9: the NEGATIVE fixture. draw BREAKS the line at id 10; drawWrapped does
    // not. Both draw 3 glyphs (the newline is zeroed, H6), but they DIVERGE at
    // index 2 -- proving the scope is real, not folklore. On v1.2.2 drawWrapped
    // drew 4. Both call counts are pinned.
    resetRec(ATLAS);
    FONT_NL.draw(rec, 'AB\nC', 0, 0);
    const dCalls = rec.calls, d0 = rec.dx[0], d1 = rec.dx[1], d2 = rec.dx[2];
    check(dCalls === 3 && d0 === 0 && d1 === 12 && d2 === 0,
        () => 'T0.law5/neg: draw(AB\\nC) ' + dCalls + ' [' + d0 + ',' + d1 + ',' + d2 + '] != 3 [0,12,0]');
    resetRec(ATLAS);
    FONT_NL.drawWrapped(rec, 'AB\nC', Float32Array.of(0, 4, 36, 0), 1, 1000, 1000, 0, 0, 1, 0, 0);
    const wCalls = rec.calls, w0 = rec.dx[0], w1 = rec.dx[1], w2 = rec.dx[2];
    check(wCalls === 3 && w0 === 0 && w1 === 12 && w2 === 24,
        () => 'T0.law5/neg: drawWrapped(AB\\nC) ' + wCalls + ' [' + w0 + ',' + w1 + ',' + w2 + '] != 3 [0,12,24]');
    check(d2 !== w2,
        () => 'T0.law5/neg: the two renderers AGREED across a newline (' + d2 + '), scope may be widenable');

    // ---- Law 6 -- the F-06 residual, pinned as today's WRONG answer (4.5) ---
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

    // ---- Law 12 (M4) -- the per-line-vs-total RESIDUAL law (F-06) -----------
    // Three equations, stated separately because they fail for different
    // reasons:
    //
    //   (i)   measure(s, k)        === sum over lines L of measure(L, k)
    //   (ii)  measureWidest(s, k)  === max over lines L of measure(L, k)
    //   (iii) measure(s,k) - measureWidest(s,k) === sum of the NON-LONGEST lines
    //
    // (i) is a property of `measure`, which M4 does not change, so it is the
    // CONTROL: if it reddens, the session broke something it promised not to
    // touch. (ii) is measureWidest's contract. (iii) IS THE F-06 NUMBER, asserted
    // as an exact value rather than as an inequality -- it is the only one of the
    // three that reads as a number in a failure message.
    //
    // The two equalities directly above (48 and 84 on FONT_ASCII) are this law's
    // control at scale 1; the residuals below re-derive them.
    //
    // DEPENDENCY, stated because it is invisible: id 10's own advance is 0 for
    // every font (M2 zeroes its seven slots, BitmapFont.js F-25 block), so the
    // sum-of-lines identity is EXACT and needs no id-10 correction term. If M9
    // ever un-zeroes those slots, this law is the first thing to re-derive.
    //
    // The right-hand side uses `_measureRange` over the ORIGINAL string rather
    // than `measure` over a `slice`: identical arithmetic (each call starts a
    // fresh kerning chain by construction) and no substring allocation.
    check(FONT_ASCII.measure('AA\nAA') - FONT_ASCII.measureWidest('AA\nAA') === 24,
        () => 'T0.law12/F-06: FONT_ASCII residual for "AA\\nAA" != 24');
    check(FONT_ASCII.measure('A\nAAAAAA') - FONT_ASCII.measureWidest('A\nAAAAAA') === 12,
        () => 'T0.law12/F-06: FONT_ASCII residual for "A\\nAAAAAA" != 12');
    check(FONT_SNAP.measure('AA\nAA') === 32 && FONT_SNAP.measureWidest('AA\nAA') === 16,
        () => 'T0.law12/F-06: FONT_SNAP "AA\\nAA" ' + FONT_SNAP.measure('AA\nAA') + '/' +
            FONT_SNAP.measureWidest('AA\nAA') + ' != 32/16');
    check(FONT_SNAP.measure('AA\nAA') - FONT_SNAP.measureWidest('AA\nAA') === 16,
        () => 'T0.law12/F-06: FONT_SNAP residual for "AA\\nAA" != 16');
    check(FONT_SNAP.measure('A\nAAAAAA') === 56 && FONT_SNAP.measureWidest('A\nAAAAAA') === 48,
        () => 'T0.law12/F-06: FONT_SNAP "A\\nAAAAAA" != 56/48');
    check(FONT_SNAP.measure('A\nAAAAAA') - FONT_SNAP.measureWidest('A\nAAAAAA') === 8,
        () => 'T0.law12/F-06: FONT_SNAP residual for "A\\nAAAAAA" != 8');
    // The trailing-newline row. A `for` that stops at the last id 10 drops the
    // final line from the max and reddens ONLY here.
    check(FONT_SNAP.measureWidest('AAA\n') === 24 && FONT_SNAP.measureWidest('\n\n\nAAA') === 24,
        () => 'T0.law12/F-06: trailing/leading newline widest != 24');
    check(FONT_SNAP.measureWidest('\n') === 0 && FONT_SNAP.measureWidest('') === 0,
        () => 'T0.law12/F-06: empty-line widest != 0');

    // The sweep. FONT_SNAP_KERN is the fixture that can SEE fork (6): on a
    // kerningless font a measureWidest that carries the kerning chain across the
    // line break is arithmetically identical to one that resets it, so running
    // this only on FONT_SNAP would be vacuous (F-21's shape). Deleting the
    // `prevId = -1` reset from measureWidest reddens (ii) and (iii) HERE.
    const RESID_FONTS = [FONT_SNAP, FONT_SNAP_KERN, FONT_ASCII];
    let residSeen = 0, residNonZero = 0, residCrossKern = 0;
    for (let fi = 0; fi < RESID_FONTS.length; fi++) {
        const font = RESID_FONTS[fi];
        for (let i = 0; i < 256; i++) {
            const t = CORPUS_NL[i];
            const len = t.length;
            for (let k = 0; k < 5; k++) {
                const s = SCALES[k];
                let sum = 0, max = 0, lineStart = 0, lines = 0;
                for (let p = 0; p <= len; p++) {
                    if (p === len || t.charCodeAt(p) === 10) {
                        const w = font._measureRange(t, lineStart, p, s);
                        sum += w;
                        if (w > max) max = w;
                        lines++;
                        lineStart = p + 1;
                    }
                }
                const total = font.measure(t, s);
                const wide = font.measureWidest(t, s);
                // (i) the CONTROL
                check(total === sum,
                    () => 'T0.law12(i): measure ' + total + ' != per-line sum ' + sum +
                        ' (seed=' + SEED + ' fi=' + fi + ' i=' + i + ' s=' + s + ')');
                // (ii) measureWidest's contract
                check(wide === max,
                    () => 'T0.law12(ii): measureWidest ' + wide + ' != per-line max ' + max +
                        ' (seed=' + SEED + ' fi=' + fi + ' i=' + i + ' s=' + s + ')');
                // (iii) THE F-06 NUMBER, exact
                check(total - wide === sum - max,
                    () => 'T0.law12(iii): residual ' + (total - wide) + ' != sum of non-longest ' +
                        (sum - max) + ' (seed=' + SEED + ' fi=' + fi + ' i=' + i + ' s=' + s + ')');
                residSeen++;
                if (total - wide !== 0) residNonZero++;
                // Non-vacuity for fork (6): count the multi-line strings on the
                // KERNED snap font whose seam glyphs carry a non-zero kern. Those
                // are the only tuples where crossing the newline would change the
                // answer at all.
                if (fi === 1 && lines > 1) {
                    for (let p = 1; p < len; p++) {
                        if (t.charCodeAt(p) === 10 && p + 1 < len &&
                            font.kerning[(t.charCodeAt(p - 1) << 8) | t.charCodeAt(p + 1)] !== 0) {
                            residCrossKern++;
                            break;
                        }
                    }
                }
            }
        }
    }
    check(residSeen === 3840, () => 'T0.law12: swept ' + residSeen + ' tuples, expected 3840');
    check(residNonZero >= 1000,
        () => 'T0.law12: only ' + residNonZero + ' non-zero residuals -- the corpus went single-line');
    check(residCrossKern >= 100,
        () => 'T0.law12: only ' + residCrossKern + ' kerned line seams on FONT_SNAP_KERN (< 100) -- ' +
            'fork (6) is VACUOUS again (F-21 shape); the newline-reset mutation would not be detected');

    // Row 16: the newline-free twin. measureWidest === measure exactly, over the
    // whole newline-free corpus at every scale. A measureWidest that resets its
    // running max at every glyph passes every multi-line row above and dies here.
    for (let i = 0; i < 512; i++) {
        const t = CORPUS[i];
        for (let k = 0; k < 5; k++) {
            const s = SCALES[k];
            const a = FONT_KERN.measureWidest(t, s);
            const b = FONT_KERN.measure(t, s);
            check(a === b,
                () => 'T0.law12/row16: measureWidest ' + a + ' != measure ' + b +
                    ' on a newline-free string (seed=' + SEED + ' i=' + i + ' s=' + s + ')');
        }
    }

    // measureLine === _measureRange for every IN-RANGE integer tuple: the door
    // must be transparent when it has nothing to do. Out-of-range indices are
    // policy, not arithmetic, and get enumerated rows in T5 instead.
    for (let i = 0; i < 512; i++) {
        const t = CORPUS[i];
        const len = t.length;
        const a = prng() % len;
        const b = a + 1 + (prng() % (len - a));
        for (let k = 0; k < 5; k++) {
            const s = SCALES[k];
            const ml = FONT_KERN.measureLine(t, a, b, s);
            const mr = FONT_KERN._measureRange(t, a, b, s);
            check(ml === mr,
                () => 'T0.law12: measureLine ' + ml + ' != _measureRange ' + mr +
                    ' (seed=' + SEED + ' i=' + i + ' a=' + a + ' b=' + b + ' s=' + s + ')');
        }
    }

    // ---- Laws 7 & 8 -- fork (3), the missing glyph and the kerning chain (4.7)
    const chr200 = String.fromCharCode(200);
    // row 10: kerning ACROSS an unmapped id, and the oracle AGREES (this is what
    // makes fork (3) non-decorative). Restoring the oracle's adv[id] skip -> 19.
    check(FONT_GAP._measureRange('A' + chr200 + 'B', 0, 3, 1) === 34,
        () => 'T0.law7/row10: FONT_GAP mr(AeB) != 34');
    check(oracleAdvance(JSON_GAP, 'A' + chr200 + 'B', 0, 3, 1) === 34,
        () => 'T0.law7/row10: oracle(JSON_GAP, AeB) != 34 (oracle skip restored?)');
    // row 11: kerning DOES apply when the two glyphs are genuinely adjacent.
    check(FONT_GAP._measureRange('AB', 0, 2, 1) === 19,
        () => 'T0.law7/row11: FONT_GAP mr(AB) ' + FONT_GAP._measureRange('AB', 0, 2, 1) + ' != 19');
    // row 12: the fork (2)x(3) interaction -- an unmapped glyph with real width.
    check(FONT_GAP6._measureRange('A' + chr200 + 'B', 0, 3, 1) === 40,
        () => 'T0.law8/row12: FONT_GAP6 mr(AeB) ' + FONT_GAP6._measureRange('A' + chr200 + 'B', 0, 3, 1) + ' != 40');
    // row 13: the two-way law at scale over the whole gap corpus x both fonts.
    for (let i = 0; i < 256; i++) {
        const t = CORPUS_GAP[i];
        const len = t.length;
        for (let k = 0; k < 5; k++) {
            const s = SCALES[k];
            const mrG = FONT_GAP._measureRange(t, 0, len, s);
            const orG = oracleAdvance(JSON_GAP, t, 0, len, s, 0);
            check(mrG === orG,
                () => 'T0.law7/row13: FONT_GAP mr ' + mrG + ' != oracle ' + orG + ' (i=' + i + ' s=' + s + ')');
            const mrG6 = FONT_GAP6._measureRange(t, 0, len, s);
            const orG6 = oracleAdvance(JSON_GAP6, t, 0, len, s, 6);
            check(mrG6 === orG6,
                () => 'T0.law8/row13: FONT_GAP6 mr ' + mrG6 + ' != oracle ' + orG6 + ' (i=' + i + ' s=' + s + ')');
        }
    }
    // row 14: coverage vs advance are independent.
    check(FONT_GAP.hasGlyph(200) === false && FONT_GAP6.hasGlyph(200) === false && FONT_GAP.hasGlyph(65) === true,
        () => 'T0.law7/row14: hasGlyph coverage wrong');

    // ---- Laws 9 & 10 -- fork (4), the newline (4.8) ------------------------
    // row 15: id 10's advance is zeroed (was 31).
    check(FONT_NL.measure('A\nA') === 24, () => 'T0.law9/row15: FONT_NL.measure(A\\nA) ' + FONT_NL.measure('A\nA') + ' != 24');
    // row 16: id-10 kernings are dropped (was 32). Independent of row 15.
    check(FONT_NLK.measure('A\nA') === 24, () => 'T0.law9/row16: FONT_NLK.measure(A\\nA) ' + FONT_NLK.measure('A\nA') + ' != 24');
    // row 17: the newline broke the chain, ordinary adjacency did not.
    // kernOf() DECODES the 1/16 store; `kerning[...]` raw is 16x pixels and must
    // never be added to pixel literals. Latent from M9a until caught in review:
    // FONT_NLK's A->A kern is structurally 0 (both defined pairs name id 10 and
    // are H7-filtered), so the raw form read 24 === 24 and could not redden. With
    // any non-zero A->A kern the raw form gives 8 where the law requires 23.
    check(FONT_NLK._measureRange('AA', 0, 2, 1) === 12 + FONT_NLK.kernOf(65, 65) + 12,
        () => 'T0.law9/row17: FONT_NLK mr(AA) ' + FONT_NLK._measureRange('AA', 0, 2, 1) + ' != 24');
    // row 18: the SIZE is zeroed too, not just the advance (else drawWrapped
    // renders the newline again and law 5 row 9 goes 3 -> 4).
    check(FONT_NL.hasGlyph(10) === false && FONT_NL.glyphs[10 * 7 + 2] === 0 && FONT_NL.glyphs[10 * 7 + 3] === 0,
        () => 'T0.law9/row18: id 10 size not zeroed');
    // row 19: two-way law at scale, AND the full measure equals the sum of the
    // per-line measures (the oracle's id-10 handling and the constructor cannot drift).
    for (let i = 0; i < 256; i++) {
        const fonts = [FONT_NL, FONT_NLK];
        const jsons = [JSON_NL, JSON_NLK];
        const t = CORPUS_NL[i];
        const len = t.length;
        for (let fj = 0; fj < 2; fj++) {
            for (let k = 0; k < 5; k++) {
                const s = SCALES[k];
                const mrN = fonts[fj]._measureRange(t, 0, len, s);
                const orN = oracleAdvance(jsons[fj], t, 0, len, s, 0);
                check(mrN === orN,
                    () => 'T0.law9/row19: mr ' + mrN + ' != oracle ' + orN + ' (fj=' + fj + ' i=' + i + ' s=' + s + ')');
                // per-line sum: split on id 10, sum each line's _measureRange.
                let sum = 0, lineStart = 0;
                for (let p = 0; p <= len; p++) {
                    if (p === len || t.charCodeAt(p) === 10) {
                        sum += fonts[fj]._measureRange(t, lineStart, p, s);
                        lineStart = p + 1;
                    }
                }
                check(mrN === sum,
                    () => 'T0.law10/row19: full ' + mrN + ' != per-line sum ' + sum + ' (fj=' + fj + ' i=' + i + ' s=' + s + ')');
            }
        }
    }

    // ---- Law 11 -- one predicate, three sites (4.9) ------------------------
    // Build three Uint8Array(256) masks ONCE from a single pass over all 256 ids,
    // including unmapped ones and chr(0). draw and drawWrapped must skip (=emit no
    // drawImage for) the IDENTICAL id set -- a per-site assertion cannot catch a
    // divergence between the two walk bodies; a cross-site one is the only shape
    // that can. If H6 failed to zero id 10's size, drawWrapped would draw it while
    // draw (newline) would not, and these two masks would diverge at index 10.
    const skipDraw = new Uint8Array(256);
    const skipWrap = new Uint8Array(256);
    const skipMeas = new Uint8Array(256);
    const ALLIDS = (() => { let s = ''; for (let id = 0; id < 256; id++) s += String.fromCharCode(id); return s; })();
    // draw: mark every id that produced NO drawImage. draw splits ALLIDS into
    // lines at id 10; the recording only holds the drawn glyphs, so we reconstruct
    // per-id by drawing each id alone (draw has no per-position hook).
    for (let id = 0; id < 256; id++) {
        const one = String.fromCharCode(id);
        resetRec(ATLAS);
        FONT_ASCII.draw(rec, one, 0, 0, 1, 0);
        skipDraw[id] = rec.calls === 0 ? 1 : 0;
        resetRec(ATLAS);
        FONT_ASCII.drawWrapped(rec, one, Float32Array.of(0, 1, 12, 0), 1, 1000, 1000, 0, 0, 1, 0, 0);
        skipWrap[id] = rec.calls === 0 ? 1 : 0;
        // measure "skip" = contributes zero advance (guard-continue OR width-0).
        skipMeas[id] = FONT_ASCII._measureRange(one, 0, 1, 1) === 0 ? 1 : 0;
    }
    for (let id = 0; id < 256; id++) {
        check(skipDraw[id] === skipWrap[id],
            () => 'T0.law11: draw/drawWrapped disagree on skipping id ' + id +
                ' (draw ' + skipDraw[id] + ' wrap ' + skipWrap[id] + ')');
        // Every id a renderer DREW must carry a non-zero advance (skipMeas 0).
        if (skipDraw[id] === 0) {
            check(skipMeas[id] === 0,
                () => 'T0.law11: draw drew id ' + id + ' but _measureRange gave it 0 advance');
        }
    }
    // The _measureRange guard itself: an out-of-range index yields a NaN id, which
    // the reference-form guard REJECTS. A reverted `id < 0 || id >= 256` accepts
    // NaN and `glyphs[NaN*7+6]` poisons the width. This is the one site where the
    // guard is reachable through the public surface (draw has no range; drawWrapped
    // clamps), so it is pinned directly.
    check(FONT_ASCII._measureRange('A', 0, 2, 1) === 12,
        () => 'T0.law11: _measureRange("A",0,2) ' + FONT_ASCII._measureRange('A', 0, 2, 1) + ' != 12 (NaN id leaked past the guard)');

    // ---- Tier budget (4.1) -------------------------------------------------
    const elapsed = Date.now() - t0start;
    check(elapsed < 8000, () => 'T0: tier wall clock ' + elapsed + ' ms >= 8000 (superlinear regression?)');
}
