#!/usr/bin/env node
// Fetch real live data on your own computer, for the dev server's /missions/ page:
//
//   node tracker/run-local.mjs              all jobs (positions, dsn, news) — about a minute
//   node tracker/run-local.mjs dsn          just one job
//
// Files are saved in .dev-data/live/, which `node scripts/dev-server.js` serves at /live/.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runJobs } from './src/run.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = join(ROOT, '.dev-data');
const jobs = process.argv.slice(2);

const results = await runJobs(jobs.length ? jobs : ['positions', 'dsn', 'news'], {
  read: async (key) => JSON.parse(await readFile(join(DATA, key), 'utf8')),
  write: async (key, body) => {
    await mkdir(dirname(join(DATA, key)), { recursive: true });
    await writeFile(join(DATA, key), body);
    console.log(`saved ${join('.dev-data', key)} (${(body.length / 1024).toFixed(1)} KB)`);
  },
});
if (Object.values(results).some((r) => r.startsWith('failed'))) process.exitCode = 1;
