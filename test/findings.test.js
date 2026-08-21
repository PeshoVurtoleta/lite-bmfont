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
 * Int16 store still truncates and wraps (unchecked output is byte-identical);
 * M3 only makes the drift detectable under `{ checked: true }`.
 *
 * M4 (v1.4.0, metrics coherence and the pixel-snap promise) closes FOUR more --
 * F-07, F-34, F-35, F-36 -- and adds `measureWidest`/`measureLine` for the first
 * half of F-06. F-07's watch-todo leaves this file below; the other three were
 * found after M0 and never had one. Their contracts now live in
 * `test/BitmapFont.test.js` (`describe('BitmapFont M4: metrics coherence and the
 * pixel-snap promise')`) and in the torture gate (`t5-fuzz.mjs`, `t0-laws.mjs`
 * law 12, `t6-alloc.mjs` windows E and F, `t9-controls.mjs` controls 11-13).
 * **F-06's SEMANTIC half is CLOSED in 2.0.0** (decisions/0012 fork 2): `measure`
 * now returns the widest line, pinned in `BitmapFont.test.js` block
 * "F-06 (2.0.0 BREAKING)" and the T0 law tier.
 *
 * There are now ZERO remaining watch-todos: F-14 was CLOSED in 2.0.0 (fork 5, the
 * prototype freeze), and its block below flipped from a todo watching a mutable
 * prototype to a real test of the frozen state. F-18 was CLOSED in 1.8.0 (M7):
 * its block flipped likewise (generateAtlas now ships as the `/atlas` subpath).
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
import { createLeakTracker } from '@zakkster/lite-leak';
import { BitmapFont, GLYPH_STRIDE } from '../BitmapFont.js';
import { generateAtlas, AtlasError } from '../Atlas.js';
import { generateAtlasV0 } from './torture/fixtures/atlas-verbatim.mjs';
import { makeDocStub } from './torture/fixtures/dom-stub.mjs';
import { rec, resetRec, JSON_ASCII, ATLAS } from './torture/harness.mjs';

// F-03 (the NaN guard polarity) was FIXED in M2. Its watch-todo is removed here;
// its content ships as real assertions in BitmapFont.test.js ("BitmapFont M2:
// cursor conservation", block F-03) and in the torture gate (t0-laws law 11,
// t1-degenerate's F-04 pin). A finding fixed is a finding that leaves this file.

// F-07 was FIXED in M4 (v1.4.0, decisions/0004 fork 2 sub-fork B1). Its
// watch-todo is removed here; a finding fixed is a finding that leaves this file.
// The contract ships as real assertions in BitmapFont.test.js ("BitmapFont M4:
// metrics coherence and the pixel-snap promise", the four F-07 blocks) and in the
// torture gate (t5-fuzz.mjs rows Y1-Y10, t9-controls.mjs controls 11 and 12,
// which rebuild the two REJECTED variants and require the numbers to move).
//
// The original repro, kept as one real assertion so the fix has a regression test
// on the exact font the old todo used: base=12, yoffset=0, lineHeight=16 isolates
// the rounding mechanism from any yoffset/base fractional noise, and 16 * 1.1 is
// 17.6, a step that never lands back on an integer.
test('F-07 (FIXED in 1.4.0): every baseline is pixel-snapped, not just the first', () => {
    const json = {
        common: { lineHeight: 16, base: 12 },
        chars: [{ id: 65, x: 0, y: 0, width: 8, height: 12, xoffset: 0, yoffset: 0, xadvance: 8 }],
        kernings: [],
    };
    const f = new BitmapFont(ATLAS, { ...json, chars: [json.chars[0], { ...json.chars[0], id: 66 }, { ...json.chars[0], id: 67 }] });
    resetRec(ATLAS);
    f.draw(rec, 'A\nB\nC', 0, 0, 1.1, 0);
    assert.equal(rec.calls, 3);
    // dy = baseline + yoffset*scale - base*scale, and yoffset is 0 here, so the
    // whole column is `baseline - 13.200000000000001`. The baselines are
    // Math.round(0) + Math.round(i * 17.6) = 0, 18, 35.
    const shift = 0 * 1.1 - 12 * 1.1;
    assert.deepEqual(Array.from(rec.dy.slice(0, 3)),
        [0 + shift, 18 + shift, 35 + shift]);
    // 1.3.0 produced -13.200000000000001, 4.4, 22 -- only line 0 was rounded and
    // the rest accumulated raw. Line 1 is the cheapest witness that it changed.
    assert.notEqual(rec.dy[1], 4.4);
});

// F-08 (detection), F-09, F-10 and F-13 were CLOSED in M3 (the descriptor door).
// Their watch-todos are removed here; their contracts ship as real assertions in
// BitmapFont.test.js ("BitmapFont M3: the descriptor door") and the torture gate
// (t3-descriptor.mjs). A finding fixed is a finding that leaves this file. F-08's
// STORAGE half stays open (M9): the unchecked Int16 truncation is a documented
// contract now, pinned in BitmapFont.test.js block "F-08: unchecked ...".

// F-14 CLOSED in 2.0.0 (decisions/0012 fork 5): the prototype is frozen at
// module scope. Object.seal was REJECTED (it still permits overwriting an
// existing method); freezing INSTANCES too was REJECTED because they carry the
// per-font typed-array state the constructor and destroy() write.
//
// MEASURED BLAST RADIUS (wider than the F-14 roadmap row, discovered in
// implementation): freezing the prototype makes the twelve inherited method
// properties non-writable, so a plain-assignment method hijack throws whether it
// targets the prototype OR is shadowed on an instance -- assignment-shadowing
// routes through the inherited property's writable flag. The escape hatches are
// UNTOUCHED: Object.defineProperty on the instance, own-DATA-field writes, and
// subclassing all still work. The ALLOWED rows below are the non-vacuity twin --
// a freeze that also broke subclassing or own-field writes would be a regression
// and only they would catch it.
test('F-14 CLOSED (2.0.0): BitmapFont.prototype is frozen; method patching throws, subclassing survives', () => {
    assert.equal(typeof BitmapFont, 'function');
    assert.equal(Object.isFrozen(BitmapFont.prototype), true);
    // THROWS -- the intended close (a shared prototype hijack).
    assert.throws(() => { BitmapFont.prototype.draw = () => 'hijacked'; }, TypeError);
    assert.throws(() => { BitmapFont.prototype.injected = () => 1; }, TypeError);
    const f = new BitmapFont(ATLAS, JSON_ASCII);
    // THROWS -- the WIDER consequence: assignment-shadowing a method on an
    // instance also throws, because the inherited property is non-writable.
    assert.throws(() => { f.draw = () => 'hijacked'; }, TypeError);
    // ALLOWED -- Object.defineProperty on the instance is the supported override.
    assert.doesNotThrow(() => Object.defineProperty(f, 'draw', { value: () => 'ok', configurable: true }));
    assert.equal(f.draw(), 'ok');
    // ALLOWED -- own DATA fields stay mutable (the per-font state boundary).
    f.myOwnField = 1;
    assert.equal(f.myOwnField, 1);
    f.checked = false;              // an existing own data property
    assert.equal(f.checked, false);
    // ALLOWED -- subclassing is untouched: a subclass may override `draw`.
    class Sub extends BitmapFont { draw() { return 'sub'; } }
    const s = new Sub(ATLAS, JSON_ASCII);
    assert.equal(s.draw(), 'sub');
});

// F-18 is CLOSED in 1.8.0 (M7, decisions/0009): generateAtlas is no longer a
// demo-local duplicate -- it ships as the `@zakkster/lite-bmfont/atlas` subpath
// (Atlas.js) and the demo imports it. This block was the watch-todo that
// asserted the duplication STILL existed; it is now a real test of the CLOSED
// state. The A2/A3/A6 blocks below prove the extraction preserved behaviour and
// fails closed. (A5 pack contents, A3(i) clean-child import and A4 docs-drift
// live in the T8 torture tier, which needs a subprocess and the real tarball.)
test('F-18 CLOSED: generateAtlas ships as a subpath, the demo imports it', () => {
    const html = readFileSync(new URL('../demo/demo-lite-bmfont.html', import.meta.url), 'utf8');
    const defCount = (html.match(/function generateAtlas\(/g) || []).length;
    const callCount = (html.match(/generateAtlas\(/g) || []).length; // call sites only now
    assert.equal(defCount, 0);          // no inline definition remains
    assert.equal(callCount, 4);         // the four font-bank call sites
    // The demo imports the CDN FILE path for the subpath -- BARE, with no
    // `/+esm` suffix. Corrected in 1.9.0 to match what shipped: `+esm` is
    // jsDelivr's CommonJS-to-ESM transform, and Atlas.js is ALREADY ESM with
    // zero dependencies, so the suffix buys nothing and the bare file path is
    // what actually resolves. The pin is deliberately exact -- a `/atlas/+esm`
    // exports-subpath spelling is NOT guaranteed to resolve on jsDelivr
    // (decisions/0009), so this must not be loosened into a substring match.
    assert.match(html, /import\s*\{generateAtlas\}\s*from\s*'https:\/\/cdn\.jsdelivr\.net\/npm\/@zakkster\/lite-bmfont\/Atlas\.js'/);
    // The core still carries no atlas code -- the extraction did not leak into it.
    const src = readFileSync(new URL('../BitmapFont.js', import.meta.url), 'utf8');
    assert.equal(src.includes('generateAtlas'), false);
});

// A6 -- STEP-2 EQUIVALENCE. The shipped, doored generateAtlas produces
// byte-identical descriptors and identical canvas dimensions to the frozen
// verbatim body for every demo argument tuple, so the CLEAN edit provably
// preserved behaviour. Reddens if a body constant (e.g. cellW) is changed.
test('A6: doored generateAtlas matches the frozen verbatim body on the demo tuples', () => {
    const TUPLES = [
        [36, "bold 36px 'Fira Code', monospace", '#39ff85', '#001a0a'],
        [28, "800 28px 'Outfit', sans-serif", '#ffb830', '#1a0c00'],
        [18, "500 18px 'Outfit', sans-serif", '#c8c8e0', '#000'],
        [48, "bold 48px 'Fira Code', monospace", '#ff4090', '#200010'],
    ];
    const prev = globalThis.document;
    globalThis.document = makeDocStub();
    try {
        for (const t of TUPLES) {
            const a = generateAtlas(...t);
            const b = generateAtlasV0(...t);
            assert.deepStrictEqual(a.json, b.json, 'descriptor differs for size ' + t[0]);
            assert.equal(a.atlas.width, b.atlas.width, 'canvas width differs for size ' + t[0]);
            assert.equal(a.atlas.height, b.atlas.height, 'canvas height differs for size ' + t[0]);
        }
        // The descriptor must satisfy the { checked: true } door it was built for.
        const { atlas, json } = generateAtlas(...TUPLES[0]);
        assert.doesNotThrow(() => new BitmapFont(atlas, json, { checked: true }));
    } finally {
        if (prev === undefined) delete globalThis.document; else globalThis.document = prev;
    }
});

// A3 -- DOM DOORS. The DOM-FREE-IMPORT direction (A3(i)) is NOT tested here: a
// static `import '../Atlas.js'` at the top of this file already resolves the
// module in a DOM-free Node process, so an in-process A3(i) would be preempted
// -- its mutation (a module-scope bare-`document` read) crashes the whole file
// before any test registers, and any weaker mutation reddens A6 first. The
// genuine, non-redundant proof lives in torture tier T8 (`checkCleanChildImport`
// in t8-packaging.mjs): it imports BOTH entry points through the `exports` map
// in a CLEAN CHILD process, which the exports-map mutation reddens while
// `npm test` stays green.
test('A3(ii): generateAtlas without a DOM throws a NAMED AtlasError, not a TypeError', () => {
    const prev = globalThis.document;
    if (prev !== undefined) delete globalThis.document;
    try {
        let e = null;
        try { generateAtlas(36, 'x', '#fff'); } catch (x) { e = x; }
        assert.ok(e instanceof AtlasError, 'expected AtlasError, got ' + (e && e.constructor && e.constructor.name));
        assert.equal(e.name, 'AtlasError');
        assert.ok(!(e instanceof TypeError), 'a bare TypeError escaped the DOM door');
        assert.match(e.message, /^lite-bmfont: generateAtlas requires a DOM/);
    } finally {
        if (prev !== undefined) globalThis.document = prev;
    }
});
test('A3(size): a non-integer or out-of-range size throws AtlasError, does not normalize', () => {
    const prev = globalThis.document;
    globalThis.document = makeDocStub();
    try {
        // 1/2/3 are below the DERIVED lower bound (cellH - 4 >= 1 => size >= 4):
        // they would emit glyph heights -3/-2/0 that { checked: true } waves through.
        for (const bad of [36.5, 0, -1, 1, 2, 3, 513, NaN]) {
            let e = null;
            try { generateAtlas(bad, 'x', '#fff'); } catch (x) { e = x; }
            assert.ok(e instanceof AtlasError, 'size ' + bad + ' did not throw AtlasError');
            assert.match(e.message, /^lite-bmfont: generateAtlas size must be an integer/);
        }
        // twin: the smallest legal size (4) and a demo size (36) do NOT throw, and
        // every emitted glyph height is positive -- the whole point of the bound.
        for (const good of [4, 36]) {
            const { json } = generateAtlas(good, 'x', '#fff');
            for (const ch of json.chars) {
                assert.ok(ch.height >= 1, 'size ' + good + ' emitted height ' + ch.height + ' < 1');
            }
        }
    } finally {
        if (prev === undefined) delete globalThis.document; else globalThis.document = prev;
    }
});

// FIX 1 -- the 2d context is an unverified state. createElement can hand back an
// element with no getContext, and getContext('2d') can return null under memory
// pressure. Both must throw the AtlasError the header promises, never a bare
// TypeError one step later ("null is not zero").
test('A3(context): a null or unusable 2d context throws AtlasError, not a TypeError', () => {
    const prev = globalThis.document;
    try {
        // (a) getContext returns null.
        globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => null }) };
        let e = null;
        try { generateAtlas(36, 'x', '#fff'); } catch (x) { e = x; }
        assert.ok(e instanceof AtlasError, 'null context did not throw AtlasError, got ' + (e && e.constructor && e.constructor.name));
        assert.ok(!(e instanceof TypeError), 'a bare TypeError escaped the null-context door');
        assert.match(e.message, /2d context/);

        // (b) createElement returns an element with no getContext at all.
        globalThis.document = { createElement: () => ({ width: 0, height: 0 }) };
        e = null;
        try { generateAtlas(36, 'x', '#fff'); } catch (x) { e = x; }
        assert.ok(e instanceof AtlasError, 'no-getContext did not throw AtlasError, got ' + (e && e.constructor && e.constructor.name));
        assert.ok(!(e instanceof TypeError), 'a bare TypeError escaped the getContext door');
        assert.match(e.message, /no getContext/);

        // (c) createElement itself THROWS a plain Error -> AtlasError, not Error.
        globalThis.document = { createElement: () => { throw new Error('boom-create'); } };
        e = null;
        try { generateAtlas(36, 'x', '#fff'); } catch (x) { e = x; }
        assert.ok(e instanceof AtlasError, 'throwing createElement did not become AtlasError, got ' + (e && e.constructor && e.constructor.name));
        assert.match(e.message, /boom-create/); // the original is carried, not swallowed

        // (d) getContext THROWS a plain Error -> AtlasError, not Error.
        globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => { throw new Error('boom-ctx'); } }) };
        e = null;
        try { generateAtlas(36, 'x', '#fff'); } catch (x) { e = x; }
        assert.ok(e instanceof AtlasError, 'throwing getContext did not become AtlasError, got ' + (e && e.constructor && e.constructor.name));
        assert.match(e.message, /boom-ctx/);

        // (e) a hostile createElement throws a TypeError internally -> AtlasError,
        // NOT the bare TypeError the shipped docs promise never escapes.
        globalThis.document = { createElement: () => { undefined.foo; } };
        e = null;
        try { generateAtlas(36, 'x', '#fff'); } catch (x) { e = x; }
        assert.ok(e instanceof AtlasError, 'internal TypeError escaped as ' + (e && e.constructor && e.constructor.name));
        assert.ok(!(e instanceof TypeError), 'a bare TypeError escaped the DOM wrap');

        // twin: a healthy stub still succeeds.
        globalThis.document = makeDocStub();
        assert.doesNotThrow(() => generateAtlas(36, 'x', '#fff'));
    } finally {
        if (prev === undefined) delete globalThis.document; else globalThis.document = prev;
    }
});

// A2 -- RETENTION + GC. 200 generateAtlas calls with results dropped; every
// returned atlas is registered with lite-leak (a primitive tag, a module-level
// NOOP cleanup -- neither closes over the atlas, per the held-value contract).
// After gc() the tracker returns to 0. A canvas pool inside generateAtlas would
// hold all 200 and this reddens.
const ATLAS_NOOP = function () {};
test('A2: generateAtlas retains nothing -- 200 dropped atlases collect to 0', async () => {
    const tracker = createLeakTracker({ name: 'bmfont-atlas' });
    const prev = globalThis.document;
    globalThis.document = makeDocStub();
    // Churn in a helper so no stack slot retains the last atlas past the loop.
    function churn() {
        for (let i = 0; i < 200; i++) {
            const { atlas } = generateAtlas(36, "bold 36px monospace", '#fff');
            tracker.track(atlas, ATLAS_NOOP, i);
        }
    }
    try {
        churn();
        assert.equal(tracker.size(), 200, 'expected 200 tracked atlases mid-churn');
        for (let k = 0; k < 6; k++) {
            globalThis.gc?.();
            await new Promise((r) => setTimeout(r, 30));
        }
        assert.equal(tracker.size(), 0, 'atlases outlived their owner: ' + tracker.size());
    } finally {
        if (prev === undefined) delete globalThis.document; else globalThis.document = prev;
    }
});

// =====================================================================
// M5 (v1.9.0): the glyph-quad buffer -- layoutGlyphs + drawQuads
// =====================================================================
// A font with six DISTINCT glyphs (five visible A-E, plus a zero-size space so
// the count-vs-draw law below is non-vacuous). Every source column differs per
// glyph, so a column mix-up in drawQuads cannot hide behind equal values.
const QJSON = {
    common: { lineHeight: 20, base: 16 },
    chars: [
        { id: 65, x: 1, y: 2, width: 8, height: 12, xoffset: 1, yoffset: 3, xadvance: 9 },
        { id: 66, x: 11, y: 4, width: 7, height: 11, xoffset: 2, yoffset: 2, xadvance: 8 },
        { id: 67, x: 20, y: 6, width: 9, height: 13, xoffset: 0, yoffset: 4, xadvance: 10 },
        { id: 68, x: 30, y: 8, width: 6, height: 10, xoffset: 1, yoffset: 1, xadvance: 7 },
        { id: 69, x: 40, y: 3, width: 10, height: 14, xoffset: 2, yoffset: 5, xadvance: 11 },
        { id: 32, x: 0, y: 0, width: 0, height: 0, xoffset: 0, yoffset: 0, xadvance: 6 },
    ],
    kernings: [],
};
function qFont() { return new BitmapFont(ATLAS, QJSON); }
// Snapshot the recording's eight columns over [0, n) into a plain object.
function snap(n) {
    const c = { sx: [], sy: [], sw: [], sh: [], dx: [], dy: [], dw: [], dh: [] };
    for (let g = 0; g < n; g++) {
        c.sx.push(rec.sx[g]); c.sy.push(rec.sy[g]); c.sw.push(rec.sw[g]); c.sh.push(rec.sh[g]);
        c.dx.push(rec.dx[g]); c.dy.push(rec.dy[g]); c.dw.push(rec.dw[g]); c.dh.push(rec.dh[g]);
    }
    return c;
}

// A3 -- the mutation seam is the buffer. Editing buf[i*6+5] (dy) between the two
// calls moves EXACTLY one glyph by EXACTLY 10 in y and leaves the other five
// record columns untouched. Reddens under drawQuads `buffer[p + 5]` ->
// `buffer[p + 3]`: dy then reads the sh column, so the +10 never lands and the
// dy of the moved glyph equals its sh instead of base.dy + 10.
test('A3 (M5): editing dy in the quad buffer moves one glyph 10px, all six columns checked', () => {
    const f = qFont();
    const text = 'ABCDE';
    const buf = new Float64Array(text.length * GLYPH_STRIDE);
    const n = f.layoutGlyphs(text, buf, 0, 0, 1, 0);
    assert.equal(n, 5);
    resetRec(ATLAS);
    f.drawQuads(rec, buf, 0, n, 0, 0, 1);
    assert.equal(rec.calls, n);
    const base = snap(n);
    const i = 2;
    buf[i * GLYPH_STRIDE + 5] += 10;      // move glyph 2 down by 10 in y
    resetRec(ATLAS);
    f.drawQuads(rec, buf, 0, n, 0, 0, 1);
    assert.equal(rec.calls, n);
    for (let g = 0; g < n; g++) {
        const wantDy = base.dy[g] + (g === i ? 10 : 0);
        assert.equal(rec.dy[g], wantDy, 'dy[' + g + '] ' + rec.dy[g] + ' != ' + wantDy);
        assert.equal(rec.sx[g], base.sx[g], 'sx[' + g + '] moved');
        assert.equal(rec.sy[g], base.sy[g], 'sy[' + g + '] moved');
        assert.equal(rec.sw[g], base.sw[g], 'sw[' + g + '] moved');
        assert.equal(rec.sh[g], base.sh[g], 'sh[' + g + '] moved');
        assert.equal(rec.dx[g], base.dx[g], 'dx[' + g + '] moved');
    }
});

// A4 -- subset draw. drawQuads(ctx, buf, 2, 3, ...) draws records 2, 3, 4 in
// EXACTLY three calls, and the three drawn dx values are those records'. Reddens
// under the loop bound `const end = f + n;` -> `const end = n;` (the clamped
// first/count locals): the loop then runs g in [2, 3) -- one call for record 2.
test('A4 (M5): drawQuads(ctx, buf, 2, 3) draws records 2,3,4 in exactly 3 calls', () => {
    const f = qFont();
    const text = 'ABCDE';
    const buf = new Float64Array(text.length * GLYPH_STRIDE);
    const n = f.layoutGlyphs(text, buf, 0, 0, 1, 0);
    assert.equal(n, 5);
    resetRec(ATLAS);
    f.drawQuads(rec, buf, 2, 3, 0, 0, 1);
    assert.equal(rec.calls, 3, 'drawQuads drew ' + rec.calls + ' != 3');
    for (let k = 0; k < 3; k++) {
        const recIdx = 2 + k;
        assert.equal(rec.sx[k], buf[recIdx * GLYPH_STRIDE], 'call ' + k + ' sx != record ' + recIdx);
        assert.equal(rec.dx[k], buf[recIdx * GLYPH_STRIDE + 4], 'call ' + k + ' dx != record ' + recIdx);
    }
});

// A5 -- count equality with draw, including a zero-size glyph. layoutGlyphs
// returns the number of drawImage calls draw makes for the SAME text: a space
// (width 0, height 0) advances the cursor and emits no record. Reddens under
// layoutGlyphs `gw > 0 && gh > 0` -> `true`: the space then gets a record and the
// returned count (3) exceeds draw's drawImage count (2). (Over-detects into
// A1/A3 too, which is accepted.)
test('A5 (M5): layoutGlyphs count equals draw drawImage count -- a zero-size glyph emits no record', () => {
    const f = qFont();
    const text = 'A B';                    // space id 32 is width 0 / height 0
    resetRec(ATLAS);
    f.draw(rec, text, 0, 0, 1, 0);
    const drawCalls = rec.calls;
    assert.equal(drawCalls, 2, 'draw drew ' + drawCalls + ' != 2 (space must not draw)');
    const buf = new Float64Array(text.length * GLYPH_STRIDE);
    const n = f.layoutGlyphs(text, buf, 0, 0, 1, 0);
    assert.equal(n, drawCalls, 'layoutGlyphs count ' + n + ' != draw count ' + drawCalls);
});
