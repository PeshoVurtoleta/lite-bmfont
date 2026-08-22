// =============================================================================
//  lite-bmfont x lite-text-layout -- the compound pipeline demo, scene bodies
// =============================================================================
//
// WHY THIS FILE EXISTS: same reason as scenes.mjs. Every per-frame body lives
// here, with ZERO STATIC IMPORTS, so a test can drive it under Node with a
// recording ctx and gate what it allocates. A claim rendered on screen by a
// body no test can reach is the F-53 defect, and this package has shipped that
// twice.
//
// WHAT IS AND IS NOT CLAIMED HERE. Every caption is scoped to STRING garbage,
// which is what these bodies actually avoid. They are NOT allocation-free:
// storing a double into an object field boxes a HeapNumber on current V8, which
// is F-55, measured at ~31.5-291.5 B/frame in the sibling demo. This file keeps
// its per-frame numeric state in a Float64Array (see the S_* indices below)
// rather than object fields specifically to shrink that, but "zero allocation"
// unqualified is a claim this file does not make and its captions do not print.
//
// @license MIT (c) Zahary Shinikchiev <shinikchiev@yahoo.com>

// -- The layout-buffer contract, restated so a reader need not chase it -------
// @zakkster/lite-text-layout writes 4 floats per line:
//   [startIdx, endIdx, lineWidth, flags]      endIdx is EXCLUSIVE
// and @zakkster/lite-bmfont's drawWrapped consumes exactly that shape. The two
// packages agree on `lineWidth` being AT THE RENDERED SCALE -- that agreement
// is F-45, which shipped broken for three versions because no test rendered a
// wrapped line at a scale other than 1.
export const LAYOUT_STRIDE = 4;

// text-layout's flag VALUE SPACE. Compare by equality, never by truthiness:
// FLAG_TRUNCATED is 1 and FLAG_OVERFLOW is 2, so `if (flags)` conflates a
// caller bug with a normal truncation.
export const FLAG_NORMAL = 0;
export const FLAG_TRUNCATED = 1;
export const FLAG_OVERFLOW = 2;

// -- Per-frame numeric state lives in a Float64Array, not object fields -------
// F-55: `obj.x += 1.5` boxes a HeapNumber per assignment on current V8. Typed
// array slots do not. This is the one structural difference between this file
// and scenes.mjs, and it is deliberate.
export const S_NOW = 0;
export const S_DT = 1;
export const S_W = 2;
export const S_H = 3;
export const S_BOXW = 4;
export const S_BOXH = 5;
export const S_LINES = 6;
export const S_FLAG = 7;
export const S_DRAWS = 8;
export const S_GLYPHS = 9;
export const S_DIRTY = 10;
export const S_PHASE = 11;
export const S_SCENE = 12;
export const STATE_LEN = 13;

export function makeState() {
    const st = new Float64Array(STATE_LEN);
    st[S_BOXW] = 520;
    st[S_BOXH] = 300;
    st[S_DIRTY] = 1;
    return st;
}

// -- Constant strings, built ONCE at module load -----------------------------
// Nothing below is concatenated, sliced or padded inside a frame body.
export const BODY_TEXT =
    'The layout buffer is the contract. lite-text-layout walks the string once, ' +
    'resolves every kerning pair against the same 64K Int16 LUT the renderer ' +
    'uses, and writes four floats per line into a buffer you own. Nothing is ' +
    'allocated. lite-bmfont then blits those lines every frame without ever ' +
    'looking at the text again. Compute on change, render for free.';

export const TRUNC_TEXT =
    'Truncation is a value, not a boolean. FLAG_TRUNCATED means the TEXT did ' +
    'not fit the BOX and the renderer appends an ellipsis. FLAG_OVERFLOW means ' +
    'the BUFFER did not fit the TEXT, which is a caller bug and a different ' +
    'problem wearing the same shape. Comparing these by truthiness hides one ' +
    'inside the other.';

export const STRESS_TEXT =
    'Every block on this screen re-blits from its own layout buffer each frame. ' +
    'None of them re-wraps. The wrap ran once, when the text or the box changed.';

// Captions. Each names the call that delivers what it claims, and each claim is
// scoped to string garbage -- see the header.
export const CAP_WRAP = 'computeWrap -> drawWrapped -- drag the box edge; wrap reruns only on change';
export const CAP_TRUNC = 'FLAG_TRUNCATED = 1, FLAG_OVERFLOW = 2 -- a value space, not a boolean';
export const CAP_SCOPE = 'frame time -> RingBuffer.push -> CanvasGraph.render -- no string per sample';
export const CAP_STRESS = 'N blocks, N layout buffers, zero re-wraps, zero string allocation per frame';

export const LBL_LINES = 'LINES';
export const LBL_FLAG = 'FLAG';
export const LBL_BLOCKS = 'BLOCKS';
export const FLAG_NAMES = ['NORMAL', 'TRUNCATED', 'OVERFLOW'];

// -- Scene 1: WRAP -----------------------------------------------------------
// The headline pairing. `deps.layout.computeWrap` runs ONLY when S_DIRTY is
// set; every other frame is a pure blit out of the same buffer.
export function renderWrap(ctx, st, deps) {
    const boxW = st[S_BOXW];
    const boxH = st[S_BOXH];

    if (st[S_DIRTY] === 1) {
        // computeWrap reads deps.wrapBody -- the WHOLE-PIXEL view, not the font.
        // drawWrapped below reads the real font. See the F-56 adapter in the host
        // page: lite-text-layout@1.3.0 does not decode bmfont 2.x's 1/16 store.
        const n = deps.layout.computeWrap(
            BODY_TEXT, deps.wrapBody, boxW, boxH, deps.lineHeight, deps.wrapBuf, 1);
        st[S_LINES] = n;
        st[S_FLAG] = n > 0 ? deps.wrapBuf[(n - 1) * LAYOUT_STRIDE + 3] : FLAG_NORMAL;
        st[S_DIRTY] = 0;
    }

    const x = (st[S_W] - boxW) * 0.5;
    const y = (st[S_H] - boxH) * 0.5;

    // Box outline first: all canvas state writes, then the glyph blits.
    ctx.strokeStyle = '#1f6b3f';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, boxW, boxH);

    deps.fontBody.drawWrapped(ctx, BODY_TEXT, deps.wrapBuf, st[S_LINES],
        boxW, boxH, x, y, 1, 0, 0);

    deps.fontSmall.draw(ctx, CAP_WRAP, x, y + boxH + 22, 0.8, 0);
    st[S_DRAWS] = st[S_LINES];
}

// -- Scene 2: TRUNCATE -------------------------------------------------------
// Drives the box height with a sine so the flag transitions live. computeWrap
// runs EVERY frame here on purpose: it is zero-alloc by construction, and the
// point of the scene is that re-wrapping per frame is affordable.
export function renderTruncate(ctx, st, deps) {
    const t = st[S_PHASE];
    const boxW = 560;
    const boxH = 120 + Math.sin(t * 0.0009) * 90 + 100;

    const n = deps.layout.computeWrap(
        TRUNC_TEXT, deps.wrapBody, boxW, boxH, deps.lineHeight, deps.wrapBuf, 1);
    st[S_LINES] = n;
    st[S_FLAG] = n > 0 ? deps.wrapBuf[(n - 1) * LAYOUT_STRIDE + 3] : FLAG_NORMAL;

    const x = (st[S_W] - boxW) * 0.5;
    const y = (st[S_H] - boxH) * 0.5;

    ctx.strokeStyle = st[S_FLAG] === FLAG_TRUNCATED ? '#c8a020' : '#1f6b3f';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, boxW, boxH);

    // 11th arg is vAlign (0=top), NOT flags. The ellipsis flag is per-LINE and
    // reaches the renderer through buffer slot [3], which computeWrap wrote --
    // passing FLAG_TRUNCATED here would silently middle-align instead.
    deps.fontBody.drawWrapped(ctx, TRUNC_TEXT, deps.wrapBuf, n,
        boxW, boxH, x, y, 1, 0, 0);

    deps.fontSmall.draw(ctx, CAP_TRUNC, x, y + boxH + 22, 0.8, 0);
    st[S_DRAWS] = n;
}

// -- Scene 3: SCOPE ----------------------------------------------------------
// The trace itself is drawn by @zakkster/lite-canvas-graph onto its own canvas.
// This body only labels it, so the two renderers never contend for ctx state.
export function renderScope(ctx, st, deps) {
    const x = 60;
    const y = st[S_H] * 0.5 - 60;
    deps.fontHead.draw(ctx, 'FRAME SCOPE', x, y, 1, 0);
    deps.fontSmall.draw(ctx, CAP_SCOPE, x, y + 44, 0.8, 0);
    st[S_DRAWS] = 2;
}

// -- Scene 4: STRESS ---------------------------------------------------------
// `deps.stressBufs` is an array of Float32Array layout buffers, wrapped ONCE at
// boot. Every frame is pure drawWrapped.
export function renderStress(ctx, st, deps) {
    const bufs = deps.stressBufs;
    const counts = deps.stressCounts;
    const n = bufs.length;
    const cols = 4;
    const bw = 250;
    const bh = 130;
    const gapX = 20;
    const gapY = 18;
    const startX = (st[S_W] - (cols * bw + (cols - 1) * gapX)) * 0.5;
    const startY = 90;
    let drawn = 0;

    for (let i = 0; i < n; i++) {
        const col = i % cols;
        const row = (i / cols) | 0;
        const bx = startX + col * (bw + gapX);
        const by = startY + row * (bh + gapY);
        if (by > st[S_H] - 40) break;
        deps.fontSmall.drawWrapped(ctx, STRESS_TEXT, bufs[i], counts[i],
            bw, bh, bx, by, 0.8, 0, 0);
        drawn += counts[i];
    }

    deps.fontSmall.draw(ctx, CAP_STRESS, startX, 62, 0.8, 0);
    st[S_DRAWS] = drawn;
}
