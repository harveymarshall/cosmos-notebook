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
    await store.deleteComment(postId, commentId);
    await audit(user, 'remove-comment', comment.authorSub, { reason: reasonOf(body), detail: { postId, commentId } });
    return { deleted: true };
  });

  // Task 6 adds the action routes below this line, using findMember, protect and audit.
  registerActions({ route, admin, store, members, ownerSub, now, log, subOf, reasonOf, findMember, protect, audit });
}

function registerActions() {}
