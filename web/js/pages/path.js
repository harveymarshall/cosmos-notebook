// A learning path page. Signed-in members can follow the path, see their status on every
// step (from their notebook), skip steps they already know, and see the next step.
import { esc, pill, toast } from '../ui.js';
import { put, del } from '../api.js';
import { icon } from '../lib/icons.js';
import { loadPathProgress, summarise, isDone } from '../path-progress.js';

const MOON = {
  complete: ['moonFull', 'Stage complete'],
  started: ['moonHalf', 'Stage in progress'],
  'not-started': ['moonNew', 'Stage not started'],
};
const root = document.querySelector('[data-path]');
const pathId = root?.dataset.path;
const actions = document.getElementById('path-actions');
const out = document.getElementById('path-progress');
let data;
let path;

function drawActions(enrolment) {
  if (!enrolment) {
    actions.innerHTML = `<button class="btn primary" type="button" data-act="follow">Follow this path</button>
      <span class="muted small">Your next step will show on My notebook.</span>`;
    return;
  }
  actions.innerHTML = `<span class="tag inv">Following</span>
    <span class="muted small">since ${new Date(enrolment.enrolledAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
    <button class="linkish" type="button" data-act="leave">Leave path</button>`;
}

function drawSteps(enrolment) {
  const skipped = enrolment?.skipped || {};
  document.querySelectorAll('.path-steps [data-item-id]').forEach((li) => {
    const id = li.dataset.itemId;
    const status = data.byId[id]?.status;
    const text = li.querySelector('span:last-child');
    text.querySelectorAll('.pill, .step-extra').forEach((n) => n.remove());
    if (status) text.insertAdjacentHTML('beforeend', ` ${pill(status)}`);
    if (!enrolment || li.dataset.optional || isDone(status)) return;
    if (skipped[id]) {
      text.insertAdjacentHTML(
        'beforeend',
        ` <span class="step-extra"><span class="tag ghost">Skipped</span>${skipped[id].note ? ` <span class="muted small">${esc(skipped[id].note)}</span>` : ''} <button class="linkish small" type="button" data-unskip="${esc(id)}">Undo</button></span>`
      );
    } else {
      text.insertAdjacentHTML('beforeend', ` <span class="step-extra"><button class="linkish small" type="button" data-skip="${esc(id)}">I already know this</button></span>`);
    }
  });
}

function draw() {
  const enrolment = data.enrolments[pathId];
  drawActions(enrolment);
  drawSteps(enrolment);
  const sum = summarise(path, data.byId, enrolment);
  for (const s of sum.stages) {
    const el = document.querySelector(`[data-phase="${CSS.escape(s.id)}"]`);
    if (!el) continue;
    const [name, label] = MOON[s.state];
    el.querySelector('.phase-moon').innerHTML = icon(name, { scale: 2, label });
    el.classList.toggle('complete', s.state === 'complete');
    el.classList.toggle('current', Boolean(enrolment || sum.started) && s === sum.next);
  }
  if (!enrolment && !sum.started) {
    out.hidden = true;
    return;
  }
  out.hidden = false;
  out.innerHTML =
    sum.done === sum.total
      ? `<strong>Path complete.</strong> All ${sum.total} steps done.`
      : `<strong>${sum.done} of ${sum.total}</strong> steps done${
          sum.nextStep ? ` · next: <a href="/notebook/item/?id=${encodeURIComponent(sum.nextStep.id)}">${esc(sum.nextStep.title)}</a>` : ''
        }`;
}

async function act(fn, okMessage) {
  try {
    const { enrolment } = await fn();
    if (enrolment) data.enrolments[pathId] = enrolment;
    else delete data.enrolments[pathId];
    draw();
    if (okMessage) toast(okMessage);
  } catch (err) {
    toast(err.message || 'Something went wrong', 'error');
  }
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t || !data) return;
  if (t.dataset.act === 'follow') act(() => put(`/me/paths/${pathId}`, {}), 'Following — your next step is on My notebook');
  else if (t.dataset.act === 'leave') {
    // Two clicks rather than a browser dialog
    if (t.dataset.sure) act(() => del(`/me/paths/${pathId}`).then(() => ({})), 'Left the path. Your notebook progress is kept.');
    else {
      t.dataset.sure = '1';
      t.textContent = 'Click again to leave';
      setTimeout(() => {
        delete t.dataset.sure;
        t.textContent = 'Leave path';
      }, 4000);
    }
  } else if (t.dataset.skip) {
    const id = t.dataset.skip;
    t.parentElement.innerHTML = `<form class="skip-form" data-for="${esc(id)}"><label class="sr-only" for="skip-${esc(id)}">Optional note</label>
      <input id="skip-${esc(id)}" name="note" maxlength="300" placeholder="Optional note, e.g. did it at school">
      <button class="btn small">Skip</button><button class="linkish small" type="button" data-cancel>Cancel</button></form>`;
    document.getElementById(`skip-${id}`).focus();
  } else if (t.dataset.cancel !== undefined) draw();
  else if (t.dataset.unskip) act(() => del(`/me/paths/${pathId}/skips/${t.dataset.unskip}`));
});

document.addEventListener('submit', (e) => {
  const f = e.target.closest('.skip-form');
  if (!f) return;
  e.preventDefault();
  act(() => put(`/me/paths/${pathId}/skips/${f.dataset.for}`, { note: f.note.value }), 'Step skipped');
});

loadPathProgress()
  .then((d) => {
    if (!d) return; // signed out: the page keeps its "Follow this path" sign-up link
    data = d;
    path = d.paths.find((p) => p.id === pathId);
    if (path) draw();
  })
  .catch(() => {});
