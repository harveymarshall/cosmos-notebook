// The admin console. These files are NOT part of the public website: the API joins them
// (in the order listed in app.js) and sends them only to signed-in members of the Cognito
// "admins" group; web/js/admin-loader.js runs the result. Only this file imports; the
// others use these names. Imports use site-absolute paths; the loader makes them full URLs.
import { render, $, $$, esc, requireLogin, showError, busy, toast, kindTag, fmtDate, timeAgo, renderMarkdown, params } from '/js/ui.js';
import { get, post, api } from '/js/api.js';
