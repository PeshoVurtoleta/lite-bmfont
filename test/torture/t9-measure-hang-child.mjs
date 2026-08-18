/**
 * T9 controls 11, 12 and 13 child (M4) -- runs the measure family and `draw`
 * against either the SHIPPED module or a reconstruction of a rejected variant,
 * out of the parent process so a non-terminating body is survivable. Invoked by
 * t9-controls.mjs via spawnSync; never imported.
 *
 *   argv[2] = 'door' | 'nodoor' | 'notext' | 'aform' | 'b2form'
 *
 * 'door'   -- import ../../BitmapFont.js directly. Every call must RETURN, and
 *             must return the value the door promises. Prints a JSON line.
 * 'nodoor' -- strip measureLine's range door. `measureLine('AAAA', -Infinity,
 *             Infinity, 1)` then reaches `_measureRange`, whose `i++` never
 *             advances from -Infinity, and NEVER RETURNS. The parent's 2 s
 *             spawnSync timeout is the only thing that stops it. This is control
 *             13's SELF-TEST: if this child also exits 0, the watchdog is not
 *             watching and the control is decorative.
 * 'notext' -- strip all three `typeof text !== 'string'` doors. `measure` on an
 *             object with a numeric length and a charCodeAt then hangs -- the
 *             second self-test, and the one that proves an "array-like" text
 *             door would have been the wrong generalisation.
 * 'aform'  -- rebuild `draw`'s per-line Y as decisions/0004 fork (2) option A,
 *             `cursorY = Math.round(cursorY + step)` (accumulate-rounded).
 *             CONTROL 11: its five baselines must DIFFER from the shipped ones.
 * 'b2form' -- rebuild it as sub-fork B2, `Math.round(y + i * step)`.
 *             CONTROL 12: its baselines must MATCH the shipped ones at y = 0 and
 *             DIFFER at y = 0.6. Both halves are asserted; the second is the
 *             whole reason the fractional-y row exists.
 *
 * FAIL-CLOSED MARKER DISCIPLINE, inherited verbatim from t9-hang-child.mjs. Each
 * marker must match an EXACT expected number of times. A different count means
 * the source moved under us; the child exits 3 naming the marker rather than
 * silently degrading to testing the shipped body -- which would make the whole
 * control vacuous. The parent turns exit 3 into a die().
 *
 * RETURNING IS NECESSARY AND NOT SUFFICIENT. A call that returns the WRONG value
 * is also a failure and must not be reported as a pass merely because the
 * process ended, so 'door' checks every value and exits non-zero on a mismatch.
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
const dyCol = new Float64Array(64);
const ctx = {
    drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) {
        if (calls < 64) dyCol[calls] = dy;
        calls++;
    },
};

/** Recover the integer baseline from a recorded dy (yoffset 2, base 16). */
function baselines(font, text, y, scale) {
    calls = 0;
    font.draw(ctx, text, 0, y, scale, 0);
    const out = [];
    for (let i = 0; i < calls; i++) out.push(Math.round(dyCol[i] - (2 * scale - 16 * scale)));
    return out;
}

function die(msg) {
    process.stderr.write('t9-measure-hang-child: ' + msg + '\n');
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

// The fork (3) range door: CLAMP-ONLY (F-35, it deliberately does not truncate,
// because drawWrapped does not either) and TWO-LEG (F-38, there is no
// `!(end >= 0)` leg, because drawWrapped has none and a NaN end must reach
// `len`). If either property is ever undone, this marker stops matching and the
// child exits 3, which the parent turns into a die() naming the marker. That is
// the intended behaviour: the control refuses to test a body it can no longer
// reconstruct, rather than silently testing the shipped one.
const RANGE_DOOR =
    '        if (!(start >= 0)) start = 0;\n' +
    '        if (!(start <= len)) start = len;\n' +
    '        if (!(end <= len)) end = len;\n' +
    '        if (!(end > start)) return 0;\n';
const TEXT_DOOR = "        if (typeof text !== 'string') return NaN;\n";
const PER_LINE = '                cursorY = anchorY + Math.round(++lineIndex * step);';

async function load(marker, replacement, expected, name) {
    if (marker === null) {
        const m = await import(SRC.href);
        return m.BitmapFont;
    }
    const src = patch(readFileSync(SRC, 'utf8'), marker, replacement, expected, name);
    const tmp = join(tmpdir(), 'bmfont-m4-' + name + '-' + process.pid + '.mjs');
    try {
        writeFileSync(tmp, src);
        const m = await import('file://' + tmp);
        return m.BitmapFont;
    } finally {
        try { unlinkSync(tmp); } catch { /* killed mid-hang: tmpdir file, not the package */ }
    }
}

const HANGY = { length: Infinity, charCodeAt() { return 65; } };

if (mode === 'door') {
    const BitmapFont = await load(null);
    const f = new BitmapFont({}, JSON_SNAP);
    // Every call the F-34 boundary must survive, in the order the plan lists.
    const a = f.measureLine('AAAA', -Infinity, Infinity, 1);
    const b = f.measure(HANGY);
    const c = f.measureWidest(HANGY);
    const d = f.measureLine('AAAA', NaN, NaN, 1);
    // Returning is not sufficient: the VALUE must be the one the door promises.
    if (a !== 32) die('measureLine(-Inf,Inf) returned ' + a + ', expected 32');
    if (!Number.isNaN(b)) die('measure(array-like) returned ' + b + ', expected NaN');
    if (!Number.isNaN(c)) die('measureWidest(array-like) returned ' + c + ', expected NaN');
    // F-38: 32, not 0. A NaN pair clamps to the WHOLE line -- NaN start to 0,
    // NaN end to len -- which is what drawWrapped renders for the same pair. A 0
    // here means an `end >= 0` leg is back in the door.
    if (d !== 32) die('measureLine(NaN,NaN) returned ' + d + ', expected 32 (F-38)');
    process.stdout.write(JSON.stringify({
        mode, a, b: String(b), c: String(c), d,
        y0: baselines(f, 'A\nB\nC\nD\nE', 0, 1.1),
        y06: baselines(f, 'A\nB\nC\nD\nE', 0.6, 1.1),
    }) + '\n');
    process.exit(0);
}

if (mode === 'nodoor') {
    const BitmapFont = await load(RANGE_DOOR, '        // range door removed by t9 control 13 self-test\n', 1, 'RANGE_DOOR');
    const f = new BitmapFont({}, JSON_SNAP);
    const a = f.measureLine('AAAA', -Infinity, Infinity, 1);   // never returns
    process.stdout.write(JSON.stringify({ mode, a }) + '\n');
    process.exit(0);
}

if (mode === 'notext') {
    const BitmapFont = await load(TEXT_DOOR, '        // text door removed by t9 control 13 self-test\n', 3, 'TEXT_DOOR');
    const f = new BitmapFont({}, JSON_SNAP);
    const b = f.measure(HANGY);                                 // never returns
    process.stdout.write(JSON.stringify({ mode, b: String(b) }) + '\n');
    process.exit(0);
}

if (mode === 'aform' || mode === 'b2form') {
    const repl = mode === 'aform'
        ? '                cursorY = Math.round(cursorY + step);'
        : '                cursorY = Math.round(y + ++lineIndex * step);';
    const BitmapFont = await load(PER_LINE, repl, 1, 'PER_LINE');
    const f = new BitmapFont({}, JSON_SNAP);
    process.stdout.write(JSON.stringify({
        mode,
        y0: baselines(f, 'A\nB\nC\nD\nE', 0, 1.1),
        y06: baselines(f, 'A\nB\nC\nD\nE', 0.6, 1.1),
    }) + '\n');
    process.exit(0);
}

process.stderr.write('unknown mode ' + mode + '\n');
process.exit(2);
