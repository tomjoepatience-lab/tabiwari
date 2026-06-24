// 割り勘の集計・精算ロジック（DB に依存しない純粋関数。テストしやすい）

export type CalcItem = { price: number; memberIds: number[] };
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

  let total = 0;
  for (const r of receipts) {
    let receiptTotal = 0;
    for (const it of r.items) {
      receiptTotal += it.price;
      // 負担者が空なら全員で割る（保険）。通常は入力時に1人以上指定される。
      const sharers = it.memberIds.length > 0 ? it.memberIds : memberIds;
      const sumW = sharers.reduce((s, m) => s + (weightOf.get(m) ?? 1), 0) || 1;
      for (const m of sharers) owed.set(m, (owed.get(m) ?? 0) + it.price * (weightOf.get(m) ?? 1) / sumW);
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
