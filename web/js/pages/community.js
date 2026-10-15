import { render, $, showError } from '../ui.js';
import { get } from '../api.js';
import { postCard, likedSet, wireLikes } from '../feed.js';

let cursor = null;
const posts = [];

async function loadMore() {
  const res = await get(`/feed?limit=12${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
  cursor = res.cursor;
  const liked = await likedSet(res.posts);
  posts.push(...res.posts.map((p) => ({ p, liked: liked.has(p.postId) })));

  render(
    posts.length
      ? `<div class="grid" id="posts">${posts.map(({ p, liked }) => postCard(p, liked)).join('')}</div>
         ${cursor ? '<p class="center"><button class="btn" id="more">Load more</button></p>' : ''}`
      : `<div class="empty-state"><p><strong>No write-ups yet.</strong></p>
         <p class="muted">Finish an experiment, tick “Share on the community feed”, and yours will be the first. <a href="/notebook/">Go to My notebook →</a></p></div>`
  );
  $('#more')?.addEventListener('click', (e) => {
    e.target.disabled = true;
    loadMore().catch(showError);
  });
}

wireLikes(document.getElementById('app'));
loadMore().catch(showError);
