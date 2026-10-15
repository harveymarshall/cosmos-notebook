// The whole API: one small router and the routes. Runs as a single AWS Lambda behind
// API Gateway (HTTP API), and locally inside scripts/dev-server.js.
//
// Sign-in is checked by API Gateway (JWT authorizer, Cognito) before a request reaches
// here; the verified claims arrive in event.requestContext.authorizer.jwt.claims.

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { HttpError, LIMITS, ITEM_ID, ENTITY_ID, POST_ID, str, oneOf, bool, date, url, param } from './validate.js';
import { NotFound } from './store.js';

const EXPERIMENT_STATUS = ['planned', 'in-progress', 'done'];
const BOOK_STATUS = ['to-read', 'reading', 'finished'];
const TRACKS = ['astro', 'quantum', 'both'];
const SUBMISSION_TYPES = ['experiment', 'book', 'resource'];
const MAX_PENDING_SUBMISSIONS = 5;

export const newId = () => randomBytes(9).toString('base64url'); // 12 chars, URL-safe

function userFrom(event) {
  const claims = event?.requestContext?.authorizer?.jwt?.claims;
  if (!claims?.sub) return null;
  let groups = claims['cognito:groups'] ?? [];
  if (typeof groups === 'string') groups = groups.replace(/^\[|\]$/g, '').split(/[\s,]+/).filter(Boolean);
  return { sub: String(claims.sub), groups, isAdmin: groups.includes('admins') };
}

function compile(pattern) {
  const keys = [];
  const re = new RegExp(
    '^' +
      pattern.replace(/:(\w+)/g, (_, k) => {
        keys.push(k);
        return '([^/]+)';
      }) +
      '/?$'
  );
  return { re, keys };
}

const json = (status, data) => ({
  statusCode: status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  body: data === undefined ? '' : JSON.stringify(data),
});

export function createApp({ store, now = () => new Date().toISOString(), makeId = newId, log = console } = {}) {
  const routes = [];
  const route = (method, pattern, opts, fn, status = 200) =>
    routes.push({ method, ...compile(pattern), ...opts, fn, status });

  // ---------- helpers ----------
  const requireProfile = async (user) => {
    const profile = await store.getProfile(user.sub);
    if (!profile?.displayName) throw new HttpError(409, 'Choose a display name in your profile first');
    return profile;
  };
  const postIdFor = (kind, sub, id) => `${kind}~${sub}~${id}`;
  // Admin routes answer 404 to everyone else, exactly like a route that doesn't exist,
  // so nobody can tell there is an admin area at all.
  const canSeeAdmin = (user) => {
    if (!user?.isAdmin) throw new HttpError(404, 'Not found');
  };
  let consoleCode;

  /** Publish, update or withdraw the community post for a progress item or observation. */
  async function syncPost({ user, kind, id, published, title, body, status, meta }) {
    const postId = postIdFor(kind, user.sub, id);
    if (!published || !body.trim()) {
      await store.deletePost(postId);
      return null;
    }
    const profile = await requireProfile(user);
    const existing = await store.getPost(postId);
    const time = now();
    await store.upsertPost({
      postId,
      kind,
      itemId: id,
      authorSub: user.sub,
      authorName: profile.displayName,
      title,
      body,
      status: status || '',
      meta: meta || {},
      publishedAt: existing?.publishedAt || time,
      updatedAt: time,
    });
    return postId;
  }

  // ---------- public ----------
  route('GET', '/api/health', {}, async () => ({ ok: true, time: now() }));

  route('GET', '/api/library', {}, async () => {
    const approved = await store.listSubmissionsByStatus('approved', { newestFirst: true });
    return {
      items: approved.map((s) => ({
        id: `c-${Buffer.from(s.id, 'base64url').toString('hex')}`,
        submissionId: s.id,
        kind: s.type,
        title: s.title,
        summary: s.summary,
        track: s.track,
        link: s.link,
        body: s.body,
        contributor: s.authorName,
        approvedAt: s.reviewedAt,
      })),
    };
  });

  route('GET', '/api/feed', {}, async ({ query }) => {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 50);
    return store.listFeed({ limit, cursor: query.cursor });
  });

  route('GET', '/api/posts/:postId', {}, async ({ params }) => {
    const post = await store.getPost(param(params.postId, POST_ID, 'postId'));
    if (!post) throw new HttpError(404, 'Post not found');
    return { post };
  });

  route('GET', '/api/posts/:postId/comments', {}, async ({ params }) => {
    return { comments: await store.listComments(param(params.postId, POST_ID, 'postId')) };
  });

  // ---------- me ----------
  route('GET', '/api/me', { auth: true }, async ({ user }) => ({
    user: { sub: user.sub, isAdmin: user.isAdmin },
    profile: (await store.getProfile(user.sub)) || null,
  }));

  route('PUT', '/api/me/profile', { auth: true }, async ({ user, body }) => {
    const existing = await store.getProfile(user.sub);
    const profile = {
      displayName: str(body, 'displayName', { required: true, min: 2, max: LIMITS.displayName }),
      bio: str(body, 'bio', { max: LIMITS.bio }),
      createdAt: existing?.createdAt || now(),
      updatedAt: now(),
    };
    await store.putProfile(user.sub, profile);
    return { profile };
  });

  // Progress on library items
  route('GET', '/api/me/progress', { auth: true }, async ({ user }) => ({ items: await store.listProgress(user.sub) }));

  route('PUT', '/api/me/progress/:itemId', { auth: true }, async ({ user, params, body }) => {
    const itemId = param(params.itemId, ITEM_ID, 'itemId');
    const kind = oneOf(body, 'kind', ['experiment', 'book']);
    const item = {
      itemId,
      kind,
      title: str(body, 'title', { required: true, max: LIMITS.title }),
      status: oneOf(body, 'status', kind === 'book' ? BOOK_STATUS : EXPERIMENT_STATUS),
      notes: str(body, 'notes', { max: LIMITS.notes }),
      startedAt: date(body, 'startedAt'),
      completedAt: date(body, 'completedAt'),
      published: bool(body, 'published'),
      updatedAt: now(),
    };
    item.postId = await syncPost({
      user,
      kind,
      id: itemId,
      published: item.published,
      title: item.title,
      body: item.notes,
      status: item.status,
      meta: { completedAt: item.completedAt },
    });
    if (!item.postId) item.published = item.published && !!item.notes;
    await store.putProgress(user.sub, item);
    return { item };
  });

  route('DELETE', '/api/me/progress/:itemId', { auth: true }, async ({ user, params }) => {
    const itemId = param(params.itemId, ITEM_ID, 'itemId');
    const existing = await store.getProgress(user.sub, itemId);
    if (existing) await store.deletePost(postIdFor(existing.kind, user.sub, itemId));
    await store.deleteEntries(user.sub, itemId);
    await store.deleteProgress(user.sub, itemId);
    return { deleted: true };
  });

  // Journal: one entry per session, so a long experiment never becomes one giant page
  const MAX_ENTRIES = 200;
  const readEntry = (body) => ({
    date: date(body, 'date') || now().slice(0, 10),
    title: str(body, 'title', { max: LIMITS.title }),
    conditions: str(body, 'conditions', { max: LIMITS.shortText }),
    notes: str(body, 'notes', { max: LIMITS.notes }),
  });

  route('GET', '/api/me/progress/:itemId/entries', { auth: true }, async ({ user, params }) => ({
    entries: await store.listEntries(user.sub, param(params.itemId, ITEM_ID, 'itemId')),
  }));

  route('POST', '/api/me/progress/:itemId/entries', { auth: true }, async ({ user, params, body }) => {
    const itemId = param(params.itemId, ITEM_ID, 'itemId');
    const existing = await store.listEntries(user.sub, itemId);
    if (existing.length >= MAX_ENTRIES) throw new HttpError(429, `An experiment can hold up to ${MAX_ENTRIES} journal entries`);
    const time = now();
    const entry = { id: makeId(), itemId, ...readEntry(body), createdAt: time, updatedAt: time };
    await store.putEntry(user.sub, entry);
    return { entry };
  }, 201);

  route('PUT', '/api/me/progress/:itemId/entries/:entryId', { auth: true }, async ({ user, params, body }) => {
    const itemId = param(params.itemId, ITEM_ID, 'itemId');
    const id = param(params.entryId, ENTITY_ID, 'entryId');
    const existing = await store.getEntry(user.sub, itemId, id);
    if (!existing) throw new HttpError(404, 'Journal entry not found');
    const entry = { ...existing, ...readEntry(body), updatedAt: now() };
    await store.putEntry(user.sub, entry);
    return { entry };
  });

  route('DELETE', '/api/me/progress/:itemId/entries/:entryId', { auth: true }, async ({ user, params }) => {
    const itemId = param(params.itemId, ITEM_ID, 'itemId');
    await store.deleteEntry(user.sub, itemId, param(params.entryId, ENTITY_ID, 'entryId'));
    return { deleted: true };
  });

  // Observing log
  const readObservation = (body) => ({
    title: str(body, 'title', { required: true, max: LIMITS.title }),
    date: date(body, 'date') || now().slice(0, 10),
    time: str(body, 'time', { max: 40 }),
    location: str(body, 'location'),
    target: str(body, 'target'),
    equipment: str(body, 'equipment'),
    conditions: str(body, 'conditions'),
    notes: str(body, 'notes', { max: LIMITS.notes }),
    published: bool(body, 'published'),
  });

  async function saveObservation(user, id, body, existing) {
    const obs = { id, ...readObservation(body), createdAt: existing?.createdAt || now(), updatedAt: now() };
    obs.postId = await syncPost({
      user,
      kind: 'observation',
      id,
      published: obs.published,
      title: obs.title,
      body: obs.notes,
      meta: { date: obs.date, target: obs.target, equipment: obs.equipment, conditions: obs.conditions },
    });
    await store.putObservation(user.sub, obs);
    return { observation: obs };
  }

  route('GET', '/api/me/observations', { auth: true }, async ({ user }) => ({
    observations: await store.listObservations(user.sub),
  }));

  route('POST', '/api/me/observations', { auth: true }, async ({ user, body }) => saveObservation(user, makeId(), body), 201);

  route('PUT', '/api/me/observations/:id', { auth: true }, async ({ user, params, body }) => {
    const id = param(params.id, ENTITY_ID, 'id');
    const existing = await store.getObservation(user.sub, id);
    if (!existing) throw new HttpError(404, 'Observation not found');
    return saveObservation(user, id, body, existing);
  });

  route('DELETE', '/api/me/observations/:id', { auth: true }, async ({ user, params }) => {
    const id = param(params.id, ENTITY_ID, 'id');
    await store.deletePost(postIdFor('observation', user.sub, id));
    await store.deleteObservation(user.sub, id);
    return { deleted: true };
  });

  // ---------- likes & comments ----------
  route('GET', '/api/me/likes', { auth: true }, async ({ user, query }) => {
    const ids = String(query.postIds || '')
      .split(',')
      .filter((id) => POST_ID.test(id))
      .slice(0, 100);
    return { liked: ids.length ? await store.likedBy(user.sub, ids) : [] };
  });

  route('POST', '/api/posts/:postId/like', { auth: true }, async ({ user, params }) => {
    const postId = param(params.postId, POST_ID, 'postId');
    await store.like(postId, user.sub, now());
    return { post: await store.getPost(postId), liked: true };
  });

  route('DELETE', '/api/posts/:postId/like', { auth: true }, async ({ user, params }) => {
    const postId = param(params.postId, POST_ID, 'postId');
    await store.unlike(postId, user.sub);
    return { post: await store.getPost(postId), liked: false };
  });

  route('POST', '/api/posts/:postId/comments', { auth: true }, async ({ user, params, body }) => {
    const postId = param(params.postId, POST_ID, 'postId');
    const profile = await requireProfile(user);
    const comment = await store.addComment(postId, {
      id: makeId(),
      authorSub: user.sub,
      authorName: profile.displayName,
      body: str(body, 'body', { required: true, max: LIMITS.comment }),
      createdAt: now(),
    });
    return { comment };
  }, 201);

  route('DELETE', '/api/posts/:postId/comments/:commentId', { auth: true }, async ({ user, params }) => {
    const postId = param(params.postId, POST_ID, 'postId');
    const commentId = param(params.commentId, /^\d{8,20}-[A-Za-z0-9_-]{6,64}$/, 'commentId');
    const comment = await store.getComment(postId, commentId);
    if (!comment) throw new HttpError(404, 'Comment not found');
    const postAuthor = postId.split('~')[1];
    if (comment.authorSub !== user.sub && postAuthor !== user.sub && !user.isAdmin) {
      throw new HttpError(403, 'You can only delete your own comments');
    }
    await store.deleteComment(postId, commentId);
    return { deleted: true };
  });

  // ---------- library submissions ----------
  route('GET', '/api/me/submissions', { auth: true }, async ({ user }) => ({
    submissions: await store.listSubmissionsByUser(user.sub),
  }));

  route('POST', '/api/submissions', { auth: true }, async ({ user, body }) => {
    const profile = await requireProfile(user);
    const mine = await store.listSubmissionsByUser(user.sub);
    if (mine.filter((s) => s.status === 'pending').length >= MAX_PENDING_SUBMISSIONS) {
      throw new HttpError(429, `You can have up to ${MAX_PENDING_SUBMISSIONS} submissions waiting for review`);
    }
    const type = oneOf(body, 'type', SUBMISSION_TYPES);
    const submission = {
      id: makeId(),
      type,
      title: str(body, 'title', { required: true, min: 3, max: LIMITS.title }),
      summary: str(body, 'summary', { required: true, min: 10, max: LIMITS.summary }),
      track: oneOf(body, 'track', TRACKS),
      link: url(body, 'link'),
      body: str(body, 'body', { required: type === 'experiment', max: LIMITS.notes }),
      status: 'pending',
      authorSub: user.sub,
      authorName: profile.displayName,
      createdAt: now(),
    };
    if (type !== 'experiment' && !submission.link && !submission.body) {
      throw new HttpError(400, 'link: add a link or a description');
    }
    await store.putSubmission(submission);
    return { submission };
  }, 201);

  // ---------- admin ----------
  route('GET', '/api/admin/console', { auth: true }, async ({ user }) => {
    canSeeAdmin(user);
    consoleCode ??= readFileSync(new URL('./console/admin.js', import.meta.url), 'utf8');
    return { code: consoleCode };
  });

  route('GET', '/api/admin/submissions', { auth: true }, async ({ user, query }) => {
    canSeeAdmin(user);
    const status = oneOf(query, 'status', ['pending', 'approved', 'rejected'], { fallback: 'pending' });
    return { submissions: await store.listSubmissionsByStatus(status, { newestFirst: status !== 'pending' }) };
  });

  route('POST', '/api/admin/submissions/:id/review', { auth: true }, async ({ user, params, body }) => {
    canSeeAdmin(user);
    const id = param(params.id, ENTITY_ID, 'id');
    const existing = await store.getSubmission(id);
    if (!existing) throw new HttpError(404, 'Submission not found');
    const decision = oneOf(body, 'decision', ['approve', 'reject']);
    const edits = body?.edits && typeof body.edits === 'object' ? body.edits : {};
    const updated = {
      ...existing,
      title: edits.title !== undefined ? str(edits, 'title', { required: true, min: 3, max: LIMITS.title }) : existing.title,
      summary: edits.summary !== undefined ? str(edits, 'summary', { required: true, max: LIMITS.summary }) : existing.summary,
      track: edits.track !== undefined ? oneOf(edits, 'track', TRACKS) : existing.track,
      link: edits.link !== undefined ? url(edits, 'link') : existing.link,
      body: edits.body !== undefined ? str(edits, 'body', { max: LIMITS.notes }) : existing.body,
      status: decision === 'approve' ? 'approved' : 'rejected',
      reviewNote: str(body, 'note', { max: LIMITS.summary }),
      reviewedAt: now(),
      reviewedBy: user.sub,
    };
    await store.putSubmission(updated);
    return { submission: updated };
  });

  route('DELETE', '/api/admin/posts/:postId', { auth: true }, async ({ user, params }) => {
    canSeeAdmin(user);
    const removed = await store.deletePost(param(params.postId, POST_ID, 'postId'));
    return { deleted: removed };
  });

  // ---------- dispatcher ----------
  return async function handle(event) {
    const method = (event.requestContext?.http?.method || event.httpMethod || 'GET').toUpperCase();
    const path = event.rawPath || event.path || '/';
    try {
      let matched = false;
      for (const r of routes) {
        const m = path.match(r.re);
        if (!m) continue;
        matched = true;
        if (r.method !== method) continue;

        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const user = userFrom(event);
        if (r.auth && !user) throw new HttpError(401, 'Please log in');

        let body = {};
        if (event.body) {
          const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
          if (raw.length > 100_000) throw new HttpError(413, 'Request too large');
          try {
            body = JSON.parse(raw);
          } catch {
            throw new HttpError(400, 'Body must be JSON');
          }
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Body must be a JSON object');
        }
        const query = event.queryStringParameters || {};
        const data = await r.fn({ user, params, body, query, event });
        return json(r.status, data);
      }
      throw new HttpError(matched ? 405 : 404, matched ? 'Method not allowed' : 'Not found');
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.message, ...(err.details || {}) });
      if (err instanceof NotFound) return json(404, { error: 'Not found' });
      if (err?.name === 'ValidationException') return json(400, { error: 'Bad request' });
      log.error?.(err);
      return json(500, { error: 'Something went wrong' });
    }
  };
}
