// Marks each item on the plan with the member's own status, and fills in the phase moons.
import { pill } from '../ui.js';
import { fillPhaseMoons } from '../progress-moons.js';

fillPhaseMoons()
  .then((byId) => {
    if (!byId) return;
    document.querySelectorAll('[data-item-id]').forEach((li) => {
      const p = byId[li.dataset.itemId];
      if (p) li.insertAdjacentHTML('beforeend', ` ${pill(p.status)}`);
    });
  })
  .catch(() => {});
