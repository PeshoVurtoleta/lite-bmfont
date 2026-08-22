import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
    VERSION, FORMAT_VERSION, GLYPH_STRIDE,
    GLYPH_ADVANCE_SHIFT, GLYPH_ADVANCE_SCALE, BitmapFont,
} from '../BitmapFont.js';

test('version is synced across package.json, VERSION and the CHANGELOG heading', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const head = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
        .split('\n').find(l => /^##\s+\d+\.\d+\.\d+/.test(l));
    assert.equal(VERSION, '2.0.2');
    assert.equal(pkg.version, VERSION);
    assert.equal(head.replace(/^##\s+/, '').split(/\s/)[0], VERSION);
});

// F-52: no SHIPPED consumer file may carry a roadmap session name (M0..M9, plus
// M9pre / M9a / M9b) or a scheduling phrase ("stays open" / "may re-parent").
// Three such sentences went to npm inside the 2.0.0 tarball -- the published docs
// speculated about the release the reader was holding. The docs-drift guard could
// not see them: it pins SIGNATURES, not stale English.
//
// REFIT (planner): scope = files[] MINUS CHANGELOG.md, LICENSE, BitmapFont.js.
// CHANGELOG legitimately narrates the session history; LICENSE is boilerplate;
// BitmapFont.js carries session names INSIDE method bodies whose SHAs A11 pins,
// so editing them is out of scope. The exemption set is asserted LITERALLY so
// widening it later reddens THIS test. Proven in BOTH directions below.
const SESSION_OR_SCHEDULE = /\bM[0-9](?:pre|[ab])?\b|stays open|may re-parent/;

test('F-52: no shipped consumer file carries a session name or scheduling phrase (both directions)', () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

    // Literal exemption set. Adding a file here to dodge the gate reddens this line.
    const EXEMPT = ['BitmapFont.js', 'CHANGELOG.md', 'LICENSE'];
    assert.deepEqual([...EXEMPT].sort(), ['BitmapFont.js', 'CHANGELOG.md', 'LICENSE']);

    const scanned = pkg.files.filter((f) => !EXEMPT.includes(f));
    // Fail closed: an empty or trivially-small scan set would pass vacuously.
    assert.ok(scanned.length >= 5, 'scan set too small: ' + scanned.length);
    assert.ok(scanned.includes('llms.txt') && scanned.includes('BitmapFont.d.ts'),
        'scan set missing the files F-52 lived in');

    // DIRECTION 1: the shipped tree is clean.
    const offenders = [];
    for (const rel of scanned) {
        const abs = join(root, rel);
        assert.ok(existsSync(abs), 'files[] lists a missing file: ' + rel);   // fail closed
        const lines = readFileSync(abs, 'utf8').split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (SESSION_OR_SCHEDULE.test(lines[i])) offenders.push(rel + ':' + (i + 1) + ' ' + lines[i].trim());
        }
    }
    assert.deepEqual(offenders, [], 'shipped file carries a session name / scheduling phrase:\n' + offenders.join('\n'));

    // DIRECTION 2 (positive control): the matcher actually fires. Without this,
    // DIRECTION 1 is a tautology -- a regex that matches nothing always passes.
    assert.ok(SESSION_OR_SCHEDULE.test('closed in M4 and half-closed in M9'), 'matcher blind to M<n>');
    assert.ok(SESSION_OR_SCHEDULE.test('the storage half stays open (M9)'), 'matcher blind to "stays open"');
    assert.ok(SESSION_OR_SCHEDULE.test('2.0.0 may re-parent this type'), 'matcher blind to "may re-parent"');
    assert.ok(SESSION_OR_SCHEDULE.test('scheduled for M9pre'), 'matcher blind to M9pre');
    // and it does NOT fire on ordinary prose or version strings.
    assert.equal('the 2.0.0 release measures widths'.match(SESSION_OR_SCHEDULE), null, 'matcher false-positives on prose');
});

// The ASCII-only Law (M2b / F-46). Every tracked text file must contain only
// bytes decoding to code points < 0x80, with two Law exceptions: U+00D7 and
// U+00B5. The scope is enumerated from `git ls-files` -- never a filename list,
// never package.json files[] -- so a new file carrying a non-ASCII byte reddens
// this gate on the day it is added, with no edit to this test. Fail closed:
// git erroring, a non-zero status, an empty enumeration, or a readFileSync
// throw is a FAILURE, not a skip and not a pass.
const ASCII_ALLOWED_ABOVE_7F = new Set([0x00d7, 0x00b5]);

test('every tracked text file is ASCII-only (U+00D7 and U+00B5 excepted)', () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

    const git = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'buffer' });
    // Fail closed on a broken enumeration -- an enumerating gate that enumerates
    // nothing passes trivially and reads as coverage.
    assert.equal(git.error, undefined, 'git ls-files failed to spawn: ' + String(git.error));
    assert.equal(git.status, 0, 'git ls-files exited ' + String(git.status));

    const files = git.stdout.toString('utf8').split('\0').filter(Boolean);
    // Assert a non-zero, structurally-real enumeration BEFORE judging any byte.
    assert.ok(files.length >= 25, 'git ls-files yielded too few paths: ' + files.length);
    assert.ok(
        files.includes('demo/demo-lite-bmfont.html'),
        'enumeration is not repo-root-scoped: missing demo/demo-lite-bmfont.html'
    );

    // NO binary skip. This package tracks ZERO binaries today (38 files, all
    // text), so a content sniff guards nothing and costs a bypass: a NUL-byte
    // skip fails open on a UTF-16 text file (every ASCII byte is followed by
    // 0x00, so the skip fires before the offender is decoded), exactly as an
    // extension allowlist fails open on a rename. Both are an unverified state
    // treated as safe, which D-2 forbids. Strict instead: a NUL byte is a
    // failure, invalid UTF-8 is a failure, and if a real binary is ever tracked
    // the gate fails LOUDLY so its addition is a deliberate decision.
    const structural = [];
    const offenders = [];
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (const rel of files) {
        // readFileSync throwing is a FAILURE -- do not catch and skip.
        const buf = readFileSync(resolve(root, rel));
        if (buf.includes(0x00)) {
            structural.push(rel + ': contains a NUL byte (binary or non-UTF-8 text); the ASCII-only Law admits neither');
            continue;
        }
        let text;
        try {
            text = decoder.decode(buf);
        } catch {
            // A strict UTF-8 decode throw is a FAILURE with its own message, not
            // an exception the runner reports as a crash.
            structural.push(rel + ': not valid UTF-8');
            continue;
        }
        const lines = text.split('\n');
        for (let ln = 0; ln < lines.length; ln++) {
            let col = 0;
            for (const ch of lines[ln]) {
                col++;
                const cp = ch.codePointAt(0);
                if (cp < 0x80 || ASCII_ALLOWED_ABOVE_7F.has(cp)) continue;
                offenders.push(
                    rel + ':' + (ln + 1) + ':' + col +
                    ' U+' + cp.toString(16).toUpperCase().padStart(4, '0')
                );
            }
        }
    }

    // Structural failures (binary / non-UTF-8) are judged before code points --
    // a file that cannot be soundly decoded cannot be soundly scanned.
    assert.equal(
        structural.length, 0,
        'tracked files the ASCII-only Law cannot admit:\n  ' + structural.join('\n  ')
    );
    assert.equal(
        offenders.length, 0,
        'non-ASCII code points found (transliterate per the Law):\n  ' + offenders.join('\n  ')
    );
});

// A11 (M5) -- the per-method body-SHA FREEZE. `draw` is NOT touched by the glyph-
// quad split; this pins that at byte level, and freezes the other nine shipped
// methods too (the session that only froze the method it expected to touch is the
// one that finds out later -- R-9). Each body is extracted exactly as the
// release-gate awk does -- from `^    name(` through the next `^    }$`, inclusive,
// each line plus a trailing newline -- and sha256'd. The GUARD is distinctness,
// not a length floor: a failed extraction yields the empty string, and every
// empty capture shares one sha, so ten mutually-distinct non-empty shas catch a
// vacuous extraction directly (a 200-char floor would falsely redden `hasGlyph`
// at 143 chars and `destroy` at 126).
test('A11 (M9b stage 2): method bodies frozen -- ONLY measure moved (F-06 delegate); the other eleven must not', () => {
    const src = readFileSync(new URL('../BitmapFont.js', import.meta.url), 'utf8');
    const lines = src.split('\n');
    function methodSha(name) {
        const start = lines.findIndex((l) => new RegExp('^    ' + name + '\\(').test(l));
        if (start < 0) return '';
        let end = -1;
        for (let i = start; i < lines.length; i++) {
            if (/^    }$/.test(lines[i])) { end = i; break; }
        }
        if (end < 0) return '';
        const block = lines.slice(start, end + 1).join('\n') + '\n';
        return createHash('sha256').update(block).digest('hex');
    }
    // A11 stage 2 (0012 fork 2, SESSION-M9b section 4). F-06 makes `measure` a
    // one-line delegate to measureWidest -- so EXACTLY ONE body moves this
    // session, and it is `measure`. The other eleven are byte-identical to their
    // M9a stage-1 pins; reddening any of them means a second body moved, which the
    // session plan says is a STOP-and-report, not a re-pin. (Stage 1 -- the seven
    // C-folded advance/kerning readers moving under s16 -- was M9a's and its pins
    // are UNCHANGED below.)
    //   MOVED this session: measure (F-06 delegate flip) -- ONE.
    //   MUST NOT MOVE:      measureWidest, measureLine, hasGlyph, destroy,
    //                       drawQuads, draw, drawFast, drawFastInt, drawWrapped,
    //                       _measureRange, layoutGlyphs (eleven).
    const PINS = {
        measure: 'e702a3964c16973d9ec15d8b3b2a9c5a03235235ad774e8854389e54b0fa1750',        // MOVED (F-06 delegate, 2.0.0)
        measureLine: '50c28a69fe3e170e03bf0b50a3587c94c82ce91f5431aee2e10059742737e9d4',    // 1.8.0, unchanged
        hasGlyph: '5bdf08564c7ed450ad2ada75d43549bd7ccb4db5a986566ee455001c5c644dc5',       // 1.8.0, unchanged
        destroy: '6f7fd1459b1f452d4e2d5be976082fbabdd676958d1b11079b4bb955602fdf1c',        // 1.8.0, unchanged
        drawQuads: '3625e1f7c3c3d7d1e083da06d5091ddc1778d6886ff6e645c6f882c7ef3ad38c',      // M5, first pin -- reads no advance
        measureWidest: '92114ba0d5eef66f75c71053253e2af9131914fd745dc64560c5df323391a42d',  // MOVED (s16)
        draw: '29ad8b98df8f8aa829e0d6fec61becf5d4d334e92a0a1703f520662f543b015a',            // MOVED (s16)
        drawFast: '30237560098d1cd99fdfe3fc741b07b5a4df56a33a4ce0907bf14acb8617eb69',        // MOVED (s16)
        drawFastInt: '9c356aeb3739f79a86bd572d09d12c01fa00dd79823888473827d2a90bb3d843',     // MOVED (s16)
        drawWrapped: '87e106414526112e59d81e765b763d50afd29de4a63aedbf5acaabfe8c36f579',     // MOVED (s16 + F-49)
        _measureRange: 'd7ff407d3e886af23d4428a2d194eef86cec3072e82ddd904a70fe938505e999',   // MOVED (s16)
        layoutGlyphs: 'cdabf73698117057dcf35a8e6f97ab53548aa2dd580ccfc8bdf3f208a4f9b47e',    // MOVED (s16), M5 first pin
    };
    const names = Object.keys(PINS);
    const got = names.map(methodSha);
    // Guard on the guard: every capture is non-empty and all twelve are DISTINCT,
    // so a failed awk-style extraction (empty string, shared sha) cannot pass.
    for (let i = 0; i < names.length; i++) {
        assert.notEqual(got[i], '', names[i] + ': body extraction was empty (regex missed the method)');
    }
    assert.equal(new Set(got).size, names.length, 'two method bodies hashed identically -- an extraction went vacuous');
    // The freeze itself. Everything EXCEPT measure must be byte-identical to M9a;
    // measure is the one body fork 2 is allowed to move this session.
    for (let i = 0; i < names.length; i++) {
        assert.equal(got[i], PINS[names[i]],
            names[i] + ' body sha moved from its pin -- ' +
            (names[i] === 'measure'
                ? 'measure moved but not to the F-06 delegate pin (0012 fork 2 stage 2)'
                : names[i] + ' MUST NOT move this session -- a SECOND body moved, STOP and report (0012 fork 2 stage 2)'));
    }
});

// F-26 (M9pre) -- the SOURCE-TEXT pin, recorded as a WEAKER class of assertion.
// The F-03 guard reshape `if (!(id >= 0 && id < 256)) continue;` lives in three
// hot bodies (draw, drawWrapped, layoutGlyphs) and is unfalsifiable through the
// public API -- none of those three takes a range parameter, so no public call
// can drive a NaN id into the guard. KEEP wins over delete (SESSION-M9pre S4):
// deleting the reshape writes the NaN-ACCEPTING `id < 0 || id >= 256` form -- the
// F-03 corruption -- back into three bodies on the theory no future call path
// reaches them, and "no future call path" is an unverified state the Law fails
// closed on. So the three sites are KEPT and pinned HERE by source text. This is
// weaker than every behavioural assertion in the suite and is recorded as such;
// it must NOT be described anywhere as behavioural coverage. The behavioural twin
// that DOES redden is _measureRange's guard, killed by T0 law 11 (it takes
// start/end). R-17: the count is THREE (a third site, layoutGlyphs, arrived with
// M5); a session that pinned "two" would miss it.
test('F-26 source pin: exactly three NaN-safe glyph guards, zero NaN-accepting form in CODE', () => {
    // readFileSync throwing is a FAILURE, not a skip (matches the ASCII gate at :57).
    const src = readFileSync(new URL('../BitmapFont.js', import.meta.url), 'utf8');
    // Strip comments FIRST: BitmapFont.js:423 and :729 both quote the forbidden
    // `id < 0 || id >= 256` form inside `//` prose warning AGAINST it. A pin that
    // tripped on those would be a grep matching its own docs -- this repo has
    // shipped that bug. Block comments then line comments; the code that remains
    // is what ships.
    const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    const safe = (code.match(/if \(!\(id >= 0 && id < 256\)\) continue;/g) || []).length;
    const accepting = (code.match(/id < 0 \|\| id >= 256/g) || []).length;
    // False-positive direction: the two comment occurrences must NOT survive the
    // strip. If they did, `accepting` would be 2 and this would catch it.
    assert.equal(
        accepting, 0,
        'the NaN-accepting `id < 0 || id >= 256` form is present in CODE (F-03 restored), count ' + accepting
    );
    assert.equal(
        safe, 3,
        'expected exactly three NaN-safe glyph guards (draw/drawWrapped/layoutGlyphs); found ' + safe +
        ' -- a reshape site was deleted, added or altered'
    );
});

// Fork 9 (0012) -- the ROSTER GATE. M9pre silently dropped a fork its own plan
// specified (the F-08 deferral handoff); the file was internally consistent so
// two review passes missed it. So decisions/0012 carries a LITERAL roster and
// this gate extracts every `## Fork (n)` at column 0 -- OUTSIDE fenced code
// blocks -- and asserts the set is exactly [1..9], each with a Decision and a
// Rejected line. Proven in BOTH directions below: a deleted fork reddens, and a
// `## Fork (n)` quoted inside a fence does NOT (a grep matching its own docs is
// a shipped failure mode -- 0011 fork 2 had to strip comment lines for it).
test('Fork 9 roster (0012): forks [1..9] each present with a Decision and a Rejected line', () => {
    const src = readFileSync(new URL('../decisions/0012-two-oh.md', import.meta.url), 'utf8');
    // Strip fenced code blocks so a ``` example quoting `## Fork (7)` cannot be
    // counted as a real heading. Toggle on every ``` line.
    const lines = src.split('\n');
    let fenced = false;
    const code = [];
    for (const l of lines) {
        if (l.startsWith('```')) { fenced = !fenced; code.push(''); continue; }
        code.push(fenced ? '' : l);
    }
    const body = code.join('\n');
    // Section bodies: split on the column-0 fork headings.
    const parts = body.split(/^## Fork \((\d+)\)/m);
    // parts = [pre, "1", text1, "2", text2, ...]
    const nums = [];
    for (let i = 1; i < parts.length; i += 2) {
        const n = Number(parts[i]);
        const text = parts[i + 1];
        nums.push(n);
        assert.match(text, /Decision:/,
            'Fork (' + n + ') has no Decision: line');
        assert.match(text, /Rejected/,
            'Fork (' + n + ') has no Rejected line');
    }
    nums.sort((a, b) => a - b);
    assert.deepEqual(nums, [1, 2, 3, 4, 5, 6, 7, 8, 9],
        'the 0012 fork roster is not exactly [1..9]: ' + JSON.stringify(nums));

    // REVERSE direction: prove a `## Fork (n)` INSIDE a fence is NOT counted, so
    // the strip is load-bearing and not decorative. If the strip were removed the
    // roster would gain a spurious member and deepEqual above would redden.
    const withFence = body + '\n```\n## Fork (42) -- this is prose in a fence, not a heading\n```\n';
    const lines2 = withFence.split('\n');
    let fenced2 = false; const code2 = [];
    for (const l of lines2) {
        if (l.startsWith('```')) { fenced2 = !fenced2; code2.push(''); continue; }
        code2.push(fenced2 ? '' : l);
    }
    const nums2 = (code2.join('\n').match(/^## Fork \((\d+)\)/mg) || []).map((h) => Number(h.match(/\d+/)[0]));
    assert.equal(nums2.indexOf(42), -1,
        'a `## Fork (42)` quoted inside a fenced block was counted -- the strip is broken');
});

// A DOCS-CLAIM PIN for the advance range (M9a, 2026-08-21).
//
// T8's docs-drift guard checks PRESENCE and NAMING -- every prototype method has
// a signature, every export has a heading. It cannot see a claim that is merely
// FALSE. The prerelease docs check found four shipped statements that had become
// wrong the moment the 1/16 format landed, and every gate was green through all
// of them: README, llms.txt, BitmapFont.d.ts and BitmapFont.js's own JSDoc all
// published `missingAdvance` as `[0, 32767]` while the code enforced
// `[0, 2047.9375]` -- a caller passing the documented maximum gets a throw.
//
// That is the F-43/F-44 class: a number in prose that no gate reads. This pin is
// the narrowest thing that closes it -- the bound is DERIVED from the exported
// constant, so it cannot drift from the code, and the four shipped files must
// carry the derived string. Scoped to those four files so it never matches its
// own text (the greps-that-match-their-own-docs failure this repo has shipped).
test('docs-claim pin: the advance range in the shipped docs equals the enforced bound', async () => {
    const { GLYPH_ADVANCE_SCALE } = await import('../BitmapFont.js');
    const bound = String(32767 * GLYPH_ADVANCE_SCALE);   // derived, never typed
    assert.equal(bound, '2047.9375', 'the derived advance bound moved; update the docs and this pin together');

    const SHIPPED = ['README.md', 'llms.txt', 'BitmapFont.d.ts', 'BitmapFont.js'];
    for (const f of SHIPPED) {
        const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
        assert.ok(src.includes(bound),
            f + ' does not publish the enforced advance bound ' + bound);
        // The superseded Int16 bound must not survive as an ADVANCE range claim.
        assert.ok(!/\[0,\s*32767\]/.test(src),
            f + ' still publishes the superseded advance range [0, 32767]');
    }
});

// The SECOND docs-claim pin (M9b, 2026-08-21), and it exists because the first
// one was too narrow. The advance-range pin above caught nothing when F-06
// flipped `measure`: all THREE shipped API docs -- README, llms.txt and the
// .d.ts -- kept saying "it sums across newlines ... `measure('AA\nAA')` is 32,
// not 16" and described the flip in FUTURE tense ("2.0.0 promotes measure"),
// inside the 2.0.0 commit itself. `npm test`, torture, the T8 docs-drift guard
// and the advance-range pin were all green through it. An IDE hover would have
// shipped every consumer the exact F-06 confusion this major exists to end.
//
// So this pin derives BOTH numbers from the live code and asserts the shipped
// docs publish the current one and not the superseded one. Scoped to the three
// files so it never matches its own text.
test('docs-claim pin: the measure semantics in the shipped docs match the code', async () => {
    const { BitmapFont } = await import('../BitmapFont.js');
    const chars = [];
    for (let c = 32; c < 127; c++) {
        chars.push({ id: c, x: 0, y: 0, width: 8, height: 8, xoffset: 0, yoffset: 0, xadvance: 8 });
    }
    const font = new BitmapFont({ width: 256, height: 256 },
        { common: { lineHeight: 10, base: 8 }, chars, kernings: [] });

    // Derived, never typed: the advance-8 font the docs use as their example.
    const widest = font.measure('AA\nAA');          // 2.0.0: 16
    const oneLine = font.measure('ABC');             // unchanged by F-06
    assert.equal(widest, 16, 'the documented example moved; update the docs and this pin together');
    assert.equal(oneLine, font.measureWidest('ABC'), 'measure must equal measureWidest on a newline-free string');
    assert.equal(widest, font.measureWidest('AA\nAA'), 'measure must be an exact alias of measureWidest');

    for (const f of ['README.md', 'llms.txt', 'BitmapFont.d.ts']) {
        const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
        // The 1.x claim must be gone in every form it was written in.
        assert.ok(!/sums across newlines/i.test(src),
            f + ' still claims `measure` sums across newlines (1.x semantics)');
        assert.ok(!/2\.0\.0 promotes/.test(src),
            f + ' still describes the F-06 flip in the FUTURE tense');
        assert.ok(!/is `?32`?, not `?16`?/.test(src),
            f + ' still publishes the superseded 32-not-16 example');
    }
});

// decisions/0012 fork 8 -- FORMAT_VERSION and the two-lane drift guard. The suite
// has been bitten twice by a peer-asserted contract that silently SKIPS when the
// peer is unwired, turning the drift guard into a no-op. So neither lane may skip:
// lane 1 always runs (no peer needed), lane 2 FAILS closed when the peer is absent.
const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, '..');

// LANE 1 -- the committed FORMAT_VERSION 2 stamp vs the LIVE exports and structure.
// No peer required; always executes. Changing any value in the stamp reddens this
// (the AR-02 mutation). The stamp is the human-readable source of truth that the
// binary format's five load-bearing numbers have not drifted from the code.
test('fork 8 lane 1: the live format matches the committed FORMAT_VERSION 2 stamp', () => {
    const stamp = JSON.parse(readFileSync(join(PKG_ROOT, 'test', 'fixtures', 'format-stamp.json'), 'utf8'));
    // Exported constants, straight from the module.
    assert.equal(FORMAT_VERSION, stamp.formatVersion, 'FORMAT_VERSION drifted from the stamp');
    assert.equal(GLYPH_ADVANCE_SHIFT, stamp.glyphAdvanceShift, 'GLYPH_ADVANCE_SHIFT drifted from the stamp');
    assert.equal(GLYPH_ADVANCE_SCALE, stamp.glyphAdvanceScale, 'GLYPH_ADVANCE_SCALE drifted from the stamp');
    assert.equal(GLYPH_STRIDE, stamp.quadStride, 'GLYPH_STRIDE (quad stride) drifted from the stamp');
    // Internal consistency: scale is exactly 1 / (1 << shift).
    assert.equal(GLYPH_ADVANCE_SCALE, 1 / (1 << GLYPH_ADVANCE_SHIFT), 'scale is not 1/(1<<shift)');
    // Structure derived from a LIVE font, not from a literal.
    const ATLAS = {};
    const font = new BitmapFont(ATLAS, {
        common: { lineHeight: 12, base: 10 },
        chars: [
            { id: 65, x: 0, y: 0, width: 8, height: 8, xoffset: 0, yoffset: 0, xadvance: 10 },
            { id: 66, x: 8, y: 0, width: 8, height: 8, xoffset: 0, yoffset: 0, xadvance: 10 },
        ],
        kernings: [{ first: 65, second: 66, amount: stamp.kerningKeySample.amount }],
    });
    assert.equal(font.glyphs.length / 256, stamp.glyphRecordStride, 'glyph record stride (glyphs.length/256) drifted from the stamp');
    // Kerning key formula: the sample key is (first << 8) | second, and a LIVE
    // font stores/reads the amount at exactly that key. kernOf reading it back
    // proves the key AND the 1/16 store; the reversed pair reads 0, proving the
    // key is ORDERED, not symmetric.
    const { first, second, key, amount } = stamp.kerningKeySample;
    assert.equal((first << 8) | second, key, 'the stamped kerning key sample is not (first << 8) | second');
    assert.equal(font.kernOf(first, second), amount, 'live kernOf did not round-trip the stamped amount at the stamped key');
    assert.equal(font.kernOf(second, first), 0, 'the kerning key is not ordered -- reversed pair should be 0');
    // Layout stride 4: a LIVE drawWrapped reads 4-slot line records. Two lines in
    // an 8-float buffer draw both; a wrong stride would misread the second line.
    const rec = [];
    const ctx = { drawImage() { rec.push(1); } };
    const layout = Float32Array.of(0, 1, 10, 0,   1, 2, 10, 0);   // 2 lines x stride 4
    font.drawWrapped(ctx, 'AB', layout, 2, 1000, 1000, 0, 0, 1, 0, 0);
    assert.equal(stamp.layoutStride, 4, 'the stamped layout stride is not 4');
    assert.ok(rec.length >= 2, 'a stride-4 layout of 2 lines drew fewer than 2 glyphs -- layout stride contract broke');
});

// LANE 2 -- the PEER. Reads whatever @zakkster/lite-bmfont is installed in the
// sibling LiteTextLayout and asserts the WIRING and the CONTRACT. It FAILS, never
// skips, when the peer is absent -- a silent skip is the no-op this guard exists
// to prevent (MEMORY: bitten twice). Per decisions/0012 B-7 the installed peer is
// 1.6.0, which PREDATES the 1/16 format and whose range `^1.6.0` cannot accept
// 2.0.0 through semver. So the honest current assertion is that the peer is still
// on the pre-format 1.x line: this reddens the day the peer is deliberately bumped
// to >= 2.0.0, forcing whoever does it to re-verify FORMAT_VERSION against the peer
// and convert this lane into the real `peer.FORMAT_VERSION === FORMAT_VERSION`
// drift check, rather than have the format silently drift across the boundary.
test('fork 8 lane 2: the LiteTextLayout peer is wired and read (fails closed, never skips)', () => {
    const peerRoot = resolve(PKG_ROOT, '..', 'LiteTextLayout');
    assert.ok(existsSync(peerRoot),
        'peer LiteTextLayout absent at ' + peerRoot + ' -- the format drift guard cannot run; wire the sibling locally, do NOT skip');
    const peerManifest = JSON.parse(readFileSync(join(peerRoot, 'package.json'), 'utf8'));
    const declared = (peerManifest.dependencies || {})['@zakkster/lite-bmfont']
        || (peerManifest.devDependencies || {})['@zakkster/lite-bmfont'];
    assert.ok(declared,
        'LiteTextLayout/package.json no longer declares @zakkster/lite-bmfont -- the peer wiring is gone');
    const peerCopyManifest = join(peerRoot, 'node_modules', '@zakkster', 'lite-bmfont', 'package.json');
    assert.ok(existsSync(peerCopyManifest),
        'LiteTextLayout has no INSTALLED @zakkster/lite-bmfont copy at ' + peerCopyManifest + ' -- wire it locally, do NOT skip');
    const peerVersion = JSON.parse(readFileSync(peerCopyManifest, 'utf8')).version;
    const peerMajor = Number(peerVersion.split('.')[0]);
    assert.ok(Number.isInteger(peerMajor), 'peer lite-bmfont version is unparseable: ' + peerVersion);
    // THE CONTRACT (B-7). The peer predates FORMAT_VERSION and its range cannot
    // reach 2.0.0. When it is bumped past 1.x this reddens ON PURPOSE.
    assert.ok(peerMajor < 2,
        'the installed peer lite-bmfont is now ' + peerVersion + ' (>= 2.0.0): re-verify the binary format against ' +
        'the peer and replace this line with `peer.FORMAT_VERSION === ' + FORMAT_VERSION + '` -- the format now crosses the boundary');
    // And prove the format has genuinely NOT reached the peer copy: its source
    // exports no FORMAT_VERSION (it is a pre-stamp build), so there is nothing to
    // agree with yet -- exactly why the contract above is the honest assertion.
    const peerMain = join(peerRoot, 'node_modules', '@zakkster', 'lite-bmfont', 'BitmapFont.js');
    if (existsSync(peerMain)) {
        const peerSrc = readFileSync(peerMain, 'utf8');
        assert.ok(!/export const FORMAT_VERSION/.test(peerSrc),
            'the peer copy ' + peerVersion + ' unexpectedly exports FORMAT_VERSION -- it is no longer pre-format; update this lane to the real drift check');
    }
});
