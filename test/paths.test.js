import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parsePath, resolvePath, pathIndex } from '../src/paths.js';

const SAMPLE = `---
title: Sample path
summary: A promise.
track: quantum
level: beginner
length: 2 weeks
---
Intro text.

## First stage
when: Nov
checkpoint: Explain it back.

Why it matters.

- read: a-book — chapter 2
- do: an-experiment
- optional use: a-tool
- task: Look up — at the sky

## Second
id: custom-id

- do: an-experiment
`;

const lib = {
  book: new Map([['a-book', { title: 'A Book', url: '/reading/a-book/' }]]),
  experiment: new Map([['an-experiment', { title: 'An Experiment', url: '/experiments/an-experiment/' }]]),
  resource: new Map([['a-tool', { title: 'A Tool', url: 'https://example.org' }]]),
};

test('parses meta, stages, settings and steps', () => {
  const p = parsePath(SAMPLE, { slug: 'sample' });
  assert.equal(p.meta.id, 'sample');
  assert.equal(p.meta.track, 'quantum');
  assert.equal(p.intro, 'Intro text.');
  assert.equal(p.stages.length, 2);
  const [a, b] = p.stages;
  assert.equal(a.id, 'first-stage');
  assert.equal(a.when, 'Nov');
  assert.equal(a.checkpoint, 'Explain it back.');
  assert.equal(a.intro, 'Why it matters.');
  assert.deepEqual(a.steps[0], { type: 'read', ref: 'a-book', note: 'chapter 2', optional: false });
  assert.equal(a.steps[2].optional, true);
  assert.equal(a.steps[3].text, 'Look up — at the sky', 'task text keeps its dashes');
  assert.equal(b.id, 'custom-id');
});

test('resolves steps to library items and counts tracked steps', () => {
  const r = resolvePath(parsePath(SAMPLE, { slug: 'sample' }), lib);
  assert.equal(r.stages[0].steps[0].title, 'A Book');
  assert.equal(r.stages[0].steps[2].external, true);
  assert.equal(r.stages[0].steps[3].kind, 'task');
  assert.deepEqual(r.counts, { stages: 2, steps: 3, optional: 0 });
});

test('clear errors for broken paths', () => {
  assert.throws(() => resolvePath(parsePath(SAMPLE.replace('do: an-experiment\n- optional', 'do: missing-one\n- optional'), { slug: 's' }), lib), /missing-one/);
  assert.throws(() => resolvePath(parsePath(SAMPLE.replace('read: a-book', 'do: a-book'), { slug: 's' }), lib), /it's a book, so use "read:"/);
  assert.throws(() => parsePath(SAMPLE.replace('- task:', '- watch:'), { slug: 's' }), /unknown step type "watch"/);
  assert.throws(() => parsePath('---\ntitle: X\n---\nno stages', { slug: 's' }), /at least one/);
  assert.throws(() => parsePath(SAMPLE.replace('id: custom-id', 'id: first-stage'), { slug: 's' }), /share the id/);
  assert.throws(() => parsePath(SAMPLE, { slug: 'Bad Name' }), /lowercase/);
});

test('path index lists each path once per item', () => {
  const idx = pathIndex([resolvePath(parsePath(SAMPLE, { slug: 'sample' }), lib)]);
  assert.deepEqual(idx.get('an-experiment'), [{ id: 'sample', title: 'Sample path', stage: 'First stage' }]);
});

test('the Road Map keeps the original five phases', async () => {
  const p = parsePath(await readFile(new URL('../content/paths/road-map.md', import.meta.url), 'utf8'), { slug: 'road-map' });
  assert.deepEqual(p.stages.map((s) => s.id), ['orient', 'light', 'constant', 'space', 'level-up']);
});
