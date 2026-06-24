// 思い出アルバム（自動生成＋スクラップブック・ビューア）
// tabikake のアルバム機能を web(vanilla DOM) に移植したもの。
// 素材は「思い出写真（trip_photos）」のみ。レシートはアルバムに入れない。
// フェーズ1: 写真を日付順に台紙へ並べ、表紙＋ページめくりで閲覧する
//           （写真のドラッグ/リサイズ/デコ等の編集は後続フェーズで上に積む）。
import { api, TripPhoto, TripDetail } from './api';

export type AlbumPage = {
  id: string;                 // 安定ID（cover / photo{id}）
  kind: 'cover' | 'photo';
  photoId?: number;
  url?: string;
  ratio?: number;             // 写真の縦横比 w/h（フレームを写真の形に合わせる）
  caption?: string | null;
  takenOn?: string | null;
  title?: string;            // cover のみ
  subtitle?: string;         // cover のみ
};

// 写真の縦横比を取得（失敗時は 1.4 で代用）
function loadRatio(url: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1.4);
    img.onerror = () => resolve(1.4);
    img.src = url;
  });
}

// 思い出写真からアルバムのページ列を組み立てる（表紙＋時系列の写真ページ）
export async function buildAlbumPages(d: TripDetail): Promise<AlbumPage[]> {
  // 撮影日（あれば）→ sort_order → id の順。アルバムは時系列。
  const sorted = [...d.photos].sort((a, b) => {
    const da = a.taken_on ?? '', db = b.taken_on ?? '';
    if (da !== db) return da < db ? -1 : 1;
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.id - b.id;
  });

  const ratios = await Promise.all(sorted.map((p) => loadRatio(api.tripPhotoUrl(p.id))));

  const cover: AlbumPage = {
    id: 'cover', kind: 'cover',
    url: sorted[0] ? api.tripPhotoUrl(sorted[0].id) : undefined,
    title: d.trip.title, subtitle: dateRange(d.trip.start_date, d.trip.end_date),
  };

  const photoPages: AlbumPage[] = sorted.map((p, i) => ({
    id: `photo${p.id}`, kind: 'photo', photoId: p.id,
    url: api.tripPhotoUrl(p.id), ratio: ratios[i],
    caption: p.caption, takenOn: p.taken_on,
  }));

  return [cover, ...photoPages];
}

// --- 描画 -------------------------------------------------------------
function fmtDate(s?: string | null) { return s ? s.slice(0, 10).replace(/-/g, '/') : ''; }
function dateRange(a: string | null, b: string | null) {
  if (!a && !b) return '';
  return [a, b].filter(Boolean).map((x) => fmtDate(String(x))).join(' – ');
}
// ページごとの微傾き（決定的・台紙に貼った写真風）
const TILTS = [-2.4, 1.7, -1.3, 2.1, -1.9, 1.2];

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, props: Record<string, any> = {}, children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: cls, style, ...rest } = props;
  if (cls) node.className = cls;
  if (style) node.setAttribute('style', style);
  Object.assign(node, rest);
  for (const c of children) node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return node;
}

function renderPage(p: AlbumPage, pageIdx: number): HTMLElement {
  if (p.kind === 'cover') {
    const bg = p.url
      ? h('img', { class: 'album-cover-bg', src: p.url })
      : h('div', { class: 'album-cover-bg album-cover-plain' });
    return h('section', { class: 'album-page album-cover' }, [
      bg,
      h('div', { class: 'album-cover-overlay' }, [
        h('div', { class: 'album-cover-plate' }, [
          h('div', { class: 'album-cover-title', textContent: p.title || 'アルバム' }),
          p.subtitle ? h('div', { class: 'album-cover-subtitle', textContent: p.subtitle }) : h('span'),
        ]),
      ]),
    ]);
  }

  const tilt = TILTS[pageIdx % TILTS.length];
  const img = h('img', { class: 'album-img', src: p.url, loading: 'lazy' });
  // 白フチ（プリント風）。aspect-ratio で写真の形にフレームを合わせる。
  const print = h('div', { class: 'album-print', style: `aspect-ratio:${p.ratio || 1.4};transform:rotate(${tilt}deg)` }, [img]);
  const area = h('div', { class: 'album-area' }, [print]);

  const footer = h('div', { class: 'album-footer' });
  if (p.takenOn) footer.append(h('div', { class: 'album-date', textContent: fmtDate(p.takenOn) }));
  if (p.caption) footer.append(h('div', { class: 'album-caption', textContent: p.caption }));

  return h('section', { class: 'album-page album-leaf' }, [area, footer]);
}

// アルバムを開く（フルスクリーンのページめくりビューア）
export async function openAlbum(d: TripDetail): Promise<void> {
  if (!d.photos.length) { alert('まだ思い出写真がありません。「思い出」タブから写真を追加してください。'); return; }

  const overlay = h('div', { class: 'album-overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };

  const pagesWrap = h('div', { class: 'album-pages' });
  const counter = h('div', { class: 'album-counter', textContent: '…' });
  const prev = h('button', { class: 'album-nav prev', textContent: '‹', 'aria-label': 'まえへ' });
  const next = h('button', { class: 'album-nav next', textContent: '›', 'aria-label': 'つぎへ' });
  const top = h('div', { class: 'album-top' }, [
    h('button', { class: 'album-close', textContent: '‹ 閉じる', onclick: close }),
    h('div', { class: 'album-title', textContent: d.trip.title }),
    h('span', { class: 'album-top-spacer' }),
  ]);

  pagesWrap.append(h('div', { class: 'album-loading', textContent: 'アルバムを組み立て中…' }));
  overlay.append(top, pagesWrap, prev, next, counter);
  document.body.append(overlay);

  const pages = await buildAlbumPages(d);
  pagesWrap.replaceChildren(...pages.map((p, i) => renderPage(p, i)));

  const total = pages.length;
  const pageW = () => pagesWrap.clientWidth || 1;
  const current = () => Math.round(pagesWrap.scrollLeft / pageW());
  const updateCounter = () => { counter.textContent = `${current() + 1} / ${total}`; };
  const go = (i: number) => pagesWrap.scrollTo({ left: Math.max(0, Math.min(total - 1, i)) * pageW(), behavior: 'smooth' });

  prev.addEventListener('click', () => go(current() - 1));
  next.addEventListener('click', () => go(current() + 1));
  pagesWrap.addEventListener('scroll', updateCounter, { passive: true });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') go(current() + 1);
    else if (e.key === 'ArrowLeft') go(current() - 1);
  };
  document.addEventListener('keydown', onKey);
  updateCounter();
}
