// ---------- router ----------
const session = requireLogin();

function route() {
  ensureStyles();
  const hash = location.hash.replace(/^#/, '');
  const [page] = hash.split('?');
  const member = page.match(/^members\/([0-9a-f-]{36})$/i);
  // Old links used ?status=… for the review queue
  if (!page && params().get('status')) {
    location.hash = 'suggestions?status=' + encodeURIComponent(params().get('status'));
    return;
  }
  if (member) return renderMember(member[1]);
  if (page === 'members') return renderMembers();
  if (page === 'suggestions') return renderSuggestions();
  return renderDashboard();
}

if (session) {
  window.addEventListener('hashchange', () => route().catch(showError));
  route().catch(showError);
}
