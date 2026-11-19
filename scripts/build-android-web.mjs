/**
 * Copy the reviewed Quiet Spaces web assets into Capacitor's native webDir.
 * The GitHub Pages PWA still serves the root files directly.
 * Never copy private journal data, backups, node_modules or the PWA service worker.
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const destination = join(root, 'www');
const assets = [
  'index.html',
  'styles.css',
  'spaces.css',
  'db.js',
  'exercise-guide.js',
  'spaces.js',
  'app.js',
  'manifest.webmanifest'
];

await rm(destination, {recursive: true, force: true});
await mkdir(destination, {recursive: true});

for (const name of assets) {
  await cp(join(root, name), join(destination, name));
}
await cp(join(root, 'icons'), join(destination, 'icons'), {recursive: true});

// Same HTML/JS app; only the PWA installation and web-only auto-updater differ.
// In the Android wrapper, the update mechanism is disabled in app.js.
const index = await readFile(join(destination, 'index.html'), 'utf8');
const dbTag = '<script defer src="./db.js"></script>';
if (!index.includes(dbTag) || !index.includes('./app.js')) {
  throw new Error('Cannot package Quiet Spaces: required app script tags not found.');
}
await writeFile(join(destination, 'native-env.js'),
  "'use strict'; globalThis.QuietSpacesNative = true;\n", 'utf8');
await writeFile(join(destination, 'index.html'),
  index.replace(dbTag, '<script defer src="./native-env.js"></script>\n  ' + dbTag), 'utf8');

console.log('Prepared Quiet Spaces Android web bundle in www/ (' + assets.length + ' files + icons).');
