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
test('A11 (M5): the ten shipped method bodies are frozen (draw must not move)', () => {
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
    // Captured on the 1.8.0 commit (1ab66eb) BEFORE the M5 edit.
    const PINS = {
        measure: '9967686a0e14e87b9751cb9b334e35bf7a4fa05b460474ab6dfe92a6864e45c1',
        measureWidest: 'bb315f6f2e292bb866f95c4ec393c84fdfe1af0f70a3a3fcb3dcb5585da019c6',
        measureLine: '50c28a69fe3e170e03bf0b50a3587c94c82ce91f5431aee2e10059742737e9d4',
        hasGlyph: '5bdf08564c7ed450ad2ada75d43549bd7ccb4db5a986566ee455001c5c644dc5',
        draw: '5a794f4afc3ae6d88225d121848afba9fe976467f3ae8b88224c390348907075',
        drawFast: '143bafcb7d50c6497826d841a587fbdeae9ab4cdf92f8a6bae490eb58024d869',
        drawFastInt: '3c5942448910181e71257ae15c4bb8c46439bfc5f27469b0e33c419ca8f7900e',
        drawWrapped: 'bdae8ef4563b43b39ab6683b1370b3c1ceb3a64bab0ef96ac99de4a4505c29fd',
        destroy: '6f7fd1459b1f452d4e2d5be976082fbabdd676958d1b11079b4bb955602fdf1c',
        _measureRange: 'ba94f3bf4b9267fa55fc9d17c23aa4c7541edf2b9dac89e21c86d2ed335c5504',
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
            (names[i] === 'draw' ? 'draw MUST NOT change in M5' : 'an unintended edit'));
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
