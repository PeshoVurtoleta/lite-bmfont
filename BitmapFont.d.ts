/**
 * @zakkster/lite-bmfont -- Zero-GC Bitmap Font Renderer
 * TypeScript declarations.
 */

/** Horizontal alignment used by `draw`, `drawFast`, `drawWrapped`. */
export type Align = 0 | 1 | 2;
/** Vertical alignment used by `drawWrapped`. */
export type VAlign = 0 | 1 | 2;

/** A single glyph descriptor from a standard BMFont JSON. */
export interface BMFontChar {
    id: number;
    x: number;
    y: number;
    width: number;
    height: number;
    xoffset: number;
    yoffset: number;
    xadvance: number;
}

/** A single kerning pair from a standard BMFont JSON. */
export interface BMFontKerning {
    first: number;
    second: number;
    amount: number;
}

/** Minimum BMFont JSON shape required by `BitmapFont`. */
export interface BMFontJson {
    common: { lineHeight: number; base: number };
    chars: BMFontChar[];
    kernings?: BMFontKerning[];
}

/** Options bag for the `BitmapFont` constructor (F-28: unknown keys throw). */
export interface BitmapFontOptions {
    /**
     * The xadvance written into every uncovered glyph id (default `0`,
     * byte-identical to 1.2.x). Finite in `[0, 32767]` or the constructor throws.
     */
    missingAdvance?: number;
    /**
     * Open the LOSSY validation lane (default `false`, must be a boolean). When
     * `true`, an atlas coordinate past Int16, a fractional `xadvance` or `amount`,
     * and an id or kerning key outside `[0, 256)` throw a `BitmapFontError`
     * naming the exact drift, instead of being truncated/skipped silently
     * (F-08 detection). Inputs with no correct reading throw in both lanes.
     */
    checked?: boolean;
}

/**
 * The one error the constructor throws (F-10). Extends `RangeError`, so a
 * `catch (e) { if (e instanceof RangeError) }` around `new BitmapFont(...)` still
 * fires. `field` is the caller-facing field name (e.g. `'chars[0].id'`,
 * `'opts.checked'`); `value` is the received value; `message` starts
 * `lite-bmfont: ` and contains both. 2.0.0 may re-parent this type.
 */
export class BitmapFontError extends RangeError {
    readonly name: 'BitmapFontError';
    readonly field: string;
    readonly value: unknown;
}

export class BitmapFont {
    /** Distance between baselines, in source pixels. */
    readonly lineHeight: number;
    /** Distance from a line's top to its baseline, in source pixels. */
    readonly base: number;

    /**
     * Glyph table. 7 Int16 slots per glyph id (0..255):
     * [0]=x [1]=y [2]=width [3]=height [4]=xoffset [5]=yoffset [6]=xadvance.
     * Public: the documented word-wrap recipe reads `glyphs[id * 7 + 6]`.
     * The stride is a cross-package contract -- changing it is a MAJOR, and
     * that binds M5 (glyph quads) and M7 (atlas subpath).
     */
    readonly glyphs: Int16Array;

    /**
     * Flat 64K kerning LUT keyed by `(first << 8) | second`. Public for the same
     * reason as `glyphs`; the 8-bit key is structural, not a limitation.
     */
    readonly kerning: Int16Array;

    /**
     * The descriptor is validated at construction (F-10): `imageAtlas`, `common`,
     * `common.lineHeight`, `common.base`, `chars` and (when present) `kernings`
     * are checked, and a malformed one throws a `BitmapFontError` naming the
     * field -- no raw `TypeError` escapes. `chars: []` is LEGAL (a coherent
     * zero-glyph font). See {@link BitmapFontOptions} for `missingAdvance` (F-12)
     * and `checked` (F-08 detection). Id 10 (`\n`) is never given a missing
     * advance -- its descriptor entry is discarded. Use `hasGlyph` to detect gaps.
     */
    constructor(
        imageAtlas: HTMLImageElement | HTMLCanvasElement,
        fontJson: BMFontJson,
        opts?: BitmapFontOptions
    );

    /**
     * TOTAL advance of `text` at `scale`, kerning-aware.
     *
     * **It sums across newlines.** `measure('AA\nAA')` on an advance-8 font is
     * `32`, not `16`: this is a total advance, NOT a layout width.
     *
     * Which width do I want:
     * - one explicit range -> {@link BitmapFont.measureLine}
     * - a box that will hold every line -> {@link BitmapFont.measureWidest}
     * - the total advance of the whole string, newlines included -> `measure`
     *
     * Returns **`NaN`** if `text` is not a string, or if `scale` is outside
     * `(0, Infinity)` -- `NaN`, `0`, a negative, or `Infinity` (F-36). A renderer
     * can decline to act; a query cannot decline to answer. Throws after
     * `destroy()`.
     *
     * The text door is `typeof text === 'string'`, so a **boxed** `String`
     * object is rejected and returns `NaN`. That is deliberate: the looser
     * "has a length and a charCodeAt" test admits an object that never
     * terminates.
     *
     * The cross-newline sum is pinned current behaviour, not a feature: 2.0.0
     * promotes `measure` to the widest line.
     */
    measure(text: string, scale?: number): number;

    /**
     * Width of the WIDEST line of `text` at `scale`, kerning-aware -- the number
     * to size or centre a box with, and the one `draw` aligns each line against
     * (F-06). `measureWidest('AA\nAA')` is `16` where `measure` is `32`; for a
     * newline-free string the two are equal.
     *
     * Lines split at `\n` only, and the kerning chain RESETS at the break,
     * matching `draw`. A trailing newline yields a final empty line of width 0,
     * so `'AAA\n'` is `24`, not `0`. One pass, zero allocation.
     *
     * **Can return a NEGATIVE width.** A negative `xadvance` or kerning `amount`
     * is a valid Int16 the constructor accepts, so a line can legitimately
     * measure negative; the result is then the greatest (least negative) line.
     * An empty line measures 0, which is wider than any negative line.
     *
     * Returns **`NaN`** if `text` is not a string or `scale` is outside
     * `(0, Infinity)`. Throws after `destroy()`.
     */
    measureWidest(text: string, scale?: number): number;

    /**
     * Width of ONE range of `text` at `scale`, kerning-aware.
     *
     * `start` and `end` are CLAMPED into `[0, text.length]` and are otherwise
     * left alone -- exactly what `drawWrapped` does to the indices it reads out
     * of a layout buffer, which is what makes this report what `drawWrapped`
     * RENDERS rather than what a raw index walk counts. Fractional indices are
     * read as `charCodeAt` reads them, truncated per iteration, NOT rounded at
     * the boundary. On `'AAAA'` at advance 8: `[-0.5, 2)` is `16` (two glyphs,
     * as drawn), `[0.5, 2.7)` is `24` (three glyphs, as drawn), and
     * `[-Infinity, Infinity)` is `32` and RETURNS (F-34, F-35).
     *
     * The clamp has the same TWO legs `drawWrapped` uses, so a `NaN` bound
     * behaves as the renderer treats it: a `NaN` `start` becomes 0 and a `NaN`
     * `end` becomes `text.length`, which measures the WHOLE line -- `NaN` is
     * what a `Float32Array` layout buffer holds when a layout pass failed.
     *
     * An empty range (after clamping) returns **`0`**, not `NaN`: the sum of an
     * empty set of advances is 0, and it is the width `drawWrapped` renders for
     * that line. A negative `end` measures 0 for the same reason.
     *
     * Returns **`NaN`** if `text` is not a string or `scale` is outside
     * `(0, Infinity)`. Door order is text, then scale, THEN the range, so a bad
     * `scale` with an empty range is `NaN`, not `0`. Throws after `destroy()`.
     */
    measureLine(text: string, start: number, end: number, scale?: number): number;

    /**
     * Does the descriptor cover this glyph id? Fail-closed on every non-integer:
     * `NaN`, `-1`, `256`, `65.5` are all `false`. Id 10 (`\n`) is ALWAYS `false`
     * -- a newline is a layout instruction, not a glyph, and its descriptor entry
     * is discarded at construction. Throws after `destroy()`.
     */
    hasGlyph(id: number): boolean;

    /**
     * Render a (possibly multi-line) string. Newlines (`\n`) advance by `lineHeight`.
     * `x`/`y` is the baseline anchor of the first line.
     *
     * **Pixel-snapped per LINE ORIGIN in X and per BASELINE in Y** -- that is the
     * exact scope of the promise (F-07). EVERY baseline is snapped, not just the
     * first: line `i` lands at
     * `Math.round(y) + Math.round(i * lineHeight * scale)`. Glyph X is
     * deliberately NOT snapped -- only the line origin is rounded, so at
     * `scale` 1.1 a glyph column reads `0, 8.8, 17.6, 26.4...`.
     *
     * A `scale` outside `(0, Infinity)` -- `NaN`, `0`, a negative, or `Infinity` --
     * draws NOTHING and returns (F-11). An `align` outside `{0, 1, 2}` -- including
     * `NaN`, negatives and fractionals -- renders LEFT.
     *
     * A **non-string** `text` -- `null`, `undefined`, a number, an array, or a
     * boxed `String` (`new String('A')`) -- draws NOTHING and returns (F-42).
     * All FIVE text-taking faces carry the same `typeof text !== 'string'` door
     * (`decisions/0004` fork 9): the two text renderers (`draw`, `drawWrapped`)
     * answer a rejected `text` by drawing nothing, the three measure faces by
     * returning `NaN`. `drawFast`
     * takes a number and carries no text door. Silence is a renderer's closed
     * state, not an error signal -- detect a bad `text` with
     * `Number.isNaN(measureWidest(text))`.
     */
    draw(
        ctx: CanvasRenderingContext2D,
        text: string,
        x: number,
        y: number,
        scale?: number,
        align?: Align
    ): void;

    /**
     * Zero-allocation number renderer. Renders `value` with one decimal place
     * (`33.4`). NaN/+/-Infinity return; negatives clamp to 0; decimal rounds to
     * the nearest tenth EXACTLY (`8.45` -> `"8.4"`, via Fast2Sum, not a
     * `value * 10` product -- F-23 closed). Atlas must contain glyphs for
     * `'0'`-`'9'` and `'.'`.
     *
     * Above 2^53 (9007199254740992) every double is an integer and its digits are
     * rendered EXACTLY -- the true value of the double stored, NOT necessarily the
     * literal you typed: `762638538843020900000` renders `"762638538843020853248.0"`,
     * the double that literal became. Values outside [-DRAWFAST_MAX, DRAWFAST_MAX]
     * draw nothing. A `scale` outside `(0, Infinity)` draws NOTHING and returns
     * (F-11), same as `draw`.
     */
    drawFast(
        ctx: CanvasRenderingContext2D,
        value: number,
        x: number,
        y: number,
        scale?: number,
        align?: Align
    ): void;

    /**
     * Zero-allocation INTEGER renderer for counts -- coins, kills, score,
     * seconds. Renders `value` with no decimal point.
     *
     * TRUNCATES toward zero: `1.9` renders `"1"`, not `"2"`. `drawFast` ROUNDS to
     * the nearest tenth. This is deliberate -- `drawFast` renders a measurement,
     * `drawFastInt` renders a count, and a count must never display a threshold it
     * has not crossed.
     *
     * Requires the atlas to contain glyphs for ASCII `'0'`-`'9'` (48-57) ONLY. It
     * does NOT require the `'.'` (46) glyph that `drawFast` requires, so a
     * digits-only atlas can use this method.
     *
     * The ceiling is `DRAWFASTINT_MAX` (`Number.MAX_SAFE_INTEGER`), the
     * CORRECTNESS boundary rather than `drawFast`'s buffer boundary: above 2^53 a
     * double is not integer-exact, so `drawFastInt` refuses the range instead of
     * rendering it. It is exact by construction for every value it admits. NaN,
     * +/-Infinity and out-of-range magnitudes draw nothing and return; negatives
     * clamp to 0 (`-5` renders `"0"`); a `scale` outside `(0, Infinity)` draws
     * NOTHING and returns. The digit loop keeps its loop variables under 2^31 via
     * a hi/lo split, so the BODY boxes no HeapNumber in any tier. A `value` above
     * 2^31 still costs ~16 B/call boxed at the CALL boundary -- caller-side,
     * identical before and after, removable by no library change (F-44 was a
     * misdiagnosis of that box as per-iteration).
     *
     * `ctx.drawImage` MUST NOT re-enter the font: `drawFast` and `drawFastInt`
     * share one 24-byte scratch buffer, and a re-entrant ctx corrupts the outer
     * call's digits. True for `CanvasRenderingContext2D`, not for an arbitrary
     * object with a `drawImage` method.
     */
    drawFastInt(
        ctx: CanvasRenderingContext2D,
        value: number,
        x: number,
        y: number,
        scale?: number,
        align?: Align
    ): void;

    /**
     * Render pre-laid-out wrapped text into a bounding box, with horizontal
     * and vertical alignment.
     *
     * `layoutBuffer` is a Float32Array of `lineCount * 4` floats, packed as:
     *   `[startIdx, endIdx, lineWidth (at the rendered scale), flags]` per line.
     * The `flags` word is read as a bitfield: bit 0 appends an `"..."` ellipsis.
     * It is ToInt32'd first, so `1.0000001` (a Float32 rounding artifact) still
     * fires (F-13). A bit outside the known mask throws under `{ checked: true }`
     * and is ignored otherwise.
     *
     * `x`/`y` are the container's top-left corner. A `scale` outside `(0, Infinity)`
     * draws NOTHING and returns (F-11). An `align` outside `{0, 1, 2}` renders LEFT
     * and a `vAlign` outside `{0, 1, 2}` renders TOP.
     *
     * Contract, enforced (1.2.3):
     * - `lineCount` is floored to an integer and clamped at 0. `NaN`, a negative,
     *   and any value below 1 draw nothing and return.
     * - The buffer MUST hold at least `lineCount * 4` floats. A short buffer throws
     *   `RangeError` naming both numbers.
     * - `startIdx` below 0, or `NaN`, clamps to 0. `endIdx` above `text.length`, or
     *   `NaN`, clamps to `text.length`. `endIdx < startIdx` draws an empty line.
     *   Fractional indices are truncated (as `charCodeAt` reads them), not floored.
     * - `layoutBuffer` may be any indexable with a numeric `length` (`Float64Array`
     *   and a plain `Array` behave identically); no type check is performed.
     * - Id 10 (`\n`) inside a line range is NOT a line break here -- lines come from
     *   the layout buffer. It advances 0 and draws nothing.
     * - **Pixel-snapped per LINE ORIGIN in X and per BASELINE in Y** (F-07, 1.4.0).
     *   Line `l` lands at `anchor + Math.round(l * lineHeight * scale)`, where
     *   `anchor` is the unchanged line-0 anchor `Math.round(y + base * scale)`
     *   plus, at `vAlign` 1/2, the separately rounded centring term. Glyph X is
     *   not snapped.
     * - A **non-string** `text` draws NOTHING and returns (F-42), ahead of the
     *   buffer-length `RangeError` -- there is nothing to draw, so there is no
     *   line count to honour. Same `typeof text !== 'string'` door as `draw` and
     *   the measure family; detect a bad `text` with
     *   `Number.isNaN(measureWidest(text))`.
     */
    drawWrapped(
        ctx: CanvasRenderingContext2D,
        text: string,
        layoutBuffer: Float32Array,
        lineCount: number,
        boxWidth: number,
        boxHeight: number,
        x: number,
        y: number,
        scale?: number,
        align?: Align,
        vAlign?: VAlign
    ): void;

    /** Releases the atlas reference and internal typed arrays. */
    destroy(): void;
}

export default BitmapFont;

export const VERSION: string;

/** Largest magnitude drawFast renders (1e21). Both endpoints inclusive. */
export const DRAWFAST_MAX: number;

/**
 * Largest magnitude drawFastInt renders: Number.MAX_SAFE_INTEGER
 * (9007199254740991, 16 digits). Both endpoints inclusive. The CORRECTNESS
 * boundary, not the buffer boundary -- above 2^53 a double is not integer-exact,
 * so drawFastInt refuses the range (contrast DRAWFAST_MAX, above which drawFast
 * renders the double's EXACT integer value by decimal doubling).
 * The digit loop keeps its loop variables under 2^31 via a hi/lo split, so the
 * body boxes no HeapNumber in any tier; a value above 2^31 still costs ~16 B/call
 * boxed at the call boundary (caller-side, identical before and after -- F-44 was
 * misdiagnosed as per-iteration boxing).
 */
export const DRAWFASTINT_MAX: number;
