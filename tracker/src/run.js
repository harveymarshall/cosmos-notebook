// The tracker's jobs. Each one fetches from NASA (or the news API) and saves one small JSON
// file the website reads: live/positions.json, live/dsn.json and live/news.json.
// Storage is passed in (S3 in AWS, a folder on your computer), so the jobs are easy to test.

import { MISSIONS } from './missions.js';
import { fetchVectors } from './horizons.js';
import { fetchDsn } from './dsn.js';
import { fetchNews } from './news.js';

export const FILES = {
  positions: { key: 'live/positions.json', maxAge: 900 },
  dsn: { key: 'live/dsn.json', maxAge: 30 },
  news: { key: 'live/news.json', maxAge: 900 },
};

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Positions for every mission. One failed spacecraft never blanks the map: it keeps the
 * position from the previous run (marked stale) until Horizons answers again.
 */
export async function positionsJob({ fetch, read, now = Date.now(), wait = pause, missions = MISSIONS }) {
  const previous = (await read(FILES.positions.key).catch(() => null)) || {};
  const craft = {};
  const errors = [];
  for (const m of missions) {
    try {
      craft[m.slug] = { id: m.horizons, ...(await fetchVectors(m.horizons, { fetch, now, wait })) };
    } catch (err) {
      errors.push(`${m.slug}: ${err.message}`);
      const old = previous.craft?.[m.slug];
      if (old) craft[m.slug] = { ...old, stale: true };
    }
    await wait(250); // be gentle with Horizons
  }
  if (!Object.keys(craft).length) throw new Error(`No positions at all: ${errors.join('; ')}`);
  return {
    generated: new Date(now).toISOString(),
    source: 'NASA/JPL Horizons',
    frame: 'Heliocentric ecliptic J2000; km and km/s',
    craft,
    errors,
  };
}

export async function dsnJob({ fetch, now = Date.now() }) {
  const dishes = await fetchDsn({ fetch, now });
  return { generated: new Date(now).toISOString(), source: 'NASA Deep Space Network (DSN Now)', dishes };
}

export async function newsJob({ fetch, now = Date.now(), missions = MISSIONS }) {
  const news = await fetchNews(missions, { fetch });
  return { generated: new Date(now).toISOString(), source: 'Spaceflight News API', ...news };
}

const JOBS = { positions: positionsJob, dsn: dsnJob, news: newsJob };

/** Run some jobs and save what they make. A failed job leaves its old file in place. */
export async function runJobs(names, { fetch = globalThis.fetch, read, write, now = Date.now(), wait = pause, log = console }) {
  const results = {};
  for (const name of names) {
    const job = JOBS[name];
    if (!job) throw new Error(`Unknown job "${name}" (try: ${Object.keys(JOBS).join(', ')})`);
    try {
      const data = await job({ fetch, read, now, wait });
      await write(FILES[name].key, JSON.stringify(data), FILES[name].maxAge);
      results[name] = data.errors?.length ? `ok with ${data.errors.length} problem(s): ${data.errors.join('; ')}` : 'ok';
    } catch (err) {
      results[name] = `failed: ${err.message}`;
      log.error(`${name} failed:`, err);
    }
  }
  log.log(JSON.stringify(results));
  return results;
}
