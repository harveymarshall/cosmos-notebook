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
