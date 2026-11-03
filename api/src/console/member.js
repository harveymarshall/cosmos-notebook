// ---------- one member ----------
async function renderMember(sub) {
  const data = await get(`/admin/members/${encodeURIComponent(sub)}`);
  const { member: m, counts, posts, comments, history, viewerIsOwner } = data;
  const locked = m.isOwner || m.isSelf;
  const action = (key, label, cls = '') => `<button class="btn ${cls}" data-act="${key}">${label}</button>`;
  render(`
<p><a href="#members">← All members</a></p>
<header class="page-head"><h1>${esc(m.displayName || m.email)} ${badges(m)}</h1>
<p class="lede small">${esc(m.email)} · joined ${esc(fmtDate(m.createdAt))} · last active ${esc(when(m.lastSeenAt))}</p></header>
<div class="adm-tiles">
  <div class="adm-tile"><strong>${counts.experimentsDone}</strong><span>Experiments done</span></div>
  <div class="adm-tile"><strong>${counts.observations}</strong><span>Observations</span></div>
  <div class="adm-tile"><strong>${counts.posts}</strong><span>Posts</span></div>
  <div class="adm-tile"><strong>${counts.comments}</strong><span>Comments</span></div>
  <div class="adm-tile"><strong>${counts.likes}</strong><span>Likes</span></div>
</div>
${m.bio ? `<p>${esc(m.bio)}</p>` : ''}
<div class="adm-actions">
  ${locked ? `<span class="muted small">${m.isOwner ? 'Owner account: protected' : 'This is you'}</span>` : m.suspended ? action('unsuspend', 'Unsuspend', 'primary') : action('suspend', 'Suspend')}
  ${action('reset-password', 'Send password reset')}
  ${viewerIsOwner && !m.isOwner ? (m.isAdmin ? action('revoke-admin', 'Remove admin') : action('grant-admin', 'Make admin')) : ''}
  ${locked ? '' : `<span class="danger-zone">${action('delete', 'Delete account', 'danger ghost')}</span>`}
</div>
<div id="confirm"></div>
<h2>Posts</h2>
${posts.length ? `<ul class="adm-list">${posts.map((p) => `<li><div>${kindTag(p.kind)} <a href="/community/post/?id=${encodeURIComponent(p.postId)}">${esc(p.title)}</a> <span class="muted small">${esc(fmtDate(p.publishedAt))}</span></div><button class="btn small danger ghost" data-post="${esc(p.postId)}">Remove</button></li>`).join('')}</ul>` : '<p class="muted">No posts.</p>'}
<h2>Comments</h2>
${comments.length ? `<ul class="adm-list">${comments.map((c) => `<li><div>${esc(c.body)} <span class="muted small">on <a href="/community/post/?id=${encodeURIComponent(c.postId)}">a post</a> · ${esc(timeAgo(c.createdAt))}${c.hidden ? ' · hidden' : ''}</span></div><button class="btn small danger ghost" data-comment="${esc(c.postId)}|${esc(c.commentId)}">Remove</button></li>`).join('')}</ul>` : '<p class="muted">No comments.</p>'}
<h2>History</h2>
${history.length ? `<ul class="adm-list">${history.map(auditLine).join('')}</ul>` : '<p class="muted">No admin actions yet.</p>'}`);

  const slot = $('#confirm');
  const run = async (form, fn, done) => {
    await busy(form, fn);
    toast(done);
    renderMember(sub).catch(showError);
  };
  const ACTIONS = {
    suspend: { title: 'Suspend this member?', text: "They're signed out and can't sign in. Their posts leave the feed and their comments are hidden until you unsuspend them.", button: 'Suspend', path: 'suspend', done: 'Suspended' },
    unsuspend: { title: 'Unsuspend this member?', text: 'They can sign in again and their posts and comments come back.', button: 'Unsuspend', path: 'unsuspend', done: 'Unsuspended' },
    'reset-password': { title: 'Send a password reset?', text: "Cognito emails them a code. Their current password stops working until they choose a new one.", button: 'Send reset', path: 'reset-password', done: 'Reset code sent' },
    'grant-admin': { title: 'Make this member an admin?', text: 'They can see this console and manage members (except you). It takes effect next time they sign in.', button: 'Make admin', path: 'admin', grant: true, done: 'Now an admin' },
    'revoke-admin': { title: 'Remove admin rights?', text: 'Takes effect next time they sign in.', button: 'Remove admin', path: 'admin', grant: false, done: 'Admin removed' },
  };
  $$('[data-act]').forEach((b) =>
    b.addEventListener('click', async () => {
      const key = b.dataset.act;
      if (key === 'delete') {
        const ok = await confirmPanel(slot, {
          title: 'Delete this account for good?',
          text: 'This removes their login, notebook, observations, posts, comments, likes and pending suggestions. Approved suggestions stay in the library without their name. It cannot be undone.',
          button: 'Delete everything',
          danger: true,
          typeToConfirm: m.email,
        });
        if (!ok) return;
        await busy(ok.form, () => api('DELETE', `/admin/members/${encodeURIComponent(sub)}`, { confirmEmail: ok.confirmEmail, reason: ok.reason })).catch(() => null).then((r) => {
          if (!r) return;
          toast('Account deleted');
          location.hash = 'members';
        });
        return;
      }
      const a = ACTIONS[key];
      const ok = await confirmPanel(slot, { title: a.title, text: a.text, button: a.button, danger: key === 'suspend' });
      if (!ok) return;
      await run(ok.form, async () => {
        const r = await post(`/admin/members/${encodeURIComponent(sub)}/${a.path}`, { reason: ok.reason, ...(a.grant !== undefined ? { grant: a.grant } : {}) });
        if (r.partial) throw new Error('Partly done: sign-in is blocked but hiding their content failed. Press Suspend again to retry.');
      }, a.done).catch(() => {});
    })
  );
  $$('[data-post]').forEach((b) =>
    b.addEventListener('click', async () => {
      const ok = await confirmPanel(slot, { title: 'Remove this post?', text: 'It disappears from the community feed with its likes and comments.', button: 'Remove post', danger: true });
      if (ok) await run(ok.form, () => api('DELETE', `/admin/posts/${encodeURIComponent(b.dataset.post)}`), 'Post removed').catch(() => {});
    })
  );
  $$('[data-comment]').forEach((b) =>
    b.addEventListener('click', async () => {
      const [postId, commentId] = b.dataset.comment.split('|');
      const ok = await confirmPanel(slot, { title: 'Remove this comment?', text: 'It is deleted for good.', button: 'Remove comment', danger: true });
      if (ok) await run(ok.form, () => api('DELETE', `/admin/comments/${encodeURIComponent(postId)}/${encodeURIComponent(commentId)}`, { reason: ok.reason }), 'Comment removed').catch(() => {});
    })
  );
}
