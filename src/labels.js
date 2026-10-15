// Labels and small badges shared by the site builder (Node) and the app (browser).
import { escapeHtml } from './markdown.js';
import { icon, statusMoon, TRACK_ICON } from './icons.js';

export { icon, statusMoon };

export const STATUS = {
  planned: 'Planned',
  'in-progress': 'In progress',
  done: 'Done',
  'to-read': 'To read',
  reading: 'Reading',
  finished: 'Finished',
  pending: 'Waiting for review',
  approved: 'Approved',
  rejected: 'Not accepted',
};
export const EXPERIMENT_STATUSES = ['planned', 'in-progress', 'done'];
export const BOOK_STATUSES = ['to-read', 'reading', 'finished'];
export const TRACK = { astro: 'Astrophysics', quantum: 'Quantum', both: 'Astro + quantum' };
export const KIND = { experiment: 'Experiment', book: 'Book', resource: 'Resource', observation: 'Observing log' };

export const pill = (status) =>
  status
    ? `<span class="pill s-${escapeHtml(status)}">${statusMoon(status, { scale: 1 })}${escapeHtml(STATUS[status] || status)}</span>`
    : '';
export const trackTag = (t) =>
  t ? `<span class="tag t-${escapeHtml(t)}">${icon(TRACK_ICON[t] || 'star', { scale: 1 })}${escapeHtml(TRACK[t] || t)}</span>` : '';
export const kindTag = (k) => (k ? `<span class="tag">${escapeHtml(KIND[k] || k)}</span>` : '');
export const stars = (n) => {
  const k = Math.max(0, Math.min(3, Number(n) || 0));
  return k ? `<span class="difficulty" title="Difficulty ${k} of 3">${'●'.repeat(k)}${'○'.repeat(3 - k)}</span>` : '';
};

export const fmtDate = (v) => {
  if (!v) return '';
  const d = new Date(String(v).length === 10 ? `${v}T00:00:00Z` : v);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

/** The write-up skeleton offered to members when they start notes on an experiment. */
export const WRITEUP_TEMPLATE = `## The question

## My prediction

## Method

1.

## Data

| Trial | Measurement | Notes |
| ----: | ----------: | ----- |
| 1 | | |

## Result

## Explain it to a friend

## New questions

- `;
