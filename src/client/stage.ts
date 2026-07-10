// こどもホーム v2「5段階ステージ」の景色・小物。ManekoStage.dc.html（design v2）から
// ステージ別の背景/建物/装飾を verbatim 移植し、402×840 の絶対配置レイヤーとして返す。
// stage 0..4（journey.ts の currentStage と同じ区分）。マネコ本体・HUD・カード類は kids.ts 側。
import { esc } from './phone';

export interface StageInfo {
  tier: string;   // 黒ピルに出す段階ラベル（例: 'STAGE 1 ・ 0〜25%'）
  sky: string;    // ルート canvas の background
  ground: string; // 地面グラデ
  sunGlow: string;
  sunX: string;
  haze: string;
  note: string;   // 目標カード下段のひとこと
}

// D[] 配列（renderVals）の値そのまま。name は journey.ts の STAGES[s].name を使う。
export const STAGE_INFO: StageInfo[] = [
  {
    tier: 'STAGE 1 ・ 0〜25%',
    sky: 'linear-gradient(180deg,#8A99A4 0%,#A6B2B6 30%,#C2C9C6 52%,#D4CEC0 62%)',
    ground: 'linear-gradient(180deg,#B8A57E 0%,#A28C64 45%,#8A7550 100%)',
    sunGlow: 'rgba(255,255,255,.3)', sunX: '72%', haze: 'rgba(214,208,192,.75)',
    note: 'まずは10円玉から。こつこついこう…',
  },
  {
    tier: 'STAGE 2 ・ 25〜50%',
    sky: 'linear-gradient(180deg,#6BA6DC 0%,#93C4E9 26%,#C4E0F3 46%,#E9E7CD 62%)',
    ground: 'linear-gradient(180deg,#CBB98F 0%,#B49C6C 45%,#9C8456 100%)',
    sunGlow: 'rgba(255,250,228,.55)', sunX: '74%', haze: 'rgba(233,231,205,.7)',
    note: '畑と木のパンやが出現。だんだん貯まってきた',
  },
  {
    tier: 'STAGE 3 ・ 50〜74%',
    sky: 'linear-gradient(180deg,#4FA6E8 0%,#8FCDF3 26%,#C6E6FA 44%,#FFE6A6 56%,#FFD489 62%)',
    ground: 'linear-gradient(180deg,#EAD3A0 0%,#DBB472 45%,#C79C56 100%)',
    sunGlow: 'rgba(255,240,190,.8)', sunX: '76%', haze: 'rgba(255,236,182,.72)',
    note: '金の道が開通。にぎわってきた！',
  },
  {
    tier: 'STAGE 4 ・ 75〜99%',
    sky: 'linear-gradient(180deg,#5E9BD6 0%,#8FC0E8 28%,#C4E0F3 52%,#E6EEF5 62%)',
    ground: 'linear-gradient(180deg,#C9D1DA 0%,#ABB7C3 45%,#93A0AE 100%)',
    sunGlow: 'rgba(255,255,255,.5)', sunX: '72%', haze: 'rgba(220,230,240,.72)',
    note: 'タワマンが林立！ゴールはもうすぐ',
  },
  {
    tier: 'STAGE 5 ・ 100%',
    sky: 'linear-gradient(180deg,#F2954A 0%,#FCC26A 28%,#FFDD95 46%,#FFF0C6 60%)',
    ground: 'linear-gradient(180deg,#F7E19A 0%,#EBC468 45%,#D9A83E 100%)',
    sunGlow: 'rgba(255,224,150,.95)', sunX: '50%', haze: 'rgba(255,238,200,.82)',
    note: '目標たっせい！マネコは大富豪になった',
  },
];

// STAGE_INFO[s] の sky（空）と ground（地面）を 1 本の 180deg グラデ文字列に合成して返す。
// html/body の背景に敷き、402 幅キャンバスの外側（スケール余白＝旧レターボックス）を
// キャンバス内と同系色で埋め、「アプリの外の背景」を露出させないための連続背景。
// sky の停止点を 12〜54%、ground の停止点を 56〜100% に圧縮再配置し、54〜56% の補間で
// つなぎ目をぼかす。先頭 0〜12% は sky の先頭色（＝キャンバス上端色）のフラット区間:
// cover スケールの左右クロップキャップで上端に小さな残余ギャップが出ても、
// キャンバス上端と完全同色で続くため micro-seam（板の境目）が見えない。
export function stageBackdrop(s: number): string {
  const d = STAGE_INFO[Math.max(0, Math.min(4, s))];
  const parse = (g: string): { color: string; pos: number }[] => {
    const inner = g.slice(g.indexOf('(') + 1, g.lastIndexOf(')'));
    const parts = inner.split(',').map((p) => p.trim());
    parts.shift(); // 先頭の "180deg" を捨てる
    return parts.map((p) => {
      const m = p.match(/^(.+?)\s+([\d.]+)%$/)!;
      return { color: m[1], pos: parseFloat(m[2]) };
    });
  };
  const remap = (stops: { color: string; pos: number }[], lo: number, hi: number): string => {
    const max = Math.max(...stops.map((x) => x.pos)) || 1;
    return stops.map((x) => `${x.color} ${(lo + (x.pos / max) * (hi - lo)).toFixed(1)}%`).join(',');
  };
  const sky = parse(d.sky);
  return `linear-gradient(180deg,${sky[0].color} 0%,${remap(sky, 12, 54)},${remap(parse(d.ground), 56, 100)})`;
}

// ステージ別の景色レイヤー一式（太陽・雲・遠景・地面・道・建物・小物）。ManekoStage.dc.html の忠実移植。
export function stageSceneryHtml(s: number): string {
  const d = STAGE_INFO[Math.max(0, Math.min(4, s))];
  const sunny = s >= 2;
  const roadGold = s === 2 || s === 4;
  const bldPoor = s === 0, bldBasic = s === 1, bldRich = s === 2, bldTower = s === 3, bldPalace = s === 4;
  const achieved = s === 4;

  return `
    <!-- 太陽光グロー -->
    <div style="position:absolute;left:${d.sunX};top:2%;width:300px;height:300px;transform:translate(-50%,-34%);border-radius:50%;background:radial-gradient(circle,${d.sunGlow},rgba(255,255,255,0) 70%);filter:blur(4px)"></div>
    ${sunny ? `
    <div style="position:absolute;left:-60px;top:-80px;width:200px;height:520px;background:linear-gradient(180deg,rgba(255,255,255,.48),rgba(255,255,255,0) 78%);transform:rotate(24deg);transform-origin:top left;filter:blur(2px)"></div>
    <div style="position:absolute;left:76px;top:-80px;width:86px;height:440px;background:linear-gradient(180deg,rgba(255,255,255,.34),rgba(255,255,255,0) 80%);transform:rotate(28deg);transform-origin:top left;filter:blur(2px)"></div>` : ''}

    <!-- 雲 -->
    <div style="position:absolute;right:-8px;top:150px;width:132px;height:42px;border-radius:999px;background:radial-gradient(ellipse at 42% 34%,#FFFFFF,rgba(255,255,255,.7));box-shadow:0 9px 16px rgba(110,124,138,.2);filter:blur(.4px);animation:mcloud 9s ease-in-out infinite"></div>
    <div style="position:absolute;right:38px;top:137px;width:74px;height:36px;border-radius:999px;background:#FFFFFF;filter:blur(.4px);animation:mcloud 9s ease-in-out infinite"></div>
    <div style="position:absolute;left:4px;top:204px;width:100px;height:32px;border-radius:999px;background:radial-gradient(ellipse at 42% 34%,#FFFFFF,rgba(255,255,255,.58));box-shadow:0 7px 12px rgba(110,124,138,.16);filter:blur(.4px);animation:mcloud 11s ease-in-out infinite;animation-delay:-4s"></div>

    <!-- 遠景シルエット -->
    ${bldPoor ? `
    <div style="position:absolute;left:-60px;right:-60px;top:238px;height:98px;background:#93A0A2;border-radius:50%/100% 100% 0 0;opacity:.38;filter:blur(2px)"></div>
    <div style="position:absolute;left:150px;right:-90px;top:252px;height:84px;background:#899384;border-radius:50%/100% 100% 0 0;opacity:.42;filter:blur(1.4px)"></div>` : ''}
    ${bldBasic ? `
    <div style="position:absolute;left:-70px;right:-40px;top:234px;height:102px;background:#7CA067;border-radius:50%/100% 100% 0 0;opacity:.4;filter:blur(2px)"></div>
    <div style="position:absolute;left:110px;right:-90px;top:248px;height:90px;background:#6B9056;border-radius:50%/100% 100% 0 0;opacity:.48;filter:blur(1.2px)"></div>` : ''}
    ${bldRich ? `
    <div style="position:absolute;left:-60px;right:-40px;top:240px;height:94px;background:#8DB49E;border-radius:50%/100% 100% 0 0;opacity:.4;filter:blur(2px)"></div>
    <div style="position:absolute;left:52px;right:52px;top:274px;height:58px;display:flex;align-items:flex-end;gap:4px;opacity:.34;filter:blur(1.2px)">
      <div style="flex:1;height:58%;background:#A9B7C2;border-radius:2px 2px 0 0"></div>
      <div style="flex:1;height:88%;background:#9FB0BC;border-radius:2px 2px 0 0"></div>
      <div style="flex:1;height:44%;background:#AEBBC5;border-radius:2px 2px 0 0"></div>
      <div style="flex:1;height:72%;background:#9AACB8;border-radius:2px 2px 0 0"></div>
      <div style="flex:1;height:100%;background:#A6B4C0;border-radius:3px 3px 0 0"></div>
      <div style="flex:1;height:60%;background:#9FB0BC;border-radius:2px 2px 0 0"></div>
      <div style="flex:1;height:82%;background:#AAB8C3;border-radius:2px 2px 0 0"></div>
    </div>` : ''}
    ${bldTower ? `
    <div style="position:absolute;left:-40px;right:-40px;top:250px;height:88px;display:flex;align-items:flex-end;gap:4px;opacity:.34;filter:blur(1.4px);padding:0 8px">
      <div style="flex:1;height:62%;background:#8FA9C4;border-radius:2px 2px 0 0"></div>
      <div style="flex:1;height:92%;background:#7F9CBA;border-radius:2px 2px 0 0"></div>
      <div style="flex:1;height:46%;background:#94ADC6;border-radius:2px 2px 0 0"></div>
      <div style="flex:1;height:78%;background:#88A3C0;border-radius:2px 2px 0 0"></div>
      <div style="flex:1;height:100%;background:#8FA9C4;border-radius:2px 2px 0 0"></div>
      <div style="flex:1;height:56%;background:#7F9CBA;border-radius:2px 2px 0 0"></div>
      <div style="flex:1;height:84%;background:#90AAC5;border-radius:2px 2px 0 0"></div>
      <div style="flex:1;height:50%;background:#849FBC;border-radius:2px 2px 0 0"></div>
    </div>` : ''}
    ${bldPalace ? `
    <div style="position:absolute;left:-60px;right:-40px;top:238px;height:96px;background:#F0C879;border-radius:50%/100% 100% 0 0;opacity:.5;filter:blur(2px)"></div>
    <div style="position:absolute;left:36px;right:36px;top:266px;height:66px;display:flex;align-items:flex-end;justify-content:space-between;opacity:.5;filter:blur(1px)">
      <div style="position:relative;width:16px;height:70%;background:#E7C069;border-radius:2px 2px 0 0"><div style="position:absolute;left:-2px;top:-9px;width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;border-bottom:11px solid #D9A83E"></div></div>
      <div style="position:relative;width:20px;height:100%;background:#EDC873;border-radius:3px 3px 0 0"><div style="position:absolute;left:-2px;top:-11px;width:0;height:0;border-left:12px solid transparent;border-right:12px solid transparent;border-bottom:13px solid #D9A83E"></div></div>
      <div style="position:relative;width:14px;height:56%;background:#E7C069;border-radius:2px 2px 0 0"><div style="position:absolute;left:-3px;top:-8px;width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;border-bottom:10px solid #D9A83E"></div></div>
      <div style="position:relative;width:18px;height:84%;background:#EDC873;border-radius:2px 2px 0 0"><div style="position:absolute;left:-2px;top:-10px;width:0;height:0;border-left:11px solid transparent;border-right:11px solid transparent;border-bottom:12px solid #D9A83E"></div></div>
    </div>` : ''}

    <!-- 地面 -->
    <div style="position:absolute;left:0;right:0;top:300px;bottom:0;background:${d.ground}"></div>
    <div style="position:absolute;left:0;right:0;top:300px;bottom:0;background:radial-gradient(ellipse 92% 72% at 50% 120%, rgba(255,250,232,.32), rgba(255,250,232,0) 60%)"></div>
    <div style="position:absolute;left:0;right:0;top:300px;bottom:0;opacity:.5;background:repeating-linear-gradient(90deg, rgba(255,255,255,.05) 0 1px, rgba(0,0,0,.035) 1px 3px, rgba(0,0,0,0) 3px 40px)"></div>
    <div style="position:absolute;left:0;right:0;top:300px;bottom:0;background-image:radial-gradient(circle at 50% 50%, rgba(90,60,20,.1) 0 1.4px, rgba(90,60,20,0) 2px);background-size:13px 13px;opacity:.7"></div>
    <div style="position:absolute;left:0;right:0;top:300px;height:56px;background:linear-gradient(180deg,rgba(255,248,224,.5),rgba(255,248,224,0))"></div>
    <div style="position:absolute;left:0;right:0;top:290px;height:38px;background:linear-gradient(180deg,${d.haze},rgba(255,255,255,0));filter:blur(1px);pointer-events:none"></div>
    <div style="position:absolute;left:0;right:0;top:300px;bottom:0;background:radial-gradient(ellipse 78% 64% at 50% 22%, rgba(0,0,0,0) 42%, rgba(52,33,10,.2));pointer-events:none"></div>

    <!-- 農地（かけだしの町） -->
    ${bldBasic ? `
    <div style="position:absolute;left:-30px;top:332px;width:250px;height:98px;transform:skewX(-24deg);transform-origin:top left;overflow:hidden;border-radius:0 0 10px 0;box-shadow:inset -8px -12px 18px rgba(60,38,12,.4), 0 5px 10px rgba(80,50,15,.22)">
      <div style="position:absolute;inset:0;background:repeating-linear-gradient(90deg,#6E4E2C 0 10px,#8A6A40 10px 22px)"></div>
      <div style="position:absolute;inset:0;background:repeating-linear-gradient(90deg,rgba(96,144,60,.95) 0 4px,rgba(0,0,0,0) 4px 22px)"></div>
      <div style="position:absolute;left:0;right:0;top:0;height:28px;background:linear-gradient(180deg,rgba(255,246,216,.42),rgba(255,246,216,0))"></div>
    </div>
    <div style="position:absolute;left:150px;top:302px;width:42px;height:58px">
      <div style="position:absolute;left:18px;top:14px;width:6px;height:44px;background:#8A5E32;border-radius:2px"></div>
      <div style="position:absolute;left:2px;top:22px;width:38px;height:5px;background:#8A5E32;border-radius:2px"></div>
      <div style="position:absolute;left:12px;top:2px;width:18px;height:18px;border-radius:50%;background:linear-gradient(180deg,#EAD08A,#D2AE58);box-shadow:inset -2px -3px 5px rgba(150,110,40,.4)"></div>
      <div style="position:absolute;left:8px;top:-3px;width:26px;height:9px;border-radius:50%;background:#B98C46"></div>
      <div style="position:absolute;left:6px;top:24px;width:30px;height:18px;background:linear-gradient(180deg,#C8493C,#A5342A);border-radius:3px"></div>
      <div style="position:absolute;left:15px;top:9px;width:3px;height:3px;border-radius:50%;background:#4A3316"></div>
      <div style="position:absolute;left:24px;top:9px;width:3px;height:3px;border-radius:50%;background:#4A3316"></div>
    </div>` : ''}

    <!-- びんぼう地面のひび＋雑草（fable裁定: 猫の腕・樽の高さを横切る長いひび2本は「電線」に見えるため除去。短い1本のみ残す） -->
    ${bldPoor ? `
    <div style="position:absolute;left:120px;top:640px;width:90px;height:2px;background:rgba(70,45,15,.3);transform:rotate(6deg)"></div>
    <div style="position:absolute;left:30px;top:600px;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:20px solid #7C8A54"></div>
    <div style="position:absolute;left:330px;top:520px;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:18px solid #7C8A54"></div>` : ''}

    <!-- 金の道 -->
    ${roadGold ? `
    <div style="position:absolute;left:0;right:0;top:300px;bottom:0;background:linear-gradient(180deg,#FBDD7E 0%,#EDB33F 100%);clip-path:polygon(45% 0, 55% 0, 98% 100%, 2% 100%);box-shadow:inset 0 0 30px rgba(160,100,10,.3)"></div>
    <div style="position:absolute;left:0;right:0;top:300px;bottom:0;opacity:.9;background:repeating-linear-gradient(180deg,#FFF6D8 0 30px, rgba(255,246,216,0) 30px 66px);clip-path:polygon(49.5% 0, 50.5% 0, 52.2% 100%, 47.8% 100%)"></div>` : ''}

    <!-- 建物：STAGE0 びんぼう（fable裁定: カード群と重ならないよう top 246→302） -->
    ${bldPoor ? `
    <div style="position:absolute;left:34px;top:302px;width:150px;height:96px">
      <div style="position:absolute;left:130px;bottom:0;width:14px;height:62px;background:linear-gradient(180deg,#8A6C46,#654B2C);transform:skewY(-32deg);transform-origin:left bottom;border-radius:0 3px 0 0;box-shadow:inset -3px 0 6px rgba(50,30,10,.4)"></div>
      <div style="position:absolute;left:10px;bottom:0;width:120px;height:62px;background:linear-gradient(90deg,#C3A47E 0%,#A5875D 62%,#8A6C46 100%);border-radius:3px;box-shadow:inset -6px -8px 12px rgba(80,50,20,.3)"></div>
      <div style="position:absolute;left:0;bottom:56px;width:140px;height:22px;background:repeating-linear-gradient(90deg,#7A5A38 0 14px,#5E442A 14px 20px);transform:skewY(-4deg);border-radius:3px"></div>
      <div style="position:absolute;left:22px;bottom:14px;width:24px;height:24px;background:#9C8258;border:2px dashed #6E5230;transform:rotate(8deg)"></div>
      <div style="position:absolute;left:82px;bottom:0;width:26px;height:40px;background:#5E442A;border-radius:5px 5px 0 0"></div>
      <div style="position:absolute;left:26px;bottom:64px;padding:2px 9px;background:#EBE0C8;border:2px solid #7A5A38;border-radius:6px;font-size:11px;font-weight:800;color:#6E5230;transform:rotate(-5deg);white-space:nowrap">やおや?</div>
    </div>
    <div style="position:absolute;right:26px;top:258px;width:44px;height:84px">
      <div style="position:absolute;left:17px;bottom:0;width:10px;height:64px;background:#6E5230;border-radius:3px"></div>
      <div style="position:absolute;left:2px;bottom:46px;width:24px;height:5px;background:#6E5230;transform:rotate(-38deg);border-radius:3px"></div>
      <div style="position:absolute;right:0;bottom:54px;width:22px;height:5px;background:#6E5230;transform:rotate(32deg);border-radius:3px"></div>
    </div>` : ''}

    <!-- 建物：STAGE1 かけだし（木のパンや）（fable裁定: top 230→292） -->
    ${bldBasic ? `
    <div style="position:absolute;left:30px;top:292px;transform:scale(.78);transform-origin:top left">
      <div style="position:relative;width:150px;height:130px">
        <div style="position:absolute;left:126px;bottom:0;width:18px;height:100px;background:linear-gradient(180deg,#CDAE7E,#A9895A);transform:skewY(-36deg);transform-origin:left bottom;border-radius:0 4px 0 0;box-shadow:inset -4px 0 7px rgba(110,75,30,.4)"></div>
        <div style="position:absolute;left:0;bottom:0;width:126px;height:100px;border-radius:5px 5px 0 0;background:linear-gradient(90deg,#F0DCB4 0%,#E0C089 62%,#D6B57E 100%);box-shadow:inset -8px -10px 16px rgba(140,95,40,.22)"></div>
        <div style="position:absolute;left:-6px;bottom:92px;width:138px;height:18px;border-radius:6px;background:linear-gradient(180deg,#B47A46,#946030);box-shadow:0 3px 6px rgba(120,70,20,.3)"></div>
        <div style="position:absolute;left:34px;bottom:106px;width:58px;height:24px;border-radius:7px;background:#FFFDF4;border:3px solid #B47A46;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#946030">パンや</div>
        <div style="position:absolute;left:-4px;bottom:68px;width:134px;height:22px;border-radius:8px 8px 12px 12px;background:repeating-linear-gradient(90deg,#D98A5C 0 16px,#FFF6E8 16px 32px);box-shadow:0 4px 8px rgba(120,60,20,.2)"></div>
        <div style="position:absolute;left:14px;bottom:22px;width:32px;height:36px;border-radius:6px;background:linear-gradient(200deg,#FFEBB8,#E8B45C);border:3px solid #B47A46"></div>
        <div style="position:absolute;left:96px;bottom:12px;width:24px;height:48px;border-radius:6px 6px 0 0;background:linear-gradient(180deg,#A9683A,#845020);border:3px solid #7A461C"></div>
        <div style="position:absolute;left:0;bottom:0;width:126px;height:11px;background:linear-gradient(180deg,#C9A878,#B08C5A);border-radius:0 0 4px 4px"></div>
      </div>
    </div>` : ''}

    <!-- 建物：STAGE2 にぎわい（パンや＋ゲームショップ）（fable裁定: パンや top 216→278 / ゲーム 234→290） -->
    ${bldRich ? `
    <div style="position:absolute;left:10px;top:278px;transform:scale(.68);transform-origin:top left">
      <div style="position:relative;width:160px;height:150px">
        <div style="position:absolute;left:130px;bottom:6px;width:22px;height:112px;background:linear-gradient(90deg,#D9A876,#B9895A);transform:skewY(-38deg);transform-origin:top left;border-radius:0 4px 4px 0"></div>
        <div style="position:absolute;left:0;bottom:0;width:130px;height:112px;border-radius:6px 6px 0 0;background:linear-gradient(180deg,#FFF3DE,#F5DDB4);box-shadow:inset -10px -12px 18px rgba(160,110,40,.18)"></div>
        <div style="position:absolute;left:-6px;bottom:104px;width:142px;height:18px;border-radius:6px;background:linear-gradient(180deg,#C97B4A,#A85E34);box-shadow:0 3px 6px rgba(120,70,20,.3)"></div>
        <div style="position:absolute;left:34px;bottom:118px;width:62px;height:26px;border-radius:8px;background:#FFFDF4;border:3px solid #C97B4A;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;color:#A85E34">パンや</div>
        <div style="position:absolute;left:-4px;bottom:76px;width:138px;height:26px;border-radius:8px 8px 12px 12px;background:repeating-linear-gradient(90deg,#E8483F 0 17px,#FFF6E8 17px 34px);box-shadow:0 4px 8px rgba(120,40,20,.25), inset 0 -5px 6px rgba(150,40,20,.25)"></div>
        <div style="position:absolute;left:12px;bottom:24px;width:34px;height:38px;border-radius:6px;background:linear-gradient(200deg,#FFEBB8,#E8B45C);border:3px solid #C97B4A"></div>
        <div style="position:absolute;left:102px;bottom:12px;width:24px;height:52px;border-radius:6px 6px 0 0;background:linear-gradient(180deg,#B9743F,#94551F);border:3px solid #8A4E1C"></div>
        <div style="position:absolute;left:0;bottom:0;width:130px;height:12px;background:linear-gradient(180deg,#D9B586,#C09A64);border-radius:0 0 4px 4px"></div>
      </div>
    </div>
    <div style="position:absolute;right:6px;top:290px;transform:scale(.56);transform-origin:top right">
      <div style="position:relative;width:150px;height:146px">
        <div style="position:absolute;left:0;bottom:0;width:134px;height:106px;border-radius:6px 6px 0 0;background:linear-gradient(180deg,#E4F0FB,#BFD9F0);box-shadow:inset -10px -12px 18px rgba(50,90,140,.18)"></div>
        <div style="position:absolute;left:-6px;bottom:98px;width:146px;height:18px;border-radius:6px;background:linear-gradient(180deg,#4E7FB5,#39628F);box-shadow:0 3px 6px rgba(30,60,100,.3)"></div>
        <div style="position:absolute;left:34px;bottom:112px;width:66px;height:26px;border-radius:8px;background:#FFFDF4;border:3px solid #4E7FB5;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;color:#39628F">ゲーム</div>
        <div style="position:absolute;left:-4px;bottom:72px;width:142px;height:24px;border-radius:8px 8px 12px 12px;background:repeating-linear-gradient(90deg,#39B7B7 0 17px,#FFF6E8 17px 34px);box-shadow:0 4px 8px rgba(20,90,90,.25)"></div>
        <div style="position:absolute;left:14px;bottom:22px;width:52px;height:40px;border-radius:6px;background:linear-gradient(200deg,#9FE8E0,#4FB9C9);border:3px solid #4E7FB5"></div>
        <div style="position:absolute;left:82px;bottom:12px;width:26px;height:50px;border-radius:6px 6px 0 0;background:linear-gradient(180deg,#4E7FB5,#35597F);border:3px solid #2E4E70"></div>
        <div style="position:absolute;left:0;bottom:0;width:134px;height:12px;background:linear-gradient(180deg,#A9C4DC,#8FAECB);border-radius:0 0 4px 4px"></div>
      </div>
    </div>` : ''}

    <!-- 建物：STAGE3 大都会タワマン -->
    ${bldTower ? `
    <div style="position:absolute;left:12px;top:146px;width:60px;height:196px">
      <div style="position:absolute;left:50%;bottom:-6px;width:82px;height:16px;border-radius:50%;background:rgba(40,60,90,.2);filter:blur(4px);transform:translateX(-50%)"></div>
      <div style="position:absolute;right:-13px;bottom:0;width:13px;height:196px;background:linear-gradient(180deg,#7C93AD,#5E7690);transform:skewY(-36deg);transform-origin:left bottom"></div>
      <div style="position:absolute;left:0;top:-8px;width:60px;height:13px;background:linear-gradient(180deg,#E4EDF6,#C2D2E2);transform:skewX(-54deg);transform-origin:bottom left;border-radius:3px 3px 0 0"></div>
      <div style="position:absolute;left:0;bottom:0;width:60px;height:196px;border-radius:5px 5px 0 0;background-image:linear-gradient(180deg,rgba(255,255,255,.35),rgba(255,255,255,0) 20%),repeating-linear-gradient(0deg,rgba(88,120,158,.4) 0 3px,transparent 3px 16px),repeating-linear-gradient(90deg,rgba(88,120,158,.32) 0 3px,transparent 3px 14px),linear-gradient(90deg,#EAF1F8 0%,#CBD9E8 62%,#B4C6D9 100%);box-shadow:inset -8px -10px 18px rgba(70,100,140,.24),inset 6px 6px 12px rgba(255,255,255,.5)"></div>
      <div style="position:absolute;left:9px;bottom:28px;width:8px;height:11px;border-radius:2px;background:#FFDE8A;box-shadow:0 0 5px rgba(255,210,110,.7)"></div>
      <div style="position:absolute;left:30px;bottom:96px;width:8px;height:11px;border-radius:2px;background:#FFDE8A;box-shadow:0 0 5px rgba(255,210,110,.7)"></div>
    </div>
    <div style="position:absolute;right:10px;top:112px;width:66px;height:230px">
      <div style="position:absolute;left:50%;bottom:-6px;width:88px;height:16px;border-radius:50%;background:rgba(40,60,90,.2);filter:blur(4px);transform:translateX(-50%)"></div>
      <div style="position:absolute;right:-15px;bottom:0;width:15px;height:230px;background:linear-gradient(180deg,#748BA6,#566E88);transform:skewY(-36deg);transform-origin:left bottom"></div>
      <div style="position:absolute;left:0;top:-9px;width:66px;height:15px;background:linear-gradient(180deg,#E4EDF6,#C2D2E2);transform:skewX(-54deg);transform-origin:bottom left;border-radius:3px 3px 0 0"></div>
      <div style="position:absolute;left:0;bottom:0;width:66px;height:230px;border-radius:5px 5px 0 0;background-image:linear-gradient(180deg,rgba(255,255,255,.35),rgba(255,255,255,0) 18%),repeating-linear-gradient(0deg,rgba(80,112,150,.42) 0 3px,transparent 3px 16px),repeating-linear-gradient(90deg,rgba(80,112,150,.34) 0 3px,transparent 3px 15px),linear-gradient(90deg,#E3ECF5 0%,#C3D3E4 62%,#AAC0D6 100%);box-shadow:inset -9px -10px 18px rgba(60,92,132,.26),inset 6px 6px 12px rgba(255,255,255,.5)"></div>
      <div style="position:absolute;left:12px;bottom:40px;width:9px;height:12px;border-radius:2px;background:#FFDE8A;box-shadow:0 0 5px rgba(255,210,110,.7)"></div>
      <div style="position:absolute;left:36px;bottom:120px;width:9px;height:12px;border-radius:2px;background:#FFDE8A;box-shadow:0 0 5px rgba(255,210,110,.7)"></div>
    </div>
    <div style="position:absolute;left:50%;top:156px;transform:translateX(-50%);width:70px;height:186px;opacity:.95">
      <div style="position:absolute;right:-15px;bottom:0;width:15px;height:186px;background:linear-gradient(180deg,#8199B4,#63798F);transform:skewY(-36deg);transform-origin:left bottom"></div>
      <div style="position:absolute;left:0;top:-8px;width:70px;height:13px;background:linear-gradient(180deg,#EDF3F9,#CCDAE7);transform:skewX(-54deg);transform-origin:bottom left;border-radius:3px 3px 0 0"></div>
      <div style="position:absolute;left:0;bottom:0;width:70px;height:186px;border-radius:6px 6px 0 0;background-image:linear-gradient(180deg,rgba(255,255,255,.4),rgba(255,255,255,0) 18%),repeating-linear-gradient(0deg,rgba(92,124,162,.36) 0 3px,transparent 3px 17px),repeating-linear-gradient(90deg,rgba(92,124,162,.3) 0 3px,transparent 3px 15px),linear-gradient(90deg,#EEF4FA 0%,#D2DFEC 64%,#BCCEDE 100%);box-shadow:inset -8px -10px 16px rgba(70,100,140,.2),inset 6px 6px 12px rgba(255,255,255,.55)"></div>
      <div style="position:absolute;left:16px;bottom:70px;width:9px;height:12px;border-radius:2px;background:#FFDE8A;box-shadow:0 0 5px rgba(255,210,110,.7)"></div>
    </div>` : ''}

    <!-- 建物：STAGE4 黄金の都（お城＋噴水）（fable裁定: 宮殿 top 206→282 / 噴水 352→408） -->
    ${bldPalace ? `
    <div style="position:absolute;left:50%;top:282px;transform:translateX(-50%);width:210px;height:138px">
      <div style="position:absolute;left:6px;bottom:0;width:44px;height:104px;border-radius:5px 5px 0 0;background:linear-gradient(180deg,#FFE9A8,#E7BE5C);box-shadow:inset -5px -6px 10px rgba(150,100,20,.3)"></div>
      <div style="position:absolute;left:0;bottom:100px;width:56px;height:0;border-left:28px solid transparent;border-right:28px solid transparent;border-bottom:34px solid #C0392B"></div>
      <div style="position:absolute;left:26px;bottom:132px;width:4px;height:16px;background:#8A5E0A"></div>
      <div style="position:absolute;left:30px;bottom:140px;width:16px;height:10px;background:#F5C542;animation:mflag 2.4s ease-in-out infinite;transform-origin:left center"></div>
      <div style="position:absolute;right:6px;bottom:0;width:44px;height:104px;border-radius:5px 5px 0 0;background:linear-gradient(180deg,#FFE9A8,#E7BE5C);box-shadow:inset -5px -6px 10px rgba(150,100,20,.3)"></div>
      <div style="position:absolute;right:0;bottom:100px;width:56px;height:0;border-left:28px solid transparent;border-right:28px solid transparent;border-bottom:34px solid #C0392B"></div>
      <div style="position:absolute;right:26px;bottom:132px;width:4px;height:16px;background:#8A5E0A"></div>
      <div style="position:absolute;right:30px;bottom:140px;width:16px;height:10px;background:#F5C542;animation:mflag 2.4s ease-in-out infinite;animation-delay:-1s;transform-origin:left center"></div>
      <div style="position:absolute;left:56px;bottom:0;width:98px;height:118px;border-radius:6px 6px 0 0;background:linear-gradient(180deg,#FFF0C4,#EFCB6E);box-shadow:inset -6px -8px 14px rgba(150,100,20,.28)"></div>
      <div style="position:absolute;left:52px;bottom:114px;width:106px;height:0;border-left:53px solid transparent;border-right:53px solid transparent;border-bottom:40px solid #B0332B"></div>
      <div style="position:absolute;left:100px;bottom:152px;width:5px;height:20px;background:#8A5E0A"></div>
      <div style="position:absolute;left:105px;bottom:162px;width:20px;height:12px;background:#F5C542;animation:mflag 2.2s ease-in-out infinite;transform-origin:left center"></div>
      <div style="position:absolute;left:84px;bottom:0;width:42px;height:56px;border-radius:21px 21px 0 0;background:linear-gradient(180deg,#8A5E0A,#5E3E06)"></div>
      <div style="position:absolute;left:90px;bottom:0;width:30px;height:48px;border-radius:15px 15px 0 0;background:linear-gradient(180deg,#C89A2E,#9A731C)"></div>
      <div style="position:absolute;left:96px;bottom:78px;width:18px;height:18px;border-radius:50%;border:2px solid #B0332B;background:radial-gradient(circle at 35% 30%,#FFF3C8,#FFD54A);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#A9750B">¥</div>
    </div>
    <div style="position:absolute;left:36px;top:408px;width:70px;height:44px">
      <div style="position:absolute;left:0;bottom:0;width:70px;height:20px;border-radius:50%;background:radial-gradient(ellipse,#8FD4F5,#4E9FD8);border:3px solid #EFCB6E"></div>
      <div style="position:absolute;left:31px;bottom:14px;width:8px;height:24px;background:#EFCB6E;border-radius:3px"></div>
      <div style="position:absolute;left:28px;bottom:34px;width:14px;height:8px;border-radius:50%;background:#8FD4F5"></div>
      <div style="position:absolute;left:22px;bottom:26px;width:6px;height:14px;border-radius:3px;background:rgba(160,220,250,.8)"></div>
      <div style="position:absolute;left:42px;bottom:26px;width:6px;height:14px;border-radius:3px;background:rgba(160,220,250,.8)"></div>
    </div>` : ''}

    <!-- ごほうび台座（STAGE2 ゲームき）。ゲーム屋を290へ下げたぶん 352→386 に追従（設計の間隔を維持） -->
    ${bldRich ? `
    <div style="position:absolute;right:14px;top:386px;display:flex;flex-direction:column;align-items:center;gap:2px">
      <div style="position:relative;width:100px;height:64px">
        <div style="position:absolute;left:12px;top:6px;width:74px;height:48px;border-radius:50%;background:radial-gradient(ellipse,rgba(255,226,120,.7),rgba(255,226,120,0) 70%)"></div>
        <div style="position:absolute;left:12px;top:10px;animation:mfloat2 3.2s ease-in-out infinite">
          <div style="position:relative;width:78px;height:36px">
            <div style="position:absolute;left:0;top:0;width:14px;height:36px;border-radius:7px 0 0 7px;background:linear-gradient(180deg,#3FD0CB,#1FA0A4)"></div>
            <div style="position:absolute;left:64px;top:0;width:14px;height:36px;border-radius:0 7px 7px 0;background:linear-gradient(180deg,#FF9052,#E85D2A)"></div>
            <div style="position:absolute;left:14px;top:0;width:50px;height:36px;background:linear-gradient(180deg,#3E4450,#23272F)">
              <div style="position:absolute;left:5px;top:5px;width:40px;height:26px;border-radius:3px;background:linear-gradient(160deg,#8FD4F5,#4B9FD8);display:flex;align-items:center;justify-content:center"><div style="width:14px;height:14px;border-radius:50%;border:2px solid #E8B62B;background:radial-gradient(circle at 35% 30%,#FFEFAE,#FFD54A 55%,#DFA318);font-size:8px;font-weight:800;color:#A9750B;display:flex;align-items:center;justify-content:center">¥</div></div>
            </div>
          </div>
        </div>
        <div style="position:absolute;left:16px;bottom:0;width:66px;height:18px;clip-path:polygon(12% 0,88% 0,100% 100%,0 100%);background:linear-gradient(180deg,#FFE28A,#D9A335)"></div>
      </div>
    </div>` : ''}

    <!-- 達成トロフィー（STAGE4） -->
    ${achieved ? `
    <div style="position:absolute;right:16px;top:344px;display:flex;flex-direction:column;align-items:center;gap:3px">
      <div style="position:relative;width:96px;height:78px;animation:mfloat2 3s ease-in-out infinite">
        <div style="position:absolute;left:8px;top:2px;width:80px;height:60px;border-radius:50%;background:radial-gradient(ellipse,rgba(255,220,110,.85),rgba(255,220,110,0) 70%)"></div>
        <div style="position:absolute;left:30px;top:6px;width:36px;height:40px;border-radius:0 0 18px 18px;background:linear-gradient(180deg,#FFE9A0,#E7BE5C);box-shadow:inset -4px -4px 8px rgba(150,100,20,.35)"></div>
        <div style="position:absolute;left:18px;top:12px;width:14px;height:22px;border-radius:0 0 0 10px;border:4px solid #E7BE5C;border-right:none"></div>
        <div style="position:absolute;right:18px;top:12px;width:14px;height:22px;border-radius:0 0 10px 0;border:4px solid #E7BE5C;border-left:none"></div>
        <div style="position:absolute;left:40px;bottom:2px;width:16px;height:12px;background:#D9A335"></div>
        <div style="position:absolute;left:30px;bottom:0;width:36px;height:8px;border-radius:3px;background:#8A5E0A"></div>
        <div style="position:absolute;left:40px;top:18px;font-size:14px;font-weight:800;color:#A9750B">¥</div>
        <div style="position:absolute;left:6px;top:8px;width:10px;height:10px;background:#FFF7C8;animation:msparkle 1.6s ease-in-out infinite"></div>
        <div style="position:absolute;right:2px;top:24px;width:8px;height:8px;background:#FFF7C8;animation:msparkle 1.6s ease-in-out infinite;animation-delay:-.7s"></div>
      </div>
      <div style="padding:3px 12px;border-radius:999px;background:#C0392B;color:#FFF3D0;font-size:11px;font-weight:800;box-shadow:0 3px 8px rgba(150,20,20,.35)">目標たっせい!</div>
    </div>` : ''}

    <!-- 追加の装飾：STAGE0 -->
    ${bldPoor ? `
    <div style="position:absolute;left:12px;top:452px;width:44px;height:52px">
      <div style="position:absolute;inset:0;border-radius:10px/16px;background:linear-gradient(90deg,#7A552E,#A97C4A 45%,#6E4A26);box-shadow:inset -6px 0 8px rgba(60,38,12,.4)"></div>
      <div style="position:absolute;left:0;right:0;top:9px;height:5px;background:#5E4426"></div>
      <div style="position:absolute;left:0;right:0;bottom:11px;height:5px;background:#5E4426"></div>
      <div style="position:absolute;left:0;right:0;top:2px;height:7px;border-radius:50%;background:#6E4E2C"></div>
    </div>
    <div style="position:absolute;right:24px;top:452px;width:38px;height:42px">
      <div style="position:absolute;left:2px;top:8px;width:34px;height:34px;border-radius:0 0 8px 8px;background:linear-gradient(180deg,#C97B4A,#9A5A30);box-shadow:inset -4px -4px 6px rgba(80,40,10,.4)"></div>
      <div style="position:absolute;left:0;top:4px;width:38px;height:10px;border-radius:4px;background:#B96C3E"></div>
      <div style="position:absolute;left:18px;top:10px;width:2px;height:26px;background:rgba(60,30,10,.5);transform:rotate(7deg)"></div>
      <div style="position:absolute;left:6px;top:4px;width:8px;height:14px;background:#7C8A54;clip-path:polygon(50% 0,100% 100%,0 100%)"></div>
    </div>
    <div style="position:absolute;left:66px;top:646px;width:60px;height:30px">
      <div style="position:absolute;left:0;bottom:0;width:30px;height:22px;border-radius:50%;background:linear-gradient(180deg,#B7B2A6,#8C877B)"></div>
      <div style="position:absolute;left:24px;bottom:0;width:26px;height:18px;border-radius:50%;background:linear-gradient(180deg,#A9A498,#837E72)"></div>
      <div style="position:absolute;left:12px;bottom:12px;width:22px;height:16px;border-radius:50%;background:linear-gradient(180deg,#C2BDB1,#948F83)"></div>
    </div>
    <div style="position:absolute;right:52px;top:640px;width:52px;height:42px">
      <div style="position:absolute;left:0;right:0;top:10px;bottom:0;background:linear-gradient(180deg,#C9A66E,#A9854A);border-radius:3px;box-shadow:inset -5px -6px 8px rgba(90,60,20,.35)"></div>
      <div style="position:absolute;left:0;right:0;top:10px;height:14px;background:rgba(255,255,255,.1)"></div>
      <div style="position:absolute;left:4px;top:0;width:20px;height:14px;background:#B8965E;transform:skewX(-20deg);border-radius:2px"></div>
      <div style="position:absolute;right:4px;top:0;width:20px;height:14px;background:#B8965E;transform:skewX(20deg);border-radius:2px"></div>
    </div>
    <div style="position:absolute;left:150px;top:520px;width:20px;height:20px;border-radius:50%;border:2px solid #C9C4B6;background:radial-gradient(circle at 35% 30%,#EDE9DE,#C4BFB0);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#8C877B">¥</div>
    <div style="position:absolute;right:126px;top:566px;width:72px;height:20px;border-radius:50%;background:radial-gradient(ellipse,rgba(150,168,178,.5),rgba(150,168,178,.16));box-shadow:inset 0 2px 4px rgba(80,100,110,.3)"></div>
    <div style="position:absolute;left:104px;top:470px;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:22px solid #9A8C5A"></div>
    <div style="position:absolute;left:114px;top:474px;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-bottom:18px solid #8C7E50"></div>` : ''}

    <!-- 追加の装飾：STAGE1 -->
    ${bldBasic ? `
    <div style="position:absolute;left:12px;top:450px;width:56px;height:48px">
      <div style="position:absolute;left:0;bottom:0;width:56px;height:30px;background:repeating-linear-gradient(90deg,#B98C50 0 9px,#A87C40 9px 12px);border-radius:3px;box-shadow:inset 0 -4px 6px rgba(90,60,20,.3)"></div>
      <div style="position:absolute;left:6px;bottom:24px;width:12px;height:16px;border-radius:6px 6px 8px 8px;background:linear-gradient(180deg,#E8863C,#D96A22)"></div>
      <div style="position:absolute;left:7px;bottom:38px;width:3px;height:8px;background:#5E8A3A;transform:rotate(-12deg)"></div>
      <div style="position:absolute;left:22px;bottom:24px;width:12px;height:16px;border-radius:6px 6px 8px 8px;background:linear-gradient(180deg,#E8863C,#D96A22)"></div>
      <div style="position:absolute;left:38px;bottom:22px;width:16px;height:16px;border-radius:50%;background:linear-gradient(180deg,#7CB84C,#5A9A34)"></div>
    </div>
    <div style="position:absolute;right:24px;top:452px;width:52px;height:44px;border-radius:12px;background:repeating-linear-gradient(90deg,#E8C86A 0 6px,#D6B24E 6px 10px);box-shadow:inset -6px -6px 10px rgba(150,110,30,.35),0 3px 6px rgba(120,90,20,.25)">
      <div style="position:absolute;left:0;right:0;top:0;height:12px;border-radius:12px 12px 0 0;background:rgba(255,240,190,.35)"></div>
    </div>
    <div style="position:absolute;left:90px;top:522px;width:46px;height:34px">
      <div style="position:absolute;left:4px;bottom:0;width:30px;height:26px;border-radius:5px;background:linear-gradient(180deg,#9FB6BE,#6E8A94);box-shadow:inset -4px -4px 6px rgba(40,60,70,.4)"></div>
      <div style="position:absolute;left:26px;bottom:14px;width:20px;height:6px;background:#7E97A0;border-radius:3px;transform:rotate(-14deg)"></div>
      <div style="position:absolute;left:8px;bottom:22px;width:20px;height:8px;border:3px solid #7E97A0;border-bottom:none;border-radius:12px 12px 0 0;background:transparent"></div>
    </div>
    <div style="position:absolute;right:100px;top:522px;width:40px;height:44px">
      <div style="position:absolute;left:0;bottom:0;width:40px;height:36px;border-radius:8px 8px 10px 10px;background:linear-gradient(180deg,#D8C79A,#B8A470);box-shadow:inset -5px -5px 8px rgba(120,95,40,.35)"></div>
      <div style="position:absolute;left:8px;top:0;width:24px;height:12px;background:#C9B586;border-radius:8px 8px 0 0;clip-path:polygon(0 100%,20% 0,50% 60%,80% 0,100% 100%)"></div>
    </div>
    <div style="position:absolute;left:150px;top:452px;display:flex;align-items:flex-end;gap:14px">
      <div style="width:6px;height:26px;background:#9A7648;border-radius:2px"></div>
      <div style="width:6px;height:26px;background:#9A7648;border-radius:2px"></div>
      <div style="width:6px;height:26px;background:#9A7648;border-radius:2px"></div>
    </div>
    <div style="position:absolute;left:150px;top:460px;width:96px;height:5px;background:#8A6A40;border-radius:2px"></div>
    <div style="position:absolute;left:40px;top:648px;width:52px;height:36px">
      <div style="position:absolute;left:0;bottom:0;width:52px;height:20px;border-radius:4px;background:linear-gradient(180deg,#C97B4A,#9A5A30)"></div>
      <div style="position:absolute;left:8px;bottom:16px;width:10px;height:10px;border-radius:50%;background:#F06292"></div>
      <div style="position:absolute;left:22px;bottom:20px;width:10px;height:10px;border-radius:50%;background:#F5C542"></div>
      <div style="position:absolute;left:36px;bottom:16px;width:10px;height:10px;border-radius:50%;background:#EF6FA0"></div>
    </div>
    <div style="position:absolute;right:66px;top:600px;animation:mfloat2 3s ease-in-out infinite">
      <div style="position:relative;width:22px;height:16px">
        <div style="position:absolute;left:0;top:0;width:10px;height:14px;border-radius:50%;background:#F5A623;transform:rotate(-16deg)"></div>
        <div style="position:absolute;right:0;top:0;width:10px;height:14px;border-radius:50%;background:#F5A623;transform:rotate(16deg)"></div>
        <div style="position:absolute;left:9px;top:2px;width:3px;height:12px;border-radius:2px;background:#5E4426"></div>
      </div>
    </div>` : ''}

    <!-- 追加の装飾：STAGE2（街灯はゲーム屋の移動に追従して 344→380） -->
    ${bldRich ? `
    <div style="position:absolute;right:24px;top:380px;width:26px;height:96px">
      <div style="position:absolute;left:10px;top:22px;width:6px;height:74px;background:linear-gradient(90deg,#3E4A55,#5E6E7A);border-radius:3px"></div>
      <div style="position:absolute;left:2px;top:8px;width:22px;height:18px;border-radius:6px 6px 10px 10px;background:radial-gradient(circle at 40% 30%,#FFF3B8,#FFD54A);box-shadow:0 0 12px rgba(255,213,74,.7)"></div>
      <div style="position:absolute;left:6px;top:2px;width:14px;height:8px;border-radius:4px 4px 0 0;background:#3E4A55"></div>
      <div style="position:absolute;left:2px;bottom:0;width:22px;height:6px;border-radius:3px;background:#3E4A55"></div>
    </div>
    <div style="position:absolute;left:14px;top:648px;width:70px;height:34px">
      <div style="position:absolute;left:2px;bottom:0;width:66px;height:8px;background:#A9713E;border-radius:2px"></div>
      <div style="position:absolute;left:2px;bottom:12px;width:66px;height:7px;background:#B97E48;border-radius:2px"></div>
      <div style="position:absolute;left:4px;bottom:20px;width:64px;height:7px;background:#B97E48;border-radius:2px"></div>
      <div style="position:absolute;left:4px;bottom:0;width:5px;height:22px;background:#7A5230"></div>
      <div style="position:absolute;right:4px;bottom:0;width:5px;height:22px;background:#7A5230"></div>
    </div>
    <div style="position:absolute;right:26px;top:452px;animation:mfloat2 3.4s ease-in-out infinite">
      <div style="position:relative;width:48px;height:70px">
        <div style="position:absolute;left:2px;top:0;width:24px;height:30px;border-radius:50%;background:radial-gradient(circle at 35% 28%,#FF9AB0,#E0447E)"></div>
        <div style="position:absolute;left:20px;top:6px;width:24px;height:30px;border-radius:50%;background:radial-gradient(circle at 35% 28%,#8FD0F5,#3E8FD0)"></div>
        <div style="position:absolute;left:12px;top:14px;width:22px;height:28px;border-radius:50%;background:radial-gradient(circle at 35% 28%,#FFE08A,#F0B429)"></div>
        <div style="position:absolute;left:22px;top:30px;width:2px;height:38px;background:rgba(90,60,20,.5)"></div>
      </div>
    </div>
    <div style="position:absolute;right:34px;top:642px;width:44px;height:46px">
      <div style="position:absolute;left:14px;bottom:0;width:16px;height:16px;background:linear-gradient(180deg,#C97B4A,#9A5A30);border-radius:3px"></div>
      <div style="position:absolute;left:6px;bottom:12px;width:32px;height:26px;border-radius:50%;background:radial-gradient(circle at 38% 30%,#7CC44E,#4E9A32);box-shadow:inset -4px -4px 8px rgba(30,80,20,.4)"></div>
      <div style="position:absolute;left:16px;bottom:22px;width:8px;height:8px;border-radius:50%;background:#F5C542"></div>
    </div>
    <div style="position:absolute;left:118px;top:474px;width:38px;height:40px">
      <div style="position:absolute;left:0;bottom:0;width:38px;height:30px;background:linear-gradient(180deg,#E85585,#C93A6A);border-radius:2px 2px 3px 3px"></div>
      <div style="position:absolute;left:6px;top:2px;width:10px;height:12px;border:2px solid #C93A6A;border-bottom:none;border-radius:6px 6px 0 0;background:transparent"></div>
      <div style="position:absolute;right:6px;top:2px;width:10px;height:12px;border:2px solid #C93A6A;border-bottom:none;border-radius:6px 6px 0 0;background:transparent"></div>
      <div style="position:absolute;left:0;right:0;top:12px;height:4px;background:rgba(255,255,255,.4)"></div>
    </div>
    <div style="position:absolute;right:122px;top:560px;width:22px;height:22px;border-radius:50%;border:2px solid #E8B62B;background:radial-gradient(circle at 35% 30%,#FFEFAE,#FFD54A 55%,#DFA318);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#A9750B">¥</div>
    <div style="position:absolute;right:106px;top:572px;width:16px;height:16px;border-radius:50%;border:2px solid #E8B62B;background:radial-gradient(circle at 35% 30%,#FFEFAE,#FFD54A 55%,#DFA318)"></div>` : ''}

    <!-- 追加の装飾：STAGE4（右側の行灯は #k-pig と重なるため削除） -->
    ${bldPalace ? `
    <div style="position:absolute;left:50%;top:430px;width:120px;height:300px;transform:translateX(-50%);background:linear-gradient(180deg,#B0332B,#8E2018);clip-path:polygon(30% 0,70% 0,100% 100%,0 100%);box-shadow:inset 0 0 24px rgba(60,10,10,.4)"></div>
    <div style="position:absolute;left:50%;top:430px;width:120px;height:300px;transform:translateX(-50%);background:repeating-linear-gradient(90deg,rgba(245,197,66,.55) 0 3px,rgba(0,0,0,0) 3px 13px);clip-path:polygon(33% 0,40% 0,22% 100%,4% 100%)"></div>
    <div style="position:absolute;left:12px;top:452px;width:58px;height:50px">
      <div style="position:absolute;left:0;bottom:0;width:58px;height:30px;border-radius:3px;background:linear-gradient(180deg,#8A5E2E,#5E3E18);box-shadow:inset -5px -5px 8px rgba(40,25,8,.5)"></div>
      <div style="position:absolute;left:-2px;bottom:24px;width:62px;height:16px;border-radius:10px 10px 0 0;background:linear-gradient(180deg,#A9713E,#7A4E24);transform:rotate(-4deg);transform-origin:left"></div>
      <div style="position:absolute;left:0;right:0;bottom:14px;height:5px;background:#F5C542"></div>
      <div style="position:absolute;left:26px;bottom:8px;width:8px;height:12px;background:#F5C542;border-radius:2px"></div>
      <div style="position:absolute;left:8px;bottom:30px;width:10px;height:10px;border-radius:50%;background:radial-gradient(circle,#FFEFAE,#FFD54A);animation:msparkle 1.8s ease-in-out infinite"></div>
      <div style="position:absolute;left:24px;bottom:32px;width:10px;height:10px;border-radius:50%;background:radial-gradient(circle,#FFEFAE,#FFD54A)"></div>
      <div style="position:absolute;left:40px;bottom:30px;width:10px;height:10px;border-radius:50%;background:radial-gradient(circle,#FFEFAE,#FFD54A)"></div>
    </div>
    <div style="position:absolute;right:30px;top:466px;width:64px;height:36px">
      <div style="position:absolute;left:0;bottom:0;width:20px;height:20px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#FFEFAE,#FFD54A 55%,#DFA318);border:2px solid #E8B62B"></div>
      <div style="position:absolute;left:16px;bottom:0;width:20px;height:20px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#FFEFAE,#FFD54A 55%,#DFA318);border:2px solid #E8B62B"></div>
      <div style="position:absolute;left:34px;bottom:0;width:20px;height:20px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#FFEFAE,#FFD54A 55%,#DFA318);border:2px solid #E8B62B"></div>
      <div style="position:absolute;left:10px;bottom:14px;width:20px;height:20px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#FFEFAE,#FFD54A 55%,#DFA318);border:2px solid #E8B62B;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#A9750B">¥</div>
      <div style="position:absolute;left:26px;bottom:14px;width:20px;height:20px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#FFEFAE,#FFD54A 55%,#DFA318);border:2px solid #E8B62B"></div>
    </div>
    <div style="position:absolute;left:100px;top:474px;width:18px;height:18px;transform:rotate(45deg);background:linear-gradient(135deg,#FF7EA8,#D6316C);box-shadow:0 3px 6px rgba(180,40,90,.4)"></div>
    <div style="position:absolute;right:112px;top:566px;width:16px;height:16px;transform:rotate(45deg);background:linear-gradient(135deg,#8FD0F5,#3E8FD0);box-shadow:0 3px 6px rgba(30,90,160,.4)"></div>
    <div style="position:absolute;left:132px;top:558px;width:15px;height:15px;transform:rotate(45deg);background:linear-gradient(135deg,#9FE8A0,#3EA05E);box-shadow:0 3px 6px rgba(30,140,70,.4)"></div>
    <div style="position:absolute;left:36px;top:646px;width:44px;height:48px">
      <div style="position:absolute;left:6px;bottom:0;width:32px;height:32px;border-radius:0 0 14px 14px;background:linear-gradient(180deg,#FFE9A0,#D9A83E);box-shadow:inset -5px -5px 8px rgba(150,100,20,.4)"></div>
      <div style="position:absolute;left:2px;bottom:26px;width:40px;height:10px;border-radius:6px;background:#EBC468"></div>
      <div style="position:absolute;left:8px;bottom:32px;width:12px;height:12px;border-radius:50%;background:#E0447E"></div>
      <div style="position:absolute;left:22px;bottom:34px;width:12px;height:12px;border-radius:50%;background:#F06292"></div>
    </div>` : ''}

    <!-- 追加の装飾：STAGE3（fable裁定: 金のセダンは中央の道で猫と重なるためホームでは削除（マップ側に有）／金プランターも #k-pig と重なるため削除） -->
    ${bldTower ? `
    <div style="position:absolute;left:50%;top:430px;width:220px;height:300px;transform:translateX(-50%);background:linear-gradient(180deg,#6E7987,#525E6B);clip-path:polygon(38% 0,62% 0,100% 100%,0 100%);box-shadow:inset 0 0 24px rgba(20,30,40,.4)"></div>
    <div style="position:absolute;left:50%;top:430px;width:220px;height:300px;transform:translateX(-50%);background:repeating-linear-gradient(180deg,#F2E6C4 0 20px,rgba(0,0,0,0) 20px 44px);clip-path:polygon(49% 0,51% 0,52% 100%,48% 100%);opacity:.9"></div>
    <div style="position:absolute;left:50%;top:430px;width:220px;height:300px;transform:translateX(-50%);background:linear-gradient(180deg,#F5C542,#C89A2E);clip-path:polygon(38% 0,41% 0,3% 100%,0 100%)"></div>
    <div style="position:absolute;left:50%;top:430px;width:220px;height:300px;transform:translateX(-50%);background:linear-gradient(180deg,#F5C542,#C89A2E);clip-path:polygon(59% 0,62% 0,100% 100%,97% 100%)"></div>
    <div style="position:absolute;left:50%;top:676px;width:150px;height:34px;transform:translateX(-50%);background:repeating-linear-gradient(90deg,rgba(255,255,255,.92) 0 14px,rgba(0,0,0,0) 14px 30px);border-radius:3px"></div>
    <div style="position:absolute;right:12px;top:330px;width:76px;height:44px">
      <div style="position:absolute;left:0;top:0;width:76px;height:20px;border-radius:8px 8px 12px 12px;background:repeating-linear-gradient(90deg,#F5C542 0 12px,#FFF6E8 12px 24px);box-shadow:0 3px 6px rgba(150,100,20,.3)"></div>
      <div style="position:absolute;left:14px;top:22px;width:48px;height:18px;border-radius:6px;background:#FFFDF4;border:2.5px solid #C89A2E;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#8A5E0A">ホテル</div>
    </div>
    <div style="position:absolute;left:24px;top:500px;width:26px;height:96px">
      <div style="position:absolute;left:10px;top:22px;width:6px;height:74px;background:linear-gradient(90deg,#3E4A55,#5E6E7A);border-radius:3px"></div>
      <div style="position:absolute;left:2px;top:8px;width:22px;height:18px;border-radius:6px 6px 10px 10px;background:radial-gradient(circle at 40% 30%,#FFF3B8,#FFD54A);box-shadow:0 0 12px rgba(255,213,74,.7)"></div>
      <div style="position:absolute;left:6px;top:2px;width:14px;height:8px;border-radius:4px 4px 0 0;background:#3E4A55"></div>
      <div style="position:absolute;left:2px;bottom:0;width:22px;height:6px;border-radius:3px;background:#3E4A55"></div>
    </div>
    <div style="position:absolute;right:24px;top:500px;width:26px;height:96px">
      <div style="position:absolute;left:10px;top:22px;width:6px;height:74px;background:linear-gradient(90deg,#3E4A55,#5E6E7A);border-radius:3px"></div>
      <div style="position:absolute;left:2px;top:8px;width:22px;height:18px;border-radius:6px 6px 10px 10px;background:radial-gradient(circle at 40% 30%,#FFF3B8,#FFD54A);box-shadow:0 0 12px rgba(255,213,74,.7)"></div>
      <div style="position:absolute;left:6px;top:2px;width:14px;height:8px;border-radius:4px 4px 0 0;background:#3E4A55"></div>
      <div style="position:absolute;left:2px;bottom:0;width:22px;height:6px;border-radius:3px;background:#3E4A55"></div>
    </div>` : ''}
  `;
}

// 「買ったもの」フロート（left:16 top:376）。ステージ別アイコン＋ラベルは実データ label。
export function stageBuyIconHtml(s: number, label: string): string {
  const L = `<div style="position:absolute;left:-2px;bottom:-6px;padding:2px 8px;border-radius:999px;background:#FFFDF6;box-shadow:0 3px 8px rgba(120,80,20,.25);font-size:10.5px;font-weight:800;color:#7A5A20;white-space:nowrap">${esc(label)}</div>`;
  const L4 = `<div style="position:absolute;left:-4px;bottom:-6px;padding:2px 8px;border-radius:999px;background:#FFFDF6;box-shadow:0 3px 8px rgba(120,80,20,.25);font-size:10.5px;font-weight:800;color:#7A5A20;white-space:nowrap">${esc(label)}</div>`;
  let icon = '';
  if (s === 0) {
    icon = `
      <div style="position:relative;width:70px;height:44px">
        <div style="position:absolute;left:6px;top:8px;width:48px;height:14px;border-radius:7px;background:linear-gradient(180deg,#FFE08A,#E8B23C);transform:rotate(-8deg);box-shadow:0 2px 5px rgba(150,100,20,.3)"></div>
        ${L}
      </div>`;
  } else if (s === 1) {
    icon = `
      <div style="position:relative;width:70px;height:52px">
        <div style="position:absolute;left:12px;top:2px;width:36px;height:34px;border-radius:50% 50% 46% 46%;background:linear-gradient(180deg,#FFFCF2,#EFE7CE);box-shadow:inset 0 -4px 6px rgba(150,120,60,.25),0 3px 6px rgba(120,90,30,.25)"></div>
        <div style="position:absolute;left:20px;bottom:12px;width:20px;height:16px;background:#3E4A3A;border-radius:3px"></div>
        ${L}
      </div>`;
  } else if (s === 2) {
    icon = `
      <div style="position:relative;width:80px;height:52px">
        <div style="position:absolute;left:34px;top:0;width:26px;height:26px;border-radius:50%;background:repeating-radial-gradient(circle at 50% 50%,#FF6FA0 0 4px,#FFF3F6 4px 8px);border:2.5px solid #E85585"></div>
        <div style="position:absolute;left:0;top:20px;width:34px;height:22px;border-radius:50%;background:linear-gradient(160deg,#FFB1C8,#F06292)"></div>
        ${L4}
      </div>`;
  } else if (s === 3) {
    icon = `
      <div style="position:relative;width:76px;height:54px">
        <div style="position:absolute;left:10px;top:16px;width:44px;height:20px;border-radius:4px 4px 6px 6px;background:linear-gradient(180deg,#FFF6E8,#F0DCC0);box-shadow:inset 0 -4px 6px rgba(150,100,60,.25),0 3px 6px rgba(120,90,30,.25)"></div>
        <div style="position:absolute;left:14px;top:7px;width:36px;height:13px;border-radius:7px 7px 0 0;background:linear-gradient(180deg,#FFB1C8,#F06292)"></div>
        <div style="position:absolute;left:29px;top:1px;width:7px;height:8px;border-radius:50%;background:#C0392B"></div>
        ${L}
      </div>`;
  } else {
    icon = `
      <div style="position:relative;width:64px;height:56px">
        <div style="position:absolute;left:8px;top:6px;width:44px;height:30px;border-radius:6px;background:linear-gradient(160deg,#B7E3F5,#5FB0E0);border:3px solid #FFF;box-shadow:0 4px 8px rgba(40,90,140,.3);transform:rotate(-6deg)"></div>
        <div style="position:absolute;left:22px;top:0;width:16px;height:16px;transform:rotate(45deg);background:linear-gradient(160deg,#C4F0FF,#7FCBEA);border:2px solid #FFF"></div>
        ${L4}
      </div>`;
  }
  return `<div style="position:absolute;left:16px;top:376px;z-index:2;animation:mfloat2 3.8s ease-in-out infinite">${icon}</div>`;
}
