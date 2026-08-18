import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERSION } from '../BitmapFont.js';

test('version is synced across package.json, VERSION and the CHANGELOG heading', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const head = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
        .split('\n').find(l => /^##\s+\d+\.\d+\.\d+/.test(l));
    assert.equal(VERSION, '1.4.1');
    assert.equal(pkg.version, VERSION);
    assert.equal(head.replace(/^##\s+/, '').split(/\s/)[0], VERSION);
});
