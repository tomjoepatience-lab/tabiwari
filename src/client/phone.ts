// デザイン(2a/3a)は 402×840 の絶対配置キャンバス前提。
// 実アプリでは中央に「スマホ画面」として置き、狭い画面では等倍縮小する。
import { el } from './ui';

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export const CANVAS_W = 402;
export const CANVAS_H = 840;

// ソフトキーボードの高さを CSS 変数 --kb として公開する。
// iOS standalone PWA ではキーボード表示で window.innerHeight が縮まないため、
// fillHeight キャンバス（=画面高さ）の下端＝記録ボタンがキーボードの裏に隠れ、
// 既に最下部までスクロール済みだと前に出せなくなる（品数が多いほど顕著）。
// visualViewport の縮みぶんを --kb に入れ、.pc-scroll の下パディングに足すことで
// 保存ボタンをキーボードより上へスクロールできるようにする。
// デスクトップやキーボード非表示時は visualViewport==innerHeight なので --kb=0px（挙動不変）。
let kbInstalled = false;
export function installKeyboardInset(): void {
  if (kbInstalled || typeof window === 'undefined') return;
  const vv = window.visualViewport;
  if (!vv) return;
  kbInstalled = true;
  const root = document.documentElement;
  const update = () => {
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    // アドレスバー等の小さなブレは無視し、キーボード相当（120px超）だけ反映する。
    root.style.setProperty('--kb', inset > 120 ? `${Math.round(inset)}px` : '0px');
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}
installKeyboardInset();

// 402×840 のキャンバスを生成して返す。html を innerHTML で流し込む。
// fillHeight=true: キャンバス高さを画面高さに合わせ、内側の .pc-scroll だけでスクロールさせる
//   （固定840px＋body二重スクロールで下端が画面外に出る不具合を防ぐ）。ホームは絶対配置(840px前提)
//   なので既定 false のまま。
export function phoneCanvas(
  html: string,
  opts: { bg: string; fillHeight?: boolean } = { bg: '#F7F4EE' }
): { wrap: HTMLElement; canvas: HTMLElement; refit: () => void } {
  const canvas = el('div', { class: 'pc-canvas' + (opts.fillHeight ? ' fill' : '') });
  canvas.style.background = opts.bg;
  canvas.innerHTML = html;
  const wrap = el('div', { class: 'pc-wrap' }, [canvas]);

  const fit = () => {
    if (opts.fillHeight) {
      // fillHeight: transform を使わず幅いっぱい（最大 CANVAS_W）＋高さ画面フィット。
      // transform された要素は position:absolute の子(.pc-scroll)の包含ブロックにならず
      // 内側スクロールが壊れるため、ここでは scale せず等倍で画面に合わせる。
      // 高さは visualViewport ではなく layout viewport を使う:
      //   ソフトキーボード表示で visualViewport が縮むとキャンバスが跳ねるため。
      //   下限クランプもしない（横向き等 vh<キャンバスで body 二重スクロールに戻るのを防ぐ）。
      // 実機FB対応: innerHeight−8 固定だと、iPhone では main の padding
      // （env(safe-area-inset-top/bottom)≒59+34px）のぶんキャンバスが画面下へはみ出し、
      // ナビと保存ボタンが折り返しの下に沈んで「保存ボタンがナビに重なり上に出せない」状態に
      // なっていた。safe-area を差し引いた 100dvh ベースの calc にする（env()=0 の環境では
      // 従来の innerHeight−8 と同値）。px 指定はcalc/dvh未対応環境向けフォールバック。
      canvas.style.transform = 'none';
      const px = `${Math.round(window.innerHeight - 8)}px`;
      const h = 'calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 8px)';
      canvas.style.height = px;
      canvas.style.height = h;
      wrap.style.height = px;
      wrap.style.height = h;
      // .pc-scroll は canvas 直下（inset:0）なので canvas 高さに自動で追従する。
    } else {
      // ホーム（絶対配置 402×840・現在はこどもホームのみが利用）。
      // 入力フォーカス中（＝ソフトキーボードで innerHeight が縮む瞬間）は再計算をスキップし、
      // ホーム上のモーダル（けいじばん/ぶたさん貯金箱の入力）が極端に小さくなるのを防ぐ。
      // モーダルは .pc-canvas の子なので、canvas を縮めると入力も一緒に縮んでしまうため。
      const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '');
      if (typing) return;
      const vw = Math.min(window.innerWidth, document.documentElement.clientWidth);
      if (vw <= 500) {
        // 実機FB対応: contain（min スケール）だと縦長実機で上下に外側背景が見え、
        // ナビが画面下から浮きキャンバスの境目が見えていた。スマホ幅では cover スケール
        // （max）でビューポート全体を覆う。ただし左右の切れは片側14pxまでにキャップし、
        // 下端アンカー（wrap を overflow:hidden、canvas を bottom:0）で top 方向にだけ
        // はみ出させる → 下部ナビが常に画面最下部に着く。キャップで上に小さな残余ギャップが
        // 出る場合は body の stageBackdrop（先頭 0〜12% を sky 先頭色でフラット化）が埋める。
        const availW = vw;
        const availH = window.innerHeight;
        const scale = Math.min(
          Math.max(availW / CANVAS_W, availH / CANVAS_H), // cover
          (availW + 28) / CANVAS_W                        // 左右クロップは 14px×2 まで
        );
        canvas.style.height = `${CANVAS_H}px`;
        canvas.style.position = 'absolute';
        canvas.style.left = '50%';
        canvas.style.top = 'auto';
        canvas.style.bottom = '0';
        canvas.style.transformOrigin = 'bottom center';
        canvas.style.transform = `translateX(-50%) scale(${scale})`;
        wrap.style.position = 'relative';
        wrap.style.width = '100%';
        wrap.style.height = `${availH}px`;
        wrap.style.overflow = 'hidden';
      } else {
        // タブレット/PC（幅 > 500px）は従来どおり contain: 幅と高さの両方に収まるよう
        // 等倍縮小し、ゲーム画面のように全体が見える。cover 用の inline スタイルは戻す。
        canvas.style.position = '';
        canvas.style.left = '';
        canvas.style.top = '';
        canvas.style.bottom = '';
        canvas.style.transformOrigin = '';
        wrap.style.position = '';
        wrap.style.width = '';
        wrap.style.overflow = '';
        const availW = vw - 12;
        const availH = window.innerHeight - 16;
        const scale = Math.min(1, availW / CANVAS_W, availH / CANVAS_H);
        canvas.style.transform = `scale(${scale})`;
        canvas.style.height = `${CANVAS_H}px`;
        wrap.style.height = `${Math.round(CANVAS_H * scale)}px`;
      }
    }
  };
  fit();
  window.addEventListener('resize', fit);
  // wrap が DOM から外れたら（または一度も繋がれず捨てられたら）リスナーを掃除。
  // 画面遷移は #app の子差し替えなので、body ではなく #app を監視しないと発火しない。
  let wasConnected = false;
  const mo = new MutationObserver(() => {
    if (wrap.isConnected) { wasConnected = true; return; }
    if (wasConnected || !document.body.contains(wrap)) {
      window.removeEventListener('resize', fit);
      mo.disconnect();
    }
  });
  mo.observe(document.getElementById('app') ?? document.body, { childList: true });
  return { wrap, canvas, refit: fit };
}
