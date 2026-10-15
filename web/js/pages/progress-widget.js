// The "Your progress" box on each experiment and book page.
import { esc, pill } from '../ui.js';
import { get, put } from '../api.js';
import { getSession, authEnabled } from '../auth.js';

const box = document.getElementById('progress-widget');

async function draw() {
  if (!box || !authEnabled()) return box && (box.hidden = true);
  const { itemId, kind, title } = box.dataset;
  const editUrl = `/notebook/item/?id=${encodeURIComponent(itemId)}`;
  if (!getSession()) {
    box.innerHTML = `<p class="small"><strong>Track this ${kind}.</strong> <a href="/login/?mode=signup&next=${encodeURIComponent(editUrl)}">Sign up free</a> or <a href="/login/?next=${encodeURIComponent(location.pathname)}">log in</a> to keep your data and notes in your own notebook.</p>`;
    return;
  }
  try {
    const { items } = await get('/me/progress');
    const p = items.find((x) => x.itemId === itemId);
    if (p) {
      box.innerHTML = `<p class="small">Your progress: ${pill(p.status)} <a class="btn small" href="${editUrl}">Open in my notebook</a></p>`;
    } else {
      box.innerHTML = `<p class="small">Not in your notebook yet. <button class="btn small primary" id="start">${kind === 'book' ? 'Start reading' : 'Start this experiment'}</button></p>`;
      document.getElementById('start').addEventListener('click', async (e) => {
        e.target.disabled = true;
        await put(`/me/progress/${encodeURIComponent(itemId)}`, {
          kind,
          title,
          status: kind === 'book' ? 'reading' : 'in-progress',
          startedAt: new Date().toISOString().slice(0, 10),
        });
        location.href = editUrl;
      });
    }
  } catch (err) {
    box.innerHTML = `<p class="small muted">${esc(err.message)}</p>`;
  }
}

draw();
