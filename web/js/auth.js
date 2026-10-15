// Sign up, log in, password reset and sessions, talking straight to Amazon Cognito's
// public API (no SDK needed). Locally, scripts/dev-server.js imitates the same API.

const CFG = window.COSMOS_CONFIG || {};
const KEY = 'cosmos.session';

export const authEnabled = () => Boolean(CFG.clientId && (CFG.region || CFG.cognitoEndpoint));
const endpoint = () => CFG.cognitoEndpoint || `https://cognito-idp.${CFG.region}.amazonaws.com/`;

const FRIENDLY = {
  UsernameExistsException: 'An account with this email already exists. Try logging in instead.',
  NotAuthorizedException: 'Incorrect email or password.',
  UserNotFoundException: 'Incorrect email or password.',
  UserNotConfirmedException: 'Please confirm your email address first.',
  CodeMismatchException: "That code isn't right. Check the email and try again.",
  ExpiredCodeException: 'That code has expired. Ask for a new one.',
  LimitExceededException: 'Too many attempts. Please wait a few minutes and try again.',
  TooManyRequestsException: 'Too many attempts. Please wait a few minutes and try again.',
  TooManyFailedAttemptsException: 'Too many attempts. Please wait a few minutes and try again.',
};

async function cognito(action, payload) {
  let res;
  try {
    res = await fetch(endpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': `AWSCognitoIdentityProviderService.${action}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw Object.assign(new Error("Couldn't reach the sign-in service. Check your connection."), { code: 'Network' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = String(data.__type || '').split('#').pop();
    const msg = FRIENDLY[code] || data.message || 'Something went wrong. Please try again.';
    throw Object.assign(new Error(msg), { code });
  }
  return data;
}

const decode = (jwt) => {
  try {
    const part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(part))));
  } catch {
    return {};
  }
};

function save(result, previous = {}) {
  const access = decode(result.AccessToken);
  const id = decode(result.IdToken || previous.idToken || '');
  const session = {
    accessToken: result.AccessToken,
    idToken: result.IdToken || previous.idToken,
    refreshToken: result.RefreshToken || previous.refreshToken,
    expiresAt: (access.exp || Math.floor(Date.now() / 1000) + (result.ExpiresIn || 3600)) * 1000,
    sub: access.sub,
    email: id.email || previous.email || '',
    groups: access['cognito:groups'] || [],
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {}
  window.dispatchEvent(new Event('cosmos:auth'));
  return session;
}

export function getSession() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    return s && s.accessToken ? s : null;
  } catch {
    return null;
  }
}

export function isAdmin() {
  return (getSession()?.groups || []).includes('admins');
}

function clear() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
  window.dispatchEvent(new Event('cosmos:auth'));
}

export const signUp = (email, password) =>
  cognito('SignUp', {
    ClientId: CFG.clientId,
    Username: email,
    Password: password,
    UserAttributes: [{ Name: 'email', Value: email }],
  });

export const confirmSignUp = (email, code) =>
  cognito('ConfirmSignUp', { ClientId: CFG.clientId, Username: email, ConfirmationCode: code.trim() });

export const resendCode = (email) => cognito('ResendConfirmationCode', { ClientId: CFG.clientId, Username: email });

export async function logIn(email, password) {
  const res = await cognito('InitiateAuth', {
    ClientId: CFG.clientId,
    AuthFlow: 'USER_PASSWORD_AUTH',
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });
  if (!res.AuthenticationResult) throw new Error('Additional sign-in steps are not supported yet.');
  return save(res.AuthenticationResult, { email });
}

export const forgotPassword = (email) => cognito('ForgotPassword', { ClientId: CFG.clientId, Username: email });

export const resetPassword = (email, code, password) =>
  cognito('ConfirmForgotPassword', { ClientId: CFG.clientId, Username: email, ConfirmationCode: code.trim(), Password: password });

let refreshing = null;
export async function refresh() {
  const s = getSession();
  if (!s?.refreshToken) return null;
  refreshing ||= cognito('InitiateAuth', {
    ClientId: CFG.clientId,
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    AuthParameters: { REFRESH_TOKEN: s.refreshToken },
  })
    .then((res) => save(res.AuthenticationResult, s))
    .catch((err) => {
      if (err.code !== 'Network') clear();
      return null;
    })
    .finally(() => (refreshing = null));
  return refreshing;
}

/** A valid access token, refreshed if it's about to expire — or null when logged out. */
export async function getAccessToken() {
  const s = getSession();
  if (!s) return null;
  if (s.expiresAt - Date.now() > 60_000) return s.accessToken;
  return (await refresh())?.accessToken || null;
}

export async function logOut() {
  const s = getSession();
  clear();
  if (s?.refreshToken) {
    cognito('RevokeToken', { ClientId: CFG.clientId, Token: s.refreshToken }).catch(() => {});
  }
}
