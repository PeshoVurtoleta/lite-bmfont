# 0008 -- the ASCII-only Law gets an executable gate, and the tree is swept

Status: accepted
Session: M2b (v1.6.1)
Findings: F-46
Relates-to: the suite Law (ASCII-only source, U+00D7 and U+00B5 excepted)
Date: 2026-08-19

## The question

The suite Law requires ASCII-only source, allowing exactly two code points:
U+00D7 and U+00B5. For six versions the rule was prose in `CLAUDE.md` with no
witness. A census on 2026-08-19 found 1,196 non-ASCII code points in the repo --
75 of them inside the published tarball -- confined to the three files authored
before the discipline hardened (`README.md`, `BitmapFont.js`, `llms.txt`) plus
the demo. That profile -- clean in every file authored since M0, dirty only in
the pre-discipline three -- is the signature of a missing gate, not of
carelessness. The deliverable is the witness; the sweep is what makes it green.

## The decisions

### D-1 -- scope: enumerate from `git ls-files`, never a filename list

The gate lists nothing by name. It is NOT a literal filename array and NOT
`package.json` files[]. A hardcoded list is the F-31 shape this package has
already been bitten by: a structural gate pinned four named typed arrays and
could not see a fifth. If the gate can be made green by editing a list of names,
it is the wrong gate. Scope is every tracked file, `demo/` included -- the demo
is source and holds 94 percent of the offenders.

The binary-handling story took three steps, and the first two both fail open in
the same shape:

1. **Extension allowlist** (`.png .jpg .ico .woff .woff2`, skipped by name).
   Fails open on a RENAME: a text file misnamed `decoy.png` is waved past the
   scan unread. An unverified state treated as safe -- the exact thing D-2
   forbids.
2. **NUL-byte content sniff** (skip any file containing `0x00`). Closes the
   rename hole but reopens an identical one down a layer: a UTF-16 text file has
   a `0x00` after every ASCII byte, so the skip fires before the offending code
   point is ever decoded. A UTF-16LE file carrying a real em dash passed the
   gate. Same fail-open, one encoding lower.
3. **Strict, no skip at all** (shipped). This package tracks ZERO binaries today
   (38 files, all text), so any binary skip guards nothing and only costs a
   bypass. A NUL byte is itself a FAILURE (`<path>: contains a NUL byte ...`); a
   file that a strict `TextDecoder('utf-8', {fatal: true})` cannot decode is a
   FAILURE (`<path>: not valid UTF-8`); everything else is decoded and scanned.
   If a real binary is ever tracked the gate fails LOUDLY, and its addition
   becomes a deliberate decision rather than a silent bypass -- which is the
   whole point of D-2.

### D-2 -- fail closed on a broken enumeration

`git ls-files` erroring, a non-zero exit status, an empty list, or a
`readFileSync` throw is a FAILURE -- never catch-and-skip, never catch-and-pass.
An enumerating gate that enumerates nothing passes trivially and reads as
coverage; that is the T2 lane-2 drift-guard failure mode recorded in
`memory/no-published-circular-devdeps.md`. The gate asserts a non-zero file
count (>= 25, and the presence of the deep path `demo/demo-lite-bmfont.html`, so
a subdirectory- or cwd-scoped enumeration cannot pass a naive count) BEFORE it
judges any byte.

### D-3 -- the two exceptions, decoded by code point and tested both ways

Offenders are code points >= 0x80 EXCEPT U+00D7 and U+00B5. The file is decoded
as UTF-8 and judged by CODE POINT, and offenders are reported in code points
(`path:line:col U+XXXX`), not bytes. Neither exception appears in the tree today,
so the allowance arrives dormant -- and a gate rejecting all 1,196 offenders AND
the two exceptions would pass every rejection test in the session. The twin is
therefore mandatory: a file containing only U+00D7 and U+00B5 must PASS, and
swapping them for U+00D6/U+00B6 must FAIL. Both directions were watched (A5).

### D-4 -- semver: PATCH, decided by a command not a review

The sweep is comments, prose and demo text only, so this ships 1.6.1. The claim
is proven byte-level, not by a reviewer's eye: for each swept file the set of
lines that DIFFER equals exactly the set of lines that held an offender, and each
differing line equals the original with ONLY the declared transliteration applied
(A6a/A6b). The one declared non-offender diff per file is the version-triple bump
(`BitmapFont.js:1225`, `llms.txt:18`, `package.json`), which is what a patch IS.

### D-5 -- transliterate prose, delete emoji

| from | to | where |
|---|---|---|
| U+2014 | `--` | all files |
| U+2013 | `-` | all files (every one is a numeric/character RANGE -- C-1) |
| U+2192 | `->` | README |
| U+2026 | `...` | all files (C-2) |
| U+2550, U+2500 | `=`, `-` | demo comment banners |
| U+00B7 | `&middot;` | demo visible markup (C-6) |
| 21 pictographs + 3 U+FE0F | deleted | README headings and bullets (24 code points) |

The demo's two U+00B7 are the one user-visible case; `&middot;` keeps the source
ASCII and the rendered page byte-identical. Emoji are DELETED, not given ASCII
stand-ins: the blueprint `LiteSepforge/README.md` and the peer
`LiteTextLayout/README.md` both measure 0 non-ASCII and use no heading emoji, so
deletion moves toward the blueprint. Resulting double spaces were collapsed.

## Corrections applied after the planner (supersede D-5 on two rows)

- **C-1 -- U+2013 becomes `-`, not `--`.** Every en dash is a range
  (`0-255`, `'0'`-`'9'` codes 48-57); `0--255` would be wrong. `--` is U+2014 only.
- **C-2 -- U+2026 has three contexts, one a factual fix.** (a) prose ellipsis
  `->` `...`; (b) the character NAMING what the wrap flag appends
  (`README.md:80`, `BitmapFont.js:1019`, `llms.txt`) was FALSE -- the flag
  appends three ASCII `.` (code 46), as `BitmapFont.js:72`/`:992` already said;
  the sweep resolves the self-contradiction toward the code and earns its own
  CHANGELOG Docs row; (c) `llms.txt`'s runnable `'Hello world<ellipsis>'` snippet
  fed the ASCII-only atlas a code point it cannot draw, so `'Hello world...'` is
  the first version that renders.
- **C-3 -- A6 by line inspection, not a hand-rolled tokenizer.** A6a (differing
  lines == offender lines) and A6b (each differing line == original + only the
  declared substitution) are strictly stronger than a comment-stripped hash and
  need no parser written this afternoon.
- **C-4 -- two comment lines are load-bearing.**
  `test/torture/t9-hang-child.mjs:56-58` embeds `BitmapFont.js:819` and
  `t9-render-hang-child.mjs:88-94` embeds `BitmapFont.js:1046`; both exit 3 on
  drift. Neither line is an offender, so the sweep does not reach them. Verified
  as a hazard that does NOT fire. A sweep is not a proofreading pass: touch only
  the offending positions, reflow nothing adjacent.
- **C-5 -- `test/packaging.test.js:10`** pins the VERSION literal `1.6.0` ->
  `1.6.1` alongside the CHANGELOG heading.
- **C-6 -- the demo has no executable coverage** (`findings.test.js:118` is
  `test.todo`), and it is 94 percent of the sweep. The gate proves the
  characters are GONE; the module script was re-parsed after the sweep and the
  `&middot;` separator confirmed in the bottom guide.
- **C-7 -- A1 sharpened:** assert `git ls-files -z` yields >= 25 paths AND
  contains `demo/demo-lite-bmfont.html`, catching an F-31-shaped scope error one
  layer earlier.

## What this is not

Not the README-spine rewrite (F-47, filed and unscheduled). Not any executable
change (A6 enforces it). Not a propagation of the gate to the rest of the suite
-- that is a suite-level decision. This session proves the witness on one
package, in the one shape (enumerate, never list) the package has proven it gets
wrong when it is not deliberate.
