// バックアップ: カードをJSONにして(写真の本体は含めない)、iPhoneの共有シート(「ファイル」に保存→iCloud Drive等)へ渡す。
import * as db from './db.js';

// キーと、端末ごとの同期の状態は書き出さない
const SECRET_KEYS = new Set(['geminiKey', 'syncUrl', 'syncToken', 'syncCursor', 'syncDirty', 'syncLastAt']);

export async function exportData() {
  const [cards, meta] = await Promise.all([db.getAll('cards'), db.getAll('meta')]);
  const payload = {
    app: 'idea-box',
    version: 1,
    exportedAt: new Date().toISOString(),
    cards,
    meta: meta.filter(m => !SECRET_KEYS.has(m.key)),
  };
  const name = `idea-box-${new Date().toISOString().slice(0, 10)}.json`;
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
    } catch (e) {
      if (e.name === 'AbortError') return false;
      throw e;
    }
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  await db.setMeta('lastBackupAt', new Date().toISOString());
  return true;
}

// 取り込み: idが同じものは updatedAt(なければ createdAt)が新しい方を残す
export async function importData(text) {
  const data = JSON.parse(text);
  if (data.app !== 'idea-box') throw new Error('このアプリのバックアップファイルではありません');
  const stamp = x => x.updatedAt || x.createdAt || '';
  let added = 0;
  for (const name of ['cards']) {
    const current = new Map((await db.getAll(name)).map(x => [x.id, x]));
    const toPut = (data[name] || []).filter(x => {
      const cur = current.get(x.id);
      return !cur || stamp(x) > stamp(cur);
    });
    added += toPut.length;
    await db.putMany(name, toPut);
  }
  return added;
}
