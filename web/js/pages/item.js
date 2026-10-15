import {
  render, $, $$, esc, requireLogin, showError, params, busy, toast, trackTag, kindTag, icon,
  markdownEditor, wireMarkdownEditors, EXPERIMENT_STATUSES, BOOK_STATUSES, STATUS, WRITEUP_TEMPLATE, dateInputValue, today, fmtDate,
} from '../ui.js';
import { get, put, post, del, loadLibrary } from '../api.js';
import { liveGraphs, graphElement } from '../autograph.js';
import { combineTables, toCsv, parseDate } from '../lib/charts.js';

const session = requireLogin();
const id = params().get('id') || '';
const enc = encodeURIComponent;
let state = { item: null, progress: {}, entries: [], active: params().get('entry') || 'writeup', profile: null };

const ENTRY_TEMPLATE = `| Time | Measurement | Notes |
| ---- | ----------: | ----- |
| | | |
`;

const shortDate = (d) => fmtDate(d).split(' ').slice(0, 2).join(' ').toUpperCase();

function setActive(key) {
  state.active = key;
  const u = new URL(location.href);
  u.searchParams.set('entry', key);
  history.replaceState(null, '', u);
  draw();
}

function tabsHtml() {
  const { entries, active, item } = state;
  const isBook = item.kind === 'book';
  const tabs = [
    `<button class="ftab" type="button" role="tab" data-key="writeup" aria-selected="${active === 'writeup'}"><span class="face"><span class="t">${isBook ? 'Notes' : 'Write-up'}</span><span class="d">${isBook ? 'summary' : 'final'}</span></span></button>`,
    item.kind === 'experiment'
      ? `<button class="ftab" type="button" role="tab" data-key="data" aria-selected="${active === 'data'}"><span class="face"><span class="t">Data</span><span class="d">graphs</span></span></button>`
      : '',
    ...entries.map(
      (e, i) =>
        `<button class="ftab" type="button" role="tab" data-key="${esc(e.id)}" aria-selected="${active === e.id}" aria-label="Entry ${i + 1}, ${esc(fmtDate(e.date))}"><span class="face"><span class="t">#${i + 1}</span><span class="d">${esc(shortDate(e.date))}</span></span></button>`
    ),
    active === 'new'
      ? `<button class="ftab" type="button" role="tab" data-key="new" aria-selected="true"><span class="face"><span class="t">#${entries.length + 1}</span><span class="d">NEW</span></span></button>`
      : '',
    `<button class="ftab add" type="button" data-key="add" aria-label="Add a journal entry"><span class="face"><span class="t">${icon('plus', { scale: 2 })}</span></span></button>`,
  ];
  return `<div class="ftabs${entries.length > 3 ? ' scroll' : ''}" role="tablist" aria-label="Journal">${tabs.join('')}</div>`;
}

function writeupHtml() {
  const { item, progress: p, profile } = state;
  const statuses = item.kind === 'book' ? BOOK_STATUSES : EXPERIMENT_STATUSES;
  const status = p.status || statuses[0];
  return `<div class="fhead"><span>${item.kind === 'book' ? 'Reading notes' : 'Write-up · the version you can share'}</span><span class="fill dither" aria-hidden="true"></span></div>
<form id="wf" class="form fbody">
  <fieldset class="status-picker">
    <legend>Status</legend>
    ${statuses
      .map((s) => `<label class="seg"><input type="radio" name="status" value="${s}"${s === status ? ' checked' : ''}><span>${STATUS[s]}</span></label>`)
      .join('')}
  </fieldset>
  <div class="two-col">
    <label>Started<input type="date" name="startedAt" value="${dateInputValue(p.startedAt)}"></label>
    <label>${item.kind === 'book' ? 'Finished' : 'Completed'}<input type="date" name="completedAt" value="${dateInputValue(p.completedAt)}"></label>
  </div>
  ${markdownEditor({
    name: 'notes',
    value: p.notes || '',
    label: item.kind === 'book' ? 'Big ideas, in your own words' : 'Result & explanation',
    rows: 12,
    placeholder: item.kind === 'book' ? 'What clicked, what you want to remember…' : 'Pull your sessions together: your result, how close it was, what it means…',
  })}
  ${item.kind === 'experiment' && !p.notes ? '<button type="button" class="btn small ghost" id="template">Use the write-up template</button>' : ''}
  <div class="live-graphs" id="live"></div>
  <label class="check">
    <input type="checkbox" name="published"${p.published ? ' checked' : ''}>
    <span><strong>Share on the community feed</strong><br><span class="muted small">Only this write-up is shared — your journal entries stay private${
      profile?.displayName ? `. Shown as <strong>${esc(profile.displayName)}</strong>` : '. You’ll need a display name first — set one on your <a href="/notebook/profile/">profile</a>'
    }.</span></span>
  </label>
  <div class="form-error"></div>
  <div class="actions">
    <button class="btn primary">Save</button>
    ${p.postId ? `<a class="btn" href="/community/post/?id=${enc(p.postId)}">View shared post</a>` : ''}
    ${p.itemId ? '<button type="button" class="btn ghost danger" id="remove">Clear everything</button>' : ''}
  </div>
  <p class="muted small saved-at">${p.updatedAt ? `Last saved ${new Date(p.updatedAt).toLocaleString('en-GB')}` : 'Not saved yet'}</p>
</form>`;
}

function entryHtml() {
  const { entries, active } = state;
  const isNew = active === 'new';
  const e = isNew ? { date: today(), title: '', conditions: '', notes: '' } : entries.find((x) => x.id === active);
  if (!e) return '<p class="fempty">That entry was not found.</p>';
  const num = isNew ? entries.length + 1 : entries.indexOf(e) + 1;
  return `<div class="fhead"><span>Entry #${num}${isNew ? ' · new' : ''}</span><span class="fill dither" aria-hidden="true"></span><span class="lcd" style="font-size:1.1rem">${esc(shortDate(e.date))}</span></div>
<form id="ef" class="form fbody">
  <div class="two-col">
    <label>Date<input type="date" name="date" value="${esc(dateInputValue(e.date))}" required></label>
    <label>Title<input name="title" maxlength="120" value="${esc(e.title)}" placeholder="e.g. Tripod night"></label>
  </div>
  <label>Conditions &amp; kit <span class="muted">(optional)</span><input name="conditions" maxlength="120" value="${esc(e.conditions)}" placeholder="21:00–22:30 · binoculars on tripod · clear"></label>
  ${markdownEditor({ name: 'notes', value: e.notes || '', label: 'This session', rows: 10, placeholder: 'Measurements, what you saw, what went wrong, what to try next…' })}
  <button type="button" class="btn small ghost" id="add-table">Insert a data table</button>
  <div class="live-graphs" id="live" aria-label="Graphs of the tables in this entry"></div>
  <div class="form-error"></div>
  <div class="actions">
    <button class="btn primary">${isNew ? 'Save entry' : 'Save changes'}</button>
    ${isNew ? '<button type="button" class="btn ghost" id="cancel">Cancel</button>' : '<button type="button" class="btn ghost danger" id="del-entry">Delete entry</button>'}
  </div>
  ${!isNew && e.updatedAt ? `<p class="muted small saved-at">Last saved ${new Date(e.updatedAt).toLocaleString('en-GB')}</p>` : ''}
</form>`;
}

function dataHtml() {
  return `<div class="fhead"><span>All sessions · joined-up data</span><span class="fill dither" aria-hidden="true"></span></div><div class="fbody" id="data-mount"></div>`;
}

function fillData() {
  const mount = $('#data-mount');
  const groups = combineTables(state.entries);
  if (!groups.length) {
    mount.innerHTML = `<p style="margin-top:0">No measurements yet. Add a table to any journal entry and it’s graphed here, joined up with your other sessions.</p>
<pre class="muted small" style="border:2px dashed var(--ink);padding:12px;overflow-x:auto">| Time  | Moon     | Distance (J-widths) |
| ----- | -------- | ------------------: |
| 21:10 | Ganymede | 4.1                 |
| 21:12 | Callisto | -6.8                |</pre>
<p class="muted small">Tables with the same column names are joined across sessions. Times are placed on each entry's date, so several nights line up on one timeline. Use minus numbers for one side (e.g. west of Jupiter).</p>`;
    return;
  }
  mount.innerHTML = '';
  groups.forEach((g, gi) => {
    const sessions = new Set(g.rows.map((r) => r.entry.id)).size;
    const graph = graphElement(g, { title: `${g.rows.length} readings · ${sessions} session${sessions === 1 ? '' : 's'}` });
    if (graph) mount.append(graph);
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr><th scope="col">Session</th>${g.headers
      .map((h) => `<th scope="col">${esc(h)}</th>`)
      .join('')}</tr></thead><tbody>${g.rows
      .map((r) => `<tr><td>${esc(shortDate(r.entry.date))}</td>${r.cells.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
      .join('')}</tbody></table></div>
<div class="actions" style="margin:12px 0 ${gi < groups.length - 1 ? '28px' : '0'}"><button class="btn small" type="button" data-csv="${gi}">Download CSV</button></div>`;
    mount.append(wrap);
  });
  $$('[data-csv]', mount).forEach((b) =>
    b.addEventListener('click', () => {
      const blob = new Blob([toCsv(groups[Number(b.dataset.csv)])], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${id}-data.csv`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    })
  );
}

function draw() {
  const { item, entries } = state;
  $('#journal').innerHTML = `${tabsHtml()}<div class="folder" id="folder" role="tabpanel">${
    state.active === 'writeup' ? writeupHtml() : state.active === 'data' ? dataHtml() : entryHtml()
  }</div>`;
  if (state.active === 'data') fillData();
  $('#entry-count').textContent = `${entries.length} journal ${entries.length === 1 ? 'entry' : 'entries'}`;
  wireMarkdownEditors($('#folder'));
  $('.ftab[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });

  $$('.ftab').forEach((b) =>
    b.addEventListener('click', () => (b.dataset.key === 'add' ? setActive('new') : setActive(b.dataset.key)))
  );

  const wf = $('#wf');
  if (wf) liveGraphs(wf.notes, $('#live'));
  const efLive = $('#ef');
  if (efLive) liveGraphs(efLive.notes, $('#live'), { baseDate: parseDate(efLive.date.value) || new Date() });
  if (wf) {
    $('#template')?.addEventListener('click', (ev) => {
      wf.notes.value = WRITEUP_TEMPLATE;
      wf.notes.focus();
      ev.target.remove();
    });
    wf.addEventListener('change', (ev) => {
      if (ev.target.name !== 'status') return;
      const v = ev.target.value;
      if (['in-progress', 'reading', 'done', 'finished'].includes(v) && !wf.startedAt.value) wf.startedAt.value = today();
      if (['done', 'finished'].includes(v) && !wf.completedAt.value) wf.completedAt.value = today();
    });
    wf.addEventListener('submit', (ev) => {
      ev.preventDefault();
      busy(wf, async () => {
        const body = {
          kind: item.kind,
          title: item.title,
          status: wf.status.value,
          startedAt: wf.startedAt.value,
          completedAt: wf.completedAt.value,
          notes: wf.notes.value,
          published: wf.published.checked,
        };
        if (body.published && !body.notes.trim()) throw new Error('Write your result before sharing it with the community.');
        const res = await put(`/me/progress/${enc(id)}`, body);
        state.progress = res.item;
        toast(res.item.postId ? 'Saved and shared' : 'Saved');
        draw();
      }).catch(() => {});
    });
    $('#remove')?.addEventListener('click', async () => {
      if (!confirm('Clear your status, write-up and every journal entry for this item? Any shared post is removed too.')) return;
      try {
        await del(`/me/progress/${enc(id)}`);
        toast('Cleared');
        state = { ...state, progress: {}, entries: [], active: 'writeup' };
        draw();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  const ef = $('#ef');
  if (ef) {
    $('#add-table').addEventListener('click', () => {
      const ta = ef.notes;
      ta.value = `${ta.value.replace(/\s*$/, '')}${ta.value.trim() ? '\n\n' : ''}${ENTRY_TEMPLATE}`;
      ta.dispatchEvent(new Event('input'));
      ta.focus();
    });
    $('#cancel')?.addEventListener('click', () => setActive(state.entries.at(-1)?.id || 'writeup'));
    ef.addEventListener('submit', (ev) => {
      ev.preventDefault();
      busy(ef, async () => {
        const body = { date: ef.date.value, title: ef.title.value, conditions: ef.conditions.value, notes: ef.notes.value };
        if (state.active === 'new') {
          // Starting a journal also starts the item in your notebook
          if (!state.progress.itemId) {
            const res = await put(`/me/progress/${enc(id)}`, {
              kind: item.kind,
              title: item.title,
              status: item.kind === 'book' ? 'reading' : 'in-progress',
              startedAt: body.date || today(),
            });
            state.progress = res.item;
          }
          const { entry } = await post(`/me/progress/${enc(id)}/entries`, body);
          state.entries = (await get(`/me/progress/${enc(id)}/entries`)).entries;
          toast('Entry saved');
          setActive(entry.id);
        } else {
          const { entry } = await put(`/me/progress/${enc(id)}/entries/${enc(state.active)}`, body);
          state.entries = (await get(`/me/progress/${enc(id)}/entries`)).entries;
          toast('Saved');
          setActive(entry.id);
        }
      }).catch(() => {});
    });
    $('#del-entry')?.addEventListener('click', async () => {
      if (!confirm('Delete this journal entry?')) return;
      try {
        await del(`/me/progress/${enc(id)}/entries/${enc(state.active)}`);
        state.entries = state.entries.filter((e) => e.id !== state.active);
        toast('Entry deleted');
        setActive(state.entries.at(-1)?.id || 'writeup');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }
}

async function main() {
  const [library, { items }, { profile }, { entries }] = await Promise.all([
    loadLibrary(),
    get('/me/progress'),
    get('/me'),
    get(`/me/progress/${enc(id)}/entries`).catch(() => ({ entries: [] })),
  ]);
  const item = library.items.find((i) => i.id === id);
  if (!item || !['experiment', 'book'].includes(item.kind)) {
    render(`<div class="notice">That library item couldn't be found. <a href="/notebook/">Back to your notebook</a></div>`);
    return;
  }
  state = { ...state, item, progress: items.find((x) => x.itemId === id) || {}, entries, profile };
  if (!['writeup', 'new', 'data'].includes(state.active) && !entries.some((e) => e.id === state.active)) state.active = 'writeup';
  if (state.active === 'data' && item.kind !== 'experiment') state.active = 'writeup';
  document.title = `${item.title} · ${document.title.split(' · ').pop()}`;

  render(`
<p class="eyebrow"><a href="/notebook/">My notebook</a> · ${item.kind === 'book' ? 'Book' : 'Experiment'}</p>
<div class="item-head">
  <div class="item-icon">${icon(item.icon || (item.kind === 'book' ? 'star' : 'planet'), { scale: 3 })}</div>
  <div style="display:flex;flex-direction:column;gap:8px;min-width:0">
    <h1 style="margin:0">${esc(item.title)}</h1>
    <div class="card-meta">${trackTag(item.track)} ${kindTag(item.kind)} ${item.community ? '<span class="tag">Member-added</span>' : ''}<span class="muted small" id="entry-count"></span></div>
  </div>
</div>
<p class="lede">${esc(item.summary || '')} <a class="small" href="${esc(item.url)}">${item.kind === 'book' ? 'About this book' : 'Open the full guide'} →</a></p>
<section class="journal" id="journal" aria-label="Journal"></section>
<p class="muted small journal-note">Add a new tab for each session with <strong>+</strong>, so no single page gets too long. When you’re finished, pull it together in the ${
    item.kind === 'book' ? 'Notes' : 'Write-up'
  } tab.</p>`);
  draw();
}

if (session) main().catch(showError);
