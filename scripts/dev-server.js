#!/usr/bin/env node
// Run the whole thing on your own computer — no AWS account needed:
//
//   node build.js && node scripts/dev-server.js        → http://localhost:4321
//
// It serves the built site, runs the real API code against an in-memory database
// (saved to .dev-data/ so it survives restarts), and imitates Amazon Cognito's sign-up
// and log-in API. Confirmation and reset codes are printed here instead of emailed.
// The FIRST account you create becomes an admin, so you can try the review queue.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { createApp } from '../api/src/app.js';
import { createStore } from '../api/src/store.js';
import { createFakeDynamo } from '../api/src/fake-dynamo.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const DATA = join(ROOT, '.dev-data');
const PORT = Number(process.env.PORT) || 4321;
mkdirSync(DATA, { recursive: true });

// ---------- API with a local database ----------
const app = createApp({ store: createStore({ send: createFakeDynamo({ file: join(DATA, 'db.json') }), table: 'dev' }) });

// ---------- pretend Cognito ----------
const USERS_FILE = join(DATA, 'users.json');
const users = existsSync(USERS_FILE) ? JSON.parse(readFileSync(USERS_FILE, 'utf8')) : {};
const saveUsers = () => writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
const SECRET = existsSync(join(DATA, 'secret')) ? readFileSync(join(DATA, 'secret'), 'utf8') : randomBytes(32).toString('hex');
writeFileSync(join(DATA, 'secret'), SECRET);
const refreshTokens = new Map();

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (payload) => {
  const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}`;
  return `${head}.${createHmac('sha256', SECRET).update(head).digest('base64url')}`;
};
function verify(token) {
  const [h, p, s] = String(token).split('.');
  if (!s) return null;
  const expected = createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  if (expected.length !== s.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(s))) return null;
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  return claims.exp * 1000 > Date.now() ? claims : null;
}
const hash = (pw, salt = randomBytes(16).toString('hex')) => `${salt}:${scryptSync(pw, salt, 32).toString('hex')}`;
const checkHash = (pw, stored) => hash(pw, stored.split(':')[0]) === stored;
const code = () => String(Math.floor(100000 + Math.random() * 900000));

class CognitoError extends Error {
  constructor(type, message) {
    super(message);
    this.type = type;
  }
}
const passwordOk = (pw) => typeof pw === 'string' && pw.length >= 8 && /[a-z]/.test(pw) && /\d/.test(pw);

function tokensFor(email, u) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const refresh = randomBytes(24).toString('base64url');
  refreshTokens.set(refresh, email);
  return {
    AccessToken: sign({ sub: u.sub, 'cognito:groups': u.groups, token_use: 'access', client_id: 'dev', exp }),
    IdToken: sign({ sub: u.sub, email, email_verified: true, token_use: 'id', exp }),
    RefreshToken: refresh,
    ExpiresIn: 3600,
    TokenType: 'Bearer',
  };
}

const cognito = {
  SignUp({ Username, Password }) {
    const email = String(Username || '').toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new CognitoError('InvalidParameterException', 'Invalid email address format.');
    if (users[email]) throw new CognitoError('UsernameExistsException', 'An account with the given email already exists.');
    if (!passwordOk(Password)) throw new CognitoError('InvalidPasswordException', 'Password does not conform to policy: needs 8+ characters, a lowercase letter and a number.');
    const first = Object.keys(users).length === 0;
    users[email] = { sub: randomUUID(), password: hash(Password), confirmed: false, code: code(), groups: first ? ['admins'] : [] };
    saveUsers();
    console.log(`\n📧  Confirmation code for ${email}: ${users[email].code}${first ? '   (first account → admin)' : ''}\n`);
    return { UserConfirmed: false, UserSub: users[email].sub, CodeDeliveryDetails: { DeliveryMedium: 'EMAIL', Destination: email } };
  },
  ConfirmSignUp({ Username, ConfirmationCode }) {
    const u = users[String(Username).toLowerCase()];
    if (!u) throw new CognitoError('UserNotFoundException', 'Username/client id combination not found.');
    if (u.code !== ConfirmationCode) throw new CognitoError('CodeMismatchException', 'Invalid verification code provided.');
    u.confirmed = true;
    delete u.code;
    saveUsers();
    return {};
  },
  ResendConfirmationCode({ Username }) {
    const email = String(Username).toLowerCase();
    const u = users[email];
    if (u && !u.confirmed) {
      u.code = code();
      saveUsers();
      console.log(`\n📧  New confirmation code for ${email}: ${u.code}\n`);
    }
    return { CodeDeliveryDetails: { DeliveryMedium: 'EMAIL' } };
  },
  InitiateAuth({ AuthFlow, AuthParameters = {} }) {
    if (AuthFlow === 'REFRESH_TOKEN_AUTH') {
      const email = refreshTokens.get(AuthParameters.REFRESH_TOKEN);
      if (!email) throw new CognitoError('NotAuthorizedException', 'Invalid Refresh Token');
      const { RefreshToken, ...rest } = tokensFor(email, users[email]);
      refreshTokens.delete(RefreshToken);
      return { AuthenticationResult: rest };
    }
    const email = String(AuthParameters.USERNAME || '').toLowerCase();
    const u = users[email];
    if (!u || !checkHash(String(AuthParameters.PASSWORD || ''), u.password)) {
      throw new CognitoError('NotAuthorizedException', 'Incorrect username or password.');
    }
    if (!u.confirmed) throw new CognitoError('UserNotConfirmedException', 'User is not confirmed.');
    return { AuthenticationResult: tokensFor(email, u) };
  },
  ForgotPassword({ Username }) {
    const email = String(Username).toLowerCase();
    if (users[email]) {
      users[email].resetCode = code();
      saveUsers();
      console.log(`\n📧  Password reset code for ${email}: ${users[email].resetCode}\n`);
    }
    return { CodeDeliveryDetails: { DeliveryMedium: 'EMAIL' } };
  },
  ConfirmForgotPassword({ Username, ConfirmationCode, Password }) {
    const u = users[String(Username).toLowerCase()];
    if (!u || u.resetCode !== ConfirmationCode) throw new CognitoError('CodeMismatchException', 'Invalid verification code provided.');
    if (!passwordOk(Password)) throw new CognitoError('InvalidPasswordException', 'Password does not conform to policy.');
    u.password = hash(Password);
    u.confirmed = true;
    delete u.resetCode;
    saveUsers();
    return {};
  },
  RevokeToken({ Token }) {
    refreshTokens.delete(Token);
    return {};
  },
};

// ---------- HTTP ----------
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) req.destroy();
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

async function staticFile(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, clean);
  if (!file.startsWith(DIST)) return null;
  for (const candidate of [file, join(file, 'index.html')]) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {}
  }
  return null;
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    // Browser settings: point sign-in at the pretend Cognito below
    if (url.pathname === '/config.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(
        `window.COSMOS_CONFIG = ${JSON.stringify({ region: 'local', clientId: 'dev', cognitoEndpoint: '/__cognito', apiBase: '', siteTitle: 'Cosmos Notebook (dev)' })};`
      );
    }

    if (url.pathname === '/__cognito' && req.method === 'POST') {
      const action = String(req.headers['x-amz-target'] || '').split('.').pop();
      const body = JSON.parse((await readBody(req)) || '{}');
      try {
        if (!cognito[action]) throw new CognitoError('InvalidParameterException', `Unsupported action ${action}`);
        const out = cognito[action](body);
        res.writeHead(200, { 'content-type': 'application/x-amz-json-1.1' });
        return res.end(JSON.stringify(out));
      } catch (err) {
        if (!(err instanceof CognitoError)) throw err;
        res.writeHead(400, { 'content-type': 'application/x-amz-json-1.1' });
        return res.end(JSON.stringify({ __type: err.type, message: err.message }));
      }
    }

    if (url.pathname.startsWith('/api/')) {
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const claims = token ? verify(token) : null;
      const body = await readBody(req);
      const out = await app({
        rawPath: url.pathname,
        queryStringParameters: url.search ? Object.fromEntries(url.searchParams) : undefined,
        requestContext: { http: { method: req.method }, authorizer: claims ? { jwt: { claims } } : undefined },
        body: body || undefined,
      });
      res.writeHead(out.statusCode, out.headers);
      return res.end(out.body);
    }

    // Mission Control's live data: fetch it with `npm run live` (saved in .dev-data/live/)
    if (url.pathname.startsWith('/live/')) {
      const name = url.pathname.slice('/live/'.length);
      const live = /^[a-z]+\.json$/.test(name) ? join(DATA, 'live', name) : null;
      if (live && existsSync(live)) {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(await readFile(live));
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'No live data yet - run `npm run live`' }));
    }

    const file = await staticFile(url.pathname);
    const target = file || join(DIST, '404.html');
    const content = await readFile(target);
    res.writeHead(file ? 200 : 404, { 'content-type': TYPES[extname(target)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(content);
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(existsSync(DIST) ? 'Server error' : 'Run `node build.js` first.');
  }
}).listen(PORT, () => {
  console.log(`Cosmos Notebook running at http://localhost:${PORT}`);
  console.log('Sign-up codes appear in this window. The first account you create is an admin. Ctrl+C to stop.');
});
