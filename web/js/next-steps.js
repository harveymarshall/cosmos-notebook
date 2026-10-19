// The "Next step" card: for each path a member follows, the one thing to do next.
// Used on My notebook (with a nudge to pick a path) and the home page (only if they follow one).
import { esc } from './ui.js';
import { loadPathProgress, summarise, STEP_VERB } from './path-progress.js';

const itemLink = (id) => `/notebook/item/?id=${encodeURIComponent(id)}`;

function row(path, sum) {
  const head = `<div class="ns-path"><a href="/paths/${esc(path.id)}/">${esc(path.title)}</a><span class="lcd">${sum.done}/${sum.total}</span></div>`;
  if (!sum.nextStep) return `<div class="ns-row">${head}<p class="ns-step">Path complete — every step done. <a href="/paths/">Pick another →</a></p></div>`;
  const st = sum.nextStep;
  const doing = st.status === 'in-progress' || st.status === 'reading';
  return `<div class="ns-row">${head}<p class="ns-step"><span class="step-kind">${doing ? 'Carry on' : STEP_VERB[st.kind]}</span><a href="${itemLink(st.id)}">${esc(st.title)}</a><span class="muted small"> · ${esc(st.stage)}</span></p></div>`;
}

/** Fills `el` with the card. `nudge` shows a prompt to pick a path when the member follows none. */
export async function renderNextSteps(el, { nudge = false } = {}) {
  if (!el) return;
  const data = await loadPathProgress();
  if (!data) return;
  const followed = data.paths.filter((p) => data.enrolments[p.id]);
  if (!followed.length) {
    if (nudge) {
      el.innerHTML = `<div class="callout-card next-nudge"><div><strong class="px">Pick a learning path</strong><p class="muted small">Follow a guided route through the library and your next step will appear here.</p></div><a class="btn" href="/paths/">Browse paths →</a></div>`;
      el.hidden = false;
    }
    return;
  }
  el.innerHTML = `<section class="win next-steps" aria-label="Your next steps"><div class="win-bar"><span>Next step</span><span class="fill dither" aria-hidden="true"></span></div><div class="win-body">${followed
    .map((p) => row(p, summarise(p, data.byId, data.enrolments[p.id])))
    .join('')}</div></section>`;
  el.hidden = false;
}
