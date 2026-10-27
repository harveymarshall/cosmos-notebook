// Mission Control: a live, animated map of the spacecraft exploring the Solar System, with
// ticking distance and signal-time readouts, which Deep Space Network dishes are talking to
// them right now, upcoming milestones and mission news.
//
// Data: /live/positions.json, /live/dsn.json and /live/news.json, written on a schedule by
// the tracker Lambda (tracker/). Planets are calculated on the device (src/astro.js).
import { render, $, $$, esc } from '../ui.js';
import { MISSIONS, milestoneTime } from '../lib/missions.js';
import { readout, stateAt, planetAt, firstCrossing, trackEnd, LIGHT_DAY, AU, km, au, kms, hms, span, elapsed, ago, rate } from '../lib/fleet.js';
import { currentTheme } from '../theme.js';

const DAY = 86400000;
const REPLAY_DAYS = 180;
const REPLAY_MS = 14000;
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const state = {
  positions: null,
  dsn: null,
  news: null,
  selected: 'voyager-1',
  hover: null,
  scale: 'all',
  replay: null, // { started, from, to }
  newsFilter: 'all',
  lightDay: null, // when Voyager 1 passes one light-day from Earth (ms), if it's coming up
};

const tracks = () => state.positions?.craft || {};
const trackOf = (slug) => tracks()[slug] || null;
const missionName = (slug) => MISSIONS.find((m) => m.slug === slug)?.name || slug;

async function getJson(path) {
  try {
    const res = await fetch(path, { cache: 'no-cache' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// Common DSN Now codes for spacecraft that aren't on our list
const DSN_NAMES = {
  MRO: 'Mars Reconnaissance Orbiter', MVN: 'MAVEN', M20: 'Perseverance rover', MSL: 'Curiosity rover', JNO: 'Juno',
  JWST: 'James Webb Space Telescope', TGO: 'ExoMars Trace Gas Orbiter', MEX: 'Mars Express', LRO: 'Lunar Reconnaissance Orbiter',
  KPLO: 'Danuri (Korea Pathfinder Lunar Orbiter)', SOHO: 'SOHO', ACE: 'ACE', WIND: 'Wind', STA: 'STEREO-A', EMM: 'Hope (Emirates Mars Mission)',
  GAIA: 'Gaia', EUCL: 'Euclid', SPP: 'Parker Solar Probe', ORX: 'OSIRIS-APEX',
};
const craftLabel = (link) => {
  const m = MISSIONS.find((x) => x.horizons === link.id);
  return m ? m.name : DSN_NAMES[link.craft] || link.craft;
};
/** The DSN links for one mission right now, e.g. [{ station: 'Madrid', dish: 'DSS63', ... }] */
const dsnLinksFor = (mission) =>
  (state.dsn?.dishes || []).flatMap((d) => d.links.filter((l) => l.id === mission.horizons && (l.down || l.up)).map((l) => ({ ...l, station: d.station, dish: d.dish })));

// ---------------------------------------------------------------- page

function page() {
  const fleet = MISSIONS.map(
    (m) => `<article class="card mc-card" id="m-${m.slug}" data-slug="${m.slug}">
  <div class="card-meta"><span class="tag">${esc(m.agency)}</span><span class="tag inv mc-live" data-f="dsn" hidden></span></div>
  <h3><button class="linkish mc-pick" type="button" data-slug="${m.slug}" aria-label="Show ${esc(m.name)} on the map">${esc(m.name)}</button></h3>
  <p class="mc-where">${esc(m.where)}<span class="muted small" data-f="note"></span></p>
  <div class="readouts mc-readouts">
    <div class="wide"><p class="k">From Earth</p><p class="v" data-f="earth">—</p></div>
    <div class="half"><p class="k">Signal time (one way)</p><p class="v" data-f="light">—</p></div>
    <div><p class="k">From Sun</p><p class="v" data-f="sun">—</p></div>
    <div><p class="k">Speed</p><p class="v" data-f="speed">—</p></div>
  </div>
  <p class="mc-ms small" data-f="next"></p>
  <details class="mc-about"><summary class="px small">About the mission</summary><p class="small">${esc(m.about)}</p>${milestoneList(m)}</details>
  <div class="card-foot"><span>Launched ${esc(m.launched.slice(0, 4))} · mission time <span class="lcd" data-f="met">${elapsed(m.launched, Date.now())}</span></span><button class="linkish small" type="button" data-news="${m.slug}" hidden>News</button></div>
</article>`
  ).join('');

  render(`
<section class="mc-next" aria-label="Coming up"><div id="mc-banner"></div><ol class="mc-upcoming" id="mc-upcoming"></ol></section>
<div class="mc-grid">
  <figure class="win mc-map">
    <div class="win-bar"><span>Solar System · from above</span><span class="fill dither" aria-hidden="true"></span><span class="lcd mc-clock" id="mc-clock"></span></div>
    <div class="mc-screen" id="mc-screen"><canvas id="mc-canvas" role="img" aria-label="Map of the Solar System from above, showing the planets and where each spacecraft is now"></canvas></div>
    <figcaption class="mc-controls">
      <div class="status-picker" role="radiogroup" aria-label="Zoom">
        <label class="seg"><input type="radio" name="scale" value="inner"><span>Inner planets</span></label>
        <label class="seg"><input type="radio" name="scale" value="mid"><span>To Jupiter</span></label>
        <label class="seg"><input type="radio" name="scale" value="all" checked><span>Whole fleet</span></label>
      </div>
      <button class="btn small" type="button" id="mc-replay">Replay 6 months</button>
    </figcaption>
    <p class="mc-status small" id="mc-status" role="status"></p>
  </figure>
  <section class="win mc-dsn" aria-labelledby="dsn-title">
    <div class="win-bar"><span id="dsn-title">Deep Space Network · now</span><span class="fill dither" aria-hidden="true"></span><span class="mc-blink" aria-hidden="true">●</span></div>
    <div class="win-body" id="mc-dsn"><p class="muted">Listening…</p></div>
  </section>
</div>

<div class="section-row"><h2 class="section-title">The fleet</h2></div>
<div class="mc-fleet">${fleet}</div>

<div class="section-row" id="news"><h2 class="section-title">Mission news</h2></div>
<div class="filters mc-news-filters" id="mc-news-filters"></div>
<ul class="list mc-news" id="mc-news"><li class="muted">Fetching headlines…</li></ul>`);
}

function milestoneList(m) {
  const now = Date.now();
  return `<ul class="mc-milestones small">${m.milestones
    .map((ms) => {
      const { t, exact } = milestoneTime(ms);
      const when = new Date(t).toLocaleDateString('en-GB', { day: exact ? 'numeric' : undefined, month: 'short', year: 'numeric', timeZone: 'UTC' });
      return `<li class="${t < now ? 'done' : 'todo'}"><span class="lcd">${esc(when)}</span> ${esc(ms.label)}</li>`;
    })
    .join('')}</ul>`;
}

// ---------------------------------------------------------------- upcoming + banner

function upcoming(now) {
  const items = [];
  for (const m of MISSIONS) {
    for (const ms of m.milestones) {
      const { t, exact } = milestoneTime(ms);
      // Month-only dates stay listed until the month is over
      const end = exact ? t + DAY : Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth() + 1, 1);
      if (end > now) items.push({ t, exact, mission: m, label: ms.label });
    }
  }
  if (state.lightDay && state.lightDay > now) {
    items.push({ t: state.lightDay, exact: true, mission: MISSIONS[0], label: 'One light-day from Earth (calculated live from its trajectory)' });
  }
  return items.sort((a, b) => a.t - b.t).slice(0, 5);
}

function drawUpcoming() {
  const now = Date.now();
  const list = $('#mc-upcoming');
  if (!list) return;
  const items = upcoming(now);
  const key = items.map((i) => `${i.mission.slug}${i.t}`).join('|');
  if (list.dataset.key !== key) {
    list.dataset.key = key;
    list.innerHTML = items
      .map(
        (i, n) => `<li><span class="lcd mc-count" data-n="${n}"></span><span><button class="linkish mc-pick" type="button" data-slug="${i.mission.slug}">${esc(i.mission.name)}</button> · ${esc(i.label)}</span></li>`
      )
      .join('');
  }
  items.forEach((i, n) => {
    const el = list.querySelector(`[data-n="${n}"]`);
    if (!el) return;
    if (!i.exact) el.textContent = new Date(i.t).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    else if (i.t <= now) el.textContent = 'Today';
    else el.textContent = span(i.t - now);
  });
}

function drawBanner(now) {
  const box = $('#mc-banner');
  const v1 = trackOf('voyager-1');
  if (!box || !v1) return box && (box.innerHTML = '');
  const r = readout(v1, now);
  let html;
  if (state.lightDay && state.lightDay > now) {
    const when = new Date(state.lightDay).toLocaleString('en-GB', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
    html = `<p class="eyebrow">Voyager 1 · approaching one light-day</p>
<p class="mc-big lcd">${span(state.lightDay - now)}</p>
<p>until Voyager 1 is so far away that its radio signals take a <strong>whole day</strong> to reach us — about ${esc(when)}. Right now they take <span class="lcd" data-f="v1-light">${hms(r.lightTime)}</span>.</p>`;
  } else {
    html = `<p class="eyebrow">Voyager 1 · ${r.lightTime >= 86400 ? 'more than a light-day away' : 'humanity\'s farthest messenger'}</p>
<p class="mc-big lcd">${hms(r.lightTime)}</p>
<p>for a signal from Voyager 1 to reach Earth. It is ${esc(km(r.fromEarth))} away and still going.</p>`;
  }
  // Only rebuild when the wording changes; numbers tick in place
  if (box.dataset.mode !== String(state.lightDay > now)) {
    box.dataset.mode = String(state.lightDay > now);
    box.innerHTML = html;
  } else {
    box.querySelector('.mc-big').textContent = state.lightDay > now ? span(state.lightDay - now) : hms(r.lightTime);
    const lt = box.querySelector('[data-f="v1-light"]');
    if (lt) lt.textContent = hms(r.lightTime);
  }
}

function findLightDay() {
  const v1 = trackOf('voyager-1');
  state.lightDay = null;
  if (!v1) return;
  const now = Date.now();
  const f = (t) => readout(v1, t).fromEarth;
  if (f(now) >= LIGHT_DAY) return;
  state.lightDay = firstCrossing(f, LIGHT_DAY, now, now + 400 * DAY, 6 * 3600000, 1000);
}

// ---------------------------------------------------------------- fleet cards

function tickCards(now) {
  for (const m of MISSIONS) {
    const card = document.getElementById(`m-${m.slug}`);
    if (!card) continue;
    const set = (f, v) => {
      const el = card.querySelector(`[data-f="${f}"]`);
      if (el && el.textContent !== v) el.textContent = v;
    };
    const track = trackOf(m.slug);
    if (track) {
      const r = readout(track, now);
      set('earth', km(r.fromEarth));
      set('light', hms(r.lightTime));
      set('sun', au(r.fromSun));
      set('speed', kms(r.speed));
      const ahead = now - trackEnd(track);
      set('note', track.stale || ahead > 2 * DAY ? ' · estimated from its last known course' : '');
    }
    set('met', elapsed(m.launched, now));
    const next = m.milestones.map((ms) => ({ ...ms, ...milestoneTime(ms) })).find((ms) => ms.t + (ms.exact ? DAY : 31 * DAY) > now);
    set('next', next ? `Next: ${next.label} — ${next.exact ? (next.t > now ? `in ${span(next.t - now)}` : 'today') : new Date(next.t).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}` : '');
  }
}

function drawDsnBadges() {
  for (const m of MISSIONS) {
    const badge = document.querySelector(`#m-${m.slug} [data-f="dsn"]`);
    if (!badge) continue;
    const links = dsnLinksFor(m);
    badge.hidden = !links.length;
    if (links.length) {
      const l = links[0];
      badge.textContent = `● Live · ${l.station}`;
      badge.title = `${l.dish} at ${l.station} is ${l.down ? `receiving${l.downRate ? ` at ${rate(l.downRate)}` : ''}` : ''}${l.down && l.up ? ' and ' : ''}${l.up ? 'sending commands' : ''}`;
    }
  }
}

function select(slug, { scroll = false } = {}) {
  state.selected = slug;
  $$('.mc-card').forEach((c) => c.classList.toggle('selected', c.dataset.slug === slug));
  if (scroll) document.getElementById(`m-${slug}`)?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  // Zoom out if the chosen spacecraft is off this map
  const track = trackOf(slug);
  if (track) {
    const r = readout(track, Date.now()).fromSun / AU;
    const need = r > SCALES.mid.max ? 'all' : r > SCALES.inner.max ? 'mid' : null;
    if (need && (state.scale === 'inner' || (state.scale === 'mid' && need === 'all'))) setScale(need);
  }
}

// ---------------------------------------------------------------- Deep Space Network

function drawDsn() {
  const box = $('#mc-dsn');
  if (!box) return;
  const data = state.dsn;
  if (!data) {
    box.innerHTML = `<p class="muted">No Deep Space Network data yet.</p>`;
    return;
  }
  const stations = ['Goldstone', 'Madrid', 'Canberra'];
  const COUNTRY = { Goldstone: 'California', Madrid: 'Spain', Canberra: 'Australia' };
  box.innerHTML = `${stations
    .map((st) => {
      const links = data.dishes.filter((d) => d.station === st).flatMap((d) => d.links.filter((l) => l.down || l.up).map((l) => ({ ...l, dish: d.dish })));
      return `<div class="mc-station"><p class="px">${esc(st)} <span class="muted small">${esc(COUNTRY[st])}</span></p>${
        links.length
          ? `<ul>${links
              .map((l) => {
                const ours = MISSIONS.find((m) => m.horizons === l.id);
                const arrows = `${l.down ? '<span title="Receiving data" aria-label="receiving">▼</span>' : ''}${l.up ? '<span title="Sending commands" aria-label="sending">▲</span>' : ''}`;
                return `<li class="${ours ? 'ours' : ''}"><span class="mc-arrows">${arrows}</span>${
                  ours ? `<button class="linkish mc-pick" type="button" data-slug="${ours.slug}">${esc(ours.name)}</button>` : esc(craftLabel(l))
                }<span class="muted small"> ${esc(l.dish.replace('DSS', 'DSS-'))}${l.downRate ? ` · ${esc(rate(l.downRate))}` : ''}${l.rtlt ? ` · round trip ${esc(hms(l.rtlt))}` : ''}</span></li>`;
              })
              .join('')}</ul>`
          : '<p class="muted small">Quiet right now.</p>'
      }</div>`;
    })
    .join('')}<p class="muted small mc-updated">Updated ${esc(ago(data.generated))}. The dishes are spread around the world so one can always see each spacecraft as Earth turns.</p>`;
  drawDsnBadges();
}

// ---------------------------------------------------------------- news

function drawNews() {
  const list = $('#mc-news');
  const filters = $('#mc-news-filters');
  if (!list || !filters) return;
  const data = state.news;
  if (!data) {
    list.innerHTML = '<li class="muted">No headlines yet.</li>';
    filters.innerHTML = '';
    return;
  }
  const withNews = MISSIONS.filter((m) => data.byMission?.[m.slug]?.length);
  filters.innerHTML = [['all', 'All space news'], ...withNews.map((m) => [m.slug, m.name])]
    .map(([k, label]) => `<button class="chip" type="button" data-filter="${k}" aria-pressed="${state.newsFilter === k}">${esc(label)}</button>`)
    .join('');
  for (const m of MISSIONS) {
    const b = document.querySelector(`[data-news="${m.slug}"]`);
    if (b) {
      const n = data.byMission?.[m.slug]?.length || 0;
      b.hidden = !n;
      b.textContent = `News (${n})`;
    }
  }
  const items = state.newsFilter === 'all' ? data.latest || [] : data.byMission?.[state.newsFilter] || [];
  list.innerHTML = items.length
    ? items
        .map(
          (a) => `<li class="mc-article">
  <p class="muted small"><span class="px">${esc(a.site || 'News')}</span> · ${esc(a.published ? ago(a.published) : '')}${(a.missions || [])
    .map((s) => ` <span class="tag">${esc(missionName(s))}</span>`)
    .join('')}</p>
  <a href="${esc(a.url)}" rel="noopener nofollow" target="_blank"><strong>${esc(a.title)}</strong></a>
  ${a.summary ? `<p class="small">${esc(a.summary)}</p>` : ''}
</li>`
        )
        .join('')
    : '<li class="muted">No recent headlines.</li>';
}

// ---------------------------------------------------------------- the map

const SCALES = {
  inner: { max: 1.75, log: false, planets: ['mercury', 'venus', 'earth', 'mars'], rings: [] },
  mid: { max: 5.9, log: false, planets: ['mercury', 'venus', 'earth', 'mars', 'jupiter'], rings: [] },
  all: { max: 200, log: true, planets: ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'], rings: [1, 10, 100] },
};
const PERIOD = { mercury: 87.97, venus: 224.7, earth: 365.26, mars: 686.98, jupiter: 4332.6, saturn: 10759, uranus: 30687, neptune: 60190 };
const LABEL = { mercury: 'Mercury', venus: 'Venus', earth: 'Earth', mars: 'Mars', jupiter: 'Jupiter', saturn: 'Saturn', uranus: 'Uranus', neptune: 'Neptune' };
const LOG_K = 0.35;
const logR = (r) => Math.log10(1 + r / LOG_K);

const orbitCache = {};
function orbit(planet) {
  if (!orbitCache[planet]) {
    const n = 160;
    const t0 = Date.now();
    orbitCache[planet] = Array.from({ length: n + 1 }, (_, k) => planetAt(planet, t0 + (k / n) * PERIOD[planet] * DAY));
  }
  return orbitCache[planet];
}

const map = { canvas: null, ctx: null, w: 0, h: 0, dpr: 1, u: 2, stars: [], hits: [], last: 0 };

function setScale(scale) {
  state.scale = scale;
  const radio = document.querySelector(`input[name="scale"][value="${scale}"]`);
  if (radio) radio.checked = true;
}

function sizeMap() {
  const box = $('#mc-screen');
  if (!box || !map.canvas) return;
  const cssW = box.clientWidth;
  const cssH = Math.round(cssW * (cssW < 560 ? 0.95 : 0.62));
  map.dpr = Math.min(window.devicePixelRatio || 1, 2);
  map.w = Math.round(cssW * map.dpr);
  map.h = Math.round(cssH * map.dpr);
  map.canvas.width = map.w;
  map.canvas.height = map.h;
  map.canvas.style.height = `${cssH}px`;
  map.u = Math.max(2, Math.round((cssW / 320) * map.dpr)); // one "pixel" of pixel art
  // A fixed sprinkle of background stars
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  map.stars = Array.from({ length: Math.round((map.w * map.h) / (5200 * map.dpr * map.dpr)) }, () => ({ x: rnd(), y: rnd(), b: rnd(), p: rnd() * 6.28 }));
}

function colours() {
  const red = currentTheme() === 'red';
  return red ? { ink: '#FF3B3B', dim: 'rgba(255,59,59,.45)', faint: 'rgba(255,59,59,.22)', bg: '#000' } : { ink: '#F2F1EC', dim: 'rgba(242,241,236,.5)', faint: 'rgba(242,241,236,.2)', bg: '#000' };
}

function project(pos) {
  const s = SCALES[state.scale];
  const cx = map.w / 2;
  const cy = map.h / 2;
  const R = Math.min(map.w, map.h) / 2 - map.u * 10;
  const r = Math.hypot(pos[0], pos[1]) / AU;
  const f = s.log ? logR(r) / logR(s.max) : r / s.max;
  const a = Math.atan2(pos[1], pos[0]);
  return { x: cx + Math.cos(a) * f * R, y: cy - Math.sin(a) * f * R, off: f > 1.02, a, cx, cy, R };
}

function dot(ctx, x, y, size) {
  ctx.fillRect(Math.round(x - size / 2), Math.round(y - size / 2), size, size);
}

function drawMap(now, simT) {
  const { ctx, w, h, u } = map;
  if (!ctx) return;
  const c = colours();
  const s = SCALES[state.scale];
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, w, h);

  // Stars
  for (const st of map.stars) {
    const tw = reduceMotion ? 0.6 : 0.45 + 0.4 * Math.sin(now / 900 + st.p);
    ctx.globalAlpha = Math.max(0.08, st.b * tw);
    ctx.fillStyle = c.ink;
    dot(ctx, st.x * w, st.y * h, st.b > 0.92 ? u : Math.max(1, u / 2));
  }
  ctx.globalAlpha = 1;

  const centre = project([0, 0, 0]);
  const fontPx = Math.round(15 * map.dpr);
  ctx.font = `${fontPx}px VT323, ui-monospace, monospace`;
  ctx.textBaseline = 'middle';

  // Distance rings (log view) and the heliopause, the edge of the Sun's bubble
  if (s.log) {
    ctx.setLineDash([u, u * 3]);
    ctx.lineWidth = Math.max(1, u / 2);
    for (const r of [...s.rings, 120]) {
      const p = project([r * AU, 0, 0]);
      ctx.strokeStyle = r === 120 ? c.dim : c.faint;
      ctx.beginPath();
      ctx.arc(centre.cx, centre.cy, p.x - centre.cx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = r === 120 ? c.dim : c.faint;
      // Ring labels above the ring; the heliopause's below it so they never collide
      const ry = r === 120 ? centre.cy + (p.x - centre.cx) + fontPx * 0.7 : centre.cy - (p.x - centre.cx) - fontPx * 0.6;
      ctx.fillText(r === 120 ? 'Heliopause ~120 AU' : `${r} AU`, centre.cx + 4 * map.dpr, ry);
    }
    ctx.setLineDash([]);
  }

  // Planet orbits and planets
  ctx.lineWidth = Math.max(1, u / 2);
  for (const planet of s.planets) {
    ctx.strokeStyle = planet === 'earth' ? c.dim : c.faint;
    ctx.setLineDash(planet === 'earth' ? [] : [u, u * 2]);
    ctx.beginPath();
    orbit(planet).forEach((pos, i) => {
      const p = project(pos);
      i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
    });
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const planet of s.planets) {
    const p = project(planetAt(planet, simT));
    ctx.fillStyle = planet === 'earth' ? c.ink : c.dim;
    dot(ctx, p.x, p.y, planet === 'earth' ? u * 2 : u * (['jupiter', 'saturn'].includes(planet) ? 2 : 1.5));
    if (planet === 'earth' || !s.log || ['jupiter', 'saturn', 'uranus', 'neptune'].includes(planet)) {
      ctx.fillStyle = planet === 'earth' ? c.ink : c.dim;
      ctx.fillText(LABEL[planet], p.x + u * 2, p.y + u * 2.5);
    }
  }

  // The Sun: a pixel disc with slowly turning rays
  ctx.fillStyle = c.ink;
  const sr = u * 2;
  for (let dx = -sr; dx <= sr; dx += u) for (let dy = -sr; dy <= sr; dy += u) if (dx * dx + dy * dy <= sr * sr * 1.1) ctx.fillRect(Math.round(centre.cx + dx - u / 2), Math.round(centre.cy + dy - u / 2), u, u);
  const spin = reduceMotion ? 0 : now / 4000;
  for (let k = 0; k < 8; k++) {
    const a = spin + (k * Math.PI) / 4;
    dot(ctx, centre.cx + Math.cos(a) * u * 4, centre.cy + Math.sin(a) * u * 4, u);
  }

  // Spacecraft: trails, markers and labels
  map.hits = [];
  const blink = reduceMotion || Math.floor(now / 500) % 2 === 0;
  for (const m of MISSIONS) {
    const track = trackOf(m.slug);
    if (!track) continue;
    const selected = state.selected === m.slug;
    const hover = state.hover === m.slug;

    // Trail: the daily positions up to the moment being shown
    ctx.strokeStyle = selected || hover ? c.dim : c.faint;
    ctx.lineWidth = Math.max(1, u / (selected ? 1 : 2));
    ctx.setLineDash([u, u]);
    ctx.beginPath();
    let started = false;
    const lastRow = Math.min(track.p.length - 1, Math.floor((simT - track.t0) / track.dt));
    for (let i = Math.max(0, lastRow - REPLAY_DAYS); i <= lastRow; i++) {
      const p = project(track.p[i]);
      if (p.off) continue;
      started ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      started = true;
    }
    const pos = stateAt(track, simT).pos;
    const p = project(pos);
    if (started && !p.off) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = c.ink;
    if (p.off) {
      // Off this map: an arrow at the edge pointing the way
      const ex = p.cx + Math.cos(p.a) * (p.R + u * 4);
      const ey = p.cy - Math.sin(p.a) * (p.R + u * 4);
      const x = Math.min(w - u * 3, Math.max(u * 3, ex));
      const y = Math.min(h - u * 3, Math.max(u * 3, ey));
      ctx.globalAlpha = selected || hover ? 1 : 0.6;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-p.a);
      ctx.fillRect(-u * 2, -u / 2, u * 3, u);
      ctx.fillRect(0, -u * 1.5, u, u * 3);
      ctx.restore();
      ctx.globalAlpha = 1;
      if (selected || hover) label(ctx, `${m.name} →`, x, y, u, fontPx, c, true);
      map.hits.push({ slug: m.slug, x, y });
      continue;
    }
    // A pixel "+" that blinks gently
    const arm = selected ? u * 2 : u;
    if (blink || selected) {
      ctx.fillRect(Math.round(p.x - arm - u / 2), Math.round(p.y - u / 2), arm * 2 + u, u);
      ctx.fillRect(Math.round(p.x - u / 2), Math.round(p.y - arm - u / 2), u, arm * 2 + u);
    } else dot(ctx, p.x, p.y, u);
    if (selected) {
      // Targeting brackets
      const b = u * 5;
      ctx.fillRect(p.x - b, p.y - b, u * 2, u / 1.5);
      ctx.fillRect(p.x - b, p.y - b, u / 1.5, u * 2);
      ctx.fillRect(p.x + b - u * 2, p.y - b, u * 2, u / 1.5);
      ctx.fillRect(p.x + b - u / 1.5, p.y - b, u / 1.5, u * 2);
      ctx.fillRect(p.x - b, p.y + b - u / 1.5, u * 2, u / 1.5);
      ctx.fillRect(p.x - b, p.y + b - u * 2, u / 1.5, u * 2);
      ctx.fillRect(p.x + b - u * 2, p.y + b - u / 1.5, u * 2, u / 1.5);
      ctx.fillRect(p.x + b - u / 1.5, p.y + b - u * 2, u / 1.5, u * 2);
    }
    // In the whole-fleet view the inner Solar System is crowded: name only the far-flung ones
    const crowded = s.log && Math.hypot(pos[0], pos[1]) / AU < 8;
    if (selected || hover || !crowded) label(ctx, selected || hover ? m.name : m.short, p.x + u * 4, p.y - u * 3, u, fontPx, c, selected || hover);
    map.hits.push({ slug: m.slug, x: p.x, y: p.y });
  }
}

function label(ctx, text, x, y, u, fontPx, c, strong) {
  const wText = ctx.measureText(text).width;
  const lx = Math.min(map.w - wText - u * 2, Math.max(u * 2, x));
  const ly = Math.min(map.h - fontPx, Math.max(fontPx, y));
  if (strong) {
    ctx.fillStyle = c.bg;
    ctx.fillRect(lx - u, ly - fontPx / 2 - u / 2, wText + u * 2, fontPx + u);
  }
  ctx.fillStyle = strong ? c.ink : c.dim;
  ctx.fillText(text, lx, ly);
}

function simTime(now) {
  const r = state.replay;
  if (!r) return now;
  const f = (performance.now() - r.started) / REPLAY_MS;
  if (f >= 1) {
    stopReplay();
    return now;
  }
  const eased = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;
  return r.from + (r.to - r.from) * eased;
}

function startReplay() {
  const now = Date.now();
  state.replay = { started: performance.now(), from: now - REPLAY_DAYS * DAY, to: now };
  const b = $('#mc-replay');
  if (b) b.textContent = 'Stop replay';
}
function stopReplay() {
  state.replay = null;
  const b = $('#mc-replay');
  if (b) b.textContent = 'Replay 6 months';
}

function tickClock(simT) {
  const el = $('#mc-clock');
  if (!el) return;
  const d = new Date(simT);
  const text = state.replay
    ? `▶ ${d.toISOString().slice(0, 10)}`
    : `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)} UTC`;
  if (el.textContent !== text) el.textContent = text;
}

function frame() {
  const now = Date.now();
  const simT = simTime(now);
  // Redraw about 30 times a second — plenty for blinking pixels
  if (performance.now() - map.last > 33) {
    map.last = performance.now();
    drawMap(now, simT);
    tickClock(simT);
  }
  requestAnimationFrame(frame);
}

function nearestHit(ev) {
  const rect = map.canvas.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * map.w;
  const y = ((ev.clientY - rect.top) / rect.height) * map.h;
  let best = null;
  let bestD = 22 * map.dpr;
  for (const hit of map.hits) {
    const d = Math.hypot(hit.x - x, hit.y - y);
    if (d < bestD) {
      best = hit;
      bestD = d;
    }
  }
  return best;
}

function wireMap() {
  map.canvas = $('#mc-canvas');
  map.ctx = map.canvas.getContext('2d');
  sizeMap();
  new ResizeObserver(sizeMap).observe($('#mc-screen'));
  map.canvas.addEventListener('pointermove', (ev) => {
    const hit = nearestHit(ev);
    state.hover = hit?.slug || null;
    map.canvas.style.cursor = hit ? 'pointer' : 'default';
  });
  map.canvas.addEventListener('pointerleave', () => (state.hover = null));
  map.canvas.addEventListener('click', (ev) => {
    const hit = nearestHit(ev);
    if (hit) select(hit.slug, { scroll: true });
  });
  $$('input[name="scale"]').forEach((r) => r.addEventListener('change', () => (state.scale = r.value)));
  $('#mc-replay').addEventListener('click', () => (state.replay ? stopReplay() : startReplay()));
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- status + data

function drawStatus() {
  const el = $('#mc-status');
  if (!el) return;
  const p = state.positions;
  if (!p) {
    el.innerHTML = `<span class="px">No live positions yet.</span> They appear after Mission Control's tracker first runs — planets are shown meanwhile.`;
    return;
  }
  const n = Object.keys(p.craft).length;
  const stale = Object.values(p.craft).filter((t) => t.stale).length;
  el.textContent = `${n} spacecraft · positions from NASA/JPL Horizons, updated ${ago(p.generated)}${stale ? ` · ${stale} using their last known course` : ''} · tap one to select it`;
}

async function loadPositions() {
  state.positions = await getJson('/live/positions.json');
  findLightDay();
  drawStatus();
}
async function loadDsn() {
  state.dsn = await getJson('/live/dsn.json');
  drawDsn();
}
async function loadNews() {
  state.news = await getJson('/live/news.json');
  drawNews();
}

function wirePage() {
  document.addEventListener('click', (ev) => {
    const pick = ev.target.closest('.mc-pick');
    if (pick) {
      select(pick.dataset.slug);
      $('.mc-map')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      return;
    }
    const f = ev.target.closest('[data-filter]');
    if (f) {
      state.newsFilter = f.dataset.filter;
      drawNews();
      return;
    }
    const n = ev.target.closest('[data-news]');
    if (n) {
      state.newsFilter = n.dataset.news;
      drawNews();
      $('#news')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    }
  });
}

async function main() {
  page();
  wirePage();
  wireMap();
  await Promise.all([loadPositions(), loadDsn(), loadNews()]);
  select(state.selected);
  const tick = () => {
    const now = Date.now();
    tickCards(now);
    drawBanner(now);
    drawUpcoming();
  };
  tick();
  setInterval(tick, 100);
  setInterval(loadDsn, 60000);
  setInterval(loadPositions, 30 * 60000);
  setInterval(drawStatus, 60000);
}

main().catch((err) => {
  console.error(err);
  render(`<div class="notice error" role="alert">Mission Control couldn't start: ${esc(err.message)}</div>`);
});
