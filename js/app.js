import * as db from './db.js';
import { KINDS, BASE_KINDS, KIND_FIELDS, kindList, newKindDef, kindDefId, isBaseKind, SORTS, ACTION_SORTS, DUE_WINDOWS, inDueWindow, sortActionList, PROJECT_COLORS, colorVar, thumbOf, needsImage, sigil, sigilSvg, tagSlots, projectSlots, dotFill, linkedInfoCount, sortCards, linkIndex, isInfo, parseCapture, newCard, normTag, tagId, displayTitle, matches, nearCards, relatedTags, sortActions, isOverdue, forActionList, linkedIds, projectSteps, nextOrder, newStep, newProject, stepProgress } from './core.js';
import * as gemini from './gemini.js';
import { exportData, importData } from './backup.js';
import * as sync from './sync.js';

// ---------- 状態 ----------
const state = {
  cards: [],
  query: '',
  kindFilter: '',
  tagFilter: '',
  projectFilter: '',
  sort: 'created',
  shown: 100,
  // アクション画面の条件
  actTag: '',
  actProject: '',
  actDue: '',
  actSort: 'due',
};

const $view = document.getElementById('view');

// ---------- ユーティリティ ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg, ms = 2600) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), ms);
}

// アクションや手順を終えたとき、チェックの周りに小さな粒を散らす(動きを減らす設定なら何もしない)
function celebrate(el) {
  if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = el.getBoundingClientRect();
  const colors = ['#FF9F0A', '#34C759', '#0A84FF', '#FF375F', '#BF5AF2', '#FFD60A'];
  for (let i = 0; i < 14; i++) {
    const d = document.createElement('i');
    d.className = 'spark';
    const a = (Math.PI * 2 * i) / 14, dist = 26 + Math.random() * 22;
    d.style.cssText = `left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;background:${colors[i % colors.length]};--dx:${Math.cos(a) * dist}px;--dy:${Math.sin(a) * dist}px`;
    document.body.append(d);
    setTimeout(() => d.remove(), 700);
  }
}

// 期日の短い表示。今年なら月/日、ほかの年は年も付ける
const shortDue = d => d.slice(0, 4) === today().slice(0, 4) ? d.slice(5).replace('-', '/') : d.replace(/-/g, '/');

function today() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  const days = Math.floor((Date.now() - d.getTime()) / 864e5);
  if (days < 1 && d.getDate() === new Date().getDate()) return `今日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (days < 7) return `${Math.max(1, days)}日前`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function setTitle(text, { back = false } = {}) {
  document.getElementById('nav-title').textContent = text;
  document.getElementById('nav-title-large').textContent = text;
  document.getElementById('back').hidden = !back;
  document.title = `${text} - idea-box`;
}

function setTab(tab) {
  for (const a of document.querySelectorAll('.tabbar__item')) {
    const on = a.dataset.tab === tab;
    a.classList.toggle('is-active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

// ---------- データ ----------
const live = () => state.cards.filter(c => !c.deleted);
const items = () => live().filter(isInfo);
const tags = () => live().filter(c => c.kind === 'tag');
const projects = () => live().filter(c => c.kind === 'project');
const byId = id => state.cards.find(c => c.id === id);
function tagNames() { return new Map(tags().map(t => [t.id, t.title])); }
function tagUse() {
  const n = new Map();
  for (const c of items()) for (const t of c.tags || []) n.set(t, (n.get(t) || 0) + 1);
  return n;
}

async function load() {
  state.cards = await db.getAll('cards');
  linkCache = slotCache = kindCache = null;
}

// touch: false なら「最近さわった」時刻を変えない(画像の取得など、自分で直していない書き込み)
async function save(card, { touch = true } = {}) {
  if (touch) card.updatedAt = new Date().toISOString();
  await db.put('cards', card);
  const i = state.cards.findIndex(c => c.id === card.id);
  if (i >= 0) state.cards[i] = card; else state.cards.push(card);
  linkCache = slotCache = kindCache = null;
}

async function addCard(input) {
  const tagIds = [];
  for (const name of input.tags || []) tagIds.push((await ensureTag(name)).id);
  const card = newCard({ ...input, id: db.uid(), tags: tagIds });
  await save(card);
  if (needsImage(card)) setTimeout(fillImages, 500);
  return card;
}

// 名前の表記ゆれをそろえて探し、なければタグのカードを作る
async function ensureTag(name) {
  const key = normTag(name);
  const found = tags().find(t => normTag(t.title) === key);
  if (found) return found;
  // 以前に消したタグと同じ名前なら、そのカードを生き返らせる
  const old = byId(tagId(name));
  if (old) { old.deleted = false; old.title = String(name).normalize('NFKC').replace(/^#+/, '').trim(); await save(old); return old; }
  const tag = newCard({ id: tagId(name), kind: 'tag', title: String(name).normalize('NFKC').replace(/^#+/, '').trim(), inbox: false });
  tag.kind = 'tag';
  await save(tag);
  return tag;
}

// ハブ経由(iOSショートカット・Chrome拡張)で届いたカードは、タグを名前のまま持っている。タグのカードに直す
async function resolvePendingTags() {
  for (const c of live().filter(x => Array.isArray(x.pendingTags))) {
    const ids = new Set(c.tags || []);
    for (const name of c.pendingTags) ids.add((await ensureTag(name)).id);
    c.tags = [...ids];
    delete c.pendingTags;
    await save(c);
  }
}

async function removeCard(card) {
  // 削除は墓標(deleted)にして、他の端末にも伝える
  card.deleted = true;
  await save(card);
  await db.del('images', card.id).catch(() => {});
  if (card.kind === 'tag') {
    for (const c of items().filter(x => (x.tags || []).includes(card.id))) {
      c.tags = c.tags.filter(t => t !== card.id);
      await save(c);
    }
  }
  // プロジェクトを消すと、その手順も消える(つないだ情報やほかのプロジェクトは残る)
  if (card.kind === 'project') for (const st of projectSteps(state.cards, card.id)) { st.deleted = true; await save(st); }
}

// つながりを付ける・外す。付けるときは片方(a)の links にだけ書く。外すときは両方から消す
async function link(a, b) {
  if (a.id === b.id || linkedIds(state.cards, a.id).includes(b.id)) return;
  a.links = [...(a.links || []), b.id];
  await save(a);
}
async function unlink(a, b) {
  for (const [x, y] of [[a, b], [b, a]]) {
    if ((x.links || []).includes(y.id)) { x.links = x.links.filter(i => i !== y.id); await save(x); }
  }
}
const linked = (id, pred = () => true) => linkedIds(state.cards, id).map(byId).filter(c => c && !c.deleted && pred(c));

// 写真は長辺1600pxのJPEGに縮めて端末にだけ置く
async function shrink(file, max = 1600) {
  try {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * s);
    canvas.height = Math.round(bmp.height * s);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise(r => canvas.toBlob(b => r(b || file), 'image/jpeg', 0.82));
  } catch {
    return file;
  }
}

// ---------- 共通の部品 ----------
// つながりの索引は画面を描くたびに1回だけ作る(保存や画面切り替えで作り直す)
let linkCache = null, slotCache = null, kindCache = null;
// 種別の一覧(最初からある種別 + 自分で変えた・足した分)
const kinds = () => (kindCache ||= kindList(state.cards.filter(c => c.kind === 'kinddef')));
const kindOf = key => kinds().find(k => k.key === key);
const kindName = key => (kindOf(key) || {}).title || KINDS[key] || 'メモ';
const hasField = (key, f) => ((kindOf(key) || {}).fields || []).includes(f);
const links = () => (linkCache ||= linkIndex(state.cards));
const slots = () => (slotCache ||= { t: tagSlots(state.cards.filter(c => c.kind === 'tag')), p: projectSlots(state.cards.filter(c => c.kind === 'project')) });
// カードが属するプロジェクトの色を1つの点で。複数なら円を塗り分ける
// カードが属するプロジェクト: つないだプロジェクトと、手順なら持ち主のプロジェクト
function projectsOf(card, idx = links()) {
  const ids = new Set(idx.get(card.id) || []);
  if (card.kind === 'step' && card.project) ids.add(card.project);
  return [...ids].map(byId).filter(p => p && !p.deleted && p.kind === 'project');
}
function projectDot(card, idx = links()) {
  const ps = projectsOf(card, idx).filter(p => p.color);
  const fill = dotFill(ps.map(p => p.color));
  return fill ? `<span class="pdot" style="background:${fill}" role="img" aria-label="${esc(ps.map(p => p.title).join('、'))}"></span>` : '';
}
const colorDot = p => p && p.color ? `<span class="pdot pdot--sm" style="background:${colorVar(p.color)}" aria-hidden="true"></span>` : '';

// つながりの紋章: タグ・プロジェクト・つないだカードから作る小さな模様
function cardSigil(card, size = 22) {
  const ids = [...(links().get(card.id) || [])].map(byId).filter(c => c && !c.deleted);
  const sg = sigil(card, { slots: slots().t, pslots: slots().p, projectIds: projectsOf(card).map(p => p.id), linkIds: ids.filter(c => c.kind !== 'project' && c.kind !== 'tag').map(c => c.id) });
  return sigilSvg(sg, size);
}
// カードの小さな絵。写真は端末の保存から後で差し込む(hydrateThumbs)
function thumbHtml(card) {
  const t = thumbOf(card);
  if (!t) return '';
  return t.photo ? `<span class="thumb" data-photo="${esc(card.id)}"></span>`
    : `<span class="thumb"><img src="${esc(t.src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>`;
}
// 行の右側: 絵があれば絵に紋章を小さく重ね、なければ紋章だけを大きめに
function asideHtml(card) {
  const th = thumbHtml(card);
  return th ? `<span class="item__aside">${th}<span class="sigil-badge">${cardSigil(card, 22)}</span></span>`
    : `<span class="item__aside item__aside--sigil">${cardSigil(card, 34)}</span>`;
}
const photoUrls = new Map();
async function hydrateThumbs(root = $view) {
  for (const el of root.querySelectorAll('.thumb[data-photo]:not(.is-ready)')) {
    el.classList.add('is-ready');
    const id = el.dataset.photo;
    if (!photoUrls.has(id)) {
      const rec = await db.get('images', id).catch(() => null);
      photoUrls.set(id, rec && rec.blob ? URL.createObjectURL(rec.blob) : '');
    }
    const u = photoUrls.get(id);
    if (u) el.innerHTML = `<img src="${u}" alt="">`; else dropThumb(el);
  }
}
// 読めなかった絵は外し、行の右側は紋章だけの形に戻す
function dropThumb(th) {
  const aside = th.parentElement;
  th.remove();
  if (!aside || !aside.classList.contains('item__aside')) return;
  const svg = aside.querySelector('.sigil');
  aside.classList.add('item__aside--sigil');
  aside.innerHTML = '';
  if (svg) { svg.setAttribute('width', 34); svg.setAttribute('height', 34); aside.append(svg); }
}
document.addEventListener('error', e => { const t = e.target; if (t && t.tagName === 'IMG' && t.parentElement && t.parentElement.classList.contains('thumb')) dropThumb(t.parentElement); }, true);
new MutationObserver(() => hydrateThumbs()).observe($view, { childList: true, subtree: true });

function tagChips(card, names = tagNames()) {
  const list = (card.tags || []).map(t => names.get(t)).filter(Boolean);
  if (!list.length) return '';
  // 一覧の行は全体がリンクなので、タグはリンクにせず表示だけにする(リンクの入れ子を避ける)
  return `<span class="chips">${(card.tags || []).filter(t => names.get(t)).map(t => `<span class="chip-tag">#${esc(names.get(t))}</span>`).join('')}</span>`;
}

// filterable: タグとプロジェクトを押せるボタンにする(「すべて」の一覧)。リンクの中にボタンを入れないよう、行の下側を <a> の外に出す
function cardRow(card, { names = tagNames(), inboxButton = false, filterable = false } = {}) {
  const snippet = card.title ? (card.body || card.quote || '') : (card.body || '').split('\n').slice(1).join(' ');
  const action = card.action && !card.action.done ? `<span class="badge${isOverdue(card.action, today()) ? ' badge--warn' : ''}">アクション${card.action.due ? ` ${esc(shortDue(card.action.due))}` : ''}</span>` : '';
  const head = `<span class="item__head"><span class="item__text">
      <span class="item__kind kind-${esc(card.kind)}">${esc(kindName(card.kind))}</span>
      <span class="item__title">${projectDot(card)}${esc(displayTitle(card))}</span>
      ${snippet.trim() ? `<span class="item__snippet">${esc(snippet.trim().slice(0, 140))}</span>` : ''}</span>${asideHtml(card)}</span>`;
  if (filterable) {
    const projs = [...(links().get(card.id) || [])].map(byId).filter(p => p && !p.deleted && p.kind === 'project');
    const tagBtns = (card.tags || []).filter(t => names.get(t)).map(t => `<button class="chip-tag" data-ftag="${esc(t)}" aria-label="#${esc(names.get(t))} で絞る">#${esc(names.get(t))}</button>`).join('');
    const projBtns = projs.map(p => `<button class="chip-tag chip-project" data-fproj="${esc(p.id)}" aria-label="${esc(p.title)} で絞る">${colorDot(p)}${esc(p.title)}</button>`).join('');
    return `<li class="item" data-id="${esc(card.id)}" data-kind="${esc(card.kind)}">
    <div class="item__body">
      <a class="item__main item__main--top" href="#card/${esc(card.id)}">${head}</a>
      <div class="item__meta item__meta--below">${esc(fmtDate(card.createdAt))}${action}${tagBtns || projBtns ? `<span class="chips">${projBtns}${tagBtns}</span>` : ''}</div>
    </div>
  </li>`;
  }
  return `<li class="item" data-id="${esc(card.id)}" data-kind="${esc(card.kind)}">
    <a class="item__main" href="#card/${esc(card.id)}">
      ${head}
      <span class="item__meta">${esc(fmtDate(card.createdAt))}${action}${tagChips(card, names)}</span>
    </a>
    ${inboxButton ? `<button class="item__done" data-act="sorted" aria-label="受信箱から出す">✓</button>` : ''}
  </li>`;
}

function bindRows(root, after) {
  root.querySelectorAll('[data-act="sorted"]').forEach(b => b.addEventListener('click', async e => {
    e.preventDefault();
    const card = byId(b.closest('.item').dataset.id);
    card.inbox = false;
    await save(card);
    const li = b.closest('.item');
    li.classList.add('is-leaving');
    setTimeout(() => li.remove(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220);
    toast('受信箱から出しました');
    if (after) after();
  }));
}

// 押して選ぶ欄。選んだものは塗りつぶし、もう一度押すと外れる。上の欄に文字を入れると絞り込み、なければ「作る」が出る
// options: () => [{ id, label }]  selected: () => Set  onToggle(id, on)  onCreate(name) → 作ったid(任意)
function pickerHtml(id, placeholder) {
  return `<div class="picker" id="${id}"><input class="picker__filter" placeholder="${esc(placeholder)}" autocomplete="off" aria-label="${esc(placeholder)}"><div class="picker__chips" role="group"></div></div>`;
}
function mountPicker(id, { options, selected, onToggle, onCreate = null, prefix = '', kind = '' }) {
  const root = document.getElementById(id);
  if (!root) return;
  const input = root.querySelector('.picker__filter');
  const box = root.querySelector('.picker__chips');
  const draw = () => {
    const sel = selected();
    const q = normTag(input.value);
    const all = options();
    const shown = all.filter(o => !q || normTag(o.label).includes(q))
      .sort((a, b) => (sel.has(b.id) - sel.has(a.id)));
    const exact = all.some(o => normTag(o.label) === q);
    box.innerHTML = shown.map(o => `<button type="button" class="chip-tag chip-pick${kind ? ` chip-${kind}` : ''}${sel.has(o.id) ? ' is-on' : ''}" data-id="${esc(o.id)}" aria-pressed="${sel.has(o.id)}">${sel.has(o.id) ? '✓ ' : ''}${esc(prefix + o.label)}</button>`).join('')
      + (q && !exact && onCreate ? `<button type="button" class="chip-tag chip-pick chip-new" data-new="1">＋ ${esc(prefix + input.value.trim().replace(/^#+/, ''))} を作る</button>` : '')
      + (!shown.length && !(q && onCreate) ? '<span class="muted small">候補がありません</span>' : '');
    box.querySelectorAll('[data-id]').forEach(b => b.addEventListener('click', async () => {
      await onToggle(b.dataset.id, !selected().has(b.dataset.id));
      draw();
    }));
    const nb = box.querySelector('[data-new]');
    if (nb) nb.addEventListener('click', create);
  };
  const create = async () => {
    const name = input.value.trim().replace(/^#+/, '');
    if (!name || !onCreate) return;
    const all = options();
    const hit = all.find(o => normTag(o.label) === normTag(name));
    if (hit) { if (!selected().has(hit.id)) await onToggle(hit.id, true); }
    else await onCreate(name);
    input.value = '';
    draw();
  };
  input.addEventListener('input', draw);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); create(); } });
  draw();
  return { draw };
}
// つないだプロジェクトへのリンク(選んだあとに開けるように)
function projectLinksText(list, empty = '') {
  return list.length ? `開く: ${list.map(p => `<a class="kind-project" href="#project/${esc(p.id)}">${esc(p.title)}</a>`).join('、')}` : esc(empty);
}
const tagOptions = () => { const use = tagUse(); return tags().sort((a, b) => (use.get(b.id) || 0) - (use.get(a.id) || 0) || a.title.localeCompare(b.title, 'ja')).map(t => ({ id: t.id, label: t.title })); };

// ---------- 受信箱(放り込む) ----------
async function renderInbox() {
  setTab('inbox');
  setTitle('受信箱');
  const inbox = items().filter(c => c.inbox).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const names = tagNames();
  const ck = state.capKind && kindOf(state.capKind) && !kindOf(state.capKind).hidden ? kindOf(state.capKind) : null;
  if (!ck) state.capKind = '';
  const f = k => !!ck && ck.fields.includes(k);
  $view.innerHTML = `
    <div class="kind-pick" role="radiogroup" aria-label="種別">
      <button class="kind ${ck ? '' : 'is-active'}" data-ck="" role="radio" aria-checked="${!ck}">おまかせ</button>
      ${kinds().filter(k => !k.hidden && k.key !== 'summary').map(k => `<button class="kind ${ck && ck.key === k.key ? 'is-active' : ''}" data-ck="${esc(k.key)}" role="radio" aria-checked="${!!ck && ck.key === k.key}">${esc(k.title)}</button>`).join('')}
      <a class="kind kind--edit" href="#kinds" aria-label="種別を編集">編集</a>
    </div>
    <div class="card capture">
      ${ck ? `<input class="field field--title" id="cap-title" placeholder="タイトル${f('url') ? '(空ならページの題名)' : ''}" aria-label="タイトル">
      ${f('url') ? `<div class="row"><label for="cap-url">URL</label><input id="cap-url" type="url" inputmode="url" class="row-left" placeholder="https://…"></div>` : ''}
      ${f('quote') ? `<textarea class="field field--quote" id="cap-quote" placeholder="引用・名言" aria-label="引用"></textarea>` : ''}
      <textarea class="field field--desc" id="cap-text" placeholder="${f('photo') ? '写真に添える一言(任意)' : 'メモ(任意)'}" aria-label="メモ"></textarea>`
      : `<textarea class="field field--note" id="cap-text" placeholder="思いつき・URL・名言…なんでも&#10;音声はキーボードのマイクで" aria-label="放り込む内容"></textarea>`}
      <div class="field--tags">${pickerHtml('cap-tags', 'タグを選ぶ・新しく作る(任意)')}</div>
    </div>
    <div class="actions">
      <label class="btn ${f('photo') ? 'btn--prominent' : 'btn--tinted'}" for="cap-photo">写真</label>
      <input type="file" id="cap-photo" accept="image/*" hidden>
      ${f('photo') ? '' : '<button class="btn btn--prominent" id="cap-save">放り込む</button>'}
    </div>
    ${inbox.length ? `<section class="list-section"><h2 class="list-section__header">まだ整理していないもの</h2>
      <ul class="list list--inset items">${inbox.map(c => cardRow(c, { names, inboxButton: true })).join('')}</ul>
      <p class="list-section__footer">✓で受信箱から出します。そのままにしておいても構いません。</p></section>`
      : `<div class="empty"><p class="empty__message">受信箱は空です。思いついたことを上に放り込んでください。</p></div>`}
  `;
  const text = document.getElementById('cap-text');
  // 放り込む前に選んだタグ(タグのid)
  const capTags = new Set();
  mountPicker('cap-tags', {
    options: tagOptions, selected: () => capTags, prefix: '#',
    onToggle: (tid, on) => { on ? capTags.add(tid) : capTags.delete(tid); },
    onCreate: async name => { capTags.add((await ensureTag(name)).id); },
  });
  const capNames = () => [...capTags].map(byId).filter(t => t && !t.deleted).map(t => t.title);
  $view.querySelectorAll('[data-ck]').forEach(b => b.addEventListener('click', () => { state.capKind = b.dataset.ck; renderInbox(); }));
  const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const saveBtn = document.getElementById('cap-save');
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    let input;
    if (ck) {
      const title = val('cap-title'), url = val('cap-url'), quote = val('cap-quote');
      if (!title && !url && !quote && !text.value.trim()) { (document.getElementById('cap-title') || text).focus(); return; }
      if (url && !/^https?:\/\//i.test(url)) { toast('URLは http(s):// から入れてください'); document.getElementById('cap-url').focus(); return; }
      input = { text: text.value, title, url, quote, kind: ck.key, tags: capNames() };
    } else {
      if (!text.value.trim()) { text.focus(); return; }
      input = { text: text.value, tags: capNames() };
    }
    const added = await addCard(input);
    toast('受信箱に入れました');
    await renderInbox();
    $view.querySelector(`.item[data-id="${added.id}"]`)?.classList.add('is-new');
  });
  document.getElementById('cap-photo').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const card = await addCard({ text: text.value, title: val('cap-title'), kind: ck && ck.fields.includes('photo') ? ck.key : 'photo', tags: capNames() });
    await db.put('images', { id: card.id, blob: await shrink(file) });
    location.hash = `#card/${card.id}`;
  });
  bindRows($view);
}


// ---------- すべて(探す) ----------
// 種類の絞り込み: すべて + 隠していない種別 + アクション
const filters = () => [['', 'すべて'], ...kinds().filter(k => !k.hidden || k.key === state.kindFilter).map(k => [k.key, k.title]), ['action', 'アクション']];

// 「すべて」の条件はこの端末に覚えておく(同期はしない)。次に開いたときも同じ条件で並ぶ
const FILTER_KEYS = ['query', 'kindFilter', 'tagFilter', 'projectFilter', 'sort'];
function rememberFilters() {
  db.setMeta('allFilters', Object.fromEntries(FILTER_KEYS.map(k => [k, state[k]]))).catch(() => {});
}

async function renderAll() {
  rememberFilters();
  setTab('all');
  setTitle('すべて');
  const tagList = tags().sort((a, b) => a.title.localeCompare(b.title, 'ja'));
  const projList = projects().sort((a, b) => (a.status === 'closed') - (b.status === 'closed') || a.title.localeCompare(b.title, 'ja'));
  // 消されたタグやプロジェクトで絞ったままにならないように
  if (state.tagFilter && !tagList.some(t => t.id === state.tagFilter)) state.tagFilter = '';
  if (state.projectFilter && !projList.some(p => p.id === state.projectFilter)) state.projectFilter = '';
  $view.innerHTML = `
    <div class="pad"><input class="search-field" id="q" type="search" placeholder="検索(語・#タグ)" value="${esc(state.query)}" aria-label="検索"></div>
    <div class="filters" role="group" aria-label="種類で絞る">${filters().map(([k, l]) => `<button class="kind ${state.kindFilter === k ? 'is-active' : ''}" data-k="${k}" aria-pressed="${state.kindFilter === k}">${l}</button>`).join('')}</div>
    <div class="selects" role="group" aria-label="タグ・プロジェクトで絞る、並べ替え">
      <select id="f-tag" class="pill-select${state.tagFilter ? ' is-set' : ''}" aria-label="タグで絞る"><option value=""># タグ</option>${tagList.map(t => `<option value="${esc(t.id)}" ${t.id === state.tagFilter ? 'selected' : ''}>#${esc(t.title)}</option>`).join('')}</select>
      <select id="f-proj" class="pill-select${state.projectFilter ? ' is-set' : ''}" aria-label="プロジェクトで絞る"><option value="">◇ プロジェクト</option>${projList.map(p => `<option value="${esc(p.id)}" ${p.id === state.projectFilter ? 'selected' : ''}>${esc(p.title)}${p.status === 'closed' ? '(閉じた)' : ''}</option>`).join('')}</select>
      <select id="f-sort" class="pill-select" aria-label="並び">${Object.entries(SORTS).map(([k, l]) => `<option value="${k}" ${k === state.sort ? 'selected' : ''}>↕ ${l}</option>`).join('')}</select>
    </div>
    <div class="list-tools"><span class="small muted" id="count"></span><button class="btn btn--small btn--plain" id="f-clear" hidden>条件を外す</button></div>
    <div id="results"></div>`;
  const draw = () => {
    const names = tagNames();
    const inProj = state.projectFilter ? links().get(state.projectFilter) || new Set() : null;
    const list = sortCards(items()
      .filter(c => !state.kindFilter || (state.kindFilter === 'action' ? c.action : c.kind === state.kindFilter))
      .filter(c => !state.tagFilter || (c.tags || []).includes(state.tagFilter))
      .filter(c => !inProj || inProj.has(c.id))
      .filter(c => matches(c, state.query, names)), state.sort);
    // 検索語は再描画せずに変わるので、絞り込み中かどうかは描くたびに見る
    const any = !!(state.kindFilter || state.tagFilter || state.projectFilter || state.query.trim());
    document.getElementById('count').textContent = any ? `${list.length}件` : '';
    document.getElementById('f-clear').hidden = !any;
    document.getElementById('results').innerHTML = list.length
      ? `<ul class="list list--inset items">${list.slice(0, state.shown).map(c => cardRow(c, { names, filterable: true })).join('')}</ul>
         ${list.length > state.shown ? `<div class="actions"><button class="btn btn--plain" id="more">もっと見る</button></div>` : ''}`
      : `<div class="empty"><p class="empty__message">${items().length ? '見つかりませんでした' : 'まだ何もありません。受信箱から放り込んでください。'}</p></div>`;
    const more = document.getElementById('more');
    if (more) more.addEventListener('click', () => { state.shown += 100; draw(); });
    // 行のタグ・プロジェクトを押すと、それで絞る
    $view.querySelectorAll('#results [data-ftag]').forEach(b => b.addEventListener('click', () => { state.tagFilter = b.dataset.ftag; state.shown = 100; renderAll(); scrollTo(0, 0); }));
    $view.querySelectorAll('#results [data-fproj]').forEach(b => b.addEventListener('click', () => { state.projectFilter = b.dataset.fproj; state.shown = 100; renderAll(); scrollTo(0, 0); }));
  };
  let t;
  document.getElementById('q').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { state.query = e.target.value; state.shown = 100; rememberFilters(); draw(); }, 200); });
  $view.querySelectorAll('.filters .kind').forEach(b => b.addEventListener('click', () => { state.kindFilter = b.dataset.k; state.shown = 100; renderAll(); }));
  document.getElementById('f-tag').addEventListener('change', e => { state.tagFilter = e.target.value; state.shown = 100; renderAll(); });
  document.getElementById('f-proj').addEventListener('change', e => { state.projectFilter = e.target.value; state.shown = 100; renderAll(); });
  document.getElementById('f-sort').addEventListener('change', e => { state.sort = e.target.value; rememberFilters(); draw(); });
  document.getElementById('f-clear').addEventListener('click', () => { Object.assign(state, { query: '', kindFilter: '', tagFilter: '', projectFilter: '', shown: 100 }); renderAll(); });
  draw();
}

// ---------- タグ ----------
// タグの名前を変える。同じ名前のタグがほかにあれば変えずに false
async function renameTag(tag, value) {
  const v = String(value).normalize('NFKC').replace(/^#+/, '').trim();
  if (!v) return false;
  const dup = tags().find(t => t.id !== tag.id && normTag(t.title) === normTag(v));
  if (dup) { toast(`#${dup.title} がすでにあります`); return false; }
  tag.title = v;
  await save(tag);
  return true;
}

async function deleteTag(tag) {
  const n = tagUse().get(tag.id) || 0;
  if (!confirm(`#${tag.title} を削除します。${n ? `付いている${n}枚のカードからも外れます(カード自体は残ります)。` : ''}`)) return false;
  await removeCard(tag);
  return true;
}

async function renderTags({ editing = false } = {}) {
  setTab('tags');
  setTitle('タグ');
  const use = tagUse();
  const list = tags().sort((a, b) => (use.get(b.id) || 0) - (use.get(a.id) || 0) || a.title.localeCompare(b.title, 'ja'));
  $view.innerHTML = `
    <div class="card"><div class="row"><input id="new-tag" placeholder="新しいタグ(例: ブログ、買いたい)" aria-label="新しいタグ"><button class="btn btn--small btn--tinted" id="add-tag">追加</button></div></div>
    ${list.length ? `<div class="list-tools"><span class="small muted">${editing ? '名前を書き換えると、付いているカードすべてで変わります' : ''}</span><button class="btn btn--small btn--plain" id="tag-edit">${editing ? '完了' : '名前の変更・削除'}</button></div>` : ''}
    ${!list.length ? `<div class="empty"><p class="empty__message">まだタグがありません。カードにタグを付けると、ここに並びます。</p></div>`
      : editing ? `<div class="card">${list.map(t => `<div class="row" data-id="${esc(t.id)}"><label>#</label><input class="row-left tag-name" value="${esc(t.title)}" aria-label="#${esc(t.title)} の名前"><small class="muted">${use.get(t.id) || 0}</small><button class="btn btn--small btn--plain danger tag-del" aria-label="#${esc(t.title)} を削除">削除</button></div>`).join('')}</div>`
      : `<div class="tag-cloud">${list.map(t => `<a class="chip-tag chip-tag--lg" href="#tag/${esc(t.id)}">#${esc(t.title)} <small>${use.get(t.id) || 0}</small></a>`).join('')}</div>
      <p class="pad small muted">出口(#ブログ、#買いたい など)も、話題も、状態(#試したい など)も、同じタグで扱います。1つのカードにいくつ付けても構いません。</p>`}`;
  const editBtn = document.getElementById('tag-edit');
  if (editBtn) editBtn.addEventListener('click', () => renderTags({ editing: !editing }));
  $view.querySelectorAll('.tag-name').forEach(inp => inp.addEventListener('change', async () => {
    const tag = byId(inp.closest('.row').dataset.id);
    if (await renameTag(tag, inp.value)) toast(`#${tag.title} に変えました`); else inp.value = tag.title;
  }));
  $view.querySelectorAll('.tag-del').forEach(b => b.addEventListener('click', async () => {
    if (await deleteTag(byId(b.closest('.row').dataset.id))) renderTags({ editing: true });
  }));
  const input = document.getElementById('new-tag');
  const add = async () => {
    if (!input.value.trim()) return;
    const t = await ensureTag(input.value);
    location.hash = `#tag/${t.id}`;
  };
  document.getElementById('add-tag').addEventListener('click', add);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) add(); });
}

async function renderTag(id) {
  const tag = byId(id);
  if (!tag || tag.deleted || tag.kind !== 'tag') { location.hash = '#tags'; return; }
  setTab('tags');
  setTitle(`#${tag.title}`, { back: true });
  const names = tagNames();
  const list = items().filter(c => (c.tags || []).includes(id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const rel = relatedTags(state.cards, id);
  $view.innerHTML = `
    <div class="card">
      <div class="row"><label for="tag-name">名前</label><input id="tag-name" value="${esc(tag.title)}"></div>
      <textarea class="field field--desc" id="tag-body" placeholder="このタグについてのメモ・まとめ(任意)" aria-label="タグのメモ">${esc(tag.body)}</textarea>
    </div>
    ${rel.length ? `<section class="list-section"><h2 class="list-section__header">よく一緒に付くタグ</h2>
      <div class="tag-cloud">${rel.map(r => `<a class="chip-tag" href="#tag/${esc(r.tagId)}">#${esc(names.get(r.tagId) || '')} <small>${r.count}</small></a>`).join('')}</div></section>` : ''}
    <section class="list-section"><h2 class="list-section__header">このタグのカード</h2>
      ${list.length ? `<ul class="list list--inset items">${list.map(c => cardRow(c, { names })).join('')}</ul>` : '<p class="pad muted">まだありません</p>'}
    </section>
    <div class="actions">
      <button class="btn btn--tinted" id="make-summary" ${list.length ? '' : 'disabled'}>まとめカードを作る</button>
      <button class="btn btn--plain danger" id="del-tag">タグを削除</button>
    </div>`;
  const nameInput = document.getElementById('tag-name');
  nameInput.addEventListener('change', async () => {
    if (!(await renameTag(tag, nameInput.value))) { nameInput.value = tag.title; return; }
    setTitle(`#${tag.title}`, { back: true });
  });
  autosave(tag, { body: document.getElementById('tag-body') });
  document.getElementById('make-summary').addEventListener('click', async () => {
    const lines = list.map(c => `- ${displayTitle(c)}`).join('\n');
    const card = await addCard({ kind: 'summary', title: `${tag.title} のまとめ`, text: `\n\n---\n元にしたカード:\n${lines}`, tags: [tag.title] });
    card.refs = list.map(c => c.id);
    card.inbox = false;
    await save(card);
    location.hash = `#card/${card.id}`;
  });
  document.getElementById('del-tag').addEventListener('click', async () => {
    if (await deleteTag(tag)) location.hash = '#tags';
  });
}

// ---------- カード ----------
// 欄ごとに別のタイマーを持つ。500ms以内に別の欄へ移っても、前の欄の書きかけを落とさない
function autosave(card, fields, after) {
  const timers = {};
  for (const [key, el] of Object.entries(fields)) {
    el.addEventListener('input', () => {
      clearTimeout(timers[key]);
      timers[key] = setTimeout(async () => {
        card[key] = el.value;
        if (key === 'url' || key === 'body') card.kind = card.kind === 'memo' || card.kind === 'url' || card.kind === 'video' ? newCard({ id: card.id, text: card.body, url: card.url }).kind : card.kind;
        await save(card);
        if (after) after();
      }, 500);
    });
  }
}

async function renderCard(id) {
  const card = byId(id);
  if (!card || card.deleted) { location.hash = '#all'; return; }
  if (card.kind === 'tag') { location.hash = `#tag/${id}`; return; }
  if (card.kind === 'project') { location.hash = `#project/${id}`; return; }
  if (card.kind === 'step') return renderStep(card);
  setTab(card.inbox ? 'inbox' : 'all');
  setTitle(kindName(card.kind) || 'カード', { back: true });
  const image = card.kind === 'photo' ? await db.get('images', id) : null;
  const near = nearCards(items(), card);
  const names = tagNames();
  const refs = (card.refs || []).map(byId).filter(c => c && !c.deleted);
  const myProjects = linked(id, c => c.kind === 'project');
  const a = card.action;
  $view.innerHTML = `
    ${image ? `<div class="photo"><img id="photo" alt="写真"></div>` : ''}
    ${!image && thumbOf(card) && thumbOf(card).src ? `<div class="photo photo--web thumb-hero"><span class="thumb"><img src="${esc(thumbOf(card).src)}" alt="" referrerpolicy="no-referrer"></span></div>` : ''}
    <div class="card">
      <input class="field field--title" id="c-title" placeholder="見出し(任意)" value="${esc(card.title)}" aria-label="見出し">
      <textarea class="field field--note" id="c-body" placeholder="本文" aria-label="本文">${esc(card.body)}</textarea>
      ${hasField(card.kind, 'quote') || card.quote ? `<textarea class="field field--quote" id="c-quote" placeholder="引用・名言" aria-label="引用">${esc(card.quote)}</textarea>` : ''}
      <div class="row"><label for="c-url">URL</label><input id="c-url" type="url" inputmode="url" placeholder="https://…" value="${esc(card.url)}">${card.url ? `<a class="btn btn--small btn--plain" href="${esc(card.url)}" target="_blank" rel="noopener">開く</a>` : ''}</div>
      <div class="row"><label for="c-kind">種類</label><select id="c-kind">${kinds().filter(k => !k.hidden || k.key === card.kind).map(k => `<option value="${esc(k.key)}" ${k.key === card.kind ? 'selected' : ''}>${esc(k.title)}</option>`).join('')}${kindOf(card.kind) ? '' : `<option value="${esc(card.kind)}" selected>${esc(kindName(card.kind))}</option>`}</select></div>
    </div>
    ${image ? `<div class="actions"><button class="btn btn--tinted" id="ocr">文字を読み取る(Gemini)</button></div>` : ''}
    <div class="sigil-box pad">${cardSigil(card, 44)}<p class="small muted">つながりの紋章: 外の点はタグ、弧はプロジェクト、内の線はつないだカード。つながりが似たカードは模様も似ます。</p></div>

    <section class="list-section"><h2 class="list-section__header">タグ</h2>
      <div class="card">
        ${pickerHtml('c-tags', 'タグを探す・新しく作る')}
      </div>
      <p class="list-section__footer">押すと付き、もう一度押すと外れます。いくつでも選べます。</p>
    </section>

    <section class="list-section"><h2 class="list-section__header">プロジェクト</h2>
      <div class="card">
        ${pickerHtml('c-projects', 'プロジェクトを探す・新しく作る')}
      </div>
      <p class="list-section__footer" id="c-proj-open">${projectLinksText(myProjects, 'どのプロジェクトにもつながなくて構いません。')}</p>
    </section>

    <section class="list-section"><h2 class="list-section__header">アクション</h2>
      <div class="card" id="action-box">
        ${a ? `
          <div class="row"><input type="checkbox" id="a-done" ${a.done ? 'checked' : ''} aria-label="完了"><input id="a-text" class="row-left" placeholder="やること" value="${esc(a.text)}"></div>
          <div class="row"><label for="a-due">期限(任意)</label><input id="a-due" type="date" value="${esc(a.due || '')}"></div>
          ${a.done ? `<textarea class="field field--desc" id="a-note" placeholder="やってみてどうだった?(任意)" aria-label="完了メモ">${esc(a.doneNote || '')}</textarea>` : ''}
          <div class="row"><button class="btn btn--small btn--plain danger" id="a-remove">アクションを外す</button></div>`
        : `<div class="row"><input id="a-new" class="row-left" placeholder="このカードから、やることを1つ"><button class="btn btn--small btn--tinted" id="a-add">追加</button></div>`}
      </div>
    </section>

    ${refs.length ? `<section class="list-section"><h2 class="list-section__header">元にしたカード</h2><ul class="list list--inset items">${refs.map(c => cardRow(c, { names })).join('')}</ul></section>` : ''}
    ${near.length ? `<section class="list-section"><h2 class="list-section__header">近いカード</h2>
      <ul class="list list--inset items">${near.map(n => cardRow(n.card, { names })).join('')}</ul>
      <p class="list-section__footer">同じタグや、似た言葉を含むカードです。</p></section>` : ''}

    <div class="actions">
      ${card.inbox ? `<button class="btn btn--tinted" id="c-sorted">受信箱から出す</button>` : `<button class="btn btn--plain" id="c-inbox">受信箱に戻す</button>`}
      <button class="btn btn--plain danger" id="c-del">削除</button>
    </div>
    <p class="pad small muted">作成 ${esc(fmtDate(card.createdAt))} ・ 更新 ${esc(fmtDate(card.updatedAt))}</p>`;

  if (image) {
    const url = URL.createObjectURL(image.blob);
    const img = document.getElementById('photo');
    img.src = url;
    img.onload = () => URL.revokeObjectURL(url);
    document.getElementById('ocr').addEventListener('click', async e => {
      const btn = e.currentTarget;
      const apiKey = await db.getMeta('geminiKey', '');
      if (!apiKey) { toast('設定でGemini APIキーを入れてください'); return; }
      if (!confirm('写真をGeminiに送って文字を読み取ります。住所や番号など、送りたくない情報が写っていないか確かめてください。')) return;
      btn.disabled = true; btn.textContent = '読み取り中…';
      try {
        const r = await gemini.readText({ apiKey, model: await db.getMeta('geminiModel', gemini.DEFAULT_MODEL), blob: image.blob });
        if (!card.title && r.title) card.title = r.title;
        card.body = [card.body, r.text].filter(Boolean).join('\n\n');
        await save(card);
        renderCard(id);
      } catch (err) {
        toast(err.message, 5000);
        btn.disabled = false; btn.textContent = '文字を読み取る(Gemini)';
      }
    });
  }

  const fields = { title: document.getElementById('c-title'), body: document.getElementById('c-body'), url: document.getElementById('c-url') };
  const q = document.getElementById('c-quote');
  if (q) fields.quote = q;
  autosave(card, fields);
  // URLを変えたら、前のページの画像は使わず取り直す
  fields.url.addEventListener('change', () => { if (card.image || card.imageTried) { delete card.image; delete card.imageTried; save(card); setTimeout(fillImages, 800); } });
  grow(fields.body);
  fields.body.addEventListener('input', () => grow(fields.body));
  document.getElementById('c-kind').addEventListener('change', async e => { card.kind = e.target.value; await save(card); renderCard(id); });

  // タグ(押して付ける・外す)
  mountPicker('c-tags', {
    options: tagOptions, selected: () => new Set(card.tags || []), prefix: '#',
    onToggle: async (tid, on) => { card.tags = on ? [...new Set([...(card.tags || []), tid])] : (card.tags || []).filter(t => t !== tid); await save(card); },
    onCreate: async name => { const t = await ensureTag(name); card.tags = [...new Set([...(card.tags || []), t.id])]; await save(card); },
  });

  // プロジェクトとのつながり(押してつなぐ・外す)。閉じたプロジェクトは、つながっているものだけ出す
  mountPicker('c-projects', {
    kind: 'project',
    options: () => { const mine = new Set(linkedIds(state.cards, id)); return projects().filter(p => p.status !== 'closed' || mine.has(p.id)).map(p => ({ id: p.id, label: p.title })); },
    selected: () => new Set(linked(id, c => c.kind === 'project').map(p => p.id)),
    onToggle: async (pid, on) => { on ? await link(card, byId(pid)) : await unlink(card, byId(pid)); refreshOpen(); },
    onCreate: async name => { const np = newProject({ id: db.uid(), title: name }); await save(np); await link(card, np); refreshOpen(); toast(`プロジェクト「${name}」を作ってつなぎました`); },
  });
  function refreshOpen() { document.getElementById('c-proj-open').innerHTML = projectLinksText(linked(id, c => c.kind === 'project'), 'どのプロジェクトにもつながなくて構いません。'); }

  // アクション
  if (a) {
    const set = async patch => { Object.assign(card.action, patch); await save(card); };
    document.getElementById('a-done').addEventListener('change', async e => {
      if (e.target.checked) celebrate(e.target);
      await set({ done: e.target.checked, doneAt: e.target.checked ? new Date().toISOString() : null });
      renderCard(id);
    });
    let t;
    document.getElementById('a-text').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => set({ text: e.target.value }), 500); });
    document.getElementById('a-due').addEventListener('change', e => set({ due: e.target.value || null }));
    const note = document.getElementById('a-note');
    if (note) note.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => set({ doneNote: note.value }), 500); });
    document.getElementById('a-remove').addEventListener('click', async () => { card.action = null; await save(card); renderCard(id); });
  } else {
    const input = document.getElementById('a-new');
    const add = async () => {
      if (!input.value.trim()) { input.focus(); return; }
      card.action = { text: input.value.trim(), due: null, done: false, doneAt: null, doneNote: '' };
      await save(card);
      renderCard(id);
    };
    document.getElementById('a-add').addEventListener('click', add);
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) add(); });
  }

  const sorted = document.getElementById('c-sorted');
  if (sorted) sorted.addEventListener('click', async () => { card.inbox = false; await save(card); toast('受信箱から出しました'); renderCard(id); });
  const back = document.getElementById('c-inbox');
  if (back) back.addEventListener('click', async () => { card.inbox = true; await save(card); renderCard(id); });
  document.getElementById('c-del').addEventListener('click', async () => {
    if (!confirm('このカードを削除します。')) return;
    await removeCard(card);
    history.length > 1 ? history.back() : (location.hash = '#all');
  });
}

function grow(el) {
  el.style.height = 'auto';
  el.style.height = `${Math.max(132, el.scrollHeight)}px`;
}


// ---------- プロジェクト ----------
async function renderProjects() {
  setTab('projects');
  setTitle('プロジェクト');
  const all = projects().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const active = all.filter(p => p.status !== 'closed');
  const closed = all.filter(p => p.status === 'closed');
  const row = p => {
    const pr = stepProgress(projectSteps(state.cards, p.id));
    const n = linkedInfoCount(state.cards, p.id, links());
    return `<li class="item"><a class="item__main" href="#project/${esc(p.id)}">
      <span class="item__title">${colorDot(p)}${esc(p.title || '(無題)')}</span>
      ${p.goal ? `<span class="item__snippet">${esc(p.goal)}</span>` : ''}
      <span class="item__meta">${p.due ? `<span class="badge">${esc(p.due)}</span>` : ''}${pr.all ? `<span>手順 ${pr.done}/${pr.all}</span>` : ''}${n ? `<span>カード ${n}</span>` : ''}${p.status === 'closed' ? `<span>閉じた ${esc(fmtDate(p.closedAt))}</span>` : ''}</span>
    </a></li>`;
  };
  $view.innerHTML = `
    <div class="card"><div class="row"><input id="new-project" class="row-left" placeholder="新しいプロジェクト(例: 車を買い替える)" aria-label="新しいプロジェクト"><button class="btn btn--small btn--tinted" id="add-project">作る</button></div></div>
    ${active.length ? `<ul class="list list--inset items">${active.map(row).join('')}</ul>`
      : `<div class="empty"><p class="empty__message">ゴールのあることを始めるときに作ります。情報や手順、ほかのプロジェクトをここに集められます。</p></div>`}
    ${closed.length ? `<details class="done-list"><summary class="pad">閉じたプロジェクト</summary><ul class="list list--inset items">${closed.map(row).join('')}</ul></details>` : ''}`;
  const input = document.getElementById('new-project');
  const add = async () => {
    if (!input.value.trim()) { input.focus(); return; }
    const p = newProject({ id: db.uid(), title: input.value });
    await save(p);
    location.hash = `#project/${p.id}`;
  };
  document.getElementById('add-project').addEventListener('click', add);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) add(); });
}

async function renderProject(id, { suggestions = null } = {}) {
  const p = byId(id);
  if (!p || p.deleted || p.kind !== 'project') { location.hash = '#projects'; return; }
  setTab('projects');
  setTitle(p.title || 'プロジェクト', { back: true });
  const steps = projectSteps(state.cards, id);
  const rel = linked(id);
  const relProjects = rel.filter(c => c.kind === 'project');
  const relInfo = rel.filter(isInfo);
  const names = tagNames();
  const t = today();
  const closed = p.status === 'closed';
  const stepRow = (st, i) => {
    const subs = linked(st.id, c => c.kind === 'project' && c.id !== id);
    return `<li class="item item--action item--step" data-id="${esc(st.id)}">
      <input type="checkbox" class="item__check" ${st.action.done ? 'checked' : ''} aria-label="${esc(st.title)} を完了">
      <a class="item__main" href="#card/${esc(st.id)}">
        <span class="item__title${st.action.done ? ' is-done' : ''}">${esc(st.title || '(未記入)')}</span>
        ${st.action.due || subs.length ? `<span class="item__meta">${st.action.due ? `<span class="badge${isOverdue(st.action, t) ? ' badge--warn' : ''}">${esc(st.action.due)}</span>` : ''}${subs.map(s => `<span class="kind-project">→ ${esc(s.title)}</span>`).join('')}</span>` : ''}
      </a>
      <span class="item__tools">
        <button data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="上へ">↑</button>
        <button data-move="1" ${i === steps.length - 1 ? 'disabled' : ''} aria-label="下へ">↓</button>
      </span>
    </li>`;
  };
  $view.innerHTML = `
    <div class="card">
      <input class="field field--title" id="p-title" placeholder="プロジェクト名" value="${esc(p.title)}" aria-label="プロジェクト名">
      <textarea class="field field--desc" id="p-goal" placeholder="ゴール(どうなったら終わりか)" aria-label="ゴール">${esc(p.goal)}</textarea>
      <div class="row"><label for="p-due">期日(任意)</label><input id="p-due" type="date" value="${esc(p.due || '')}"></div>
      <div class="row swatches" role="radiogroup" aria-label="色"><label>色</label><span class="swatches__list">
        <button type="button" class="swatch swatch--none${p.color ? '' : ' is-on'}" data-color="" role="radio" aria-checked="${!p.color}" aria-label="色なし"></button>
        ${PROJECT_COLORS.map(([k, l]) => `<button type="button" class="swatch${p.color === k ? ' is-on' : ''}" data-color="${k}" style="background:${colorVar(k)}" role="radio" aria-checked="${p.color === k}" aria-label="${l}"></button>`).join('')}
      </span></div>
      <textarea class="field field--desc" id="p-body" placeholder="メモ(任意)" aria-label="メモ">${esc(p.body)}</textarea>
    </div>

    <section class="list-section"><h2 class="list-section__header">手順</h2>
      ${steps.length ? `<ul class="list list--inset items" id="steps">${steps.map(stepRow).join('')}</ul>` : ''}
      <div class="card${steps.length ? ' card--after-list' : ''}"><div class="row"><input id="new-step" class="row-left" placeholder="手順を追加" aria-label="手順を追加"><button class="btn btn--small btn--tinted" id="add-step">追加</button></div></div>
      <p class="list-section__footer">期限を付けた手順だけが、アクション画面に出ます。手順を開くと、別のプロジェクトへ移したり、サブプロジェクトにしたりできます。</p>
      ${suggestions ? `<div class="card suggest">
          ${suggestions.length ? suggestions.map((s, i) => `<label class="row suggest__row"><input type="checkbox" data-s="${i}" checked><span>${esc(s)}</span></label>`).join('')
            : '<p class="muted small">新しい手順の案は出ませんでした。</p>'}
        </div>
        <div class="actions">${suggestions.length ? '<button class="btn btn--prominent" id="s-take">選んだものを手順に入れる</button>' : ''}<button class="btn btn--plain" id="s-close">閉じる</button></div>`
      : `<div class="actions"><button class="btn btn--tinted" id="suggest">AIに手順の案を出してもらう</button></div>`}
    </section>

    <section class="list-section"><h2 class="list-section__header">つながっているプロジェクト</h2>
      <div class="card">
        ${pickerHtml('p-links', 'プロジェクトを探す・新しく作る')}
      </div>
      <p class="list-section__footer">親子ではなく、横のつながりです。押すとつながり、どちらから見ても表示されます。<br><span id="p-links-open">${projectLinksText(relProjects)}</span></p>
    </section>

    <section class="list-section"><h2 class="list-section__header">つないだ情報${relInfo.length ? ` <span class="count">${relInfo.length}</span>` : ''}</h2>
      ${relInfo.length ? `<ul class="list list--inset items">${relInfo.map(c => cardRow(c, { names })).join('')}</ul>` : ''}
      <div class="card${relInfo.length ? ' card--after-list' : ''}"><div class="row"><input id="new-info" class="row-left" placeholder="メモ・URLをここに書いてつなぐ" aria-label="情報を追加"><button class="btn btn--small btn--tinted" id="add-info">追加</button></div></div>
      <p class="list-section__footer">受信箱やすべてのカードからも、カードを開いて「プロジェクトにつなぐ」でここに集まります。</p>
    </section>

    <section class="list-section"><h2 class="list-section__header">${closed ? '閉じたときのメモ' : 'プロジェクトを閉じる'}</h2>
      <div class="card"><textarea class="field field--desc" id="p-close-note" placeholder="終わってみて一言(任意)" aria-label="閉じるときのメモ">${esc(p.closeNote)}</textarea></div>
      <div class="actions">
        ${closed ? '<button class="btn btn--plain" id="p-reopen">もう一度開く</button>' : '<button class="btn btn--tinted" id="p-close">閉じる</button>'}
        <button class="btn btn--plain danger" id="p-del">削除</button>
      </div>
    </section>`;

  autosave(p, { title: document.getElementById('p-title'), goal: document.getElementById('p-goal'), body: document.getElementById('p-body'), closeNote: document.getElementById('p-close-note') },
    () => setTitle(p.title || 'プロジェクト', { back: true }));
  document.getElementById('p-due').addEventListener('change', async e => { p.due = e.target.value || null; await save(p); });
  $view.querySelectorAll('.swatch').forEach(b => b.addEventListener('click', async () => {
    p.color = b.dataset.color || null;
    await save(p);
    $view.querySelectorAll('.swatch').forEach(x => { const on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-checked', on); });
  }));

  // 手順
  const stepInput = document.getElementById('new-step');
  const addStep = async () => {
    if (!stepInput.value.trim()) { stepInput.focus(); return; }
    await save(newStep({ id: db.uid(), projectId: id, text: stepInput.value, order: nextOrder(projectSteps(state.cards, id)) }));
    await renderProject(id);
    document.getElementById('new-step').focus();
  };
  document.getElementById('add-step').addEventListener('click', addStep);
  stepInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) addStep(); });
  $view.querySelectorAll('#steps .item__check').forEach(cb => cb.addEventListener('change', async () => {
    const st = byId(cb.closest('.item').dataset.id);
    if (cb.checked) celebrate(cb);
    Object.assign(st.action, { done: cb.checked, doneAt: cb.checked ? new Date().toISOString() : null });
    await save(st);
    renderProject(id);
  }));
  $view.querySelectorAll('#steps [data-move]').forEach(b => b.addEventListener('click', async () => {
    const i = steps.findIndex(st => st.id === b.closest('.item').dataset.id);
    const j = i + Number(b.dataset.move);
    if (j < 0 || j >= steps.length) return;
    // 並びを1から振り直してから入れ替える(order が重なっていても崩れない)
    steps.forEach((st, k) => { st.order = k + 1; });
    [steps[i].order, steps[j].order] = [steps[j].order, steps[i].order];
    for (const st of steps) await save(st);
    renderProject(id);
  }));

  // AIの手順案
  const sug = document.getElementById('suggest');
  if (sug) sug.addEventListener('click', async () => {
    const apiKey = await db.getMeta('geminiKey', '');
    if (!apiKey) { toast('設定でGemini APIキーを入れてください'); return; }
    sug.disabled = true; sug.textContent = '考えています…';
    try {
      const list = await gemini.suggestSteps({ apiKey, model: await db.getMeta('geminiModel', gemini.DEFAULT_MODEL), project: p, steps: steps.map(st => st.title), related: relInfo.map(displayTitle) });
      renderProject(id, { suggestions: list });
    } catch (err) {
      toast(err.message, 5000);
      sug.disabled = false; sug.textContent = 'AIに手順の案を出してもらう';
    }
  });
  const take = document.getElementById('s-take');
  if (take) take.addEventListener('click', async () => {
    let order = nextOrder(steps);
    for (const cb of $view.querySelectorAll('.suggest [data-s]:checked')) await save(newStep({ id: db.uid(), projectId: id, text: suggestions[Number(cb.dataset.s)], order: order++ }));
    renderProject(id);
  });
  const sclose = document.getElementById('s-close');
  if (sclose) sclose.addEventListener('click', () => renderProject(id));

  // つながり
  mountPicker('p-links', {
    kind: 'project',
    options: () => { const mine = new Set(linkedIds(state.cards, id)); return projects().filter(x => x.id !== id && (x.status !== 'closed' || mine.has(x.id))).map(x => ({ id: x.id, label: x.title })); },
    selected: () => new Set(linked(id, c => c.kind === 'project').map(x => x.id)),
    onToggle: async (pid, on) => { on ? await link(p, byId(pid)) : await unlink(p, byId(pid)); refreshOpen(); },
    onCreate: async name => { const np = newProject({ id: db.uid(), title: name }); await save(np); await link(p, np); refreshOpen(); },
  });
  function refreshOpen() { document.getElementById('p-links-open').innerHTML = projectLinksText(linked(id, c => c.kind === 'project')); }
  const infoInput = document.getElementById('new-info');
  const addInfo = async () => {
    if (!infoInput.value.trim()) { infoInput.focus(); return; }
    const c = await addCard({ text: infoInput.value });
    c.inbox = false;
    c.links = [id];
    await save(c);
    renderProject(id);
  };
  document.getElementById('add-info').addEventListener('click', addInfo);
  infoInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) addInfo(); });

  // 閉じる・開く・削除
  const pc = document.getElementById('p-close');
  if (pc) pc.addEventListener('click', async () => { p.closeNote = document.getElementById('p-close-note').value; p.status = 'closed'; p.closedAt = new Date().toISOString(); await save(p); toast('プロジェクトを閉じました'); renderProject(id); });
  const pr = document.getElementById('p-reopen');
  if (pr) pr.addEventListener('click', async () => { p.status = 'active'; p.closedAt = null; await save(p); renderProject(id); });
  document.getElementById('p-del').addEventListener('click', async () => {
    if (!confirm(`「${p.title}」と、その手順を削除します。つないだ情報のカードは残ります。`)) return;
    await removeCard(p);
    location.hash = '#projects';
  });
}

// 手順の画面: 書き足す、期限、別のプロジェクトへ移す、サブプロジェクトにする
async function renderStep(st) {
  const id = st.id;
  const owner = byId(st.project);
  setTab('projects');
  setTitle('手順', { back: true });
  const subs = linked(id, c => c.kind === 'project' && c.id !== st.project);
  const targets = projects().filter(x => x.status !== 'closed' || x.id === st.project);
  const a = st.action;
  $view.innerHTML = `
    <div class="card">
      <div class="row"><input type="checkbox" id="st-done" ${a.done ? 'checked' : ''} aria-label="完了"><input id="st-title" class="row-left" placeholder="やること" value="${esc(st.title)}"></div>
      <div class="row"><label for="st-due">期限(任意)</label><input id="st-due" type="date" value="${esc(a.due || '')}"></div>
      <textarea class="field field--desc" id="st-body" placeholder="メモ(任意)" aria-label="メモ">${esc(st.body)}</textarea>
      ${a.done ? `<textarea class="field field--desc" id="st-note" placeholder="やってみてどうだった?(任意)" aria-label="完了メモ">${esc(a.doneNote || '')}</textarea>` : ''}
    </div>
    <p class="pad small muted">期限を付けると、アクション画面にも出ます。</p>

    <section class="list-section"><h2 class="list-section__header">プロジェクト</h2>
      <div class="card">
        ${owner && !owner.deleted ? `<div class="row"><a class="kind-project" href="#project/${esc(owner.id)}">${esc(owner.title)}</a></div>` : ''}
        <div class="row"><label for="st-move">移す先</label><select id="st-move">${targets.map(x => `<option value="${esc(x.id)}" ${x.id === st.project ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select></div>
      </div>
    </section>

    <section class="list-section"><h2 class="list-section__header">サブプロジェクト</h2>
      ${subs.length ? `<div class="card"><div class="chips chips--edit">${subs.map(x => `<a class="chip-tag chip-project" href="#project/${esc(x.id)}">${esc(x.title)}</a>`).join('')}</div></div>` : ''}
      <div class="actions"><button class="btn btn--tinted" id="st-sub">この手順をプロジェクトにする</button></div>
      <p class="list-section__footer">手順はこのまま残り、新しいプロジェクトと元のプロジェクトがつながります。</p>
    </section>

    <div class="actions"><button class="btn btn--plain danger" id="st-del">手順を削除</button></div>`;

  const set = async patch => { Object.assign(st, patch); await save(st); };
  document.getElementById('st-done').addEventListener('change', async e => {
    if (e.target.checked) celebrate(e.target);
    await set({ action: { ...st.action, done: e.target.checked, doneAt: e.target.checked ? new Date().toISOString() : null } });
    renderStep(st);
  });
  const timers = {};
  const later = (k, fn) => { clearTimeout(timers[k]); timers[k] = setTimeout(fn, 500); };
  document.getElementById('st-title').addEventListener('input', e => later('t', () => set({ title: e.target.value, action: { ...st.action, text: e.target.value } })));
  document.getElementById('st-body').addEventListener('input', e => later('b', () => set({ body: e.target.value })));
  const note = document.getElementById('st-note');
  if (note) note.addEventListener('input', () => later('n', () => set({ action: { ...st.action, doneNote: note.value } })));
  document.getElementById('st-due').addEventListener('change', e => set({ action: { ...st.action, due: e.target.value || null } }));
  document.getElementById('st-move').addEventListener('change', async e => {
    const to = e.target.value;
    if (to === st.project) return;
    await set({ project: to, order: nextOrder(projectSteps(state.cards, to)) });
    toast(`「${byId(to).title}」に移しました`);
    renderStep(st);
  });
  document.getElementById('st-sub').addEventListener('click', async () => {
    const np = newProject({ id: db.uid(), title: st.title });
    // 新しいプロジェクトの側に、元の手順と元のプロジェクトへのつながりを書く
    np.links = [id, ...(owner && !owner.deleted ? [owner.id] : [])];
    await save(np);
    location.hash = `#project/${np.id}`;
  });
  document.getElementById('st-del').addEventListener('click', async () => {
    if (!confirm('この手順を削除します。')) return;
    await removeCard(st);
    location.hash = owner ? `#project/${owner.id}` : '#projects';
  });
}

// ---------- アクション ----------
const ACT_KEYS = ['actTag', 'actProject', 'actDue', 'actSort'];
function rememberActFilters() {
  db.setMeta('actionFilters', Object.fromEntries(ACT_KEYS.map(k => [k, state[k]]))).catch(() => {});
}

async function renderActions() {
  rememberActFilters();
  setTab('actions');
  setTitle('アクション');
  const all = forActionList(state.cards);
  const t = today();
  const names = tagNames();
  const tagList = tags().sort((a, b) => a.title.localeCompare(b.title, 'ja'));
  const projList = projects().sort((a, b) => (a.status === 'closed') - (b.status === 'closed') || a.title.localeCompare(b.title, 'ja'));
  if (state.actTag && !tagList.some(x => x.id === state.actTag)) state.actTag = '';
  if (state.actProject && !projList.some(p => p.id === state.actProject)) state.actProject = '';
  if (!ACTION_SORTS[state.actSort]) state.actSort = 'due';
  const list = all
    .filter(c => !state.actTag || (c.tags || []).includes(state.actTag))
    .filter(c => !state.actProject || projectsOf(c).some(p => p.id === state.actProject))
    .filter(c => inDueWindow(c.action, state.actDue, t));
  const { open, done } = sortActionList(list, state.actSort);
  const any = !!(state.actTag || state.actProject || state.actDue);
  const row = c => {
    const projs = projectsOf(c);
    const projBtns = projs.map(p => `<button class="chip-tag chip-project" data-fproj="${esc(p.id)}" aria-label="${esc(p.title)} で絞る">${colorDot(p)}${esc(p.title)}</button>`).join('');
    const tagBtns = (c.tags || []).filter(x => names.get(x)).map(x => `<button class="chip-tag" data-ftag="${esc(x)}" aria-label="#${esc(names.get(x))} で絞る">#${esc(names.get(x))}</button>`).join('');
    const due = c.action.due ? `<span class="badge${isOverdue(c.action, t) ? ' badge--warn' : ''}">${esc(shortDue(c.action.due))}</span>` : '';
    // 単発のアクションは元のカードの見出しを添える(手順はプロジェクトの札で分かる)
    const src = c.kind === 'step' ? '' : displayTitle(c);
    return `<li class="item item--action" data-id="${esc(c.id)}">
    <input type="checkbox" class="item__check" ${c.action.done ? 'checked' : ''} aria-label="${esc(c.action.text)} を完了">
    <div class="item__body">
      <a class="item__main item__main--top" href="#card/${esc(c.id)}">
        <span class="item__title${c.action.done ? ' is-done' : ''}">${projectDot(c)}${esc(c.action.text || '(やること未記入)')}</span>
        ${src && src !== c.action.text ? `<span class="item__snippet">${esc(src)}</span>` : ''}
      </a>
      ${due || projBtns || tagBtns ? `<div class="item__meta item__meta--below">${due}<span class="chips">${projBtns}${tagBtns}</span></div>` : '<div class="item__gap"></div>'}
    </div></li>`;
  };
  const sel = (id, cls, label, opts, cur) => `<select id="${id}" class="pill-select${cur && cls ? ' is-set' : ''}" aria-label="${label}">${opts}</select>`;
  $view.innerHTML = all.length ? `
    <div class="selects" role="group" aria-label="アクションを絞る、並べ替え">
      ${sel('a-due', true, '期日で絞る', `<option value="">◷ 期日</option>${Object.entries(DUE_WINDOWS).map(([k, l]) => `<option value="${k}" ${k === state.actDue ? 'selected' : ''}>${l}</option>`).join('')}`, state.actDue)}
      ${sel('a-proj', true, 'プロジェクトで絞る', `<option value="">◇ プロジェクト</option>${projList.map(p => `<option value="${esc(p.id)}" ${p.id === state.actProject ? 'selected' : ''}>${esc(p.title)}${p.status === 'closed' ? '(閉じた)' : ''}</option>`).join('')}`, state.actProject)}
      ${sel('a-tag', true, 'タグで絞る', `<option value=""># タグ</option>${tagList.map(x => `<option value="${esc(x.id)}" ${x.id === state.actTag ? 'selected' : ''}>#${esc(x.title)}</option>`).join('')}`, state.actTag)}
      ${sel('a-sort', false, '並び', Object.entries(ACTION_SORTS).map(([k, l]) => `<option value="${k}" ${k === state.actSort ? 'selected' : ''}>↕ ${l}</option>`).join(''), '')}
    </div>
    ${any ? `<div class="list-tools"><span class="small muted">${open.length}件</span><button class="btn btn--small btn--plain" id="a-clear">条件を外す</button></div>` : ''}
    ${open.length ? `<ul class="list list--inset items">${open.map(row).join('')}</ul>` : `<div class="empty"><p class="empty__message">${any ? 'この条件のやることはありません' : 'やることはありません'}</p></div>`}
    ${done.length ? `<details class="done-list"><summary class="pad">完了したもの</summary><ul class="list list--inset items">${done.slice(0, 100).map(row).join('')}</ul></details>` : ''}
    <p class="pad small muted">カードを開いて「アクション」から追加します。プロジェクトの手順は、期限を付けたものだけがここに出ます。</p>`
    : `<div class="empty"><p class="empty__message">アクションはまだありません。カードを開いて追加するか、プロジェクトの手順に期限を付けると、ここに出ます。</p></div>`;
  const on = (id, key) => { const el = document.getElementById(id); if (el) el.addEventListener('change', e => { state[key] = e.target.value; renderActions(); }); };
  on('a-due', 'actDue'); on('a-proj', 'actProject'); on('a-tag', 'actTag'); on('a-sort', 'actSort');
  const clear = document.getElementById('a-clear');
  if (clear) clear.addEventListener('click', () => { Object.assign(state, { actTag: '', actProject: '', actDue: '' }); renderActions(); });
  $view.querySelectorAll('[data-ftag]').forEach(b => b.addEventListener('click', () => { state.actTag = b.dataset.ftag; renderActions(); scrollTo(0, 0); }));
  $view.querySelectorAll('[data-fproj]').forEach(b => b.addEventListener('click', () => { state.actProject = b.dataset.fproj; renderActions(); scrollTo(0, 0); }));
  $view.querySelectorAll('.item__check').forEach(cb => cb.addEventListener('change', async () => {
    const card = byId(cb.closest('.item').dataset.id);
    if (cb.checked) celebrate(cb);
    card.action.done = cb.checked;
    card.action.doneAt = cb.checked ? new Date().toISOString() : null;
    await save(card);
    if (cb.checked) toast('完了しました。感想はカードに書けます');
    renderActions();
  }));
}

// ---------- 種別の編集 ----------
// 定義カードを取り出す(なければ今の値で作る)。最初からある種別は名前・順番・隠すだけを持つ
function kindDef(key) {
  const d = byId(kindDefId(key));
  if (d && !d.deleted) return d;
  const k = kindOf(key) || { title: '', fields: [], order: 1000 };
  return newKindDef({ key, title: k.title, fields: isBaseKind(key) ? [] : k.fields, order: k.order });
}
async function saveKind(key, patch) {
  const d = Object.assign(kindDef(key), patch);
  if (d.deleted) d.deleted = false;
  await save(d);
  kindCache = null;
}

async function renderKinds() {
  setTab('settings');
  setTitle('種別', { back: true });
  const list = kinds();
  const count = new Map();
  for (const c of items()) count.set(c.kind, (count.get(c.kind) || 0) + 1);
  const row = (k, i) => `<li class="item kind-row" data-key="${esc(k.key)}">
    <div class="item__body kind-row__body">
      <div class="row"><input class="row-left kind-name" value="${esc(k.title)}" aria-label="種別の名前"><span class="small muted">${count.get(k.key) || 0}枚</span></div>
      <div class="kind-row__opts">
        ${k.base ? `<span class="small muted">${k.fields.length ? `欄: ${k.fields.map(f => f === 'photo' ? '写真' : KIND_FIELDS[f]).join('・')}` : '欄: メモだけ'}</span>`
          : Object.entries(KIND_FIELDS).map(([f, l]) => `<button type="button" class="chip-tag chip-pick${k.fields.includes(f) ? ' is-on' : ''}" data-field="${f}" aria-pressed="${k.fields.includes(f)}">${k.fields.includes(f) ? '✓ ' : ''}${l}</button>`).join('')}
        ${k.key === 'memo' ? '' : `<label class="small kind-hide"><input type="checkbox" data-hide ${k.hidden ? 'checked' : ''}> 隠す</label>`}
        ${k.base ? '' : '<button type="button" class="btn btn--small btn--plain danger" data-del>消す</button>'}
      </div>
    </div>
    <span class="item__tools">
      <button data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="上へ">↑</button>
      <button data-move="1" ${i === list.length - 1 ? 'disabled' : ''} aria-label="下へ">↓</button>
    </span>
  </li>`;
  $view.innerHTML = `
    <p class="pad small muted">情報ソースの種類です。名前を変えたり、並べ替えたり、使わないものを隠したりできます。足した種別には、作るときに出す欄(リンク・引用)を選べます。</p>
    <ul class="list list--inset items" id="kind-list">${list.map(row).join('')}</ul>
    <div class="card card--after-list"><div class="row"><input id="new-kind" class="row-left" placeholder="新しい種別(例: 本、論文、ポッドキャスト)" aria-label="新しい種別"><button class="btn btn--small btn--tinted" id="add-kind">足す</button></div></div>
    <p class="pad small muted">「隠す」と、受信箱の選択や絞り込みに出なくなります(その種別のカードはそのまま残ります)。足した種別を消すと、そのカードはメモになります。</p>`;
  const keyOf = el => el.closest('.kind-row').dataset.key;
  $view.querySelectorAll('.kind-name').forEach(inp => inp.addEventListener('change', async () => {
    const v = inp.value.trim();
    if (!v) { inp.value = kindName(keyOf(inp)); return; }
    await saveKind(keyOf(inp), { title: v });
    toast('名前を変えました');
  }));
  $view.querySelectorAll('[data-field]').forEach(b => b.addEventListener('click', async () => {
    const key = keyOf(b), f = b.dataset.field, cur = new Set(kindOf(key).fields);
    cur.has(f) ? cur.delete(f) : cur.add(f);
    await saveKind(key, { fields: [...cur] });
    renderKinds();
  }));
  $view.querySelectorAll('[data-hide]').forEach(cb => cb.addEventListener('change', async () => { await saveKind(keyOf(cb), { hidden: cb.checked }); }));
  $view.querySelectorAll('[data-move]').forEach(b => b.addEventListener('click', async () => {
    const keys = kinds().map(k => k.key), i = keys.indexOf(keyOf(b)), j = i + Number(b.dataset.move);
    if (j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    for (let n = 0; n < keys.length; n++) if (kindOf(keys[n]).order !== n * 10) await saveKind(keys[n], { order: n * 10 });
    renderKinds();
  }));
  $view.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    const key = keyOf(b), n = count.get(key) || 0;
    if (!confirm(`種別「${kindName(key)}」を消しますか?${n ? `\nこの種別の${n}枚のカードはメモになります。` : ''}`)) return;
    for (const c of items().filter(c => c.kind === key)) { c.kind = 'memo'; await save(c); }
    const d = byId(kindDefId(key));
    if (d) await removeCard(d);
    kindCache = null;
    if (state.capKind === key) state.capKind = '';
    if (state.kindFilter === key) state.kindFilter = '';
    renderKinds();
  }));
  const input = document.getElementById('new-kind');
  const add = async () => {
    const title = input.value.trim();
    if (!title) { input.focus(); return; }
    if (kinds().some(k => k.title === title)) { toast('同じ名前の種別があります'); return; }
    const key = 'k' + db.uid().toLowerCase().replace(/[^a-z0-9]/g, '');
    await save(newKindDef({ key, title, fields: [], order: (kinds().at(-1)?.order ?? 0) + 10 }));
    kindCache = null;
    renderKinds();
  };
  document.getElementById('add-kind').addEventListener('click', add);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) add(); });
}

// ---------- 設定 ----------
async function renderSettings() {
  setTab('settings');
  setTitle('設定');
  const [key, model, url, token] = await Promise.all([db.getMeta('geminiKey', ''), db.getMeta('geminiModel', gemini.DEFAULT_MODEL), db.getMeta('syncUrl', ''), db.getMeta('syncToken', '')]);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const capUrl = new URL('./', location.href).href;
  $view.innerHTML = `
    <section class="list-section"><h2 class="list-section__header">アイデアハブ(端末間の同期)</h2>
      <div class="card">
        <div class="row"><label for="s-url">URL</label><input id="s-url" placeholder="https://script.google.com/…/exec" value="${esc(url)}"></div>
        <div class="row"><label for="s-token">合言葉</label><input id="s-token" value="${esc(token)}" autocomplete="off"></div>
      </div>
      <div class="actions"><button class="btn btn--prominent" id="s-connect">${url ? '保存して同期する' : '接続して同期する'}</button>${url ? '<button class="btn btn--plain danger" id="s-disconnect">接続をやめる</button>' : ''}</div>
      <p class="list-section__footer" id="s-status"></p>
    </section>
    <section class="list-section"><h2 class="list-section__header">種別</h2>
      <ul class="list list--inset"><li class="list__row"><a class="row-link" href="#kinds">種別(情報ソースの種類)を編集 <span class="muted">${kinds().filter(k => !k.hidden).map(k => esc(k.title)).join('・')}</span></a></li></ul>
    </section>

    <section class="list-section"><h2 class="list-section__header">Gemini(写真の文字読み取り)</h2>
      <div class="card">
        <div class="row"><label for="g-key">APIキー</label><input id="g-key" type="password" value="${esc(key)}" autocomplete="off"></div>
        <div class="row"><label for="g-model">モデル</label><input id="g-model" value="${esc(model)}"></div>
      </div>
      <p class="list-section__footer">ボタンを押したときだけ、その写真を送ります。無料枠では送った内容がGoogleの製品改善に使われることがあります。キーはこの端末の中にだけ保存します。</p>
    </section>
    <section class="list-section"><h2 class="list-section__header">バックアップ</h2>
      <div class="actions"><button class="btn btn--tinted" id="b-export">書き出す</button><label class="btn btn--plain" for="b-import">読み込む</label><input type="file" id="b-import" accept="application/json,.json" hidden></div>
      <p class="list-section__footer">カードをJSONで書き出します(写真の本体とキーは含みません)。</p>
    </section>
    <section class="list-section"><h2 class="list-section__header">入口</h2>
      <p class="pad small">iPhoneの共有シートやChrome拡張からは、次のURLにテキストを付けて開くと受信箱に入ります。</p>
      <p class="pad small mono">${esc(capUrl)}?capture=1&amp;text=…&amp;url=…&amp;tags=…</p>
      <p class="pad small muted">作り方はリポジトリの docs/shortcuts.md と extension/README.md にあります。</p>
      ${!standalone ? `<p class="list-section__footer">Safariの共有ボタンから「ホーム画面に追加」してから使ってください。追加しないと、しばらく開かないうちにデータが消えることがあります。</p>` : ''}
    </section>`;
  const status = document.getElementById('s-status');
  const showStatus = s => {
    status.textContent = s.state === 'off' ? '未接続です。この端末の中だけに保存しています。'
      : s.state === 'syncing' ? '同期中…'
        : s.state === 'error' ? `同期できませんでした: ${s.error}`
          : `同期済み${s.lastAt ? ` (${fmtDate(s.lastAt)})` : ''}${s.pending ? ` ・ 未送信 ${s.pending}件` : ''}`;
  };
  showStatus(sync.status);
  const off = sync.onStatus(showStatus);
  addEventListener('hashchange', off, { once: true });
  document.getElementById('s-connect').addEventListener('click', async () => {
    const u = document.getElementById('s-url').value.trim();
    const t = document.getElementById('s-token').value.trim();
    if (!u || !t) { toast('URLと合言葉を入れてください'); return; }
    await sync.connect(u, t);
    renderSettings();
  });
  const dis = document.getElementById('s-disconnect');
  if (dis) dis.addEventListener('click', async () => { await sync.disconnect(); renderSettings(); });
  document.getElementById('g-key').addEventListener('change', e => db.setMeta('geminiKey', e.target.value.trim()));
  document.getElementById('g-model').addEventListener('change', e => db.setMeta('geminiModel', e.target.value.trim() || gemini.DEFAULT_MODEL));
  document.getElementById('b-export').addEventListener('click', () => exportData().catch(e => toast(e.message)));
  document.getElementById('b-import').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try { const n = await importData(await f.text()); await load(); toast(`${n}件を読み込みました`); } catch (err) { toast(err.message, 5000); }
  });
}

// ---------- 共有シート・拡張からの受け取り ----------
async function takeCapture() {
  const cap = parseCapture(location.search);
  if (!cap) return false;
  // 同じURLを開き直したときに二重に入れない
  const sig = JSON.stringify(cap);
  if (sessionStorage.getItem('lastCapture') === sig) return false;
  sessionStorage.setItem('lastCapture', sig);
  await addCard(cap);
  history.replaceState(null, '', location.pathname + '#inbox');
  toast('受信箱に入れました');
  return true;
}

// ---------- ルーティング ----------
async function route() {
  const [name, arg] = location.hash.replace(/^#/, '').split('/');
  window.scrollTo(0, 0);
  linkCache = slotCache = kindCache = null;
  switch (name) {
    case 'all': return renderAll();
    case 'tags': return renderTags();
    case 'tag': return renderTag(decodeURIComponent(arg || ''));
    case 'card': return renderCard(decodeURIComponent(arg || ''));
    case 'actions': return renderActions();
    case 'projects': return renderProjects();
    case 'project': return renderProject(decodeURIComponent(arg || ''));
    case 'settings': return renderSettings();
    case 'kinds': return renderKinds();
    default: return renderInbox();
  }
}

document.getElementById('back').addEventListener('click', () => history.length > 1 ? history.back() : (location.hash = '#inbox'));
addEventListener('hashchange', route);

// Large Title の折り畳み
const nav = document.getElementById('nav');
const sentinel = document.createElement('div');
sentinel.style.cssText = 'position:absolute;top:0;height:1px;width:1px;';
document.body.prepend(sentinel);
new IntersectionObserver(([e]) => nav.classList.toggle('is-collapsed', !e.isIntersecting), { threshold: 0 }).observe(sentinel);

// 他の端末の変更を受け取ったら読み直す。入力中は画面を作り直さない(次に画面を移ったときに反映される)
// Webページの代表画像を、ハブに頼んで取ってくる(アプリからは他のサイトを直接読めないため)。
// 1回に30件まで、1件ずつ。ハブが古くて画像を返さないときは、印を付けずにやめる(新しいハブで後から取れるように)
let fillingImages = false;
async function fillImages() {
  if (fillingImages) return;
  const [url, token] = await Promise.all([db.getMeta('syncUrl', ''), db.getMeta('syncToken', '')]);
  if (!url || !token || !navigator.onLine) return;
  fillingImages = true;
  let found = 0, stopped = false;
  try {
    for (const c of state.cards.filter(needsImage).slice(0, 30)) {
      const asked = c.url;
      let data;
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token, meta: asked }), redirect: 'follow' });
        data = await res.json();
      } catch { stopped = true; break; }
      if (!data || !data.ok || typeof data.image !== 'string') { stopped = true; break; }
      const card = byId(c.id);
      // 待っている間にURLが変わっていたら、前のページの答えは使わない
      if (!card || card.imageTried || card.url !== asked) continue;
      card.imageTried = true;
      if (!card.image && /^https:\/\//i.test(data.image)) { card.image = data.image; found++; }
      // 見出しのないカードには、ページの題名(YouTubeは動画の題名)を見出しに
      const head = typeof data.text === 'string' ? data.text.split('\n')[0].trim() : '';
      if (!card.title && head) { card.title = head.slice(0, 120); found++; }
      await save(card, { touch: false });
    }
  } finally {
    fillingImages = false;
  }
  if (found) await refreshView();
  // 30件を超えて残っていれば、少し置いて次の30件へ(ハブに断られたときは続けない)
  if (!stopped && state.cards.some(needsImage)) setTimeout(fillImages, 3000);
}
async function refreshView() {
  const a = document.activeElement;
  const typing = a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
  if (!typing && !location.hash.startsWith('#settings') && !location.hash.startsWith('#card/')) { const y = scrollY; await route(); scrollTo(0, y); }
}

async function onRemoteChange() {
  await load();
  await resolvePendingTags();
  const a = document.activeElement;
  const typing = a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
  if (!typing && !location.hash.startsWith('#settings')) { const y = scrollY; await route(); scrollTo(0, y); }
  fillImages();
}

(async function start() {
  await load();
  const saved = await db.getMeta('allFilters', null).catch(() => null);
  if (saved) for (const k of FILTER_KEYS) if (typeof saved[k] === 'string') state[k] = saved[k];
  const savedAct = await db.getMeta('actionFilters', null).catch(() => null);
  if (savedAct) for (const k of ACT_KEYS) if (typeof savedAct[k] === 'string') state[k] = savedAct[k];
  db.requestPersist();
  // Safariのタブはホーム画面のアプリと保存場所が別で、使わないと7日で消える
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && !(matchMedia('(display-mode: standalone)').matches || navigator.standalone)) document.getElementById('tab-warning').hidden = false;
  // 同期の見張りを先に付ける。先に受け取ると、URLから来たカードがハブへ送られない
  await sync.initSync({ onRemoteChange });
  await takeCapture();
  route();
  sync.schedule(300);
  setTimeout(fillImages, 4000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync.schedule(300); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();

// テスト用に公開
window.__app = { state };
