// 右クリックメニュー: 選んだ文・リンク・ページを、そのまま受信箱に送る
import { send } from './send.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'idea-box', title: 'idea-box に送る', contexts: ['page', 'selection', 'link'] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const capture = info.linkUrl
    ? { url: info.linkUrl, title: info.selectionText || '', quote: '' }
    : { url: info.pageUrl || (tab && tab.url) || '', title: (tab && tab.title) || '', quote: info.selectionText || '' };
  try {
    await send(capture);
    flash('✓', '#34c759');
  } catch {
    flash('!', '#ff3b30');
  }
});

function flash(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2500);
}
