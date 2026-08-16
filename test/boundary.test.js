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
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BitmapFont } from '../BitmapFont.js';
import { rec, resetRec, CAP, FONT_ASCII, FONT_NUM, JSON_ASCII, ATLAS } from './torture/harness.mjs';

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

// ---- adversarial case: a String OBJECT (not a primitive) as `text` --------
// Nobody on the planning side flagged this: `text.length` and
// `text.charCodeAt(i)` are both present on `String` objects via the
// prototype, so `new String('ABC')` duck-types as a valid `text` argument
// even though every fixture and every existing test passes a primitive.
// This is not a finding -- it happens to work -- but it was UNVERIFIED.

test('draw() accepts a String OBJECT (not primitive) because length/charCodeAt duck-type', () => {
    resetRec(ATLAS);
    // eslint-disable-next-line no-new-wrappers
    const boxed = new String('ABC');
    assert.doesNotThrow(() => FONT_ASCII.draw(rec, boxed, 0, 0, 1, 0));
    assert.equal(rec.calls, 3);
    assert.equal(rec.dropped, 0);
    assert.equal(rec.imgMismatch, 0);
});
