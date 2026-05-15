/** @zakkster/lite-bmfont — Zero-GC Bitmap Font Renderer */
export class BitmapFont {
    /**
     * @param {HTMLImageElement | HTMLCanvasElement} imageAtlas
     *   Loaded image atlas containing the glyph sheet.
     * @param {{
     *   common: { lineHeight: number, base: number },
     *   chars: Array<{ id: number, x: number, y: number, width: number, height: number, xoffset: number, yoffset: number, xadvance: number }>,
     *   kernings?: Array<{ first: number, second: number, amount: number }>
     * }} fontJson  Standard BMFont JSON descriptor.
     */
    constructor(imageAtlas, fontJson) {
        this.atlas = imageAtlas;
        this.lineHeight = fontJson.common.lineHeight;
        this.base = fontJson.common.base;

        // 7 Int16 slots per glyph id (0..255):
        //   [0]=x, [1]=y, [2]=width, [3]=height, [4]=xoffset, [5]=yoffset, [6]=xadvance
        this.glyphs = new Int16Array(256 * 7);
        // Flat 64K kerning LUT, keyed by (first << 8) | second. Trades 128KB for O(1) lookup.
        this.kerning = new Int16Array(65536);
        // Reusable scratch for drawFast's char-code buffer. Max width of a 64-bit float
        // rendered with one decimal is well under 24 bytes.
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

    /**
     * Pixel width of a substring at `scale`, kerning-aware. Internal hot-path helper.
     * @param {string} text
     * @param {number} start  Inclusive start index.
     * @param {number} end    Exclusive end index.
     * @param {number} scale
     * @returns {number}
     */
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

    /**
     * Pixel width of `text` at `scale`, kerning-aware.
     * @param {string} text
     * @param {number} [scale=1.0]
     * @returns {number}
     */
    measure(text, scale = 1.0) {
        return this._measureRange(text, 0, text.length, scale);
    }

    /**
     * Render a (possibly multi-line) string. Newlines (`\n`) advance by `lineHeight`.
     * Pixel-snapped baseline for crisp pixel fonts.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {string} text
     * @param {number} x      Baseline X (left/center/right anchor point per `align`)
     * @param {number} y      Baseline Y of the first line
     * @param {number} [scale=1.0]
     * @param {0|1|2} [align=0]  0 = left, 1 = center, 2 = right
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
     * @param {number} [scale=1.0]
     * @param {0|1|2} [align=0]  0 = left, 1 = center, 2 = right
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

    /**
     * Render pre-laid-out wrapped text into a bounding box, with horizontal
     * and vertical alignment. The caller supplies a typed-array layout describing
     * which character ranges belong to which line — no string splitting, no array
     * allocation per frame.
     *
     * **Layout buffer format** — `lineCount` consecutive 4-tuples of Float32:
     *
     *     [0] startIdx  — start char index into `text` (inclusive)
     *     [1] endIdx    — end char index into `text` (exclusive)
     *     [2] lineWidth — pixel width of this line **at scale=1** (used for alignment)
     *     [3] flags     — 0 = normal line; 1 = append "..." ellipsis after content
     *
     * Buffer must contain at least `lineCount * 4` floats. Excess capacity is ignored.
     *
     * The ellipsis flag is for layout engines that truncated a line and want the
     * renderer to append "…" without paying for a separate string. Requires
     * ASCII '.' (code 46) in the atlas.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {string} text         Original text the layout buffer indexes into.
     * @param {Float32Array} layoutBuffer  See format above.
     * @param {number} lineCount    Number of valid line entries in `layoutBuffer`.
     * @param {number} boxWidth     Container width (px at the rendered scale). Used for H-align.
     * @param {number} boxHeight    Container height (px at the rendered scale). Used for V-align.
     * @param {number} x            Container top-left X.
     * @param {number} y            Container top-left Y.
     * @param {number} [scale=1.0]
     * @param {0|1|2} [align=0]   0 = left, 1 = center, 2 = right
     * @param {0|1|2} [vAlign=0]  0 = top,  1 = middle, 2 = bottom
     */
    drawWrapped(ctx, text, layoutBuffer, lineCount, boxWidth, boxHeight, x, y, scale = 1.0, align = 0, vAlign = 0) {
        if (lineCount === 0) return;

        // `cursorY` tracks the baseline of the current line. The user passes `y` as the
        // container's top edge, so we shift down by `base * scale` so the first line's
        // visual TOP — not its baseline — lands at `y` when vAlign=0.
        let cursorY = Math.round(y + this.base * scale);

        // Zero-loop vertical alignment
        if (vAlign > 0 && boxHeight > 0) {
            const totalHeight = lineCount * this.lineHeight * scale;
            if (vAlign === 1) cursorY += Math.round((boxHeight - totalHeight) / 2);
            else if (vAlign === 2) cursorY += Math.round(boxHeight - totalHeight);
        }

        let ptr = 0;

        for (let l = 0; l < lineCount; l++) {
            const startIdx = layoutBuffer[ptr++];
            const endIdx = layoutBuffer[ptr++];
            const lineWidth = layoutBuffer[ptr++];
            const flags = layoutBuffer[ptr++];

            let cursorX = x;

            // Zero-loop horizontal alignment. `lineWidth` is at scale=1 per contract,
            // so we multiply by `scale` to compare against `boxWidth` (rendered px).
            if (align > 0 && boxWidth > 0) {
                if (align === 1) cursorX += (boxWidth - lineWidth * scale) / 2;
                else if (align === 2) cursorX += boxWidth - lineWidth * scale;
            }

            // Pixel-snap once per line (matches draw()'s behavior).
            cursorX = Math.round(cursorX);

            let prevId = -1;

            for (let i = startIdx; i < endIdx; i++) {
                const id = text.charCodeAt(i);
                if (id < 0 || id >= 256) continue;

                if (prevId !== -1) cursorX += this.kerning[(prevId << 8) | id] * scale;

                const gPtr = id * 7;
                const gw = this.glyphs[gPtr + 2];
                const gh = this.glyphs[gPtr + 3];

                if (gw > 0 && gh > 0) {
                    ctx.drawImage(
                        this.atlas,
                        this.glyphs[gPtr], this.glyphs[gPtr + 1], gw, gh,
                        cursorX + this.glyphs[gPtr + 4] * scale,
                        cursorY + this.glyphs[gPtr + 5] * scale - (this.base * scale),
                        gw * scale, gh * scale
                    );
                }
                cursorX += this.glyphs[gPtr + 6] * scale;
                prevId = id;
            }

            // Draw ellipsis if layout flagged it
            if (flags === 1) {
                const dotPtr = 46 * 7;
                const gw = this.glyphs[dotPtr + 2];
                const gh = this.glyphs[dotPtr + 3];
                const xadv = this.glyphs[dotPtr + 6] * scale;

                if (gw > 0 && gh > 0) {
                    // Kern between the trailing glyph and the first '.' for parity with how
                    // a layout engine would have measured a run that ended in '.'.
                    if (prevId !== -1) cursorX += this.kerning[(prevId << 8) | 46] * scale;

                    for (let d = 0; d < 3; d++) {
                        ctx.drawImage(
                            this.atlas,
                            this.glyphs[dotPtr], this.glyphs[dotPtr + 1], gw, gh,
                            cursorX + this.glyphs[dotPtr + 4] * scale,
                            cursorY + this.glyphs[dotPtr + 5] * scale - (this.base * scale),
                            gw * scale, gh * scale
                        );
                        cursorX += xadv;
                    }
                }
            }

            cursorY += this.lineHeight * scale;
        }
    }

    /** Release atlas reference and typed arrays. */
    destroy() {
        this.atlas = null;
        this.glyphs = this.kerning = this._charScratch = null;
    }
}
export default BitmapFont;
