/**
 * Frozen STEP-1 body of the atlas generator (M7). This is the demo's inline
 * `generateAtlas` from `demo/demo-lite-bmfont.html`, moved UNCHANGED and wrapped
 * only in `export function` -- no doors, no banner. It is the checkable artifact
 * behind the verbatim-then-clean method: T8's A6 proves the shipped, doored
 * `Atlas.js:generateAtlas` produces byte-identical descriptors to this frozen
 * copy for every demo argument tuple, so the CLEAN edit provably preserved
 * behaviour even though the verbatim MOVE has no machine proof (there is no DOM
 * in node:test to run the original against).
 *
 * DO NOT add doors here or "fix" it. Its whole value is being frozen. It reads
 * the bare `document` global exactly as the demo did; a caller sets
 * globalThis.document before invoking it.
 */

export function generateAtlasV0(size, fontCSS, fillColor, shadowColor) {
    const chars = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';
    const c = document.createElement('canvas');
    const cols = 16, cellW = size * 1.2 | 0, cellH = size * 1.4 | 0;
    const rows = Math.ceil(chars.length / cols);
    c.width = cols * cellW;
    c.height = rows * cellH;
    const x = c.getContext('2d');
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
}
