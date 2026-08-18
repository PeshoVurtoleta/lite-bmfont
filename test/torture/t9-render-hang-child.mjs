/**
 * T9 controls 14 and 15 child (M4a) -- runs the RENDERERS against either the
 * SHIPPED module or a reconstruction with one text door removed, out of the
 * parent process so a non-terminating body is survivable. Invoked by
 * t9-controls.mjs via spawnSync; never imported.
 *
 *   argv[2] = 'door' | 'nodraw' | 'nowrap'
 *
 * 'door'   -- import ../../BitmapFont.js directly. Every call must RETURN, and
 *             every recorded call count is CHECKED -- returning is necessary and
 *             NOT sufficient (F-42). Prints one JSON line and exits 0; exits 4
 *             via die() on any wrong count.
 * 'nodraw' -- strip draw's `typeof text !== 'string'` door ONLY (DRAW_DOOR,
 *             expected 1). draw(ctx, HANGY, ...) then never returns: `len` is
 *             Infinity and the line scan `while (lineEnd < len ...)` never ends.
 *             The parent's 2 s spawnSync timeout is the only thing that stops it.
 *             CONTROL 14's SELF-TEST: if this child also exits 0 the watchdog is
 *             not watching and the control is decorative (ROADMAP law 8).
 * 'nowrap' -- strip drawWrapped's door ONLY (WRAP_DOOR, expected 1).
 *             drawWrapped(ctx, HANGY, WRAP_BUF, 1, ...) then never returns:
 *             `tlen` is Infinity, the F-04 clamp `!(endIdx <= tlen)` PASSES an
 *             Infinity endIdx straight through, and the glyph walk never ends.
 *             CONTROL 15's SELF-TEST.
 *
 * A NEW child, NOT new modes on t9-measure-hang-child.mjs: that file's
 * TEXT_DOOR marker is calibrated to the measure family (`return NaN;`, exactly
 * 3), and the renderer doors are a DIFFERENT string (`return;`). Two door counts
 * in one marker budget is how a coder's mistake in one silently changes the
 * expectation for the other.
 *
 * FAIL-CLOSED MARKER DISCIPLINE, inherited from t9-measure-hang-child.mjs. Each
 * marker must match an EXACT expected count. A different count means the source
 * moved under us; the child exits 3 naming the marker rather than silently
 * degrading to testing the shipped body. The parent turns exit 3 into a die().
 *
 * The recording ctx is a LOCAL nine-named-parameter object and the fixture is
 * built inline: importing harness.mjs would pull the real module into a process
 * whose job may be to run a broken one, and would make a failure ambiguous.
 *
 * @license MIT
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mode = process.argv[2];
const SRC = new URL('../../BitmapFont.js', import.meta.url);

// JSON_SNAP, inline: advance 8, lineHeight 17, base 16.
const chars = [];
for (let id = 32; id <= 126; id++) {
    if (id === 32) chars.push({ id: 32, x: 0, y: 0, width: 0, height: 0, xoffset: 0, yoffset: 0, xadvance: 8 });
    else chars.push({ id, x: (id - 32) * 8, y: 0, width: 8, height: 14, xoffset: 0, yoffset: 2, xadvance: 8 });
}
const JSON_SNAP = { common: { lineHeight: 17, base: 16 }, chars, kernings: [] };

let calls = 0;
const ctx = {
    drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) { calls++; },
};

function die(msg) {
    process.stderr.write('t9-render-hang-child: ' + msg + '\n');
    process.exit(4);
}

/** Read the source, apply one replacement with an exact expected match count. */
function patch(src, marker, replacement, expected, name) {
    const count = src.split(marker).length - 1;
    if (count !== expected) {
        process.stderr.write('marker ' + name + ' matched ' + count + ' times, expected ' + expected + '\n');
        process.exit(3);
    }
    return src.split(marker).join(replacement);
}

// The two renderer doors, each as a MULTI-LINE marker that includes the lines
// that DIFFER between the bodies so a single door can be stripped at a time. The
// door string alone matches 2 (both bodies); these markers each match exactly 1.
// Re-read from the working tree if the door or the line after it moves.
const DRAW_DOOR =
    "        if (typeof text !== 'string') return;\n" +
    "        if (!(scale > 0 && scale < Infinity)) return;\n" +
    "        const len = text.length;\n";
const DRAW_NODOOR =
    "        if (!(scale > 0 && scale < Infinity)) return;\n" +
    "        const len = text.length;\n";
const WRAP_DOOR =
    "        if (typeof text !== 'string') return;\n" +
    "        if (!(scale > 0 && scale < Infinity)) return;\n" +
    "        // F-05 / the lineCount degenerates.";
const WRAP_NODOOR =
    "        if (!(scale > 0 && scale < Infinity)) return;\n" +
    "        // F-05 / the lineCount degenerates.";

// One line, endIdx Infinity -- the shape the F-04 clamp passes through when
// tlen is Infinity (PROBE's WRAP_BUF).
const WRAP_BUF = Float32Array.of(0, Infinity, 8, 0);
const HANGY = { length: Infinity, charCodeAt() { return 65; } };

async function load(marker, replacement, expected, name) {
    if (marker === null) {
        const m = await import(SRC.href);
        return m.BitmapFont;
    }
    const src = patch(readFileSync(SRC, 'utf8'), marker, replacement, expected, name);
    const tmp = join(tmpdir(), 'bmfont-m4a-' + name + '-' + process.pid + '.mjs');
    try {
        writeFileSync(tmp, src);
        const m = await import('file://' + tmp);
        return m.BitmapFont;
    } finally {
        try { unlinkSync(tmp); } catch { /* killed mid-hang: tmpdir file, not the package */ }
    }
}

if (mode === 'door') {
    const BitmapFont = await load(null);
    const f = new BitmapFont({}, JSON_SNAP);
    // Each call must RETURN and draw the CHECKED number of quads.
    calls = 0; f.draw(ctx, HANGY, 0, 0, 1, 0);
    const hangDraw = calls;
    calls = 0; f.drawWrapped(ctx, HANGY, WRAP_BUF, 1, 100, 100, 0, 0, 1, 0, 0);
    const hangWrap = calls;
    calls = 0; f.draw(ctx, new String('A'), 0, 0);
    const boxed = calls;
    calls = 0; f.draw(ctx, null, 0, 0);            // must NOT throw, must draw 0
    const nullish = calls;
    calls = 0; f.draw(ctx, 'A', 0, 0);             // NON-VACUITY: must draw 1
    const real = calls;
    if (hangDraw !== 0) die('draw(HANGY) drew ' + hangDraw + ', expected 0');
    if (hangWrap !== 0) die('drawWrapped(HANGY) drew ' + hangWrap + ', expected 0');
    if (boxed !== 0) die('draw(new String("A")) drew ' + boxed + ', expected 0');
    if (nullish !== 0) die('draw(null) drew ' + nullish + ', expected 0');
    if (real !== 1) die('draw("A") drew ' + real + ', expected 1 (the door rejects real strings)');
    process.stdout.write(JSON.stringify({ mode, hangDraw, hangWrap, boxed, nullish, real }) + '\n');
    process.exit(0);
}

if (mode === 'nodraw') {
    const BitmapFont = await load(DRAW_DOOR, DRAW_NODOOR, 1, 'DRAW_DOOR');
    const f = new BitmapFont({}, JSON_SNAP);
    f.draw(ctx, HANGY, 0, 0, 1, 0);                // never returns
    process.stdout.write(JSON.stringify({ mode, calls }) + '\n');
    process.exit(0);
}

if (mode === 'nowrap') {
    const BitmapFont = await load(WRAP_DOOR, WRAP_NODOOR, 1, 'WRAP_DOOR');
    const f = new BitmapFont({}, JSON_SNAP);
    f.drawWrapped(ctx, HANGY, WRAP_BUF, 1, 100, 100, 0, 0, 1, 0, 0);   // never returns
    process.stdout.write(JSON.stringify({ mode, calls }) + '\n');
    process.exit(0);
}

process.stderr.write('unknown mode ' + mode + '\n');
process.exit(2);
