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

// 情報カードではない、仕組みのためのカード(kinddef は種別の定義)
export const STRUCT_KINDS = ['tag', 'project', 'step', 'kinddef'];
// 受信箱・すべて・近いカードに並べる「情報」のカードか(タグ・プロジェクト・手順は別の画面で扱う)
export const isInfo = c => !c.deleted && !STRUCT_KINDS.includes(c.kind);

// ---------- 種別(情報ソースの種類) ----------
// 最初からある種別。fields はカードを作るときに出す欄: url=リンク、quote=引用、photo=写真
// 種別アイコン(線画・1色)。名前 → [呼び名, SVGのpath]。色は付けず文字色に合わせる
export const KIND_ICONS = {
  pencil: ['メモ', 'M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4'],
  link: ['リンク', 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1 M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1'],
  play: ['動画', 'M3 6.5A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z M10 9l5 3-5 3z'],
  quote: ['引用', 'M4 12h5v6H4v-5c0-3 1.5-5 4-6.5 M14 12h5v6h-5v-5c0-3 1.5-5 4-6.5'],
  camera: ['写真', 'M4 8h3l2-3h6l2 3h3v11H4z M15.5 13a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z'],
  layers: ['まとめ', 'M12 4l8 4.5-8 4.5-8-4.5z M4 12.5l8 4.5 8-4.5 M4 16.5l8 4.5 8-4.5'],
  book: ['本', 'M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3'],
  paper: ['論文・文書', 'M7 3h7l5 5v13H7z M14 3v5h5 M10 13h6 M10 17h6'],
  mic: ['音声', 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M5 11a7 7 0 0 0 14 0 M12 18v3'],
  music: ['音楽', 'M9 18V5l11-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'],
  chat: ['会話', 'M4 5h16v11H9l-5 4z'],
  person: ['人', 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0'],
  bulb: ['ひらめき', 'M9 18h6 M10 21h4 M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z'],
  bag: ['買い物', 'M5 8h14l-1 13H6z M9 8V6a3 3 0 0 1 6 0v2'],
  pin: ['場所', 'M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z M14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0z'],
  calendar: ['予定', 'M4 6h16v15H4z M4 10h16 M8 3v4 M16 3v4'],
  globe: ['世界', 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M3 12h18 M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z'],
  flask: ['実験・研究', 'M9 3h6 M10 3v6l-5 10a1.5 1.5 0 0 0 1.3 2h11.4a1.5 1.5 0 0 0 1.3-2l-5-10V3'],
  heart: ['好き', 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z'],
  star: ['大事', 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z'],
  dot: ['点', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'],
};
export const DEFAULT_KIND_ICON = 'dot';
const iconName = n => (Object.hasOwn(KIND_ICONS, n) ? n : '');
// アイコンのSVG。中身は上の固定の表からだけ作るので、そのまま innerHTML に入れてよい
export const kindIconSvg = (name, size = 14) => `<svg class="ki" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false"><path d="${KIND_ICONS[iconName(name) || DEFAULT_KIND_ICON][1]}"/></svg>`;

export const BASE_KINDS = [
  { key: 'memo', title: 'メモ', fields: [], icon: 'pencil' },
  { key: 'url', title: 'Web', fields: ['url'], icon: 'link' },
  { key: 'video', title: '動画', fields: ['url'], icon: 'play' },
  { key: 'quote', title: '名言・引用', fields: ['quote'], icon: 'quote' },
  { key: 'photo', title: '写真', fields: ['photo'], icon: 'camera' },
  { key: 'summary', title: 'まとめ', fields: [], icon: 'layers' },
];
export const KIND_FIELDS = { url: 'リンク(URL)', quote: '引用' };
const BASE_KEYS = new Set(BASE_KINDS.map(k => k.key));
export const isBaseKind = key => BASE_KEYS.has(key);
export const kindDefId = key => `kind-${key}`;
// 種別の一覧。最初からある種別に、定義カード(kind: 'kinddef')での名前・順番・隠す・追加を重ねる。
// 最初からある種別は消せず、名前と順番と隠すだけ変えられる(メモは隠せない)。欄は追加した種別だけ変えられる
export function kindList(defCards = []) {
  const defs = new Map(defCards.filter(d => d && d.kind === 'kinddef' && d.key).map(d => [d.key, d]));
  const out = BASE_KINDS.map((b, i) => {
    const d = defs.get(b.key);
    return { key: b.key, title: (d && d.title) || b.title, fields: b.fields, order: d && Number.isFinite(d.order) ? d.order : i * 10, hidden: !!(d && d.hidden && !d.deleted && b.key !== 'memo'), icon: (d && !d.deleted && iconName(d.icon)) || b.icon, base: true };
  });
  for (const d of defs.values()) {
    if (isBaseKind(d.key) || d.deleted) continue;
    out.push({ key: d.key, title: d.title || '(無題)', fields: (d.fields || []).filter(f => KIND_FIELDS[f]), order: Number.isFinite(d.order) ? d.order : 1000, hidden: !!d.hidden, icon: iconName(d.icon) || DEFAULT_KIND_ICON, base: false });
  }
  return out.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'ja'));
}
export function newKindDef({ key, title, fields = [], order = 1000, icon = '', now = new Date().toISOString() }) {
  return { id: kindDefId(key), kind: 'kinddef', key, title: String(title || '').trim(), fields, order, icon: iconName(icon), hidden: false, body: '', url: '', quote: '', tags: [], inbox: false, action: null, createdAt: now, updatedAt: now };
}
// 種別のキーとして使える文字列か(URLから来た値をそのまま使わないため)
const KIND_KEY_RE = /^[a-z][\w-]{0,40}$/;

const URL_RE = /https?:\/\/[^\s<>"'「」]+/i;
const VIDEO_RE = /^(https?:\/\/)?((www|m)\.)?(youtube\.com|youtu\.be|vimeo\.com|nicovideo\.jp)\//i;

export function extractUrl(text) {
  const m = URL_RE.exec(text || '');
  return m ? m[0].replace(/[).,、。]+$/, '') : '';
}

// 入力内容から種類を推し量る。選ぶ手間を省くためのもので、あとで変えられる。
export function detectKind({ text = '', url = '', kind = '' } = {}) {
  if (kind && KIND_KEY_RE.test(kind) && !STRUCT_KINDS.includes(kind)) return kind;
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
  const image = (p.get('image') || '').trim();
  return { text, url, title, quote, kind: (p.get('kind') || '').trim(), tags, ...(/^https:\/\//i.test(image) ? { image } : {}) };
}

export function newCard({ id, now = new Date().toISOString(), text = '', url = '', title = '', quote = '', kind = '', tags = [], inbox = true, image = '' }) {
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
    ...(/^https:\/\//i.test(image) ? { image } : {}),
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

// アクションの並べ替え。完了したものはいつも終えた順
export const ACTION_SORTS = { due: '期日の近い順', created: '新しい順', oldest: '古い順', updated: '最近さわった順' };
export function sortActionList(list, sort = 'due') {
  const { open, done } = sortActions(list);
  const by = { created: (a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''), oldest: (a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''), updated: (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '') }[sort];
  if (by) open.sort(by);
  return { open, done };
}

// 期日での絞り込み。overdue: 期限切れ / today: 今日まで / week: 7日後まで / none: 期日なし
// 「〜まで」は期限切れも含む(遅れているものこそ、その期間にやる必要があるため)
export const DUE_WINDOWS = { overdue: '期限切れ', today: '今日まで', week: '7日後まで', none: '期日なし' };
export function inDueWindow(action, win, today) {
  if (!win) return true;
  const due = action && action.due;
  if (win === 'none') return !due;
  if (!due) return false;
  if (win === 'overdue') return due < today;
  if (win === 'today') return due <= today;
  if (win === 'week') {
    const d = new Date(today + 'T00:00:00'); d.setDate(d.getDate() + 7);
    const p = n => String(n).padStart(2, '0');
    return due <= `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  return true;
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

// ---------- サムネイル ----------
// YouTube の動画id(watch?v= / youtu.be / shorts / embed)
export function youtubeId(url) {
  const m = /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/i.exec(String(url || ''));
  return m ? m[1] : '';
}
// カードの小さな絵の出どころ。photo: 端末に保存した写真 / src: 画像のURL / なければ null
export function thumbOf(card) {
  if (!card) return null;
  if (card.kind === 'photo') return { photo: true };
  const yt = youtubeId(card.url);
  if (yt) return { src: `https://i.ytimg.com/vi/${yt}/mqdefault.jpg` };
  if (card.image && /^https:\/\//i.test(card.image)) return { src: card.image };
  return null;
}
// まだハブに問い合わせていないURLカードか(代表画像か見出しが欠けているもの)
export const needsImage = c => isInfo(c) && c.kind !== 'photo' && /^https?:\/\//i.test(c.url || '') && !c.imageTried
  && ((!c.image && !youtubeId(c.url)) || !c.title);

// ---------- つながりの紋章 ----------
// カードのつながりから小さな模様の部品を決める。同じつながりは同じ位置に同じ印が出るので、
// つながりの似たカードは模様も似る(色は使わない)。内から外へ:
//  arcs:  プロジェクト → 中心の輪の8か所の弧
//  dots:  タグ → 12方向×内外2重の24か所の点
//  ticks: つないだカード → 外枠の12か所の刻み。位置は二枚の組から決まるので、つながった二枚には同じ刻みが出る
const fnv = s => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; return (h ^ (h >>> 15)) >>> 0; };
// タグの点の位置を、タグ全体で重ならないように決める。作った順に、ハッシュの位置が埋まっていれば次の空きへ。
// 先に作ったタグの位置は、あとからタグが増えても変わらない(24個を超えたら重なりを許す)
export function tagSlots(tagCards) { return allocSlots(tagCards, 't', 24); }
// プロジェクトの弧も同じやり方で、8か所に重ならないように
export function projectSlots(projectCards) { return allocSlots(projectCards, 'p', 8); }
function allocSlots(cards, prefix, n) {
  const map = new Map(), used = new Set();
  const list = [...cards].filter(t => !t.deleted).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '') || String(a.id).localeCompare(String(b.id)));
  for (const t of list) {
    let s = fnv(prefix + t.id) % n;
    for (let i = 0; i < n && used.has(s); i++) s = (s + 1) % n;
    used.add(s); map.set(t.id, s);
  }
  return map;
}
export function sigil(card, { projectIds = [], linkIds = [], slots = null, pslots = null } = {}) {
  const uniq = a => [...new Set(a)].sort((x, y) => x - y);
  return {
    dots: uniq((card.tags || []).map(t => (slots && slots.has(t) ? slots.get(t) : fnv('t' + t) % 24))),
    arcs: uniq(projectIds.map(p => (pslots && pslots.has(p) ? pslots.get(p) : fnv('p' + p) % 8))),
    ticks: uniq(linkIds.map(l => fnv('l' + [card.id, l].sort().join('|')) % 12)),
  };
}
// 紋章をSVGの文字列に(size は表示の大きさ、図は24×24の座標で描く)
export function sigilSvg(sg, size = 22) {
  const c = 12, pt = (r, a) => [c + r * Math.sin(a), c - r * Math.cos(a)].map(v => v.toFixed(2));
  const parts = [];
  for (const s of sg.arcs) {
    const a0 = (s / 8) * Math.PI * 2 + 0.22, a1 = ((s + 1) / 8) * Math.PI * 2 - 0.22;
    const [x0, y0] = pt(4, a0), [x1, y1] = pt(4, a1);
    parts.push(`<path d="M${x0} ${y0}A4 4 0 0 1 ${x1} ${y1}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`);
  }
  for (const s of sg.dots) { const [x, y] = pt(s < 12 ? 9 : 6.2, ((s % 12) / 12) * Math.PI * 2 + (s < 12 ? 0 : Math.PI / 12)); parts.push(`<circle cx="${x}" cy="${y}" r="1.9"/>`); }
  for (const s of sg.ticks) { const a = (s / 12) * Math.PI * 2 + Math.PI / 12; const [x0, y0] = pt(10.2, a), [x1, y1] = pt(12, a); parts.push(`<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`); }
  const empty = !parts.length;
  return `<svg class="sigil${empty ? ' sigil--empty' : ''}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="11.1" fill="none" stroke="currentColor" stroke-width="0.7" opacity="0.3"/>${empty ? '<circle cx="12" cy="12" r="1.2" opacity="0.5"/>' : parts.join('')}</svg>`;
}
