// こどもモード「マネコタウン」ホーム — デザイン 2a (maneko-home-game-2a.dc.html) の忠実移植。
// マークアップ・色・寸法・アニメーションはモックのまま、数値だけ実データを注入する。
import { Overview, QuickReward, RecentReceipt } from './api';
import { yen, el, labeled } from './ui';
import { phoneCanvas, esc } from './phone';
import { Insight } from './advice';
import { ReactionKind } from './character';
import { canvasModal } from './records';
import { monthlyNeeded } from './insights';
import { journeyTotal, currentStage, journeyPercent, STAGES, openJourney } from './journey';

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

// ---- 2a のパーツ（モックからそのまま） ----------------------------------

// マネコ本体（描き込みリッチ版・300×370）。2a マークアップの忠実コピー。
export function manekoHtml(): string {
  return `
    <div id="m-cat-shadow" style="position:absolute;left:78px;bottom:10px;width:144px;height:26px;border-radius:50%;background:radial-gradient(ellipse at center, rgba(120,70,0,.35), rgba(120,70,0,0) 70%);animation:mshadow 3s ease-in-out infinite"></div>
    <div id="m-cat-body" style="position:absolute;inset:0;animation:mfloat 3s ease-in-out infinite">
      <div style="position:absolute;right:26px;bottom:88px;width:70px;height:24px;border-radius:14px;background:linear-gradient(90deg,#E8791B,#FFB65C);transform-origin:left center;animation:mwag 2.2s ease-in-out infinite;box-shadow:inset 0 -4px 6px rgba(160,80,0,.3)">
        <div style="position:absolute;right:6px;top:3px;bottom:3px;width:8px;border-radius:4px;background:rgba(200,90,10,.55)"></div>
        <div style="position:absolute;right:20px;top:3px;bottom:3px;width:7px;border-radius:4px;background:rgba(200,90,10,.45)"></div>
        <div style="position:absolute;right:33px;top:3px;bottom:3px;width:6px;border-radius:4px;background:rgba(200,90,10,.35)"></div>
      </div>
      <div style="position:absolute;left:96px;bottom:32px;width:46px;height:26px;border-radius:50%;background:linear-gradient(180deg,#FFC56E,#F0912C);box-shadow:inset 0 -4px 6px rgba(170,85,0,.35)"></div>
      <div style="position:absolute;left:160px;bottom:32px;width:46px;height:26px;border-radius:50%;background:linear-gradient(180deg,#FFC56E,#F0912C);box-shadow:inset 0 -4px 6px rgba(170,85,0,.35)"></div>
      <div style="position:absolute;left:70px;bottom:42px;width:160px;height:150px;border-radius:50% 50% 47% 47%;background:radial-gradient(circle at 35% 25%, #FFC96F, #FF9E3D 55%, #E8791B);box-shadow:inset -12px -16px 24px rgba(180,80,0,.30), inset 10px 12px 20px rgba(255,255,255,.35)"></div>
      <div style="position:absolute;left:80px;bottom:150px;width:30px;height:10px;border-radius:6px;background:rgba(200,90,10,.6);transform:rotate(20deg)"></div>
      <div style="position:absolute;left:84px;bottom:126px;width:24px;height:9px;border-radius:6px;background:rgba(200,90,10,.5);transform:rotate(16deg)"></div>
      <div style="position:absolute;left:192px;bottom:150px;width:30px;height:10px;border-radius:6px;background:rgba(200,90,10,.6);transform:rotate(-20deg)"></div>
      <div style="position:absolute;left:194px;bottom:126px;width:24px;height:9px;border-radius:6px;background:rgba(200,90,10,.5);transform:rotate(-16deg)"></div>
      <div style="position:absolute;left:108px;bottom:52px;width:84px;height:92px;border-radius:50%;background:radial-gradient(circle at 42% 28%, #FFF6E0, #FFE3AE)"></div>
      <div style="position:absolute;left:130px;bottom:70px;width:40px;height:40px;border-radius:50%;border:3px solid #E8B62B;background:radial-gradient(circle at 35% 30%, #FFEFAE, #FFD54A 55%, #DFA318);box-shadow:inset 0 -4px 6px rgba(160,100,0,.4);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:800;color:#A9750B">¥</div>
      <div style="position:absolute;left:58px;top:126px;width:32px;height:56px;border-radius:16px;background:linear-gradient(180deg,#FFC56E,#EF8A24);transform-origin:50% 88%;animation:mbeckon 1.5s ease-in-out infinite;box-shadow:inset -4px -6px 8px rgba(170,85,0,.3)"></div>
      <div style="position:absolute;left:208px;top:176px;width:32px;height:52px;border-radius:16px;background:linear-gradient(180deg,#FFC56E,#EF8A24);transform:rotate(-30deg);box-shadow:inset -4px -6px 8px rgba(170,85,0,.3)"></div>
      <div style="position:absolute;left:98px;top:46px;width:0;height:0;border-left:17px solid transparent;border-right:17px solid transparent;border-bottom:34px solid #E8791B;transform:rotate(-16deg)"></div>
      <div style="position:absolute;left:106px;top:58px;width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:18px solid #FFB3BC;transform:rotate(-16deg)"></div>
      <div style="position:absolute;left:186px;top:46px;width:0;height:0;border-left:17px solid transparent;border-right:17px solid transparent;border-bottom:34px solid #E8791B;transform:rotate(16deg)"></div>
      <div style="position:absolute;left:194px;top:60px;width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:18px solid #FFB3BC;transform:rotate(16deg)"></div>
      <div style="position:absolute;left:76px;top:70px;width:148px;height:130px;border-radius:50%;background:radial-gradient(circle at 35% 25%, #FFC96F, #FF9E3D 55%, #E8791B);box-shadow:inset -12px -14px 22px rgba(180,80,0,.28), inset 10px 10px 18px rgba(255,255,255,.35)"></div>
      <div style="position:absolute;left:136px;top:78px;width:7px;height:18px;border-radius:4px;background:#DF7014;transform:rotate(-8deg)"></div>
      <div style="position:absolute;left:148px;top:76px;width:7px;height:20px;border-radius:4px;background:#DF7014"></div>
      <div style="position:absolute;left:160px;top:78px;width:7px;height:18px;border-radius:4px;background:#DF7014;transform:rotate(8deg)"></div>
      <div style="position:absolute;left:80px;top:130px;width:16px;height:7px;border-radius:4px;background:rgba(200,90,10,.5);transform:rotate(-14deg)"></div>
      <div style="position:absolute;left:204px;top:130px;width:16px;height:7px;border-radius:4px;background:rgba(200,90,10,.5);transform:rotate(14deg)"></div>
      <div style="position:absolute;left:122px;top:132px;width:56px;height:36px;border-radius:50%;background:radial-gradient(circle at 50% 30%, #FFF4D8, #FFE6B4)"></div>
      <div style="position:absolute;left:112px;top:112px;width:30px;height:32px;border-radius:50%;background:#FFF9EC;box-shadow:inset 0 2px 3px rgba(120,80,20,.25)">
        <div style="position:absolute;left:5px;top:5px;width:20px;height:22px;border-radius:50%;background:radial-gradient(circle at 40% 30%, #FFC963, #E8871A 60%, #B35E08)"></div>
        <div style="position:absolute;left:11px;top:8px;width:8px;height:17px;border-radius:50%;background:#1A0F08"></div>
        <div style="position:absolute;left:8px;top:8px;width:7px;height:7px;border-radius:50%;background:#FFFFFF"></div>
        <div style="position:absolute;left:19px;top:19px;width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,.9)"></div>
      </div>
      <div style="position:absolute;left:158px;top:112px;width:30px;height:32px;border-radius:50%;background:#FFF9EC;box-shadow:inset 0 2px 3px rgba(120,80,20,.25)">
        <div style="position:absolute;left:5px;top:5px;width:20px;height:22px;border-radius:50%;background:radial-gradient(circle at 40% 30%, #FFC963, #E8871A 60%, #B35E08)"></div>
        <div style="position:absolute;left:11px;top:8px;width:8px;height:17px;border-radius:50%;background:#1A0F08"></div>
        <div style="position:absolute;left:8px;top:8px;width:7px;height:7px;border-radius:50%;background:#FFFFFF"></div>
        <div style="position:absolute;left:19px;top:19px;width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,.9)"></div>
      </div>
      <div style="position:absolute;left:97px;top:150px;width:18px;height:11px;border-radius:50%;background:#FF9AA8;opacity:.85"></div>
      <div style="position:absolute;left:186px;top:150px;width:18px;height:11px;border-radius:50%;background:#FF9AA8;opacity:.85"></div>
      <div style="position:absolute;left:145px;top:144px;width:10px;height:7px;border-radius:50% 50% 60% 60%;background:#F08BA8"></div>
      <div style="position:absolute;left:137px;top:151px;width:12px;height:9px;border-bottom:2.5px solid #8A4B12;border-radius:0 0 12px 12px"></div>
      <div style="position:absolute;left:151px;top:151px;width:12px;height:9px;border-bottom:2.5px solid #8A4B12;border-radius:0 0 12px 12px"></div>
      <div style="position:absolute;left:74px;top:138px;width:26px;height:2.5px;border-radius:2px;background:rgba(140,80,20,.5);transform:rotate(8deg)"></div>
      <div style="position:absolute;left:74px;top:148px;width:26px;height:2.5px;border-radius:2px;background:rgba(140,80,20,.5);transform:rotate(-4deg)"></div>
      <div style="position:absolute;left:200px;top:138px;width:26px;height:2.5px;border-radius:2px;background:rgba(140,80,20,.5);transform:rotate(-8deg)"></div>
      <div style="position:absolute;left:200px;top:148px;width:26px;height:2.5px;border-radius:2px;background:rgba(140,80,20,.5);transform:rotate(4deg)"></div>
      <div style="position:absolute;left:118px;top:190px;width:66px;height:14px;border-radius:8px;background:linear-gradient(180deg,#E8483F,#B92626);box-shadow:inset 0 -3px 4px rgba(120,10,10,.5)"></div>
      <div style="position:absolute;left:141px;top:198px;width:20px;height:20px;border-radius:50%;background:radial-gradient(circle at 38% 30%, #FFEFAE, #FFD54A 55%, #D9971A);box-shadow:0 2px 4px rgba(120,80,0,.4)">
        <div style="position:absolute;left:2px;top:9px;width:16px;height:2px;background:#8A5E0A"></div>
        <div style="position:absolute;left:8px;bottom:2px;width:4px;height:5px;border-radius:2px;background:#8A5E0A"></div>
      </div>
      <div style="position:absolute;left:196px;top:132px;width:48px;height:48px;border-radius:50%;border:3px solid #E8B62B;background:radial-gradient(circle at 35% 30%, #FFEFAE, #FFD54A 55%, #DFA318);box-shadow:inset 0 -5px 7px rgba(160,100,0,.45), 0 5px 10px rgba(180,110,0,.3);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:#A9750B;animation:mspin 3s linear infinite">¥</div>
      <div style="position:absolute;left:52px;top:60px;width:12px;height:12px;background:#FFF3B8;animation:msparkle 2.1s ease-in-out infinite"></div>
      <div style="position:absolute;left:246px;top:96px;width:9px;height:9px;background:#FFF3B8;animation:msparkle 2.1s ease-in-out infinite;animation-delay:-.8s"></div>
    </div>`;
}

// ステージ別のマネコ衣装。manekoHtml と同じ 300×370 座標系に重ねる。
// 貯金の累計が進む（ステージが上がる）ほど、衣装がどんどん豪華になる。
//   0 なし → 1 マフラー → 2 キャップ → 3 シルクハット＋蝶ネクタイ → 4 パイロット → 5 うちゅうヘルメット
export function stageCostumeHtml(stage: number): string {
  switch (stage) {
    case 1: // マフラー
      return `
      <div style="position:absolute;left:104px;top:182px;width:92px;height:22px;border-radius:12px;background:repeating-linear-gradient(45deg,#E8483F 0 10px,#C7362F 10px 20px);box-shadow:0 3px 6px rgba(120,20,20,.3);z-index:3"></div>
      <div style="position:absolute;left:150px;top:198px;width:22px;height:42px;border-radius:6px;background:repeating-linear-gradient(45deg,#E8483F 0 8px,#C7362F 8px 16px);transform:rotate(8deg);z-index:3"></div>
      <div style="position:absolute;left:152px;top:236px;width:24px;height:7px;background:#B92626;border-radius:0 0 4px 4px;transform:rotate(8deg);z-index:3"></div>`;
    case 2: // みどりのキャップ（ベレー）
      return `
      <div style="position:absolute;left:108px;top:34px;width:84px;height:36px;border-radius:50% 50% 46% 46%;background:radial-gradient(circle at 40% 30%,#6FC46F,#3E9E52);box-shadow:inset -6px -8px 10px rgba(20,80,30,.3);z-index:3"></div>
      <div style="position:absolute;left:100px;top:58px;width:52px;height:14px;border-radius:8px;background:#2E7E3E;z-index:3"></div>
      <div style="position:absolute;left:145px;top:28px;width:11px;height:11px;border-radius:50%;background:#2E7E3E;z-index:3"></div>`;
    case 3: // シルクハット＋蝶ネクタイ（リッチ）
      return `
      <div style="position:absolute;left:104px;top:44px;width:92px;height:15px;border-radius:8px;background:#2E2A32;box-shadow:0 3px 6px rgba(20,20,30,.35);z-index:3"></div>
      <div style="position:absolute;left:122px;top:6px;width:56px;height:40px;border-radius:6px 6px 0 0;background:linear-gradient(180deg,#3A3640,#23202A);z-index:3"></div>
      <div style="position:absolute;left:122px;top:38px;width:56px;height:8px;background:#E8483F;z-index:3"></div>
      <div style="position:absolute;left:130px;top:188px;width:0;height:0;border-top:11px solid transparent;border-bottom:11px solid transparent;border-right:16px solid #E8483F;z-index:4"></div>
      <div style="position:absolute;left:154px;top:188px;width:0;height:0;border-top:11px solid transparent;border-bottom:11px solid transparent;border-left:16px solid #E8483F;z-index:4"></div>
      <div style="position:absolute;left:145px;top:192px;width:12px;height:14px;border-radius:3px;background:#B92626;z-index:4"></div>`;
    case 4: // パイロット帽＋ゴーグル
      return `
      <div style="position:absolute;left:100px;top:38px;width:100px;height:42px;border-radius:50% 50% 40% 40%;background:radial-gradient(circle at 40% 30%,#8A6B4A,#5E4630);box-shadow:inset -6px -8px 10px rgba(40,25,10,.35);z-index:3"></div>
      <div style="position:absolute;left:94px;top:60px;width:28px;height:32px;border-radius:0 0 8px 16px;background:#5E4630;z-index:3"></div>
      <div style="position:absolute;left:178px;top:60px;width:28px;height:32px;border-radius:0 0 16px 8px;background:#5E4630;z-index:3"></div>
      <div style="position:absolute;left:104px;top:100px;width:42px;height:36px;border-radius:50%;background:rgba(180,220,255,.5);border:4px solid #4E3A28;z-index:4"></div>
      <div style="position:absolute;left:154px;top:100px;width:42px;height:36px;border-radius:50%;background:rgba(180,220,255,.5);border:4px solid #4E3A28;z-index:4"></div>
      <div style="position:absolute;left:146px;top:112px;width:10px;height:8px;background:#4E3A28;z-index:4"></div>`;
    case 5: // うちゅうヘルメット
      return `
      <div style="position:absolute;left:150px;top:38px;width:4px;height:20px;background:#C9D3DF;z-index:3"></div>
      <div style="position:absolute;left:146px;top:30px;width:12px;height:12px;border-radius:50%;background:#E8483F;box-shadow:0 0 8px #E8483F;animation:msparkle 1.4s ease-in-out infinite;z-index:3"></div>
      <div style="position:absolute;left:66px;top:52px;width:168px;height:162px;border-radius:50%;background:radial-gradient(circle at 35% 28%,rgba(200,235,255,.28),rgba(160,205,245,.14));border:5px solid #E6EEF6;box-shadow:inset -14px -10px 26px rgba(90,130,180,.25),0 0 20px rgba(180,220,255,.5);z-index:4"></div>
      <div style="position:absolute;left:96px;top:190px;width:108px;height:26px;border-radius:14px;background:linear-gradient(180deg,#F5F7FA,#C9D3DF);box-shadow:inset 0 -3px 5px rgba(120,140,170,.35);z-index:5"></div>`;
    default:
      return '';
  }
}

// 下部ナビ（2a のゲームふう・忠実移植）。active のラベルに金の下地。
export function kidsNavHtml(active: KidsTab): string {
  const lbl = (tab: KidsTab, color: string, text: string) =>
    `<span style="font-size:11px;font-weight:800;color:${color};background:${active === tab ? '#FFD54A' : 'rgba(255,253,246,.9)'};border-radius:999px;padding:1px 9px">${text}</span>`;
  return `
  <div style="position:absolute;left:0;right:0;bottom:26px;display:flex;justify-content:center;align-items:flex-end;gap:14px;z-index:20">
    <div data-nav="home" class="hv" style="display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer">
      <div style="width:56px;height:56px;border-radius:50%;border:3.5px solid #FFFDF6;background:radial-gradient(circle at 35% 30%, #FFC94D, #F5A623);box-shadow:0 5px 12px rgba(120,80,20,.35);display:flex;flex-direction:column;align-items:center;justify-content:center">
        <div style="width:0;height:0;border-left:11px solid transparent;border-right:11px solid transparent;border-bottom:10px solid #FFFDF6"></div>
        <div style="width:16px;height:11px;background:#FFFDF6;border-radius:0 0 3px 3px"></div>
      </div>
      ${lbl('home', '#7A4A00', 'ホーム')}
    </div>
    <div data-nav="report" class="hv" style="display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer">
      <div style="width:56px;height:56px;border-radius:50%;border:3.5px solid #FFFDF6;background:radial-gradient(circle at 35% 30%, #7FB3DE, #4E7FB5);box-shadow:0 5px 12px rgba(50,80,120,.35);display:flex;align-items:flex-end;justify-content:center;gap:2.5px;padding-bottom:16px">
        <div style="width:6px;height:9px;border-radius:2px;background:#FFFDF6"></div>
        <div style="width:6px;height:15px;border-radius:2px;background:#FFFDF6"></div>
        <div style="width:6px;height:12px;border-radius:2px;background:#FFFDF6"></div>
      </div>
      ${lbl('report', '#39628F', 'レポート')}
    </div>
    <div data-nav="add" class="hv" style="display:flex;flex-direction:column;align-items:center;gap:3px;margin-bottom:8px;cursor:pointer">
      <div style="width:88px;height:88px;border-radius:50%;border:4px solid #FFFDF6;background:radial-gradient(circle at 35% 28%, #FFEFAE, #FFD54A 50%, #DFA318);box-shadow:0 8px 20px rgba(150,95,10,.45), inset 0 -8px 12px rgba(160,100,0,.4);display:flex;flex-direction:column;align-items:center;justify-content:center;animation:mfloat2 2.6s ease-in-out infinite">
        <span style="font-size:20px;font-weight:800;color:#7A4A00;line-height:1.1">きろく</span>
        <span style="font-size:10px;font-weight:800;color:#A9750B">おこづかい帳</span>
      </div>
    </div>
    <div data-nav="savings" class="hv" style="display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;position:relative">
      <div style="position:absolute;top:-8px;right:-6px;background:#E8483F;color:#FFF8EC;font-size:9px;font-weight:800;border-radius:999px;padding:2px 7px;box-shadow:0 3px 6px rgba(150,20,20,.4);z-index:2">New!</div>
      <div style="width:56px;height:56px;border-radius:50%;border:3.5px solid #FFFDF6;background:radial-gradient(circle at 35% 30%, #F0A0B8, #D96A8A);box-shadow:0 5px 12px rgba(150,60,90,.35);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.5px">
        <div style="width:24px;height:7px;border-radius:50%;background:#FFFDF6;opacity:.7"></div>
        <div style="width:24px;height:7px;border-radius:50%;background:#FFFDF6;opacity:.85"></div>
        <div style="width:24px;height:7px;border-radius:50%;background:#FFFDF6"></div>
      </div>
      ${lbl('savings', '#B9506E', 'ちょきん')}
    </div>
    <div data-nav="menu" class="hv" style="display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer">
      <div style="width:56px;height:56px;border-radius:50%;border:3.5px solid #FFFDF6;background:radial-gradient(circle at 35% 30%, #A88ECB, #7A5BA8);box-shadow:0 5px 12px rgba(80,50,120,.35);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px">
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
  const goalPace = goal ? monthlyNeeded(goal) : null;

  // RPGの旅: 貯金の累計で決まる現在ステージ（衣装＆進捗％の元）
  const jTotal = journeyTotal(o);
  const jStage = currentStage(jTotal);
  const jPct = journeyPercent(jTotal);

  // RPGふう進捗: ちょきんが進むほど街とマネコがリッチになる
  //   25%〜: 道ばたに花が咲く / 50%〜: 花がふえて旗が立つ / 75%〜: マネコに王冠 / 達成: おまつり(紙ふぶき)
  const rich = o.goals.some((g) => g.done) ? 100 : goalPct;
  const flower = (color: string, x: string, y: number, s2 = 1) => `
    <div style="position:absolute;${x};top:${y}px;transform:scale(${s2});z-index:3">
      <div style="position:relative;width:26px;height:42px">
        <div style="position:absolute;left:11px;top:14px;width:4px;height:26px;background:#3E9E6C;border-radius:2px"></div>
        <div style="position:absolute;left:5px;top:26px;width:10px;height:5px;border-radius:50%;background:#3E9E6C;transform:rotate(-30deg)"></div>
        <div style="position:absolute;left:3px;top:0;width:20px;height:20px;border-radius:50%;background:${color};box-shadow:0 2px 4px rgba(120,60,60,.3)"></div>
        <div style="position:absolute;left:9px;top:6px;width:8px;height:8px;border-radius:50%;background:#FFF7C8"></div>
      </div>
    </div>`;
  const richHtml = `
    ${rich >= 25 ? flower('#F06292', 'left:66px', 636) + flower('#7A5BA8', 'right:74px', 596, 0.9) : ''}
    ${rich >= 50 ? flower('#3E9E6C', 'left:96px', 566, 0.8) + `
      <div style="position:absolute;right:40px;top:288px;z-index:3">
        <div style="position:relative;width:40px;height:56px">
          <div style="position:absolute;left:4px;top:0;width:4px;height:56px;background:linear-gradient(180deg,#D9A876,#94551F);border-radius:2px"></div>
          <div style="position:absolute;left:8px;top:2px;width:0;height:0;border-top:9px solid transparent;border-bottom:9px solid transparent;border-left:26px solid #E8483F"></div>
        </div>
      </div>` : ''}
    ${rich >= 100 ? `
      <div style="position:absolute;left:120px;top:230px;width:10px;height:10px;background:#F06292;animation:msparkle 1.5s ease-in-out infinite;z-index:3"></div>
      <div style="position:absolute;right:130px;top:200px;width:9px;height:9px;background:#7CC77A;animation:msparkle 1.5s ease-in-out infinite;animation-delay:-.5s;z-index:3"></div>
      <div style="position:absolute;left:200px;top:180px;width:8px;height:8px;background:#7FB3DE;animation:msparkle 1.5s ease-in-out infinite;animation-delay:-1s;z-index:3"></div>` : ''}`;
  // 王冠（75%〜）。マネコの頭上（300×370 のキャラ座標系）
  const crownHtml = rich >= 75 ? `
    <div style="position:absolute;left:122px;top:16px;z-index:4">
      <div style="position:relative;width:56px;height:32px">
        <div style="position:absolute;left:0;bottom:0;width:56px;height:14px;background:linear-gradient(180deg,#FFE28A,#D9A335);border-radius:3px"></div>
        <div style="position:absolute;left:1px;bottom:12px;width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:14px solid #FFD54A"></div>
        <div style="position:absolute;left:19px;bottom:12px;width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:18px solid #FFD54A"></div>
        <div style="position:absolute;right:1px;bottom:12px;width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:14px solid #FFD54A"></div>
        <div style="position:absolute;left:25px;bottom:4px;width:7px;height:7px;border-radius:50%;background:#E8483F"></div>
      </div>
    </div>` : '';

  // 買ったもの（最新2件をデザインの小物に割り当て）
  const buy1 = a.recent[0];
  const buy2 = a.recent[1];
  const buyLabel = (r: RecentReceipt) => esc(`${(r.store_name || r.items[0]?.name || 'かいもの').slice(0, 7)} ${yen(r.total)}`);

  const coinRain = !!(a.celebrate || o.challengeDone);

  const html = `
  <div style="position:relative;width:402px;height:840px;overflow:hidden;background:linear-gradient(180deg,#5FB2EE 0%,#A8DCFA 30%,#FFE2A0 50%,#FFD489 58%);font-family:'M PLUS Rounded 1c', sans-serif;color:#4A3B28">

    <!-- 光の帯・雲 -->
    <div style="position:absolute;left:-60px;top:-80px;width:200px;height:560px;background:linear-gradient(180deg,rgba(255,255,255,.6),rgba(255,255,255,0) 80%);transform:rotate(24deg);transform-origin:top left"></div>
    <div style="position:absolute;left:60px;top:-80px;width:90px;height:480px;background:linear-gradient(180deg,rgba(255,255,255,.45),rgba(255,255,255,0) 80%);transform:rotate(28deg);transform-origin:top left"></div>
    <div style="position:absolute;right:-20px;top:190px;width:110px;height:36px;border-radius:999px;background:rgba(255,255,255,.85);animation:mcloud 8s ease-in-out infinite"></div>
    <div style="position:absolute;left:10px;top:224px;width:76px;height:26px;border-radius:999px;background:rgba(255,255,255,.7);animation:mcloud 10s ease-in-out infinite;animation-delay:-4s"></div>

    <!-- 地面（石畳＋金の道） -->
    <div style="position:absolute;left:0;right:0;top:300px;bottom:0;background:linear-gradient(180deg,#EFD3A0,#D9AE6E)"></div>
    <div style="position:absolute;left:0;right:0;top:300px;bottom:0;background-image:radial-gradient(ellipse 22px 12px at 50% 50%, rgba(140,95,35,.16) 0 58%, rgba(140,95,35,0) 62%);background-size:58px 32px"></div>
    <div style="position:absolute;left:0;right:0;top:294px;height:28px;background:linear-gradient(180deg,rgba(255,246,214,.95),rgba(255,246,214,0))"></div>
    <div style="position:absolute;left:0;right:0;top:300px;bottom:0;background:linear-gradient(180deg,#FBDD7E 0%,#EDB33F 100%);clip-path:polygon(45% 0, 55% 0, 98% 100%, 2% 100%);box-shadow:inset 0 0 30px rgba(160,100,10,.3)"></div>
    <div style="position:absolute;left:0;right:0;top:300px;bottom:0;opacity:.95;background:repeating-linear-gradient(180deg,#FFF6D8 0 30px, rgba(255,246,216,0) 30px 66px);clip-path:polygon(49.5% 0, 50.5% 0, 52.2% 100%, 47.8% 100%)"></div>

    <!-- 左：パンやさん -->
    <div style="position:absolute;left:10px;top:216px;transform:scale(.68);transform-origin:top left">
      <div style="position:relative;width:160px;height:150px">
        <div style="position:absolute;left:130px;bottom:6px;width:22px;height:112px;background:linear-gradient(90deg,#D9A876,#B9895A);transform:skewY(-38deg);transform-origin:top left;border-radius:0 4px 4px 0"></div>
        <div style="position:absolute;left:0;bottom:0;width:130px;height:112px;border-radius:6px 6px 0 0;background:linear-gradient(180deg,#FFF3DE,#F5DDB4);box-shadow:inset -10px -12px 18px rgba(160,110,40,.18)"></div>
        <div style="position:absolute;left:-6px;bottom:104px;width:142px;height:18px;border-radius:6px;background:linear-gradient(180deg,#C97B4A,#A85E34);box-shadow:0 3px 6px rgba(120,70,20,.3)"></div>
        <div style="position:absolute;left:34px;bottom:118px;width:62px;height:26px;border-radius:8px;background:#FFFDF4;border:3px solid #C97B4A;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;color:#A85E34">パンや</div>
        <div style="position:absolute;left:-4px;bottom:76px;width:138px;height:26px;border-radius:8px 8px 12px 12px;background:repeating-linear-gradient(90deg,#E8483F 0 17px, #FFF6E8 17px 34px);box-shadow:0 4px 8px rgba(120,40,20,.25), inset 0 -5px 6px rgba(150,40,20,.25)"></div>
        <div style="position:absolute;left:12px;bottom:24px;width:34px;height:38px;border-radius:6px;background:linear-gradient(200deg,#FFEBB8,#E8B45C);border:3px solid #C97B4A;box-shadow:inset 0 -6px 8px rgba(160,90,20,.35)"></div>
        <div style="position:absolute;left:60px;bottom:24px;width:34px;height:38px;border-radius:6px;background:linear-gradient(200deg,#FFEBB8,#E8B45C);border:3px solid #C97B4A;box-shadow:inset 0 -6px 8px rgba(160,90,20,.35)"></div>
        <div style="position:absolute;left:102px;bottom:12px;width:24px;height:52px;border-radius:6px 6px 0 0;background:linear-gradient(180deg,#B9743F,#94551F);border:3px solid #8A4E1C"></div>
        <div style="position:absolute;left:0;bottom:0;width:130px;height:12px;background:linear-gradient(180deg,#D9B586,#C09A64);border-radius:0 0 4px 4px"></div>
      </div>
    </div>

    <!-- 右：ゲームショップ -->
    <div style="position:absolute;right:6px;top:234px;transform:scale(.56);transform-origin:top right">
      <div style="position:relative;width:150px;height:146px">
        <div style="position:absolute;left:0;bottom:0;width:134px;height:106px;border-radius:6px 6px 0 0;background:linear-gradient(180deg,#E4F0FB,#BFD9F0);box-shadow:inset -10px -12px 18px rgba(50,90,140,.18)"></div>
        <div style="position:absolute;left:-6px;bottom:98px;width:146px;height:18px;border-radius:6px;background:linear-gradient(180deg,#4E7FB5,#39628F);box-shadow:0 3px 6px rgba(30,60,100,.3)"></div>
        <div style="position:absolute;left:34px;bottom:112px;width:66px;height:26px;border-radius:8px;background:#FFFDF4;border:3px solid #4E7FB5;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;color:#39628F">ゲーム</div>
        <div style="position:absolute;left:-4px;bottom:72px;width:142px;height:24px;border-radius:8px 8px 12px 12px;background:repeating-linear-gradient(90deg,#39B7B7 0 17px, #FFF6E8 17px 34px);box-shadow:0 4px 8px rgba(20,90,90,.25), inset 0 -5px 6px rgba(20,90,90,.25)"></div>
        <div style="position:absolute;left:14px;bottom:22px;width:52px;height:40px;border-radius:6px;background:linear-gradient(200deg,#9FE8E0,#4FB9C9);border:3px solid #4E7FB5;box-shadow:inset 0 -6px 8px rgba(20,80,110,.35)"></div>
        <div style="position:absolute;left:82px;bottom:12px;width:26px;height:50px;border-radius:6px 6px 0 0;background:linear-gradient(180deg,#4E7FB5,#35597F);border:3px solid #2E4E70"></div>
        <div style="position:absolute;left:0;bottom:0;width:134px;height:12px;background:linear-gradient(180deg,#A9C4DC,#8FAECB);border-radius:0 0 4px 4px"></div>
      </div>
    </div>

    <!-- 奥：おかしやさん -->
    <div style="position:absolute;left:152px;top:276px;transform:scale(.36);transform-origin:top left;opacity:.75">
      <div style="position:relative;width:130px;height:120px">
        <div style="position:absolute;left:0;bottom:0;width:130px;height:88px;border-radius:8px 8px 0 0;background:linear-gradient(180deg,#FBD1D9,#F0A9B8)"></div>
        <div style="position:absolute;left:-6px;bottom:80px;width:142px;height:22px;border-radius:8px 8px 12px 12px;background:repeating-linear-gradient(90deg,#E86A8A 0 16px, #FFF6E8 16px 32px)"></div>
        <div style="position:absolute;left:30px;bottom:16px;width:70px;height:42px;border-radius:8px;background:#FFF6E8;border:3px solid #D96A85"></div>
      </div>
    </div>

    <!-- 目標：ショーケース（台座つき） -->
    <div id="k-goal" style="position:absolute;right:14px;top:344px;display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer">
      <div style="position:relative;width:110px;height:78px">
        <div style="position:absolute;left:14px;top:6px;width:82px;height:56px;border-radius:50%;background:radial-gradient(ellipse, rgba(255,226,120,.75), rgba(255,226,120,0) 70%)"></div>
        <div style="position:absolute;left:12px;top:12px;animation:mfloat2 3.2s ease-in-out infinite">
          <div style="position:relative;width:86px;height:40px">
            <div style="position:absolute;left:0;top:0;width:16px;height:40px;border-radius:8px 0 0 8px;background:linear-gradient(180deg,#3FD0CB,#1FA0A4);box-shadow:inset 2px 2px 3px rgba(255,255,255,.4)">
              <div style="position:absolute;left:4px;top:8px;width:8px;height:8px;border-radius:50%;background:#0E6E72"></div>
              <div style="position:absolute;left:4px;top:24px;width:8px;height:8px;border-radius:50%;background:#0E6E72"></div>
            </div>
            <div style="position:absolute;left:70px;top:0;width:16px;height:40px;border-radius:0 8px 8px 0;background:linear-gradient(180deg,#FF9052,#E85D2A);box-shadow:inset -2px 2px 3px rgba(255,255,255,.4)">
              <div style="position:absolute;left:4px;top:8px;width:8px;height:8px;border-radius:50%;background:#A63C12"></div>
              <div style="position:absolute;left:4px;top:24px;width:8px;height:8px;border-radius:50%;background:#A63C12"></div>
            </div>
            <div style="position:absolute;left:16px;top:0;width:54px;height:40px;background:linear-gradient(180deg,#3E4450,#23272F)">
              <div style="position:absolute;left:5px;top:5px;width:44px;height:30px;border-radius:3px;background:linear-gradient(160deg,#8FD4F5,#4B9FD8);box-shadow:inset 0 0 8px rgba(255,255,255,.5);display:flex;align-items:center;justify-content:center">
                <div style="width:16px;height:16px;border-radius:50%;border:2px solid #E8B62B;background:radial-gradient(circle at 35% 30%, #FFEFAE, #FFD54A 55%, #DFA318);display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:800;color:#A9750B">¥</div>
              </div>
            </div>
          </div>
        </div>
        <div style="position:absolute;left:20px;bottom:0;width:70px;height:20px;clip-path:polygon(12% 0, 88% 0, 100% 100%, 0 100%);background:linear-gradient(180deg,#FFE28A,#D9A335);box-shadow:inset 0 4px 5px rgba(255,250,220,.7)"></div>
        <div style="position:absolute;left:2px;top:2px;width:10px;height:10px;background:#FFF7C8;animation:msparkle 1.7s ease-in-out infinite"></div>
        <div style="position:absolute;right:0;top:26px;width:8px;height:8px;background:#FFF7C8;animation:msparkle 1.7s ease-in-out infinite;animation-delay:-.8s"></div>
      </div>
      <div style="width:132px;background:rgba(255,253,246,.95);border:2.5px solid #E8B62B;border-radius:12px;padding:7px 10px;box-shadow:0 4px 10px rgba(120,80,20,.25);display:flex;flex-direction:column;gap:4px">
        ${goal ? `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:4px">
          <span style="font-size:10.5px;font-weight:800;color:#7A5A20;white-space:nowrap">もくひょう ${esc(goal.name.slice(0, 4))}</span>
          <span style="font-size:10.5px;font-weight:800;color:#3E9E6C;white-space:nowrap">${goalPct}%</span>
        </div>
        <div style="height:9px;border-radius:999px;background:#F0E4C8;overflow:hidden">
          <div style="width:${goalPct}%;height:100%;border-radius:999px;background:linear-gradient(90deg,#7CC77A,#3E9E6C)"></div>
        </div>
        <span style="font-size:9.5px;font-weight:700;color:#A08A60">${yen(goal.saved)} / ${yen(goal.target)}</span>
        ${goalPace && !goalPace.overdue ? `<span style="font-size:9.5px;font-weight:800;color:#B9506E">まいつき ${yen(goalPace.perMonth)} ずつ！</span>` : ''}
        ` : o.goals.some((g) => g.done) ? `
        <span style="font-size:10.5px;font-weight:800;color:#3E9E6C">たっせい！🎉 すごい！</span>
        <span style="font-size:9.5px;font-weight:700;color:#A08A60">けいじばんで つぎの もくひょうを きめよう ›</span>
        ` : `
        <span style="font-size:10.5px;font-weight:800;color:#7A5A20">もくひょうをきめよう！</span>
        <span style="font-size:9.5px;font-weight:700;color:#A08A60">けいじばんを タップして とうろく ›</span>
        `}
      </div>
    </div>

    <!-- 買ったもの：おかし（最新のかいもの） -->
    ${buy1 ? `
    <div style="position:absolute;left:16px;top:356px;animation:mfloat2 3.8s ease-in-out infinite">
      <div style="position:relative;width:84px;height:70px">
        <div style="position:absolute;left:40px;top:0;width:30px;height:30px;border-radius:50%;background:repeating-radial-gradient(circle at 50% 50%, #FF6FA0 0 4px, #FFF3F6 4px 8px);border:2.5px solid #E85585;box-shadow:0 3px 6px rgba(180,60,100,.3)"></div>
        <div style="position:absolute;left:53px;top:28px;width:4px;height:24px;border-radius:2px;background:#FFF6E8;box-shadow:0 2px 3px rgba(120,80,20,.3)"></div>
        <div style="position:absolute;left:2px;top:26px;width:38px;height:26px;border-radius:50%;background:linear-gradient(160deg,#FFB1C8,#F06292);box-shadow:inset 3px 4px 5px rgba(255,235,240,.6), 0 3px 6px rgba(180,60,100,.3)">
          <div style="position:absolute;left:15px;top:0;width:8px;height:26px;background:rgba(255,246,232,.75)"></div>
        </div>
        <div style="position:absolute;left:-8px;top:28px;width:0;height:0;border-top:7px solid transparent;border-bottom:7px solid transparent;border-right:12px solid #F06292;transform:rotate(-8deg);margin-top:5px"></div>
        <div style="position:absolute;left:38px;top:33px;width:0;height:0;border-top:7px solid transparent;border-bottom:7px solid transparent;border-left:12px solid #F06292;transform:rotate(8deg)"></div>
        <div style="position:absolute;left:-4px;bottom:-8px;padding:3px 9px;border-radius:999px;background:#FFFDF6;box-shadow:0 3px 8px rgba(120,80,20,.25);font-size:11px;font-weight:800;color:#7A5A20;white-space:nowrap">${buyLabel(buy1)}</div>
      </div>
    </div>` : ''}

    <!-- 買ったもの：ゲームソフト（2番目のかいもの） -->
    ${buy2 ? `
    <div style="position:absolute;left:22px;top:492px;animation:mfloat2 4.4s ease-in-out infinite;animation-delay:-2s">
      <div style="position:relative;width:60px;height:74px">
        <div style="position:absolute;left:0;top:0;width:46px;height:58px;border-radius:5px;background:#FFFDF6;border:2.5px solid #C9B68A;box-shadow:0 4px 8px rgba(120,80,20,.25);transform:rotate(-6deg)">
          <div style="position:absolute;left:4px;top:4px;width:32px;height:34px;border-radius:3px;background:linear-gradient(160deg,#8FD4F5,#3E7FB8);display:flex;align-items:center;justify-content:center">
            <div style="width:14px;height:14px;border-radius:50%;border:2px solid #E8B62B;background:radial-gradient(circle at 35% 30%, #FFEFAE, #FFD54A 55%, #DFA318)"></div>
          </div>
          <div style="position:absolute;left:4px;bottom:5px;width:32px;height:8px;border-radius:2px;background:#E8DFC8"></div>
        </div>
        <div style="position:absolute;left:-6px;bottom:-6px;padding:3px 9px;border-radius:999px;background:#FFFDF6;box-shadow:0 3px 8px rgba(120,80,20,.25);font-size:11px;font-weight:800;color:#7A5A20;white-space:nowrap">${buyLabel(buy2)}</div>
      </div>
    </div>` : ''}

    <!-- コインの雨（モックと同じ2枚・2枚目は無地） -->
    ${coinRain ? `
    <div style="position:absolute;left:90px;top:-40px;animation:mfall 6s linear infinite;opacity:0">${coin(24, 10)}</div>
    <div style="position:absolute;left:300px;top:-40px;animation:mfall 7.2s linear infinite;animation-delay:-3.1s;opacity:0">${coin(20)}</div>
    ` : ''}

    <!-- 進捗ごほうび（花・旗・おまつり） -->
    ${richHtml}

    <!-- マネコ（描き込みリッチ版・75%で王冠） -->
    <div id="k-cat" style="position:absolute;left:50%;bottom:128px;width:300px;height:370px;transform:translateX(-50%) scale(.68);transform-origin:bottom center;cursor:pointer">
      ${manekoHtml()}
      ${stageCostumeHtml(jStage)}
      ${crownHtml}
    </div>

    <!-- マネコのふきだし（じぶんからおしゃべりする） -->
    <div id="k-bubble" style="position:absolute;left:50%;top:346px;transform:translateX(-50%);z-index:8;background:#FFFDF6;border:2.5px solid #4A3B28;border-radius:16px;padding:8px 14px;max-width:245px;box-shadow:0 4px 12px rgba(60,40,20,.25);opacity:0;transition:opacity .35s;pointer-events:none">
      <span id="k-bubble-text" style="font-size:12.5px;font-weight:800;color:#4A3B28;line-height:1.5"></span>
      <div style="position:absolute;left:50%;bottom:-8px;width:13px;height:13px;background:#FFFDF6;border-right:2.5px solid #4A3B28;border-bottom:2.5px solid #4A3B28;transform:translateX(-50%) rotate(45deg)"></div>
    </div>

    <!-- 上部HUD（ゲームふう） -->
    <div style="position:absolute;left:14px;right:14px;top:60px;display:flex;align-items:center;gap:8px">
      <div style="display:flex;align-items:center;gap:6px;background:rgba(255,253,246,.95);border:2.5px solid #E8B62B;border-radius:999px;padding:4px 12px 4px 5px;box-shadow:0 4px 10px rgba(120,80,20,.25)">
        ${coin(24, 11)}
        <span style="font-size:15px;font-weight:800;color:#3D2F1C">${o.wallet.toLocaleString('ja-JP')}</span>
      </div>
      <div style="display:flex;align-items:center;gap:5px;background:rgba(255,253,246,.95);border:2.5px solid #F0A0B8;border-radius:999px;padding:5px 12px;box-shadow:0 4px 10px rgba(120,80,20,.25)">
        <span style="font-size:11px;font-weight:800;color:#B9506E">ごきげん</span>
        <span style="font-size:13px;font-weight:800;color:#F06292;letter-spacing:1px">${heartsStr}</span>
      </div>
      <div id="k-present" class="hv" style="margin-left:auto;display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer">
        <div style="position:relative;width:46px;height:40px">
          <div style="position:absolute;left:3px;bottom:0;width:40px;height:26px;border-radius:5px;background:linear-gradient(180deg,#E8483F,#B92626);box-shadow:inset 0 -4px 5px rgba(100,10,10,.4)"></div>
          <div style="position:absolute;left:0;bottom:22px;width:46px;height:12px;border-radius:4px;background:linear-gradient(180deg,#FF6B5E,#D93A32)"></div>
          <div style="position:absolute;left:20px;bottom:0;width:6px;height:34px;background:#FFD54A"></div>
          <div style="position:absolute;left:13px;bottom:32px;width:8px;height:8px;border-radius:50% 50% 0 50%;border:3px solid #FFD54A;background:transparent"></div>
          <div style="position:absolute;left:25px;bottom:32px;width:8px;height:8px;border-radius:50% 50% 50% 0;border:3px solid #FFD54A;background:transparent"></div>
        </div>
        <span style="font-size:10px;font-weight:800;color:#6B5638;background:rgba(255,253,246,.9);border-radius:999px;padding:1px 8px">プレゼント</span>
      </div>
    </div>
    <div style="position:absolute;left:14px;top:112px;display:flex;align-items:center;gap:8px">
      <div style="width:52px;height:52px;border-radius:50%;background:conic-gradient(#FFC94D 0 ${lvPct}%, #F0E4C8 ${lvPct}% 100%);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 10px rgba(120,80,20,.25)">
        <div style="width:40px;height:40px;border-radius:50%;background:#FFFDF6;display:flex;flex-direction:column;align-items:center;justify-content:center">
          <span style="font-size:9px;font-weight:800;color:#A08A60;line-height:1">Lv</span>
          <span style="font-size:16px;font-weight:800;color:#E8791B;line-height:1">${s.level}</span>
        </div>
      </div>
    </div>
    <div id="k-challenge" style="position:absolute;right:14px;top:112px;width:158px;background:rgba(255,253,246,.95);border:2.5px solid #E8B62B;border-radius:14px;overflow:hidden;box-shadow:0 5px 14px rgba(120,80,20,.25);cursor:pointer">
      <div style="background:linear-gradient(90deg,#FFC94D,#F5A623);padding:4px 10px;font-size:11px;font-weight:800;color:#7A4A00">きょうのチャレンジ</div>
      <div style="padding:7px 10px;display:flex;flex-direction:column;gap:3px">
        ${o.challengeDone ? `
        <span style="font-size:11.5px;font-weight:800;color:#4A3B28;white-space:nowrap">おかいものメモ <span style="font-size:12px;color:#3E9E6C">クリア!</span></span>
        <span style="font-size:10.5px;font-weight:700;color:#3E9E6C">+5 コイン GET ✓</span>
        ` : `
        <span style="font-size:11.5px;font-weight:800;color:#4A3B28">おかいもの メモ あと<span style="font-size:15px;color:#E8483F">1</span>回</span>
        <span style="font-size:10.5px;font-weight:700;color:#3E9E6C">クリアで +5 コイン</span>
        `}
      </div>
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
