// マネコのアドバイスエンジン（ルールベース）
// 直近の支出（明細キーワード×カテゴリ）から、気分・体型・セリフを決める。
// 方針: 叱らない。日用品・固定費・交通などの必需品には警告しない。あくまで提案。
import { RecentReceipt } from './api';
import { Mood, ReactionKind } from './character';

export type Insight = {
  mood: Mood;
  chubby: number;              // 0〜1（食べすぎで丸くなる）
  messages: string[];          // 吹き出しでローテーション表示
  tips: { icon: string; text: string; tone: 'warn' | 'ok' | 'info' }[];
  streak: number;              // 連続記録日数
  monthTotal: number;          // 今月の支出合計
  prevMonthTotal: number;
};

const RX = {
  ramen: /ラーメン|らーめん|らあめん|つけ麺|油そば|二郎|家系|中華そば/,
  drink: /居酒屋|ビール|酎ハイ|チューハイ|ハイボール|ワイン|日本酒|焼酎|飲み放題|飲み会|バー|スナック|レモンサワー|カクテル/,
  cafe: /カフェ|コーヒー|珈琲|スタバ|スターバックス|ドトール|タリーズ|ラテ|フラペ/,
  sweets: /ケーキ|スイーツ|チョコ|アイス|プリン|パフェ|クレープ|タピオカ|ドーナツ|和菓子|洋菓子|シュークリーム/,
  clothes: /服|Tシャツ|シャツ|パーカー|ニット|スカート|ズボン|パンツ|靴|スニーカー|帽子|コート|ジャケット|ユニクロ|GU|ZARA/,
  // 警告しないもの（消耗品・固定費・必需品）
  essential: /洗剤|ティッシュ|トイレットペーパー|シャンプー|歯磨|柔軟剤|マスク|電池|ゴミ袋|日用品|家賃|光熱|水道|ガス代|電気代|サブスク|定期券|薬|病院/,
};
const ESSENTIAL_CATEGORIES = new Set(['交通', '宿泊', '日用品']);

function receiptText(r: RecentReceipt): string {
  return [r.store_name ?? '', ...r.items.map((i) => i.name)].join(' ');
}

// 「最近の買い物」タップ時にマネコがどう反応するか
export function reactionFor(r: RecentReceipt): ReactionKind {
  const text = receiptText(r);
  if (RX.ramen.test(text)) return 'ramen';
  if (RX.drink.test(text)) return 'drink';
  if (RX.cafe.test(text)) return 'cafe';
  if (RX.sweets.test(text)) return 'sweets';
  if (RX.clothes.test(text)) return 'wear';
  if (r.category === '買い物' || r.category === '食費') return 'shopping'; // スーパー等のまとめ買いは買い物袋
  return 'generic';
}

function ym(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function analyzeSpending(receipts: RecentReceipt[], now = new Date()): Insight {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days30 = new Date(today); days30.setDate(days30.getDate() - 30);
  const thisMonth = ym(now);
  const prevMonth = ym(new Date(now.getFullYear(), now.getMonth() - 1, 1));

  let monthTotal = 0, prevMonthTotal = 0;
  let ramen = 0, drink = 0, cafe = 0, sweets = 0;
  let foodTotal = 0, spendTotal = 0;
  const recordedDays = new Set<string>();

  for (const r of receipts) {
    const day = r.purchased_on.slice(0, 10);
    recordedDays.add(day);
    if (day.startsWith(thisMonth)) monthTotal += r.total;
    if (day.startsWith(prevMonth)) prevMonthTotal += r.total;

    const d = new Date(day);
    if (d < days30) continue; // 嗜好の分析は直近30日だけ
    const text = receiptText(r);
    const isEssential = RX.essential.test(text) || ESSENTIAL_CATEGORIES.has(r.category ?? '');
    spendTotal += r.total;
    if (r.category === '食費') foodTotal += r.total;
    if (isEssential) continue; // 必需品は数えない＝警告しない
    if (RX.ramen.test(text)) ramen++;
    if (RX.drink.test(text)) drink++;
    if (RX.cafe.test(text)) cafe++;
    if (RX.sweets.test(text)) sweets++;
  }

  // 連続記録日数（今日 or 昨日から遡る）
  let streak = 0;
  const cur = new Date(today);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (!recordedDays.has(iso(cur))) cur.setDate(cur.getDate() - 1); // 今日まだ記録がなくても昨日から数える
  while (recordedDays.has(iso(cur))) { streak++; cur.setDate(cur.getDate() - 1); }

  // 体型: ラーメン・スイーツ・食費比率で丸くなる
  const foodRatio = spendTotal > 0 ? foodTotal / spendTotal : 0;
  const chubby = Math.max(0, Math.min(1, ramen * 0.13 + sweets * 0.07 + Math.max(0, foodRatio - 0.45) * 0.8));

  const messages: string[] = [];
  const tips: Insight['tips'] = [];
  let mood: Mood = 'normal';

  // --- 気づかい系（警告ではなくアドバイス） ---
  if (ramen >= 4) {
    mood = 'worried';
    messages.push(`今月ラーメン${ramen}回目だにゃ…最近ちょっと丸くなってきた気がする。来週は2回までにしてみない?`);
    tips.push({ icon: '🍜', text: `ラーメン${ramen}回/30日。頻度をすこし下げてみよう`, tone: 'warn' });
  } else if (ramen === 3) {
    messages.push('ラーメン、今月3回目にゃ。おいしいよね…でもほどほどにしとこ?');
    tips.push({ icon: '🍜', text: 'ラーメン3回/30日。いまのところセーフ', tone: 'info' });
  }
  if (drink >= 3) {
    if (mood === 'normal') mood = 'tired';
    messages.push(`飲み会つづきで肝臓がきついにゃ〜…${drink}回はがんばりすぎ。次の週末はおうちでゆっくりしよ?`);
    tips.push({ icon: '🍺', text: `飲み${drink}回/30日。休肝日をつくろう`, tone: 'warn' });
  }
  if (cafe >= 8) {
    messages.push(`カフェ${cafe}回…！おうちコーヒーにしたら月にけっこう浮くにゃ。たまにはお家カフェどう?`);
    tips.push({ icon: '☕', text: `カフェ${cafe}回/30日。おうちコーヒーも検討`, tone: 'info' });
  }
  if (sweets >= 5) {
    messages.push(`あまいもの${sweets}回目だにゃ。ボク、ほっぺがまんまるになってきた…！`);
    tips.push({ icon: '🍰', text: `スイーツ${sweets}回/30日`, tone: 'info' });
  }

  // --- ほめ系 ---
  const hasWarning = tips.some((t) => t.tone === 'warn');
  if (!hasWarning) {
    if (mood === 'normal') mood = 'happy';
    messages.push('いまのところ、いい感じの使い方だにゃ！この調子この調子♪');
  }
  if (streak >= 3) {
    if (!hasWarning) mood = 'excited';
    messages.push(`${streak}日連続で記録してるにゃ！えらすぎる…！`);
    tips.push({ icon: '🔥', text: `${streak}日連続で記録中`, tone: 'ok' });
  }
  if (prevMonthTotal > 0 && monthTotal < prevMonthTotal * 0.8 && now.getDate() >= 20) {
    messages.push('今月は先月よりだいぶ節約できてるにゃ。ごほうびに新しい服…はまだ早い?');
    tips.push({ icon: '✨', text: '先月より節約ペース', tone: 'ok' });
  }

  // --- あいさつ ---
  const h = now.getHours();
  const greet = h < 5 ? '夜ふかしさんにゃ…ボクはもう眠い…' :
    h < 11 ? 'おはようにゃ！今日もいっしょにがんばろ' :
    h < 17 ? 'おつかれさま！今日は何かいいことあった?' :
    '今日もおつかれさまだにゃ〜';
  messages.unshift(greet);

  if (!receipts.length) {
    messages.push('まだ記録がないにゃ。最初のレシートを登録してみて！');
  }

  return { mood, chubby, messages, tips, streak, monthTotal, prevMonthTotal };
}

// タップしたときのランダムなひとこと
const TAP_LINES = [
  'にゃっ!? びっくりした〜',
  'なでてくれるの? えへへ',
  'おこづかい…はいらないにゃ。記録がごほうびだから',
  'きょうも記録してくれてありがとにゃ',
  'まるいのは…毛がふわふわなだけだにゃ！',
  'いっしょにお金じょうずになろうね',
];
export function randomTapLine(): string {
  return TAP_LINES[Math.floor(Math.random() * TAP_LINES.length)];
}
