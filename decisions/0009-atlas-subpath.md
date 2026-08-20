# 0009 -- the atlas generator as a subpath export (F-18)

Status: accepted
Session: M7 (v1.8.0)
Findings: F-18 (closed -- the duplicated demo helper becomes a shipped utility)
Relates-to: decisions/0003-descriptor-door.md (its { checked: true } door is what
  makes the size question a THROW, not a normalize)
Date: 2026-08-20

## The question

`generateAtlas` was defined inline in `demo/demo-lite-bmfont.html` and called
four times from it -- the demo's only way to produce a runnable font without
shipping a binary atlas. F-18 named that a duplication: a helper worth shipping
lived in a file that is not shipped. M7 promotes it. Three things had to be
decided: WHERE it lives against the "single PascalCase main file" Law, WHETHER it
may allocate, and WHAT it does with a `size` the descriptor door would reject.

The one sentence for the whole decision: **`generateAtlas` ships as its own
subpath `Atlas.js` (never folded into the core, never a second package), it MAY
allocate because it is a boot-time cold path and that exception is labelled in
four places so it is never cited as precedent, and a fractional or out-of-range
`size` THROWS a named `AtlasError` rather than being normalized.**

## Fork (1) -- WHERE. Subpath `Atlas.js`. RATIFIED (option A).

Options:

- **A. A subpath `Atlas.js` + `Atlas.d.ts`.** The core stays one file, imports
  nothing, keeps `sideEffects: false`, and is never loaded unless asked for.
- **B. Fold into `BitmapFont.js` behind a `typeof document` guard.**
- **C. A separate package.**

**Decision: A. RATIFIED.**

**B is rejected, and the reason is stronger than "the Law says one file".** B
puts a DOM reference into the module that `test/packaging.test.js` and every
`node:test` file in this repo imports in Node. It does not break those imports --
the guard hides the DOM at run time -- but it makes the package's DOM-free claim
a statement about a DEAD BRANCH instead of about the file. The core's
importability in a DOM-free Node process is load-bearing for this repo's OWN gate
(T8 imports both entry points in a clean child), not merely a courtesy to
consumers. A claim you can only make about a branch that never runs is not a
claim worth gating. A keeps the DOM in a file the core never touches, so the
core's DOM-freedom is a property of the source, checkable by import.

**C is rejected as overhead without a constituency.** A whole package -- its own
`package.json`, version, CHANGELOG, llms.txt, release cadence -- for 40 lines
with exactly one consumer, and it would be the suite's first package that exists
only to hold a helper. The Law's intent is one module, no build step, no bundler
required; a subpath satisfies that intent for the core while giving the helper a
home. This reading is the precedent the next package that wants a subpath will
cite: a subpath is admissible when it keeps the MAIN file single, importless and
side-effect-free, and the subpath is itself a single file that the main file does
not depend on.

## Fork (2) -- ALLOCATION. `generateAtlas` MAY allocate. RATIFIED, and LABELLED.

The suite Law is "zero allocation on any hot path." `generateAtlas` returns
`{ atlas, json }` -- one canvas, one descriptor object, ~95 char entries -- and
cannot do otherwise: a BMFont descriptor IS an object graph. It is a **boot-time
cold path**, called once per theme, never in a frame loop.

**Decision: it allocates, and the exception is LABELLED in four places** -- the
`Atlas.js` header, `Atlas.d.ts`, `llms.txt`, and this ADR -- each marking it COLD
and each stating it is NOT precedent. The reasoning: an unlabelled exception
becomes a convention. If the only record of "this may allocate" is the absence of
a gate, the next author reads silence as permission. Two guards fall out: (a)
nobody "optimizes" it into an out parameter -- the label says the allocation is
intended, not an oversight; (b) nobody cites it to justify allocating on a real
hot path -- the label says COLD, boot-time, once-per-theme, explicitly not
precedent. The retention is still PROVEN (T8/A2): 200 calls, results dropped,
every returned atlas registered with lite-leak, `tracker.size()` back to 0 after
gc. "May allocate" is not "may leak."

## Fork (3) -- a bad `size`. THROW, do not normalize. RATIFIED.

`size` passes straight into `common.base` and also drives `cellW`/`cellH` (which
are already `| 0`-truncated, so only `base` is a raw pass-through). The descriptor
door (decisions/0003) under `{ checked: true }` rejects a fractional `base`.

Options: **A** throw on a non-integer / out-of-range `size`; **B** normalize it
(`size | 0`, clamp) and proceed.

**Decision: A. `Number.isInteger(size) && size >= 4 && size <= 512`, else throw
`AtlasError`.**

**B is rejected because it launders a caller bug.** `generateAtlas(36.5, ...)`
under B would silently render at 36 (or 37) -- a size the caller did not ask for
-- and hand back a descriptor the `{ checked: true }` door would have caught.
Normalizing moves the defect from a loud throw AT THE SOURCE to a silent wrong
render downstream, which is exactly the "fail closed on every unverified state"
Law inverted. A caller who wants a rounded size rounds it; the helper does not
guess. The upper bound `512` is a sanity ceiling (a 512px cell atlas is already
~8K x 4K); it is not a correctness boundary, only a fail-loud guard against an
accidental gigantic allocation.

The lower bound `4` is DERIVED, not picked. Glyph `height` is `cellH - 4` with
`cellH = (size * 1.4) | 0`, so a positive height needs `cellH >= 5`, i.e.
`size * 1.4 >= 5`, i.e. `size >= 3.58` -- the smallest integer is `4` (`cellH` 5,
`height` 1). Sizes 1..3 give `cellH` 1/2/4 and `height` -3/-2/0: a geometrically
meaningless descriptor that `{ checked: true }` waves through because -3/-2/0 are
valid Int16. The same "fail closed" argument that throws on a fractional `base`
throws here -- a descriptor whose own validator accepts it but whose geometry is
nonsense is exactly the silent-wrong-render the door exists to stop.

## Fork (4) -- the DOM door. NAMED error at CALL time. RATIFIED.

The DOM is read as `globalThis.document` INSIDE `generateAtlas`, at call time,
never at module scope -- so `import('./Atlas.js')` in Node resolves without a
throw (or `sideEffects: false` is a lie and the T8 import proof is untestable).
Called without a DOM, it throws `AtlasError` with a message starting
`lite-bmfont: generateAtlas requires a DOM`, **never** a bare
`TypeError: Cannot read properties of undefined`. Module scope inert; call time
fails closed and loudly. Both directions are gated (T8/A3).

The door is not just the `document` presence check. Three more unverified states
downstream all fail closed as `AtlasError`, because a shipped doc that promises
"never a bare TypeError" is false the moment ONE bare throw escapes (qa caught
exactly this on the first cut): (a) `createElement` returns an element with no
`getContext`; (b) `getContext('2d')` returns `null` (a real browser does this
under memory pressure -- "null is not zero"); (c) a HOSTILE `document` whose
`createElement`/`getContext`/`measureText`/`fillText` THROWS. The whole DOM
interaction is wrapped: any non-`AtlasError` throw is re-thrown as `AtlasError`
carrying the original, and our own doors' `AtlasError`s pass through unchanged.
`A3(context)` in `test/findings.test.js` exercises all of (a)/(b)/(c), each with
the mutation that removes the guard and reddens it.

## Process note -- the reservation habit, a SECOND time

This ADR is `0009`, not the `0007` the M7 brief reserved. `0007` was taken by M8b
(`decisions/0007-drawfast-exact-digits.md`), and `0008` is M2b's ASCII gate. The
FIRST time this reservation habit bit, it cost M8b its 1.6.0 stamp; this is the
second. It is the exact failure `ROADMAP.md` section 4's "DECISION NUMBERS ARE
ISSUED AT PLAN TIME" rule names. Recorded here in the ADR's own body so the rule
has evidence it is real: reserve nothing at brief time -- number at plan time,
against the tree that exists.

## Fork (5) -- how the extraction is PROVEN. Verbatim, then clean. RATIFIED.

The move is done in two stages, and only the second is machine-proved -- state
that plainly rather than imply the whole extraction is gated.

- STAGE 1 (verbatim): the demo's inline body is moved into
  `test/torture/fixtures/atlas-verbatim.mjs:generateAtlasV0` UNCHANGED, wrapped
  only in `export function`. There is NO automated proof that this copy equals
  the original demo body -- node:test has no DOM to run the pre-extraction demo
  against, and `harness.mjs`'s recording ctx has no `createElement`/`measureText`.
  Stage 1 is DIFF-REVIEWED ONLY. `generateAtlasV0` is frozen for exactly this
  reason: it is the fixed point the clean version is measured against.
- STAGE 2 (clean): `Atlas.js:generateAtlas` adds the doors (DOM, size, context,
  the hostile-throw wrap) and the COLD banner -- nothing else. `A6`
  (`test/findings.test.js`) proves, for all four demo argument tuples, that the
  doored `generateAtlas` and the frozen `generateAtlasV0` produce
  `deepStrictEqual` descriptors and identical canvas dimensions under one DOM
  stub, and that the descriptor satisfies its own `{ checked: true }` validator.

So A6 proves the CLEAN edit preserved behaviour. It does NOT prove the verbatim
MOVE, which rests on diff review -- an honest limit, recorded here because a
reader of this ADR alone would otherwise believe the extraction fully machine-
proved. The mitigation is that `generateAtlasV0` is byte-comparable to
`git show 32b5304:demo/demo-lite-bmfont.html` by eye, and A6 makes any drift in
the shipped file (not the frozen one) red.

## Consequences

- New subpath `@zakkster/lite-bmfont/atlas` -> `Atlas.js` + `Atlas.d.ts`, both in
  `package.json` `files[]`; `sideEffects: false` unchanged; the core changes
  exactly one line (the `VERSION` literal).
- F-18 closes: the demo imports `generateAtlas` from the published file instead of
  defining it. `test/findings.test.js` flips from watching the duplication to
  pinning the CLOSED state.
- The demo imports the CDN FILE path (`.../Atlas.js/+esm`), not the `exports`
  subpath -- jsDelivr resolves file paths reliably but not package `exports`
  subpaths. The npm-consumer contract stays `@zakkster/lite-bmfont/atlas`; the
  demo is a browser-CDN consumer and spells it differently, with a comment saying
  why. PUBLISH-WINDOW EXPOSURE (2026-08-20): that URL 404s until 1.8.0 is
  published and jsDelivr fetches it -- the demo is intentionally broken for that
  window, an ungated exposure no gate in this repo can see. It closes on publish.
- `generateAtlas` is a module-level export of `Atlas.js`, never on
  `BitmapFont.prototype`, so the docs-drift guard (T8) cannot enumerate it and
  needs NO exemption -- the exception disappears structurally instead of
  re-entering as a hand-maintained skip list.


## Correction (2026-08-20, M5)

The demo import spelling above (`.../Atlas.js/+esm`) was superseded before M5. The
user's commit 1ab66eb changed the demo to the BARE CDN file path
`https://cdn.jsdelivr.net/npm/@zakkster/lite-bmfont/Atlas.js` (no `/+esm`
suffix). `/+esm` is jsDelivr's CommonJS-to-ESM transform; `Atlas.js` is already
ESM with zero runtime deps, so the suffix converts nothing and buys nothing. The
npm-consumer contract is unchanged (`@zakkster/lite-bmfont/atlas`). This note
appends rather than edits the original text above -- a dated ADR statement is
evidence and is corrected by addition, not rewrite. `test/findings.test.js` pins
the corrected bare-path spelling.
