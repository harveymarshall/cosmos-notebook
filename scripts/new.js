#!/usr/bin/env node
// Add a new item to the shared library from a template:
//   node scripts/new.js experiment "Measure the Moon's distance"
//   node scripts/new.js book "The Fabric of the Cosmos"

import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const KINDS = {
  experiment: { template: 'experiment.md', folder: 'content/experiments' },
  book: { template: 'book.md', folder: 'content/reading' },
};

const [kind, ...titleParts] = process.argv.slice(2);
const title = titleParts.join(' ').trim();
if (!KINDS[kind] || !title) {
  console.log('Usage: node scripts/new.js <experiment|book> "Title"');
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const slug = title
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');
const name = `${slug}.md`;
const dest = join(ROOT, KINDS[kind].folder, name);

try {
  await access(dest);
  console.error(`Already exists: ${KINDS[kind].folder}/${name}`);
  process.exit(1);
} catch {}

const template = await readFile(join(ROOT, 'templates', KINDS[kind].template), 'utf8');
await writeFile(dest, template.replaceAll('{{title}}', title.replace(/"/g, "'")).replaceAll('{{date}}', today));
console.log(`Created ${KINDS[kind].folder}/${name}\nEdit it, then run: node build.js`);
