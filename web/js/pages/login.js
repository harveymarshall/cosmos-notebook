import { render, $, esc, busy, params, toast } from '../ui.js';
import { authEnabled, getSession, signUp, confirmSignUp, resendCode, logIn, forgotPassword, resetPassword } from '../auth.js';

const next = () => {
  const n = params().get('next') || '/notebook/';
  return n.startsWith('/') && !n.startsWith('//') ? n : '/notebook/';
};
let email = sessionStorage.getItem('cosmos.email') || '';
const remember = (v) => {
  email = v.trim().toLowerCase();
  sessionStorage.setItem('cosmos.email', email);
};
let pendingPassword = ''; // kept in memory only, to log you in right after confirming
const PASSWORD_HINT = 'At least 8 characters, with a lowercase letter and a number.';

const shell = (title, lede, form, foot = '') => `<div class="auth-card">
  <h1>${title}</h1>
  ${lede ? `<p class="muted">${lede}</p>` : ''}
  ${form}
  ${foot ? `<div class="auth-foot">${foot}</div>` : ''}
</div>`;

const emailField = (autofocus = true) =>
  `<label>Email<input type="email" name="email" autocomplete="email" required value="${esc(email)}"${autofocus ? ' autofocus' : ''}></label>`;

function show(mode) {
  history.replaceState(null, '', `?mode=${mode}${params().get('next') ? `&next=${encodeURIComponent(params().get('next'))}` : ''}`);
  VIEWS[mode]();
}

const VIEWS = {
  login() {
    render(
      shell(
        'Welcome back',
        'Log in to your notebook.',
        `<form id="f" class="form" novalidate>
          ${emailField()}
          <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
          <div class="form-error"></div>
          <button class="btn primary block">Log in</button>
        </form>`,
        `<a href="#" data-go="forgot">Forgot your password?</a><span>New here? <a href="#" data-go="signup">Create an account</a></span>`
      )
    );
    $('#f').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      remember(f.email.value);
      busy(f, async () => {
        try {
          await logIn(email, f.password.value);
          location.href = next();
        } catch (err) {
          if (err.code === 'UserNotConfirmedException') {
            await resendCode(email).catch(() => {});
            toast('We sent you a new confirmation code.');
            return show('confirm');
          }
          throw err;
        }
      }).catch(() => {});
    });
  },

  signup() {
    render(
      shell(
        'Start your notebook',
        'Free. Track your experiments, keep an observing log, and join the community.',
        `<form id="f" class="form" novalidate>
          ${emailField()}
          <label>Password<input type="password" name="password" autocomplete="new-password" required minlength="8" aria-describedby="pw-hint">
          <span class="muted small" id="pw-hint">${PASSWORD_HINT}</span></label>
          <div class="form-error"></div>
          <button class="btn primary block">Create account</button>
        </form>`,
        `<span>Already have an account? <a href="#" data-go="login">Log in</a></span>`
      )
    );
    $('#f').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      remember(f.email.value);
      busy(f, async () => {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Please enter a valid email address.');
        const pw = f.password.value;
        if (pw.length < 8 || !/[a-z]/.test(pw) || !/\d/.test(pw)) throw new Error(`Password: ${PASSWORD_HINT}`);
        pendingPassword = pw;
        await signUp(email, pw);
        show('confirm');
      }).catch(() => {});
    });
  },

  confirm() {
    render(
      shell(
        'Check your email',
        `We sent a 6-digit code to <strong>${esc(email || 'your email')}</strong>. It can take a minute — check spam too.`,
        `<form id="f" class="form" novalidate>
          ${email ? `<input type="hidden" name="email" value="${esc(email)}">` : emailField()}
          <label>Confirmation code<input name="code" inputmode="numeric" autocomplete="one-time-code" required autofocus maxlength="10"></label>
          <div class="form-error"></div>
          <button class="btn primary block">Confirm email</button>
        </form>`,
        `<a href="#" id="resend">Send a new code</a><a href="#" data-go="login">Back to log in</a>`
      )
    );
    $('#resend').addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await resendCode(email);
        toast('New code sent.');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    $('#f').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      remember(f.email.value);
      busy(f, async () => {
        await confirmSignUp(email, f.code.value);
        const pw = pendingPassword;
        pendingPassword = '';
        if (pw) {
          await logIn(email, pw);
          location.href = '/notebook/?welcome=1';
        } else {
          toast('Email confirmed — please log in.');
          show('login');
        }
      }).catch(() => {});
    });
  },

  forgot() {
    render(
      shell(
        'Reset your password',
        "Enter your email and we'll send you a code.",
        `<form id="f" class="form" novalidate>
          ${emailField()}
          <div class="form-error"></div>
          <button class="btn primary block">Send reset code</button>
        </form>`,
        `<a href="#" data-go="login">Back to log in</a>`
      )
    );
    $('#f').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      remember(f.email.value);
      busy(f, async () => {
        await forgotPassword(email);
        show('reset');
      }).catch(() => {});
    });
  },

  reset() {
    render(
      shell(
        'Choose a new password',
        `If an account exists for <strong>${esc(email)}</strong>, we've emailed it a code.`,
        `<form id="f" class="form" novalidate>
          <input type="hidden" name="email" value="${esc(email)}">
          <label>Code<input name="code" inputmode="numeric" autocomplete="one-time-code" required autofocus></label>
          <label>New password<input type="password" name="password" autocomplete="new-password" required minlength="8">
          <span class="muted small">${PASSWORD_HINT}</span></label>
          <div class="form-error"></div>
          <button class="btn primary block">Save new password</button>
        </form>`,
        `<a href="#" data-go="login">Back to log in</a>`
      )
    );
    $('#f').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      busy(f, async () => {
        await resetPassword(email, f.code.value, f.password.value);
        await logIn(email, f.password.value);
        location.href = next();
      }).catch(() => {});
    });
  },
};

document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  if (go) {
    e.preventDefault();
    show(go.dataset.go);
  }
});

if (!authEnabled()) {
  render(`<div class="notice">Accounts aren't switched on for this site yet. The site owner needs to finish the AWS setup (see the README).</div>`);
} else if (getSession() && !['confirm', 'reset'].includes(params().get('mode'))) {
  location.replace(next());
} else {
  const mode = params().get('mode');
  (VIEWS[mode] || VIEWS.login)();
}
