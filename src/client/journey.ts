// マネコのぼうけん — RPGふうの「たびマップ」。デザイン v2（マネコマップ.dc.html）の忠実移植。
// **目標1つ = 1つの旅**。選んだ目標の saved/target が進むほど、
// 「びんぼう長屋 → かけだしの町 → にぎわい商店街 → 大都会タワマン → 黄金の都」へと
// 街とマネコの装備が豪華になる。下から上へ進行（下=スタート、上=ゴール）。
// 上部の切替ピルで目標を行き来できる。ホームとは別画面（フルスクリーンの縦スクロール）。
import { Overview, SavingsGoal } from './api';
import { el, yen } from './ui';
import { esc } from './phone';
import { manekoHtml, stageAccessoriesHtml } from './maneko';

// ---- 旅の進捗モデル ------------------------------------------------------
// 目標がまだ無いときのフォールバック（0除算回避＆マップが成立する最小値）。
const GOAL_FALLBACK = 10000;

// 各ステージは「ゴールに対する割合」で置く（ゴール金額が変わっても比率で自動配置）。
export type Stage = { ratio: number; key: string; name: string; sub: string };
export const STAGES: Stage[] = [
  { ratio: 0,    key: 'start', name: 'びんぼう長屋',   sub: '10円玉から スタート' },
  { ratio: 0.25, key: 'town',  name: 'かけだしの町',   sub: 'はたけと パンや' },
  { ratio: 0.50, key: 'shop',  name: 'にぎわい商店街', sub: 'おみせが いっぱい！' },
  { ratio: 0.75, key: 'tower', name: '大都会タワマン', sub: 'たかい たかい ビル！' },
  { ratio: 1,    key: 'gold',  name: '黄金の都',       sub: 'だいふごうネコ！' },
];

// 切替の並び順: 未達成（作成順）→ 達成済み（作成順）。
// ※API は id DESC（新しい順）で返すため、そのままだと目標を追加した瞬間に
//   先頭（＝代表目標）が入れ替わってしまう。作成順(id ASC)に揃えて安定させる。
function goalOrder(o: Overview): SavingsGoal[] {
  const byId = [...o.goals].sort((a, b) => a.id - b.id);
  return [...byId.filter((g) => !g.done), ...byId.filter((g) => g.done)];
}
// 代表目標: 最初の未達成目標（作成順） ?? 最後の達成済み目標（100%お祝い表示用） ?? null。
// 目標を追加しても代表目標は変わらない＝「新しい目標で進捗がリセット/変動して見える」問題を防ぐ。
export function featuredGoal(o: Overview): SavingsGoal | null {
  const ordered = goalOrder(o);
  return ordered.find((g) => !g.done) ?? ordered[ordered.length - 1] ?? null;
}
// ステージ i の到達に必要な金額（ゴール金額 × ステージの割合）
export function stageAt(i: number, goal: number): number {
  return Math.round(STAGES[i].ratio * goal);
}
// 現在のステージ番号（0..4）
export function currentStage(total: number, goal: number): number {
  let i = 0;
  for (let k = 0; k < STAGES.length; k++) if (total >= stageAt(k, goal)) i = k;
  return i;
}
// 旅ぜんたいの達成率（0..100）。floor で、ゴール金額到達前に 100% と出さない
// （round だと ゴール-0.5%相当で 100% になり「達成」表示とロック表示が食い違う）。
export function journeyPercent(total: number, goal: number): number {
  return Math.max(0, Math.min(100, Math.floor((total / goal) * 100)));
}

// ---- レイアウト定数（デザイン v2 の 2680px コンテンツ座標系） ----------------
// ゾーン別ノードの y（402固定ステージ内・上=ゴール, 下=スタート）
const NODE_TOP = [2440, 1900, 1350, 820, 452];   // z1..z5
// マネコ（現在地）ブロックの top（fable確定・ゲート/標識と「いまここ」ピルの衝突回避込み）
const CAT_TOP = [2150, 1650, 1180, 890, 340];    // z1..z5
// カードの座標（left, top, width）。左カードはデザインの実座標のまま、
// 右カードは 7文字タイトルが1行で収まるよう幅150→162。left は設計どおり 214
//（右端 376 ≤ 396 で x396ルールOK。左に寄せると現在ノードの%が隠れる）。
const CARD = [
  { l: 16,  t: 2412, w: 170 },  // z1 左
  { l: 214, t: 1872, w: 162 },  // z2 右
  { l: 16,  t: 1332, w: 170 },  // z3 左
  { l: 214, t: 788,  w: 162 },  // z4 右
  { l: 214, t: 428,  w: 162 },  // z5 右
];

// ---- 背景バンド（フルブリード：overlay幅いっぱい） ------------------------
function bandsHtml(): string {
  return `
    <!-- 黄金の都 sky -->
    <div style="position:absolute;left:0;right:0;top:0;height:600px;background:linear-gradient(180deg,#F2954A 0%,#FCC26A 30%,#FFDD95 60%,#FCE0A6 100%)"></div>
    <!-- 大都会 sky -->
    <div style="position:absolute;left:0;right:0;top:540px;height:620px;background:linear-gradient(180deg,#FCE0A6 0%,#8FC0E8 22%,#6BA6DC 55%,#BFD6EC 100%)"></div>
    <!-- にぎわい -->
    <div style="position:absolute;left:0;right:0;top:1100px;height:560px;background:linear-gradient(180deg,#BFD6EC 0%,#EAD8B0 40%,#E4C98C 100%)"></div>
    <!-- かけだし -->
    <div style="position:absolute;left:0;right:0;top:1620px;height:560px;background:linear-gradient(180deg,#E4C98C 0%,#A9CFE0 30%,#C9DFC2 70%,#BFD8A8 100%)"></div>
    <!-- びんぼう -->
    <div style="position:absolute;left:0;right:0;top:2140px;height:540px;background:linear-gradient(180deg,#BFD8A8 0%,#AEB4A6 30%,#B8AC90 65%,#A2926E 100%)"></div>
    <!-- soft ground vignette everywhere -->
    <div style="position:absolute;left:0;right:0;top:0;bottom:0;background:radial-gradient(ellipse 120% 40% at 50% 0%, rgba(255,255,255,.18), rgba(255,255,255,0) 40%);pointer-events:none"></div>
    <!-- clouds -->
    <div style="position:absolute;left:20px;top:640px;width:120px;height:38px;border-radius:999px;background:radial-gradient(ellipse at 42% 34%,#FFFFFF,rgba(255,255,255,.72));box-shadow:0 9px 16px rgba(90,120,150,.18);animation:mcloud 10s ease-in-out infinite"></div>
    <div style="position:absolute;right:14px;top:780px;width:96px;height:32px;border-radius:999px;background:radial-gradient(ellipse at 42% 34%,#FFFFFF,rgba(255,255,255,.66));box-shadow:0 8px 14px rgba(90,120,150,.16);animation:mcloud 12s ease-in-out infinite;animation-delay:-4s"></div>
    <div style="position:absolute;left:130px;top:920px;width:80px;height:26px;border-radius:999px;background:#FFFFFF;opacity:.9;animation:mcloud 11s ease-in-out infinite;animation-delay:-2s"></div>
    <!-- ZONE4 横断大通り（フルブリード） -->
    <div style="position:absolute;left:0;right:0;top:1024px;height:78px;background:linear-gradient(180deg,#5E6B7A,#49545F);box-shadow:inset 0 4px 8px rgba(20,30,40,.35), inset 0 -4px 8px rgba(20,30,40,.3)"></div>
    <div style="position:absolute;left:0;right:0;top:1024px;height:5px;background:linear-gradient(180deg,#D9B45C,#B8923C)"></div>
    <div style="position:absolute;left:0;right:0;top:1097px;height:5px;background:linear-gradient(180deg,#D9B45C,#B8923C)"></div>
    <div style="position:absolute;left:0;right:0;top:1060px;height:4px;background:repeating-linear-gradient(90deg,#F2E6C4 0 22px, rgba(0,0,0,0) 22px 44px);opacity:.8"></div>`;
}

// ---- 402px固定ステージの景色（道・建物・ゲート・バナー。ノード/カード/マネコは動的で別途） ----
function sceneryHtml(): string {
  return `
    <!-- ゾーン別の道（土→石→レンガ→金縁アスファルト→金）。※z1土道は 400→500 に延長（スタートバナーに届かせる） -->
    <div style="position:absolute;left:50%;top:130px;height:440px;width:30px;transform:translateX(-50%);border-radius:15px 15px 0 0;background:linear-gradient(180deg,#FBE491,#EDB33F);box-shadow:0 0 0 3px rgba(180,130,30,.25), inset -4px 0 6px rgba(160,100,10,.3)"></div>
    <div style="position:absolute;left:50%;top:570px;height:550px;width:30px;transform:translateX(-50%);background:linear-gradient(180deg,#6E7987,#5A6673);border-left:3px solid #D9B45C;border-right:3px solid #D9B45C;box-shadow:inset -4px 0 6px rgba(20,30,40,.35)"></div>
    <div style="position:absolute;left:50%;top:1120px;height:500px;width:30px;transform:translateX(-50%);background:repeating-linear-gradient(180deg,#CE8760 0 14px,#B96F48 14px 17px);border-left:3px solid #E8D5B0;border-right:3px solid #E8D5B0;box-shadow:inset -4px 0 6px rgba(140,60,30,.3)"></div>
    <div style="position:absolute;left:50%;top:1620px;height:520px;width:28px;transform:translateX(-50%);background-color:#B9AE94;background-image:radial-gradient(circle at 30% 24%, #CFC6AC 0 5px, rgba(0,0,0,0) 6px),radial-gradient(circle at 72% 68%, #C4BAA0 0 5px, rgba(0,0,0,0) 6px);background-size:22px 26px;box-shadow:inset -4px 0 6px rgba(90,80,50,.35)"></div>
    <div style="position:absolute;left:50%;top:2140px;height:500px;width:24px;transform:translateX(-50%);border-radius:0 0 12px 12px;background:linear-gradient(180deg,#AC9268,#9A8158);box-shadow:inset -4px 0 6px rgba(80,60,30,.35)"></div>

    <!-- CENTER PATH（白破線）。※bottom 150→60 に延長 -->
    <div style="position:absolute;left:50%;top:130px;bottom:60px;width:10px;transform:translateX(-50%);border-radius:8px;background:repeating-linear-gradient(180deg, rgba(255,255,255,.88) 0 18px, rgba(255,255,255,0) 18px 38px)"></div>

    <!-- ===== ZONE 5 : 黄金の都 ===== -->
    <div style="position:absolute;left:50%;top:40px;width:340px;height:340px;transform:translateX(-50%);border-radius:50%;background:radial-gradient(circle,rgba(255,232,160,.9),rgba(255,232,160,0) 68%);filter:blur(3px)"></div>
    <div style="position:absolute;left:50%;top:20px;transform:translateX(-50%);display:flex;align-items:center;gap:8px;background:#FFFDF6;border:3px solid #E8B62B;border-radius:16px;padding:9px 18px;box-shadow:0 8px 20px rgba(150,100,20,.28);white-space:nowrap">
      <div style="width:20px;height:20px;background:repeating-conic-gradient(#2E2A24 0 25%, #FFF 0 50%) 0/10px 10px;border-radius:3px"></div>
      <div style="font-size:15px;font-weight:800;color:#3D2F1C">ゴールは <span style="color:#C0392B">黄金の都</span> !</div>
    </div>
    <div style="position:absolute;left:0;right:0;top:360px;height:200px;background:linear-gradient(180deg,#FBDD7E,#EDB33F);clip-path:polygon(42% 0,58% 0,74% 100%,26% 100%);box-shadow:inset 0 0 30px rgba(160,100,10,.3)"></div>
    <div style="position:absolute;left:50%;top:180px;transform:translateX(-50%);width:230px;height:210px">
      <div style="position:absolute;left:50%;bottom:-6px;width:220px;height:26px;border-radius:50%;background:rgba(120,80,10,.24);filter:blur(4px);transform:translateX(-50%)"></div>
      <div style="position:absolute;left:6px;bottom:8px;width:46px;height:120px">
        <div style="position:absolute;right:-13px;bottom:0;width:13px;height:120px;background:linear-gradient(180deg,#D9A83E,#B4842A);transform:skewY(-40deg);transform-origin:left bottom"></div>
        <div style="position:absolute;left:0;bottom:0;width:46px;height:120px;border-radius:4px 4px 0 0;background:linear-gradient(90deg,#FFEDB0 0%,#F1CE78 70%,#E3BA5A 100%);box-shadow:inset -6px -8px 12px rgba(150,100,20,.28)"></div>
        <div style="position:absolute;left:-3px;bottom:118px;width:52px;height:0;border-left:26px solid transparent;border-right:26px solid transparent;border-bottom:30px solid #C0392B"></div>
        <div style="position:absolute;left:22px;bottom:146px;width:3px;height:14px;background:#8A5E0A"></div>
        <div style="position:absolute;left:26px;bottom:153px;width:15px;height:9px;background:#F5C542;transform-origin:left center;animation:mflag 2.4s ease-in-out infinite"></div>
        <div style="position:absolute;left:14px;bottom:34px;width:16px;height:22px;border-radius:8px 8px 0 0;background:linear-gradient(180deg,#B98A2E,#8A6410)"></div>
      </div>
      <div style="position:absolute;right:6px;bottom:8px;width:46px;height:120px">
        <div style="position:absolute;right:-13px;bottom:0;width:13px;height:120px;background:linear-gradient(180deg,#D9A83E,#B4842A);transform:skewY(-40deg);transform-origin:left bottom"></div>
        <div style="position:absolute;left:0;bottom:0;width:46px;height:120px;border-radius:4px 4px 0 0;background:linear-gradient(90deg,#FFEDB0 0%,#F1CE78 70%,#E3BA5A 100%);box-shadow:inset -6px -8px 12px rgba(150,100,20,.28)"></div>
        <div style="position:absolute;left:-3px;bottom:118px;width:52px;height:0;border-left:26px solid transparent;border-right:26px solid transparent;border-bottom:30px solid #C0392B"></div>
        <div style="position:absolute;left:22px;bottom:146px;width:3px;height:14px;background:#8A5E0A"></div>
        <div style="position:absolute;left:26px;bottom:153px;width:15px;height:9px;background:#F5C542;transform-origin:left center;animation:mflag 2.4s ease-in-out infinite;animation-delay:-1s"></div>
        <div style="position:absolute;left:14px;bottom:34px;width:16px;height:22px;border-radius:8px 8px 0 0;background:linear-gradient(180deg,#B98A2E,#8A6410)"></div>
      </div>
      <div style="position:absolute;left:50%;bottom:8px;transform:translateX(-50%);width:104px;height:150px">
        <div style="position:absolute;right:-16px;bottom:0;width:16px;height:150px;background:linear-gradient(180deg,#D9A83E,#B4842A);transform:skewY(-40deg);transform-origin:left bottom"></div>
        <div style="position:absolute;left:0;bottom:0;width:104px;height:150px;border-radius:6px 6px 0 0;background:linear-gradient(90deg,#FFF3CC 0%,#F3D585 65%,#E7C062 100%);box-shadow:inset -8px -10px 16px rgba(150,100,20,.26),inset 6px 6px 12px rgba(255,255,255,.4)"></div>
        <div style="position:absolute;left:-4px;bottom:148px;width:112px;height:0;border-left:56px solid transparent;border-right:56px solid transparent;border-bottom:42px solid #B0332B"></div>
        <div style="position:absolute;left:50px;bottom:186px;width:4px;height:18px;background:#8A5E0A"></div>
        <div style="position:absolute;left:55px;bottom:196px;width:20px;height:11px;background:#F5C542;transform-origin:left center;animation:mflag 2.2s ease-in-out infinite"></div>
        <div style="position:absolute;left:38px;bottom:0;width:44px;height:60px;border-radius:22px 22px 0 0;background:linear-gradient(180deg,#8A5E0A,#5E3E06)"></div>
        <div style="position:absolute;left:44px;bottom:0;width:32px;height:50px;border-radius:16px 16px 0 0;background:linear-gradient(180deg,#C89A2E,#9A731C)"></div>
        <div style="position:absolute;left:50px;bottom:86px;width:22px;height:22px;border-radius:50%;border:2px solid #B0332B;background:radial-gradient(circle at 35% 30%,#FFF3C8,#FFD54A);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#A9750B">¥</div>
      </div>
    </div>
    <div style="position:absolute;left:56px;top:400px;width:60px;height:34px">
      <div style="position:absolute;left:0;bottom:0;width:22px;height:22px;border-radius:50%;border:2px solid #E8B62B;background:radial-gradient(circle at 35% 30%,#FFEFAE,#FFD54A 55%,#DFA318)"></div>
      <div style="position:absolute;left:16px;bottom:0;width:22px;height:22px;border-radius:50%;border:2px solid #E8B62B;background:radial-gradient(circle at 35% 30%,#FFEFAE,#FFD54A 55%,#DFA318);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#A9750B">¥</div>
      <div style="position:absolute;left:32px;bottom:0;width:22px;height:22px;border-radius:50%;border:2px solid #E8B62B;background:radial-gradient(circle at 35% 30%,#FFEFAE,#FFD54A 55%,#DFA318)"></div>
      <div style="position:absolute;left:12px;bottom:16px;width:22px;height:22px;border-radius:50%;border:2px solid #E8B62B;background:radial-gradient(circle at 35% 30%,#FFEFAE,#FFD54A 55%,#DFA318)"></div>
    </div>
    <div style="position:absolute;right:60px;top:300px;width:12px;height:12px;background:#FFF7C8;animation:msparkle 1.8s ease-in-out infinite"></div>
    <div style="position:absolute;left:70px;top:250px;width:10px;height:10px;background:#FFF7C8;animation:msparkle 2.1s ease-in-out infinite;animation-delay:-.7s"></div>

    <!-- ===== ZONE 4 : 大都会タワマン ===== -->
    <div style="position:absolute;left:-20px;right:-20px;top:700px;height:70px;display:flex;align-items:flex-end;gap:5px;opacity:.3;filter:blur(1.4px);padding:0 10px">
      <div style="flex:1;height:60%;background:#8FA9C4;border-radius:2px 2px 0 0"></div>
      <div style="flex:1;height:90%;background:#7F9CBA;border-radius:2px 2px 0 0"></div>
      <div style="flex:1;height:45%;background:#94ADC6;border-radius:2px 2px 0 0"></div>
      <div style="flex:1;height:75%;background:#88A3C0;border-radius:2px 2px 0 0"></div>
      <div style="flex:1;height:100%;background:#8FA9C4;border-radius:2px 2px 0 0"></div>
      <div style="flex:1;height:55%;background:#7F9CBA;border-radius:2px 2px 0 0"></div>
      <div style="flex:1;height:82%;background:#90AAC5;border-radius:2px 2px 0 0"></div>
    </div>
    <div style="position:absolute;left:20px;top:560px;width:64px;height:210px">
      <div style="position:absolute;left:50%;bottom:-8px;width:88px;height:20px;border-radius:50%;background:rgba(40,60,90,.22);filter:blur(4px);transform:translateX(-50%)"></div>
      <div style="position:absolute;right:-15px;bottom:0;width:15px;height:210px;background:linear-gradient(180deg,#7C93AD,#5E7690);transform:skewY(-36deg);transform-origin:left bottom"></div>
      <div style="position:absolute;left:0;top:-9px;width:64px;height:15px;background:linear-gradient(180deg,#E4EDF6,#C2D2E2);transform:skewX(-54deg);transform-origin:bottom left;border-radius:3px 3px 0 0"></div>
      <div style="position:absolute;left:0;bottom:0;width:64px;height:210px;border-radius:5px 5px 0 0;background-image:linear-gradient(180deg,rgba(255,255,255,.35),rgba(255,255,255,0) 20%),repeating-linear-gradient(0deg,rgba(88,120,158,.4) 0 3px,transparent 3px 18px),repeating-linear-gradient(90deg,rgba(88,120,158,.32) 0 3px,transparent 3px 15px),linear-gradient(90deg,#EAF1F8 0%,#CBD9E8 62%,#B4C6D9 100%);box-shadow:inset -8px -10px 18px rgba(70,100,140,.24),inset 6px 6px 12px rgba(255,255,255,.5)"></div>
      <div style="position:absolute;left:10px;bottom:34px;width:9px;height:12px;border-radius:2px;background:#FFDE8A;box-shadow:0 0 5px rgba(255,210,110,.7)"></div>
      <div style="position:absolute;left:34px;bottom:100px;width:9px;height:12px;border-radius:2px;background:#FFDE8A;box-shadow:0 0 5px rgba(255,210,110,.7)"></div>
      <div style="position:absolute;left:22px;bottom:164px;width:9px;height:12px;border-radius:2px;background:#FFDE8A;box-shadow:0 0 5px rgba(255,210,110,.7)"></div>
    </div>
    <div style="position:absolute;right:16px;top:530px;width:70px;height:240px">
      <div style="position:absolute;left:50%;bottom:-8px;width:94px;height:20px;border-radius:50%;background:rgba(40,60,90,.22);filter:blur(4px);transform:translateX(-50%)"></div>
      <div style="position:absolute;right:-16px;bottom:0;width:16px;height:240px;background:linear-gradient(180deg,#748BA6,#566E88);transform:skewY(-36deg);transform-origin:left bottom"></div>
      <div style="position:absolute;left:0;top:-10px;width:70px;height:16px;background:linear-gradient(180deg,#E4EDF6,#C2D2E2);transform:skewX(-54deg);transform-origin:bottom left;border-radius:3px 3px 0 0"></div>
      <div style="position:absolute;left:0;bottom:0;width:70px;height:240px;border-radius:5px 5px 0 0;background-image:linear-gradient(180deg,rgba(255,255,255,.35),rgba(255,255,255,0) 18%),repeating-linear-gradient(0deg,rgba(80,112,150,.42) 0 3px,transparent 3px 18px),repeating-linear-gradient(90deg,rgba(80,112,150,.34) 0 3px,transparent 3px 16px),linear-gradient(90deg,#E3ECF5 0%,#C3D3E4 62%,#AAC0D6 100%);box-shadow:inset -9px -10px 18px rgba(60,92,132,.26),inset 6px 6px 12px rgba(255,255,255,.5)"></div>
      <div style="position:absolute;left:14px;bottom:40px;width:10px;height:13px;border-radius:2px;background:#FFDE8A;box-shadow:0 0 5px rgba(255,210,110,.7)"></div>
      <div style="position:absolute;left:40px;bottom:120px;width:10px;height:13px;border-radius:2px;background:#FFDE8A;box-shadow:0 0 5px rgba(255,210,110,.7)"></div>
      <div style="position:absolute;left:24px;bottom:190px;width:10px;height:13px;border-radius:2px;background:#FFDE8A;box-shadow:0 0 5px rgba(255,210,110,.7)"></div>
    </div>
    <div style="position:absolute;left:50%;top:582px;transform:translateX(-50%);width:78px;height:186px;opacity:.96">
      <div style="position:absolute;right:-16px;bottom:0;width:16px;height:186px;background:linear-gradient(180deg,#8199B4,#63798F);transform:skewY(-36deg);transform-origin:left bottom"></div>
      <div style="position:absolute;left:0;top:-9px;width:78px;height:15px;background:linear-gradient(180deg,#EDF3F9,#CCDAE7);transform:skewX(-54deg);transform-origin:bottom left;border-radius:3px 3px 0 0"></div>
      <div style="position:absolute;left:0;bottom:0;width:78px;height:186px;border-radius:6px 6px 0 0;background-image:linear-gradient(180deg,rgba(255,255,255,.4),rgba(255,255,255,0) 18%),repeating-linear-gradient(0deg,rgba(92,124,162,.36) 0 3px,transparent 3px 19px),repeating-linear-gradient(90deg,rgba(92,124,162,.3) 0 3px,transparent 3px 16px),linear-gradient(90deg,#EEF4FA 0%,#D2DFEC 64%,#BCCEDE 100%);box-shadow:inset -8px -10px 16px rgba(70,100,140,.2),inset 6px 6px 12px rgba(255,255,255,.55)"></div>
      <div style="position:absolute;left:16px;bottom:56px;width:10px;height:13px;border-radius:2px;background:#FFDE8A;box-shadow:0 0 5px rgba(255,210,110,.7)"></div>
      <div style="position:absolute;left:46px;bottom:126px;width:10px;height:13px;border-radius:2px;background:#FFDE8A;box-shadow:0 0 5px rgba(255,210,110,.7)"></div>
    </div>
    <!-- z4: 中層ビル（左右・アイソメ） -->
    <div style="position:absolute;left:8px;top:900px;width:74px;height:118px">
      <div style="position:absolute;left:50%;bottom:-6px;width:96px;height:16px;border-radius:50%;background:rgba(40,60,90,.2);filter:blur(4px);transform:translateX(-50%)"></div>
      <div style="position:absolute;right:-11px;bottom:0;width:11px;height:118px;background:linear-gradient(180deg,#B08850,#8E6A38);transform:skewY(-36deg);transform-origin:left bottom"></div>
      <div style="position:absolute;left:0;top:-7px;width:74px;height:12px;background:linear-gradient(180deg,#FFF3D6,#EDD9A8);transform:skewX(-54deg);transform-origin:bottom left;border-radius:3px 3px 0 0"></div>
      <div style="position:absolute;left:0;bottom:0;width:74px;height:118px;border-radius:4px 4px 0 0;background-image:repeating-linear-gradient(0deg,rgba(150,110,50,.35) 0 3px,transparent 3px 17px),repeating-linear-gradient(90deg,rgba(150,110,50,.28) 0 3px,transparent 3px 16px),linear-gradient(90deg,#F7E8C6 0%,#E8D0A0 62%,#D9BC84 100%);box-shadow:inset -7px -8px 14px rgba(140,100,40,.24),inset 5px 5px 10px rgba(255,255,255,.5)"></div>
      <div style="position:absolute;left:24px;bottom:0;width:26px;height:26px;border-radius:8px 8px 0 0;background:linear-gradient(180deg,#C89A2E,#9A731C)"></div>
      <div style="position:absolute;left:12px;bottom:64px;width:9px;height:11px;border-radius:2px;background:#FFDE8A;box-shadow:0 0 5px rgba(255,210,110,.7)"></div>
    </div>
    <div style="position:absolute;right:12px;top:892px;width:70px;height:124px">
      <div style="position:absolute;left:50%;bottom:-6px;width:92px;height:16px;border-radius:50%;background:rgba(40,60,90,.2);filter:blur(4px);transform:translateX(-50%)"></div>
      <div style="position:absolute;right:-11px;bottom:0;width:11px;height:124px;background:linear-gradient(180deg,#6E8AA8,#52708C);transform:skewY(-36deg);transform-origin:left bottom"></div>
      <div style="position:absolute;left:0;top:-7px;width:70px;height:12px;background:linear-gradient(180deg,#E8F1F9,#C8D9E8);transform:skewX(-54deg);transform-origin:bottom left;border-radius:3px 3px 0 0"></div>
      <div style="position:absolute;left:0;bottom:0;width:70px;height:124px;border-radius:4px 4px 0 0;background-image:repeating-linear-gradient(0deg,rgba(80,112,150,.4) 0 3px,transparent 3px 16px),repeating-linear-gradient(90deg,rgba(80,112,150,.3) 0 3px,transparent 3px 15px),linear-gradient(90deg,#E6EFF8 0%,#C6D8EA 62%,#AEC6DC 100%);box-shadow:inset -7px -8px 14px rgba(60,92,132,.26),inset 5px 5px 10px rgba(255,255,255,.5)"></div>
      <div style="position:absolute;left:8px;bottom:26px;width:54px;height:14px;border-radius:6px 6px 8px 8px;background:repeating-linear-gradient(90deg,#F5C542 0 11px,#FFF6E8 11px 22px);box-shadow:0 3px 5px rgba(150,100,20,.3)"></div>
      <div style="position:absolute;left:22px;bottom:0;width:26px;height:26px;border-radius:8px 8px 0 0;background:linear-gradient(180deg,#8A5E0A,#5E3E06)"></div>
    </div>
    <!-- z4: 歩道の植栽（金のプランター） -->
    <div style="position:absolute;right:98px;top:972px;width:40px;height:50px">
      <div style="position:absolute;left:7px;bottom:0;width:26px;height:16px;clip-path:polygon(8% 0,92% 0,100% 100%,0 100%);background:linear-gradient(180deg,#F5C542,#C89A2E)"></div>
      <div style="position:absolute;left:3px;bottom:13px;width:34px;height:34px;border-radius:50%;background:radial-gradient(circle at 38% 30%,#82CC52,#549E36);box-shadow:inset -5px -6px 10px rgba(30,80,20,.4)"></div>
    </div>
    <!-- z4: 横断歩道＋くるま -->
    <div style="position:absolute;left:50%;top:1032px;width:72px;height:62px;transform:translateX(-50%);background:repeating-linear-gradient(180deg,rgba(255,255,255,.92) 0 9px,rgba(0,0,0,0) 9px 20px);border-radius:3px"></div>
    <div style="position:absolute;left:18px;top:1040px;width:88px;height:40px">
      <div style="position:absolute;left:0;bottom:8px;width:88px;height:22px;border-radius:12px 14px 6px 6px;background:linear-gradient(180deg,#F5C542,#D9A020);box-shadow:inset -6px -5px 8px rgba(150,100,10,.4)"></div>
      <div style="position:absolute;left:20px;bottom:24px;width:44px;height:16px;border-radius:10px 12px 0 0;background:linear-gradient(180deg,#FFE9A0,#EDC868)"></div>
      <div style="position:absolute;left:26px;bottom:26px;width:14px;height:11px;border-radius:4px;background:linear-gradient(180deg,#BFE0F5,#8FBEDE)"></div>
      <div style="position:absolute;left:44px;bottom:26px;width:14px;height:11px;border-radius:4px;background:linear-gradient(180deg,#BFE0F5,#8FBEDE)"></div>
      <div style="position:absolute;left:12px;bottom:0;width:16px;height:16px;border-radius:50%;background:#2E2A24;box-shadow:inset 0 0 0 4px #4A443C"></div>
      <div style="position:absolute;left:60px;bottom:0;width:16px;height:16px;border-radius:50%;background:#2E2A24;box-shadow:inset 0 0 0 4px #4A443C"></div>
    </div>
    <div style="position:absolute;right:20px;top:1052px;width:76px;height:36px">
      <div style="position:absolute;left:0;bottom:8px;width:76px;height:20px;border-radius:12px 12px 6px 6px;background:linear-gradient(180deg,#E8685C,#C0392B);box-shadow:inset -5px -5px 8px rgba(130,30,20,.4)"></div>
      <div style="position:absolute;left:16px;bottom:22px;width:38px;height:14px;border-radius:10px 10px 0 0;background:linear-gradient(180deg,#F5A8A0,#E8685C)"></div>
      <div style="position:absolute;left:21px;bottom:24px;width:12px;height:10px;border-radius:3px;background:linear-gradient(180deg,#BFE0F5,#8FBEDE)"></div>
      <div style="position:absolute;left:37px;bottom:24px;width:12px;height:10px;border-radius:3px;background:linear-gradient(180deg,#BFE0F5,#8FBEDE)"></div>
      <div style="position:absolute;left:10px;bottom:0;width:14px;height:14px;border-radius:50%;background:#2E2A24;box-shadow:inset 0 0 0 3px #4A443C"></div>
      <div style="position:absolute;left:52px;bottom:0;width:14px;height:14px;border-radius:50%;background:#2E2A24;box-shadow:inset 0 0 0 3px #4A443C"></div>
    </div>

    <!-- ===== ZONE 3 : にぎわい商店街 ===== -->
    <div style="position:absolute;left:22px;top:1180px;width:110px;height:120px">
      <div style="position:absolute;left:50%;bottom:-6px;width:130px;height:20px;border-radius:50%;background:rgba(120,70,10,.2);filter:blur(4px);transform:translateX(-50%)"></div>
      <div style="position:absolute;right:-15px;bottom:0;width:15px;height:96px;background:linear-gradient(180deg,#D0A972,#B08850);transform:skewY(-38deg);transform-origin:left bottom"></div>
      <div style="position:absolute;left:0;top:20px;width:110px;height:12px;background:linear-gradient(180deg,#FFF6E0,#F1DDB6);transform:skewX(-52deg);transform-origin:bottom left"></div>
      <div style="position:absolute;left:0;bottom:0;width:110px;height:96px;border-radius:4px 4px 0 0;background:linear-gradient(90deg,#FFF3DE 0%,#F3DBB2 64%,#E7C88E 100%);box-shadow:inset -8px -10px 16px rgba(160,110,40,.2),inset 6px 6px 10px rgba(255,255,255,.45)"></div>
      <div style="position:absolute;left:-4px;bottom:74px;width:120px;height:18px;border-radius:6px;background:linear-gradient(180deg,#C97B4A,#A85E34);box-shadow:0 3px 6px rgba(120,70,20,.3)"></div>
      <div style="position:absolute;left:28px;bottom:86px;width:54px;height:22px;border-radius:7px;background:#FFFDF4;border:3px solid #C97B4A;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#A85E34">パンや</div>
      <div style="position:absolute;left:-3px;bottom:52px;width:116px;height:22px;border-radius:6px 6px 10px 10px;background:repeating-linear-gradient(90deg,#E8483F 0 15px,#FFF6E8 15px 30px);box-shadow:0 4px 8px rgba(120,40,20,.22)"></div>
      <div style="position:absolute;left:12px;bottom:16px;width:30px;height:34px;border-radius:6px;background:linear-gradient(200deg,#FFEBB8,#E8B45C);border:3px solid #C97B4A"></div>
      <div style="position:absolute;left:78px;bottom:0;width:24px;height:48px;border-radius:6px 6px 0 0;background:linear-gradient(180deg,#B9743F,#94551F);border:3px solid #8A4E1C"></div>
    </div>
    <div style="position:absolute;right:20px;top:1230px;width:100px;height:106px">
      <div style="position:absolute;left:50%;bottom:-6px;width:120px;height:18px;border-radius:50%;background:rgba(40,80,120,.18);filter:blur(4px);transform:translateX(-50%)"></div>
      <div style="position:absolute;right:-14px;bottom:0;width:14px;height:86px;background:linear-gradient(180deg,#8FAAC6,#6E8AA8);transform:skewY(-38deg);transform-origin:left bottom"></div>
      <div style="position:absolute;left:0;top:18px;width:100px;height:11px;background:linear-gradient(180deg,#EAF3FB,#CBDCEC);transform:skewX(-52deg);transform-origin:bottom left"></div>
      <div style="position:absolute;left:0;bottom:0;width:100px;height:86px;border-radius:4px 4px 0 0;background:linear-gradient(90deg,#E9F2FB 0%,#C8DBEE 64%,#B0C9E0 100%);box-shadow:inset -8px -10px 16px rgba(50,90,140,.2),inset 6px 6px 10px rgba(255,255,255,.5)"></div>
      <div style="position:absolute;left:-4px;bottom:66px;width:108px;height:16px;border-radius:6px;background:linear-gradient(180deg,#4E7FB5,#39628F);box-shadow:0 3px 6px rgba(30,60,100,.3)"></div>
      <div style="position:absolute;left:24px;bottom:78px;width:52px;height:20px;border-radius:7px;background:#FFFDF4;border:3px solid #4E7FB5;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#39628F">ゲーム</div>
      <div style="position:absolute;left:-3px;bottom:46px;width:106px;height:20px;border-radius:6px 6px 10px 10px;background:repeating-linear-gradient(90deg,#39B7B7 0 15px,#FFF6E8 15px 30px);box-shadow:0 4px 8px rgba(20,90,90,.22)"></div>
      <div style="position:absolute;left:12px;bottom:14px;width:40px;height:32px;border-radius:6px;background:linear-gradient(200deg,#9FE8E0,#4FB9C9);border:3px solid #4E7FB5"></div>
      <div style="position:absolute;left:66px;bottom:0;width:24px;height:46px;border-radius:6px 6px 0 0;background:linear-gradient(180deg,#4E7FB5,#35597F);border:3px solid #2E4E70"></div>
    </div>
    <div style="position:absolute;left:52px;top:1408px;width:26px;height:70px">
      <div style="position:absolute;left:10px;top:18px;width:6px;height:52px;background:linear-gradient(90deg,#3E4A55,#5E6E7A);border-radius:3px"></div>
      <div style="position:absolute;left:2px;top:6px;width:22px;height:16px;border-radius:6px 6px 10px 10px;background:radial-gradient(circle at 40% 30%,#FFF3B8,#FFD54A);box-shadow:0 0 12px rgba(255,213,74,.7)"></div>
    </div>
    <div style="position:absolute;left:80px;top:1470px;width:70px;height:20px;display:flex;gap:8px;align-items:flex-end">
      <div style="width:10px;height:10px;border-radius:50%;background:#F06292"></div>
      <div style="width:10px;height:10px;border-radius:50%;background:#F5C542"></div>
      <div style="width:10px;height:10px;border-radius:50%;background:#EF6FA0"></div>
    </div>
    <!-- z3: 右側の街灯＆万国旗 -->
    <div style="position:absolute;right:52px;top:1400px;width:26px;height:70px">
      <div style="position:absolute;left:10px;top:18px;width:6px;height:52px;background:linear-gradient(90deg,#3E4A55,#5E6E7A);border-radius:3px"></div>
      <div style="position:absolute;left:2px;top:6px;width:22px;height:16px;border-radius:6px 6px 10px 10px;background:radial-gradient(circle at 40% 30%,#FFF3B8,#FFD54A);box-shadow:0 0 12px rgba(255,213,74,.7)"></div>
    </div>
    <div style="position:absolute;left:30px;top:1492px;width:342px;height:30px">
      <div style="position:absolute;left:0;right:0;top:6px;height:2.5px;background:rgba(90,60,20,.45);border-radius:2px;transform:rotate(1.2deg)"></div>
      <div style="position:absolute;left:4px;right:4px;top:8px;display:flex;justify-content:space-between">
        <div style="width:14px;height:18px;background:#E8483F;clip-path:polygon(0 0,100% 0,50% 100%)"></div>
        <div style="width:14px;height:18px;background:#F5C542;clip-path:polygon(0 0,100% 0,50% 100%)"></div>
        <div style="width:14px;height:18px;background:#39B7B7;clip-path:polygon(0 0,100% 0,50% 100%)"></div>
        <div style="width:14px;height:18px;background:#F06292;clip-path:polygon(0 0,100% 0,50% 100%)"></div>
        <div style="width:14px;height:18px;background:#7CC44E;clip-path:polygon(0 0,100% 0,50% 100%)"></div>
        <div style="width:14px;height:18px;background:#E8483F;clip-path:polygon(0 0,100% 0,50% 100%)"></div>
        <div style="width:14px;height:18px;background:#F5C542;clip-path:polygon(0 0,100% 0,50% 100%)"></div>
        <div style="width:14px;height:18px;background:#39B7B7;clip-path:polygon(0 0,100% 0,50% 100%)"></div>
        <div style="width:14px;height:18px;background:#F06292;clip-path:polygon(0 0,100% 0,50% 100%)"></div>
      </div>
    </div>

    <!-- ===== ZONE 2 : かけだしの町 ===== -->
    <div style="position:absolute;left:-20px;top:1760px;width:220px;height:80px;transform:skewX(-22deg);transform-origin:top left;overflow:hidden;border-radius:0 0 10px 0;box-shadow:inset -8px -12px 18px rgba(60,90,30,.3)">
      <div style="position:absolute;inset:0;background:repeating-linear-gradient(90deg,#8A6A40 0 10px,#A9854A 10px 22px)"></div>
      <div style="position:absolute;inset:0;background:repeating-linear-gradient(90deg,rgba(96,160,60,.9) 0 4px,rgba(0,0,0,0) 4px 22px)"></div>
    </div>
    <div style="position:absolute;right:22px;top:1730px;width:96px;height:104px">
      <div style="position:absolute;left:50%;bottom:-6px;width:116px;height:18px;border-radius:50%;background:rgba(90,60,20,.2);filter:blur(4px);transform:translateX(-50%)"></div>
      <div style="position:absolute;right:-14px;bottom:0;width:14px;height:82px;background:linear-gradient(180deg,#BE9560,#9C7440);transform:skewY(-38deg);transform-origin:left bottom"></div>
      <div style="position:absolute;left:-4px;top:14px;width:104px;height:14px;border-radius:6px;background:linear-gradient(180deg,#B47A46,#946030);transform:skewX(-48deg);transform-origin:bottom left"></div>
      <div style="position:absolute;left:0;bottom:0;width:96px;height:82px;border-radius:4px 4px 0 0;background:linear-gradient(90deg,#F0DBB4 0%,#DBBE88 64%,#CBAA6C 100%);box-shadow:inset -8px -10px 14px rgba(140,95,40,.22),inset 6px 6px 10px rgba(255,255,255,.4)"></div>
      <div style="position:absolute;left:24px;bottom:60px;width:48px;height:20px;border-radius:6px;background:#FFFDF4;border:3px solid #B47A46;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#946030">パンや</div>
      <div style="position:absolute;left:12px;bottom:16px;width:28px;height:30px;border-radius:6px;background:linear-gradient(200deg,#FFEBB8,#E8B45C);border:3px solid #B47A46"></div>
      <div style="position:absolute;left:62px;bottom:0;width:22px;height:42px;border-radius:6px 6px 0 0;background:linear-gradient(180deg,#A9683A,#845020);border:3px solid #7A461C"></div>
    </div>
    <div style="position:absolute;left:60px;top:1900px;width:40px;height:56px">
      <div style="position:absolute;left:15px;bottom:0;width:12px;height:24px;background:linear-gradient(90deg,#9A6A3C,#7A4E24);border-radius:2px"></div>
      <div style="position:absolute;left:0;bottom:16px;width:40px;height:40px;border-radius:50%;background:radial-gradient(circle at 38% 30%,#7CC44E,#4E9A32);box-shadow:inset -5px -6px 10px rgba(30,80,20,.4)"></div>
    </div>
    <div style="position:absolute;right:70px;top:1930px;width:32px;height:46px">
      <div style="position:absolute;left:12px;bottom:0;width:10px;height:20px;background:linear-gradient(90deg,#9A6A3C,#7A4E24);border-radius:2px"></div>
      <div style="position:absolute;left:0;bottom:13px;width:32px;height:32px;border-radius:50%;background:radial-gradient(circle at 38% 30%,#82CC52,#549E36)"></div>
    </div>
    <!-- z2: 道しるべ＆ひまわり -->
    <div style="position:absolute;left:60px;top:1660px;width:68px;height:74px">
      <div style="position:absolute;left:30px;bottom:0;width:8px;height:74px;background:linear-gradient(90deg,#A9784A,#7A5230);border-radius:3px"></div>
      <div style="position:absolute;left:4px;top:8px;width:56px;height:18px;background:linear-gradient(180deg,#F5C542,#D9A020);clip-path:polygon(0 0,86% 0,100% 50%,86% 100%,0 100%);display:flex;align-items:center;padding-left:7px;font-size:9.5px;font-weight:800;color:#7A4A00">みやこ</div>
      <div style="position:absolute;left:10px;top:32px;width:56px;height:18px;background:repeating-linear-gradient(90deg,#B98C50 0 14px,#A87C40 14px 18px);clip-path:polygon(14% 0,100% 0,100% 100%,14% 100%,0 50%);display:flex;align-items:center;justify-content:flex-end;padding-right:7px;font-size:9.5px;font-weight:800;color:#4A3316">ながや</div>
    </div>
    <div style="position:absolute;left:34px;top:1980px;display:flex;align-items:flex-end;gap:10px">
      <div style="position:relative;width:20px;height:52px"><div style="position:absolute;left:9px;bottom:0;width:3px;height:34px;background:#5E8A3A"></div><div style="position:absolute;left:0;top:0;width:20px;height:20px;border-radius:50%;background:repeating-conic-gradient(#F5C542 0 30deg,#E8A020 30deg 60deg)"></div><div style="position:absolute;left:6px;top:6px;width:8px;height:8px;border-radius:50%;background:#7A4E24"></div></div>
      <div style="position:relative;width:16px;height:40px"><div style="position:absolute;left:7px;bottom:0;width:3px;height:26px;background:#5E8A3A"></div><div style="position:absolute;left:0;top:0;width:16px;height:16px;border-radius:50%;background:repeating-conic-gradient(#F5C542 0 30deg,#E8A020 30deg 60deg)"></div><div style="position:absolute;left:5px;top:5px;width:6px;height:6px;border-radius:50%;background:#7A4E24"></div></div>
    </div>

    <!-- ===== ZONE 1 : びんぼう長屋 ===== -->
    <div style="position:absolute;left:60px;top:2360px;width:120px;height:2px;background:rgba(70,45,15,.32);transform:rotate(4deg)"></div>
    <div style="position:absolute;right:70px;top:2460px;width:130px;height:2px;background:rgba(70,45,15,.28);transform:rotate(-3deg)"></div>
    <div style="position:absolute;left:24px;top:2270px;width:104px;height:96px">
      <div style="position:absolute;left:50%;bottom:-6px;width:120px;height:16px;border-radius:50%;background:rgba(60,40,15,.24);filter:blur(4px);transform:translateX(-50%)"></div>
      <div style="position:absolute;right:-13px;bottom:0;width:13px;height:64px;background:linear-gradient(180deg,#8A6C46,#6A5030);transform:skewY(-38deg);transform-origin:left bottom"></div>
      <div style="position:absolute;left:-6px;top:14px;width:120px;height:16px;background:repeating-linear-gradient(90deg,#7A5A38 0 12px,#5E442A 12px 20px);transform:skewX(-46deg);transform-origin:bottom left;border-radius:3px"></div>
      <div style="position:absolute;left:0;bottom:0;width:104px;height:64px;border-radius:3px;background:linear-gradient(90deg,#C0A176 0%,#A2865C 62%,#8A6C46 100%);box-shadow:inset -6px -8px 12px rgba(80,50,20,.3)"></div>
      <div style="position:absolute;left:18px;bottom:12px;width:22px;height:22px;background:#9C8258;border:2px dashed #6E5230;transform:rotate(8deg)"></div>
      <div style="position:absolute;left:70px;bottom:0;width:24px;height:38px;background:#5E442A;border-radius:5px 5px 0 0"></div>
      <div style="position:absolute;left:22px;bottom:70px;padding:2px 9px;background:#EBE0C8;border:2px solid #7A5A38;border-radius:6px;font-size:11px;font-weight:800;color:#6E5230;transform:rotate(-5deg);white-space:nowrap">やおや?</div>
    </div>
    <div style="position:absolute;right:44px;top:2330px;width:40px;height:48px">
      <div style="position:absolute;inset:0;border-radius:10px/16px;background:linear-gradient(90deg,#A97C4A,#7A552E 55%,#6E4A26);box-shadow:inset -6px 0 8px rgba(60,38,12,.4)"></div>
      <div style="position:absolute;left:0;right:0;top:9px;height:5px;background:#5E4426"></div>
      <div style="position:absolute;left:0;right:0;bottom:11px;height:5px;background:#5E4426"></div>
    </div>
    <div style="position:absolute;left:120px;top:2400px;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:20px solid #7C8A54"></div>
    <div style="position:absolute;right:120px;top:2420px;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:18px solid #7C8A54"></div>
    <!-- START banner -->
    <div style="position:absolute;left:50%;top:2560px;transform:translateX(-50%);display:flex;align-items:center;gap:7px;background:#2E2A24;color:#FFE9B8;border-radius:999px;padding:6px 18px;box-shadow:0 6px 14px rgba(46,42,36,.3);font-size:13px;font-weight:800;white-space:nowrap">🏁 ぼうけん スタート</div>

    <!-- ===== ゾーン境界ゲート＆追加装飾 ===== -->
    <div style="position:absolute;left:50%;top:388px;width:64px;height:62px;transform:translateX(-50%);background:linear-gradient(180deg,#C0392B,#A02A20);clip-path:polygon(28% 0,72% 0,100% 100%,0 100%);box-shadow:inset 0 0 12px rgba(60,10,10,.4)"></div>
    <div style="position:absolute;left:50%;top:520px;width:150px;height:76px;transform:translateX(-50%)">
      <div style="position:absolute;left:2px;bottom:0;width:16px;height:56px;border-radius:4px 4px 0 0;background:linear-gradient(90deg,#FFE9A0,#D9A83E);box-shadow:inset -3px -4px 6px rgba(150,100,20,.4)"></div>
      <div style="position:absolute;right:2px;bottom:0;width:16px;height:56px;border-radius:4px 4px 0 0;background:linear-gradient(90deg,#FFE9A0,#D9A83E);box-shadow:inset -3px -4px 6px rgba(150,100,20,.4)"></div>
      <div style="position:absolute;left:-2px;top:14px;width:154px;height:18px;border-radius:9px;background:linear-gradient(180deg,#F5C542,#C89A2E);box-shadow:0 3px 6px rgba(150,100,20,.35)"></div>
      <div style="position:absolute;left:50%;top:2px;transform:translateX(-50%);padding:2px 10px;border-radius:999px;background:#FFFDF6;border:2px solid #C89A2E;font-size:11px;font-weight:800;color:#8A5E0A;white-space:nowrap">黄金の都へ</div>
      <div style="position:absolute;left:8px;top:-8px;width:9px;height:9px;background:#FFF7C8;animation:msparkle 1.9s ease-in-out infinite"></div>
      <div style="position:absolute;right:10px;top:-4px;width:8px;height:8px;background:#FFF7C8;animation:msparkle 2.2s ease-in-out infinite;animation-delay:-.8s"></div>
    </div>
    <div style="position:absolute;left:50%;top:1104px;width:170px;height:64px;transform:translateX(-50%)">
      <div style="position:absolute;left:4px;bottom:0;width:10px;height:52px;background:linear-gradient(90deg,#8E9AA6,#6E7A86);border-radius:3px"></div>
      <div style="position:absolute;right:4px;bottom:0;width:10px;height:52px;background:linear-gradient(90deg,#8E9AA6,#6E7A86);border-radius:3px"></div>
      <div style="position:absolute;left:0;top:0;width:170px;height:34px;border-radius:8px;background:linear-gradient(180deg,#3E6FA8,#2E5686);box-shadow:0 4px 8px rgba(20,50,90,.3);display:flex;align-items:center;justify-content:center">
        <span style="color:#FFF;font-size:12px;font-weight:800">↑ 大都会タワマン</span>
      </div>
    </div>
    <div style="position:absolute;left:50%;top:1560px;width:160px;height:70px;transform:translateX(-50%)">
      <div style="position:absolute;left:2px;bottom:0;width:14px;height:50px;border-radius:4px 4px 0 0;background:linear-gradient(90deg,#E8685C,#C0392B)"></div>
      <div style="position:absolute;right:2px;bottom:0;width:14px;height:50px;border-radius:4px 4px 0 0;background:linear-gradient(90deg,#E8685C,#C0392B)"></div>
      <div style="position:absolute;left:-2px;top:12px;width:164px;height:30px;border-radius:16px 16px 6px 6px;background:linear-gradient(180deg,#E8483F,#C0392B);box-shadow:0 4px 8px rgba(150,40,25,.3);display:flex;align-items:center;justify-content:center">
        <span style="color:#FFF3D0;font-size:12px;font-weight:800">にぎわい商店街</span>
      </div>
      <div style="position:absolute;left:50%;top:2px;transform:translateX(-50%);width:12px;height:12px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#FFEFAE,#FFD54A);border:2px solid #C89A2E"></div>
    </div>
    <div style="position:absolute;left:50%;top:2076px;width:150px;height:66px;transform:translateX(-50%)">
      <div style="position:absolute;left:2px;bottom:0;width:13px;height:48px;background:linear-gradient(90deg,#A9784A,#7A5230);border-radius:3px 3px 0 0"></div>
      <div style="position:absolute;right:2px;bottom:0;width:13px;height:48px;background:linear-gradient(90deg,#A9784A,#7A5230);border-radius:3px 3px 0 0"></div>
      <div style="position:absolute;left:-2px;top:8px;width:154px;height:28px;border-radius:6px;background:repeating-linear-gradient(90deg,#B98C50 0 18px,#A87C40 18px 22px);box-shadow:0 3px 6px rgba(90,60,20,.3);display:flex;align-items:center;justify-content:center">
        <span style="color:#4A3316;font-size:12px;font-weight:800">かけだしの町</span>
      </div>
      <div style="position:absolute;left:18px;top:-6px;width:12px;height:9px;border-radius:50% 50% 40% 40%;background:#5E8A3A"></div>
    </div>
    <!-- z1: カラス＆小石 -->
    <div style="position:absolute;right:56px;top:2306px;width:30px;height:26px">
      <div style="position:absolute;left:2px;bottom:0;width:20px;height:14px;border-radius:50% 50% 40% 40%;background:#3A3540"></div>
      <div style="position:absolute;left:14px;bottom:8px;width:12px;height:12px;border-radius:50%;background:#3A3540"></div>
      <div style="position:absolute;left:24px;bottom:12px;width:6px;height:4px;background:#E8A020;clip-path:polygon(0 0,100% 50%,0 100%)"></div>
      <div style="position:absolute;left:19px;bottom:14px;width:3px;height:3px;border-radius:50%;background:#FFF"></div>
    </div>
    <div style="position:absolute;left:70px;top:2512px;width:46px;height:18px">
      <div style="position:absolute;left:0;bottom:0;width:20px;height:14px;border-radius:50%;background:linear-gradient(180deg,#B7B2A6,#8C877B)"></div>
      <div style="position:absolute;left:16px;bottom:0;width:16px;height:11px;border-radius:50%;background:linear-gradient(180deg,#A9A498,#837E72)"></div>
    </div>
    <div style="position:absolute;right:96px;top:2508px;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:18px solid #7C8A54"></div>`;
}

// ---- ノード（進捗の丸） -------------------------------------------------
function nodeHtml(i: number, state: 'done' | 'current' | 'locked', pct: number): string {
  const top = NODE_TOP[i];
  if (state === 'current') {
    return `<div style="position:absolute;left:50%;top:${top}px;width:46px;height:46px;transform:translateX(-50%);border-radius:50%;border:4px solid #FFFDF6;background:radial-gradient(circle at 35% 30%,#FF7A5C,#D8382C);display:flex;align-items:center;justify-content:center;color:#FFF;font-size:13px;font-weight:800;z-index:5;animation:mpulse 2s ease-in-out infinite">${pct}%</div>`;
  }
  if (state === 'locked') {
    return `<div style="position:absolute;left:50%;top:${top}px;width:44px;height:44px;transform:translateX(-50%);border-radius:50%;border:4px solid #FFFDF6;background:radial-gradient(circle at 35% 30%,#FFE9A0,#E7BE5C 60%,#C99B2E);display:flex;align-items:center;justify-content:center;box-shadow:0 5px 12px rgba(150,100,20,.35);z-index:4">
      <div style="width:16px;height:13px;border-radius:3px;background:#7A5A20;position:relative"><div style="position:absolute;left:3px;top:-6px;width:10px;height:9px;border:2.5px solid #7A5A20;border-bottom:none;border-radius:6px 6px 0 0"></div></div>
    </div>`;
  }
  return `<div style="position:absolute;left:50%;top:${top}px;width:40px;height:40px;transform:translateX(-50%);border-radius:50%;border:4px solid #FFFDF6;background:radial-gradient(circle at 35% 30%,#FFD86A,#E0A82E);display:flex;align-items:center;justify-content:center;color:#7A4A00;font-size:16px;font-weight:800;box-shadow:0 5px 12px rgba(150,100,20,.32);z-index:4">✓</div>`;
}

// ---- カード（ステージ情報） ---------------------------------------------
function cardHtml(i: number, goal: number, state: 'done' | 'current' | 'locked'): string {
  const st = STAGES[i];
  const c = CARD[i];
  const pct = Math.round(st.ratio * 100);
  const at = stageAt(i, goal);
  const border = state === 'current' ? '3px solid #D8382C' : '2.5px solid #E8B62B';
  const badge = state === 'locked' ? '🔒' : '✓';
  const badgeStyle = state === 'locked' ? 'font-size:13px' : 'font-size:14px;color:#3E9E6C';
  const bg = state === 'current' ? '#FFFDF6' : 'rgba(255,253,246,.96)';
  // z-index:7 … マネコ(z6)より上。猫がカードに触れても文字が読めるようにする。
  return `
    <div class="jr-card" style="position:absolute;left:${c.l}px;top:${c.t}px;width:${c.w}px;background:${bg};border:${border};border-radius:16px;padding:11px 13px;box-shadow:0 8px 20px rgba(150,100,20,.22);display:flex;flex-direction:column;gap:3px;z-index:7">
      <div style="display:flex;align-items:center;justify-content:space-between"><span class="jr-card-title" style="font-size:13.5px;font-weight:800;color:#3D2F1C;line-height:1.2;white-space:nowrap">${esc(st.name)}</span><span style="${badgeStyle}">${badge}</span></div>
      <span style="font-size:11.5px;font-weight:600;color:#A0895E">${esc(st.sub)}</span>
      <span style="font-size:12.5px;font-weight:800;color:#C0392B">${pct}% ・ ${yen(at)}</span>
    </div>`;
}

// ---- マネコ（現在地） ---------------------------------------------------
function catHtml(stage: number): string {
  const top = CAT_TOP[stage];
  const acc = stageAccessoriesHtml(stage);
  return `
    <div style="position:absolute;left:50%;top:${top}px;width:220px;height:250px;transform:translateX(-50%);z-index:6">
      <div style="position:absolute;left:50%;top:-6px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;z-index:2">
        <div style="background:#D8382C;color:#FFF3D0;font-size:12px;font-weight:800;padding:4px 14px;border-radius:999px;box-shadow:0 4px 10px rgba(180,40,30,.4);white-space:nowrap">いま ここ</div>
        <div style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:9px solid #D8382C"></div>
      </div>
      <div style="position:absolute;left:68px;bottom:60px;width:84px;height:16px;border-radius:50%;background:radial-gradient(ellipse,rgba(40,60,90,.34),rgba(40,60,90,0) 70%);animation:mshadow 3s ease-in-out infinite"></div>
      <!-- 猫本体: 設計のマップ猫(実寸約124px幅)に合わせ scale(.42)（300×.42≈126px）。
           bottom:68 でピル→▲の直下に頭が来る＆足が影の上に乗る。 -->
      <div id="jr-cat" style="position:absolute;left:50%;bottom:68px;width:300px;height:370px;transform:translateX(-50%) scale(.42);transform-origin:bottom center">
        ${acc.back}
        ${manekoHtml({ collar: false })}
        ${acc.front}
      </div>
    </div>`;
}

// ---- 旅マップ本体 --------------------------------------------------------
// goalId 指定でその目標の旅を表示。省略時は代表目標（featuredGoal）。
// 目標ゼロなら fallback ¥10,000・0% の世界（切替UIなし）。
export function journeyView(o: Overview, goalId?: number): HTMLElement {
  const goals = goalOrder(o);              // 切替順: 未達成（作成順）→ 達成済み
  let sel: SavingsGoal | null =
    (goalId != null ? goals.find((g) => g.id === goalId) : undefined) ?? featuredGoal(o);

  const overlay = el('div', { class: 'jr-overlay' });

  // スクロール永続化（overlay 自体は innerHTML を差し替えても同一要素なのでリスナーは1回でよい）
  const KEY = 'maneko_map_scroll';
  const onScroll = () => { try { localStorage.setItem(KEY, String(overlay.scrollTop)); } catch { /* noop */ } };
  overlay.addEventListener('scroll', onScroll, { passive: true });

  // 閉じる。ブラウザ/端末の「戻る」でも閉じられるよう history と連動させる。
  // history push は**初回のみ**（目標切替では積まない＝戻る1回で必ず閉じる）。
  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener('popstate', onPop);
    overlay.removeEventListener('scroll', onScroll);
    overlay.classList.remove('jr-in');
    overlay.classList.add('jr-out');
    window.setTimeout(() => overlay.remove(), 340); // トランジション(.32s)ぶん待って除去
  };
  const onPop = () => finish();
  history.pushState({ jr: 1 }, '');
  window.addEventListener('popstate', onPop);

  // 目標切替（◀▶で循環）
  const step = (d: number) => {
    if (!sel || goals.length < 2) return;
    const i = goals.findIndex((g) => g.id === sel!.id);
    sel = goals[(i + d + goals.length) % goals.length];
    render(false);
  };

  // 選択目標でオーバーレイの中身を（再）構築する。
  // preferSavedScroll: 初回のみ true（保存スクロールを復元）。切替時は現在地センター優先。
  const render = (preferSavedScroll: boolean) => {
    const goalAmt = sel && sel.target > 0 ? sel.target : GOAL_FALLBACK;
    const total = sel ? Math.max(0, sel.saved) : 0;
    const stage = currentStage(total, goalAmt);
    const pct = journeyPercent(total, goalAmt);
    const reachedGoal = total >= goalAmt;
    const nextIdx = Math.min(STAGES.length - 1, stage + 1);
    const next = STAGES[nextIdx];
    const toNext = Math.max(0, stageAt(nextIdx, goalAmt) - total);

    // ノード＆カードの状態
    let nodes = '';
    let cards = '';
    for (let i = 0; i < STAGES.length; i++) {
      const state: 'done' | 'current' | 'locked' =
        i === stage ? 'current' : total >= stageAt(i, goalAmt) ? 'done' : 'locked';
      nodes += nodeHtml(i, state, pct);
      cards += cardHtml(i, goalAmt, state);
    }

    // 目標切替ピル（目標があるときだけ表示。◀▶は目標が2つ以上のとき）
    const arrows = goals.length >= 2;
    const pill = sel ? `
    <div class="jr-goal-bar">
      <div class="jr-goal-pill">
        ${arrows ? '<button class="jr-goal-prev" type="button" aria-label="まえの目標">◀</button>' : ''}
        <span class="jr-goal-label">${esc(sel.emoji ?? '⭐')} ${esc(sel.name.slice(0, 6))} ・ ${yen(sel.target)}</span>
        ${arrows ? '<button class="jr-goal-next" type="button" aria-label="つぎの目標">▶</button>' : ''}
      </div>
    </div>` : '';

    overlay.innerHTML = `
    <div class="jr-content" style="position:relative;width:100%;height:2680px">
      ${bandsHtml()}
      <div style="position:absolute;left:50%;top:0;width:402px;height:2680px;transform:translateX(-50%)">
        ${sceneryHtml()}
        ${nodes}
        ${cards}
        ${catHtml(stage)}
      </div>
    </div>
    <!-- 上部HUD（fixed） -->
    <div class="jr-top">
      <button class="jr-back" type="button">← もどる</button>
      <div class="jr-title"><span>🗺️</span> マネコの ぼうけん</div>
      <div class="jr-hud">${pct}%</div>
    </div>
    ${pill}
    <!-- 下部HUD（fixed） -->
    <div class="jr-foot">
      <div style="position:absolute;left:50%;bottom:82px;transform:translateX(-50%);animation:mchev 1.6s ease-in-out infinite;color:#FFFDF6;font-size:20px;text-shadow:0 2px 6px rgba(40,60,90,.4);z-index:1">︿</div>
      <div style="background:linear-gradient(180deg,rgba(255,253,246,0),rgba(255,253,246,.9) 34%,#FFFDF6);padding:34px 18px calc(22px + env(safe-area-inset-bottom));display:flex;flex-direction:column;align-items:center;gap:5px">
        <div style="display:flex;align-items:center;gap:7px"><span style="font-size:12px;font-weight:800;color:#A0895E">いま</span><span style="font-size:15px;font-weight:800;color:#E8791B">${esc(STAGES[stage].name)}</span></div>
        <div style="width:100%;max-width:320px;height:12px;border-radius:999px;background:#F0E4C8;overflow:hidden;box-shadow:inset 0 1px 3px rgba(120,90,20,.2)"><div style="width:${pct}%;height:100%;border-radius:999px;background:linear-gradient(90deg,#FFC94D,#E8791B)"></div></div>
        <div style="font-size:12.5px;font-weight:700;color:#7A5A20">${reachedGoal ? 'ぜんぶ たっせい！すごい！' : `つぎの <b style="color:#C0392B">「${esc(next.name)}」</b> まで あと <b>${yen(toNext)}</b>`}</div>
      </div>
    </div>`;

    // innerHTML 差し替えで消えるリスナーを張り直す
    overlay.querySelector('.jr-back')?.addEventListener('click', () => { if (!closed) history.back(); });  // 連打ガード
    overlay.querySelector('.jr-goal-prev')?.addEventListener('click', () => step(-1));
    overlay.querySelector('.jr-goal-next')?.addEventListener('click', () => step(1));

    // スクロール位置: 初回は保存があれば復元、なければ（＆切替時は常に）現在地センター
    let top = Math.max(0, CAT_TOP[stage] - Math.round(window.innerHeight / 2) + 120);
    if (preferSavedScroll) {
      try {
        const v = localStorage.getItem(KEY);
        if (v != null && isFinite(parseFloat(v))) top = parseFloat(v);
      } catch { /* noop */ }
    }
    // 初回は body 追加前に呼ばれるため、追加後（次フレーム）にスクロールする
    requestAnimationFrame(() => overlay.scrollTo({ top, behavior: 'auto' }));
  };

  render(true);
  requestAnimationFrame(() => overlay.classList.add('jr-in'));
  return overlay;
}

// ホーム等から呼ぶ: 旅マップを開く（body に載せてフルスクリーン表示）。
// goalId 指定でその目標を選択、省略時は代表目標。既に開いていれば二重に開かない。
export function openJourney(o: Overview, goalId?: number): void {
  if (document.querySelector('.jr-overlay')) return;
  document.body.appendChild(journeyView(o, goalId));
}

// 取り残し防止: 画面遷移（router）から呼び、開いていれば旅マップを閉じる。
export function closeJourney(): void {
  document.querySelectorAll('.jr-overlay').forEach((e) => e.remove());
}
