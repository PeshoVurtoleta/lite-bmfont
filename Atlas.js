/**
 * @zakkster/lite-bmfont/atlas -- COLD boot-time mock-BMFont atlas generator.
 *
 * NOT a hot path. generateAtlas() allocates one canvas, one descriptor object
 * and ~95 char entries PER CALL. It is a boot-time helper, called once per theme
 * to synthesize an ASCII atlas from a CSS font, never inside a frame loop. This
 * allocation is a RATIFIED exception (decisions/0009-atlas-subpath.md); it is
 * NOT precedent for allocating anywhere else in the suite, and nothing here may
 * be "optimized" into an out parameter.
 *
 * It lives on its own subpath (`@zakkster/lite-bmfont/atlas`) so the core
 * `BitmapFont.js` imports nothing, keeps `sideEffects: false`, and stays
 * importable in a DOM-free Node process -- the repo's own gate imports the core
 * in Node. This file touches the DOM ONLY inside generateAtlas(), read at CALL
 * time; module scope is inert and imports clean in Node (proven by T8).
 *
 * @license MIT
 */

/** The one error generateAtlas throws (never a bare TypeError on undefined). */
export class AtlasError extends Error {
    constructor(message, field, value) {
        super(message);
        this.name = 'AtlasError';
        this.field = field;
        this.value = value;
    }
}

/**
 * COLD, ALLOCATES. Synthesize a full printable-ASCII mock BMFont atlas from a
 * CSS font. Returns `{ atlas, json }` ready for `new BitmapFont(atlas, json)`.
 *
 * @param {number} size        integer font size in px, 4..512 (feeds common.base)
 * @param {string} fontCSS     a CSS `font` shorthand, e.g. "bold 36px monospace"
 * @param {string} fillColor   glyph fill color
 * @param {string} [shadowColor] optional drop-shadow color
 * @returns {{ atlas: HTMLCanvasElement, json: object }}
 */
export function generateAtlas(size, fontCSS, fillColor, shadowColor) {
    // COLD door 1: the DOM is read at CALL time, never at module scope, so this
    // file imports in a DOM-free Node process. Fail closed with a NAMED error --
    // never a "Cannot read properties of undefined" TypeError.
    const doc = globalThis.document;
    if (!doc || typeof doc.createElement !== 'function') {
        throw new AtlasError(
            'lite-bmfont: generateAtlas requires a DOM (document.createElement); ' +
            'it is a browser boot-time helper, not a Node entry point',
            'document', doc);
    }
    // COLD door 2: `size` passes straight into common.base, and { checked: true }
    // rejects a fractional or out-of-range base. THROW rather than normalize -- a
    // silent snap would render at a size the caller did not ask for and launder a
    // caller bug past the descriptor door (decisions/0009).
    //
    // Lower bound 4 is DERIVED, not picked: glyph height is `cellH - 4` with
    // cellH = (size * 1.4) | 0, so a positive height needs cellH >= 5, i.e.
    // size * 1.4 >= 5, i.e. size >= 3.58 -> the smallest integer is 4 (cellH 5,
    // height 1). size 1..3 give height <= 0 -- a geometrically meaningless
    // descriptor { checked: true } waves through because -3/-2/0 are valid Int16.
    if (!(Number.isInteger(size) && size >= 4 && size <= 512)) {
        throw new AtlasError(
            'lite-bmfont: generateAtlas size must be an integer in [4, 512], got ' + String(size),
            'size', size);
    }

    const chars = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';
    // The DOM interaction is wrapped: a hostile document whose createElement,
    // getContext, measureText or fillText THROWS must fail closed as the
    // AtlasError this file's header promises -- never a bare Error or TypeError
    // escaping one call deeper (door 3c, below). Our own malformed-return doors
    // (3a/3b) throw AtlasError and are re-thrown unchanged.
    let c, x;
    try {
        c = doc.createElement('canvas');
        // COLD door 3a: createElement may hand back an element with no getContext.
        if (!c || typeof c.getContext !== 'function') {
            throw new AtlasError(
                'lite-bmfont: generateAtlas got an element with no getContext() from ' +
                'document.createElement -- not a usable <canvas>',
                'canvas', c);
        }
        const cols = 16, cellW = size * 1.2 | 0, cellH = size * 1.4 | 0;
        const rows = Math.ceil(chars.length / cols);
        c.width = cols * cellW;
        c.height = rows * cellH;
        x = c.getContext('2d');
        // COLD door 3b: getContext('2d') can legitimately return null (a browser
        // does this under memory pressure). "null is not zero" -- fail closed.
        if (!x || typeof x.measureText !== 'function' || typeof x.fillText !== 'function') {
            throw new AtlasError(
                'lite-bmfont: generateAtlas got a null or unusable 2d context from ' +
                'canvas.getContext (a browser may return null under memory pressure)',
                'context', x);
        }
        x.textBaseline = 'top';
        x.font = fontCSS;

        const json = {common: {lineHeight: cellH, base: size}, chars: [], kernings: []};

        for (let i = 0; i < chars.length; i++) {
            const ch = chars[i];
            const col = i % cols, row = (i / cols) | 0;
            const px = col * cellW + 2, py = row * cellH + 2;
            const m = x.measureText(ch);
            const w = Math.ceil(m.width) + 4;

            if (shadowColor) {
                x.shadowColor = shadowColor;
                x.shadowBlur = 3;
                x.shadowOffsetX = 1;
                x.shadowOffsetY = 2;
            }
            x.fillStyle = fillColor;
            x.fillText(ch, px, py);
            x.shadowBlur = 0;

            json.chars.push({
                id: ch.charCodeAt(0),
                x: px,
                y: py,
                width: w,
                height: cellH - 4,
                xoffset: 0,
                yoffset: 0,
                xadvance: w - 2
            });
        }
        return {atlas: c, json};
    } catch (err) {
        // COLD door 3c: re-throw our own AtlasErrors unchanged; wrap any other
        // throw (a hostile DOM call) as AtlasError, carrying the original.
        if (err instanceof AtlasError) throw err;
        throw new AtlasError(
            'lite-bmfont: generateAtlas failed while building the atlas from the DOM: ' +
            (err && err.message ? err.message : String(err)),
            'dom', err);
    }
}
