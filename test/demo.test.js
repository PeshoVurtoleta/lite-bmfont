// test/demo.test.js -- the demo's four frame-path scene bodies, gated.
//
// WHY (F-53): demo/ is excluded from files[], so the torture gate (T6) cannot
// see it. The demo used to render the words "zero alloc" over a frame path that
// allocated ~42 strings/frame. The bodies now live in demo/scenes.mjs and this
// file drives them with NO DOM and NO generateAtlas -- a plain descriptor and
// the shared recording ctx -- so the claim the demo prints is covered here.
//
// WHAT THIS FILE CAN AND CANNOT PROVE (measured, host-specific -- see F-54):
//   * WAVE and TYPEWRITER carry a large enough per-frame string signal that the
//     allocation-VOLUME lane separates the OLD (allocating) body from the NEW
//     (zero-alloc) one on this host. Those two get volume rows.
//   * SCORE (2 short strings/frame) and STRESS (1 concat/frame) are BELOW the
//     lane's resolution on this host -- the OLD and NEW numbers overlap. The
//     volume lane is BLIND to them (F-54). They are covered instead by a
//     BEHAVIOURAL row (the drawn glyphs are decoded from the recording ctx and
//     compared to the exact 2.0.0 output) plus a SOURCE-TEXT pin.
//   * The SOURCE-TEXT pin is a source-text gate, NOT behavioural coverage of
//     zero allocation: it proves the allocating TOKENS are gone from the render
//     bodies, nothing more. The volume lane cannot see a 2-string-per-frame
//     regression, so nothing here proves the score/stress scenes allocate zero.
//     That gap is F-54.
//
// Requires --expose-gc (npm test passes it). The gc assert below FAILS CLOSED:
// a missing gc is a hard failure, never a skipped no-op gate.
//
// @license MIT

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BitmapFont, GLYPH_STRIDE } from '../BitmapFont.js';
import { rec, allocVolume } from './torture/harness.mjs';
import { createLeakTracker } from '@zakkster/lite-leak';
import * as scenes from '../demo/scenes.mjs';

// ---- volume limits (host-derived, per SESSION-M10 LIMIT DERIVATION) ---------
// Host: darwin arm64, Node v26.3.1. Instrument: harness.allocVolume
// (VOL_OPS=200,000, VOL_WARMUP=20,000, stride i&1023). Method: 6 reps per body,
// fresh process, hard-warmed. FLOOR = max over reps of the NEW body; MUTANT =
// min over reps of the OLD body. LIMIT = round(sqrt(FLOOR*MUTANT)) to 2 sig figs.
//
//   scene       FLOOR(new)   MUTANT(old)   OLD/NEW   LIMIT       margins(new/old)
//   wave         6,337,808   21,257,144    3.35x     12,000,000  1.89x / 1.77x
//   typewriter     790,224    3,442,512    4.36x      1,600,000  2.02x / 2.15x
//
// BOTH margins are UNDER 10x. Per the derivation rule that is a FINDING, not a
// number to tune -- filed as F-54. The floor is NOT the ~0 the coordinator's
// host measured: on Node 26.3.1 allocVolume returns a non-zero, deterministic
// new-space-working-set floor for float-heavy multi-call frame bodies that does
// NOT correlate with real garbage (a heap-sampling profiler attributes ~504 B
// to the NEW wave body over 400k frames -- it is zero-alloc). The limits below
// still SEPARATE old from new deterministically on this host, so the mutation
// rows (A1/A6) redden; they are not widened to pass anything.
const WAVE_VOL_MAX = 12000000;
const TW_VOL_MAX = 1600000;

// ---- test font: plain descriptor, NO DOM, NO generateAtlas ------------------
// Space (32) has width/height 0 so it emits NO glyph record -- the record-vs-
// char gap the prefix map exists for is LIVE here (unlike a generateAtlas font,
// whose space has a measured width). Digits carry NON-UNIFORM advances plus a
// kerning pair, so intWidth / padded8Width are not vacuous (the atlas is not
// assumed monospace).
const ATLAS = {};
function makeDemoFont() {
    const chars = [];
    for (let id = 32; id <= 126; id++) {
        if (id === 32) {
            chars.push({ id: 32, x: 0, y: 0, width: 0, height: 0, xoffset: 0, yoffset: 0, xadvance: 6 });
            continue;
        }
        let adv = 12;
        if (id >= 48 && id <= 57) adv = 10 + ((id - 48) % 4);   // digits 10..13
        chars.push({ id, x: (id - 32) * 10, y: 0, width: 10, height: 14, xoffset: 0, yoffset: 2, xadvance: adv });
    }
    const kernings = [
        { first: 48, second: 48, amount: -2 },   // '0','0'
        { first: 49, second: 48, amount: 1 },    // '1','0'
        { first: 65, second: 66, amount: -1 },   // 'A','B'
    ];
    return new BitmapFont(ATLAS, { common: { lineHeight: 20, base: 16 }, chars, kernings });
}

function makeS() {
    const f = makeDemoFont();
    const S = scenes.makeSceneState({ main: f, accent: f, small: f, pink: f });
    S.W = 1200;
    S.H = 700;
    return S;
}

/** Decode the id of recorded glyph `i` from its source x (atlas x = (id-32)*10). */
function decodeChar(i) {
    return String.fromCharCode(Math.round(rec.sx[i] / 10) + 32);
}

function volFrame(fn, S) {
    return (i) => {
        S.now = i * 16.7;
        S.dt = 0.016;
        rec.calls = 0;
        fn(rec, S);
    };
}

// ---------------------------------------------------------------------------

test('the --expose-gc child reached this file (FAIL CLOSED, never a skip)', () => {
    assert.equal(typeof globalThis.gc, 'function',
        'globalThis.gc is missing -- run under --expose-gc; a silent skip is a no-op gate');
});

test('SCENE_STRIDE is gated equal to the library GLYPH_STRIDE', () => {
    // MUTATION: set SCENE_STRIDE to 5 in scenes.mjs -> this reddens and every
    // buffer index in the scene bodies is off by one.
    assert.equal(scenes.SCENE_STRIDE, GLYPH_STRIDE);
    assert.equal(scenes.SCENE_STRIDE, 6);
});

test('fork-4 volume lane: stub floor is near-zero; wave and typewriter separate OLD from NEW', () => {
    assert.equal(typeof globalThis.gc, 'function', 'no gc; volume lane cannot run');
    rec.expected = ATLAS;

    // MANDATORY CONTROL (SESSION-M10): a non-allocating body must resolve to the
    // floor at stride i&1023, in THIS process and run, so the scene numbers below
    // are signal not noise. In a clean script that floor is exactly 0; inside the
    // node:test runner it settles to an irreducible ~240 B (test-runner residue),
    // with occasional warmup spikes -- so take the MIN over reps and assert it is
    // far below STUB_CEILING. STUB_CEILING (100,000) sits below the coordinator's
    // measured WRONG-stride floors (stride 50 -> 575,968 B; stride 1 -> 3.7 MB),
    // so a broken stride still reddens this control, while the correct stride
    // passes. It is 16x below even the typewriter limit.
    const STUB_CEILING = 100000;
    const noop = (i) => {};
    let stub = Infinity;
    for (let r = 0; r < 8; r++) stub = Math.min(stub, allocVolume(noop));
    assert.ok(stub < STUB_CEILING,
        'stub-only floor is ' + stub + ' B (>= ' + STUB_CEILING + ') -- the stride is wrong and every scene number is noise');

    // WAVE volume row. A1 MUTATION (proven red in a sandbox): restore the OLD
    // `measure(msg.substring(0,i))` body -> ~21.3 MB > WAVE_VOL_MAX.
    const sWave = makeS();
    const waveFrame = volFrame(scenes.renderWave, sWave);
    allocVolume(waveFrame);   // warm
    const wave = Math.min(allocVolume(waveFrame), allocVolume(waveFrame));
    assert.ok(wave < WAVE_VOL_MAX,
        'wave allocated ' + wave + ' B/window >= ' + WAVE_VOL_MAX + ' (OLD-body regression)');

    // TYPEWRITER volume row. A6 MUTATION (proven red in a sandbox): restore the
    // OLD `twText.substring(...)` body -> ~3.4 MB > TW_VOL_MAX.
    const sTw = makeS();
    const twFrame = volFrame(scenes.renderTypewriter, sTw);
    allocVolume(twFrame);     // warm
    const tw = Math.min(allocVolume(twFrame), allocVolume(twFrame));
    assert.ok(tw < TW_VOL_MAX,
        'typewriter allocated ' + tw + ' B/window >= ' + TW_VOL_MAX + ' (OLD-body regression)');
});

test('A2 (score) behavioural: the drawn glyphs equal the 2.0.0 padStart(8,"0") string', () => {
    // The volume lane is BLIND to the score scene (F-54): 2 short strings/frame
    // is below its resolution. This is real, falsifiable coverage instead --
    // MUTATION: drop the ZEROS run (draw only drawFastInt) and a value < 8 digits
    // no longer decodes to eight characters; MUTATION: pad to 7 and v=99999999
    // mismatches. The digit sequence is decoded straight off the recording ctx.
    rec.expected = ATLAS;
    const S = makeS();
    S.dt = 0;   // freeze the animation so scoreDisplay == scoreVal exactly
    for (const v of [0, 7, 99, 1234567, 99999999]) {
        S.scoreVal = v;
        S.scoreDisplay = v;
        rec.calls = 0;
        scenes.renderScore(rec, S);
        // The first eight recorded glyphs are the padded number (zeros run then
        // digits); every one emits because '0'..'9' are visible glyphs.
        let drawn = '';
        for (let i = 0; i < 8; i++) drawn += decodeChar(i);
        assert.equal(drawn, String(v).padStart(8, '0'), 'score v=' + v + ' drew ' + drawn);
    }
});

test('A5 (wave) behavioural: drawQuads blits the RETURNED record count, not msg.length', () => {
    // WAVE_MSG is 19 chars with 2 spaces; a zero-size space emits no record, so
    // layoutGlyphs returns 17 and the loop must blit 17 scale-1 glyphs. MUTATION:
    // loop to msg.length (19) -> two UNWRITTEN records blit -> 19, not 17.
    rec.expected = ATLAS;
    const S = makeS();
    S.now = 1000;
    S.dt = 0.016;
    rec.calls = 0;
    scenes.renderWave(rec, S);
    // layoutGlyphs only ever WRITES records whose source size is > 0, so every
    // blitted record must have sw > 0. Looping to msg.length blits the two
    // never-written trailing slots (a zero-size drawImage) -- the pinned fork-10b
    // hazard -- and those carry sw == 0. This is the witness the record-count
    // gap turns on: 17 written, not msg.length == 19.
    let written = 0;
    for (let i = 0; i < rec.calls; i++) {
        assert.ok(rec.sw[i] > 0,
            'wave blit an UNWRITTEN record (sw=' + rec.sw[i] + ') at ' + i + ' -- drawQuads got msg.length, not the returned count');
        if (Math.abs(rec.dw[i] / rec.sw[i] - 1) < 1e-9) written++;   // msg1 renders at scale 1
    }
    // and msg1 contributes exactly the 17 records layoutGlyphs returned.
    assert.equal(written, 17, 'wave msg1 blit ' + written + ' scale-1 records; expected 17 (19 chars - 2 spaces)');
});

test('A7: ZEROS is nine constant runs built once at module load', () => {
    // MUTATION: move the ZEROS array literal inside renderScore -> the source-text
    // pin below catches the in-body literal (the volume lane is blind to one
    // array/frame, F-54). Here we assert the shape the score fork depends on.
    assert.equal(scenes.ZEROS.length, 9);
    for (let i = 0; i < 9; i++) {
        assert.equal(scenes.ZEROS[i], '0'.repeat(i), 'ZEROS[' + i + '] is not ' + i + " zeros");
    }
    // built once: the same reference survives across two makeSceneState calls
    makeS();
    makeS();
    assert.equal(scenes.ZEROS[8], '00000000');
});

// ---- SOURCE-TEXT PIN (F-26 disposition, applied KNOWINGLY) ------------------
// This is a SOURCE-TEXT gate, NOT behavioural coverage of zero allocation. It
// proves the allocating tokens (substring / padStart / toString / split / string
// concat / string-array literal) are absent from the four render function BODIES
// -- nothing about runtime behaviour. It exists because the volume lane cannot
// see the score/stress regressions (F-54).
//
// Scoped to the render BODIES with comments stripped, and proven in BOTH
// directions below, because this repo has twice shipped a grep that matched the
// very comment warning against the pattern.
const ALLOC_TOKEN = /substring|padStart|\.toString\(|\.split\(|\+\s*['"]|\[\s*['"]/;

function stripComments(code) {
    return code
        .replace(/\/\*[\s\S]*?\*\//g, '')      // block comments
        .replace(/\/\/[^\n]*/g, '');           // line comments
}

function renderBody(src, name) {
    const marker = 'export function ' + name + '(ctx, S) {';
    const start = src.indexOf(marker);
    assert.notEqual(start, -1, 'render body not found: ' + name);
    let depth = 0, i = start + marker.length - 1;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    assert.ok(depth === 0, 'unbalanced braces extracting ' + name);
    return src.slice(start, i + 1);
}

test('source-text pin: no allocating token in any render body (and the pin fires both ways)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, '..', 'demo', 'scenes.mjs'), 'utf8');

    // Direction 1: the shipped bodies are clean.
    for (const name of ['renderWave', 'renderScore', 'renderTypewriter', 'renderStress']) {
        const body = stripComments(renderBody(src, name));
        const m = body.match(ALLOC_TOKEN);
        assert.equal(m, null, name + ' contains an allocating token: ' + (m && m[0]));
    }

    // Direction 2: the pin actually fires. If any of these pass the pin, it is
    // inert and the direction-1 assertions above prove nothing.
    assert.ok(ALLOC_TOKEN.test("x.toString().padStart(8, '0')"), 'pin blind to padStart/toString');
    assert.ok(ALLOC_TOKEN.test('twText.substring(0, i)'), 'pin blind to substring');
    assert.ok(ALLOC_TOKEN.test("s.split('\\n')"), 'pin blind to split');
    assert.ok(ALLOC_TOKEN.test("count + ' LIVE STRINGS'"), 'pin blind to string concat');
    assert.ok(ALLOC_TOKEN.test("const z = ['', '0', '00'];"), 'pin blind to string-array literal (A7)');
    // and it does NOT match the legitimate indexing the bodies use
    assert.equal("ZEROS[8 - d]".match(ALLOC_TOKEN), null, 'pin false-positives on numeric indexing');
    assert.equal("SCORE_ORBIT[i]".match(ALLOC_TOKEN), null, 'pin false-positives on variable indexing');
});


// ---- A8: RETENTION with a CANARY (the lane F-54 says nothing else can see) --
// demo/scenes.mjs holds four module-scope typed-array buffers and a long-lived
// mutable state object S that closes over the fonts and receives a FRESH ctx
// every frame. A retention leak there -- a module sink that pushes ctx, a buffer
// that grows -- is invisible to every volume/behavioural/source row above: the
// volume lane measures transient garbage, not retention (that is F-54).
//
// WHY A CANARY, NOT `size -> 0`: a plain drain-to-0 is the F-27 defect itself.
// Tracking a THROWAWAY object instead of the ctx also arms at 256 (256 throwaways)
// and also drains to 0 (they are unreachable) -- both halves pass while the ctx
// was never watched. The count cannot tell 256 of the right object from 256 of
// the wrong one. So we RETAIN one ctx (the canary, index CANARY_IDX) alive to the
// end of the test and require the tracker to settle to EXACTLY 1. That single row
// now has three outcomes it can tell apart:
//   size 1   -> correct: 255 collected, the tracked canary survived because it is
//               still reachable. GREEN.
//   size 0   -> the canary was collected though we still hold it: the witness
//               tracked the WRONG object (F-27), not the ctx we retain. RED.
//   size 256 -> nothing collected: a module sink retained every ctx. RED.
// Held-value contract: neither the NOOP cleanup nor the numeric tag closes over
// the ctx; tracking the ctx itself is the point.
const DEMO_CTX_NOOP = function () {};
const CANARY_IDX = 7;

/** A fresh stub ctx per call -- a distinct, trackable target. */
function makeCtxStub() {
    return { globalAlpha: 1.0, fillStyle: '', fillRect() {}, drawImage() {} };
}

// Churn in a helper so no stack slot retains the last ctx past the loop. The ONE
// ctx at CANARY_IDX is pushed into `held` (which the caller keeps alive) so it
// must survive; every other ctx is dropped.
function churnCtxs(S, tracker, held) {
    for (let i = 0; i < 256; i++) {
        const c = makeCtxStub();
        for (let f = 0; f < 64; f++) {
            S.now = f * 16.7;
            S.dt = 0.016;
            scenes.renderTypewriter(c, S);   // drops c: renderTypewriter takes ctx as a param, never stores it
        }
        if (i === CANARY_IDX) held.push(c);  // retain exactly one REAL ctx
        tracker.track(c, DEMO_CTX_NOOP, i);
    }
}

test('A8: 256 dropped scene ctxs collect but the retained canary survives -> size exactly 1 (retention)', async () => {
    // FAIL CLOSED: a missing gc makes this a no-op that always "passes".
    assert.equal(typeof globalThis.gc, 'function', 'A8 needs --expose-gc; a silent skip is a no-op gate');
    const tracker = createLeakTracker({ name: 'bmfont-demo-ctx' });
    const S = makeS();
    const held = [];   // keeps the canary ctx alive to the end of this test

    churnCtxs(S, tracker, held);
    // Prove the witness was ARMED at 256 before proving anything drains -- a
    // tracker that was never 256 is a broken witness, not a passing gate.
    assert.equal(tracker.size(), 256, 'A8: witness not armed -- expected 256 tracked scene ctxs mid-churn, got ' + tracker.size());

    // BOUNDED churn (risk shape 4): fixed cycles with an await settle each, never
    // a `while (tracker.size())` spin.
    for (let k = 0; k < 6; k++) {
        globalThis.gc();
        await new Promise((r) => setTimeout(r, 30));
    }

    const survived = tracker.size();
    // size 0 => the tracked object was NOT the ctx we still hold (F-27).
    assert.notEqual(survived, 0,
        'A8 CANARY GONE: the retained ctx was collected -> the witness tracked the WRONG object, not the ctx (F-27); size 0 != 1');
    // size > 1 => a module sink held ctxs that should have been dropped.
    assert.equal(survived, 1,
        'A8 LEAK: ' + survived + ' scene ctxs retained, expected exactly the 1 held canary -> a module sink over ctx in scenes.mjs');
    // Reference `held` AFTER the assertions so V8 keeps the canary alive across
    // the gc loop; this line is also what makes the size-1 expectation true.
    assert.equal(held.length, 1, 'A8: the canary ctx must be the one live retained reference');
});
