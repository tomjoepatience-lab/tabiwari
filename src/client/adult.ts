// おとなモード「マネコ家計簿」ホーム — デザイン 3a (maneko-home-adult-3a.dc.html) の忠実移植。
// マークアップ・色・寸法はモックのまま、数値だけ実データを注入する。
import { Overview, QuickReward, RecentReceipt } from './api';
import { yen } from './ui';
import { phoneCanvas, esc } from './phone';
import { Insight } from './advice';
import { ReactionKind } from './character';
import { KidsTab } from './kids';
import { receiptCard, canvasModal } from './records';
import { monthlyNeeded } from './insights';

export interface AdultHomeArgs {
  overview: Overview;
  recent: RecentReceipt[];
  insight: Insight;
  celebrate: { kind: ReactionKind; name: string; reward?: QuickReward } | null;
  insights: string[]; // マネコ分析係のひとこと（ローテーション表示）
  goTab(tab: KidsTab): void;
  onReceiptChanged(): void; // ジャンル手直し後にキャッシュを無効化してもらう
}

// 吹き出しのローテーションタイマー（renderHome が画面を作り直すたびに止める）
let chipTimer: number | undefined;
export function stopChipRotation() {
  if (chipTimer) { clearInterval(chipTimer); chipTimer = undefined; }
}

// つかいみちバーの色（3a モックの並び）
const CAT_COLORS = ['#C99B2E', '#8FA98F', '#C88A6A', '#7E93AE'];
// 最近の記録アイコンの配色（つかいみちバーと同じカテゴリ順位に対応させる）
const ICON_COLORS: [string, string][] = [
  ['#F5E9CE', '#C99B2E'],
  ['#E4EBE4', '#5C7A5C'],
  ['#F0E2D8', '#B06A3E'],
  ['#E6EBF0', '#7E93AE'],
];

function paceChip(o: Overview, insight: Insight): string {
  const warn = insight.tips.find((t) => t.tone === 'warn');
  if (warn) return warn.text;
  const budget = o.settings?.monthly_budget;
  if (budget && budget > 0) {
    const now = new Date();
    const daysIn = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const pace = (o.month.spend / budget) / Math.max(0.03, now.getDate() / daysIn);
    if (o.month.spend > budget) return '予算オーバー…来月がんばろ';
    if (pace > 1.15) return 'ちょっとペース速いかも';
    return '予算内ペース、いい調子!';
  }
  return insight.streak >= 3 ? `${insight.streak}日連続で記録中!` : '今日も記録していこう';
}

// 3a のミニマネコ（ヒーローカードの上から覗く・忠実コピー）
function miniManekoHtml(): string {
  return `
  <div id="a-cat" style="position:absolute;right:6px;top:-296px;width:300px;height:370px;transform:scale(.40);transform-origin:bottom right;cursor:pointer">
    <div id="a-cat-body" style="position:absolute;inset:0;animation:mfloat2 3.6s ease-in-out infinite">
      <div style="position:absolute;right:26px;bottom:88px;width:70px;height:24px;border-radius:14px;background:linear-gradient(90deg,#E8791B,#FFB65C);transform-origin:left center;animation:mwag 2.8s ease-in-out infinite;box-shadow:inset 0 -4px 6px rgba(160,80,0,.3)"></div>
      <div style="position:absolute;left:96px;bottom:32px;width:46px;height:26px;border-radius:50%;background:linear-gradient(180deg,#FFC56E,#F0912C);box-shadow:inset 0 -4px 6px rgba(170,85,0,.35)"></div>
      <div style="position:absolute;left:160px;bottom:32px;width:46px;height:26px;border-radius:50%;background:linear-gradient(180deg,#FFC56E,#F0912C);box-shadow:inset 0 -4px 6px rgba(170,85,0,.35)"></div>
      <div style="position:absolute;left:70px;bottom:42px;width:160px;height:150px;border-radius:50% 50% 47% 47%;background:radial-gradient(circle at 35% 25%, #FFC96F, #FF9E3D 55%, #E8791B);box-shadow:inset -12px -16px 24px rgba(180,80,0,.30), inset 10px 12px 20px rgba(255,255,255,.35)"></div>
      <div style="position:absolute;left:108px;bottom:52px;width:84px;height:92px;border-radius:50%;background:radial-gradient(circle at 42% 28%, #FFF6E0, #FFE3AE)"></div>
      <div style="position:absolute;left:130px;bottom:70px;width:40px;height:40px;border-radius:50%;border:3px solid #E8B62B;background:radial-gradient(circle at 35% 30%, #FFEFAE, #FFD54A 55%, #DFA318);box-shadow:inset 0 -4px 6px rgba(160,100,0,.4);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:800;color:#A9750B">¥</div>
      <div style="position:absolute;left:64px;top:180px;width:32px;height:52px;border-radius:16px;background:linear-gradient(180deg,#FFC56E,#EF8A24);transform:rotate(26deg);box-shadow:inset -4px -6px 8px rgba(170,85,0,.3)"></div>
      <div style="position:absolute;left:208px;top:180px;width:32px;height:52px;border-radius:16px;background:linear-gradient(180deg,#FFC56E,#EF8A24);transform:rotate(-26deg);box-shadow:inset -4px -6px 8px rgba(170,85,0,.3)"></div>
      <div style="position:absolute;left:98px;top:46px;width:0;height:0;border-left:17px solid transparent;border-right:17px solid transparent;border-bottom:34px solid #E8791B;transform:rotate(-16deg)"></div>
      <div style="position:absolute;left:106px;top:58px;width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:18px solid #FFB3BC;transform:rotate(-16deg)"></div>
      <div style="position:absolute;left:186px;top:46px;width:0;height:0;border-left:17px solid transparent;border-right:17px solid transparent;border-bottom:34px solid #E8791B;transform:rotate(16deg)"></div>
      <div style="position:absolute;left:194px;top:60px;width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:18px solid #FFB3BC;transform:rotate(16deg)"></div>
      <div style="position:absolute;left:76px;top:70px;width:148px;height:130px;border-radius:50%;background:radial-gradient(circle at 35% 25%, #FFC96F, #FF9E3D 55%, #E8791B);box-shadow:inset -12px -14px 22px rgba(180,80,0,.28), inset 10px 10px 18px rgba(255,255,255,.35)"></div>
      <div style="position:absolute;left:136px;top:78px;width:7px;height:18px;border-radius:4px;background:#DF7014;transform:rotate(-8deg)"></div>
      <div style="position:absolute;left:148px;top:76px;width:7px;height:20px;border-radius:4px;background:#DF7014"></div>
      <div style="position:absolute;left:160px;top:78px;width:7px;height:18px;border-radius:4px;background:#DF7014;transform:rotate(8deg)"></div>
      <div style="position:absolute;left:122px;top:132px;width:56px;height:36px;border-radius:50%;background:radial-gradient(circle at 50% 30%, #FFF4D8, #FFE6B4)"></div>
      <div style="position:absolute;left:112px;top:112px;width:30px;height:32px;border-radius:50%;background:#FFF9EC;box-shadow:inset 0 2px 3px rgba(120,80,20,.25)">
        <div style="position:absolute;left:5px;top:5px;width:20px;height:22px;border-radius:50%;background:radial-gradient(circle at 40% 30%, #FFC963, #E8871A 60%, #B35E08)"></div>
        <div style="position:absolute;left:11px;top:8px;width:8px;height:17px;border-radius:50%;background:#1A0F08"></div>
        <div style="position:absolute;left:8px;top:8px;width:7px;height:7px;border-radius:50%;background:#FFFFFF"></div>
      </div>
      <div style="position:absolute;left:158px;top:112px;width:30px;height:32px;border-radius:50%;background:#FFF9EC;box-shadow:inset 0 2px 3px rgba(120,80,20,.25)">
        <div style="position:absolute;left:5px;top:5px;width:20px;height:22px;border-radius:50%;background:radial-gradient(circle at 40% 30%, #FFC963, #E8871A 60%, #B35E08)"></div>
        <div style="position:absolute;left:11px;top:8px;width:8px;height:17px;border-radius:50%;background:#1A0F08"></div>
        <div style="position:absolute;left:8px;top:8px;width:7px;height:7px;border-radius:50%;background:#FFFFFF"></div>
      </div>
      <div style="position:absolute;left:97px;top:150px;width:18px;height:11px;border-radius:50%;background:#FF9AA8;opacity:.85"></div>
      <div style="position:absolute;left:186px;top:150px;width:18px;height:11px;border-radius:50%;background:#FF9AA8;opacity:.85"></div>
      <div style="position:absolute;left:145px;top:144px;width:10px;height:7px;border-radius:50% 50% 60% 60%;background:#F08BA8"></div>
      <div style="position:absolute;left:137px;top:151px;width:12px;height:9px;border-bottom:2.5px solid #8A4B12;border-radius:0 0 12px 12px"></div>
      <div style="position:absolute;left:151px;top:151px;width:12px;height:9px;border-bottom:2.5px solid #8A4B12;border-radius:0 0 12px 12px"></div>
      <div style="position:absolute;left:118px;top:190px;width:66px;height:14px;border-radius:8px;background:linear-gradient(180deg,#E8483F,#B92626);box-shadow:inset 0 -3px 4px rgba(120,10,10,.5)"></div>
      <div style="position:absolute;left:141px;top:198px;width:20px;height:20px;border-radius:50%;background:radial-gradient(circle at 38% 30%, #FFEFAE, #FFD54A 55%, #D9971A);box-shadow:0 2px 4px rgba(120,80,0,.4)">
        <div style="position:absolute;left:2px;top:9px;width:16px;height:2px;background:#8A5E0A"></div>
        <div style="position:absolute;left:8px;bottom:2px;width:4px;height:5px;border-radius:2px;background:#8A5E0A"></div>
      </div>
    </div>
  </div>`;
}

// 3a の下部タブバー（active のタブだけ金色）
export function adultNavHtml(active: KidsTab): string {
  const c = (tab: KidsTab) => (active === tab ? '#C99B2E' : '#B8AE9C');
  const t = (tab: KidsTab) => (active === tab ? '#C99B2E' : '#8C8375');
  return `
  <div style="position:absolute;left:0;right:0;bottom:0;height:84px;background:#FFFFFF;box-shadow:0 -6px 20px rgba(60,50,30,.08);display:flex;align-items:flex-start;justify-content:space-around;padding:12px 10px 0;z-index:1200;pointer-events:none">
    <div data-nav="home" style="display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;pointer-events:auto">
      <div style="display:flex;flex-direction:column;align-items:center">
        <div style="width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:8px solid ${c('home')}"></div>
        <div style="width:13px;height:9px;background:${c('home')};border-radius:0 0 2px 2px"></div>
      </div>
      <span style="font-size:10px;font-weight:800;color:${t('home')}">ホーム</span>
    </div>
    <div data-nav="report" style="display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;pointer-events:auto">
      <div style="display:flex;align-items:flex-end;gap:2px;height:17px">
        <div style="width:5px;height:8px;border-radius:1.5px;background:${c('report')}"></div>
        <div style="width:5px;height:14px;border-radius:1.5px;background:${c('report')}"></div>
        <div style="width:5px;height:11px;border-radius:1.5px;background:${c('report')}"></div>
      </div>
      <span style="font-size:10px;font-weight:800;color:${t('report')}">レポート</span>
    </div>
    <div data-nav="add" class="hv" style="display:flex;flex-direction:column;align-items:center;gap:3px;margin-top:-26px;cursor:pointer;pointer-events:auto">
      <div style="width:56px;height:56px;border-radius:50%;background:#2E2A24;box-shadow:0 8px 18px rgba(46,42,36,.35);display:flex;align-items:center;justify-content:center">
        <div style="position:relative;width:20px;height:20px">
          <div style="position:absolute;left:8px;top:0;width:4px;height:20px;border-radius:2px;background:#E3C56A"></div>
          <div style="position:absolute;left:0;top:8px;width:20px;height:4px;border-radius:2px;background:#E3C56A"></div>
        </div>
      </div>
      <span style="font-size:10px;font-weight:800;color:${t('add')}">きろく</span>
    </div>
    <div data-nav="savings" style="display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;pointer-events:auto">
      <div style="display:flex;flex-direction:column;align-items:center;gap:1.5px">
        <div style="width:17px;height:5px;border-radius:50%;background:${c('savings')}"></div>
        <div style="width:17px;height:5px;border-radius:50%;background:${c('savings')}"></div>
        <div style="width:17px;height:5px;border-radius:50%;background:${c('savings')}"></div>
      </div>
      <span style="font-size:10px;font-weight:800;color:${t('savings')}">ちょきん</span>
    </div>
    <div data-nav="menu" style="display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;pointer-events:auto">
      <div style="display:flex;flex-direction:column;gap:3.5px;padding-top:2px">
        <div style="width:18px;height:3px;border-radius:2px;background:${c('menu')}"></div>
        <div style="width:18px;height:3px;border-radius:2px;background:${c('menu')}"></div>
        <div style="width:18px;height:3px;border-radius:2px;background:${c('menu')}"></div>
      </div>
      <span style="font-size:10px;font-weight:800;color:${t('menu')}">せってい</span>
    </div>
  </div>`;
}

export function adultHome(a: AdultHomeArgs): HTMLElement[] {
  const o = a.overview;
  const s = o.settings!;
  const now = new Date();
  const budget = s.monthly_budget;
  const income = s.monthly_income ?? (o.month.income || null);
  const remaining = budget != null ? budget - o.month.spend : null;
  const usedPct = budget ? Math.max(0, Math.min(100, Math.round((o.month.spend / budget) * 100))) : null;
  // 吹き出し: お祝い（ごほうびも表示）→ 分析係のインサイトをローテーション
  const lines = a.insights.length ? [...a.insights] : [paceChip(o, a.insight)];
  if (a.celebrate?.reward) {
    const rw = a.celebrate.reward;
    const bits: string[] = [];
    if (rw.challengeCleared) bits.push('きょうのチャレンジクリア!');
    if (rw.levelUp) bits.push(`Lv.${rw.level} にアップ!`);
    if (bits.length) lines.unshift(bits.join(' '));
  }
  const chipText = a.celebrate ? `「${a.celebrate.name.slice(0, 8)}」を記録しました ✓` : lines[0];

  // ホームに出す目標（スワイプで切替）。未達成を優先、全部達成済みなら最新1枚
  const activeGoals = o.goals.filter((g) => !g.done);
  const goalCards = activeGoals.length ? activeGoals : o.goals.slice(0, 1);
  const hasGoals = goalCards.length > 0;
  const goalsHtml = hasGoals ? `
    <!-- 目標（スワイプ切替） -->
    <div style="position:absolute;left:20px;right:20px;top:344px">
      <div class="ag-swipe" id="ag-swipe">
        ${goalCards.map((g) => {
          const p = Math.min(100, Math.round((g.saved / g.target) * 100));
          const pace = monthlyNeeded(g);
          const sub = g.done ? 'たっせい！🎉'
            : pace ? (pace.overdue ? `期限超過 ・ あと${yen(g.target - g.saved)}` : `期限 ${g.deadline!.slice(0, 7).replace('-', '/')} ・ 毎月あと${yen(pace.perMonth)}`)
            : `あと ${yen(g.target - g.saved)}`;
          return `
          <div class="ag-card">
            <div class="ag-head"><span class="ag-name">${esc((g.emoji ?? '🎯') + ' ' + g.name.slice(0, 10))}</span><span class="ag-pct">${p}%</span></div>
            <div class="ag-bar"><div class="ag-fill" style="width:${Math.max(4, p)}%"></div></div>
            <div class="ag-sub"><span>${yen(g.saved)} / ${yen(g.target)}</span><span>${esc(sub)}</span></div>
          </div>`;
        }).join('')}
      </div>
      ${goalCards.length > 1 ? `<div class="ag-dots">${goalCards.map((_, i) => `<span class="ag-dot${i === 0 ? ' on' : ''}" data-dot="${i}"></span>`).join('')}</div>` : ''}
    </div>` : '';
  // 目標カードがある分だけ下のセクションを詰める（つかいみちは3件に）
  const catsTop = hasGoals ? 452 : 356;
  const recentTop = hasGoals ? 608 : 546;

  // つかいみち（今月カテゴリ上位・最大値比）
  const cats = o.month.byCategory.slice(0, hasGoals ? 3 : 4);
  const maxCat = Math.max(1, ...cats.map((c2) => c2.total));
  const catRows = cats.map((c2, i) => `
    <div style="display:grid;grid-template-columns:76px 1fr 72px;align-items:center;gap:10px">
      <span style="font-size:12.5px;font-weight:700;color:#5C544A">${esc(c2.category.slice(0, 6))}</span>
      <div style="height:8px;border-radius:999px;background:#F0EBE0;overflow:hidden"><div style="width:${Math.max(4, Math.round((c2.total / maxCat) * 86))}%;height:100%;border-radius:999px;background:${CAT_COLORS[i % CAT_COLORS.length]}"></div></div>
      <span style="font-size:12.5px;font-weight:800;text-align:right">${yen(c2.total)}</span>
    </div>`).join('');

  // 最近の記録（3件）。きょうの分はモックと同じく「きょう 18:24」の時刻付き
  const dayLabel = (r: RecentReceipt) => {
    const d = r.purchased_on.slice(0, 10);
    const pad = (n: number) => String(n).padStart(2, '0');
    const t = new Date();
    const tIso = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
    const y = new Date(t); y.setDate(y.getDate() - 1);
    const yIso = `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`;
    if (d === tIso) {
      const c = r.created_at ? new Date(r.created_at) : null;
      return c && !Number.isNaN(c.getTime()) ? `きょう ${c.getHours()}:${pad(c.getMinutes())}` : 'きょう';
    }
    if (d === yIso) return 'きのう';
    return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  };
  // ホームはスクロール式（fillHeight）になったので最大10件まで表示（実機FB: 2〜3件しか見えなかった）
  const rows = a.recent.slice(0, 10);
  // アイコンは支配的なジャンル（金額最大）で決め、つかいみちバーの順位色と対応させる
  const domGenre = (r: RecentReceipt) => {
    const m = new Map<string, number>();
    for (const it of r.items) {
      const g = it.genre ?? 'その他';
      m.set(g, (m.get(g) ?? 0) + it.price);
    }
    return [...m.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'その他';
  };
  const catRank = new Map(o.month.byCategory.map((c2, i) => [c2.category, i]));
  const recentRows = rows.map((r, i) => {
    const g = domGenre(r);
    const rank = catRank.get(g);
    const [bg, fg] = ICON_COLORS[(rank !== undefined ? rank : i) % ICON_COLORS.length];
    const name = esc((r.store_name || r.items[0]?.name || r.trip_title).slice(0, 12));
    return `
    <div data-rid="${r.id}" style="display:flex;align-items:center;gap:12px;padding:9px 0;cursor:pointer;${i < rows.length - 1 ? 'border-bottom:1px solid #F0EBE0' : ''}">
      <div style="width:34px;height:34px;border-radius:50%;background:${bg};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:${fg}">${esc(g.slice(0, 1))}</div>
      <div style="display:flex;flex-direction:column;flex:1">
        <span style="font-size:13px;font-weight:800">${name}</span>
        <span style="font-size:10.5px;font-weight:700;color:#8C8375">${dayLabel(r)}</span>
      </div>
      <span style="font-size:14px;font-weight:800">-${yen(r.total)}</span>
    </div>`;
  }).join('');

  // スクロール式ホーム: コンテンツ高さを「最近の記録」の件数から動的計算する。
  // recentTop + セクション見出し(~30px) + 行高さ53px×件数 + カード下パディング24px + 下部余白170px（ナビ84px＋ゆとり）
  const contentH = recentTop + 30 + Math.max(1, rows.length) * 53 + 24 + 170;

  // 実機FB対応: 840px 固定キャンバス（transform scale・スクロール不可）をやめ、
  // fill タブと同じ「fillHeight ＋ .pc-scroll 内側スクロール」方式にする。
  // 既存の絶対配置セクションは position:relative の内側コンテンツ div にそのまま置き、
  // 下部ナビだけスクロールの外（canvas 直下・bottom固定 z-20）へ出して画面下に常時固定する。
  const html = `
  <div class="pc-scroll" style="padding:0;display:block">
  <div style="position:relative;width:402px;max-width:100%;margin:0 auto;height:${contentH}px;overflow:hidden;font-family:'M PLUS Rounded 1c', sans-serif;color:#2E2A24">

    <!-- ヘッダー -->
    <div style="position:absolute;left:20px;right:20px;top:64px;display:flex;align-items:center;justify-content:space-between">
      <div style="display:flex;align-items:baseline;gap:8px">
        <span style="font-size:24px;font-weight:800">${now.getMonth() + 1}月</span>
        <span style="font-size:12.5px;font-weight:700;color:#8C8375">${now.getFullYear()}</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;background:#FFFFFF;border-radius:999px;padding:5px 12px;box-shadow:0 3px 10px rgba(60,50,30,.08)">
        <span style="font-size:11px;font-weight:800;color:#C99B2E">Lv.${s.level}</span>
        <span style="font-size:11px;font-weight:700;color:#8C8375">マネコ</span>
      </div>
    </div>

    <!-- ヒーローカード + マネコ -->
    <div style="position:absolute;left:20px;right:20px;top:170px">
      ${miniManekoHtml()}
      <div id="a-chip" style="position:absolute;right:132px;top:-58px;background:#FFFFFF;border-radius:14px 14px 14px 4px;padding:8px 12px;box-shadow:0 4px 12px rgba(60,50,30,.14);font-size:12px;font-weight:800;color:#4A3B28;line-height:1.5;animation:mfloat2 3.6s ease-in-out infinite;max-width:220px;min-width:150px;pointer-events:none">${esc(chipText)}</div>
      <div style="position:relative;background:#2E2A24;border-radius:24px;padding:22px 22px 20px;box-shadow:0 14px 30px rgba(46,42,36,.28);display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <span style="font-size:12.5px;font-weight:700;color:#B8AE9C">${remaining != null ? '今月あと使える' : '今月の支出'}</span>
          <span id="a-set-budget" style="font-size:11.5px;font-weight:700;color:#8C8375;cursor:pointer">${budget != null ? `予算 ${yen(budget)}` : '予算を設定 ›'}</span>
        </div>
        <div style="font-size:38px;font-weight:800;color:#F7F4EE;line-height:1;letter-spacing:.01em">${yen(remaining != null ? remaining : o.month.spend)}</div>
        ${usedPct != null ? `
        <div style="height:10px;border-radius:999px;background:#4A443A;overflow:hidden">
          <div style="width:${usedPct}%;height:100%;border-radius:999px;background:linear-gradient(90deg,#E3C56A,#C99B2E)"></div>
        </div>` : ''}
        <div style="display:flex;gap:18px">
          <span style="font-size:12px;font-weight:700;color:#B8AE9C">収入 <span style="color:#E3C56A">${income != null ? yen(income) : '—'}</span></span>
          <span style="font-size:12px;font-weight:700;color:#B8AE9C">支出 <span style="color:#F7F4EE">${yen(o.month.spend)}</span></span>
        </div>
      </div>
    </div>

    ${goalsHtml}

    <!-- カテゴリ -->
    <div style="position:absolute;left:20px;right:20px;top:${catsTop}px;display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span style="font-size:14px;font-weight:800">つかいみち</span>
        <span id="a-see-all" style="font-size:11.5px;font-weight:700;color:#C99B2E;cursor:pointer">すべて見る ›</span>
      </div>
      <div style="background:#FFFFFF;border-radius:20px;padding:16px 18px;box-shadow:0 4px 14px rgba(60,50,30,.07);display:flex;flex-direction:column;gap:12px">
        ${catRows || '<span style="font-size:12.5px;font-weight:700;color:#8C8375">今月の記録はまだありません</span>'}
      </div>
    </div>

    <!-- 最近の記録 -->
    <div style="position:absolute;left:20px;right:20px;top:${recentTop}px;display:flex;flex-direction:column;gap:10px">
      <span style="font-size:14px;font-weight:800">最近の記録</span>
      <div style="background:#FFFFFF;border-radius:20px;padding:6px 18px;box-shadow:0 4px 14px rgba(60,50,30,.07);display:flex;flex-direction:column">
        ${recentRows || '<span style="font-size:12.5px;font-weight:700;color:#8C8375;padding:12px 0">まだ記録がありません。まんなかの「きろく」から始めましょう</span>'}
      </div>
    </div>

  </div>
  </div>
  ${adultNavHtml('home')}`;

  const { wrap, canvas } = phoneCanvas(html, { bg: '#F7F4EE', fillHeight: true });
  canvas.querySelectorAll<HTMLElement>('[data-nav]').forEach((n) => {
    n.addEventListener('click', () => a.goTab(n.dataset.nav as KidsTab));
  });
  canvas.querySelector('#a-see-all')?.addEventListener('click', () => a.goTab('report'));
  canvas.querySelector('#a-set-budget')?.addEventListener('click', () => { if (budget == null) a.goTab('menu'); });

  // 目標スワイパー: スクロールでドット更新・ドットタップで移動・カードタップでちょきんへ
  const swipe = canvas.querySelector<HTMLElement>('#ag-swipe');
  if (swipe) {
    swipe.addEventListener('click', () => a.goTab('savings'));
    const dots = [...canvas.querySelectorAll<HTMLElement>('.ag-dot')];
    if (dots.length) {
      swipe.addEventListener('scroll', () => {
        const i = Math.round(swipe.scrollLeft / Math.max(1, swipe.clientWidth));
        dots.forEach((d, j) => d.classList.toggle('on', j === i));
      }, { passive: true });
      dots.forEach((d) => d.addEventListener('click', () => {
        swipe.scrollTo({ left: Number(d.dataset.dot) * swipe.clientWidth, behavior: 'smooth' });
      }));
    }
  }
  // 最近の記録タップ → 見やすい明細カード（カード自身に店名が出るのでタイトルは重複させない）
  canvas.querySelectorAll<HTMLElement>('[data-rid]').forEach((n) => {
    n.addEventListener('click', () => {
      const r = a.recent.find((x) => x.id === Number(n.dataset.rid));
      if (r) canvasModal(canvas, receiptCard(r, { onChanged: a.onReceiptChanged }));
    });
  });

  // マネコ分析係: インサイトを順ぐりに話す（お祝いがあれば少し待ってから）
  const chip = canvas.querySelector<HTMLElement>('#a-chip');
  stopChipRotation();
  if (lines.length > 1 || a.celebrate) {
    let mi = a.celebrate ? 0 : 1;
    chipTimer = window.setInterval(() => {
      if (!chip || !chip.isConnected) { stopChipRotation(); return; }
      chip.textContent = lines[mi % lines.length];
      mi++;
    }, 6500);
  }

  // マネコをタップ → ちいさくジャンプ＋次のインサイト
  const catBody = canvas.querySelector<HTMLElement>('#a-cat-body');
  let tapIdx = 0;
  canvas.querySelector('#a-cat')?.addEventListener('click', () => {
    if (catBody) {
      catBody.style.animation = 'mjump 1.2s ease-in-out';
      window.setTimeout(() => { catBody.style.animation = 'mfloat2 3.6s ease-in-out infinite'; }, 1200);
    }
    tapIdx++;
    if (chip) chip.textContent = lines[tapIdx % lines.length];
  });

  return [wrap];
}
