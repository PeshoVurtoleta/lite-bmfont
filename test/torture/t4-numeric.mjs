/**
 * T4 -- the digit-oracle and magnitude-door tier for BOTH number renderers:
 * `drawFast` (M1, ceiling DRAWFAST_MAX = 1e21, the BUFFER boundary) and
 * `drawFastInt` (M8, ceiling DRAWFASTINT_MAX = Number.MAX_SAFE_INTEGER, the
 * CORRECTNESS boundary). Every assertion names the mutation it kills; that
 * column is the deliverable, not a courtesy.
 *
 * THE TWO BODIES ARE NOT THE SAME KIND OF EXACT, and this tier must not blur it:
 * `drawFast` multiplies by 10 and is NOT exact above 2^53 (F-23, both bands,
 * re-routed to M8b) -- so its seeded sweep tolerates a float-drift bound.
 * `drawFastInt` extracts digits from `Math.trunc(value)` with `temp % 10` /
 * `Math.floor(temp / 10)` and is EXACT BY CONSTRUCTION for every value its door
 * admits (|n| <= 2^53 - 1) -- so its seeded sweep demands EXACT equality with NO
 * drift tolerance (7.2). A tier whose docstring contradicts the code below it is
 * how F-24 started; this paragraph is the antidote.
 *
 * FOUR THINGS THE READER MUST KNOW:
 *
 * 1. The 5-second budget (row 22) is a BUDGET, not the hang detector. An
 *    assertion evaluated after the tier cannot fire if the tier never returns.
 *    The real F-01 detector is T9 control 9's out-of-process spawnSync timeout.
 *
 * 2. `1e21 + 1 === 1e21` is TRUE -- 1e21's ulp is 2^17 = 131072, so the next
 *    representable double above it is `1e21 + 131072`. `nextUp` walks the IEEE
 *    bit pattern; the self-check pins the ulp fact.
 *
 * 3. THE ORACLE. `toFixed(1)` is EXACT below 1e21 (0 disagreements over 191,255
 *    in-door samples, M1-T03) and is the primary witness there. Ground truth
 *    across the WHOLE range, including >= 1e21 where toFixed goes exponential, is
 *    `oracleExact`: it reads the mantissa/exponent and scales by 10 in BigInt
 *    with NO float multiply anywhere (a tie at a tenth is impossible for a
 *    double, so half-away is exact). The plan's `BigInt(Math.round(v*10))` oracle
 *    is REJECTED and absent here: it shares the library's `value * 10` multiply,
 *    so above 2^53 it invents a tenth from float noise -- it is not independent
 *    of the thing it checks. `oracleExact` ALLOCATES (BigInt); it lives in this
 *    correctness tier only and must NEVER enter a T6 alloc-gate window.
 *
 * 4. THE DECODER COLLISION. JSON_NUM puts digit d at sx = d*10 with sw 8, and
 *    '.' at sx = 60 with sw 4 -- so '6' (id 54, sx 60) and '.' COLLIDE on sx
 *    alone. sw is load-bearing: a decoder reading sx only maps every '.' to '6'.
 *
 * F-23 (re-routed by decisions/0005 fork 1, NOT fixed here -- see the M8
 * amendment to decisions/0001) is PINNED here as current measured behaviour,
 * both bands, so the eventual arithmetic fix forces this tier red rather than
 * passing either way. These pins are the freeze on drawFast's arithmetic that M8
 * needs, since M8 is the session that must NOT move it.
 */
import {
    rec, resetRec, resetTotals, nanScan, check, makePrng, SEED,
    FONT_NUM, FONT_DIGITS, ATLAS, NUM_CYCLE, INT_CYCLE,
} from './harness.mjs';
import { DRAWFAST_MAX, DRAWFASTINT_MAX } from '../../BitmapFont.js';

// ---- oracles and bit walkers, built ONCE at module scope --------------------

const NEXT = new DataView(new ArrayBuffer(8));
// bit-increment: the next representable double above v, for v >= 0. The negative
// endpoint is reached as -nextUp(1e21) (see row 15), so only nextUp is needed.
function nextUp(v) { NEXT.setFloat64(0, v); NEXT.setBigUint64(0, NEXT.getBigUint64(0) + 1n); return NEXT.getFloat64(0); }

const DV = new DataView(new ArrayBuffer(8));
/** Bit-exact one-decimal rendering of a double. NO float multiply. Ground truth. */
function oracleExact(v) {
    if (v < 0) v = 0;
    if (Number.isInteger(v)) return BigInt(v).toString() + '.0';
    DV.setFloat64(0, v);
    const bits = DV.getBigUint64(0);
    const eb = Number((bits >> 52n) & 0x7ffn), mb = bits & 0xfffffffffffffn;
    let mant, exp;
    if (eb === 0) { mant = mb; exp = -1074n; } else { mant = mb | (1n << 52n); exp = BigInt(eb - 1075); }
    const den = 1n << (-exp);            // exp < 0 for any non-integer double
    const num = mant * 10n;
    const q = num / den, r = num % den;
    const scaled = (2n * r >= den) ? q + 1n : q;
    const s = scaled.toString();
    return s.length === 1 ? '0.' + s : s.slice(0, -1) + '.' + s.slice(-1);
}
/** Independent of the library's arithmetic. Exact only for |v| < 1e21. */
function oracleFixed(v) { return (v < 0 ? 0 : v).toFixed(1); }

/**
 * Recover the drawn character code from the recorded SOURCE rect. sw === 4 is
 * '.' (46); every digit is 48 + sx/10. Decoding sx alone would map '.' to '6'.
 */
function glyphAt(i) { return rec.sw[i] === 4 ? 46 : 48 + rec.sx[i] / 10; }
/** Decode the whole recorded window into its rendered string. */
function decode() {
    let s = '';
    for (let i = 0; i < rec.calls; i++) s += String.fromCharCode(glyphAt(i));
    return s;
}

const inDoor = (v) => v >= -DRAWFAST_MAX && v <= DRAWFAST_MAX;

// The three helpers are PARAMETERISED BY METHOD (drawName), not duplicated:
// they are cold test helpers, and the DO-NOT-EXTRACT rule of decisions/0005 is
// about BitmapFont.js's hot bodies, not about this file. Default is 'drawFast'
// so every M1 call site below is untouched; M8's rows pass 'drawFastInt'.
// A `font` arg lets A9 run the same call through the digits-only FONT_DIGITS.

/** Draw v and assert it spells `expected` exactly, glyph by glyph. */
function spell(v, expected, label, drawName = 'drawFast', font = FONT_NUM) {
    resetRec(ATLAS); resetTotals();
    font[drawName](rec, v, 0, 0);
    check(rec.calls === expected.length, () => 'T4 ' + label + ': ' + v + ' drew ' + rec.calls + ' glyphs "' + decode() + '", expected ' + expected.length + ' "' + expected + '"');
    check(rec.total === rec.calls, () => 'T4 ' + label + ': total ' + rec.total + ' != calls ' + rec.calls + ' on ' + v);
    for (let k = 0; k < expected.length; k++) {
        check(glyphAt(k) === expected.charCodeAt(k), () => 'T4 ' + label + ': ' + v + ' glyph[' + k + '] = ' + glyphAt(k) + ', expected ' + expected.charCodeAt(k) + ' ("' + decode() + '" vs "' + expected + '")');
    }
    check(nanScan() === 0, () => 'T4 ' + label + ': NaN in a drawImage column on ' + v);
}
/** Draw v and assert nothing is drawn -- the door rejected it. */
function reject(v, label, drawName = 'drawFast', font = FONT_NUM) {
    resetRec(ATLAS); resetTotals();
    font[drawName](rec, v, 0, 0);
    check(rec.calls === 0 && rec.total === 0, () => 'T4 ' + label + ': ' + v + ' drew ' + rec.calls + '/' + rec.total + ' glyphs "' + decode() + '", expected 0 (door reject)');
}
/** Draw a REJECTED value and prove the door is a TRUE no-op, not merely a
 *  no-draw. Plain reject() is BLIND to a fail-open `||` door (decisions/0005
 *  C-4a): rewriting the magnitude guard as
 *  `if (value > DRAWFASTINT_MAX || value < -DRAWFASTINT_MAX) return;` lets NaN
 *  through, `48 + (NaN % 10)` is NaN, the Uint8Array coerces it to 0, glyph 0 is
 *  unmapped and `gw > 0 && gh > 0` skips every drawImage -- so rec.calls,
 *  rec.total and nanScan() all stay 0, indistinguishable from a correct reject.
 *  drawFastInt has no unconditional non-digit write (drawFast's `buf[len++]=46`
 *  is what catches the same mutant there), so the detector is a SCRATCH CANARY:
 *  fill _charScratch with 255 -- a byte the digit loop (46, 48..57) can never
 *  write -- and assert it is untouched. Model: test/boundary.test.js:364. */
function rejectCanary(v, label, drawName = 'drawFastInt', font = FONT_NUM) {
    const buf = font._charScratch;
    buf.fill(255);
    resetRec(ATLAS); resetTotals();
    font[drawName](rec, v, 0, 0);
    check(rec.calls === 0 && rec.total === 0, () => 'T4 ' + label + ': ' + v + ' drew ' + rec.calls + '/' + rec.total + ' glyphs "' + decode() + '", expected 0 (door reject)');
    for (let k = 0; k < buf.length; k++) {
        if (buf[k] !== 255) { check(false, () => 'T4 ' + label + ': ' + v + ' TOUCHED _charScratch[' + k + ']=' + buf[k] + ' -- a fail-open door wrote a coerced digit ahead of the guard (decisions/0005 C-4a)'); break; }
    }
}
/** Draw v and return its rendered string (+ NaN/total invariants). */
function libSpell(v, drawName = 'drawFast', font = FONT_NUM) {
    resetRec(ATLAS); resetTotals();
    font[drawName](rec, v, 0, 0);
    check(nanScan() === 0, () => 'T4 sweep: NaN in a drawImage column on ' + v);
    check(rec.total === rec.calls, () => 'T4 sweep: total ' + rec.total + ' != calls ' + rec.calls + ' on ' + v);
    return decode();
}
/** The drawFastInt oracle (decisions/0005 fork 3): TRUNCATE toward zero, then
 *  clamp negatives to 0. NOT the brief's bare String(Math.trunc(v)) -- that
 *  reddens the -1 row against correct code, because negatives clamp. */
function truncOracle(v) { return String(Math.trunc(v < 0 ? 0 : v)); }

export function run() {
    const t0 = Date.now();

    // -- self-check: pins the ulp fact so a broken bit-walker cannot pass -----
    check(nextUp(1e21) === 1e21 + 131072, () => 'T4 self-check: nextUp(1e21) is not 1e21 + 131072');

    // -- Row 1: the constant itself ------------------------------------------
    // KILLS: DRAWFAST_MAX retuned to 1e20 (stops drawing legal HUD values) or 1e22 (reopens F-02).
    check(DRAWFAST_MAX === 1e21, () => 'T4 row 1: DRAWFAST_MAX is ' + DRAWFAST_MAX + ', expected 1e21');

    // -- Rows 2-3: the inclusive ceiling and the ulp identity ----------------
    // KILLS: door `>`/`<` instead of `>=`/`<=`; bound `buf.length - 1` (23 glyphs); dropped decimal.
    spell(1e21, '1000000000000000000000.0', 'row 2 ceiling');
    // KILLS: anyone "restoring" the brief's impossible `1e21 + 1 -> 0 calls` row.
    check(1e21 + 1 === 1e21, () => 'T4 row 3: 1e21 + 1 !== 1e21');
    spell(1e21 + 1, '1000000000000000000000.0', 'row 3 ulp identity');

    // -- Rows 4-6: zero, the negative clamp, the inclusive negative endpoint --
    // KILLS: do..while converted to while (would render ".0", 2 calls) for value 0.
    spell(0, '0.0', 'row 4 zero');
    spell(-0, '0.0', 'row 4 negative zero');
    // KILLS: deleting `if (value < 0) value = 0` (garbage from 48 + (-5 % 10)).
    spell(-5, '0.0', 'row 5 negative clamp');
    // KILLS: negative bound made exclusive -- breaks the exported pre-clamp contract.
    spell(-1e21, '0.0', 'row 6 negative endpoint');

    // -- Row 7: rounding to nearest tenth ------------------------------------
    // KILLS: Math.round(value*10) replaced by truncation or the float-subtraction form.
    spell(33.49, '33.5', 'row 7 round up');
    spell(1.4, '1.4', 'row 7 no drift');
    spell(0.05, '0.1', 'row 7 round half');

    // -- Row 8: digit order and count over the clean range -------------------
    // KILLS: any digit-order inversion -- the buffer is written and read backwards,
    // so a single loop-direction swap reverses every number.
    spell(1e20, '100000000000000000000.0', 'row 8 1e20');       // 23 glyphs
    spell(2 ** 53, '9007199254740992.0', 'row 8 2**53');        // 18 glyphs
    spell(1e15, '1000000000000000.0', 'row 8 1e15');            // 18 glyphs
    spell(9.99, '10.0', 'row 8 9.99');
    spell(1e6, '1000000.0', 'row 8 1e6');

    // -- A3 (re-derived, M8b): the regime seam and branch coverage -----------
    // The two regimes are output-IDENTICAL across a large overlap. Measured
    // (M8b): forcing regime A across [2^53, ~1.15e18) reproduces regime B
    // byte-for-byte -- 0 divergences below 1152957424055785000. So the boundary
    // at 2^53 is a CONSERVATIVE choice, NOT a correctness cliff, and its exact
    // position is not observable through output anywhere near the seam. The old
    // A3 mutation (`<` -> `<=` on the regime test) therefore cannot redden and is
    // RETIRED. What IS load-bearing, and pinned here:
    //
    // 1. The seam values themselves are exact against the BigInt oracle.
    spell(2 ** 53 - 2, oracleExact(2 ** 53 - 2), 'A3 seam 2^53-2');
    spell(2 ** 53,     oracleExact(2 ** 53),     'A3 seam 2^53');
    spell(2 ** 53 + 2, oracleExact(2 ** 53 + 2), 'A3 seam 2^53+2');
    //
    // 2. BRANCH COVERAGE via observable side channels (not a source read):
    //  - regime A is REACHED: a sub-2^53 NON-integer renders a non-zero tenth,
    //    which regime B (tenth hardcoded to 0) cannot produce. 8.45 -> "8.4";
    //    were regime B entered it would spell "8.0". KILLS a boundary lowered to 0.
    spell(8.45, '8.4', 'A3 regime-A reached (non-zero tenth; regime B would spell "8.0")');
    //  - regime B is REACHED: 1152957424055785000 is the smallest value where
    //    regime A's two-chunk hi/lo split loses precision -- forced through regime
    //    A it spells "1152957424045784960.0", but regime B's decimal doubling
    //    spells the exact "1152957424055784960.0". Rendering it exactly proves
    //    regime B ran. This is the RE-SPECIFIED A3 mutation: RAISE the regime
    //    boundary above 1.15e18 (e.g. `value < 2e18`) and this value routes to
    //    regime A, mis-renders, and this row reddens. Verified red in a sandbox.
    spell(1152957424055785000, oracleExact(1152957424055785000),
        'A3 regime-B reached (regime A mis-renders this; only doubling spells it exact)');

    // -- Rows 9-15: the rejected set -----------------------------------------
    // KILLS row 9: guard written with || instead of &&, or a bare `value > MAX` (NaN passes >).
    reject(NaN, 'row 9 NaN');
    // KILLS row 10: the one-sided door !(value <= MAX) -- lets -Infinity through to draw "0.0".
    reject(-Infinity, 'row 10 -Infinity');
    // KILLS row 11: the lower-bound-only door.
    reject(Infinity, 'row 11 +Infinity');
    // KILLS row 12: >= mutated to >; and door-removed-but-bound-present (24 confidently wrong glyphs).
    reject(nextUp(1e21), 'row 12 nextUp(1e21)');
    // KILLS row 13: door removed entirely -- F-02 returns as 24 NaN quads.
    reject(1e22, 'row 13 1e22');
    reject(1e100, 'row 13 1e100');
    // KILLS row 14: F-01 returns. Its failure mode is "the gate never finishes" -- see T9 control 9.
    // Reaching the next line IS the assertion; the call must return.
    reject(Number.MAX_VALUE, 'row 14 MAX_VALUE');
    // KILLS row 15: the negative half of the door deleted. These render "0.0" on v1.2.1.
    // The double just BELOW -1e21 (more negative -> outside the door) is -nextUp(1e21):
    // bit-nextDown of a negative moves toward zero, so the value-wise step is on |v|.
    reject(-nextUp(1e21), 'row 15 just below -1e21');
    reject(-1e22, 'row 15 -1e22');
    reject(-Number.MAX_VALUE, 'row 15 -MAX_VALUE');

    // -- F-23 band 1 (|v| < 2^53): the tenth is now EXACT (decisions/0007 fork 1,
    // Fast2Sum). The library CONFORMS to its published "rounded to nearest tenth"
    // guarantee, and matches both independent oracles. `was` is the pre-M8b value
    // the fix moved, quoted so a regression names what it broke.
    for (const [v, was] of [[8.45, '8.5'], [999999.95, '1000000.0']]) {
        const s = libSpell(v);
        const ex = oracleExact(v);
        check(s === ex, () => 'T4 F-23 band1: ' + v + ' renders "' + s + '", exact "' + ex + '" -- M8b closed the near-tie rounding (was "' + was + '" before decisions/0007 fork 1)');
        check(oracleFixed(v) === ex, () => 'T4 F-23 band1: toFixed and exact disagree on ' + v + ' -- an oracle is wrong');
    }

    // -- F-23 band 2 (2^53 < |v| <= 1e21): the integer digits are now EXACT --
    // the true value of the double, by decimal doubling (decisions/0007 fork 1).
    // A caller who writes 762638538843020900000 now sees the digits of the double
    // it actually became: exact, not the literal typed.
    for (const [v, was] of [[762638538843020900000, '762638538843020800088.0'], [4858154237736017000, '4858154237736017846.0']]) {
        const s = libSpell(v);
        const ex = oracleExact(v);
        check(s === ex, () => 'T4 F-23 band2: ' + v + ' renders "' + s + '", exact "' + ex + '" -- M8b closed band 2 (was "' + was + '" before decisions/0007 fork 1)');
        check(oracleFixed(v) === ex, () => 'T4 F-23 band2: toFixed and exact disagree on ' + v + ' -- an oracle is wrong');
    }

    // -- Rows 16-18: the seeded sweep, now at EXACT equality (M8b-T11) --------
    // ~4.4% land above the ceiling by construction, so both lanes run.
    //
    // M8b made drawFast exact at EVERY magnitude (decisions/0007): regime A's
    // Fast2Sum tenth carries no `value * 10` product to drift, and regime B
    // renders the double's true integer value by decimal doubling. So this sweep
    // no longer tolerates a float-drift bound -- ANY divergence from oracleExact
    // is a defect, exactly as drawFastInt's sweep already demanded. It is run
    // over TWO seeds so the exact-equality claim is sampled across two
    // independent value streams; a tolerance-free sweep that saw only one stream
    // would still be a real gate, but two makes a reintroduced drift far harder
    // to slip past on a lucky seed.
    for (const sweepSeed of [SEED, (SEED ^ 0x2545f491) >>> 0]) {
        const next = makePrng(sweepSeed);
        for (let i = 0; i < 10000; i++) {
            const exp = (next() % 44) - 21;
            const mant = (next() / 2 ** 32) * 10;
            let v = mant * 10 ** exp;
            if ((next() & 3) === 0) v = -v;

            if (!inDoor(v)) {
                // Row 18: a door that rejects only SOME out-of-range values (tested
                // on intPart/scaled after the multiply rather than on value) fails here.
                reject(v, 'sweep reject');
                continue;
            }

            const s = libSpell(v);
            const ex = oracleExact(v);
            // Row 16: EXACT equality, no drift tolerance. A digit reversal, a
            // dropped digit, a wrong radix, OR any residual drift from a
            // reintroduced `value * 10` dies here.
            check(s === ex,
                () => 'T4 row 16 (sweep): SEED=' + sweepSeed + ' i=' + i + ' v=' + v + ' drew "' + s + '", exact "' + ex + '" -- EXACT equality required, no drift (replay: TORTURE_SEED=' + SEED + ' npm run torture)');
            // Row 17: the two independent oracles must agree below 1e21 -- guards
            // against oracleExact and the library drifting together.
            if (Math.abs(v) < 1e21) {
                check(oracleFixed(v) === ex, () => 'T4 row 17 (sweep): SEED=' + sweepSeed + ' i=' + i + ' v=' + v + ' toFixed "' + oracleFixed(v) + '" != exact "' + ex + '"');
            }
        }
    }

    // ====================================================================
    // drawFastInt (M8). A SECOND hot body, exact by construction at its own
    // ceiling. Oracle: truncOracle = String(Math.trunc(v < 0 ? 0 : v)).
    // ====================================================================

    // -- The constant, and the ceiling arithmetic self-checks ----------------
    // KILLS: DRAWFASTINT_MAX retuned off Number.MAX_SAFE_INTEGER.
    check(DRAWFASTINT_MAX === Number.MAX_SAFE_INTEGER, () => 'T4 drawFastInt: DRAWFASTINT_MAX is ' + DRAWFASTINT_MAX + ', expected Number.MAX_SAFE_INTEGER');
    // Unlike 1e21 + 1 === 1e21, MAX_SAFE_INTEGER + 1 is EXACT and genuinely
    // outside the door -- so the reject rows below are real, not identities.
    check(Number.MAX_SAFE_INTEGER + 1 === 9007199254740992, () => 'T4 drawFastInt: MAX_SAFE_INTEGER + 1 is not the exact 9007199254740992');

    // -- The 19-row fixed sweep (section 7.1). 19 rows, not 20: 2^53 - 1 and
    // Number.MAX_SAFE_INTEGER are the SAME number, so there is no separate row.
    const dfi = 'drawFastInt';
    // 0 must render "0" (one glyph) -- KILLS do..while converted to while.
    spell(0, truncOracle(0), 'drawFastInt row 0', dfi);
    // -0: MEASURED, not assumed. -0 < 0 is false so the clamp does not fire;
    // Math.trunc(-0) is -0; -0 % 10 is -0; 48 + -0 is 48 = '0'. Renders "0".
    spell(-0, truncOracle(-0), 'drawFastInt row -0', dfi);
    spell(1, truncOracle(1), 'drawFastInt row 1', dfi);
    spell(9, truncOracle(9), 'drawFastInt row 9', dfi);
    spell(10, truncOracle(10), 'drawFastInt row 10', dfi);
    spell(99, truncOracle(99), 'drawFastInt row 99', dfi);
    spell(100, truncOracle(100), 'drawFastInt row 100', dfi);
    // 2^31: the Smi boundary (0.4b). 10 glyphs.
    spell(2 ** 31, truncOracle(2 ** 31), 'drawFastInt row 2^31', dfi);
    // The widest accepted output: 16 glyphs. KILLS >= mutated to > on the upper
    // bound (A4): MAX_SAFE_INTEGER must render, not reject.
    spell(Number.MAX_SAFE_INTEGER, truncOracle(Number.MAX_SAFE_INTEGER), 'drawFastInt row MAX_SAFE', dfi);
    // -1 clamps to "0" -- KILLS the brief's bare String(Math.trunc(v)) oracle,
    // which would demand "-1" against correct (clamping) code.
    spell(-1, truncOracle(-1), 'drawFastInt row -1 clamp', dfi);
    // A4 negative endpoint: -MAX_SAFE_INTEGER is INSIDE the door (then clamps to
    // "0"). The only detector for a door written with an upper bound only.
    spell(-Number.MAX_SAFE_INTEGER, truncOracle(-Number.MAX_SAFE_INTEGER), 'drawFastInt row -MAX_SAFE endpoint', dfi);
    // Fork (3) A vs B (A3): TRUNCATE, do not round. 0.4->"0", 0.5->"0", 1.9->"1".
    // KILLS Math.round(value) in place of Math.trunc (0.5->"1", 1.9->"2").
    spell(0.4, truncOracle(0.4), 'drawFastInt row 0.4 trunc', dfi);
    spell(0.5, truncOracle(0.5), 'drawFastInt row 0.5 trunc', dfi);
    spell(1.9, truncOracle(1.9), 'drawFastInt row 1.9 trunc', dfi);
    // Rejected set. 0 calls each.
    // MAX_SAFE_INTEGER + 1 -- the inclusive-ceiling step-over (A4).
    reject(Number.MAX_SAFE_INTEGER + 1, 'drawFastInt reject MAX_SAFE+1', dfi);
    // -(MAX_SAFE_INTEGER + 1) -- the negative step-over (A4).
    reject(-(Number.MAX_SAFE_INTEGER + 1), 'drawFastInt reject -(MAX_SAFE+1)', dfi);
    // 1e21 -- IN-door for drawFast, OUT for drawFastInt: the row that proves the
    // two ceilings are different numbers.
    reject(1e21, 'drawFastInt reject 1e21', dfi);
    // Number.MAX_VALUE -- F-01's shape one method over. Reaching the next line IS
    // part of the assertion: the door must return, not loop on Math.floor(v/10).
    reject(Number.MAX_VALUE, 'drawFastInt reject MAX_VALUE', dfi);
    // NaN -- KILLS a door written with || (NaN passes >). Plain reject() is
    // BLIND to this (C-4a): NaN's coerced-to-0 digit never reaches drawImage, so
    // only the scratch canary sees the write. rejectCanary pins the NaN-safety.
    rejectCanary(NaN, 'drawFastInt reject NaN', dfi);
    // +/-Infinity -- KILLS a one-sided door, both sides. Canary here too so the
    // door's NaN-safety is pinned by the same instrument across all three.
    rejectCanary(Infinity, 'drawFastInt reject +Infinity', dfi);
    rejectCanary(-Infinity, 'drawFastInt reject -Infinity', dfi);
    // Canary non-vacuity twin: the untouched-scratch checks above could never
    // fire unless an ACCEPTED value DOES write the scratch. Prove it can.
    {
        const buf = FONT_NUM._charScratch;
        buf.fill(255);
        resetRec(ATLAS); resetTotals();
        FONT_NUM.drawFastInt(rec, 120, 0, 0);
        let touched = false;
        for (let k = 0; k < buf.length; k++) if (buf[k] !== 255) { touched = true; break; }
        check(touched, () => 'T4 canary non-vacuity: drawFastInt(120) left _charScratch untouched -- the rejectCanary can never fire');
    }

    // -- A9: drawFastInt needs NO '.' glyph. FONT_DIGITS has ids 48-57, no 46.
    // KILLS: drawFastInt emitting a 46 -> on FONT_NUM this is A1, here it proves
    // the atlas-requirement difference (decisions/0005).
    spell(120, '120', 'A9 drawFastInt on digits-only font', dfi, FONT_DIGITS);
    // Non-vacuity twin: drawFast on the SAME digits-only font. The '.' (id 46) is
    // unmapped, so its zeroed slot (gw=0,gh=0) is skipped by `gw > 0 && gh > 0`
    // -- 4 quads reach drawImage with a gap where the '.' would be. That drawFast
    // LOSES the point on a digits-only atlas while drawFastInt does not is the
    // whole reason to choose drawFastInt.
    resetRec(ATLAS); resetTotals();
    FONT_DIGITS.drawFast(rec, 120, 0, 0);
    check(rec.calls === 4, () => 'T4 A9: drawFast on the digits-only font drew ' + rec.calls + ' quads, expected 4 (the . is unmapped and skipped)');

    // -- The seeded drawFastInt sweep (section 7.2): 10,000 values, EXACT
    // equality against the oracle, NO drift tolerance -- the asymmetry with
    // drawFast's tolerant row 16 IS the point: drawFast needs a tolerance because
    // `value * 10` genuinely drifts (F-23); drawFastInt is exact by construction,
    // so ANY divergence is a defect. Copying drawFast's tolerant compare in here
    // would hide the bug this sweep exists to find.
    const nextI = makePrng((SEED ^ 0x1b873593) >>> 0);
    const inDoorInt = (v) => v >= -DRAWFASTINT_MAX && v <= DRAWFASTINT_MAX;
    for (let i = 0; i < 10000; i++) {
        const exp = (nextI() % 44) - 21;
        const mant = (nextI() / 2 ** 32) * 10;
        let v = mant * 10 ** exp;
        if ((nextI() & 3) === 0) v = -v;
        if (!inDoorInt(v)) {
            reject(v, 'drawFastInt seeded reject', dfi);
            continue;
        }
        const s = libSpell(v, dfi);
        const ex = truncOracle(v);
        check(s === ex, () => 'T4 drawFastInt seeded: SEED=' + SEED + ' i=' + i + ' v=' + v + ' drew "' + s + '", exact "' + ex + '" -- EXACT equality required, no drift (replay: TORTURE_SEED=' + SEED + ' npm run torture)');
    }

    // -- The interleave (A5): the shared 24-byte _charScratch is safe by
    // exercise. 100,000 iterations alternating drawFast and drawFastInt produce,
    // per call, byte-identical recorded columns to the same call made in
    // isolation. KILLS: hoisting `len`/`temp` to an instance field, reading buf
    // before writing it, or forgetting `len = 0` -- any of which makes an
    // interleaved call differ from an isolated one.
    function callHash(seed) {
        let h = (seed ^ 0x9e3779b9) | 0;
        for (let k = 0; k < rec.calls; k++) {
            h = Math.imul(h ^ (rec.sx[k] | 0), 0x85ebca6b) | 0;
            h = Math.imul(h ^ (rec.sw[k] | 0), 0xc2b2ae35) | 0;
            h = Math.imul(h ^ (rec.dx[k] | 0), 0x27d4eb2f) | 0;
            h = Math.imul(h ^ (rec.dy[k] | 0), 0x165667b1) | 0;
        }
        h = Math.imul(h ^ rec.calls, 0x85ebca6b) | 0;
        return h >>> 0;
    }
    // Pass 1: interleaved. Even i -> drawFast, odd i -> drawFastInt.
    let s1 = 0;
    for (let i = 0; i < 100000; i++) {
        resetRec(ATLAS); resetTotals();
        if (i & 1) FONT_NUM.drawFastInt(rec, INT_CYCLE[i & 255], 0, 0);
        else FONT_NUM.drawFast(rec, NUM_CYCLE[i & 255], 0, 0);
        s1 = (s1 + callHash(i)) >>> 0;
    }
    // Pass 2: isolated. All the drawFast calls, THEN all the drawFastInt calls,
    // each grouped so no call is preceded by the other method. The per-i hash is
    // summed order-independently, so equal sums mean every i produced identical
    // columns interleaved and isolated.
    let s2 = 0;
    for (let i = 0; i < 100000; i += 2) {
        resetRec(ATLAS); resetTotals();
        FONT_NUM.drawFast(rec, NUM_CYCLE[i & 255], 0, 0);
        s2 = (s2 + callHash(i)) >>> 0;
    }
    for (let i = 1; i < 100000; i += 2) {
        resetRec(ATLAS); resetTotals();
        FONT_NUM.drawFastInt(rec, INT_CYCLE[i & 255], 0, 0);
        s2 = (s2 + callHash(i)) >>> 0;
    }
    check(s1 === s2, () => 'T4 A5 interleave: interleaved checksum ' + s1 + ' != isolated ' + s2 + ' -- the shared _charScratch corrupts across drawFast/drawFastInt calls (a hoisted len/temp, or a missing len = 0)');

    // -- Rows 19-21: tier-wide invariants ------------------------------------
    // KILLS row 19: any NaN reaching drawImage -- there is no input for which a NaN coord is right.
    check(nanScan() === 0, () => 'T4 row 19: NaN in a drawImage column at tier end');
    // KILLS row 20: a truncated recording read as clean; a wrong atlas identity.
    check(rec.dropped === 0, () => 'T4 row 20: rec.dropped is ' + rec.dropped + ' at tier end');
    check(rec.imgMismatch === 0, () => 'T4 row 20: rec.imgMismatch is ' + rec.imgMismatch + ' at tier end');
    // KILLS row 21: option D -- "fixing" F-02 by growing the scratch. An equality is not a heap gate.
    check(FONT_NUM._charScratch.byteLength === 24, () => 'T4 row 21: _charScratch is ' + FONT_NUM._charScratch.byteLength + ' bytes, expected 24');

    // -- Row 22: the tier budget (NOT the hang detector) ---------------------
    // KILLS a bounded-but-superlinear regression: a door by string conversion, or an O(value) loop.
    const ms = Date.now() - t0;
    check(ms < 5000, () => 'T4 row 22: tier took ' + ms + ' ms, budget is 5000 (a superlinear regression, not the hang -- that is T9 control 9)');
}
