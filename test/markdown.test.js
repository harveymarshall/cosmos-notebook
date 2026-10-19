import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdown } from '../src/markdown.js';

test('ordered lists keep their numbering when split by a code block', () => {
  const { html } = markdown('1. First\n2. Second\n\n```\ncode\n```\n\n3. Third\n');
  assert.match(html, /<ol><li>First<\/li><li>Second<\/li><\/ol>/);
  assert.match(html, /<ol start="3"><li>Third<\/li><\/ol>/);
});

test('a list starting at 1 has no start attribute', () => {
  assert.doesNotMatch(markdown('1. One\n2. Two\n').html, /start=/);
});
