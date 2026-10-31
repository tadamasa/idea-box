// 画面に触れない処理。node --test で確かめられるように、DOMやIndexedDBを使わない。

export const KINDS = {
  memo: 'メモ',
  url: 'Web',
  video: '動画',
  quote: '名言・引用',
  photo: '写真',
  summary: 'まとめ',
  tag: 'タグ',
};

const URL_RE = /https?:\/\/[^\s<>"'「」]+/i;
const VIDEO_RE = /^(https?:\/\/)?((www|m)\.)?(youtube\.com|youtu\.be|vimeo\.com|nicovideo\.jp)\//i;

export function extractUrl(text) {
  const m = URL_RE.exec(text || '');
  return m ? m[0].replace(/[).,、。]+$/, '') : '';
}

// 入力内容から種類を推し量る。選ぶ手間を省くためのもので、あとで変えられる。
export function detectKind({ text = '', url = '', kind = '' } = {}) {
  if (kind && KINDS[kind] && kind !== 'tag') return kind;
  const u = url || extractUrl(text);
  if (u && VIDEO_RE.test(u)) return 'video';
  if (u) return 'url';
  const t = text.trim();
  if (/^[「『"“]/.test(t)) return 'quote';
  return 'memo';
}

// 共有シートやChrome拡張から ?capture=1&text=...&url=...&title=...&kind=...&tags=a,b で受け取る
export function parseCapture(search) {
  const p = new URLSearchParams(search);
  if (!p.has('capture')) return null;
  const text = (p.get('text') || '').trim();
  const url = (p.get('url') || '').trim() || extractUrl(text);
  const title = (p.get('title') || '').trim();
  const quote = (p.get('quote') || '').trim();
  const tags = (p.get('tags') || '').split(/[,、\s]+/).map(normTag).filter(Boolean);
  if (!text && !url && !title && !quote) return null;
  return { text, url, title, quote, kind: (p.get('kind') || '').trim(), tags };
}

export function newCard({ id, now = new Date().toISOString(), text = '', url = '', title = '', quote = '', kind = '', tags = [], inbox = true }) {
  const u = url || extractUrl(text);
  // 本文がURLだけなら本文は空にして、URL欄に移す
  const body = u && text.trim() === u ? '' : text.trim();
  return {
    id,
    kind: detectKind({ text, url: u, kind }),
    title: title.trim(),
    body,
    url: u,
    quote: quote.trim(),
    tags: [...new Set(tags)],
    inbox,
    action: null,
    createdAt: now,
    updatedAt: now,
  };
}

// タグ名の表記ゆれをそろえる: 全角英数→半角、先頭の#を外す、空白をつめる、英字は小文字
export function normTag(name) {
  return String(name ?? '').normalize('NFKC').replace(/^#+/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// タグのidは名前から決める。2台の端末が同じ名前のタグを同時に作っても、同じタグになる
export function tagId(name) {
  const key = normTag(name);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `t-${h1.toString(36)}${h2.toString(36)}`;
}

export function displayTitle(card) {
  if (!card) return '';
  if (card.title) return card.title;
  const first = (card.body || card.quote || '').split('\n').find(l => l.trim());
  if (first) return first.trim().slice(0, 80);
  if (card.url) {
    try { const u = new URL(card.url); return u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, ''); } catch { return card.url; }
  }
  return '(無題)';
}

function fold(s) { return String(s ?? '').normalize('NFKC').toLowerCase(); }

// 空白で区切った語をすべて含むものだけ残す。タグ名でも当たる。
export function matches(card, query, tagNames = new Map()) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold([card.title, card.body, card.quote, card.url, ...(card.tags || []).map(t => tagNames.get(t) || '')].join('\n'));
  return words.every(w => hay.includes(w.replace(/^#/, '')));
}

// 文字の2-gram。日本語に分かち書きなしで効く、軽い近さの目安。
export function bigrams(text) {
  const s = fold(text).replace(/https?:\/\/\S+/g, ' ').replace(/[\s\p{P}\p{S}]+/gu, ' ');
  const out = new Set();
  for (const w of s.split(' ')) for (let i = 0; i < w.length - 1; i++) out.add(w.slice(i, i + 2));
  return out;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n);
}

// 近いカード: 共有するタグの数を主に、本文の言葉の重なりを従にして並べる。
// 返り値: [{ card, shared: [tagId], score }]
export function nearCards(cards, target, { limit = 6 } = {}) {
  const tags = new Set(target.tags || []);
  const grams = bigrams([target.title, target.body, target.quote].join(' '));
  const out = [];
  for (const c of cards) {
    if (c.id === target.id || c.deleted || c.kind === 'tag') continue;
    const shared = (c.tags || []).filter(t => tags.has(t));
    const sim = jaccard(grams, bigrams([c.title, c.body, c.quote].join(' ')));
    const score = shared.length + sim * 2;
    if (shared.length || sim >= 0.12) out.push({ card: c, shared, score });
  }
  return out.sort((a, b) => b.score - a.score || (b.card.updatedAt || '').localeCompare(a.card.updatedAt || '')).slice(0, limit);
}

// あるタグと一緒に付いていることが多いタグ。[{ tagId, count }]
export function relatedTags(cards, tagId, { limit = 8 } = {}) {
  const count = new Map();
  for (const c of cards) {
    if (c.deleted || !(c.tags || []).includes(tagId)) continue;
    for (const t of c.tags) if (t !== tagId) count.set(t, (count.get(t) || 0) + 1);
  }
  return [...count].map(([t, n]) => ({ tagId: t, count: n })).sort((a, b) => b.count - a.count).slice(0, limit);
}

// アクションの並び: 未完了(期限の近い順、期限なしは後ろで新しい順)→ 完了(新しい順)
export function sortActions(cards) {
  const open = cards.filter(c => c.action && !c.action.done && !c.deleted);
  const done = cards.filter(c => c.action && c.action.done && !c.deleted);
  open.sort((a, b) => {
    const da = a.action.due || '9999', dbb = b.action.due || '9999';
    return da.localeCompare(dbb) || (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });
  done.sort((a, b) => (b.action.doneAt || '').localeCompare(a.action.doneAt || ''));
  return { open, done };
}

export function isOverdue(action, today) {
  return !!(action && !action.done && action.due && action.due < today);
}
