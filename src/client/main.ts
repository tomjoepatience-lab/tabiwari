import { api, Group, Member, ProjectKind, Receipt, Trip, TripDetail, User } from './api';
import { resizeImage } from './image';
import { runOcr } from './ocr';
import { openAlbum } from './album';

declare const L: any;
declare const Chart: any;

const CATEGORIES = ['食費', '交通', '宿泊', '観光', '買い物', 'その他'];
const yen = (n: number) => '¥' + n.toLocaleString('ja-JP');
const signedYen = (n: number) => (n >= 0 ? '+' : '−') + '¥' + Math.abs(n).toLocaleString('ja-JP');
const app = () => document.getElementById('app')!;

let charts: any[] = [];
let mapInstance: any = null;
let tripTab: 'memory' | 'map' | 'list' | 'analytics' = 'memory';
let currentUser: User | null = null;
let myGroups: Group[] = [];

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

// --- ダッシュボード ---------------------------------------------------
function projectCard(t: Trip) {
  const meta = t.kind === 'daily' ? '日常（普段使い）' : (dateRange(t.start_date, t.end_date) || '日付未設定');
  return el('a', { class: 'card trip-card', href: `#/trip/${t.id}` }, [
    el('div', { class: 'trip-title', textContent: t.title }),
    el('div', { class: 'trip-total', textContent: yen(t.total ?? 0) }),
    el('div', { class: 'muted', textContent: meta }),
  ]);
}

// グループ管理（一覧・作成・招待コードで参加）
function groupsCard(groups: Group[]) {
  const list = groups.length
    ? el('ul', { class: 'group-list' }, groups.map((g) =>
        el('li', {}, [
          el('strong', { textContent: g.name }),
          el('span', { class: 'muted', textContent: ` ・ メンバー${g.members ?? '-'}人 ・ 招待コード ` }),
          el('code', { class: 'invite', textContent: g.invite_code }),
        ])
      ))
    : el('p', { class: 'muted', textContent: 'まだグループがありません。作成するか、家族からもらった招待コードで参加してください。' });

  const newName = el('input', { placeholder: '例: 我が家' });
  const createBtn = el('button', { type: 'button', class: 'primary', textContent: '作成' });
  createBtn.addEventListener('click', async () => {
    if (!newName.value.trim()) return alert('グループ名を入力してください。');
    try { await api.createGroup(newName.value.trim()); await renderHome(); } catch (e) { alert((e as Error).message); }
  });
  const code = el('input', { placeholder: '招待コード' });
  const joinBtn = el('button', { type: 'button', textContent: '参加' });
  joinBtn.addEventListener('click', async () => {
    if (!code.value.trim()) return alert('招待コードを入力してください。');
    try { await api.joinGroup(code.value.trim()); await renderHome(); } catch (e) { alert((e as Error).message); }
  });

  return el('section', { class: 'card' }, [
    el('h2', { textContent: '👪 グループ（家族の共有単位）' }),
    list,
    el('div', { class: 'row' }, [labeled('新規グループを作る', newName), createBtn]),
    el('div', { class: 'row' }, [labeled('招待コードで参加', code), joinBtn]),
  ]);
}

async function renderHome() {
  const [projects, groups] = await Promise.all([api.listTrips(), api.listGroups()]);
  myGroups = groups;
  const trips = projects.filter((p) => p.kind !== 'daily');
  const dailies = projects.filter((p) => p.kind === 'daily');

  // ユーザーバー
  const logout = el('button', { class: 'link-btn', textContent: 'ログアウト' });
  logout.addEventListener('click', async () => { await api.logout(); currentUser = null; myGroups = []; renderAuth(); });
  const userbar = el('div', { class: 'row between userbar' }, [
    el('span', { class: 'muted', textContent: `👤 ${currentUser?.username ?? ''}` }),
    logout,
  ]);

  // 新規プロジェクト作成フォーム（グループ必須・種類で日付欄を出し分け）
  let form: HTMLElement;
  if (!groups.length) {
    form = el('section', { class: 'card' }, [
      el('h2', { textContent: '新しいプロジェクト' }),
      el('p', { class: 'muted', textContent: '先に上でグループを作成（または参加）してください。プロジェクトはグループに属します。' }),
    ]);
  } else {
    const kindSel = el('select', { name: 'kind' }, [
      el('option', { value: 'trip', textContent: '旅行・イベント' }),
      el('option', { value: 'daily', textContent: '日常（普段使い）' }),
    ]);
    const groupSel = el('select', { name: 'group_id' }, groups.map((g) => el('option', { value: String(g.id), textContent: g.name })));
    const title = el('input', { name: 'title', placeholder: '例: 沖縄2泊3日 ／ 我が家の家計簿', required: true });
    const start = el('input', { name: 'start_date', type: 'date' });
    const end = el('input', { name: 'end_date', type: 'date' });
    const dateWrap = el('div', { class: 'row' }, [labeled('開始', start), labeled('終了', end)]);
    const syncDates = () => { dateWrap.style.display = kindSel.value === 'daily' ? 'none' : 'flex'; };
    kindSel.addEventListener('change', syncDates);
    const f = el('form', { class: 'card' }, [
      el('h2', { textContent: '新しいプロジェクト' }),
      el('div', { class: 'row' }, [labeled('グループ', groupSel), labeled('種類', kindSel), labeled('名前', title)]),
      dateWrap,
      el('div', {}, [el('button', { type: 'submit', class: 'primary', textContent: '作成' })]),
    ]);
    syncDates();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      await api.createTrip({ title: title.value, kind: kindSel.value as ProjectKind, group_id: Number(groupSel.value), start_date: start.value, end_date: end.value });
      await renderHome();
    });
    form = f;
  }

  const projectCardG = (t: Trip) => {
    const card = projectCard(t);
    if (t.group_name) card.append(el('div', { class: 'card-group', textContent: '👪 ' + t.group_name }));
    return card;
  };
  const section = (label: string, items: Trip[], empty: string) =>
    el('section', {}, [
      el('h2', { textContent: label }),
      items.length
        ? el('div', { class: 'trip-grid' }, items.map(projectCardG))
        : el('p', { class: 'muted', textContent: empty }),
    ]);

  const analysis = el('section', { class: 'card' }, [el('h2', { textContent: '統括（全プロジェクト横断）' }), el('p', { class: 'muted', textContent: '読み込み中…' })]);

  app().replaceChildren(
    userbar,
    el('h1', { textContent: 'ダッシュボード' }),
    groupsCard(groups),
    section('🧳 旅行・イベント', trips, 'まだ旅行がありません。グループを選んで作成してください。'),
    section('🏠 日常', dailies, 'まだ日常の家計簿がありません。種類で「日常」を選んで作成できます。'),
    analysis,
    form,
  );
  void renderAnalysis(analysis);
}

async function renderAnalysis(section: HTMLElement) {
  const a = await api.analytics();
  if (!a.byCategory.length) {
    section.replaceChildren(el('h2', { textContent: '統括（全プロジェクト横断）' }), el('p', { class: 'muted', textContent: 'データがまだありません。' }));
    return;
  }
  const cat = el('canvas');
  const trip = el('canvas');
  section.replaceChildren(
    el('h2', { textContent: '統括（全プロジェクト横断）' }),
    el('div', { class: 'charts' }, [
      el('div', { class: 'chart-box' }, [el('h3', { textContent: 'カテゴリ別' }), cat]),
      el('div', { class: 'chart-box' }, [el('h3', { textContent: 'プロジェクト別' }), trip]),
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

  const isTrip = d.trip.kind !== 'daily';

  const headerMain = el('div', { class: 'trip-header-main' }, [
    el('h1', { textContent: d.trip.title }),
    el('div', { class: 'muted', textContent: isTrip
      ? `${dateRange(d.trip.start_date, d.trip.end_date)} ・ 合計 ${yen(d.summary.total)}`
      : `日常（普段使い）・ 合計 ${yen(d.summary.total)}` }),
  ]);
  const headerChildren: (Node | string)[] = [
    el('a', { class: 'back', href: '#/', textContent: '← ダッシュボード' }),
    headerMain,
  ];
  if (isTrip) {
    const albumBtn = el('button', { class: 'album-open-btn', textContent: '📖 アルバム' });
    albumBtn.addEventListener('click', () => openAlbum(d));
    headerChildren.push(albumBtn);
  }
  const header = el('div', { class: 'trip-header' }, headerChildren);

  const tabs = el('div', { class: 'tabs' });
  const panel = el('div', { class: 'panel' });
  // 旅行は思い出/地図/リスト、日常はリスト＋月次・カテゴリ分析（割り勘・集計は両方で使える）
  const tabDefs: [typeof tripTab, string][] = isTrip
    ? [['memory', '思い出'], ['map', '地図'], ['list', 'リスト']]
    : [['list', 'リスト'], ['analytics', '月次・カテゴリ']];
  if (!tabDefs.some(([k]) => k === tripTab)) tripTab = tabDefs[0][0];
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
  // タブ切替で前タブのグラフを破棄（route() はナビ時のみ破棄するため）
  charts.forEach((c) => c.destroy());
  charts = [];
  if (tripTab === 'memory') panel.replaceChildren(memoryTab(d));
  else if (tripTab === 'list') panel.replaceChildren(receiptList(d, nameOf));
  else if (tripTab === 'analytics') renderProjectAnalytics(d, panel);
  else { panel.replaceChildren(el('div', { class: 'map', id: 'trip-map' })); initMap(d, nameOf); }
}

// 日常プロジェクトの月次推移＋カテゴリ別（このプロジェクトのレシートから集計）
function renderProjectAnalytics(d: TripDetail, panel: HTMLElement) {
  if (!d.receipts.length) {
    panel.replaceChildren(el('p', { class: 'muted', textContent: 'まだレシートがありません。リストタブから追加してください。' }));
    return;
  }
  const byMonth = new Map<string, number>();
  const byCat = new Map<string, number>();
  for (const r of d.receipts) {
    const m = (r.purchased_on || '').slice(0, 7);
    if (m) byMonth.set(m, (byMonth.get(m) ?? 0) + r.total);
    const c = r.category || '未分類';
    byCat.set(c, (byCat.get(c) ?? 0) + r.total);
  }
  const months = [...byMonth.keys()].sort();
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const monthCv = el('canvas');
  const catCv = el('canvas');
  panel.replaceChildren(el('div', { class: 'charts' }, [
    el('div', { class: 'chart-box' }, [el('h3', { textContent: '月次推移' }), monthCv]),
    el('div', { class: 'chart-box' }, [el('h3', { textContent: 'カテゴリ別' }), catCv]),
  ]));
  const colors = ['#534ab7', '#1d9e75', '#d85a30', '#378add', '#ba7517', '#999'];
  charts.push(new Chart(monthCv, {
    type: 'bar',
    data: { labels: months.map((m) => m.replace('-', '/')), datasets: [{ data: months.map((m) => byMonth.get(m)), backgroundColor: '#534ab7' }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  }));
  charts.push(new Chart(catCv, {
    type: 'doughnut',
    data: { labels: cats.map((e) => e[0]), datasets: [{ data: cats.map((e) => e[1]), backgroundColor: colors }] },
    options: { plugins: { legend: { position: 'bottom' } } },
  }));
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

// --- 思い出タブ（思い出写真の管理＝アップロード＋グリッド） ------------
// レシートとは別。ここに貯めた写真だけがアルバムの素材になる。
function memoryTab(d: TripDetail) {
  let photoData: string | null = null;
  const fileInput = el('input', { type: 'file', accept: 'image/*' });
  const preview = el('img', { class: 'preview', style: 'display:none' as any });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    photoData = await resizeImage(file);
    preview.src = photoData;
    preview.style.display = 'block';
  });
  const caption = el('input', { name: 'caption', placeholder: 'ひとこと（任意）' });
  const date = el('input', { name: 'taken_on', type: 'date' });
  const form = el('form', { class: 'card' }, [
    el('h3', { textContent: '思い出写真を追加' }),
    el('div', { class: 'row' }, [labeled('写真', fileInput), labeled('撮影日', date)]),
    labeled('キャプション', caption),
    preview,
    el('div', {}, [el('button', { type: 'submit', class: 'primary', textContent: '追加' })]),
  ]);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!photoData) return alert('写真を選んでください。');
    await api.addTripPhoto(d.trip.id, { photo: photoData, caption: caption.value, taken_on: date.value });
    await renderTrip(d.trip.id);
  });

  const grid = d.photos.length
    ? el('div', { class: 'photo-grid' }, d.photos.map((p) => {
        const img = el('img', { class: 'photo-thumb', src: api.tripPhotoUrl(p.id), loading: 'lazy', alt: p.caption || '' });
        img.addEventListener('click', () => openAlbum(d));
        const del = el('button', { class: 'photo-del', textContent: '✕', title: '削除' });
        del.addEventListener('click', async () => {
          if (!confirm('この写真を削除しますか？')) return;
          await api.deleteTripPhoto(p.id);
          await renderTrip(d.trip.id);
        });
        return el('div', { class: 'photo-item' }, [img, del,
          p.caption ? el('div', { class: 'photo-cap', textContent: p.caption }) : el('span')]);
      }))
    : el('p', { class: 'muted', textContent: 'まだ思い出写真がありません。下から追加すると「📖 アルバム」にまとまります。' });

  const head = el('div', { class: 'row between' }, [
    el('span', { class: 'muted', textContent: `${d.photos.length} 枚の思い出写真` }),
  ]);
  return el('div', {}, [head, grid, form]);
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
    const thumb = r.has_photo
      ? el('img', { class: 'receipt-thumb', src: api.photoUrl(r.id), loading: 'lazy', alt: r.store_name || '' })
      : el('div', { class: 'receipt-thumb placeholder', textContent: '🧾' });
    const head = el('div', { class: 'receipt-head' }, [
      el('strong', { textContent: r.store_name || '(店名なし)' }),
      el('span', { class: 'chip sm', textContent: r.category || '未分類' }),
      el('span', { class: 'muted', textContent: `${fmtDate(r.purchased_on)} ・ 払: ${nameOf(r.paid_by)}` }),
      el('span', { class: 'spacer' }),
      el('strong', { textContent: yen(r.total) }),
      del,
    ]);
    const body = el('div', { class: 'receipt-body' }, [
      head,
      el('ul', { class: 'items' }, r.items.map((it) =>
        el('li', {}, [`${it.name} `, el('span', { class: 'muted', textContent: yen(it.price) }), el('span', { class: 'share', textContent: ' 負担: ' + (it.member_ids.map(nameOf).join('・') || '—') })])
      )),
    ]);
    const card = el('div', { class: 'receipt' }, [thumb, body]);
    thumb.addEventListener('click', () => openModal(d, r, nameOf));
    return card;
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
    ocrStatus.textContent = '読み取り中…（数秒かかります）';
    try {
      const result = await runOcr(photoData);
      if (result.items.length) {
        setItems(result.items);
        if (result.store_name && !store.value) store.value = result.store_name;
        if (result.category && CATEGORIES.includes(result.category)) category.value = result.category;
        if (result.purchased_on) date.value = result.purchased_on;
        ocrStatus.textContent = `${result.items.length}件の明細を読み取りました（金額・負担者を確認してください）`;
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
    el('div', { class: 'field' }, [el('span', { class: 'field-label', textContent: 'レシート読取（AIが明細を自動入力・写真も添付されます）' }), el('div', { class: 'row' }, [ocrInput, ocrStatus])]),
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

// --- 認証ゲート -------------------------------------------------------
function renderAuth() {
  let mode: 'login' | 'register' = 'login';
  const username = el('input', { name: 'username', placeholder: 'ユーザー名', autocomplete: 'username' });
  const password = el('input', { name: 'password', type: 'password', placeholder: 'パスワード', autocomplete: 'current-password' });
  const errBox = el('p', { class: 'status err', style: 'display:none' as any });
  const submit = el('button', { type: 'submit', class: 'primary', textContent: 'ログイン' });
  const toggle = el('button', { type: 'button', class: 'link-btn', textContent: 'アカウントを作る' });
  const heading = el('h2', { textContent: 'ログイン' });

  const setMode = (m: 'login' | 'register') => {
    mode = m;
    heading.textContent = submit.textContent = m === 'login' ? 'ログイン' : '新規登録';
    toggle.textContent = m === 'login' ? 'アカウントを作る' : 'ログインに戻る';
    errBox.style.display = 'none';
  };
  toggle.addEventListener('click', () => setMode(mode === 'login' ? 'register' : 'login'));

  const form = el('form', { class: 'card auth-card' }, [
    heading,
    el('p', { class: 'muted', textContent: '家族でグループを共有して、旅行も日常も一緒に記録できます。' }),
    labeled('ユーザー名', username),
    labeled('パスワード', password),
    errBox,
    el('div', { class: 'row between' }, [toggle, submit]),
  ]);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.style.display = 'none';
    try {
      const res = mode === 'login'
        ? await api.login({ username: username.value, password: password.value })
        : await api.register({ username: username.value, password: password.value });
      currentUser = res.user;
      await boot();
    } catch (err) {
      errBox.textContent = (err as Error).message;
      errBox.style.display = 'block';
    }
  });
  app().replaceChildren(el('section', { class: 'auth-wrap' }, [form]));
}

async function boot() {
  const me = await api.me().catch(() => null);
  if (!me) { currentUser = null; renderAuth(); return; }
  currentUser = me.user;
  myGroups = me.groups;
  route();
}

window.addEventListener('hashchange', () => { if (currentUser) route(); });
boot();
