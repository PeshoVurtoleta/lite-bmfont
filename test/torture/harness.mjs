/**
 * @zakkster/lite-bmfont -- torture harness.
 *
 * One shared recording Canvas2D ctx, the seeded PRNG, the fixed test fonts,
 * the advance oracle, and the two lite-gc-profiler gate wrappers. Every tier
 * AND the node:test file import from here so the discipline lives in one place.
 *
 * Four rules that bite (ROADMAP section 3):
 *   1. All scratch (fonts, layout buffers, strings, the ctx) is allocated ONCE,
 *      at module scope or the top of run(), OUTSIDE every loop.
 *   2. `check()` builds its message only on failure -- a template literal per
 *      iteration is an allocation and would fail the T6 gate.
 *   3. GC/alloc measurement is one-at-a-time; tiers run STRICTLY SEQUENTIALLY.
 *   4. The recording ctx.drawImage takes NINE NAMED PARAMETERS, never a rest
 *      parameter -- a rest array allocates per glyph and would report megabytes
 *      per frame against a library that allocates nothing (T9 control 2).
 *
 * Section 0 surface corrections (verified against the INSTALLED profiler
 * v1.15.0, Gc.d.ts):
 *   - measureAllocs opts are { iterations, batches }; maxBytesPerCall is a
 *     checkAllocs RULE, never a measureAllocs option (a silently-blind gate).
 *   - checkNoGc throws TypeError on unknown rule keys; RULES carries only
 *     maxMajor / maxPauseMs / maxArrayBuffersGrowth. maxArrayBuffersGrowth is
 *     inconclusive without measureOps stabilize:'deep'.
 *
 * @license MIT
 */

import { measureOps, checkNoGc, measureAllocs, checkAllocs } from '@zakkster/lite-gc-profiler';
import { BitmapFont } from '../../BitmapFont.js';

/** Seed for every PRNG in the run. Override with TORTURE_SEED for replay. */
export const SEED = (() => {
    const raw = process.env.TORTURE_SEED;
    if (raw === undefined) return 0x9e3779b9;
    const n = Number(raw) >>> 0;
    return n === 0 ? 1 : n;                 // xorshift32 must not be seeded with 0
})();

/** Deliberately-broken control mode: injects a retained allocation into the T6 hot body. */
export const BREAK = process.env.BMFONT_TORTURE_BREAK === '1';

/** checkNoGc rules. maxArrayBuffersGrowth requires measureOps stabilize:'deep'. */
export const RULES = { maxMajor: 0, maxPauseMs: 4, maxArrayBuffersGrowth: 0 };

/** checkAllocs rules. The literal form of the README's zero-allocation claim. */
export const ALLOC_RULES = { maxBytesPerCall: 0 };

/** Recording-ctx column capacity. */
export const CAP = 4096;

/** Seeded xorshift32. Returns a function yielding a uint32 each call. */
export function makePrng(seed) {
    let x = (seed >>> 0) || 1;
    return function next() {
        x ^= x << 13; x >>>= 0;
        x ^= x >> 17;
        x ^= x << 5; x >>>= 0;
        return x >>> 0;
    };
}

/** Fail the whole gate. stdout stays clean; the reason goes to stderr. */
export function die(msg) {
    process.stderr.write('torture: FAIL -- ' + msg + '\n');
    process.exit(1);
}

/**
 * Assertion whose message is built ONLY on failure. Pass a thunk, not a string,
 * so the happy path allocates nothing.
 * @param {boolean} cond
 * @param {() => string} msgThunk
 */
export function check(cond, msgThunk) { if (!cond) die(msgThunk()); }

/**
 * THE recording Canvas2D context. One object for the entire suite -- every tier
 * and the node:test file share it, so draw()'s single ctx.drawImage call site
 * stays monomorphic and the numbers describe a real app.
 *
 * drawImage takes NINE NAMED PARAMETERS. Never a rest parameter: drawImage(...args)
 * allocates an array per glyph and would report megabytes per frame against a
 * library that allocates nothing. T9 control 2 proves that is not folklore.
 */
export const rec = {
    sx: new Float64Array(CAP),
    sy: new Float64Array(CAP),
    sw: new Float64Array(CAP),
    sh: new Float64Array(CAP),
    dx: new Float64Array(CAP),
    dy: new Float64Array(CAP),
    dw: new Float64Array(CAP),
    dh: new Float64Array(CAP),

    calls: 0,          // write index into the columns. Reset by `rec.calls = 0`.
    total: 0,          // monotonic call count, for conservation assertions
    dropped: 0,        // incremented when calls >= CAP. Every tier asserts === 0.
    imgMismatch: 0,    // incremented when img !== expected
    expected: null,    // the atlas identity every call must carry

    drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) {
        const i = this.calls;
        this.total++;
        if (img !== this.expected) this.imgMismatch++;
        if (i >= CAP) { this.dropped++; return; }
        this.sx[i] = sx; this.sy[i] = sy; this.sw[i] = sw; this.sh[i] = sh;
        this.dx[i] = dx; this.dy[i] = dy; this.dw[i] = dw; this.dh[i] = dh;
        this.calls = i + 1;
    },
};
Object.seal(rec);   // SEAL, not freeze: shape is fixed, counters must stay writable

/**
 * Reset the recording window. Sets the expected atlas identity, clears the write
 * index and the two fault counters. Does NOT clear `total` -- that is monotonic
 * by contract and cleared only by resetTotals().
 */
export function resetRec(expectedAtlas) {
    rec.expected = expectedAtlas === undefined ? null : expectedAtlas;
    rec.calls = 0;
    rec.dropped = 0;
    rec.imgMismatch = 0;
}

/** Clear the monotonic counter. Called immediately before a measured window. */
export function resetTotals() { rec.total = 0; }

/**
 * Post-window NaN scan over [0, calls) across all eight columns. Returns the
 * count. Source columns come out of an Int16Array and cannot be NaN, so a hit
 * there means the HARNESS is corrupt -- which is worth knowing for free.
 */
export function nanScan() {
    let n = 0;
    for (let i = 0; i < rec.calls; i++) {
        if (rec.sx[i] !== rec.sx[i]) n++;
        if (rec.sy[i] !== rec.sy[i]) n++;
        if (rec.sw[i] !== rec.sw[i]) n++;
        if (rec.sh[i] !== rec.sh[i]) n++;
        if (rec.dx[i] !== rec.dx[i]) n++;
        if (rec.dy[i] !== rec.dy[i]) n++;
        if (rec.dw[i] !== rec.dw[i]) n++;
        if (rec.dh[i] !== rec.dh[i]) n++;
    }
    return n;
}

/**
 * Run `fn(i)` under a single measured window and gate it against RULES.
 * stabilize:'deep' is mandatory -- maxArrayBuffersGrowth is otherwise
 * inconclusive, never a silent pass.
 * @param {(i:number)=>void} fn  Sync, zero-alloc hot body.
 * @param {{ops:number, warmup?:number}} opts
 * @returns {{report:object, summary:object}}
 */
export function runOpsGate(fn, opts) {
    const res = measureOps(fn, {
        ops: opts.ops,
        warmup: opts.warmup === undefined ? 0 : opts.warmup,
        stabilize: 'deep',
    });
    return { report: checkNoGc(res.summary, RULES), summary: res.summary };
}

/**
 * The retained-bytes lane: the literal form of the README's zero-allocation claim.
 * NOTE the real surface -- rules go to checkAllocs, NOT into measureAllocs opts.
 * @param {(i:number)=>void} fn
 * @param {{iterations:number, batches?:number}} opts
 * @returns {{report:object, result:object}}
 */
export function runAllocGate(fn, opts) {
    const result = measureAllocs(fn, {
        iterations: opts.iterations,
        batches: opts.batches === undefined ? 8 : opts.batches,
    });
    return { report: checkAllocs(result, ALLOC_RULES), result };
}

// ---- shared test fonts and fixtures -- allocated ONCE, at module scope -------

/**
 * The atlas is opaque: draw() reads nothing out of it, so {} is a valid atlas
 * and the harness asserts identity (img === rec.expected), not pixels.
 */
export const ATLAS = {};

/** BMFont JSON for ASCII 32..126 (95 glyphs). Integer advances only. */
export const JSON_ASCII = (() => {
    const chars = [];
    for (let id = 32; id <= 126; id++) {
        if (id === 32) {
            chars.push({ id: 32, x: 0, y: 0, width: 0, height: 0, xoffset: 0, yoffset: 0, xadvance: 6 });
        } else {
            chars.push({ id, x: (id - 32) * 10, y: 0, width: 10, height: 14, xoffset: 0, yoffset: 2, xadvance: 12 });
        }
    }
    return { common: { lineHeight: 20, base: 16 }, chars, kernings: [] };
})();

/** BMFont JSON for digits '0'..'9' and '.', for drawFast. Integer advances. */
export const JSON_NUM = (() => {
    const chars = [
        { id: 46, x: 60, y: 0, width: 4, height: 4, xoffset: 0, yoffset: 12, xadvance: 6 }, // '.'
    ];
    for (let i = 0; i < 10; i++) {
        chars.push({ id: 48 + i, x: i * 10, y: 0, width: 8, height: 14, xoffset: 0, yoffset: 2, xadvance: 10 });
    }
    return { common: { lineHeight: 20, base: 16 }, chars, kernings: [] };
})();

/**
 * JSON_ASCII plus a DENSE kerning table so T0 law 4 is not vacuous (F-21).
 *
 * The three original pairs are preserved verbatim -- node:test blocks assert
 * them by name. Every other (first, second) in 33..126 gets an amount from
 * `((f * 31 + s * 17) % 7) - 3`, in [-3, 3], with the zeros dropped. That is
 * ~6/7 of 8833 remaining pairs, so about 85% of ALL possible seams carry
 * non-zero kerning and the law is non-vacuous for EVERY seed, not just the two
 * that happened to ship. The multiplier on `s` is 17 and not 7 on purpose:
 * 7 % 7 === 0 would make the amount independent of `s`, which reintroduces
 * whole rows of zeros -- the same degeneracy in a new costume.
 *
 * Built ONCE at module scope (harness rule 1); the array is ~7,500 objects and
 * never enters a measured window.
 */
export const JSON_KERN = (() => {
    const kernings = [
        { first: 65, second: 66, amount: -1 },
        { first: 66, second: 65, amount: 2 },
        { first: 65, second: 65, amount: -2 },
    ];
    for (let f = 33; f <= 126; f++) {
        for (let s = 33; s <= 126; s++) {
            if (f === 65 && (s === 65 || s === 66)) continue;
            if (f === 66 && s === 65) continue;
            const a = ((f * 31 + s * 17) % 7) - 3;
            if (a !== 0) kernings.push({ first: f, second: s, amount: a });
        }
    }
    return { common: { lineHeight: 20, base: 16 }, chars: JSON_ASCII.chars, kernings };
})();

/**
 * M4's snap fixture. ADVANCE 8, lineHeight 17, base 16 -- the three numbers
 * every literal in M4 is asserted against, and none of them exist in any other
 * fixture here (JSON_ASCII advances 12 with lineHeight 20). 17 is what makes
 * `17 * 1.1 = 18.7` fractional, which is the whole F-07 table.
 *
 * Every field is an integer, so no F-08 truncation residual contaminates any M4
 * number. Space (id 32) has width 0 and height 0 -- `gw > 0 && gh > 0` is false
 * so it never reaches drawImage, matching JSON_ASCII's convention -- but it
 * STILL ADVANCES 8, so a string containing a space measures correctly and draws
 * one fewer quad.
 *
 * By construction: measure('AA') === 16, measure('AA\n' + 'AA') === 32,
 * measure('A\nAAAAAA') === 56, measureWidest('AA\nAA') === 16,
 * measureWidest('A\nAAAAAA') === 48.
 */
export const JSON_SNAP = (() => {
    const chars = [];
    for (let id = 32; id <= 126; id++) {
        if (id === 32) {
            chars.push({ id: 32, x: 0, y: 0, width: 0, height: 0, xoffset: 0, yoffset: 0, xadvance: 8 });
        } else {
            chars.push({ id, x: (id - 32) * 8, y: 0, width: 8, height: 14, xoffset: 0, yoffset: 2, xadvance: 8 });
        }
    }
    return { common: { lineHeight: 17, base: 16 }, chars, kernings: [] };
})();

/**
 * JSON_SNAP plus JSON_KERN's dense kerning table, rebuilt over 33..126 against
 * the advance-8 chars. IT EXISTS FOR ONE ASSERTION and this comment says which:
 * decisions/0004 fork (6) -- whether `measureWidest` resets the kerning chain at
 * a line break. On a KERNINGLESS font both fork (6) options are arithmetically
 * identical for every string, so the decision would be untestable against
 * JSON_SNAP alone. That is F-21's vacuity shape in a new costume, in the fixture
 * built to prevent it. This is the only font that can see it.
 */
export const JSON_SNAP_KERN = (() => {
    const kernings = [
        { first: 65, second: 66, amount: -1 },
        { first: 66, second: 65, amount: 2 },
        { first: 65, second: 65, amount: -2 },
    ];
    for (let f = 33; f <= 126; f++) {
        for (let s = 33; s <= 126; s++) {
            if (f === 65 && (s === 65 || s === 66)) continue;
            if (f === 66 && s === 65) continue;
            const a = ((f * 31 + s * 17) % 7) - 3;
            if (a !== 0) kernings.push({ first: f, second: s, amount: a });
        }
    }
    return { common: { lineHeight: 17, base: 16 }, chars: JSON_SNAP.chars, kernings };
})();

/**
 * JSON_SNAP with NEGATIVE metrics (F-39). Advance -8 for every glyph and a
 * negative kerning pair, so a line's width is legitimately negative.
 *
 * A negative `xadvance` or kerning `amount` is a valid Int16 that the descriptor
 * door accepts in BOTH lanes -- it is neither lossy nor non-finite -- so a font
 * like this constructs and `measure` returns a negative number for it. Every
 * other fixture in this file is all-positive, which made the `measureWidest`
 * equivalence laws (A3, A5) VACUOUS for the whole negative class: an accumulator
 * seeded at 0 floors every line at 0 and no all-positive corpus can see it.
 * This fixture is the one that can.
 *
 * DEVIATION, declared: SESSION-M4.md section 12 authorises JSON_SNAP and
 * JSON_SNAP_KERN in this file and nothing else. This third fixture was added
 * after qa found F-39, on the coordinator's instruction, for exactly that
 * finding.
 */
export const JSON_SNAP_NEG = (() => {
    const chars = [];
    for (let id = 32; id <= 126; id++) {
        chars.push({ id, x: (id - 32) * 8, y: 0, width: 8, height: 14, xoffset: 0, yoffset: 2, xadvance: -8 });
    }
    return {
        common: { lineHeight: 17, base: 16 },
        chars,
        kernings: [{ first: 65, second: 65, amount: -3 }, { first: 65, second: 66, amount: -2 }],
    };
})();

/** 200 glyphs (ids 32..231), 500 kerning pairs, all integer. T7 only. */
export const JSON_SOAK = (() => {
    const chars = [];
    for (let id = 32; id <= 231; id++) {
        chars.push({ id, x: (id - 32) * 10, y: 0, width: 10, height: 14, xoffset: 0, yoffset: 2, xadvance: 12 });
    }
    const kernings = [];
    for (let n = 0; n < 500; n++) {
        const first = 32 + (n % 200);
        const second = 32 + ((n * 7 + 3) % 200);
        const amount = (n % 5) - 2;             // -2..2, integer
        kernings.push({ first, second, amount });
    }
    return { common: { lineHeight: 20, base: 16 }, chars, kernings };
})();

/**
 * Fork fixtures (M2, decisions/0002). Built once at module scope.
 *
 * JSON_GAP: ids 65, 66 only (advance 12), with kernings that reach ACROSS an
 * unmapped id (200) and name it as a partner -- the evidence fork (3) rests on.
 * JSON_GAP6: the same descriptor with { missingAdvance: 6 }, so the unmapped id
 * occupies real width -- the fork (2)x(3) interaction.
 * JSON_NL: JSON_ASCII plus a descriptor that MAPS id 10 (width/height 9, advance
 * 7) -- the entry fork (4) discards. `.concat` so JSON_ASCII.chars is untouched.
 * JSON_NLK: JSON_NL plus kernings naming id 10 -- the H7 filter FONT_NL cannot
 * kill on its own.
 */
export const JSON_GAP = { common: { lineHeight: 20, base: 16 }, chars: [
    { id: 65, x: 0, y: 0, width: 10, height: 14, xoffset: 0, yoffset: 2, xadvance: 12 },
    { id: 66, x: 10, y: 0, width: 10, height: 14, xoffset: 0, yoffset: 2, xadvance: 12 },
], kernings: [
    { first: 65, second: 66, amount: -5 },
    { first: 65, second: 200, amount: 3 },
    { first: 200, second: 66, amount: 7 },
] };
export const JSON_GAP6 = JSON_GAP;
export const JSON_NL = { common: { lineHeight: 20, base: 16 },
    chars: JSON_ASCII.chars.concat([{ id: 10, x: 0, y: 0, width: 9, height: 9, xoffset: 0, yoffset: 0, xadvance: 7 }]),
    kernings: [] };
export const JSON_NLK = { common: JSON_NL.common, chars: JSON_NL.chars,
    kernings: [ { first: 65, second: 10, amount: -4 }, { first: 10, second: 65, amount: 5 } ] };

/** Fonts constructed once at module scope; never inside a loop. */
export const FONT_ASCII = new BitmapFont(ATLAS, JSON_ASCII);
export const FONT_NUM = new BitmapFont(ATLAS, JSON_NUM);
export const FONT_KERN = new BitmapFont(ATLAS, JSON_KERN);
export const FONT_GAP = new BitmapFont(ATLAS, JSON_GAP);
export const FONT_GAP6 = new BitmapFont(ATLAS, JSON_GAP6, { missingAdvance: 6 });
export const FONT_NL = new BitmapFont(ATLAS, JSON_NL);
export const FONT_NLK = new BitmapFont(ATLAS, JSON_NLK);
// M4. Neither is passed `{ checked: true }`: every field is already integer and
// in range, so `checked` would change nothing and would couple M4 to M3's lane
// split for no reason.
export const FONT_SNAP = new BitmapFont(ATLAS, JSON_SNAP);
export const FONT_SNAP_KERN = new BitmapFont(ATLAS, JSON_SNAP_KERN);
export const FONT_SNAP_NEG = new BitmapFont(ATLAS, JSON_SNAP_NEG);   // F-39

/** 64 chars, 3 lines, 2 newlines, NO spaces -> 62 drawn glyphs exactly. */
export const S64 = 'A'.repeat(21) + '\n' + 'A'.repeat(21) + '\n' + 'A'.repeat(20);

/** T6 window C text: 64 'B'. */
export const WRAP_TEXT = 'B'.repeat(64);

/** 8 lines of [l*8, l*8+8, 96, 0]; flags 0 -> 64 drawImage per call, exact. */
export const WRAP_LAYOUT = (() => {
    const buf = new Float32Array(32);
    for (let l = 0; l < 8; l++) {
        buf[l * 4] = l * 8;
        buf[l * 4 + 1] = l * 8 + 8;
        buf[l * 4 + 2] = 96;
        buf[l * 4 + 3] = 0;
    }
    return buf;
})();

/** NUM_CYCLE[i] = 100 + i; every value renders "ddd.0" -> 5 glyphs exactly. */
export const NUM_CYCLE = (() => {
    const a = new Float64Array(256);
    for (let i = 0; i < 256; i++) a[i] = 100 + i;
    return a;
})();

/**
 * The independent witness for the advance conservation law. Sums
 * (xadvance + kerning) straight out of the ORIGINAL BMFont JSON, in doubles,
 * never touching the Int16Array store -- so the residual between this and
 * _measureRange IS the F-08 truncation drift when a font has one.
 *
 * MISSING-GLYPH POLICY, fork (3) option A -- decided in M2, recorded in
 * decisions/0002. An unmapped id in [0, 256) advances by whatever the glyph
 * table says (0 by default, `missingAdvance` if the caller opted in) AND BECOMES
 * THE KERNING `prev`, exactly as all three walk sites in BitmapFont.js do. The
 * 1.2.2 comment here claimed the opposite and called it "today's implementation
 * behaviour"; it was never true (F-24) and it would have failed M2's three-way
 * law on day one for a reason that is not any of F-03/F-04/F-05/F-12.
 *
 * The oracle must still read the ORIGINAL JSON, never the Int16 store, or the
 * F-08 residual disappears -- so an unmapped id contributes `missingAdvance`
 * (passed in), not `font.glyphs[id * 7 + 6]`. Id 10 is handled exactly as the
 * library handles it: `adv[10]` is forced out of the map by buildOracleMaps
 * (which skips `c.id === 10`), and `kern` keys naming 10 are skipped, so the
 * oracle reproduces the constructor's policy from the JSON side without knowing
 * about it.
 *
 * @param {object} json   the ORIGINAL descriptor, not the font
 * @param {string} text
 * @param {number} start  inclusive
 * @param {number} end    exclusive
 * @param {number} scale
 * @param {number} [missingAdvance=0]  advance charged to an id in [0,256) the
 *                                     descriptor did not cover
 * @returns {number}
 */
const oracleCache = new WeakMap();
function buildOracleMaps(json) {
    const adv = Object.create(null);
    const kern = Object.create(null);
    for (let i = 0; i < json.chars.length; i++) {
        const c = json.chars[i];
        // Id 10 is a layout instruction, not a glyph -- its descriptor entry is
        // discarded (F-25), so the oracle must not see its advance either.
        if (c.id >= 0 && c.id < 256 && c.id !== 10) adv[c.id] = c.xadvance;
    }
    if (json.kernings) {
        for (let i = 0; i < json.kernings.length; i++) {
            const k = json.kernings[i];
            // A newline cannot be a kerning partner (H7); mirror the filter here.
            if (k.first < 256 && k.second < 256 && k.first !== 10 && k.second !== 10) {
                kern[(k.first << 8) | k.second] = k.amount;
            }
        }
    }
    return { adv, kern };
}
export function oracleAdvance(json, text, start, end, scale, missingAdvance = 0) {
    let maps = oracleCache.get(json);
    if (maps === undefined) { maps = buildOracleMaps(json); oracleCache.set(json, maps); }
    const adv = maps.adv;
    const kern = maps.kern;
    let width = 0;
    let prevId = -1;
    for (let i = start; i < end; i++) {
        const id = text.charCodeAt(i);
        // An id in [0,256) advances and becomes prev regardless of coverage --
        // an unmapped id contributes `missingAdvance` (0 by default). Id 10 was
        // dropped from `adv`, so `adv[10] === undefined` -> it advances 0 and
        // resets nothing extra, matching the library's zeroed-slot policy.
        if (id >= 0 && id < 256) {
            if (prevId !== -1) {
                const kk = kern[(prevId << 8) | id];
                if (kk !== undefined) width += kk * scale;
            }
            width += (adv[id] === undefined ? missingAdvance : adv[id]) * scale;
            prevId = id;
        }
    }
    return width;
}
