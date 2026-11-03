// NASA JPL Horizons: where each spacecraft is. We ask for its position and velocity
// relative to the Sun (ecliptic J2000, km and km/s), one row a day, and keep the numbers
// compact. Docs: https://ssd-api.jpl.nasa.gov/doc/horizons.html

const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const DAY = 86400000;

const ymd = (t) => new Date(t).toISOString().slice(0, 10);

/** The Horizons query for one body's daily state vectors between two times (ms). */
export function horizonsUrl(id, start, stop) {
  const q = {
    format: 'json',
    COMMAND: `'${id}'`,
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'VECTORS'",
    CENTER: "'500@10'", // the Sun's centre
    REF_PLANE: "'ECLIPTIC'",
    START_TIME: `'${ymd(start)}'`,
    STOP_TIME: `'${ymd(stop)}'`,
    STEP_SIZE: "'1 d'",
    VEC_TABLE: "'2'", // position and velocity
    OUT_UNITS: "'KM-S'",
    CSV_FORMAT: "'YES'",
  };
  return `${API}?${Object.entries(q)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')}`;
}

/** The window we fetch: the last 180 days (for trails) up to 5 days ahead (so the page keeps
 *  working if a few tracker runs fail). Whole days, so the first row sits on a midnight. */
export function window(now = Date.now(), { back = 180, ahead = 5 } = {}) {
  const today = Math.floor(now / DAY) * DAY;
  return { start: today - back * DAY, stop: today + ahead * DAY };
}

const JD_UNIX_EPOCH = 2440587.5;

/** Turns the text Horizons returns into rows: { t (ms, TDB ≈ UTC), p: [x,y,z,vx,vy,vz] }. */
export function parseVectors(result) {
  const text = String(result || '');
  const start = text.indexOf('$$SOE');
  const end = text.indexOf('$$EOE');
  if (start === -1 || end === -1) {
    const why = text.match(/(No ephemeris[^\n]*|Cannot[^\n]*|No matches found[^\n]*|ERROR[^\n]*)/i);
    throw new Error(why ? why[1].trim() : 'Horizons sent no data table');
  }
  const rows = [];
  for (const line of text.slice(start + 5, end).split('\n')) {
    const cells = line.split(',').map((c) => c.trim());
    if (cells.length < 8 || !cells[0]) continue;
    const jd = Number(cells[0]);
    const p = cells.slice(2, 8).map(Number);
    if (!Number.isFinite(jd) || p.some((v) => !Number.isFinite(v))) continue;
    rows.push({ t: Math.round((jd - JD_UNIX_EPOCH) * DAY), p });
  }
  if (!rows.length) throw new Error('Horizons table was empty');
  return rows;
}

/** Keeps the file small: whole kilometres and metres per second are plenty for a map. */
export function compact(rows) {
  return {
    t0: rows[0].t,
    dt: rows.length > 1 ? rows[1].t - rows[0].t : DAY,
    p: rows.map(({ p }) => [...p.slice(0, 3).map((v) => Math.round(v)), ...p.slice(3).map((v) => Math.round(v * 1000) / 1000)]),
  };
}

/** Fetch one body. Retries once if Horizons says it is busy (HTTP 503). */
export async function fetchVectors(id, { fetch = globalThis.fetch, now = Date.now(), wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const { start, stop } = window(now);
  const url = horizonsUrl(id, start, stop);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (res.status === 503 && attempt === 0) {
      await wait(3000);
      continue;
    }
    if (!res.ok) throw new Error(`Horizons answered ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(String(body.error).split('\n')[0]);
    return compact(parseVectors(body.result));
  }
}
