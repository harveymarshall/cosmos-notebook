import { render, $, $$, esc, showError, params, busy, toast, kindTag, pill, fmtDate, timeAgo, renderMarkdown } from '../ui.js';
import { get, post, del, loadLibrary } from '../api.js';
import { getSession, isAdmin } from '../auth.js';
import { likeButton, likedSet, wireLikes } from '../feed.js';

const id = params().get('id') || '';

async function main() {
  let data;
  try {
    data = await get(`/posts/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err.status === 404 || err.status === 400) {
      render(`<div class="notice">This write-up isn't available — it may have been made private. <a href="/community/">Back to the community</a></div>`);
      return;
    }
    throw err;
  }
  const p = data.post;
  const [{ comments }, liked, library] = await Promise.all([
    get(`/posts/${encodeURIComponent(id)}/comments`),
    likedSet([p]),
    loadLibrary(),
  ]);
  const session = getSession();
  const libItem = library.items.find((i) => i.id === p.itemId && p.kind !== 'observation');
  const meta = p.meta || {};
  const details =
    p.kind === 'observation'
      ? [meta.date && ['Date', fmtDate(meta.date)], meta.target && ['Target', meta.target], meta.equipment && ['Equipment', meta.equipment], meta.conditions && ['Conditions', meta.conditions]]
      : [meta.completedAt && ['Completed', fmtDate(meta.completedAt)]];
  document.title = `${p.title} · ${document.title.split(' · ').pop()}`;

  render(`
<article class="entry">
<header class="entry-head">
  <p class="eyebrow"><a href="/community/">Community</a></p>
  <h1>${esc(p.title)}</h1>
  <div class="card-meta">${kindTag(p.kind)} ${p.status ? pill(p.status) : ''}</div>
  <p class="muted">by <strong>${esc(p.authorName)}</strong> · ${timeAgo(p.publishedAt)}${p.updatedAt !== p.publishedAt ? ' · edited' : ''}</p>
  <dl class="facts">${details.filter(Boolean).map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
  ${libItem ? `<p class="small">Following the library guide: <a href="${esc(libItem.url)}">${esc(libItem.title)}</a></p>` : ''}
  <div class="post-actions big">${likeButton(p, liked.has(p.postId))}
  ${session?.sub === p.authorSub ? `<a class="btn small" href="${p.kind === 'observation' ? '/notebook/observations/' : `/notebook/item/?id=${encodeURIComponent(p.itemId)}`}">Edit</a>` : ''}
  ${isAdmin() ? '<button class="btn small danger ghost" id="remove-post">Remove post (admin)</button>' : ''}</div>
</header>
<div class="prose" id="body"></div>
</article>

<section class="comments" id="comments">
  <h2 class="section-title">${comments.length} ${comments.length === 1 ? 'comment' : 'comments'}</h2>
  ${comments
    .map(
      (c) => `<div class="comment">
      <div class="comment-head"><strong>${esc(c.authorName)}</strong><span class="muted small">${timeAgo(c.createdAt)}</span>
      ${session && (session.sub === c.authorSub || session.sub === p.authorSub || isAdmin()) ? `<button class="link-btn small" data-del="${esc(c.commentId)}">Delete</button>` : ''}</div>
      <div class="comment-body">${esc(c.body).replace(/\n/g, '<br>')}</div></div>`
    )
    .join('')}
  ${
    session
      ? `<form id="cf" class="form comment-form">
          <label for="cbody" class="sr-only">Add a comment</label>
          <textarea id="cbody" name="body" rows="3" maxlength="2000" required placeholder="Ask a question, share a tip, say well done…"></textarea>
          <div class="form-error"></div>
          <button class="btn primary">Post comment</button></form>`
      : `<p><a class="btn" href="/login/?next=${encodeURIComponent(location.pathname + location.search)}">Log in to comment</a></p>`
  }
</section>`);

  renderMarkdown(p.body, $('#body'), { graphs: true });

  const cf = $('#cf');
  cf?.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(cf, async () => {
      await post(`/posts/${encodeURIComponent(id)}/comments`, { body: cf.body.value });
      toast('Comment posted');
      await main();
      $('#comments').scrollIntoView();
    }).catch((err) => {
      if (err.status === 409) $('.form-error', cf).innerHTML += '<p class="small"><a href="/notebook/profile/">Set your display name</a></p>';
    });
  });

  $$('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Delete this comment?')) return;
      try {
        await del(`/posts/${encodeURIComponent(id)}/comments/${encodeURIComponent(b.dataset.del)}`);
        toast('Comment deleted');
        main();
      } catch (err) {
        toast(err.message, 'error');
      }
    })
  );

  $('#remove-post')?.addEventListener('click', async () => {
    if (!confirm('Remove this post from the community for everyone? The author keeps their private notes.')) return;
    try {
      await del(`/admin/posts/${encodeURIComponent(id)}`);
      location.href = '/community/';
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

wireLikes(document.getElementById('app'));
main().catch(showError);
