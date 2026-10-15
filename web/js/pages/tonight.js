// Tonight's sky: Moon phase, what's up, a cloud forecast with a GO / NO-GO verdict,
// upcoming sky events, and the light / dark / red observing-mode switch.
import { render, $, $$, esc, showError, toast, icon, fmtDate } from '../ui.js';
import { planNight, verdict, nextOccurrence } from '../lib/astro.js';
import { currentTheme, setTheme, THEMES } from '../theme.js';
import { getSession } from '../auth.js';

const LOC_KEY = 'cosmos.location';
const time = (d) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

function loadLocation() {
  try {
    const l = JSON.parse(localStorage.getItem(LOC_KEY) || 'null');
    return l && Number.isFinite(l.lat) && Number.isFinite(l.lon) ? l : null;
  } catch {
    return null;
  }
}
function saveLocation(l) {
  // Rounded to ~1 km: plenty for the sky, kinder to privacy
  const loc = { name: String(l.name || 'My location').slice(0, 60), lat: Math.round(l.lat * 100) / 100, lon: Math.round(l.lon * 100) / 100 };
  try {
    localStorage.setItem(LOC_KEY, JSON.stringify(loc));
  } catch {}
  return loc;
}

const modeSwitch = () => `<div class="status-picker" role="group" aria-label="Display mode">
  ${THEMES.map(
    (t) =>
      `<label class="seg"><input type="radio" name="mode" value="${t}"${currentTheme() === t ? ' checked' : ''}><span>${t === 'red' ? '● Red' : t[0].toUpperCase() + t.slice(1)}</span></label>`
  ).join('')}
</div>`;

function wireModeSwitch() {
  $$('input[name="mode"]').forEach((r) => r.addEventListener('change', () => setTheme(r.value)));
}

// ---------- location ----------
function askLocation(message = '') {
  render(`
<header class="tonight-head"><div><p class="eyebrow">Tonight's sky</p><h1 style="margin:0">Where are you observing from?</h1></div>${modeSwitch()}</header>
${message ? `<div class="notice">${esc(message)}</div>` : ''}
<div class="card-form" style="max-width:640px">
  <p style="margin-top:0">Your location is saved <strong>only on this device</strong>. It's used to work out what's in your sky, and to fetch a cloud forecast from Open-Meteo.</p>
  <div class="actions" style="margin-bottom:12px"><button class="btn primary" id="geo" type="button">Use my location</button></div>
  <div id="geo-note" role="status" aria-live="polite"></div>
  <form id="loc" class="form">
    <div class="loc-form">
      <label for="town">Or search for a town<input id="town" name="town" required minlength="2" placeholder="e.g. Leeds" autocomplete="address-level2"></label>
      <button class="btn">Search</button>
    </div>
    <div class="form-error"></div>
    <div class="loc-results" id="results"></div>
  </form>
</div>`);
  wireModeSwitch();

  const geoBtn = $('#geo');
  const note = (html) => {
    $('#geo-note').innerHTML = html ? `<div class="notice" style="margin:0 0 22px">${html}</div>` : '';
  };
  const blockedHelp =
    'Location is <strong>blocked for this site</strong> in your browser, so it can’t be shared. Search for your town below instead — it works just as well. ' +
    '<span class="muted small">To allow it: in Safari, choose <em>Settings for this website → Location</em>; in Chrome, tap the icon left of the address and turn on <em>Location</em>. On a Mac, Location Services for your browser must also be on (System Settings → Privacy &amp; Security).</span>';
  const useSearch = () => setTimeout(() => $('#town')?.focus(), 50);

  if (!navigator.geolocation || !window.isSecureContext) {
    geoBtn.disabled = true;
    note("This browser can’t share its location. Search for your town below instead.");
  } else if (navigator.permissions?.query) {
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((p) => {
        const sync = () => {
          if (p.state === 'denied') {
            geoBtn.disabled = true;
            note(blockedHelp);
          } else {
            geoBtn.disabled = false;
            note('');
          }
        };
        sync();
        p.onchange = sync;
      })
      .catch(() => {});
  }

  geoBtn.addEventListener('click', () => {
    geoBtn.disabled = true;
    geoBtn.textContent = 'Finding you…';
    note('');
    navigator.geolocation.getCurrentPosition(
      (pos) => show(saveLocation({ name: 'My location', lat: pos.coords.latitude, lon: pos.coords.longitude })),
      (err) => {
        geoBtn.textContent = 'Use my location';
        geoBtn.disabled = err.code === 1;
        note(
          err.code === 1
            ? blockedHelp
            : err.code === 3
              ? 'Finding your location took too long. Try again, or search for your town below.'
              : 'Your device couldn’t work out where you are right now. Search for your town below instead.'
        );
        useSearch();
      },
      { timeout: 15000, maximumAge: 3600000, enableHighAccuracy: false }
    );
  });

  const form = $('#loc');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const box = $('.form-error', form);
    box.innerHTML = '';
    try {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(form.town.value.trim())}&count=6&language=en&format=json`);
      if (!r.ok) throw new Error();
      const { results = [] } = await r.json();
      $('#results').innerHTML = results.length
        ? results
            .map(
              (p, i) =>
                `<button type="button" class="btn ghost" data-i="${i}" style="justify-content:flex-start">${esc(p.name)}${p.admin1 ? `, ${esc(p.admin1)}` : ''} · ${esc(p.country_code || '')}</button>`
            )
            .join('')
        : '<p class="muted">No places found — try a nearby town.</p>';
      $$('#results [data-i]').forEach((b) =>
        b.addEventListener('click', () => {
          const p = results[Number(b.dataset.i)];
          show(saveLocation({ name: p.name, lat: p.latitude, lon: p.longitude }));
        })
      );
    } catch {
      box.innerHTML = `<div class="notice error">Couldn't search places right now. Check your connection.</div>`;
    }
  });
}

// ---------- the night ----------
function moonIcon(moon) {
  const map = { new: 'moonNew', half: 'moonHalf', full: 'moonFull', crescent: 'crescent' };
  // Half icon is lit on the right (waxing); crescent icon is lit on the left (waning)
  const flip = (moon.shape === 'half' && !moon.waxing) || (moon.shape === 'crescent' && moon.waxing);
  return icon(map[moon.shape], { scale: moon.shape === 'crescent' ? 5 : 6, flip, label: moon.name });
}

function moonTip(moon) {
  if (moon.illumination > 0.7) return 'A bright Moon washes out faint galaxies — great night for the Moon and planets.';
  if (moon.illumination < 0.25) return 'Little moonlight — the best time for faint galaxies and clusters.';
  return 'Look along the line between light and dark (the terminator) for craters in sharp relief.';
}

function whatsUp(night) {
  const items = [...night.planets, ...night.deepSky];
  if (!items.length) return '<p class="fempty">Nothing bright is well placed tonight — a good night for the Moon, or a rest.</p>';
  const iconFor = (o) => (o.id === 'jupiter' ? 'jupiter' : o.id === 'saturn' ? 'planet' : o.ra !== undefined ? 'star' : 'planet');
  return items
    .map(
      (o) => `<div class="fentry">
  <span style="width:42px;display:grid;place-items:center">${icon(iconFor(o), { scale: 2 })}</span>
  <span class="main"><strong>${esc(o.name)}</strong><span class="sub">Best ${time(o.at)} · ${Math.round(o.alt)}° up in the ${o.dir} · ${esc(o.note)}</span></span>
  <span class="tag">${esc(o.how)}</span>
</div>`
    )
    .join('');
}

async function forecast(loc) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&hourly=cloud_cover&timezone=GMT&forecast_days=3`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('forecast');
  const j = await r.json();
  return j.hourly.time.map((t, i) => ({ time: new Date(`${t}:00Z`), cloud: j.hourly.cloud_cover[i] }));
}

function cloudChart(hourly, night) {
  const from = new Date(night.darkStart.getTime() - 2 * 3600000);
  from.setMinutes(0, 0, 0);
  const to = new Date(night.darkEnd.getTime() + 3600000);
  const hours = hourly.filter((h) => h.time >= from && h.time <= to);
  if (!hours.length) return '<p class="muted">No forecast for tonight yet.</p>';
  const ticks = hours.filter((_, i) => i % 3 === 0);
  return `<div class="clouds" role="img" aria-label="Cloud cover by hour from ${time(hours[0].time)} to ${time(hours.at(-1).time)}: ${hours
    .map((h) => `${time(h.time)} ${h.cloud}%`)
    .join(', ')}">
  ${hours
    .map((h) => {
      const dark = h.time >= night.darkStart && h.time <= night.darkEnd;
      return `<div class="b${h.cloud >= 60 ? ' heavy' : ''}${dark ? '' : ' day'}" style="height:${Math.max(h.cloud, 3)}%" title="${time(h.time)} · ${h.cloud}% cloud"></div>`;
    })
    .join('')}
</div>
<div class="cloud-axis" aria-hidden="true">${ticks.map((h) => `<span>${time(h.time).slice(0, 2)}</span>`).join('')}</div>
<p class="muted small" style="margin:6px 0 0">Taller bar = more cloud · faded bars are twilight · forecast by <a href="https://open-meteo.com/" rel="noopener" target="_blank">Open-Meteo</a></p>`;
}

function verdictHtml(v) {
  if (!v) return '';
  const text =
    v.level === 'GO'
      ? `Clear spells tonight. Best window ${time(v.from)}–${time(v.to)} (about ${v.bestAvg}% cloud).`
      : v.level === 'MAYBE'
        ? `Patchy. Your best chance is ${time(v.from)}–${time(v.to)} (about ${v.bestAvg}% cloud).`
        : `Mostly cloudy all night (best is about ${v.bestAvg}% cloud). A night for reading or writing up.`;
  return `<div class="verdict" role="status"><span class="lcd">${v.level}</span><p>${text}</p></div>`;
}

function icsFile(ev, date) {
  const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const next = new Date(date.getTime() + 86400000);
  const escIcs = (t) => String(t).replace(/[\\;,]/g, (c) => `\\${c}`);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cosmos Notebook//Sky events//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:${ev.id}-${date.getFullYear()}@cosmos-notebook`, `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${ymd(date)}`, `DTEND;VALUE=DATE:${ymd(next)}`,
    `SUMMARY:${escIcs(ev.title)}`, `DESCRIPTION:${escIcs(ev.note)}`,
    'BEGIN:VALARM', 'TRIGGER:-PT6H', 'ACTION:DISPLAY', `DESCRIPTION:${escIcs(ev.title)} tonight`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

async function eventsHtml() {
  let list = [];
  try {
    list = await (await fetch('/events.json')).json();
  } catch {}
  const upcoming = list
    .map((e) => ({ ...e, date: nextOccurrence(e.when) }))
    .filter((e) => e.date)
    .sort((a, b) => a.date - b.date)
    .slice(0, 6);
  return {
    upcoming,
    html: upcoming.length
      ? upcoming
          .map(
            (e, i) => `<div class="fentry">
  <span class="lcd" style="font-size:1.4rem;line-height:.95;min-width:48px;text-align:center">${String(e.date.getDate()).padStart(2, '0')}<br>${e.date
              .toLocaleDateString('en-GB', { month: 'short' })
              .toUpperCase()}</span>
  <span class="main"><strong>${esc(e.title)}</strong><span class="sub">${esc(e.note)}${e.date.getFullYear() !== new Date().getFullYear() ? ` · ${e.date.getFullYear()}` : ''}</span></span>
  <button class="btn small" type="button" data-ev="${i}" aria-label="Add ${esc(e.title)} to your calendar">+ Cal</button>
</div>`
          )
          .join('')
      : '<p class="fempty">No events listed.</p>',
  };
}

async function show(loc) {
  // Before noon we still mean the night that's just happening; after noon, tonight
  const ref = new Date();
  if (ref.getHours() < 12) ref.setDate(ref.getDate() - 1);
  const night = planNight(ref, loc.lat, loc.lon);
  const moon = night.moon;
  const ev = await eventsHtml();

  render(`
<header class="tonight-head">
  <div>
    <p class="eyebrow">${esc(ref.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }))} · ${esc(loc.name)}</p>
    <h1 style="margin:0">Tonight's sky</h1>
  </div>
  <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center">${modeSwitch()}<button class="btn small" id="change-loc" type="button">Change place</button></div>
</header>

<div class="tonight-grid">
  <div style="display:flex;flex-direction:column;gap:28px;min-width:0">
    <section class="win" aria-label="Moon and conditions">
      <div class="win-bar"><span>Moon &amp; darkness</span><span class="fill dither" aria-hidden="true"></span></div>
      <div class="win-body moon-panel">
        <div class="moon-box">${moonIcon(moon)}</div>
        <div style="display:flex;flex-direction:column;gap:4px;min-width:0">
          <p class="px" style="font-size:1.05rem">${esc(moon.name)}</p>
          <p class="big-lcd">${Math.round(moon.illumination * 100)}% LIT</p>
          <p class="muted small">${esc(moonTip(moon))}</p>
        </div>
      </div>
      <div class="win-body" style="border-top:2px solid var(--ink);padding:12px 18px">
        <p style="margin:0">${
          night.darkStart
            ? `${night.fullyDark ? 'Properly dark' : 'Darkest (it never gets fully dark this time of year)'} from <strong class="lcd" style="font-size:1.3rem">${time(night.darkStart)}</strong> to <strong class="lcd" style="font-size:1.3rem">${time(night.darkEnd)}</strong>`
            : 'It doesn’t get dark here tonight.'
        }</p>
      </div>
      <div id="verdict"></div>
    </section>

    <section aria-label="Cloud cover tonight">
      <h2 class="section-title">Cloud cover</h2>
      <div id="clouds"><p class="muted loading">Fetching forecast…</p></div>
    </section>
  </div>

  <div style="display:flex;flex-direction:column;gap:28px;min-width:0">
    <section aria-label="Worth a look tonight">
      <h2 class="section-title">Worth a look</h2>
      <div class="folder">${whatsUp(night)}
        <div class="fbody" style="border-top:2px dashed var(--ink)"><a class="btn primary" href="${getSession() ? '/notebook/observations/' : '/login/?mode=signup&next=%2Fnotebook%2Fobservations%2F'}">+ Log tonight in my notebook</a></div>
      </div>
    </section>

    <section aria-label="Coming up">
      <h2 class="section-title">Coming up</h2>
      <div class="folder">${ev.html}</div>
    </section>
  </div>
</div>`);

  wireModeSwitch();
  $('#change-loc').addEventListener('click', () => askLocation());
  $$('[data-ev]').forEach((b) =>
    b.addEventListener('click', () => {
      const e = ev.upcoming[Number(b.dataset.ev)];
      const blob = new Blob([icsFile(e, e.date)], { type: 'text/calendar' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${e.id}.ics`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      b.textContent = '✓ Added';
    })
  );

  if (!night.darkStart) {
    $('#clouds').innerHTML = '<p class="muted">No dark hours tonight.</p>';
    return;
  }
  try {
    const hourly = await forecast(loc);
    $('#clouds').innerHTML = cloudChart(hourly, night);
    $('#verdict').innerHTML = verdictHtml(verdict(hourly, night.darkStart, night.darkEnd));
  } catch {
    $('#clouds').innerHTML = '<div class="notice">The cloud forecast isn’t available right now. Everything else on this page is worked out on your device.</div>';
  }
}

// Keep the mode switch in step with the header button
window.addEventListener('cosmos:theme', () => $$('input[name="mode"]').forEach((r) => (r.checked = r.value === currentTheme())));

try {
  const loc = loadLocation();
  if (loc) show(loc).catch(showError);
  else askLocation();
} catch (err) {
  showError(err);
}
