// レシート画像をサーバーの /api/ocr に送り、Claude(vision) で抽出した明細を受け取る。
// （旧: ブラウザ内 Tesseract。精度向上のためサーバー経由の Claude vision に切替）

export type Draft = { name: string; price: number };
export type OcrResult = {
  store_name: string;
  purchased_on: string;
  category: string;
  items: Draft[];
};

export async function runOcr(dataUrl: string): Promise<OcrResult> {
  const res = await fetch('/api/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: dataUrl }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<OcrResult>;
}
