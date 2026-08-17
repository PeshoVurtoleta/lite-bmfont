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

/**
 * The one error type the descriptor door throws (F-10). It EXTENDS `RangeError`
 * so that M2's two existing `RangeError` throws are not made uncatchable: a
 * caller who wrote `catch (e) { if (e instanceof RangeError) ... }` still catches
 * every M3 throw. The two M2 throws are NOT handled uniformly, though. The
 * `missingAdvance` range door widens to `BitmapFontError` (its message gains the
 * `opts.` prefix); the `drawWrapped` short-buffer door deliberately stays a bare
 * `RangeError` (M3-T14, so its pinned "4 / 12" message assertions do not move) --
 * see the "Error type" section of `decisions/0003-descriptor-door.md`. `name` is
 * set explicitly (a subclass otherwise inherits `'RangeError'`), and
 * `field`/`value` are own properties so a caller can branch on the field without
 * parsing English. The message always starts `lite-bmfont: ` and contains both.
 * 2.0.0 may re-parent this type; 1.x may not.
 */
export class BitmapFontError extends RangeError {
    constructor(message, field, value) {
        super(message);
        this.name = 'BitmapFontError';
        this.field = field;
        this.value = value;
    }
}

// ---- descriptor-door constants and predicates (F-08/09/10/13/28/29/30) -------
// COLD. Every line below runs at construction only (ROADMAP law 7); no measured
// window builds a font. FLAG_ELLIPSIS/FLAG_MASK are the ONE per-line cost in
// drawWrapped (fork 8).

/** Bit 0 of the layout flags word: append "..." (F-13). */
const FLAG_ELLIPSIS = 1;
/** Every known layout-flags bit. A bit outside this is a caller error. */
const FLAG_MASK = 1;
/** The only own keys `opts` may carry. Frozen so a caller cannot mutate it. */
const OPTS_ALLOWED = Object.freeze(['missingAdvance', 'checked']);
/** The seven Int16 glyph fields, in slot order, walked by the field door. */
const GLYPH_FIELDS = ['x', 'y', 'width', 'height', 'xoffset', 'yoffset', 'xadvance'];

/** Throw the one library error, naming the caller-facing field and value. */
function _throwField(field, value, detail) {
    throw new BitmapFontError(
        'lite-bmfont: ' + field + ' ' + detail + ', got ' + String(value), field, value);
}

/**
 * The SHARED integer-key predicate (fork 1 amendment 2). One function serves
 * `char.id` and both kerning keys, so their always-throw messages differ only
 * in the field name. `typeof === 'number' && v === (v | 0)` rejects every
 * non-number (a string that coerces is invisible to hasGlyph -- F-29) and every
 * non-finite by construction (`NaN|0 === 0`, `Infinity|0 === 0`), so `NaN` is an
 * always-throw, never a checked-lane case (matrix row 20 vs 21).
 */
function _requireIntKey(value, field) {
    if (typeof value !== 'number' || value !== (value | 0)) {
        _throwField(field, value, 'must be an integer');
    }
}

/**
 * Validate one Int16 glyph/amount field. Non-number and non-finite ALWAYS throw
 * (F-30 amendment 1: no reading of `x: NaN` renders the intended glyph). A finite
 * value outside Int16 range, or a non-integer, is LOSSY-but-interpretable, so it
 * throws only under `checked` and otherwise stores exactly as v1.2.x did (F-08 is
 * detection only; storage is M9). Range is tested before integrality so a huge
 * value reports the wrap, not the truncation.
 */
function _requireNumField(value, field, checked) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        _throwField(field, value, 'must be a finite number');
    }
    if (checked) {
        if (value < -32768 || value > 32767) {
            _throwField(field, value,
                'is outside Int16 range [-32768, 32767] and stores as ' + Int16Array.of(value)[0]);
        }
        if (value !== (value | 0)) {
            _throwField(field, value,
                'is not an integer; the Int16 store truncates it toward zero to ' + (value | 0));
        }
    }
}

/**
 * The `chars`/`kernings` array-shape pre-pass (fork 4). NOT a length test: a
 * string has a numeric length and yields a zero-glyph font (0.1a). Valid iff not
 * a string, integer length in [0, 2^32), and every index yields a non-null
 * object. Runs BEFORE the store loop so a throw leaves no half-built font
 * (atomicity, fork 4 reason i).
 */
function _requireArrayField(arr, field) {
    if (typeof arr === 'string') {
        _throwField(field, arr, 'must be an array, not a string');
    }
    if (arr === null || typeof arr !== 'object') {
        _throwField(field, arr, 'must be an array, not a ' + typeof arr);
    }
    const len = arr.length;
    if (typeof len !== 'number' || len !== (len >>> 0)) {
        _throwField(field + '.length', len, 'must be an integer in [0, 2^32)');
    }
    for (let i = 0; i < len; i++) {
        const el = arr[i];
        if (el === null || typeof el !== 'object') {
            _throwField(field + '[' + i + ']', el, 'must be an object');
        }
    }
}

export class BitmapFont {
    /**
     * @param {HTMLImageElement | HTMLCanvasElement} imageAtlas
     *   Loaded image atlas containing the glyph sheet.
     * @param {{
     *   common: { lineHeight: number, base: number },
     *   chars: Array<{ id: number, x: number, y: number, width: number, height: number, xoffset: number, yoffset: number, xadvance: number }>,
     *   kernings?: Array<{ first: number, second: number, amount: number }>
     * }} fontJson  Standard BMFont JSON descriptor. Validated at construction
     *   (F-10): `imageAtlas`, `common`, `common.lineHeight`, `common.base`,
     *   `chars` and (when present) `kernings` are checked, and a malformed one
     *   throws a `BitmapFontError` naming the field -- no raw `TypeError`
     *   escapes. `chars: []` is LEGAL: it builds a coherent zero-glyph font
     *   whose `measure` is 0 and whose `hasGlyph` is false for every id.
     * @param {{ missingAdvance?: number, checked?: boolean }} [opts]
     *   Optional policy. Must be a plain object or `undefined`/`null`; an
     *   unknown own key throws (F-28), so `{ missingAdvanc: 6 }` -- one dropped
     *   letter -- is an error, not a silent default.
     *   - `missingAdvance` (default **0**, v1.2.x byte-for-byte) is the xadvance
     *     written into every uncovered glyph id, so an absent glyph leaves a gap
     *     instead of letting the next glyph overprint it (F-12). Finite in
     *     [0, 32767] or the constructor throws. Id 10 (`\n`) is never given one.
     *   - `checked` (default **false**, must be a boolean) opens the LOSSY lane.
     *     Two lanes: inputs with no correct reading (a null atlas, a NaN metric,
     *     a non-number id) ALWAYS throw; lossy-but-interpretable inputs (an atlas
     *     coord past Int16, a fractional `xadvance`, an id outside [0, 256)) are
     *     skipped/truncated silently by default and throw only under
     *     `{ checked: true }`, which reports the exact drift (F-08 detection).
     *   Use `hasGlyph(id)` to detect coverage gaps at load time.
     */
    constructor(imageAtlas, fontJson, opts) {
        // ---- descriptor door (F-10), matrix rows 1-11. COLD, fail closed. ---
        // `null is not zero`: no raw TypeError naming an internal property may
        // escape. Runs BEFORE the three assignments, which read the fields it
        // has just proven present and finite.
        if (imageAtlas === null || typeof imageAtlas !== 'object') {
            _throwField('imageAtlas', imageAtlas, 'must be an image or canvas element');
        }
        if (fontJson === null || typeof fontJson !== 'object') {
            _throwField('fontJson', fontJson, 'must be a BMFont descriptor object');
        }
        const _common = fontJson.common;
        if (_common === null || typeof _common !== 'object') {
            _throwField('common', _common, 'must be an object with lineHeight and base');
        }
        if (typeof _common.lineHeight !== 'number' || !Number.isFinite(_common.lineHeight)) {
            _throwField('common.lineHeight', _common.lineHeight, 'must be a finite number');
        }
        if (typeof _common.base !== 'number' || !Number.isFinite(_common.base)) {
            _throwField('common.base', _common.base, 'must be a finite number');
        }

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

        // ---- F-28: the opts bag fails closed (fork 2). COLD. ----------------
        // A default-off validator behind a typo-swallowing bag is unturnable-on,
        // so `checked` is C's precondition and settled first. `opts` must be a
        // plain object or undefined/null; every own key must be in the frozen
        // allowlist (an inherited or misspelled key is unknown and throws); and
        // `checked` must be an exact boolean -- no truthiness on a validator's
        // own switch. The `!(a && b)` missingAdvance test rejects NaN on both
        // bounds (ROADMAP law 4 idiom). M2's behaviour is preserved (same range,
        // same NaN rejection) and the error widens to BitmapFontError (row 40);
        // the message text gains the `opts.` prefix (`opts.missingAdvance`) so
        // it names the field a caller can branch on and so `e.message` contains
        // `e.field` -- a change to the shipped 1.2.x message, noted in CHANGELOG.
        let missingAdvance = 0;
        let checked = false;
        if (opts !== undefined && opts !== null) {
            if (typeof opts !== 'object') {
                _throwField('opts', opts, 'must be an object');
            }
            for (const key in opts) {
                if (!Object.prototype.hasOwnProperty.call(opts, key) || OPTS_ALLOWED.indexOf(key) === -1) {
                    _throwField('opts.' + key, opts[key],
                        'is not a known option (allowed: ' + OPTS_ALLOWED.join(', ') + ')');
                }
            }
            if (Object.prototype.hasOwnProperty.call(opts, 'checked')) {
                if (opts.checked !== true && opts.checked !== false) {
                    _throwField('opts.checked', opts.checked, 'must be a boolean');
                }
                checked = opts.checked;
            }
            if (Object.prototype.hasOwnProperty.call(opts, 'missingAdvance')) {
                const m = opts.missingAdvance;
                if (!(m >= 0 && m <= 32767)) {
                    throw new BitmapFontError(
                        'lite-bmfont: opts.missingAdvance must be a finite number in [0, 32767], got ' + m,
                        'opts.missingAdvance', m);
                }
                missingAdvance = m;
            }
        }
        this.checked = checked;

        // ---- chars/kernings array-shape pre-pass (fork 4), rows 12-18, 27-29.
        // Throws before the store loop and the kernings loop run -- atomicity:
        // a constructor that throws leaves no half-built font.
        _requireArrayField(fontJson.chars, 'chars');
        if (fontJson.kernings !== undefined && fontJson.kernings !== null) {
            _requireArrayField(fontJson.kernings, 'kernings');
        }

        for (let i = 0; i < fontJson.chars.length; i++) {
            const char = fontJson.chars[i];
            const id = char.id;

            // F-29: id must be a real integer (the shared key predicate). A
            // string that coerces, or true/null, writes a glyph the descriptor
            // never named and lies to hasGlyph; NaN/Infinity name no glyph at
            // all. Always-throw in both lanes (matrix row 20 -- NaN is HERE,
            // never the checked lane).
            _requireIntKey(id, 'chars[' + i + '].id');

            if (id >= 0 && id < 256) {
                // F-30 / F-08 detection: validate the seven Int16 fields above
                // the byte-for-byte-M2 stores. Non-finite always throws (no
                // reading of x: NaN renders the glyph); a field past Int16 or a
                // fractional field throws only under checked, else stores as it
                // always did.
                for (let n = 0; n < 7; n++) {
                    _requireNumField(char[GLYPH_FIELDS[n]], 'chars[' + i + '].' + GLYPH_FIELDS[n], checked);
                }
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
            } else if (checked) {
                // F-29 row 21: a FINITE integer id outside the 8-bit range is a
                // legitimate Unicode descriptor this font cannot hold. Skipped
                // (and reported by hasGlyph) by default; named under checked.
                _throwField('chars[' + i + '].id', id, 'is outside the 8-bit range [0, 256)');
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
                const f = k.first;
                const s = k.second;
                // F-09: both keys use the SAME integer predicate as char.id
                // (fork 1 amendment 2), so their messages differ only in the
                // field name. '65', 65.5, true and 255.9 each wrote a pair the
                // descriptor never named (16706 / 322 / ...) -- always-throw now.
                _requireIntKey(f, 'kernings[' + i + '].first');
                _requireIntKey(s, 'kernings[' + i + '].second');
                // amount rides the F-08 lane: non-finite always throws, a lossy
                // amount throws only under checked, else truncates as it did.
                _requireNumField(k.amount, 'kernings[' + i + '].amount', checked);
                // The id-10 half of the F-25 policy stays: a newline is not a
                // glyph, so it cannot be a kerning partner (H7). M2 left the
                // negative-key hole open and named it F-09; M3 closes it by
                // testing BOTH bounds here. A FINITE key outside [0, 256) is
                // skipped by default and named under checked (row 21's twin --
                // the two must not diverge).
                if (f >= 0 && f < 256 && s >= 0 && s < 256) {
                    if (f !== 10 && s !== 10) {
                        this.kerning[(f << 8) | s] = k.amount;
                    }
                } else if (checked) {
                    const bad = (f < 0 || f >= 256) ? 'first' : 'second';
                    _throwField('kernings[' + i + '].' + bad, bad === 'first' ? f : s,
                        'is outside the 8-bit range [0, 256)');
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
     * @param {number} [scale=1.0]  A `scale` outside `(0, Infinity)` -- `NaN`,
     *   `0`, a negative, or `Infinity` -- draws NOTHING and returns (F-11): a bad
     *   scale has one correct silent answer, unlike a short layout buffer.
     * @param {0|1|2} [align=0]  0 = left, 1 = center, 2 = right. Any value
     *   outside `{0, 1, 2}` -- including `NaN`, negatives and fractionals --
     *   renders LEFT (decisions/0003 fork 6).
     */
    draw(ctx, text, x, y, scale = 1.0, align = 0) {
        if (!(scale > 0 && scale < Infinity)) return;
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
     * @param {number} [scale=1.0]  A `scale` outside `(0, Infinity)` draws
     *   NOTHING and returns (F-11), same as `draw`.
     * @param {0|1|2} [align=0]  0 = left, 1 = center, 2 = right. Any value
     *   outside `{0, 1, 2}` renders LEFT (decisions/0003 fork 6).
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
        // F-11 (fork 5): the scale door goes AFTER the magnitude door so
        // decisions/0001's pinned magnitude behaviour keeps first-guard position.
        // Range test, not a NaN test: 0 and -1 are finite and draw zero/negative
        // quads, which a `scale !== scale` check cannot see. Draw nothing, return.
        if (!(scale > 0 && scale < Infinity)) return;
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
     * @param {number} [scale=1.0]  A `scale` outside `(0, Infinity)` draws
     *   NOTHING and returns (F-11).
     * @param {0|1|2} [align=0]   0 = left, 1 = center, 2 = right. Any value
     *   outside `{0, 1, 2}` renders LEFT (decisions/0003 fork 6).
     * @param {0|1|2} [vAlign=0]  0 = top,  1 = middle, 2 = bottom. Any value
     *   outside `{0, 1, 2}` -- including `NaN`, negatives and fractionals --
     *   renders TOP (decisions/0003 fork 7).
     */
    drawWrapped(ctx, text, layoutBuffer, lineCount, boxWidth, boxHeight, x, y, scale = 1.0, align = 0, vAlign = 0) {
        if (!(scale > 0 && scale < Infinity)) return;
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
        // F-13 checked-lane flag: read the per-font boolean ONCE here (per call),
        // not per line, so the per-line `else if (checked && ...)` reads a local.
        const checked = this.checked;

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

            // Draw ellipsis if layout flagged it. F-13 (fork 8): the flags word
            // arrives through a Float32Array, so ToInt32 first -- (flags|0) reads
            // 1.0000001192092896 as 1 and the ellipsis fires. Do NOT simplify
            // back to a strict compare against 1: that miss IS the finding. Bit 0
            // (FLAG_ELLIPSIS) appends "..."; a bit outside FLAG_MASK is a caller
            // error routed to the checked lane.
            const f = flags | 0;
            if (f & FLAG_ELLIPSIS) {
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
            } else if (checked && (f & ~FLAG_MASK)) {
                // F-13 (fork 8): unknown flag bits stop being silent under
                // checked. This costs, on a default font, one per-line test of
                // the hoisted `checked` local (false -> short-circuits before the
                // mask). Flags are per-line runtime data, so the unknown-bit
                // throw cannot hoist to construction; only the `this.checked`
                // READ is hoisted (above the loop). An opt-in checked font also
                // pays the `f & ~FLAG_MASK`.
                _throwField('flags', flags, 'has bits outside the known mask ' + FLAG_MASK);
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

export const VERSION = '1.3.0';
