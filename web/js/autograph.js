// Auto-graphs in the app: every table of measurements gets a chart, with axis pickers
// and an optional best-fit line. Works on rendered Markdown, live while typing, and on
// joined-up data from several journal entries.
import { parseTables, analyze, defaultAxes, chartSvg, fmt } from './lib/charts.js';
import { escapeHtml as esc } from './lib/markdown.js';

let uid = 0;

/**
 * Build an interactive graph for one table.
 * `table` = { headers, rows: [{ cells, baseDate? }] }. Returns an element, or null if there's nothing to plot.
 */
export function graphElement(table, { title = 'Auto-graph', remember } = {}) {
  const columns = analyze({ headers: table.headers, rows: table.rows.map((r) => r.cells) });
  const start = remember?.get() || defaultAxes(columns);
  if (!start) return null;
  let axes = { ...start };
  let fit = !!start.fit;
  const id = `g${++uid}`;

  const fig = document.createElement('figure');
  fig.className = 'graph win';
  const xOpts = columns.map((c, i) => (c.kind === 'empty' ? '' : `<option value="${i}">${esc(c.name)}</option>`)).join('');
  const yOpts = columns.map((c, i) => (c.kind === 'num' ? `<option value="${i}">${esc(c.name)}</option>` : '')).join('');
  fig.innerHTML = `<div class="win-bar"><span>${esc(title)}</span><span class="fill dither" aria-hidden="true"></span></div>
<div class="graph-body"></div>
<figcaption class="graph-controls">
  <label for="${id}-x">Across <select id="${id}-x" data-axis="x">${xOpts}</select></label>
  <label for="${id}-y">Up <select id="${id}-y" data-axis="y">${yOpts}</select></label>
  <label class="fitbox" for="${id}-f"><input type="checkbox" id="${id}-f" data-fit> Best-fit line</label>
  <span class="fit-readout" aria-live="polite"></span>
</figcaption>`;

  const draw = () => {
    const xKind = columns[axes.x]?.kind;
    const canFit = xKind === 'num';
    const fitBox = fig.querySelector('[data-fit]');
    fitBox.disabled = !canFit;
    fitBox.checked = fit && canFit;
    fig.querySelector('.fitbox').classList.toggle('off', !canFit);
    const out = chartSvg({ columns, rows: table.rows, axes, fit: fit && canFit, title });
    fig.querySelector('.graph-body').innerHTML = out ? out.svg : '<p class="muted small" style="padding:16px">Not enough numbers to draw this one yet.</p>';
    fig.querySelector('.fit-readout').innerHTML = out?.fit
      ? `slope <b>${fmt(out.fit.slope)}</b> · intercept <b>${fmt(out.fit.intercept)}</b> · R² <b>${out.fit.r2.toFixed(3)}</b>`
      : '';
    remember?.set({ ...axes, fit });
  };

  fig.querySelector('[data-axis="x"]').value = String(axes.x);
  fig.querySelector('[data-axis="y"]').value = String(axes.y[0]);
  fig.addEventListener('change', (e) => {
    if (e.target.dataset.axis === 'x') axes = { ...axes, x: Number(e.target.value), series: axes.x === Number(e.target.value) ? axes.series : -1 };
    if (e.target.dataset.axis === 'y') axes = { ...axes, y: [Number(e.target.value)] };
    if (e.target.hasAttribute('data-fit')) fit = e.target.checked;
    if (axes.series === axes.x || axes.y.includes(axes.series)) axes.series = -1;
    draw();
  });
  draw();
  return fig;
}

/** After Markdown has been rendered into `container`, add a graph under each table of numbers. */
export function attachGraphs(container, markdown) {
  const tables = parseTables(markdown);
  const wraps = [...container.querySelectorAll('.table-wrap')].filter((w) => !w.closest('blockquote'));
  tables.slice(0, wraps.length).forEach((t, i) => {
    const el = graphElement({ headers: t.headers, rows: t.rows.map((cells) => ({ cells })) });
    if (el) wraps[i].after(el);
  });
}

/** Graphs that redraw as you type in a text box. Axis choices survive edits. */
export function liveGraphs(textarea, mount, { baseDate } = {}) {
  const memory = new Map();
  let timer;
  const run = () => {
    mount.innerHTML = '';
    parseTables(textarea.value).forEach((t, i) => {
      const key = `${i}:${t.headers.join('|').toLowerCase()}`;
      const el = graphElement(
        { headers: t.headers, rows: t.rows.map((cells) => ({ cells, baseDate })) },
        { title: 'Live graph', remember: { get: () => memory.get(key), set: (v) => memory.set(key, v) } }
      );
      if (el) mount.append(el);
    });
  };
  textarea.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, 350);
  });
  run();
}
