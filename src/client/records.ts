// おとなモードの記録まわり: 詳細フォーム・見やすい明細カード・キャンバス内モーダル
import { api, RecentReceipt } from './api';
import { el, yen, labeled, todayIso } from './ui';
import { esc } from './phone';
import { resizeImage } from './image';
import { runOcr } from './ocr';
import { GENRES, classifyItem, Genre } from '../shared/genre';

// ---- キャンバス内モーダル（402pxのスマホ画面の中に重ねるカード） --------
export function canvasModal(anchor: HTMLElement, content: HTMLElement, opts: { title?: string } = {}): HTMLElement {
  const canvas = anchor.closest('.pc-canvas') ?? document.body;
  const overlay = el('div', { class: 'cm-overlay' });
  const close = el('button', { class: 'cm-close', textContent: '✕' });
  const card = el('div', { class: 'cm-card' }, [
    el('div', { class: 'cm-head' }, [
      el('span', { class: 'cm-title', textContent: opts.title ?? '' }),
      close,
    ]),
    el('div', { class: 'cm-body' }, [content]),
  ]);
  overlay.append(card);
  const dismiss = () => overlay.remove();
  close.addEventListener('click', dismiss);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
  canvas.append(overlay);
  return overlay;
}

// ---- ジャンルの色（3aトークン系・文字色はWCAG AA相当まで暗くしてある） ----
export const GENRE_COLORS: Record<string, [string, string]> = {
  '食料品': ['#F5E9CE', '#7E5F19'],
  '外食': ['#F0E2D8', '#8F4E28'],
  '嗜好品': ['#F6DFE4', '#A34560'],
  '日用品': ['#E4EBE4', '#45603F'],
  '交通': ['#E6EBF0', '#52677E'],
  '衣類・美容': ['#EDE7F2', '#63488F'],
  '医療・健康': ['#E2EEF0', '#3E6E78'],
  '趣味・娯楽': ['#EAE6F8', '#55499A'],
  '交際費': ['#F8E9DC', '#8A5E2E'],
  '住まい・光熱': ['#E8E8E2', '#5C5C4C'],
  'その他': ['#EFECE5', '#6E675C'],
};
export const genreColor = (g: string | null): [string, string] => GENRE_COLORS[g ?? 'その他'] ?? GENRE_COLORS['その他'];

// ---- 見やすい明細カード（ジャンル別グループ＋小計＋写真） ----------------
// readonly はこどもモードなど、ジャンル手直しをさせたくない画面用
export function receiptCard(r: RecentReceipt, opts: { onChanged?: () => void; readonly?: boolean } = {}): HTMLElement {
  const card = el('div', { class: 'rc-card' });

  // ヘッダー: 店名・日付・場所
  const dateStr = r.purchased_on.slice(0, 10).replace(/-/g, '/');
  card.append(el('div', { class: 'rc-head' }, [
    el('div', { class: 'rc-store', textContent: r.store_name || r.items[0]?.name || '記録' }),
    el('div', { class: 'rc-meta', textContent: dateStr + (r.place_name ? ` ・ 📍${r.place_name}` : '') }),
  ]));

  // 明細: ジャンルごとにまとめて小計を出す（羅列しない）
  const groups = new Map<string, typeof r.items>();
  for (const it of r.items) {
    const g = it.genre ?? 'その他';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(it);
  }
  const sorted = [...groups.entries()].sort((a, b) =>
    b[1].reduce((s, i) => s + i.price, 0) - a[1].reduce((s, i) => s + i.price, 0));

  for (const [g, items] of sorted) {
    const [bg, fg] = genreColor(g);
    const subtotal = items.reduce((s, i) => s + i.price, 0);
    const gHead = el('div', { class: 'rc-genre' }, [
      el('span', { class: 'rc-genre-chip', textContent: g }),
      el('span', { class: 'rc-genre-sub', textContent: yen(subtotal) }),
    ]);
    (gHead.firstChild as HTMLElement).style.background = bg;
    (gHead.firstChild as HTMLElement).style.color = fg;
    card.append(gHead);
    for (const it of items) {
      const row = el('div', { class: 'rc-item' }, [
        el('span', { class: 'rc-item-name', textContent: it.name }),
        el('span', { class: 'rc-item-price', textContent: yen(it.price) }),
      ]);
      // 明細名タップでジャンル手直し（変更したらカードをその場で組み直す）
      if (!opts.readonly) {
        row.addEventListener('click', () => {
          openGenrePicker(card, it.genre, async (genre) => {
            try {
              await api.setItemGenre(it.id, genre);
              it.genre = genre;
              card.replaceWith(receiptCard(r, opts));
              opts.onChanged?.();
            } catch (e) { alert((e as Error).message); }
          });
        });
      } else {
        row.style.cursor = 'default';
      }
      card.append(row);
    }
  }

  // 合計
  card.append(el('div', { class: 'rc-total' }, [
    el('span', { textContent: '合計' }),
    el('span', { class: 'rc-total-amount', textContent: yen(r.total) }),
  ]));

  // 思い出写真
  if (r.photo_ids.length) {
    const wrap = el('div', { class: 'rc-photos' });
    for (const pid of r.photo_ids) {
      const img = el('img', { class: 'rc-photo', src: api.tripPhotoUrl(pid), loading: 'lazy' as any });
      img.addEventListener('click', () => {
        const big = el('img', { class: 'rc-photo-big', src: api.tripPhotoUrl(pid) });
        canvasModal(card, big, { title: r.store_name || '思い出' });
      });
      wrap.append(img);
    }
    card.append(wrap);
  }
  return card;
}

// ジャンル選択シート（手直し用）
function openGenrePicker(anchor: HTMLElement, current: string | null, onPick: (g: Genre) => void) {
  const wrap = el('div', { class: 'gp-grid' });
  for (const g of GENRES) {
    const [bg, fg] = genreColor(g);
    const b = el('button', { class: 'gp-chip' + (g === current ? ' active' : ''), textContent: g });
    b.style.background = bg;
    b.style.color = fg;
    b.addEventListener('click', () => { onPick(g); overlay.remove(); });
    wrap.append(b);
  }
  const overlay = canvasModal(anchor, wrap, { title: 'ジャンルを直す' });
}

// ---- おとなの詳細きろくフォーム -----------------------------------------
export interface AddFormArgs {
  pickPlace(): Promise<{ lat: number; lng: number; name: string | null } | null>;
  onSaved(res: { name: string; reward: any }): void;
}

export function adultAddForm(a: AddFormArgs): HTMLElement[] {
  // お店・日付・場所
  const storeInput = el('input', { class: 'grow', placeholder: 'お店（例: スーパーまるやま）' });
  const dateInput = el('input', { type: 'date', value: todayIso() });
  let place: { lat: number; lng: number; name: string | null } | null = null;
  const placeChip = el('span', { class: 'af-place', textContent: '' });
  const placeBtn = el('button', { type: 'button', textContent: '🗺 場所を選ぶ' });
  const placeClear = el('button', { type: 'button', class: 'link-btn', textContent: '消す' });
  const syncPlace = () => {
    placeChip.textContent = place ? `📍 ${place.name ?? `${place.lat.toFixed(3)}, ${place.lng.toFixed(3)}`}` : '';
    placeClear.style.display = place ? '' : 'none';
  };
  placeBtn.addEventListener('click', async () => {
    const p = await a.pickPlace();
    if (p) { place = p; syncPlace(); }
  });
  placeClear.addEventListener('click', () => { place = null; syncPlace(); });
  syncPlace();

  // 明細行（品名・金額・ジャンル自動）
  type Row = { name: HTMLInputElement; price: HTMLInputElement; genre: HTMLSelectElement; manual: boolean; node: HTMLElement };
  const rows: Row[] = [];
  const rowsWrap = el('div', { class: 'af-rows' });
  const totalEl = el('span', { class: 'af-total', textContent: '¥0' });
  const syncTotal = () => {
    const t = rows.reduce((s, r) => s + (Math.round(Number(r.price.value)) || 0), 0);
    totalEl.textContent = yen(t);
  };
  const addRow = (focus = false): Row => {
    const name = el('input', { class: 'af-name', placeholder: '品名（例: アイス）' });
    const price = el('input', { class: 'af-price', type: 'number', inputMode: 'numeric', placeholder: '金額', min: '1' });
    const genre = el('select', { class: 'af-genre' }, GENRES.map((g) => el('option', { value: g, textContent: g })));
    const del = el('button', { type: 'button', class: 'af-del', textContent: '✕' });
    const row: Row = { name, price, genre, manual: false, node: el('div', { class: 'af-row' }, [name, price, genre, del]) };
    // 品名からジャンルを自動でつける（手で選んだら以後は触らない）
    const auto = () => {
      if (row.manual || !name.value.trim()) return;
      genre.value = classifyItem(name.value, storeInput.value);
      paintGenre();
    };
    const paintGenre = () => {
      const [bg, fg] = genreColor(genre.value);
      genre.style.background = bg;
      genre.style.color = fg;
    };
    name.addEventListener('input', auto);
    genre.addEventListener('change', () => { row.manual = true; paintGenre(); });
    price.addEventListener('input', syncTotal);
    del.addEventListener('click', () => {
      if (rows.length <= 1) { name.value = ''; price.value = ''; row.manual = false; auto(); syncTotal(); return; }
      rows.splice(rows.indexOf(row), 1);
      row.node.remove();
      syncTotal();
    });
    genre.value = 'その他';
    paintGenre();
    rows.push(row);
    rowsWrap.append(row.node);
    if (focus) name.focus();
    return row;
  };
  addRow();

  // レシート読み取り（Claude vision OCR）→ 店名・日付・明細を自動入力
  const ocrInput = el('input', { type: 'file', accept: 'image/*' });
  ocrInput.style.display = 'none';
  const ocrBtn = el('button', { type: 'button', class: 'af-ocr', textContent: '🧾 レシートを読み取って自動入力' });
  ocrBtn.addEventListener('click', () => ocrInput.click());
  ocrInput.addEventListener('change', async () => {
    const f = ocrInput.files?.[0];
    ocrInput.value = '';
    if (!f) return;
    ocrBtn.disabled = true;
    const orig = ocrBtn.textContent;
    ocrBtn.textContent = '🔎 読み取り中…（10秒ほどかかります）';
    try {
      const dataUrl = await resizeImage(f, 1280, 0.8);
      const r = await runOcr(dataUrl);
      if (!r.items.length) {
        alert('明細を読み取れませんでした。明るい場所でまっすぐ撮り直してみてください。');
        return;
      }
      if (r.store_name) storeInput.value = r.store_name; // 先に店名を入れてからジャンル推定
      if (r.purchased_on) dateInput.value = r.purchased_on;
      rows.splice(0).forEach((row) => row.node.remove()); // 既存行を流し込みで置き換え
      for (const it of r.items) {
        const row = addRow();
        row.name.value = it.name;
        row.price.value = String(it.price);
        row.name.dispatchEvent(new Event('input'));  // 自動ジャンル
        row.price.dispatchEvent(new Event('input')); // 合計更新
      }
    } catch (e) {
      alert((e as Error).message);
    } finally {
      ocrBtn.disabled = false;
      ocrBtn.textContent = orig;
    }
  });
  const addRowBtn = el('button', { type: 'button', class: 'link-btn', textContent: '＋ 明細をふやす' });
  addRowBtn.addEventListener('click', () => addRow(true));
  // 店名を変えたら未確定行のジャンルを付け直す
  storeInput.addEventListener('input', () => {
    for (const r of rows) {
      if (!r.manual && r.name.value.trim()) {
        r.genre.value = classifyItem(r.name.value, storeInput.value);
        const [bg, fg] = genreColor(r.genre.value);
        r.genre.style.background = bg;
        r.genre.style.color = fg;
      }
    }
  });

  // 思い出写真（最大3枚）
  const photos: string[] = [];
  const thumbs = el('div', { class: 'af-thumbs' });
  const fileInput = el('input', { type: 'file', accept: 'image/*', multiple: true });
  fileInput.style.display = 'none';
  const photoBtn = el('button', { type: 'button', textContent: '📷 思い出写真をつける' });
  photoBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    for (const f of Array.from(fileInput.files ?? [])) {
      if (photos.length >= 3) break;
      try {
        const data = await resizeImage(f, 1000, 0.75);
        photos.push(data);
        const t = el('span', { class: 'af-thumb' });
        const img = el('img', { src: data });
        const x = el('button', { type: 'button', class: 'af-thumb-x', textContent: '✕' });
        x.addEventListener('click', () => { photos.splice(photos.indexOf(data), 1); t.remove(); });
        t.append(img, x);
        thumbs.append(t);
      } catch (e) { alert((e as Error).message); }
    }
    fileInput.value = '';
  });

  const saveBtn = el('button', { type: 'submit', class: 'primary big-add', textContent: '記録する' });
  const form = el('form', { class: 'card af-card' }, [
    el('h2', { textContent: '✏️ きろく' }),
    el('p', { class: 'muted', textContent: 'ジャンルは自動でつきます（あとから直せます）。' }),
    ocrBtn,
    ocrInput,
    el('p', { class: 'muted af-ocr-note', textContent: 'レシートは読み取りに使うだけで、画像は保存しません。' }),
    el('div', { class: 'row' }, [labeled('お店', storeInput), labeled('日付', dateInput)]),
    el('div', { class: 'row af-place-row' }, [placeBtn, placeChip, placeClear]),
    el('div', { class: 'af-rows-head' }, [el('span', { textContent: '明細' }), el('span', {}, ['合計 ', totalEl])]),
    rowsWrap,
    addRowBtn,
    el('div', { class: 'row' }, [photoBtn, fileInput]),
    thumbs,
    el('div', { class: 'center' }, [saveBtn]),
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const items = rows
      .map((r) => ({ name: r.name.value.trim(), price: Math.round(Number(r.price.value)), genre: r.genre.value }))
      .filter((i) => i.name && Number.isFinite(i.price) && i.price > 0);
    if (!items.length) { alert('品名と金額を入力してください'); return; }
    saveBtn.disabled = true;
    try {
      const res = await api.quickExpense({
        store_name: storeInput.value.trim() || undefined,
        purchased_on: dateInput.value || todayIso(),
        items,
        lat: place?.lat ?? null,
        lng: place?.lng ?? null,
        place_name: place?.name ?? null,
        photos: photos.length ? photos : undefined,
      });
      a.onSaved({ name: storeInput.value.trim() || items[0].name, reward: res.reward });
    } catch (err) {
      alert((err as Error).message);
      saveBtn.disabled = false;
    }
  });

  return [form];
}
