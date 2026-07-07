// デザイン(2a/3a)は 402×840 の絶対配置キャンバス前提。
// 実アプリでは中央に「スマホ画面」として置き、狭い画面では等倍縮小する。
import { el } from './ui';

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export const CANVAS_W = 402;
export const CANVAS_H = 840;

// 402×840 のキャンバスを生成して返す。html を innerHTML で流し込む。
export function phoneCanvas(html: string, opts: { bg: string } = { bg: '#F7F4EE' }): { wrap: HTMLElement; canvas: HTMLElement } {
  const canvas = el('div', { class: 'pc-canvas' });
  canvas.style.background = opts.bg;
  canvas.innerHTML = html;
  const wrap = el('div', { class: 'pc-wrap' }, [canvas]);

  // 画面幅に合わせて等倍縮小（402px より狭い端末対策）
  const fit = () => {
    const avail = Math.min(window.innerWidth - 12, document.documentElement.clientWidth - 12);
    const scale = Math.min(1, avail / CANVAS_W);
    canvas.style.transform = `scale(${scale})`;
    wrap.style.height = `${Math.round(CANVAS_H * scale)}px`;
  };
  fit();
  window.addEventListener('resize', fit);
  // wrap が DOM から外れたら（または一度も繋がれず捨てられたら）リスナーを掃除
  let wasConnected = false;
  const mo = new MutationObserver(() => {
    if (wrap.isConnected) { wasConnected = true; return; }
    if (wasConnected || !document.body.contains(wrap)) {
      window.removeEventListener('resize', fit);
      mo.disconnect();
    }
  });
  mo.observe(document.body, { childList: true });
  return { wrap, canvas };
}
