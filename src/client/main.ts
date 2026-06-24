import { api, Group, Member, ProjectKind, Receipt, Trip, TripDetail, User } from './api';
import { resizeImage } from './image';
import { runOcr } from './ocr';
import { openAlbum } from './album';
import { reverseGeocode, searchPlaces, fmtDist } from './geo';

declare const L: any;
declare const Chart: any;

const CATEGORIES = ['食費', '交通', '宿泊', '観光', '買い物', 'その他'];
const yen = (n: number) => '¥' + n.toLocaleString('ja-JP');
const signedYen = (n: number) => (n >= 0 ? '+' : '−') + '¥' + Math.abs(n).toLocaleString('ja-JP');
const app = () => document.getElementById('app')!;
const byId = (id: string) => document.getElementById(id);

// メンバーのアバター（色付き丸＋頭文字）
const AVATAR_COLORS = ['#1f9d63', '#e8845c', '#dca63a', '#3d7dca', '#9b6bd6', '#d8638f'];
const avatarColor = (i: number) => AVATAR_COLORS[((i % AVATAR_COLORS.length) + AVATAR_COLORS.length) % AVATAR_COLORS.length];
function avatarEl(label: string, colorIdx: number, extraClass = '') {
  return el('span', { class: 'avatar' + (extraClass ? ' ' + extraClass : ''), style: `background:${avatarColor(colorIdx)}` as any, textContent: (label || '?').slice(0, 1) });
}

let charts: any[] = [];
let mapInstance: any = null;
let tripTab: 'summary' | 'add' | 'list' | 'memory' | 'map' | 'analytics' = 'summary';
let currentUser: User | null = null;
let myGroups: Group[] = [];
let editingReceiptId: number | null = null;

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
  const kind = t.kind === 'daily' ? 'daily' : 'trip';
  const meta = t.kind === 'daily' ? '日常（普段使い）' : (dateRange(t.start_date, t.end_date) || '日付未設定');
  const children: (Node | string)[] = [
    el('div', { class: 'proj-icon ' + kind, textContent: kind === 'trip' ? '🧳' : '🏠' }),
    el('span', { class: 'proj-tag ' + kind, textContent: kind === 'trip' ? '旅行・イベント' : '日常' }),
    el('div', { class: 'trip-title', textContent: t.title }),
    el('div', { class: 'muted', textContent: meta }),
    el('div', { class: 'trip-total', textContent: yen(t.total ?? 0) }),
  ];
  if (t.group_name) children.push(el('div', { class: 'card-group', textContent: '👪 ' + t.group_name }));
  return el('a', { class: 'card trip-card', href: `#/trip/${t.id}` }, children);
}

// 5タブ・ナビ（記録/アルバムはプロジェクトへ、分析/グループはセクションへスクロール）
function navBar(projects: Trip[]) {
  const firstTrip = projects.find((p) => p.kind !== 'daily') ?? projects[0];
  const items: [string, () => void, boolean][] = [
    ['🏠 ホーム', () => window.scrollTo({ top: 0, behavior: 'smooth' }), true],
    ['🧾 記録', () => { if (projects[0]) location.hash = `#/trip/${projects[0].id}`; else byId('projects-sec')?.scrollIntoView({ behavior: 'smooth' }); }, false],
    ['📊 分析', () => byId('analysis-sec')?.scrollIntoView({ behavior: 'smooth' }), false],
    ['📖 アルバム', () => { if (firstTrip) location.hash = `#/trip/${firstTrip.id}`; else byId('projects-sec')?.scrollIntoView({ behavior: 'smooth' }); }, false],
    ['👪 グループ', () => byId('groups-sec')?.scrollIntoView({ behavior: 'smooth' }), false],
  ];
  return el('div', { class: 'nav' }, items.map(([label, fn, active]) => {
    const b = el('button', { class: 'nav-item' + (active ? ' active' : ''), textContent: label });
    b.addEventListener('click', fn);
    return b;
  }));
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

  return el('section', { class: 'card', id: 'groups-sec' }, [
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

  // 挨拶ヘッダー＋5タブナビ
  const logout = el('button', { class: 'link-btn', textContent: 'ログアウト' });
  logout.addEventListener('click', async () => { await api.logout(); currentUser = null; myGroups = []; renderAuth(); });
  const greeting = el('section', { class: 'card' }, [
    el('div', { class: 'greeting' }, [
      el('div', { class: 'leaf', textContent: '🌿' }),
      el('div', { class: 'greeting-text' }, [
        el('strong', { textContent: `こんにちは、${currentUser?.username ?? ''}さん` }),
        el('div', { class: 'muted', textContent: '我が家のお金、見える化中' }),
      ]),
      avatarEl(currentUser?.username ?? '?', 0, 'me-avatar'),
    ]),
    navBar(projects),
    logout,
  ]);

  // 残高ヒーロー
  const totalAll = projects.reduce((s, p) => s + (p.total ?? 0), 0);
  const hero = el('section', { class: 'hero' }, [
    el('div', { class: 'hero-label', textContent: '支出合計（全プロジェクト）' }),
    el('div', { class: 'hero-amount', textContent: yen(totalAll) }),
    el('div', { class: 'hero-stats' }, [
      el('div', { class: 'hero-stat' }, [el('span', { class: 'k', textContent: 'プロジェクト' }), el('span', { class: 'v', textContent: `${projects.length}件` })]),
      el('div', { class: 'hero-stat' }, [el('span', { class: 'k', textContent: 'グループ' }), el('span', { class: 'v', textContent: groups[0]?.name ?? '—' })]),
    ]),
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

  const section = (label: string, items: Trip[], empty: string) =>
    el('section', {}, [
      el('h2', { textContent: label }),
      items.length
        ? el('div', { class: 'trip-grid' }, items.map(projectCard))
        : el('p', { class: 'muted', textContent: empty }),
    ]);

  const projectsSec = el('section', { id: 'projects-sec' }, [
    el('div', { class: 'section-head' }, [el('h2', { textContent: 'プロジェクト' }), (() => {
      const b = el('button', { class: 'primary', textContent: '＋ 新しく作る' });
      b.addEventListener('click', () => byId('create-form')?.scrollIntoView({ behavior: 'smooth' }));
      return b;
    })()]),
    section('🧳 旅行・イベント', trips, 'まだ旅行がありません。グループを選んで作成してください。'),
    section('🏠 日常', dailies, 'まだ日常の家計簿がありません。種類で「日常」を選んで作成できます。'),
  ]);

  const analysis = el('section', { class: 'card', id: 'analysis-sec' }, [el('h2', { textContent: '統括（全プロジェクト横断）' }), el('p', { class: 'muted', textContent: '読み込み中…' })]);
  form.id = 'create-form';

  app().replaceChildren(greeting, hero, projectsSec, analysis, groupsCard(groups), form);
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
  const header = el('div', { class: 'trip-header ' + (isTrip ? 'trip' : 'daily') }, headerChildren);

  const panel = el('div', { class: 'panel' });
  // タブで縦スクロールを避ける。精算/追加/リストは共通、思い出・地図=旅行、月次=日常
  const tabDefs: [typeof tripTab, string, string][] = isTrip
    ? [['summary', '💸', '精算'], ['add', '➕', '追加'], ['list', '📋', 'リスト'], ['memory', '🖼', '思い出'], ['map', '🗺', '地図']]
    : [['summary', '💸', '精算'], ['add', '➕', '追加'], ['list', '📋', 'リスト'], ['analytics', '📊', '月次']];
  if (!tabDefs.some(([k]) => k === tripTab)) tripTab = 'summary';

  const tabbar = el('nav', { class: 'tabbar' });
  const drawTabs = () => {
    tabbar.replaceChildren(...tabDefs.map(([key, ico, label]) => {
      const b = el('button', { class: 'tabbar-item' + (tripTab === key ? ' active' : '') }, [
        el('span', { class: 'ti-ico', textContent: ico }),
        el('span', { textContent: label }),
      ]);
      b.addEventListener('click', () => { tripTab = key; drawTabs(); renderPanel(d, panel, nameOf); });
      return b;
    }));
  };
  drawTabs();

  app().replaceChildren(el('div', { class: 'detail' }, [header, panel]), tabbar);
  renderPanel(d, panel, nameOf);
}

function renderPanel(d: TripDetail, panel: HTMLElement, nameOf: (id: number | null) => string) {
  // タブ切替で前タブのグラフ・地図を破棄（route() はナビ時のみ破棄するため）
  charts.forEach((c) => c.destroy());
  charts = [];
  if (mapInstance) { try { mapInstance.remove(); } catch { /* noop */ } mapInstance = null; }
  if (tripTab === 'summary') panel.replaceChildren(membersCard(d), summaryCard(d, nameOf));
  else if (tripTab === 'add') {
    const editing = editingReceiptId ? d.receipts.find((r) => r.id === editingReceiptId) : undefined;
    panel.replaceChildren(receiptForm(d, editing));
  }
  else if (tripTab === 'list') panel.replaceChildren(receiptList(d, nameOf));
  else if (tripTab === 'analytics') renderProjectAnalytics(d, panel);
  else if (tripTab === 'memory') panel.replaceChildren(memoryTab(d));
  else { panel.replaceChildren(el('div', { class: 'map', id: 'trip-map' })); initMap(d, nameOf); }
}

// 日常プロジェクトの「月次・カテゴリ」タブ：月次予算＋繰り返し支出＋グラフ
async function renderProjectAnalytics(d: TripDetail, panel: HTMLElement) {
  const nameOf = (mid: number | null) => d.members.find((m) => m.id === mid)?.name ?? '—';
  const thisMonth = new Date().toISOString().slice(0, 10).slice(0, 7);
  panel.replaceChildren(budgetCard(d, thisMonth), await recurringCard(d, nameOf), chartsCard(d));
}

// 月次予算カード
function budgetCard(d: TripDetail, thisMonth: string) {
  const spent = d.receipts.filter((r) => (r.purchased_on || '').slice(0, 7) === thisMonth).reduce((s, r) => s + r.total, 0);
  const budget = d.trip.monthly_budget ?? null;
  const over = budget != null && spent > budget;
  const pct = budget && budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;

  const bar = el('div', { class: 'budget-bar' }, [el('div', { class: 'budget-fill' + (over ? ' over' : ''), style: `width:${pct}%` as any })]);
  const summary = budget != null
    ? el('p', {}, [`今月（${thisMonth.replace('-', '/')}）の支出 `, el('strong', { textContent: yen(spent) }), ` ／ 予算 ${yen(budget)} … `,
        el('strong', { class: over ? 'neg' : 'pos', textContent: over ? `超過 ${yen(spent - budget)}` : `残り ${yen(budget - spent)}` })])
    : el('p', { class: 'muted' }, [`今月（${thisMonth.replace('-', '/')}）の支出 `, el('strong', { textContent: yen(spent) }), '（予算は未設定）']);

  const input = el('input', { type: 'number', min: '0', placeholder: '月次予算（円）', value: budget != null ? String(budget) : '', class: 'price' });
  const save = el('button', { type: 'button', textContent: '予算を保存' });
  save.addEventListener('click', async () => {
    const v = input.value.trim() === '' ? null : Math.max(0, parseInt(input.value, 10) || 0);
    await api.setBudget(d.trip.id, v);
    await renderTrip(d.trip.id);
  });

  return el('section', { class: 'card' }, [
    el('h3', { textContent: '今月の予算' }),
    summary,
    budget != null ? bar : el('span'),
    el('div', { class: 'row' }, [labeled('月次予算', input), save]),
  ]);
}

// 繰り返し支出カード（テンプレ管理＋今月分の一括計上）
async function recurringCard(d: TripDetail, nameOf: (id: number | null) => string) {
  const list = await api.listRecurring(d.trip.id).catch(() => []);

  const rows = list.length
    ? el('ul', { class: 'recurring-list' }, list.map((r) => {
        const del = el('button', { class: 'link-btn', textContent: '削除' });
        del.addEventListener('click', async () => { await api.deleteRecurring(r.id); await renderTrip(d.trip.id); });
        return el('li', {}, [
          el('strong', { textContent: r.name }),
          el('span', { class: 'muted', textContent: ` ${yen(r.amount)}／月 ・ ${r.category || '未分類'} ・ 払: ${nameOf(r.paid_by)} ` }),
          del,
        ]);
      }))
    : el('p', { class: 'muted', textContent: '繰り返し支出（家賃・サブスク等）はまだありません。' });

  const name = el('input', { placeholder: '例: 家賃' });
  const amount = el('input', { type: 'number', min: '1', placeholder: '金額', class: 'price' });
  const category = el('select', {}, CATEGORIES.map((c) => el('option', { value: c, textContent: c })));
  const paidBy = el('select', {}, d.members.map((m) => el('option', { value: String(m.id), textContent: m.name })));
  const add = el('button', { type: 'button', textContent: '追加' });
  add.addEventListener('click', async () => {
    if (!name.value.trim() || !(parseInt(amount.value, 10) > 0)) return alert('名前と金額を入力してください。');
    await api.addRecurring(d.trip.id, { name: name.value.trim(), amount: parseInt(amount.value, 10), category: category.value, paid_by: Number(paidBy.value) });
    await renderTrip(d.trip.id);
  });

  const gen = el('button', { type: 'button', class: 'primary', textContent: '今月分をまとめて計上' });
  gen.addEventListener('click', async () => {
    const res = await api.generateRecurring(d.trip.id);
    alert(`${res.month.replace('-', '/')}: ${res.created}件を計上${res.skipped ? `（${res.skipped}件は計上済みのためスキップ）` : ''}`);
    await renderTrip(d.trip.id);
  });

  return el('section', { class: 'card' }, [
    el('h3', { textContent: '繰り返し支出（毎月）' }),
    rows,
    list.length ? el('div', {}, [gen]) : el('span'),
    el('div', { class: 'row' }, [labeled('名前', name), labeled('金額', amount), labeled('カテゴリ', category), labeled('払う人', paidBy), add]),
  ]);
}

// 月次推移＋カテゴリ別グラフ
function chartsCard(d: TripDetail) {
  if (!d.receipts.length) return el('p', { class: 'muted', textContent: 'まだレシートがありません。リストタブや繰り返し支出から追加してください。' });
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
  const card = el('section', { class: 'card' }, [el('div', { class: 'charts' }, [
    el('div', { class: 'chart-box' }, [el('h3', { textContent: '月次推移' }), monthCv]),
    el('div', { class: 'chart-box' }, [el('h3', { textContent: 'カテゴリ別' }), catCv]),
  ])]);
  const colors = ['#534ab7', '#1d9e75', '#d85a30', '#378add', '#ba7517', '#999'];
  // canvas は DOM 追加後に描画する（次のマイクロタスク）
  Promise.resolve().then(() => {
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
  });
  return card;
}

// 比率の表示用ラベル（例: 太郎 6 : 花子 4 ／ 全員同じなら「均等」）
function ratioLabel(members: Member[]): string {
  if (members.length < 2) return '';
  if (members.every((m) => m.weight === members[0].weight)) return '均等（全員同じ負担）';
  return members.map((m) => `${m.name} ${m.weight}`).join(' : ');
}

function membersCard(d: TripDetail) {
  // 各メンバーの名前・比率を編集、削除も可能
  const rows = d.members.map((m, i) => {
    const nameInput = el('input', { value: m.name, class: 'member-name-input' });
    const w = el('input', { type: 'number', min: '1', value: String(m.weight), class: 'weight-input' });
    const save = async () => {
      const nn = nameInput.value.trim();
      const wv = Math.max(1, parseInt(w.value, 10) || 1);
      if (!nn || (nn === m.name && wv === m.weight)) return;
      await api.updateMember(m.id, { name: nn, weight: wv });
      await renderTrip(d.trip.id);
    };
    nameInput.addEventListener('change', save);
    w.addEventListener('change', save);
    const del = el('button', { type: 'button', class: 'link-btn danger', textContent: '削除' });
    del.addEventListener('click', async () => {
      if (!confirm(`「${m.name}」を削除しますか？\n（このメンバーの負担割当は外れ、支払者だった会計は支払者なしになります）`)) return;
      await api.deleteMember(m.id);
      await renderTrip(d.trip.id);
    });
    return el('div', { class: 'member-row' }, [
      avatarEl(m.name, i),
      nameInput,
      el('span', { class: 'field-label', textContent: '比率' }),
      w,
      del,
    ]);
  });

  const nameInput = el('input', { name: 'name', placeholder: 'メンバー名', required: true });
  const weightInput = el('input', { name: 'weight', type: 'number', min: '1', value: '1', class: 'weight-input' });
  const form = el('form', { class: 'row' }, [
    labeled('名前', nameInput),
    labeled('比率', weightInput),
    el('button', { type: 'submit', class: 'primary', textContent: '＋ 追加' }),
  ]);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!nameInput.value.trim()) return alert('メンバー名を入力してください。');
    await api.addMember(d.trip.id, nameInput.value.trim(), Math.max(1, parseInt(weightInput.value, 10) || 1));
    await renderTrip(d.trip.id);
  });

  const label = ratioLabel(d.members);
  return el('section', { class: 'card' }, [
    el('h2', { textContent: 'メンバー・割り勘の比率' }),
    el('p', { class: 'muted', textContent: '名前・比率はその場で編集できます（変更すると自動保存）。' }),
    d.members.length ? el('div', { class: 'members' }, rows) : el('p', { class: 'muted', textContent: 'メンバーを追加してください。' }),
    label ? el('p', { class: 'muted', textContent: '現在の比率 … ' + label }) : el('span'),
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
  // 支払いの内訳（横バー）
  const idx = new Map(d.members.map((m, i) => [m.id, i]));
  const ai = (id: number | null) => (id != null && idx.has(id) ? idx.get(id)! : 0);
  const maxPaid = Math.max(1, ...d.summary.perMember.map((p) => p.paid));
  const paybars = el('div', { class: 'paybars' }, d.summary.perMember.map((p) =>
    el('div', { class: 'paybar-row' }, [
      avatarEl(p.name, ai(p.memberId)),
      el('div', { class: 'paybar-track' }, [el('div', { class: 'paybar-fill', style: `width:${Math.round((p.paid / maxPaid) * 100)}%;background:${avatarColor(ai(p.memberId))}` as any })]),
      el('span', { class: 'paybar-val', textContent: yen(p.paid) }),
    ])
  ));

  const settle = d.summary.settlement.length
    ? el('ul', { class: 'settle' }, d.summary.settlement.map((t) =>
        el('li', {}, [
          avatarEl(nameOf(t.from), ai(t.from)), el('span', { class: 'arrow', textContent: '→' }), avatarEl(nameOf(t.to), ai(t.to)),
          el('span', { textContent: ` ${nameOf(t.from)} → ${nameOf(t.to)}` }),
          el('span', { class: 'amt', textContent: yen(t.amount) }),
        ]))
    )
    : el('p', { class: 'muted', textContent: '精算は不要です（全員ちょうど）。' });
  return el('section', { class: 'card' }, [
    el('h2', { textContent: '集計・精算' }), table,
    el('h3', { textContent: '支払いの内訳' }), paybars,
    el('h3', { textContent: '💸 精算（誰が誰に）' }), settle,
  ]);
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
  // 紐付ける会計（任意）
  const receiptLabel = (r: Receipt) => `${fmtDate(r.purchased_on)} ${r.store_name || '(店名なし)'} ${yen(r.total)}`;
  const linkSel = el('select', { name: 'receipt_id' }, [
    el('option', { value: '', textContent: '（紐付けない）' }),
    ...d.receipts.map((r) => el('option', { value: String(r.id), textContent: receiptLabel(r) })),
  ]);
  const form = el('form', { class: 'card' }, [
    el('h3', { textContent: '思い出写真を追加' }),
    el('div', { class: 'row' }, [labeled('写真', fileInput), labeled('撮影日', date)]),
    labeled('キャプション', caption),
    labeled('紐付ける会計（任意）', linkSel),
    preview,
    el('div', {}, [el('button', { type: 'submit', class: 'primary', textContent: '追加' })]),
  ]);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!photoData) return alert('写真を選んでください。');
    await api.addTripPhoto(d.trip.id, { photo: photoData, caption: caption.value, taken_on: date.value, receipt_id: linkSel.value ? Number(linkSel.value) : null });
    await renderTrip(d.trip.id);
  });

  const receiptById = new Map(d.receipts.map((r) => [r.id, r]));
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
        const linked = p.receipt_id != null ? receiptById.get(p.receipt_id) : undefined;
        return el('div', { class: 'photo-item' }, [img, del,
          p.caption ? el('div', { class: 'photo-cap', textContent: p.caption }) : el('span'),
          linked ? el('div', { class: 'photo-link', textContent: `🧾 ${linked.store_name || '会計'} ${yen(linked.total)}` }) : el('span')]);
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
    const edit = el('button', { class: 'link-btn', textContent: '編集' });
    edit.addEventListener('click', (e) => {
      e.stopPropagation();
      editingReceiptId = r.id;
      tripTab = 'add';
      renderTrip(d.trip.id);
    });
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
      edit,
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

// --- 地図タブ（Google Maps、ダメなら Leaflet/OSM にフォールバック） ----
let mapsKeyCache: string | null = null;
let gmapsPromise: Promise<any> | null = null;
let lastMapCtx: { d: TripDetail; nameOf: (id: number | null) => string } | null = null;

async function getMapsKey(): Promise<string> {
  if (mapsKeyCache !== null) return mapsKeyCache;
  try { mapsKeyCache = (await api.config()).mapsKey || ''; } catch { mapsKeyCache = ''; }
  return mapsKeyCache;
}
function loadGoogleMaps(key: string): Promise<any> {
  const w = window as any;
  if (w.google?.maps) return Promise.resolve(w.google);
  if (gmapsPromise) return gmapsPromise;
  gmapsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
    s.async = true;
    s.onload = () => (w.google?.maps ? resolve(w.google) : reject(new Error('maps unavailable')));
    s.onerror = () => reject(new Error('maps script error'));
    document.head.appendChild(s);
  });
  return gmapsPromise;
}
// キー無効/リファラ制限などの認証失敗時は Leaflet にフォールバック
(window as any).gm_authFailure = () => { if (lastMapCtx && byId('trip-map')) renderLeafletMap(lastMapCtx.d, lastMapCtx.nameOf); };

async function initMap(d: TripDetail, nameOf: (id: number | null) => string) {
  lastMapCtx = { d, nameOf };
  try {
    const key = await getMapsKey();
    if (!key) throw new Error('no key');
    await loadGoogleMaps(key);
    if (!byId('trip-map')) return; // タブが切り替わっていたら何もしない
    renderGoogleMap(d, nameOf);
  } catch {
    renderLeafletMap(d, nameOf);
  }
}

function renderGoogleMap(d: TripDetail, nameOf: (id: number | null) => string) {
  const google = (window as any).google;
  const elc = byId('trip-map');
  if (!elc || !google?.maps) { renderLeafletMap(d, nameOf); return; }
  const pinned = d.receipts.filter((r) => r.lat != null && r.lng != null);
  const map = new google.maps.Map(elc, {
    center: pinned[0] ? { lat: pinned[0].lat, lng: pinned[0].lng } : { lat: 35.68, lng: 139.76 },
    zoom: pinned.length ? 8 : 4, mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
  });
  const bounds = new google.maps.LatLngBounds();
  pinned.forEach((r) => {
    const mk = new google.maps.Marker({ position: { lat: r.lat, lng: r.lng }, map, title: r.store_name || '' });
    bounds.extend(mk.getPosition());
    mk.addListener('click', () => openModal(d, r, nameOf));
  });
  if (pinned.length > 1) map.fitBounds(bounds);
}

function renderLeafletMap(d: TripDetail, nameOf: (id: number | null) => string) {
  const elc = byId('trip-map');
  if (!elc || typeof L === 'undefined') return;
  elc.innerHTML = '';
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
  map.fitBounds(L.featureGroup(markers).getBounds().pad(0.3));
}

// --- 場所ピッカー（tabikake 移植：タップ/検索/現在地でピンを決める） ----
type Picked = { lat: number; lng: number; name: string | null };
async function openMapPicker(initial: { lat: number; lng: number } | null): Promise<Picked | null> {
  const start = initial ?? { lat: 35.681, lng: 139.767 };
  let picked: { lat: number; lng: number } | null = initial ? { ...initial } : null;
  let pickedName: string | null = null;
  let reverseToken = 0;

  const overlay = el('div', { class: 'picker-overlay' });
  const mapDiv = el('div', { class: 'picker-map', id: 'picker-map' });
  const searchInput = el('input', { class: 'picker-input', placeholder: '店名・地名で検索' });
  const searchBtn = el('button', { type: 'button', class: 'primary', textContent: '検索' });
  const results = el('div', { class: 'picker-results', style: 'display:none' as any });
  const locBtn = el('button', { type: 'button', class: 'picker-loc', textContent: '📍 現在地' });
  const sheetName = el('div', { class: 'picker-name', textContent: '地図のピンをタップ／検索／現在地で選べます' });
  const sheetTag = el('div', { class: 'picker-tag', textContent: '場所を選ぶ' });
  const okBtn = el('button', { type: 'button', class: 'primary', textContent: 'この場所にする' });
  const cancelBtn = el('button', { type: 'button', textContent: 'キャンセル' });

  const updateSheet = () => {
    sheetTag.textContent = picked ? '✓ 選択中' : '場所を選ぶ';
    sheetName.textContent = picked ? (pickedName || '選択した地点') : '地図のピンをタップ／検索／現在地で選べます';
    okBtn.toggleAttribute('disabled', !picked);
  };

  let setPin: (lat: number, lng: number) => void = () => {};
  let panTo: (lat: number, lng: number, zoom?: number) => void = () => {};

  // 選択を確定（doReverse=true なら名前を逆ジオで補完）
  const setPicked = async (lat: number, lng: number, name: string | null, doReverse: boolean) => {
    picked = { lat, lng };
    pickedName = name;
    setPin(lat, lng);
    results.style.display = 'none';
    updateSheet();
    if (doReverse && !name) {
      const t = ++reverseToken;
      const r = await reverseGeocode(lat, lng);
      if (t === reverseToken && picked && r.name) { pickedName = r.name; updateSheet(); }
    }
  };

  const finish = (result: Picked | null) => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    resolveFn(result);
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(null); };
  let resolveFn: (v: Picked | null) => void;
  const promise = new Promise<Picked | null>((res) => { resolveFn = res; });

  okBtn.addEventListener('click', () => { if (picked) finish({ ...picked, name: pickedName }); });
  cancelBtn.addEventListener('click', () => finish(null));
  document.addEventListener('keydown', onKey);

  const runSearch = async () => {
    const q = searchInput.value.trim();
    if (!q) return;
    searchBtn.textContent = '…';
    const res = await searchPlaces(q, picked ? { lat: picked.lat, lon: picked.lng } : undefined);
    searchBtn.textContent = '検索';
    if (!res.length) { results.replaceChildren(el('div', { class: 'picker-result muted', textContent: '見つかりませんでした' })); results.style.display = 'block'; return; }
    results.replaceChildren(...res.map((r) => {
      const row = el('div', { class: 'picker-result' }, [
        el('div', { class: 'picker-result-name', textContent: r.name }),
        el('div', { class: 'picker-result-detail', textContent: (r.dist != null ? fmtDist(r.dist) + ' ・ ' : '') + r.detail }),
      ]);
      row.addEventListener('click', () => { searchInput.value = r.name; setPicked(r.lat, r.lon, r.name, false); panTo(r.lat, r.lon, 16); });
      return row;
    }));
    results.style.display = 'block';
  };
  searchBtn.addEventListener('click', runSearch);
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } });

  locBtn.addEventListener('click', () => {
    locBtn.textContent = '取得中…';
    navigator.geolocation.getCurrentPosition(
      (pos) => { locBtn.textContent = '📍 現在地'; setPicked(pos.coords.latitude, pos.coords.longitude, null, true); panTo(pos.coords.latitude, pos.coords.longitude, 16); },
      () => { locBtn.textContent = '📍 現在地'; alert('現在地を取得できませんでした。'); }
    );
  });

  overlay.append(
    mapDiv,
    el('div', { class: 'picker-search' }, [el('div', { class: 'picker-search-row' }, [searchInput, searchBtn]), results]),
    locBtn,
    el('div', { class: 'picker-sheet' }, [sheetTag, sheetName, el('div', { class: 'picker-bar' }, [cancelBtn, okBtn])]),
  );
  document.body.append(overlay);
  updateSheet();

  // 地図の初期化（Google が使えれば Google、ダメなら Leaflet）
  const initGoogle = (google: any) => {
    const map = new google.maps.Map(mapDiv, { center: { lat: start.lat, lng: start.lng }, zoom: initial ? 16 : 13, mapTypeControl: false, streetViewControl: false, fullscreenControl: false });
    let marker: any = null;
    setPin = (lat, lng) => {
      if (!marker) {
        marker = new google.maps.Marker({ position: { lat, lng }, map, draggable: true });
        marker.addListener('dragend', (e: any) => setPicked(e.latLng.lat(), e.latLng.lng(), null, true));
      } else marker.setPosition({ lat, lng });
    };
    panTo = (lat, lng, zoom) => { map.panTo({ lat, lng }); if (zoom) map.setZoom(zoom); };
    map.addListener('click', (e: any) => { if (e.placeId && e.stop) e.stop(); setPicked(e.latLng.lat(), e.latLng.lng(), null, true); });
    if (picked) setPin(picked.lat, picked.lng);
  };
  const initLeaflet = () => {
    const map = L.map(mapDiv).setView([start.lat, start.lng], initial ? 16 : 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);
    let marker: any = null;
    setPin = (lat, lng) => {
      if (!marker) {
        marker = L.marker([lat, lng], { draggable: true }).addTo(map);
        marker.on('dragend', () => { const p = marker.getLatLng(); setPicked(p.lat, p.lng, null, true); });
      } else marker.setLatLng([lat, lng]);
    };
    panTo = (lat, lng, zoom) => map.setView([lat, lng], zoom ?? map.getZoom());
    map.on('click', (e: any) => setPicked(e.latlng.lat, e.latlng.lng, null, true));
    if (picked) setPin(picked.lat, picked.lng);
    setTimeout(() => map.invalidateSize(), 100);
  };
  try {
    const key = await getMapsKey();
    if (!key) throw new Error('no key');
    await loadGoogleMaps(key);
    initGoogle((window as any).google);
  } catch {
    initLeaflet();
  }

  return promise;
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
  const weightOf = new Map(members.map((m) => [m.id, m.weight > 0 ? m.weight : 1]));
  const owed = new Map<number, number>();
  for (const it of r.items) {
    const sharers = it.member_ids.length ? it.member_ids : members.map((m) => m.id);
    const sumW = sharers.reduce((s, m) => s + (weightOf.get(m) ?? 1), 0) || 1;
    for (const m of sharers) owed.set(m, (owed.get(m) ?? 0) + it.price * (weightOf.get(m) ?? 1) / sumW);
  }
  return members.map((m) => ({ name: m.name, owed: Math.round(owed.get(m.id) ?? 0) })).filter((b) => b.owed > 0);
}

// --- レシート追加／編集フォーム --------------------------------------
function receiptForm(d: TripDetail, editing?: Receipt) {
  if (!d.members.length) return el('section', { class: 'card', id: 'receipt-form' }, [el('h2', { textContent: 'レシートを追加' }), el('p', { class: 'muted', textContent: '先にメンバーを追加してください。' })]);

  let coords: { lat: number; lng: number } | null =
    editing && editing.lat != null && editing.lng != null ? { lat: editing.lat, lng: editing.lng } : null;

  const itemsWrap = el('div', { class: 'item-rows' });
  const addRow = () => itemsWrap.append(itemRow(d.members));
  const setItems = (drafts: ItemDraft[]) =>
    itemsWrap.replaceChildren(...(drafts.length ? drafts.map((dr) => itemRow(d.members, dr)) : [itemRow(d.members)]));
  if (editing) setItems(editing.items.map((it) => ({ name: it.name, price: it.price, shares: it.shares })));
  else addRow();

  // レシートOCR。画像から明細の下書きを作るだけ（写真はレシートに保存しない）
  const ocrInput = el('input', { type: 'file', accept: 'image/*' });
  const ocrStatus = el('span', { class: 'muted' });
  ocrInput.addEventListener('change', async () => {
    const file = ocrInput.files?.[0];
    if (!file) return;
    ocrStatus.textContent = '読み取り中…（数秒かかります）';
    try {
      const scan = await resizeImage(file);
      const result = await runOcr(scan);
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

  const store = el('input', { name: 'store_name', placeholder: '店名', value: editing?.store_name ?? '' });
  const category = el('select', { name: 'category' }, CATEGORIES.map((c) => el('option', { value: c, textContent: c })));
  if (editing?.category) category.value = editing.category;
  const date = el('input', { name: 'purchased_on', type: 'date', required: true, value: editing ? editing.purchased_on.slice(0, 10) : new Date().toISOString().slice(0, 10) });
  const paidBy = el('select', { name: 'paid_by' }, d.members.map((m) => el('option', { value: String(m.id), textContent: m.name })));
  if (editing?.paid_by != null) paidBy.value = String(editing.paid_by);

  // 位置（地図でピンを刺す／現在地）。tabikake 風の場所ピッカー。
  const locStatus = el('span', { class: 'muted' });
  if (editing?.place_name) { locStatus.textContent = '📍 ' + editing.place_name; (store as any).dataset.place = editing.place_name; }
  else if (coords) locStatus.textContent = `📍 (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`;

  const applyLoc = (lat: number, lng: number, name: string | null) => {
    coords = { lat, lng };
    if (name) { (store as any).dataset.place = name; if (!store.value) store.value = name; }
    locStatus.textContent = '📍 ' + (name || `(${lat.toFixed(4)}, ${lng.toFixed(4)})`);
  };

  const mapBtn = el('button', { type: 'button', class: 'link-btn', textContent: '🗺 地図で選ぶ' });
  mapBtn.addEventListener('click', async () => {
    const r = await openMapPicker(coords);
    if (r) applyLoc(r.lat, r.lng, r.name);
  });
  const geoBtn = el('button', { type: 'button', class: 'link-btn', textContent: '📍 現在地' });
  geoBtn.addEventListener('click', () => {
    locStatus.textContent = '取得中…';
    navigator.geolocation.getCurrentPosition(
      async (pos) => { const r = await reverseGeocode(pos.coords.latitude, pos.coords.longitude); applyLoc(pos.coords.latitude, pos.coords.longitude, r.name || null); },
      () => { locStatus.textContent = '位置情報を取得できませんでした'; }
    );
  });

  const addItemBtn = el('button', { type: 'button', class: 'link-btn', textContent: '＋ 明細を追加' });
  addItemBtn.addEventListener('click', addRow);

  const actions: (Node | string)[] = [el('button', { type: 'submit', class: 'primary', textContent: editing ? '更新' : '保存' })];
  if (editing) {
    const cancel = el('button', { type: 'button', class: 'link-btn', textContent: 'キャンセル' });
    cancel.addEventListener('click', () => { editingReceiptId = null; renderTrip(d.trip.id); });
    actions.push(cancel);
  }

  // レシート読取バナー（OCRの入力はラベル経由で起動）
  ocrInput.style.display = 'none';
  const scanBtn = el('button', { type: 'button', class: 'primary', textContent: 'スキャン' });
  scanBtn.addEventListener('click', () => ocrInput.click());
  const scanBanner = el('div', { class: 'scan-banner' }, [
    el('div', { class: 'scan-ico', textContent: '📷' }),
    el('div', { class: 'scan-text' }, [
      el('strong', { textContent: 'レシートを撮るだけ' }),
      el('div', { class: 'muted', textContent: 'AIが店名・日付・明細を自動入力（写真はレシートには保存されません）。' }),
      ocrStatus,
    ]),
    scanBtn, ocrInput,
  ]);

  const form = el('form', { class: 'card', id: 'receipt-form' }, [
    el('h2', { textContent: editing ? 'レシートを編集' : 'レシートを追加' }),
    scanBanner,
    el('div', { class: 'row' }, [labeled('店名', store), labeled('カテゴリ', category)]),
    el('div', { class: 'row' }, [labeled('日付', date), labeled('払った人', paidBy)]),
    el('div', { class: 'field' }, [el('span', { class: 'field-label', textContent: '位置（任意）' }), el('div', { class: 'row' }, [mapBtn, geoBtn, locStatus])]),
    el('h3', { textContent: '明細（負担者を選ぶ／「この明細だけ比率を指定」で品目別の比重も設定可）' }),
    itemsWrap,
    addItemBtn,
    el('div', { class: 'row' }, actions),
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const items = [...itemsWrap.querySelectorAll('.item-row')].map((row) => {
      const override = (row.querySelector('.override-toggle') as HTMLInputElement)?.checked;
      const shares = [...row.querySelectorAll('.check')]
        .map((lbl) => ({
          cb: lbl.querySelector('input[type=checkbox]') as HTMLInputElement,
          wi: lbl.querySelector('.weight-mini') as HTMLInputElement,
        }))
        .filter((x) => x.cb.checked)
        .map((x) => ({ member_id: Number(x.cb.value), weight: override ? Math.max(1, parseInt(x.wi.value, 10) || 1) : null }));
      return {
        name: (row.querySelector('[name=item_name]') as HTMLInputElement).value.trim(),
        price: parseInt((row.querySelector('[name=item_price]') as HTMLInputElement).value, 10),
        shares,
      };
    }).filter((it) => it.name && it.price > 0);

    if (!items.length) return alert('明細を1件以上入力してください（商品名と金額）。');
    if (items.some((it) => it.shares.length === 0)) return alert('各明細に負担者を1人以上選んでください。');

    const body: any = {
      store_name: store.value,
      category: category.value,
      purchased_on: date.value,
      paid_by: Number(paidBy.value),
      lat: coords?.lat ?? editing?.lat ?? null,
      lng: coords?.lng ?? editing?.lng ?? null,
      place_name: (store as any).dataset.place || editing?.place_name || null,
      items,
    };
    try {
      if (editing) {
        await api.updateReceipt(editing.id, body);
        editingReceiptId = null;
      } else {
        await api.addReceipt(d.trip.id, body);
      }
      tripTab = 'list';
      await renderTrip(d.trip.id);
    } catch (err) {
      alert((err as Error).message);
    }
  });

  return form;
}

type ItemDraft = { name: string; price: number; shares?: { member_id: number; weight: number | null }[] };

function itemRow(members: Member[], draft?: ItemDraft) {
  const sharesById = new Map((draft?.shares ?? []).map((s) => [s.member_id, s.weight]));
  const hasDraftShares = !!draft?.shares;
  const startOverride = !!draft?.shares?.some((s) => s.weight != null);
  const weightInputs: HTMLInputElement[] = [];

  const checks = el('div', { class: 'checks' }, members.map((m) => {
    const checked = hasDraftShares ? sharesById.has(m.id) : true;
    const cb = el('input', { type: 'checkbox', value: String(m.id), checked });
    const w = el('input', { type: 'number', min: '1', class: 'weight-mini', value: String(sharesById.get(m.id) ?? m.weight), style: startOverride ? '' : ('display:none' as any) });
    weightInputs.push(w);
    return el('label', { class: 'check' }, [cb, ' ' + m.name, w]);
  }));

  const override = el('input', { type: 'checkbox', class: 'override-toggle', checked: startOverride });
  override.addEventListener('change', () => weightInputs.forEach((w) => { w.style.display = override.checked ? '' : 'none'; }));

  return el('div', { class: 'item-row' }, [
    el('input', { name: 'item_name', placeholder: '商品名', class: 'grow', value: draft?.name ?? '' }),
    el('input', { name: 'item_price', type: 'number', min: '1', placeholder: '金額', class: 'price', value: draft && draft.price ? String(draft.price) : '' }),
    checks,
    el('label', { class: 'override-wrap' }, [override, ' この明細だけ比率を指定']),
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
