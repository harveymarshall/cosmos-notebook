// The admin console. This file is NOT part of the public website: the API sends it only
// to signed-in members of the Cognito "admins" group (GET /api/admin/console), and
// web/js/admin-loader.js runs it. Imports use site-absolute paths; the loader turns
// them into full URLs.
import { render, $, $$, esc, requireLogin, showError, busy, toast, kindTag, fmtDate, renderMarkdown, params } from '/js/ui.js';
import { get, post } from '/js/api.js';

const session = requireLogin();
const TABS = [
  ['pending', 'Waiting'],
  ['approved', 'Approved'],
  ['rejected', 'Not accepted'],
];

const card = (s, status) => `<article class="review card-form" data-id="${esc(s.id)}">
  <div class="card-meta">${kindTag(s.type)} <span class="muted small">from <strong>${esc(s.authorName)}</strong> · ${fmtDate(s.createdAt)}</span></div>
  <form class="form">
    <label>Title<input name="title" value="${esc(s.title)}" maxlength="120" required></label>
    <label>Summary<input name="summary" value="${esc(s.summary)}" maxlength="300" required></label>
    <div class="two-col">
      <label>Topic<select name="track">${['astro', 'quantum', 'both']
        .map((t) => `<option value="${t}"${s.track === t ? ' selected' : ''}>${t}</option>`)
        .join('')}</select></label>
      <label>Link<input name="link" value="${esc(s.link || '')}" maxlength="500"></label>
    </div>
    ${s.link ? `<p class="small">Check the link before approving: <a href="${esc(s.link)}" rel="noopener nofollow ugc" target="_blank">${esc(s.link)}</a></p>` : ''}
    <details${s.body ? ' open' : ''}><summary>Guide / description</summary>
      <textarea name="body" rows="10" maxlength="20000">${esc(s.body || '')}</textarea>
      <div class="prose preview" data-preview></div>
    </details>
    <label>Note to the member <span class="muted">(optional)</span><input name="note" maxlength="300" value="${esc(s.reviewNote || '')}"></label>
    <div class="form-error"></div>
    <div class="actions">
      ${status !== 'approved' ? '<button class="btn primary" data-decision="approve">Approve and publish</button>' : '<button class="btn" data-decision="approve">Save changes</button>'}
      ${status !== 'rejected' ? `<button class="btn danger ghost" data-decision="reject">${status === 'approved' ? 'Remove from library' : 'Reject'}</button>` : ''}
    </div>
  </form>
</article>`;

async function main() {
  const status = params().get('status') || 'pending';
  const { submissions } = await get(`/admin/submissions?status=${status}`);
  render(`
<header class="page-head"><h1>Review queue</h1><p class="lede">Check each suggestion is safe, accurate and useful before it joins the library. You can edit before approving.</p></header>
<nav class="filters">${TABS.map(([k, label]) => `<a class="chip" aria-pressed="${k === status}" href="?status=${k}">${label}</a>`).join('')}</nav>
${submissions.length ? submissions.map((s) => card(s, status)).join('') : `<p class="muted">Nothing here${status === 'pending' ? ' — the queue is clear' : ''}.</p>`}`);

  $$('[data-preview]').forEach((pv) => {
    const ta = pv.previousElementSibling;
    const update = () => renderMarkdown(ta.value, pv);
    ta.addEventListener('input', update);
    update();
  });

  $$('.review').forEach((art) => {
    const form = $('form', art);
    let decision = 'approve';
    $$('[data-decision]', form).forEach((b) => b.addEventListener('click', () => (decision = b.dataset.decision)));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      busy(form, async () => {
        await post(`/admin/submissions/${encodeURIComponent(art.dataset.id)}/review`, {
          decision,
          note: form.note.value,
          edits: { title: form.title.value, summary: form.summary.value, track: form.track.value, link: form.link.value, body: form.body.value },
        });
        toast(decision === 'approve' ? 'Published to the library' : 'Marked as not accepted');
        main();
      }).catch(() => {});
    });
  });
}

if (session) main().catch(showError);
