/**
 * @zakkster/lite-bmfont — Zero-GC Bitmap Font Renderer
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

    constructor(imageAtlas: HTMLImageElement | HTMLCanvasElement, fontJson: BMFontJson);

    /** Pixel width of `text` at `scale`, kerning-aware. */
    measure(text: string, scale?: number): number;

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
     * (`33.4`). NaN/±Infinity return; negatives clamp to 0; decimal rounds to
     * nearest tenth. Atlas must contain glyphs for `'0'`–`'9'` and `'.'`.
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
