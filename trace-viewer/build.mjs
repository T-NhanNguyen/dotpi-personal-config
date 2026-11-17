// Canonical static assets live in public; never fall back to the legacy React app.
import { copyFile, lstat, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const source = join(root, 'public');
const destination = join(root, 'dist');
const required = [
	'index.html',
	'app.js',
	'organic-layout.js',
	'select-menu.js',
	'style.css',
	'fonts/dm-sans.ttf',
	'fonts/space-grotesk.ttf',
	'fonts/DM-Sans-OFL.txt',
	'fonts/Space-Grotesk-OFL.txt',
];

// Reject symlinks before any writes so assets cannot redirect the build elsewhere.
async function listAssets(directory, prefix = '') {
	if (!(await lstat(directory)).isDirectory()) {
		throw new Error(`Expected an asset directory: ${directory}`);
	}
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...await listAssets(path, relative));
		} else if (entry.isFile()) {
			files.push(relative);
		} else {
			throw new Error(`Unsupported asset (only regular files allowed): ${path}`);
		}
	}
	return files.sort();
}

const files = await listAssets(source);
for (const relative of required) {
	if (!files.includes(relative) || (await lstat(join(source, relative))).size === 0) {
		throw new Error(`Missing or empty required asset: ${relative}`);
	}
}
try {
	if (!(await lstat(destination)).isDirectory()) {
		throw new Error('dist must be a real directory, not a symlink or file');
	}
} catch (error) {
	if (error.code !== 'ENOENT') throw error;
}

// Clear only dist, after validation, so obsolete Vite bundles cannot survive.
await rm(destination, { recursive: true, force: true });
await mkdir(destination);
for (const relative of files) {
	const output = join(destination, relative);
	await mkdir(dirname(output), { recursive: true });
	await copyFile(join(source, relative), output);
}
console.log(`Built ${files.length} static assets from public to dist.`);
