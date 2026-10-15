// Auto-graphs: turn Markdown tables of measurements into black & white pixel-style SVG charts.
// Pure functions (no DOM), shared by the app and the tests.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---------- reading values ----------

/** "4.1", "-2.3", "1.07e9", "6.6 × 10^-34", "1,200", "45%", "4.1 cm" → number, else null */
export function parseNumber(raw) {
  const s = String(raw ?? '').trim().replace(/−/g, '-').replace(/,(?=\d{3}\b)/g, '');
  if (!s) return null;
  const sci = s.match(/^([-+]?\d*\.?\d+)\s*[×x*]\s*10\s*\^?\s*\(?\s*([-+]?\d+)\s*\)?/i);
  if (sci) return parseFloat(sci[1]) * 10 ** parseInt(sci[2], 10);
  const m = s.match(/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?(?=\s*[a-zA-Zµ°%'"/]*\s*$)/i);
  return m ? parseFloat(m[0]) : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "21:10" → minutes after midnight; null if not a time */
export function parseTime(raw) {
  const m = String(raw ?? '').trim().match(/^(\d{1,2})[:h](\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [h, min, sec] = [+m[1], +m[2], +(m[3] || 0)];
  return h < 24 && min < 60 ? h * 60 + min + sec / 60 : null;
}

/** "2026-12-12", "12 Dec", "12 Dec 2026", "12/12/2026" → Date (local midnight); null if not a date */
export function parseDate(raw, year = new Date().getFullYear()) {
  const s = String(raw ?? '').trim().toLowerCase();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})\s+([a-z]{3})[a-z]*\.?(?:\s+(\d{4}))?$/);
  if (m && MONTHS.includes(m[2])) return new Date(m[3] ? +m[3] : year, MONTHS.indexOf(m[2]), +m[1]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  return null;
}

// ---------- finding tables ----------

const cells = (line) =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim().replace(/\*\*|__|`/g, ''));

/** Every Markdown table in the text, in order (tables inside code blocks are skipped). */
export function parseTables(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const tables = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i])) inFence = !inFence;
    if (inFence) continue;
    if (/^\|.*\|\s*$/.test(lines[i]) && /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1] || '')) {
      const headers = cells(lines[i]);
      const rows = [];
      let j = i + 2;
      while (j < lines.length && /^\|.*\|\s*$/.test(lines[j])) rows.push(cells(lines[j++]));
      tables.push({ headers, rows: rows.filter((r) => r.some((c) => c !== '')) });
      i = j - 1;
    }
  }
  return tables;
}

// ---------- understanding a table ----------

/**
 * Works out what each column holds. `baseDate` (a Date) turns times into full timestamps,
 * which lets several nights' tables be joined into one graph.
 */
export function analyze(table) {
  const n = table.headers.length;
  const columns = [];
  for (let c = 0; c < n; c++) {
    const raw = table.rows.map((r) => r[c] ?? '');
    const filled = raw.map((v, i) => [v, i]).filter(([v]) => v !== '');
    const kinds = { num: 0, time: 0, date: 0 };
    for (const [v] of filled) {
      if (parseTime(v) !== null) kinds.time++;
      else if (parseDate(v)) kinds.date++;
      else if (parseNumber(v) !== null) kinds.num++;
    }
    const all = filled.length;
    let kind = 'cat';
    if (all >= 2 || (all >= 1 && table.rows.length === 1)) {
      if (kinds.time === all) kind = 'time';
      else if (kinds.date === all) kind = 'date';
      else if (kinds.num + kinds.time + kinds.date === all && kinds.num >= all * 0.8) kind = 'num';
    }
    if (all === 0) kind = 'empty';
    columns.push({ name: table.headers[c] || `Column ${c + 1}`, kind, raw });
  }
  return columns;
}

/** X value for a row: numbers as-is; times/dates as timestamps (ms).
 *  With `night` set, times before noon count as after midnight (same observing night). */
export function xValue(kind, raw, baseDate, night = false) {
  if (kind === 'num') return parseNumber(raw);
  if (kind === 'date') return parseDate(raw)?.getTime() ?? null;
  if (kind === 'time') {
    const t = parseTime(raw);
    if (t === null) return null;
    const base = baseDate ? new Date(baseDate) : new Date(2000, 0, 1);
    base.setHours(0, 0, 0, 0);
    return base.getTime() + (night && t < 12 * 60 ? t + 24 * 60 : t) * 60000;
  }
  return null;
}

/** Sensible starting axes: { x, y: [..], series } as column indexes, or null if nothing to plot. */
export function defaultAxes(columns) {
  const numeric = columns.map((c, i) => [c, i]).filter(([c]) => c.kind === 'num').map(([, i]) => i);
  if (!numeric.length) return null;
  const first = columns.findIndex((c) => c.kind !== 'empty');
  const firstKind = columns[first]?.kind;
  if (['num', 'time', 'date'].includes(firstKind)) {
    const y = numeric.filter((i) => i !== first).slice(0, 3);
    if (!y.length) return null;
    // Split into lines only by a short repeating label column (e.g. Moon: Ganymede / Callisto), not free-text notes
    const series = columns.findIndex((c, i) => {
      if (c.kind !== 'cat' || i === first) return false;
      const vals = c.raw.filter(Boolean);
      const distinct = new Set(vals).size;
      return distinct >= 2 && distinct <= 4 && distinct < vals.length;
    });
    return { x: first, y: y.slice(0, 1), series: series >= 0 && y.length === 1 ? series : -1 };
  }
  // First column is labels: two numbers → plot one against the other; else a bar chart
  if (numeric.length >= 2) return { x: numeric[0], y: [numeric[1]], series: -1 };
  return { x: first, y: [numeric[0]], series: -1 };
}

// ---------- maths ----------

/** Least-squares straight line through points. */
export function linearFit(points) {
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
    syy += (p.y - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r2: syy === 0 ? 1 : (sxy * sxy) / (sxx * syy) };
}

export function fmt(v) {
  if (!Number.isFinite(v)) return '–';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) return v.toExponential(2).replace('e+', 'e');
  return String(Number(v.toPrecision(3)));
}

function niceTicks(min, max, count = 5) {
  if (min === max) {
    const d = Math.abs(min) * 0.1 || 1;
    min -= d;
    max += d;
  }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
  return { lo, hi, ticks };
}

const MIN = 60000;
const TIME_STEPS = [MIN, 5 * MIN, 10 * MIN, 15 * MIN, 30 * MIN, 60 * MIN, 120 * MIN, 180 * MIN, 360 * MIN, 720 * MIN, 1440 * MIN, 2880 * MIN, 7 * 1440 * MIN, 14 * 1440 * MIN, 30 * 1440 * MIN];

function timeTicks(min, max, count = 6) {
  if (min === max) {
    min -= 30 * MIN;
    max += 30 * MIN;
  }
  const step = TIME_STEPS.find((s) => (max - min) / s <= count) || TIME_STEPS.at(-1);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi; v += step) ticks.push(v);
  return { lo, hi, ticks, step };
}

const pad2 = (n) => String(n).padStart(2, '0');
const timeLabel = (ms, step, span) => {
  const d = new Date(ms);
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const dm = `${d.getDate()} ${MONTHS[d.getMonth()][0].toUpperCase()}${MONTHS[d.getMonth()].slice(1)}`;
  if (step >= 1440 * MIN) return dm;
  return span > 1440 * MIN && d.getHours() === 0 && d.getMinutes() === 0 ? dm : hm;
};

// ---------- drawing ----------

const W = 640;
const H = 320;
const M = { l: 62, r: 36, t: 18, b: 46 };
const DASHES = ['', '7 4', '2 4', '10 3 2 3'];

function marker(shape, x, y) {
  const s = 4;
  switch (shape) {
    case 0: return `<rect x="${x - s}" y="${y - s}" width="${2 * s}" height="${2 * s}" fill="currentColor"/>`;
    case 1: return `<rect x="${x - s + 1}" y="${y - s + 1}" width="${2 * s - 2}" height="${2 * s - 2}" class="hollow" stroke="currentColor" stroke-width="2"/>`;
    case 2: return `<path d="M${x} ${y - s - 1}L${x + s + 1} ${y}L${x} ${y + s + 1}L${x - s - 1} ${y}Z" fill="currentColor"/>`;
    default: return `<path d="M${x - s} ${y - s}L${x + s} ${y + s}M${x + s} ${y - s}L${x - s} ${y + s}" stroke="currentColor" stroke-width="2.5"/>`;
  }
}

/**
 * Draw a chart. `columns` from analyze(); `axes` = { x, y:[i], series } column indexes.
 * `rows` lets callers pass extra per-row info: [{ cells:[...], baseDate }].
 * Returns { svg, summary, fit } or null when there aren't enough points.
 */
export function chartSvg({ columns, rows, axes, fit: wantFit = false, title = '' }) {
  const xc = columns[axes.x];
  const yIdx = axes.y.filter((i) => columns[i]?.kind === 'num');
  if (!xc || !yIdx.length) return null;
  const isCat = !['num', 'time', 'date'].includes(xc.kind);
  const isTime = xc.kind === 'time' || xc.kind === 'date';
  // A session that runs past midnight: evening and early-morning times together
  const mins = xc.kind === 'time' ? rows.map((r) => parseTime(r.cells[axes.x])).filter((t) => t !== null) : [];
  const night = mins.some((t) => t >= 18 * 60) && mins.some((t) => t < 12 * 60);

  // Build series: one per Y column, or one per category in the series column
  const series = [];
  if (axes.series >= 0 && yIdx.length === 1 && !isCat) {
    const groups = new Map();
    rows.forEach((r) => {
      const key = r.cells[axes.series] || '—';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });
    [...groups].slice(0, 4).forEach(([name, rs]) => series.push({ name, rows: rs, y: yIdx[0] }));
  } else {
    yIdx.slice(0, 4).forEach((y) => series.push({ name: columns[y].name, rows, y }));
  }

  const pts = series.map((s) => ({
    ...s,
    points: s.rows
      .map((r, i) => ({
        x: isCat ? i : xValue(xc.kind, r.cells[axes.x], r.baseDate, night),
        y: parseNumber(r.cells[s.y]),
        label: r.cells[axes.x],
      }))
      .filter((p) => p.x !== null && p.y !== null && Number.isFinite(p.x) && Number.isFinite(p.y))
      .sort((a, b) => (isCat ? 0 : a.x - b.x)),
  })).filter((s) => s.points.length);

  const all = pts.flatMap((s) => s.points);
  if (all.length < (isCat ? 1 : 2)) return null;

  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;
  const ys = all.map((p) => p.y);
  const yAx = niceTicks(isCat ? Math.min(0, ...ys) : Math.min(...ys), isCat ? Math.max(0, ...ys) : Math.max(...ys));
  const sy = (v) => M.t + ph - ((v - yAx.lo) / (yAx.hi - yAx.lo || 1)) * ph;

  let sx;
  let xTicks = [];
  let parts = [];
  if (isCat) {
    const labels = rows.map((r) => r.cells[axes.x]);
    const band = pw / Math.max(labels.length, 1);
    sx = (i) => M.l + band * i + band / 2;
    xTicks = labels.map((l, i) => ({ x: sx(i), label: l.length > 10 ? `${l.slice(0, 9)}…` : l }));
    const s0 = pts[0];
    const bw = Math.max(6, Math.min(48, band * 0.6));
    parts = s0.points.map(
      (p) => `<rect x="${(sx(p.x) - bw / 2).toFixed(1)}" y="${Math.min(sy(p.y), sy(Math.max(0, yAx.lo))).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.abs(sy(p.y) - sy(Math.max(0, yAx.lo))).toFixed(1)}" fill="url(#dither)" stroke="currentColor" stroke-width="2"/>`
    );
  } else {
    const xs = all.map((p) => p.x);
    const xAx = isTime ? timeTicks(Math.min(...xs), Math.max(...xs)) : niceTicks(Math.min(...xs), Math.max(...xs));
    sx = (v) => M.l + ((v - xAx.lo) / (xAx.hi - xAx.lo || 1)) * pw;
    const span = xAx.hi - xAx.lo;
    xTicks = xAx.ticks.map((v) => ({ x: sx(v), label: isTime ? timeLabel(v, xAx.step, span) : fmt(v) }));
    const joinLines = isTime || pts.every((s) => s.points.every((p, i, a) => i === 0 || p.x >= a[i - 1].x));
    parts = pts.map((s, si) => {
      const line =
        joinLines && s.points.length > 1 && !wantFit
          ? `<polyline points="${s.points.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ')}" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="${DASHES[si]}" stroke-linejoin="miter"/>`
          : '';
      return line + s.points.map((p) => marker(si, +sx(p.x).toFixed(1), +sy(p.y).toFixed(1))).join('');
    });
  }

  // Best-fit line (numeric X only)
  let fit = null;
  if (wantFit && !isCat && !isTime) {
    fit = linearFit(pts[0].points);
    if (fit) {
      const [x0, x1] = [Math.min(...pts[0].points.map((p) => p.x)), Math.max(...pts[0].points.map((p) => p.x))];
      const clampY = (v) => Math.max(M.t, Math.min(M.t + ph, sy(v)));
      parts.push(
        `<line x1="${sx(x0).toFixed(1)}" y1="${clampY(fit.slope * x0 + fit.intercept).toFixed(1)}" x2="${sx(x1).toFixed(1)}" y2="${clampY(fit.slope * x1 + fit.intercept).toFixed(1)}" stroke="currentColor" stroke-width="2" stroke-dasharray="8 5"/>`
      );
    }
  }

  const grid = yAx.ticks
    .map((v) => `<line x1="${M.l}" x2="${W - M.r}" y1="${sy(v).toFixed(1)}" y2="${sy(v).toFixed(1)}" stroke="currentColor" stroke-opacity=".35" stroke-dasharray="1 4"/><text x="${M.l - 8}" y="${(sy(v) + 5).toFixed(1)}" text-anchor="end" class="ct">${esc(fmt(v))}</text>`)
    .join('');
  const xt = xTicks
    .map((t) => `<line x1="${t.x.toFixed(1)}" x2="${t.x.toFixed(1)}" y1="${H - M.b}" y2="${H - M.b + 6}" stroke="currentColor" stroke-width="2"/><text x="${t.x.toFixed(1)}" y="${H - M.b + 22}" text-anchor="middle" class="ct">${esc(t.label)}</text>`)
    .join('');
  const legend =
    pts.length > 1
      ? pts
          .map((s, si) => {
            const y = M.t + 8 + si * 18;
            return `<g>${marker(si, W - M.r - 120, y)}<line x1="${W - M.r - 134}" x2="${W - M.r - 106}" y1="${y}" y2="${y}" stroke="currentColor" stroke-width="2" stroke-dasharray="${DASHES[si]}"/><text x="${W - M.r - 98}" y="${y + 5}" class="cl">${esc(s.name.slice(0, 16))}</text></g>`;
          })
          .join('')
      : '';

  const yName = pts.length === 1 && axes.series < 0 ? columns[pts[0].y].name : yIdx.length === 1 ? columns[yIdx[0]].name : '';
  const kindWord = isCat ? 'Bar chart' : fit ? 'Scatter plot with best-fit line' : 'Line chart';
  const ysRange = `${fmt(Math.min(...ys))} to ${fmt(Math.max(...ys))}`;
  const summary = `${kindWord} of ${yName || 'values'} against ${xc.name}: ${all.length} points, ${yName ? `${yName} ` : ''}from ${ysRange}.${
    fit ? ` Best-fit slope ${fmt(fit.slope)}, R² ${fit.r2.toFixed(3)}.` : ''
  }`;

  const svg = `<svg class="autograph" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(summary)}" preserveAspectRatio="xMidYMid meet">
<defs><pattern id="dither" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="2" height="2" fill="currentColor"/><rect x="2" y="2" width="2" height="2" fill="currentColor"/></pattern></defs>
${title ? `<title>${esc(title)}</title>` : ''}
${grid}
<line x1="${M.l}" x2="${W - M.r}" y1="${H - M.b}" y2="${H - M.b}" stroke="currentColor" stroke-width="2"/>
<line x1="${M.l}" x2="${M.l}" y1="${M.t}" y2="${H - M.b}" stroke="currentColor" stroke-width="2"/>
${xt}
${parts.join('')}
${legend}
<text x="${(M.l + W - M.r) / 2}" y="${H - 4}" text-anchor="middle" class="ca">${esc(xc.name)}</text>
${yName ? `<text x="14" y="${M.t + ph / 2}" text-anchor="middle" class="ca" transform="rotate(-90 14 ${M.t + ph / 2})">${esc(yName)}</text>` : ''}
</svg>`;
  return { svg, summary, fit, points: all.length };
}

/**
 * Join several sessions' tables that share the same columns into one table.
 * `entries` = [{ date: 'YYYY-MM-DD', title, notes }]. Returns [{ headers, rows:[{cells, baseDate, entry}] }].
 */
export function combineTables(entries) {
  const groups = new Map();
  for (const e of entries) {
    for (const t of parseTables(e.notes)) {
      const key = t.headers.map((h) => h.toLowerCase()).join('|');
      if (!groups.has(key)) groups.set(key, { headers: t.headers, rows: [] });
      const base = parseDate(e.date);
      for (const r of t.rows) groups.get(key).rows.push({ cells: r, baseDate: base, entry: e });
    }
  }
  return [...groups.values()].filter((g) => g.rows.length);
}

/** CSV text for a combined table (adds the session date as the first column). */
export function toCsv(group) {
  const q = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [['Session date', ...group.headers].map(q).join(',')];
  for (const r of group.rows) lines.push([r.entry?.date || '', ...r.cells].map(q).join(','));
  return `${lines.join('\n')}\n`;
}
