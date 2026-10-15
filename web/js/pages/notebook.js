import { render, $, $$, esc, requireLogin, showError, pill, trackTag, params, busy, toast, icon, statusMoon, fmtDate } from '../ui.js';
import { get, put, loadLibrary } from '../api.js';

const session = requireLogin();
const TABS = [
  ['now', 'Now'],
  ['next', 'Next'],
  ['done', 'Done'],
  ['books', 'Books'],
  ['log', 'Log'],
];
let tab = TABS.some(([id]) => id === location.hash.slice(1)) ? location.hash.slice(1) : 'now';
let data;

const itemLink = (item) => `/notebook/item/?id=${encodeURIComponent(item.id)}`;

function entryRow(item, progress) {
  const status = progress?.status || (item.kind === 'book' ? 'to-read' : 'planned');
  const sub = item.kind === 'book'
    ? [item.author, progress?.completedAt && `finished ${fmtDate(progress.completedAt)}`].filter(Boolean).join(' · ')
    : [
        item.track === 'quantum' ? 'Quantum' : item.track === 'astro' ? 'Astro' : 'Astro + quantum',
        progress?.completedAt ? `done ${fmtDate(progress.completedAt)}` : progress?.startedAt ? `started ${fmtDate(progress.startedAt)}` : item.cost,
      ].filter(Boolean).join(' · ');
  return `<a class="fentry" href="${itemLink(item)}">
  ${statusMoon(status, { scale: 2, label: status.replace('-', ' ') })}
  <span class="main"><strong>${esc(item.title)}</strong><span class="sub">${esc(sub)}${
    item.community ? ' · member-added' : ''
  }</span></span>
  ${progress?.published ? '<span class="tag shared">Shared</span>' : ''}
  <span class="go" aria-hidden="true">→</span>
</a>`;
}

function profilePrompt() {
  return `<form id="name-form" class="callout-card form inline-form">
  <div><strong class="px">Pick a display name</strong><p class="muted small">It's shown next to anything you share with the community. You can change it later.</p></div>
  <label class="sr-only" for="dn">Display name</label>
  <input id="dn" name="displayName" required minlength="2" maxlength="40" placeholder="e.g. Sam from Leeds">
  <button class="btn primary">Save</button>
  <div class="form-error"></div>
</form>`;
}

function folder() {
  const { lists, observations } = data;
  const head = (label) => `<div class="fhead"><span>${label}</span><span class="fill dither" aria-hidden="true"></span></div>`;
  const rows = (items, empty) => (items.length ? items.map(([i, p]) => entryRow(i, p)).join('') : `<p class="fempty">${empty}</p>`);
  switch (tab) {
    case 'now':
      return head('In progress') + rows(lists.now, 'Nothing on the go. Open the <strong>Next</strong> tab and start something.');
    case 'next':
      return head('Up next, in plan order') + rows(lists.next, 'You’ve started every experiment — impressive!');
    case 'done':
      return head('Completed') + rows(lists.done, 'Your finished experiments will be filed here.');
    case 'books':
      return head('Reading list') + rows(lists.books, 'No books in the library yet.');
    case 'log':
      return (
        head('Night log') +
        (observations.length
          ? observations
              .slice(0, 6)
              .map(
                (o) => `<a class="fentry" href="/notebook/observations/#o-${esc(o.id)}">
  <span class="lcd" style="font-size:1.4rem;line-height:.95;min-width:48px;text-align:center">${esc(fmtDate(o.date).split(' ').slice(0, 2).join('<br>').toUpperCase())}</span>
  <span class="main"><strong>${esc(o.title)}</strong><span class="sub">${[o.target, o.equipment, o.conditions].filter(Boolean).map(esc).join(' · ')}</span></span>
  ${o.published ? '<span class="tag shared">Shared</span>' : ''}<span class="go" aria-hidden="true">→</span></a>`
              )
              .join('')
          : '<p class="fempty">No nights logged yet — check <a href="/tonight/">Tonight’s sky</a> and get out there.</p>') +
        `<div class="fbody" style="border-top:2px dashed var(--ink);display:flex;gap:14px;flex-wrap:wrap"><a class="btn primary" href="/notebook/observations/">+ Log a night</a>${
          observations.length > 6 ? `<a class="btn" href="/notebook/observations/">All ${observations.length} nights</a>` : ''
        }</div>`
      );
  }
  return '';
}

function drawFolder() {
  $('#folder').innerHTML = folder();
  $$('.ftab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
}

async function main() {
  const [{ profile, user }, { items: progressList }, library, { observations }] = await Promise.all([
    get('/me'),
    get('/me/progress'),
    loadLibrary(),
    get('/me/observations'),
  ]);
  const progress = Object.fromEntries(progressList.map((p) => [p.itemId, p]));
  const phaseIdx = (id) => {
    const i = library.phases.findIndex((p) => p.id === id);
    return i === -1 ? 99 : i;
  };
  const experiments = library.items.filter((i) => i.kind === 'experiment').sort((a, b) => phaseIdx(a.phase) - phaseIdx(b.phase));
  const books = library.items.filter((i) => i.kind === 'book');
  const st = (i) => progress[i.id]?.status;
  const pair = (i) => [i, progress[i.id]];
  const lists = {
    now: [...experiments.filter((e) => st(e) === 'in-progress'), ...books.filter((b) => st(b) === 'reading')].map(pair),
    next: experiments.filter((e) => !st(e) || st(e) === 'planned').map(pair),
    done: experiments.filter((e) => st(e) === 'done').map(pair),
    books: books.map(pair),
  };
  data = { lists, observations };

  const done = lists.done.length;
  const doing = experiments.filter((e) => st(e) === 'in-progress').length;
  const finishedBooks = books.filter((b) => st(b) === 'finished').length;
  const moons = experiments
    .map((e) => statusMoon(st(e) || 'planned', { scale: 2 }))
    .join('');
  const counts = { now: lists.now.length, next: lists.next.length, done, books: books.length, log: observations.length };

  render(`
<header class="page-head notebook-head">
  <div>
    <p class="eyebrow">My notebook</p>
    <h1>${profile?.displayName ? `Hello, ${esc(profile.displayName)}` : 'Welcome aboard'}</h1>
    <p class="muted small">${esc(session.email || '')} · <a href="/notebook/profile/">Profile &amp; settings</a>${
      user.isAdmin ? ' · <a href="/admin/">Review queue</a>' : ''
    }</p>
  </div>
  <div class="head-actions">
    <a class="btn" href="/tonight/">Tonight's sky</a>
    <a class="btn" href="/submit/">Suggest an addition</a>
  </div>
</header>
${params().get('welcome') ? `<div class="notice ok">Your account is ready. Open the <strong>Next</strong> tab and pick an experiment — <a href="/plan/">the plan</a> suggests an order.</div>` : ''}
${profile?.displayName ? '' : profilePrompt()}

<div class="stats">
  <div><strong>${done}<span>/${experiments.length}</span></strong><span>Experiments</span></div>
  <div><strong>${finishedBooks}<span>/${books.length}</span></strong><span>Books</span></div>
  <div><strong>${String(observations.length).padStart(2, '0')}</strong><span>Nights</span></div>
</div>
<div class="moonbar" role="img" aria-label="${done} experiments done, ${doing} in progress, ${experiments.length - done - doing} planned">${moons}<span class="lcd">${done}/${experiments.length}</span></div>

<section class="journal" aria-label="Notebook entries">
  <div class="ftabs" role="tablist" aria-label="Notebook sections">
    ${TABS.map(
      ([id, label]) =>
        `<button class="ftab" type="button" role="tab" data-tab="${id}" aria-selected="${id === tab}" aria-controls="folder"><span class="face row"><span class="t">${label}</span><span class="d">${counts[id]}</span></span></button>`
    ).join('')}
  </div>
  <div class="folder" id="folder" role="tabpanel"></div>
</section>
`);
  drawFolder();

  $$('.ftab').forEach((b) =>
    b.addEventListener('click', () => {
      tab = b.dataset.tab;
      history.replaceState(null, '', `#${tab}`);
      drawFolder();
    })
  );
  // Arrow keys move between tabs
  $('.ftabs').addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const ids = TABS.map(([id]) => id);
    tab = ids[(ids.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
    history.replaceState(null, '', `#${tab}`);
    drawFolder();
    $(`.ftab[data-tab="${tab}"]`).focus();
  });

  const form = $('#name-form');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(form, async () => {
      await put('/me/profile', { displayName: form.displayName.value });
      toast('Display name saved');
      main();
    }).catch(() => {});
  });
}

if (session) main().catch(showError);
