// Pixel-art icons, drawn on a grid in one colour (currentColor) so they follow the theme.
// Shared by the site builder and the app.

const ICONS = {
  planet: [19, 11, 'M7 0h5v1h-5zM18 0h1v1h-1zM6 1h7v1h-7zM15 1h4v1h-4zM5 2h9v1h-9zM18 2h1v1h-1zM4 3h11v1h-11zM18 3h1v1h-1zM4 4h9v1h-9zM16 4h3v1h-3zM4 5h6v1h-6zM13 5h3v1h-3zM0 6h3v1h-3zM4 6h3v1h-3zM10 6h5v1h-5zM0 7h1v1h-1zM7 7h8v1h-8zM0 8h1v1h-1zM4 8h10v1h-10zM0 9h4v1h-4zM6 9h7v1h-7zM0 10h1v1h-1zM7 10h5v1h-5z'], // Saturn with a slightly tilted ring
  atom: [15, 15, 'M5 0h5v1h-5zM3 1h2v1h-2zM10 1h2v1h-2zM2 2h1v1h-1zM10 2h4v1h-4zM1 3h1v1h-1zM10 3h4v1h-4zM1 4h1v1h-1zM10 4h4v1h-4zM0 5h1v1h-1zM14 5h1v1h-1zM0 6h1v1h-1zM6 6h3v1h-3zM14 6h1v1h-1zM0 7h1v1h-1zM6 7h3v1h-3zM14 7h1v1h-1zM0 8h1v1h-1zM6 8h3v1h-3zM14 8h1v1h-1zM0 9h1v1h-1zM14 9h1v1h-1zM1 10h4v1h-4zM13 10h1v1h-1zM1 11h4v1h-4zM13 11h1v1h-1zM1 12h4v1h-4zM12 12h1v1h-1zM3 13h2v1h-2zM10 13h2v1h-2zM5 14h5v1h-5z'],
  telescope: [15, 13, 'M12 0h3v1h-3zM10 1h5v1h-5zM8 2h6v1h-6zM6 3h6v1h-6zM4 4h6v1h-6zM2 5h6v1h-6zM2 6h4v1h-4zM6 7h1v1h-1zM5 8h3v1h-3zM4 9h1v1h-1zM6 9h1v1h-1zM8 9h1v1h-1zM3 10h1v1h-1zM6 10h1v1h-1zM9 10h1v1h-1zM2 11h1v1h-1zM6 11h1v1h-1zM10 11h1v1h-1zM1 12h1v1h-1zM6 12h1v1h-1zM11 12h1v1h-1z'],
  star: [13, 13, 'M6 0h1v1h-1zM6 1h1v1h-1zM5 2h3v1h-3zM5 3h3v1h-3zM4 4h5v1h-5zM2 5h9v1h-9zM0 6h13v1h-13zM2 7h9v1h-9zM4 8h5v1h-5zM5 9h3v1h-3zM5 10h3v1h-3zM6 11h1v1h-1zM6 12h1v1h-1z'],
  crescent: [13, 13, 'M4 0h5v1h-5zM2 1h5v1h-5zM1 2h4v1h-4zM1 3h3v1h-3zM0 4h4v1h-4zM0 5h3v1h-3zM0 6h3v1h-3zM0 7h3v1h-3zM0 8h4v1h-4zM1 9h3v1h-3zM1 10h4v1h-4zM2 11h5v1h-5zM4 12h5v1h-5z'],
  sun: [13, 13, 'M6 0h1v1h-1zM1 1h1v1h-1zM6 1h1v1h-1zM11 1h1v1h-1zM2 2h1v1h-1zM10 2h1v1h-1zM5 3h3v1h-3zM4 4h5v1h-5zM3 5h7v1h-7zM0 6h2v1h-2zM3 6h7v1h-7zM11 6h2v1h-2zM3 7h7v1h-7zM4 8h5v1h-5zM5 9h3v1h-3zM2 10h1v1h-1zM10 10h1v1h-1zM1 11h1v1h-1zM6 11h1v1h-1zM11 11h1v1h-1zM6 12h1v1h-1z'],
  wave: [16, 5, 'M2 0h2v1h-2zM12 0h2v1h-2zM1 1h1v1h-1zM4 1h1v1h-1zM11 1h1v1h-1zM14 1h1v1h-1zM0 2h1v1h-1zM5 2h1v1h-1zM10 2h1v1h-1zM15 2h1v1h-1zM6 3h1v1h-1zM9 3h1v1h-1zM7 4h2v1h-2z'],
  spectrum: [15, 9, 'M0 0h1v9h-1zM2 0h2v9h-2zM5 0h1v9h-1zM9 0h3v9h-3zM13 0h1v9h-1z'],
  jupiter: [21, 9, 'M3 0h3v1h-3zM1 1h7v1h-7zM0 2h9v1h-9zM0 3h1v1h-1zM8 3h1v1h-1zM0 4h9v1h-9zM11 4h1v1h-1zM14 4h1v1h-1zM19 4h1v1h-1zM0 5h1v1h-1zM8 5h1v1h-1zM0 6h9v1h-9zM1 7h7v1h-7zM3 8h3v1h-3z'],
  warning: [13, 12, 'M6 0h1v1h-1zM5 1h3v1h-3zM5 2h1v1h-1zM7 2h1v1h-1zM4 3h1v1h-1zM8 3h1v1h-1zM4 4h1v1h-1zM6 4h1v1h-1zM8 4h1v1h-1zM3 5h1v1h-1zM6 5h1v1h-1zM9 5h1v1h-1zM3 6h1v1h-1zM6 6h1v1h-1zM9 6h1v1h-1zM2 7h1v1h-1zM6 7h1v1h-1zM10 7h1v1h-1zM2 8h1v1h-1zM10 8h1v1h-1zM1 9h1v1h-1zM6 9h1v1h-1zM11 9h1v1h-1zM1 10h1v1h-1zM11 10h1v1h-1zM0 11h13v1h-13z'],
  moonNew: [11, 11, 'M3 0h5v1h-5zM1 1h2v1h-2zM8 1h2v1h-2zM1 2h1v1h-1zM9 2h1v1h-1zM0 3h1v1h-1zM10 3h1v1h-1zM0 4h1v1h-1zM10 4h1v1h-1zM0 5h1v1h-1zM10 5h1v1h-1zM0 6h1v1h-1zM10 6h1v1h-1zM0 7h1v1h-1zM10 7h1v1h-1zM1 8h1v1h-1zM9 8h1v1h-1zM1 9h2v1h-2zM8 9h2v1h-2zM3 10h5v1h-5z'],
  moonHalf: [11, 11, 'M3 0h5v1h-5zM1 1h2v1h-2zM5 1h4v1h-4zM1 2h1v1h-1zM5 2h5v1h-5zM0 3h1v1h-1zM5 3h6v1h-6zM0 4h1v1h-1zM5 4h6v1h-6zM0 5h1v1h-1zM5 5h6v1h-6zM0 6h1v1h-1zM5 6h6v1h-6zM0 7h1v1h-1zM5 7h6v1h-6zM1 8h1v1h-1zM5 8h5v1h-5zM1 9h2v1h-2zM5 9h4v1h-4zM3 10h5v1h-5z'],
  moonFull: [11, 11, 'M3 0h5v1h-5zM1 1h9v1h-9zM1 2h9v1h-9zM0 3h11v1h-11zM0 4h11v1h-11zM0 5h11v1h-11zM0 6h11v1h-11zM0 7h11v1h-11zM1 8h9v1h-9zM1 9h9v1h-9zM3 10h5v1h-5z'],
  menu: [9, 7, 'M0 0h9v1h-9zM0 3h9v1h-9zM0 6h9v1h-9z'],
  plus: [7, 7, 'M3 0h1v7h-1zM0 3h7v1h-7z'],
};

/** Inline SVG for an icon. `scale` = screen pixels per grid square. */
export function icon(name, { scale = 2, label = '', flip = false, cls = '' } = {}) {
  const def = ICONS[name];
  if (!def) return '';
  const [w, h, d] = def;
  const a11y = label ? `role="img" aria-label="${label.replace(/"/g, '&quot;')}"` : 'aria-hidden="true"';
  return `<svg class="pxi${cls ? ` ${cls}` : ''}" viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}" shape-rendering="crispEdges" ${a11y}${
    flip ? ' style="transform:scaleX(-1)"' : ''
  }><path fill="currentColor" d="${d}"/></svg>`;
}

/** Status shown as a moon phase: planned = new, in progress = half, done = full. */
const STATUS_MOON = {
  planned: 'moonNew', 'to-read': 'moonNew', pending: 'moonNew',
  'in-progress': 'moonHalf', reading: 'moonHalf',
  done: 'moonFull', finished: 'moonFull', approved: 'moonFull',
  rejected: 'moonNew',
};
export const statusMoon = (status, opts = {}) => icon(STATUS_MOON[status] || 'moonNew', opts);

export const TRACK_ICON = { astro: 'planet', quantum: 'atom', both: 'star' };
