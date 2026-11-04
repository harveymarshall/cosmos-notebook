// ---------- members list ----------
async function renderMembers() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '').get('q') || '';
  render(`
<header class="page-head"><h1>Members</h1></header>
${tabs('members')}
<form class="adm-search" id="search"><input name="q" type="search" placeholder="Search by email (start of address)" value="${esc(q)}"><button class="btn">Search</button></form>
<div class="table-wrap"><table class="adm-table"><thead><tr><th>Email</th><th>Name</th><th>Joined</th><th>Last active</th><th>Status</th></tr></thead><tbody id="rows"></tbody></table></div>
<p id="more"></p>`);
  $('#search').addEventListener('submit', (e) => {
    e.preventDefault();
    location.hash = `members?q=${encodeURIComponent(e.target.q.value.trim())}`;
  });
  let cursor = null;
  const load = async () => {
    const { members, cursor: next } = await get(`/admin/members?q=${encodeURIComponent(q)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    $('#rows').insertAdjacentHTML(
      'beforeend',
      members
        .map(
          (m) => `<tr><td><a href="#members/${esc(m.sub)}">${esc(m.email)}</a></td><td>${esc(m.displayName || '—')}</td><td>${esc(fmtDate(m.createdAt))}</td><td>${esc(when(m.lastSeenAt))}</td><td>${
            badges(m) || 'Active'
          }</td></tr>`
        )
        .join('')
    );
    if (!members.length && !cursor) $('#rows').innerHTML = '<tr><td colspan="5" class="muted">No members found.</td></tr>';
    cursor = next;
    $('#more').innerHTML = cursor ? '<button class="btn" id="load-more">Load more</button>' : '';
    if (cursor) $('#load-more').addEventListener('click', () => load().catch(showError));
  };
  await load();
}
