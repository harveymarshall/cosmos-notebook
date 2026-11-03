# Admin Members Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the site owner list, inspect, suspend, delete, reset and promote members, moderate one member's content, and see site stats from the existing admin console.

**Architecture:** A thin Cognito wrapper (`api/src/members.js`, injected `send` like `store.js`) plus an in-memory fake for tests; new admin routes in `api/src/admin-members.js` registered by `createApp`; per-author GSI2 keys on posts/comments/likes and a new `USER#<sub> / ACCOUNT` item (last seen, suspended) in the single DynamoDB table; the admin console split into several concatenated files with hash routing.

**Tech Stack:** Node.js 22 (ESM), `node:test`, AWS SDK v3 from the Lambda runtime (`@aws-sdk/client-cognito-identity-provider`), DynamoDB single table, Terraform (AWS provider 6), vanilla browser JS.

**Spec:** `docs/superpowers/specs/2026-11-03-admin-members-design.md`

## Global Constraints

- No new npm dependencies. The API uses only the AWS SDK that ships with the `nodejs22.x` Lambda runtime.
- Admin routes answer **404** to non-admins (same as an unknown route); signed-out callers get **401**.
- Owner protection is server-side: suspend, delete and admin-revoke on `OWNER_SUB` → 403 `The owner account can't be changed here`; only the owner may grant/revoke admin → 403 `Only the owner can change admins`; an admin can't suspend/delete themselves → 403 `You can't do that to your own account`.
- Suspended members' writes → 403 `Your account is suspended`.
- Cognito errors: `UserNotFoundException` → 404 `Member not found`; `TooManyRequestsException` → 429 `AWS is busy, try again in a moment`; anything else → 502 `Couldn't reach the sign-in service`.
- The fake DynamoDB (`api/src/fake-dynamo.js`) supports only: key conditions `=` and `begins_with`, conditions `attribute_exists(PK)` / `attribute_not_exists(PK)`, `SET #a = :a, …` or a single `ADD x :n`. Every store method in this plan stays within that.
- Cognito permissions are scoped to the one user pool ARN; no create-user, set-password or pool-config actions.
- Every admin action writes an audit entry.
- Tests run with `npm test` (= `node --test api/test/*.test.js test/*.test.js`). All existing tests must keep passing.
- Commit after each task; messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Data model note (refines the spec)

`lastSeenAt` and `suspended` live on a separate item `USER#<sub> / ACCOUNT` (with `GSI1PK = MEMBERS`, `GSI1SK = <lastSeenAt>#<sub>`), not on `PROFILE`. Reason: `PUT /api/me/profile` rewrites the whole profile item, which would wipe those fields. Task 9 updates the spec table to match.

## File Structure

| File | Responsibility |
| --- | --- |
| `api/src/fake-cognito.js` (new) | In-memory Cognito user pool for tests and the dev server |
| `api/src/members.js` (new) | Cognito wrapper: list/find members, admin actions, error mapping |
| `api/src/store.js` (modify) | GSI2 author keys; ACCOUNT item; member queries; hide/unhide; delete-all; audit; reindex |
| `api/src/validate.js` (modify) | `SUB` and `COMMENT_ID` patterns |
| `api/src/app.js` (modify) | `members`/`ownerSub` inputs, last-seen on `/api/me`, suspended-write guard, hidden comments filtered, console bundling, registers admin routes |
| `api/src/admin-members.js` (new) | All new `/api/admin/...` routes |
| `api/index.mjs` (modify) | Real Cognito client wiring, env vars |
| `scripts/dev-server.js` (modify) | Fake Cognito so the admin panel works locally |
| `api/src/console/*.js` (split) | Admin UI: `imports.js`, `shared.js`, `dashboard.js`, `members.js`, `member.js`, `suggestions.js`, `main.js` |
| `web/js/pages/login.js` (modify) | "Password reset required" → reset step |
| `infra/terraform/api.tf`, `variables.tf`, `existing.auto.tfvars` (modify) | Cognito policy, env, timeout, `owner_sub` |
| `api/test/members.test.js` (new) | Unit tests for `members.js` + fake |
| `api/test/admin.test.js` (new) | Route tests for everything admin |

---

### Task 1: Fake Cognito and the members wrapper

**Files:**
- Create: `api/src/fake-cognito.js`
- Create: `api/src/members.js`
- Test: `api/test/members.test.js`

**Interfaces:**
- Produces: `createFakeCognito({ users } = {})` → `send(op, params)` with `send.addUser({ sub, email, groups?, createdAt? })` and `send.users` (Map by Username).
- Produces: `createMembers({ send, userPoolId })` → `{ list({ q, cursor, limit }), find(sub), listAll(), adminSubs(), disable(username), enable(username), signOut(username), resetPassword(username), addAdmin(username), removeAdmin(username), remove(username) }`. A member is `{ username, sub, email, enabled, status, createdAt }` (`createdAt` ISO string).

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test api/test/members.test.js`
Expected: FAIL — `Cannot find module '../src/fake-cognito.js'`.

- [ ] **Step 3: Write the fake**

```js
// api/src/fake-cognito.js
// A tiny in-memory stand-in for the Cognito user-pool admin API, used by tests and the dev
// server. It understands exactly the operations api/src/members.js uses, with the same
// error names, and the two ListUsers filters it sends: `sub = "…"` and `email ^= "…"`.

const err = (name, message = name) => Object.assign(new Error(message), { name });

export function createFakeCognito({ users = [] } = {}) {
  const pool = new Map(); // Username -> user
  let n = 0;

  const view = (u) => ({
    Username: u.Username,
    Attributes: [
      { Name: 'sub', Value: u.sub },
      { Name: 'email', Value: u.email },
    ],
    Enabled: u.enabled,
    UserStatus: u.status,
    UserCreateDate: new Date(u.createdAt),
  });
  const byName = (Username) => {
    const u = pool.get(Username);
    if (!u) throw err('UserNotFoundException', 'User does not exist.');
    return u;
  };
  const matches = (u, filter) => {
    if (!filter) return true;
    const m = filter.match(/^(sub|email)\s*(=|\^=)\s*"([^"]*)"$/);
    if (!m) throw err('InvalidParameterException', `fake-cognito: unsupported filter ${filter}`);
    const value = u[m[1]];
    return m[2] === '=' ? value === m[3] : value.startsWith(m[3]);
  };
  const page = (list, Limit = 60, PaginationToken) => {
    const start = PaginationToken ? Number(PaginationToken) : 0;
    const items = list.slice(start, start + Limit);
    const next = start + Limit < list.length ? String(start + Limit) : undefined;
    return { items, next };
  };

  const ops = {
    ListUsers({ Filter, Limit, PaginationToken }) {
      const list = [...pool.values()].filter((u) => matches(u, Filter)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const { items, next } = page(list, Limit, PaginationToken);
      return { Users: items.map(view), PaginationToken: next };
    },
    ListUsersInGroup({ GroupName, Limit, NextToken }) {
      const list = [...pool.values()].filter((u) => u.groups.has(GroupName));
      const { items, next } = page(list, Limit, NextToken);
      return { Users: items.map(view), NextToken: next };
    },
    AdminGetUser({ Username }) {
      const u = byName(Username);
      return { ...view(u), UserAttributes: view(u).Attributes };
    },
    AdminDisableUser({ Username }) {
      byName(Username).enabled = false;
      return {};
    },
    AdminEnableUser({ Username }) {
      byName(Username).enabled = true;
      return {};
    },
    AdminUserGlobalSignOut({ Username }) {
      byName(Username).signedOutAt = Date.now();
      return {};
    },
    AdminResetUserPassword({ Username }) {
      byName(Username).status = 'RESET_REQUIRED';
      return {};
    },
    AdminAddUserToGroup({ Username, GroupName }) {
      byName(Username).groups.add(GroupName);
      return {};
    },
    AdminRemoveUserFromGroup({ Username, GroupName }) {
      byName(Username).groups.delete(GroupName);
      return {};
    },
    AdminDeleteUser({ Username }) {
      byName(Username);
      pool.delete(Username);
      return {};
    },
  };

  const send = async (op, params = {}) => {
    if (!ops[op]) throw err('InvalidParameterException', `fake-cognito: unsupported operation ${op}`);
    return ops[op](params);
  };
  send.users = pool;
  send.addUser = ({ sub, email, groups = [], createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, ++n)).toISOString() }) => {
    const Username = sub; // pools with email sign-in use the sub as the Username
    pool.set(Username, { Username, sub, email: email.toLowerCase(), enabled: true, status: 'CONFIRMED', createdAt, groups: new Set(groups) });
  };
  for (const u of users) send.addUser(u);
  return send;
}
```

- [ ] **Step 4: Write the wrapper**

```js
// api/src/members.js
// Member accounts in Cognito, for the admin console. Speaks Cognito's admin API through a
// single `send(operation, params)` function (like store.js), so the same code runs against
// the AWS SDK in Lambda (../index.mjs) and the in-memory fake in tests (./fake-cognito.js).
import { HttpError } from './validate.js';

const ADMINS = 'admins';

const attr = (u, name) => (u.Attributes || u.UserAttributes || []).find((a) => a.Name === name)?.Value || '';
const toMember = (u) => ({
  username: u.Username,
  sub: attr(u, 'sub'),
  email: attr(u, 'email'),
  enabled: u.Enabled !== false,
  status: u.UserStatus || '',
  createdAt: new Date(u.UserCreateDate).toISOString(),
});
// Cognito filter values sit inside double quotes; drop anything that could end them.
const quote = (s) => String(s).replace(/["\\]/g, '');

function translate(error) {
  if (error instanceof HttpError) return error;
  if (error?.name === 'UserNotFoundException') return new HttpError(404, 'Member not found');
  if (error?.name === 'TooManyRequestsException') return new HttpError(429, 'AWS is busy, try again in a moment');
  return Object.assign(new HttpError(502, "Couldn't reach the sign-in service"), { cause: error });
}

export function createMembers({ send, userPoolId }) {
  const call = async (op, params) => {
    try {
      return await send(op, { UserPoolId: userPoolId, ...params });
    } catch (error) {
      throw translate(error);
    }
  };

  async function list({ q = '', cursor, limit = 60 } = {}) {
    const res = await call('ListUsers', {
      Limit: Math.min(Math.max(limit, 1), 60),
      ...(q ? { Filter: `email ^= "${quote(q.toLowerCase())}"` } : {}),
      ...(cursor ? { PaginationToken: cursor } : {}),
    });
    return { members: (res.Users || []).map(toMember), cursor: res.PaginationToken || null };
  }

  return {
    list,

    async find(sub) {
      const res = await call('ListUsers', { Filter: `sub = "${quote(sub)}"`, Limit: 1 });
      return res.Users?.length ? toMember(res.Users[0]) : null;
    },

    /** Every member (for stats). Stops at 10,000. */
    async listAll() {
      const all = [];
      let cursor;
      do {
        const pageRes = await list({ cursor });
        all.push(...pageRes.members);
        cursor = pageRes.cursor;
      } while (cursor && all.length < 10000);
      return all;
    },

    async adminSubs() {
      const subs = new Set();
      let NextToken;
      do {
        const res = await call('ListUsersInGroup', { GroupName: ADMINS, Limit: 60, ...(NextToken ? { NextToken } : {}) });
        for (const u of res.Users || []) subs.add(attr(u, 'sub'));
        NextToken = res.NextToken;
      } while (NextToken);
      return subs;
    },

    disable: (Username) => call('AdminDisableUser', { Username }),
    enable: (Username) => call('AdminEnableUser', { Username }),
    signOut: (Username) => call('AdminUserGlobalSignOut', { Username }),
    resetPassword: (Username) => call('AdminResetUserPassword', { Username }),
    addAdmin: (Username) => call('AdminAddUserToGroup', { Username, GroupName: ADMINS }),
    removeAdmin: (Username) => call('AdminRemoveUserFromGroup', { Username, GroupName: ADMINS }),

    /** Deletes the login. Already gone counts as done, so a retried delete can finish. */
    async remove(Username) {
      try {
        await call('AdminDeleteUser', { Username });
      } catch (error) {
        if (error.status !== 404) throw error;
      }
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test api/test/members.test.js`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add api/src/fake-cognito.js api/src/members.js api/test/members.test.js
git commit -m "Admin: Cognito members wrapper and in-memory fake

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Store — author index keys, account item, member queries

**Files:**
- Modify: `api/src/store.js` (header comment; `upsertPost`; `like`; `addComment`; `listComments`; new methods at the end of the returned object)
- Test: `api/test/admin.test.js` (new file; store-level tests now, route tests in later tasks)

**Interfaces:**
- Produces (store methods):
  - `getAccount(sub)` → `{ sub, lastSeenAt?, suspended?, suspendedAt? } | undefined`
  - `touchAccount(sub, at)` — sets `lastSeenAt` and the MEMBERS index keys, keeps `suspended`
  - `setSuspended(sub, suspended, at)`
  - `listAccounts()` → accounts with `lastSeenAt`, newest first (max 10,000)
  - `getProfiles(subs)` / `getAccounts(subs)` → `{ [sub]: item }`
  - `memberPosts(sub)` → posts (stripped, newest first)
  - `memberComments(sub)` → `[{ ...comment, postId, commentId }]`
  - `memberLikes(sub)` → `[{ postId, at }]`
  - `listComments(postId, { includeHidden = false } = {})`

- [ ] **Step 1: Write the failing test**

```js
// api/test/admin.test.js
// Run with:  node --test api/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { createFakeDynamo } from '../src/fake-dynamo.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test api/test/admin.test.js`
Expected: FAIL — `store.getAccount is not a function`.

- [ ] **Step 3: Add the index keys to new posts, likes and comments**

In `api/src/store.js`, update the layout comment at the top to:

```js
// Single-table layout (PK / SK, plus two indexes):
//   USER#<sub>   PROFILE                profile
//   USER#<sub>   ACCOUNT                last seen, suspended (GSI1: MEMBERS / <lastSeenAt>#<sub>)
//   USER#<sub>   PROG#<itemId>          progress on a library item
//   USER#<sub>   PATH#<pathId>          enrolment on a learning path (pace, skipped steps, checkpoints)
//   USER#<sub>   OBS#<id>               observing log entry
//   POST#<id>    META                   published write-up   (GSI1: FEED or FEED#HIDDEN / <publishedAt>#<id>,
//                                                             GSI2: USER#<author> / POST#<publishedAt>#<id>)
//   POST#<id>    LIKE#<sub>             a like               (GSI2: USER#<sub> / LIKE#<at>#<postId>)
//   POST#<id>    CMT#<createdAt>#<cid>  a comment            (GSI2: USER#<author> / CMT#<createdAt>#<postId>#<cid>)
//   SUB#<id>     META                   library submission   (GSI1: SUBSTATUS#<status> / <createdAt>,
//                                                             GSI2: USER#<sub> / SUB#<createdAt>)
//   AUDIT        <at>#<id>              admin action log
```

In `upsertPost`, inside the first `put(...)` item, after `GSI1SK: ...`, add:

```js
            GSI2PK: `USER#${post.authorSub}`,
            GSI2SK: `POST#${post.publishedAt}#${post.postId}`,
```

In `like`, replace the `Item:` line with:

```js
                Item: { PK: `POST#${postId}`, SK: `LIKE#${sub}`, entity: 'like', sub, at, postId, GSI2PK: `USER#${sub}`, GSI2SK: `LIKE#${at}#${postId}` },
```

In `addComment`, replace the `Put` line with:

```js
            {
              Put: {
                TableName: T,
                Item: {
                  PK: `POST#${postId}`,
                  SK: `CMT#${commentId}`,
                  entity: 'comment',
                  ...comment,
                  postId,
                  GSI2PK: `USER#${comment.authorSub}`,
                  GSI2SK: `CMT#${comment.createdAt}#${postId}#${commentId}`,
                },
              },
            },
```

Replace `listComments` with:

```js
    async listComments(postId, { includeHidden = false } = {}) {
      const items = await queryAll({
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': `POST#${postId}`, ':sk': 'CMT#' },
      });
      return items.filter((i) => includeHidden || !i.hidden).map((i) => ({ ...strip(i), commentId: i.SK.slice(4) }));
    },
```

- [ ] **Step 4: Add account and member-query methods**

Inside `createStore`, after `const del = ...`, add helpers:

```js
  const update = (Key, fields, extra = {}) =>
    send('Update', {
      TableName: T,
      Key,
      UpdateExpression: `SET ${Object.keys(fields).map((f, i) => `#f${i} = :v${i}`).join(', ')}`,
      ExpressionAttributeNames: Object.fromEntries(Object.keys(fields).map((f, i) => [`#f${i}`, f])),
      ExpressionAttributeValues: Object.fromEntries(Object.values(fields).map((v, i) => [`:v${i}`, v])),
      ...extra,
    });

  async function batchGet(keys) {
    const items = [];
    for (const group of chunk(keys, 100)) {
      let request = group;
      for (let attempt = 0; attempt < 5 && request && request.length; attempt++) {
        const res = await send('BatchGet', { RequestItems: { [T]: { Keys: request } } });
        items.push(...(res.Responses?.[T] || []));
        request = res.UnprocessedKeys?.[T]?.Keys;
      }
    }
    return items;
  }

  const byAuthor = (sub, prefix) =>
    queryAll(
      {
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :sk)',
        ExpressionAttributeValues: { ':pk': `USER#${sub}`, ':sk': prefix },
        ScanIndexForward: false,
      },
      5000
    );

  const bySub = (items) => Object.fromEntries(items.map((i) => [i.PK.slice(5), strip(i)]));
```

At the end of the returned object (after `listSubmissionsByUser`), add:

```js
    // ---------- accounts (last seen, suspended) ----------
    async getAccount(sub) {
      return strip(await get(`USER#${sub}`, 'ACCOUNT'));
    },
    async touchAccount(sub, at) {
      await update({ PK: `USER#${sub}`, SK: 'ACCOUNT' }, { entity: 'account', sub, lastSeenAt: at, GSI1PK: 'MEMBERS', GSI1SK: `${at}#${sub}` });
    },
    async setSuspended(sub, suspended, at) {
      await update({ PK: `USER#${sub}`, SK: 'ACCOUNT' }, { entity: 'account', sub, suspended, suspendedAt: suspended ? at : null });
    },
    /** Accounts that have been seen, most recent first. */
    async listAccounts() {
      return (
        await queryAll(
          { IndexName: 'GSI1', KeyConditionExpression: 'GSI1PK = :pk', ExpressionAttributeValues: { ':pk': 'MEMBERS' }, ScanIndexForward: false },
          10000
        )
      ).map(strip);
    },
    async getAccounts(subs) {
      return bySub(await batchGet(subs.map((s) => ({ PK: `USER#${s}`, SK: 'ACCOUNT' }))));
    },
    async getProfiles(subs) {
      return bySub(await batchGet(subs.map((s) => ({ PK: `USER#${s}`, SK: 'PROFILE' }))));
    },

    // ---------- one member's community activity (GSI2) ----------
    async memberPosts(sub) {
      return (await byAuthor(sub, 'POST#')).map(strip);
    },
    async memberComments(sub) {
      return (await byAuthor(sub, 'CMT#')).map((i) => ({ ...strip(i), postId: i.PK.slice(5), commentId: i.SK.slice(4) }));
    },
    async memberLikes(sub) {
      return (await byAuthor(sub, 'LIKE#')).map((i) => ({ postId: i.PK.slice(5), at: i.at }));
    },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — the 2 new store tests and every existing test.

- [ ] **Step 6: Commit**

```bash
git add api/src/store.js api/test/admin.test.js
git commit -m "Store: per-author index keys, account item, member queries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Store — hide/unhide, delete-all, audit, reindex

**Files:**
- Modify: `api/src/store.js` (new methods)
- Test: `api/test/admin.test.js` (append)

**Interfaces:**
- Consumes: Task 2 helpers `update`, `byAuthor`, `memberPosts`, `memberComments`.
- Produces:
  - `setMemberHidden(sub, hidden)` → `{ posts, comments }` (number changed)
  - `deleteUserItems(sub)` → number of `USER#<sub>` items removed
  - `deleteSubmission(id)`; `anonymiseSubmission(submission)`
  - `putAudit(entry)`; `listAudit({ limit = 50, targetSub } = {})` → newest first
  - `listAllPosts()` → every post (feed and hidden)
  - `reindexPost(postId)` → `{ posts, comments, likes }` items updated

- [ ] **Step 1: Write the failing test**

Append to `api/test/admin.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test api/test/admin.test.js`
Expected: FAIL — `store.setMemberHidden is not a function`.

- [ ] **Step 3: Implement**

Add to the returned object in `api/src/store.js`, after `memberLikes`:

```js
    /** Suspend/unsuspend: move a member's posts out of (or back into) the feed and hide
     *  (or show) their comments, keeping each post's commentCount equal to what's visible. */
    async setMemberHidden(sub, hidden) {
      const feed = hidden ? 'FEED#HIDDEN' : 'FEED';
      const posts = await byAuthor(sub, 'POST#');
      for (const p of posts) {
        await update({ PK: p.PK, SK: 'META' }, { GSI1PK: feed }, { ConditionExpression: 'attribute_exists(PK)' });
      }
      let comments = 0;
      for (const c of await byAuthor(sub, 'CMT#')) {
        if (!!c.hidden === hidden) continue;
        try {
          await send('TransactWrite', {
            TransactItems: [
              {
                Update: {
                  TableName: T,
                  Key: { PK: c.PK, SK: c.SK },
                  UpdateExpression: 'SET #h = :h',
                  ExpressionAttributeNames: { '#h': 'hidden' },
                  ExpressionAttributeValues: { ':h': hidden },
                  ConditionExpression: 'attribute_exists(PK)',
                },
              },
              {
                Update: {
                  TableName: T,
                  Key: { PK: c.PK, SK: 'META' },
                  UpdateExpression: 'ADD commentCount :n',
                  ExpressionAttributeValues: { ':n': hidden ? -1 : 1 },
                  ConditionExpression: 'attribute_exists(PK)',
                },
              },
            ],
          });
          comments++;
        } catch (err) {
          if (err.name !== 'TransactionCanceledException') throw err; // comment or post already gone
        }
      }
      return { posts: posts.length, comments };
    },

    /** Removes everything stored under USER#<sub>: profile, account, progress, paths, journal, observations. */
    async deleteUserItems(sub) {
      const items = await queryAll({ KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': `USER#${sub}` } }, 100000);
      for (const group of chunk(items, 25)) {
        let request = { [T]: group.map((i) => ({ DeleteRequest: { Key: { PK: i.PK, SK: i.SK } } })) };
        for (let attempt = 0; attempt < 5 && request && Object.keys(request).length; attempt++) {
          const res = await send('BatchWrite', { RequestItems: request });
          request = res.UnprocessedItems;
        }
      }
      return items.length;
    },

    async deleteSubmission(id) {
      await del(`SUB#${id}`, 'META');
    },
    /** Approved suggestions stay in the library after their author leaves, without their name. */
    async anonymiseSubmission(s) {
      await this.putSubmission({ ...s, authorSub: 'deleted', authorName: 'A former member' });
    },

    // ---------- audit log ----------
    async putAudit(entry) {
      await put({ PK: 'AUDIT', SK: `${entry.at}#${entry.id}`, entity: 'audit', ...entry });
    },
    async listAudit({ limit = 50, targetSub } = {}) {
      const items = await queryAll(
        { KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': 'AUDIT' }, ScanIndexForward: false },
        targetSub ? 2000 : limit
      );
      return items
        .map(strip)
        .filter((a) => !targetSub || a.targetSub === targetSub)
        .slice(0, limit);
    },

    // ---------- one-off: rebuild the per-author index for items written before it existed ----------
    async listAllPosts() {
      const all = [];
      for (const pk of ['FEED', 'FEED#HIDDEN']) {
        all.push(
          ...(await queryAll({ IndexName: 'GSI1', KeyConditionExpression: 'GSI1PK = :pk', ExpressionAttributeValues: { ':pk': pk } }, 100000)).map(strip)
        );
      }
      return all;
    },
    async reindexPost(postId) {
      const items = await queryAll({ KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': `POST#${postId}` } }, 100000);
      const counts = { posts: 0, comments: 0, likes: 0 };
      for (const i of items) {
        const key = { PK: i.PK, SK: i.SK };
        if (i.SK === 'META') {
          await update(key, { GSI2PK: `USER#${i.authorSub}`, GSI2SK: `POST#${i.publishedAt}#${postId}` });
          counts.posts++;
        } else if (i.SK.startsWith('CMT#')) {
          await update(key, { postId, GSI2PK: `USER#${i.authorSub}`, GSI2SK: `CMT#${i.createdAt}#${postId}#${i.SK.slice(4)}` });
          counts.comments++;
        } else if (i.SK.startsWith('LIKE#')) {
          await update(key, { postId, GSI2PK: `USER#${i.sub}`, GSI2SK: `LIKE#${i.at}#${postId}` });
          counts.likes++;
        }
      }
      return counts;
    },
```

Note: `anonymiseSubmission` uses `this.putSubmission`, so it must be a method (`async anonymiseSubmission(s) {…}`), not an arrow function.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/store.js api/test/admin.test.js
git commit -m "Store: hide/unhide a member, delete-all, audit log, reindex

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: App wiring — inputs, last seen, suspended writes, hidden comments

**Files:**
- Modify: `api/src/validate.js` (add `SUB`, `COMMENT_ID`)
- Modify: `api/src/app.js`
- Create: `api/src/admin-members.js` (empty registration function for now)
- Test: `api/test/admin.test.js` (append; adds the shared route-test harness)

**Interfaces:**
- Produces: `createApp({ store, members, ownerSub = '', now, makeId, log })`.
- Produces: route option `admin: true` — the dispatcher returns 404 for non-admins before running the handler, and skips the suspended check.
- Produces: `registerAdminMembers({ route, store, members, ownerSub, now, makeId, log })` in `api/src/admin-members.js`.
- Produces (validate.js): `SUB = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`, `COMMENT_ID = /^\d{8,20}-[A-Za-z0-9_-]{6,64}$/`.

- [ ] **Step 1: Write the failing test**

Append to `api/test/admin.test.js` (add these imports at the top of the file with the others):

```js
import { createApp } from '../src/app.js';
import { createFakeCognito } from '../src/fake-cognito.js';
import { createMembers } from '../src/members.js';
```

Then append:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test api/test/admin.test.js`
Expected: FAIL — the suspended write returns 200, and `lastSeenAt` is undefined.

- [ ] **Step 3: Add the patterns to validate.js**

After `POST_ID` in `api/src/validate.js`:

```js
export const SUB = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i; // Cognito user ids
export const COMMENT_ID = /^\d{8,20}-[A-Za-z0-9_-]{6,64}$/;
```

- [ ] **Step 4: Create the admin routes module (empty for now)**

```js
// api/src/admin-members.js
// Admin console routes for managing members: stats, the member list and page, suspend,
// delete, password reset, admin rights, removing comments, and the audit log.
// Every route is registered with { auth: true, admin: true }: the dispatcher in app.js
// answers 404 to anyone who isn't an admin before the handler runs.

export function registerAdminMembers({ route, store, members, ownerSub, now, makeId, log }) {}
```

- [ ] **Step 5: Wire app.js**

In `api/src/app.js`:

1. Update the import from `./validate.js` to include `COMMENT_ID`, and add:

```js
import { registerAdminMembers } from './admin-members.js';
```

2. Change the factory signature:

```js
export function createApp({ store, members, ownerSub = '', now = () => new Date().toISOString(), makeId = newId, log = console } = {}) {
```

3. Replace the `GET /api/me` route with:

```js
  route('GET', '/api/me', { auth: true }, async ({ user }) => {
    // "Last active" for the admin console: at most one write per member per day
    const account = await store.getAccount(user.sub);
    const time = now();
    if (!account?.lastSeenAt || account.lastSeenAt.slice(0, 10) < time.slice(0, 10)) await store.touchAccount(user.sub, time);
    return {
      user: { sub: user.sub, isAdmin: user.isAdmin },
      profile: (await store.getProfile(user.sub)) || null,
    };
  });
```

4. In `DELETE /api/posts/:postId/comments/:commentId`, replace the inline regex with `COMMENT_ID`:

```js
    const commentId = param(params.commentId, COMMENT_ID, 'commentId');
```

5. Just before `// ---------- dispatcher ----------`, add:

```js
  registerAdminMembers({ route, store, members, ownerSub, now, makeId, log });
```

6. In the dispatcher, replace

```js
        if (r.auth && !user) throw new HttpError(401, 'Please log in');
```

with

```js
        if (r.auth && !user) throw new HttpError(401, 'Please log in');
        if (r.admin) canSeeAdmin(user);
        // A suspended member's sign-in can outlive the sign-out by up to an hour, so every
        // write checks the account too.
        else if (r.auth && method !== 'GET' && (await store.getAccount(user.sub))?.suspended) {
          throw new HttpError(403, 'Your account is suspended');
        }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — including all existing `api.test.js` tests (they call `createApp` without `members`, which is fine because no admin-member route runs).

- [ ] **Step 7: Commit**

```bash
git add api/src/validate.js api/src/app.js api/src/admin-members.js api/test/admin.test.js
git commit -m "API: last seen, suspended members can't write, admin route flag

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Admin routes — stats, audit, member list and page, remove comment

**Files:**
- Modify: `api/src/admin-members.js`
- Test: `api/test/admin.test.js` (append)

**Interfaces:**
- Consumes: Task 1 `members.*`; Task 2/3 store methods; Task 4 `route(..., { auth: true, admin: true }, fn)`.
- Produces: routes `GET /api/admin/stats`, `GET /api/admin/audit`, `GET /api/admin/members`, `GET /api/admin/members/:sub`, `DELETE /api/admin/comments/:postId/:commentId`.
- Produces (for Task 6, same file): helpers `findMember(sub)`, `protect(user, member)`, `audit(user, action, targetSub, { reason, detail })`.

- [ ] **Step 1: Write the failing test**

Append to `api/test/admin.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test api/test/admin.test.js`
Expected: FAIL — admin routes return 404 for the owner too, and 404 (not 401) when signed out, because they aren't registered yet.

- [ ] **Step 3: Implement**

Replace `api/src/admin-members.js` with:

```js
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
```

Note: the dispatcher reads a DELETE body as JSON, so `{ reason }` works for DELETE too.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS .

- [ ] **Step 5: Commit**

```bash
git add api/src/admin-members.js api/test/admin.test.js
git commit -m "Admin API: stats, audit, member list and page, remove comment

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Admin routes — suspend, unsuspend, reset password, admin rights, delete, reindex

**Files:**
- Modify: `api/src/admin-members.js` (replace the `registerActions` stub)
- Test: `api/test/admin.test.js` (append)

**Interfaces:**
- Consumes: Task 5 `findMember`, `protect`, `audit`, `subOf`, `reasonOf`; Task 1 members actions; Task 3 store methods.
- Produces: routes `POST /api/admin/members/:sub/suspend`, `/unsuspend`, `/reset-password`, `/admin` (`{ grant: boolean }`), `DELETE /api/admin/members/:sub` (`{ confirmEmail }`), `POST /api/admin/maintenance/reindex`.

- [ ] **Step 1: Write the failing test**

Append to `api/test/admin.test.js`:

```js
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

test('suspend hides content and blocks sign-in; unsuspend restores both', async () => {
  const { call, cognito, seed } = setupApp();
  const { bobPost } = await seed();
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
  const { call, store, seed } = setupApp();
  await seed();
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
  const { call, store, cognito, seed } = setupApp();
  const { bobPost } = await seed();
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
  const { call, cognito, seed } = setupApp();
  await seed();
  const realRemove = cognito.users.delete.bind(cognito.users);
  let fail = true;
  cognito.users.delete = (k) => {
    if (fail) throw Object.assign(new Error('nope'), { name: 'InternalErrorException' });
    return realRemove(k);
  };
  const first = await call('DELETE', `/api/admin/members/${ALICE}`, { as: AS.owner, body: { confirmEmail: 'alice@example.com' } });
  assert.equal(first.status, 502);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test api/test/admin.test.js`
Expected: FAIL — action routes return 404 for the owner.

- [ ] **Step 3: Implement**

In `api/src/admin-members.js`, replace `function registerActions() {}` with:

```js
function registerActions({ route, admin, store, members, ownerSub, now, log, subOf, reasonOf, findMember, protect, audit }) {
  route('POST', '/api/admin/members/:sub/suspend', admin, async ({ user, params, body }) => {
    const m = await findMember(subOf(params));
    protect(user, m);
    const reason = reasonOf(body);
    await members.disable(m.username);
    await members.signOut(m.username);
    await store.setSuspended(m.sub, true, now());
    try {
      const hidden = await store.setMemberHidden(m.sub, true);
      await audit(user, 'suspend', m.sub, { reason, detail: hidden });
      return { suspended: true, hidden };
    } catch (err) {
      log.error?.(err);
      await audit(user, 'suspend', m.sub, { reason, detail: { partial: 'hide-content' } });
      return { partial: true, step: 'hide-content' };
    }
  });

  route('POST', '/api/admin/members/:sub/unsuspend', admin, async ({ user, params, body }) => {
    const m = await findMember(subOf(params));
    protect(user, m);
    await members.enable(m.username);
    await store.setSuspended(m.sub, false, now());
    const shown = await store.setMemberHidden(m.sub, false);
    await audit(user, 'unsuspend', m.sub, { reason: reasonOf(body), detail: shown });
    return { suspended: false, shown };
  });

  route('POST', '/api/admin/members/:sub/reset-password', admin, async ({ user, params, body }) => {
    const m = await findMember(subOf(params));
    await members.resetPassword(m.username);
    await audit(user, 'reset-password', m.sub, { reason: reasonOf(body) });
    return { reset: true };
  });

  route('POST', '/api/admin/members/:sub/admin', admin, async ({ user, params, body }) => {
    const m = await findMember(subOf(params));
    if (ownerSub && m.sub === ownerSub) throw new HttpError(403, "The owner account can't be changed here");
    if (!ownerSub || user.sub !== ownerSub) throw new HttpError(403, 'Only the owner can change admins');
    const grant = body?.grant === true;
    await (grant ? members.addAdmin(m.username) : members.removeAdmin(m.username));
    await audit(user, grant ? 'grant-admin' : 'revoke-admin', m.sub, { reason: reasonOf(body) });
    return { isAdmin: grant, note: 'Takes effect the next time they sign in' };
  });

  // Each step is safe to repeat and the login goes last, so a failed delete can be re-run.
  route('DELETE', '/api/admin/members/:sub', admin, async ({ user, params, body }) => {
    const m = await findMember(subOf(params));
    protect(user, m);
    const confirm = str(body, 'confirmEmail', { required: true, max: 320 }).toLowerCase();
    if (confirm !== m.email.toLowerCase()) {
      throw new HttpError(400, "confirmEmail: doesn't match this member's email", { field: 'confirmEmail' });
    }
    const removed = { posts: 0, comments: 0, likes: 0, submissions: 0, anonymised: 0, items: 0 };
    for (const p of await store.memberPosts(m.sub)) {
      await store.deletePost(p.postId);
      removed.posts++;
    }
    for (const c of await store.memberComments(m.sub)) {
      await store.deleteComment(c.postId, c.commentId);
      removed.comments++;
    }
    for (const l of await store.memberLikes(m.sub)) {
      await store.unlike(l.postId, m.sub);
      removed.likes++;
    }
    for (const s of await store.listSubmissionsByUser(m.sub)) {
      if (s.status === 'approved') {
        await store.anonymiseSubmission(s);
        removed.anonymised++;
      } else {
        await store.deleteSubmission(s.id);
        removed.submissions++;
      }
    }
    removed.items = await store.deleteUserItems(m.sub);
    await members.remove(m.username);
    await audit(user, 'delete', m.sub, { reason: reasonOf(body), detail: removed });
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
    await audit(user, 'reindex', '', { detail: total });
    return total;
  });
}
```

Notes for the implementer:
- The `'a delete that failed part-way'` test simulates Cognito failing by patching `cognito.users.delete`; `fake-cognito`'s `AdminDeleteUser` calls `pool.delete`, so the patch throws inside `send`, which `members.js` turns into a 502.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/admin-members.js api/test/admin.test.js
git commit -m "Admin API: suspend, unsuspend, reset password, admin rights, delete, reindex

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Lambda, dev server and Terraform wiring

**Files:**
- Modify: `api/index.mjs`
- Modify: `scripts/dev-server.js`
- Modify: `infra/terraform/api.tf`, `infra/terraform/variables.tf`, `infra/terraform/existing.auto.tfvars`
- Test: `api/test/admin.test.js` (append a smoke test of the Lambda entry wiring is not possible without AWS; instead `node --check` + `terraform fmt` in CI)

**Interfaces:**
- Consumes: `createMembers`, `createFakeCognito`, `createApp({ members, ownerSub })`.
- Produces: Lambda env `USER_POOL_ID`, `OWNER_SUB`; Terraform variable `owner_sub`.

- [ ] **Step 1: Wire the Lambda entry**

In `api/index.mjs`, after the DynamoDB imports add:

```js
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
  AdminGetUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminDeleteUserCommand,
  AdminUserGlobalSignOutCommand,
  AdminResetUserPasswordCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { createMembers } from './src/members.js';
```

Replace the `const app = createApp(...)` line with:

```js
const COGNITO = {
  ListUsers: ListUsersCommand,
  ListUsersInGroup: ListUsersInGroupCommand,
  AdminGetUser: AdminGetUserCommand,
  AdminDisableUser: AdminDisableUserCommand,
  AdminEnableUser: AdminEnableUserCommand,
  AdminDeleteUser: AdminDeleteUserCommand,
  AdminUserGlobalSignOut: AdminUserGlobalSignOutCommand,
  AdminResetUserPassword: AdminResetUserPasswordCommand,
  AdminAddUserToGroup: AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroup: AdminRemoveUserFromGroupCommand,
};
const cognito = new CognitoIdentityProviderClient({});
const cognitoSend = (op, params) => cognito.send(new COGNITO[op](params));

const app = createApp({
  store: createStore({ send, table: process.env.TABLE_NAME }),
  members: createMembers({ send: cognitoSend, userPoolId: process.env.USER_POOL_ID }),
  ownerSub: process.env.OWNER_SUB || '',
});
```

Run: `node --check api/index.mjs`
Expected: no output (syntax OK). (Importing it would need the AWS SDK, which only exists in Lambda.)

- [ ] **Step 2: Wire the dev server**

The dev server keeps its pretend accounts in `.dev-data/users.json` (`users[email] = { sub, groups, … }`), and the first account is an admin. The admin console's member tools use a fake Cognito pool filled from that file, with the first admin as owner. (Suspending someone locally blocks their writes but not their dev login, which doesn't go through the fake pool. That's fine for trying the console.)

In `scripts/dev-server.js`, add imports next to the existing ones:

```js
import { createFakeCognito } from '../api/src/fake-cognito.js';
import { createMembers } from '../api/src/members.js';
```

Delete the line

```js
const app = createApp({ store: createStore({ send: createFakeDynamo({ file: join(DATA, 'db.json') }), table: 'dev' }) });
```

and, directly after `const saveUsers = ...` in the "pretend Cognito" block, add:

```js
// ---------- API with a local database (after the accounts, so the console can list them) ----------
const devCognito = createFakeCognito();
for (const [email, u] of Object.entries(users)) devCognito.addUser({ sub: u.sub, email, groups: u.groups || [] });
const app = createApp({
  store: createStore({ send: createFakeDynamo({ file: join(DATA, 'db.json') }), table: 'dev' }),
  members: createMembers({ send: devCognito, userPoolId: 'dev' }),
  ownerSub: Object.values(users).find((u) => u.groups?.includes('admins'))?.sub || '',
});
```

Owner protection locally applies to the first admin as of server start. If you sign up the first account while the server runs, restart it once.

In the `SignUp` handler, right after `saveUsers();`, add:

```js
    devCognito.addUser({ sub: users[email].sub, email, groups: users[email].groups });
```

Run: `npm run dev` (Ctrl+C after it prints the URL). Expected: starts without errors.

- [ ] **Step 3: Terraform — owner variable**

Append to `infra/terraform/variables.tf`:

```hcl
variable "owner_sub" {
  description = "Cognito user id (sub) of the site owner. The admin console can't suspend, delete or demote this account, and only it can grant admin. Set in existing.auto.tfvars."
  type        = string
  default     = ""

  validation {
    condition     = var.owner_sub == "" || can(regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", var.owner_sub))
    error_message = "owner_sub must be a Cognito user id like 1a2b3c4d-...."
  }
}
```

Find the owner's sub (the user is the only member of `admins`). Ask the user to run, or run with their explicit OK using the `cosmos` profile:

```bash
AWS_PROFILE=cosmos aws cognito-idp list-users-in-group --region eu-west-2 \
  --user-pool-id "$(AWS_PROFILE=cosmos aws cognito-idp list-user-pools --region eu-west-2 --max-results 10 --query "UserPools[?Name=='cosmos-notebook-members'].Id" --output text)" \
  --group-name admins --query 'Users[].Attributes[?Name==`sub`].Value' --output text
```

Append to `infra/terraform/existing.auto.tfvars` (replace the value with the printed sub):

```hcl
# The site owner (protected in the admin console)
owner_sub = "<printed-sub>"
```

- [ ] **Step 4: Terraform — Cognito policy, env, timeout**

In `infra/terraform/api.tf`, add after the `api_table` role policy:

```hcl
# Member management for the admin console: this one user pool only, and nothing that
# creates users, sets passwords or changes the pool itself.
data "aws_iam_policy_document" "api_members" {
  statement {
    sid = "ManageMembers"
    actions = [
      "cognito-idp:ListUsers",
      "cognito-idp:ListUsersInGroup",
      "cognito-idp:AdminGetUser",
      "cognito-idp:AdminDisableUser",
      "cognito-idp:AdminEnableUser",
      "cognito-idp:AdminDeleteUser",
      "cognito-idp:AdminUserGlobalSignOut",
      "cognito-idp:AdminResetUserPassword",
      "cognito-idp:AdminAddUserToGroup",
      "cognito-idp:AdminRemoveUserFromGroup",
      "cognito-idp:AdminListGroupsForUser",
    ]
    resources = [aws_cognito_user_pool.members.arn]
  }
}

resource "aws_iam_role_policy" "api_members" {
  name   = "member-admin"
  role   = aws_iam_role.api.name
  policy = data.aws_iam_policy_document.api_members.json
}
```

In `aws_lambda_function.api`: change `timeout = 10` to `timeout = 29` (API Gateway HTTP API waits at most 30 s; deletes and reindex need more than 10), and replace the `environment` block with:

```hcl
  environment {
    variables = {
      TABLE_NAME   = aws_dynamodb_table.main.name
      USER_POOL_ID = aws_cognito_user_pool.members.id
      OWNER_SUB    = var.owner_sub
    }
  }
```

Run (if Terraform is installed locally; otherwise CI checks it): `terraform -chdir=infra/terraform fmt -check`
Expected: no output.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/index.mjs scripts/dev-server.js infra/terraform/api.tf infra/terraform/variables.tf infra/terraform/existing.auto.tfvars
git commit -m "Wire member admin into Lambda, dev server and Terraform

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Admin console UI

**Files:**
- Create: `api/src/console/imports.js`, `shared.js`, `dashboard.js`, `members.js`, `member.js`, `suggestions.js`, `main.js`
- Delete: `api/src/console/admin.js` (its content moves to `suggestions.js` + `imports.js`)
- Modify: `api/src/app.js` (console route bundles the files)
- Test: `api/test/admin.test.js` (append: bundle is a valid module and is admin-only)

**Interfaces:**
- Consumes: every `/api/admin/...` route from Tasks 5–6; `web/js/ui.js` (`render, $, $$, esc, requireLogin, showError, busy, toast, kindTag, fmtDate, timeAgo, renderMarkdown, params`); `web/js/api.js` (`get, post, api`).
- Produces: `CONSOLE_FILES` order in app.js: `['imports.js', 'shared.js', 'dashboard.js', 'members.js', 'member.js', 'suggestions.js', 'main.js']`. Only `imports.js` may contain `import` lines; the other files use those names and define plain functions.

- [ ] **Step 1: Write the failing test**

Append to `api/test/admin.test.js`:

```js
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

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
```

Move the four new `import` lines to the top of the file with the others.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test api/test/admin.test.js`
Expected: FAIL — `renderDashboard` not found.

- [ ] **Step 3: Bundle the console in app.js**

In `api/src/app.js`, replace the console route with:

```js
  // The console is several files joined into one module; only imports.js has import lines.
  const CONSOLE_FILES = ['imports.js', 'shared.js', 'dashboard.js', 'members.js', 'member.js', 'suggestions.js', 'main.js'];
  route('GET', '/api/admin/console', { auth: true }, async ({ user }) => {
    canSeeAdmin(user);
    consoleCode ??= CONSOLE_FILES.map((f) => readFileSync(new URL(`./console/${f}`, import.meta.url), 'utf8')).join('\n');
    return { code: consoleCode };
  });
```

- [ ] **Step 4: Write the console files**

`api/src/console/imports.js`:

```js
// The admin console. These files are NOT part of the public website: the API joins them
// (in the order listed in app.js) and sends them only to signed-in members of the Cognito
// "admins" group; web/js/admin-loader.js runs the result. Only this file imports; the
// others use these names. Imports use site-absolute paths; the loader makes them full URLs.
import { render, $, $$, esc, requireLogin, showError, busy, toast, kindTag, fmtDate, timeAgo, renderMarkdown, params } from '/js/ui.js';
import { get, post, api } from '/js/api.js';
```

`api/src/console/shared.js`:

```js
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
```

`api/src/console/dashboard.js`:

```js
// ---------- dashboard ----------
async function renderDashboard() {
  const [stats, { entries }] = await Promise.all([get('/admin/stats'), get('/admin/audit?limit=50')]);
  const tile = (n, label) => `<div class="adm-tile"><strong>${esc(String(n))}</strong><span>${esc(label)}</span></div>`;
  render(`
<header class="page-head"><h1>Admin</h1></header>
${tabs('dashboard')}
<div class="adm-tiles">
  ${tile(stats.members, 'Members')}
  ${tile(stats.newLast7Days, 'New this week')}
  ${tile(stats.newLast30Days, 'New this month')}
  ${tile(stats.activeLast7Days, 'Active 7 days')}
  ${tile(stats.activeLast30Days, 'Active 30 days')}
  ${tile(stats.posts, 'Posts')}
  ${tile(stats.comments, 'Comments')}
  ${tile(stats.pendingSuggestions, 'Suggestions waiting')}
</div>
<h2>Recent activity</h2>
${entries.length ? `<ul class="adm-list">${entries.map(auditLine).join('')}</ul>` : '<p class="muted">No admin actions yet.</p>'}
<h2>Maintenance</h2>
<form id="reindex" class="form">
  <p class="small">Run <strong>Rebuild member index</strong> once after this update, so posts, comments and likes written before it show up on member pages. Safe to run again.</p>
  <div class="form-error"></div>
  <button class="btn">Rebuild member index</button>
</form>`);
  $('#reindex').addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.target, async () => {
      const r = await post('/admin/maintenance/reindex', {});
      toast(`Indexed ${r.posts} posts, ${r.comments} comments, ${r.likes} likes`);
      renderDashboard();
    }).catch(() => {});
  });
}
```

`api/src/console/members.js`:

```js
// ---------- members list ----------
async function renderMembers() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '').get('q') || '';
  render(`
<header class="page-head"><h1>Members</h1></header>
${tabs('members')}
<form class="adm-search" id="search"><input name="q" type="search" placeholder="Search by email (start of address)" value="${esc(q)}"><button class="btn">Search</button></form>
<div class="table-wrap"><table class="adm-table"><thead><tr><th>Email</th><th>Name</th><th>Joined</th><th>Last active</th><th>Status</th></tr></thead><tbody id="rows"></tbody></table></div>
<p id="more"></p>`);
  $('#search').addEventListener('submit', (e) => {
    e.preventDefault();
    location.hash = `members?q=${encodeURIComponent(e.target.q.value.trim())}`;
  });
  let cursor = null;
  const load = async () => {
    const { members, cursor: next } = await get(`/admin/members?q=${encodeURIComponent(q)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    $('#rows').insertAdjacentHTML(
      'beforeend',
      members
        .map(
          (m) => `<tr><td><a href="#members/${esc(m.sub)}">${esc(m.email)}</a></td><td>${esc(m.displayName || '—')}</td><td>${esc(fmtDate(m.createdAt))}</td><td>${esc(when(m.lastSeenAt))}</td><td>${
            badges(m) || 'Active'
          }</td></tr>`
        )
        .join('')
    );
    if (!members.length && !cursor) $('#rows').innerHTML = '<tr><td colspan="5" class="muted">No members found.</td></tr>';
    cursor = next;
    $('#more').innerHTML = cursor ? '<button class="btn" id="load-more">Load more</button>' : '';
    if (cursor) $('#load-more').addEventListener('click', () => load().catch(showError));
  };
  await load();
}
```

`api/src/console/member.js`:

```js
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
```

`api/src/console/suggestions.js` — the old `admin.js` review queue, with the tabs bar and hash-based status. Copy `card(...)` verbatim from the current `api/src/console/admin.js` (lines 15–37, the `const card = (s, status) => ...` template), then:

```js
// ---------- suggestions (review queue) ----------
const STATUS_TABS = [
  ['pending', 'Waiting'],
  ['approved', 'Approved'],
  ['rejected', 'Not accepted'],
];

// const card = (s, status) => `...`;  ← paste the existing card template here unchanged

async function renderSuggestions() {
  const status = new URLSearchParams(location.hash.split('?')[1] || '').get('status') || 'pending';
  const { submissions } = await get(`/admin/submissions?status=${status}`);
  render(`
<header class="page-head"><h1>Review queue</h1><p class="lede">Check each suggestion is safe, accurate and useful before it joins the library. You can edit before approving.</p></header>
${tabs('suggestions')}
<nav class="filters">${STATUS_TABS.map(([k, label]) => `<a class="chip" aria-pressed="${k === status}" href="#suggestions?status=${k}">${label}</a>`).join('')}</nav>
${submissions.length ? submissions.map((s) => card(s, status)).join('') : `<p class="muted">Nothing here${status === 'pending' ? ' — the queue is clear' : ''}.</p>`}`);

  $$('[data-preview]').forEach((pv) => {
    const ta = pv.previousElementSibling;
    const update = () => renderMarkdown(ta.value, pv);
    ta.addEventListener('input', update);
    update();
  });

  $$('.review').forEach((art) => {
    const form = $('form', art);
    let decision = 'approve';
    $$('[data-decision]', form).forEach((b) => b.addEventListener('click', () => (decision = b.dataset.decision)));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      busy(form, async () => {
        await post(`/admin/submissions/${encodeURIComponent(art.dataset.id)}/review`, {
          decision,
          note: form.note.value,
          edits: { title: form.title.value, summary: form.summary.value, track: form.track.value, link: form.link.value, body: form.body.value },
        });
        toast(decision === 'approve' ? 'Published to the library' : 'Marked as not accepted');
        renderSuggestions();
      }).catch(() => {});
    });
  });
}
```

(Write the pasted `card` as a real `const card = ...` — the comment line above is only a pointer for where it goes.)

`api/src/console/main.js`:

```js
// ---------- router ----------
const session = requireLogin();

function route() {
  ensureStyles();
  const hash = location.hash.replace(/^#/, '');
  const [page] = hash.split('?');
  const member = page.match(/^members\/([0-9a-f-]{36})$/i);
  // Old links used ?status=… for the review queue
  if (!page && params().get('status')) return renderSuggestions();
  if (member) return renderMember(member[1]);
  if (page === 'members') return renderMembers();
  if (page === 'suggestions') return renderSuggestions();
  return renderDashboard();
}

if (session) {
  window.addEventListener('hashchange', () => route().catch(showError));
  route().catch(showError);
}
```

Delete the old file: `git rm api/src/console/admin.js`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (including the bundle syntax check).

- [ ] **Step 6: Try it in the browser**

Run: `npm run dev`, sign up (the first account is admin), open `/admin/`. Check: Dashboard tiles and "Rebuild member index" work; Members tab lists you; your member page shows "Owner account: protected" (or "This is you" when owner protection is off locally); a second account can be suspended (its posts leave `/community/`), unsuspended, and deleted after typing its email; Suggestions tab still reviews; at ~400px wide the table becomes cards.

- [ ] **Step 7: Commit**

```bash
git add api/src/console api/src/app.js api/test/admin.test.js
git commit -m "Admin console: dashboard, members, member page, tabs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Login handles "reset required", docs, spec refinement

**Files:**
- Modify: `web/js/pages/login.js` (login submit handler)
- Modify: `docs/superpowers/specs/2026-11-03-admin-members-design.md` (data model table)
- Modify: `README.md` (admin section)

**Interfaces:**
- Consumes: `logIn` error `code === 'PasswordResetRequiredException'`; existing `show('reset')` step.

- [ ] **Step 1: Login change**

In `web/js/pages/login.js`, in the login form's `catch (err)` block, before `throw err;`, add:

```js
          if (err.code === 'PasswordResetRequiredException') {
            toast('Your password was reset by the site team. Check your email for a code, then choose a new password.');
            return show('reset');
          }
```

Check by reading the `reset()` step that it uses the remembered `email` (it does via `remember`), so no email prompt is needed.

- [ ] **Step 2: Spec refinement**

In the spec's "Data model changes" table, replace the `USER#<sub> / PROFILE` row with:

```markdown
| `USER#<sub> / ACCOUNT` (new) | `GSI1PK = MEMBERS`, `GSI1SK = <lastSeenAt>#<sub>`; fields `lastSeenAt`, `suspended`, `suspendedAt` (separate from PROFILE, which `PUT /api/me/profile` rewrites whole) |
```

And in "Last active", change "updates `lastSeenAt`" to "updates `lastSeenAt` on the ACCOUNT item".

- [ ] **Step 3: README**

Find the admin section: `grep -n "admin" README.md | head`. Under it, add:

```markdown
### Managing members

The admin console (`/admin/`, only visible to the `admins` group) has three tabs:

- **Dashboard** — member and activity counts, recent admin actions, and *Rebuild member index* (run once after upgrading).
- **Members** — search by email, open a member to see their posts and comments, suspend or unsuspend them (suspending hides their posts and comments), send a password reset, make or remove admins (owner only), or delete the account and all its data.
- **Suggestions** — the library review queue.

The owner account is set by `owner_sub` in `infra/terraform/existing.auto.tfvars` and can't be suspended, deleted or demoted from the console. Every action is kept in the audit log.
```

- [ ] **Step 4: Full test run and build**

Run: `npm test && node build.js`
Expected: all tests pass; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add web/js/pages/login.js docs/superpowers/specs/2026-11-03-admin-members-design.md README.md
git commit -m "Login handles admin password resets; document member management

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Ship

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin feature/admin-members
gh pr create --title "Admin panel: members management" --body "<summary of tasks 1-9; expected plan: 1 new IAM role policy, Lambda env + timeout change, nothing replaced or destroyed>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 2: Check the plan**

Wait for the Infrastructure workflow's Plan on the PR. Expected: `aws_iam_role_policy.api_members` created; `aws_lambda_function.api` updated in-place (environment, timeout). **Stop and report if anything is replaced or destroyed.**

- [ ] **Step 3: Merge, approve, deploy**

Merge after checks pass. The user approves the `production` apply. Wait for both the apply and the Deploy workflow.

- [ ] **Step 4: Post-deploy**

Ask the user to open `https://cosmosnotebook.com/admin/`, press **Rebuild member index** once, and confirm the Dashboard numbers and their own member page ("Owner account: protected").
