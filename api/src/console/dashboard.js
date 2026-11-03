// ---------- dashboard ----------
async function renderDashboard() {
  const [stats, { entries }] = await Promise.all([get('/admin/stats'), get('/admin/audit?limit=50')]);
  const tile = (n, label) => `<div class="adm-tile"><strong>${esc(String(n))}</strong><span>${esc(label)}</span></div>`;
  render(`
<header class="page-head"><h1>Admin</h1></header>
${tabs('dashboard')}
<div class="adm-tiles">
  ${tile(stats.members, 'Members')}
  ${tile(stats.newLast7Days, 'New this week')}
  ${tile(stats.newLast30Days, 'New this month')}
  ${tile(stats.activeLast7Days, 'Active 7 days')}
  ${tile(stats.activeLast30Days, 'Active 30 days')}
  ${tile(stats.posts, 'Posts')}
  ${tile(stats.comments, 'Comments')}
  ${tile(stats.pendingSuggestions, 'Suggestions waiting')}
</div>
<h2>Recent activity</h2>
${entries.length ? `<ul class="adm-list">${entries.map(auditLine).join('')}</ul>` : '<p class="muted">No admin actions yet.</p>'}
<h2>Maintenance</h2>
<form id="reindex" class="form">
  <p class="small">Run <strong>Rebuild member index</strong> once after this update, so posts, comments and likes written before it show up on member pages. Safe to run again.</p>
  <div class="form-error"></div>
  <button class="btn">Rebuild member index</button>
</form>`);
  $('#reindex').addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.target, async () => {
      const r = await post('/admin/maintenance/reindex', {});
      toast(`Indexed ${r.posts} posts, ${r.comments} comments, ${r.likes} likes`);
      renderDashboard();
    }).catch(() => {});
  });
}
