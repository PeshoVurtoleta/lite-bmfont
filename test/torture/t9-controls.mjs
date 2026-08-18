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
    oracleAdvance, FONT_ASCII, JSON_ASCII, ATLAS,
} from './harness.mjs';
import { BitmapFont, BitmapFontError } from '../../BitmapFont.js';
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

    // Control 9 -- the magnitude door (ROADMAP section 3 control 6). Runs OUT OF
    // PROCESS: with the door removed this body never returns, and no in-process
    // watchdog, throw or timeout can stop it. spawnSync's timeout is the only
    // mechanism; its default kill signal is SIGTERM. timeout(1) is not on this host.
    {
        const child = new URL('./t9-hang-child.mjs', import.meta.url).pathname;
        const hang = spawnSync(process.execPath, [child, 'hang', 'Number.MAX_VALUE'],
            { timeout: 2000, encoding: 'utf8' });
        if (hang.status === 3) die('T9 control 9: could not reconstruct the pre-door body -- the markers moved; update t9-hang-child.mjs');
        if (hang.signal !== 'SIGTERM') {
            die('T9 control 9: the door-removed body returned (signal=' + hang.signal +
                ' status=' + hang.status + ') -- the hang control is vacuous');
        }
        const door = spawnSync(process.execPath, [child, 'door', 'Number.MAX_VALUE'],
            { timeout: 2000, encoding: 'utf8' });
        if (door.status !== 0 || door.signal !== null) {
            die('T9 control 9: the SHIPPED body did not return on Number.MAX_VALUE -- the door is broken');
        }
        if (door.stdout.trim() !== 'calls=0') {
            die('T9 control 9: shipped drawFast(MAX_VALUE) drew ' + door.stdout.trim() + ', expected calls=0');
        }
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
}
