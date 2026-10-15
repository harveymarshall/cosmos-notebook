// Community post cards and like buttons, shared by the home page, feed and post pages.
import { esc, excerpt, timeAgo, kindTag, pill, toast, icon } from './ui.js';
import { getSession, authEnabled } from './auth.js';
import { get, post, del } from './api.js';

export const postUrl = (p) => `/community/post/?id=${encodeURIComponent(p.postId)}`;

export const likeButton = (p, liked) =>
  `<button class="like${liked ? ' on' : ''}" data-like="${esc(p.postId)}" aria-pressed="${liked ? 'true' : 'false'}" aria-label="${
    liked ? 'Unlike' : 'Like'
  } (${p.likeCount || 0})">${icon('star', { scale: 1 })}<span class="n">${p.likeCount || 0}</span></button>`;

export function postCard(p, liked = false) {
  const meta = p.meta || {};
  const sub =
    p.kind === 'observation'
      ? [meta.target, meta.equipment].filter(Boolean).map(esc).join(' · ')
      : p.status
        ? pill(p.status)
        : '';
  return `<article class="card post-card">
  <div class="card-meta">${kindTag(p.kind)} ${sub}</div>
  <h3><a href="${postUrl(p)}">${esc(p.title)}</a></h3>
  <p>${esc(excerpt(p.body))}</p>
  <div class="card-foot post-foot">
    <span class="by">${esc(p.authorName || 'A member')} · ${timeAgo(p.publishedAt)}</span>
    <span class="post-actions">${likeButton(p, liked)}<a class="comments-link" href="${postUrl(p)}#comments">[ ${p.commentCount || 0} comments ]</a></span>
  </div>
</article>`;
}

/** Which of these posts has the current member liked? */
export async function likedSet(posts) {
  if (!getSession() || !posts.length) return new Set();
  try {
    const { liked } = await get(`/me/likes?postIds=${posts.map((p) => encodeURIComponent(p.postId)).join(',')}`);
    return new Set(liked);
  } catch {
    return new Set();
  }
}

/** One click handler for every like button inside `root`. */
export function wireLikes(root) {
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-like]');
    if (!btn) return;
    e.preventDefault();
    if (!authEnabled() || !getSession()) {
      location.href = `/login/?next=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    }
    const on = btn.getAttribute('aria-pressed') === 'true';
    btn.disabled = true;
    try {
      const id = encodeURIComponent(btn.dataset.like);
      const res = on ? await del(`/posts/${id}/like`) : await post(`/posts/${id}/like`);
      btn.outerHTML = likeButton(res.post, res.liked);
    } catch (err) {
      btn.disabled = false;
      toast(err.message, 'error');
    }
  });
}
