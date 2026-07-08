// デザイン(2a/3a)は 402×840 の絶対配置キャンバス前提。
// 実アプリでは中央に「スマホ画面」として置き、狭い画面では等倍縮小する。
import { el } from './ui';

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export const CANVAS_W = 402;
export const CANVAS_H = 840;

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
      // 高さは visualViewport ではなく layout viewport(innerHeight) を使う:
      //   ソフトキーボード表示で visualViewport が縮むとキャンバスが跳ねるため。
      //   下限クランプもしない（横向き等 vh<キャンバスで body 二重スクロールに戻るのを防ぐ）。
      const h = Math.round(window.innerHeight - 8);
      canvas.style.transform = 'none';
      canvas.style.height = `${h}px`;
      wrap.style.height = `${h}px`;
      // .pc-scroll は canvas 直下（inset:0）なので canvas 高さに自動で追従する。
    } else {
      // ホーム（絶対配置 402×840）は横幅に合わせて等倍縮小。
      const availW = Math.min(window.innerWidth, document.documentElement.clientWidth) - 12;
      const scale = Math.min(1, availW / CANVAS_W);
      canvas.style.transform = `scale(${scale})`;
      canvas.style.height = `${CANVAS_H}px`;
      wrap.style.height = `${Math.round(CANVAS_H * scale)}px`;
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
