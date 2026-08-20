/**
 * QA-M0 boundary matrix -- entry points added or exercised by this session's
 * harness (`test/torture/harness.mjs`'s `rec` recording ctx) plus the two
 * `BitmapFont.test.js` alignment assertions found DECORATIVE by mutation
 * testing during this QA pass (see the session report: mutating `draw()`'s
 * center-align divisor from `/2` to `/3` passed BOTH `npm test` and
 * `npm run torture` with zero failures -- the existing test only asserts
 * `dx[0] < 100`, which holds for any positive divisor).
 *
 * These are NOT `todo` -- they describe today's ACTUAL, CORRECT-per-contract
 * behavior (or, where noted, today's loosely-validated-but-not-a-named-
 * finding behavior) and must stay green. Uses the shared recording ctx from
 * `test/torture/harness.mjs` -- never a second hand-rolled mock.
 *
 * Zero edits to BitmapFont.js. This file adds no behaviour and fixes nothing.
 *
 * QA-M1 ADDENDUM -- `drawFast` boundary cases outside the six named M1 blocks
 * (BitmapFont.test.js's DRAWFAST_MAX describe) and outside T4's rows. Every
 * case was mutation-proven against a scratchpad-only mutant of BitmapFont.js
 * (never committed) before being added; the mutation each kills is named in
 * its own comment.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BitmapFont, DRAWFAST_MAX, BitmapFontError, GLYPH_STRIDE } from '../BitmapFont.js';
import { rec, resetRec, resetTotals, CAP, FONT_ASCII, FONT_NUM, JSON_ASCII, ATLAS } from './torture/harness.mjs';

// ---- exact alignment formulas (closes the mutation-testing gap) -----------

test('draw() center-align is exactly x - width/2, not an inequality', () => {
    // mockFontJson-equivalent: FONT_ASCII 'A' has xadvance 12, width 10, xoffset 0.
    // measure('A',1) = 12 (single glyph, no kerning). center: cursorX = round(100 - 12/2) = 94.
    resetRec(ATLAS);
    FONT_ASCII.draw(rec, 'A', 100, 0, 1, 1);
    assert.equal(rec.calls, 1);
    assert.equal(rec.dx[0], 94);
});

test('draw() right-align is exactly x - width, not an inequality', () => {
    // measure('A',1) = 12. right: cursorX = round(100 - 12) = 88.
    resetRec(ATLAS);
    FONT_ASCII.draw(rec, 'A', 100, 0, 1, 2);
    assert.equal(rec.calls, 1);
    assert.equal(rec.dx[0], 88);
});

test('drawFast() center-align is exactly x - width/2, not an inequality', () => {
    // FONT_NUM: '5' -> "5.0" = digit(5) + '.' + digit(0), each xadvance 10 except
    // '.' xadvance 6 -> width = 10 + 6 + 10 = 26. center: cursorX = round(100 - 26/2) = 87.
    resetRec(ATLAS);
    FONT_NUM.drawFast(rec, 5, 100, 0, 1, 1);
    assert.equal(rec.calls, 3);
    assert.equal(rec.dx[0], 87);
});

test('drawFast() right-align is exactly x - width, not an inequality', () => {
    // width 26 (see above). right: cursorX = round(100 - 26) = 74.
    resetRec(ATLAS);
    FONT_NUM.drawFast(rec, 5, 100, 0, 1, 2);
    assert.equal(rec.calls, 3);
    assert.equal(rec.dx[0], 74);
});

// ---- CAP boundary: 0, 1, CAP-1, CAP, CAP+1 --------------------------------

test('rec.dropped boundary: 0 glyphs draws nothing, drops nothing', () => {
    resetRec(ATLAS);
    FONT_ASCII.draw(rec, '', 0, 0, 1, 0);
    assert.equal(rec.calls, 0);
    assert.equal(rec.dropped, 0);
});

test('rec.dropped boundary: 1 glyph', () => {
    resetRec(ATLAS);
    FONT_ASCII.draw(rec, 'A', 0, 0, 1, 0);
    assert.equal(rec.calls, 1);
    assert.equal(rec.dropped, 0);
});

test('rec.dropped boundary: CAP-1 glyphs fits with one slot to spare', () => {
    resetRec(ATLAS);
    FONT_ASCII.draw(rec, 'A'.repeat(CAP - 1), 0, 0, 1, 0);
    assert.equal(rec.calls, CAP - 1);
    assert.equal(rec.dropped, 0);
});

test('rec.dropped boundary: exactly CAP glyphs fills every slot, drops none', () => {
    resetRec(ATLAS);
    FONT_ASCII.draw(rec, 'A'.repeat(CAP), 0, 0, 1, 0);
    assert.equal(rec.calls, CAP);
    assert.equal(rec.dropped, 0);
});

test('rec.dropped boundary: CAP+1 glyphs overruns by exactly one', () => {
    resetRec(ATLAS);
    FONT_ASCII.draw(rec, 'A'.repeat(CAP + 1), 0, 0, 1, 0);
    assert.equal(rec.calls, CAP);
    assert.equal(rec.dropped, 1);
});

// ---- duplicate dispose / dispose interactions ------------------------------

test('destroy() is idempotent -- a second call does not throw', () => {
    const f = new BitmapFont(ATLAS, JSON_ASCII);
    f.destroy();
    assert.equal(f.atlas, null);
    assert.doesNotThrow(() => f.destroy());
    assert.equal(f.atlas, null);
    assert.equal(f.glyphs, null);
    assert.equal(f.kerning, null);
    assert.equal(f._charScratch, null);
});

test('draw("") after destroy() is a safe no-op (len===0 returns before touching null arrays)', () => {
    const f = new BitmapFont(ATLAS, JSON_ASCII);
    f.destroy();
    assert.doesNotThrow(() => f.draw(rec, '', 0, 0, 1, 0));
});

test('draw(non-empty) after destroy() throws -- documents the contract, not a new finding', () => {
    const f = new BitmapFont(ATLAS, JSON_ASCII);
    f.destroy();
    assert.throws(() => f.draw(rec, 'A', 0, 0, 1, 0), TypeError);
});

// ---- re-entrant write into the recording ctx -------------------------------

test('re-entrant draw() from inside ctx.drawImage does not corrupt the call count', () => {
    let reentered = false;
    let total = 0;
    const reentrantCtx = {
        drawImage() {
            total++;
            if (!reentered) {
                reentered = true;
                FONT_ASCII.draw(reentrantCtx, 'B', 0, 0, 1, 0); // 1 glyph
                reentered = false;
            }
        },
    };
    assert.doesNotThrow(() => FONT_ASCII.draw(reentrantCtx, 'A', 0, 0, 1, 0));
    // Outer 'A' is 1 glyph; it re-enters once for inner 'B' (1 glyph) -> 2 total.
    assert.equal(total, 2);
});

// ---- null / undefined / NaN / -0 at the x/y entry points ------------------

test('draw() with x=null coerces via Math.round(null)===0, does not throw', () => {
    resetRec(ATLAS);
    assert.doesNotThrow(() => FONT_ASCII.draw(rec, 'A', null, 0, 1, 0));
    assert.equal(rec.calls, 1);
    assert.equal(rec.dx[0], 0);
});

test('draw() with x=undefined propagates NaN (Math.round(undefined) is NaN), does not throw', () => {
    resetRec(ATLAS);
    assert.doesNotThrow(() => FONT_ASCII.draw(rec, 'A', undefined, 0, 1, 0));
    assert.equal(rec.calls, 1);
    assert.ok(Number.isNaN(rec.dx[0]));
});

test('draw() with x=-0 does not throw and settles to +0 through the +xoffset add', () => {
    resetRec(ATLAS);
    assert.doesNotThrow(() => FONT_ASCII.draw(rec, 'A', -0, 0, 1, 0));
    assert.equal(rec.calls, 1);
    assert.equal(rec.dx[0], 0);
});

// ---- F-42 (M4a): a String OBJECT (not a primitive) as `text` --------------
// This block once read "This is not a finding -- it happens to work -- but it
// was UNVERIFIED", and asserted 3 draws. M4a proves that judgement WRONG. The
// same duck-typing that let `new String('ABC')` "happen to work" -- `text.length`
// and `text.charCodeAt` present via the prototype -- is exactly what let
// `{length: Infinity, charCodeAt(){return 65}}` HANG both renderers (F-42, an S1
// non-termination). The renderer text door is now `typeof text !== 'string'`
// (decisions/0004 fork 9), the same predicate the measure family carries, so a
// boxed String is rejected: draw() draws NOTHING and returns. Inverted in place,
// never deleted -- the block that stated the latent defect must record that it
// became a finding.

test('draw() rejects a String OBJECT (not primitive): the typeof text door draws nothing (F-42)', () => {
    resetRec(ATLAS);
    // eslint-disable-next-line no-new-wrappers
    const boxed = new String('ABC');
    assert.doesNotThrow(() => FONT_ASCII.draw(rec, boxed, 0, 0, 1, 0));
    assert.equal(rec.calls, 0);
    assert.equal(rec.dropped, 0);
    assert.equal(rec.imgMismatch, 0);
});

// ---- M1 QA pass: drawFast boundary cases the six named M1 blocks (T4 rows
// and BitmapFont.test.js's DRAWFAST_MAX describe) do NOT cover. Every case
// below was mutation-proven during QA: a targeted single-change mutant of
// BitmapFont.js was built in the scratchpad (never committed, never touches
// the tree) and the same assertion was re-run against it -- the mutant must
// FAIL the assertion the real module PASSES. The mutation each case kills is
// named in its comment. Decode helper mirrors T4's sw-disambiguated one:
// '.' and digit '6' collide on sx alone (both land at sx=60).
// ---------------------------------------------------------------------------

function decodeSeq(seq) {
    let s = '';
    for (const [sx, sw] of seq) s += sw === 4 ? '.' : String.fromCharCode(48 + sx / 10);
    return s;
}

function captureDrawFast(font, value, x, y, scale, align) {
    const seq = [];
    const dxs = [];
    const ctx = { drawImage(img, sx, sy, sw, sh, dx) { seq.push([sx, sw]); dxs.push(dx); } };
    font.drawFast(ctx, value, x, y, scale, align);
    return { seq, dxs, calls: seq.length };
}

test('drawFast(): value=null coerces to 0 through the numeric range guard, renders "0.0"', () => {
    // KILLS: guard rewritten as `Number.isFinite(value) && value>=-MAX && value<=MAX`
    // (a plausible "make the NaN check explicit" cleanup) -- Number.isFinite(null)
    // is false, so that rewrite would reject null instead of coercing it to 0.
    const { seq, calls } = captureDrawFast(FONT_NUM, null, 0, 0, 1, 0);
    assert.equal(calls, 3);
    assert.equal(decodeSeq(seq), '0.0');
});

test('drawFast(): value=undefined fails the range guard and draws nothing', () => {
    // KILLS: the negated-range idiom `!(v>=-MAX && v<=MAX)` rewritten as the
    // seemingly-equivalent `v<-MAX || v>MAX` (drops NaN-safety by De Morgan's
    // law under a false assumption -- undefined/NaN compare false on BOTH
    // sides of `||`, so a value that should be rejected instead falls through).
    const { calls } = captureDrawFast(FONT_NUM, undefined, 0, 0, 1, 0);
    assert.equal(calls, 0);
});

test('drawFast(): Number.MIN_VALUE and a subnormal both round to "0.0", not silently dropped', () => {
    // KILLS: a bogus near-zero "optimization" dead zone, e.g.
    // `if (value !== 0 && Math.abs(value) < 1e-10) return;` added ahead of the
    // digit loop -- a plausible future micro-opt that would make MIN_VALUE and
    // 5e-320 draw nothing instead of the correct "0.0".
    for (const v of [Number.MIN_VALUE, 5e-320]) {
        const { seq, calls } = captureDrawFast(FONT_NUM, v, 0, 0, 1, 0);
        assert.equal(calls, 3, 'v=' + v);
        assert.equal(decodeSeq(seq), '0.0', 'v=' + v);
    }
});

test('drawFast(): the documented pre-clamp Math.max(-DRAWFAST_MAX, Math.min(DRAWFAST_MAX, v)) always renders the ceiling', () => {
    // The exported constant's entire reason for existing (BitmapFont.js's own
    // doc comment): callers pre-clamp with this exact expression. Nothing else
    // in the suite runs the composed clamp end-to-end through a live call.
    // KILLS: the internal door threshold drifting away from the exported
    // DRAWFAST_MAX (e.g. the guard hardcodes a literal instead of reading the
    // constant) -- DRAWFAST_MAX would still read 1e21 (so a bare equality
    // check on the export stays green) but the caller's clamped value would be
    // silently rejected by a narrower internal door.
    for (const raw of [Number.MAX_VALUE, Infinity, 1e300]) {
        const clamped = Math.max(-DRAWFAST_MAX, Math.min(DRAWFAST_MAX, raw));
        const { seq, calls } = captureDrawFast(FONT_NUM, clamped, 0, 0, 1, 0);
        assert.equal(calls, 24, 'raw=' + raw);
        assert.equal(decodeSeq(seq), '1000000000000000000000.0', 'raw=' + raw);
    }
    // The negative side of the same contract: values far below -DRAWFAST_MAX
    // clamp to -DRAWFAST_MAX, which is inside the door and renders "0.0".
    for (const raw of [-Number.MAX_VALUE, -Infinity, -1e300]) {
        const clamped = Math.max(-DRAWFAST_MAX, Math.min(DRAWFAST_MAX, raw));
        const { calls } = captureDrawFast(FONT_NUM, clamped, 0, 0, 1, 0);
        assert.equal(calls, 3, 'raw=' + raw);
    }
});

test('drawFast(): the ceiling renders correctly under non-default scale and center alignment', () => {
    // KILLS: the drawFast-local width pre-pass dropping `* scale` on one of its
    // two accumulation terms (a plausible copy-paste slip between the kerning
    // term and the xadvance term) -- only visible when scale != 1, and only at
    // the full 24-glyph width where the error compounds enough to move cursorX.
    const { seq, dxs, calls } = captureDrawFast(FONT_NUM, DRAWFAST_MAX, 1000, 0, 2, 1);
    assert.equal(calls, 24);
    assert.equal(decodeSeq(seq), '1000000000000000000000.0');
    // width = 23 digits * xadvance(10) * scale(2) + 1 dot * xadvance(6) * scale(2)
    assert.equal(dxs[0], Math.round(1000 - (23 * 10 * 2 + 1 * 6 * 2) / 2));
});

test('drawFast(): 9.99 / 99.95 / 999.95 carry into a new digit count, not truncated', () => {
    // KILLS: `Math.round(value * 10)` replaced by `Math.trunc(value * 10)` --
    // both pass every non-carry fixed value in T4's sweep, but only rounding
    // carries 9.99 -> "10.0" (4 glyphs, not 3) and 99.95 -> "100.0" (5, not 4).
    for (const [v, expected] of [[9.99, '10.0'], [99.95, '100.0'], [999.95, '1000.0']]) {
        const { seq } = captureDrawFast(FONT_NUM, v, 0, 0, 1, 0);
        assert.equal(decodeSeq(seq), expected, 'v=' + v);
    }
});

test('drawFast() after destroy() always throws, even for value=0 -- no draw("") style early-out shortcut', () => {
    // draw('') is null-safe post-destroy() because len===0 returns before any
    // array touch (see the destroy() block above); drawFast has no analogous
    // shortcut for value=0 -- it always reaches `this._charScratch`.
    // KILLS: a defensive `if (!this._charScratch) return;` added right after
    // the range guard (a plausible "make destroy() safer" patch) -- it would
    // silently no-op post-destroy calls instead of surfacing the TypeError
    // that documents "you destroyed this font and used it anyway".
    const font = new BitmapFont(ATLAS, { common: { lineHeight: 20, base: 16 }, chars: [{ id: 48, x: 0, y: 0, width: 8, height: 14, xoffset: 0, yoffset: 2, xadvance: 10 }, { id: 46, x: 60, y: 0, width: 4, height: 4, xoffset: 0, yoffset: 12, xadvance: 6 }] });
    font.destroy();
    assert.throws(() => font.drawFast(rec, 0, 0, 0), TypeError);
    assert.throws(() => font.drawFast(rec, 5, 0, 0), TypeError);
});

test('drawFast(): destroy() called mid-render (dispose-during-iteration) throws rather than silently drawing stale glyphs', () => {
    // KILLS: hoisting `const glyphs = this.glyphs, kerning = this.kerning;`
    // above the render loop (a plausible perf "avoid repeated `this.` property
    // reads" refactor) -- the hoisted locals keep the pre-destroy() array
    // references alive across the loop, so a destroy() fired from inside
    // ctx.drawImage would silently finish the render on stale, already-freed
    // arrays instead of throwing on the next `this.glyphs`/`this.kerning` read.
    const font = new BitmapFont(ATLAS, { common: { lineHeight: 20, base: 16 }, chars: [{ id: 46, x: 60, y: 0, width: 4, height: 4, xoffset: 0, yoffset: 12, xadvance: 6 }, { id: 49, x: 10, y: 0, width: 8, height: 14, xoffset: 0, yoffset: 2, xadvance: 10 }, { id: 50, x: 20, y: 0, width: 8, height: 14, xoffset: 0, yoffset: 2, xadvance: 10 }, { id: 51, x: 30, y: 0, width: 8, height: 14, xoffset: 0, yoffset: 2, xadvance: 10 }] });
    let destroyed = false;
    const seq = [];
    const ctx = {
        drawImage(img, sx) {
            seq.push(sx);
            if (!destroyed) { destroyed = true; font.destroy(); }
        },
    };
    assert.throws(() => font.drawFast(ctx, 123, 0, 0), TypeError);
    assert.equal(seq.length, 1); // exactly the one glyph drawn before destroy() landed
});

test('drawFast(): a reentrant call on the same instance corrupts the outer render via the shared _charScratch buffer (PINNED hazard, not a fix)', () => {
    // ADVERSARIAL CASE the planning session did not consider: `_charScratch` is
    // ONE buffer per BitmapFont instance, reused across calls for zero-GC. If a
    // caller's ctx.drawImage synchronously calls drawFast again on the SAME
    // font instance (a plausible pattern: a debug overlay that draws a second
    // number from inside a custom draw hook), the inner call overwrites the
    // buffer the outer call is still reading backwards through -- silently,
    // with no throw and no NaN. This is CURRENT behavior, not a named finding;
    // it is pinned (T4's F-23 style) so a change to it is deliberate, not
    // accidental. KILLS: "fixing" reentrancy by giving drawFast a local buffer
    // instead of `this._charScratch` (`const buf = new Uint8Array(24);`) --
    // that would also break the zero-GC contract T6 exists to gate, but this
    // is the test that names the reentrancy behavior specifically.
    const font = new BitmapFont(ATLAS, { common: { lineHeight: 20, base: 16 }, chars: [{ id: 46, x: 60, y: 0, width: 4, height: 4, xoffset: 0, yoffset: 12, xadvance: 6 }, { id: 49, x: 10, y: 0, width: 8, height: 14, xoffset: 0, yoffset: 2, xadvance: 10 }, { id: 50, x: 20, y: 0, width: 8, height: 14, xoffset: 0, yoffset: 2, xadvance: 10 }, { id: 51, x: 30, y: 0, width: 8, height: 14, xoffset: 0, yoffset: 2, xadvance: 10 }, { id: 53, x: 50, y: 0, width: 8, height: 14, xoffset: 0, yoffset: 2, xadvance: 10 }, { id: 55, x: 70, y: 0, width: 8, height: 14, xoffset: 0, yoffset: 2, xadvance: 10 }] });
    let fired = false;
    const out = [];
    const ctx = {
        drawImage(img, sx, sy, sw) {
            out.push(sw === 4 ? '.' : String.fromCharCode(48 + sx / 10));
            if (!fired) { fired = true; font.drawFast(ctx, 12.3, 0, 0); }
        },
    };
    font.drawFast(ctx, 5, 0, 0);
    // Outer "5.0" should be 3 glyphs; instead the inner "12.3" (4 glyphs) draws
    // mid-loop and the outer's remaining reads pick up the inner's leftovers.
    assert.equal(out.join(''), '512.3.3');
});

test('drawFast(): a rejected out-of-door value leaves rec and _charScratch exactly as a never-called drawFast would', () => {
    // KILLS: a stray scratch write landing ahead of the range guard (a
    // plausible refactor accident -- e.g. moving `const buf = this._charScratch`
    // and an initial write above the early return while restructuring the
    // method) -- a rejected call must be a true no-op, not just a no-draw.
    const probeFont = new BitmapFont(ATLAS, { common: { lineHeight: 20, base: 16 }, chars: [{ id: 48, x: 0, y: 0, width: 8, height: 14, xoffset: 0, yoffset: 2, xadvance: 10 }] });
    const before = Array.from(probeFont._charScratch);
    resetRec(ATLAS);
    resetTotals();
    probeFont.drawFast(rec, DRAWFAST_MAX * 10, 0, 0); // 1e22, well outside the door
    assert.equal(rec.calls, 0);
    assert.equal(rec.total, 0);
    assert.deepEqual(Array.from(probeFont._charScratch), before);
});

// ---- QA-M8: the drawFastInt headline pin (A1) -----------------------------

test('drawFastInt(120) -> 3 glyphs and NO "." ; drawFast(120) -> 5 glyphs WITH a "." (A1)', () => {
    // Adjacent, in one block, so the DIFFERENCE is the assertion. FONT_NUM keys
    // the '.' glyph as sw === 4 (t4-numeric decoder). drawFastInt is integer-only
    // and must emit no '.'; drawFast renders "120.0" with exactly one.
    // KILLS: copying drawFast's `buf[len++] = 46;` into drawFastInt -> 4 calls and
    // a sw===4 glyph -> red.
    resetRec(ATLAS); resetTotals();
    FONT_NUM.drawFastInt(rec, 120, 0, 0);
    assert.equal(rec.calls, 3, 'drawFastInt(120) draws exactly "120"');
    let dotInt = 0;
    for (let i = 0; i < rec.calls; i++) if (rec.sw[i] === 4) dotInt++;
    assert.equal(dotInt, 0, 'drawFastInt must not emit the "." glyph (sw===4)');

    resetRec(ATLAS); resetTotals();
    FONT_NUM.drawFast(rec, 120, 0, 0);
    assert.equal(rec.calls, 5, 'drawFast(120) draws "120.0"');
    let dotFast = 0;
    for (let i = 0; i < rec.calls; i++) if (rec.sw[i] === 4) dotFast++;
    assert.equal(dotFast, 1, 'drawFast renders exactly one "." glyph (sw===4)');
});

// =====================================================================
// M5 (v1.9.0): layoutGlyphs / drawQuads boundary matrix
// =====================================================================
// A 4-glyph font (A,B,C visible; space id 32 zero-size) for the drawQuads legs.
function qFontB() {
    return new BitmapFont(ATLAS, {
        common: { lineHeight: 20, base: 16 },
        chars: [
            { id: 65, x: 1, y: 2, width: 8, height: 12, xoffset: 1, yoffset: 3, xadvance: 9 },
            { id: 66, x: 11, y: 4, width: 7, height: 11, xoffset: 2, yoffset: 2, xadvance: 8 },
            { id: 67, x: 20, y: 6, width: 9, height: 13, xoffset: 0, yoffset: 4, xadvance: 10 },
            { id: 32, x: 0, y: 0, width: 0, height: 0, xoffset: 0, yoffset: 0, xadvance: 6 },
        ],
        kernings: [],
    });
}

// A6 -- OVERFLOW, both directions. The guard is PER EMITTED RECORD (`p + 6 > cap`),
// so a buffer one record short throws a PLAIN RangeError (never a BitmapFontError:
// that is the descriptor door's type), with the pinned message shape; a buffer
// sized to exactly `count * GLYPH_STRIDE` does NOT throw. Reddens under the
// capacity compare `>` -> `>=`: the exact-fit buffer then throws on its last
// record. 'ABC' is three visible glyphs, so need = 18 floats.
test('A6 (M5): layoutGlyphs overflow throws a plain RangeError one record short, fits exactly', () => {
    const text = 'ABC';
    const need = text.length * GLYPH_STRIDE;         // 18, all visible
    const shortBuf = new Float64Array(need - GLYPH_STRIDE);   // 12 -- one record short
    let err = null;
    try { FONT_ASCII.layoutGlyphs(text, shortBuf, 0, 0, 1, 0); } catch (e) { err = e; }
    assert.ok(err instanceof RangeError, 'expected a RangeError, got ' + err);
    assert.equal(err instanceof BitmapFontError, false, 'must NOT be a BitmapFontError');
    assert.match(err.message, /^lite-bmfont: outBuffer holds \d+ floats, glyph \d+ needs \d+$/);
    // Exactly `count * GLYPH_STRIDE` fits and returns the full count.
    const exact = new Float64Array(need);
    let n;
    assert.doesNotThrow(() => { n = FONT_ASCII.layoutGlyphs(text, exact, 0, 0, 1, 0); });
    assert.equal(n, text.length);
});

// A7 -- MATCHED-SCALE EXACTNESS. drawQuads's scale sizes ONLY the source dims;
// dx/dy are already absolute and already scaled by layoutGlyphs. At a non-zero
// origin and scale 2, drawQuads(..., scale) reproduces draw's destination
// exactly. Reddens under applying `scale` to dx/dy as well: the destination x/y
// then double-scale and diverge from draw.
test('A7 (M5): drawQuads scale sizes only sw/sh -- dx/dy match draw exactly', () => {
    const text = 'ABC';
    const s = 2;
    const buf = new Float64Array(text.length * GLYPH_STRIDE);
    const n = FONT_ASCII.layoutGlyphs(text, buf, 5, 7, s, 0);
    resetRec(ATLAS);
    FONT_ASCII.draw(rec, text, 5, 7, s, 0);
    assert.equal(rec.calls, n);
    const dx = Array.from(rec.dx.slice(0, n));
    const dy = Array.from(rec.dy.slice(0, n));
    const dw = Array.from(rec.dw.slice(0, n));
    const dh = Array.from(rec.dh.slice(0, n));
    resetRec(ATLAS);
    FONT_ASCII.drawQuads(rec, buf, 0, n, 0, 0, s);
    assert.equal(rec.calls, n);
    for (let g = 0; g < n; g++) {
        assert.equal(rec.dx[g], dx[g], 'dx[' + g + '] ' + rec.dx[g] + ' != draw ' + dx[g]);
        assert.equal(rec.dy[g], dy[g], 'dy[' + g + '] ' + rec.dy[g] + ' != draw ' + dy[g]);
        assert.equal(rec.dw[g], dw[g], 'dw[' + g + '] ' + rec.dw[g] + ' != draw ' + dw[g]);
        assert.equal(rec.dh[g], dh[g], 'dh[' + g + '] ' + rec.dh[g] + ' != draw ' + dh[g]);
    }
});

// A8 -- THE DOORS. Non-string text returns NaN (a query cannot decline to
// answer; 0 is the honest answer for ''); scale = 0 returns NaN and leaves the
// buffer UNWRITTEN. Reddens under the text door `typeof text !== 'string'` ->
// `if (text == null) return NaN`: a non-string non-null then falls through and
// returns 0, not NaN. (The scale-door half of this test is killed by the
// separate scale-door removal; both are exercised here.)
test('A8 (M5): layoutGlyphs doors -- non-string and scale=0 both return NaN, buffer untouched', () => {
    const buf = new Float64Array(6 * GLYPH_STRIDE);
    // non-string text
    for (const bad of [123, null, undefined, {}, []]) {
        assert.ok(Number.isNaN(FONT_ASCII.layoutGlyphs(bad, buf, 0, 0, 1, 0)),
            'layoutGlyphs(' + String(bad) + ') is not NaN');
    }
    // scale = 0: NaN AND the buffer is untouched (sentinel survives)
    const sent = new Float64Array(GLYPH_STRIDE).fill(-999);
    const probe = new Float64Array(GLYPH_STRIDE).fill(-999);
    assert.ok(Number.isNaN(FONT_ASCII.layoutGlyphs('ABC', probe, 0, 0, 0, 0)),
        'scale=0 must return NaN');
    assert.deepEqual(Array.from(probe), Array.from(sent), 'scale=0 wrote into outBuffer');
});

// A8 (hostile array-like) -- ITS OWN test(): `{length: Infinity, charCodeAt}` is
// the input that SIGKILLed 1.4.0 at 6 s; the `typeof text !== 'string'` door
// rejects it in O(1) and returns NaN. This assertion pins ONLY that SHIPPED
// behaviour -- it does NOT and CANNOT detect the door-removal mutation: under
// `if (text == null)` the call never returns, the event loop is blocked (the
// walk is synchronous), the wall-clock line below is never reached, and no
// per-test timeout can interrupt a synchronous hang. The door-removal HANG is
// proven OUT OF PROCESS by T9 control 13's 'notext-layout' lane
// (test/torture/t9-measure-hang-child.mjs + t9-controls.mjs), which SIGKILLs a
// door-removed layoutGlyphs and dies if it terminates.
test('A8 (M5): layoutGlyphs answers the hostile array-like with NaN in O(1) (hang proof is T9 control 13)', () => {
    const buf = new Float64Array(6 * GLYPH_STRIDE);
    const hostile = { length: Infinity, charCodeAt() { return 65; } };
    const t0 = Date.now();
    const r = FONT_ASCII.layoutGlyphs(hostile, buf, 0, 0, 1, 0);
    const ms = Date.now() - t0;
    assert.ok(Number.isNaN(r), 'hostile array-like did not return NaN: ' + r);
    assert.ok(ms < 1000, 'hostile array-like took ' + ms + ' ms -- the text door let it into the walk');
});

// A8b (M5) -- drawQuads fails CLOSED on the buffer length and CLAMPS the
// index-likes (fork 10, drawWrapped's fork (1) idiom). A range whose end record
// exceeds the buffer throws a plain RangeError; a valid subset does not; NaN /
// negative / fractional first|count are clamped, never a NaN-geometry drawImage.
// Reddens under dropping the `if (end * 6 > buffer.length)` throw: the
// out-of-buffer call then issues NaN-geometry drawImage calls (fail-open).
test('A8b (M5): drawQuads throws past the buffer, clamps bad first/count, draws a valid subset', () => {
    const f = qFontB();
    const text = 'ABC';
    const buf = new Float64Array(text.length * GLYPH_STRIDE);   // 18 floats, 3 records
    const n = f.layoutGlyphs(text, buf, 0, 0, 1, 0);
    assert.equal(n, 3);
    // Past the buffer: (0 + 10) * 6 = 60 > 18 -> throw, no drawImage.
    resetRec(ATLAS);
    let err = null;
    try { f.drawQuads(rec, buf, 0, 10, 0, 0, 1); } catch (e) { err = e; }
    assert.ok(err instanceof RangeError, 'over-buffer drawQuads did not throw a RangeError: ' + err);
    assert.equal(err instanceof BitmapFontError, false, 'must NOT be a BitmapFontError');
    assert.match(err.message, /^lite-bmfont: buffer holds \d+ floats, quads \d+\.\.\d+ need \d+$/);
    assert.equal(rec.calls, 0, 'a throwing call must not have drawn');
    // Exact fit draws all three with zero NaN geometry.
    resetRec(ATLAS);
    assert.doesNotThrow(() => f.drawQuads(rec, buf, 0, 3, 0, 0, 1));
    assert.equal(rec.calls, 3);
    // Clamps: NaN / negative / fractional first|count never reach drawImage with
    // NaN geometry. NaN count -> nothing; -1 first -> clamps to 0; 2.9 count ->
    // floor 2.
    resetRec(ATLAS);
    f.drawQuads(rec, buf, 0, NaN, 0, 0, 1);
    assert.equal(rec.calls, 0, 'NaN count drew something');
    resetRec(ATLAS);
    f.drawQuads(rec, buf, -1, 2, 0, 0, 1);       // first clamps to 0 -> records 0,1
    assert.equal(rec.calls, 2, 'negative first did not clamp to 0');
    resetRec(ATLAS);
    f.drawQuads(rec, buf, 0, 2.9, 0, 0, 1);      // count floors to 2
    assert.equal(rec.calls, 2, 'fractional count did not floor');
    // No recorded geometry is NaN.
    for (let i = 0; i < rec.calls; i++) {
        assert.ok(!Number.isNaN(rec.dx[i]) && !Number.isNaN(rec.sx[i]), 'clamped draw produced NaN geometry');
    }
});

// A8c (M5) -- the PINNED HAZARD (fork 10b), asserted as behaviour, not fixed. A
// buffer length cannot know how many records layoutGlyphs actually WROTE, so
// passing a count larger than the written total (but within the buffer) draws
// from unwritten slots -- the caller's responsibility, exactly as drawFast's
// shared-scratch reentrancy is a pinned hazard, not a fix. Pinned so a future
// reader does not mistake the fail-closed length check for a fail-closed count.
test('A8c (M5): drawQuads past the WRITTEN count but within the buffer is the caller hazard (pinned)', () => {
    const f = qFontB();
    // 'A B' writes TWO records (space id 32 is zero-size) into a 3-record buffer.
    const buf = new Float64Array(3 * GLYPH_STRIDE);
    const n = f.layoutGlyphs('A B', buf, 0, 0, 1, 0);
    assert.equal(n, 2, 'expected 2 written records');
    // Asking for 3 does NOT throw (3 * 6 = 18 <= 18) and draws the unwritten
    // third slot -- fail-open BY CONTRACT, the caller must pass `n`.
    resetRec(ATLAS);
    assert.doesNotThrow(() => f.drawQuads(rec, buf, 0, 3, 0, 0, 1));
    assert.equal(rec.calls, 3, 'the pinned hazard changed -- drawQuads now bounds on written count');
});
