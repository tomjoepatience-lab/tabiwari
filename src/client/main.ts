import { api, Member, Receipt, TripDetail } from './api';
import { resizeImage } from './image';
import { runOcr } from './ocr';

declare const L: any;
declare const Chart: any;

const CATEGORIES = ['食費', '交通', '宿泊', '観光', '買い物', 'その他'];
const yen = (n: number) => '¥' + n.toLocaleString('ja-JP');
const signedYen = (n: number) => (n >= 0 ? '+' : '−') + '¥' + Math.abs(n).toLocaleString('ja-JP');
const app = () => document.getElementById('app')!;

let charts: any[] = [];
let mapInstance: any = null;
let tripTab: 'memory' | 'map' | 'list' = 'memory';

// --- DOM ヘルパー -----------------------------------------------------
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: cls, ...rest } = props as any;
  if (cls) node.className = cls;
  Object.assign(node, rest);
  for (const c of children) node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return node;
}

// --- ルーティング -----------------------------------------------------
async function route() {
  charts.forEach((c) => c.destroy());
  charts = [];
  if (mapInstance) { mapInstance.remove(); mapInstance = null; }
  const m = (location.hash || '#/').match(/^#\/trip\/(\d+)/);
  try {
    if (m) await renderTrip(Number(m[1]));
    else await renderHome();
  } catch (e) {
    app().replaceChildren(el('p', { class: 'status err', textContent: (e as Error).message }));
  }
}

// --- ホーム -----------------------------------------------------------
async function renderHome() {
  const trips = await api.listTrips();

  const form = el('form', { class: 'card' }, [
    el('h2', { textContent: '新しい旅行' }),
    el('div', { class: 'row' }, [
      el('input', { name: 'title', placeholder: '旅行・イベント名（例: 沖縄2泊3日）', required: true }),
      el('input', { name: 'start_date', type: 'date' }),
      el('input', { name: 'end_date', type: 'date' }),
      el('button', { type: 'submit', textContent: '作成' }),
    ]),
  ]);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    await api.createTrip({ title: String(f.get('title')), start_date: String(f.get('start_date') || ''), end_date: String(f.get('end_date') || '') });
    await renderHome();
  });

  const list = el('div', { class: 'trip-grid' },
    trips.length
      ? trips.map((t) =>
          el('a', { class: 'card trip-card', href: `#/trip/${t.id}` }, [
            el('div', { class: 'trip-title', textContent: t.title }),
            el('div', { class: 'trip-total', textContent: yen(t.total ?? 0) }),
            el('div', { class: 'muted', textContent: dateRange(t.start_date, t.end_date) }),
          ])
        )
      : [el('p', { class: 'muted', textContent: 'まだ旅行がありません。下のフォームから作成してください。' })]
  );

  const analysis = el('section', { class: 'card' }, [el('h2', { textContent: '分析（旅行横断）' }), el('p', { class: 'muted', textContent: '読み込み中…' })]);

  app().replaceChildren(el('section', {}, [el('h1', { textContent: '旅行' }), list]), analysis, form);
  void renderAnalysis(analysis);
}

async function renderAnalysis(section: HTMLElement) {
  const a = await api.analytics();
  if (!a.byCategory.length) {
    section.replaceChildren(el('h2', { textContent: '分析（旅行横断）' }), el('p', { class: 'muted', textContent: 'データがまだありません。' }));
    return;
  }
  const cat = el('canvas');
  const trip = el('canvas');
  section.replaceChildren(
    el('h2', { textContent: '分析（旅行横断）' }),
    el('div', { class: 'charts' }, [
      el('div', { class: 'chart-box' }, [el('h3', { textContent: 'カテゴリ別' }), cat]),
      el('div', { class: 'chart-box' }, [el('h3', { textContent: '旅行別' }), trip]),
    ])
  );
  const colors = ['#534ab7', '#1d9e75', '#d85a30', '#378add', '#ba7517', '#999'];
  charts.push(new Chart(cat, {
    type: 'doughnut',
    data: { labels: a.byCategory.map((c) => c.category), datasets: [{ data: a.byCategory.map((c) => c.total), backgroundColor: colors }] },
    options: { plugins: { legend: { position: 'bottom' } } },
  }));
  charts.push(new Chart(trip, {
    type: 'bar',
    data: { labels: a.byTrip.map((t) => t.title), datasets: [{ data: a.byTrip.map((t) => t.total), backgroundColor: '#534ab7' }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  }));
}

// --- 旅行詳細 ---------------------------------------------------------
async function renderTrip(id: number) {
  const d = await api.getTrip(id);
  const nameOf = (mid: number | null) => d.members.find((m) => m.id === mid)?.name ?? '—';

  const header = el('div', { class: 'trip-header' }, [
    el('a', { class: 'back', href: '#/', textContent: '← 旅行一覧' }),
    el('h1', { textContent: d.trip.title }),
    el('div', { class: 'muted', textContent: `${dateRange(d.trip.start_date, d.trip.end_date)} ・ 合計 ${yen(d.summary.total)}` }),
  ]);

  const tabs = el('div', { class: 'tabs' });
  const panel = el('div', { class: 'panel' });
  const tabDefs: [typeof tripTab, string][] = [['memory', '思い出'], ['map', '地図'], ['list', 'リスト']];
  const drawTabs = () => {
    tabs.replaceChildren(...tabDefs.map(([key, label]) => {
      const b = el('button', { class: 'tab' + (tripTab === key ? ' active' : ''), textContent: label });
      b.addEventListener('click', () => { tripTab = key; drawTabs(); renderPanel(d, panel, nameOf); });
      return b;
    }));
  };
  drawTabs();

  app().replaceChildren(header, membersCard(d), summaryCard(d, nameOf), receiptForm(d), el('section', { class: 'card' }, [tabs, panel]));
  renderPanel(d, panel, nameOf);
}

function renderPanel(d: TripDetail, panel: HTMLElement, nameOf: (id: number | null) => string) {
  if (tripTab === 'memory') panel.replaceChildren(memoryGrid(d, nameOf));
  else if (tripTab === 'list') panel.replaceChildren(receiptList(d, nameOf));
  else { panel.replaceChildren(el('div', { class: 'map', id: 'trip-map' })); initMap(d, nameOf); }
}

function membersCard(d: TripDetail) {
  const form = el('form', { class: 'row' }, [
    el('input', { name: 'name', placeholder: 'メンバー名を追加', required: true }),
    el('button', { type: 'submit', textContent: '追加' }),
  ]);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await api.addMember(d.trip.id, String(new FormData(form).get('name')));
    await renderTrip(d.trip.id);
  });
  return el('section', { class: 'card' }, [
    el('h2', { textContent: 'メンバー' }),
    el('div', { class: 'chips' }, d.members.map((m) => el('span', { class: 'chip', textContent: m.name }))),
    form,
  ]);
}

function summaryCard(d: TripDetail, nameOf: (id: number | null) => string) {
  const table = el('table', { class: 'table' }, [
    el('tr', {}, [th('メンバー'), th('払った'), th('負担'), th('収支')]),
    ...d.summary.perMember.map((p) =>
      el('tr', {}, [td(p.name), td(yen(p.paid)), td(yen(p.owed)), el('td', { class: p.net >= 0 ? 'pos' : 'neg', textContent: signedYen(p.net) })])
    ),
  ]);
  const settle = d.summary.settlement.length
    ? el('ul', { class: 'settle' }, d.summary.settlement.map((t) => el('li', {}, [`${nameOf(t.from)} → ${nameOf(t.to)} `, el('strong', { textContent: yen(t.amount) })])))
    : el('p', { class: 'muted', textContent: '精算は不要です（全員ちょうど）。' });
  return el('section', { class: 'card' }, [el('h2', { textContent: '集計・精算' }), table, el('h3', { textContent: '精算（誰が誰にいくら）' }), settle]);
}

// --- 思い出タブ（写真カード） -----------------------------------------
function memoryGrid(d: TripDetail, nameOf: (id: number | null) => string) {
  if (!d.receipts.length) return el('p', { class: 'muted', textContent: 'まだレシートがありません。' });
  return el('div', { class: 'memory-grid' }, d.receipts.map((r) => {
    const thumb = r.has_photo
      ? el('img', { class: 'thumb', src: api.photoUrl(r.id), loading: 'lazy', alt: r.store_name || '' })
      : el('div', { class: 'thumb placeholder', textContent: '🧾' });
    const card = el('div', { class: 'memory-card' }, [
      thumb,
      el('div', { class: 'memory-body' }, [
        el('div', { class: 'memory-store', textContent: r.store_name || '(店名なし)' }),
        el('div', { class: 'memory-meta' }, [el('span', { class: 'chip sm', textContent: r.category || '未分類' }), el('strong', { textContent: yen(r.total) })]),
      ]),
    ]);
    card.addEventListener('click', () => openModal(d, r, nameOf));
    return card;
  }));
}

// --- リストタブ -------------------------------------------------------
function receiptList(d: TripDetail, nameOf: (id: number | null) => string) {
  if (!d.receipts.length) return el('p', { class: 'muted', textContent: 'まだレシートがありません。' });
  return el('div', {}, d.receipts.map((r) => {
    const del = el('button', { class: 'link-btn', textContent: '削除' });
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('このレシートを削除しますか？')) return;
      await api.deleteReceipt(r.id);
      await renderTrip(d.trip.id);
    });
    const head = el('div', { class: 'receipt-head' }, [
      el('strong', { textContent: r.store_name || '(店名なし)' }),
      el('span', { class: 'chip sm', textContent: r.category || '未分類' }),
      el('span', { class: 'muted', textContent: `${fmtDate(r.purchased_on)} ・ 払: ${nameOf(r.paid_by)}` }),
      el('span', { class: 'spacer' }),
      el('strong', { textContent: yen(r.total) }),
      del,
    ]);
    return el('div', { class: 'receipt' }, [
      head,
      el('ul', { class: 'items' }, r.items.map((it) =>
        el('li', {}, [`${it.name} `, el('span', { class: 'muted', textContent: yen(it.price) }), el('span', { class: 'share', textContent: ' 負担: ' + (it.member_ids.map(nameOf).join('・') || '—') })])
      )),
    ]);
  }));
}

// --- 地図タブ ---------------------------------------------------------
function initMap(d: TripDetail, nameOf: (id: number | null) => string) {
  const pinned = d.receipts.filter((r) => r.lat != null && r.lng != null);
  const map = L.map('trip-map');
  mapInstance = map;
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);
  if (!pinned.length) { map.setView([35.68, 139.76], 4); return; }
  const markers = pinned.map((r) => {
    const mk = L.marker([r.lat, r.lng]).addTo(map);
    mk.bindPopup(`<b>${r.store_name || '(店名なし)'}</b><br>${r.category || ''} ${yen(r.total)}`);
    mk.on('click', () => openModal(d, r, nameOf));
    return mk;
  });
  const group = L.featureGroup(markers);
  map.fitBounds(group.getBounds().pad(0.3));
}

// --- 詳細モーダル -----------------------------------------------------
function openModal(d: TripDetail, r: Receipt, nameOf: (id: number | null) => string) {
  const breakdown = receiptBreakdown(r, d.members);
  const overlay = el('div', { class: 'overlay' });
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const photo = r.has_photo
    ? el('img', { class: 'modal-photo', src: api.photoUrl(r.id), alt: r.store_name || '' })
    : el('div', { class: 'modal-photo placeholder', textContent: '🧾' });

  const modal = el('div', { class: 'modal' }, [
    el('button', { class: 'modal-close', textContent: '✕', onclick: close } as any),
    photo,
    el('div', { class: 'modal-body' }, [
      el('div', { class: 'modal-head' }, [el('strong', { textContent: r.store_name || '(店名なし)' }), el('span', { class: 'muted', textContent: fmtDate(r.purchased_on) })]),
      el('div', { class: 'modal-meta' }, [el('span', { class: 'chip sm', textContent: r.category || '未分類' }), el('span', { class: 'muted', textContent: '払った人: ' + nameOf(r.paid_by) })]),
      r.place_name ? el('div', { class: 'muted', textContent: '📍 ' + r.place_name }) : el('span'),
      el('h3', { textContent: '明細と負担者' }),
      el('ul', { class: 'items' }, r.items.map((it) =>
        el('li', {}, [`${it.name} `, el('span', { class: 'muted', textContent: yen(it.price) }), el('span', { class: 'share', textContent: ' 負担: ' + (it.member_ids.map(nameOf).join('・') || '—') })])
      )),
      el('div', { class: 'modal-total' }, ['合計 ', el('strong', { textContent: yen(r.total) })]),
      el('div', { class: 'muted', textContent: '負担内訳: ' + breakdown.map((b) => `${b.name} ${yen(b.owed)}`).join(' / ') }),
    ]),
  ]);
  overlay.append(modal);
  document.body.append(overlay);
}

function receiptBreakdown(r: Receipt, members: Member[]) {
  const owed = new Map<number, number>();
  for (const it of r.items) {
    const sharers = it.member_ids.length ? it.member_ids : members.map((m) => m.id);
    const each = it.price / sharers.length;
    for (const m of sharers) owed.set(m, (owed.get(m) ?? 0) + each);
  }
  return members.map((m) => ({ name: m.name, owed: Math.round(owed.get(m.id) ?? 0) })).filter((b) => b.owed > 0);
}

// --- レシート追加フォーム --------------------------------------------
function receiptForm(d: TripDetail) {
  if (!d.members.length) return el('section', { class: 'card' }, [el('h2', { textContent: 'レシートを追加' }), el('p', { class: 'muted', textContent: '先にメンバーを追加してください。' })]);

  let photoData: string | null = null;
  let coords: { lat: number; lng: number } | null = null;

  const itemsWrap = el('div', { class: 'item-rows' });
  const addRow = () => itemsWrap.append(itemRow(d.members));
  const setItems = (drafts: { name: string; price: number }[]) =>
    itemsWrap.replaceChildren(...(drafts.length ? drafts.map((dr) => itemRow(d.members, dr)) : [itemRow(d.members)]));
  addRow();

  // レシートOCR（Tesseract.js）。画像を写真として添付しつつ、明細の下書きを作る
  const ocrInput = el('input', { type: 'file', accept: 'image/*' });
  const ocrStatus = el('span', { class: 'muted' });
  ocrInput.addEventListener('change', async () => {
    const file = ocrInput.files?.[0];
    if (!file) return;
    photoData = await resizeImage(file);
    preview.src = photoData;
    preview.style.display = 'block';
    ocrStatus.textContent = '読み取り中… 0%';
    try {
      const drafts = await runOcr(file, (p) => { ocrStatus.textContent = `読み取り中… ${Math.round(p * 100)}%`; });
      if (drafts.length) {
        setItems(drafts);
        ocrStatus.textContent = `${drafts.length}件の明細を読み取りました（金額・負担者を確認してください）`;
      } else {
        ocrStatus.textContent = '明細を読み取れませんでした。手入力してください。';
      }
    } catch (e) {
      ocrStatus.textContent = 'OCRに失敗しました: ' + (e as Error).message;
    }
  });

  const store = el('input', { name: 'store_name', placeholder: '店名' });
  const category = el('select', { name: 'category' }, CATEGORIES.map((c) => el('option', { value: c, textContent: c })));
  const date = el('input', { name: 'purchased_on', type: 'date', required: true, value: new Date().toISOString().slice(0, 10) });
  const paidBy = el('select', { name: 'paid_by' }, d.members.map((m) => el('option', { value: String(m.id), textContent: m.name })));

  // 写真
  const photoInput = el('input', { type: 'file', accept: 'image/*' });
  const preview = el('img', { class: 'preview', style: 'display:none' as any });
  photoInput.addEventListener('change', async () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    photoData = await resizeImage(file);
    preview.src = photoData;
    preview.style.display = 'block';
  });

  // 位置
  const locStatus = el('span', { class: 'muted' });
  const geoBtn = el('button', { type: 'button', class: 'link-btn', textContent: '📍 現在地を取得' });
  geoBtn.addEventListener('click', () => {
    locStatus.textContent = '取得中…';
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        locStatus.textContent = `取得しました (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`;
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${coords.lat}&lon=${coords.lng}`);
          const j = await r.json();
          if (j.name && !store.value) store.value = j.name;
          (store as any).dataset.place = j.display_name || '';
        } catch { /* 逆ジオは任意。失敗してもOK */ }
      },
      () => { locStatus.textContent = '位置情報を取得できませんでした'; }
    );
  });

  const addItemBtn = el('button', { type: 'button', class: 'link-btn', textContent: '＋ 明細を追加' });
  addItemBtn.addEventListener('click', addRow);

  const form = el('form', { class: 'card' }, [
    el('h2', { textContent: 'レシートを追加' }),
    el('div', { class: 'row' }, [labeled('店名', store), labeled('カテゴリ', category)]),
    el('div', { class: 'row' }, [labeled('日付', date), labeled('払った人', paidBy)]),
    el('div', { class: 'row' }, [labeled('写真', photoInput), el('div', { class: 'field' }, [el('span', { class: 'field-label', textContent: '位置' }), el('div', { class: 'row' }, [geoBtn, locStatus])])]),
    el('div', { class: 'field' }, [el('span', { class: 'field-label', textContent: 'レシート読取（OCR・写真も添付されます）' }), el('div', { class: 'row' }, [ocrInput, ocrStatus])]),
    preview,
    el('h3', { textContent: '明細（商品ごとに負担者を選ぶ／OCRの下書きを修正）' }),
    itemsWrap,
    addItemBtn,
    el('div', {}, [el('button', { type: 'submit', class: 'primary', textContent: '保存' })]),
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const items = [...itemsWrap.querySelectorAll('.item-row')].map((row) => ({
      name: (row.querySelector('[name=item_name]') as HTMLInputElement).value.trim(),
      price: parseInt((row.querySelector('[name=item_price]') as HTMLInputElement).value, 10),
      member_ids: [...row.querySelectorAll('input[type=checkbox]:checked')].map((c) => Number((c as HTMLInputElement).value)),
    })).filter((it) => it.name && it.price > 0);

    if (!items.length) return alert('明細を1件以上入力してください（商品名と金額）。');
    if (items.some((it) => it.member_ids.length === 0)) return alert('各明細に負担者を1人以上選んでください。');

    try {
      await api.addReceipt(d.trip.id, {
        store_name: store.value,
        category: category.value,
        purchased_on: date.value,
        paid_by: Number(paidBy.value),
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        place_name: (store as any).dataset.place || null,
        photo: photoData,
        items,
      });
      await renderTrip(d.trip.id);
    } catch (err) {
      alert((err as Error).message);
    }
  });

  return form;
}

function itemRow(members: Member[], draft?: { name: string; price: number }) {
  const checks = el('div', { class: 'checks' }, members.map((m) =>
    el('label', { class: 'check' }, [el('input', { type: 'checkbox', value: String(m.id), checked: true }), ' ' + m.name])
  ));
  return el('div', { class: 'item-row' }, [
    el('input', { name: 'item_name', placeholder: '商品名', class: 'grow', value: draft?.name ?? '' }),
    el('input', { name: 'item_price', type: 'number', min: '1', placeholder: '金額', class: 'price', value: draft ? String(draft.price) : '' }),
    checks,
  ]);
}

// --- 共通 -------------------------------------------------------------
function labeled(label: string, control: HTMLElement) {
  return el('label', { class: 'field' }, [el('span', { class: 'field-label', textContent: label }), control]);
}
const th = (t: string) => el('th', { textContent: t });
const td = (t: string) => el('td', { textContent: t });
function fmtDate(s: string) { return s ? s.slice(0, 10).replace(/-/g, '/') : ''; }
function dateRange(a: string | null, b: string | null) {
  if (!a && !b) return '日付未設定';
  return [a, b].filter(Boolean).map((x) => fmtDate(String(x))).join(' – ');
}

window.addEventListener('hashchange', route);
route();
