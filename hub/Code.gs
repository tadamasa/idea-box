/**
 * アイデアハブ: idea-box(https://tadamasa.github.io/idea-box/)のカードを、このスプレッドシートに同期する受け口。
 *
 * 使い方は hub/README.md を参照。
 *  1. 新しいスプレッドシート → 拡張機能 → Apps Script に、このファイルを貼る
 *  2. setup を一度実行(合言葉が実行ログに出る)
 *  3. デプロイ → 新しいデプロイ → ウェブアプリ(実行ユーザー: 自分、アクセス: 全員)
 *  4. 出たURLと合言葉を、idea-box の設定と Chrome拡張の設定に入れる
 *
 * シート「cards」は、ほかのApps Scriptからそのまま読める表になっている。
 * 最後の列 json がアプリの元データ。人が表を書き換えても、アプリには反映されない(json が正)。
 */

const CARD_COLS = ['id', 'rev', 'mtime', 'deleted', 'kind', 'title', 'tags', 'inbox', 'action', 'due', 'done', 'url', 'createdAt', 'json'];
const NAMES = ['cards'];
const COLS = { cards: CARD_COLS };
const PAGE = 400; // 1回の応答で返す最大件数

function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TOKEN')) props.setProperty('TOKEN', Utilities.getUuid().replace(/-/g, ''));
  sheet_('cards', CARD_COLS);
  Logger.log('合言葉: ' + props.getProperty('TOKEN'));
}

function doGet() {
  return json_({ ok: true, app: 'idea-hub' });
}

// 受け取る: { token, since, cards: [{id, mtime, deleted, data}] }
// 返す:     { ok, rev, more, cards: [{id, mtime, deleted, data}] }  (rev が since より新しいもの)
//
// Chrome拡張とiOSショートカットは、かわりに { token, capture: {text, url, title, quote, kind, tags} } を送る。
// ハブがカードを1枚作り、アプリは次の同期で受け取る(タグ名は pendingTags に入れ、アプリがタグに直す)。
function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad json' }); }
  const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!token || req.token !== token) return json_({ ok: false, error: 'unauthorized' });
  if (req.capture) {
    const card = captureCard_(req.capture, new Date());
    if (!card) return json_({ ok: false, error: 'empty' });
    req = { token: req.token, since: Number.MAX_SAFE_INTEGER, cards: [{ id: card.id, mtime: Date.now(), data: card }] };
    doSync_(req);
    return json_({ ok: true, id: card.id });
  }
  return doSync_(req);
}

function doSync_(req) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const props = PropertiesService.getScriptProperties();
    let rev = Number(props.getProperty('REV') || 0);
    const since = Number(req.since || 0);
    const fresh = [];
    for (const name of NAMES) {
      const cols = COLS[name];
      const sh = sheet_(name, cols);
      const values = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, cols.length).getValues() : [];
      const index = {};
      values.forEach((r, i) => { index[r[0]] = i; });
      // タグ名の表(tags 列を読めるようにするため)
      const tagNames = {};
      values.forEach(r => { if (r[4] === 'tag' && String(r[3]) !== 'true') tagNames[r[0]] = r[5]; });
      for (const item of req[name] || []) if (item && item.data && item.data.kind === 'tag') tagNames[item.id] = item.data.title || '';
      let changed = false;
      for (const item of req[name] || []) {
        if (!item || !item.id) continue;
        const i = index[item.id];
        if (i !== undefined && Number(values[i][2]) > Number(item.mtime || 0)) continue; // 表のほうが新しい
        rev += 1;
        const row = cardRow_(item, rev, tagNames);
        if (i === undefined) { index[item.id] = values.length; values.push(row); } else values[i] = row;
        changed = true;
      }
      if (changed) {
        const need = values.length + 1 - sh.getMaxRows();
        if (need > 0) { sh.insertRowsAfter(sh.getMaxRows(), need); sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@'); }
        sh.getRange(2, 1, values.length, cols.length).setValues(values);
      }
      for (const r of values) if (Number(r[1]) > since) fresh.push({ name, rev: Number(r[1]), r, last: cols.length - 1 });
    }
    props.setProperty('REV', String(rev));
    // 古い順に PAGE 件まで返す。残りがあれば more を立て、返した最後の rev を次の起点にする
    fresh.sort((x, y) => x.rev - y.rev);
    const page = fresh.slice(0, PAGE);
    const out = { ok: true, more: fresh.length > PAGE, rev: fresh.length > PAGE ? page[page.length - 1].rev : rev };
    for (const name of NAMES) out[name] = [];
    for (const f of page) {
      const deleted = String(f.r[3]) === 'true';
      out[f.name].push({ id: String(f.r[0]), mtime: Number(f.r[2]), deleted, data: deleted ? null : parse_(f.r[f.last]) });
    }
    return json_(out);
  } finally {
    lock.releaseLock();
  }
}

// 受け取ったテキストからカードを作る。種類の推定はアプリの core.js の detectKind と同じ考え方
function captureCard_(cap, now) {
  const text = String(cap.text || '').trim();
  const m = /https?:\/\/[^\s<>"'「」]+/i.exec(text);
  const url = String(cap.url || '').trim() || (m ? m[0] : '');
  const title = String(cap.title || '').trim();
  const quote = String(cap.quote || '').trim();
  if (!text && !url && !title && !quote) return null;
  const kinds = ['memo', 'url', 'video', 'quote', 'photo', 'summary'];
  let kind = kinds.indexOf(cap.kind) >= 0 ? cap.kind : '';
  if (!kind) kind = /(youtube\.com|youtu\.be|vimeo\.com|nicovideo\.jp)\//i.test(url) ? 'video' : url ? 'url' : /^[「『"“]/.test(text) ? 'quote' : 'memo';
  const tags = (Array.isArray(cap.tags) ? cap.tags : String(cap.tags || '').split(/[,、\s]+/)).map(t => String(t).replace(/^#+/, '').trim()).filter(Boolean);
  const iso = now.toISOString();
  return {
    id: now.getTime().toString(36) + Math.random().toString(36).slice(2, 8),
    kind, title, body: url && text === url ? '' : text, url, quote,
    tags: [], pendingTags: tags, inbox: true, action: null, createdAt: iso, updatedAt: iso,
    source: String(cap.source || ''),
  };
}

function cardRow_(item, rev, tagNames) {
  const c = item.data || {};
  const a = c.action || null;
  const tags = (c.tags || []).map(t => tagNames[t] || '').concat(c.pendingTags || []).filter(Boolean).join(', ');
  return [item.id, String(rev), String(Number(item.mtime || 0)), String(!!item.deleted), c.kind || '', c.title || firstLine_(c), tags,
    String(!!c.inbox), a ? (a.text || '') : '', a ? (a.due || '') : '', a ? String(!!a.done) : '', c.url || '', (c.createdAt || '').slice(0, 10),
    item.deleted ? '' : cell_(c)];
}

function firstLine_(c) {
  return String(c.body || c.quote || '').split('\n')[0].slice(0, 80);
}

// 1セルは5万字まで。長い本文は削って入れる
function cell_(obj) {
  const s = JSON.stringify(obj);
  if (s.length < 49000) return s;
  return JSON.stringify(Object.assign({}, obj, { body: String(obj.body || '').slice(0, 40000) }));
}

function sheet_(name, cols) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    // 日付などが勝手に変換されないよう、すべて書式なしテキストにする
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function parse_(s) { try { return JSON.parse(s); } catch (e) { return null; } }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
