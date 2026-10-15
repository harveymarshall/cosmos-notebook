import { esc } from '../ui.js';
import { get } from '../api.js';
import { getSession } from '../auth.js';
import { postCard, likedSet, wireLikes } from '../feed.js';
import { fillPhaseMoons } from '../progress-moons.js';

fillPhaseMoons().catch(() => {});

// Logged-in members get a shortcut to their notebook instead of the sign-up button
if (getSession()) {
  const actions = document.getElementById('hero-actions');
  if (actions) actions.innerHTML = `<a class="btn primary" href="/notebook/">Open my notebook</a><a class="btn" href="/tonight/">Tonight's sky</a>`;
}

const box = document.getElementById('home-feed');
wireLikes(box);
get('/feed?limit=3')
  .then(async ({ posts }) => {
    const liked = await likedSet(posts);
    box.innerHTML = posts.length
      ? posts.map((p) => postCard(p, liked.has(p.postId))).join('')
      : `<p class="muted">No write-ups yet — finish an experiment and share yours to be the first.</p>`;
  })
  .catch(() => {
    box.innerHTML = `<p class="muted">The community feed isn't available right now.</p>`;
  });
