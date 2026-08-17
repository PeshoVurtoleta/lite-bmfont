/** @zakkster/lite-bmfont — Zero-GC Bitmap Font Renderer */

/**
 * Largest magnitude `drawFast` can render. The "d.d" form of 1e21 is exactly
 * 24 bytes -- 22 integer digits + '.' + 1 decimal -- which is the whole
 * `_charScratch` buffer. Outside [-DRAWFAST_MAX, DRAWFAST_MAX], and for NaN
 * and +/-Infinity, `drawFast` draws nothing and returns.
 *
 * BOTH ENDPOINTS ARE INCLUSIVE. 1e21 renders; the next representable double
 * above it (1e21 + 131072) does not. That means the obvious pre-clamp
 * `Math.max(-DRAWFAST_MAX, Math.min(DRAWFAST_MAX, v))` always produces a value
 * this method will draw -- which is the whole reason the constant is exported.
 * `>` vs `>=` in the guard is a one-character mutation; T4 pins both sides.
 */
export const DRAWFAST_MAX = 1e21;

export class BitmapFont {
    /**
     * @param {HTMLImageElement | HTMLCanvasElement} imageAtlas
     *   Loaded image atlas containing the glyph sheet.
     * @param {{
     *   common: { lineHeight: number, base: number },
     *   chars: Array<{ id: number, x: number, y: number, width: number, height: number, xoffset: number, yoffset: number, xadvance: number }>,
     *   kernings?: Array<{ first: number, second: number, amount: number }>
     * }} fontJson  Standard BMFont JSON descriptor.
     * @param {{ missingAdvance?: number }} [opts]
     *   Optional policy. `missingAdvance` (default **0**, which is v1.2.x
     *   behaviour byte-for-byte) is the xadvance written into every glyph id
     *   the descriptor did not cover, so an absent glyph leaves a gap instead
     *   of letting the next glyph overprint it (F-12). Must be a finite number
     *   in [0, 32767] or the constructor throws; it is truncated to an integer
     *   by the Int16 store, exactly as a descriptor xadvance is (F-08).
     *   Id 10 (`\n`) is NEVER given a missing advance -- see the id-10 policy
     *   below. Use `hasGlyph(id)` to detect coverage gaps at load time.
     */
    constructor(imageAtlas, fontJson, opts) {
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
        // 256-bit glyph-coverage bitmap, 8 words of 32 bits, THIRTY-TWO bytes.
        // A 256-byte Uint8Array was the obvious form and was rejected: this
        // package publishes 134,680 bytes per font as a number, and 32 is the
        // smallest honest way to answer hasGlyph(). The cost of the bitmap is
        // that hasGlyph must test integrality explicitly (`id === (id | 0)`),
        // which a byte-per-id map would have got for free -- see hasGlyph.
        this._mapped = new Uint32Array(8);

        // Cold path, fail closed. `null is not zero`: an explicitly-passed NaN,
        // null or Infinity is a caller error and throws here, at construction,
        // rather than becoming a silently-truncated 0 in the glyph table. The
        // `!(a && b)` form rejects NaN on both bounds (ROADMAP law 4 idiom).
        let missingAdvance = 0;
        if (opts !== undefined && opts !== null && opts.missingAdvance !== undefined) {
            const m = opts.missingAdvance;
            if (!(m >= 0 && m <= 32767)) {
                throw new RangeError('lite-bmfont: missingAdvance must be a finite number in [0, 32767], got ' + m);
            }
            missingAdvance = m;
        }

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
                // Mark coverage only for INTEGER ids. A fractional id already
                // writes nothing to `glyphs` (a non-integer index on a typed
                // array is discarded by spec), so marking it would make
                // hasGlyph() disagree with the table it describes. Descriptor
                // validation proper is M3's (F-10); this only keeps the two
                // structures consistent with each other.
                if (id === (id | 0)) this._mapped[id >>> 5] |= 1 << (id & 31);
            }
        }

        // ---- id 10 ('\n') is a LAYOUT INSTRUCTION, NOT A GLYPH (F-25) -------
        // Stated policy, not an implementation detail: a descriptor entry for
        // id 10 is DISCARDED. Some BMFont exporters emit one; against such a
        // descriptor v1.2.2 charged 7px of advance in `_measureRange`, ran the
        // kerning chain THROUGH the line break, and -- because `drawWrapped`
        // has no `id === 10` case at all -- drew the newline as a visible 9x9
        // glyph in the middle of a line. `draw` has always disagreed with both.
        //
        // Zeroing all seven slots settles all three at once, at ZERO per-glyph
        // cost: width 0 and height 0 make `gw > 0 && gh > 0` false so no
        // renderer ever passes it to drawImage, and xadvance 0 plus an empty
        // kerning row/column (see the kernings loop) makes `_measureRange`
        // arithmetically identical to `draw`'s skip-and-reset. The alternative
        // -- an `id === 10` branch in `_measureRange` -- was the brief's
        // recommendation and is rejected in decisions/0002 fork (4): it costs a
        // comparison on every glyph of every measure to serve a cold-path fact.
        //
        // It does NOT make `draw` and `drawWrapped` produce the same dx column
        // across a newline; nothing can, because only `draw` breaks the line.
        // T0 law 5 is scoped to newline-free ranges and proves the exclusion.
        const nlPtr = 10 * 7;
        this.glyphs[nlPtr] = 0; this.glyphs[nlPtr + 1] = 0;
        this.glyphs[nlPtr + 2] = 0; this.glyphs[nlPtr + 3] = 0;
        this.glyphs[nlPtr + 4] = 0; this.glyphs[nlPtr + 5] = 0;
        this.glyphs[nlPtr + 6] = 0;
        this._mapped[0] &= ~(1 << 10);

        // ---- F-12: fill uncovered ids, at CONSTRUCTION (ROADMAP law 7) ------
        // The render loop still reads `glyphs[id * 7 + 6]` and does not know
        // anything changed. Zero hot-path bytes. Default 0 => this loop does
        // not run and 1.2.x output is byte-identical.
        if (missingAdvance !== 0) {
            for (let id = 0; id < 256; id++) {
                if (id === 10) continue;
                if ((this._mapped[id >>> 5] >>> (id & 31) & 1) === 0) {
                    this.glyphs[id * 7 + 6] = missingAdvance;
                }
            }
        }

        if (fontJson.kernings) {
            for (let i = 0; i < fontJson.kernings.length; i++) {
                const k = fontJson.kernings[i];
                // The id-10 half of the F-25 policy: a newline is not a glyph,
                // so it cannot be a kerning partner. Dropping these two cases
                // here is what lets `_measureRange` reproduce `draw`'s chain
                // reset with no per-glyph test. (The negative-key hole this
                // condition still has is F-09 and belongs to M3; do not widen
                // the scope of this hunk.)
                if (k.first < 256 && k.second < 256 && k.first !== 10 && k.second !== 10) {
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
            // F-03 REFERENCE FORM. This is the correct polarity and it is the
            // one `draw` and `drawWrapped` were converted to. NaN fails BOTH
            // comparisons, so a NaN id is REJECTED. Do not "simplify" this to
            // `if (id < 0 || id >= 256) continue;` -- that reads perfectly
            // natural, is what the other two sites used to say, and ACCEPTS
            // NaN, which is what poisoned the cursor for a whole line.
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
     * Does the descriptor cover this glyph id? Cold path -- built for a loader
     * that wants to detect coverage gaps at boot instead of discovering them as
     * overlapping text at runtime (F-12).
     *
     * Fail-closed on every non-integer: `NaN`, `-1`, `256`, `65.5` and
     * `undefined` are all `false`. Id 10 is ALWAYS false -- a newline is a
     * layout instruction, not a glyph, and its descriptor entry is discarded at
     * construction. Throws after `destroy()`, like every other read.
     *
     * @param {number} id
     * @returns {boolean}
     */
    hasGlyph(id) {
        return id >= 0 && id < 256 && id === (id | 0) &&
            (this._mapped[id >>> 5] >>> (id & 31) & 1) === 1;
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

            // F-03: NaN-safe, and the SAME idiom as _measureRange:76. The old
            // `id < 0 || id >= 256` form is also false for NaN, which means it
            // ACCEPTED NaN and `cursorX += undefined * scale` poisoned every
            // remaining glyph on the line. Two comparisons before, two after.
            if (!(id >= 0 && id < 256)) continue;

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
     * - |value| > DRAWFAST_MAX (1e21): silently skipped (returns). 1e21 is the
     *   largest magnitude whose "d.d" form fits the 24-byte scratch buffer, and
     *   it IS renderable -- the door is inclusive at both ends. Pre-clamp with
     *   Math.max(-DRAWFAST_MAX, Math.min(DRAWFAST_MAX, v)).
     * - Negative values inside the door: clamped to 0 (so -5 renders "0.0").
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
        // One NaN-safe range test replaces three equality tests and adds the
        // ceiling (F-01, F-02). NaN fails BOTH comparisons, so the negation
        // returns -- the `!(x <= max)` idiom of ROADMAP law 4, whose polarity
        // cannot be written backwards by accident. +Infinity fails the upper
        // bound, -Infinity the lower, so all three documented early returns
        // survive exactly. Large negatives now no-draw instead of clamping to
        // "0.0"; -DRAWFAST_MAX itself is inside the door.
        if (!(value >= -DRAWFAST_MAX && value <= DRAWFAST_MAX)) return;
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
            // Unconditional structural backstop. The door makes this unreachable
            // TODAY; "unreachable" is a claim about today's code, and a silent
            // 24-call NaN storm is what happens when the claim expires. Stays a
            // do..while: a plain while renders ".0" for value 0.
        } while (temp > 0 && len < buf.length);

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
     * **Contract, enforced (1.2.3):**
     *
     * - `lineCount` is floored to an integer and clamped at 0. `NaN`, a
     *   negative, and any value below 1 draw NOTHING and return. (`0.5` drew a
     *   full line in 1.2.2; that was a defect.)
     * - The buffer MUST hold at least `lineCount * 4` floats. Short buffers
     *   THROW a `RangeError` naming both numbers. In 1.2.2 the surplus lines
     *   vanished silently, which no caller could detect.
     * - `startIdx` below 0, or `NaN`, is clamped to 0. `endIdx` above
     *   `text.length`, or `NaN`, is clamped to `text.length`. An `endIdx`
     *   below `startIdx` draws an empty line. Fractional indices are read as
     *   `charCodeAt` reads them: truncated.
     * - `layoutBuffer` may be any indexable with a numeric `length`
     *   (`Float32Array` is the intended type; `Float64Array` and a plain
     *   `Array` behave identically). No type check is performed.
     * - Id 10 (`\n`) inside a line range is NOT a line break here -- lines come
     *   from the layout buffer. It advances 0 and draws nothing.
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
        // F-05 / the lineCount degenerates. Fork (1): CLAMP the index-like
        // value, THROW on the buffer length. Both are per CALL, zero per glyph.
        // `!(lineCount >= 1)` rejects NaN, negatives and everything below one
        // line in a single NaN-safe test; Math.floor then kills the fractional
        // case that drew a whole extra line in 1.2.2.
        const n = !(lineCount >= 1) ? 0 : Math.floor(lineCount);
        if (n === 0) return;
        // A buffer too short cannot produce correct output under ANY
        // interpretation, so it is the one case that throws rather than
        // clamps. `.length` (not `byteLength`) is deliberate: it is what makes
        // a plain Array and a Float64Array work, which the contract promises.
        if (n * 4 > layoutBuffer.length) {
            throw new RangeError('lite-bmfont: layoutBuffer holds ' + layoutBuffer.length +
                ' floats, lineCount ' + n + ' needs ' + (n * 4));
        }
        const tlen = text.length;

        // `cursorY` tracks the baseline of the current line. The user passes `y` as the
        // container's top edge, so we shift down by `base * scale` so the first line's
        // visual TOP — not its baseline — lands at `y` when vAlign=0.
        let cursorY = Math.round(y + this.base * scale);

        // Zero-loop vertical alignment
        if (vAlign > 0 && boxHeight > 0) {
            const totalHeight = n * this.lineHeight * scale;
            if (vAlign === 1) cursorY += Math.round((boxHeight - totalHeight) / 2);
            else if (vAlign === 2) cursorY += Math.round(boxHeight - totalHeight);
        }

        let ptr = 0;

        for (let l = 0; l < n; l++) {
            // F-04: per-LINE index normalization -- two comparisons per line,
            // ZERO per glyph. `!(v >= 0)` and `!(v <= tlen)` each reject NaN,
            // so a NaN or negative index becomes an empty or short line and can
            // never reach charCodeAt(). `startIdx = -1` used to render the
            // whole line at NaN x -- the exact hand-off shape lite-text-layout
            // produces. Fractional indices are deliberately NOT floored:
            // charCodeAt truncates, so 0.5 already reads glyph 0, and a floor
            // here would buy nothing and cost a call (T2 row 6 pins it).
            let startIdx = layoutBuffer[ptr++];
            let endIdx = layoutBuffer[ptr++];
            const lineWidth = layoutBuffer[ptr++];
            const flags = layoutBuffer[ptr++];
            if (!(startIdx >= 0)) startIdx = 0;
            if (!(endIdx <= tlen)) endIdx = tlen;

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
                // F-03, identical to draw:147 and _measureRange:81. Third of
                // three sites; all three now read the same way.
                if (!(id >= 0 && id < 256)) continue;

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
        this.glyphs = this.kerning = this._charScratch = this._mapped = null;
    }
}
export default BitmapFont;

export const VERSION = '1.2.3';
