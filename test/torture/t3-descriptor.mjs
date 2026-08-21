/**
 * T3 -- the descriptor/constructor abuse matrix (M3, decisions/0003).
 *
 * Every row of the 50-row accept/reject matrix, each throwing row carrying its
 * non-vacuity twin -- a nearby input that must NOT throw -- because an
 * always-throwing door passes every `throws` assertion in the tier. Every
 * CHECKED row is run twice, once with { checked: true } and once without (row
 * 56, lane symmetry): a checked-only assertion cannot see a test that landed in
 * the wrong lane.
 *
 * Imports from harness.mjs ONLY (one recording ctx in the whole suite -- rule 1).
 * No profiler call. T3 makes no measured window, so it constructs fonts inside
 * the row that needs them; the only hygiene rule is "never inside a loop".
 *
 * Base descriptor OK: one glyph, id 65, ADVANCE 12 (matching JSON_ASCII at
 * harness.mjs:196) so no number in this tier can inherit M2's advance-8 mistake.
 *
 * Tier budget < 3000 ms, asserted at the end.
 */

import {
    check, nanScan, rec, resetRec, ATLAS, FONT_ASCII, FONT_NUM,
} from './harness.mjs';
import { BitmapFont, BitmapFontError } from '../../BitmapFont.js';

// ---- builders (allocate freely: no measured window) --------------------------
const mkChar = (o) => Object.assign(
    { id: 65, x: 0, y: 0, width: 10, height: 14, xoffset: 0, yoffset: 2, xadvance: 12 }, o);
const mkFont = (o) => Object.assign({ common: { lineHeight: 20, base: 16 }, chars: [mkChar()] }, o);

const TEXT = 'HELLO';
const T2LAYOUT = (flags) => Float32Array.of(0, 5, 60, flags);

// ---- the error-type + message-quality sweep, applied to EVERY throwing row ---
// rows 51 (error type) and 52 (message quality) are not a separate pass: they
// are enforced here, so a door that throws the wrong type or an unfielded error
// reddens the very row that exercised it.
function throwsBFE(label, fn, field, ...contains) {
    let e = null;
    try { fn(); } catch (x) { e = x; }
    check(e !== null, () => 'T3/' + label + ': expected a throw, got none');
    check(e instanceof BitmapFontError,
        () => 'T3/' + label + ': not a BitmapFontError (row 51): ' + (e && e.constructor && e.constructor.name));
    check(e instanceof RangeError && e instanceof Error,
        () => 'T3/' + label + ': not instanceof RangeError/Error (row 51)');
    check(e.name === 'BitmapFontError', () => 'T3/' + label + ': name ' + e.name + ' != BitmapFontError');
    check(typeof e.field === 'string' && e.field.length > 0,
        () => 'T3/' + label + ': field is not a non-empty string: ' + String(e.field));
    check(e.field.includes(field), () => 'T3/' + label + ': field ' + e.field + ' does not name ' + field);
    check(typeof e.message === 'string' && e.message.slice(0, 13) === 'lite-bmfont: ',
        () => 'T3/' + label + ': message does not start "lite-bmfont: ": ' + e.message);
    check(e.message.includes(e.field), () => 'T3/' + label + ': message omits field ' + e.field + ': ' + e.message);
    check(e.message.includes(', got '),
        () => 'T3/' + label + ': message omits the received value (row 52): ' + e.message);
    for (const c of contains) {
        check(e.message.includes(c), () => 'T3/' + label + ': message missing "' + c + '": ' + e.message);
    }
    return e;
}
function constructs(label, fn) {
    let e = null;
    try { fn(); } catch (x) { e = x; }
    check(e === null, () => 'T3/' + label + ': expected no throw, got ' + (e && e.message));
}
function clean(label) {
    check(nanScan() === 0, () => 'T3/' + label + ': nanScan ' + nanScan() + ' != 0 (row 53)');
    check(rec.dropped === 0 && rec.imgMismatch === 0,
        () => 'T3/' + label + ': dropped ' + rec.dropped + ' imgMismatch ' + rec.imgMismatch + ' (row 54)');
}

export function run() {
    const t3start = Date.now();

    // ==== the atlas / fontJson / common door, rows 1-11 =====================
    throwsBFE('1 atlas null', () => new BitmapFont(null, mkFont()), 'imageAtlas', 'imageAtlas');
    throwsBFE('2 atlas undefined', () => new BitmapFont(undefined, mkFont()), 'imageAtlas');
    throwsBFE('3 atlas primitive', () => new BitmapFont(7, mkFont()), 'imageAtlas');
    constructs('3b twin atlas {}', () => new BitmapFont({}, mkFont()));          // ACCEPT

    throwsBFE('4 fontJson null', () => new BitmapFont(ATLAS, null), 'fontJson');
    throwsBFE('5 fontJson {}', () => new BitmapFont(ATLAS, {}), 'common');
    throwsBFE('6 fontJson primitive', () => new BitmapFont(ATLAS, 7), 'fontJson');
    throwsBFE('7 common null', () => new BitmapFont(ATLAS, { common: null, chars: [mkChar()] }), 'common');
    throwsBFE('7 common missing', () => new BitmapFont(ATLAS, { chars: [mkChar()] }), 'common');

    throwsBFE('8 lineHeight NaN',
        () => new BitmapFont(ATLAS, { common: { lineHeight: NaN, base: 16 }, chars: [mkChar()] }),
        'common.lineHeight', 'NaN');
    throwsBFE('9 lineHeight string',
        () => new BitmapFont(ATLAS, { common: { lineHeight: '20', base: 16 }, chars: [mkChar()] }),
        'common.lineHeight');
    throwsBFE('9 lineHeight bool',
        () => new BitmapFont(ATLAS, { common: { lineHeight: true, base: 16 }, chars: [mkChar()] }),
        'common.lineHeight');
    throwsBFE('10 base NaN',
        () => new BitmapFont(ATLAS, { common: { lineHeight: 20, base: NaN }, chars: [mkChar()] }),
        'common.base');
    throwsBFE('11 base string',
        () => new BitmapFont(ATLAS, { common: { lineHeight: 20, base: '16' }, chars: [mkChar()] }),
        'common.base');
    constructs('11b twin lineHeight 0 base 0',                                   // 0 is not falsy-rejected
        () => new BitmapFont(ATLAS, { common: { lineHeight: 0, base: 0 }, chars: [mkChar()] }));

    // ==== the chars / kernings pre-pass, rows 12-18, 27-29 ==================
    throwsBFE('12 chars missing', () => new BitmapFont(ATLAS, { common: { lineHeight: 20, base: 16 } }), 'chars');
    throwsBFE('13 chars 7', () => new BitmapFont(ATLAS, { common: { lineHeight: 20, base: 16 }, chars: 7 }), 'chars', 'number');
    // row 14: the string clause. A LENGTH-ONLY test (the brief's prescription)
    // passes 'AB' and this row goes red -- 0.1a made executable.
    throwsBFE('14 chars AB', () => new BitmapFont(ATLAS, { common: { lineHeight: 20, base: 16 }, chars: 'AB' }), 'chars', 'string');
    throwsBFE('15 chars {length:-1}',
        () => new BitmapFont(ATLAS, { common: { lineHeight: 20, base: 16 }, chars: { length: -1 } }), 'chars.length', '-1');
    throwsBFE('16 chars {length:3} empty',
        () => new BitmapFont(ATLAS, { common: { lineHeight: 20, base: 16 }, chars: { length: 3 } }), 'chars[0]');
    // row 17: the tier's PRIMARY non-vacuity twin. chars [] constructs coherently.
    constructs('17 chars []', () => new BitmapFont(ATLAS, { common: { lineHeight: 20, base: 16 }, chars: [] }));
    {
        const f = new BitmapFont(ATLAS, { common: { lineHeight: 20, base: 16 }, chars: [] });
        check(f.measure('A') === 0, () => 'T3/17: chars [] measure(A) ' + f.measure('A') + ' != 0');
        check(f.hasGlyph(65) === false, () => 'T3/17: chars [] hasGlyph(65) not false');
    }
    throwsBFE('18 chars [null]', () => new BitmapFont(ATLAS, mkFont({ chars: [null] })), 'chars[0]');
    throwsBFE('18 chars [7]', () => new BitmapFont(ATLAS, mkFont({ chars: [7] })), 'chars[0]');

    constructs('27 kernings null', () => new BitmapFont(ATLAS, mkFont({ kernings: null })));
    constructs('27 kernings absent', () => new BitmapFont(ATLAS, mkFont()));
    throwsBFE('28 kernings 7', () => new BitmapFont(ATLAS, mkFont({ kernings: 7 })), 'kernings', 'number');
    throwsBFE('29 kernings [null]', () => new BitmapFont(ATLAS, mkFont({ kernings: [null] })), 'kernings[0]');

    // ==== the per-char field door, rows 19-26 ==============================
    const eId = throwsBFE('19 id string', () => new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ id: '65' })] })), 'chars[0].id', '65');
    throwsBFE('19b id null', () => new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ id: null })] })), 'chars[0].id');
    throwsBFE('19b id true', () => new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ id: true })] })), 'chars[0].id');
    throwsBFE('20 id 65.5', () => new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ id: 65.5 })] })), 'chars[0].id');
    // row 20b: NaN/Infinity are ALWAYS-THROW (both lanes). Routing NaN to the
    // checked lane reddens the UNCHECKED half here -- the direct kill for the
    // rows 20/21 contradiction.
    for (const v of [NaN, Infinity, -Infinity]) {
        throwsBFE('20b id ' + v + ' unchecked', () => new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ id: v })] })), 'chars[0].id');
        throwsBFE('20b id ' + v + ' checked', () => new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ id: v })] }), { checked: true }), 'chars[0].id');
    }
    // row 21: FINITE integer id outside [0,256). NaN is NOT in this case list.
    // 0012 fork 6: checked defaults ON, so the SKIP lane is opted into explicitly.
    for (const v of [-1, 256, 3000]) {
        constructs('21 id ' + v + ' unchecked', () => new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ id: v })] }), { checked: false }));
        const f = new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ id: v })] }), { checked: false });
        check(f.hasGlyph(v) === false, () => 'T3/21: id ' + v + ' unchecked hasGlyph true');
        throwsBFE('21 id ' + v + ' checked', () => new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ id: v })] }), { checked: true }), 'chars[0].id');
        constructs('21 id ' + v + ' default(checked) throws instead', () => { try { new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ id: v })] })); throw new Error('did not throw'); } catch (e) { if (!(e instanceof BitmapFontError)) throw e; } });
    }

    // row 22: F-30, non-finite glyph field, BOTH lanes.
    for (const v of [NaN, Infinity, -Infinity]) {
        throwsBFE('22 x ' + v + ' unchecked', () => new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ x: v })] })), 'chars[0].x');
        throwsBFE('22 x ' + v + ' checked', () => new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ x: v })] }), { checked: true }), 'chars[0].x');
    }
    throwsBFE('23 x string', () => new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ x: '10' })] })), 'chars[0].x');

    // row 24: x 40000 -- unchecked WRAPS (pinned), checked throws naming both numbers.
    {
        const f = new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ x: 40000 })] }), { checked: false });
        check(f.glyphs[65 * 7] === -25536, () => 'T3/24: x 40000 unchecked stored ' + f.glyphs[65 * 7] + ' != -25536');
        throwsBFE('24 x 40000 checked', () => new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ x: 40000 })] }), { checked: true }),
            'chars[0].x', '40000', '-25536');
    }
    // row 25: xadvance 8.6 -- 0012 fork 1 (C-folded). Stores round(8.6*16)=138 in
    // BOTH lanes (the declared 1/16 resolution retires the integrality throw), so
    // advanceOf 8.625 and measure('AA') 17.25 -- EXACT literals, never a tolerance
    // (S-4). v1.x stored 8 (measure 16, 1.2px/glyph drift); that number is dead.
    {
        const fu = new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ xadvance: 8.6 })] }), { checked: false });
        const fc = new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ xadvance: 8.6 })] }), { checked: true });
        check(fu.glyphs[65 * 7 + 6] === 138 && fc.glyphs[65 * 7 + 6] === 138,
            () => 'T3/25: xadvance 8.6 stored ' + fu.glyphs[65 * 7 + 6] + '/' + fc.glyphs[65 * 7 + 6] + ' != 138');
        check(fc.advanceOf(65) === 8.625, () => 'T3/25: advanceOf ' + fc.advanceOf(65) + ' != 8.625');
        check(fc.measure('AA') === 17.25, () => 'T3/25: measure(AA) ' + fc.measure('AA') + ' != 17.25');
    }
    // row 26: xadvance -8.6. Row 56 (lane symmetry) requires BOTH lanes, and the
    // checked-lane message is required to say "toward zero" and never "floor"
    // (A9) -- so the UNCHECKED behaviour that wording describes MUST be pinned too,
    // or the wording could keep passing while the store changed to floor (F-33,
    // found and closed in M3). Unchecked twin: the Int16 store truncates toward
    // ZERO, storing -8; floor would give -9.
    {
        // 0012 fork 1: -8.6 is a valid sub-pixel advance, stores round(-8.6*16)=-138
        // in BOTH lanes (no integrality throw for this slot), advanceOf -8.625.
        const fu = new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ xadvance: -8.6 })] }), { checked: false });
        const fc = new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ xadvance: -8.6 })] }), { checked: true });
        check(fu.glyphs[65 * 7 + 6] === -138 && fc.glyphs[65 * 7 + 6] === -138,
            () => 'T3/26: xadvance -8.6 stored ' + fu.glyphs[65 * 7 + 6] + '/' + fc.glyphs[65 * 7 + 6] + ' != -138');
        check(fc.advanceOf(65) === -8.625, () => 'T3/26: advanceOf ' + fc.advanceOf(65) + ' != -8.625');
        // F-33/A9: the "toward zero, never floor" wording still guards slots 0-5
        // (they keep the Int16 integrality lane). Pin it on x (slot 0): -8.6 under
        // checked throws "truncates ... toward zero to -8", never floor (-9).
        const e = throwsBFE('26 x -8.6 checked toward-zero', () => new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ x: -8.6 })] }), { checked: true }), 'chars[0].x', 'toward zero');
        check(e.message.includes('-8') && !e.message.includes('floor'),
            () => 'T3/26: slot-0 message not "toward zero to -8" or says floor: ' + e.message);
    }
    // row 26b twin: xadvance 12 does not throw in EITHER lane.
    constructs('26b twin xadvance 12 unchecked', () => new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ xadvance: 12 })] })));
    constructs('26b twin xadvance 12 checked', () => new BitmapFont(ATLAS, mkFont({ chars: [mkChar({ xadvance: 12 })] }), { checked: true }));

    // ==== the kerning key door, rows 30-36 =================================
    const eK = throwsBFE('30 first string', () => new BitmapFont(ATLAS, mkFont({ kernings: [{ first: '65', second: 66, amount: 5 }] })),
        'kernings[0].first', '65');
    throwsBFE('30 first true', () => new BitmapFont(ATLAS, mkFont({ kernings: [{ first: true, second: 66, amount: 5 }] })), 'kernings[0].first');
    throwsBFE('31 first 65.5', () => new BitmapFont(ATLAS, mkFont({ kernings: [{ first: 65.5, second: 66, amount: 5 }] })), 'kernings[0].first');
    throwsBFE('31 second 255.9', () => new BitmapFont(ATLAS, mkFont({ kernings: [{ first: 65, second: 255.9, amount: 5 }] })), 'kernings[0].second');
    // row 31b: the SHARED-predicate cross-check. id '65' and first '65' messages
    // differ ONLY in the field name. Two divergent copies of the predicate red it.
    {
        const normId = eId.message.replace(eId.field, 'FIELD');
        const normK = eK.message.replace(eK.field, 'FIELD');
        check(normId === normK,
            () => 'T3/31b: id and key messages differ beyond the field name:\n  ' + normId + '\n  ' + normK);
    }
    // row 32: first -1 (finite, out of range). unchecked writes NOWHERE; checked throws.
    {
        const f = new BitmapFont(ATLAS, mkFont({ kernings: [{ first: -1, second: 65, amount: -2 }] }), { checked: false });
        const base = (255 << 8) | 65;
        check(f.kerning[base] === 0 && f.kerning[base - 1] === 0 && f.kerning[base + 1] === 0 &&
            f.kerning[((254 << 8) | 65)] === 0 && f.kerning[((255 << 8) | 64)] === 0,
            () => 'T3/32: first -1 wrote a neighbouring slot (base ' + base + ')');
        throwsBFE('32 first -1 checked', () => new BitmapFont(ATLAS, mkFont({ kernings: [{ first: -1, second: 65, amount: -2 }] }), { checked: true }),
            'kernings[0].first');
    }
    // row 32b: a NON-finite key is ALWAYS-THROW (both lanes) -- row 20b's kerning
    // twin. Routing it to the checked lane reddens the unchecked half.
    for (const v of [NaN, Infinity]) {
        throwsBFE('32b first ' + v + ' unchecked', () => new BitmapFont(ATLAS, mkFont({ kernings: [{ first: v, second: 65, amount: -2 }] })), 'kernings[0].first');
        throwsBFE('32b first ' + v + ' checked', () => new BitmapFont(ATLAS, mkFont({ kernings: [{ first: v, second: 65, amount: -2 }] }), { checked: true }), 'kernings[0].first');
    }
    // row 33: keys >= 256 (finite). unchecked skips; checked throws.
    {
        const f = new BitmapFont(ATLAS, mkFont({ kernings: [{ first: 256, second: 300, amount: -2 }] }), { checked: false });
        check(f.kerning[(256 << 8) | 300] === undefined || f.kerning[(256 << 8) | 300] === 0,
            () => 'T3/33: first 256 wrote a slot');
        throwsBFE('33 first 256 checked', () => new BitmapFont(ATLAS, mkFont({ kernings: [{ first: 256, second: 300, amount: -2 }] }), { checked: true }),
            'kernings[0].first');
    }
    // row 33b twin: a valid pair writes in BOTH lanes.
    {
        // 0012 fork 1/3: kerning stored in 1/16 fixed point, -2 -> round(-2*16) = -32.
        const f = new BitmapFont(ATLAS, mkFont({ kernings: [{ first: 65, second: 66, amount: -2 }] }));
        check(f.kerning[(65 << 8) | 66] === -32 && f.kernOf(65, 66) === -2, () => 'T3/33b: valid pair not written (' + f.kerning[(65 << 8) | 66] + ')');
        constructs('33b twin valid checked', () => new BitmapFont(ATLAS, mkFont({ kernings: [{ first: 65, second: 66, amount: -2 }] }), { checked: true }));
    }
    // row 34: amount non-finite / non-number ALWAYS throws.
    throwsBFE('34 amount NaN', () => new BitmapFont(ATLAS, mkFont({ kernings: [{ first: 65, second: 66, amount: NaN }] })), 'kernings[0].amount');
    throwsBFE('34 amount string', () => new BitmapFont(ATLAS, mkFont({ kernings: [{ first: 65, second: 66, amount: 'x' }] })), 'kernings[0].amount');
    // row 35: amount -1.7 -- 0012 fork 1/3 (C-folded). A sub-pixel kern is valid:
    // stores round(-1.7*16) = -27, kernOf -1.6875, and does NOT throw in EITHER
    // lane (the declared 1/16 resolution retires the integrality throw). v1.x
    // stored -1; that number is dead.
    {
        const fu = new BitmapFont(ATLAS, mkFont({ kernings: [{ first: 65, second: 66, amount: -1.7 }] }), { checked: false });
        const fc = new BitmapFont(ATLAS, mkFont({ kernings: [{ first: 65, second: 66, amount: -1.7 }] }), { checked: true });
        check(fu.kerning[(65 << 8) | 66] === -27 && fc.kerning[(65 << 8) | 66] === -27,
            () => 'T3/35: amount -1.7 stored ' + fu.kerning[(65 << 8) | 66] + '/' + fc.kerning[(65 << 8) | 66] + ' != -27');
        check(fc.kernOf(65, 66) === -1.6875, () => 'T3/35: kernOf ' + fc.kernOf(65, 66) + ' != -1.6875');
    }
    // row 36: amount 40000 -- 0012 fork 1: outside the 1/16 fixed-point range
    // [-2048, 2047.9375]. Unchecked stores round(40000*16)=640000 wrapped in Int16
    // to -15360; checked throws naming the range.
    {
        const f = new BitmapFont(ATLAS, mkFont({ kernings: [{ first: 65, second: 66, amount: 40000 }] }), { checked: false });
        check(f.kerning[(65 << 8) | 66] === -15360, () => 'T3/36: amount 40000 stored ' + f.kerning[(65 << 8) | 66] + ' != -15360');
        throwsBFE('36 amount 40000 checked', () => new BitmapFont(ATLAS, mkFont({ kernings: [{ first: 65, second: 66, amount: 40000 }] }), { checked: true }),
            'kernings[0].amount', '2047.9375');
    }

    // ==== the opts bag door, rows 37-40 ====================================
    throwsBFE('37 opts 7', () => new BitmapFont(ATLAS, mkFont(), 7), 'opts');
    throwsBFE('37 opts string', () => new BitmapFont(ATLAS, mkFont(), 'x'), 'opts');
    throwsBFE('38 unknown key', () => new BitmapFont(ATLAS, mkFont(), { missingAdvanc: 6 }), 'missingAdvanc', 'missingAdvance', 'checked');
    // row 38b: an INHERITED missingAdvance is treated as unknown and throws.
    // MEASURED: on 1.2.3 it was silently honoured (uncovered id advanced 6); after
    // M3 it throws. `in` instead of hasOwnProperty reddens this.
    throwsBFE('38b inherited missingAdvance', () => new BitmapFont(ATLAS, mkFont(), Object.create({ missingAdvance: 6 })), 'missingAdvance');
    throwsBFE('39 checked 1', () => new BitmapFont(ATLAS, mkFont(), { checked: 1 }), 'opts.checked');
    throwsBFE('39 checked string', () => new BitmapFont(ATLAS, mkFont(), { checked: 'yes' }), 'opts.checked');
    // row 39b: SIX constructing twins -- the bag door is the one most likely too wide.
    constructs('39b twin {}', () => new BitmapFont(ATLAS, mkFont(), {}));
    constructs('39b twin undefined', () => new BitmapFont(ATLAS, mkFont(), undefined));
    constructs('39b twin null', () => new BitmapFont(ATLAS, mkFont(), null));
    constructs('39b twin missingAdvance', () => new BitmapFont(ATLAS, mkFont(), { missingAdvance: 6 }));
    constructs('39b twin checked true', () => new BitmapFont(ATLAS, mkFont(), { checked: true }));
    constructs('39b twin checked false', () => new BitmapFont(ATLAS, mkFont(), { checked: false }));
    // row 40: M2's missingAdvance range door -- now BitmapFontError, still RangeError.
    for (const v of [NaN, -1, 40000]) {
        const e = throwsBFE('40 missingAdvance ' + v, () => new BitmapFont(ATLAS, mkFont(), { missingAdvance: v }), 'missingAdvance');
        check(e instanceof RangeError, () => 'T3/40: missingAdvance ' + v + ' not instanceof RangeError');
    }

    // ==== the per-call scale doors, rows 41-44 =============================
    const SCALE_BAD = [NaN, 0, -1, Infinity];
    for (const s of SCALE_BAD) {
        resetRec(ATLAS); FONT_ASCII.draw(rec, 'AAAA', 0, 0, s, 0);
        check(rec.calls === 0, () => 'T3/41 draw scale ' + s + ': calls ' + rec.calls + ' != 0');
        clean('41 draw scale ' + s);
        resetRec(ATLAS); FONT_ASCII.drawWrapped(rec, 'AAAA', Float32Array.of(0, 4, 48, 0), 1, 100, 100, 0, 0, s, 0, 0);
        check(rec.calls === 0, () => 'T3/42 drawWrapped scale ' + s + ': calls ' + rec.calls + ' != 0');
        clean('42 drawWrapped scale ' + s);
        resetRec(ATLAS); FONT_NUM.drawFast(rec, 1234, 0, 0, s, 0);
        check(rec.calls === 0, () => 'T3/43 drawFast scale ' + s + ': calls ' + rec.calls + ' != 0');
        clean('43 drawFast scale ' + s);
    }
    // row 43b twin: scale 1 / 0.5 / 1e-45 DRAW on all three, NaN-free.
    for (const s of [1, 0.5, 1e-45]) {
        resetRec(ATLAS); FONT_ASCII.draw(rec, 'AAAA', 0, 0, s, 0);
        check(rec.calls === 4, () => 'T3/43b draw scale ' + s + ': calls ' + rec.calls + ' != 4');
        clean('43b draw scale ' + s);
        resetRec(ATLAS); FONT_ASCII.drawWrapped(rec, 'AAAA', Float32Array.of(0, 4, 48, 0), 1, 100, 100, 0, 0, s, 0, 0);
        check(rec.calls === 4, () => 'T3/43b drawWrapped scale ' + s + ': calls ' + rec.calls + ' != 4');
        clean('43b drawWrapped scale ' + s);
        resetRec(ATLAS); FONT_NUM.drawFast(rec, 1234, 0, 0, s, 0);
        check(rec.calls === 6, () => 'T3/43b drawFast scale ' + s + ': calls ' + rec.calls + ' != 6');
        clean('43b drawFast scale ' + s);
    }
    // row 44: M3 pinned "measure keeps ALL FIVE degenerate answers -- no door in
    // the pure fn". M4 (F-36, decisions/0004 fork 4) gives the three PUBLIC
    // measure faces the same range door the three draw bodies got in M3, so this
    // row is INVERTED here exactly as its twin at t1-degenerate.mjs is -- in
    // place, with the fixture's own numbers, never deleted. The scale door is
    // shared with rows 41-43 above: the SAME predicate now answers a renderer by
    // drawing nothing and a query by returning NaN, which is the asymmetry
    // fork (4) declares. `_measureRange` keeps no door and T1 pins that.
    {
        const baseW = FONT_ASCII.measure('ABC', 1);
        check(Number.isNaN(FONT_ASCII.measure('ABC', 0)), () => 'T3/44/M4: measure(0) is not NaN');
        check(Number.isNaN(FONT_ASCII.measure('ABC', -1)), () => 'T3/44/M4: measure(-1) is not NaN');
        check(FONT_ASCII.measure('ABC', 1e-45) >= 0, () => 'T3/44: measure(1e-45) < 0');
        check(Number.isNaN(FONT_ASCII.measure('ABC', NaN)), () => 'T3/44: measure(NaN) not NaN');
        check(Number.isNaN(FONT_ASCII.measure('ABC', Infinity)), () => 'T3/44/M4: measure(Infinity) is not exactly NaN');
        // The twin: a VALID scale still answers, so a door that rejects
        // everything cannot pass this row.
        check(FONT_ASCII.measure('ABC', 2) === baseW * 2, () => 'T3/44/M4: measure(2) != 2*baseW');
        // The internal is untouched (fork 3 A2) -- same inputs, 1.3.0 answers.
        check(FONT_ASCII._measureRange('ABC', 0, 3, 0) === 0, () => 'T3/44/M4: _measureRange(0) grew a door');
        check(FONT_ASCII._measureRange('ABC', 0, 3, -1) === -baseW, () => 'T3/44/M4: _measureRange(-1) grew a door');
    }

    // ==== align / vAlign documented fallbacks, rows 45-46 ==================
    // row 45: out-of-range align renders LEFT -- dx column identical to align 0.
    resetRec(ATLAS); FONT_ASCII.draw(rec, 'ABC', 0, 0, 1, 0);
    const alignRef = Array.from(rec.dx.slice(0, rec.calls)); const alignRefCalls = rec.calls;
    for (const a of [3, -1, 1.5, NaN]) {
        resetRec(ATLAS); FONT_ASCII.draw(rec, 'ABC', 0, 0, 1, a);
        check(rec.calls === alignRefCalls, () => 'T3/45 align ' + a + ': calls ' + rec.calls + ' != ' + alignRefCalls);
        for (let g = 0; g < alignRefCalls; g++) {
            check(rec.dx[g] === alignRef[g], () => 'T3/45 align ' + a + ': dx[' + g + '] ' + rec.dx[g] + ' != ' + alignRef[g]);
        }
        clean('45 align ' + a);
    }
    // row 46: out-of-range vAlign renders TOP -- dy column identical to vAlign 0.
    resetRec(ATLAS); FONT_ASCII.drawWrapped(rec, 'ABC', Float32Array.of(0, 3, 36, 0), 1, 100, 100, 0, 0, 1, 0, 0);
    const vRef = Array.from(rec.dy.slice(0, rec.calls)); const vRefCalls = rec.calls;
    check(vRef[0] === 2, () => 'T3/46: vAlign 0 dy[0] ' + vRef[0] + ' != 2');           // PROBE (g)
    for (const va of [3, -1, NaN]) {
        resetRec(ATLAS); FONT_ASCII.drawWrapped(rec, 'ABC', Float32Array.of(0, 3, 36, 0), 1, 100, 100, 0, 0, 1, 0, va);
        check(rec.calls === vRefCalls, () => 'T3/46 vAlign ' + va + ': calls ' + rec.calls + ' != ' + vRefCalls);
        for (let g = 0; g < vRefCalls; g++) {
            check(rec.dy[g] === vRef[g], () => 'T3/46 vAlign ' + va + ': dy[' + g + '] ' + rec.dy[g] + ' != ' + vRef[g]);
        }
        clean('46 vAlign ' + va);
    }

    // ==== the flags contract, rows 47-50 ===================================
    const flagsCalls = (font, fl) => { resetRec(ATLAS); font.drawWrapped(rec, TEXT, T2LAYOUT(fl), 1, 1000, 1000, 0, 0, 1, 0, 0); return rec.calls; };
    // 0012 fork 6: checked defaults ON, so FONT_ASCII now THROWS on an unknown flag
    // bit. The SILENT-IGNORE rows (unknown bits drawn, not thrown) are the opt-out
    // lane and use this font. FONT_ASCII with a clean-bit flag (0/1/1.0000001/NaN)
    // stays on FONT_ASCII -- those carry no unknown bit either lane.
    const FONT_ASCII_UNCHECKED = new BitmapFont(ATLAS, { common: { lineHeight: 20, base: 16 }, chars: FONT_ASCII_JSON_CHARS(), kernings: [] }, { checked: false });
    // row 47: 1.0000001 now fires the ellipsis (8), MEASURED.
    check(flagsCalls(FONT_ASCII, 1.0000001) === 8, () => 'T3/47: flags 1.0000001 did not fire the ellipsis');
    clean('47');
    // row 48: flags 2 -- unchecked unchanged (5); checked throws naming value + bit.
    check(flagsCalls(FONT_ASCII_UNCHECKED, 2) === 5, () => 'T3/48: flags 2 unchecked changed');
    clean('48 unchecked');
    {
        const fc = new BitmapFont(ATLAS, { common: { lineHeight: 20, base: 16 },
            chars: FONT_ASCII_JSON_CHARS(), kernings: [] }, { checked: true });
        let msg = null;
        try { resetRec(ATLAS); fc.drawWrapped(rec, TEXT, T2LAYOUT(2), 1, 1000, 1000, 0, 0, 1, 0, 0); }
        catch (e) { msg = e instanceof BitmapFontError ? e.message : String(e); }
        check(msg !== null && msg.includes('2') && msg.includes('mask'),
            () => 'T3/48 checked: flags 2 did not throw naming value + mask, got ' + msg);
        // twin: the same checked font with flags 1 does NOT throw.
        let threw = false;
        try { resetRec(ATLAS); fc.drawWrapped(rec, TEXT, T2LAYOUT(1), 1, 1000, 1000, 0, 0, 1, 0, 0); } catch { threw = true; }
        check(!threw, () => 'T3/48 checked twin: flags 1 threw');
        // F-49 (0012 fork 4): flags 3 has bit 0 SET and bit 1 unknown. The mask test
        // used to sit in the ellipsis `else`, so odd flags skipped it and 3 was
        // SILENT. Hoisted, it throws under checked. Restoring the else-if reddens this.
        let msg3 = null;
        try { resetRec(ATLAS); fc.drawWrapped(rec, TEXT, T2LAYOUT(3), 1, 1000, 1000, 0, 0, 1, 0, 0); }
        catch (e) { msg3 = e instanceof BitmapFontError ? e.message : String(e); }
        check(msg3 !== null && msg3.includes('mask'),
            () => 'T3/48 F-49: flags 3 (bit 0 set) did not throw -- the else-if hole is back, got ' + msg3);
    }
    // row 49: flags -1 -> 8 (declared delta). row 50: flags 0 / NaN -> 5 (unchanged).
    check(flagsCalls(FONT_ASCII_UNCHECKED, -1) === 8, () => 'T3/49: flags -1 did not fire the ellipsis (declared delta)');
    clean('49');
    check(flagsCalls(FONT_ASCII, 0) === 5, () => 'T3/50: flags 0 changed');
    check(flagsCalls(FONT_ASCII, NaN) === 5, () => 'T3/50: flags NaN changed');
    clean('50');

    // ==== tier-wide, rows 53-55 ============================================
    clean('tier-end');
    const elapsed = Date.now() - t3start;
    check(elapsed < 3000, () => 'T3: tier wall clock ' + elapsed + ' ms >= 3000 (row 55)');
}

// FONT_ASCII's chars, rebuilt locally for the one checked font row 48 needs
// (harness exports no checked font). Kept out of the run() body so no font is
// constructed inside a loop.
function FONT_ASCII_JSON_CHARS() {
    const chars = [];
    for (let id = 32; id <= 126; id++) {
        if (id === 32) chars.push({ id: 32, x: 0, y: 0, width: 0, height: 0, xoffset: 0, yoffset: 0, xadvance: 6 });
        else chars.push({ id, x: (id - 32) * 10, y: 0, width: 10, height: 14, xoffset: 0, yoffset: 2, xadvance: 12 });
    }
    return chars;
}
