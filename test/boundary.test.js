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
import { BitmapFont, DRAWFAST_MAX } from '../BitmapFont.js';
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
