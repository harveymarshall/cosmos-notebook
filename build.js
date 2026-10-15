#!/usr/bin/env node
// Builds the website into ./dist:
//   - the shared library (experiments, books, resources) from the files in ./content
//   - the app pages (log in, My notebook, community, submissions) from ./web
//     (the admin console is not built here: the API serves it to admins only)
// No dependencies — just Node.js 18+.   Usage:  node build.js [--drafts]
//
// Settings for sign-in come from environment variables at build time (see README):
//   COGNITO_REGION, COGNITO_CLIENT_ID, SITE_URL

import { readFile, writeFile, mkdir, readdir, rm, cp } from 'node:fs/promises';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { markdown, escapeHtml } from './src/markdown.js';
import { parseFrontMatter } from './src/frontmatter.js';
import { trackTag, kindTag, stars } from './src/labels.js';
import { icon, TRACK_ICON } from './src/icons.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, 'dist');
const SHOW_DRAFTS = process.argv.includes('--drafts');

const site = JSON.parse(await readFile(join(ROOT, 'content/site.json'), 'utf8'));
const siteUrl = (process.env.SITE_URL || site.siteUrl || '').replace(/\/$/, '');
const esc = escapeHtml;
// Changes whenever the stylesheet or app scripts change, so browsers never mix old and new files
const { createHash } = await import('node:crypto');
const hashOf = async (dir) => {
  const h = createHash('sha256');
  const walk = async (d) => {
    for (const e of (await readdir(d, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const f = join(d, e.name);
      if (e.isDirectory()) await walk(f);
      else h.update(await readFile(f));
    }
  };
  await walk(dir);
  return h;
};
const ASSET_VERSION = (await hashOf(join(ROOT, 'public'))).update((await hashOf(join(ROOT, 'web'))).digest('hex')).update((await hashOf(join(ROOT, 'src'))).digest('hex')).digest('hex').slice(0, 10);

// ---------- content ----------

async function loadCollection(dir) {
  const folder = join(ROOT, 'content', dir);
  let files = [];
  try {
    files = (await readdir(folder)).filter((f) => f.endsWith('.md') && !f.startsWith('_'));
  } catch {
    return [];
  }
  const items = [];
  for (const file of files) {
    const { data, body } = parseFrontMatter(await readFile(join(folder, file), 'utf8'));
    if (data.draft === true && !SHOW_DRAFTS) continue;
    const slug = data.slug || basename(file, extname(file));
    if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(slug)) throw new Error(`${dir}/${file}: file names must be lowercase-with-dashes`);
    items.push({ ...data, slug, file, body, ...markdown(body) });
  }
  return items;
}

const phaseOf = (id) => site.phases.find((p) => p.id === id);
const phaseIndex = (id) => {
  const i = site.phases.findIndex((p) => p.id === id);
  return i === -1 ? 99 : i;
};
const byPlan = (a, b) =>
  phaseIndex(a.phase) - phaseIndex(b.phase) || (Number(a.order) || 0) - (Number(b.order) || 0) || a.title.localeCompare(b.title);

const experiments = (await loadCollection('experiments')).sort(byPlan);
const books = (await loadCollection('reading')).sort(byPlan);
const resources = JSON.parse(await readFile(join(ROOT, 'content/resources.json'), 'utf8').catch(() => '[]'));

const ids = [...experiments.map((e) => e.slug), ...books.map((b) => b.slug)];
const dupe = ids.find((id, i) => ids.indexOf(id) !== i);
if (dupe) throw new Error(`Two library items share the id "${dupe}" — rename one file.`);

// ---------- layout ----------

const NAV = [
  ['/', 'Home'],
  ['/library/', 'Library'],
  ['/plan/', 'Plan'],
  ['/tonight/', 'Tonight'],
  ['/community/', 'Community'],
  ['/about/', 'About'],
];

const MATH_HEAD = `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"
  onload="renderMathInElement(document.querySelector('main'),{delimiters:[{left:'$$',right:'$$',display:true},{left:'\\\\(',right:'\\\\)',display:false}]})"></script>`;

function layout({ title, description, path, body, hasMath = false, wide = false, script, noindex = false }) {
  const pageTitle = title ? `${title} · ${site.title}` : site.title;
  const desc = description || site.description;
  const canonical = siteUrl ? `${siteUrl}${path}` : path;
  const nav = NAV.map(([href, label]) => {
    const active = href === '/' ? path === '/' : path.startsWith(href);
    return `<a href="${href}"${active ? ' aria-current="page"' : ''}>${label}</a>`;
  }).join('');

  return `<!doctype html>
<html lang="${site.language || 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(desc)}">
${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${esc(canonical)}">`}
<meta property="og:title" content="${esc(title || site.title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Jersey+10&family=IBM+Plex+Mono:ital,wght@0,400;0,500;0,600;1,400&family=VT323&display=swap">
<link rel="stylesheet" href="/styles.css?v=${ASSET_VERSION}">
<script>try{var t=localStorage.getItem('cosmos.theme');if(t==='light'||t==='dark'||t==='red')document.documentElement.dataset.theme=t}catch(e){}</script>
<script src="/config.js"></script>
<script type="module" src="/js/nav.js?v=${ASSET_VERSION}"></script>
${script ? `<script type="module" src="/js/pages/${script}.js?v=${ASSET_VERSION}"></script>` : ''}
${hasMath ? MATH_HEAD : ''}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="header-inner">
    <a class="brand" href="/">${icon('planet', { scale: 2 })}<span>${esc(site.title)}</span></a>
    <nav id="nav" class="nav" aria-label="Main">${nav}<span id="account-slot" class="account-slot"><a class="btn small" href="/login/">Log in</a></span></nav>
    <div class="header-tools">
      <button class="btn ico theme-btn" id="theme-btn" type="button" aria-label="Change colour theme">
        <span class="t-auto">${icon('moonHalf', { scale: 2 })}</span><span class="t-light">${icon('sun', { scale: 2 })}</span><span class="t-dark">${icon('crescent', { scale: 2 })}</span><span class="t-red px" style="font-size:.85rem">Red</span>
      </button>
      <button class="btn ico menu-btn" type="button" aria-label="Menu" aria-expanded="false" aria-controls="nav" onclick="this.setAttribute('aria-expanded', document.body.classList.toggle('nav-open'))">${icon('menu', { scale: 2 })}</button>
    </div>
  </div>
</header>
<main id="main" class="wrap${wide ? ' wide' : ''}">
${body}
</main>
<footer class="site-footer">
  <div class="wrap wide">
    <div class="foot">
      <div class="safety-note" role="note">${icon('warning', { scale: 2 })}<p>Never look at the Sun directly or through optics. Never point a laser at anyone's eyes.</p></div>
      <p class="muted">${esc(site.title)} · a free community lab notebook</p>
    </div>
    <div class="ruler" aria-hidden="true"></div>
  </div>
</footer>
</body>
</html>
`;
}

async function write(path, html) {
  const full = join(OUT, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, html);
}

/** A page whose content is drawn by a script in web/js/pages. */
const appPage = (path, { title, script, wide = false, intro = '' }) =>
  write(
    `${path.replace(/^\//, '')}index.html`,
    layout({
      title,
      path,
      script,
      wide,
      noindex: true,
      body: `${intro}<div id="app" class="app" aria-live="polite"><p class="muted loading">Loading…</p></div>`,
    })
  );

// ---------- pieces ----------

function experimentCard(e) {
  const phase = phaseOf(e.phase);
  return `<article class="card lib-card" data-kind="experiment" data-track="${esc(e.track || '')}">
  <div class="card-meta">${trackTag(e.track)}</div>
  <div class="card-icon">${icon(e.icon || TRACK_ICON[e.track] || 'star', { scale: 3 })}</div>
  <h3><a href="/experiments/${e.slug}/">${esc(e.title)}</a></h3>
  <p>${esc(e.summary || '')}</p>
  <div class="card-foot">${stars(e.difficulty)}${e.time ? `<span>${esc(e.time)}</span>` : ''}${
    e.cost ? `<span>${esc(e.cost)}</span>` : ''
  }${phase ? `<span>${esc(phase.when)}</span>` : ''}</div>
</article>`;
}

const bookRow = (b) => `<li class="lib-row" data-kind="book" data-track="${esc(b.track || '')}">
  <div><a href="/reading/${b.slug}/"><strong>${esc(b.title)}</strong></a><span class="muted"> — ${esc(b.author || '')}</span>
  <div class="muted small">${esc(b.summary || '')}</div></div>
  <div class="row-meta">${trackTag(b.track)}</div>
</li>`;

const resourceRow = (r) => `<li class="lib-row" data-kind="resource" data-track="${esc(r.track || '')}">
  <div><a href="${esc(r.link)}" rel="noopener" target="_blank"><strong>${esc(r.title)}</strong></a>
  <div class="muted small">${esc(r.summary || '')}</div></div>
  <div class="row-meta">${trackTag(r.track)}</div>
</li>`;

const progressWidget = (id, kind, title) =>
  `<aside class="progress-widget" id="progress-widget" data-item-id="${esc(id)}" data-kind="${kind}" data-title="${esc(title)}">
  <p class="muted small">Track this ${kind === 'book' ? 'book' : 'experiment'} in your own notebook — <a href="/login/?mode=signup">sign up free</a>.</p>
</aside>`;

function toc(headings) {
  if (headings.filter((h) => h.level === 2).length < 3) return '';
  return `<nav class="toc" aria-label="On this page"><p class="eyebrow">On this page</p><ol>${headings
    .filter((h) => h.level === 2)
    .map((h) => `<li><a href="#${h.id}">${esc(h.text)}</a></li>`)
    .join('')}</ol></nav>`;
}

// ---------- build ----------

const t0 = Date.now();
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await cp(join(ROOT, 'public'), OUT, { recursive: true });
await cp(join(ROOT, 'web/js'), join(OUT, 'js'), { recursive: true });
await mkdir(join(OUT, 'js/lib'), { recursive: true });
for (const f of ['markdown.js', 'labels.js', 'icons.js', 'astro.js', 'charts.js']) await cp(join(ROOT, 'src', f), join(OUT, 'js/lib', f));

await cp(join(ROOT, 'content/events.json'), join(OUT, 'events.json')).catch(() => {});

// Sign-in settings for the browser. Without them the site still works, minus accounts.
const config = {
  region: process.env.COGNITO_REGION || '',
  clientId: process.env.COGNITO_CLIENT_ID || '',
  cognitoEndpoint: process.env.COGNITO_ENDPOINT || '',
  apiBase: process.env.API_BASE || '',
  siteTitle: site.title,
};
await write('config.js', `window.COSMOS_CONFIG = ${JSON.stringify(config, null, 2)};\n`);

// Library data for the app (the seed library; approved community items come from the API)
await write(
  'library.json',
  JSON.stringify({
    phases: site.phases.map(({ id, title, when }) => ({ id, title, when })),
    items: [
      ...experiments.map((e) => ({
        id: e.slug,
        kind: 'experiment',
        icon: e.icon || TRACK_ICON[e.track] || 'star',
        title: e.title,
        summary: e.summary || '',
        track: e.track || '',
        phase: e.phase || '',
        difficulty: e.difficulty || 0,
        time: e.time || '',
        cost: e.cost || '',
        url: `/experiments/${e.slug}/`,
      })),
      ...books.map((b) => ({
        id: b.slug,
        kind: 'book',
        title: b.title,
        author: b.author || '',
        summary: b.summary || '',
        track: b.track || '',
        phase: b.phase || '',
        url: `/reading/${b.slug}/`,
        link: b.link || '',
      })),
      ...resources.map((r) => ({ ...r, kind: 'resource', url: r.link })),
    ],
  })
);

// Experiment guides
for (const [i, e] of experiments.entries()) {
  const prev = experiments[i - 1];
  const next = experiments[i + 1];
  const phase = phaseOf(e.phase);
  const facts = [
    phase && ['When', `${phase.when} · ${phase.title}`],
    e.time && ['Time', e.time],
    e.cost && ['Cost', e.cost],
    e.difficulty && ['Difficulty', `${e.difficulty} of 3`],
  ].filter(Boolean);
  const body = `<article class="entry">
<header class="entry-head">
  <p class="eyebrow"><a href="/library/">Library</a> · Experiment</p>
  <div class="item-head"><div class="item-icon">${icon(e.icon || TRACK_ICON[e.track] || 'star', { scale: 3 })}</div><h1 style="margin:0;align-self:center">${esc(e.title)}</h1></div>
  <p class="lede">${esc(e.summary || '')}</p>
  <div class="card-meta">${trackTag(e.track)}</div>
  <dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
  ${progressWidget(e.slug, 'experiment', e.title)}
</header>
<div class="entry-grid">
  ${toc(e.headings)}
  <div class="prose">${e.html}</div>
</div>
<nav class="pager">${prev ? `<a href="/experiments/${prev.slug}/"><span class="muted small">Previous</span>${esc(prev.title)}</a>` : '<span></span>'}${
    next ? `<a class="next" href="/experiments/${next.slug}/"><span class="muted small">Next</span>${esc(next.title)}</a>` : ''
  }</nav>
</article>`;
  await write(
    `experiments/${e.slug}/index.html`,
    layout({ title: e.title, description: e.summary, path: `/experiments/${e.slug}/`, body, hasMath: e.hasMath, script: 'progress-widget' })
  );
}

// Book pages
for (const b of books) {
  const body = `<article class="entry">
<header class="entry-head">
  <p class="eyebrow"><a href="/library/">Library</a> · Book</p>
  <h1>${esc(b.title)}</h1>
  <p class="lede">${esc(b.author || '')}${b.summary ? ` — ${esc(b.summary)}` : ''}</p>
  <div class="card-meta">${trackTag(b.track)}</div>
  ${b.link ? `<p><a href="${esc(b.link)}" rel="noopener" target="_blank">More about this book</a></p>` : ''}
  ${progressWidget(b.slug, 'book', b.title)}
</header>
<div class="prose">${b.html}</div>
</article>`;
  await write(
    `reading/${b.slug}/index.html`,
    layout({ title: b.title, description: b.summary, path: `/reading/${b.slug}/`, body, hasMath: b.hasMath, script: 'progress-widget' })
  );
}

// Old index URLs → library
const redirect = (to) =>
  `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${to}"><link rel="canonical" href="${to}"><a href="${to}">Moved here</a>`;
await write('experiments/index.html', redirect('/library/#experiments'));
await write('reading/index.html', redirect('/library/#books'));

// Library
await write(
  'library/index.html',
  layout({
    title: 'Library',
    path: '/library/',
    wide: true,
    script: 'library',
    body: `<header class="page-head"><h1>The library</h1>
<p class="lede">Hands-on experiments, books and tools for learning physics at home. Members can suggest new ones — every suggestion is checked before it appears here.</p>
<p><a class="btn" href="/submit/">Suggest an addition</a></p></header>
<div class="filters" role="group" aria-label="Filter the library">
  <button class="chip" aria-pressed="true" data-f="all">All</button>
  <button class="chip" aria-pressed="false" data-f="track:astro">Astrophysics</button>
  <button class="chip" aria-pressed="false" data-f="track:quantum">Quantum</button>
</div>
<section id="experiments"><h2 class="section-title">Experiments</h2><div class="grid">${experiments.map(experimentCard).join('')}</div></section>
<section id="books"><h2 class="section-title">Books</h2><ul class="list">${books.map(bookRow).join('')}</ul></section>
<section id="resources"><h2 class="section-title">Tools and resources</h2><ul class="list">${resources.map(resourceRow).join('')}</ul></section>
<section id="community-library" hidden><h2 class="section-title">Added by members</h2><div id="community-items" class="grid"></div></section>`,
  })
);

// Plan
const planBody = `<header class="page-head"><h1>The plan</h1><p class="lede">A suggested path: about 2–4 hours a week over a winter. Each phase pairs reading with a hands-on project — read just enough, then go and do it. Your own progress shows up in <a href="/notebook/">My notebook</a>.</p></header>
<ol class="timeline">
${site.phases
  .map((p) => {
    const exps = experiments.filter((e) => e.phase === p.id);
    const bks = books.filter((b) => b.phase === p.id);
    return `<li class="phase" data-phase="${esc(p.id)}">
  <span class="phase-moon">${icon('moonNew', { scale: 2 })}</span>
  <div class="phase-when"><span>${esc(p.when)}</span><span class="muted small">${esc(p.weeks || '')}</span></div>
  <div class="phase-body">
    <h2>${esc(p.title)}</h2>
    <p>${esc(p.summary)}</p>
    ${bks.length ? `<p class="eyebrow">Read</p><ul class="mini">${bks.map((b) => `<li data-item-id="${b.slug}"><a href="/reading/${b.slug}/">${esc(b.title)}</a></li>`).join('')}</ul>` : ''}
    ${exps.length ? `<p class="eyebrow">Do</p><ul class="mini">${exps.map((e) => `<li data-item-id="${e.slug}"><a href="/experiments/${e.slug}/">${esc(e.title)}</a></li>`).join('')}</ul>` : ''}
    ${p.extras?.length ? `<p class="eyebrow">Also</p><ul class="mini plain">${p.extras.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
  </div>
</li>`;
  })
  .join('\n')}
</ol>
<section class="method win"><div class="win-bar"><span>Method</span><span class="fill dither" aria-hidden="true"></span></div><div class="win-body">
  <h2 class="section-title">How every project runs</h2>
  <ol class="steps">
    <li><strong>Learn just enough.</strong> One short video or chapter on the idea.</li>
    <li><strong>Predict.</strong> Write down what you expect before measuring.</li>
    <li><strong>Do it.</strong> Record everything, including the messy bits.</li>
    <li><strong>Explain it.</strong> A one-page write-up for a friend — share it with the community if you like.</li>
    <li><strong>Follow the questions.</strong> They become the next project.</li>
  </ol>
</div></section>`;
await write('plan/index.html', layout({ title: 'The plan', path: '/plan/', body: planBody, script: 'plan' }));

// About
const aboutSrc = await readFile(join(ROOT, 'content/about.md'), 'utf8').catch(() => '');
const about = markdown(parseFrontMatter(aboutSrc).body);
await write(
  'about/index.html',
  layout({ title: 'About', path: '/about/', body: `<article class="entry"><header class="entry-head"><h1>About</h1></header><div class="prose">${about.html}</div></article>` })
);

// Home
const homeBody = `<section class="hero">
  <div class="hero-copy">
    <p class="eyebrow">A community lab notebook</p>
    <h1>${esc(site.tagline.split(' — ')[0])}.</h1>
    <p class="lede">Recreate famous physics experiments at home, keep your data in a private notebook, log your nights under the stars, and share what you find.</p>
    <div class="hero-actions" id="hero-actions">
      <a class="btn primary" href="/login/?mode=signup">Start your notebook — free</a>
      <a class="btn" href="/library/">Browse library</a>
    </div>
    <p class="readout">${experiments.length} EXPERIMENTS · ${books.length} BOOKS · ${resources.length} TOOLS · £0 TO JOIN</p>
  </div>
  <figure class="hero-figure win">
    <div class="win-bar"><span>Jupiter and its moons</span><span class="fill dither" aria-hidden="true"></span></div>
    <div class="win-body" style="display:flex;flex-direction:column;gap:14px;background:var(--paper)">
      <div class="jupiter-view" role="img" aria-label="Jupiter with its four largest moons in a line, as seen through binoculars">
        <span class="jv-moon" aria-hidden="true"><i></i>Callisto</span>
        <span class="jv-moon" aria-hidden="true"><i></i>Io</span>
        <span class="jv-planet" aria-hidden="true">${icon('jupiter', { scale: 10 }).replace('viewBox="0 0 21 9" width="210" height="90"', 'viewBox="0 0 9 9" width="90" height="90"')}</span>
        <span class="jv-moon" aria-hidden="true"><i></i>Europa</span>
        <span class="jv-moon" aria-hidden="true"><i style="width:10px;height:10px"></i>Ganymede</span>
      </div>
      <div class="readouts">
        <div><p class="k">Period</p><p class="v">7.15 d</p></div>
        <div><p class="k">Orbit</p><p class="v">1.07e9 m</p></div>
        <div class="inv"><p class="k">Mass</p><p class="v">1.90e27 kg</p></div>
      </div>
      <figcaption class="muted small">Kepler's third law, M = 4π²a³ / GT² — the <a href="/experiments/weigh-jupiter/">Weigh Jupiter</a> experiment.</figcaption>
    </div>
  </figure>
</section>

<section class="how">
  <div><div class="how-top"><span class="how-num">01</span>${icon('telescope', { scale: 3 })}</div><h3>Pick an experiment</h3><p>Each guide has the kit, the method and the maths. Most cost under £15.</p></div>
  <div><div class="how-top"><span class="how-num">02</span>${icon('moonHalf', { scale: 3 })}</div><h3>Track it</h3><p>Your private notebook keeps a journal entry for every session — new moon to full moon.</p></div>
  <div><div class="how-top"><span class="how-num">03</span>${icon('star', { scale: 3 })}</div><h3>Share it</h3><p>Publish a write-up to the community, swap tips, and suggest new experiments.</p></div>
</section>

<section>
  <div class="section-row"><h2 class="section-title">The road map</h2><a href="/plan/">Full plan →</a></div>
  <ol class="road">${site.phases
    .map(
      (p) =>
        `<li data-phase="${esc(p.id)}">${icon('moonNew', { scale: 2 })}<span class="when">${esc(p.when.toUpperCase())}</span><strong>${esc(p.title)}</strong><span class="muted small">${
          experiments.filter((e) => e.phase === p.id).length
        } experiments</span></li>`
    )
    .join('')}</ol>
</section>

<section>
  <div class="section-row"><h2 class="section-title">Experiments</h2><a href="/library/">Whole library →</a></div>
  <div class="grid">${experiments.slice(0, 6).map(experimentCard).join('')}</div>
</section>

<section>
  <div class="section-row"><h2 class="section-title">From the community</h2><a href="/community/">See all →</a></div>
  <div id="home-feed" class="grid"><p class="muted">Loading the latest write-ups…</p></div>
</section>`;
await write('index.html', layout({ title: '', path: '/', body: homeBody, wide: true, script: 'home' }));

// App pages
await appPage('/login/', { title: 'Log in', script: 'login' });
await appPage('/notebook/', { title: 'My notebook', script: 'notebook', wide: true });
await appPage('/notebook/item/', { title: 'Notebook entry', script: 'item' });
await appPage('/notebook/observations/', { title: 'Observing log', script: 'observations' });
await appPage('/notebook/profile/', { title: 'Profile', script: 'profile' });
await appPage('/community/', {
  title: 'Community',
  script: 'community',
  intro: `<header class="page-head"><h1>Community</h1><p class="lede">Write-ups and observing logs shared by members. Be kind, be curious, and show your working.</p></header>`,
});
await appPage('/community/post/', { title: 'Write-up', script: 'post' });
await appPage('/library/item/', { title: 'Library item', script: 'library-item' });
await appPage('/submit/', {
  title: 'Suggest an addition',
  script: 'submit',
  intro: `<header class="page-head"><h1>Suggest an addition</h1><p class="lede">Know a great home experiment, book, video or tool? Suggest it here. An admin checks every suggestion before it joins the library.</p></header>`,
});
await appPage('/tonight/', { title: "Tonight's sky", script: 'tonight', wide: true });

// 404
await write(
  '404.html',
  layout({
    title: 'Lost in space',
    path: '/404.html',
    noindex: true,
    body: `<section class="hero"><p class="eyebrow">404</p><h1>Lost in space.</h1><p class="lede">That page drifted out of orbit. <a href="/">Head back home</a>.</p></section>`,
  })
);

// Sitemap
const abs = (p) => `${siteUrl}${p}`;
const urls = ['/', '/library/', '/plan/', '/tonight/', '/community/', '/about/', ...experiments.map((e) => `/experiments/${e.slug}/`), ...books.map((b) => `/reading/${b.slug}/`)];
await write(
  'sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${abs(u)}</loc></url>`).join('\n')}
</urlset>
`
);
await write(
  'robots.txt',
  `User-agent: *\nAllow: /\nDisallow: /notebook/\nDisallow: /api/\nSitemap: ${abs('/sitemap.xml')}\n`
);

console.log(
  `Built site: ${experiments.length} experiments, ${books.length} books, ${resources.length} resources` +
    `${config.clientId ? '' : ' (sign-in not configured — set COGNITO_REGION and COGNITO_CLIENT_ID)'} in ${Date.now() - t0} ms → dist/`
);
