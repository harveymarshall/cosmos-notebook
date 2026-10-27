// Mission Control's tracker: reading NASA's feeds and saving the live files.
// Run: node --test tracker/test/*.test.js   (no network — every feed is faked)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { horizonsUrl, parseVectors, compact, window } from '../src/horizons.js';
import { parseDsn } from '../src/dsn.js';
import { fetchNews, mentions, article } from '../src/news.js';
import { positionsJob, runJobs, FILES } from '../src/run.js';
import { MISSIONS, milestoneTime } from '../src/missions.js';

// Real Horizons output for Europa Clipper, 27–28 Oct 2026 (trimmed header)
const CLIPPER = `*******************************************************************************
Target body name: Europa Clipper (spacecraft) (-159) {source: Europa_Clipper_merged}
Center body name: Sun (10)                        {source: Europa_Clipper_merged}
*******************************************************************************
JDTDB, Calendar Date (TDB), X, Y, Z, VX, VY, VZ,
**************************************************************************************************************************
$$SOE
2461340.500000000, A.D. 2026-Oct-27 00:00:00.0000,  1.186447630906406E+08,  4.126641961805721E+07, -3.549461359544603E+06, -1.181634559842358E+01,  3.764472244903151E+01,  8.285896299731839E-01,
2461341.500000000, A.D. 2026-Oct-28 00:00:00.0000,  1.175943280227265E+08,  4.450836385954827E+07, -3.476991949822729E+06, -1.249795376312465E+01,  3.739728068687710E+01,  8.488639074714630E-01,
$$EOE
*******************************************************************************`;

test('Horizons query asks for Sun-centred daily vectors in km and km/s', () => {
  const url = decodeURIComponent(horizonsUrl(-159, Date.UTC(2026, 9, 1), Date.UTC(2026, 9, 3)));
  for (const part of ["COMMAND='-159'", "EPHEM_TYPE='VECTORS'", "CENTER='500@10'", "STEP_SIZE='1 d'", "OUT_UNITS='KM-S'", "START_TIME='2026-10-01'", "STOP_TIME='2026-10-03'"]) {
    assert.ok(url.includes(part), part);
  }
  assert.ok(!horizonsUrl(-159, 0, 1).includes(' '), 'no raw spaces in the URL');
});

test('the fetch window covers the last 180 days and 5 days ahead, on whole days', () => {
  const { start, stop } = window(Date.UTC(2026, 9, 27, 15, 30));
  assert.equal(new Date(start).toISOString(), '2026-04-30T00:00:00.000Z');
  assert.equal(new Date(stop).toISOString(), '2026-11-01T00:00:00.000Z');
});

test('Horizons tables become timed rows and compact tracks', () => {
  const rows = parseVectors(CLIPPER);
  assert.equal(rows.length, 2);
  assert.equal(new Date(rows[0].t).toISOString(), '2026-10-27T00:00:00.000Z');
  assert.equal(rows[0].p[0], 1.186447630906406e8);
  const track = compact(rows);
  assert.equal(track.dt, 86400000);
  assert.deepEqual(track.p[0], [118644763, 41266420, -3549461, -11.816, 37.645, 0.829]);
});

test('Horizons errors are reported, not turned into empty tracks', () => {
  assert.throws(() => parseVectors('No ephemeris for target "Juno" after A.D. 2025-SEP-15'), /No ephemeris/);
  assert.throws(() => parseVectors('$$SOE\n$$EOE'), /empty/);
});

const DSN_XML = `<?xml version='1.0' encoding='utf-8'?>
<dsn>
<station name="gdscc" friendlyName="Goldstone" timeUTC="1793121600000" timeZoneOffset="-25200000" />
<dish name="DSS14" azimuthAngle="120.5" elevationAngle="30.1" windSpeed="5" isMSPA="false" isArray="false" isDDOR="false" activity="Spacecraft Telemetry, Tracking, and Command">
<upSignal active="false" signalType="none" dataRate="" frequency="" band="X" power="" spacecraft="EURC" spacecraftID="-159" />
<downSignal active="true" signalType="data" dataRate="1600" frequency="8.4e9" band="X" power="-140.2" spacecraft="EURC" spacecraftID="-159" />
<target name="EURC" id="159" uplegRange="4.6e7" downlegRange="4.6e7" rtlt="307.1" />
</dish>
<dish name="DSS24" azimuthAngle="" elevationAngle="" windSpeed="" isMSPA="false" isArray="false" isDDOR="false" activity="">
<downSignal active="false" signalType="none" dataRate="" frequency="" band="" power="" spacecraft="" spacecraftID="" />
<target name="DSN" id="99" uplegRange="-1.0" downlegRange="-1.0" rtlt="-1.0" />
</dish>
<station name="mdscc" friendlyName="Madrid" timeUTC="1793121600000" timeZoneOffset="3600000" />
<dish name="DSS63" azimuthAngle="250" elevationAngle="40" windSpeed="3" isMSPA="false" isArray="false" isDDOR="false" activity="">
<upSignal active="true" signalType="data" dataRate="16" frequency="7.1e9" band="X" power="18" spacecraft="VGR1" spacecraftID="-31" />
<downSignal active="true" signalType="data" dataRate="160" frequency="8.4e9" band="X" power="-157" spacecraft="VGR1" spacecraftID="-31" />
<target name="VGR1" id="31" uplegRange="2.58e10" downlegRange="2.58e10" rtlt="172600" />
</dish>
<timestamp>1793121600000</timestamp>
</dsn>`;

test('DSN Now: dishes, stations and who they are talking to', () => {
  const dishes = parseDsn(DSN_XML);
  assert.equal(dishes.length, 3);
  const [gold, idle, madrid] = dishes;
  assert.equal(gold.station, 'Goldstone');
  assert.deepEqual(gold.links, [{ craft: 'EURC', id: -159, down: true, up: false, downRate: 1600, band: 'X', rtlt: 307.1, range: 4.6e7 }]);
  assert.deepEqual(idle.links, [], 'placeholder "DSN" targets are ignored');
  assert.equal(madrid.station, 'Madrid');
  assert.equal(madrid.country, 'Spain');
  assert.equal(madrid.links[0].id, -31);
  assert.equal(madrid.links[0].up, true);
  assert.equal(madrid.links[0].downRate, 160);
});

test('DSN Now: anything that is not the feed is rejected', () => {
  assert.throws(() => parseDsn('<html>Service unavailable</html>'), /Not a DSN/);
});

test('news: whole-word headline matches, safe links only', () => {
  assert.ok(mentions('Hera snaps Didymos on approach', 'Hera'));
  assert.ok(!mentions('Herald of a new rocket age', 'Hera'));
  assert.ok(mentions('NASA’s Voyager 1 nears one light-day', 'Voyager 1'));
  assert.ok(!mentions('Voyager 12 is not a thing', 'Voyager 1'));
  assert.equal(article({ title: 'x', url: 'javascript:alert(1)' }), null);
  assert.equal(article({ title: 'A'.repeat(300), url: 'https://example.com', summary: 'B '.repeat(400) }).title.length <= 160, true);
});

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

test('news: latest list tagged with missions, plus per-mission headlines', async () => {
  const fake = async (url) => {
    const u = new URL(url);
    const q = u.searchParams.get('title_contains');
    if (!q) return json({ results: [{ id: 1, title: 'BepiColombo fires up for Mercury', url: 'https://a.example/1', news_site: 'ESA' }, { id: 2, title: 'Rocket launch today', url: 'https://a.example/2' }] });
    if (q === 'Hera') return json({ results: [{ id: 3, title: 'Hera arrives', url: 'https://a.example/3' }, { id: 4, title: 'Herald sun', url: 'https://a.example/4' }] });
    return json({ results: [] });
  };
  const missions = MISSIONS.filter((m) => ['hera', 'bepicolombo'].includes(m.slug));
  const out = await fetchNews(missions, { fetch: fake });
  assert.deepEqual(out.latest[0].missions, ['bepicolombo']);
  assert.deepEqual(out.latest[1].missions, []);
  assert.deepEqual(out.byMission.hera.map((a) => a.id), [3]);
  assert.equal(out.byMission.bepicolombo, undefined);
});

test('positions: one failing spacecraft keeps its last known track, marked stale', async () => {
  const missions = MISSIONS.filter((m) => ['europa-clipper', 'juice'].includes(m.slug));
  const fake = async (url) => (decodeURIComponent(url).includes("'-159'") ? json({ result: CLIPPER }) : json({ error: 'No ephemeris for target' }));
  const previous = { craft: { juice: { id: -28, t0: 1, dt: 86400000, p: [[1, 2, 3, 0, 0, 0]] } } };
  const out = await positionsJob({ fetch: fake, read: async () => previous, wait: async () => {}, missions });
  assert.equal(out.craft['europa-clipper'].p.length, 2);
  assert.equal(out.craft.juice.stale, true);
  assert.equal(out.errors.length, 1);
});

test('runJobs saves each file with its cache time and survives a failed job', async () => {
  const saved = {};
  const fake = async (url) => (url.includes('dsn.xml') ? { ok: true, status: 200, text: async () => DSN_XML } : json({}, 500));
  const quiet = { log() {}, error() {} };
  const res = await runJobs(['dsn', 'news'], { fetch: fake, read: async () => null, write: async (k, body, age) => (saved[k] = { body, age }), log: quiet });
  assert.equal(res.dsn, 'ok');
  assert.match(res.news, /^failed/);
  assert.equal(saved[FILES.dsn.key].age, 30);
  assert.equal(JSON.parse(saved[FILES.dsn.key].body).dishes.length, 3);
  assert.equal(saved[FILES.news.key], undefined, 'a failed job leaves the old file alone');
});

test('every mission has what the tracker and page need', () => {
  const slugs = new Set();
  for (const m of MISSIONS) {
    assert.ok(/^[a-z0-9-]+$/.test(m.slug) && !slugs.has(m.slug), m.slug);
    slugs.add(m.slug);
    assert.ok(Number.isInteger(m.horizons) && m.horizons < 0, `${m.slug} horizons id`);
    assert.ok(m.name && m.agency && m.where && m.about && m.news.length, m.slug);
    assert.ok(!Number.isNaN(Date.parse(m.launched)), `${m.slug} launch date`);
    for (const ms of m.milestones) assert.ok(/^\d{4}-\d{2}(-\d{2})?$/.test(ms.date) && ms.label, `${m.slug} ${ms.date}`);
  }
  assert.equal(milestoneTime({ date: '2026-11' }).exact, false);
  assert.equal(new Date(milestoneTime({ date: '2026-11-21' }).t).toISOString().slice(0, 10), '2026-11-21');
});
