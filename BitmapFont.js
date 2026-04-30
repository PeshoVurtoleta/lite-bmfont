/** @zakkster/lite-bmfont — Zero-GC Bitmap Font Renderer */
export class BitmapFont {
    constructor(imageAtlas, fontJson) {
        this.atlas = imageAtlas;
        this.lineHeight = fontJson.common.lineHeight;
        this.base = fontJson.common.base;

        this.glyphs = new Int16Array(256 * 7);
        this.kerning = new Int16Array(65536);
        this._charScratch = new Uint8Array(24);

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

    /**
     * Zero-GC number renderer. Draws a non-negative number with one decimal place
     * (e.g. 33.4) directly from char codes — no string allocation on the hot path.
     *
     * - NaN, +Infinity, -Infinity: silently skipped (returns).
     * - Negative values: clamped to 0.
     * - Decimal: rounded to nearest tenth (33.49 -> 33.5).
     *
     * Requires the font atlas to contain glyphs for ASCII '0'-'9' (48-57) and '.' (46).
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} value
     * @param {number} x      Baseline X
     * @param {number} y      Baseline Y
     * @param {number} scale
     * @param {number} align  0 = Left, 1 = Center, 2 = Right
     */
    drawFast(ctx, value, x, y, scale = 1.0, align = 0) {
        if (value !== value || value === Infinity || value === -Infinity) return;
        if (value < 0) value = 0;

        // Multiply once on the original value to avoid float-subtraction error
        // (e.g. (1.4 - 1) * 10 can produce 3.999... and floor to "1.3").
        const scaled = Math.round(value * 10);
        const intPart = Math.floor(scaled / 10);
        const decPart = scaled - intPart * 10;

        const buf = this._charScratch;
        let len = 0;

        // 1. Decimal digit (e.g. '4' -> 52)
        buf[len++] = 48 + decPart;
        // 2. Decimal point ('.' -> 46)
        buf[len++] = 46;
        // 3. Integer digits, written backwards
        let temp = intPart;
        do {
            buf[len++] = 48 + (temp % 10);
            temp = Math.floor(temp / 10);
        } while (temp > 0);

        // Measure (iterating backwards through the scratch = forwards through the number)
        let width = 0;
        let prevId = -1;
        for (let i = len - 1; i >= 0; i--) {
            const id = buf[i];
            if (prevId !== -1) width += this.kerning[(prevId << 8) | id] * scale;
            width += this.glyphs[id * 7 + 6] * scale;
            prevId = id;
        }

        let cursorX = x;
        if (align === 1) cursorX -= width / 2;
        else if (align === 2) cursorX -= width;
        cursorX = Math.round(cursorX);
        const cursorY = Math.round(y);

        prevId = -1;
        for (let i = len - 1; i >= 0; i--) {
            const id = buf[i];
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
        this.glyphs = this.kerning = this._charScratch = null;
    }
}
export default BitmapFont;
