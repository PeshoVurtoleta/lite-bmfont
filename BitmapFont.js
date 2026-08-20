/** @zakkster/lite-bmfont -- Zero-GC Bitmap Font Renderer */

/**
 * SHARED-SCRATCH CONTRACT (decisions/0005 fork 2). `ctx.drawImage` must not
 * re-enter the font. `drawFast` and `drawFastInt` share one 24-byte scratch
 * buffer (`_charScratch`); a re-entrant ctx corrupts the outer call's digits.
 * This is true for a real CanvasRenderingContext2D, which cannot call back into
 * user code, and false for an arbitrary object with a `drawImage` method. T9
 * control 16 violates the contract deliberately and asserts the corruption is
 * real, so the contract is exercised rather than merely believed.
 */

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
 * Largest magnitude `drawFastInt` can render: Number.MAX_SAFE_INTEGER
 * (9007199254740991, 16 digits). This is the CORRECTNESS boundary, not the
 * buffer boundary -- 24 bytes would hold 24 digits, but above 2^53 a double
 * is not integer-exact and `v % 10` returns arithmetic noise. Rendering 18
 * confident digits of a number that only has 16 is a lie. Contrast
 * DRAWFAST_MAX, which IS the buffer boundary: above 2^53 `drawFast` renders the
 * double's EXACT integer value by decimal doubling (F-23 closed, decisions/0007),
 * so its extra digits are true, not noise -- the two constants answer the same
 * principle applied to different facts (decisions/0005, decisions/0007).
 * The digit loop keeps its loop variables inside Smi range (lo = n % 1e7,
 * hi = (n - lo) / 1e7, both under 2^31), so the BODY boxes no HeapNumber in any
 * V8 tier. This does NOT make a >2^31 call zero-alloc: passing an argument above
 * 2^31 boxes the double at the call boundary (~16 B/call), a caller-side cost
 * identical before and after and removable by no change here. F-44's original
 * "boxing inside the digit loop" mechanism was a misdiagnosis (decisions/0007).
 * Both endpoints INCLUSIVE, so
 * Math.max(-DRAWFASTINT_MAX, Math.min(DRAWFASTINT_MAX, v)) always renders.
 */
export const DRAWFASTINT_MAX = Number.MAX_SAFE_INTEGER;

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
     *
     * **EXPLICITLY UNSAFE. This body has NO door and 1.4.0 did not give it one**
     * (F-34, decisions/0004 fork 3 sub-fork A2). At `start === -Infinity` the
     * `i++` never advances and the loop is unkillable. A clamp here would tax
     * `draw`'s per-line align calls, which pass `0` and a computed `lineEnd`
     * provably in `[0, len]` by construction -- bytes in a hot body to defend
     * against a mistake made somewhere else (ROADMAP law 6).
     *
     * **The precondition every caller keeps: `text` is a string, and `start` and
     * `end` are finite and inside `[0, text.length]`.** The three PUBLIC faces
     * establish it before they call, and T9 control 13 proves that boundary out
     * of process. Use `measureLine` if you did not compute the indices yourself.
     *
     * @param {string} text
     * @param {number} start  Inclusive start index. Must be finite and in [0, len].
     * @param {number} end    Exclusive end index. Must be finite and in [0, len].
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
     * TOTAL advance of `text` at `scale`, kerning-aware.
     *
     * **It SUMS ACROSS NEWLINES.** `measure('AA\nAA')` on an advance-8 font is
     * **32**, not 16: this is a total advance, NOT a layout width. For the width
     * of the widest line -- the number you want when sizing or centring a box
     * that `draw` will fill -- use {@link BitmapFont#measureWidest}. For one
     * explicit range use {@link BitmapFont#measureLine}. The cross-newline sum
     * is PINNED CURRENT BEHAVIOUR, not a feature: 2.0.0 promotes `measure` to
     * the widest line (F-06, decisions/0004 fork 1).
     *
     * Fail signal is **NaN**, shared by the whole measure family
     * (decisions/0004 fork 4). A non-string `text`, or a `scale` outside
     * `(0, Infinity)` -- `NaN`, `0`, a negative, or `Infinity` -- returns NaN.
     * The text door is `typeof text === 'string'`, so a **boxed** `String`
     * object (`new String('AA')`) is REJECTED and returns NaN, deliberately: the
     * looser "has a length and a charCodeAt" test admits
     * `{length: Infinity, charCodeAt(){...}}`, which does not terminate.
     * The asymmetry with the renderers is deliberate: a renderer can decline to
     * act (`draw` draws nothing), a query cannot decline to answer. Door order
     * is text, then scale. Throws after `destroy()`, like every other read.
     *
     * @param {string} text
     * @param {number} [scale=1.0]
     * @returns {number}  NaN if `text` is not a string or `scale` is out of range.
     */
    measure(text, scale = 1.0) {
        // F-36 doors, per CALL, zero per glyph. The text door is `typeof`, NOT
        // an array-like test: `{length: Infinity, charCodeAt(){return 65}}` has
        // a numeric length and a charCodeAt and is exactly the input that hung
        // 1.3.0 forever (F-34). The scale door is a RANGE test, not a NaN test
        // -- `0` and `-1` are finite and returned `0` and a NEGATIVE width,
        // which `scale !== scale` cannot see (ROADMAP law 4 idiom).
        if (typeof text !== 'string') return NaN;
        if (!(scale > 0 && scale < Infinity)) return NaN;
        return this._measureRange(text, 0, text.length, scale);
    }

    /**
     * Width of the WIDEST line of `text` at `scale`, kerning-aware -- the number
     * `draw` aligns each line against, and the one to size a box with (F-06).
     *
     * `measureWidest('AA\nAA')` on an advance-8 font is **16** where `measure`
     * is 32. For a newline-free string the two are equal.
     *
     * Lines are split at id 10 (`\n`) only, and the kerning chain RESETS at the
     * break, exactly as `draw` resets `prevId` there (decisions/0004 fork 6). A
     * trailing newline yields a final empty line of width 0, so `'AAA\n'` is 24,
     * not 0. One pass, no `split`, no `slice`, no array: zero allocation, gated
     * by T6 window E's allocation-VOLUME check. (NOT by its `maxBytesPerCall: 0`
     * lane -- that lane is retention-only and a `split()` implementation passes
     * it. F-37, decisions/0004 correction 6.)
     *
     * Fail signal is **NaN**: a non-string `text` or a `scale` outside
     * `(0, Infinity)`. There is no range door because there is no range
     * (fork 7). Throws after `destroy()`.
     *
     * @param {string} text
     * @param {number} [scale=1.0]
     * @returns {number}  NaN if `text` is not a string or `scale` is out of range.
     */
    measureWidest(text, scale = 1.0) {
        if (typeof text !== 'string') return NaN;
        if (!(scale > 0 && scale < Infinity)) return NaN;

        const len = text.length;
        // -Infinity, NOT 0 (F-39). A negative `xadvance` or a negative kerning
        // amount is a valid Int16 the constructor accepts in BOTH lanes -- it is
        // neither lossy nor non-finite -- so a line CAN legitimately measure
        // negative. Seeding the accumulator at 0 silently floored every such
        // font at 0 and made `measureWidest` disagree with `measure` on a
        // single-line string, which is the one equivalence this method promises.
        // The empty string still returns 0: the final comparison sees
        // `width === 0` and 0 > -Infinity.
        let max = -Infinity;
        let width = 0;
        let prevId = -1;

        for (let i = 0; i < len; i++) {
            const id = text.charCodeAt(i);
            // The ONE extra per-glyph comparison this method pays over
            // _measureRange. Id 10 already advances 0 and kerns 0 for every font
            // (its seven slots are zeroed at construction, F-25), so this branch
            // exists purely to close the line and reset the chain -- which is
            // what makes the answer equal draw's per-line align width.
            if (id === 10) {
                if (width > max) max = width;
                width = 0;
                prevId = -1;
                continue;
            }
            // F-03 REFERENCE FORM, identical to _measureRange. NaN fails BOTH
            // comparisons, so a NaN id is REJECTED.
            if (id >= 0 && id < 256) {
                if (prevId !== -1) {
                    width += this.kerning[(prevId << 8) | id] * scale;
                }
                width += this.glyphs[id * 7 + 6] * scale;
                prevId = id;
            }
        }
        return width > max ? width : max;
    }

    /**
     * Width of ONE range of `text` at `scale`, kerning-aware -- the doored,
     * public face of `_measureRange` (F-34, F-35, decisions/0004 fork 3).
     *
     * `start` and `end` are CLAMPED into `[0, text.length]` with the NaN-safe
     * idiom and are otherwise left alone -- exactly what `drawWrapped` does to
     * the indices it reads out of a layout buffer. That is what makes this
     * method report what `drawWrapped` RENDERS rather than what the raw helper
     * counts: on `'AAAA'` at advance 8, `[-0.5, 2)` is **16** here and **24**
     * through `_measureRange`, and `drawWrapped` draws the two glyphs this
     * number describes. Fractional indices are read as `charCodeAt` reads them,
     * truncated per iteration, so `[0.5, 2.7)` is **24** -- three glyphs, which
     * is again what `drawWrapped` draws. An unbounded range RETURNS:
     * `[-Infinity, Infinity)` is 32, where the raw helper never terminates.
     *
     * An empty range (after clamping) is **0**, not NaN (fork 5): the sum of an
     * empty set of advances is 0, and it is the width `drawWrapped` renders for
     * the same line. NaN means one thing only -- an argument that cannot be used.
     *
     * Fail signal is **NaN**: a non-string `text` or a `scale` outside
     * `(0, Infinity)`. Door order is text, then scale, THEN the range, so a bad
     * `scale` with an empty range is NaN, not 0. Throws after `destroy()`.
     *
     * @param {string} text
     * @param {number} start  Inclusive start index. Clamped into `[0, len]`;
     *   NOT truncated -- a fractional index is read as `charCodeAt` reads it.
     * @param {number} end    Exclusive end index. Clamped into `[0, len]`;
     *   NOT truncated, for the same reason.
     * @param {number} [scale=1.0]
     * @returns {number}  NaN if `text` is not a string or `scale` is out of
     *   range; 0 for an empty range.
     */
    measureLine(text, start, end, scale = 1.0) {
        if (typeof text !== 'string') return NaN;
        if (!(scale > 0 && scale < Infinity)) return NaN;

        // The fork (3) range door: CLAMP ONLY. `!(v >= 0)` and `!(v <= len)`
        // each reject NaN as well as their bound, so nothing non-finite survives
        // to the walk -- which is the whole of F-34. After the clamp both ends
        // are finite and in [0, len] and the counter increments by 1, so the
        // walk terminates; that is the entire termination argument.
        //
        // TWO LEGS, NOT FOUR -- the clamp is `drawWrapped`'s, leg for leg
        // (F-38). There is deliberately NO `if (!(end >= 0)) end = 0;`. A NaN
        // `end` must fall through to `!(end <= len)` and become `len`, because
        // that is what the renderer does with it: a NaN endIdx renders the whole
        // line. An `end >= 0` leg fires FIRST on NaN and drives it to 0 instead,
        // so `measureLine(t, 0, NaN, 1)` reported 0 for a line drawWrapped draws
        // in full. A layoutBuffer is a Float32Array and NaN is exactly what it
        // holds when a layout pass failed or never ran -- the caller this method
        // exists for. A negative `end` still measures 0, via `!(end > start)`,
        // and the renderer's loop never runs either: both 0, no leg needed.
        //
        // DO NOT ADD `Math.trunc` HERE either. It looks like tidying and it
        // silently reintroduces F-35 one method over. `drawWrapped` clamps its
        // indices and does NOT pre-truncate them: it walks a fractional `i` and
        // lets charCodeAt truncate per ITERATION, so [0.5, 2.7) visits 0.5, 1.5
        // and 2.5 and renders THREE glyphs. Truncating both ends here collapses
        // that to [0, 2) and reports two -- a width the renderer will not draw,
        // which is exactly the defect this method exists to remove.
        //
        // Termination still holds, which is the whole of F-34: whatever reaches
        // the walk satisfies `0 <= start < end <= len` with both ends finite, so
        // the counter gets there. NaN and +/-Infinity are all absorbed above.
        const len = text.length;
        if (!(start >= 0)) start = 0;
        if (!(start <= len)) start = len;
        if (!(end <= len)) end = len;
        if (!(end > start)) return 0;

        return this._measureRange(text, start, end, scale);
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
     *
     * **Pixel-snapped, per LINE ORIGIN in X and per BASELINE in Y** -- and that
     * is the exact scope of the promise (F-07, decisions/0004 fork 2). EVERY
     * baseline is snapped, not just the first: line `i` lands at
     * `Math.round(y) + Math.round(i * lineHeight * scale)`. Before 1.4.0 only
     * line 0 was rounded and the rest accumulated raw, so at `scale` 1.1 with
     * `lineHeight` 17 the five baselines were `0, 18.7, 37.4, 56.1, 74.8`; they
     * are now `0, 19, 37, 56, 75`. Glyph X is deliberately **not** snapped: only
     * the line origin is rounded, so a glyph column at `scale` 1.1 reads
     * `0, 8.8, 17.6, 26.4...`. Rounding X per glyph would break the advance
     * conservation law and cost bytes in the glyph loop.
     *
     * A non-string `text` draws NOTHING and returns (F-42, decisions/0004 fork
     * 9) -- the same `typeof` door the measure family answers with NaN. Detect
     * a bad `text` via `Number.isNaN(measureWidest(text))`.
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
        // F-42 text door. The SAME predicate the measure family has carried
        // since 1.4.0 (measure/measureWidest/measureLine), returning instead of
        // NaN because a renderer's closed state is an empty canvas (ROADMAP law
        // 3, decisions/0004 fork 9). NOT an array-like test:
        // {length: Infinity, charCodeAt(){return 65}} has a numeric length and a
        // charCodeAt, and `len` then never bounds the line scan below -- SIGKILL
        // at 6 s in 1.4.0. Per CALL, zero per glyph. Text first, then scale.
        if (typeof text !== 'string') return;
        if (!(scale > 0 && scale < Infinity)) return;
        const len = text.length;
        if (len === 0) return;

        let cursorX = x;
        // ---- F-07, decisions/0004 fork (2), sub-fork B1 ---------------------
        // baseline(i) = Math.round(y) + Math.round(i * lineHeight * scale)
        //
        // ONE round per line from an EXACT per-line product, never from a
        // running float. `Math.round(y)` is computed once and reused as the
        // anchor, so line i sits exactly Math.round(i * step) below the baseline
        // this renderer ACTUALLY used for line 0 (B1). Rejected: B2
        // (`Math.round(y + i * step)`) re-derives every line from a raw `y` the
        // renderer discarded and forces a drawWrapped line-0 delta; A
        // (`Math.round(cursorY + step)`) feeds each line's error into the next
        // and drifts a full pixel over a paragraph. T9 controls 11/12 ship both
        // and both must fail.
        //
        // THE SNAP IS PER LINE ORIGIN IN X, PER BASELINE IN Y -- the whole
        // promise, stated exactly. `cursorX` is rounded once per line and NEVER
        // per glyph: a per-glyph round would break T0 law 1's exact, no-epsilon
        // `walk === _measureRange === oracle` equality, and would put bytes in a
        // hot body to serve a cosmetic preference.
        const anchorY = Math.round(y);
        const step = this.lineHeight * scale;
        let lineIndex = 0;
        let cursorY = anchorY;
        let prevId = -1;

        let lineEnd = 0;
        while (lineEnd < len && text.charCodeAt(lineEnd) !== 10) lineEnd++;

        if (align === 1) cursorX -= this._measureRange(text, 0, lineEnd, scale) / 2;
        else if (align === 2) cursorX -= this._measureRange(text, 0, lineEnd, scale);

        cursorX = Math.round(cursorX);

        for (let i = 0; i < len; i++) {
            const id = text.charCodeAt(i);

            if (id === 10) {
                // F-07 / B1. Per LINE: one multiply, one round, one add, one
                // increment -- replacing one multiply and one add. ZERO per
                // glyph. Do not re-derive this from a running accumulator.
                cursorY = anchorY + Math.round(++lineIndex * step);
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

    // CROSS-REFERENCE (decisions/0007 fork 3). `drawFast`'s digit loops and
    // `drawFastInt`'s (below, after this method's closing brace) are DELIBERATE
    // DUPLICATES and MUST NOT be merged. The old reason ("one is exact, the other
    // is not") EXPIRED when M8b made both exact. The new reason: `drawFast` now
    // carries two regimes and a decimal digit; `drawFastInt` carries neither. A
    // merged helper would push a regime branch and a tenth-computation into a body
    // whose door guarantees neither is reachable -- bytes in a hot body for a
    // branch that never fires. (Comment sits above the JSDoc, outside range A7.)
    /**
     * Zero-GC number renderer. Draws a non-negative number with one decimal place
     * (e.g. 33.4) directly from char codes -- no string allocation on the hot path.
     *
     * - NaN, +Infinity, -Infinity: silently skipped (returns).
     * - |value| > DRAWFAST_MAX (1e21): silently skipped (returns). 1e21 is the
     *   largest magnitude whose "d.d" form fits the 24-byte scratch buffer, and
     *   it IS renderable -- the door is inclusive at both ends. Pre-clamp with
     *   Math.max(-DRAWFAST_MAX, Math.min(DRAWFAST_MAX, v)).
     * - Negative values inside the door: clamped to 0 (so -5 renders "0.0").
     * - Decimal: rounded to the nearest tenth, EXACTLY (8.45 -> 8.4, not 8.5).
     *   The tenth is derived by Fast2Sum, not a `value * 10` product, so the
     *   nearest-tenth guarantee now holds at every magnitude (F-23, decisions/0007).
     * - Above 2^53 every double is an integer and its digits are rendered
     *   EXACTLY -- the true value of the double stored, which is NOT necessarily
     *   the literal you typed: 762638538843020900000 renders
     *   "762638538843020853248.0", because that is the double 762638538843020900000
     *   actually became (decisions/0007 fork 1). This is exact, not approximate.
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

        const buf = this._charScratch;
        let len = 0;

        if (value < 9007199254740992) {
            // REGIME A -- the tenth is exact without a rounded product. f*8 and
            // f*2 are exact (powers of two); Fast2Sum recovers f*10 = s + err
            // exactly, and err breaks the tie that `Math.round(value * 10)` got
            // wrong (F-23 band 1).
            let i = Math.floor(value);
            const f = value - i;
            const a = f * 8, b = f * 2;
            const s = a + b;
            const err = b - (s - a);
            let d = Math.floor(s);
            if ((s - d) + err >= 0.5) d += 1;
            if (d === 10) { d = 0; i += 1; }
            buf[len++] = 48 + d;
            buf[len++] = 46;
            // hi/lo split: both operands stay under 2^31, so the digit loop
            // holds Smi discipline in every tier (F-44 was misdiagnosed as
            // per-iteration boxing; the real >2^31 box is caller-side, at the
            // call boundary, and no body change removes it).
            const lo = i % 1e7;
            const hi = (i - lo) / 1e7;
            let temp = lo;
            if (hi > 0) {
                for (let k = 0; k < 7 && len < buf.length; k++) {
                    buf[len++] = 48 + (temp % 10);
                    temp = (temp - temp % 10) / 10;
                }
                temp = hi;
            }
            do {
                buf[len++] = 48 + (temp % 10);
                temp = (temp - temp % 10) / 10;
                // do..while: a plain while renders ".0" for value 0.
            } while (temp > 0 && len < buf.length);
        } else {
            // REGIME B -- every double at or above 2^53 is an integer, so the
            // tenth is 0 by construction. value = mant * 2^e with mant < 2^53;
            // halving is exact. Emit mant's digits, then double the DECIMAL
            // digits e times in place. e <= 17 for every value the door admits.
            buf[len++] = 48;
            buf[len++] = 46;
            let mant = value, e = 0;
            while (mant > 9007199254740992) { mant /= 2; e++; }
            const lo = mant % 1e7;
            const hi = (mant - lo) / 1e7;
            let temp = lo;
            if (hi > 0) {
                for (let k = 0; k < 7 && len < buf.length; k++) {
                    buf[len++] = 48 + (temp % 10);
                    temp = (temp - temp % 10) / 10;
                }
                temp = hi;
            }
            do {
                buf[len++] = 48 + (temp % 10);
                temp = (temp - temp % 10) / 10;
            } while (temp > 0 && len < buf.length);
            // Double in place on the CHAR CODES already in the scratch: no
            // second array, so the constructor does not move (A7).
            for (let dbl = 0; dbl < e; dbl++) {
                let carry = 0;
                for (let k = 2; k < len; k++) {
                    const xd = (buf[k] - 48) * 2 + carry;
                    if (xd >= 10) { buf[k] = 48 + xd - 10; carry = 1; }
                    else { buf[k] = 48 + xd; carry = 0; }
                }
                // Structural backstop. The door makes overflow unreachable
                // TODAY -- DRAWFAST_MAX fills the scratch to exactly 24 of 24
                // bytes, with no headroom (P-7). Fail closed, do not truncate.
                if (carry) { if (len >= buf.length) return; buf[len++] = 49; }
            }
        }

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
     * Zero-GC integer renderer. Draws a non-negative INTEGER directly from char
     * codes -- no string allocation and no '.' glyph.
     *
     * Differences from `drawFast`, each deliberate (decisions/0005):
     * - TRUNCATES toward zero: 1.9 renders "1", not "2". `drawFast` ROUNDS to
     *   the nearest tenth. This is deliberate -- `drawFast` renders a
     *   measurement, `drawFastInt` renders a count, and a count must never
     *   display a threshold it has not crossed.
     * - No decimal point. Requires the font atlas to contain glyphs for ASCII
     *   '0'-'9' (48-57) ONLY; it does NOT require '.' (46) that `drawFast`
     *   requires, so a digits-only atlas can use this method.
     * - Ceiling is DRAWFASTINT_MAX (Number.MAX_SAFE_INTEGER), the CORRECTNESS
     *   boundary: exact by construction for every admitted value, where
     *   `drawFast`'s DRAWFAST_MAX is the buffer boundary.
     *
     * NaN, +/-Infinity and |value| > DRAWFASTINT_MAX draw nothing and return.
     * Negative values inside the door clamp to 0 (-5 renders "0"). A `scale`
     * outside `(0, Infinity)` draws nothing and returns.
     *
     * `ctx.drawImage` MUST NOT re-enter the font (shared-scratch contract, see
     * the file header and decisions/0005 fork 2).
     *
     * The digit loop keeps its loop variables inside Smi range (lo = n % 1e7,
     * hi = (n - lo) / 1e7, both under 2^31), so the BODY boxes no HeapNumber in
     * any tier. A value above 2^31 still costs ~16 B/call boxed at the CALL
     * boundary -- caller-side, identical before and after, removable by no library
     * change (F-44 was misdiagnosed as per-iteration boxing; decisions/0007).
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} value
     * @param {number} x      Baseline X
     * @param {number} y      Baseline Y
     * @param {number} [scale=1.0]  A `scale` outside `(0, Infinity)` draws
     *   NOTHING and returns (F-11), same as `drawFast`.
     * @param {0|1|2} [align=0]  0 = left, 1 = center, 2 = right. Any value
     *   outside `{0, 1, 2}` renders LEFT (decisions/0003 fork 6).
     */
    drawFastInt(ctx, value, x, y, scale = 1.0, align = 0) {
        // Magnitude door FIRST (F-11 fork 5 keeps decisions/0001's pinned
        // magnitude behaviour in first-guard position). One NaN-safe range test:
        // NaN fails both comparisons, +Infinity fails the upper bound,
        // -Infinity the lower. ROADMAP law 4's `!(x >= min && x <= max)`.
        if (!(value >= -DRAWFASTINT_MAX && value <= DRAWFASTINT_MAX)) return;
        // RANGE test, not a NaN test: 0 and -1 are finite and draw zero/negative
        // quads, which `scale !== scale` cannot see. Draw nothing, return.
        if (!(scale > 0 && scale < Infinity)) return;
        if (value < 0) value = 0;

        // TRUNCATE, do not round (decisions/0005 fork 3): drawFast renders a
        // MEASUREMENT and rounds to the nearest tenth; this renders a COUNT, and
        // a count must never display a threshold it has not crossed. 1.9 -> "1".
        // Rounding would also reintroduce F-23 band 1 here: Math.floor(v + 0.5)
        // near 2^53 adds a quantity below the ulp. Math.trunc is exact for every
        // admitted value.
        let n = Math.trunc(value);

        // SHARED with drawFast (decisions/0005 fork 2). Safe because neither body
        // is re-entrant; ctx.drawImage must not call back into the font. T9
        // control 16 violates that and proves the corruption is real.
        const buf = this._charScratch;
        let len = 0;

        // DUPLICATED from drawFast, deliberately. DO NOT extract a shared helper:
        // a call frame on two hot paths to save twelve source lines is ROADMAP
        // law 6 inverted. DO NOT harmonise the two loops either -- THIS one is
        // exact by construction because the door admits only integer-exact
        // doubles (|n| <= 2^53-1 => n % 10 is exact, by induction). drawFast now
        // carries two regimes and a decimal digit this body never needs
        // (decisions/0007 fork 3).
        // hi/lo split: lo = n % 1e7 and hi = (n - lo) / 1e7 are both under 2^31,
        // so every loop variable stays inside Smi range -- the body boxes no
        // HeapNumber in any tier (source-level Smi discipline; also the throughput
        // Smi-knee of decisions/0005 0.4b). It does NOT zero the ~16 B/call a
        // >2^31 argument costs at the call boundary: that box is caller-side and
        // unchanged by this split (F-44 was misdiagnosed). n <= 2^53-1 so hi is at
        // most 900719925 < 2^31.
        // The bound is an unconditional structural backstop: the door makes it
        // unreachable TODAY, and "unreachable" is a claim about today's code.
        // do..while, not while: value 0 must render "0" (one glyph).
        const lo = n % 1e7;
        const hi = (n - lo) / 1e7;
        let temp = lo;
        if (hi > 0) {
            for (let k = 0; k < 7 && len < buf.length; k++) {
                buf[len++] = 48 + (temp % 10);
                temp = (temp - temp % 10) / 10;
            }
            temp = hi;
        }
        do {
            buf[len++] = 48 + (temp % 10);
            temp = (temp - temp % 10) / 10;
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
     * which character ranges belong to which line -- no string splitting, no array
     * allocation per frame.
     *
     * **Layout buffer format** -- `lineCount` consecutive 4-tuples of Float32:
     *
     *     [0] startIdx  -- start char index into `text` (inclusive)
     *     [1] endIdx    -- end char index into `text` (exclusive)
     *     [2] lineWidth  - pixel width of this line **at the RENDERED scale**
     *                      (compared directly against boxWidth; F-45)
     *     [3] flags     -- 0 = normal line; 1 = append "..." ellipsis after content
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
     * - **Pixel-snapped per LINE ORIGIN in X and per BASELINE in Y** (F-07,
     *   1.4.0). Line `l` lands at `anchor + Math.round(l * lineHeight * scale)`,
     *   where `anchor` is the unchanged line-0 anchor
     *   `Math.round(y + base * scale)` plus, at `vAlign` 1/2, the separately
     *   rounded centring term. At `vAlign` 0 that is exactly `draw`'s baseline
     *   sequence plus `Math.round(base * scale)`. Glyph X is not snapped.
     *
     * The ellipsis flag is for layout engines that truncated a line and want the
     * renderer to append "..." without paying for a separate string. Requires
     * ASCII '.' (code 46) in the atlas.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {string} text         Original text the layout buffer indexes into.
     *   A non-string draws NOTHING and returns (F-42, decisions/0004 fork 9),
     *   ahead of the F-05 buffer-length check -- there is nothing to draw.
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
        // F-42 text door -- see draw()'s. Same predicate the measure family
        // carries, returning (a renderer's closed state is an empty canvas).
        // Text first, then scale; per CALL, zero per glyph.
        if (typeof text !== 'string') return;
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
        // F-42: this read is why the door above exists. The F-04 clamp leg
        // `if (!(endIdx <= tlen)) endIdx = tlen;` is a test AGAINST tlen, so an
        // Infinity tlen PASSES an Infinity endIdx straight through and the glyph
        // walk never terminates. The clamp is sound only while text.length is
        // finite; nothing said so before 1.4.1.
        const tlen = text.length;

        // `cursorY` tracks the baseline of the current line. The user passes `y` as the
        // container's top edge, so we shift down by `base * scale` so the first line's
        // visual TOP -- not its baseline -- lands at `y` when vAlign=0.
        let cursorY = Math.round(y + this.base * scale);

        // Zero-loop vertical alignment
        if (vAlign > 0 && boxHeight > 0) {
            const totalHeight = n * this.lineHeight * scale;
            if (vAlign === 1) cursorY += Math.round((boxHeight - totalHeight) / 2);
            else if (vAlign === 2) cursorY += Math.round(boxHeight - totalHeight);
        }

        // ---- F-07, decisions/0004 fork (2), sub-fork B1 ---------------------
        // baseline(l) = anchorY + Math.round(l * lineHeight * scale), and at
        // vAlign 0 that is exactly draw's sequence plus Math.round(base*scale).
        //
        // The line-0 anchor ABOVE is UNCHANGED in 1.4.0, including the two
        // composed rounds at vAlign 1/2. `round(a) + round(b)` is not
        // `round(a + b)`, so collapsing them MOVES line 0 by a pixel at a
        // fractional centring term -- an undeclared delta that must not ship.
        // B1 was chosen precisely so it costs nothing: the per-line term is
        // added to the anchor the method already computed, never re-derived
        // from the raw `y`.
        //
        // THE SNAP IS PER LINE ORIGIN IN X, PER BASELINE IN Y. `cursorX` is
        // rounded once per line below and NEVER per glyph -- a per-glyph round
        // would break T0 law 1's exact, no-epsilon three-way equality.
        const anchorY = cursorY;
        const step = this.lineHeight * scale;

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

            // Zero-loop horizontal alignment. `lineWidth` arrives at the
            // RENDERED scale, per @zakkster/lite-text-layout's RANGE-CONTRACT
            // (its producer bakes `scale` into the width; TextLayout.js:289 says
            // so in words, drift-guarded across four surfaces). `boxWidth` is
            // rendered px (see :1027). Both operands are rendered px -- compare
            // them DIRECTLY (F-45, decisions/0006, 1.6.0).
            //
            // DO NOT REINTRODUCE `lineWidth * scale`. It reads like the
            // obviously-correct line next to `boxWidth`, and it is exactly the
            // defect: at scale != 1 it double-scaled the width and pushed every
            // centre/right line off by `lineWidth * (scale - 1)` (2x centre put
            // the first glyph off the left edge of the box). Zero at scale 1,
            // which is why it shipped for three versions. "Restoring symmetry"
            // here re-opens F-45.
            if (align > 0 && boxWidth > 0) {
                if (align === 1) cursorX += (boxWidth - lineWidth) / 2;
                else if (align === 2) cursorX += boxWidth - lineWidth;
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

            // F-07 / B1. Per LINE: one multiply, one round, one add -- replacing
            // one multiply and one add. ZERO per glyph. `l + 1` because `l` is
            // still this line's index; the next line is one below the anchor.
            cursorY = anchorY + Math.round((l + 1) * step);
        }
    }

    /** Release atlas reference and typed arrays. */
    destroy() {
        this.atlas = null;
        this.glyphs = this.kerning = this._charScratch = this._mapped = null;
    }
}
export default BitmapFont;

export const VERSION = '1.8.0';
