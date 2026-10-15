import { render, $, esc, requireLogin, showError, busy, toast, pill, fmtDate, kindTag } from '../ui.js';
import { get, put } from '../api.js';
import { logOut } from '../auth.js';

const session = requireLogin();

async function main() {
  const [{ profile, user }, { submissions }] = await Promise.all([get('/me'), get('/me/submissions')]);
  render(`
<p class="eyebrow"><a href="/notebook/">My notebook</a></p>
<h1>Profile &amp; settings</h1>

<form id="f" class="form card-form">
  <h2>Public profile</h2>
  <label>Display name<input name="displayName" required minlength="2" maxlength="40" value="${esc(profile?.displayName || '')}">
    <span class="muted small">Shown next to anything you share or comment on.</span></label>
  <label>About you <span class="muted">(optional)</span><textarea name="bio" rows="3" maxlength="300">${esc(profile?.bio || '')}</textarea></label>
  <div class="form-error"></div>
  <div class="actions"><button class="btn primary">Save profile</button></div>
</form>

<section class="card-form">
  <h2>Your suggestions to the library</h2>
  ${
    submissions.length
      ? `<ul class="list">${submissions
          .map(
            (s) => `<li class="lib-row"><div><strong>${esc(s.title)}</strong> ${kindTag(s.type)}
            <div class="muted small">Sent ${fmtDate(s.createdAt)}${s.reviewNote ? ` · Reviewer: “${esc(s.reviewNote)}”` : ''}</div></div>
            <div class="row-meta">${pill(s.status)}</div></li>`
          )
          .join('')}</ul>`
      : '<p class="muted">None yet. <a href="/submit/">Suggest an experiment, book or resource</a>.</p>'
  }
</section>

<section class="card-form">
  <h2>Account</h2>
  <p>Signed in as <strong>${esc(session.email || '')}</strong>${user.isAdmin ? ' · <span class="tag">Admin</span>' : ''}</p>
  <p class="muted small">Forgotten your password? Log out and use “Forgot your password?” on the log-in page.</p>
  <button class="btn" id="logout">Log out</button>
</section>`);

  const f = $('#f');
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(f, async () => {
      await put('/me/profile', { displayName: f.displayName.value, bio: f.bio.value });
      toast('Profile saved');
    }).catch(() => {});
  });
  $('#logout').addEventListener('click', async () => {
    await logOut();
    location.href = '/';
  });
}

if (session) main().catch(showError);
