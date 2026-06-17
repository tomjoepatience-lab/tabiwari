// Tesseract.js でレシート画像を読み取り、明細の「下書き」を作る。
// 完全自動は狙わない。抽出した {name, price} をフォームに流し込み、ユーザーが直す前提。

declare const Tesseract: any;

export type Draft = { name: string; price: number };

// 明細ではない行（合計・税・支払いなど）を弾くキーワード
const SKIP = /合計|小計|総|税|お預|預り|釣|つり|現金|クレジット|カード|ポイント|割引|値引|電話|TEL|領収|登録|番号|営業|店|レジ|担当|total|subtotal|tax|cash|change/i;

export function parseReceiptText(text: string): Draft[] {
  const drafts: Draft[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || SKIP.test(line)) continue;

    // 行末の金額（…¥1,200 / …298円 / …150）を明細価格とみなす。
    // 末尾固定にすることで日付（6月2日 等）を誤検出しない。
    const m = line.match(/([0-9][0-9,]*)\s*円?\s*$/);
    if (!m || m.index === undefined) continue;
    const price = parseInt(m[1].replace(/,/g, ''), 10);
    if (!Number.isFinite(price) || price < 1 || price > 1_000_000) continue;

    const name = line.slice(0, m.index).replace(/[¥￥*＊\-－—]/g, '').trim();
    if (!name) continue; // 金額だけの行は明細とみなさない

    drafts.push({ name, price });
  }
  return drafts;
}

export async function runOcr(file: File | string, onProgress?: (p: number) => void): Promise<Draft[]> {
  const { data } = await Tesseract.recognize(file, 'jpn+eng', {
    logger: (m: any) => {
      if (m.status === 'recognizing text' && onProgress) onProgress(m.progress);
    },
  });
  return parseReceiptText(data.text as string);
}
