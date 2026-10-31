// Gemini API を端末から直接呼ぶ。APIキーは端末内(IndexedDB)にだけ保存する。
// 無料枠では入力がGoogleの製品改善に使われうるため、呼ぶのはユーザーがボタンを押したときだけ。

import { parseSteps } from './core.js';

export const DEFAULT_MODEL = 'gemini-3.8-flash';

const OCR_PROMPT = 'この写真に写っている文字を、改行も含めてそのまま書き起こしてください。' +
  '1行目には「何の写真か」を20字以内の見出しで書き、2行目は空け、3行目から書き起こしを続けます。' +
  '読めない部分は「…」とします。説明や前置きは不要です。';

// 写真(Blob)から文字を読み取る。返り値: { title, text }
export async function readText({ apiKey, model = DEFAULT_MODEL, blob }) {
  if (!apiKey) throw new Error('設定でGemini APIキーを入れてください');
  const data = await toBase64(blob);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ inline_data: { mime_type: blob.type || 'image/jpeg', data } }, { text: OCR_PROMPT }] }],
      generationConfig: { temperature: 0 },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Geminiの呼び出しに失敗しました: ${json.error ? json.error.message : res.statusText}`);
  const parts = (((json.candidates || [])[0] || {}).content || {}).parts || [];
  return splitOcr(parts.map(p => p.text || '').join('').trim());
}

// プロジェクトの手順案を出す。送るのはプロジェクト名・ゴール・期日・今ある手順・つないだ情報の見出しだけ。
// 返り値: 手順の文の配列(今ある手順と重なるものは除く)
export async function suggestSteps({ apiKey, model = DEFAULT_MODEL, project, steps = [], related = [] }) {
  if (!apiKey) throw new Error('設定でGemini APIキーを入れてください');
  const prompt = [
    'あなたは個人のプロジェクトの段取りを手伝います。次のプロジェクトのゴールに向けて、具体的な手順の候補を5〜8個出してください。',
    '・1つは30字程度までの「動詞で終わる」文にする(例:「近隣の相場を3社分調べる」)。',
    '・今ある手順と重ならないものだけ。順番に意味があれば、その順に並べる。',
    '・見落としやすい手続きや、先にやると後が楽になることがあれば含める。',
    '・説明や前置きは書かず、JSON の文字列配列だけを返す。',
    '',
    `プロジェクト: ${project.title}`,
    project.goal ? `ゴール: ${project.goal}` : '',
    project.due ? `期日: ${project.due}` : '',
    project.body ? `メモ: ${String(project.body).slice(0, 1500)}` : '',
    steps.length ? `今ある手順:\n${steps.map(s => `- ${s}`).join('\n')}` : '今ある手順: なし',
    related.length ? `つないだ情報の見出し:\n${related.slice(0, 30).map(s => `- ${s}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, responseMimeType: 'application/json' },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Geminiの呼び出しに失敗しました: ${json.error ? json.error.message : res.statusText}`);
  const parts = (((json.candidates || [])[0] || {}).content || {}).parts || [];
  return parseSteps(parts.map(p => p.text || '').join(''), steps);
}

export function splitOcr(out) {
  const lines = String(out || '').split('\n');
  const title = (lines.shift() || '').replace(/^#+\s*/, '').trim();
  return { title, text: lines.join('\n').trim() };
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
