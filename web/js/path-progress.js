// Works out a member's progress on learning paths from their notebook (no extra tracking),
// plus which paths they follow and which steps they've skipped.
import { get } from './api.js';
import { getSession } from './auth.js';

export const isDone = (status) => status === 'done' || status === 'finished';
export const isStarted = (status) => Boolean(status) && status !== 'planned' && status !== 'to-read';
export const STEP_VERB = { book: 'Read', experiment: 'Do' };

let pathsCache;
export const loadPaths = () => (pathsCache ||= fetch('/paths.json').then((r) => r.json()));

/** Returns { byId, paths, enrolments } for a signed-in member, or null when signed out. */
export async function loadPathProgress() {
  if (!getSession()) return null;
  const [{ items }, paths, { enrolments }] = await Promise.all([get('/me/progress'), loadPaths(), get('/me/paths')]);
  return {
    byId: Object.fromEntries(items.map((p) => [p.itemId, p])),
    paths,
    enrolments: Object.fromEntries(enrolments.map((e) => [e.pathId, e])),
  };
}

/** Counts for one path: done steps (skipped ones count), total, each stage's state, and the next step. */
export function summarise(path, byId, enrolment) {
  const skipped = enrolment?.skipped || {};
  const complete = (id) => isDone(byId[id]?.status) || Boolean(skipped[id]);
  let done = 0;
  let total = 0;
  let nextStep = null;
  const stages = path.stages.map((s) => {
    const d = s.items.filter(complete).length;
    const started = s.items.some((id) => isStarted(byId[id]?.status) || skipped[id]);
    done += d;
    total += s.items.length;
    if (!nextStep) {
      const step = (s.steps || []).find((st) => !complete(st.id));
      if (step) nextStep = { ...step, stage: s.title, stageId: s.id, status: byId[step.id]?.status || '' };
    }
    const state = s.items.length && d === s.items.length ? 'complete' : d || started ? 'started' : 'not-started';
    return { id: s.id, title: s.title, done: d, total: s.items.length, state };
  });
  const next = stages.find((s) => s.state !== 'complete');
  return { done, total, stages, next, nextStep, started: stages.some((s) => s.state !== 'not-started') };
}
