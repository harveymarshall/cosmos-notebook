// Admin console routes for managing members: stats, the member list and page, suspend,
// delete, password reset, admin rights, removing comments, and the audit log.
// Every route is registered with { auth: true, admin: true }: the dispatcher in app.js
// answers 404 to anyone who isn't an admin before the handler runs.

export function registerAdminMembers({ route, store, members, ownerSub, now, makeId, log }) {}
