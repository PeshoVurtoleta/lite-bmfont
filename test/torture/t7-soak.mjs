/**
 * T7 -- soak and retention.
 *
 * 4096 build/draw/destroy cycles. Each cycle constructs a fresh
 * new BitmapFont(ATLAS, JSON_SOAK) -- 200 glyphs, 500 kerning pairs, 134,680
 * bytes of typed array (3584 + 131072 + 24) -- draws a 64-char string, a
 * drawFast value and an 8-line wrapped layout, then destroy()s it. Total churn
 * is 4096 x 134,680 = 551,649,280 bytes (~552 MB).
 *
 * After each cycle destroy() must null every reference (atlas, glyphs, kerning,
 * _charScratch), and a SECOND, independent witness (lite-leak) must return to
 * size 0 -- so a typed-array leak and a JS-object leak cannot hide behind each
 * other. The tracked target is a fresh per-cycle PROXY object with a module-level
 * NOOP cleanup: tracking the font itself, or a cleanup that closes over the font,
 * violates lite-leak's held-value contract and pins the very object it watches.
 *
 * Heap is sampled at cycle boundaries only, after globalThis.gc(), before and
 * after the loop -- intra-cycle churn is never misread as growth.
 */

import { BitmapFont } from '../../BitmapFont.js';
import { createLeakTracker } from '@zakkster/lite-leak';
import {
    rec, resetRec, check, ATLAS, JSON_SOAK, S64, WRAP_TEXT, WRAP_LAYOUT,
} from './harness.mjs';

const CYCLES = 4096;
const NOOP = function () {};             // module scope -- never a closure over target

export function run() {
    const tracker = createLeakTracker({ name: 'bmfont-soak' });

    globalThis.gc();
    const heapBefore = process.memoryUsage().heapUsed;

    for (let c = 0; c < CYCLES; c++) {
        const font = new BitmapFont(ATLAS, JSON_SOAK);

        // Exercise all three draw paths on the fresh font.
        resetRec(ATLAS);
        font.draw(rec, S64, 0, 0, 1, 0);
        font.drawFast(rec, 123.4, 0, 0);
        font.drawWrapped(rec, WRAP_TEXT, WRAP_LAYOUT, 8, 100, 200, 0, 0);
        check(rec.dropped === 0 && rec.imgMismatch === 0,
            () => 'T7: cycle ' + c + ' dropped ' + rec.dropped + ' imgMismatch ' + rec.imgMismatch);

        // Second witness: a fresh proxy object, NOT the font; module-level NOOP.
        const h = tracker.track({ cycle: c }, NOOP, c);

        font.destroy();
        check(font.atlas === null, () => 'T7: cycle ' + c + ' atlas not nulled');
        check(font.glyphs === null, () => 'T7: cycle ' + c + ' glyphs not nulled');
        check(font.kerning === null, () => 'T7: cycle ' + c + ' kerning not nulled');
        check(font._charScratch === null, () => 'T7: cycle ' + c + ' _charScratch not nulled');

        tracker.untrack(h);
    }

    check(tracker.size() === 0,
        () => 'T7: lite-leak tracker leaked ' + tracker.size() + ' resources');

    globalThis.gc();
    const heapAfter = process.memoryUsage().heapUsed;
    const grewKB = (heapAfter - heapBefore) / 1024;
    check(grewKB < 512, () => 'T7: heap grew ' + grewKB.toFixed(1) + ' KB over ' + CYCLES + ' cycles');
}
