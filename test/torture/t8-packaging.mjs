/**
 * T8 -- the packaging / docs-drift poison door (M7, decisions/0009).
 *
 * Registered-empty since M0; FILLED here. The split axis (SESSION-M7 R-6): what
 * needs a SUBPROCESS or the real TARBALL lives here; the in-process assertions
 * (version sync, the ASCII-only Law, the F-18 closure, and the atlas behavioural
 * proofs A2/A3/A6) stay in `npm test` and are NOT duplicated here.
 *
 * Three checks, none of which `npm test` can make cheaply:
 *
 *   A5  PACK CONTENTS. `npm pack --dry-run --json` must list EXACTLY the nine
 *       shipped files and zero `test/` or `demo/` paths. Drop Atlas.js from
 *       files[] -> red; add "test/" -> red.
 *
 *   A3(i) DOM-FREE IMPORT THROUGH THE EXPORTS MAP. The real tarball is packed,
 *       extracted, and BOTH entry points (`@zakkster/lite-bmfont` and
 *       `@zakkster/lite-bmfont/atlas`) are imported by SPECIFIER in a CLEAN child
 *       process with no DOM. Resolving through `exports` in a child is the only
 *       way to prove the subpath map is wired AND that neither module touches the
 *       DOM at module scope. Hoisting `const doc = document` to Atlas.js module
 *       scope -> the child throws -> red.
 *
 *   A4  DOCS-DRIFT GUARD (F-31 shape). `BitmapFont.prototype` is enumerated at
 *       RUNTIME -- never a hand list -- and every public method must appear in
 *       llms.txt (column-0 signature, fences stripped) AND README (backticked
 *       heading), both directions. `generateAtlas` needs no exemption: it is a
 *       module-level export of Atlas.js, never on the prototype, so the
 *       enumeration cannot see it. The two filters are PINNED: `skipped` must be
 *       exactly ['constructor'] and `privates` exactly ['_measureRange'], so a
 *       new private or a second skip reddens and forces a deliberate decision.
 *       The exports direction enumerates BOTH module namespaces and requires a
 *       `## Export: NAME` heading for each (only 'default' is skipped, pinned).
 *
 * @license MIT
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { check, die } from './harness.mjs';
import { BitmapFont } from '../../BitmapFont.js';
import * as BmNS from '../../BitmapFont.js';
import * as AtlasNS from '../../Atlas.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

const SHIPPED = [
    'Atlas.d.ts', 'Atlas.js', 'BitmapFont.d.ts', 'BitmapFont.js',
    'CHANGELOG.md', 'LICENSE', 'README.md', 'llms.txt', 'package.json',
];

function stripFences(text) {
    const out = [];
    let inFence = false;
    for (const line of text.split('\n')) {
        if (line.slice(0, 3) === '```') { inFence = !inFence; continue; }
        if (!inFence) out.push(line);
    }
    return out.join('\n');
}

function eqSet(a, b) {
    if (a.length !== b.length) return false;
    const s = new Set(a);
    return b.every((x) => s.has(x)) && s.size === b.length;
}

// ---- A5 -- pack contents ----------------------------------------------------
function checkPackContents() {
    const res = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: ROOT, encoding: 'utf8' });
    check(res.error === undefined, () => 'T8/A5: npm pack failed to spawn: ' + String(res.error));
    check(res.status === 0, () => 'T8/A5: npm pack exited ' + String(res.status) + '\n' + (res.stderr || ''));

    let parsed;
    try { parsed = JSON.parse(res.stdout); }
    catch (e) { die('T8/A5: npm pack --json output did not parse: ' + (e && e.message)); return; }
    // npm >= 10 keys the object by package name; older npm returns an array.
    const entry = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
    check(entry && Array.isArray(entry.files), () => 'T8/A5: npm pack json carried no files[]');

    const files = entry.files.map((f) => f.path);
    check(eqSet(files, SHIPPED),
        () => 'T8/A5: pack contents drifted.\n  got:      ' + files.slice().sort().join(', ') +
              '\n  expected: ' + SHIPPED.slice().sort().join(', '));
    const leaked = files.filter((p) => /^(test|demo)\//.test(p));
    check(leaked.length === 0, () => 'T8/A5: test/ or demo/ leaked into the tarball: ' + leaked.join(', '));
}

// ---- A3(i) -- DOM-free import through the exports map, clean child -----------
function checkCleanChildImport() {
    const tmp = mkdtempSync(join(tmpdir(), 'bmfont-t8-'));
    try {
        const packRes = spawnSync('npm', ['pack', '--pack-destination', tmp], { cwd: ROOT, encoding: 'utf8' });
        check(packRes.error === undefined, () => 'T8/A3(i): npm pack (real) failed to spawn: ' + String(packRes.error));
        check(packRes.status === 0, () => 'T8/A3(i): npm pack (real) exited ' + String(packRes.status) + '\n' + (packRes.stderr || ''));
        const tarball = packRes.stdout.trim().split('\n').pop().trim();
        check(tarball.endsWith('.tgz'), () => 'T8/A3(i): could not read tarball name from npm pack: ' + tarball);

        const pkgDir = join(tmp, 'package');
        const untar = spawnSync('tar', ['-xzf', join(tmp, tarball), '-C', tmp], { encoding: 'utf8' });
        check(untar.status === 0, () => 'T8/A3(i): tar -xzf exited ' + String(untar.status) + '\n' + (untar.stderr || ''));

        // Stage the extracted package under a consumer's node_modules so the
        // scoped subpath specifier resolves through the exports map.
        const consumer = join(tmp, 'consumer');
        const scopeDir = join(consumer, 'node_modules', '@zakkster', 'lite-bmfont');
        mkdirSync(dirname(scopeDir), { recursive: true });
        cpSync(pkgDir, scopeDir, { recursive: true });

        const script =
            "const bad = typeof document !== 'undefined';" +
            "Promise.all([import('@zakkster/lite-bmfont'), import('@zakkster/lite-bmfont/atlas')])" +
            ".then(([core, atlas]) => {" +
            "  if (bad) { console.error('DOM present in child'); process.exit(3); }" +
            "  if (typeof core.BitmapFont !== 'function') { console.error('no BitmapFont'); process.exit(4); }" +
            "  if (typeof atlas.generateAtlas !== 'function') { console.error('no generateAtlas'); process.exit(5); }" +
            "  process.exit(0);" +
            "}).catch((e) => { console.error('import threw: ' + (e && e.stack || e)); process.exit(6); });";

        const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: consumer, encoding: 'utf8' });
        check(child.status === 0,
            () => 'T8/A3(i): clean-child DOM-free import failed (exit ' + String(child.status) + '): ' + (child.stderr || ''));
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}

// ---- A4 -- docs-drift guard --------------------------------------------------
function checkDocsDrift() {
    const proto = Object.getOwnPropertyNames(BitmapFont.prototype);
    const skipped = proto.filter((n) => n === 'constructor');
    const privates = proto.filter((n) => n[0] === '_');
    // PINNED filters -- a new private or a second skip reddens here on purpose.
    check(eqSet(skipped, ['constructor']),
        () => 'T8/A4: skipped drifted from [constructor]: ' + JSON.stringify(skipped));
    check(eqSet(privates, ['_measureRange']),
        () => 'T8/A4: privates drifted from [_measureRange]: ' + JSON.stringify(privates));

    const methods = proto.filter((n) => n !== 'constructor' && n[0] !== '_');
    // 9 -> 11 in M5 (v1.9.0): layoutGlyphs and drawQuads. 11 -> 13 in 2.0.0 (0012
    // fork 1): advanceOf and kernOf decode the 1/16 fixed-point store. A deliberate
    // pin amendment, NOT a filter widening -- skipped/privates above stay pinned.
    check(methods.length === 13, () => 'T8/A4: expected 13 public methods, got ' + methods.length + ': ' + methods.join(', '));

    // The callable atlas surface documented as an API heading: functions that are
    // not error classes (error classes are prose-documented, like BitmapFontError).
    const atlasApi = Object.keys(AtlasNS).filter((k) => typeof AtlasNS[k] === 'function' && !/Error$/.test(k));
    check(atlasApi.length >= 1, () => 'T8/A4: Atlas.js exports no callable API');

    // ---- llms.txt: column-0 method signatures (fences stripped) ----
    const llms = readFileSync(resolve(ROOT, 'llms.txt'), 'utf8');
    const llmsLines = stripFences(llms).split('\n');
    const sig = /^([A-Za-z_$][A-Za-z0-9_$]*)\(.*->/;
    const llmsMethods = [];
    for (const l of llmsLines) { const m = l.match(sig); if (m) llmsMethods.push(m[1]); }
    for (const name of methods) {
        check(llmsMethods.includes(name), () => 'T8/A4: llms.txt missing method signature for ' + name);
    }
    for (const name of llmsMethods) {
        check(methods.includes(name),
            () => 'T8/A4: llms.txt documents a method signature ' + name + '() that is not on BitmapFont.prototype');
    }

    // ---- llms.txt exports direction ----
    const names = Array.from(new Set([...Object.keys(BmNS), ...Object.keys(AtlasNS)]));
    const skippedExports = names.filter((n) => n === 'default');
    check(eqSet(skippedExports, ['default']),
        () => 'T8/A4: exports skip list drifted from [default]: ' + JSON.stringify(skippedExports));
    const exported = new Set(names.filter((n) => n !== 'default'));
    // forward: every real export has a heading.
    for (const name of exported) {
        const re = new RegExp('^## Export: ' + name + '\\b', 'm');
        check(re.test(llms), () => 'T8/A4: llms.txt has no "## Export: ' + name + '" heading');
    }
    // backward: every "## Export: NAME" heading names a real export -- a stale
    // heading with no code behind it reddens (the F-31 shape, both directions).
    const headingRe = /^## Export: ([A-Za-z_$][A-Za-z0-9_$]*)/gm;
    let hm;
    while ((hm = headingRe.exec(llms)) !== null) {
        const nm = hm[1];
        check(exported.has(nm),
            () => 'T8/A4: llms.txt has a "## Export: ' + nm + '" heading that names no runtime export');
    }

    // ---- README: backticked API headings, both directions ----
    const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf8');
    const headRe = /^#{2,4} `([A-Za-z_$][A-Za-z0-9_$]*)/;
    const idents = [];
    for (const l of readme.split('\n')) { const m = l.match(headRe); if (m) idents.push(m[1]); }
    // constructor heading is `new BitmapFont(...)` -> ident 'new'.
    for (const name of methods) {
        check(idents.includes(name), () => 'T8/A4: README has no backticked API heading for ' + name);
    }
    for (const name of atlasApi) {
        check(idents.includes(name), () => 'T8/A4: README has no backticked API heading for atlas export ' + name);
    }
    const allowed = new Set([...methods, 'new', ...atlasApi]);
    for (const id of idents) {
        check(allowed.has(id),
            () => 'T8/A4: README documents a backticked API heading `' + id + '` that names no method, constructor or atlas export');
    }
}

export function run() {
    checkPackContents();
    checkCleanChildImport();
    checkDocsDrift();
}
