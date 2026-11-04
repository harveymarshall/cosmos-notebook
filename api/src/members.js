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
