// Reads the small block of settings at the top of each entry:
//
// ---
// title: Weigh Jupiter
// status: in-progress
// tags: [astro, kepler]
// ---
//
// Supports strings, numbers, true/false, [inline, lists] and "- item" lists.

function parseValue(raw) {
  let v = raw.trim();
  // Allow trailing "# comments" after unquoted values
  if (!/^["']/.test(v)) v = v.replace(/\s+#.*$/, '').trim();
  else v = v.replace(/^(["'])(.*?)\1\s+#.*$/, '$1$2$1');
  if (v === '') return '';
  if (/^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (/^\[.*\]$/.test(v)) {
    return v
      .slice(1, -1)
      .split(',')
      .map((x) => parseValue(x))
      .filter((x) => x !== '');
  }
  const q = v.match(/^(["'])(.*)\1$/);
  return q ? q[2] : v;
}

export function parseFrontMatter(text) {
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { data: {}, body: src };

  const data = {};
  let listKey = null;
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = line.match(/^\s+-\s+(.*)$/) || line.match(/^-\s+(.*)$/);
    if (item && listKey) {
      if (!Array.isArray(data[listKey])) data[listKey] = [];
      data[listKey].push(parseValue(item[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    if (value.trim() === '') {
      data[key] = ''; // becomes a list if "- item" lines follow
      listKey = key;
    } else {
      data[key] = parseValue(value);
      listKey = null;
    }
  }
  return { data, body: src.slice(m[0].length) };
}
