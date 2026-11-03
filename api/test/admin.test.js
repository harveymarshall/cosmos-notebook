// api/test/admin.test.js
// Run with:  node --test api/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { createFakeDynamo } from '../src/fake-dynamo.js';
import { createApp } from '../src/app.js';
import { createFakeCognito } from '../src/fake-cognito.js';
import { createMembers } from '../src/members.js';

const ALICE = '11111111-aaaa-4aaa-8aaa-111111111111';
const BOB = '22222222-bbbb-4bbb-8bbb-222222222222';

const newStore = () => createStore({ send: createFakeDynamo(), table: 'test' });
const post = (author, id, publishedAt) => ({
  postId: `experiment~${author}~${id}`,
  kind: 'experiment',
  itemId: id,
  authorSub: author,
  authorName: author === ALICE ? 'Alice' : 'Bob',
  title: id,
  body: 'notes',
  status: 'done',
  meta: {},
  publishedAt,
  updatedAt: publishedAt,
});

test('store: account item keeps last-seen and suspended separately from the profile', async () => {
  const store = newStore();
  assert.equal(await store.getAccount(ALICE), undefined);
  await store.touchAccount(ALICE, '2026-11-01T10:00:00.000Z');
  await store.setSuspended(ALICE, true, '2026-11-02T10:00:00.000Z');
  await store.touchAccount(ALICE, '2026-11-03T10:00:00.000Z');
  const acct = await store.getAccount(ALICE);
  assert.equal(acct.lastSeenAt, '2026-11-03T10:00:00.000Z');
  assert.equal(acct.suspended, true);
  await store.putProfile(ALICE, { displayName: 'Alice', createdAt: 'x', updatedAt: 'x' });
  assert.equal((await store.getAccount(ALICE)).suspended, true, 'profile save does not touch the account');
  await store.touchAccount(BOB, '2026-10-01T10:00:00.000Z');
  assert.deepEqual((await store.listAccounts()).map((a) => a.sub), [ALICE, BOB]);
  const accounts = await store.getAccounts([ALICE, BOB, '33333333-cccc-4ccc-8ccc-333333333333']);
  assert.deepEqual(Object.keys(accounts).sort(), [ALICE, BOB]);
  assert.equal((await store.getProfiles([ALICE]))[ALICE].displayName, 'Alice');
});

test('store: a member\'s posts, comments and likes can be listed', async () => {
  const store = newStore();
  await store.upsertPost(post(ALICE, 'weigh-jupiter', '2026-11-01T10:00:00.000Z'));
  await store.upsertPost(post(BOB, 'time-a-pendulum', '2026-11-02T10:00:00.000Z'));
  const bobPost = `experiment~${BOB}~time-a-pendulum`;
  await store.addComment(bobPost, { id: 'c00001', authorSub: ALICE, authorName: 'Alice', body: 'hi', createdAt: '2026-11-02T11:00:00.000Z' });
  await store.like(bobPost, ALICE, '2026-11-02T12:00:00.000Z');

  assert.deepEqual((await store.memberPosts(ALICE)).map((p) => p.itemId), ['weigh-jupiter']);
  const comments = await store.memberComments(ALICE);
  assert.equal(comments.length, 1);
  assert.equal(comments[0].postId, bobPost);
  assert.match(comments[0].commentId, /^\d+-c00001$/);
  assert.deepEqual(await store.memberLikes(ALICE), [{ postId: bobPost, at: '2026-11-02T12:00:00.000Z' }]);
  assert.deepEqual(await store.memberPosts(BOB).then((p) => p.length), 1);
});

test('store: hiding a member takes their posts out of the feed and their comments off posts', async () => {
  const store = newStore();
  await store.upsertPost(post(ALICE, 'weigh-jupiter', '2026-11-01T10:00:00.000Z'));
  await store.upsertPost(post(BOB, 'time-a-pendulum', '2026-11-02T10:00:00.000Z'));
  const bobPost = `experiment~${BOB}~time-a-pendulum`;
  await store.addComment(bobPost, { id: 'c00001', authorSub: ALICE, authorName: 'Alice', body: 'hi', createdAt: '2026-11-02T11:00:00.000Z' });

  assert.deepEqual(await store.setMemberHidden(ALICE, true), { posts: 1, comments: 1 });
  assert.deepEqual((await store.listFeed()).posts.map((p) => p.authorSub), [BOB]);
  assert.equal((await store.listComments(bobPost)).length, 0);
  assert.equal((await store.listComments(bobPost, { includeHidden: true })).length, 1);
  assert.equal((await store.getPost(bobPost)).commentCount, 0, 'hidden comments are not counted');
  assert.deepEqual(await store.setMemberHidden(ALICE, true), { posts: 1, comments: 0 }, 'hiding twice changes nothing');

  assert.deepEqual(await store.setMemberHidden(ALICE, false), { posts: 1, comments: 1 });
  assert.equal((await store.listFeed()).posts.length, 2);
  assert.equal((await store.listComments(bobPost)).length, 1);
  assert.equal((await store.getPost(bobPost)).commentCount, 1);
});

test('store: delete-all, submissions and audit', async () => {
  const store = newStore();
  await store.putProfile(ALICE, { displayName: 'Alice' });
  await store.touchAccount(ALICE, '2026-11-01T10:00:00.000Z');
  await store.putObservation(ALICE, { id: 'obs001', title: 'Moon' });
  assert.equal(await store.deleteUserItems(ALICE), 3);
  assert.equal(await store.getProfile(ALICE), undefined);

  const s = { id: 'sub001', type: 'book', title: 'Cosmos', summary: 'A classic book', track: 'astro', status: 'approved', authorSub: ALICE, authorName: 'Alice', createdAt: '2026-10-01T00:00:00.000Z' };
  await store.putSubmission(s);
  await store.anonymiseSubmission(s);
  const after = await store.getSubmission('sub001');
  assert.equal(after.authorName, 'A former member');
  assert.equal(after.authorSub, 'deleted');
  assert.equal((await store.listSubmissionsByUser(ALICE)).length, 0);
  await store.deleteSubmission('sub001');
  assert.equal(await store.getSubmission('sub001'), undefined);

  await store.putAudit({ id: 'a1', at: '2026-11-01T10:00:00.000Z', actorSub: BOB, action: 'suspend', targetSub: ALICE, reason: '', detail: {} });
  await store.putAudit({ id: 'a2', at: '2026-11-02T10:00:00.000Z', actorSub: BOB, action: 'reset-password', targetSub: BOB, reason: '', detail: {} });
  assert.deepEqual((await store.listAudit()).map((a) => a.id), ['a2', 'a1']);
  assert.deepEqual((await store.listAudit({ targetSub: ALICE })).map((a) => a.id), ['a1']);
});

test('store: reindex adds author keys to items written before them, and is idempotent', async () => {
  const send = createFakeDynamo();
  const store = createStore({ send, table: 'test' });
  // An "old" post, comment and like, written without GSI2 keys
  const postId = `experiment~${BOB}~old`;
  await send('Put', { TableName: 'test', Item: { PK: `POST#${postId}`, SK: 'META', entity: 'post', ...post(BOB, 'old', '2026-01-01T00:00:00.000Z'), likeCount: 1, commentCount: 1, GSI1PK: 'FEED', GSI1SK: `2026-01-01T00:00:00.000Z#${postId}` } });
  await send('Put', { TableName: 'test', Item: { PK: `POST#${postId}`, SK: 'CMT#20260102000000000-c1', entity: 'comment', id: 'c1', authorSub: ALICE, authorName: 'Alice', body: 'x', createdAt: '2026-01-02T00:00:00.000Z' } });
  await send('Put', { TableName: 'test', Item: { PK: `POST#${postId}`, SK: `LIKE#${ALICE}`, entity: 'like', sub: ALICE, at: '2026-01-03T00:00:00.000Z' } });
  assert.equal((await store.memberComments(ALICE)).length, 0);

  const posts = await store.listAllPosts();
  assert.equal(posts.length, 1);
  assert.deepEqual(await store.reindexPost(postId), { posts: 1, comments: 1, likes: 1 });
  assert.deepEqual(await store.reindexPost(postId), { posts: 1, comments: 1, likes: 1 });
  assert.equal((await store.memberPosts(BOB)).length, 1);
  assert.equal((await store.memberComments(ALICE)).length, 1);
  assert.equal((await store.memberLikes(ALICE)).length, 1);
});

const OWNER = '33333333-cccc-4ccc-8ccc-333333333333';
const AS = {
  alice: { sub: ALICE },
  bob: { sub: BOB },
  owner: { sub: OWNER, groups: '[admins]' },
};

function setupApp() {
  let t = Date.parse('2026-11-03T09:00:00Z');
  let n = 0;
  const cognito = createFakeCognito();
  cognito.addUser({ sub: ALICE, email: 'alice@example.com', createdAt: '2026-10-30T10:00:00.000Z' });
  cognito.addUser({ sub: BOB, email: 'bob@example.com', createdAt: '2026-09-01T10:00:00.000Z' });
  cognito.addUser({ sub: OWNER, email: 'owner@example.com', groups: ['admins'], createdAt: '2026-08-01T10:00:00.000Z' });
  const store = createStore({ send: createFakeDynamo(), table: 'test' });
  const clock = { advance: (ms) => (t += ms) };
  const app = createApp({
    store,
    members: createMembers({ send: cognito, userPoolId: 'pool' }),
    ownerSub: OWNER,
    now: () => new Date((t += 1000)).toISOString(),
    makeId: () => `id${String(++n).padStart(6, '0')}`,
    log: { error() {} },
  });
  const call = async (method, path, { as, body } = {}) => {
    const [rawPath, qs] = path.split('?');
    const res = await app({
      rawPath,
      queryStringParameters: qs ? Object.fromEntries(new URLSearchParams(qs)) : undefined,
      requestContext: {
        http: { method },
        authorizer: as ? { jwt: { claims: { sub: as.sub, ...(as.groups ? { 'cognito:groups': as.groups } : {}) } } } : undefined,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.statusCode, data: res.body ? JSON.parse(res.body) : undefined };
  };
  // Alice and Bob each publish a write-up; Alice comments on and likes Bob's
  const seed = async () => {
    for (const [who, nameText] of [[AS.alice, 'Alice'], [AS.bob, 'Bob']]) {
      await call('PUT', '/api/me/profile', { as: who, body: { displayName: nameText } });
    }
    await call('PUT', '/api/me/progress/weigh-jupiter', { as: AS.alice, body: { kind: 'experiment', title: 'Weigh Jupiter', status: 'done', notes: 'Jupiter is heavy', published: true } });
    await call('PUT', '/api/me/progress/time-a-pendulum', { as: AS.bob, body: { kind: 'experiment', title: 'Time a pendulum', status: 'done', notes: 'Tick tock', published: true } });
    const bobPost = `experiment~${BOB}~time-a-pendulum`;
    await call('POST', `/api/posts/${bobPost}/comments`, { as: AS.alice, body: { body: 'Nice!' } });
    await call('POST', `/api/posts/${bobPost}/like`, { as: AS.alice });
    return { alicePost: `experiment~${ALICE}~weigh-jupiter`, bobPost };
  };
  return { call, store, cognito, clock, seed };
}

test('GET /api/me records last seen at most once a day', async () => {
  const { call, store, clock } = setupApp();
  await call('GET', '/api/me', { as: AS.alice });
  const first = (await store.getAccount(ALICE)).lastSeenAt;
  await call('GET', '/api/me', { as: AS.alice });
  assert.equal((await store.getAccount(ALICE)).lastSeenAt, first, 'same day: no new write');
  clock.advance(24 * 3600 * 1000);
  await call('GET', '/api/me', { as: AS.alice });
  assert.notEqual((await store.getAccount(ALICE)).lastSeenAt, first);
});

test('a suspended member cannot write, but can still read', async () => {
  const { call, store } = setupApp();
  await call('PUT', '/api/me/profile', { as: AS.alice, body: { displayName: 'Alice' } });
  await store.setSuspended(ALICE, true, '2026-11-03T09:00:00.000Z');
  const r = await call('PUT', '/api/me/profile', { as: AS.alice, body: { displayName: 'Alice 2' } });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, 'Your account is suspended');
  assert.equal((await call('GET', '/api/me', { as: AS.alice })).status, 200);
});
