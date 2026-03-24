export class BitmapFont {
    readonly lineHeight: number;
    readonly base: number;
    constructor(imageAtlas: HTMLImageElement | HTMLCanvasElement, fontJson: { common: { lineHeight: number; base: number }; chars: Array<{ id: number; x: number; y: number; width: number; height: number; xoffset: number; yoffset: number; xadvance: number }>; kernings?: Array<{ first: number; second: number; amount: number }> });
    measure(text: string, scale?: number): number;
    draw(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, scale?: number, align?: 0 | 1 | 2): void;
    destroy(): void;
}
export default BitmapFont;
