/**
 * T9 control 9 child -- runs drawFast against either the shipped module or a
 * reconstruction with the magnitude door removed, out of process so a runaway
 * body is survivable. Invoked by t9-controls.mjs via spawnSync; never imported.
 *
 *   argv[2] = 'corrupt' | 'door'
 *   argv[3] = the value as a JS literal string (e.g. 'Number.MAX_VALUE')
 *
 * WHY THIS IS A CORRUPTION CONTROL, NOT A HANG CONTROL (decisions/0007 fork 6).
 * Before M8b the door prevented a HANG: the old body multiplied `value * 10`,
 * which overflowed to Infinity, and `while (temp > 0)` never ended. M8b DELETED
 * `value * 10`. Every loop in the new body is now bounded by a finite exponent
 * (Number.MAX_VALUE decomposes to e = 971 and RETURNS), so no input hangs it and
 * a hang control would be vacuous. The door's job CHANGED: it now prevents
 * SILENT SCRATCH TRUNCATION. With the door removed, Number.MAX_VALUE returns but
 * fills the shared 24-byte `_charScratch` with a TRUNCATED digit string (its true
 * value has ~309 digits; only 24 fit). The shipped body rejects it at the door
 * and never touches the scratch. That observable difference -- scratch corrupted
 * vs scratch untouched -- is the load-bearing proof of the door.
 *
 * 'corrupt': read ../../BitmapFont.js, strip the door line AND rewrite the
 *            regime-A loop bound (source-integrity markers, A5), write to
 *            os.tmpdir(), import it, fill `_charScratch` with a 255 canary, call
 *            drawFast. The door-removed body RETURNS (no hang) but corrupts the
 *            scratch; print calls, whether the canary was touched, and the
 *            truncated digits it wrote.
 * 'door':    import ../../BitmapFont.js directly, fill `_charScratch` with 255,
 *            call drawFast. The door must reject before the scratch is touched:
 *            print calls=0 touched=0.
 *
 * FAIL-CLOSED MARKER DISCIPLINE. Each marker must match EXACTLY once. A count of
 * 0 or 2 means the source moved under us; the child exits 3 naming the marker
 * rather than silently degrading to testing the shipped body -- which would make
 * the whole control vacuous. The parent turns exit 3 into a die().
 *
 * The recording ctx is a LOCAL nine-named-parameter object; importing harness.mjs
 * would pull the real module into a process whose job is to run a broken one.
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mode = process.argv[2];
const value = Function('return (' + process.argv[3] + ');')();

// JSON_NUM: '.' at x:60 w:4, digit N at x:N*10 w:8. Local, inline.
const chars = [{ id: 46, x: 60, y: 0, width: 4, height: 4, xoffset: 0, yoffset: 12, xadvance: 6 }];
for (let i = 0; i < 10; i++) chars.push({ id: 48 + i, x: i * 10, y: 0, width: 8, height: 14, xoffset: 0, yoffset: 2, xadvance: 10 });
const JSON_NUM = { common: { lineHeight: 20, base: 16 }, chars, kernings: [] };

let calls = 0;
const ctx = { drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) { calls++; } };

// Decode the scratch the way drawFast writes it: buf[0] = decimal digit, buf[1]
// = '.', buf[2..] = integer digits written backwards. A truncated fill decodes
// to a truncated (wrong) number, which is exactly what the door prevents.
function decodeScratch(buf, len) {
    let s = '';
    for (let k = len - 1; k >= 2; k--) s += String.fromCharCode(buf[k]);
    return s + '.' + String.fromCharCode(buf[0]);
}
function scanCanary(buf) {
    for (let k = 0; k < buf.length; k++) if (buf[k] !== 255) return true;
    return false;
}

const SRC = new URL('../../BitmapFont.js', import.meta.url);

if (mode === 'door') {
    const { BitmapFont } = await import(SRC.href);
    const font = new BitmapFont({}, JSON_NUM);
    font._charScratch.fill(255);
    font.drawFast(ctx, value, 0, 0);
    const touched = scanCanary(font._charScratch) ? 1 : 0;
    process.stdout.write('calls=' + calls + ' touched=' + touched + '\n');
    process.exit(0);
}

if (mode === 'corrupt') {
    // Two markers, each verified to match EXACTLY once. Their jobs differ:
    //   DOOR  -- LOAD-BEARING: removed here to let Number.MAX_VALUE into the body.
    //            Its removal is what corrupts the shared scratch (touched 0 -> 1);
    //            restore it and the corruption vanishes (A7).
    //   BOUND -- SOURCE-INTEGRITY ONLY (A5): drawFast's regime-A do..while bound,
    //            anchored on its UNIQUE preceding comment so drawFastInt's and
    //            regime-B's identical `} while` lines are not selected. It is NOT
    //            rewritten -- the earlier rewrite was inert, because MAX_VALUE
    //            takes regime B and never executes this regime-A line (qa G-2).
    //            It stays as a tripwire: renaming `temp` in the regime-A loop
    //            moves its count to 0 and the child exits 3.
    // The regime-B carry backstop (`if (len >= buf.length) return`) is NOT
    // stripped here; the parent's `corrupt` calls===0 assertion is what proves
    // that backstop load-bearing -- drop it in the shipped body and MAX_VALUE
    // draws 24 corrupted glyphs instead of returning (qa G-3).
    const DOOR = 'if (!(value >= -DRAWFAST_MAX && value <= DRAWFAST_MAX)) return;';
    const BOUND =
        '                // do..while: a plain while renders ".0" for value 0.\n' +
        '            } while (temp > 0 && len < buf.length);';

    let src = readFileSync(SRC, 'utf8');

    const doorCount = src.split(DOOR).length - 1;
    if (doorCount !== 1) { process.stderr.write('marker DOOR matched ' + doorCount + ' times\n'); process.exit(3); }
    const boundCount = src.split(BOUND).length - 1;
    if (boundCount !== 1) { process.stderr.write('marker BOUND matched ' + boundCount + ' times\n'); process.exit(3); }

    // BOUND is verified above but deliberately NOT rewritten (see the marker
    // note): its rewrite is inert on MAX_VALUE's regime-B path. Only the DOOR is
    // removed -- that is the load-bearing change this control makes.
    src = src.replace(DOOR, '// door removed by t9-hang-child (control 9)');

    const tmp = join(tmpdir(), 'bmfont-nodoor-' + process.pid + '.mjs');
    try {
        writeFileSync(tmp, src);
        const { BitmapFont } = await import('file://' + tmp);
        const font = new BitmapFont({}, JSON_NUM);
        font._charScratch.fill(255);
        font.drawFast(ctx, value, 0, 0);   // RETURNS (no hang); scratch corrupted
        const touched = scanCanary(font._charScratch) ? 1 : 0;
        const digits = decodeScratch(font._charScratch, font._charScratch.length);
        process.stdout.write('calls=' + calls + ' touched=' + touched + ' digits=' + digits + '\n');
    } finally {
        try { unlinkSync(tmp); } catch { /* tmpdir file, not the package */ }
    }
    process.exit(0);
}

process.stderr.write('unknown mode ' + mode + '\n');
process.exit(2);
