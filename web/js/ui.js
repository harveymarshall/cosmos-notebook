// Small shared helpers for the app pages.
import { escapeHtml, markdown } from './lib/markdown.js';
import { getSession, authEnabled } from './auth.js';
import { attachGraphs } from './autograph.js';

export { escapeHtml as esc, markdown };
export * from './lib/labels.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const app = () => document.getElementById('app');

export function render(html, root = app()) {
  root.innerHTML = html;
  return root;
}

export function toast(message, kind = 'ok') {
  let box = $('#toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.setAttribute('role', 'status');
    document.body.append(box);
  }
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = message;
  box.append(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3700);
}

export const errorBox = (err) =>
  `<div class="notice error" role="alert">${escapeHtml(err?.message || String(err))}</div>`;

/** Show a friendly message (not a blank page) when something fails. */
export function showError(err) {
  console.error(err);
  render(`${errorBox(err)}<p><a href="javascript:location.reload()">Try again</a></p>`);
}

/** Send people to log in, then bring them back here. Returns the session if logged in. */
export function requireLogin() {
  if (!authEnabled()) {
    render(`<div class="notice">Accounts aren't switched on for this site yet. The site owner needs to finish the AWS setup (see the README).</div>`);
    return null;
  }
  const s = getSession();
  if (!s) {
    location.replace(`/login/?next=${encodeURIComponent(location.pathname + location.search)}`);
    return null;
  }
  return s;
}

export const params = () => new URLSearchParams(location.search);

/** Render Markdown, plus maths if the text has any (KaTeX loads on demand).
 *  With { graphs: true }, every table of numbers also gets an auto-graph. */
export function renderMarkdown(text, el, { graphs = false } = {}) {
  const { html, hasMath } = markdown(text || '');
  el.innerHTML = html;
  if (graphs) attachGraphs(el, text || '');
  if (hasMath) loadMath().then((render) => render(el)).catch(() => {});
  return el;
}

let mathPromise;
function loadMath() {
  mathPromise ||= new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css';
    document.head.append(css);
    const a = document.createElement('script');
    a.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js';
    a.onload = () => {
      const b = document.createElement('script');
      b.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js';
      b.onload = () =>
        resolve((el) =>
          window.renderMathInElement(el, {
            delimiters: [
              { left: '$$', right: '$$', display: true },
              { left: '\\(', right: '\\)', display: false },
            ],
            throwOnError: false,
          })
        );
      b.onerror = reject;
      document.head.append(b);
    };
    a.onerror = reject;
    document.head.append(a);
  });
  return mathPromise;
}

/** Plain-text preview of Markdown for cards. */
export function excerpt(text, max = 220) {
  const plain = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/[#>*_`~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max).replace(/\s+\S*$/, '')}…` : plain;
}

export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Disable a form's buttons while a request runs; shows errors in the form. */
export async function busy(form, fn) {
  const buttons = $$('button', form);
  buttons.forEach((b) => (b.disabled = true));
  const box = $('.form-error', form);
  if (box) box.innerHTML = '';
  try {
    return await fn();
  } catch (err) {
    if (box) box.innerHTML = errorBox(err);
    else toast(err.message, 'error');
    throw err;
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

/** A Markdown text box with Write / Preview tabs. */
export function markdownEditor({ name, value = '', rows = 12, placeholder = '', label = 'Notes' }) {
  const id = `md-${name}`;
  return `<div class="md-editor" data-md="${name}">
  <div class="md-tabs" role="tablist">
    <span class="md-label">${escapeHtml(label)}</span>
    <button type="button" role="tab" aria-selected="true" data-tab="write">Write</button>
    <button type="button" role="tab" aria-selected="false" data-tab="preview">Preview</button>
  </div>
  <textarea id="${id}" name="${name}" rows="${rows}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>
  <div class="prose md-preview" hidden></div>
  <p class="muted small md-help">Markdown works: <code>## Heading</code>, <code>**bold**</code>, <code>- [ ] checklist</code>, tables, and maths with <code>$$ E = hf $$</code>.</p>
</div>`;
}

export function wireMarkdownEditors(root = document) {
  $$('.md-editor', root).forEach((ed) => {
    const ta = $('textarea', ed);
    const pv = $('.md-preview', ed);
    $$('[data-tab]', ed).forEach((tab) =>
      tab.addEventListener('click', () => {
        const preview = tab.dataset.tab === 'preview';
        $$('[data-tab]', ed).forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
        ta.hidden = preview;
        pv.hidden = !preview;
        if (preview) renderMarkdown(ta.value || '*Nothing written yet.*', pv, { graphs: true });
      })
    );
  });
}

export const dateInputValue = (v) => (v ? String(v).slice(0, 10) : '');
export const today = () => new Date().toISOString().slice(0, 10);
