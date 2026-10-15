// A small, dependency-free Markdown converter covering what a lab notebook needs:
// headings, paragraphs, bold/italic, links, images, inline + fenced code, quotes,
// bullet/numbered/task lists, tables, horizontal rules and maths ($$ … $$, \( … \)).

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const slugify = (s) =>
  String(s)
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// Only allow web links, site-relative links, anchors and email — never javascript: or data:
// (important now that members' writing is rendered on the site).
const safeUrl = (url, { image = false } = {}) => {
  const ok = image
    ? /^(https:\/\/|http:\/\/|\/(?!\/))/i.test(url)
    : /^(https?:\/\/|\/(?!\/)|#|mailto:|\.{1,2}\/)/i.test(url);
  return ok ? url : '#';
};

function inline(text) {
  const stash = [];
  const keep = (html) => `\u0000${stash.push(html) - 1}\u0000`;

  // Protect maths and code before anything else touches them.
  let s = text
    .replace(/\\\((.+?)\\\)/g, (_, m) => keep(`\\(${escapeHtml(m)}\\)`))
    .replace(/`([^`]+)`/g, (_, c) => keep(`<code>${escapeHtml(c)}</code>`));

  s = escapeHtml(s);

  s = s
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;(.*?)&quot;)?\)/g, (_, alt, src, title) =>
      keep(
        `<figure><img src="${safeUrl(src, { image: true })}" alt="${alt}" loading="lazy">${
          title || alt ? `<figcaption>${title || alt}</figcaption>` : ''
        }</figure>`
      )
    )
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
      const safe = safeUrl(href);
      const external = /^https?:\/\//.test(safe);
      return `<a href="${safe}"${external ? ' rel="noopener nofollow ugc" target="_blank"' : ''}>${label}</a>`;
    })
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?!\s)(.+?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>');

  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)]);
}

function renderList(allItems, ordered) {
  const items = allItems.filter((i) => i.trim());
  if (!items.length) return '<p class="placeholder">Notes to come.</p>';
  const tag = ordered ? 'ol' : 'ul';
  const isTask = items.some((i) => /^\[( |x|X)\]\s/.test(i));
  const lis = items
    .map((item) => {
      const task = item.match(/^\[( |x|X)\]\s+(.*)$/);
      if (task) {
        const done = task[1].toLowerCase() === 'x';
        return `<li class="task${done ? ' done' : ''}"><span class="box" aria-hidden="true">${
          done ? '✓' : ''
        }</span><span>${inline(task[2])}</span></li>`;
      }
      return `<li>${inline(item)}</li>`;
    })
    .join('');
  return `<${tag}${isTask ? ' class="tasks"' : ''}>${lis}</${tag}>`;
}

function renderTable(rows) {
  const cells = (row) =>
    row
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
  const head = cells(rows[0]);
  const aligns = cells(rows[1]).map((c) =>
    /^:-+:$/.test(c) ? 'center' : /^-+:$/.test(c) ? 'right' : ''
  );
  const td = (tag, c, i) =>
    `<${tag}${aligns[i] ? ` style="text-align:${aligns[i]}"` : ''}>${inline(c)}</${tag}>`;
  const body = rows
    .slice(2)
    .map((r) => `<tr>${cells(r).map((c, i) => td('td', c, i)).join('')}</tr>`)
    .join('');
  return `<div class="table-wrap"><table><thead><tr>${head
    .map((c, i) => td('th', c, i))
    .join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export function markdown(src) {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const headings = [];
  let i = 0;

  const isBlockStart = (l) =>
    /^(#{1,6})\s/.test(l) ||
    /^```/.test(l) ||
    /^\$\$/.test(l.trim()) ||
    /^>\s?/.test(l) ||
    /^\s*([-*+]|\d+[.)])\s+/.test(l) ||
    /^(\*\s*){3,}$|^(-\s*){3,}$/.test(l.trim()) ||
    /^\|.*\|\s*$/.test(l);

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code
    const fence = line.match(/^```\s*([\w+-]*)/);
    if (fence) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      const lang = fence[1] ? ` class="language-${fence[1]}"` : '';
      out.push(`<pre><code${lang}>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // Display maths
    if (/^\$\$/.test(line.trim())) {
      const first = line.trim().slice(2);
      const buf = [];
      if (first.endsWith('$$') && first.length > 2) {
        buf.push(first.slice(0, -2));
        i++;
      } else {
        if (first) buf.push(first);
        i++;
        while (i < lines.length && !/\$\$\s*$/.test(lines[i])) buf.push(lines[i++]);
        if (i < lines.length) {
          const last = lines[i].replace(/\$\$\s*$/, '');
          if (last.trim()) buf.push(last);
          i++;
        }
      }
      out.push(`<div class="math">$$${escapeHtml(buf.join('\n'))}$$</div>`);
      continue;
    }

    // Headings
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      const level = h[1].length;
      const html = inline(h[2]);
      const id = slugify(html);
      if (level === 2 || level === 3) headings.push({ level, id, text: html.replace(/<[^>]+>/g, '') });
      out.push(`<h${level} id="${id}">${html}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(line.trim())) {
      out.push('<hr>');
      i++;
      continue;
    }

    // Blockquote (supports "> **Safety:** …" style callouts)
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      const inner = markdown(buf.join('\n')).html;
      const kind = buf[0].match(/^\*\*(Safety|Tip|Note|Result)[:.]?\*\*/i);
      out.push(
        `<blockquote${kind ? ` class="callout ${kind[1].toLowerCase()}"` : ''}>${inner}</blockquote>`
      );
      continue;
    }

    // Lists
    const li = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      const ordered = /\d/.test(li[1]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
        if (m && /\d/.test(m[1]) === ordered) {
          items.push(m[2]);
          i++;
        } else if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length) {
          items[items.length - 1] += ' ' + lines[i].trim();
          i++;
        } else break;
      }
      out.push(renderList(items, ordered));
      continue;
    }

    // Tables
    if (/^\|.*\|\s*$/.test(line) && /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1] || '')) {
      const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
      out.push(renderTable(rows));
      continue;
    }

    // Paragraph
    const buf = [];
    while (i < lines.length && lines[i].trim() && !(buf.length && isBlockStart(lines[i]))) {
      buf.push(lines[i++].trim());
    }
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }

  const html = out.join('\n');
  return { html, headings, hasMath: /\$\$|\\\(/.test(html) };
}

export { escapeHtml, slugify, inline };
