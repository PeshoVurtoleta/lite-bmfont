/**
 * T4 -- the drawFast digit oracle and magnitude-door tier (M1). Every assertion
 * names the mutation it kills; that column is the deliverable, not a courtesy.
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
 * F-23 (routed to M8) is PINNED here as current measured behaviour, both bands,
 * so M8's arithmetic fix forces this tier red rather than passing either way.
 */
import {
    rec, resetRec, resetTotals, nanScan, check, makePrng, SEED,
    FONT_NUM, ATLAS,
} from './harness.mjs';
import { DRAWFAST_MAX } from '../../BitmapFont.js';

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
const tenths = (s) => BigInt(s.replace('.', ''));   // "8.5" -> 85n

/** Draw v and assert it spells `expected` exactly, glyph by glyph. */
function spell(v, expected, label) {
    resetRec(ATLAS); resetTotals();
    FONT_NUM.drawFast(rec, v, 0, 0);
    check(rec.calls === expected.length, () => 'T4 ' + label + ': ' + v + ' drew ' + rec.calls + ' glyphs "' + decode() + '", expected ' + expected.length + ' "' + expected + '"');
    check(rec.total === rec.calls, () => 'T4 ' + label + ': total ' + rec.total + ' != calls ' + rec.calls + ' on ' + v);
    for (let k = 0; k < expected.length; k++) {
        check(glyphAt(k) === expected.charCodeAt(k), () => 'T4 ' + label + ': ' + v + ' glyph[' + k + '] = ' + glyphAt(k) + ', expected ' + expected.charCodeAt(k) + ' ("' + decode() + '" vs "' + expected + '")');
    }
    check(nanScan() === 0, () => 'T4 ' + label + ': NaN in a drawImage column on ' + v);
}
/** Draw v and assert nothing is drawn -- the door rejected it. */
function reject(v, label) {
    resetRec(ATLAS); resetTotals();
    FONT_NUM.drawFast(rec, v, 0, 0);
    check(rec.calls === 0 && rec.total === 0, () => 'T4 ' + label + ': ' + v + ' drew ' + rec.calls + '/' + rec.total + ' glyphs "' + decode() + '", expected 0 (door reject)');
}
/** Draw v and return its rendered string (+ NaN/total invariants). */
function libSpell(v) {
    resetRec(ATLAS); resetTotals();
    FONT_NUM.drawFast(rec, v, 0, 0);
    check(nanScan() === 0, () => 'T4 sweep: NaN in a drawImage column on ' + v);
    check(rec.total === rec.calls, () => 'T4 sweep: total ' + rec.total + ' != calls ' + rec.calls + ' on ' + v);
    return decode();
}

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

    // -- F-23 band 1 (|v| < 2^53): off-by-one-tenth on near-ties -------------
    // Pinned as CURRENT behaviour (both-directions): the library is WRONG, and the
    // two independent oracles AGREE on the right answer. M8's fix flips these.
    for (const [v, today] of [[8.45, '8.5'], [999999.95, '1000000.0']]) {
        const s = libSpell(v);
        const ex = oracleExact(v);
        check(s === today, () => 'T4 F-23 band1: ' + v + ' now renders "' + s + '", pinned "' + today + '" (M8 will change this)');
        check(oracleFixed(v) === ex, () => 'T4 F-23 band1: toFixed and exact disagree on ' + v + ' -- an oracle is wrong');
        check(s !== ex, () => 'T4 F-23 band1: ' + v + ' unexpectedly renders the exact "' + ex + '" -- F-23 band 1 fixed? re-open the pin');
    }

    // -- F-23 band 2 (2^53 < |v| <= 1e21): wrong integer digits, silent ------
    for (const [v, today] of [[762638538843020900000, '762638538843020800088.0'], [4858154237736017000, '4858154237736017846.0']]) {
        const s = libSpell(v);
        const ex = oracleExact(v);
        check(s === today, () => 'T4 F-23 band2: ' + v + ' now renders "' + s + '", pinned "' + today + '" (M8 will change this)');
        check(oracleFixed(v) === ex, () => 'T4 F-23 band2: toFixed and exact disagree on ' + v + ' -- an oracle is wrong');
        check(s !== ex, () => 'T4 F-23 band2: ' + v + ' unexpectedly renders the exact "' + ex + '" -- F-23 band 2 fixed? re-open the pin');
    }

    // -- Rows 16-18: the 10,000 seeded sweep ---------------------------------
    // 436 of 10,000 (4.4%) land above the ceiling by construction, so both lanes run.
    //
    // DIVISION OF LABOUR. The library's digits diverge from exact wherever
    // `value * 10` loses precision -- near-ties at any magnitude (band 1) and
    // systematically above 2^53 (band 2, F-23). There is NO clean magnitude
    // predicate for "the library is exact here"; oracleExact is the only truth.
    // So the FIXED sweep and the F-23 pins own tenth-level rounding EXACTLY, and
    // this seeded sweep owns broad coverage of the digit MACHINERY (order, count,
    // base). Its per-value bound tolerates the library's float drift -- which is
    // at most ~ulp(value*10) in tenths -- but a digit reversal, a dropped digit,
    // or a wrong radix moves the value by orders of magnitude and dies here.
    const next = makePrng(SEED);
    for (let i = 0; i < 10000; i++) {
        const exp = (next() % 44) - 21;
        const mant = (next() / 2 ** 32) * 10;
        let v = mant * 10 ** exp;
        if ((next() & 3) === 0) v = -v;

        if (!inDoor(v)) {
            // Row 18: a door that rejects only SOME out-of-range values (tested on
            // intPart/scaled after the multiply rather than on value) fails here.
            reject(v, 'sweep reject');
            continue;
        }

        const s = libSpell(v);
        const ex = oracleExact(v);
        if (s !== ex) {
            // Row 16: the divergence must be float-shaped. `exT >> 44` is ~2^-44
            // relative (thousands of ulps of headroom over the library's real
            // drift), `+ 2` covers a near-tie crossing a power of 10 at small
            // magnitudes. A structural mutation blows past both.
            const exT = tenths(ex);
            let d = tenths(s) - exT;
            if (d < 0n) d = -d;
            check(d <= (exT >> 44n) + 2n,
                () => 'T4 row 16 (sweep): SEED=' + SEED + ' i=' + i + ' v=' + v + ' drew "' + s + '", exact "' + ex + '" -- diff ' + d + ' tenths exceeds the float-drift bound (replay: TORTURE_SEED=' + SEED + ' npm run torture)');
        }
        // Row 17: the two independent oracles must agree below 1e21 -- guards
        // against oracleExact and the library drifting together (0 failures measured).
        if (Math.abs(v) < 1e21) {
            check(oracleFixed(v) === ex, () => 'T4 row 17 (sweep): SEED=' + SEED + ' i=' + i + ' v=' + v + ' toFixed "' + oracleFixed(v) + '" != exact "' + ex + '"');
        }
    }

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
