// 送り先: アイデアハブ(設定済みなら)へ直接。未設定なら idea-box を新しいタブで開いて渡す。
export const DEFAULT_APP = 'https://tadamasa.github.io/idea-box/';

export async function settings() {
  const s = await chrome.storage.local.get(['hubUrl', 'token', 'appUrl']);
  return { hubUrl: s.hubUrl || '', token: s.token || '', appUrl: s.appUrl || DEFAULT_APP };
}

export async function send(capture) {
  const s = await settings();
  if (s.hubUrl && s.token) {
    const res = await fetch(s.hubUrl, {
      method: 'POST',
      // text/plain にすると事前確認(CORS preflight)が要らず、Apps Scriptで受けられる
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: s.token, capture: { ...capture, source: 'chrome' } }),
      redirect: 'follow',
    });
    let data;
    try { data = await res.json(); } catch { throw new Error('ハブの応答を読めませんでした(URLと公開範囲を確かめてください)'); }
    if (!data.ok) throw new Error(data.error === 'unauthorized' ? '合言葉が違います' : `ハブ: ${data.error}`);
    return 'hub';
  }
  const u = new URL(s.appUrl);
  u.searchParams.set('capture', '1');
  for (const k of ['text', 'url', 'title', 'quote', 'tags']) if (capture[k]) u.searchParams.set(k, Array.isArray(capture[k]) ? capture[k].join(',') : capture[k]);
  await chrome.tabs.create({ url: u.href });
  return 'tab';
}
