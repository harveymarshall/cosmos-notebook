// A learning path page: marks each step with the member's status, lights up finished stages
// and shows overall progress. Signed-out visitors just see the path.
import { pill } from '../ui.js';
import { icon } from '../lib/icons.js';
import { loadPathProgress, summarise } from '../path-progress.js';

const MOON = {
  complete: ['moonFull', 'Stage complete'],
  started: ['moonHalf', 'Stage in progress'],
  'not-started': ['moonNew', 'Stage not started'],
};

loadPathProgress()
  .then((data) => {
    if (!data) return;
    const root = document.querySelector('[data-path]');
    const path = data.paths.find((p) => p.id === root?.dataset.path);
    if (!path) return;

    document.querySelectorAll('.path-steps [data-item-id]').forEach((li) => {
      const p = data.byId[li.dataset.itemId];
      if (p) li.querySelector('span:last-child').insertAdjacentHTML('beforeend', ` ${pill(p.status)}`);
    });

    const sum = summarise(path, data.byId);
    for (const s of sum.stages) {
      const el = document.querySelector(`[data-phase="${CSS.escape(s.id)}"]`);
      if (!el) continue;
      const [name, label] = MOON[s.state];
      el.querySelector('.phase-moon').innerHTML = icon(name, { scale: 2, label });
      el.classList.toggle('complete', s.state === 'complete');
      el.classList.toggle('current', s === sum.next);
    }

    const out = document.getElementById('path-progress');
    out.hidden = false;
    out.innerHTML = sum.total
      ? sum.done === sum.total
        ? `<strong>Path complete.</strong> All ${sum.total} steps done.`
        : `<strong>${sum.done} of ${sum.total}</strong> steps done${sum.next ? ` · next: <a href="#" data-jump="${sum.next.id}">${sum.next.title}</a>` : ''}`
      : '';
    out.querySelector('[data-jump]')?.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelector(`[data-phase="${CSS.escape(e.target.dataset.jump)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  })
  .catch(() => {});
