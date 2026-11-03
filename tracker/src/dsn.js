// NASA's Deep Space Network "DSN Now" feed: which of the giant dishes in California, Spain
// and Australia are talking to which spacecraft right now. The feed is a small XML file
// that updates every few seconds: https://eyes.nasa.gov/dsn/dsn.html

export const DSN_URL = 'https://eyes.nasa.gov/dsn/data/dsn.xml';

// Station codes in the feed → where they are
const SITES = {
  gdscc: { name: 'Goldstone', country: 'USA' },
  mdscc: { name: 'Madrid', country: 'Spain' },
  cdscc: { name: 'Canberra', country: 'Australia' },
};

const attrs = (tag) => {
  const out = {};
  for (const m of tag.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
};
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const isOn = (s) => s && s.active !== 'false' && s.signalType && s.signalType !== 'none';

/**
 * Reads the feed into a list of dishes:
 *   { dish: 'DSS63', station: 'Madrid', country, links: [{ craft: 'VGR1', id: -31, down, up, downRate, rtlt, range }] }
 * `id` is the spacecraft's Horizons/NAIF ID, so the page can match it to a mission.
 */
export function parseDsn(xml) {
  const text = String(xml || '');
  if (!/<dsn[\s>]/.test(text)) throw new Error('Not a DSN Now feed');
  const dishes = [];
  let site = null;
  let dish = null;
  for (const m of text.matchAll(/<(\/?)(station|dish|downSignal|upSignal|target)\b([^>]*?)(\/?)>/g)) {
    const [, closing, kind, body] = m;
    if (closing) {
      if (kind === 'dish') dish = null;
      continue;
    }
    const a = attrs(body);
    if (kind === 'station') {
      site = SITES[a.name] || { name: a.friendlyName || a.name || '?', country: '' };
    } else if (kind === 'dish') {
      dish = { dish: a.name || '?', station: site?.name || '?', country: site?.country || '', down: [], up: [], targets: [] };
      dishes.push(dish);
    } else if (dish && kind === 'downSignal') {
      if (isOn(a)) dish.down.push(a);
    } else if (dish && kind === 'upSignal') {
      if (isOn(a)) dish.up.push(a);
    } else if (dish && kind === 'target') {
      dish.targets.push(a);
    }
  }

  return dishes.map(({ dish, station, country, down, up, targets }) => {
    const links = targets
      .filter((t) => t.name && !/^(DSN|DSS|TEST|RFC|TBD)/i.test(t.name) && Number(t.id) > 0)
      .map((t) => {
        const id = -Math.abs(Number(t.id));
        const dn = down.find((s) => s.spacecraft === t.name || Number(s.spacecraftID) === id);
        const upl = up.find((s) => s.spacecraft === t.name || Number(s.spacecraftID) === id);
        return {
          craft: t.name,
          id,
          down: Boolean(dn),
          up: Boolean(upl),
          downRate: dn ? num(dn.dataRate) : null, // bits per second
          band: dn?.band || upl?.band || null,
          rtlt: num(t.rtlt), // round-trip light time, seconds
          range: num(t.downlegRange) ?? num(t.uplegRange), // km
        };
      });
    return { dish, station, country, links };
  });
}

/** Fetch and read the feed. */
export async function fetchDsn({ fetch = globalThis.fetch, now = Date.now() } = {}) {
  // The feed's own page adds a changing number so caches never serve an old copy
  const res = await fetch(`${DSN_URL}?r=${Math.floor(now / 5000)}`, { headers: { accept: 'application/xml,text/xml' } });
  if (!res.ok) throw new Error(`DSN Now answered ${res.status}`);
  return parseDsn(await res.text());
}
