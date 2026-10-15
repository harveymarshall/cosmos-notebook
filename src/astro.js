// Small, dependency-free astronomy for "Tonight's sky".
// Planet positions use NASA JPL's "Approximate Positions of the Planets" Keplerian
// elements (valid 1800–2050, accurate to well under a degree — plenty for "where do I look").
// Runs in the browser and in Node (tests).

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const norm360 = (x) => ((x % 360) + 360) % 360;
const norm180 = (x) => { const y = norm360(x); return y > 180 ? y - 360 : y; };

export const julianDay = (date) => date.getTime() / 86400000 + 2440587.5;

// a (AU), e, I (deg), L (deg), long. perihelion (deg), long. ascending node (deg) — value, rate per century
const ELEMENTS = {
  mercury: [[0.38709927, 0.00000037], [0.20563593, 0.00001906], [7.00497902, -0.00594749], [252.2503235, 149472.67411175], [77.45779628, 0.16047689], [48.33076593, -0.12534081]],
  venus: [[0.72333566, 0.0000039], [0.00677672, -0.00004107], [3.39467605, -0.0007889], [181.9790995, 58517.81538729], [131.60246718, 0.00268329], [76.67984255, -0.27769418]],
  earth: [[1.00000261, 0.00000562], [0.01671123, -0.00004392], [-0.00001531, -0.01294668], [100.46457166, 35999.37244981], [102.93768193, 0.32327364], [0, 0]],
  mars: [[1.52371034, 0.00001847], [0.0933941, 0.00007882], [1.84969142, -0.00813131], [-4.55343205, 19140.30268499], [-23.94362959, 0.44441088], [49.55953891, -0.29257343]],
  jupiter: [[5.202887, -0.00011607], [0.04838624, -0.00013253], [1.30439695, -0.00183714], [34.39644051, 3034.74612775], [14.72847983, 0.21252668], [100.47390909, 0.20469106]],
  saturn: [[9.53667594, -0.0012506], [0.05386179, -0.00050991], [2.48599187, 0.00193609], [49.95424423, 1222.49362201], [92.59887831, -0.41897216], [113.66242448, -0.28867794]],
};

function heliocentric(planet, jd) {
  const T = (jd - 2451545.0) / 36525;
  const [a, e, I, L, wbar, node] = ELEMENTS[planet].map(([v, r]) => v + r * T);
  const w = wbar - node;
  const M = norm180(L - wbar);
  // Solve Kepler's equation (degrees)
  const eDeg = e * DEG;
  let E = M + eDeg * Math.sin(M * RAD);
  for (let i = 0; i < 10; i++) {
    const dM = M - (E - eDeg * Math.sin(E * RAD));
    const dE = dM / (1 - e * Math.cos(E * RAD));
    E += dE;
    if (Math.abs(dE) < 1e-7) break;
  }
  const xp = a * (Math.cos(E * RAD) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E * RAD);
  const [cw, sw, cO, sO, cI, sI] = [w, w, node, node, I, I].map((v, i) => (i % 2 ? Math.sin : Math.cos)(v * RAD));
  return {
    x: (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    y: (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    z: sw * sI * xp + cw * sI * yp,
  };
}

const OBLIQUITY = 23.43928 * RAD;
function toEquatorial({ x, y, z }) {
  const ye = y * Math.cos(OBLIQUITY) - z * Math.sin(OBLIQUITY);
  const ze = y * Math.sin(OBLIQUITY) + z * Math.cos(OBLIQUITY);
  return { ra: norm360(Math.atan2(ye, x) * DEG), dec: Math.atan2(ze, Math.hypot(x, ye)) * DEG, dist: Math.hypot(x, y, z) };
}

/** Geocentric RA/Dec (degrees) and distance (AU) of the Sun or a planet. */
export function position(body, date) {
  const jd = julianDay(date);
  const earth = heliocentric('earth', jd);
  if (body === 'sun') return toEquatorial({ x: -earth.x, y: -earth.y, z: -earth.z });
  const p = heliocentric(body, jd);
  return toEquatorial({ x: p.x - earth.x, y: p.y - earth.y, z: p.z - earth.z });
}

/** Angle between the Sun and a planet as seen from Earth (degrees). */
export function elongation(body, date) {
  const s = position('sun', date);
  const p = position(body, date);
  const v = ({ ra, dec }) => [Math.cos(dec * RAD) * Math.cos(ra * RAD), Math.cos(dec * RAD) * Math.sin(ra * RAD), Math.sin(dec * RAD)];
  const [a, b] = [v(s), v(p)];
  return Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * DEG;
}

/** Altitude and azimuth (degrees; azimuth from north, clockwise) for an observer. */
export function horizontal({ ra, dec }, date, lat, lon) {
  const jd = julianDay(date);
  const gmst = norm360(280.46061837 + 360.98564736629 * (jd - 2451545.0));
  const H = (gmst + lon - ra) * RAD;
  const [phi, d] = [lat * RAD, dec * RAD];
  const alt = Math.asin(Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(H));
  const az = Math.atan2(-Math.cos(d) * Math.sin(H), Math.sin(d) * Math.cos(phi) - Math.cos(d) * Math.cos(H) * Math.sin(phi));
  return { alt: alt * DEG, az: norm360(az * DEG) };
}

export const compass = (az) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(norm360(az) / 45) % 8];

// ---------- the Moon's phase ----------
const SYNODIC = 29.530588853;
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

export function moonPhase(date) {
  const age = ((((date.getTime() - KNOWN_NEW_MOON) / 86400000) % SYNODIC) + SYNODIC) % SYNODIC;
  const illumination = (1 - Math.cos((2 * Math.PI * age) / SYNODIC)) / 2;
  const steps = [
    [1.85, 'New moon', 'new'], [5.54, 'Waxing crescent', 'crescent'], [9.23, 'First quarter', 'half'],
    [12.92, 'Waxing gibbous', 'full'], [16.61, 'Full moon', 'full'], [20.3, 'Waning gibbous', 'full'],
    [23.99, 'Last quarter', 'half'], [27.68, 'Waning crescent', 'crescent'], [Infinity, 'New moon', 'new'],
  ];
  const [, name, shape] = steps.find(([limit]) => age < limit);
  return { age, illumination, name, shape, waxing: age < SYNODIC / 2 };
}

// ---------- what's worth a look tonight ----------
export const PLANETS = [
  { id: 'venus', name: 'Venus', how: 'Eye', note: 'brilliant “evening/morning star”' },
  { id: 'jupiter', name: 'Jupiter', how: 'Binoculars', note: 'look for its four moons' },
  { id: 'saturn', name: 'Saturn', how: 'Eye', note: 'rings need a small telescope' },
  { id: 'mars', name: 'Mars', how: 'Eye', note: 'orange-red point of light' },
  { id: 'mercury', name: 'Mercury', how: 'Eye', note: 'low in twilight — a rare catch' },
];

// Bright deep-sky objects (J2000 RA/Dec, degrees)
export const DEEP_SKY = [
  { id: 'm31', name: 'Andromeda Galaxy', ra: 10.68, dec: 41.27, how: 'Binoculars', note: '2.5 million light years away' },
  { id: 'm45', name: 'The Pleiades', ra: 56.75, dec: 24.12, how: 'Eye', note: 'the Seven Sisters star cluster' },
  { id: 'm42', name: 'Orion Nebula', ra: 83.82, dec: -5.39, how: 'Binoculars', note: 'a star nursery in Orion’s sword' },
  { id: 'dc', name: 'Double Cluster', ra: 34.75, dec: 57.13, how: 'Binoculars', note: 'two star clusters side by side' },
  { id: 'm13', name: 'Hercules Cluster', ra: 250.42, dec: 36.46, how: 'Binoculars', note: 'a ball of 300,000 stars' },
  { id: 'm44', name: 'Beehive Cluster', ra: 130.1, dec: 19.67, how: 'Binoculars', note: 'a swarm of stars in Cancer' },
];

const STEP_MIN = 10;

/**
 * Plan a night: the dark window (Sun more than 12° below the horizon), and when each
 * planet and bright object is best placed. `date` is any moment on the evening in question.
 */
export function planNight(date, lat, lon) {
  // Search from local noon on this day for 24 hours
  const start = new Date(date);
  start.setHours(12, 0, 0, 0);
  const samples = [];
  for (let m = 0; m <= 24 * 60; m += STEP_MIN) {
    const t = new Date(start.getTime() + m * 60000);
    samples.push({ t, sun: horizontal(position('sun', t), t, lat, lon).alt });
  }
  const windowFor = (limit) => {
    const dark = samples.filter((s) => s.sun < limit);
    return dark.length ? { start: dark[0].t, end: dark[dark.length - 1].t, samples: dark } : null;
  };
  const dark = windowFor(-12) || windowFor(-6);
  const twilight = windowFor(-6) || dark;

  const best = (coords, window) => {
    let top = null;
    for (const s of window.samples) {
      const h = horizontal(typeof coords === 'function' ? coords(s.t) : coords, s.t, lat, lon);
      if (!top || h.alt > top.alt) top = { ...h, t: s.t };
    }
    return top;
  };

  const planets = !twilight
    ? []
    : PLANETS.map((p) => {
        const top = best((t) => position(p.id, t), twilight);
        return { ...p, alt: top.alt, az: top.az, dir: compass(top.az), at: top.t, elongation: elongation(p.id, top.t) };
      }).filter((p) => p.alt > 8 && p.elongation > 12);

  const deepSky = !dark
    ? []
    : DEEP_SKY.map((o) => {
        const top = best({ ra: o.ra, dec: o.dec }, dark);
        return { ...o, alt: top.alt, az: top.az, dir: compass(top.az), at: top.t };
      })
        .filter((o) => o.alt > 30)
        .sort((a, b) => b.alt - a.alt)
        .slice(0, 3);

  return {
    darkStart: dark?.start || null,
    darkEnd: dark?.end || null,
    fullyDark: !!windowFor(-12),
    planets,
    deepSky,
    moon: moonPhase(dark?.start || date),
  };
}

/**
 * GO / MAYBE / NO-GO from an hourly cloud forecast ([{ time: Date, cloud: 0-100 }]),
 * looking only at the dark hours, and the best 2-hour stretch.
 */
export function verdict(hourly, darkStart, darkEnd) {
  const inDark = hourly.filter((h) => h.time >= darkStart && h.time <= darkEnd);
  if (!inDark.length) return null;
  let bestStart = 0;
  let bestAvg = Infinity;
  for (let i = 0; i < inDark.length; i++) {
    const slice = inDark.slice(i, i + 2);
    const avg = slice.reduce((n, h) => n + h.cloud, 0) / slice.length;
    if (avg < bestAvg) {
      bestAvg = avg;
      bestStart = i;
    }
  }
  const level = bestAvg < 30 ? 'GO' : bestAvg < 60 ? 'MAYBE' : 'NO-GO';
  return { level, bestAvg: Math.round(bestAvg), from: inDark[bestStart].time, to: new Date(inDark[bestStart].time.getTime() + 2 * 3600000) };
}

/** Next date (on or after `from`) of a yearly event given as "MM-DD", or a one-off "YYYY-MM-DD". */
export function nextOccurrence(when, from = new Date()) {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  if (/^\d{4}-\d{2}-\d{2}$/.test(when)) {
    const [y, m, d] = when.split('-').map(Number);
    const t = new Date(y, m - 1, d);
    return t >= today ? t : null;
  }
  const [m, d] = when.split('-').map(Number);
  let t = new Date(from.getFullYear(), m - 1, d);
  if (t < today) t = new Date(from.getFullYear() + 1, m - 1, d);
  return t;
}
