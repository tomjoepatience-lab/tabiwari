import Anthropic from '@anthropic-ai/sdk';

// レシート画像を Claude(vision) に渡して「店名・日付・カテゴリ・明細」を構造化抽出する。
// Tesseract より日本語レシートの精度が高い。APIキーはサーバーのみが持つ。

// OCR は抽出タスクなので低コストな Haiku で十分（Opus の約1/5）。
// 精度が足りなければ 'claude-sonnet-4-6'（中間）や 'claude-opus-4-8'（最上位）に上げる。
const MODEL = 'claude-haiku-4-5';

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY が未設定です（.env / Render の環境変数に設定してください）');
  }
  if (!client) client = new Anthropic();
  return client;
}

export type Draft = { name: string; price: number };
export type OcrResult = { store_name: string; purchased_on: string; category: string; items: Draft[] };

const SYSTEM = '日本のレシート画像から購入した商品明細を正確に抽出するアシスタント。出力はJSONのみ。';

const USER_TEXT = [
  'このレシート画像から購入した商品の明細を抽出してください。',
  '次のJSONだけを出力してください（説明文やコードフェンスは不要）:',
  '{"store_name":"店名","purchased_on":"YYYY-MM-DD","category":"食費|交通|宿泊|観光|買い物|その他","items":[{"name":"商品名","price":整数の円}]}',
  'ルール:',
  '- 合計・小計・税・お預り・お釣り・ポイント・支払い等の行は items に含めない（購入した商品のみ）。',
  '- price は円の整数（カンマや¥記号は除く）。',
  '- 日付が読めなければ purchased_on は空文字。',
  '- category は内容から最も近いものを1つ選ぶ。',
].join('\n');

export async function extractReceipt(dataUrl: string): Promise<OcrResult> {
  const m = dataUrl.match(/^data:image\/[a-zA-Z]+;base64,(.*)$/s);
  const data = m ? m[1] : dataUrl;

  const res = await getClient().messages.create({
    model: MODEL,
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
  const text = textBlock && 'text' in textBlock ? textBlock.text : '';
  return normalize(parseJson(text));
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
    items,
  };
}
