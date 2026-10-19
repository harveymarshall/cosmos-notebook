// The list of learning paths: shows a signed-in member how far along each one they are.
import { loadPathProgress, summarise } from '../path-progress.js';

loadPathProgress()
  .then((data) => {
    if (!data) return;
    document.querySelectorAll('.path-card[data-path]').forEach((card) => {
      const path = data.paths.find((p) => p.id === card.dataset.path);
      if (!path) return;
      const sum = summarise(path, data.byId);
      if (!sum.started) return;
      const out = card.querySelector('.path-progress');
      out.hidden = false;
      out.innerHTML =
        sum.done === sum.total
          ? '<strong>Complete</strong>'
          : `<strong>${sum.done}/${sum.total}</strong> steps done${sum.next ? ` · next: ${sum.next.title}` : ''}`;
    });
  })
  .catch(() => {});
