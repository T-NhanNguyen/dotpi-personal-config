// Remap fictional session-directory encoding without touching real pi sessions.
import { mkdtemp, mkdir, readdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const workspace = dirname(fileURLToPath(import.meta.url));
export async function prepareSessions(cwd = workspace) {
 const parent = await mkdtemp(join(tmpdir(), 'synthetic-trace-sessions-'));
 const encoded = `--${resolve(cwd).replace(/^[/\\]+/, '').replace(/[/\\:]/g, '-')}--`;
 const target = join(parent, encoded);
 await mkdir(target);
 const source = join(workspace, 'sessions', '--synthetic-nonportable-workspace--');
 for (const file of await readdir(source)) await copyFile(join(source, file), join(target, file));
 return parent;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(await prepareSessions());
