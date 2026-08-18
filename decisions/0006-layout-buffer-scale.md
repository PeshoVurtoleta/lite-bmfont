# 0006 -- the layout buffer's lineWidth scale, reconciled with its producer

Status: accepted
Session: M2a (v1.6.0)
Findings: F-45
Relates-to: decisions/0002 (established the layout-buffer contract this corrects)
Date: 2026-08-19

## The question

`drawWrapped` reads a `lineWidth` out of a caller-supplied layout buffer and uses
it to place a centre- or right-aligned line inside `boxWidth`. bmfont's shipped
contract said that float was "pixel width of this line at scale=1", so the method
multiplied it by `scale` to bring it into the rendered-px space `boxWidth` lives
in:

    if (align === 1) cursorX += (boxWidth - lineWidth * scale) / 2;
    else if (align === 2) cursorX += boxWidth - lineWidth * scale;

The canonical producer of that buffer, `@zakkster/lite-text-layout`'s
`computeWrap`, does NOT emit `lineWidth` at scale 1. Its RANGE-CONTRACT
(`TextLayout.js:289`, drift-guarded byte-identical across four surfaces) states
"lineWidth is at **the rendered scale**", and its body bakes `scale` into every
accumulated advance. So the two operands disagreed by a factor of `scale`, and
every centre/right-aligned wrapped line was mispositioned at any `scale != 1`.

Closed form of the error: centre `lineWidth * (scale - 1) / 2`, right
`lineWidth * (scale - 1)`. Identically zero at `scale = 1`, which is why it
shipped and survived three versions. Confirmed BY EXECUTION against the real
pairing (bmfont 1.5.0 + text-layout 1.2.2): at 2x centre align `drawWrapped` put
the first glyph at -40, off the left edge of the box, where the per-line `draw`
oracle put it at 30.

## D-1 -- convention. ADOPTED: A, `lineWidth@render-scale`.

`drawWrapped` drops `* scale` on both align terms and compares rendered px to
rendered px. The buffer's `lineWidth` is the width already at the rendered scale.

Three reasons, in weight order:

1. text-layout's buffer is INTRINSICALLY scale-specific. `computeWrap` takes
   `scale` and bakes the line-BREAK positions at that scale -- the SAME text is
   one line at 0.5x and two lines at 2x (verified: `'AAA BBB CCC DDD'` in a
   `boxWidth` 200 box wraps to 1 line at 0.5x/1x and 2 lines at 2x). The buffer
   already describes "the layout at scale S" and cannot be re-rendered at another
   scale correctly. bmfont's "one buffer, any render scale" model never worked
   against it, so there was nothing to preserve.
2. The producer's contract is drift-guarded across four surfaces. bmfont's was a
   single Law line that ALSO carried a factually wrong claim about the peer.
3. text-layout is the canonical producer; bmfont is the consumer that documented
   a mismatched assumption. When two packages ship contradictory contracts for
   one float, the consumer yields to the producer's stated, guarded contract.

### Rejected: B, keep `lineWidth@scale1`.

Would break a shipped, drift-guarded contract in ANOTHER package to preserve an
unshipped assumption in this one. It also asks text-layout to stop scaling a
width whose scale is load-bearing to its own break decisions -- there is no
coherent "scale-1 lineWidth" for a buffer whose line breaks moved with scale.

## D-2 -- semver. ADOPTED: MINOR (1.6.0).

M4a shipped a behaviour change as a PATCH because it only altered inputs that
were already broken. This is NOT that. A caller who hand-rolled a scale-1-width
buffer and used centre/right align at `scale != 1` was getting CORRECT output
under bmfont's documented contract and now regresses. That population is
out-of-contract only because the canonical producer is broken today -- so nobody
pairing the two at `scale != 1` is getting correct pixels -- but the honest label
is a MINOR with a loud `Changed (behaviour)` row carrying the closed form and the
2x before/after.

### Rejected: fold into M9 (2.0.0).

Clean, and genuinely the kind of cross-package format change a major exists to
collect. Rejected for one reason: the `@zakkster/lite-text-layout` TL5 session is
blocked on this fix and waits for the major otherwise.

## D-3 -- test wiring. ADOPTED: no published devDependency; two lanes.

`@zakkster/lite-text-layout` already devDeps `@zakkster/lite-bmfont` at `^1.2.3`.
Adding the reverse edge makes the dev cycle explicit and lets a version-floor
bump on either side deadlock the other's CI. bmfont's devDeps stay EXACTLY
`lite-gc-profiler` + `lite-leak`. **No `package.json` entry is added for the
peer** -- lane 2 resolves it only from a local symlink or `npm link`.

- **LANE 1 -- frozen fixture, ALWAYS RUNS.** The exact `Float32Array` rows
  `computeWrap` emits for the test paragraph at 0.5/1/2, plus the producer
  version that generated them (`1.2.2`), are committed in
  `test/torture/fixtures/wrap-lineWidth.mjs`. No dependency, deterministic. This
  lane proves bmfont renders correctly against what the producer actually emits.
- **LANE 2 -- live, runs only when the peer is locally wired.** A `spawnSync`
  child resolves the peer, regenerates the buffers with the real `computeWrap`,
  and prints them; the parent asserts BYTE-IDENTICAL to lane 1.
  - buffers differ -> the producer's contract moved and the fixture is stale.
    DIE, naming both versions. That is the entire point of lane 2.
  - peer unresolvable -> print one `torture: TODO --` line naming what did not
    run and exit 0. A silent skip is FORBIDDEN (it would turn the drift guard
    into a no-op on every machine, which is all of CI).
  - child exit 3 -> markers/resolution moved; the parent turns that into a die().

The fixture is a mockup with a provenance stamp, not a guess: it is generated BY
the producer, and lane 2 is the drift guard that keeps it honest.

## Non-goals, stated so the next editor does not chase them

- `draw`/`drawFast`/`drawFastInt`/`measure` are NOT affected. `draw` measures its
  own glyphs and reads no buffer `lineWidth` (verified: 0 occurrences of
  `lineWidth` in its body). The double-scale existed only in `drawWrapped`, which
  is the only method that reads the layout buffer.
- The glyph loop is byte-identical to `8348bd0`. The fix is pure deletion of two
  multiplies on the per-LINE align path; zero change per glyph, no arity change,
  no new allocation.
- DO NOT "restore symmetry" by reinstating `lineWidth * scale`. It reads like the
  obviously-correct line next to `boxWidth`, and it is exactly the defect. The
  comment at the align block carries a DO-NOT-REINTRODUCE note for this reason.
- No `lite-text-layout` edit. Its contract is authoritative here; a text-side
  change, if ever needed, is a text-layout finding filed there.
