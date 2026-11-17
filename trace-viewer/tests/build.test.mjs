import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, copyFile, mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

for (const state of ['missing','empty']) {
 test(`build rejects ${state} select-menu.js before replacing dist`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'trace-viewer-build-'));
  try {
   await copyFile(new URL('../build.mjs', import.meta.url), join(root, 'build.mjs'));
   await cp(new URL('../public/', import.meta.url), join(root, 'public'), {recursive:true});
   await mkdir(join(root, 'dist'));
   const sentinel = join(root, 'dist', 'existing.txt');
   await writeFile(sentinel, 'preserve existing build');
   const script = join(root, 'public', 'select-menu.js');
   if (state === 'missing') await rm(script); else await writeFile(script, '');
   const result = spawnSync(process.execPath, [join(root, 'build.mjs')], {encoding:'utf8'});
   assert.ifError(result.error);
   assert.notEqual(result.status, 0);
   assert.match(result.stderr, /Missing or empty required asset: select-menu\.js/);
   assert.equal(await readFile(sentinel, 'utf8'), 'preserve existing build');
  } finally {
   await rm(root, {recursive:true,force:true});
  }
 });
}
