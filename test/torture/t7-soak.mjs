/**
 * T7 -- soak and retention.
 *
 * 4096 build/draw/destroy cycles. Each cycle constructs a fresh
 * new BitmapFont(ATLAS, JSON_SOAK) -- 200 glyphs, 500 kerning pairs, 134,712
 * bytes of typed array (3584 + 131072 + 24 + 32) -- draws a 64-char string, a
 * drawFast value and an 8-line wrapped layout, then destroy()s it. Total churn
 * is 4096 x 134,712 = 551,780,352 bytes (~552 MB).
 *
 * After each cycle destroy() must null every reference (atlas, glyphs, kerning,
 * _charScratch, _mapped -- the M2 coverage bitmap), and a SECOND, independent
 * witness (lite-leak) must return to size 0 -- so a typed-array leak and a
 * JS-object leak cannot hide behind each other.
 *
 * THE WITNESS IS THE FONT ITSELF (F-27, corrected M9pre). lite-leak's held-value
 * contract (llms.txt:127-128) forbids the `cleanup` closure OR the `tag` from
 * closing over `target` -- "capturing the target via either defeats
 * finalization." It does NOT forbid passing the target AS `target`: the
 * FinalizationRegistry watches exactly that object. So the font is tracked with
 * a module-level NOOP (closes over nothing) and a numeric tag `c`, and BOTH legs
 * of the real contract are satisfied. The prior code tracked a throwaway
 * `{cycle: c}` and untracked it in the same iteration, so the tier could never
 * see a leaked font -- a blind witness that this comment used to argue FOR.
 *
 * There is NO untrack. llms.txt:127-128: a record is retained "until FR fires OR
 * untrack" -- two ways down, and only one is a witness. A collected font fires
 * its FR callback and decrements size() on its own; a retained font never does,
 * and that difference IS the test. An untrack (even one guarded on destroy())
 * cancels the FR unconditionally -- destroy() ALWAYS nulls the five refs, so the
 * guard is always true and the witness goes blind again (verified: with an
 * untrack, a module-level KEEP.push(this) retainer leaves size() at 0; without
 * it, size() reads 4096). size() is read ONCE, after the loop, after gc() and
 * TWO settle ticks -- FR callbacks fire on a later turn, so a synchronous read
 * sees an empty window and false-passes.
 *
 * Heap growth is RECORDED, not gated. It was never a leak witness -- F-27
 * records the 512 KB bound passing with 4096 fonts genuinely retained, because
 * destroy() nulls the arrays and the shells are small -- and under contention it
 * false-REDs (3/120, up to 646.8 KB). The witness is size(); the heap number is
 * printed for observability only. See the de-gate note at the read below.
 *
 * FRAME-LIVENESS PRECONDITION. The FR witness only works if the fonts' creating
 * frame has RETURNED before size() is read: a live stack slot holds the last
 * `const font`, so a same-frame drain leaves it uncollectable and false-REDs with
 * "leaked 1 resources" -- invisible under JIT, deterministic under `--jitless`.
 * The fill loop therefore lives in fill(), which returns before run() drains.
 */

import { BitmapFont } from '../../BitmapFont.js';
import { createLeakTracker } from '@zakkster/lite-leak';
import {
    rec, resetRec, check, ATLAS, JSON_SOAK, S64, WRAP_TEXT, WRAP_LAYOUT,
} from './harness.mjs';

const CYCLES = 4096;
const NOOP = function () {};             // module scope -- never a closure over target

/** Yield a real event-loop turn so pending FinalizationRegistry callbacks run. */
function settle() { return new Promise((resolve) => setTimeout(resolve, 50)); }

/**
 * Run the 4096 build/draw/destroy cycles in ITS OWN FRAME, tracking each font.
 * FRAME-LIVENESS PRECONDITION (see the header): this MUST be a separate frame
 * from the drain. The last `const font` occupies a live stack slot for as long
 * as its creating frame is on the stack; if the loop and the size() read shared
 * one frame, the final font would not be collectable when size() is read and the
 * witness would false-RED with "leaked 1 resources" -- invisible under JIT,
 * deterministic under `--jitless`. Returning here frees that slot before the
 * caller drains. The tracker is passed IN and this function returns void -- it
 * is the RETURN of this frame, not any value it hands back, that frees the slot.
 */
function fill(tracker) {
    for (let c = 0; c < CYCLES; c++) {
        const font = new BitmapFont(ATLAS, JSON_SOAK);

        // Exercise all three draw paths on the fresh font.
        resetRec(ATLAS);
        font.draw(rec, S64, 0, 0, 1, 0);
        font.drawFast(rec, 123.4, 0, 0);
        font.drawWrapped(rec, WRAP_TEXT, WRAP_LAYOUT, 8, 100, 200, 0, 0);
        check(rec.dropped === 0 && rec.imgMismatch === 0,
            () => 'T7: cycle ' + c + ' dropped ' + rec.dropped + ' imgMismatch ' + rec.imgMismatch);

        // The witness IS the font. Module-level NOOP cleanup (closes over
        // nothing) and a numeric tag satisfy the held-value contract; there is
        // NO untrack, so a collected font decrements size() via its FR callback
        // and a retained one never does. See the header.
        tracker.track(font, NOOP, c);

        font.destroy();
        check(font.atlas === null, () => 'T7: cycle ' + c + ' atlas not nulled');
        check(font.glyphs === null, () => 'T7: cycle ' + c + ' glyphs not nulled');
        check(font.kerning === null, () => 'T7: cycle ' + c + ' kerning not nulled');
        check(font._charScratch === null, () => 'T7: cycle ' + c + ' _charScratch not nulled');
        check(font._mapped === null, () => 'T7: cycle ' + c + ' _mapped not nulled');
    }
}

export async function run() {
    const tracker = createLeakTracker({ name: 'bmfont-soak' });

    globalThis.gc();
    const heapBefore = process.memoryUsage().heapUsed;

    // fill() runs in its own frame and RETURNS before the drain, so the last
    // font's stack slot is dead by the time size() is read (frame-liveness).
    fill(tracker);

    // The retention witness. Read ONCE, after fill() returned, after gc() and
    // TWO settle ticks -- FR callbacks fire on a later turn. A leaked font (one
    // retained past destroy()) never fires its FR, so size() stays non-zero.
    globalThis.gc();
    await settle();
    globalThis.gc();
    await settle();
    check(tracker.size() === 0,
        () => 'T7: lite-leak tracker leaked ' + tracker.size() + ' resources');

    // Heap growth: RECORDED, NOT GATED. The min of three (gc, read) samples is
    // the tightest honest number (each gc() can collect residue the last left, so
    // the min can never exceed a lone read at the same point), but it is REPORTED,
    // not asserted. Two reasons, both structural, neither a quiet threshold move:
    //   1. This bound was NEVER a leak witness. F-27's own row records 4096
    //      GENUINELY-retained fonts leaving it GREEN inside 512 KB, because
    //      destroy() nulls the typed arrays and the shells are small. The real
    //      witness is tracker.size() above (it reddens `leaked 4096 resources`).
    //   2. Its only remaining behaviour is spurious failure. Under 24-way
    //      contention a single gate false-REDs 3/120, up to 646.8 KB (26% over) --
    //      the heap genuinely sits above 512 KB at every sample, so min-of-3 does
    //      not rescue it; the growth is contention noise, not a reclaimable
    //      residue. A check that cannot catch its target and fires on healthy code
    //      is negative value, so it is de-gated -- printed like the A11 timing
    //      line, not `die()`d on. Do NOT restore the gate: it was dropped for
    //      cause, not casually.
    let heapAfter = Infinity;
    for (let s = 0; s < 3; s++) {
        globalThis.gc();
        const h = process.memoryUsage().heapUsed;
        if (h < heapAfter) heapAfter = h;
    }
    const grewKB = (heapAfter - heapBefore) / 1024;
    process.stderr.write(
        'torture: RECORDED (T7 heap, not gated; witness is tracker.size(), not this) -- ' +
        'heap grew ' + grewKB.toFixed(1) + ' KB over ' + CYCLES + ' cycles\n');
}
