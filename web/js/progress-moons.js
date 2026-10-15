// Fills in the phase moons on the plan and home road map from the member's own progress.
import { get } from './api.js';
import { getSession } from './auth.js';
import { icon } from './lib/icons.js';

export async function fillPhaseMoons() {
  if (!getSession()) return null;
  const [{ items }, lib] = await Promise.all([get('/me/progress'), fetch('/library.json').then((r) => r.json())]);
  const byId = Object.fromEntries(items.map((p) => [p.itemId, p]));
  const doneish = (s) => s === 'done' || s === 'finished';
  for (const phase of lib.phases) {
    const inPhase = lib.items.filter((i) => i.phase === phase.id && (i.kind === 'experiment' || i.kind === 'book'));
    if (!inPhase.length) continue;
    const done = inPhase.filter((i) => doneish(byId[i.id]?.status)).length;
    const started = inPhase.some((i) => byId[i.id] && byId[i.id].status !== 'planned' && byId[i.id].status !== 'to-read');
    const name = done === inPhase.length ? 'moonFull' : started || done ? 'moonHalf' : 'moonNew';
    const label = done === inPhase.length ? 'Phase complete' : started || done ? 'Phase in progress' : 'Phase not started';
    document.querySelectorAll(`[data-phase="${phase.id}"]`).forEach((el) => {
      const slot = el.querySelector('.phase-moon') || el.querySelector(':scope > .pxi')?.parentElement;
      const old = el.querySelector('.phase-moon .pxi') || el.querySelector(':scope > .pxi');
      if (old) old.outerHTML = icon(name, { scale: 2, label });
      if (slot && done === inPhase.length) el.classList.add('complete');
    });
  }
  return byId;
}
