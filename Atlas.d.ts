/**
 * @zakkster/lite-bmfont/atlas -- COLD boot-time atlas generator.
 * TypeScript declarations.
 */

import type { BMFontJson } from './BitmapFont.js';

/** The one error `generateAtlas` throws (`name === 'AtlasError'`). */
export declare class AtlasError extends Error {
    name: 'AtlasError';
    /**
     * The offending field, e.g. `'document'`, `'size'`, `'dom'` (a hostile DOM
     * call threw) or `'internal'` (a bug in generateAtlas's own arithmetic --
     * never the caller's DOM). Not exhaustive.
     */
    field: string;
    /** The received value. */
    value: unknown;
    constructor(message: string, field: string, value: unknown);
}

/**
 * COLD, ALLOCATES. Boot-time helper: synthesize a full printable-ASCII mock
 * BMFont atlas from a CSS font and return `{ atlas, json }` ready for
 * `new BitmapFont(atlas, json)`.
 *
 * This is the ONE allocating function in the package -- one canvas, one
 * descriptor and ~95 char entries per call. It is a RATIFIED exception
 * (decisions/0009), NOT a hot path and NOT precedent for allocating elsewhere.
 * Call it once per theme at boot, never in a frame loop.
 *
 * Fails closed with `AtlasError`, never a bare `Error`/`TypeError`: a missing DOM
 * (`globalThis.document.createElement`), a null/unusable `getContext('2d')`, and
 * a hostile DOM whose `createElement`/`getContext`/`measureText`/`fillText` throws
 * are ALL re-thrown as `AtlasError` (carrying the original). A non-integer or
 * out-of-range `size` (must be an integer in `[4, 512]`) throws rather than being
 * normalized -- `size` feeds `common.base`, which `{ checked: true }` would reject.
 *
 * @param size        integer font size in px, 4..512 (feeds `common.base`)
 * @param fontCSS     a CSS `font` shorthand, e.g. `"bold 36px monospace"`
 * @param fillColor   glyph fill color
 * @param shadowColor optional drop-shadow color
 */
export declare function generateAtlas(
    size: number,
    fontCSS: string,
    fillColor: string,
    shadowColor?: string,
): { atlas: HTMLCanvasElement; json: BMFontJson };
