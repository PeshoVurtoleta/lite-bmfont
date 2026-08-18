/**
 * T9 control 16 child (M8) -- the shared-scratch re-entrancy contract, run out
 * of process. Invoked by t9-controls.mjs via spawnSync; never imported.
 *
 *   argv[2] = 'clean' | 'reenter'
 *
 * 'clean'   -- a plain 9-arg recording ctx. Calls drawFastInt(ctx, 12345, 0, 0)
 *              and prints {mode, calls, glyphs}. glyphs MUST be "12345", calls 5.
 *              This is the NON-VACUITY twin: a ctx that records nothing would
 *              pass every corruption check trivially, so the parent proves the
 *              recording path works before trusting the corruption in 'reenter'.
 * 'reenter' -- a ctx whose drawImage, on its FIRST invocation ONLY (a depth
 *              guard, so the recursion terminates in exactly one nested call),
 *              calls font.drawFastInt(this, 99, 0, 0) BEFORE recording. The inner
 *              call overwrites the shared 24-byte _charScratch mid-render, so the
 *              OUTER call's remaining digits are read back corrupted. Prints
 *              {mode, outerGlyphs, innerGlyphs}. innerGlyphs proves the nested
 *              call HAPPENED; outerGlyphs !== "12345" proves the corruption.
 *
 * WHY OUT OF PROCESS: the re-entrant ctx deliberately corrupts a shared buffer
 * and recurses; a child process makes the blast radius exactly one process and
 * cannot leave _charScratch dirty for a later tier.
 *
 * NEVER imports harness.mjs: a control's job may be to run a hostile ctx, and
 * pulling the real module's fixtures in is how a control starts testing the
 * wrong thing. Inline fixture, local ctx. No source patching, so no markers and
 * no exit-3 lane. The child ASSERTS NOTHING -- it reports; the parent decides.
 *
 * @license MIT
 */
import { BitmapFont } from '../../BitmapFont.js';

const mode = process.argv[2];

// Inline digits '0'-'9' (id 48+i at x = i*10, width 8, advance 10). No '.' --
// drawFastInt never emits one. A drawn glyph decodes as 48 + sx/10.
const chars = [];
for (let i = 0; i < 10; i++) {
    chars.push({ id: 48 + i, x: i * 10, y: 0, width: 8, height: 14, xoffset: 0, yoffset: 2, xadvance: 10 });
}
const font = new BitmapFont({}, { common: { lineHeight: 20, base: 16 }, chars, kernings: [] });

const decode = (sx) => String.fromCharCode(48 + sx / 10);

if (mode === 'clean') {
    let glyphs = '';
    let calls = 0;
    const ctx = {
        drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) { calls++; glyphs += decode(sx); },
    };
    font.drawFastInt(ctx, 12345, 0, 0);
    process.stdout.write(JSON.stringify({ mode, calls, glyphs }) + '\n');
    process.exit(0);
}

if (mode === 'reenter') {
    let entered = false;          // depth guard: re-enter exactly once
    let recordingInner = false;
    let innerGlyphs = '';
    let outerGlyphs = '';
    const ctx = {
        drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) {
            if (!entered) {
                entered = true;
                recordingInner = true;
                font.drawFastInt(this, 99, 0, 0);   // the ONE nested call
                recordingInner = false;
            }
            if (recordingInner) innerGlyphs += decode(sx);
            else outerGlyphs += decode(sx);
        },
    };
    font.drawFastInt(ctx, 12345, 0, 0);
    process.stdout.write(JSON.stringify({ mode, outerGlyphs, innerGlyphs }) + '\n');
    process.exit(0);
}

process.stderr.write('unknown mode ' + mode + '\n');
process.exit(2);
