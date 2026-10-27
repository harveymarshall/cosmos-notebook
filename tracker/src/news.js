// Mission news from the free Spaceflight News API (https://api.spaceflightnewsapi.net/v4/docs).
// We keep headlines, a short summary and the link — the page sends readers to the original.

export const NEWS_API = 'https://api.spaceflightnewsapi.net/v4/articles/';

const clip = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : t;
};
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : null);

export function article(a) {
  const url = safeUrl(a?.url);
  if (!url || !a.title) return null;
  return {
    id: a.id ?? url,
    title: clip(a.title, 160),
    summary: clip(a.summary, 240),
    site: clip(a.news_site, 60),
    url,
    published: a.published_at || null,
  };
}

async function getArticles(params, fetch) {
  const res = await fetch(`${NEWS_API}?${new URLSearchParams({ ordering: '-published_at', ...params })}`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Spaceflight News API answered ${res.status}`);
  const body = await res.json();
  return (body.results || []).map(article).filter(Boolean);
}

/** A whole-word, case-insensitive match, so "Hera" doesn't match "Herald". */
export const mentions = (title, word) => new RegExp(`(^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu').test(title);

/**
 * Latest space news, plus up to 5 recent headlines for each mission.
 * A mission's first keyword is searched for; every keyword is then checked as a whole word
 * in the headline, so loose matches are dropped.
 */
export async function fetchNews(missions, { fetch = globalThis.fetch } = {}) {
  const latest = await getArticles({ limit: '12' }, fetch);
  const byMission = {};
  for (const m of missions) {
    try {
      const found = await getArticles({ limit: '10', title_contains: m.news[0] }, fetch);
      const hits = found.filter((a) => m.news.some((w) => mentions(a.title, w))).slice(0, 5);
      if (hits.length) byMission[m.slug] = hits;
    } catch (err) {
      console.warn(`news for ${m.slug}: ${err.message}`);
    }
  }
  // Tag the general list with the missions it mentions
  for (const a of latest) a.missions = missions.filter((m) => m.news.some((w) => mentions(a.title, w))).map((m) => m.slug);
  return { latest, byMission };
}
