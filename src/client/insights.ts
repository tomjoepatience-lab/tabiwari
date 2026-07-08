// マネコ分析係: 「放置しがちだけど実は大切」な月次インサイトを生成する
// おとなホームの吹き出しでローテーション表示＋月初の先月サマリーに使う。
import { Overview, RecentReceipt } from './api';
import { yen } from './ui';

const pad = (n: number) => String(n).padStart(2, '0');
const ymOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

type GenreTotal = { genre: string; total: number };

function genreTotals(receipts: RecentReceipt[], ym: string): GenreTotal[] {
  const map = new Map<string, number>();
  for (const r of receipts) {
    if (!r.purchased_on.startsWith(ym)) continue;
    for (const it of r.items) {
      const g = it.genre ?? 'その他';
      map.set(g, (map.get(g) ?? 0) + it.price);
    }
  }
  return [...map.entries()].map(([genre, total]) => ({ genre, total })).sort((a, b) => b.total - a.total);
}

function monthTotal(receipts: RecentReceipt[], ym: string): number {
  return receipts.filter((r) => r.purchased_on.startsWith(ym)).reduce((s, r) => s + r.total, 0);
}

// ---- ホームの吹き出し用インサイト（優先度順に生成→ローテーション） ------
export function monthlyInsights(recent: RecentReceipt[], o: Overview, now = new Date()): string[] {
  const out: string[] = [];
  const thisYm = ymOf(now);
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevYm = ymOf(prev);
  const spend = monthTotal(recent, thisYm);
  const genres = genreTotals(recent, thisYm);
  const budget = o.settings?.monthly_budget ?? null;

  // 1) 予算ペース（いちばん大切）
  if (budget && budget > 0) {
    const daysIn = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const expected = budget * (now.getDate() / daysIn);
    if (spend > budget) out.push(`予算を${yen(spend - budget)}超えています…来月に向けて立て直しましょう`);
    else if (spend > expected * 1.2) out.push(`ペース注意: このままだと月末に約${yen(Math.round((spend / now.getDate()) * daysIn))}になりそう`);
    else if (now.getDate() >= 10) out.push(`予算内ペース、いい調子! あと${yen(budget - spend)}使えます`);
  }

  // 2) 前月同時期との比較（気づきにくい増加を知らせる）
  const prevSameSpan = recent
    .filter((r) => r.purchased_on.startsWith(prevYm) && Number(r.purchased_on.slice(8, 10)) <= now.getDate())
    .reduce((s, r) => s + r.total, 0);
  if (prevSameSpan > 0 && spend > prevSameSpan * 1.25) {
    out.push(`先月の同じ時期より${Math.round((spend / prevSameSpan - 1) * 100)}%多めです（${yen(spend)}）`);
  } else if (prevSameSpan > 0 && spend < prevSameSpan * 0.8 && now.getDate() >= 7) {
    out.push(`先月の同じ時期より${Math.round((1 - spend / prevSameSpan) * 100)}%節約中。えらい!`);
  }

  // 3) 今月のトップジャンル
  if (genres[0] && spend > 0) {
    const g = genres[0];
    out.push(`今月は「${g.genre}」が最多: ${yen(g.total)}（全体の${Math.round((g.total / spend) * 100)}%）`);
  }

  // 4) 嗜好品の割合（放置しがちな出費）
  const sikou = genres.find((g) => g.genre === '嗜好品');
  if (sikou && spend > 0 && sikou.total / spend >= 0.15) {
    out.push(`嗜好品が${yen(sikou.total)}（${Math.round((sikou.total / spend) * 100)}%）。ちりつもに注意`);
  }

  // 5) 同じ店に通いすぎ（習慣コストの見える化）
  const storeCount = new Map<string, { n: number; total: number }>();
  for (const r of recent) {
    if (!r.purchased_on.startsWith(thisYm) || !r.store_name) continue;
    const e = storeCount.get(r.store_name) ?? { n: 0, total: 0 };
    e.n++; e.total += r.total;
    storeCount.set(r.store_name, e);
  }
  const habitual = [...storeCount.entries()].filter(([, v]) => v.n >= 4).sort((a, b) => b[1].total - a[1].total)[0];
  if (habitual) out.push(`「${habitual[0]}」に今月${habitual[1].n}回、計${yen(habitual[1].total)}。習慣コストになっています`);

  // 6) いちばん大きな買い物
  const biggest = recent.filter((r) => r.purchased_on.startsWith(thisYm)).sort((a, b) => b.total - a.total)[0];
  if (biggest && biggest.total >= 5000) {
    out.push(`今月最大の買い物: ${biggest.store_name || biggest.items[0]?.name || ''} ${yen(biggest.total)}`);
  }

  // 7) 記録の空白（つけ忘れ防止）。recent は購入日順なので、記録した日時の最大値で見る
  const ts = recent.map((r) => Date.parse(r.created_at)).filter(Number.isFinite);
  if (ts.length) {
    const gap = Math.floor((now.getTime() - Math.max(...ts)) / 86400000);
    if (gap >= 3) out.push(`${gap}日記録がありません。レシート、たまっていませんか?`);
  }

  if (!out.length) out.push('今日も記録していこう');
  return out;
}

// ---- 期限つき目標: 「毎月あと¥Xずつで間に合う」の計算 --------------------
export type PaceInfo = { months: number; perMonth: number; overdue: boolean };
export function monthlyNeeded(
  g: { target: number; saved: number; done?: boolean; deadline: string | null },
  now = new Date()
): PaceInfo | null {
  if (!g.deadline || g.done || g.saved >= g.target) return null;
  const dl = new Date(g.deadline + 'T00:00:00');
  if (Number.isNaN(dl.getTime())) return null;
  // 今月を1ヶ月目として期限月まで数える（期限が過去なら「今月中に」扱い＝毎月額は残額そのまま）
  const raw = (dl.getFullYear() - now.getFullYear()) * 12 + (dl.getMonth() - now.getMonth()) + 1;
  const months = Math.max(1, raw);
  // overdue は「日単位」で判定する。月粒度だと当月内のすでに過ぎた日付を
  // 「まだ間に合う」と表示してしまうため（例: 今日7/8・期限7/1）。期限当日はまだセーフ。
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return { months, perMonth: Math.ceil((g.target - g.saved) / months), overdue: dl.getTime() < today.getTime() };
}

// ---- 月初の先月サマリー -------------------------------------------------
export type MonthSummary = {
  ym: string;            // 対象月（先月）YYYY-MM
  label: string;         // 「6月」など
  total: number;
  prevTotal: number;     // 先々月
  topGenres: GenreTotal[];
  biggest: RecentReceipt | null;
  recordDays: number;
  comment: string;       // マネコのひとこと
};

export function lastMonthSummary(recent: RecentReceipt[], o: Overview, now = new Date()): MonthSummary | null {
  const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const ym = ymOf(last);
  const prev2 = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const total = monthTotal(recent, ym);
  if (total <= 0) return null; // 先月の記録がなければ出さない
  const prevTotal = monthTotal(recent, ymOf(prev2));
  const topGenres = genreTotals(recent, ym).slice(0, 3);
  const biggest = recent.filter((r) => r.purchased_on.startsWith(ym)).sort((a, b) => b.total - a.total)[0] ?? null;
  const recordDays = new Set(recent.filter((r) => r.purchased_on.startsWith(ym)).map((r) => r.purchased_on.slice(0, 10))).size;

  const budget = o.settings?.monthly_budget ?? null;
  let comment: string;
  if (budget && total <= budget) comment = `予算内で着地! ${yen(budget - total)}のこしました。この調子です`;
  else if (budget) comment = `予算を${yen(total - budget)}オーバー。今月は「${topGenres[0]?.genre ?? '支出'}」を少し意識してみましょう`;
  else if (prevTotal > 0 && total < prevTotal) comment = `前の月より${yen(prevTotal - total)}節約できました`;
  else comment = `今月も一緒にコツコツ記録していきましょう`;

  return { ym, label: `${last.getMonth() + 1}月`, total, prevTotal, topGenres, biggest, recordDays, comment };
}
