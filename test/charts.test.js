// Run: node --test test/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNumber, parseTime, parseDate, parseTables, analyze, defaultAxes, linearFit, chartSvg, combineTables, toCsv } from '../src/charts.js';

const rowsOf = (t) => t.rows.map((cells) => ({ cells }));

test('reads numbers the way people type them', () => {
  assert.equal(parseNumber('4.1'), 4.1);
  assert.equal(parseNumber('−2.3'), -2.3);
  assert.equal(parseNumber('1.07e9'), 1.07e9);
  assert.ok(Math.abs(parseNumber('6.6 × 10^-34') - 6.6e-34) < 1e-40);
  assert.equal(parseNumber('1,200'), 1200);
  assert.equal(parseNumber('45%'), 45);
  assert.equal(parseNumber('4.1 cm'), 4.1);
  assert.equal(parseNumber('Ganymede'), null);
  assert.equal(parseNumber('4.1.2'), null);
  assert.equal(parseNumber(''), null);
});

test('reads times and dates, without mistaking decimals for times', () => {
  assert.equal(parseTime('21:10'), 21 * 60 + 10);
  assert.equal(parseTime('4.10'), null);
  assert.equal(parseDate('2026-12-12').getDate(), 12);
  assert.equal(parseDate('12 Dec', 2026).getMonth(), 11);
  assert.equal(parseDate('3 January 2027').getFullYear(), 2027);
  assert.equal(parseDate('Ganymede'), null);
});

test('finds tables but ignores ones inside code blocks', () => {
  const md = 'Intro\n\n| A | B |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n\n```\n| X | Y |\n| - | - |\n| 9 | 9 |\n```\n\n| C | D |\n| --- | ---: |\n| a | 5 |\n';
  const t = parseTables(md);
  assert.equal(t.length, 2);
  assert.deepEqual(t[0].headers, ['A', 'B']);
  assert.equal(t[0].rows.length, 2);
  assert.deepEqual(t[1].headers, ['C', 'D']);
});

test('Jupiter night: time on X, distance on Y, one line per moon', () => {
  const [t] = parseTables('| Time | Moon | Distance (J-widths) |\n| --- | --- | ---: |\n| 21:10 | Ganymede | 4.1 |\n| 21:12 | Callisto | -6.8 |\n| 22:40 | Ganymede | 4.4 |\n| 22:41 | Callisto | -6.5 |');
  const cols = analyze(t);
  assert.deepEqual(cols.map((c) => c.kind), ['time', 'cat', 'num']);
  const axes = defaultAxes(cols);
  assert.deepEqual(axes, { x: 0, y: [2], series: 1 });
  const out = chartSvg({ columns: cols, rows: rowsOf(t), axes });
  assert.ok(out.svg.includes('<polyline'), 'joined with lines');
  assert.equal((out.svg.match(/<polyline/g) || []).length, 2, 'one line per moon');
  assert.ok(out.svg.includes('Ganymede') && out.svg.includes('Callisto'), 'legend');
  assert.match(out.summary, /4 points/);
});

test('Planck LEDs: colour labels, then voltage against wavelength with a best-fit line', () => {
  const [t] = parseTables(
    '| Colour | Wavelength (nm) | Turn-on voltage (V) |\n| --- | ---: | ---: |\n| Red | 630 | 1.97 |\n| Yellow | 590 | 2.10 |\n| Green | 525 | 2.36 |\n| Blue | 470 | 2.64 |'
  );
  const cols = analyze(t);
  assert.deepEqual(cols.map((c) => c.kind), ['cat', 'num', 'num']);
  const axes = defaultAxes(cols);
  assert.deepEqual(axes, { x: 1, y: [2], series: -1 });
  const out = chartSvg({ columns: cols, rows: rowsOf(t), axes, fit: true });
  assert.ok(out.fit.slope < 0, 'voltage falls as wavelength rises');
  assert.ok(out.fit.r2 > 0.98);
  assert.match(out.summary, /Best-fit slope/);
  assert.ok(!out.svg.includes('<polyline'), 'scatter, not joined, when fitting');
});

test('one number per label becomes a bar chart', () => {
  const [t] = parseTables('| Light source | Lines seen |\n| --- | ---: |\n| Daylight | 0 |\n| Fluorescent | 5 |\n| Street lamp | 2 |');
  const cols = analyze(t);
  const axes = defaultAxes(cols);
  assert.deepEqual(axes, { x: 0, y: [1], series: -1 });
  const out = chartSvg({ columns: cols, rows: rowsOf(t), axes });
  assert.equal((out.svg.match(/<rect x="[0-9.]+" y=/g) || []).length - 1, 3, 'three bars (plus 1 pattern square)');
  assert.match(out.summary, /^Bar chart/);
});

test('empty template tables and text-only tables make no graph', () => {
  const [empty] = parseTables('| Trial | Measurement | Notes |\n| ---: | ---: | --- |\n| 1 | | |\n| 2 | | |');
  assert.equal(defaultAxes(analyze(empty)), null);
  const [words] = parseTables('| Kit | Where |\n| - | - |\n| Binoculars | Shed |');
  assert.equal(defaultAxes(analyze(words)), null);
});

test('best-fit line is exact for a straight line', () => {
  const f = linearFit([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }]);
  assert.equal(f.slope, 2);
  assert.equal(f.intercept, 1);
  assert.equal(f.r2, 1);
});

test('several nights join into one graph in time order, crossing midnight correctly', () => {
  const entries = [
    { date: '2026-12-14', notes: '| Time | Distance |\n| - | - |\n| 23:50 | 2.3 |\n| 00:20 | 2.1 |' },
    { date: '2026-12-12', notes: '| Time | Distance |\n| - | - |\n| 21:10 | 4.1 |' },
    { date: '2026-12-13', notes: 'No table tonight — cloudy.' },
  ];
  const [g] = combineTables(entries);
  assert.equal(g.rows.length, 3);
  const cols = analyze({ headers: g.headers, rows: g.rows.map((r) => r.cells) });
  const out = chartSvg({ columns: cols, rows: g.rows, axes: defaultAxes(cols) });
  assert.equal(out.points, 3);
  assert.ok(out.svg.includes('12 Dec') || out.svg.includes('13 Dec'), 'date labels across nights');
  const csv = toCsv(g);
  assert.ok(csv.startsWith('Session date,Time,Distance\n'));
  assert.equal(csv.trim().split('\n').length, 4);
});

test('labels in charts are escaped', () => {
  const [t] = parseTables('| <b>x</b> | y |\n| - | - |\n| 1 | 2 |\n| 2 | 3 |');
  const cols = analyze(t);
  const out = chartSvg({ columns: cols, rows: rowsOf(t), axes: defaultAxes(cols) });
  assert.ok(!out.svg.includes('<b>'));
});

test('free-text notes columns do not split the graph into many lines', () => {
  const [t] = parseTables('| Time | Measurement | Notes |\n| - | -: | - |\n| 21:00 | 3 | hazy |\n| 21:30 | 4 | clearer now |\n| 22:00 | 5 | great |');
  assert.equal(defaultAxes(analyze(t)).series, -1);
});
