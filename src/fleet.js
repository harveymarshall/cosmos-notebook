// Mission Control maths: where a spacecraft is at any moment, how far it is from Earth,
// and how long its signals take to reach us. Runs in the browser and in Node (tests).
//
// Positions come from live/positions.json (NASA JPL Horizons, one row a day). Between rows
// we use cubic Hermite interpolation — it uses the velocities as well as the positions, so
// the path curves the way the real orbit does. Past the last row we coast in a straight line.

import { heliocentric, julianDay } from './astro.js';

export const AU = 149597870.7; // km
export const C = 299792.458; // speed of light, km/s
export const LIGHT_DAY = C * 86400; // km
export const SUN_RADIUS = 695700; // km

const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
export const dist = (a, b = [0, 0, 0]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const speed = (v) => Math.hypot(v[0], v[1], v[2]);

/** A spacecraft's position (km) and velocity (km/s) at time t (ms), from its track. */
export function stateAt(track, t) {
  const { t0, dt, p: rows } = track;
  const n = rows.length;
  const f = (t - t0) / dt;
  if (f <= 0 || f >= n - 1) {
    const row = rows[f <= 0 ? 0 : n - 1];
    const tEnd = t0 + (f <= 0 ? 0 : (n - 1) * dt);
    const v = row.slice(3, 6);
    return { pos: add(row.slice(0, 3), v, (t - tEnd) / 1000), vel: v, extrapolated: true };
  }
  const i = Math.floor(f);
  const s = f - i;
  const a = rows[i];
  const b = rows[i + 1];
  const h = dt / 1000; // seconds between rows
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  // derivatives of the basis, for velocity
  const d00 = (6 * s2 - 6 * s) / h;
  const d10 = 3 * s2 - 4 * s + 1;
  const d01 = (-6 * s2 + 6 * s) / h;
  const d11 = 3 * s2 - 2 * s;
  const pos = [0, 1, 2].map((k) => h00 * a[k] + h10 * h * a[k + 3] + h01 * b[k] + h11 * h * b[k + 3]);
  const vel = [0, 1, 2].map((k) => d00 * a[k] + d10 * a[k + 3] + d01 * b[k] + d11 * b[k + 3]);
  return { pos, vel, extrapolated: false };
}

/** Heliocentric position of a planet in km. */
export const planetAt = (planet, t) => {
  const { x, y, z } = heliocentric(planet, julianDay(new Date(t)));
  return [x * AU, y * AU, z * AU];
};
export const earthAt = (t) => planetAt('earth', t);

/** Everything the mission cards show, for one spacecraft at time t. */
export function readout(track, t) {
  const { pos, vel, extrapolated } = stateAt(track, t);
  const earth = earthAt(t);
  const fromEarth = dist(pos, earth);
  return {
    pos,
    vel,
    extrapolated,
    fromSun: dist(pos),
    fromEarth,
    speed: speed(vel), // relative to the Sun
    lightTime: fromEarth / C, // seconds, one way
  };
}

/** First time in [from, to] when f(t) reaches `target` (f rising), to within `tol` ms; or null. */
export function firstCrossing(f, target, from, to, step = 3600000, tol = 1000) {
  let lo = from;
  if (f(lo) >= target) return from;
  for (let hi = from + step; hi <= to + step; hi += step) {
    const end = Math.min(hi, to);
    if (f(end) >= target) {
      let a = lo;
      let b = end;
      while (b - a > tol) {
        const mid = (a + b) / 2;
        if (f(mid) >= target) b = mid;
        else a = mid;
      }
      return b;
    }
    lo = end;
    if (end === to) break;
  }
  return null;
}

/** The last time the track has real (not extrapolated) data for. */
export const trackEnd = (track) => track.t0 + (track.p.length - 1) * track.dt;

// ---------- formatting ----------

const nf = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
export const km = (x) => `${nf.format(Math.round(x))} km`;
export const au = (x) => `${(x / AU).toFixed(x / AU < 10 ? 3 : 2)} AU`;
export const kms = (v) => `${v.toFixed(v < 10 ? 2 : 1)} km/s`;

/** 23h 04m 09s — or 3m 12.4s for short delays. */
export function hms(seconds) {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (h) return `${h}h ${pad(m)}m ${pad(Math.floor(sec))}s`;
  if (m) return `${m}m ${pad(Math.floor(sec))}s`;
  return `${sec.toFixed(1)}s`;
}

/** "12d 04:31:07" style countdown/elapsed time. */
export function span(ms) {
  const neg = ms < 0;
  let s = Math.floor(Math.abs(ms) / 1000);
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const pad = (n) => String(n).padStart(2, '0');
  const out = `${d ? `${d}d ` : ''}${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  return neg ? `-${out}` : out;
}

/** Mission elapsed time since launch, as years and days: "49y 052d". */
export function elapsed(fromIso, t) {
  const start = Date.parse(`${fromIso}T00:00:00Z`);
  let years = new Date(t).getUTCFullYear() - new Date(start).getUTCFullYear();
  const anniversary = (y) => Date.UTC(new Date(start).getUTCFullYear() + y, new Date(start).getUTCMonth(), new Date(start).getUTCDate());
  if (anniversary(years) > t) years--;
  const days = Math.floor((t - anniversary(years)) / 86400000);
  return `${years}y ${String(days).padStart(3, '0')}d`;
}

/** "3 hours ago", "2 days ago" — for "updated" labels. */
export function ago(iso, now = Date.now()) {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return '';
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

/** "1.2 kb/s", "160 b/s" */
export function rate(bps) {
  if (bps == null) return '';
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} Mb/s`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(1)} kb/s`;
  return `${Math.round(bps)} b/s`;
}
