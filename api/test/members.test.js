// api/test/members.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeCognito } from '../src/fake-cognito.js';
import { createMembers } from '../src/members.js';

const A = '11111111-aaaa-4aaa-8aaa-111111111111';
const B = '22222222-bbbb-4bbb-8bbb-222222222222';

function setup() {
  const send = createFakeCognito();
  send.addUser({ sub: A, email: 'alice@example.com', createdAt: '2026-10-01T10:00:00.000Z' });
  send.addUser({ sub: B, email: 'bob@example.com', groups: ['admins'], createdAt: '2026-10-02T10:00:00.000Z' });
  return { send, members: createMembers({ send, userPoolId: 'pool' }) };
}

test('list, search and find members', async () => {
  const { members } = setup();
  const all = await members.list({});
  assert.deepEqual(all.members.map((m) => m.email), ['alice@example.com', 'bob@example.com']);
  assert.equal(all.cursor, null);
  assert.deepEqual((await members.list({ q: 'bo' })).members.map((m) => m.sub), [B]);
  const alice = await members.find(A);
  assert.equal(alice.email, 'alice@example.com');
  assert.equal(alice.enabled, true);
  assert.equal(alice.createdAt, '2026-10-01T10:00:00.000Z');
  assert.equal(await members.find('33333333-cccc-4ccc-8ccc-333333333333'), null);
});

test('pages with a cursor', async () => {
  const { members } = setup();
  const first = await members.list({ limit: 1 });
  assert.equal(first.members.length, 1);
  assert.ok(first.cursor);
  const second = await members.list({ limit: 1, cursor: first.cursor });
  assert.equal(second.members[0].sub, B);
  assert.equal((await members.listAll()).length, 2);
});

test('search text cannot break out of the filter', async () => {
  const { members } = setup();
  assert.deepEqual((await members.list({ q: 'a" or sub ^= "' })).members, []);
});

test('admin actions', async () => {
  const { members, send } = setup();
  const alice = await members.find(A);
  await members.disable(alice.username);
  assert.equal((await members.find(A)).enabled, false);
  await members.enable(alice.username);
  assert.equal((await members.find(A)).enabled, true);
  await members.resetPassword(alice.username);
  assert.equal((await members.find(A)).status, 'RESET_REQUIRED');
  assert.deepEqual([...(await members.adminSubs())], [B]);
  await members.addAdmin(alice.username);
  assert.deepEqual([...(await members.adminSubs())].sort(), [A, B]);
  await members.removeAdmin(alice.username);
  assert.deepEqual([...(await members.adminSubs())], [B]);
  await members.signOut(alice.username);
  assert.equal(send.users.get(alice.username).signedOutAt > 0, true);
  await members.remove(alice.username);
  assert.equal(await members.find(A), null);
  await members.remove(alice.username); // already gone: not an error
});

test('Cognito errors become clear HTTP errors', async () => {
  const send = async () => {
    throw Object.assign(new Error('slow down'), { name: 'TooManyRequestsException' });
  };
  const members = createMembers({ send, userPoolId: 'pool' });
  await assert.rejects(members.list({}), { status: 429, message: 'AWS is busy, try again in a moment' });
  const broken = createMembers({ send: async () => { throw new Error('boom'); }, userPoolId: 'pool' });
  await assert.rejects(broken.find(A), { status: 502, message: "Couldn't reach the sign-in service" });
  const { members: m } = setup();
  await assert.rejects(m.disable('nobody'), { status: 404, message: 'Member not found' });
});
