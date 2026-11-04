// ---------- shared: styles, tabs, badges, confirm panel ----------
const CONSOLE_CSS = `
.adm-tabs { display: flex; gap: 8px; flex-wrap: wrap; margin: 0 0 18px; }
.adm-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 0 0 22px; }
.adm-tile { border: 2px solid var(--ink); background: var(--panel); box-shadow: 4px 4px 0 var(--ink); padding: 12px 14px; }
.adm-tile strong { display: block; font-family: var(--lcd); font-weight: 400; font-size: 2rem; line-height: 1; }
.adm-tile span { font-family: var(--display); text-transform: uppercase; font-size: .68rem; letter-spacing: .06em; color: var(--ink2); }
.adm-badge { display: inline-block; font-family: var(--display); font-size: .68rem; text-transform: uppercase; letter-spacing: .06em; border: 2px solid var(--ink); padding: 1px 6px; margin-left: 4px; }
.adm-badge.warn { background: var(--ink); color: var(--paper); }
.adm-actions { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0 20px; }
.adm-actions .danger-zone { margin-left: auto; }
.adm-confirm { border: 2px solid var(--ink); background: var(--panel); box-shadow: 4px 4px 0 var(--ink); padding: 14px; margin: 0 0 20px; }
.adm-list { list-style: none; padding: 0; margin: 0 0 20px; }
.adm-list li { border-bottom: 1px solid var(--grid, #ddd); padding: 8px 0; display: flex; gap: 10px; align-items: baseline; justify-content: space-between; }
.adm-list li > div { min-width: 0; overflow-wrap: anywhere; }
.adm-search { display: flex; gap: 8px; margin: 0 0 14px; }
.adm-search input { flex: 1; }
@media (max-width: 600px) {
  .adm-table thead { display: none; }
  .adm-table tr { display: block; border: 2px solid var(--ink); margin: 0 0 10px; }
  .adm-table td { display: block; border: 0; white-space: normal; }
  .adm-actions .danger-zone { margin-left: 0; }
}`;

function ensureStyles() {
  if (document.getElementById('adm-css')) return;
  const style = document.createElement('style');
  style.id = 'adm-css';
  style.textContent = CONSOLE_CSS;
  document.head.append(style);
}

const TABS_NAV = [
  ['dashboard', 'Dashboard'],
  ['members', 'Members'],
  ['suggestions', 'Suggestions'],
];
const tabs = (current) =>
  `<nav class="adm-tabs">${TABS_NAV.map(([k, label]) => `<a class="chip" aria-pressed="${k === current}" href="#${k}">${label}</a>`).join('')}</nav>`;

const badges = (m) =>
  [m.isOwner && '<span class="adm-badge">Owner</span>', m.isAdmin && !m.isOwner && '<span class="adm-badge">Admin</span>', m.suspended && '<span class="adm-badge warn">Suspended</span>']
    .filter(Boolean)
    .join('');

const when = (iso) => (iso ? timeAgo(iso) : '—');

const ACTION_LABELS = {
  suspend: 'Suspended',
  unsuspend: 'Unsuspended',
  'reset-password': 'Sent a password reset to',
  'grant-admin': 'Made admin',
  'revoke-admin': 'Removed admin from',
  delete: 'Deleted',
  'remove-comment': 'Removed a comment by',
  reindex: 'Rebuilt the member index',
};
const auditLine = (a) =>
  `<li><div>${esc(ACTION_LABELS[a.action] || a.action)} ${a.targetSub ? `<a href="#members/${esc(a.targetSub)}"><code>${esc(a.targetSub.slice(0, 8))}</code></a>` : ''}${
    a.reason ? ` — <em>${esc(a.reason)}</em>` : ''
  }${a.detail?.partial ? ' <span class="adm-badge warn">partly done</span>' : ''}</div><span class="muted small">${esc(timeAgo(a.at))}</span></li>`;

/** In-page confirmation (the site can't use confirm()). Resolves with { reason, confirmEmail } or null. */
function confirmPanel(slot, { title, text, button, danger = false, typeToConfirm }) {
  return new Promise((resolve) => {
    slot.innerHTML = `<form class="adm-confirm form" novalidate>
      <h3>${esc(title)}</h3>
      <p>${esc(text)}</p>
      ${typeToConfirm ? `<label>Type <strong>${esc(typeToConfirm)}</strong> to confirm<input name="confirmEmail" autocomplete="off" required></label>` : ''}
      <label>Reason <span class="muted">(optional, kept in the log)</span><input name="reason" maxlength="300"></label>
      <div class="form-error"></div>
      <div class="actions"><button class="btn ${danger ? 'danger' : 'primary'}">${esc(button)}</button> <button type="button" class="btn ghost" data-cancel>Cancel</button></div>
    </form>`;
    const form = $('form', slot);
    $('[data-cancel]', form).addEventListener('click', () => {
      slot.innerHTML = '';
      resolve(null);
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (typeToConfirm && form.confirmEmail.value.trim().toLowerCase() !== typeToConfirm.toLowerCase()) {
        $('.form-error', form).textContent = "That doesn't match.";
        return;
      }
      resolve({ form, reason: form.reason.value, confirmEmail: form.confirmEmail?.value.trim() });
    });
  });
}
