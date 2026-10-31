// npm test で実行。画面に触れない処理と、アイデアハブ(Code.gs)の動きを確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectKind, parseCapture, newCard, normTag, tagId, displayTitle, matches, nearCards, relatedTags, sortActions, isOverdue, isInfo, forActionList, linkedIds, projectSteps, nextOrder, newStep, newProject, stepProgress, parseSteps } from '../js/core.js';
import { splitOcr } from '../js/gemini.js';
import { loadHub } from './gas-mock.mjs';

test('種類を入力から推し量る', () => {
  assert.equal(detectKind({ text: 'ふと思った' }), 'memo');
  assert.equal(detectKind({ text: '見て https://example.com/a' }), 'url');
  assert.equal(detectKind({ url: 'https://youtu.be/abc' }), 'video');
  assert.equal(detectKind({ text: '「知は力なり」ベーコン' }), 'quote');
  assert.equal(detectKind({ text: 'x', kind: 'photo' }), 'photo');
  assert.equal(detectKind({ text: 'x', kind: 'tag' }), 'memo'); // タグは入力からは作らない
});

test('共有のURLパラメータを受け取る', () => {
  const c = parseCapture('?capture=1&text=%E3%83%A1%E3%83%A2&url=https%3A%2F%2Fa.jp&tags=%23%E3%83%96%E3%83%AD%E3%82%B0,%EF%BC%A1%EF%BC%A9');
  assert.deepEqual(c, { text: 'メモ', url: 'https://a.jp', title: '', quote: '', kind: '', tags: ['ブログ', 'ai'] });
  assert.equal(parseCapture('?x=1'), null);
  assert.equal(parseCapture('?capture=1'), null);
});

test('URLだけの入力は本文を空にしてURL欄に入れる', () => {
  const c = newCard({ id: '1', text: 'https://example.com/x', now: '2026-10-31T00:00:00Z' });
  assert.equal(c.body, '');
  assert.equal(c.url, 'https://example.com/x');
  assert.equal(c.kind, 'url');
  assert.equal(c.inbox, true);
  assert.equal(displayTitle(c), 'example.com/x');
});

test('タグ名の表記ゆれをそろえる', () => {
  assert.equal(normTag('#ＡＩ  活用'), 'ai 活用');
  assert.equal(normTag('ブログ'), normTag('#ブログ '));
});

test('タグのidは名前から決まり、表記ゆれでも同じになる', () => {
  assert.equal(tagId('#ＡＩ'), tagId('ai'));
  assert.notEqual(tagId('京都'), tagId('大阪'));
  assert.match(tagId('京都'), /^t-[0-9a-z]+$/);
});

test('検索は語とタグ名の両方で当たる', () => {
  const names = new Map([['t1', 'ブログ']]);
  const c = { title: '睡眠の質', body: '昼寝15分', tags: ['t1'] };
  assert.ok(matches(c, '昼寝 睡眠', names));
  assert.ok(matches(c, '#ブログ', names));
  assert.ok(!matches(c, '料理', names));
});

test('近いカードは共有タグが多い順、言葉が似ていれば共有タグなしでも出る', () => {
  const target = { id: 'a', title: '', body: '昼寝は午後の集中力を上げる', tags: ['t1', 't2'] };
  const cards = [
    target,
    { id: 'b', body: '関係ない', tags: ['t1'], updatedAt: '2' },
    { id: 'c', body: '別の話', tags: ['t1', 't2'], updatedAt: '1' },
    { id: 'd', body: '午後の昼寝で集中力が戻る', tags: [], updatedAt: '3' },
    { id: 'e', body: '料理', tags: [] },
    { id: 't1', kind: 'tag', title: 'x', tags: [] },
  ];
  const ids = nearCards(cards, target).map(n => n.card.id);
  assert.equal(ids[0], 'c');
  assert.ok(ids.includes('b') && ids.includes('d'));
  assert.ok(!ids.includes('e') && !ids.includes('t1'));
});

test('一緒に付くタグを数える', () => {
  const cards = [{ tags: ['a', 'b'] }, { tags: ['a', 'b', 'c'] }, { tags: ['b', 'c'] }, { tags: ['a'], deleted: true }];
  assert.deepEqual(relatedTags(cards, 'a'), [{ tagId: 'b', count: 2 }, { tagId: 'c', count: 1 }]);
});

test('アクションは期限の近い順、期限なしは後ろ、完了は別に並ぶ', () => {
  const cards = [
    { id: '1', action: { text: 'x', due: null, done: false }, updatedAt: '2' },
    { id: '2', action: { text: 'y', due: '2026-11-03', done: false } },
    { id: '3', action: { text: 'z', due: '2026-11-01', done: false } },
    { id: '4', action: { text: 'w', done: true, doneAt: '2026-10-30' } },
    { id: '5', action: null },
  ];
  const { open, done } = sortActions(cards);
  assert.deepEqual(open.map(c => c.id), ['3', '2', '1']);
  assert.deepEqual(done.map(c => c.id), ['4']);
  assert.ok(isOverdue({ due: '2026-10-30', done: false }, '2026-10-31'));
  assert.ok(!isOverdue({ due: '2026-10-30', done: true }, '2026-10-31'));
});

test('プロジェクトと手順は情報の一覧に混ざらず、入力からも作られない', () => {
  assert.equal(detectKind({ text: 'x', kind: 'project' }), 'memo');
  assert.ok(isInfo({ kind: 'memo' }));
  assert.ok(!isInfo({ kind: 'project' }) && !isInfo({ kind: 'step' }) && !isInfo({ kind: 'tag' }) && !isInfo({ kind: 'memo', deleted: true }));
});

test('つながりは片方に書くだけで、両方向から見える', () => {
  const cards = [
    { id: 'p1', kind: 'project', links: ['p2'] },
    { id: 'p2', kind: 'project', links: [] },
    { id: 'm', kind: 'memo', links: ['p1'] },
    { id: 'x', kind: 'memo', links: ['p1'], deleted: true },
  ];
  assert.deepEqual(linkedIds(cards, 'p1').sort(), ['m', 'p2']);
  assert.deepEqual(linkedIds(cards, 'p2'), ['p1']);
});

test('手順は order 順に並び、移すと移した先の最後に付く', () => {
  const s1 = newStep({ id: 's1', projectId: 'p1', text: ' 相場を調べる ', order: 2, now: 'a' });
  const s2 = newStep({ id: 's2', projectId: 'p1', text: '試乗する', order: 1, now: 'b' });
  const s3 = newStep({ id: 's3', projectId: 'p2', text: '見積もり', order: 1, now: 'c' });
  const cards = [s1, s2, s3];
  assert.equal(s1.title, '相場を調べる');
  assert.equal(s1.action.text, '相場を調べる');
  assert.deepEqual(projectSteps(cards, 'p1').map(s => s.id), ['s2', 's1']);
  s1.project = 'p2'; s1.order = nextOrder(projectSteps(cards, 'p2'));
  assert.deepEqual(projectSteps(cards, 'p2').map(s => s.id), ['s3', 's1']);
  assert.equal(nextOrder([]), 1);
  s3.action.done = true;
  assert.deepEqual(stepProgress(projectSteps(cards, 'p2')), { done: 1, all: 2 });
});

test('アクション画面には、単発のアクションと期限付きの手順だけが出る', () => {
  const cards = [
    { id: 'a', kind: 'memo', action: { text: 'x', due: null, done: false } },
    newStep({ id: 'b', projectId: 'p', text: '期限なし', order: 1 }),
    { ...newStep({ id: 'c', projectId: 'p', text: '期限あり', order: 2 }), action: { text: '期限あり', due: '2026-11-05', done: false } },
    { id: 'd', kind: 'memo', action: null },
  ];
  assert.deepEqual(forActionList(cards).map(c => c.id), ['a', 'c']);
});

test('新しいプロジェクトは進行中で、手順案は重なりを除いてそろえる', () => {
  const p = newProject({ id: 'p', title: ' 車を買い替える ', goal: '来春までに納車' });
  assert.equal(p.title, '車を買い替える');
  assert.equal(p.status, 'active');
  assert.deepEqual(parseSteps('["予算を決める","試乗する","予算を決める"]', ['試乗する']), ['予算を決める']);
  assert.deepEqual(parseSteps('```json\n{"steps":[{"text":"下取りを査定する"}]}\n```'), ['下取りを査定する']);
  assert.deepEqual(parseSteps('1. 書類をそろえる\n・転出届を出す'), ['書類をそろえる', '転出届を出す']);
});

test('写真の読み取り結果を見出しと本文に分ける', () => {
  assert.deepEqual(splitOcr('# 駅前のパン屋の営業時間\n\n営業 7:00-18:00\n定休日 水曜'), { title: '駅前のパン屋の営業時間', text: '営業 7:00-18:00\n定休日 水曜' });
});

test('ハブ: 送ったカードが別の端末に届き、古い書き込みは負ける', () => {
  const hub = loadHub();
  const card = { id: 'c1', kind: 'memo', title: '', body: 'メモ', tags: ['t1'], inbox: true, action: { text: '試す', due: '2026-11-01', done: false } };
  const tag = { id: 't1', kind: 'tag', title: 'ブログ', tags: [] };
  const r1 = hub.post({ token: hub.token, since: 0, cards: [{ id: 'c1', mtime: 10, data: card }, { id: 't1', mtime: 10, data: tag }] });
  assert.equal(r1.ok, true);
  const row = hub.sheets.get('cards').rows[1];
  assert.equal(row[6], 'ブログ'); // tags 列にタグ名
  assert.equal(row[8], '試す');
  // 別の端末は 0 から読むと2件届く
  const r2 = hub.post({ token: hub.token, since: 0, cards: [] });
  assert.equal(r2.cards.length, 2);
  // 古い mtime の書き込みは無視される
  hub.post({ token: hub.token, since: r2.rev, cards: [{ id: 'c1', mtime: 5, data: { ...card, body: '古い' } }] });
  const r3 = hub.post({ token: hub.token, since: 0, cards: [] });
  assert.equal(r3.cards.find(c => c.id === 'c1').data.body, 'メモ');
  // 削除は墓標で伝わる
  hub.post({ token: hub.token, since: 0, cards: [{ id: 'c1', mtime: 20, deleted: true }] });
  const r4 = hub.post({ token: hub.token, since: r3.rev, cards: [] });
  assert.deepEqual(r4.cards.map(c => [c.id, c.deleted]), [['c1', true]]);
});

test('ハブ: タイトルのないURLは、ページの見出し・Xのポスト・YouTubeの題名を本文に入れる', () => {
  const calls = [];
  const hub = loadHub({ fetch: url => {
    calls.push(url);
    if (url.startsWith('https://publish.twitter.com/oembed')) return { body: JSON.stringify({ author_name: '山田', html: '<blockquote class="twitter-tweet"><p lang="ja" dir="ltr">朝の散歩で&quot;発見&quot;<br>がある <a href="https://t.co/x">#散歩</a></p>&mdash; 山田 (@yamada) <a href="#">2026</a></blockquote>' }) };
    if (url.startsWith('https://www.youtube.com/oembed')) return { body: JSON.stringify({ title: '3Dプリンタ入門', author_name: 'ものづくりch' }) };
    if (url === 'https://example.com/a') return { body: '<html><head><meta property="og:title" content="関係性のデザイン &amp; 実践"><title>x</title></head></html>' };
    if (url === 'https://example.com/b') return { body: '<title>\n  ただのタイトル  </title>' };
    return { code: 404 };
  } });
  const get = id => hub.post({ token: hub.token, since: 0, cards: [] }).cards.find(c => c.id === id).data;
  // ショートカットは「URL + 改行 + 一言」を text で送る
  const a = get(hub.post({ token: hub.token, capture: { text: 'https://example.com/a\nあとで読む' } }).id);
  assert.equal(a.url, 'https://example.com/a');
  assert.equal(a.body, '関係性のデザイン & 実践\n\nあとで読む');
  assert.equal(get(hub.post({ token: hub.token, capture: { url: 'https://example.com/b' } }).id).body, 'ただのタイトル');
  const x = get(hub.post({ token: hub.token, capture: { text: 'https://x.com/yamada/status/123?s=20' } }).id);
  assert.equal(x.body, '朝の散歩で"発見"\nがある #散歩\n— 山田');
  assert.ok(calls.some(u => u.includes(encodeURIComponent('https://twitter.com/yamada/status/123'))));
  const yt = get(hub.post({ token: hub.token, capture: { url: 'https://youtu.be/abc' } }).id);
  assert.equal(yt.body, '3Dプリンタ入門\n— ものづくりch');
  // タイトルが来ていれば(Chrome拡張)取りに行かない。取れなくても受け取りは成功する
  const n = calls.length;
  hub.post({ token: hub.token, capture: { url: 'https://example.com/a', title: '拡張から' } });
  assert.equal(calls.length, n);
  assert.equal(get(hub.post({ token: hub.token, capture: { url: 'https://example.com/404' } }).id).body, '');
});

test('ハブ: 外に出られなくても受け取りは成功する', () => {
  const hub = loadHub();
  const r = hub.post({ token: hub.token, capture: { text: 'https://example.com/z メモ' } });
  assert.equal(r.ok, true);
  assert.equal(hub.post({ token: hub.token, since: 0, cards: [] }).cards[0].data.body, 'メモ');
});

test('ハブ: 合言葉が違えば断る', () => {
  const hub = loadHub();
  assert.equal(hub.post({ token: 'x', since: 0 }).error, 'unauthorized');
});

test('ハブ: ショートカット・拡張からの capture でカードが1枚でき、タグ名は pendingTags に入る', () => {
  const hub = loadHub();
  const r = hub.post({ token: hub.token, capture: { text: '看板の文字', kind: 'photo', tags: '#京都 散歩', source: 'ios-shortcut' } });
  assert.equal(r.ok, true);
  assert.ok(r.id);
  const got = hub.post({ token: hub.token, since: 0, cards: [] }).cards;
  assert.equal(got.length, 1);
  assert.equal(got[0].data.kind, 'photo');
  assert.equal(got[0].data.inbox, true);
  assert.deepEqual(got[0].data.pendingTags, ['京都', '散歩']);
  const yt = hub.post({ token: hub.token, capture: { url: 'https://www.youtube.com/watch?v=1', title: '動画' } });
  const v = hub.post({ token: hub.token, since: 0, cards: [] }).cards.find(c => c.id === yt.id);
  assert.equal(v.data.kind, 'video');
  assert.equal(hub.post({ token: hub.token, capture: { text: ' ' } }).error, 'empty');
});
