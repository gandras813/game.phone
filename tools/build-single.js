#!/usr/bin/env node
/**
 * Bundles the game into one self-contained HTML file.
 *
 * The source is plain ES modules with no build step; this concatenates them
 * into a single inline module so the game can be handed over as one file
 * (emailed, dropped on a USB stick, published as an Artifact).
 *
 *   node tools/build-single.js            -> dist/emberwing.html (full document)
 *   node tools/build-single.js --fragment -> dist/emberwing.fragment.html
 *
 * `--fragment` omits the doctype/html/head/body wrapper for hosts that supply
 * their own document shell.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FRAGMENT = process.argv.includes('--fragment');

// Dependency order. The modules have no cycles, so a plain concatenation works.
const MODULES = [
  'config.js', 'rng.js', 'storage.js', 'entities.js', 'world.js',
  'game.js', 'render.js', 'input.js', 'audio.js', 'main.js',
];

const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/** Strip module syntax; the bundle is one scope. */
function flatten(src) {
  return src
    .replace(/^import\b[\s\S]*?from\s*['"][^'"]+['"];?[ \t]*\r?\n/gm, '')
    .replace(/^export\s+(?=(const|let|var|function|class)\b)/gm, '');
}

// `import * as C from './config.js'` becomes a plain namespace object.
const configSrc = read('src/config.js');
const configNames = [...configSrc.matchAll(/^export const (\w+)/gm)].map((m) => m[1]);
const namespace = `\nconst C = { ${configNames.join(', ')} };\n`;

const bundle = MODULES.map((name) => {
  let src = flatten(read(`src/${name}`));
  if (name === 'config.js') src += namespace;
  // The service worker and manifest only exist in the multi-file build.
  if (name === 'main.js') src = src.split('// --- PWA ---')[0];
  return `// ==== src/${name} ${'='.repeat(Math.max(0, 58 - name.length))}\n${src.trim()}\n`;
}).join('\n');

const css = read('styles.css').trim();
const html = read('index.html');
const body = html
  .slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace(/\s*<script type="module"[^>]*><\/script>/, '')
  .trim();

const title = 'Emberwing';
const page = `<title>${title}</title>
<style>
${css}
</style>

${body}

<script type="module">
${bundle}</script>
`;

const doc = FRAGMENT ? page : `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#12071f">
<meta name="description" content="Emberwing: a one-thumb arcade flyer about a purple dragon.">
</head>
<body>
${page}</body>
</html>
`;

mkdirSync(join(ROOT, 'dist'), { recursive: true });
const out = FRAGMENT ? 'dist/emberwing.fragment.html' : 'dist/emberwing.html';
writeFileSync(join(ROOT, out), doc);
console.log(`${out}  ${(doc.length / 1024).toFixed(1)} KB  (${configNames.length} config exports inlined)`);
