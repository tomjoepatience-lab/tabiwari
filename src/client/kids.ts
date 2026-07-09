// こどもモード「マネコタウン」ホーム — デザイン 2a (maneko-home-game-2a.dc.html) の忠実移植。
// マークアップ・色・寸法・アニメーションはモックのまま、数値だけ実データを注入する。
import { Overview, QuickReward, RecentReceipt } from './api';
import { yen, el, labeled } from './ui';
import { phoneCanvas, esc } from './phone';
import { Insight } from './advice';
import { ReactionKind } from './character';
import { canvasModal } from './records';
import { journeyTotal, journeyGoal, currentStage, journeyPercent, STAGES, openJourney } from './journey';
import { manekoHtml, stageAccessoriesHtml } from './maneko';
import { STAGE_INFO, stageSceneryHtml, stageBuyIconHtml } from './stage';

export type KidsTab = 'home' | 'report' | 'add' | 'savings' | 'menu';

export interface KidsHomeArgs {
  overview: Overview;
  recent: RecentReceipt[];
  insight: Insight;
  celebrate: { kind: ReactionKind; name: string; reward?: QuickReward } | null;
  goTab(tab: KidsTab): void;
  onPresent(): Promise<{ costume: string; coins: number } | null>;
  onDeposit(goalId: number, amount: number): void;      // 🐷ちょきんばこから
  onCreateGoal(body: { name: string; emoji: string; target: number; deadline?: string }): void; // 掲示板から
}

// マネコのおしゃべりタイマー（renderHome が画面を作り直すたびに止める）
let kidsTimer: number | undefined;
export function stopKidsSpeech() {
  if (kidsTimer) { clearInterval(kidsTimer); kidsTimer = undefined; }
}

// XPからレベル進捗（次のレベルまでの割合 0..1）
export function levelProgress(xp: number, level: number): number {
  const base = Math.pow(5 * (level - 1), 2);
  const next = Math.pow(5 * level, 2);
  return Math.max(0, Math.min(1, (xp - base) / Math.max(1, next - base)));
}

// ごきげん（1〜4ハート）: 記録の継続で上がり、使いすぎ・さいふマイナスで下がる
export function kidsMood(insight: Insight, overview: Overview): number {
  let h = 3;
  if (insight.streak >= 3) h++;
  if (insight.tips.some((t) => t.tone === 'warn')) h--;
  if (overview.wallet < 0) h--;
  return Math.max(1, Math.min(4, h));
}

// 下部ナビ（2a のゲームふう・忠実移植）。active のラベルに金の下地。
export function kidsNavHtml(active: KidsTab): string {
  const lbl = (tab: KidsTab, color: string, text: string) =>
    `<span style="font-size:11px;font-weight:800;color:${color};background:${active === tab ? '#FFD54A' : 'rgba(255,253,246,.9)'};border-radius:999px;padding:1px 9px">${text}</span>`;
  return `
  <div style="position:absolute;left:0;right:0;bottom:26px;display:flex;justify-content:center;align-items:flex-end;gap:14px;z-index:20">
    <div data-nav="home" class="hv" style="display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer">
      <div style="width:52px;height:52px;border-radius:50%;border:3.5px solid #FFFDF6;background:radial-gradient(circle at 35% 30%, #FFC94D, #F5A623);box-shadow:0 5px 12px rgba(120,80,20,.35);display:flex;flex-direction:column;align-items:center;justify-content:center">
        <div style="width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;border-bottom:9px solid #FFFDF6"></div>
        <div style="width:15px;height:10px;background:#FFFDF6;border-radius:0 0 3px 3px"></div>
      </div>
      ${lbl('home', '#7A4A00', 'ホーム')}
    </div>
    <div data-nav="report" class="hv" style="display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer">
      <div style="width:52px;height:52px;border-radius:50%;border:3.5px solid #FFFDF6;background:radial-gradient(circle at 35% 30%, #7FB3DE, #4E7FB5);box-shadow:0 5px 12px rgba(50,80,120,.35);display:flex;align-items:flex-end;justify-content:center;gap:2.5px;padding-bottom:15px">
        <div style="width:5px;height:9px;border-radius:2px;background:#FFFDF6"></div>
        <div style="width:5px;height:14px;border-radius:2px;background:#FFFDF6"></div>
        <div style="width:5px;height:11px;border-radius:2px;background:#FFFDF6"></div>
      </div>
      ${lbl('report', '#39628F', 'レポート')}
    </div>
    <div data-nav="add" class="hv" style="display:flex;flex-direction:column;align-items:center;gap:3px;margin-bottom:8px;cursor:pointer">
      <div style="width:82px;height:82px;border-radius:50%;border:4px solid #FFFDF6;background:radial-gradient(circle at 35% 28%, #FFEFAE, #FFD54A 50%, #DFA318);box-shadow:0 8px 20px rgba(150,95,10,.45), inset 0 -8px 12px rgba(160,100,0,.4);display:flex;flex-direction:column;align-items:center;justify-content:center;animation:mfloat2 2.6s ease-in-out infinite">
        <span style="font-size:19px;font-weight:800;color:#7A4A00;line-height:1.1">きろく</span>
        <span style="font-size:10px;font-weight:800;color:#A9750B">おこづかい帳</span>
      </div>
    </div>
    <div data-nav="savings" class="hv" style="display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;position:relative">
      <div style="width:52px;height:52px;border-radius:50%;border:3.5px solid #FFFDF6;background:radial-gradient(circle at 35% 30%, #F0A0B8, #D96A8A);box-shadow:0 5px 12px rgba(150,60,90,.35);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.5px">
        <div style="width:22px;height:6px;border-radius:50%;background:#FFFDF6;opacity:.7"></div>
        <div style="width:22px;height:6px;border-radius:50%;background:#FFFDF6;opacity:.85"></div>
        <div style="width:22px;height:6px;border-radius:50%;background:#FFFDF6"></div>
      </div>
      ${lbl('savings', '#B9506E', 'ちょきん')}
    </div>
    <div data-nav="menu" class="hv" style="display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer">
      <div style="width:52px;height:52px;border-radius:50%;border:3.5px solid #FFFDF6;background:radial-gradient(circle at 35% 30%, #A88ECB, #7A5BA8);box-shadow:0 5px 12px rgba(80,50,120,.35);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px">
        <div style="width:22px;height:3.5px;border-radius:2px;background:#FFFDF6"></div>
        <div style="width:22px;height:3.5px;border-radius:2px;background:#FFFDF6"></div>
        <div style="width:22px;height:3.5px;border-radius:2px;background:#FFFDF6"></div>
      </div>
      ${lbl('menu', '#5C4A8A', 'メニュー')}
    </div>
  </div>`;
}

export function wireNav(canvas: HTMLElement, goTab: (t: KidsTab) => void) {
  canvas.querySelectorAll<HTMLElement>('[data-nav]').forEach((n) => {
    n.addEventListener('click', () => goTab(n.dataset.nav as KidsTab));
  });
}

// 金貨（HUD・コインの雨で使い回し。fs=0 でモック2枚目と同じ無地コイン）
const coin = (size: number, fs = 0) =>
  `<div style="width:${size}px;height:${size}px;border-radius:50%;border:2px solid #E8B62B;background:radial-gradient(circle at 35% 30%, #FFEFAE, #FFD54A 55%, #DFA318);display:flex;align-items:center;justify-content:center;font-size:${fs}px;font-weight:800;color:#A9750B">${fs ? '¥' : ''}</div>`;

export function kidsHome(a: KidsHomeArgs): HTMLElement[] {
  const o = a.overview;
  const s = o.settings!;
  const hearts = kidsMood(a.insight, o);
  const heartsStr = '♥'.repeat(hearts) + '♡'.repeat(4 - hearts);
  const lvPct = Math.round(levelProgress(s.xp, s.level) * 100);
  const goal = o.goals.find((g) => !g.done);
  const goalPct = goal ? Math.min(100, Math.round((goal.saved / goal.target) * 100)) : 0;

  // RPGの旅: 貯金の累計で決まる現在ステージ（衣装＆景色＆進捗％の元。5段階 0..4）
  const jGoal = journeyGoal(o);
  const jTotal = journeyTotal(o);
  const jStage = currentStage(jTotal, jGoal);
  const jPct = journeyPercent(jTotal, jGoal);
  const d = STAGE_INFO[jStage];

  // ステージ別の装備（首輪・帽子・王冠など）。300×370 のキャラ座標系でマネコに重ねる。
  const acc = stageAccessoriesHtml(jStage);

  // 買ったもの（最新のかいもの1件をステージ別アイコンのラベルに）
  const buy1 = a.recent[0];
  const buyLabel = (r: RecentReceipt) => `${(r.store_name || r.items[0]?.name || 'かいもの').slice(0, 7)} ${yen(r.total)}`;

  // コインの雨: お祝い / チャレンジ達成 / 黄金の都（達成ステージ）
  const coinRain = !!(a.celebrate || o.challengeDone) || jStage === 4;

  const html = `
  <div style="position:relative;width:402px;height:840px;overflow:hidden;background:${d.sky};font-family:'M PLUS Rounded 1c', sans-serif;color:#4A3B28">

    <!-- v2 ステージ景色（太陽・雲・遠景・地面・道・建物・小物） z0-2 -->
    ${stageSceneryHtml(jStage)}

    <!-- 買ったもの（最新のかいもの・ステージ別アイコン） -->
    ${buy1 ? stageBuyIconHtml(jStage, buyLabel(buy1)) : ''}

    <!-- コインの雨（お祝い / チャレンジ / 黄金の都） -->
    ${coinRain ? `
    <div style="position:absolute;left:90px;top:-40px;z-index:3;animation:mfall 6s linear infinite;opacity:0">${coin(24, 10)}</div>
    <div style="position:absolute;left:300px;top:-40px;z-index:3;animation:mfall 7.2s linear infinite;animation-delay:-3.1s;opacity:0">${coin(20)}</div>
    ` : ''}

    <!-- マネコ（ステージ別装備）。中身は acc.back + 本体 + acc.front -->
    <div id="k-cat" style="position:absolute;left:50%;bottom:132px;width:300px;height:370px;transform:translateX(-50%) scale(.66);transform-origin:bottom center;cursor:pointer;z-index:3">
      ${acc.back}
      ${manekoHtml({ collar: false })}
      ${acc.front}
    </div>

    <!-- マネコのふきだし（じぶんからおしゃべりする） -->
    <div id="k-bubble" style="position:absolute;left:50%;top:346px;transform:translateX(-50%);z-index:8;background:#FFFDF6;border:2.5px solid #4A3B28;border-radius:16px;padding:8px 14px;max-width:245px;box-shadow:0 4px 12px rgba(60,40,20,.25);opacity:0;transition:opacity .35s;pointer-events:none">
      <span id="k-bubble-text" style="font-size:12.5px;font-weight:800;color:#4A3B28;line-height:1.5"></span>
      <div style="position:absolute;left:50%;bottom:-8px;width:13px;height:13px;background:#FFFDF6;border-right:2.5px solid #4A3B28;border-bottom:2.5px solid #4A3B28;transform:translateX(-50%) rotate(45deg)"></div>
    </div>

    <!-- 上部HUD（おさいふ・ごきげん・右端に Lvリング） -->
    <div style="position:absolute;left:14px;right:14px;top:60px;display:flex;align-items:center;gap:8px;z-index:10">
      <div style="display:flex;align-items:center;gap:6px;background:rgba(255,253,246,.95);border:2.5px solid #E8B62B;border-radius:999px;padding:4px 12px 4px 5px;box-shadow:0 4px 10px rgba(120,80,20,.25)">
        ${coin(24, 11)}
        <span style="font-size:15px;font-weight:800;color:#3D2F1C">${o.wallet.toLocaleString('ja-JP')}</span>
      </div>
      <div style="display:flex;align-items:center;gap:5px;background:rgba(255,253,246,.95);border:2.5px solid #F0A0B8;border-radius:999px;padding:5px 12px;box-shadow:0 4px 10px rgba(120,80,20,.25)">
        <span style="font-size:11px;font-weight:800;color:#B9506E">ごきげん</span>
        <span style="font-size:13px;font-weight:800;color:#F06292;letter-spacing:1px">${heartsStr}</span>
      </div>
      <div style="margin-left:auto;width:50px;height:50px;border-radius:50%;background:conic-gradient(#FFC94D 0 ${lvPct}%, #F0E4C8 ${lvPct}% 100%);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 10px rgba(120,80,20,.25)">
        <div style="width:38px;height:38px;border-radius:50%;background:#FFFDF6;display:flex;flex-direction:column;align-items:center;justify-content:center">
          <span style="font-size:9px;font-weight:800;color:#A08A60;line-height:1">Lv</span>
          <span style="font-size:15px;font-weight:800;color:#E8791B;line-height:1">${s.level}</span>
        </div>
      </div>
    </div>

    <!-- ステージ名（黒ピル tier ＋ タイトル） -->
    <div style="position:absolute;left:14px;top:118px;display:flex;flex-direction:column;gap:4px;z-index:10">
      <div style="align-self:flex-start;padding:2px 10px;border-radius:999px;background:#2E2A24;color:#FFE9B8;font-size:10px;font-weight:800;letter-spacing:.08em">${esc(d.tier)}</div>
      <div style="font-size:19px;font-weight:800;color:#3D2F1C;text-shadow:0 1px 0 rgba(255,255,255,.6)">${esc(STAGES[jStage].name)}</div>
    </div>

    <!-- プレゼント（衣装ガチャ）。タイトルの右側へ移設 -->
    <div id="k-present" class="hv" style="position:absolute;right:14px;top:118px;display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer;z-index:10">
      <div style="position:relative;width:46px;height:40px">
        <div style="position:absolute;left:3px;bottom:0;width:40px;height:26px;border-radius:5px;background:linear-gradient(180deg,#E8483F,#B92626);box-shadow:inset 0 -4px 5px rgba(100,10,10,.4)"></div>
        <div style="position:absolute;left:0;bottom:22px;width:46px;height:12px;border-radius:4px;background:linear-gradient(180deg,#FF6B5E,#D93A32)"></div>
        <div style="position:absolute;left:20px;bottom:0;width:6px;height:34px;background:#FFD54A"></div>
        <div style="position:absolute;left:13px;bottom:32px;width:8px;height:8px;border-radius:50% 50% 0 50%;border:3px solid #FFD54A;background:transparent"></div>
        <div style="position:absolute;left:25px;bottom:32px;width:8px;height:8px;border-radius:50% 50% 50% 0;border:3px solid #FFD54A;background:transparent"></div>
      </div>
      <span style="font-size:10px;font-weight:800;color:#6B5638;background:rgba(255,253,246,.9);border-radius:999px;padding:1px 8px">プレゼント</span>
    </div>

    <!-- 目標カード（クリックで ちょきんタブへ） -->
    <div id="k-goal" style="position:absolute;left:14px;right:14px;top:176px;background:rgba(255,253,246,.94);border:2.5px solid #E8B62B;border-radius:14px;padding:8px 12px;box-shadow:0 5px 14px rgba(120,80,20,.22);display:flex;flex-direction:column;gap:5px;cursor:pointer;z-index:10">
      ${goal ? `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span style="font-size:11.5px;font-weight:800;color:#7A5A20;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">もくひょう ${esc(goal.name.slice(0, 6))} ${yen(goal.target)}</span>
        <span style="font-size:12px;font-weight:800;color:#3E9E6C">${goalPct}%</span>
      </div>
      <div style="height:10px;border-radius:999px;background:#F0E4C8;overflow:hidden">
        <div style="width:${goalPct}%;height:100%;border-radius:999px;background:linear-gradient(90deg,#7CC77A,#3E9E6C)"></div>
      </div>
      <span style="font-size:10.5px;font-weight:700;color:#A08A60">${esc(d.note)}</span>
      ` : o.goals.some((g) => g.done) ? `
      <span style="font-size:12px;font-weight:800;color:#3E9E6C">たっせい！🎉 すごい！</span>
      <span style="font-size:10.5px;font-weight:700;color:#A08A60">けいじばんで つぎの もくひょうを きめよう ›</span>
      ` : `
      <span style="font-size:12px;font-weight:800;color:#7A5A20">もくひょうをきめよう！</span>
      <span style="font-size:10.5px;font-weight:700;color:#A08A60">けいじばんを タップして とうろく ›</span>
      `}
    </div>

    <!-- きょうのチャレンジ（スリムバナー） -->
    <div id="k-challenge" style="position:absolute;left:14px;right:14px;top:248px;height:34px;border-radius:999px;background:linear-gradient(90deg,#FFD86A,#F5B437);box-shadow:0 4px 10px rgba(150,100,20,.28);display:flex;align-items:center;justify-content:center;padding:0 14px;cursor:pointer;z-index:10">
      ${o.challengeDone
        ? `<span style="font-size:11.5px;font-weight:800;color:#7A4A00;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">⭐ きょうのチャレンジ クリア! +5コイン ✓</span>`
        : `<span style="font-size:11.5px;font-weight:800;color:#7A4A00;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">⭐ きょうのチャレンジ: おかいもの メモ あと1回（クリアで +5コイン）</span>`}
    </div>

    <!-- 世界のしかけ: 掲示板（もくひょうづくり）と ぶたさんちょきんばこ -->
    <div id="k-board" class="hv" style="position:absolute;left:10px;top:592px;display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;z-index:5">
      <div style="position:relative;width:76px;height:66px">
        <div style="position:absolute;left:12px;top:34px;width:8px;height:30px;background:linear-gradient(180deg,#B9743F,#94551F);border-radius:2px"></div>
        <div style="position:absolute;right:12px;top:34px;width:8px;height:30px;background:linear-gradient(180deg,#B9743F,#94551F);border-radius:2px"></div>
        <div style="position:absolute;left:0;top:0;width:76px;height:40px;background:linear-gradient(180deg,#D9A876,#B9895A);border:3px solid #8A4E1C;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#5A3A16;box-shadow:0 4px 8px rgba(120,70,20,.3)">もくひょう</div>
        <div style="position:absolute;left:8px;top:6px;width:60px;height:3px;background:rgba(255,246,214,.5);border-radius:2px"></div>
      </div>
      <span style="font-size:11px;font-weight:800;color:#6B5638;background:rgba(255,253,246,.9);border-radius:999px;padding:2px 10px">けいじばん</span>
    </div>
    <div id="k-pig" class="hv" style="position:absolute;right:10px;top:592px;display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;z-index:5">
      <div style="position:relative;width:78px;height:62px">
        <div style="position:absolute;left:6px;top:12px;width:66px;height:46px;border-radius:50%;background:radial-gradient(circle at 35% 30%, #FBD0E0, #F06292);box-shadow:inset -6px -8px 10px rgba(180,60,100,.28), 0 5px 10px rgba(180,60,100,.3)"></div>
        <div style="position:absolute;left:16px;top:5px;width:15px;height:15px;background:#F06292;border-radius:50% 50% 0 50%;transform:rotate(12deg)"></div>
        <div style="position:absolute;left:34px;top:8px;width:20px;height:5px;border-radius:3px;background:#B9506E"></div>
        <div style="position:absolute;left:38px;top:-4px;width:15px;height:15px;border-radius:50%;border:2px solid #E8B62B;background:radial-gradient(circle at 35% 30%, #FFEFAE, #FFD54A 55%, #DFA318)"></div>
        <div style="position:absolute;left:0;top:28px;width:19px;height:15px;border-radius:50%;background:#F8A8C0;border:2.5px solid #D96A8A"></div>
        <div style="position:absolute;left:5px;top:33px;width:3px;height:4px;border-radius:2px;background:#B9506E"></div>
        <div style="position:absolute;left:11px;top:33px;width:3px;height:4px;border-radius:2px;background:#B9506E"></div>
        <div style="position:absolute;left:18px;top:54px;width:9px;height:8px;border-radius:0 0 4px 4px;background:#D96A8A"></div>
        <div style="position:absolute;left:52px;top:54px;width:9px;height:8px;border-radius:0 0 4px 4px;background:#D96A8A"></div>
      </div>
      <span style="font-size:11px;font-weight:800;color:#B9506E;background:rgba(255,253,246,.9);border-radius:999px;padding:2px 10px">ちょきんばこ</span>
    </div>

    <!-- せかいをみる（RPGの旅マップへ）。現在ステージ＆％も表示 -->
    <div id="k-journey" class="hv" style="position:absolute;left:50%;top:300px;transform:translateX(-50%);z-index:9;cursor:pointer;background:linear-gradient(180deg,#FFE9A8,#FFD54A);border:2.5px solid #E8B62B;border-radius:999px;padding:7px 15px;box-shadow:0 6px 16px rgba(150,95,10,.42);display:flex;align-items:center;gap:7px;white-space:nowrap">
      <span style="font-size:15px">🗺</span>
      <span style="font-size:12.5px;font-weight:800;color:#7A4A00">せかいを みにいく</span>
      <span style="font-size:11px;font-weight:800;color:#B9506E;background:#FFF7DE;border-radius:999px;padding:1px 8px">${esc(STAGES[jStage].name)} ${jPct}%</span>
    </div>

    <!-- おしらせトースト（長いセリフも折り返して全文表示） -->
    <div id="k-toast" style="position:absolute;left:50%;bottom:150px;transform:translateX(-50%);background:rgba(255,253,246,.97);border:2.5px solid #E8B62B;border-radius:18px;padding:8px 18px;font-size:13px;font-weight:800;color:#7A5A20;box-shadow:0 6px 16px rgba(120,80,20,.3);width:max-content;max-width:86%;text-align:center;line-height:1.5;opacity:0;transition:opacity .4s;z-index:15;pointer-events:none"></div>

    ${kidsNavHtml('home')}
  </div>`;

  const { wrap, canvas } = phoneCanvas(html, { bg: '#5FB2EE' });
  wireNav(canvas, a.goTab);

  const toast = canvas.querySelector<HTMLElement>('#k-toast')!;
  let toastTimer: number | undefined;
  const showToast = (text: string, ms = 3500) => {
    toast.textContent = text;
    toast.style.opacity = '1';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toast.style.opacity = '0'; }, ms);
  };

  // マネコをタップ → ジャンプ（mjump）＋ひとこと
  const catBody = canvas.querySelector<HTMLElement>('#m-cat-body');
  const catShadow = canvas.querySelector<HTMLElement>('#m-cat-shadow');
  const jump = () => {
    if (!catBody || !catShadow) return;
    catBody.style.animation = 'mjump 1.4s ease-in-out';
    catShadow.style.animation = 'mjshadow 1.4s ease-in-out';
    window.setTimeout(() => {
      catBody.style.animation = 'mfloat 3s ease-in-out infinite';
      catShadow.style.animation = 'mshadow 3s ease-in-out infinite';
    }, 1400);
  };
  // マネコのおしゃべり（吹き出し）。自分から順ぐりに話す＋タップでもひとこと
  const bubble = canvas.querySelector<HTMLElement>('#k-bubble');
  const bubbleText = canvas.querySelector<HTMLElement>('#k-bubble-text');
  const say = (t: string) => {
    if (!bubble || !bubbleText) return;
    bubbleText.textContent = t;
    bubble.style.opacity = '1';
  };
  const TAP_LINES = ['にゃっ!?', 'きょうも きろく してくれて ありがとにゃ！', 'ちょきん がんばろうね！', 'いっしょに お金じょうずに なろうにゃ'];
  let bi = 0;
  const speakNext = () => {
    if (!a.insight.messages.length) return;
    say(a.insight.messages[bi % a.insight.messages.length]);
    bi++;
  };
  stopKidsSpeech();
  window.setTimeout(speakNext, a.celebrate ? 6000 : 900);
  kidsTimer = window.setInterval(() => {
    if (!bubble || !bubble.isConnected) { stopKidsSpeech(); return; }
    speakNext();
  }, 8000);
  canvas.querySelector('#k-cat')?.addEventListener('click', () => {
    jump();
    say(TAP_LINES[Math.floor(Math.random() * TAP_LINES.length)]);
  });

  // 記録直後のお祝い
  if (a.celebrate) {
    const c = a.celebrate;
    window.setTimeout(() => {
      jump();
      const bits = [`「${c.name.slice(0, 8)}」をきろくしたにゃ！`];
      if (c.reward?.challengeCleared) bits.push('チャレンジクリア +5コイン！');
      if (c.reward?.levelUp) bits.push(`Lv.${c.reward.level} にアップ！`);
      showToast(bits.join(' '), 5000);
    }, 500);
  }

  // チャレンジ → きろくへ / もくひょう → ちょきん箱へ
  canvas.querySelector('#k-challenge')?.addEventListener('click', () => { if (!o.challengeDone) a.goTab('add'); });
  canvas.querySelector('#k-goal')?.addEventListener('click', () => a.goTab('savings'));

  // せかいをみる → RPGの旅マップ（フルスクリーン）
  canvas.querySelector('#k-journey')?.addEventListener('click', () => openJourney(o));

  // 掲示板 → もくひょうづくりのカード
  const openGoalModal = (note?: string) => {
    const gName = el('input', { class: 'grow', placeholder: 'ほしいもの（れい: ゲームき）' });
    const gEmoji = el('select', {}, ['🎮', '⭐', '🚲', '🎁', '📱', '👟', '🧸', '✈️'].map((e2) => el('option', { value: e2, textContent: e2 })));
    const gTarget = el('input', { type: 'number', class: 'price', placeholder: 'いくら？', min: '1' });
    const gDeadline = el('input', { type: 'date' });
    const btn = el('button', { class: 'primary big-add', textContent: '🪧 もくひょうを はる！' });
    const body = el('div', { class: 'kd-form' }, [
      ...(note ? [el('p', { class: 'muted', textContent: note })] : []),
      labeled('ほしいもの', gName),
      el('div', { class: 'row' }, [labeled('マーク', gEmoji), labeled('いくら？', gTarget)]),
      labeled('いつまで？（なくてもOK）', gDeadline),
      el('div', { class: 'center' }, [btn]),
    ]);
    const overlay = canvasModal(canvas, body, { title: '🪧 けいじばん' });
    btn.addEventListener('click', () => {
      const t = Math.round(Number(gTarget.value));
      if (!gName.value.trim() || !Number.isFinite(t) || t <= 0) { alert('なまえと きんがくを いれてね'); return; }
      overlay.remove();
      a.onCreateGoal({ name: gName.value.trim(), emoji: gEmoji.value, target: t, deadline: gDeadline.value || undefined });
    });
  };
  canvas.querySelector('#k-board')?.addEventListener('click', () => openGoalModal());

  // ぶたさんちょきんばこ → ちょきんカード
  canvas.querySelector('#k-pig')?.addEventListener('click', () => {
    const undone = o.goals.filter((g) => !g.done);
    if (!undone.length) { openGoalModal('まだ もくひょうが ないよ。さきに つくろう！'); return; }
    const sel = el('select', {}, undone.map((g) => el('option', { value: String(g.id), textContent: `${g.emoji ?? '⭐'} ${g.name}（あと${yen(g.target - g.saved)}）` })));
    const amt = el('input', { type: 'number', class: 'price', placeholder: 'いくら いれる？', min: '1' });
    const btn = el('button', { class: 'primary big-add', textContent: '🐷 ちょきんする！' });
    const body = el('div', { class: 'kd-form' }, [
      el('p', { class: 'muted', textContent: `おさいふ: ${yen(o.wallet)}` }),
      labeled('どの もくひょう？', sel),
      labeled('きんがく', amt),
      el('div', { class: 'center' }, [btn]),
    ]);
    const overlay = canvasModal(canvas, body, { title: '🐷 ぶたさんちょきんばこ' });
    btn.addEventListener('click', () => {
      const v = Math.round(Number(amt.value));
      if (!Number.isFinite(v) || v <= 0) { alert('きんがくを いれてね'); return; }
      if (v > o.wallet && !confirm('おさいふより おおいけど だいじょうぶ？')) return;
      overlay.remove();
      a.onDeposit(Number(sel.value), v);
    });
  });

  // プレゼント（30コインで衣装ガチャ）
  canvas.querySelector('#k-present')?.addEventListener('click', async () => {
    if (s.coins < 30) {
      showToast(`プレゼントは30コインであくよ（いま ${s.coins} コイン）`);
      return;
    }
    const r = await a.onPresent();
    if (r) {
      jump();
      showToast(`🎁 ${r.costume === 'beret' ? 'ベレーぼう' : 'マフラー'} をゲット！（のこり ${r.coins} コイン）`, 5000);
    }
  });

  return [wrap];
}
