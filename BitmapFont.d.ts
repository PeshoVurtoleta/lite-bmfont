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
     * @param opts Optional policy. `missingAdvance` (default 0, byte-identical to
     *   1.2.x) is the xadvance written into every glyph id the descriptor did not
     *   cover, so an absent glyph leaves a gap instead of overprinting the next
     *   (F-12). Must be a finite number in `[0, 32767]` or the constructor throws
     *   `RangeError`. Id 10 (`\n`) is never given a missing advance -- its
     *   descriptor entry is discarded. Use `hasGlyph` to detect gaps at load time.
     */
    constructor(
        imageAtlas: HTMLImageElement | HTMLCanvasElement,
        fontJson: BMFontJson,
        opts?: { missingAdvance?: number }
    );

    /** Pixel width of `text` at `scale`, kerning-aware. */
    measure(text: string, scale?: number): number;

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
     * nearest tenth. Atlas must contain glyphs for `'0'`-`'9'` and `'.'`.
     *
     * Above 2^53 (9007199254740992) the rendered integer digits are approximate --
     * the value is scaled through a double before digit extraction. Exact below
     * that. Values outside [-DRAWFAST_MAX, DRAWFAST_MAX] draw nothing.
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
     * Render pre-laid-out wrapped text into a bounding box, with horizontal
     * and vertical alignment.
     *
     * `layoutBuffer` is a Float32Array of `lineCount * 4` floats, packed as:
     *   `[startIdx, endIdx, lineWidth (at scale=1), flags]` per line.
     * `flags === 1` appends an `"..."` ellipsis after the line content.
     *
     * `x`/`y` are the container's top-left corner.
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
