/**
 * DOM stub for the atlas generator (M7). There is no DOM in node:test, so this
 * supplies the minimum `document` surface generateAtlas() touches: a canvas with
 * width/height and a 2d context that records nothing.
 *
 * measureText is DETERMINISTIC and deliberately FRACTIONAL --
 * `(ch.charCodeAt(0) % 7) + 3.5` -- so the `Math.ceil(m.width) + 4` in the
 * generator is actually exercised (a whole-number stub would hide it).
 *
 * The ctx no-ops fillText and accepts every property the generator sets
 * (textBaseline, font, fillStyle, shadow*), so the generator runs to completion
 * and its descriptor can be validated by a real BitmapFont in { checked: true }.
 */

export function makeCtxStub() {
    return {
        textBaseline: '',
        font: '',
        fillStyle: '',
        shadowColor: '',
        shadowBlur: 0,
        shadowOffsetX: 0,
        shadowOffsetY: 0,
        fillText() {},
        measureText(ch) {
            return { width: (ch.charCodeAt(0) % 7) + 3.5 };
        },
    };
}

export function makeCanvasStub() {
    return {
        width: 0,
        height: 0,
        getContext(kind) {
            return kind === '2d' ? makeCtxStub() : null;
        },
    };
}

export function makeDocStub() {
    return {
        createElement(tag) {
            return tag === 'canvas' ? makeCanvasStub() : {};
        },
    };
}
