// マネコのぼうけん — RPGふうの「たびマップ」。
// ちょきんの累計(journeyTotal = すべての目標の saved 合計)が進むほど、
// 景色が「しょうてんがい → まち → とかい → タワマン → おおぞら → うちゅう」へと
// スケールアップし、マネコの衣装もどんどん豪華になる。
// ホームとは別画面（フルスクリーンの縦スクロール）で、地図ボタンから入る。
import { Overview } from './api';
import { el, yen } from './ui';
import { esc } from './phone';
import { manekoHtml, stageCostumeHtml } from './kids';

// ---- 旅の進捗モデル ------------------------------------------------------
export const JOURNEY_MAX = 100000; // ここまで貯めたら「うちゅう」到達（100%）

export type Stage = { at: number; key: string; name: string; sub: string };
export const STAGES: Stage[] = [
  { at: 0,      key: 'town',  name: 'しょうてんがい', sub: 'ふつうの まいにち' },
  { at: 3000,   key: 'machi', name: 'まち',           sub: 'すこし にぎやかに' },
  { at: 10000,  key: 'city',  name: 'とかい',         sub: 'ビルが いっぱい！' },
  { at: 30000,  key: 'tower', name: 'タワーマンション', sub: 'たかい たかい！' },
  { at: 60000,  key: 'sky',   name: 'おおぞら',        sub: 'ひこうきで びゅーん' },
  { at: 100000, key: 'space', name: 'うちゅう',        sub: 'ロケットで はっしゃ！' },
];

// いまの累計ちょきん（達成ずみ目標もふくむ）
export function journeyTotal(o: Overview): number {
  return o.goals.reduce((s, g) => s + Math.max(0, g.saved), 0);
}
// 現在のステージ番号（0..5）
export function currentStage(total: number): number {
  let i = 0;
  for (let k = 0; k < STAGES.length; k++) if (total >= STAGES[k].at) i = k;
  return i;
}
// 旅ぜんたいの達成率（0..100）。floor で、うちゅう(¥100,000)到達前に 100% と出さない
// （round だと 99,500 で 100% になり「達成」表示とロック表示が食い違う）。
export function journeyPercent(total: number): number {
  return Math.max(0, Math.min(100, Math.floor((total / JOURNEY_MAX) * 100)));
}

// ---- レイアウト定数 ------------------------------------------------------
const STAGE_H = 520;                       // 1ステージの縦の高さ(px)
const N = STAGES.length;
const TOP_PAD = 130;                       // トラック最上部の余白（固定バー＋ゴール旗のぶん）
const BOTTOM_PAD = 60;                      // 最下部の余白
const TRACK_H = TOP_PAD + STAGE_H * N + BOTTOM_PAD; // トラック全体の高さ
// トップ(top=0)が「うちゅう」、ボトムが「しょうてんがい」。
// ステージ i の帯は top = TOP_PAD + (N-1-i)*STAGE_H から STAGE_H 分。
const bandTop = (i: number) => TOP_PAD + (N - 1 - i) * STAGE_H;

// ---- 景色（ステージ別・CSS描画） ----------------------------------------
// それぞれの帯(STAGE_H)いっぱいに描く。座標は帯内の相対値。
function bandScenery(i: number): string {
  switch (STAGES[i].key) {
    case 'town': return townScene();
    case 'machi': return machiScene();
    case 'city': return cityScene();
    case 'tower': return towerScene();
    case 'sky': return skyScene();
    case 'space': return spaceScene();
    default: return '';
  }
}

// 小さなお店・家（幅可変の箱）
const house = (x: number, y: number, w: number, h: number, wall: string, roof: string) => `
  <div style="position:absolute;left:${x}px;bottom:${y}px;width:${w}px;height:${h}px">
    <div style="position:absolute;left:0;bottom:0;width:100%;height:${h - 14}px;border-radius:5px 5px 0 0;background:${wall};box-shadow:inset -6px -8px 12px rgba(120,90,40,.16)"></div>
    <div style="position:absolute;left:-5px;bottom:${h - 20}px;width:${w + 10}px;height:16px;border-radius:5px;background:${roof};box-shadow:0 2px 4px rgba(90,60,20,.3)"></div>
    <div style="position:absolute;left:${Math.round(w * 0.2)}px;bottom:8px;width:${Math.round(w * 0.22)}px;height:${Math.round(h * 0.35)}px;border-radius:3px;background:#8FD4F5;border:2px solid rgba(120,90,40,.4)"></div>
    <div style="position:absolute;left:${Math.round(w * 0.58)}px;bottom:8px;width:${Math.round(w * 0.22)}px;height:${Math.round(h * 0.35)}px;border-radius:3px;background:#8FD4F5;border:2px solid rgba(120,90,40,.4)"></div>
  </div>`;

const tree = (x: number, y: number, s = 1) => `
  <div style="position:absolute;left:${x}px;bottom:${y}px;transform:scale(${s});transform-origin:bottom center">
    <div style="position:absolute;left:9px;bottom:0;width:8px;height:26px;background:#9C6B3B;border-radius:3px"></div>
    <div style="position:absolute;left:-4px;bottom:20px;width:34px;height:34px;border-radius:50%;background:radial-gradient(circle at 38% 30%,#8FD07A,#4E9E52)"></div>
  </div>`;

// building with a grid of windows
const building = (x: number, y: number, w: number, h: number, c1: string, c2: string, lit = false) => {
  const cols = Math.max(2, Math.round(w / 22));
  const rows = Math.max(3, Math.round(h / 34));
  let win = '';
  for (let r = 0; r < rows; r++) for (let cN = 0; cN < cols; cN++) {
    const on = lit && ((r + cN) % 3 === 0);
    win += `<div style="position:absolute;left:${8 + cN * ((w - 16) / cols)}px;top:${12 + r * ((h - 20) / rows)}px;width:${(w - 16) / cols - 5}px;height:${(h - 20) / rows - 8}px;border-radius:2px;background:${on ? '#FFE9A8' : 'rgba(255,255,255,.28)'}"></div>`;
  }
  return `<div style="position:absolute;left:${x}px;bottom:${y}px;width:${w}px;height:${h}px;border-radius:5px 5px 0 0;background:linear-gradient(180deg,${c1},${c2});box-shadow:inset -8px 0 14px rgba(20,40,70,.25)">${win}</div>`;
};

const cloud = (x: number, y: number, s = 1, op = .9) => `
  <div style="position:absolute;left:${x}px;top:${y}px;transform:scale(${s});width:120px;height:40px">
    <div style="position:absolute;left:0;top:10px;width:120px;height:30px;border-radius:999px;background:rgba(255,255,255,${op})"></div>
    <div style="position:absolute;left:22px;top:0;width:44px;height:40px;border-radius:50%;background:rgba(255,255,255,${op})"></div>
    <div style="position:absolute;left:56px;top:4px;width:40px;height:34px;border-radius:50%;background:rgba(255,255,255,${op})"></div>
  </div>`;

const star = (x: number, y: number, sz = 4, delay = 0) =>
  `<div style="position:absolute;left:${x}px;top:${y}px;width:${sz}px;height:${sz}px;border-radius:50%;background:#FFF7C8;box-shadow:0 0 6px #FFF7C8;animation:msparkle 2.2s ease-in-out infinite;animation-delay:${delay}s"></div>`;

// 田舎の商店街（ふつうの暮らし）
function townScene(): string {
  return `
    <div style="position:absolute;left:0;right:0;bottom:0;height:150px;background:linear-gradient(180deg,#CDE9AE,#A9D488)"></div>
    <div style="position:absolute;left:0;right:0;bottom:120px;height:60px;background:linear-gradient(180deg,rgba(140,190,110,.6),rgba(140,190,110,0))"></div>
    <div style="position:absolute;left:-40px;bottom:120px;width:260px;height:90px;border-radius:50%;background:#B7DE93"></div>
    <div style="position:absolute;right:-60px;bottom:120px;width:240px;height:80px;border-radius:50%;background:#A6D283"></div>
    ${house(24, 40, 92, 96, 'linear-gradient(180deg,#FFF3DE,#F0D8AC)', 'linear-gradient(180deg,#C97B4A,#A85E34)')}
    ${house(150, 34, 84, 104, 'linear-gradient(180deg,#EAF3FB,#C9DDEE)', 'linear-gradient(180deg,#5E86B5,#3F638F)')}
    ${house(262, 42, 88, 92, 'linear-gradient(180deg,#FFE9D8,#F3C9A8)', 'linear-gradient(180deg,#D98A5A,#B96A3A)')}
    ${tree(4, 44, 1.1)}${tree(126, 40, .9)}${tree(238, 46, 1)}${tree(356, 40, 1.05)}
    <!-- 田んぼの手前 -->
    <div style="position:absolute;left:0;right:0;bottom:0;height:36px;background:repeating-linear-gradient(90deg,#93C46E 0 22px,#84B562 22px 44px)"></div>`;
}

// 住宅街・ちょっと栄えた町
function machiScene(): string {
  return `
    <div style="position:absolute;left:0;right:0;bottom:0;height:150px;background:linear-gradient(180deg,#D3E4C6,#BFD3AE)"></div>
    ${house(16, 40, 80, 92, 'linear-gradient(180deg,#FFF3DE,#EAD3A8)', 'linear-gradient(180deg,#C97B4A,#A85E34)')}
    ${building(104, 40, 62, 150, '#EAF0F6', '#C7D6E6', true)}
    ${house(180, 36, 78, 96, 'linear-gradient(180deg,#FDE9EE,#F3C4D0)', 'linear-gradient(180deg,#D9708C,#B95070)')}
    ${building(268, 40, 70, 176, '#F0ECF6', '#D3C9E6', true)}
    ${tree(92, 44, .8)}${tree(346, 42, .9)}
    <div style="position:absolute;left:0;right:0;bottom:0;height:30px;background:linear-gradient(180deg,#B9AE96,#9E947E)"></div>`;
}

// 都会・ビル街
function cityScene(): string {
  return `
    <div style="position:absolute;left:0;right:0;bottom:0;height:200px;background:linear-gradient(180deg,rgba(150,175,205,.4),rgba(120,150,185,.65))"></div>
    ${building(6, 24, 66, 250, '#8FA6C4', '#6C86AA', true)}
    ${building(76, 24, 58, 320, '#A2B6D0', '#7E97BB', true)}
    ${building(140, 24, 72, 210, '#9CB0CC', '#748EB4', true)}
    ${building(216, 24, 60, 300, '#B0C2DA', '#8AA1C2', true)}
    ${building(282, 24, 74, 260, '#93A9C8', '#6F8AB0', true)}
    <div style="position:absolute;left:0;right:0;bottom:0;height:26px;background:linear-gradient(180deg,#6E6B78,#54525E)"></div>`;
}

// タワーマンション（ひときわ高い）
function towerScene(): string {
  return `
    <div style="position:absolute;left:0;right:0;bottom:0;height:${STAGE_H}px;background:linear-gradient(180deg,rgba(120,160,215,.15),rgba(120,160,215,0))"></div>
    ${building(18, 20, 74, 300, '#8AA6CE', '#647FA8', true)}
    ${building(292, 20, 78, 330, '#95AFD2', '#6E88B0', true)}
    <!-- 主役のタワマン -->
    <div style="position:absolute;left:50%;bottom:20px;transform:translateX(-50%);width:120px;height:452px;border-radius:12px 12px 0 0;background:linear-gradient(180deg,#EAF2FB,#B9CEE6);box-shadow:0 10px 30px rgba(40,70,120,.3),inset -12px 0 22px rgba(60,90,140,.22)">
      ${(() => { let w = ''; for (let r = 0; r < 15; r++) for (let c = 0; c < 4; c++) { const on = (r * 4 + c) % 4 === 0; w += `<div style="position:absolute;left:${12 + c * 26}px;top:${14 + r * 28}px;width:18px;height:16px;border-radius:2px;background:${on ? '#FFE9A8' : 'rgba(120,150,190,.5)'}"></div>`; } return w; })()}
      <div style="position:absolute;left:50%;top:-16px;transform:translateX(-50%);width:8px;height:20px;background:#8AA6CE"></div>
      <div style="position:absolute;left:50%;top:-22px;transform:translateX(-50%);width:8px;height:8px;border-radius:50%;background:#E8483F;animation:msparkle 1.6s ease-in-out infinite"></div>
    </div>`;
}

// おおぞら・ひこうき
function skyScene(): string {
  return `
    ${cloud(20, 60, 1.1, .95)}${cloud(240, 130, 1.3, .9)}${cloud(120, 300, 1, .85)}${cloud(280, 380, .9, .8)}
    <!-- ひこうき -->
    <div style="position:absolute;left:60px;top:180px;animation:mcloud 9s ease-in-out infinite">
      <div style="position:relative;width:170px;height:60px">
        <div style="position:absolute;left:14px;top:20px;width:140px;height:24px;border-radius:16px;background:linear-gradient(180deg,#FFFFFF,#D7E2EE);box-shadow:0 6px 12px rgba(60,90,130,.25)"></div>
        <div style="position:absolute;left:150px;top:22px;width:0;height:0;border-top:10px solid transparent;border-bottom:10px solid transparent;border-left:18px solid #C7D6E6"></div>
        <div style="position:absolute;left:60px;top:4px;width:34px;height:22px;border-radius:8px 8px 0 0;background:#B9CEE6;transform:skewX(-20deg)"></div>
        <div style="position:absolute;left:66px;top:34px;width:40px;height:20px;border-radius:0 0 10px 10px;background:#A9C0DC;transform:skewX(18deg)"></div>
        <div style="position:absolute;left:30px;top:26px;width:70px;height:9px;border-radius:5px;background:#8FD4F5"></div>
      </div>
    </div>`;
}

// うちゅう・ロケット
function spaceScene(): string {
  let stars = '';
  const pts = [[30, 40], [90, 120], [160, 60], [240, 150], [320, 40], [360, 200], [60, 260], [200, 280], [300, 320], [130, 360], [40, 420], [280, 440], [350, 380], [110, 460]];
  pts.forEach((p, k) => { stars += star(p[0], p[1], 3 + (k % 3), -(k * 0.3)); });
  return `
    ${stars}
    <!-- 月 -->
    <div style="position:absolute;right:30px;top:60px;width:70px;height:70px;border-radius:50%;background:radial-gradient(circle at 38% 32%,#FFF6D8,#E8D9A8);box-shadow:0 0 24px rgba(255,240,200,.5)">
      <div style="position:absolute;left:16px;top:20px;width:12px;height:12px;border-radius:50%;background:rgba(190,170,120,.5)"></div>
      <div style="position:absolute;left:40px;top:40px;width:9px;height:9px;border-radius:50%;background:rgba(190,170,120,.45)"></div>
    </div>
    <!-- わっかの星 -->
    <div style="position:absolute;left:36px;top:150px;width:60px;height:60px">
      <div style="position:absolute;left:8px;top:8px;width:44px;height:44px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#FFC98F,#D9743F)"></div>
      <div style="position:absolute;left:-6px;top:24px;width:72px;height:12px;border-radius:50%;border:3px solid rgba(255,220,170,.75);transform:rotate(-18deg)"></div>
    </div>
    <!-- ロケット -->
    <div style="position:absolute;left:50%;top:230px;transform:translateX(-50%);animation:mfloat 3.4s ease-in-out infinite">
      <div style="position:relative;width:80px;height:170px">
        <div style="position:absolute;left:20px;top:0;width:40px;height:120px;border-radius:50% 50% 22px 22px;background:linear-gradient(90deg,#F5F7FA,#C9D3DF);box-shadow:inset -6px 0 10px rgba(90,110,140,.3)"></div>
        <div style="position:absolute;left:26px;top:30px;width:28px;height:28px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#BFefff,#4B9FD8);border:3px solid #E8EEF5"></div>
        <div style="position:absolute;left:20px;top:0;width:40px;height:22px;border-radius:50% 50% 0 0;background:#E8483F"></div>
        <div style="position:absolute;left:-2px;top:86px;width:24px;height:40px;border-radius:12px 0 0 20px;background:#E8483F"></div>
        <div style="position:absolute;right:-2px;top:86px;width:24px;height:40px;border-radius:0 12px 20px 0;background:#E8483F"></div>
        <div style="position:absolute;left:28px;top:120px;width:24px;height:36px;border-radius:0 0 12px 12px;background:linear-gradient(180deg,#FFD54A,#F5822B);animation:mflame .5s ease-in-out infinite alternate"></div>
        <div style="position:absolute;left:34px;top:140px;width:12px;height:26px;border-radius:0 0 8px 8px;background:linear-gradient(180deg,#FFF3B8,#FFB65C)"></div>
      </div>
    </div>`;
}

// ---- チェックポイントの立て札（％と到達状況） ----------------------------
function checkpoint(i: number, reached: boolean, isCurrent: boolean): string {
  const st = STAGES[i];
  const pct = Math.round((st.at / JOURNEY_MAX) * 100);
  // 各ステージ帯の上のほうに立て札を置く（帯内相対 top）
  const topInBand = 40;
  const side = i % 2 === 0 ? 'left:18px' : 'right:18px';
  const border = reached ? '#E8B62B' : 'rgba(255,255,255,.5)';
  const bg = reached ? 'rgba(255,253,246,.96)' : 'rgba(70,80,110,.55)';
  const col = reached ? '#7A4A00' : '#EAF0FA';
  return `
  <div style="position:absolute;${side};top:${bandTop(i) + topInBand}px;width:150px;z-index:4">
    <div style="background:${bg};border:2.5px solid ${border};border-radius:14px;padding:8px 12px;box-shadow:0 6px 14px rgba(40,40,60,.28)${isCurrent ? ';outline:3px solid #E8483F;outline-offset:2px' : ''}">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:6px">
        <span style="font-size:13px;font-weight:800;color:${col}">${esc(st.name)}</span>
        <span style="font-size:12px;font-weight:800;color:${reached ? '#3E9E6C' : '#C7D2E6'}">${reached ? '✓' : '🔒'}</span>
      </div>
      <div style="font-size:10px;font-weight:700;color:${reached ? '#A08A60' : '#B9C4DA'};margin-top:2px">${esc(st.sub)}</div>
      <div style="font-size:10.5px;font-weight:800;color:${reached ? '#B9506E' : '#C7D2E6'};margin-top:3px">${pct}% ・ ${yen(st.at)}</div>
    </div>
  </div>`;
}

// ---- 旅マップ本体 --------------------------------------------------------
export function journeyView(o: Overview): HTMLElement {
  const total = journeyTotal(o);
  const stage = currentStage(total);
  const pct = journeyPercent(total);
  const reachedGoal = total >= JOURNEY_MAX;
  const next = STAGES[Math.min(N - 1, stage + 1)];
  const toNext = Math.max(0, next.at - total);

  // マネコの縦位置は「現在ステージの帯＋ステージ内の進み具合」で決める。
  // こうすると景色バンド・チェックポイントと同じ座標系に乗り、%の線形補間でズレない。
  //   frac=0（ステージ到達直後）→ そのステージ帯の中ほど、frac→1（次の閾値目前）→ 一つ上の帯へ。
  const CAT_IN_BAND = 250; // 帯の上端からマネコ立ち位置までの距離
  const frac = stage >= N - 1 ? 0
    : Math.min(1, (total - STAGES[stage].at) / (STAGES[stage + 1].at - STAGES[stage].at));
  const catY = Math.round(bandTop(stage) + CAT_IN_BAND - frac * STAGE_H);

  // 帯（景色）を積む
  let bands = '';
  for (let i = 0; i < N; i++) {
    bands += `<div style="position:absolute;left:0;right:0;top:${bandTop(i)}px;height:${STAGE_H}px;overflow:hidden">${bandScenery(i)}</div>`;
  }
  // チェックポイント
  let cps = '';
  for (let i = 0; i < N; i++) cps += checkpoint(i, total >= STAGES[i].at, i === stage);

  // 中央の道（点線ルート）
  const route = `<div style="position:absolute;left:50%;top:${TOP_PAD}px;bottom:${BOTTOM_PAD + 40}px;width:6px;transform:translateX(-50%);background:repeating-linear-gradient(180deg,rgba(255,255,255,.65) 0 16px,rgba(255,255,255,0) 16px 34px);z-index:1"></div>`;

  // マネコ＋「いまここ」フラグ＋ステージ衣装
  const catBlock = `
    <div style="position:absolute;left:50%;top:${catY}px;transform:translateX(-50%);z-index:6;display:flex;flex-direction:column;align-items:center">
      <div style="background:#E8483F;color:#FFF8EC;font-size:12px;font-weight:800;border-radius:999px;padding:4px 14px;box-shadow:0 5px 12px rgba(150,20,20,.4);white-space:nowrap;animation:mfloat2 2.4s ease-in-out infinite">いまここ ▶ ${pct}%</div>
      <div style="width:8px;height:12px;background:#E8483F;clip-path:polygon(50% 100%,0 0,100% 0)"></div>
      <div style="position:relative;width:300px;height:370px;transform:scale(.62);transform-origin:top center;margin-top:-6px">
        ${manekoHtml()}
        ${stageCostumeHtml(stage)}
      </div>
    </div>`;

  // トラック（背景いろは一番上のうちゅう→一番下の地上へ）
  const track = `
    <div class="jr-track" style="position:relative;width:100%;max-width:440px;margin:0 auto;height:${TRACK_H}px;background:linear-gradient(180deg,
        #070B22 0%, #0E1636 8%, #223066 18%, #4A73B8 30%, #74A6DE 42%,
        #A7CDEC 55%, #CFE6F0 66%, #D9E9CC 80%, #C3DCA0 92%, #A9D488 100%)">
      ${bands}
      ${route}
      ${cps}
      ${catBlock}
      <!-- 一番上：ゴール旗（固定バーの下・チェックポイントの上に置く） -->
      <div style="position:absolute;left:50%;top:74px;transform:translateX(-50%);z-index:5;text-align:center;width:max-content">
        <div style="background:rgba(255,253,246,.96);border:3px solid #E8B62B;border-radius:16px;padding:8px 18px;box-shadow:0 8px 20px rgba(20,20,40,.4)">
          <div style="font-size:14px;font-weight:800;color:#7A4A00">🏁 ゴールは うちゅう！</div>
          <div style="font-size:11px;font-weight:800;color:#B9506E;margin-top:2px">${yen(JOURNEY_MAX)} ためたら とうたつ 🚀</div>
        </div>
      </div>
    </div>`;

  // オーバーレイ（フルスクリーン・縦スクロール）
  const overlay = el('div', { class: 'jr-overlay' });
  overlay.innerHTML = `
    ${track}
    <!-- 上部固定バー -->
    <div class="jr-top">
      <button class="jr-back" type="button">← もどる</button>
      <div class="jr-title">🗺 マネコの ぼうけん</div>
      <div class="jr-hud">${pct}%</div>
    </div>
    <!-- 下部の現在地バナー -->
    <div class="jr-foot">
      <span style="font-weight:800">いま <b style="color:#FFD54A">${esc(STAGES[stage].name)}</b></span>
      <span style="opacity:.85">${reachedGoal ? 'ぜんぶ たっせい！すごい！' : `つぎの「${esc(next.name)}」まで あと ${yen(toNext)}`}</span>
    </div>`;

  // 入場アニメ（トラックをちょい寄り＝.jr-track のみ transform。overlay 自体は transform を
  // 持たせない＝固定バー .jr-top/.jr-foot が包含ブロックを奪われずビューポート固定のままになる）
  // → マネコの位置へ自動スクロール。
  requestAnimationFrame(() => {
    overlay.classList.add('jr-in');
    const target = catY - Math.round(window.innerHeight / 2) + 120;
    overlay.scrollTo({ top: Math.max(0, target), behavior: 'auto' });
  });

  // 閉じる。ブラウザ/端末の「戻る」でも閉じられるよう history と連動させ、
  // かつ hashchange 等で router が下の画面を作り替えても取り残されないようにする。
  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener('popstate', onPop);
    overlay.classList.remove('jr-in');
    overlay.classList.add('jr-out');
    window.setTimeout(() => overlay.remove(), 340); // トランジション(.32s)ぶん待って除去
  };
  const onPop = () => finish();               // 戻る（pushState を pop）→ 閉じる
  history.pushState({ jr: 1 }, '');
  window.addEventListener('popstate', onPop);
  overlay.querySelector('.jr-back')?.addEventListener('click', () => history.back());

  return overlay;
}

// ホーム等から呼ぶ: 旅マップを開く（body に載せてフルスクリーン表示）。
// 既に開いていれば二重に開かない。
export function openJourney(o: Overview): void {
  if (document.querySelector('.jr-overlay')) return;
  document.body.appendChild(journeyView(o));
}

// 取り残し防止: 画面遷移（router）から呼び、開いていれば旅マップを閉じる。
export function closeJourney(): void {
  document.querySelectorAll('.jr-overlay').forEach((e) => e.remove());
}
