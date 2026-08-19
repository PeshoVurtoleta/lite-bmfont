/**
 * T9 -- controls. Every gate M0 stands up, with the break that must make it
 * fail. A gate that cannot fail is decorative. Each control runs a deliberately-
 * broken variant IN PROCESS and die()s only if the corresponding gate FAILS to
 * flag it -- so a healthy run reaches the end silently.
 *
 * The whole-suite control (#9) is `BMFONT_TORTURE_BREAK=1 npm run torture`: it
 * injects retained allocations into T6 window A and torture.mjs's post-loop guard
 * turns a passed gate into a non-zero exit. It is exercised from torture.mjs, not
 * here; T9 covers the same alloc lane (controls 1 and 8) so a plain run already
 * proves the gate bites.
 *
 * Recorded deviations from the plan's control list:
 *   - Control 2 (nine-named-params): a rest parameter `drawImage(...args)`
 *     allocates a fresh Array per glyph, but that array is TRANSIENT and a
 *     retained-bytes gate (measureAllocs) cannot see it -- verified: bytesPerCall
 *     reads 0 for a purely transient rest ctx, and the measureOps rate lane's
 *     noise floor (~0.5 B/op) swamps the signal. So this control HOLDS the args
 *     array (restSink.push(args)) to make the allocation gate-visible, proving it
 *     is real. The nine-named-param rec forms no such array on the identical
 *     workload and passes. Both directions, so the rule is not folklore.
 */

import {
    rec, resetRec, nanScan, runOpsGate, runAllocGate, die,
    oracleAdvance, FONT_ASCII, FONT_NUM, JSON_ASCII, ATLAS,
} from './harness.mjs';
import { BitmapFont, BitmapFontError, DRAWFASTINT_MAX } from '../../BitmapFont.js';
import { createLeakTracker } from '@zakkster/lite-leak';
import { spawnSync } from 'node:child_process';

const NOOP = function () {};

/** A wrong oracle: 'A' (id 65) advances by 13 instead of 12. */
function wrongOracleAdvance(text, start, end, scale) {
    let width = 0;
    for (let i = start; i < end; i++) {
        const id = text.charCodeAt(i);
        width += (id === 65 ? 13 : 12) * scale;
    }
    return width;
}

/** Retained sink for the allocating controls -- survives GC so the gate sees it. */
const leak = [];

export function run() {
    // Control 1 -- the alloc gate (rate lane). An allocating hot loop retaining a
    // Float64Array every iteration MUST be rejected by runOpsGate.
    {
        const { report } = runOpsGate((i) => { leak.push(new Float64Array(64)); }, { ops: 4000, warmup: 0 });
        if (report.ok) die('T9 control 1: an allocating hot loop passed the zero-alloc/GC gate');
        leak.length = 0;
    }

    // Control 2 -- nine NAMED params, never a rest parameter. See the deviation
    // note above: the rest form's per-glyph Array is transient, so this control
    // retains it to make the allocation gate-visible.
    {
        const restSink = [];
        const restCtx = { drawImage(...args) { restSink.push(args); } };
        const badHot = (i) => { FONT_ASCII.draw(restCtx, 'ABC', 0, 0, 1, 0); };
        const { report: rBad } = runAllocGate(badHot, { iterations: 2000, batches: 6 });
        if (rBad.verdict === 'pass') {
            die('T9 control 2: a drawImage(...args) rest-param ctx retaining its args passed the retained-bytes gate');
        }
        restSink.length = 0;
        const goodHot = (i) => { rec.calls = 0; FONT_ASCII.draw(rec, 'ABC', 0, 0, 1, 0); };
        resetRec(ATLAS);
        const { report: rGood } = runAllocGate(goodHot, { iterations: 2000, batches: 6 });
        if (rGood.verdict !== 'pass') {
            die('T9 control 2: the nine-named-param rec did NOT pass the retained-bytes gate -- the gate is broken');
        }
    }

    // Control 3 -- the NaN scan. A hand-written NaN in one column over a window of
    // 8 must be reported as exactly one; clearing it returns the scan to zero.
    {
        resetRec(ATLAS);
        for (let i = 0; i < 8; i++) {
            rec.sx[i] = rec.sy[i] = rec.sw[i] = rec.sh[i] = 0;
            rec.dx[i] = rec.dy[i] = rec.dw[i] = rec.dh[i] = 0;
        }
        rec.calls = 8;
        rec.dx[3] = NaN;
        if (nanScan() !== 1) die('T9 control 3: nanScan did not report the injected NaN as 1');
        rec.dx[3] = 0;
        if (nanScan() !== 0) die('T9 control 3: nanScan stayed nonzero after clearing');
        resetRec(ATLAS);
    }

    // Control 4 -- the conservation law's comparator. A wrong oracle (one glyph
    // off by one) MUST diverge from _measureRange; the correct oracle must agree.
    {
        const t = 'AAAA';
        const correct = oracleAdvance(JSON_ASCII, t, 0, t.length, 1);
        const mr = FONT_ASCII._measureRange(t, 0, t.length, 1);
        if (correct !== mr) die('T9 control 4: the correct oracle disagrees with _measureRange (law setup broken)');
        const wrong = wrongOracleAdvance(t, 0, t.length, 1);
        if (wrong === mr) die('T9 control 4: a wrong oracle matched _measureRange -- the law cannot detect an error');
    }

    // Control 5 -- the dropped truncation guard. A 5000-glyph draw overruns
    // CAP=4096 -> dropped>0. The same shape reset first stays under CAP.
    {
        const big = 'A'.repeat(5000);
        resetRec(ATLAS);
        FONT_ASCII.draw(rec, big, 0, 0, 1, 0);
        if (rec.dropped === 0) die('T9 control 5: a 5000-glyph draw did not overrun CAP -- the dropped guard is dead');
        resetRec(ATLAS);
        FONT_ASCII.draw(rec, 'ABC', 0, 0, 1, 0);
        if (rec.dropped !== 0) die('T9 control 5: dropped>0 on a 3-glyph draw after resetRec');
    }

    // Control 6 -- the retention witness. A tracked handle raises size(); untrack
    // returns it to 0. Proves the witness can see a leak at all.
    {
        const tracker = createLeakTracker({ name: 'bmfont-control' });
        const hh = tracker.track({ probe: 1 }, NOOP, 'ctl6');
        if (tracker.size() === 0) die('T9 control 6: tracker.size() is 0 after a track -- the witness is blind');
        tracker.untrack(hh);
        if (tracker.size() !== 0) die('T9 control 6: tracker.size() did not return to 0 after untrack');
    }

    // Control 7 -- the imgMismatch identity witness (which replaces pixel checks).
    // Drawing a font built on ATLAS into a window expecting a DIFFERENT atlas must
    // raise imgMismatch; the matching atlas gives 0.
    {
        const other = {};
        resetRec(other);
        FONT_ASCII.draw(rec, 'ABC', 0, 0, 1, 0);
        if (rec.imgMismatch === 0) die('T9 control 7: imgMismatch stayed 0 despite a wrong atlas identity');
        resetRec(ATLAS);
        FONT_ASCII.draw(rec, 'ABC', 0, 0, 1, 0);
        if (rec.imgMismatch !== 0) die('T9 control 7: imgMismatch nonzero on the matching atlas');
    }

    // Control 8 -- the retained-bytes lane specifically. A per-call retaining fn
    // must be rejected; its zero-retention twin must pass. Control 1 only
    // exercises the rate lane; without this, maxBytesPerCall:0 is ungated.
    {
        const retaining = (i) => { leak.push(new Float64Array(8)); };
        const { report: r8bad } = runAllocGate(retaining, { iterations: 2000, batches: 6 });
        if (r8bad.verdict === 'pass') die('T9 control 8: a per-call retaining fn passed the retained-bytes gate');
        leak.length = 0;
        const twin = (i) => { const tmp = new Float64Array(8); tmp[0] = i; };
        const { report: r8good } = runAllocGate(twin, { iterations: 2000, batches: 6 });
        if (r8good.verdict !== 'pass') die('T9 control 8: the zero-retention twin did not pass the retained-bytes gate');
    }

    // Control 9 -- the magnitude door, re-derived as a CORRUPTION control
    // (decisions/0007 fork 6). M8b deleted `value * 10`, so the pre-door body no
    // longer HANGS on Number.MAX_VALUE: every loop is bounded by a finite
    // exponent, so it decomposes (e = 971) and RETURNS. A hang control would now
    // be vacuous. What the door still prevents is SILENT SCRATCH TRUNCATION --
    // door-removed, MAX_VALUE fills the shared 24-byte scratch with a truncated
    // (wrong) digit string; the shipped body rejects it before the scratch is
    // touched. Runs OUT OF PROCESS because the reconstruction imports a mutated
    // copy of the module. The load-bearing observable is scratch-touched vs not.
    {
        const child = new URL('./t9-hang-child.mjs', import.meta.url).pathname;
        const corrupt = spawnSync(process.execPath, [child, 'corrupt', 'Number.MAX_VALUE'],
            { timeout: 2000, encoding: 'utf8' });
        if (corrupt.status === 3) die('T9 control 9: could not reconstruct the door-removed body -- the markers moved; update t9-hang-child.mjs');
        // It MUST return. A SIGTERM (timeout) here would mean it hung -- which the
        // new finite-exponent body cannot do; that would signal value*10 crept back.
        if (corrupt.signal !== null || corrupt.status !== 0) {
            die('T9 control 9: the door-removed body did not RETURN (signal=' + corrupt.signal +
                ' status=' + corrupt.status + ') -- M8b made every loop finite; a non-return means value*10 is back');
        }
        const cm = /^calls=(\d+) touched=(\d) digits=(.+)$/.exec(corrupt.stdout.trim());
        if (!cm) die('T9 control 9: corrupt child output unparseable: ' + JSON.stringify(corrupt.stdout.trim()));
        const corruptCalls = cm[1], corruptTouched = cm[2], corruptDigits = cm[3];
        // G-3: the regime-B carry backstop (`if (len >= buf.length) return`) must
        // fire, so door-removed MAX_VALUE fills the scratch but RETURNS without
        // drawing -- calls=0. Drop that guard from the shipped body and the same
        // reconstruction draws 24 corrupted glyphs (calls=24), which reddens here.
        // This is the ONLY coverage of that backstop: the door hides it in normal
        // operation, so only the door-removed leg reaches it.
        if (corruptCalls !== '0') die('T9 control 9: door-removed MAX_VALUE DREW ' + corruptCalls + ' glyphs (expected 0) -- the regime-B carry backstop `if (len >= buf.length) return` is missing, so truncated digits render instead of failing closed (G-3)');
        // The door-removed body must have WRITTEN the scratch with a 24-byte
        // truncated number -- MAX_VALUE has ~309 true digits, only 24 fit.
        if (corruptTouched !== '1') die('T9 control 9: door-removed MAX_VALUE left the scratch canary intact -- no corruption produced, control vacuous (A7)');
        if (!/^\d+\.\d$/.test(corruptDigits) || corruptDigits.length !== 24) {
            die('T9 control 9: door-removed MAX_VALUE scratch is not a 24-byte truncated number: ' + JSON.stringify(corruptDigits));
        }

        const door = spawnSync(process.execPath, [child, 'door', 'Number.MAX_VALUE'],
            { timeout: 2000, encoding: 'utf8' });
        if (door.status !== 0 || door.signal !== null) {
            die('T9 control 9: the SHIPPED body did not return on Number.MAX_VALUE -- the door is broken');
        }
        // Shipped: rejected at the door BEFORE the scratch is touched.
        if (door.stdout.trim() !== 'calls=0 touched=0') {
            die('T9 control 9: shipped drawFast(MAX_VALUE) reported "' + door.stdout.trim() + '", expected "calls=0 touched=0" (door must reject before touching the scratch)');
        }
        // The proof: door removed corrupts the scratch (touched=1), door present
        // leaves it untouched (touched=0). Identical would make the control vacuous.
        if (corruptTouched === '0') die('T9 control 9: door-removed and door-present left the scratch identical -- corruption control vacuous (A7)');
    }

    // Control 10 -- the descriptor door (T3, M3). The door must bite BOTH ways:
    // a non-array `chars` throws a BitmapFontError (the door is live), and an
    // empty-array `chars` constructs (the door is not always-throwing). Deleting
    // the chars pre-pass makes `chars: 7` construct a 0-glyph font -> the first
    // check dies; an always-throwing pre-pass makes `chars: []` throw -> the
    // second dies. T3 rows 13 and 17 are the gated form; this is the control that
    // proves the descriptor gate can fail at all. Verified out of process at
    // M3-T25: deleting the pre-pass reddens T3 (row 13/A1), restoring returns ok.
    {
        let threw = null;
        try { new BitmapFont(ATLAS, { common: { lineHeight: 20, base: 16 }, chars: 7 }); }
        catch (e) { threw = e; }
        if (!(threw instanceof BitmapFontError)) {
            die('T9 control 10: chars 7 did not throw a BitmapFontError -- the descriptor door is dead (T3 would pass vacuously)');
        }
        let constructed = true;
        try { new BitmapFont(ATLAS, { common: { lineHeight: 20, base: 16 }, chars: [] }); }
        catch { constructed = false; }
        if (!constructed) {
            die('T9 control 10: chars [] threw -- the descriptor door is always-throwing (T3 non-vacuity twin would fail)');
        }
    }

    // ---- M4 controls 11, 12, 13 --------------------------------------------
    // All three run OUT OF PROCESS against a REBUILT library, not against a
    // model of one. A control that recomputes the rejected arithmetic in the
    // test file and compares it to itself proves nothing about the shipped body;
    // these mutate BitmapFont.js, import the mutation, and require the numbers
    // to move. Control 13's variants cannot even be run in process -- they never
    // return -- so spawnSync's timeout is the only mechanism, exactly as it is
    // for control 9.
    const mchild = new URL('./t9-measure-hang-child.mjs', import.meta.url).pathname;
    const spawnChild = (mode, ms) => spawnSync(process.execPath, [mchild, mode],
        { timeout: ms, killSignal: 'SIGKILL', encoding: 'utf8' });
    const parseChild = (r, mode) => {
        if (r.status === 3) {
            die('T9 control 11-13: could not reconstruct the ' + mode + ' body -- the markers moved; ' +
                'update t9-measure-hang-child.mjs. stderr: ' + (r.stderr || '').trim());
        }
        if (r.status !== 0 || r.signal !== null) {
            die('T9 control 11-13: the ' + mode + ' child did not exit 0 (status=' + r.status +
                ' signal=' + r.signal + ') stderr: ' + (r.stderr || '').trim());
        }
        return JSON.parse(r.stdout.trim());
    };
    const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

    // The shipped body's own numbers, read from the same child so every
    // comparison below is library-against-library.
    const shipped = parseChild(spawnChild('door', 4000), 'door');

    // Control 11 -- fork (2) option A, the ACCUMULATE-ROUNDED form.
    // It must be DETECTED at the y = 0 table, and detected at lines 2, 3 and 4
    // specifically: A and B agree on lines 0 and 1, so a control that checked a
    // two-line prefix would pass and the whole session would ship the wrong
    // fork. The full five-element array is asserted.
    {
        const a = parseChild(spawnChild('aform', 4000), 'aform');
        if (same(a.y0, shipped.y0)) {
            die('T9 control 11: the accumulate-rounded (A) form produced the SHIPPED y=0 baselines ' +
                a.y0.join(',') + ' -- the Y table cannot tell fork (2) A from B, and it is decorative');
        }
        if (!(a.y0[0] === shipped.y0[0] && a.y0[1] === shipped.y0[1])) {
            die('T9 control 11: A and B disagree at line 0 or 1 (' + a.y0.join(',') + ' vs ' +
                shipped.y0.join(',') + ') -- the harness moved, not the library');
        }
        if (!(a.y0[2] !== shipped.y0[2] && a.y0[3] !== shipped.y0[3] && a.y0[4] !== shipped.y0[4])) {
            die('T9 control 11: A diverges from B on fewer than three of lines 2-4 (' + a.y0.join(',') +
                ' vs ' + shipped.y0.join(',') + ')');
        }
        // The other direction: the SHIPPED body still produces the pinned row.
        if (!same(shipped.y0, [0, 19, 37, 56, 75])) {
            die('T9 control 11: the shipped body gives y=0 baselines ' + shipped.y0.join(',') +
                ' != 0,19,37,56,75');
        }
    }

    // Control 12 -- the losing sub-fork B2, Math.round(y + i * step).
    // It must be DETECTED at the fractional-y row and NOT detected at y = 0.
    // The second half is the point: B2 passing the y = 0 table is the measured
    // fact that makes the fractional-y row necessary. A control that fires on
    // y = 0 means the harness is wrong, not the library.
    {
        const b2 = parseChild(spawnChild('b2form', 4000), 'b2form');
        if (!same(b2.y0, shipped.y0)) {
            die('T9 control 12: B2 was DETECTED at y=0 (' + b2.y0.join(',') + ' vs ' +
                shipped.y0.join(',') + ') -- B1 and B2 are identical there; the harness is wrong');
        }
        if (same(b2.y06, shipped.y06)) {
            die('T9 control 12: B2 produced the SHIPPED y=0.6 baselines ' + b2.y06.join(',') +
                ' -- the discriminator does not discriminate and the sub-fork is unpinned');
        }
        // The shipped row, pinned literally. B1 gives 1,20,38,57,76; B2 gives
        // 1,19,38,57,75; they differ at indices 1 and 4 ONLY.
        if (!same(shipped.y06, [1, 20, 38, 57, 76])) {
            die('T9 control 12: the shipped body gives y=0.6 baselines ' + shipped.y06.join(',') +
                ' != 1,20,38,57,76 (B1)');
        }
        if (!same(b2.y06, [1, 19, 38, 57, 75])) {
            die('T9 control 12: the B2 variant gives ' + b2.y06.join(',') + ' != 1,19,38,57,75');
        }
        if (!(b2.y06[0] === shipped.y06[0] && b2.y06[2] === shipped.y06[2] && b2.y06[3] === shipped.y06[3])) {
            die('T9 control 12: B1 and B2 disagree outside indices 1 and 4 -- re-derive the row');
        }
    }

    // Control 13 -- the F-34 out-of-process non-termination control.
    // The shipped child already exited 0 above AND checked every returned value,
    // so "it returned" is not being mistaken for "it returned the right thing".
    // What remains is the SELF-TEST: a door-removed body MUST be killed. If a
    // doorless child also exits 0 the watchdog is not watching, and a control
    // that cannot fail is decorative (ROADMAP law 8).
    {
        // The fourth value is 32, not 0, since F-38: a NaN index pair clamps to
        // the whole line, matching what drawWrapped renders for it.
        if (shipped.a !== 32 || shipped.b !== 'NaN' || shipped.c !== 'NaN' || shipped.d !== 32) {
            die('T9 control 13: the shipped child returned ' + JSON.stringify(shipped) +
                ' -- expected 32 / NaN / NaN / 32');
        }
        for (const broken of ['nodoor', 'notext']) {
            const r = spawnChild(broken, 2000);
            if (r.status === 3) {
                die('T9 control 13: could not reconstruct the ' + broken + ' body -- the markers moved');
            }
            if (r.signal !== 'SIGKILL') {
                die('T9 control 13: the ' + broken + ' body RETURNED (status=' + r.status +
                    ' signal=' + r.signal + ') -- the door-removed walk terminated, so the hang ' +
                    'control is vacuous and F-34 is not actually gated');
            }
        }
    }

    // ---- M4a controls 14, 15 -- the RENDERER text doors (F-42) --------------
    // Same shape as 11-13 but against a SEPARATE child: the renderer doors are
    // `return;` not `return NaN;` and must not share the measure family's marker
    // budget (t9-measure-hang-child.mjs's TEXT_DOOR expects exactly 3). The
    // `door` lane is spawned ONCE and both controls read it, exactly as 11/12/13
    // share one `shipped` parse. Shipped lane 6000 ms (the PROBE's SIGKILL
    // budget); doorless SELF-TEST lanes 2000 ms (a body that has not terminated
    // on an Infinity bound in 2 s never will, and 6 s twice adds 8 s of wall
    // clock to learn nothing -- matches control 13's 2000).
    const rchild = new URL('./t9-render-hang-child.mjs', import.meta.url).pathname;
    const spawnRender = (mode, ms) => spawnSync(process.execPath, [rchild, mode],
        { timeout: ms, killSignal: 'SIGKILL', encoding: 'utf8' });
    {
        const r = spawnRender('door', 6000);
        if (r.status === 3) {
            die('T9 control 14/15: could not reconstruct the door-removed body -- the markers moved; ' +
                'update t9-render-hang-child.mjs. stderr: ' + (r.stderr || '').trim());
        }
        if (r.status !== 0 || r.signal !== null) {
            die('T9 control 14/15: the shipped render child did not exit 0 (status=' + r.status +
                ' signal=' + r.signal + ') stderr: ' + (r.stderr || '').trim());
        }
        const d = JSON.parse(r.stdout.trim());

        // Control 14 -- draw's text door. real===1 is the NON-VACUITY twin: a
        // door that rejects everything passes the three zeros and fails HERE.
        if (!(d.hangDraw === 0 && d.boxed === 0 && d.nullish === 0 && d.real === 1)) {
            die('T9 control 14: the shipped draw child returned ' + JSON.stringify(d) +
                ' -- expected hangDraw 0, boxed 0, nullish 0, real 1');
        }
        // Control 15 -- drawWrapped's text door, read from the same child.
        if (d.hangWrap !== 0) {
            die('T9 control 15: the shipped drawWrapped child drew ' + d.hangWrap + ' on HANGY, expected 0');
        }

        // Control 14 SELF-TEST: the door-removed draw MUST be SIGKILLed. If it
        // exits 0 the watchdog is not watching and the control is decorative.
        const nd = spawnRender('nodraw', 2000);
        if (nd.status === 3) {
            die('T9 control 14: could not reconstruct the door-removed draw body -- the markers moved');
        }
        if (nd.signal !== 'SIGKILL') {
            die('T9 control 14: the door-removed draw RETURNED (status=' + nd.status +
                ' signal=' + nd.signal + ') -- the hang control is vacuous and F-42 is not actually gated');
        }
        // Control 15 SELF-TEST: the door-removed drawWrapped MUST be SIGKILLed.
        const nw = spawnRender('nowrap', 2000);
        if (nw.status === 3) {
            die('T9 control 15: could not reconstruct the door-removed drawWrapped body -- the markers moved');
        }
        if (nw.signal !== 'SIGKILL') {
            die('T9 control 15: the door-removed drawWrapped RETURNED (status=' + nw.status +
                ' signal=' + nw.signal + ') -- the hang control is vacuous and F-42 is not actually gated');
        }
    }

    // ---- M8 control 16 -- the shared-scratch re-entrancy contract (fork 2) ---
    // A NEW child (no source patch, so no marker budget): it supplies a HOSTILE
    // ctx, it does not run a broken build. The contract line in the source
    // header, README, llms.txt and .d.ts says ctx.drawImage must not re-enter the
    // font; this control violates it and proves the corruption is REAL. A
    // contract nobody can violate in a test is decorative.
    const echild = new URL('./t9-reentry-child.mjs', import.meta.url).pathname;
    const spawnReentry = (mode, ms) => spawnSync(process.execPath, [echild, mode],
        { timeout: ms, killSignal: 'SIGKILL', encoding: 'utf8' });
    {
        // Lane 1: the NON-VACUITY twin. A ctx that records nothing passes every
        // corruption check trivially, so prove the recording path first.
        const c = spawnReentry('clean', 4000);
        if (c.status !== 0 || c.signal !== null) {
            die('T9 control 16: the clean reentry child did not exit 0 (status=' + c.status +
                ' signal=' + c.signal + ') stderr: ' + (c.stderr || '').trim());
        }
        const cd = JSON.parse(c.stdout.trim());
        if (!(cd.glyphs === '12345' && cd.calls === 5)) {
            die('T9 control 16: the clean lane rendered ' + JSON.stringify(cd) +
                ' -- expected glyphs "12345", calls 5 (the recording path is broken, not the library)');
        }
        // Lane 2: the violation. A re-entrant ctx MUST corrupt the outer digits.
        const r = spawnReentry('reenter', 4000);
        if (r.status !== 0 || r.signal !== null) {
            die('T9 control 16: the reentry child did not exit 0 (status=' + r.status +
                ' signal=' + r.signal + ') stderr: ' + (r.stderr || '').trim());
        }
        const rd = JSON.parse(r.stdout.trim());
        // The inner call must have HAPPENED (risk e): innerGlyphs proves the
        // nested drawFastInt(99) ran before we judge the outer call corrupt.
        if (rd.innerGlyphs !== '99') {
            die('T9 control 16: the nested drawFastInt(99) did not run (innerGlyphs=' +
                JSON.stringify(rd.innerGlyphs) + ') -- the depth guard skipped the re-entry, so ' +
                'the corruption test never fired');
        }
        if (rd.outerGlyphs === '12345') {
            die('T9 control 16: a re-entrant ctx did NOT corrupt drawFastInt -- the ' +
                'shared-scratch contract line in README/llms.txt/the source header is decorative. ' +
                'Either a second scratch was allocated (decisions/0005 fork 2 was reversed without ' +
                'amending the ADR) or this control no longer re-enters.');
        }
    }

    // ---- M8 control 17 -- the digit-loop divergence detector -----------------
    // drawFast and drawFastInt DUPLICATE the digit loop (decisions/0007 fork 3:
    // they may not be merged -- drawFast now carries two regimes and a decimal
    // digit drawFastInt never needs). This control is BEHAVIOURAL, not a source
    // diff. For every value drawFast(n) must decode to the EXACT integer digits of
    // the double n plus a trailing ".0" (oracle: BigInt of that exact integer).
    // Where n is also within drawFastInt's door (<= DRAWFASTINT_MAX), drawFastInt(n)
    // must decode to the same digits WITHOUT the ".0". Reddens on a digit-order
    // inversion, a radix mistake, a dropped digit, or an off-by-one in EITHER
    // loop's bound.
    //
    // M8b closed F-23 (decisions/0007), so the SET now reaches DRAWFAST_MAX: the
    // old band-2 exclusion -- which stopped the set below where `value * 10`
    // overflowed the 53-bit significand -- is gone. The regime-B values
    // (2^53 .. 1e21) exercise drawFast's decimal-doubling loop, which drawFastInt
    // never runs; 1e21 fills the scratch to exactly 24 bytes, so a `- 1` off-by-one
    // on either regime-B bound drops its last digit and dies here.
    {
        const SET = [1, 7, 9, 10, 42, 99, 100, 512, 999, 1000, 65535, 12345,
            100000, 999999, 1000000, 16777216, 2147483647, 2147483648, 4294967296,
            100000000000, 999999999999, 900000000000000, 1000000000000000, 4503599627370496,
            9007199254740991, 9007199254740992, 1e18, 1e20, 5e20, 1e21];
        let s = '';
        const cctx = { drawImage(img, sx, sy, sw) { s += String.fromCharCode(sw === 4 ? 46 : 48 + sx / 10); } };
        for (let i = 0; i < SET.length; i++) {
            const n = SET[i];
            // n is an integer-valued double; BigInt(n) is its exact value.
            const want = BigInt(n).toString() + '.0';
            s = ''; FONT_NUM.drawFast(cctx, n, 0, 0);
            const viaFast = s;
            if (viaFast !== want) {
                die('T9 control 17: n=' + n + ' drawFast -> "' + viaFast + '", exact "' + want +
                    '" -- drawFast digit loop diverged from the exact value');
            }
            if (n <= DRAWFASTINT_MAX) {
                s = ''; FONT_NUM.drawFastInt(cctx, n, 0, 0);
                const viaInt = s;
                if (viaInt !== viaFast.slice(0, -2)) {
                    die('T9 control 17: n=' + n + ' drawFastInt -> "' + viaInt + '" but drawFast -> "' +
                        viaFast + '" -- the two duplicated digit loops diverged');
                }
            }
        }
    }
}
