import { render, $, esc, requireLogin, showError, busy, toast, markdownEditor, wireMarkdownEditors, pill, kindTag, fmtDate } from '../ui.js';
import { get, post } from '../api.js';

const session = requireLogin();

const GUIDE_TEMPLATE = `## The question

## Learn just enough first

- [ ] 

## Kit

- [ ] 

## Method

1. 

> **Safety:** 

## Data

| Trial | Measurement | Notes |
| ----: | ----------: | ----- |
| 1 | | |

## Result

## Explain it to a friend
`;

async function main() {
  const [{ profile }, { submissions }] = await Promise.all([get('/me'), get('/me/submissions')]);
  if (!profile?.displayName) {
    render(`<div class="notice">Choose a display name first — it's shown as the contributor. <a href="/notebook/profile/">Set it on your profile →</a></div>`);
    return;
  }

  render(`
<form id="f" class="form card-form">
  <fieldset class="status-picker">
    <legend>What are you suggesting?</legend>
    <label class="seg"><input type="radio" name="type" value="experiment" checked><span>Experiment</span></label>
    <label class="seg"><input type="radio" name="type" value="book"><span>Book</span></label>
    <label class="seg"><input type="radio" name="type" value="resource"><span>Video, site or tool</span></label>
  </fieldset>
  <label>Title<input name="title" required minlength="3" maxlength="120"></label>
  <label>One-line summary<input name="summary" required minlength="10" maxlength="300" placeholder="What it is and why it's great for learning"></label>
  <fieldset class="status-picker">
    <legend>Topic</legend>
    <label class="seg"><input type="radio" name="track" value="astro" checked><span>Astrophysics</span></label>
    <label class="seg"><input type="radio" name="track" value="quantum"><span>Quantum</span></label>
    <label class="seg"><input type="radio" name="track" value="both"><span>Both</span></label>
  </fieldset>
  <label>Link <span class="muted">(optional for experiments)</span><input name="link" type="url" maxlength="500" placeholder="https://"></label>
  <div id="guide">
    ${markdownEditor({ name: 'body', label: 'The guide', rows: 14, value: GUIDE_TEMPLATE })}
    <p class="muted small">Include the kit, the method, safety notes and the maths. An admin may tidy it up before it goes live.</p>
  </div>
  <div class="form-error"></div>
  <div class="actions"><button class="btn primary">Send for review</button></div>
</form>

<section class="card-form">
  <h2>Your suggestions</h2>
  ${
    submissions.length
      ? `<ul class="list">${submissions
          .map(
            (s) => `<li class="lib-row"><div><strong>${esc(s.title)}</strong> ${kindTag(s.type)}
            <div class="muted small">Sent ${fmtDate(s.createdAt)}${s.reviewNote ? ` · Reviewer: “${esc(s.reviewNote)}”` : ''}</div></div>
            <div class="row-meta">${pill(s.status)}</div></li>`
          )
          .join('')}</ul>`
      : '<p class="muted">Nothing yet.</p>'
  }
</section>`);

  wireMarkdownEditors();
  const f = $('#f');
  const guideLabel = $('#guide .md-label');
  f.addEventListener('change', (e) => {
    if (e.target.name !== 'type') return;
    const exp = f.type.value === 'experiment';
    guideLabel.textContent = exp ? 'The guide' : 'Description (optional)';
    if (!exp && f.body.value === GUIDE_TEMPLATE) f.body.value = '';
    if (exp && !f.body.value.trim()) f.body.value = GUIDE_TEMPLATE;
  });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(f, async () => {
      const body = {
        type: f.type.value,
        title: f.title.value,
        summary: f.summary.value,
        track: f.track.value,
        link: f.link.value,
        body: f.body.value === GUIDE_TEMPLATE ? '' : f.body.value,
      };
      if (body.type === 'experiment' && !body.body.trim()) throw new Error('Please fill in the guide for your experiment.');
      await post('/submissions', body);
      toast('Thanks! Your suggestion is waiting for review.');
      main();
    }).catch(() => {});
  });
}

if (session) main().catch(showError);
