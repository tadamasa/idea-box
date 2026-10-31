// 画面に触れない処理。node --test で確かめられるように、DOMやIndexedDBを使わない。

export const KINDS = {
  memo: 'メモ',
  url: 'Web',
  video: '動画',
  quote: '名言・引用',
  photo: '写真',
  summary: 'まとめ',
  tag: 'タグ',
  project: 'プロジェクト',
  step: '手順',
};

// 受信箱・すべて・近いカードに並べる「情報」のカードか(タグ・プロジェクト・手順は別の画面で扱う)
export const isInfo = c => !c.deleted && c.kind !== 'tag' && c.kind !== 'project' && c.kind !== 'step';

const URL_RE = /https?:\/\/[^\s<>"'「」]+/i;
const VIDEO_RE = /^(https?:\/\/)?((www|m)\.)?(youtube\.com|youtu\.be|vimeo\.com|nicovideo\.jp)\//i;

export function extractUrl(text) {
  const m = URL_RE.exec(text || '');
  return m ? m[0].replace(/[).,、。]+$/, '') : '';
}

// 入力内容から種類を推し量る。選ぶ手間を省くためのもので、あとで変えられる。
export function detectKind({ text = '', url = '', kind = '' } = {}) {
  if (kind && KINDS[kind] && !['tag', 'project', 'step'].includes(kind)) return kind;
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

// タグごとの色相(0〜359)。idから決まるので、どの端末でも同じ色になる
// プロジェクトの色。色はプロジェクトにだけ付け、所属するカードには小さな点で出す
export const PROJECT_COLORS = [['red', '赤'], ['orange', '橙'], ['yellow', '黄'], ['green', '緑'], ['teal', '青緑'], ['blue', '青'], ['purple', '紫'], ['pink', '桃'], ['gray', '灰']];
const COLOR_KEYS = new Set(PROJECT_COLORS.map(c => c[0]));
export const colorVar = key => `var(--sys-${key})`;

// 点の塗り。1色ならその色、複数なら円を等分して塗り分ける(1つの点で複数の所属を表す)
export function dotFill(keys) {
  const list = [...new Set(keys)].filter(k => COLOR_KEYS.has(k)).slice(0, 4);
  if (!list.length) return '';
  if (list.length === 1) return colorVar(list[0]);
  const step = 360 / list.length;
  return `conic-gradient(${list.map((k, i) => `${colorVar(k)} ${i * step}deg ${(i + 1) * step}deg`).join(', ')})`;
}

// プロジェクトにつながっている情報カードの数(手順・タグ・ほかのプロジェクトは数えない)
export function linkedInfoCount(cards, projectId, idx = linkIndex(cards)) {
  const byId = new Map(cards.map(c => [c.id, c]));
  let n = 0;
  for (const id of idx.get(projectId) || []) { const c = byId.get(id); if (c && !c.deleted && isInfo(c)) n++; }
  return n;
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
    if (c.id === target.id || !isInfo(c)) continue;
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

// アクション画面に出すもの: 単発のアクションはすべて、プロジェクトの手順は期限を付けたものだけ
export function forActionList(cards) {
  return cards.filter(c => !c.deleted && c.action && (c.kind !== 'step' || c.action.due));
}

// ---------- プロジェクト ----------
// つながりは片方のカードの links に書くだけにし、表示は両方向から集める。
// 両方に書き込むと、2台の端末で同時に変えたときに片側だけ残ることがあるため。
export function linkedIds(cards, id) {
  const me = cards.find(c => c.id === id);
  const out = new Set(me && !me.deleted ? me.links || [] : []);
  for (const c of cards) if (!c.deleted && (c.links || []).includes(id)) out.add(c.id);
  out.delete(id);
  return [...out];
}

// つながりの索引: id → つながっている id の集合(両方向)。一覧で行ごとに linkedIds を呼ぶと遅いので、まとめて作る
export function linkIndex(cards) {
  const idx = new Map();
  const add = (a, b) => { if (!idx.has(a)) idx.set(a, new Set()); idx.get(a).add(b); };
  for (const c of cards) {
    if (c.deleted) continue;
    for (const l of c.links || []) if (l !== c.id) { add(c.id, l); add(l, c.id); }
  }
  return idx;
}

// 一覧の並べ替え
//  created: 新しく入れた順 / oldest: 古い順 / updated: 最近さわった順
//  due: 未完了のアクションの期日が近い順 → 期日なしのアクション → アクションなし(それぞれ新しい順)
export const SORTS = { created: '新しい順', oldest: '古い順', updated: '最近さわった順', due: '期日の近い順' };
export function sortCards(list, sort = 'created') {
  const newest = (a, b) => (b.createdAt || '').localeCompare(a.createdAt || '');
  const rank = c => !c.action || c.action.done ? 2 : c.action.due ? 0 : 1;
  const cmp = {
    created: newest,
    oldest: (a, b) => -newest(a, b),
    updated: (a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '') || newest(a, b),
    due: (a, b) => rank(a) - rank(b) || (rank(a) === 0 ? a.action.due.localeCompare(b.action.due) : 0) || newest(a, b),
  }[sort] || newest;
  return [...list].sort(cmp);
}

// プロジェクトの手順を order の順に。手順はそれぞれカードで、project に属するプロジェクトのidを持つ
export function projectSteps(cards, projectId) {
  return cards.filter(c => !c.deleted && c.kind === 'step' && c.project === projectId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.createdAt || '').localeCompare(b.createdAt || ''));
}

export function nextOrder(steps) {
  return steps.length ? Math.max(...steps.map(s => s.order ?? 0)) + 1 : 1;
}

export function newStep({ id, projectId, text, order, due = null, now = new Date().toISOString() }) {
  const t = String(text || '').trim();
  return {
    id, kind: 'step', title: t, body: '', url: '', quote: '', tags: [], links: [], inbox: false,
    project: projectId, order,
    action: { text: t, due: due || null, done: false, doneAt: null, doneNote: '' },
    createdAt: now, updatedAt: now,
  };
}

export function newProject({ id, title, goal = '', now = new Date().toISOString() }) {
  return {
    id, kind: 'project', title: String(title || '').trim(), body: '', goal: String(goal || '').trim(), due: null,
    status: 'active', closeNote: '', closedAt: null, url: '', quote: '', tags: [], links: [], inbox: false, action: null,
    createdAt: now, updatedAt: now,
  };
}

// 手順の進み具合(例: 2/5)。件数で急かさないよう、画面では小さく出すだけにする
export function stepProgress(steps) {
  return { done: steps.filter(s => s.action && s.action.done).length, all: steps.length };
}

// Gemini が返した手順案を、短い文の配列にそろえる。JSONでも箇条書きでも受け取る
export function parseSteps(text, existing = []) {
  let list = [];
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    const j = JSON.parse(raw);
    list = (Array.isArray(j) ? j : j.steps || []).map(x => typeof x === 'string' ? x : x && (x.text || x.step) || '');
  } catch {
    list = raw.split('\n').map(l => l.replace(/^\s*(?:[-*・]|\d+[.)、])\s*/, ''));
  }
  const seen = new Set(existing.map(e => normTag(e)));
  const out = [];
  for (const t of list.map(x => String(x).trim()).filter(Boolean)) {
    const k = normTag(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t.slice(0, 120));
  }
  return out;
}

export function isOverdue(action, today) {
  return !!(action && !action.done && action.due && action.due < today);
}
