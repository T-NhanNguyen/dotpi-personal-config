// Isolated real production entry points. Faults/barriers exist only in this child.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {createRequire, syncBuiltinESMExports} from 'node:module';

const options = JSON.parse(process.argv[2]);
const file = path.join(options.cwd, '.dev-vault/traces', options.trace || 't', 'trace.jsonl');
let fault = options.fault, barrier = options.barrier, listenAddress;
// fork() pipes are nonblocking on Unix. A synchronous barrier must wait for
// the parent's release byte, not throw EAGAIN and exit after acknowledging.
if (barrier || options.startBarrier) {
 const handle = process.stdin._handle;
 if (typeof handle?.setBlocking !== 'function') throw Error('Barrier requires a blocking stdin pipe');
 handle.setBlocking(true); // Test-only Node pipe handle; never used by production.
}
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function(...args) {
 this.once('listening', () => { listenAddress = this.address().address; });
 return listen.apply(this,args);
};
const descriptors = new Map();
const notify = message => process.send?.(message);
const pause = event => {
 notify({event});
 // A pipe, rather than a timer or IPC callback, releases synchronous filesystem code.
 const byte = Buffer.alloc(1);
 if (fs.readSync(0, byte, 0, 1, null) !== 1) throw Error('Barrier release pipe closed');
};
const original = Object.fromEntries(['mkdirSync','openSync','closeSync','writeFileSync','renameSync','appendFileSync'].map(key => [key, fs[key]]));
fs.mkdirSync = function(name, ...args) {
 const locked = String(name) === file + '.mutation-lock';
 if (locked) notify({event:'lock-attempt'});
 try {
  const result = original.mkdirSync.call(fs, name, ...args);
  if (locked) {
   notify({event:'lock-held'});
   if (barrier === 'held') { barrier = null; pause('held'); }
  }
  return result;
 } catch (error) { if (locked && error.code === 'EEXIST') notify({event:'lock-wait'}); throw error; }
};
fs.openSync = function(name, ...args) {
 const fd = original.openSync.call(fs, name, ...args); descriptors.set(fd, String(name)); return fd;
};
fs.closeSync = function(fd) { descriptors.delete(fd); return original.closeSync.call(fs, fd); };
fs.writeFileSync = function(destination, ...args) {
 const name = typeof destination === 'number' ? descriptors.get(destination) : String(destination);
 if (fault === 'write' && name && path.dirname(name) === path.dirname(file) && /^\.trace-.*\.tmp$/.test(path.basename(name))) throw Error('injected precommit write failure');
 return original.writeFileSync.call(fs, destination, ...args);
};
fs.renameSync = function(source, destination) {
 if (String(destination) === file && /^\.trace-.*\.tmp$/.test(path.basename(String(source)))) {
  if (barrier === 'rename') { barrier = null; pause('pre-rename'); }
  if (fault === 'rename') throw Error('injected precommit rename failure');
 }
 return original.renameSync.call(fs, source, destination);
};
fs.appendFileSync = function(destination, ...args) {
 if (fault === 'append' && String(destination) === file) throw Error('injected append after reservation failure');
 return original.appendFileSync.call(fs, destination, ...args);
};
syncBuiltinESMExports();

async function extensionAppend(input) {
 const host = process.env.PI_TEST_HOST;
 if (!host || !fs.existsSync(path.join(host, 'package.json'))) throw Error('Explicit compatible PI_TEST_HOST required');
 const require = createRequire(path.join(host, 'package.json'));
 const {createJiti} = require('jiti');
 const compat = [path.join(path.dirname(host), 'pi-ai/dist/compat.js'), path.join(host, 'node_modules/@earendil-works/pi-ai/dist/compat.js')].find(p => fs.existsSync(p));
 if (!compat) throw Error('PI_TEST_HOST lacks pi-ai compat.js');
 const alias = {
  '@earendil-works/pi-coding-agent':path.join(host,'dist/index.js'),
  '@earendil-works/pi-ai':compat,
  '@earendil-works/pi-agent-core':path.join(host,'node_modules/@earendil-works/pi-agent-core/dist/index.js'),
  '@earendil-works/pi-tui':path.join(host,'node_modules/@earendil-works/pi-tui/dist/index.js'),
  typebox:require.resolve('typebox'),
 };
 const jiti = createJiti(import.meta.url, {alias, moduleCache:false});
 const factory = await jiti.import(new URL('../../extensions/traces/index.ts', import.meta.url).pathname, {default:true});
 let append;
 factory({registerTool(tool) { if (tool.name === 'trace_append') append = tool; }, registerCommand() {}});
 if (!append) throw Error('trace_append not registered');
 if (options.startBarrier) pause('prepared');
 return append.execute('review-deletion-fixture', input, undefined, undefined, {cwd:options.cwd});
}
try {
 if (options.mode === 'server') {
  process.env.TRACE_VIEWER_CONFIG = options.config;
  const {startServer} = await import('../server.ts');
  const server = await startServer({cwd:options.cwd, port:0, trace:'', sessionsDir:options.sessions});
  notify({event:'ready', port:server.port, address:listenAddress});
  process.on('message', async message => {
   if (message.command === 'fault') { fault = message.fault; notify({event:'configured'}); }
   if (message.command === 'close') { await server.close(); process.disconnect(); }
  });
 } else {
  let result;
  if (options.mode === 'extension') result = await extensionAppend(options.input);
  else if (options.mode === 'append') {
   const {appendReview} = await import('../../extensions/traces/core.ts');
   if (options.startBarrier) pause('prepared');
   result = appendReview(path.dirname(path.dirname(file)), options.trace || 't', options.input);
  } else if (options.mode === 'hold') {
   const {withTraceLock} = await import('../../extensions/traces/mutation.ts');
   result = withTraceLock(file, () => 'released');
  } else if (options.mode === 'delete') {
   const {deleteReviews} = await import('../review-deletion.ts');
   // Authorization must originate in this process, whose secret is launch-specific.
   const preview = deleteReviews(path.dirname(path.dirname(file)), options.trace || 't', options.selection);
   result = deleteReviews(path.dirname(path.dirname(file)), options.trace || 't', options.selection, preview.body.preview.authorization);
  } else if (options.mode === 'plan') {
   const {planReviewDeletion} = await import('../../extensions/traces/review-deletion.ts');
   const {deleteReviews} = await import('../review-deletion.ts');
   const root = path.dirname(path.dirname(file)), trace = options.trace || 't';
   const plan = planReviewDeletion(options.records, options.selection);
   const preview = deleteReviews(root, trace, options.selection);
   result = {plan, commit:deleteReviews(root, trace, options.selection, preview.body.preview.authorization)};
  } else throw Error('Unknown child mode');
  notify({event:'result', result});
  process.disconnect();
 }
} catch (error) { notify({event:'error', error:error.stack || error.message, code:error.code}); process.exitCode = 1; process.disconnect?.(); }
