import { send, settings, pageImage } from './send.js';

let image = '';

const $ = id => document.getElementById(id);

let tab0 = null;
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tab0 = tab || null;
  if (tab) {
    $('title').value = tab.title || '';
    $('url').value = tab.url || '';
    try {
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => String(getSelection()) });
      $('quote').value = (r && r.result || '').trim();
    } catch { /* chrome:// など、読めないページ */ }
    image = await pageImage(tab.id);
  }
  const s = await settings();
  $('hubUrl').value = s.hubUrl;
  $('token').value = s.token;
  $('appUrl').value = s.appUrl;
  if (!s.hubUrl) $('msg').textContent = 'ハブ未設定: 送ると idea-box のタブが開きます';
  $('text').focus();
}

$('send').addEventListener('click', async () => {
  const btn = $('send');
  btn.disabled = true;
  $('msg').textContent = '送っています…';
  try {
    const how = await send({
      title: $('title').value.trim(),
      url: $('url').value.trim(),
      quote: $('quote').value.trim(),
      // 送る前にURLを書き換えたら、そのページの画像ではなくなるので送らない
      image: $('url').value.trim() === (tab0 && tab0.url) ? image : '',
      text: $('text').value.trim(),
      tags: $('tags').value.split(/[\s,、]+/).map(t => t.replace(/^#+/, '')).filter(Boolean),
    });
    $('msg').textContent = how === 'hub' ? '送りました。次に idea-box を開いたときに受信箱に入ります。' : 'idea-box のタブで受信箱に入れました。';
    if (how === 'hub') setTimeout(() => window.close(), 1200);
  } catch (e) {
    $('msg').textContent = e.message;
    btn.disabled = false;
  }
});

$('saveSettings').addEventListener('click', async () => {
  await chrome.storage.local.set({ hubUrl: $('hubUrl').value.trim(), token: $('token').value.trim(), appUrl: $('appUrl').value.trim() });
  $('msg').textContent = '設定を保存しました';
});

init();
