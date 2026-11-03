// Stellar Lab: set a star's mass and watch its whole life, or keep adding mass to what's
// left until it explodes or collapses. The physics and drawing run in Rust (sim/stellar),
// compiled to WebAssembly; this file is just the controls.
import { render, $, $$, esc } from '../ui.js';
import { loadStellar, STAGES, FATES, EVENT, sci, years, radius, kelvin, solarMasses, SLIDER_MAX, sliderToMass, massToSlider } from '../stellar.js';

const VERSION = new URL(import.meta.url).searchParams.get('v') || '';
const WASM_URL = `/wasm/stellar.wasm${VERSION ? `?v=${VERSION}` : ''}`;

const S = {
  MS: 0, SUBGIANT: 1, RED_GIANT: 2, HE: 3, AGB: 4, PN: 5, WD: 6, SUPERGIANT: 7, SN: 8, NS: 9, BH: 10, IA: 11, DC: 12, PISN: 13, NOTHING: 14,
};

const BLURB = [
  'Fusing hydrogen into helium in its core. Heavier stars burn hotter, brighter — and much faster.',
  'The core has run out of hydrogen. A shell around it burns instead, and the star starts to swell.',
  'A red giant: a small, hot helium core inside a huge, cool, puffed-up envelope.',
  'Helium fuses into carbon and oxygen in the core — a calmer, shorter second life.',
  'Two burning shells make the star swell, pulse and blow off its outer layers in a slow wind.',
  'The outer layers drift away as a glowing shell, lit up by the exposed core. (Nothing to do with planets — early telescopes just made them look like one.)',
  'An Earth-sized ball of carbon and oxygen held up by electron pressure. No fusion: it simply cools for ever. Add mass to push it past 1.44 M☉.',
  'Fusing heavier and heavier elements in shells like an onion, all the way to iron — which can’t release energy.',
  'The iron core collapses in under a second and rebounds. For weeks the explosion can outshine its whole galaxy.',
  'Protons and electrons crushed into neutrons: more than the Sun’s mass in a ball about 24 km across, spinning many times a second. Add mass to push it past ~2.2 M☉.',
  'Gravity wins completely: nothing, not even light, escapes from inside the event horizon. Watch the background stars bend around it. Add mass and it grows.',
  'Carbon ignites all at once and the white dwarf is destroyed completely. These explosions all peak at much the same brightness, so astronomers use them to measure the universe.',
  'Too massive to explode: the core collapses and swallows the rest of the star. Astronomers have watched stars simply vanish like this.',
  'So hot that light turns into electron–positron pairs; the core loses support and runaway oxygen burning destroys the whole star.',
  'Only an expanding cloud of fresh elements — the iron, nickel, oxygen and carbon that will one day make new stars and planets.',
];

const PRESETS = [
  ['Red dwarf', 0.2],
  ['The Sun', 1],
  ['Sirius A', 2.1],
  ['Rigel', 21],
  ['Betelgeuse', 16],
  ['Eta Carinae', 90],
  ['First stars', 200],
];

const SPEEDS = [
  ['1×', 1],
  ['3×', 3],
  ['10×', 10],
];

function stageName(st) {
  if (st.stage === S.SUPERGIANT) return st.temperature < 6000 ? 'Red supergiant' : st.temperature > 25000 ? 'Wolf–Rayet star' : 'Blue supergiant';
  if (st.stage === S.NS) return 'Neutron star (pulsar)';
  if (st.stage === S.WD && st.initialMass < 0.5) return 'Helium white dwarf';
  if (st.stage === S.SN) return st.progenitorMass >= 20 ? 'Supernova → black hole' : 'Core-collapse supernova';
  return STAGES[st.stage] || '?';
}

function eventMessage(e, st, lim) {
  switch (e) {
    case EVENT.LEFT_MAIN_SEQUENCE: return 'Hydrogen runs out in the core — it leaves the main sequence.';
    case EVENT.RED_GIANT: return 'It swells into a red giant.';
    case EVENT.HELIUM_FLASH: return 'Helium flash! The packed core ignites helium in a matter of seconds.';
    case EVENT.HELIUM_IGNITION: return 'Helium ignites in the core.';
    case EVENT.AGB: return 'Onto the asymptotic giant branch: pulsing and shedding its outer layers.';
    case EVENT.PLANETARY_NEBULA: return `Planetary nebula — the envelope drifts off, leaving a ${solarMasses(st.mass)} core.`;
    case EVENT.WHITE_DWARF: return 'A white dwarf: an Earth-sized ember, cooling for ever.';
    case EVENT.HELIUM_WHITE_DWARF: return 'Hydrogen finally gone — it fades into a helium white dwarf. (No red dwarf has got this far yet: the universe isn’t old enough.)';
    case EVENT.SUPERGIANT: return 'Too massive for a quiet end — it becomes a supergiant.';
    case EVENT.SUPERNOVA: return 'Core collapse! A supernova.';
    case EVENT.NEUTRON_STAR: return `A ${solarMasses(st.mass)} neutron star is born.`;
    case EVENT.BLACK_HOLE: return `A ${solarMasses(st.mass)} black hole forms.`;
    case EVENT.TYPE_IA: return `Over the Chandrasekhar limit (${lim.chandrasekhar} M☉): Type Ia supernova. Nothing will be left.`;
    case EVENT.DIRECT_COLLAPSE: return 'No explosion — the star is collapsing straight into a black hole.';
    case EVENT.PAIR_INSTABILITY: return 'Pair-instability supernova: the whole star is about to blow itself apart.';
    case EVENT.NEUTRON_STAR_COLLAPSE: return `Over ~${lim.tov} M☉ even neutrons can’t hold it up: collapse to a black hole!`;
    default: return '';
  }
}

const fateBar = (lim) => {
  const span = Math.log(lim.max / lim.min);
  const seg = (from, to, label, cls) =>
    `<span class="fate-seg ${cls}" style="flex-basis:${((Math.log(to / from) / span) * 100).toFixed(2)}%" title="${esc(label)}: ${from}–${to} M☉"><span>${esc(label)}</span></span>`;
  return `<div class="fate-bar" aria-hidden="true">${[
    seg(lim.min, lim.massive, 'White dwarf', 'wd'),
    seg(lim.massive, 20, 'NS', 'ns'),
    seg(20, lim.directCollapse, 'BH', 'bh'),
    seg(lim.directCollapse, lim.pairInstability, 'BH', 'dc'),
    seg(lim.pairInstability, lim.max, '∅', 'pi'),
  ].join('')}</div>`;
};

const hrLabels = () => {
  const yOf = (ll) => ((7 - ll) / 12) * 100;
  const xOf = (lt) => ((5.2 - lt) / 1.9) * 100;
  const sup = { '-': '⁻', 0: '⁰', 2: '²', 4: '⁴', 6: '⁶' };
  const l = [6, 4, 2, 0, -2, -4].map((v) => `<span class="hr-y" style="top:${yOf(v)}%">${v === 0 ? '1' : `10${String(v).replace(/./g, (c) => sup[c])}`}</span>`);
  const t = [
    [5, '100k'],
    [4.5, '30k'],
    [4, '10k'],
    [3.5, '3k'],
  ].map(([v, s]) => `<span class="hr-x" style="left:${xOf(v)}%">${s}</span>`);
  return l.join('') + t.join('');
};

function inkColour() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(v);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  const rgb = v.match(/\d+/g);
  return rgb && rgb.length >= 3 ? rgb.slice(0, 3).map(Number) : [17, 17, 17];
}

async function start() {
  if (typeof WebAssembly !== 'object') {
    render(`<div class="notice error" role="alert">This browser can’t run WebAssembly, which the simulator needs. Try a recent Chrome, Firefox, Safari or Edge.</div>`);
    return;
  }
  let engine;
  try {
    engine = await loadStellar(WASM_URL);
  } catch (err) {
    console.error(err);
    render(`<div class="notice error" role="alert">The simulator couldn’t load. ${esc(err.message || '')} <a href="javascript:location.reload()">Try again</a></div>`);
    return;
  }
  const lim = engine.limits;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let target = 1;
  const lab = engine.lab(target);
  lab.setGentle(reduceMotion);

  render(`
<div class="lab-grid">
  <figure class="win lab-view">
    <div class="win-bar"><span id="lab-stage">Main sequence</span><span class="fill dither" aria-hidden="true"></span><span id="lab-speed">1×</span></div>
    <div class="lab-screens">
      <canvas id="lab-canvas" width="${lab.viewW}" height="${lab.viewH}" role="img" aria-label="A star on the main sequence"></canvas>
      <div class="lab-hr">
        <p class="hr-title px">HR diagram</p>
        <div class="hr-plot"><canvas id="lab-hr" width="${lab.hrW}" height="${lab.hrH}" role="img" aria-label="Hertzsprung–Russell diagram showing the star's path"></canvas>${hrLabels()}</div>
        <p class="hr-axis small">← hotter · K · cooler →</p>
      </div>
    </div>
    <figcaption id="lab-blurb" class="lab-blurb small"></figcaption>
  </figure>

  <div class="lab-panel">
    <div class="lab-mass">
      <label for="lab-mass" class="px">Mass <output id="lab-mass-out" for="lab-mass">1.00 M☉</output></label>
      <input type="range" id="lab-mass" min="0" max="${SLIDER_MAX}" step="1" value="${massToSlider(target)}" aria-describedby="lab-fate">
      ${fateBar(lim)}
      <p id="lab-fate" class="small" aria-live="polite"></p>
    </div>
    <div class="lab-buttons">
      <button class="btn primary" id="lab-new" type="button">New star</button>
      <button class="btn" id="lab-play" type="button" aria-pressed="false">Pause</button>
      <button class="btn" id="lab-skip" type="button">Next stage</button>
      <button class="btn" id="lab-feed" type="button" hidden>Add mass</button>
    </div>
    <div class="status-picker" role="group" aria-label="Speed">
      ${SPEEDS.map(([label, v], i) => `<label class="seg"><input type="radio" name="lab-speed" value="${v}"${i === 0 ? ' checked' : ''}><span>${label}</span></label>`).join('')}
    </div>
    <div class="readouts lab-readouts" aria-live="off">
      <div><p class="k">Age</p><p class="v" id="r-age">0</p></div>
      <div><p class="k">Mass</p><p class="v" id="r-mass">1</p></div>
      <div><p class="k">Brightness</p><p class="v" id="r-lum">1</p></div>
      <div><p class="k">Surface</p><p class="v" id="r-temp">5,800 K</p></div>
      <div><p class="k" id="r-rad-k">Radius</p><p class="v" id="r-rad">1</p></div>
      <div class="inv"><p class="k">Born at</p><p class="v" id="r-born">1</p></div>
    </div>
    <div class="lab-presets" role="group" aria-label="Famous stars">
      ${PRESETS.map(([name, m]) => `<button class="chip" type="button" data-m="${m}">${esc(name)}</button>`).join('')}
    </div>
  </div>
</div>
<section class="win lab-log-win">
  <div class="win-bar"><span>Lab log</span><span class="fill dither" aria-hidden="true"></span></div>
  <ol class="lab-log" id="lab-log" aria-live="polite"><li class="muted">A ${solarMasses(target)} star is born.</li></ol>
</section>`);

  const canvas = $('#lab-canvas');
  const ctx = canvas.getContext('2d');
  const hrCanvas = $('#lab-hr');
  const hrCtx = hrCanvas.getContext('2d');
  const slider = $('#lab-mass');
  const out = $('#lab-mass-out');
  const playBtn = $('#lab-play');
  const feedBtn = $('#lab-feed');
  const log = $('#lab-log');

  let playing = !reduceMotion;
  let speed = 1;
  let visible = true;
  let lastStage = -1;

  const setPlaying = (on) => {
    playing = on;
    playBtn.textContent = on ? 'Pause' : 'Play';
    playBtn.setAttribute('aria-pressed', String(!on));
  };
  setPlaying(playing);

  const applyInk = () => lab.setInk(inkColour());
  applyInk();
  new MutationObserver(applyInk).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyInk);

  const note = (text, cls = '') => {
    if (!text) return;
    const st = lab.state();
    const li = document.createElement('li');
    if (cls) li.className = cls;
    li.innerHTML = `<span class="lcd">${esc(years(st.age))}</span> ${esc(text)}`;
    log.prepend(li);
    while (log.children.length > 40) log.lastElementChild.remove();
  };

  const showFate = () => {
    const st = lab.state();
    const fate = FATES[engine.fate(target)];
    const life = years(engine.msLifetime(target));
    const el = $('#lab-fate');
    if (st.canChangeMass) {
      const what = st.stage === S.WD ? `A white dwarf can hold up to ${lim.chandrasekhar} M☉.` : st.stage === S.NS ? `A neutron star can hold up to about ${lim.tov} M☉.` : st.stage === S.BH ? 'Black holes only grow.' : `Born now, a ${solarMasses(target)} star would spend ${life} on the main sequence and end as: ${fate}.`;
      el.textContent = `Drag to change the mass of what’s there now. ${what}`;
    } else {
      el.textContent = `Press New star for a ${solarMasses(target)} star: ${life} on the main sequence, ending as: ${fate}.`;
    }
  };

  const syncSlider = (m) => {
    if (m > 0) slider.value = String(massToSlider(Math.min(Math.max(m, lim.min), lim.max)));
    out.textContent = solarMasses(sliderToMass(Number(slider.value)));
  };

  const updateReadouts = () => {
    const st = lab.state();
    const name = stageName(st);
    $('#lab-stage').textContent = name;
    canvas.setAttribute('aria-label', `${name}, ${solarMasses(st.mass)}`);
    $('#r-age').textContent = years(st.age);
    $('#r-mass').textContent = st.stage === S.NOTHING ? '0' : solarMasses(st.mass);
    $('#r-lum').textContent = st.luminosity > 0 ? `${sci(st.luminosity)} L☉` : '—';
    $('#r-temp').textContent = kelvin(st.temperature);
    $('#r-rad-k').textContent = st.stage === S.BH ? 'Horizon' : 'Radius';
    $('#r-rad').textContent = st.stage === S.BH ? radius(engine.schwarzschildKm(st.mass) / 695_700) : radius(st.radius);
    $('#r-born').textContent = solarMasses(st.initialMass);
    if (st.stage !== lastStage) {
      lastStage = st.stage;
      $('#lab-blurb').textContent = BLURB[st.stage] || '';
      feedBtn.hidden = !(st.stage === S.WD || st.stage === S.NS || st.stage === S.BH);
      feedBtn.textContent = st.stage === S.BH ? 'Feed it +10%' : `Add +${st.stage === S.WD ? '0.05' : '0.1'} M☉`;
      $('#lab-skip').disabled = st.stage === S.WD || st.stage === S.NS || st.stage === S.BH || st.stage === S.NOTHING;
      showFate();
      if (st.canChangeMass) syncSlider(st.mass);
    }
  };

  const drainEvents = () => {
    for (const e of lab.events()) {
      if (e === EVENT.ACCRETION) continue;
      const st = lab.state();
      const big = [EVENT.SUPERNOVA, EVENT.TYPE_IA, EVENT.PAIR_INSTABILITY, EVENT.BLACK_HOLE, EVENT.NEUTRON_STAR_COLLAPSE].includes(e);
      note(eventMessage(e, st, lim), big ? 'big' : '');
    }
  };

  const newStar = (m) => {
    target = m;
    lab.reset(m);
    lastStage = -1;
    log.innerHTML = '';
    note(`A ${solarMasses(m)} star is born.`, 'muted');
    syncSlider(m);
    updateReadouts();
    if (!playing && !reduceMotion) setPlaying(true);
  };

  // ---------- controls ----------
  slider.addEventListener('input', () => {
    const m = sliderToMass(Number(slider.value));
    target = m;
    out.textContent = solarMasses(m);
    const st = lab.state();
    if (st.canChangeMass) {
      const before = st.stage;
      const got = lab.setMass(m);
      if (Math.abs(got - m) / m > 0.02) {
        if (before === S.BH) $('#lab-fate').textContent = 'A black hole can’t lose mass (apart from Hawking radiation, which takes far longer than the age of the universe).';
        else if (before === S.NS) $('#lab-fate').textContent = 'Supernovae don’t make neutron stars much lighter than this.';
        syncSlider(got);
        target = got;
      } else {
        showFate();
      }
      drainEvents();
      updateReadouts();
    } else {
      showFate();
    }
  });
  slider.addEventListener('change', () => {
    const st = lab.state();
    if (st.canChangeMass) syncSlider(st.mass);
  });

  $('#lab-new').addEventListener('click', () => newStar(sliderToMass(Number(slider.value))));
  playBtn.addEventListener('click', () => setPlaying(!playing));
  $('#lab-skip').addEventListener('click', () => {
    lab.skip();
    drainEvents();
    updateReadouts();
  });
  feedBtn.addEventListener('click', () => {
    const st = lab.state();
    const add = st.stage === S.BH ? st.mass * 0.1 : st.stage === S.WD ? 0.05 : 0.1;
    lab.setMass(st.mass + add);
    drainEvents();
    lastStage = -1;
    updateReadouts();
    syncSlider(lab.state().mass);
  });
  $$('input[name="lab-speed"]').forEach((r) =>
    r.addEventListener('change', () => {
      speed = Number(r.value);
      $('#lab-speed').textContent = `${speed}×`;
    })
  );
  $$('.lab-presets .chip').forEach((b) => b.addEventListener('click', () => newStar(Number(b.dataset.m))));

  // Don't spend battery drawing a canvas nobody can see
  if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(canvas);

  // ---------- loop ----------
  let last = performance.now();
  let sinceReadout = 0;
  const frame = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (visible) {
      lab.step(dt, playing ? speed : 0);
      drainEvents();
      lab.render();
      ctx.putImageData(new ImageData(new Uint8ClampedArray(lab.viewPixels()), lab.viewW, lab.viewH), 0, 0);
      hrCtx.putImageData(new ImageData(new Uint8ClampedArray(lab.hrPixels()), lab.hrW, lab.hrH), 0, 0);
      sinceReadout += dt;
      if (sinceReadout > 0.12) {
        sinceReadout = 0;
        updateReadouts();
      }
    }
    requestAnimationFrame(frame);
  };
  updateReadouts();
  syncSlider(target);
  requestAnimationFrame(frame);
}

start();
