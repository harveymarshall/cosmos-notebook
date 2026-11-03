# Admin panel: members management (Project A)

Date: 2026-11-03 · Status: approved design, awaiting spec review

## Goal

Let the site owner manage members from the existing admin console: see who they are, suspend
or delete accounts, moderate one person's content in one place, reset passwords, grant admin,
and see site stats. Email and newsletters are a separate later project (Project B).

## Decisions

| Topic | Decision |
| --- | --- |
| Admins | One owner (the site owner). Make/remove admin exists, but only the owner can use it. |
| Owner protection | `owner_sub` (Terraform variable → `OWNER_SUB` env). The API refuses to suspend, delete or demote that account, whoever asks. |
| Suspend | Disables sign-in, signs out everywhere, hides the member's posts and comments. Unsuspend restores everything. |
| Delete | Removes all of the member's data and their Cognito account. Approved library suggestions stay, anonymised. |
| Password reset | Cognito emails a code (`AdminResetUserPassword`); the admin never sees a password. |
| Audit | Every admin action is logged (who, what, target, when, optional reason). |
| MFA | Out of scope for this round (follow-up). |

## Architecture

- **UI:** the existing admin console (served by `GET /api/admin/console`, only to admins; 404
  for everyone else). It grows tabs: Dashboard · Members · Suggestions. Hash routes
  (`#dashboard`, `#members`, `#members/<sub>`, `#suggestions`).
- **Console code** splits into `api/src/console/{admin,dashboard,members,member,suggestions}.js`,
  concatenated by the console route so it stays one blob module.
- **`api/src/members.js`** — thin Cognito wrapper with an injected `send(op, params)`, like
  `store.js`. Lambda passes the runtime AWS SDK's `CognitoIdentityProviderClient`;
  tests pass `api/src/fake-cognito.js`.
- **`api/src/admin-members.js`** — the new `/api/admin/...` routes, registered from
  `createApp`, which gains `members`, `userPoolId` and `ownerSub` inputs.
- **`api/src/store.js`** — per-author index keys and new member-level queries (below).

### Permissions (Terraform)

- New inline policy on the API Lambda role, resource = this user pool's ARN only:
  `ListUsers`, `AdminGetUser`, `AdminDisableUser`, `AdminEnableUser`, `AdminDeleteUser`,
  `AdminUserGlobalSignOut`, `AdminResetUserPassword`, `AdminAddUserToGroup`,
  `AdminRemoveUserFromGroup`, `AdminListGroupsForUser`, `ListUsersInGroup`.
  No create-user, set-password or pool-configuration actions.
- The permissions boundary already allows `cognito-idp:*`; no bootstrap change.
- Terraform's own plan/apply roles keep their deny on member data.
- Lambda environment: `USER_POOL_ID`, `OWNER_SUB`.
- `owner_sub` variable (string, required non-empty when the pool exists), set in
  `existing.auto.tfvars`.

## Data model changes (single table)

| Item | New keys |
| --- | --- |
| `USER#<sub> / ACCOUNT` (new) | `GSI1PK = MEMBERS`, `GSI1SK = <lastSeenAt>#<sub>`; fields `lastSeenAt`, `suspended`, `suspendedAt` (separate from PROFILE, which `PUT /api/me/profile` rewrites whole) |
| `POST#<id> / META` | `GSI2PK = USER#<authorSub>`, `GSI2SK = POST#<publishedAt>#<id>` |
| `POST#<id> / CMT#…` | `GSI2PK = USER#<authorSub>`, `GSI2SK = CMT#<createdAt>#<postId>#<cid>`; field `hidden` |
| `POST#<id> / LIKE#<sub>` | `GSI2PK = USER#<sub>`, `GSI2SK = LIKE#<at>#<postId>` |
| `AUDIT / <at>#<id>` | new: `actorSub`, `action`, `targetSub`, `reason`, `detail` |

GSI2 already carries submissions as `USER#<sub> / SUB#<createdAt>`, so a member's whole
footprint is one `GSI2PK = USER#<sub>` query, split by `GSI2SK` prefix.

Suspended posts move out of the feed by changing `GSI1PK` from `FEED` to `FEED#HIDDEN`
(same `GSI1SK`); unsuspend moves them back. Comments get `hidden: true`, filtered by
`listComments` and excluded from `commentCount` display.

**Last active:** `GET /api/me` (called on every page load when signed in) updates
`lastSeenAt` on the ACCOUNT item if the stored value is from an earlier UTC day — at most one write per member
per day.

**Rebuild index** (one-off, idempotent): walks the feed (`GSI1 FEED` and `FEED#HIDDEN`), and
for each post sets GSI2 keys on the post, its comments and its likes; walks Cognito
`ListUsers` and sets `GSI1` keys on each existing profile. Query/Update only — no `Scan`
permission needed.

## API routes (all `auth: true`, admin-only, 404 otherwise)

| Route | Does |
| --- | --- |
| `GET /api/admin/stats` | members total, sign-ups 7d/30d, active 7d/30d, posts, comments, pending suggestions |
| `GET /api/admin/audit?limit=50` | newest audit entries |
| `GET /api/admin/members?q=&cursor=` | Cognito page (60) merged with profiles: email, name, joined, last active, status, admin |
| `GET /api/admin/members/:sub` | member detail + counts + posts + comments + audit for them |
| `POST /api/admin/members/:sub/suspend` `{reason}` | disable, global sign-out, hide content, set `suspended` |
| `POST /api/admin/members/:sub/unsuspend` `{reason}` | enable, unhide content, clear `suspended` |
| `POST /api/admin/members/:sub/reset-password` `{reason}` | `AdminResetUserPassword` |
| `POST /api/admin/members/:sub/admin` `{grant: bool, reason}` | owner only; add/remove `admins` group |
| `DELETE /api/admin/members/:sub` `{confirmEmail, reason}` | full delete (order below) |
| `DELETE /api/admin/comments/:postId/:commentId` | remove one comment (posts already have a route) |
| `POST /api/admin/maintenance/reindex` | rebuild index |

Owner protection: suspend, delete and admin-revoke on `OWNER_SUB` → 403
`"The owner account can't be changed here"`. Admin grant/revoke by a non-owner → 403.
An admin can't target themselves with suspend/delete.

**Suspended members' writes:** every write route checks the caller's profile
`suspended` flag and returns 403 `"Your account is suspended"`. Covers the up-to-60-minute
window where an access token outlives the global sign-out.

### Delete order (each step idempotent; Cognito last)

1. Confirm `confirmEmail` equals the member's Cognito email (case-insensitive) — else 400.
2. Their posts: `deletePost` each (removes the post's comments and likes too).
3. Their comments on others' posts: delete each, decrementing that post's `commentCount`.
4. Their likes on others' posts: delete each, decrementing `likeCount`.
5. Pending/rejected submissions: delete. Approved: strip `authorSub` and author name.
6. All `USER#<sub>` items (profile, progress, enrolments, journal, observations).
7. Cognito `AdminDeleteUser` (treat `UserNotFoundException` as done).
8. Audit entry with counts removed.

A failure part-way returns 500 with the step reached; re-running continues.

### Suspend order

1. `AdminDisableUser`, `AdminUserGlobalSignOut`.
2. Set profile `suspended: true`.
3. Hide posts (feed key) and comments (`hidden`).
4. Audit. If step 3 fails: 207-style response `{partial: true, step}` and audit records it;
   the panel shows "Partly done — retry".

## UI

- **Dashboard:** stat tiles row; recent audit list; "Rebuild index" button with note.
- **Members:** search box (email prefix), table (email, name, joined, last active, status
  badge), "Load more"; stacked cards under ~600px.
- **Member page:** header (email, name, badges, dates, counts); actions (Suspend/Unsuspend,
  Reset password, Make/Remove admin, Delete — separated); posts and comments with Remove;
  history. Owner shows an "Owner" badge instead of risky actions.
- **Confirmation:** in-page confirm panel (no `confirm()`), optional reason; Delete requires
  typing the email.
- **Login page:** on `PasswordResetRequiredException`, switch to the existing
  forgot-password step with the email pre-filled and a short explanation.

## Errors

Cognito errors map to clear messages: `UserNotFoundException` → 404 "Member not found";
`TooManyRequestsException` → 429 "AWS is busy, try again in a moment"; others → 502
"Couldn't reach the sign-in service". Validation errors → 400 with the field named.

## Testing (node --test, test-first)

- Every new route: non-admin 404; signed-out 401.
- Owner protection on suspend / delete / admin-revoke; non-owner can't change admins.
- Suspend hides posts from `/api/feed` and comments from the post; suspended member's
  writes 403; unsuspend restores both.
- Delete removes every item type, fixes other posts' like/comment counts, anonymises approved
  submissions, removes the Cognito user; re-running after a simulated mid-way failure finishes.
- Reindex is idempotent and makes member queries return pre-existing posts/comments/likes.
- Stats counts and `lastSeenAt` once-per-day behaviour.
- Audit entry written for every action.
- `fake-cognito.js` implements only the operations above, with the same error names.

## Rollout

1. One PR: code + Terraform. Expected plan: new IAM inline policy, Lambda environment
   change; nothing replaced or destroyed.
2. Approve apply; deploy runs.
3. Open the admin page → Dashboard → **Rebuild index** once → check counts.

## Out of scope

MFA for admins; Project B (SES, consent/opt-in, unsubscribe, newsletters, member email).
