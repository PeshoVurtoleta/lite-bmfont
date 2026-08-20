import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { VERSION } from '../BitmapFont.js';

test('version is synced across package.json, VERSION and the CHANGELOG heading', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const head = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
        .split('\n').find(l => /^##\s+\d+\.\d+\.\d+/.test(l));
    assert.equal(VERSION, '1.8.0');
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
