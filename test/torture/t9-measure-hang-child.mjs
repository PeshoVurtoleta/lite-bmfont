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

// ---- METHOD-SCOPED PATCHING (M5, 1.9.0) ------------------------------------
// These markers used to be GLOBALLY unique, and two of them stopped being so
// the moment `layoutGlyphs` landed: it reproduces `draw`'s arithmetic exactly,
// so it carries a byte-identical copy of the per-line-Y line AND a fourth copy
// of the measure family's text door. Both duplications are correct and must
// not be "deduplicated" -- a shared helper would be a call in a hot body.
//
// So the markers are scoped to ONE METHOD BODY instead of being assumed unique
// across the file. `expected` stays 1 no matter how many other faces
// legitimately copy the line, and the control still mutates the body it claims
// to mutate.
//
// DO NOT fix a future collision by raising `expected` -- that patches every
// copy, so the control no longer tests what it names. DO NOT take the first
// match either: that is position-dependent and silently re-breaks the day
// someone reorders methods. Scope it, and keep the exact-count check, because
// refusing to test a body it cannot uniquely reconstruct is this control's
// whole value.

/**
 * Character range of ONE method body, by the same `^    name(` .. `^    }`
 * extraction the A11 body-sha freeze uses. Null if it cannot be recovered.
 */
function methodRange(src, method) {
    const open = new RegExp('^    ' + method + '\\(', 'm');
    const m = open.exec(src);
    if (!m) return null;
    const CLOSE = '\n    }\n';
    const close = src.indexOf(CLOSE, m.index);
    if (close === -1) return null;
    return [m.index, close + CLOSE.length];
}

/** Apply one replacement INSIDE a single named method body. */
function patchInMethod(src, method, marker, replacement, expected, name) {
    const r = methodRange(src, method);
    if (r === null) {
        process.stderr.write('method range for ' + method + ' could not be recovered\n');
        process.exit(3);
    }
    const patched = patch(src.slice(r[0], r[1]), marker, replacement, expected,
        name + ' (scoped to ' + method + ')');
    return src.slice(0, r[0]) + patched + src.slice(r[1]);
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

async function load(marker, replacement, expected, name, methods) {
    if (marker === null) {
        const m = await import(SRC.href);
        return m.BitmapFont;
    }
    let src = readFileSync(SRC, 'utf8');
    if (methods) {
        // Scoped: applied to EACH named method, expecting `expected` hits in
        // each. Patching every member of the family is deliberate -- it is what
        // proves they all carry the identical door -- but each is now counted
        // in its own body, so a new face elsewhere cannot silently absorb the
        // count (M5).
        for (const method of methods) {
            src = patchInMethod(src, method, marker, replacement, expected, name);
        }
    } else {
        src = patch(src, marker, replacement, expected, name);
    }
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
    // layoutGlyphs (M5) carries the SAME text door and must answer HANGY with NaN
    // in O(1), out of process -- the in-process boundary test cannot prove
    // termination (a synchronous hang blocks the event loop and no per-test
    // timeout can interrupt it), which is why this control exists.
    const e = f.layoutGlyphs(HANGY, new Float64Array(64), 0, 0, 1, 0);
    // Returning is not sufficient: the VALUE must be the one the door promises.
    if (a !== 32) die('measureLine(-Inf,Inf) returned ' + a + ', expected 32');
    if (!Number.isNaN(b)) die('measure(array-like) returned ' + b + ', expected NaN');
    if (!Number.isNaN(c)) die('measureWidest(array-like) returned ' + c + ', expected NaN');
    if (!Number.isNaN(e)) die('layoutGlyphs(array-like) returned ' + e + ', expected NaN');
    // F-38: 32, not 0. A NaN pair clamps to the WHOLE line -- NaN start to 0,
    // NaN end to len -- which is what drawWrapped renders for the same pair. A 0
    // here means an `end >= 0` leg is back in the door.
    if (d !== 32) die('measureLine(NaN,NaN) returned ' + d + ', expected 32 (F-38)');
    process.stdout.write(JSON.stringify({
        mode, a, b: String(b), c: String(c), d, e: String(e),
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
    // 2.0.0 (F-06, decisions/0012 fork 2): `measure` is now a doorless one-line
    // delegate to `measureWidest`, so the TEXT_DOOR predicate lives ONLY in
    // measureWidest and measureLine. Patch those two (one hit each) and call
    // through the delegate: measure(HANGY) -> measureWidest with no door -> the
    // walk hangs on the Infinity-length array-like. Including `measure` here
    // would expect a door it no longer carries and mis-reconstruct the body.
    const BitmapFont = await load(TEXT_DOOR, '        // text door removed by t9 control 13 self-test\n', 1, 'TEXT_DOOR',
        ['measureWidest', 'measureLine']);
    const f = new BitmapFont({}, JSON_SNAP);
    const b = f.measure(HANGY);                                 // never returns (via delegate)
    process.stdout.write(JSON.stringify({ mode, b: String(b) }) + '\n');
    process.exit(0);
}

if (mode === 'notext-layout') {
    // M5: strip layoutGlyphs's text door and prove the walk then HANGS on the
    // array-like -- the door-removed twin of the shipped `door` lane above. Same
    // TEXT_DOOR marker (layoutGlyphs carries the identical predicate), scoped to
    // layoutGlyphs alone so the count stays 1.
    const BitmapFont = await load(TEXT_DOOR, '        // text door removed by t9 control 13 self-test\n', 1, 'TEXT_DOOR',
        ['layoutGlyphs']);
    const f = new BitmapFont({}, JSON_SNAP);
    const n = f.layoutGlyphs(HANGY, new Float64Array(64), 0, 0, 1, 0);   // never returns
    process.stdout.write(JSON.stringify({ mode, n }) + '\n');
    process.exit(0);
}

if (mode === 'aform' || mode === 'b2form') {
    const repl = mode === 'aform'
        ? '                cursorY = Math.round(cursorY + step);'
        : '                cursorY = Math.round(y + ++lineIndex * step);';
    const BitmapFont = await load(PER_LINE, repl, 1, 'PER_LINE', ['draw']);
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
