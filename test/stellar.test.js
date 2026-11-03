// Stellar Lab: the JS wrapper and, when it has been built, the real WebAssembly engine.
// Build it first with:  npm run build:wasm   (CI always does; locally it's skipped if missing)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadStellar, STAGES, EVENT, sci, years, radius, kelvin, solarMasses, sliderToMass, massToSlider, SLIDER_MAX } from '../web/js/stellar.js';

const WASM = new URL('../sim/stellar/target/wasm32-unknown-unknown/release/stellar.wasm', import.meta.url);
const bytes = await readFile(WASM).catch(() => null);
const needsWasm = { skip: bytes ? false : 'engine not built — run npm run build:wasm' };

test('formats numbers the way the readouts show them', () => {
  assert.equal(sci(1), '1');
  assert.equal(sci(2500), '2,500');
  assert.equal(sci(1.5e9), '1.5×10⁹');
  assert.equal(sci(0.0012), '1.2×10⁻³');
  assert.equal(years(4.6e9), '4.6 billion yr');
  assert.equal(years(12e6), '12 million yr');
  assert.equal(years(30_000), '30 thousand yr');
  assert.equal(years(0), '0 yr');
  assert.equal(radius(1), '1 R☉');
  assert.equal(radius(0.0138), '9,601 km');
  assert.equal(radius(12 / 695_700), '12 km');
  assert.equal(kelvin(5772), '5,770 K');
  assert.equal(kelvin(25_874), '25,900 K');
  assert.equal(kelvin(0), '—');
  assert.equal(solarMasses(1), '1.00 M☉');
  assert.equal(solarMasses(15), '15.0 M☉');
});

test('the mass slider is logarithmic and round-trips', () => {
  assert.ok(Math.abs(sliderToMass(0) - 0.08) < 1e-9);
  assert.ok(Math.abs(sliderToMass(SLIDER_MAX) - 300) < 1e-6);
  for (const m of [0.1, 1, 8, 40, 200]) assert.ok(Math.abs(sliderToMass(massToSlider(m)) / m - 1) < 0.01, `${m}`);
});

test('the engine loads and runs a whole life', needsWasm, async () => {
  const engine = await loadStellar(bytes);
  assert.equal(engine.limits.chandrasekhar, 1.44);
  assert.equal(engine.fate(1), 0);
  assert.equal(engine.fate(15), 1);
  assert.equal(engine.fate(200), 4);
  const lab = engine.lab(1, 42);
  let s = lab.state();
  assert.equal(STAGES[s.stage], 'Main sequence');
  assert.ok(s.luminosity > 0.5 && s.luminosity < 1.5);
  const seen = [];
  for (let i = 0; i < 2000 && lab.state().stage !== 6; i++) {
    lab.step(1 / 30, 5);
    seen.push(...lab.events());
  }
  lab.render();
  s = lab.state();
  assert.equal(STAGES[s.stage], 'White dwarf');
  assert.ok(seen.includes(EVENT.HELIUM_FLASH) && seen.includes(EVENT.PLANETARY_NEBULA));
  assert.ok(s.age > 1e10);
  const px = lab.viewPixels();
  assert.equal(px.length, lab.viewW * lab.viewH * 4);
  assert.ok(px.some((v, i) => i % 4 === 0 && v > 0), 'drew something');
  assert.ok(lab.hrPixels().some((v, i) => i % 4 === 3 && v === 255), 'drew the HR diagram');

  // Feed it until it explodes
  lab.setMass(1.6);
  assert.ok(lab.events().includes(EVENT.TYPE_IA));
  lab.free();
});

test('a neutron star fed past its limit becomes a black hole', needsWasm, async () => {
  const engine = await loadStellar(bytes);
  const lab = engine.lab(12, 1);
  for (let i = 0; i < 10 && lab.state().stage !== 9; i++) lab.skip();
  assert.equal(STAGES[lab.state().stage], 'Neutron star');
  lab.events();
  assert.equal(lab.setMass(3), 3);
  assert.equal(STAGES[lab.state().stage], 'Black hole');
  assert.ok(lab.events().includes(EVENT.NEUTRON_STAR_COLLAPSE));
  assert.equal(lab.setMass(1), 3, "black holes don't shrink");
  assert.ok(Math.abs(engine.schwarzschildKm(3) - 8.86) < 0.01);
});
