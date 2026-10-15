// Light / dark / red (night-vision) themes. The choice is remembered on this device;
// with no choice made, the site follows the phone or computer's own setting.
const KEY = 'cosmos.theme';
export const THEMES = ['light', 'dark', 'red'];
const NAMES = { light: 'Light', dark: 'Dark', red: 'Red night-vision' };

export function currentTheme() {
  const set = document.documentElement.dataset.theme;
  if (THEMES.includes(set)) return set;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function setTheme(theme) {
  if (!THEMES.includes(theme)) return;
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {}
  window.dispatchEvent(new CustomEvent('cosmos:theme', { detail: theme }));
  label();
}

export function nextTheme() {
  const now = currentTheme();
  setTheme(THEMES[(THEMES.indexOf(now) + 1) % THEMES.length]);
}

function label() {
  const btn = document.getElementById('theme-btn');
  if (!btn) return;
  const now = currentTheme();
  const next = THEMES[(THEMES.indexOf(now) + 1) % THEMES.length];
  btn.setAttribute('aria-label', `Theme: ${NAMES[now]}. Switch to ${NAMES[next]}`);
  btn.title = `Switch to ${NAMES[next]}`;
}

export function wireThemeButton() {
  const btn = document.getElementById('theme-btn');
  if (!btn || btn.dataset.wired) return;
  btn.dataset.wired = '1';
  btn.addEventListener('click', nextTheme);
  label();
}
