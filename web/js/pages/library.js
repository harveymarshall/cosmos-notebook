import { esc, trackTag, kindTag } from '../ui.js';
import { get } from '../api.js';

// Filter chips
const chips = [...document.querySelectorAll('.chip')];
chips.forEach((b) =>
  b.addEventListener('click', () => {
    chips.forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
    const [key, value] = b.dataset.f.split(':');
    document.querySelectorAll('[data-track]').forEach((el) => {
      el.hidden = key !== 'all' && el.dataset.track !== value && el.dataset.track !== 'both';
    });
  })
);

// Approved additions from members
get('/library')
  .then(({ items }) => {
    if (!items.length) return;
    document.getElementById('community-library').hidden = false;
    document.getElementById('community-items').innerHTML = items
      .map(
        (i) => `<article class="card lib-card" data-track="${esc(i.track || '')}">
  <div class="card-meta">${kindTag(i.kind)} ${trackTag(i.track)}</div>
  <h3><a href="/library/item/?id=${encodeURIComponent(i.id)}">${esc(i.title)}</a></h3>
  <p>${esc(i.summary || '')}</p>
  <div class="card-foot"><span>Suggested by ${esc(i.contributor || 'a member')}</span></div>
</article>`
      )
      .join('');
  })
  .catch(() => {});
