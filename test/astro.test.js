// Checks the astronomy engine against well-known real events.  Run: node --test test/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elongation, moonPhase, planNight, position, horizontal, verdict, nextOccurrence } from '../src/astro.js';

const at = (iso) => new Date(iso);

test('planets are opposite the Sun at their known oppositions', () => {
  assert.ok(elongation('jupiter', at('2026-01-10T12:00:00Z')) > 175, 'Jupiter, 10 Jan 2026');
  assert.ok(elongation('mars', at('2025-01-16T12:00:00Z')) > 175, 'Mars, 16 Jan 2025');
  assert.ok(elongation('saturn', at('2025-09-21T12:00:00Z')) > 175, 'Saturn, 21 Sep 2025');
});

test('Venus reaches about 47° from the Sun at greatest elongation (10 Jan 2025)', () => {
  const e = elongation('venus', at('2025-01-10T12:00:00Z'));
  assert.ok(e > 45 && e < 49, `got ${e.toFixed(1)}°`);
});

test('Sun is near the celestial equator at the equinox and high at the solstice', () => {
  assert.ok(Math.abs(position('sun', at('2025-03-20T09:01:00Z')).dec) < 0.5);
  assert.ok(Math.abs(position('sun', at('2025-06-21T02:42:00Z')).dec - 23.44) < 0.3);
});

test('Sun is high at noon in London in June and below the horizon at midnight', () => {
  const noon = horizontal(position('sun', at('2025-06-21T12:00:00Z')), at('2025-06-21T12:00:00Z'), 51.5, -0.13);
  const midnight = horizontal(position('sun', at('2025-06-21T23:59:00Z')), at('2025-06-21T23:59:00Z'), 51.5, -0.13);
  assert.ok(noon.alt > 60 && noon.alt < 63, `noon altitude ${noon.alt.toFixed(1)}`);
  assert.ok(noon.az > 170 && noon.az < 190, 'due south at noon');
  assert.ok(midnight.alt < -10);
});

test('Moon phases match real full and new moons', () => {
  assert.ok(moonPhase(at('2025-01-13T22:27:00Z')).illumination > 0.98, 'full moon 13 Jan 2025');
  assert.ok(moonPhase(at('2025-01-29T12:36:00Z')).illumination < 0.02, 'new moon 29 Jan 2025');
  assert.equal(moonPhase(at('2025-01-13T22:27:00Z')).name, 'Full moon');
});

test('a winter night in Leeds is long and dark, with Jupiter well placed', () => {
  const night = planNight(at('2026-01-10T18:00:00Z'), 53.8, -1.55);
  assert.ok(night.fullyDark);
  const hours = (night.darkEnd - night.darkStart) / 3600000;
  assert.ok(hours > 11 && hours < 14, `dark for ${hours.toFixed(1)} h`);
  const jupiter = night.planets.find((p) => p.id === 'jupiter');
  assert.ok(jupiter && jupiter.alt > 55, 'Jupiter high at opposition');
  assert.ok(night.deepSky.length > 0);
});

test('midsummer in northern Scotland never gets properly dark', () => {
  const night = planNight(at('2026-06-21T20:00:00Z'), 58.5, -3.1);
  assert.equal(night.fullyDark, false);
});

test('GO / NO-GO verdict picks the clearest two hours of darkness', () => {
  const base = Date.parse('2026-12-01T17:00:00Z');
  const clouds = [90, 90, 80, 70, 20, 10, 10, 40, 80, 90, 90, 90, 90, 90];
  const hourly = clouds.map((c, i) => ({ time: new Date(base + i * 3600000), cloud: c }));
  const v = verdict(hourly, new Date(base), new Date(base + 13 * 3600000));
  assert.equal(v.level, 'GO');
  assert.equal(v.from.toISOString(), '2026-12-01T22:00:00.000Z');
  const cloudy = verdict(hourly.map((h) => ({ ...h, cloud: 95 })), new Date(base), new Date(base + 13 * 3600000));
  assert.equal(cloudy.level, 'NO-GO');
});

test('yearly events roll over to next year once they have passed', () => {
  const d = nextOccurrence('10-21', new Date(2026, 9, 25));
  assert.equal(d.getFullYear(), 2027);
  assert.equal(nextOccurrence('2027-08-02', new Date(2026, 9, 14)).getFullYear(), 2027);
  assert.equal(nextOccurrence('2025-08-02', new Date(2026, 9, 14)), null);
});
