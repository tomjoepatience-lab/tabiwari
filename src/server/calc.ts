// 割り勘の集計・精算ロジック（DB に依存しない純粋関数。テストしやすい）

// share.weight が null のときは members.weight を継承（明細ごとのオーバーライドが優先）
export type CalcShare = { memberId: number; weight: number | null };
export type CalcItem = { price: number; shares: CalcShare[] };
export type CalcReceipt = { paidBy: number | null; items: CalcItem[] };
export type CalcMember = { id: number; weight: number };

export type PerMember = { memberId: number; paid: number; owed: number; net: number };
export type Transfer = { from: number; to: number; amount: number };
export type Summary = { total: number; perMember: PerMember[]; settlement: Transfer[] };

// 各メンバーの「払った額(paid)」「負担すべき額(owed)」「収支(net=paid-owed)」と精算案を返す。
// 負担は各メンバーの比重(weight)で按分する（全員1なら等分）。
export function summarize(members: CalcMember[], receipts: CalcReceipt[]): Summary {
  const memberIds = members.map((m) => m.id);
  const weightOf = new Map(members.map((m) => [m.id, m.weight > 0 ? m.weight : 1]));
  const paid = new Map<number, number>();
  const owed = new Map<number, number>();
  for (const id of memberIds) {
    paid.set(id, 0);
    owed.set(id, 0);
  }

  // share の実効比重: オーバーライド(weight) があればそれ、無ければ member 既定
  const effW = (s: CalcShare) => (s.weight && s.weight > 0 ? s.weight : (weightOf.get(s.memberId) ?? 1));

  let total = 0;
  for (const r of receipts) {
    let receiptTotal = 0;
    for (const it of r.items) {
      receiptTotal += it.price;
      // 負担者が空なら全員で等分（保険）。通常は入力時に1人以上指定される。
      const shares: CalcShare[] = it.shares.length > 0 ? it.shares : memberIds.map((id) => ({ memberId: id, weight: null }));
      const sumW = shares.reduce((s, sh) => s + effW(sh), 0) || 1;
      for (const sh of shares) owed.set(sh.memberId, (owed.get(sh.memberId) ?? 0) + it.price * effW(sh) / sumW);
    }
    total += receiptTotal;
    if (r.paidBy != null) paid.set(r.paidBy, (paid.get(r.paidBy) ?? 0) + receiptTotal);
  }

  const perMember: PerMember[] = memberIds.map((id) => {
    const p = Math.round(paid.get(id) ?? 0);
    const o = Math.round(owed.get(id) ?? 0);
    return { memberId: id, paid: p, owed: o, net: p - o };
  });

  return { total: Math.round(total), perMember, settlement: settle(perMember) };
}

// 貪欲法：払い過ぎた人(net>0)に、払い足りない人(net<0)が返す。送金回数を少なくする。
function settle(perMember: PerMember[]): Transfer[] {
  const creditors = perMember.filter((p) => p.net > 0).map((p) => ({ id: p.memberId, amt: p.net }));
  const debtors = perMember.filter((p) => p.net < 0).map((p) => ({ id: p.memberId, amt: -p.net }));
  creditors.sort((a, b) => b.amt - a.amt);
  debtors.sort((a, b) => b.amt - a.amt);

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amt, creditors[j].amt);
    if (pay > 0) transfers.push({ from: debtors[i].id, to: creditors[j].id, amount: pay });
    debtors[i].amt -= pay;
    creditors[j].amt -= pay;
    if (debtors[i].amt === 0) i++;
    if (creditors[j].amt === 0) j++;
  }
  return transfers;
}
