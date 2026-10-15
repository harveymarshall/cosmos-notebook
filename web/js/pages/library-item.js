import { render, $, esc, showError, params, trackTag, kindTag, fmtDate, renderMarkdown } from '../ui.js';
import { loadLibrary } from '../api.js';
import { getSession } from '../auth.js';

async function main() {
  const id = params().get('id') || '';
  const { items } = await loadLibrary();
  const item = items.find((i) => i.id === id && i.community);
  if (!item) {
    render(`<div class="notice">That library item couldn't be found. <a href="/library/">Back to the library</a></div>`);
    return;
  }
  document.title = `${item.title} · ${document.title.split(' · ').pop()}`;
  const trackable = item.kind === 'experiment' || item.kind === 'book';
  render(`
<article class="entry">
<header class="entry-head">
  <p class="eyebrow"><a href="/library/">Library</a> · Added by a member</p>
  <h1>${esc(item.title)}</h1>
  <p class="lede">${esc(item.summary || '')}</p>
  <div class="card-meta">${kindTag(item.kind)} ${trackTag(item.track)}</div>
  <p class="muted small">Suggested by ${esc(item.contributor || 'a member')}${item.approvedAt ? ` · added ${fmtDate(item.approvedAt)}` : ''}</p>
  ${item.link ? `<p><a class="btn" href="${esc(item.link)}" rel="noopener nofollow ugc" target="_blank">Visit ${item.kind === 'book' ? 'book page' : 'link'} ↗</a></p>` : ''}
  ${
    trackable
      ? getSession()
        ? `<p><a class="btn primary" href="/notebook/item/?id=${encodeURIComponent(item.id)}">Track in my notebook</a></p>`
        : `<p class="muted small"><a href="/login/?mode=signup">Sign up</a> to track this in your own notebook.</p>`
      : ''
  }
</header>
<div class="prose" id="body"></div>
</article>`);
  if (item.body) renderMarkdown(item.body, $('#body'), { graphs: true });
}

main().catch(showError);
