import { render, $, $$, esc, requireLogin, showError, busy, toast, markdownEditor, wireMarkdownEditors, fmtDate, today, renderMarkdown } from '../ui.js';
import { get, post, put, del } from '../api.js';

const session = requireLogin();
let observations = [];
let editing = null;

const form = (o = {}) => `<form id="f" class="form editor card-form">
  <h2>${o.id ? 'Edit night' : 'Log a night'}</h2>
  <label>Title<input name="title" required maxlength="120" value="${esc(o.title || '')}" placeholder="First look at Jupiter's moons"></label>
  <div class="two-col">
    <label>Date<input type="date" name="date" value="${esc(o.date || today())}"></label>
    <label>Time<input name="time" maxlength="40" value="${esc(o.time || '')}" placeholder="21:00–22:30"></label>
  </div>
  <div class="two-col">
    <label>Target<input name="target" maxlength="120" value="${esc(o.target || '')}" placeholder="Jupiter"></label>
    <label>Equipment<input name="equipment" maxlength="120" value="${esc(o.equipment || '')}" placeholder="10x50 binoculars"></label>
  </div>
  <div class="two-col">
    <label>Location<input name="location" maxlength="120" value="${esc(o.location || '')}" placeholder="Back garden"></label>
    <label>Conditions<input name="conditions" maxlength="120" value="${esc(o.conditions || '')}" placeholder="Clear, slight haze"></label>
  </div>
  ${markdownEditor({ name: 'notes', value: o.notes || '', label: 'What you saw', rows: 8, placeholder: 'Positions, sketches, surprises…' })}
  <label class="check"><input type="checkbox" name="published"${o.published ? ' checked' : ''}>
    <span><strong>Share on the community feed</strong><br><span class="muted small">Your location isn't shared — only the title, date, target, equipment, conditions and notes.</span></span></label>
  <div class="form-error"></div>
  <div class="actions"><button class="btn primary">${o.id ? 'Save changes' : 'Add to log'}</button>${o.id ? '<button type="button" class="btn ghost" id="cancel">Cancel</button>' : ''}</div>
</form>`;

const entry = (o) => `<article class="obs-entry" id="o-${esc(o.id)}">
  <header><time>${fmtDate(o.date)}</time><h3>${esc(o.title)}</h3>
  ${o.published ? `<a class="tag shared" href="/community/post/?id=${encodeURIComponent(o.postId)}">Shared</a>` : ''}</header>
  <p class="muted small">${[o.time, o.target, o.equipment, o.location, o.conditions].filter(Boolean).map(esc).join(' · ')}</p>
  <div class="prose small-prose" data-notes="${esc(o.id)}"></div>
  <div class="actions"><button class="btn small" data-edit="${esc(o.id)}">Edit</button><button class="btn small ghost danger" data-delete="${esc(o.id)}">Delete</button></div>
</article>`;

function draw() {
  render(`
<p class="eyebrow"><a href="/notebook/">My notebook</a></p>
<h1>Observing log</h1>
<p class="lede">Every clear night out: what you looked at, with what, and what you actually saw.</p>
${form(editing || {})}
<section><h2 class="section-title">${observations.length} ${observations.length === 1 ? 'night' : 'nights'} logged</h2>
${observations.length ? observations.map(entry).join('') : '<p class="muted">Nothing yet — the first clear night is the best one.</p>'}
</section>`);
  wireMarkdownEditors();
  for (const o of observations) {
    const el = $(`[data-notes="${CSS.escape(o.id)}"]`);
    if (el && o.notes) renderMarkdown(o.notes, el, { graphs: true });
  }

  const f = $('#f');
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(f, async () => {
      const body = Object.fromEntries(['title', 'date', 'time', 'target', 'equipment', 'location', 'conditions', 'notes'].map((k) => [k, f[k].value]));
      body.published = f.published.checked;
      if (body.published && !body.notes.trim()) throw new Error('Add some notes before sharing.');
      if (editing) await put(`/me/observations/${encodeURIComponent(editing.id)}`, body);
      else await post('/me/observations', body);
      toast(editing ? 'Saved' : 'Added to your log');
      editing = null;
      await load();
    }).catch(() => {});
  });
  $('#cancel')?.addEventListener('click', () => {
    editing = null;
    draw();
  });
  $$('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => {
      editing = observations.find((o) => o.id === b.dataset.edit);
      draw();
      $('#f').scrollIntoView({ behavior: 'smooth' });
    })
  );
  $$('[data-delete]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Delete this night from your log? If it was shared, the post goes too.')) return;
      try {
        await del(`/me/observations/${encodeURIComponent(b.dataset.delete)}`);
        toast('Deleted');
        await load();
      } catch (err) {
        toast(err.message, 'error');
      }
    })
  );
}

async function load() {
  ({ observations } = await get('/me/observations'));
  draw();
}

if (session) load().catch(showError);
