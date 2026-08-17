/**
 * QA-M0 findings probe -- session M0 final gate.
 *
 * Reproduces the STILL-OPEN findings against the CURRENT tree and pins today's
 * ANSWER (the defect), not a fix. F-01/F-02 were fixed in 1.2.2, and F-03/F-04/
 * F-05/F-12 in 1.2.3 (M2); those no longer live here (see the notes below). M3
 * (v1.3.0, the descriptor door) closes FOUR more -- F-09, F-10, F-13, and the
 * DETECTION half of F-08 -- so their watch-todos leave this file; their contracts
 * now live as real assertions in `test/BitmapFont.test.js`
 * (`describe('BitmapFont M3: the descriptor door')`) and in the torture gate
 * (`t3-descriptor.mjs`). **F-08's STORAGE half remains OPEN and is M9's**: the
 * Int16 store still truncates and wraps in 1.3.0 (unchecked output is
 * byte-identical); M3 only makes the drift detectable under `{ checked: true }`.
 * The THREE remaining watch-todos are F-07, F-14, F-18.
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
 * F-06 and F-11 have exact-count pins in the committed torture tiers
 * (`test/torture/t0-laws.mjs`, `t1-degenerate.mjs`) and are not duplicated here.
 * F-04, F-05 and F-12 are now FIXED (M2); their contracts are pinned as real
 * assertions in `BitmapFont.test.js` and the torture tiers, not as todos.
 *
 * Uses the shared recording ctx from `test/torture/harness.mjs` -- never a
 * second hand-rolled mock ctx.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BitmapFont } from '../BitmapFont.js';
import { rec, resetRec, JSON_ASCII, ATLAS } from './torture/harness.mjs';

// F-03 (the NaN guard polarity) was FIXED in M2. Its watch-todo is removed here;
// its content ships as real assertions in BitmapFont.test.js ("BitmapFont M2:
// cursor conservation", block F-03) and in the torture gate (t0-laws law 11,
// t1-degenerate's F-04 pin). A finding fixed is a finding that leaves this file.

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

// F-08 (detection), F-09, F-10 and F-13 were CLOSED in M3 (the descriptor door).
// Their watch-todos are removed here; their contracts ship as real assertions in
// BitmapFont.test.js ("BitmapFont M3: the descriptor door") and the torture gate
// (t3-descriptor.mjs). A finding fixed is a finding that leaves this file. F-08's
// STORAGE half stays open (M9): the unchecked Int16 truncation is a documented
// contract now, pinned in BitmapFont.test.js block "F-08: unchecked ...".

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
