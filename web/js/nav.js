// Shows "Log in" or the account menu in the header on every page.
import { getSession, authEnabled, isAdmin } from './auth.js';
import { wireThemeButton } from './theme.js';

wireThemeButton();

function update() {
  const slot = document.getElementById('account-slot');
  if (!slot) return;
  if (!authEnabled()) {
    slot.innerHTML = '';
    return;
  }
  const s = getSession();
  const here = location.pathname;
  if (!s) {
    slot.innerHTML = `<a class="btn small" href="/login/?next=${encodeURIComponent(here)}">Log in</a>`;
    return;
  }
  // The Admin link is only drawn for admins; the API refuses admin requests from anyone else.
  slot.innerHTML = `${isAdmin() ? `<a href="/admin/"${here.startsWith('/admin/') ? ' aria-current="page"' : ''}>Admin</a>` : ''}<a class="btn small primary" href="/notebook/"${
    here.startsWith('/notebook/') ? ' aria-current="page"' : ''
  }>My notebook</a>`;
}

update();
if (/^\/admin\/?$/.test(location.pathname) && authEnabled() && isAdmin()) {
  import('./admin-loader.js').then((m) => m.mountConsole()).catch(() => {});
}
window.addEventListener('cosmos:auth', update);
window.addEventListener('storage', (e) => e.key === 'cosmos.session' && update());
