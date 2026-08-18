/**
 * T2 LANE 2 CHILD (F-45, decisions/0006 D-3, M2a). Runs the REAL `computeWrap`
 * out of process -- t2-layout.mjs's run() is synchronous and the peer is ESM, so
 * the parent cannot `await import()` inside a tier. Invoked by spawnSync; never
 * imported.
 *
 * Contract with the parent, by EXIT CODE:
 *   0  -- peer resolved; regenerated rows printed to stdout as JSON
 *         { version, rows: { "0.5": [...], "1": [...], "2": [...] } }.
 *         The parent asserts BYTE-IDENTICAL to the committed fixture and DIES on
 *         any difference, naming both versions.
 *   7  -- peer UNRESOLVABLE (not locally wired). The parent prints a visible
 *         `torture: TODO --` line and exits 0. A silent skip is FORBIDDEN
 *         (risk rank 3): unwired is the state of all of CI, and a swallow would
 *         make the drift guard a no-op everywhere.
 *   3  -- the peer resolved but computeWrap could not be driven the way the
 *         fixture was generated (its surface moved). The parent turns this into
 *         a die() -- the fixture and the child's assumptions have drifted apart
 *         and a human must reconcile them.
 */
import { BitmapFont } from '../../BitmapFont.js';
import { FONT, PARAGRAPH, BOX_WIDTH, LINE_HEIGHT, SCALES } from './fixtures/wrap-lineWidth.mjs';

let TextLayout, VERSION;
try {
    ({ TextLayout, VERSION } = await import('@zakkster/lite-text-layout'));
} catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND') {
        process.stderr.write('peer-unresolved: @zakkster/lite-text-layout\n');
        process.exit(7);
    }
    process.stderr.write('peer-import-failed: ' + (e && e.stack || e) + '\n');
    process.exit(3);
}

if (!TextLayout || typeof TextLayout.computeWrap !== 'function') {
    process.stderr.write('peer resolved but TextLayout.computeWrap is not a function ' +
        '(surface moved; version ' + VERSION + ')\n');
    process.exit(3);
}

try {
    const font = new BitmapFont({}, FONT);
    const rows = {};
    for (const scale of SCALES) {
        const out = new Float32Array(64);
        const n = TextLayout.computeWrap(PARAGRAPH, font, BOX_WIDTH, 0, LINE_HEIGHT, out, scale);
        const r = [];
        for (let l = 0; l < n; l++) r.push([out[l * 4], out[l * 4 + 1], out[l * 4 + 2], out[l * 4 + 3]]);
        rows[String(scale)] = r;
    }
    process.stdout.write(JSON.stringify({ version: VERSION, rows: rows }));
    process.exit(0);
} catch (e) {
    process.stderr.write('computeWrap threw (surface moved): ' + (e && e.stack || e) + '\n');
    process.exit(3);
}
