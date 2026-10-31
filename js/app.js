import * as db from './db.js';
import { KINDS, parseCapture, newCard, normTag, tagId, displayTitle, matches, nearCards, relatedTags, sortActions, isOverdue } from './core.js';
import * as gemini from './gemini.js';
import { exportData, importData } from './backup.js';
import * as sync from './sync.js';

// ---------- 状態 ----------
const state = {
  cards: [],
  query: '',
  kindFilter: '',
  shown: 100,
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
const items = () => live().filter(c => c.kind !== 'tag');
const tags = () => live().filter(c => c.kind === 'tag');
const byId = id => state.cards.find(c => c.id === id);
function tagNames() { return new Map(tags().map(t => [t.id, t.title])); }
function tagUse() {
  const n = new Map();
  for (const c of items()) for (const t of c.tags || []) n.set(t, (n.get(t) || 0) + 1);
  return n;
}

async function load() {
  state.cards = await db.getAll('cards');
}

async function save(card) {
  card.updatedAt = new Date().toISOString();
  await db.put('cards', card);
  const i = state.cards.findIndex(c => c.id === card.id);
  if (i >= 0) state.cards[i] = card; else state.cards.push(card);
}

async function addCard(input) {
  const tagIds = [];
  for (const name of input.tags || []) tagIds.push((await ensureTag(name)).id);
  const card = newCard({ ...input, id: db.uid(), tags: tagIds });
  await save(card);
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
}

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
function tagChips(card, names = tagNames()) {
  const list = (card.tags || []).map(t => names.get(t)).filter(Boolean);
  if (!list.length) return '';
  // 一覧の行は全体がリンクなので、タグはリンクにせず表示だけにする(リンクの入れ子を避ける)
  return `<span class="chips">${(card.tags || []).filter(t => names.get(t)).map(t => `<span class="chip-tag">#${esc(names.get(t))}</span>`).join('')}</span>`;
}

function cardRow(card, { names = tagNames(), inboxButton = false } = {}) {
  const snippet = card.title ? (card.body || card.quote || '') : (card.body || '').split('\n').slice(1).join(' ');
  const action = card.action && !card.action.done ? `<span class="badge${isOverdue(card.action, today()) ? ' badge--warn' : ''}">アクション${card.action.due ? ` ${esc(card.action.due.slice(5).replace('-', '/'))}` : ''}</span>` : '';
  return `<li class="item" data-id="${esc(card.id)}">
    <a class="item__main" href="#card/${esc(card.id)}">
      <span class="item__kind kind-${esc(card.kind)}">${esc(KINDS[card.kind] || 'メモ')}</span>
      <span class="item__title">${esc(displayTitle(card))}</span>
      ${snippet.trim() ? `<span class="item__snippet">${esc(snippet.trim().slice(0, 140))}</span>` : ''}
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
    b.closest('.item').remove();
    toast('受信箱から出しました');
    if (after) after();
  }));
}

// ---------- 受信箱(放り込む) ----------
async function renderInbox() {
  setTab('inbox');
  setTitle('受信箱');
  const inbox = items().filter(c => c.inbox).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const names = tagNames();
  $view.innerHTML = `
    <div class="card capture">
      <textarea class="field field--note" id="cap-text" placeholder="思いつき・URL・名言…なんでも&#10;音声はキーボードのマイクで" aria-label="放り込む内容"></textarea>
      <input class="field field--tags" id="cap-tags" placeholder="#タグ(任意、空白区切り)" aria-label="タグ" autocomplete="off" list="tag-list">
      <datalist id="tag-list">${tags().map(t => `<option value="${esc(t.title)}">`).join('')}</datalist>
    </div>
    <div class="actions">
      <label class="btn btn--tinted" for="cap-photo">写真</label>
      <input type="file" id="cap-photo" accept="image/*" hidden>
      <button class="btn btn--prominent" id="cap-save">放り込む</button>
    </div>
    ${inbox.length ? `<section class="list-section"><h2 class="list-section__header">まだ整理していないもの</h2>
      <ul class="list list--inset items">${inbox.map(c => cardRow(c, { names, inboxButton: true })).join('')}</ul>
      <p class="list-section__footer">✓で受信箱から出します。そのままにしておいても構いません。</p></section>`
      : `<div class="empty"><p class="empty__message">受信箱は空です。思いついたことを上に放り込んでください。</p></div>`}
  `;
  const text = document.getElementById('cap-text');
  const tagInput = document.getElementById('cap-tags');
  document.getElementById('cap-save').addEventListener('click', async () => {
    if (!text.value.trim()) { text.focus(); return; }
    await addCard({ text: text.value, tags: splitTags(tagInput.value) });
    toast('受信箱に入れました');
    renderInbox();
  });
  document.getElementById('cap-photo').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const card = await addCard({ text: text.value, kind: 'photo', tags: splitTags(tagInput.value) });
    await db.put('images', { id: card.id, blob: await shrink(file) });
    location.hash = `#card/${card.id}`;
  });
  bindRows($view);
}

function splitTags(s) {
  return String(s || '').split(/[\s,、]+/).map(x => x.replace(/^#+/, '').trim()).filter(Boolean);
}

// ---------- すべて(探す) ----------
const FILTERS = [['', 'すべて'], ['memo', 'メモ'], ['url', 'Web'], ['video', '動画'], ['quote', '名言'], ['photo', '写真'], ['summary', 'まとめ'], ['action', 'アクション']];

async function renderAll() {
  setTab('all');
  setTitle('すべて');
  $view.innerHTML = `
    <div class="pad"><input class="search-field" id="q" type="search" placeholder="検索(語・#タグ)" value="${esc(state.query)}" aria-label="検索"></div>
    <div class="filters" role="group" aria-label="種類で絞る">${FILTERS.map(([k, l]) => `<button class="kind ${state.kindFilter === k ? 'is-active' : ''}" data-k="${k}" aria-pressed="${state.kindFilter === k}">${l}</button>`).join('')}</div>
    <div id="results"></div>`;
  const draw = () => {
    const names = tagNames();
    const list = items()
      .filter(c => !state.kindFilter || (state.kindFilter === 'action' ? c.action : c.kind === state.kindFilter))
      .filter(c => matches(c, state.query, names))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    document.getElementById('results').innerHTML = list.length
      ? `<ul class="list list--inset items">${list.slice(0, state.shown).map(c => cardRow(c, { names })).join('')}</ul>
         ${list.length > state.shown ? `<div class="actions"><button class="btn btn--plain" id="more">もっと見る</button></div>` : ''}`
      : `<div class="empty"><p class="empty__message">${items().length ? '見つかりませんでした' : 'まだ何もありません。受信箱から放り込んでください。'}</p></div>`;
    const more = document.getElementById('more');
    if (more) more.addEventListener('click', () => { state.shown += 100; draw(); });
  };
  let t;
  document.getElementById('q').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { state.query = e.target.value; state.shown = 100; draw(); }, 200); });
  $view.querySelectorAll('.filters .kind').forEach(b => b.addEventListener('click', () => { state.kindFilter = b.dataset.k; renderAll(); }));
  draw();
}

// ---------- タグ ----------
async function renderTags() {
  setTab('tags');
  setTitle('タグ');
  const use = tagUse();
  const list = tags().sort((a, b) => (use.get(b.id) || 0) - (use.get(a.id) || 0) || a.title.localeCompare(b.title, 'ja'));
  $view.innerHTML = `
    <div class="card"><div class="row"><input id="new-tag" placeholder="新しいタグ(例: ブログ、買いたい)" aria-label="新しいタグ"><button class="btn btn--small btn--tinted" id="add-tag">追加</button></div></div>
    ${list.length ? `<div class="tag-cloud">${list.map(t => `<a class="chip-tag chip-tag--lg" href="#tag/${esc(t.id)}">#${esc(t.title)} <small>${use.get(t.id) || 0}</small></a>`).join('')}</div>
      <p class="pad small muted">出口(#ブログ、#買いたい など)も、話題も、状態(#試したい など)も、同じタグで扱います。1つのカードにいくつ付けても構いません。</p>`
      : `<div class="empty"><p class="empty__message">まだタグがありません。カードにタグを付けると、ここに並びます。</p></div>`}`;
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
    const v = nameInput.value.normalize('NFKC').replace(/^#+/, '').trim();
    if (!v) { nameInput.value = tag.title; return; }
    const dup = tags().find(t => t.id !== id && normTag(t.title) === normTag(v));
    if (dup) { toast(`#${dup.title} がすでにあります`); nameInput.value = tag.title; return; }
    tag.title = v;
    await save(tag);
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
    if (!confirm(`#${tag.title} を削除します。カード自体は残り、このタグだけが外れます。`)) return;
    await removeCard(tag);
    location.hash = '#tags';
  });
}

// ---------- カード ----------
function autosave(card, fields, after) {
  let t;
  for (const [key, el] of Object.entries(fields)) {
    el.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(async () => {
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
  setTab(card.inbox ? 'inbox' : 'all');
  setTitle(KINDS[card.kind] || 'カード', { back: true });
  const image = card.kind === 'photo' ? await db.get('images', id) : null;
  const near = nearCards(items(), card);
  const names = tagNames();
  const refs = (card.refs || []).map(byId).filter(c => c && !c.deleted);
  const a = card.action;
  $view.innerHTML = `
    ${image ? `<div class="photo"><img id="photo" alt="写真"></div>` : ''}
    <div class="card">
      <input class="field field--title" id="c-title" placeholder="見出し(任意)" value="${esc(card.title)}" aria-label="見出し">
      <textarea class="field field--note" id="c-body" placeholder="本文" aria-label="本文">${esc(card.body)}</textarea>
      ${card.kind === 'quote' || card.quote ? `<textarea class="field field--quote" id="c-quote" placeholder="引用・名言" aria-label="引用">${esc(card.quote)}</textarea>` : ''}
      <div class="row"><label for="c-url">URL</label><input id="c-url" type="url" inputmode="url" placeholder="https://…" value="${esc(card.url)}">${card.url ? `<a class="btn btn--small btn--plain" href="${esc(card.url)}" target="_blank" rel="noopener">開く</a>` : ''}</div>
      <div class="row"><label for="c-kind">種類</label><select id="c-kind">${Object.entries(KINDS).filter(([k]) => k !== 'tag').map(([k, l]) => `<option value="${k}" ${k === card.kind ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    </div>
    ${image ? `<div class="actions"><button class="btn btn--tinted" id="ocr">文字を読み取る(Gemini)</button></div>` : ''}

    <section class="list-section"><h2 class="list-section__header">タグ</h2>
      <div class="card">
        <div class="chips chips--edit" id="c-tags"></div>
        <div class="row"><input id="c-tag-input" placeholder="タグを追加" list="tag-list" autocomplete="off" aria-label="タグを追加"><button class="btn btn--small btn--tinted" id="c-tag-add">追加</button></div>
        <datalist id="tag-list">${tags().map(t => `<option value="${esc(t.title)}">`).join('')}</datalist>
      </div>
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
  grow(fields.body);
  fields.body.addEventListener('input', () => grow(fields.body));
  document.getElementById('c-kind').addEventListener('change', async e => { card.kind = e.target.value; await save(card); renderCard(id); });

  // タグの編集
  const drawTags = () => {
    const n = tagNames();
    document.getElementById('c-tags').innerHTML = (card.tags || []).filter(t => n.get(t)).map(t =>
      `<span class="chip-tag chip-tag--edit"><a href="#tag/${esc(t)}">#${esc(n.get(t))}</a><button data-t="${esc(t)}" aria-label="#${esc(n.get(t))} を外す">×</button></span>`).join('') || '<span class="muted small">タグなし</span>';
    document.querySelectorAll('#c-tags button').forEach(b => b.addEventListener('click', async () => {
      card.tags = card.tags.filter(t => t !== b.dataset.t);
      await save(card);
      drawTags();
    }));
  };
  const tagInput = document.getElementById('c-tag-input');
  const addTag = async () => {
    const list = splitTags(tagInput.value);
    if (!list.length) return;
    for (const name of list) {
      const t = await ensureTag(name);
      if (!card.tags.includes(t.id)) card.tags.push(t.id);
    }
    await save(card);
    tagInput.value = '';
    drawTags();
  };
  document.getElementById('c-tag-add').addEventListener('click', addTag);
  tagInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addTag(); } });
  drawTags();

  // アクション
  if (a) {
    const set = async patch => { Object.assign(card.action, patch); await save(card); };
    document.getElementById('a-done').addEventListener('change', async e => {
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

// ---------- アクション ----------
async function renderActions() {
  setTab('actions');
  setTitle('アクション');
  const { open, done } = sortActions(items());
  const t = today();
  const row = c => `<li class="item item--action" data-id="${esc(c.id)}">
    <input type="checkbox" class="item__check" ${c.action.done ? 'checked' : ''} aria-label="${esc(c.action.text)} を完了">
    <a class="item__main" href="#card/${esc(c.id)}">
      <span class="item__title">${esc(c.action.text || '(やること未記入)')}</span>
      <span class="item__snippet">${esc(displayTitle(c))}</span>
      ${c.action.due ? `<span class="item__meta"><span class="badge${isOverdue(c.action, t) ? ' badge--warn' : ''}">${esc(c.action.due)}</span></span>` : ''}
    </a></li>`;
  $view.innerHTML = open.length || done.length ? `
    ${open.length ? `<ul class="list list--inset items">${open.map(row).join('')}</ul>` : '<div class="empty"><p class="empty__message">やることはありません</p></div>'}
    ${done.length ? `<details class="done-list"><summary class="pad">完了したもの</summary><ul class="list list--inset items">${done.slice(0, 100).map(row).join('')}</ul></details>` : ''}
    <p class="pad small muted">カードを開いて「アクション」から追加します。行を押すと、元のカードに戻れます。</p>`
    : `<div class="empty"><p class="empty__message">アクションはまだありません。カードを開いて、必要なときだけ追加してください。</p></div>`;
  $view.querySelectorAll('.item__check').forEach(cb => cb.addEventListener('change', async () => {
    const card = byId(cb.closest('.item').dataset.id);
    card.action.done = cb.checked;
    card.action.doneAt = cb.checked ? new Date().toISOString() : null;
    await save(card);
    if (cb.checked) toast('完了しました。感想はカードに書けます');
    renderActions();
  }));
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
  switch (name) {
    case 'all': return renderAll();
    case 'tags': return renderTags();
    case 'tag': return renderTag(decodeURIComponent(arg || ''));
    case 'card': return renderCard(decodeURIComponent(arg || ''));
    case 'actions': return renderActions();
    case 'settings': return renderSettings();
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
async function onRemoteChange() {
  await load();
  await resolvePendingTags();
  const a = document.activeElement;
  const typing = a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
  if (!typing && !location.hash.startsWith('#settings')) { const y = scrollY; await route(); scrollTo(0, y); }
}

(async function start() {
  await load();
  db.requestPersist();
  // Safariのタブはホーム画面のアプリと保存場所が別で、使わないと7日で消える
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && !(matchMedia('(display-mode: standalone)').matches || navigator.standalone)) document.getElementById('tab-warning').hidden = false;
  await takeCapture();
  route();
  await sync.initSync({ onRemoteChange });
  sync.schedule(300);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync.schedule(300); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();

// テスト用に公開
window.__app = { state };
