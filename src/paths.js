// Learning paths: guided routes through the library (content/paths/*.md).
//
// ---
// title: Quantum from your kitchen
// summary: Measure two of nature's constants at home.   (the one-line promise)
// track: quantum            # astro | quantum | both
// level: beginner           # beginner | intermediate | advanced
// length: 8–10 weeks
// order: 2                  # position on the Paths page
// ---
// Optional intro (Markdown) before the first stage.
//
// ## What is light?            <- a stage
// id: light                    <- optional settings, one per line, straight after the heading
// when: Nov
// weeks: Weeks 3–6
// checkpoint: Why do the bands spread out when the slit gets narrower?
//
// Why this stage matters (Markdown).
//
// - read: seven-brief-lessons — the quantum chapter     <- a book
// - do: speed-of-light-chocolate                        <- an experiment
// - use: phet-simulations — the photoelectric effect    <- a tool or resource
// - task: Learn three constellations                    <- anything else (plain text)
// - optional do: laser-double-slit                      <- a stretch goal
//
// Step text after " — " is a short note shown with the step.

import { parseFrontMatter } from './frontmatter.js';

export const STEP_TYPES = { read: 'book', do: 'experiment', use: 'resource', task: null };
export const LEVELS = ['beginner', 'intermediate', 'advanced'];
const STAGE_SETTINGS = ['id', 'when', 'weeks', 'checkpoint'];
const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;

const slugify = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);

/** Parses one path file into { meta, intro, stages }. Throws with a clear message on bad syntax. */
export function parsePath(text, { slug, file = 'path' } = {}) {
  const { data, body } = parseFrontMatter(text);
  const id = data.slug || slug;
  const fail = (msg) => {
    throw new Error(`paths/${file}: ${msg}`);
  };
  if (!id || !SLUG.test(id)) fail('file names must be lowercase-with-dashes');
  if (!data.title) fail('needs a title');
  if (data.level && !LEVELS.includes(data.level)) fail(`level must be one of ${LEVELS.join(', ')}`);

  const lines = body.split('\n');
  const intro = [];
  const stages = [];
  let stage = null;
  let inSettings = false;

  lines.forEach((line, n) => {
    const where = `line ${n + 1}`;
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h && !line.startsWith('###')) {
      stage = { title: h[1], id: '', when: '', weeks: '', checkpoint: '', intro: [], steps: [] };
      stages.push(stage);
      inSettings = true;
      return;
    }
    if (!stage) {
      intro.push(line);
      return;
    }
    if (inSettings) {
      const kv = line.match(/^([a-z]+):\s*(.*)$/);
      if (kv && STAGE_SETTINGS.includes(kv[1])) {
        stage[kv[1]] = kv[2].trim();
        return;
      }
      if (line.trim() === '') return;
      inSettings = false;
    }
    const step = line.match(/^[-*]\s+(optional\s+)?([a-z]+):\s*(.+?)\s*$/);
    if (step) {
      const [, optional, type, rest] = step;
      if (!(type in STEP_TYPES)) fail(`${where}: unknown step type "${type}" (use ${Object.keys(STEP_TYPES).join(', ')})`);
      const [ref, ...noteParts] = rest.split(/\s+[—–]\s+/);
      const note = noteParts.join(' — ').trim();
      if (STEP_TYPES[type]) {
        if (!SLUG.test(ref.trim())) fail(`${where}: "${ref}" is not a library id (lowercase-with-dashes)`);
        stage.steps.push({ type, ref: ref.trim(), note, optional: Boolean(optional) });
      } else {
        stage.steps.push({ type, text: rest.trim(), note: '', optional: Boolean(optional) });
      }
      return;
    }
    if (/^[-*]\s+/.test(line) && stage.steps.length) fail(`${where}: steps look like "- do: experiment-id"`);
    stage.intro.push(line);
  });

  if (!stages.length) fail('needs at least one "## Stage" heading');
  const seen = new Set();
  for (const s of stages) {
    s.id = s.id || slugify(s.title);
    if (!SLUG.test(s.id)) fail(`stage "${s.title}": id must be lowercase-with-dashes`);
    if (seen.has(s.id)) fail(`two stages share the id "${s.id}"`);
    seen.add(s.id);
    s.intro = s.intro.join('\n').trim();
    if (!s.steps.length) fail(`stage "${s.title}" has no steps`);
  }

  return {
    meta: {
      id,
      title: data.title,
      summary: data.summary || '',
      track: data.track || 'both',
      level: data.level || 'beginner',
      length: data.length || '',
      order: Number(data.order) || 99,
      draft: data.draft === true,
    },
    intro: intro.join('\n').trim(),
    stages,
  };
}

/**
 * Checks every step points at something real and fills in titles and links.
 * `library` = { experiment: Map(slug → item), book: Map, resource: Map }.
 */
export function resolvePath(path, library, { file = path.meta.id } = {}) {
  const stages = path.stages.map((s) => ({
    ...s,
    steps: s.steps.map((step) => {
      const kind = STEP_TYPES[step.type];
      if (!kind) return { ...step, kind: 'task', title: step.text };
      const item = library[kind]?.get(step.ref);
      if (!item) {
        const other = Object.entries(library).find(([, m]) => m.has(step.ref));
        const hint = other ? ` — it's a ${other[0]}, so use "${Object.keys(STEP_TYPES).find((t) => STEP_TYPES[t] === other[0])}:"` : '';
        throw new Error(`paths/${file}: stage "${s.title}" points at "${step.ref}", which isn't a ${kind} in the library${hint}`);
      }
      return { ...step, kind, title: item.title, url: item.url, external: kind === 'resource' };
    }),
  }));
  // Steps that count towards progress: books and experiments that aren't optional
  const tracked = stages.flatMap((s) => s.steps).filter((st) => st.kind === 'book' || st.kind === 'experiment');
  const optional = tracked.filter((st) => st.optional).length;
  return { ...path, stages, counts: { stages: stages.length, steps: tracked.length - optional, optional } };
}

/** Item id → the paths (and stages) that include it, for "Part of" links on library pages. */
export function pathIndex(paths) {
  const index = new Map();
  for (const p of paths)
    for (const s of p.stages)
      for (const st of s.steps) {
        if (!st.ref) continue;
        if (!index.has(st.ref)) index.set(st.ref, []);
        if (!index.get(st.ref).some((x) => x.id === p.meta.id)) index.get(st.ref).push({ id: p.meta.id, title: p.meta.title, stage: s.title });
      }
  return index;
}
