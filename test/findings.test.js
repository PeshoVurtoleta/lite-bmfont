/**
 * QA-M0 findings probe -- session M0 final gate.
 *
 * Reproduces F-03 through F-18 against the CURRENT tree and pins today's
 * ANSWER (the defect), not a fix (F-01/F-02 were fixed in 1.2.2 -- see the note
 * below). M0's NON-GOALS forbid fixing anything in
 * `BitmapFont.js` (zero diff except the appended `VERSION` export), and the
 * CHANGELOG ledger claims every one of these survives unfixed except the
 * process/tooling half of F-14/F-15/F-16/F-17. This file is the independent
 * check on that claim.
 *
 * Every block below is `test.todo(...)`: it still RUNS and its result is
 * printed, but a todo failure does not fail `npm test`'s exit code. That is
 * deliberate -- these tests exist to WATCH known findings across sessions,
 * not to gate M0. When a later session (M1..M9) fixes a finding, its block
 * goes red here on purpose; that session owns updating or removing it, this
 * file does not.
 *
 * F-01 and F-02 were FIXED in 1.2.2 (M1 -- the magnitude door). They are no
 * longer watched here: the door made them safe to call in process, so their
 * regression tests live as real assertions, not todos.
 *   - F-01 (the unkillable infinite loop above ~1.797e307) and F-02 (the silent
 *     24-byte scratch overrun from 1e22 up) are now regression-tested by the six
 *     named `drawFast` blocks in `test/BitmapFont.test.js`
 *     (`describe('BitmapFont.drawFast')`, the "M1: the magnitude door" group).
 *   - The hang itself -- which no in-process assertion can catch, since a hung
 *     tier never returns -- is proven both directions out of process by T9
 *     control 9 (`test/torture/t9-controls.mjs` + `t9-hang-child.mjs`): the
 *     door-removed body is killed by SIGTERM, the shipped body returns drawing
 *     nothing. This QA header's former claim that session law forbade
 *     reproducing them no longer holds; the door is the session that changed it.
 *
 * F-04, F-05, F-06, F-11, F-12 already have exact-count pins in the
 * committed torture tiers (`test/torture/t0-laws.mjs`, `t1-degenerate.mjs`)
 * and are not duplicated here.
 *
 * Uses the shared recording ctx from `test/torture/harness.mjs` -- never a
 * second hand-rolled mock ctx.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BitmapFont } from '../BitmapFont.js';
import { rec, resetRec, FONT_ASCII, JSON_ASCII, ATLAS } from './torture/harness.mjs';

test.todo('F-03: NaN guard polarity -- _measureRange rejects NaN, draw/drawWrapped accept it', () => {
    // _measureRange's guard: `id >= 0 && id < 256` -- NaN fails every comparison,
    // so this correctly REJECTS (fail-closed).
    assert.equal(NaN >= 0 && NaN < 256, false);
    // draw()/drawWrapped()'s guard: `id < 0 || id >= 256` -- NaN fails BOTH
    // comparisons too, so `continue` never fires and the glyph is ACCEPTED.
    // Same predicate, opposite polarity -- this is the bug, still present.
    assert.equal(NaN < 0 || NaN >= 256, false);
});

test.todo('F-07: only the first line is pixel-snapped in Y; later lines drift unrounded', () => {
    // A base=12/yoffset=0/lineHeight=16 font isolates the rounding mechanism
    // from any yoffset/base fractional noise -- the exact CHANGELOG.md repro.
    const json = {
        common: { lineHeight: 16, base: 12 },
        chars: [{ id: 65, x: 0, y: 0, width: 8, height: 12, xoffset: 0, yoffset: 0, xadvance: 8 }],
        kernings: [],
    };
    const f = new BitmapFont(ATLAS, { ...json, chars: [json.chars[0], { ...json.chars[0], id: 66 }, { ...json.chars[0], id: 67 }] });
    resetRec(ATLAS);
    f.draw(rec, 'A\nB\nC', 0, 0, 1.1, 0);
    assert.equal(rec.calls, 3);
    // draw() runs `cursorY = Math.round(y)` exactly ONCE, then accumulates
    // `cursorY += lineHeight * scale` on every subsequent line WITHOUT
    // re-rounding -- 16 * 1.1 = 17.6, a fractional step that never lands
    // back on an integer. This is the exact CHANGELOG.md reproduction.
    assert.equal(rec.dy[0], -13.200000000000001);
    assert.equal(rec.dy[1], 4.4);
    assert.equal(rec.dy[2], 22);
});

test.todo('F-08: Int16 wrap on atlas coords + silent xadvance truncation drift', () => {
    const json = JSON.parse(JSON.stringify(JSON_ASCII));
    const aChar = json.chars.find((c) => c.id === 65);
    aChar.x = 40000;      // overflows Int16 range [-32768, 32767]
    aChar.xadvance = 8.6; // fractional -- Int16Array truncates on store
    const f = new BitmapFont(ATLAS, json);
    assert.equal(f.glyphs[65 * 7], -25536);      // 40000 wraps silently
    assert.equal(f.glyphs[65 * 7 + 6], 8);       // 8.6 truncates to 8, not 9
    assert.equal(f.measure('AA'), 16);           // exact (double) answer is 17.2
});

test.todo('F-09: kerning keys are only bounds-checked on the upper end', () => {
    const json = JSON.parse(JSON.stringify(JSON_ASCII));
    json.kernings = [
        { first: -1, second: 65, amount: -2 },     // negative index -> discarded silently
        { first: 65, second: 66, amount: -1.7 },   // fractional amount -> truncated
    ];
    assert.doesNotThrow(() => new BitmapFont(ATLAS, json));
    const f = new BitmapFont(ATLAS, json);
    assert.equal(f.kerning[(65 << 8) | 66], -1); // truncated, not rounded (-1.7 -> -1)
});

test.todo('F-10: the constructor accepts malformed descriptors and rejects others with raw TypeErrors', () => {
    // Three that construct without complaint (no policy):
    assert.doesNotThrow(() => new BitmapFont(ATLAS, { common: { lineHeight: 20, base: 16 }, chars: 7 }));
    const bad = new BitmapFont(ATLAS, { common: { lineHeight: 20, base: 16 }, chars: 7 });
    assert.equal(bad.measure('A'), 0); // zero glyphs mapped, forever
    assert.doesNotThrow(() => new BitmapFont(ATLAS, { common: { lineHeight: NaN, base: NaN }, chars: [] }));
    assert.doesNotThrow(() => new BitmapFont(null, JSON_ASCII));
    // Three that throw a raw internal TypeError instead of a library error:
    assert.throws(() => new BitmapFont(ATLAS, null), TypeError);
    assert.throws(() => new BitmapFont(ATLAS, {}), TypeError);
    assert.throws(() => new BitmapFont(ATLAS, { common: { lineHeight: 20, base: 16 } }), TypeError);
});

test.todo('F-13: layout flags is strict-compared to 1 through a Float32Array', () => {
    // FONT_ASCII covers 32..126 including '.' (46); 'HELLO' is all mapped.
    const mk = (flags) => Float32Array.of(0, 5, 60, flags);
    resetRec(ATLAS);
    FONT_ASCII.drawWrapped(rec, 'HELLO', mk(1), 1, 100, 20, 0, 0, 1, 0, 0);
    const withEllipsis = rec.calls; // 5 letters + 3 dots
    resetRec(ATLAS);
    FONT_ASCII.drawWrapped(rec, 'HELLO', mk(1.0000001), 1, 100, 20, 0, 0, 1, 0, 0);
    const near1 = rec.calls; // Float32 rounds 1.0000001 away from exact 1 -- strict === misses it
    resetRec(ATLAS);
    FONT_ASCII.drawWrapped(rec, 'HELLO', mk(2), 1, 100, 20, 0, 0, 1, 0, 0);
    const unknown = rec.calls; // unknown flag value silently ignored, not rejected
    assert.equal(withEllipsis, 8);
    assert.equal(near1, 5);
    assert.equal(unknown, 5);
    assert.notEqual(withEllipsis, near1); // the strict-compare miss is real, not a fluke
});

test.todo('F-14 (freeze half): BitmapFont.prototype is still mutable -- deferred to M9', () => {
    // The VERSION half of F-14 IS fixed by M0 -- assert that split explicitly.
    assert.equal(typeof BitmapFont, 'function');
    assert.equal(Object.isFrozen(BitmapFont.prototype), false);
    const f = new BitmapFont(ATLAS, JSON_ASCII);
    const original = f.draw;
    f.draw = () => 'hijacked';
    assert.equal(f.draw(), 'hijacked'); // instance-level monkey-patch still succeeds
    f.draw = original;
});

test.todo('F-18: generateAtlas is duplicated in the demo, not shared as a utility', () => {
    const html = readFileSync(new URL('../demo/demo-lite-bmfont.html', import.meta.url), 'utf8');
    const defCount = (html.match(/function generateAtlas\(/g) || []).length;
    const callCount = (html.match(/generateAtlas\(/g) || []).length; // includes the definition
    assert.equal(defCount, 1);          // defined once, inline in the demo
    assert.equal(callCount, 5);         // 1 definition + 4 call sites
    // No shared/exported copy exists anywhere else in the shipped surface.
    const src = readFileSync(new URL('../BitmapFont.js', import.meta.url), 'utf8');
    assert.equal(src.includes('generateAtlas'), false);
});
