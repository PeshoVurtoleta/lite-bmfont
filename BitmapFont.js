/** @zakkster/lite-bmfont — Zero-GC Bitmap Font Renderer */
export class BitmapFont {
    constructor(imageAtlas, fontJson) {
        this.atlas = imageAtlas;
        this.lineHeight = fontJson.common.lineHeight;
        this.base = fontJson.common.base;

        this.glyphs = new Int16Array(256 * 7);
        this.kerning = new Int16Array(65536);

        for (let i = 0; i < fontJson.chars.length; i++) {
            const char = fontJson.chars[i];
            const id = char.id;

            if (id >= 0 && id < 256) {
                const ptr = id * 7;
                this.glyphs[ptr]     = char.x;
                this.glyphs[ptr + 1] = char.y;
                this.glyphs[ptr + 2] = char.width;
                this.glyphs[ptr + 3] = char.height;
                this.glyphs[ptr + 4] = char.xoffset;
                this.glyphs[ptr + 5] = char.yoffset;
                this.glyphs[ptr + 6] = char.xadvance;
            }
        }

        if (fontJson.kernings) {
            for (let i = 0; i < fontJson.kernings.length; i++) {
                const k = fontJson.kernings[i];
                if (k.first < 256 && k.second < 256) {
                    this.kerning[(k.first << 8) | k.second] = k.amount;
                }
            }
        }
    }

    _measureRange(text, start, end, scale) {
        let width = 0;
        let prevId = -1;

        for (let i = start; i < end; i++) {
            const id = text.charCodeAt(i);
            if (id >= 0 && id < 256) {
                if (prevId !== -1) {
                    width += this.kerning[(prevId << 8) | id] * scale;
                }
                width += this.glyphs[id * 7 + 6] * scale;
                prevId = id;
            }
        }
        return width;
    }

    measure(text, scale = 1.0) {
        return this._measureRange(text, 0, text.length, scale);
    }

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {string} text
     * @param {number} x    Baseline X
     * @param {number} y    Baseline Y
     * @param {number} scale
     * @param {number} align  0 = Left, 1 = Center, 2 = Right
     */
    draw(ctx, text, x, y, scale = 1.0, align = 0) {
        const len = text.length;
        if (len === 0) return;

        let cursorX = x;
        let cursorY = Math.round(y);
        let prevId = -1;

        let lineEnd = 0;
        while (lineEnd < len && text.charCodeAt(lineEnd) !== 10) lineEnd++;

        if (align === 1) cursorX -= this._measureRange(text, 0, lineEnd, scale) / 2;
        else if (align === 2) cursorX -= this._measureRange(text, 0, lineEnd, scale);

        cursorX = Math.round(cursorX);

        for (let i = 0; i < len; i++) {
            const id = text.charCodeAt(i);

            if (id === 10) {
                cursorY += this.lineHeight * scale;
                cursorX = x;
                prevId = -1;

                let nextEnd = i + 1;
                while (nextEnd < len && text.charCodeAt(nextEnd) !== 10) nextEnd++;

                if (align === 1) cursorX -= this._measureRange(text, i + 1, nextEnd, scale) / 2;
                else if (align === 2) cursorX -= this._measureRange(text, i + 1, nextEnd, scale);

                cursorX = Math.round(cursorX);
                continue;
            }

            if (id < 0 || id >= 256) continue;

            if (prevId !== -1) {
                cursorX += this.kerning[(prevId << 8) | id] * scale;
            }

            const ptr = id * 7;
            const gw = this.glyphs[ptr + 2];
            const gh = this.glyphs[ptr + 3];

            if (gw > 0 && gh > 0) {
                ctx.drawImage(
                    this.atlas,
                    this.glyphs[ptr], this.glyphs[ptr + 1], gw, gh,
                    cursorX + this.glyphs[ptr + 4] * scale,
                    cursorY + this.glyphs[ptr + 5] * scale - (this.base * scale),
                    gw * scale, gh * scale
                );
            }

            cursorX += this.glyphs[ptr + 6] * scale;
            prevId = id;
        }
    }

    /** Release atlas reference and typed arrays. */
    destroy() {
        this.atlas = null;
        this.glyphs = this.kerning = null;
    }
}
export default BitmapFont;
