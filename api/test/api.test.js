// Run with:  node --test api/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createStore } from '../src/store.js';
import { createFakeDynamo } from '../src/fake-dynamo.js';

const ALICE = { sub: '11111111-aaaa-4aaa-8aaa-111111111111' };
const BOB = { sub: '22222222-bbbb-4bbb-8bbb-222222222222' };
const ADMIN = { sub: '33333333-cccc-4ccc-8ccc-333333333333', groups: '[admins]' };

function setup() {
  let t = Date.parse('2026-10-20T09:00:00Z');
  let n = 0;
  const app = createApp({
    store: createStore({ send: createFakeDynamo(), table: 'test' }),
    now: () => new Date((t += 1000)).toISOString(),
    makeId: () => `id${String(++n).padStart(6, '0')}`,
    log: { error() {} },
  });
  const call = async (method, path, { as, body, query } = {}) => {
    const [rawPath, qs] = path.split('?');
    const res = await app({
      rawPath,
      queryStringParameters: query || (qs ? Object.fromEntries(new URLSearchParams(qs)) : undefined),
      requestContext: {
        http: { method },
        authorizer: as ? { jwt: { claims: { sub: as.sub, ...(as.groups ? { 'cognito:groups': as.groups } : {}) } } } : undefined,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.statusCode, data: res.body ? JSON.parse(res.body) : undefined };
  };
  return { call };
}

const name = (call, who, displayName) => call('PUT', '/api/me/profile', { as: who, body: { displayName } });

test('health and unknown routes', async () => {
  const { call } = setup();
  assert.equal((await call('GET', '/api/health')).status, 200);
  assert.equal((await call('GET', '/api/nope')).status, 404);
  assert.equal((await call('PATCH', '/api/health')).status, 405);
});

test('private routes need a login', async () => {
  const { call } = setup();
  assert.equal((await call('GET', '/api/me')).status, 401);
  assert.equal((await call('GET', '/api/me/progress')).status, 401);
  assert.equal((await call('POST', '/api/submissions', { body: {} })).status, 401);
});

test('profile, progress and private notes', async () => {
  const { call } = setup();
  let r = await call('GET', '/api/me', { as: ALICE });
  assert.equal(r.data.profile, null);

  r = await call('PUT', '/api/me/profile', { as: ALICE, body: { displayName: 'A' } });
  assert.equal(r.status, 400, 'too-short display name rejected');
  assert.equal((await name(call, ALICE, 'Alice')).status, 200);

  r = await call('PUT', '/api/me/progress/weigh-jupiter', {
    as: ALICE,
    body: { kind: 'experiment', title: 'Weigh Jupiter', status: 'in-progress', notes: 'Night 1: Ganymede east', startedAt: '2026-12-12' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.item.published, false);

  r = await call('PUT', '/api/me/progress/weigh-jupiter', { as: ALICE, body: { kind: 'experiment', title: 'x', status: 'finished' } });
  assert.equal(r.status, 400, 'book status not allowed on experiments');
  r = await call('PUT', '/api/me/progress/Bad_Id!', { as: ALICE, body: { kind: 'experiment', title: 'x', status: 'done' } });
  assert.equal(r.status, 400);

  r = await call('GET', '/api/me/progress', { as: ALICE });
  assert.equal(r.data.items.length, 1);
  assert.equal((await call('GET', '/api/me/progress', { as: BOB })).data.items.length, 0, 'Bob cannot see Alice’s progress');

  assert.equal((await call('GET', '/api/feed')).data.posts.length, 0, 'unpublished notes stay private');
});

test('publishing, feed, likes and comments', async () => {
  const { call } = setup();

  // Publishing needs a display name
  let r = await call('PUT', '/api/me/progress/cd-spectroscope', {
    as: ALICE,
    body: { kind: 'experiment', title: 'Build a CD spectroscope', status: 'done', notes: 'Sodium lamp: one yellow line!', published: true },
  });
  assert.equal(r.status, 409);

  await name(call, ALICE, 'Alice');
  r = await call('PUT', '/api/me/progress/cd-spectroscope', {
    as: ALICE,
    body: { kind: 'experiment', title: 'Build a CD spectroscope', status: 'done', notes: 'Sodium lamp: one yellow line!', published: true },
  });
  assert.equal(r.status, 200);
  const postId = r.data.item.postId;
  assert.ok(postId.startsWith('experiment~'));

  r = await call('GET', '/api/feed');
  assert.equal(r.data.posts.length, 1);
  assert.equal(r.data.posts[0].authorName, 'Alice');

  // Likes are counted once per person
  await name(call, BOB, 'Bob');
  assert.equal((await call('POST', `/api/posts/${encodeURIComponent(postId)}/like`, { as: BOB })).data.post.likeCount, 1);
  assert.equal((await call('POST', `/api/posts/${encodeURIComponent(postId)}/like`, { as: BOB })).data.post.likeCount, 1);
  assert.deepEqual((await call('GET', `/api/me/likes?postIds=${postId}`, { as: BOB })).data.liked, [postId]);
  assert.equal((await call('DELETE', `/api/posts/${postId}/like`, { as: BOB })).data.post.likeCount, 0);
  assert.equal((await call('DELETE', `/api/posts/${postId}/like`, { as: BOB })).data.post.likeCount, 0);
  await call('POST', `/api/posts/${postId}/like`, { as: BOB });

  // Comments
  r = await call('POST', `/api/posts/${postId}/comments`, { as: BOB, body: { body: 'Great result!' } });
  assert.equal(r.status, 201);
  const commentId = r.data.comment.commentId;
  r = await call('GET', `/api/posts/${postId}/comments`);
  assert.equal(r.data.comments.length, 1);
  assert.equal((await call('GET', `/api/posts/${postId}`)).data.post.commentCount, 1);

  const carol = { sub: '44444444-dddd-4ddd-8ddd-444444444444' };
  assert.equal((await call('DELETE', `/api/posts/${postId}/comments/${commentId}`, { as: carol })).status, 403);

  // Editing keeps likes, comments and the original date
  const before = (await call('GET', `/api/posts/${postId}`)).data.post;
  await call('PUT', '/api/me/progress/cd-spectroscope', {
    as: ALICE,
    body: { kind: 'experiment', title: 'Build a CD spectroscope', status: 'done', notes: 'Updated write-up', published: true },
  });
  const after = (await call('GET', `/api/posts/${postId}`)).data.post;
  assert.equal(after.body, 'Updated write-up');
  assert.equal(after.likeCount, 1);
  assert.equal(after.commentCount, 1);
  assert.equal(after.publishedAt, before.publishedAt);

  // Post author can delete a comment on their own post
  assert.equal((await call('DELETE', `/api/posts/${postId}/comments/${commentId}`, { as: ALICE })).status, 200);
  assert.equal((await call('GET', `/api/posts/${postId}`)).data.post.commentCount, 0);

  // Unpublishing removes the post with its likes
  await call('PUT', '/api/me/progress/cd-spectroscope', {
    as: ALICE,
    body: { kind: 'experiment', title: 'Build a CD spectroscope', status: 'done', notes: 'Updated write-up', published: false },
  });
  assert.equal((await call('GET', `/api/posts/${postId}`)).status, 404);
  assert.equal((await call('GET', '/api/feed')).data.posts.length, 0);
  assert.equal((await call('POST', `/api/posts/${postId}/like`, { as: BOB })).status, 404);
});

test('feed pages newest first', async () => {
  const { call } = setup();
  await name(call, ALICE, 'Alice');
  for (let i = 1; i <= 5; i++) {
    await call('POST', '/api/me/observations', {
      as: ALICE,
      body: { title: `Night ${i}`, date: `2026-12-0${i}`, notes: `Clear skies ${i}`, published: true },
    });
  }
  let r = await call('GET', '/api/feed?limit=2');
  assert.deepEqual(r.data.posts.map((p) => p.title), ['Night 5', 'Night 4']);
  r = await call('GET', `/api/feed?limit=2&cursor=${r.data.cursor}`);
  assert.deepEqual(r.data.posts.map((p) => p.title), ['Night 3', 'Night 2']);
  r = await call('GET', `/api/feed?limit=2&cursor=${r.data.cursor}`);
  assert.deepEqual(r.data.posts.map((p) => p.title), ['Night 1']);
  assert.equal(r.data.cursor, null);
  assert.equal((await call('GET', '/api/feed?cursor=rubbish')).status, 200, 'bad cursor is ignored');
});

test('observations are private to their owner', async () => {
  const { call } = setup();
  const r = await call('POST', '/api/me/observations', { as: ALICE, body: { title: 'First look at Jupiter', date: '2026-12-11' } });
  assert.equal(r.status, 201);
  const id = r.data.observation.id;
  assert.equal((await call('PUT', `/api/me/observations/${id}`, { as: BOB, body: { title: 'hijack' } })).status, 404);
  assert.equal((await call('GET', '/api/me/observations', { as: ALICE })).data.observations.length, 1);
  assert.equal((await call('DELETE', `/api/me/observations/${id}`, { as: ALICE })).status, 200);
  assert.equal((await call('GET', '/api/me/observations', { as: ALICE })).data.observations.length, 0);
});

test('submissions are vetted by admins before reaching the library', async () => {
  const { call } = setup();
  await name(call, BOB, 'Bob');
  let r = await call('POST', '/api/submissions', {
    as: BOB,
    body: { type: 'resource', title: 'Zooniverse', summary: 'Classify real galaxies for research.', track: 'astro', link: 'javascript:alert(1)' },
  });
  assert.equal(r.status, 400, 'non-web links rejected');

  r = await call('POST', '/api/submissions', {
    as: BOB,
    body: { type: 'resource', title: 'Zooniverse', summary: 'Classify real galaxies for research.', track: 'astro', link: 'https://www.zooniverse.org' },
  });
  assert.equal(r.status, 201);
  const id = r.data.submission.id;
  assert.equal((await call('GET', '/api/library')).data.items.length, 0, 'not public until approved');

  assert.equal((await call('GET', '/api/admin/submissions', { as: BOB })).status, 404, 'hidden from members');
  r = await call('GET', '/api/admin/submissions', { as: ADMIN });
  assert.equal(r.data.submissions.length, 1);

  r = await call('POST', `/api/admin/submissions/${id}/review`, {
    as: ADMIN,
    body: { decision: 'approve', note: 'Lovely', edits: { title: 'Zooniverse: Galaxy Zoo' } },
  });
  assert.equal(r.status, 200);
  r = await call('GET', '/api/library');
  assert.equal(r.data.items.length, 1);
  assert.equal(r.data.items[0].title, 'Zooniverse: Galaxy Zoo');
  assert.match(r.data.items[0].id, /^c-[0-9a-f]+$/);
  assert.equal((await call('GET', '/api/admin/submissions', { as: ADMIN })).data.submissions.length, 0, 'queue cleared');
  assert.equal((await call('GET', '/api/me/submissions', { as: BOB })).data.submissions[0].status, 'approved');

  // Limit on pending submissions
  for (let i = 0; i < 5; i++) {
    r = await call('POST', '/api/submissions', {
      as: BOB,
      body: { type: 'book', title: `Book ${i}`, summary: 'A good physics book.', track: 'both', link: 'https://example.com' },
    });
    assert.equal(r.status, 201);
  }
  r = await call('POST', '/api/submissions', {
    as: BOB,
    body: { type: 'book', title: 'One too many', summary: 'A good physics book.', track: 'both', link: 'https://example.com' },
  });
  assert.equal(r.status, 429);
});

test('admins can remove posts', async () => {
  const { call } = setup();
  await name(call, ALICE, 'Alice');
  const r = await call('POST', '/api/me/observations', { as: ALICE, body: { title: 'Spam', notes: 'buy stuff', published: true } });
  const postId = r.data.observation.postId;
  assert.equal((await call('DELETE', `/api/admin/posts/${postId}`, { as: BOB })).status, 404);
  assert.equal((await call('DELETE', `/api/admin/posts/${postId}`, { as: ADMIN })).status, 200);
  assert.equal((await call('GET', '/api/feed')).data.posts.length, 0);
});

test('bad input is rejected cleanly', async () => {
  const { call } = setup();
  const res = await call('PUT', '/api/me/profile', { as: ALICE, body: { displayName: 42 } });
  assert.equal(res.status, 400);
  const big = await call('PUT', '/api/me/profile', { as: ALICE, body: { displayName: 'x'.repeat(200000) } });
  assert.equal(big.status, 413);
});

test('journal entries: one per session, private, removed with the progress', async () => {
  const { call } = setup();
  const base = '/api/me/progress/weigh-jupiter';
  await call('PUT', base, { as: ALICE, body: { kind: 'experiment', title: 'Weigh Jupiter', status: 'in-progress' } });

  let r = await call('POST', `${base}/entries`, { as: ALICE, body: { date: '2026-12-14', title: 'Tripod night', notes: 'Cloud after 30 min' } });
  assert.equal(r.status, 201);
  r = await call('POST', `${base}/entries`, { as: ALICE, body: { date: '2026-12-12', title: 'First sighting', conditions: 'clear', notes: '| Moon | Dist |\n| --- | --- |\n| Ganymede | 4.1 |' } });
  const firstId = r.data.entry.id;
  assert.equal((await call('POST', `${base}/entries`, { as: ALICE, body: { date: 'yesterday' } })).status, 400);

  r = await call('GET', `${base}/entries`, { as: ALICE });
  assert.deepEqual(r.data.entries.map((e) => e.title), ['First sighting', 'Tripod night'], 'sorted by date');
  assert.equal((await call('GET', `${base}/entries`, { as: BOB })).data.entries.length, 0, 'private to Alice');

  r = await call('PUT', `${base}/entries/${firstId}`, { as: ALICE, body: { date: '2026-12-12', title: 'First sighting!', notes: 'edited' } });
  assert.equal(r.data.entry.title, 'First sighting!');
  assert.equal((await call('PUT', `${base}/entries/${firstId}`, { as: BOB, body: { title: 'x' } })).status, 404);

  assert.equal((await call('DELETE', `${base}/entries/${firstId}`, { as: ALICE })).status, 200);
  assert.equal((await call('GET', `${base}/entries`, { as: ALICE })).data.entries.length, 1);

  // Other experiments' journals are separate
  await call('POST', '/api/me/progress/weigh-jupiter-2/entries', { as: ALICE, body: { title: 'Other' } });
  await call('DELETE', base, { as: ALICE });
  assert.equal((await call('GET', `${base}/entries`, { as: ALICE })).data.entries.length, 0, 'cleared with progress');
  assert.equal((await call('GET', '/api/me/progress/weigh-jupiter-2/entries', { as: ALICE })).data.entries.length, 1);
});

test('the admin console is only sent to admins', async () => {
  const { call } = setup();
  const hidden = await call('GET', '/api/admin/console', { as: BOB });
  assert.equal(hidden.status, 404);
  assert.equal(JSON.stringify(hidden.data), JSON.stringify((await call('GET', '/api/nope', { as: BOB })).data), 'looks like any missing page');
  assert.equal((await call('GET', '/api/admin/console')).status, 401);
  const r = await call('GET', '/api/admin/console', { as: ADMIN });
  assert.equal(r.status, 200);
  assert.match(r.data.code, /Review queue/);
});
