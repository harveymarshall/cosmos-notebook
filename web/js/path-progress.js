// Works out a member's progress on learning paths from their notebook (no extra tracking).
import { get } from './api.js';
import { getSession } from './auth.js';

export const isDone = (status) => status === 'done' || status === 'finished';
export const isStarted = (status) => Boolean(status) && status !== 'planned' && status !== 'to-read';

/** Returns { byId, paths } for a signed-in member, or null when signed out. */
export async function loadPathProgress() {
  if (!getSession()) return null;
  const [{ items }, paths] = await Promise.all([get('/me/progress'), fetch('/paths.json').then((r) => r.json())]);
  const byId = Object.fromEntries(items.map((p) => [p.itemId, p]));
  return { byId, paths };
}

/** Counts for one path: done steps, total steps, and the state of each stage. */
export function summarise(path, byId) {
  let done = 0;
  let total = 0;
  const stages = path.stages.map((s) => {
    const d = s.items.filter((id) => isDone(byId[id]?.status)).length;
    const started = s.items.some((id) => isStarted(byId[id]?.status));
    done += d;
    total += s.items.length;
    const state = s.items.length && d === s.items.length ? 'complete' : d || started ? 'started' : 'not-started';
    return { id: s.id, title: s.title, done: d, total: s.items.length, state };
  });
  const next = stages.find((s) => s.state !== 'complete');
  return { done, total, stages, next, started: stages.some((s) => s.state !== 'not-started') };
}
