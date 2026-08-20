/**
 * @zakkster/lite-bmfont -- torture gate.
 *
 * The DONE-WHEN of every session is a single command:
 *
 *     node --expose-gc test/torture.mjs        -> prints exactly "ok", exit 0
 *     npm run torture
 *
 * Ten tiers share one shape (ROADMAP section 3). Wired so far:
 *
 *     T0  conservation law (M2)     T1  degenerate sweep (M0)
 *     T2  layout-buffer matrix (M2) T3  descriptor door (M3)
 *     T4  numeric door + oracle (M1) T5  reference-renderer fuzz (M4)
 *     T6  the zero-alloc gate (M0)  T7  soak + retention (M0)
 *     T8  packaging + docs-drift (M7)
 *     T9  controls (must be able to fail, M0/M4)
 *
 * T8 (packaging / docs-drift, M7) is FILLED: pack contents, a DOM-free import of
 * both entry points through the exports map in a clean child, and the docs-drift
 * guard. Every registered tier now does real work, so the run carries ZERO TODO
 * lines.
 *
 * lite-gc-profiler is one-measurement-at-a-time, so tiers run STRICTLY
 * SEQUENTIALLY -- never nested, never concurrent.
 *
 * Controls: `BMFONT_TORTURE_BREAK=1 node --expose-gc test/torture.mjs` injects
 * retained allocations into the T6 hot loop and must exit non-zero. Reaching the
 * end of the run with BREAK set is itself a failure (the post-loop guard). A gate
 * that cannot fail is decorative.
 *
 * Peers (lite-gc-profiler, lite-leak) are devDependencies only. BitmapFont.js has
 * zero runtime dependencies.
 *
 * @license MIT
 */

import { SEED, BREAK } from './torture/harness.mjs';
import { run as t0 } from './torture/t0-laws.mjs';
import { run as t1 } from './torture/t1-degenerate.mjs';
import { run as t2 } from './torture/t2-layout.mjs';
import { run as t3 } from './torture/t3-descriptor.mjs';
import { run as t4 } from './torture/t4-numeric.mjs';
import { run as t5 } from './torture/t5-fuzz.mjs';
import { run as t6 } from './torture/t6-alloc.mjs';
import { run as t7 } from './torture/t7-soak.mjs';
import { run as t8 } from './torture/t8-packaging.mjs';
import { run as t9 } from './torture/t9-controls.mjs';

const TIERS = [
    ['T0 laws', t0],
    ['T1 degenerate', t1],
    ['T2 layout', t2],
    ['T3 descriptor', t3],
    ['T4 numeric', t4],
    ['T5 fuzz', t5],
    ['T6 alloc', t6],
    ['T7 soak', t7],
    ['T8 packaging', t8],
    ['T9 controls', t9],
];

async function main() {
    if (typeof globalThis.gc !== 'function') {
        process.stderr.write(
            'torture: FAIL -- run with --expose-gc:  node --expose-gc test/torture.mjs\n');
        process.exit(1);
    }

    for (const [name, run] of TIERS) {
        try {
            // AWAIT, not call-and-forget (M9pre / F-27). A sync tier returns
            // undefined and `await undefined` is a no-op, so the sync tiers are
            // unaffected; T7 is async because its retention witness reads
            // tracker.size() only AFTER a FinalizationRegistry settle tick, and
            // FR callbacks fire on a later turn -- a sync read cannot see them.
            await run();
        } catch (err) {
            // Tiers normally fail via die() (which exits). A thrown error is an
            // unexpected fault -- surface it with the replay seed and stop.
            process.stderr.write(
                'torture: FAIL -- ' + name + ' threw: ' + (err && err.stack || err) +
                '\n  replay: TORTURE_SEED=' + SEED + ' node --expose-gc test/torture.mjs\n');
            process.exit(1);
        }
    }

    // Reaching here in BREAK mode means T6's control did not trip -- a fault.
    if (BREAK) {
        process.stderr.write('torture: FAIL -- BMFONT_TORTURE_BREAK set but the gate still passed\n');
        process.exit(1);
    }

    process.stdout.write('ok\n');
    process.exit(0);
}

main().catch((err) => {
    process.stderr.write('torture: FAIL -- main rejected: ' + (err && err.stack || err) + '\n');
    process.exit(1);
});
