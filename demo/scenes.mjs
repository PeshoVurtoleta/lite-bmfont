// demo/scenes.mjs -- the four per-frame scene bodies for demo-lite-bmfont.html.
//
// WHY THIS FILE EXISTS: the library is zero-allocation and the torture gate
// proves it (T6). The demo used to allocate ~42 strings per frame -- substrings,
// a padStart, a concat -- while rendering the words "zero alloc" over them
// (F-53). T6 cannot see the demo: it is a browser file excluded from files[].
// So the four frame-path scene bodies live here, imported by the HTML AND by
// test/demo.test.js, which drives them under lite-gc-profiler's allocation-
// VOLUME lane. The gate the library holds itself to now covers its own demo.
//
// ZERO STATIC IMPORTS, on purpose. A CDN `import` at the top of this module
// would throw inside the node:test child (no network, no `+esm` resolver) and
// every volume row would silently stop existing -- a no-op gate, the exact
// failure this session was called to close. The fonts and every BitmapFont
// method reach the scene bodies as INSTANCES through the state object `S`; this
// file never names `BitmapFont`.
//
// Every per-frame STRING allocation is gone and each caption below NAMES the call
// that delivers it. The bodies are NOT allocation-free: their float arithmetic on
// object fields still boxes HeapNumbers (F-55, ~31.5 B/frame wave, ~291.5 score),
// so every claim here is scoped to STRING garbage, which is what the rewrite removed
// and what demo.test.js gates. The particle pool and the click handlers stay in
// the HTML: they fire on an EVENT, not per frame, and a demo MAY allocate on an
// event (F-53 scope note). That boundary is deliberate -- but it was STATED too
// broadly here until M11: this sentence used to cover "the ambient/auto spawns"
// too, and stressAutoSpawn is NOT event-driven -- it runs every frame the stress
// scene is active, allocating a toString at ~50% per-frame odds while the HUD
// read "0 string allocs". Found by M11 QA; the allocation is gone (SPAWN_LABELS,
// built once at boot) rather than the claim being re-scoped around it.
//
// @license MIT (c) Zahary Shinikchiev <shinikchiev@yahoo.com>

/**
 * Floats per glyph record in a layoutGlyphs / drawQuads buffer: [sx,sy,sw,sh,dx,dy].
 * Gated === the library's GLYPH_STRIDE in test/demo.test.js so this constant
 * cannot drift from the API it mirrors. dx is slot 4, dy is slot 5.
 */
export const SCENE_STRIDE = 6;
const DX = 4;
const DY = 5;

/** The two wave strings. Both contain spaces, so record count != length on a
 *  descriptor whose space glyph is zero-size (the record-vs-char gap is live). */
export const WAVE_MSG = 'ZERO-GC BITMAP TEXT';
export const WAVE_MSG2 = 'OKLCH COLOR CYCLING';

/** The typewriter phrases, cycled in order. */
export const TW_PHRASES = [
    'ZERO GARBAGE COLLECTION.',
    'EVERY GLYPH FROM A TYPED ARRAY.',
    'NO STRING.SPLIT() -- EVER.',
    'O(1) KERNING VIA INT16 LUT.',
    'BITMAP FONT RENDERING AT 60FPS.',
    'CHARCODEAT() + DRAWIMAGE() = SPEED.',
];

/**
 * The nine leading-zero runs, ['', '0', '00', ... '00000000'], built ONCE at
 * module load -- never inside a frame. The score fork draws ZEROS[8 - digits]
 * then drawFastInt's the number after it: identical eight-character look, zero
 * per-frame allocation, and it teaches the discipline the library preaches
 * (allocate at boot, never in a frame) instead of the padStart it replaces.
 */
export const ZEROS = (() => {
    const a = new Array(9);
    let s = '';
    for (let i = 0; i < 9; i++) { a[i] = s; s += '0'; }
    return a;
})();

/** The stress-scene count label. A constant -- the count is drawFastInt'd and
 *  this is drawn after it, replacing the per-frame `count + ' LIVE STRINGS'`. */
export const STRESS_LABEL = ' LIVE STRINGS';

/** The six decorative orbit labels for the score scene. Hoisted to module scope:
 *  the demo used to allocate this array literal inside the orbit loop, six times
 *  per frame. */
const SCORE_ORBIT = ['COMBO', 'x2', 'BONUS', 'HIT', 'STREAK', 'MAX'];

// ---- module-scope scratch: allocated ONCE, never per frame -----------------
// Sizing is msg.length * SCENE_STRIDE, the SAFE UPPER BOUND from the API
// contract (a Float64Array, NOT Float32Array, so layoutGlyphs round-trips with
// draw). Never the record count: a space emits no record on a zero-size-space
// descriptor, so the count is <= length and not knowable before the walk.
const WAVE_BUF = new Float64Array(WAVE_MSG.length * SCENE_STRIDE);   // 19*6 = 114 floats
const WAVE_BUF2 = new Float64Array(WAVE_MSG2.length * SCENE_STRIDE); // 19*6 = 114 floats

// TW_BUF is sized to the LONGEST phrase's length (msg.length * stride), computed
// at load so a one-character miscount cannot under-size it and throw. The brief
// quoted 34*6; the longest phrase ('CHARCODEAT() + DRAWIMAGE() = SPEED.') is 35,
// so this derives the bound from the data instead of a literal.
const TW_MAXLEN = (() => { let m = 0; for (const p of TW_PHRASES) if (p.length > m) m = p.length; return m; })();
const TW_BUF = new Float64Array(TW_MAXLEN * SCENE_STRIDE);

// One-record scratch used only at boot, by buildTwRecords, to ask the font
// whether a single glyph emits. Never touched inside a frame.
const REC1 = new Float64Array(SCENE_STRIDE);

/**
 * Build the per-phrase prefix map recordsBefore[charIdx] -> record count for
 * chars [0, charIdx). Q5: layoutGlyphs returns only a total and emits nothing
 * for a glyph that fails gw>0 && gh>0 (a zero-size space), so there is no
 * char->record relation in the public surface and hasGlyph is not a substitute
 * (hasGlyph(32) is true yet a space emits no record). Emission is per-glyph and
 * context-free, so a single-char layout answers it. This is what the CUT range-
 * render session (M6 in the roadmap) would have been for; it was not needed.
 *
 * Built once per font at makeSceneState time -- NOT per frame, NOT per phrase
 * change. Boot-time substrings (charAt) are fine; frames allocate nothing.
 */
function buildTwRecords(font) {
    const maps = new Array(TW_PHRASES.length);
    for (let p = 0; p < TW_PHRASES.length; p++) {
        const phrase = TW_PHRASES[p];
        const m = new Uint16Array(phrase.length + 1);
        let acc = 0;
        for (let i = 0; i < phrase.length; i++) {
            m[i] = acc;
            const n = font.layoutGlyphs(phrase.charAt(i), REC1, 0, 0, 1, 0);
            acc += n > 0 ? n : 0;   // fail-closed: a non-string/bad scale returns NaN
        }
        m[phrase.length] = acc;
        maps[p] = m;
    }
    return maps;
}

/**
 * The single mutable scene-state object. Module-scope in the HTML, MUTATED in
 * place every frame -- a per-frame `{ fonts, ... }` literal is the single
 * largest self-inflicted regression available here. The HTML syncs W/H/now/dt/
 * count before each call; the scene bodies read and mutate the rest.
 *
 * @param {object} fonts { main, accent, small, pink } BitmapFont instances.
 */
export function makeSceneState(fonts) {
    return {
        fontMain: fonts.main,
        fontAccent: fonts.accent,
        fontSmall: fonts.small,
        fontPink: fonts.pink,
        W: 0, H: 0, now: 0, dt: 0,
        drawCount: 0,
        // score
        scoreVal: 0, scoreDisplay: 0,
        // typewriter
        twText: '', twIdx: 0, twTimer: 0, twPhraseIdx: 0,
        twCur: 0, twLaid: -1,               // -1: no phrase laid into TW_BUF yet (fail-closed)
        twRecords: buildTwRecords(fonts.main),
        // stress (mirrors the HTML particle count for display only)
        count: 0,
    };
}

// ---- zero-alloc width helpers (no toString, no allocation) ------------------

/** Digit count of a non-negative integer. `0` has one digit. */
function digitCount(n) {
    let d = 1, t = n;
    while (t >= 10) { t = Math.floor(t / 10); d++; }
    return d;
}

/**
 * Rendered width of drawFastInt(value) at `scale`. Replicates drawFastInt's own
 * width walk: per-digit advanceOf plus kernOf between adjacent digits (F-04's
 * advance store is 1/16 fixed point; advanceOf/kernOf return px). Widths come
 * from advanceOf/kernOf so a NON-monospace digit run measures correctly -- the
 * atlas is not assumed uniform. Zero allocation: every local is a number.
 */
function intWidth(font, value, scale) {
    let v = Math.trunc(value);
    if (!(v > 0)) return font.advanceOf(48) * scale;   // <=0 renders a single '0'
    const d = digitCount(v);
    let div = 1;
    for (let k = 1; k < d; k++) div *= 10;
    let w = 0, prev = -1;
    for (let k = 0; k < d; k++) {
        const code = 48 + (Math.floor(v / div) % 10);
        if (prev !== -1) w += font.kernOf(prev, code);
        w += font.advanceOf(code);
        prev = code;
        div = Math.floor(div / 10);
    }
    return w * scale;
}

/**
 * Rendered width of `n` zero-padded to eight characters, glyph by glyph with
 * kerning between every adjacent pair (including the zero-run -> number seam).
 * Used to centre the score exactly as the old align-centre padStart did.
 */
function padded8Width(font, n, scale) {
    const d = digitCount(n);
    const zeros = 8 - d;
    let w = 0, prev = -1;
    for (let k = 0; k < zeros; k++) {
        if (prev !== -1) w += font.kernOf(prev, 48);
        w += font.advanceOf(48);
        prev = 48;
    }
    let div = 1;
    for (let k = 1; k < d; k++) div *= 10;
    for (let k = 0; k < d; k++) {
        const code = 48 + (Math.floor(n / div) % 10);
        if (prev !== -1) w += font.kernOf(prev, code);
        w += font.advanceOf(code);
        prev = code;
        div = Math.floor(div / 10);
    }
    return w * scale;
}

// ---- SCENE: Wave Text -------------------------------------------------------
// FORK 1 (decisions/0013). Old body: `font.draw(ch, baseX + font.measure(
// msg.substring(0, i), scale), ...)` per glyph -- ~38 substrings/frame plus the
// O(n^2) prefix re-walk. New body: layoutGlyphs ONCE per message into a module
// buffer (the x of every glyph is already the prefix width), then per glyph set
// dy ABSOLUTELY (baseline + wave) and blit ONE drawQuads(ctx, buf, i, 1) with a
// per-glyph globalAlpha between calls -- the exact per-letter idiom the layout
// seam shipped for (decisions/0010). Zero allocation: measureLine, layoutGlyphs
// and drawQuads all write into pre-allocated scratch.
export function renderWave(ctx, S) {
    const now = S.now;
    const main = S.fontMain;
    const baseX = S.W / 2 - main.measureLine(WAVE_MSG, 0, WAVE_MSG.length, 1) / 2;
    const baseY = S.H / 2 - 20;
    const n = main.layoutGlyphs(WAVE_MSG, WAVE_BUF, baseX, baseY, 1, 0);
    for (let i = 0; i < n; i++) {
        const wave = Math.sin(now * 0.004 + i * 0.4) * 18;
        // dy is ABSOLUTE, never +=: layoutGlyphs re-wrote the flat baseline into
        // this slot THIS frame, so read that flat value and write baseline+wave.
        // A += would integrate the wave across frames.
        const flatDy = WAVE_BUF[i * SCENE_STRIDE + DY];
        WAVE_BUF[i * SCENE_STRIDE + DY] = flatDy + wave;
        ctx.globalAlpha = 0.7 + Math.sin(now * 0.003 + i * 0.5) * 0.3;
        main.drawQuads(ctx, WAVE_BUF, i, 1, 0, 0, 1);
        S.drawCount++;
    }
    ctx.globalAlpha = 0.25;
    S.fontSmall.draw(ctx, 'per-character wave via layoutGlyphs + drawQuads -- zero string allocation',
        S.W / 2, S.H / 2 + 50, 0.9, 1);
    ctx.globalAlpha = 1;
    S.drawCount++;

    const accent = S.fontAccent;
    const baseX2 = S.W / 2 - accent.measureLine(WAVE_MSG2, 0, WAVE_MSG2.length, 0.8) / 2;
    const baseY2 = S.H / 2 + 80;
    const n2 = accent.layoutGlyphs(WAVE_MSG2, WAVE_BUF2, baseX2, baseY2, 0.8, 0);
    for (let i = 0; i < n2; i++) {
        const wave2 = Math.cos(now * 0.003 + i * 0.35) * 12;
        const flatDy = WAVE_BUF2[i * SCENE_STRIDE + DY];
        WAVE_BUF2[i * SCENE_STRIDE + DY] = flatDy + wave2;
        ctx.globalAlpha = 0.5 + Math.sin(now * 0.005 + i * 0.7) * 0.3;
        accent.drawQuads(ctx, WAVE_BUF2, i, 1, 0, 0, 0.8);
        S.drawCount++;
    }
    ctx.globalAlpha = 1;
}

// ---- SCENE: Score Counter ---------------------------------------------------
// FORK 2 (decisions/0013). Old body: `Math.round(scoreDisplay).toString()
// .padStart(8, '0')` -- two allocations/frame -- plus a six-element array
// literal built inside the orbit loop, six more per frame. New body: draw the
// constant ZEROS[8 - digits] run, then drawFastInt the number after it; centre
// by the exact eight-character width (padded8Width) so it does not jitter. The
// orbit labels are the module-scope SCORE_ORBIT constant.
export function renderScore(ctx, S) {
    S.scoreDisplay += (S.scoreVal - S.scoreDisplay) * S.dt * 8;
    const n = Math.round(S.scoreDisplay);
    const nn = n > 0 ? n : 0;
    const d = digitCount(nn);
    const scale = 1.4;
    const total = padded8Width(S.fontPink, nn, scale);
    const leftX = S.W / 2 - total / 2;
    // Leading zeros as a constant string (ZEROS built at boot), then the number.
    S.fontPink.draw(ctx, ZEROS[8 - d], leftX, S.H / 2 - 40, scale, 0);
    S.fontPink.drawFastInt(ctx, nn, leftX + (total - intWidth(S.fontPink, nn, scale)), S.H / 2 - 40, scale, 0);
    S.drawCount++;

    ctx.globalAlpha = 0.3;
    S.fontSmall.draw(ctx, 'SCORE', S.W / 2, S.H / 2 - 80, 1, 1);
    S.fontSmall.draw(ctx, 'click to add points -- ZEROS[] run + drawFastInt, zero string alloc',
        S.W / 2, S.H / 2 + 30, 0.8, 1);
    ctx.globalAlpha = 1;
    S.drawCount += 2;

    // Decorative orbiting text -- labels from the module-scope constant.
    const now = S.now;
    for (let i = 0; i < 6; i++) {
        const a = now * 0.001 + i * Math.PI / 3;
        const r = 140 + Math.sin(now * 0.002 + i) * 20;
        ctx.globalAlpha = 0.15;
        S.fontSmall.draw(ctx, SCORE_ORBIT[i], S.W / 2 + Math.cos(a) * r, S.H / 2 + Math.sin(a) * r * 0.5, 0.7, 1);
        S.drawCount++;
    }
    ctx.globalAlpha = 1;
}

// ---- SCENE: Typewriter ------------------------------------------------------
// FORK 3 (decisions/0013). Old body: `twText.substring(0, ...)` every frame.
// New body: lay the WHOLE phrase out ONCE when the phrase changes (not per
// frame) into TW_BUF, and blit a growing prefix with drawQuads(ctx, buf, 0, n).
// `n` is the record count from the per-phrase prefix map (records emitted for
// the visible chars) -- NOT the char count, because a zero-size space emits no
// record. The cursor X is measureLine(twText, 0, visibleChars, 0.7): zero-alloc,
// no substring anywhere. This is the range render the CUT session would have
// shipped; the prefix map made it unnecessary.
export function renderTypewriter(ctx, S) {
    if (S.twText === '' || S.twIdx >= S.twText.length + 30) {
        S.twCur = S.twPhraseIdx % TW_PHRASES.length;
        S.twText = TW_PHRASES[S.twCur];
        S.twPhraseIdx++;
        S.twIdx = 0;
        S.twTimer = 0;
        // Lay the new phrase out ONCE, here, on the phrase change -- not per frame.
        S.fontMain.layoutGlyphs(S.twText, TW_BUF, 40, S.H / 2 - 10, 0.7, 0);
        S.twLaid = S.twCur;
    }
    S.twTimer += S.dt;
    S.twIdx = Math.min(S.twText.length + 30, (S.twTimer * 24) | 0);
    const visibleChars = Math.min(S.twIdx, S.twText.length);

    // Fail-closed: only blit if TW_BUF actually holds the current phrase.
    if (S.twLaid === S.twCur) {
        const nRecords = S.twRecords[S.twCur][visibleChars];
        S.fontMain.drawQuads(ctx, TW_BUF, 0, nRecords, 0, 0, 0.7);
        S.drawCount++;
    }

    // Blinking cursor
    if (S.twIdx <= S.twText.length && ((S.now * 0.006) | 0) % 2 === 0) {
        const cursorX = 40 + S.fontMain.measureLine(S.twText, 0, visibleChars, 0.7);
        ctx.fillStyle = '#39ff85';
        ctx.fillRect(cursorX, S.H / 2 - 10, 3, 28);
    }

    ctx.globalAlpha = 0.15;
    S.fontSmall.draw(ctx, '> layout once + drawQuads prefix -- zero string allocation', 40, S.H / 2 + 40, 0.8, 0);
    ctx.globalAlpha = 1;
    S.drawCount++;
}

// ---- SCENE: Stress Test -----------------------------------------------------
// FORK / T-6 (decisions/0013). Old body: `count + ' LIVE STRINGS'` -- one concat
// per frame. New body: drawFastInt the count, then draw the constant
// STRESS_LABEL after it, centred by the combined width (intWidth + measureLine)
// so the block does not jitter as the digit count changes.
export function renderStress(ctx, S) {
    ctx.globalAlpha = 0.2;
    const scale = 0.7;
    const numW = intWidth(S.fontMain, S.count, scale);
    const labelW = S.fontMain.measureLine(STRESS_LABEL, 0, STRESS_LABEL.length, scale);
    const leftX = S.W / 2 - (numW + labelW) / 2;
    S.fontMain.drawFastInt(ctx, S.count, leftX, 40, scale, 0);
    S.fontMain.draw(ctx, STRESS_LABEL, leftX + numW, 40, scale, 0);
    S.fontSmall.draw(ctx, 'click to spawn 50 -- push it to 2000', S.W / 2, 75, 0.7, 1);
    ctx.globalAlpha = 1;
    S.drawCount += 2;
}
