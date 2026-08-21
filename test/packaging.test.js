import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { VERSION } from '../BitmapFont.js';

test('version is synced across package.json, VERSION and the CHANGELOG heading', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const head = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
        .split('\n').find(l => /^##\s+\d+\.\d+\.\d+/.test(l));
    assert.equal(VERSION, '1.9.0');
    assert.equal(pkg.version, VERSION);
    assert.equal(head.replace(/^##\s+/, '').split(/\s/)[0], VERSION);
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
test('A11 (M9a): method bodies frozen -- seven MOVED this session; measure/measureLine/drawQuads must not', () => {
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
    // A11 stage 1 (0012 fork 1, SESSION-M9a section 7). The C-folded edit moves
    // SEVEN bodies -- the seven direct advance/kerning readers -- and this is the
    // one session where that is allowed. The three doors-and-delegates that read
    // NO advance (measure, measureLine, drawQuads) MUST NOT move; their pins are
    // UNCHANGED from 1.8.0 and reddening any of them means an unintended edit.
    // layoutGlyphs and drawQuads (added in M5, after the 1.8.0 pin) are pinned
    // here for the first time, closing that gap (R-9).
    //   MOVED this session: measureWidest, draw, drawFast, drawFastInt,
    //                       drawWrapped, _measureRange, layoutGlyphs (seven).
    //   MUST NOT MOVE:      measure, measureLine, hasGlyph, destroy, drawQuads.
    const PINS = {
        measure: '9967686a0e14e87b9751cb9b334e35bf7a4fa05b460474ab6dfe92a6864e45c1',        // 1.8.0, unchanged
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
    // Guard on the guard: every capture is non-empty and all ten are DISTINCT,
    // so a failed awk-style extraction (empty string, shared sha) cannot pass.
    for (let i = 0; i < names.length; i++) {
        assert.notEqual(got[i], '', names[i] + ': body extraction was empty (regex missed the method)');
    }
    assert.equal(new Set(got).size, names.length, 'two method bodies hashed identically -- an extraction went vacuous');
    // The freeze itself.
    for (let i = 0; i < names.length; i++) {
        assert.equal(got[i], PINS[names[i]],
            names[i] + ' body sha moved from its 1.8.0 pin -- ' +
            (['measure', 'measureLine', 'drawQuads', 'hasGlyph', 'destroy'].indexOf(names[i]) >= 0
                ? names[i] + ' MUST NOT move this session (0012 fork 1 stage 1)' : 'an unintended edit'));
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
