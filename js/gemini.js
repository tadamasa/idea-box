// Gemini API を端末から直接呼ぶ。APIキーは端末内(IndexedDB)にだけ保存する。
// 無料枠では入力がGoogleの製品改善に使われうるため、呼ぶのはユーザーがボタンを押したときだけ。

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
