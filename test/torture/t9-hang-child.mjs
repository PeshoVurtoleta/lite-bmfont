/**
 * T9 control 9 child -- runs drawFast against either the shipped module or a
 * reconstruction of the PRE-DOOR body, out of the parent process so the hang is
 * survivable. Invoked by t9-controls.mjs via spawnSync; never imported.
 *
 *   argv[2] = 'hang' | 'door'
 *   argv[3] = the value as a JS literal string (e.g. 'Number.MAX_VALUE')
 *
 * 'hang': read ../../BitmapFont.js, strip the door line AND the loop bound to
 *         reconstruct the v1.2.1 body, write it to os.tmpdir(), import it, and
 *         call drawFast. With MAX_VALUE this NEVER returns -- value*10 overflows
 *         to Infinity and `while (temp > 0)` never ends. The parent's 2s
 *         spawnSync timeout is the only thing that stops it (SIGTERM).
 * 'door': import ../../BitmapFont.js directly. The door must make it return,
 *         printing calls=<n>.
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

const SRC = new URL('../../BitmapFont.js', import.meta.url);

if (mode === 'door') {
    const { BitmapFont } = await import(SRC.href);
    const font = new BitmapFont({}, JSON_NUM);
    font.drawFast(ctx, value, 0, 0);
    process.stdout.write('calls=' + calls + '\n');
    process.exit(0);
}

if (mode === 'hang') {
    // The two markers whose removal reconstructs the pre-door v1.2.1 body.
    const DOOR = 'if (!(value >= -DRAWFAST_MAX && value <= DRAWFAST_MAX)) return;';
    const BOUND = '} while (temp > 0 && len < buf.length);';

    let src = readFileSync(SRC, 'utf8');

    const doorCount = src.split(DOOR).length - 1;
    if (doorCount !== 1) { process.stderr.write('marker DOOR matched ' + doorCount + ' times\n'); process.exit(3); }
    const boundCount = src.split(BOUND).length - 1;
    if (boundCount !== 1) { process.stderr.write('marker BOUND matched ' + boundCount + ' times\n'); process.exit(3); }

    src = src.replace(DOOR, '// door removed by t9-hang-child (control 9)');
    src = src.replace(BOUND, '} while (temp > 0);');

    const tmp = join(tmpdir(), 'bmfont-nodoor-' + process.pid + '.mjs');
    try {
        writeFileSync(tmp, src);
        const { BitmapFont } = await import('file://' + tmp);
        const font = new BitmapFont({}, JSON_NUM);
        font.drawFast(ctx, value, 0, 0);       // MAX_VALUE never returns from here
        process.stdout.write('calls=' + calls + '\n');   // reached only for in-door values
    } finally {
        try { unlinkSync(tmp); } catch { /* killed mid-hang: tmpdir file, not the package */ }
    }
    process.exit(0);
}

process.stderr.write('unknown mode ' + mode + '\n');
process.exit(2);
