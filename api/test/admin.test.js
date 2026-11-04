// api/test/admin.test.js
// Run with:  node --test api/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
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
  const reindex = () => call('POST', '/api/admin/maintenance/reindex', { as: AS.owner, body: {} });
  return { call, store, cognito, clock, seed, reindex };
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

test('admin routes are invisible to members and need a login', async () => {
  const { call } = setupApp();
  for (const [method, path] of [
    ['GET', '/api/admin/stats'],
    ['GET', '/api/admin/audit'],
    ['GET', '/api/admin/members'],
    ['GET', `/api/admin/members/${BOB}`],
    ['DELETE', `/api/admin/comments/experiment~${BOB}~x/20261103090000000-id000001`],
  ]) {
    assert.equal((await call(method, path)).status, 401, `${method} ${path} signed out`);
    assert.equal((await call(method, path, { as: AS.alice, body: {} })).status, 404, `${method} ${path} as member`);
  }
});

test('stats and the member list', async () => {
  const { call, seed } = setupApp();
  await seed();
  await call('GET', '/api/me', { as: AS.alice });
  const stats = (await call('GET', '/api/admin/stats', { as: AS.owner })).data;
  assert.deepEqual(stats, {
    members: 3,
    newLast7Days: 1,
    newLast30Days: 1,
    activeLast7Days: 1,
    activeLast30Days: 1,
    posts: 2,
    comments: 1,
    pendingSuggestions: 0,
  });

  const list = (await call('GET', '/api/admin/members', { as: AS.owner })).data;
  assert.deepEqual(
    list.members.map((m) => [m.email, m.displayName, m.isAdmin, m.isOwner, m.suspended]),
    [
      ['alice@example.com', 'Alice', false, false, false],
      ['bob@example.com', 'Bob', false, false, false],
      ['owner@example.com', '', true, true, false],
    ]
  );
  assert.ok(list.members.find((m) => m.sub === ALICE).lastSeenAt);
  assert.equal(list.members[0].username, undefined, 'internal Cognito username is not sent');
  assert.equal(list.members[0].isOwner, false);
  assert.deepEqual((await call('GET', '/api/admin/members?q=ALI', { as: AS.owner })).data.members.map((m) => m.sub), [ALICE]);
});

test('member page shows counts, posts, comments and history', async () => {
  const { call, seed } = setupApp();
  const { bobPost } = await seed();
  const r = await call('GET', `/api/admin/members/${ALICE}`, { as: AS.owner });
  assert.equal(r.status, 200);
  const m = r.data.member;
  assert.equal(m.email, 'alice@example.com');
  assert.equal(m.displayName, 'Alice');
  assert.deepEqual(r.data.counts, { experimentsDone: 1, observations: 0, posts: 1, comments: 1, likes: 1 });
  assert.equal(r.data.posts[0].itemId, 'weigh-jupiter');
  assert.equal(r.data.comments[0].postId, bobPost);
  assert.deepEqual(r.data.history, []);
  assert.equal((await call('GET', '/api/admin/members/not-a-sub', { as: AS.owner })).status, 400);
  assert.equal((await call('GET', '/api/admin/members/44444444-dddd-4ddd-8ddd-444444444444', { as: AS.owner })).status, 404);
});

test('admin can remove any comment, and it is logged', async () => {
  const { call, seed } = setupApp();
  const { bobPost } = await seed();
  const { comments } = (await call('GET', `/api/admin/members/${ALICE}`, { as: AS.owner })).data;
  const r = await call('DELETE', `/api/admin/comments/${bobPost}/${comments[0].commentId}`, { as: AS.owner, body: { reason: 'spam' } });
  assert.equal(r.status, 200);
  assert.equal((await call('GET', `/api/posts/${bobPost}/comments`)).data.comments.length, 0);
  const audit = (await call('GET', '/api/admin/audit', { as: AS.owner })).data.entries;
  assert.equal(audit[0].action, 'remove-comment');
  assert.equal(audit[0].targetSub, ALICE);
  assert.equal(audit[0].reason, 'spam');
});

test('a hidden comment is not double-decremented when its author is later deleted', async () => {
  const { call, store, seed, reindex } = setupApp();
  const { bobPost } = await seed();
  await reindex();
  assert.equal((await store.getPost(bobPost)).commentCount, 1);
  await call('POST', `/api/admin/members/${ALICE}/suspend`, { as: AS.owner, body: {} });
  assert.equal((await store.getPost(bobPost)).commentCount, 0, 'hiding already decremented it');
  const del = await call('DELETE', `/api/admin/members/${ALICE}`, { as: AS.owner, body: { confirmEmail: 'alice@example.com' } });
  assert.equal(del.status, 200);
  assert.equal((await store.getPost(bobPost)).commentCount, 0, 'deleting the hidden comment must not decrement again');
});

test('admin removing an already-hidden comment leaves the count unchanged', async () => {
  const { call, store, seed, reindex } = setupApp();
  const { bobPost } = await seed();
  await reindex();
  await call('POST', `/api/admin/members/${ALICE}/suspend`, { as: AS.owner, body: {} });
  assert.equal((await store.getPost(bobPost)).commentCount, 0);
  const { comments } = (await call('GET', `/api/admin/members/${ALICE}`, { as: AS.owner })).data;
  const r = await call('DELETE', `/api/admin/comments/${bobPost}/${comments[0].commentId}`, { as: AS.owner, body: {} });
  assert.equal(r.status, 200);
  assert.equal((await store.getPost(bobPost)).commentCount, 0, 'removing a hidden comment does not decrement');
});

test('admin remove-comment reports 404 if the comment is already gone when deleting', async () => {
  const { call, store, seed } = setupApp();
  const { bobPost } = await seed();
  const { comments } = (await call('GET', `/api/admin/members/${ALICE}`, { as: AS.owner })).data;
  const realDeleteComment = store.deleteComment.bind(store);
  store.deleteComment = async () => false;
  const r = await call('DELETE', `/api/admin/comments/${bobPost}/${comments[0].commentId}`, { as: AS.owner, body: {} });
  assert.equal(r.status, 404);
  assert.equal(r.data.error, 'Comment not found');
  const audit = (await call('GET', '/api/admin/audit', { as: AS.owner })).data.entries;
  assert.equal(audit.length, 0, 'no audit entry when the comment was already gone by the time we tried to delete it');
  store.deleteComment = realDeleteComment;
});

test('action routes are invisible to members and need a login', async () => {
  const { call } = setupApp();
  for (const [method, path] of [
    ['POST', `/api/admin/members/${BOB}/suspend`],
    ['POST', `/api/admin/members/${BOB}/unsuspend`],
    ['POST', `/api/admin/members/${BOB}/reset-password`],
    ['POST', `/api/admin/members/${BOB}/admin`],
    ['DELETE', `/api/admin/members/${BOB}`],
    ['POST', '/api/admin/maintenance/reindex'],
  ]) {
    assert.equal((await call(method, path)).status, 401, `${method} ${path} signed out`);
    assert.equal((await call(method, path, { as: AS.alice, body: {} })).status, 404, `${method} ${path} as member`);
  }
});

test('owner protection and who can change admins', async () => {
  const { call, cognito } = setupApp();
  for (const path of [`/api/admin/members/${OWNER}/suspend`, `/api/admin/members/${OWNER}/admin`]) {
    const r = await call('POST', path, { as: AS.owner, body: { grant: false } });
    assert.equal(r.status, 403);
    assert.equal(r.data.error, "The owner account can't be changed here");
  }
  const del = await call('DELETE', `/api/admin/members/${OWNER}`, { as: AS.owner, body: { confirmEmail: 'owner@example.com' } });
  assert.equal(del.status, 403);

  // Bob is made an admin by the owner, but can't change admins himself
  assert.equal((await call('POST', `/api/admin/members/${BOB}/admin`, { as: AS.owner, body: { grant: true } })).status, 200);
  assert.ok(cognito.users.get(BOB).groups.has('admins'));
  const bobAdmin = { sub: BOB, groups: '[admins]' };
  const r = await call('POST', `/api/admin/members/${ALICE}/admin`, { as: bobAdmin, body: { grant: true } });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, 'Only the owner can change admins');
  const self = await call('POST', `/api/admin/members/${BOB}/suspend`, { as: bobAdmin, body: {} });
  assert.equal(self.data.error, "You can't do that to your own account");
  assert.equal((await call('POST', `/api/admin/members/${BOB}/admin`, { as: AS.owner, body: { grant: false } })).status, 200);
  assert.equal(cognito.users.get(BOB).groups.has('admins'), false);
});

test('a suspended admin is blocked from admin routes too', async () => {
  const { call, reindex } = setupApp();
  await reindex();
  assert.equal((await call('POST', `/api/admin/members/${BOB}/admin`, { as: AS.owner, body: { grant: true } })).status, 200);
  assert.equal((await call('POST', `/api/admin/members/${BOB}/suspend`, { as: AS.owner, body: {} })).status, 200);
  const bobAdmin = { sub: BOB, groups: '[admins]' };
  const r = await call('POST', `/api/admin/members/${ALICE}/reset-password`, { as: bobAdmin, body: {} });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, 'Your account is suspended');
});

test('suspend and delete require the member index to have been rebuilt first', async () => {
  const { call, seed, reindex } = setupApp();
  await seed();
  const beforeSuspend = await call('POST', `/api/admin/members/${ALICE}/suspend`, { as: AS.owner, body: {} });
  assert.equal(beforeSuspend.status, 409);
  assert.equal(beforeSuspend.data.error, 'Run "Rebuild member index" on the Dashboard first');
  const beforeDelete = await call('DELETE', `/api/admin/members/${ALICE}`, { as: AS.owner, body: { confirmEmail: 'alice@example.com' } });
  assert.equal(beforeDelete.status, 409);
  await reindex();
  assert.equal((await call('POST', `/api/admin/members/${ALICE}/suspend`, { as: AS.owner, body: {} })).status, 200);
});

test('reset-password protects the owner account except from the owner themselves', async () => {
  const { call } = setupApp();
  await call('POST', `/api/admin/members/${BOB}/admin`, { as: AS.owner, body: { grant: true } });
  const bobAdmin = { sub: BOB, groups: '[admins]' };
  const r = await call('POST', `/api/admin/members/${OWNER}/reset-password`, { as: bobAdmin, body: {} });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, "The owner account can't be changed here");
  const self = await call('POST', `/api/admin/members/${OWNER}/reset-password`, { as: AS.owner, body: {} });
  assert.equal(self.status, 200);
});

test('revoking admin signs the member out so the admin claim dies with their session', async () => {
  const { call, cognito } = setupApp();
  await call('POST', `/api/admin/members/${BOB}/admin`, { as: AS.owner, body: { grant: true } });
  assert.equal(cognito.users.get(BOB).signedOutAt, undefined);
  const r = await call('POST', `/api/admin/members/${BOB}/admin`, { as: AS.owner, body: { grant: false } });
  assert.equal(r.status, 200);
  assert.equal(r.data.note, 'They have been signed out');
  assert.ok(cognito.users.get(BOB).signedOutAt);
});

test("a deleted member's token can no longer write, even though it's still valid", async () => {
  const { call, seed, reindex } = setupApp();
  await seed();
  await reindex();
  const r = await call('DELETE', `/api/admin/members/${ALICE}`, { as: AS.owner, body: { confirmEmail: 'alice@example.com' } });
  assert.equal(r.status, 200);
  const put = await call('PUT', '/api/me/profile', { as: AS.alice, body: { displayName: 'Alice again' } });
  assert.equal(put.status, 403);
  assert.equal(put.data.error, 'Your account is suspended');
});

test('suspend and unsuspend audit a partial result when a step fails, with the right step name', async () => {
  const { call, store, cognito, seed, reindex } = setupApp();
  await seed();
  await reindex();
  const realSetSuspended = store.setSuspended.bind(store);
  store.setSuspended = async () => {
    throw new Error('dynamo down');
  };
  const r = await call('POST', `/api/admin/members/${ALICE}/suspend`, { as: AS.owner, body: {} });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { partial: true, step: 'mark-suspended' });
  assert.equal(cognito.users.get(ALICE).enabled, false, 'still disabled even though the suspend flag write failed');
  let entry = (await call('GET', '/api/admin/audit', { as: AS.owner })).data.entries[0];
  assert.deepEqual([entry.action, entry.detail.partial], ['suspend', 'mark-suspended']);
  store.setSuspended = realSetSuspended;

  assert.equal((await call('POST', `/api/admin/members/${ALICE}/suspend`, { as: AS.owner, body: {} })).status, 200);
  store.setMemberHidden = async () => {
    throw new Error('dynamo down');
  };
  const u = await call('POST', `/api/admin/members/${ALICE}/unsuspend`, { as: AS.owner, body: {} });
  assert.equal(u.status, 200);
  assert.deepEqual(u.data, { partial: true, step: 'show-content' });
  entry = (await call('GET', '/api/admin/audit', { as: AS.owner })).data.entries[0];
  assert.deepEqual([entry.action, entry.detail.partial], ['unsuspend', 'show-content']);
});

test('suspend hides content and blocks sign-in; unsuspend restores both', async () => {
  const { call, cognito, seed, reindex } = setupApp();
  const { bobPost } = await seed();
  await reindex();
  let r = await call('POST', `/api/admin/members/${ALICE}/suspend`, { as: AS.owner, body: { reason: 'cooling off' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { suspended: true, hidden: { posts: 1, comments: 1 } });
  assert.equal(cognito.users.get(ALICE).enabled, false);
  assert.ok(cognito.users.get(ALICE).signedOutAt);
  assert.deepEqual((await call('GET', '/api/feed')).data.posts.map((p) => p.authorSub), [BOB]);
  assert.equal((await call('GET', `/api/posts/${bobPost}/comments`)).data.comments.length, 0);
  assert.equal((await call('POST', `/api/posts/${bobPost}/comments`, { as: AS.alice, body: { body: 'again' } })).status, 403);
  assert.equal((await call('GET', `/api/admin/members/${ALICE}`, { as: AS.owner })).data.member.suspended, true);

  r = await call('POST', `/api/admin/members/${ALICE}/unsuspend`, { as: AS.owner, body: {} });
  assert.deepEqual(r.data, { suspended: false, shown: { posts: 1, comments: 1 } });
  assert.equal(cognito.users.get(ALICE).enabled, true);
  assert.equal((await call('GET', '/api/feed')).data.posts.length, 2);
  assert.equal((await call('GET', `/api/posts/${bobPost}/comments`)).data.comments.length, 1);
  assert.equal((await call('POST', `/api/posts/${bobPost}/comments`, { as: AS.alice, body: { body: 'back' } })).status, 201);

  const actions = (await call('GET', '/api/admin/audit', { as: AS.owner })).data.entries.map((a) => a.action);
  assert.deepEqual(actions.slice(0, 2), ['unsuspend', 'suspend']);
});

test('suspend reports a partial result when hiding content fails', async () => {
  const { call, store, seed, reindex } = setupApp();
  await seed();
  await reindex();
  store.setMemberHidden = async () => {
    throw new Error('dynamo down');
  };
  const r = await call('POST', `/api/admin/members/${ALICE}/suspend`, { as: AS.owner, body: {} });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { partial: true, step: 'hide-content' });
  assert.equal((await store.getAccount(ALICE)).suspended, true, 'sign-in is still blocked');
  const entry = (await call('GET', '/api/admin/audit', { as: AS.owner })).data.entries[0];
  assert.deepEqual([entry.action, entry.detail.partial], ['suspend', 'hide-content']);
});

test('reset password', async () => {
  const { call, cognito } = setupApp();
  assert.equal((await call('POST', `/api/admin/members/${ALICE}/reset-password`, { as: AS.owner, body: {} })).status, 200);
  assert.equal(cognito.users.get(ALICE).status, 'RESET_REQUIRED');
});

test('delete removes every trace of a member and keeps counts right', async () => {
  const { call, store, cognito, seed, reindex } = setupApp();
  const { bobPost } = await seed();
  await reindex();
  await call('POST', '/api/me/observations', { as: AS.alice, body: { title: 'The Moon' } });
  await call('POST', '/api/submissions', { as: AS.alice, body: { type: 'book', title: 'Cosmos', summary: 'A classic book about space', track: 'astro', link: 'https://example.com/cosmos' } });
  await call('POST', '/api/submissions', { as: AS.alice, body: { type: 'book', title: 'Pale Blue Dot', summary: 'Another classic book', track: 'astro', link: 'https://example.com/pbd' } });
  const subs = (await call('GET', '/api/me/submissions', { as: AS.alice })).data.submissions;
  await call('POST', `/api/admin/submissions/${subs[0].id}/review`, { as: AS.owner, body: { decision: 'approve' } });

  const wrong = await call('DELETE', `/api/admin/members/${ALICE}`, { as: AS.owner, body: { confirmEmail: 'bob@example.com' } });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.data.error, "confirmEmail: doesn't match this member's email");

  const r = await call('DELETE', `/api/admin/members/${ALICE}`, { as: AS.owner, body: { confirmEmail: 'Alice@Example.com', reason: 'asked to leave' } });
  assert.equal(r.status, 200);
  // items: PROFILE, PROG#weigh-jupiter, OBS#… (no ACCOUNT: the seed never calls GET /api/me)
  assert.deepEqual(r.data, { deleted: true, removed: { posts: 1, comments: 1, likes: 1, submissions: 1, anonymised: 1, items: 3 } });

  assert.equal(cognito.users.has(ALICE), false);
  assert.equal(await store.getProfile(ALICE), undefined);
  assert.deepEqual((await call('GET', '/api/feed')).data.posts.map((p) => p.authorSub), [BOB]);
  const bob = (await call('GET', `/api/posts/${bobPost}`)).data.post;
  assert.deepEqual([bob.likeCount, bob.commentCount], [0, 0]);
  const library = (await call('GET', '/api/library')).data.items;
  assert.deepEqual(library.map((i) => i.contributor), ['A former member']);
  const entry = (await call('GET', '/api/admin/audit', { as: AS.owner })).data.entries[0];
  assert.deepEqual([entry.action, entry.targetSub, entry.reason], ['delete', ALICE, 'asked to leave']);
  assert.equal((await call('GET', `/api/admin/members/${ALICE}`, { as: AS.owner })).status, 404);
});

test('a delete that failed part-way can be run again', async () => {
  const { call, cognito, seed, reindex } = setupApp();
  await seed();
  await reindex();
  const realRemove = cognito.users.delete.bind(cognito.users);
  let fail = true;
  cognito.users.delete = (k) => {
    if (fail) throw Object.assign(new Error('nope'), { name: 'InternalErrorException' });
    return realRemove(k);
  };
  const first = await call('DELETE', `/api/admin/members/${ALICE}`, { as: AS.owner, body: { confirmEmail: 'alice@example.com' } });
  assert.equal(first.status, 502);
  assert.equal(first.data.step, 'remove-login');
  const entry = (await call('GET', '/api/admin/audit', { as: AS.owner })).data.entries[0];
  assert.equal(entry.action, 'delete');
  assert.equal(entry.detail.partial, 'remove-login');
  fail = false;
  const second = await call('DELETE', `/api/admin/members/${ALICE}`, { as: AS.owner, body: { confirmEmail: 'alice@example.com' } });
  assert.equal(second.status, 200);
  assert.equal(cognito.users.has(ALICE), false);
});

test('a delete that fails on a store step is reported with that step, and can be re-run', async () => {
  const { call, store, cognito, seed, reindex } = setupApp();
  await seed();
  await reindex();
  const realDeleteUserItems = store.deleteUserItems.bind(store);
  let fail = true;
  store.deleteUserItems = async (sub) => {
    if (fail) throw new Error('dynamo down');
    return realDeleteUserItems(sub);
  };
  const first = await call('DELETE', `/api/admin/members/${ALICE}`, { as: AS.owner, body: { confirmEmail: 'alice@example.com' } });
  assert.equal(first.status, 500);
  assert.equal(first.data.step, 'user-items');
  assert.equal(first.data.error, 'Delete stopped part-way — run it again to finish');
  fail = false;
  const second = await call('DELETE', `/api/admin/members/${ALICE}`, { as: AS.owner, body: { confirmEmail: 'alice@example.com' } });
  assert.equal(second.status, 200);
  assert.equal(cognito.users.has(ALICE), false);
});

test('reindex is idempotent and admin-only', async () => {
  const { call, seed } = setupApp();
  await seed();
  const a = await call('POST', '/api/admin/maintenance/reindex', { as: AS.owner, body: {} });
  assert.equal(a.status, 200);
  assert.deepEqual(a.data, { posts: 2, comments: 1, likes: 1 });
  assert.deepEqual((await call('POST', '/api/admin/maintenance/reindex', { as: AS.owner, body: {} })).data, a.data);
});

test('admin console bundle is one valid module, only for admins', async () => {
  const { call } = setupApp();
  assert.equal((await call('GET', '/api/admin/console', { as: AS.alice })).status, 404);
  const { code } = (await call('GET', '/api/admin/console', { as: AS.owner })).data;
  assert.equal((code.match(/^import /gm) || []).length, 2, 'only imports.js imports');
  for (const name of ['renderDashboard', 'renderMembers', 'renderMember', 'renderSuggestions', 'route']) {
    assert.match(code, new RegExp(`function ${name}\\(`));
  }
  const file = join(mkdtempSync(join(tmpdir(), 'console-')), 'console.mjs');
  writeFileSync(file, code);
  execFileSync(process.execPath, ['--check', file]); // throws on a syntax error
});
