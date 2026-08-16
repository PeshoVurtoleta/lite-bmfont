/** T8 -- the packaging / docs-drift poison door. Registered empty in M0; filled by M7. */
export const TODO = 'M7';
export function run() {
    process.stderr.write('torture: TODO -- T8 packaging is registered but empty (filled by M7)\n');
}
