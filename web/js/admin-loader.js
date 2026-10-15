// Mounts the admin console for members of the "admins" group. The console's code is
// not on the public site: it is fetched from the API, which only sends it to admins.
// Everyone else just sees the normal "page not found".
import { get } from './api.js';

export async function mountConsole() {
  let code;
  try {
    ({ code } = await get('/admin/console'));
  } catch {
    return; // not an admin (or signed out): leave the 404 page as it is
  }
  const main = document.getElementById('main');
  if (!main) return;
  document.title = 'Admin · Cosmos Notebook';
  main.classList.add('wide');
  main.innerHTML = '<div id="app" class="app" aria-live="polite"><p class="muted loading">Loading…</p></div>';
  // Site-absolute imports ('/js/ui.js') need full URLs inside a blob: module.
  const src = code.replace(/from '\/js\//g, `from '${location.origin}/js/`);
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  try {
    await import(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
