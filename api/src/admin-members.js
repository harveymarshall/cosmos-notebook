// api/src/admin-members.js
// Admin console routes for managing members: stats, the member list and page, suspend,
// delete, password reset, admin rights, removing comments, and the audit log.
// Every route is registered with { auth: true, admin: true }: the dispatcher in app.js
// answers 404 to anyone who isn't an admin before the handler runs.
import { HttpError, LIMITS, POST_ID, SUB, COMMENT_ID, str, param } from './validate.js';

const DAY = 24 * 3600 * 1000;

export function registerAdminMembers({ route, store, members, ownerSub, now, makeId, log }) {
  const admin = { auth: true, admin: true };
  const subOf = (params) => param(params.sub, SUB, 'member');
  const reasonOf = (body) => str(body, 'reason', { max: LIMITS.summary });

  async function findMember(sub) {
    const m = await members.find(sub);
    if (!m) throw new HttpError(404, 'Member not found');
    return m;
  }
  /** The owner can't be suspended, deleted or demoted; nobody can do those to themselves. */
  function protect(user, member) {
    if (ownerSub && member.sub === ownerSub) throw new HttpError(403, "The owner account can't be changed here");
    if (member.sub === user.sub) throw new HttpError(403, "You can't do that to your own account");
  }
  const audit = (user, action, targetSub, { reason = '', detail = {} } = {}) =>
    store.putAudit({ id: makeId(), at: now(), actorSub: user.sub, action, targetSub, reason, detail });
  const publicMember = ({ username, ...m }) => m;

  route('GET', '/api/admin/stats', admin, async () => {
    const time = Date.parse(now());
    const since = (days) => new Date(time - days * DAY).toISOString();
    const [all, accounts, posts, pending] = await Promise.all([
      members.listAll(),
      store.listAccounts(),
      store.listAllPosts(),
      store.listSubmissionsByStatus('pending'),
    ]);
    return {
      members: all.length,
      newLast7Days: all.filter((m) => m.createdAt >= since(7)).length,
      newLast30Days: all.filter((m) => m.createdAt >= since(30)).length,
      activeLast7Days: accounts.filter((a) => a.lastSeenAt >= since(7)).length,
      activeLast30Days: accounts.filter((a) => a.lastSeenAt >= since(30)).length,
      posts: posts.length,
      comments: posts.reduce((n, p) => n + (Number(p.commentCount) || 0), 0),
      pendingSuggestions: pending.length,
    };
  });

  route('GET', '/api/admin/audit', admin, async ({ query }) => {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 200);
    return { entries: await store.listAudit({ limit }) };
  });

  route('GET', '/api/admin/members', admin, async ({ query }) => {
    const q = str(query, 'q', { max: 100 }).toLowerCase();
    const page = await members.list({ q, cursor: query.cursor });
    const subs = page.members.map((m) => m.sub);
    const [profiles, accounts, admins] = await Promise.all([store.getProfiles(subs), store.getAccounts(subs), members.adminSubs()]);
    return {
      members: page.members
        .map((m) => ({
          ...publicMember(m),
          displayName: profiles[m.sub]?.displayName || '',
          lastSeenAt: accounts[m.sub]?.lastSeenAt || null,
          suspended: !!accounts[m.sub]?.suspended || !m.enabled,
          isAdmin: admins.has(m.sub),
          isOwner: m.sub === ownerSub,
        }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      cursor: page.cursor,
    };
  });

  route('GET', '/api/admin/members/:sub', admin, async ({ user, params }) => {
    const m = await findMember(subOf(params));
    const [profile, account, progress, observations, posts, comments, likes, admins, history] = await Promise.all([
      store.getProfile(m.sub),
      store.getAccount(m.sub),
      store.listProgress(m.sub),
      store.listObservations(m.sub),
      store.memberPosts(m.sub),
      store.memberComments(m.sub),
      store.memberLikes(m.sub),
      members.adminSubs(),
      store.listAudit({ targetSub: m.sub }),
    ]);
    return {
      member: {
        ...publicMember(m),
        displayName: profile?.displayName || '',
        bio: profile?.bio || '',
        lastSeenAt: account?.lastSeenAt || null,
        suspended: !!account?.suspended || !m.enabled,
        isAdmin: admins.has(m.sub),
        isOwner: m.sub === ownerSub,
        isSelf: m.sub === user.sub,
      },
      viewerIsOwner: user.sub === ownerSub,
      counts: {
        experimentsDone: progress.filter((p) => p.kind === 'experiment' && p.status === 'done').length,
        observations: observations.length,
        posts: posts.length,
        comments: comments.length,
        likes: likes.length,
      },
      posts,
      comments,
      history,
    };
  });

  route('DELETE', '/api/admin/comments/:postId/:commentId', admin, async ({ user, params, body }) => {
    const postId = param(params.postId, POST_ID, 'postId');
    const commentId = param(params.commentId, COMMENT_ID, 'commentId');
    const comment = await store.getComment(postId, commentId);
    if (!comment) throw new HttpError(404, 'Comment not found');
    if (!(await store.deleteComment(postId, commentId))) throw new HttpError(404, 'Comment not found');
    await audit(user, 'remove-comment', comment.authorSub, { reason: reasonOf(body), detail: { postId, commentId } });
    return { deleted: true };
  });

  // Task 6 adds the action routes below this line, using findMember, protect and audit.
  registerActions({ route, admin, store, members, ownerSub, now, log, subOf, reasonOf, findMember, protect, audit });
}

function registerActions({ route, admin, store, members, ownerSub, now, log, subOf, reasonOf, findMember, protect, audit }) {
  route('POST', '/api/admin/members/:sub/suspend', admin, async ({ user, params, body }) => {
    const m = await findMember(subOf(params));
    protect(user, m);
    if (!(await store.isReindexed())) throw new HttpError(409, 'Run "Rebuild member index" on the Dashboard first');
    const reason = reasonOf(body);
    let step = 'mark-suspended';
    try {
      await members.disable(m.username);
      await members.signOut(m.username);
      await store.setSuspended(m.sub, true, now());
      step = 'hide-content';
      const hidden = await store.setMemberHidden(m.sub, true);
      await audit(user, 'suspend', m.sub, { reason, detail: hidden });
      return { suspended: true, hidden };
    } catch (err) {
      log.error?.(err);
      await audit(user, 'suspend', m.sub, { reason, detail: { partial: step } });
      return { partial: true, step };
    }
  });

  route('POST', '/api/admin/members/:sub/unsuspend', admin, async ({ user, params, body }) => {
    const m = await findMember(subOf(params));
    protect(user, m);
    const reason = reasonOf(body);
    await members.enable(m.username);
    await store.setSuspended(m.sub, false, now());
    try {
      const shown = await store.setMemberHidden(m.sub, false);
      await audit(user, 'unsuspend', m.sub, { reason, detail: shown });
      return { suspended: false, shown };
    } catch (err) {
      log.error?.(err);
      await audit(user, 'unsuspend', m.sub, { reason, detail: { partial: 'show-content' } });
      return { partial: true, step: 'show-content' };
    }
  });

  route('POST', '/api/admin/members/:sub/reset-password', admin, async ({ user, params, body }) => {
    const m = await findMember(subOf(params));
    if (ownerSub && m.sub === ownerSub && user.sub !== ownerSub) throw new HttpError(403, "The owner account can't be changed here");
    await members.resetPassword(m.username);
    await audit(user, 'reset-password', m.sub, { reason: reasonOf(body) });
    return { reset: true };
  });

  route('POST', '/api/admin/members/:sub/admin', admin, async ({ user, params, body }) => {
    const m = await findMember(subOf(params));
    if (ownerSub && m.sub === ownerSub) throw new HttpError(403, "The owner account can't be changed here");
    if (!ownerSub || user.sub !== ownerSub) throw new HttpError(403, 'Only the owner can change admins');
    const grant = body?.grant === true;
    if (grant) {
      await members.addAdmin(m.username);
    } else {
      await members.removeAdmin(m.username);
      await members.signOut(m.username); // the admin claim dies with their sessions
    }
    await audit(user, grant ? 'grant-admin' : 'revoke-admin', m.sub, { reason: reasonOf(body) });
    return { isAdmin: grant, note: grant ? 'Takes effect the next time they sign in' : 'They have been signed out' };
  });

  // Each step is safe to repeat and the login goes last, so a failed delete can be re-run.
  // A failure part-way is audited with the step reached, and reported as a 500 (502 for a
  // Cognito failure) carrying { step, removed } so the caller knows what to re-run.
  // Sign-out/disable goes first so a token already in flight stops being able to write even
  // if a later step fails; a tombstone (setSuspended) is written right after the member's own
  // items are gone, so the same still-valid token is rejected by the dispatcher's suspended
  // check from then on.
  route('DELETE', '/api/admin/members/:sub', admin, async ({ user, params, body }) => {
    const m = await findMember(subOf(params));
    protect(user, m);
    if (!(await store.isReindexed())) throw new HttpError(409, 'Run "Rebuild member index" on the Dashboard first');
    const confirm = str(body, 'confirmEmail', { required: true, max: 320 }).toLowerCase();
    if (confirm !== m.email.toLowerCase()) {
      throw new HttpError(400, "confirmEmail: doesn't match this member's email", { field: 'confirmEmail' });
    }
    const reason = reasonOf(body);
    const removed = { posts: 0, comments: 0, likes: 0, submissions: 0, anonymised: 0, items: 0 };
    let step = 'sign-out';
    try {
      await members.disable(m.username);
      await members.signOut(m.username);
      step = 'posts';
      for (const p of await store.memberPosts(m.sub)) {
        await store.deletePost(p.postId);
        removed.posts++;
      }
      step = 'comments';
      for (const c of await store.memberComments(m.sub)) {
        await store.deleteComment(c.postId, c.commentId);
        removed.comments++;
      }
      step = 'likes';
      for (const l of await store.memberLikes(m.sub)) {
        await store.unlike(l.postId, m.sub);
        removed.likes++;
      }
      step = 'submissions';
      for (const s of await store.listSubmissionsByUser(m.sub)) {
        if (s.status === 'approved') {
          await store.anonymiseSubmission(s);
          removed.anonymised++;
        } else {
          await store.deleteSubmission(s.id);
          removed.submissions++;
        }
      }
      step = 'user-items';
      removed.items = await store.deleteUserItems(m.sub);
      await store.setSuspended(m.sub, true, now()); // tombstone: a still-valid token can't write after this
      step = 'remove-login';
      await members.remove(m.username);
    } catch (err) {
      if (!(err instanceof HttpError)) log.error?.(err);
      try {
        await audit(user, 'delete', m.sub, { reason, detail: { partial: step, removed } });
      } catch (auditErr) {
        log.error?.(auditErr);
      }
      throw new HttpError(err.status || 500, err.status ? err.message : 'Delete stopped part-way — run it again to finish', { step, removed });
    }
    await audit(user, 'delete', m.sub, { reason, detail: removed });
    return { deleted: true, removed };
  });

  route('POST', '/api/admin/maintenance/reindex', admin, async ({ user }) => {
    const total = { posts: 0, comments: 0, likes: 0 };
    for (const p of await store.listAllPosts()) {
      const c = await store.reindexPost(p.postId);
      total.posts += c.posts;
      total.comments += c.comments;
      total.likes += c.likes;
    }
    await store.markReindexed(now());
    await audit(user, 'reindex', '', { detail: total });
    return total;
  });
}
