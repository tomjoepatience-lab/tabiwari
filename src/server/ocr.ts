import Anthropic from '@anthropic-ai/sdk';

// レシート画像を Gemini（プライマリ）または Claude(vision) に渡して「店名・日付・カテゴリ・明細」を構造化抽出する。
// Tesseract より日本語レシートの精度が高い。APIキーはサーバーのみが持つ。
//
// プロバイダ選択: 常に Gemini を優先。フォールバックするのは
//   ① GEMINI_API_KEY が未設定、または
//   ② Gemini 呼び出しが 429(quota) / 5xx / ネットワーク断で失敗したとき
// のみ。JSON不正など「内容のエラー」はフォールバックせずそのまま投げる（無駄なAPIコール防止）。

// OCR は抽出タスクなので低コストな Haiku で十分（Opus の約1/5）。
const CLAUDE_MODEL = 'claude-haiku-4-5';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export type Draft = { name: string; price: number };
export type OcrResult = { store_name: string; purchased_on: string; category: string; address: string; items: Draft[] };

const SYSTEM = '日本のレシート画像から購入した商品明細を正確に抽出するアシスタント。出力はJSONのみ。';

const USER_TEXT = [
  'このレシート画像から購入した商品の明細を抽出してください。',
  '次のJSONだけを出力してください（説明文やコードフェンスは不要）:',
  '{"store_name":"店名","purchased_on":"YYYY-MM-DD","category":"食費|交通|宿泊|観光|買い物|その他","address":"店舗住所","items":[{"name":"商品名","price":整数の円}]}',
  'ルール:',
  '- 合計・小計・税・お預り・お釣り・ポイント・支払い等の行は items に含めない（購入した商品のみ）。',
  '- price は円の整数（カンマや¥記号は除く）。',
  '- 日付が読めなければ purchased_on は空文字。',
  '- category は内容から最も近いものを1つ選ぶ。',
  '- address はレシートに印字された店舗の住所（都道府県〜番地）。読めなければ空文字。',
].join('\n');

// Gemini が「呼び出し自体」に失敗した（429/quota/5xx/ネットワーク断）ことを示すエラー。
// これだけが Claude フォールバックの対象（JSON不正などの内容エラーは通常の Error のまま投げる）。
class GeminiUnavailableError extends Error {}

let loggedProvider = false;
function logProviderOnce(provider: 'gemini' | 'claude', model: string) {
  if (loggedProvider) return;
  loggedProvider = true;
  console.log(`[ocr] provider: ${provider} (${model})`);
}

let loggedFallback = false;
function logFallbackOnce(reason: string) {
  if (loggedFallback) return;
  loggedFallback = true;
  console.log(`[ocr] fallback to claude (${reason})`);
}

export async function extractReceipt(dataUrl: string): Promise<OcrResult> {
  const m = dataUrl.match(/^data:image\/[a-zA-Z]+;base64,(.*)$/s);
  const data = m ? m[1] : dataUrl;

  if (!process.env.GEMINI_API_KEY) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('GEMINI_API_KEY または ANTHROPIC_API_KEY が未設定です（.env / Render の環境変数に設定してください）');
    }
    logFallbackOnce('GEMINI_API_KEY 未設定');
    logProviderOnce('claude', CLAUDE_MODEL);
    const text = await callClaude(data);
    return normalize(parseJson(text));
  }

  logProviderOnce('gemini', GEMINI_MODEL);
  try {
    const text = await callGemini(data);
    return normalize(parseJson(text)); // JSON不正等の内容エラーはここで投げる→フォールバックしない
  } catch (e) {
    if (e instanceof GeminiUnavailableError && process.env.ANTHROPIC_API_KEY) {
      logFallbackOnce(e.message);
      const text = await callClaude(data);
      return normalize(parseJson(text));
    }
    throw e;
  }
}

async function callClaude(data: string): Promise<string> {
  const res = await getClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
          { type: 'text', text: USER_TEXT },
        ],
      },
    ],
  });

  const textBlock = res.content.find((b) => b.type === 'text');
  return textBlock && 'text' in textBlock ? textBlock.text : '';
}

async function callGemini(data: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY as string;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const body = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data } },
          { text: USER_TEXT },
        ],
      },
    ],
    systemInstruction: { parts: [{ text: SYSTEM }] },
    generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 4096 },
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    // ネットワーク断・タイムアウト等（呼び出し自体が失敗）→ フォールバック対象
    throw new GeminiUnavailableError(`ネットワークエラー: ${(e as Error).message}`);
  }

  const json: any = await res.json().catch(() => ({}));

  if (!res.ok) {
    const detail = json?.error?.message ? `: ${json.error.message}` : '';
    const quota = res.status === 429 || /quota|resource_exhausted/i.test(json?.error?.status ?? json?.error?.message ?? '');
    if (quota || res.status >= 500) {
      throw new GeminiUnavailableError(`${res.status}${detail}`);
    }
    throw new Error(`Gemini APIエラー (${res.status})${detail}`);
  }

  const parts = json?.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('');
}

function parseJson(text: string): unknown {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '');
  const s = cleaned.indexOf('{');
  const e = cleaned.lastIndexOf('}');
  if (s === -1 || e === -1) throw new Error('レシートを読み取れませんでした');
  return JSON.parse(cleaned.slice(s, e + 1));
}

function normalize(raw: any): OcrResult {
  const items: Draft[] = Array.isArray(raw?.items)
    ? raw.items
        .map((it: any) => ({ name: String(it?.name ?? '').trim(), price: Math.round(Number(it?.price)) }))
        .filter((it: Draft) => it.name && Number.isFinite(it.price) && it.price > 0)
    : [];
  const date = String(raw?.purchased_on ?? '');
  return {
    store_name: String(raw?.store_name ?? ''),
    purchased_on: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
    category: String(raw?.category ?? ''),
    address: String(raw?.address ?? '').trim(),
    items,
  };
}
