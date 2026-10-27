// Mission Control maths: interpolating spacecraft tracks, distances and light-time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stateAt, readout, firstCrossing, LIGHT_DAY, AU, C, hms, span, elapsed, ago, rate, earthAt, dist } from '../src/fleet.js';

const DAY = 86400000;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// Real Europa Clipper rows from Horizons (27 and 28 Oct 2026)
const CLIPPER = {
  t0: Date.UTC(2026, 9, 27),
  dt: DAY,
  p: [
    [118644763, 41266420, -3549461, -11.816, 37.645, 0.829],
    [117594328, 44508364, -3476992, -12.498, 37.397, 0.849],
  ],
};

test('the track passes exactly through each daily row', () => {
  const a = stateAt(CLIPPER, CLIPPER.t0);
  const b = stateAt(CLIPPER, CLIPPER.t0 + DAY - 1);
  near(a.pos[0], 118644763, 1, 'x at row 0');
  near(b.pos[1], 44508364, 50, 'y just before row 1');
});

test('between rows the path follows the velocities, not a straight chord', () => {
  const mid = stateAt(CLIPPER, CLIPPER.t0 + DAY / 2);
  // Hermite midpoint = chord midpoint + (h/8)(v_a − v_b): here ~7,400 km off the straight chord
  const chord = (118644763 + 117594328) / 2;
  near(mid.pos[0], chord + (86400 / 8) * (-11.816 - -12.498), 1, 'x at noon');
  assert.ok(Math.abs(mid.pos[0] - chord) > 5000, 'curves away from the chord');
  near(mid.vel[1], (37.645 + 37.397) / 2, 0.05, 'vy at noon');
  assert.equal(mid.extrapolated, false);
});

test('past the data it coasts in a straight line', () => {
  const s = stateAt(CLIPPER, CLIPPER.t0 + 2 * DAY);
  near(s.pos[0], 117594328 + -12.498 * 86400, 1, 'x a day after the last row');
  assert.equal(s.extrapolated, true);
});

test('Europa Clipper is heading for its December Earth flyby (well under 1 AU away)', () => {
  const r = readout(CLIPPER, Date.UTC(2026, 9, 27, 12));
  near(r.fromSun / AU, 0.84, 0.02, 'distance from the Sun (AU)');
  assert.ok(r.fromEarth / AU > 0.05 && r.fromEarth / AU < 0.6, `from Earth ${(r.fromEarth / AU).toFixed(3)} AU`);
  near(r.speed, 39.4, 0.3, 'speed around the Sun');
  near(r.lightTime, r.fromEarth / C, 1e-9, 'light time');
});

test('Earth is 1 AU from the Sun (within its orbit\'s stretch)', () => {
  const d = dist(earthAt(Date.UTC(2026, 0, 3))) / AU; // near perihelion
  near(d, 0.983, 0.002, 'perihelion distance');
});

test('first crossing: a probe moving straight out passes one light-day when expected', () => {
  // A made-up probe on the far side of the Sun from Earth's January position, 172 AU out, moving out at 17 km/s
  const t0 = Date.UTC(2026, 0, 1);
  const track = { t0, dt: DAY, p: [[-172 * AU, 0, 0, -17, 0, 0], [-172 * AU - 17 * 86400, 0, 0, -17, 0, 0]] };
  const f = (t) => readout(track, t).fromEarth;
  const when = firstCrossing(f, LIGHT_DAY, t0, t0 + 400 * DAY, 6 * 3600000);
  assert.ok(when, 'it crosses');
  near(f(when), LIGHT_DAY, 50, 'distance at the crossing');
  assert.ok(f(when - 3600000) < LIGHT_DAY, 'and was nearer an hour earlier');
  assert.equal(firstCrossing(() => 0, 1, t0, t0 + DAY), null);
});

test('readable numbers', () => {
  assert.equal(hms(83049), '23h 04m 09s');
  assert.equal(hms(192.44), '3m 12s');
  assert.equal(hms(4.25), '4.3s');
  assert.equal(span(DAY + 3661000), '1d 01:01:01');
  assert.equal(elapsed('1977-09-05', Date.UTC(2026, 9, 27)), '49y 052d');
  assert.equal(ago(new Date(Date.now() - 3 * 3600000).toISOString()), '3 h ago');
  assert.equal(rate(160), '160 b/s');
  assert.equal(rate(1600), '1.6 kb/s');
});
