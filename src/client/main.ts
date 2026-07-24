import { api, AppMode, Group, IncomeRow, Member, Overview, ProjectKind, QuickReward, Receipt, RecentReceipt, SavingsGoal, Trip, TripDetail, User, UsageType, UserSettings } from './api';
import { el, yen, signedYen, fmtDate, labeled, todayIso } from './ui';
import { resizeImage } from './image';
import { runOcr } from './ocr';
import { openAlbum } from './album';
import { reverseGeocode, searchPlaces, fmtDist } from './geo';
import { ReactionKind } from './character';
import { analyzeSpending, reactionFor } from './advice';
import { goalIconPath, kidsHome, kidsNavHtml, kidsPhotoShell, wireNav, KidsTab, stopKidsSpeech } from './kids-town';
import { closeJourney, featuredGoal, currentStage, STAGES } from './journey';
import { openJourney as openTownJourney } from './journey-town';
import { adultHome, adultNavHtml, stopChipRotation } from './adult';
import { stageBackdrop } from './stage';
import { phoneCanvas, esc } from './phone';
import { adultAddForm, receiptCard, canvasModal, genreColor } from './records';
import { monthlyInsights, lastMonthSummary, monthlyNeeded } from './insights';
import { hasNativeMap, openNativeMapPicker, openNativeMapViewer } from './native-map';
import { getNativeIapState, hasNativeIap, purchaseNativeIap, restoreNativeIap } from './native-iap';
import { applyDisplayPreferences, PREF_KEYS, preferenceEnabled, setPreference, PreferenceKey } from './preferences';
import { classifyItem, GENRES, Genre } from '../shared/genre';

declare const L: any;
declare const Chart: any;

const CATEGORIES = ['食費', '交通', '宿泊', '観光', '買い物', 'その他'];
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
let activeGroupId: number | null = null;
let editingReceiptId: number | null = null;

// ホームのタブの状態
type HomeTab = 'home' | 'add' | 'report' | 'savings' | 'menu';
let homeTab: HomeTab = 'home';
let overviewCache: Overview | null = null;
let recentCache: RecentReceipt[] | null = null;
let recentCacheScope = '';
let reportGroupIds: number[] = [];
let incomesCache: IncomeRow[] | null = null; // レポートのカレンダーに載せる収入一覧
let calMonth = new Date();
// 記録直後にマネコがお祝いするための持ち越し
let pendingCelebrate: { kind: ReactionKind; name: string; reward?: QuickReward } | null = null;

// DOM ヘルパーは ui.ts に共通化（el / yen / fmtDate / labeled / todayIso）

// --- 📣 アプリ内トースト（こども向け通知・どの画面でも出る） ----------------
// .pc-canvas の上部に重ねて表示。キューで同時1枚・6秒で自動消滅・タップで閉じる。
const toastQueue: string[] = [];
let toastShowing = false;
function enqueueAppToast(text: string) {
  toastQueue.push(text);
  if (!toastShowing) showNextAppToast();
}
function showNextAppToast() {
  const text = toastQueue.shift();
  if (!text) { toastShowing = false; return; }
  toastShowing = true;
  // いま表示中の画面キャンバスに重ねる（ホーム/タブ共通）。無ければ body へ。
  const host = document.querySelector<HTMLElement>('.pc-canvas') ?? document.body;
  const t = el('div', { class: 'app-toast', textContent: text });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    t.classList.add('leaving');
    window.setTimeout(() => { t.remove(); showNextAppToast(); }, 220);
  };
  t.addEventListener('click', close);
  window.setTimeout(close, 6000);
  host.append(t);
}

// --- 🎁 こども向け着信ポーリング（おこづかいが届いたらどの画面でもトースト） ----
// 25秒間隔＋タブ復帰時に即チェック。document.hidden 中はタイマーを止める。
// 既読は localStorage['maneko_seen_income_<userId>']。初回（キー無し）は鳴らさず既読だけセット。
const EVENTS_POLL_MS = 25_000;
let eventsTimer: number | undefined;
let eventsEnabled = false; // こどもモードでログイン中のみ true
let eventsBusy = false;

const seenIncomeKey = () => `maneko_seen_income_${currentUser?.id ?? 0}`;

async function checkEvents() {
  if (eventsBusy || !eventsEnabled || document.hidden || !currentUser) return;
  eventsBusy = true;
  try {
    const ev = await api.events();
    const li = ev.latestIncome;
    if (!li) {
      // 収入ゼロの子: 既読を0で初期化しておくと「はじめてのおこづかい」から鳴らせる
      if (localStorage.getItem(seenIncomeKey()) == null) {
        try { localStorage.setItem(seenIncomeKey(), '0'); } catch { /* noop */ }
      }
    } else {
      const stored = localStorage.getItem(seenIncomeKey());
      if (stored == null) {
        // 初回は過去分で鳴らさない（既読idを置くだけ）
        try { localStorage.setItem(seenIncomeKey(), String(li.id)); } catch { /* noop */ }
      } else if (li.id > Number(stored)) {
        try { localStorage.setItem(seenIncomeKey(), String(li.id)); } catch { /* noop */ }
        overviewCache = null; // おさいふ残高が変わっているので取り直す
        // ホーム/ちょきんは金額が見えている画面なのでその場で更新（入力中は壊さない）。
        // 再描画は .pc-canvas を作り直しトーストごと消すので、描画が終わってから載せる。
        const ae = document.activeElement;
        const typing = ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement;
        if ((homeTab === 'home' || homeTab === 'savings') && !typing) {
          try { await renderHome(); } catch { /* 描画に失敗してもトーストは出す */ }
        }
        enqueueAppToast(`🎁 「${li.name}」¥${li.amount.toLocaleString('ja-JP')} が とどいたよ！`);
      }
    }
  } catch { /* 通信エラーは次のポーリングで再試行 */ }
  finally { eventsBusy = false; }
}

function startEventsTimer() {
  if (eventsTimer == null) eventsTimer = window.setInterval(() => void checkEvents(), EVENTS_POLL_MS);
}
function stopEventsTimer() {
  if (eventsTimer != null) { clearInterval(eventsTimer); eventsTimer = undefined; }
}
// renderHome のたびに呼ぶ。多重 setInterval を作らない（起動は未起動時のみ）。
function syncEventsPolling(mode: AppMode) {
  if (mode === 'kids' && preferenceEnabled(PREF_KEYS.familyNotifications)) {
    if (!eventsEnabled) {
      eventsEnabled = true;
      try { localStorage.removeItem('maneko_seen_income'); } catch { /* 旧・ホーム限定トーストの既読キーを掃除 */ }
      if (!document.hidden) { startEventsTimer(); void checkEvents(); }
    }
  } else {
    stopEventsPolling();
  }
}
function stopEventsPolling() {
  eventsEnabled = false;
  stopEventsTimer();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopEventsTimer();
  else if (eventsEnabled) { startEventsTimer(); void checkEvents(); } // 復帰時は即チェック
});

// 自己操作（収入記録・ポイント¥交換）の直後に既読idを黙って前進させ、自分へのトーストを抑止する
async function markEventsSeen() {
  if (!currentUser) return;
  try {
    const ev = await api.events();
    if (ev.latestIncome) localStorage.setItem(seenIncomeKey(), String(ev.latestIncome.id));
  } catch { /* 失敗しても実害は「自分の操作にもトーストが出る」だけ */ }
}

// --- ルーティング -----------------------------------------------------
async function route() {
  closeJourney(); // 旅マップを開いたまま hashchange しても取り残さない
  charts.forEach((c) => c.destroy());
  charts = [];
  recentCache = null; // 画面遷移のたびに直近支出を取り直す（記録の追加を反映）
  incomesCache = null;
  if (mapInstance) { mapInstance.remove(); mapInstance = null; }
  const m = (location.hash || '#/').match(/^#\/trip\/(\d+)/);
  try {
    if (m) await renderTrip(Number(m[1]));
    else { homeTab = 'home'; await renderHome(); } // トップに戻ったら必ずマネコのホームへ
  } catch (e) {
    // エラーでも行き止まりにしない（再読み込み・ホームへの動線を必ず出す）
    const retry = el('button', { class: 'primary', textContent: 'もう一度読み込む' });
    retry.addEventListener('click', () => { void route(); });
    const home = el('button', { textContent: '🐱 ホームへ戻る' });
    home.addEventListener('click', () => { location.hash = '#/'; void route(); });
    app().replaceChildren(el('section', { class: 'card' }, [
      el('h2', { textContent: 'うまく読み込めなかったにゃ…' }),
      el('p', { class: 'status err', textContent: (e as Error).message }),
      el('div', { class: 'row' }, [retry, home]),
    ]));
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

// ホーム以外のタブは、デザインと同じ 402×840 のスマホ画面キャンバスに
// スクロール領域＋モード別タブバー（2a/3a 忠実移植）を重ねて表示する。
function wrapPhone(mode: AppMode, active: HomeTab, panels: HTMLElement[]): HTMLElement[] {
  // こどもはキャンバスを透過にして body のステージ背景（renderHome が敷いた stageBackdrop）を
  // そのまま透かす（fill タブでも外側背景と完全連続に）。おとなは #F7F4EE で body と同色。
  const bg = mode === 'kids' ? 'transparent' : '#F7F4EE';
  const family = overviewCache?.settings?.usage_type !== 'personal';
  const navHtml = mode === 'kids' ? kidsNavHtml(active as KidsTab, family) : adultNavHtml(active as KidsTab);
  // .pc-scroll とナビは canvas(.pc-canvas) の直下に置く。以前は 840px 固定の内側 div を
  // 挟んでいたため、それが .pc-scroll の包含ブロックになって高さが 840 に固定され、
  // fillHeight でキャンバスを縮めても下端（記録ボタン等）がナビの裏に隠れていた。
  const kidsScene = mode === 'kids'
    ? ` kids-tab-shell kids-tab-${active}${active === 'menu' ? (family ? ' kids-tab-family' : ' kids-tab-settings') : ''}`
    : '';
  const html = `<div class="pc-scroll${kidsScene}"></div>${navHtml}`;
  // fillHeight: キャンバスを画面高さに合わせ、内側 .pc-scroll だけでスクロール（二重スクロール防止）
  const { wrap, canvas, refit } = phoneCanvas(html, { bg, fillHeight: true });
  canvas.querySelector<HTMLElement>('.pc-scroll')!.append(...panels);
  wireNav(canvas, (t) => { homeTab = t as HomeTab; void renderHome(); });
  refit(); // .pc-scroll を append した後で高さを確定させる
  return [wrap];
}

type KidsLineIconName =
  | 'food' | 'transport' | 'shopping' | 'more'
  | 'camera' | 'calendar' | 'pin' | 'group' | 'chart' | 'tag';

function kidsLineIcon(name: KidsLineIconName, extraClass = ''): HTMLElement {
  const paths: Record<KidsLineIconName, string> = {
    food: '<path d="M5 3v7M8 3v7M5 7h3M6.5 10v11M15 3v18M15 3c3 2 4 5 4 8h-4"/>',
    transport: '<path d="M4 15h16l-2-6H6l-2 6Zm2-6 2-4h8l2 4M7 15v3M17 15v3"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
    shopping: '<path d="M5 8h14l-1 12H6L5 8Zm4 0V6a3 3 0 0 1 6 0v2"/>',
    more: '<circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
    camera: '<path d="M4 7h4l2-3h4l2 3h4v12H4V7Z"/><circle cx="12" cy="13" r="4"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
    pin: '<path d="M12 22s7-6 7-13a7 7 0 1 0-14 0c0 7 7 13 7 13Z"/><circle cx="12" cy="9" r="2.5"/>',
    group: '<path d="M4 20v-2a4 4 0 0 1 4-4h3a4 4 0 0 1 4 4v2M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM16 7a3 3 0 0 1 0 6M17 14h1a3 3 0 0 1 3 3v3"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    tag: '<path d="M3 4h8l10 10-7 7L4 11V4Z"/><circle cx="8" cy="8" r="1.5"/>',
  };
  const icon = el('span', { class: `kids-line-icon${extraClass ? ` ${extraClass}` : ''}` });
  icon.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
  return icon;
}

function kidsRecordModeSwitch(active: 'record' | 'report'): HTMLElement {
  const record = el('button', { type: 'button', class: active === 'record' ? 'active' : '', textContent: '記録' });
  const report = el('button', { type: 'button', class: active === 'report' ? 'active' : '', textContent: 'レポート' });
  record.addEventListener('click', () => { homeTab = 'add'; void renderHome(); });
  report.addEventListener('click', () => { homeTab = 'report'; void renderHome(); });
  return el('div', { class: 'kids-record-mode-switch' }, [record, report]);
}

function kidsRecordPhoto(o: Overview): HTMLElement[] {
  const categories = ['食費', '交通', '買い物', 'その他'];
  const icons: Record<string, KidsLineIconName> = { 食費: 'food', 交通: 'transport', 買い物: 'shopping', その他: 'more' };
  let category = categories[0];
  let ocrItems: { name: string; price: number }[] = [];
  let storeName = '';
  let genreManual = false;
  let location: { lat: number | null; lng: number | null; name: string | null } = { lat: null, lng: null, name: null };

  const amount = el('input', { class: 'kids-photo-amount', type: 'number', inputMode: 'numeric', value: '', placeholder: '0', min: '1' });
  const date = el('input', { type: 'date', value: todayIso(), class: 'kids-photo-native-input' });
  const genreSelect = el('select', { class: 'kids-photo-native-input kids-photo-genre-select', 'aria-label': '費目' } as any,
    GENRES.map((genre) => el('option', { value: genre, textContent: genre })));
  genreSelect.value = '食料品';
  const genreBadge = el('small', { class: 'kids-auto-badge', textContent: '自動' });
  const genreControl = el('span', { class: 'kids-genre-control' }, [genreBadge, genreSelect]);
  const setAutoGenre = (genre: Genre) => {
    if (genreManual) return;
    genreSelect.value = genre;
    genreBadge.textContent = '自動';
  };
  const primaryGenre = (items: { name: string; price: number }[], store: string): Genre => {
    const totals = new Map<Genre, number>();
    for (const item of items) {
      const genre = classifyItem(item.name, store);
      totals.set(genre, (totals.get(genre) ?? 0) + Math.max(0, item.price));
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? classifyItem('', store);
  };
  genreSelect.addEventListener('change', () => {
    genreManual = true;
    genreBadge.textContent = '選択';
  });
  const categoryRow = el('div', { class: 'kids-photo-categories' });
  const drawCategories = () => categoryRow.replaceChildren(...categories.map((name) => {
    const button = el('button', { type: 'button', class: 'kids-photo-category' + (name === category ? ' active' : '') }, [
      kidsLineIcon(icons[name]),
      el('strong', { textContent: name }),
    ]);
    button.addEventListener('click', () => {
      category = name;
      setAutoGenre(name === '食費' ? '食料品' : name === '交通' ? '交通' : name === '買い物' ? '日用品' : 'その他');
      drawCategories();
    });
    return button;
  }));
  drawCategories();

  const receiptInput = el('input', { type: 'file', accept: 'image/*' });
  receiptInput.style.display = 'none';
  const receiptButton = el('button', { type: 'button', class: 'kids-photo-wide-row' }, [
    kidsLineIcon('camera', 'kids-photo-row-icon'),
    el('strong', { textContent: 'レシートを読み取る' }),
  ]);
  const receiptStatus = el('p', { class: 'kids-photo-detected' });
  receiptButton.addEventListener('click', () => receiptInput.click());
  receiptInput.addEventListener('change', async () => {
    const file = receiptInput.files?.[0];
    receiptInput.value = '';
    if (!file) return;
    receiptButton.setAttribute('disabled', 'true');
    receiptButton.querySelector('strong')!.textContent = '読み取り中…';
    try {
      const result = await runOcr(await resizeImage(file, 1280, .8));
      if (!result.items.length) throw new Error('明細を読み取れませんでした');
      ocrItems = result.items;
      amount.value = String(result.items.reduce((sum, item) => sum + item.price, 0));
      if (result.purchased_on) date.value = result.purchased_on;
      storeName = result.store_name || '';
      setAutoGenre(primaryGenre(result.items, storeName));
      if (categories.includes(result.category)) {
        category = result.category;
        drawCategories();
      }
      if (result.address || result.store_name) {
        location = { lat: null, lng: null, name: result.address || result.store_name };
        placeValue.textContent = location.name;
        receiptStatus.textContent = `✓ 場所を検出: ${location.name}`;
        receiptStatus.classList.add('show');
      } else {
        receiptStatus.textContent = `${result.items.length}件を読み取りました`;
        receiptStatus.classList.add('show');
      }
    } catch (error) {
      alert((error as Error).message);
    } finally {
      receiptButton.removeAttribute('disabled');
      receiptButton.querySelector('strong')!.textContent = 'レシートを読み取る';
    }
  });

  const placeValue = el('span', { class: 'kids-photo-row-value', textContent: '未設定' });
  const placeRow = el('button', { type: 'button', class: 'kids-photo-info-row' }, [
    kidsLineIcon('pin', 'kids-photo-row-icon'),
    el('strong', { textContent: '場所（任意）' }),
    placeValue,
    el('span', { class: 'kids-photo-chevron', textContent: '›' }),
  ]);
  placeRow.addEventListener('click', async () => {
    const result = await openMapPicker(location.lat != null && location.lng != null ? { lat: location.lat, lng: location.lng } : null);
    if (!result) return;
    location = { lat: result.lat, lng: result.lng, name: result.name };
    placeValue.textContent = result.name || '地図で設定済み';
    receiptStatus.textContent = `✓ 場所を設定: ${placeValue.textContent}`;
    receiptStatus.classList.add('show');
  });

  const defaultGroupId = activeGroupId && myGroups.some((group) => group.id === activeGroupId)
    ? activeGroupId
    : myGroups[0]?.id ?? null;
  const destinationSummary = el('small', { class: 'kids-destination-summary' });
  const destinationInputs = myGroups.map((group) => {
    const input = el('input', {
      type: 'checkbox',
      value: String(group.id),
      checked: group.id === defaultGroupId,
    }) as HTMLInputElement;
    return {
      input,
      label: el('label', { class: 'kids-destination-option' }, [
        input,
        el('span', { textContent: group.name }),
      ]),
    };
  });
  const selectedGroupIds = () => destinationInputs
    .filter(({ input }) => input.checked)
    .map(({ input }) => Number(input.value));
  const updateDestinationSummary = () => {
    const count = selectedGroupIds().length;
    destinationSummary.textContent = count ? `${count}件選択` : '未選択';
    destinationSummary.classList.toggle('empty', count === 0);
  };
  destinationInputs.forEach(({ input }) => input.addEventListener('change', updateDestinationSummary));
  updateDestinationSummary();
  const destinationsRow = el('div', { class: 'kids-photo-destinations-row' }, [
    el('div', { class: 'kids-destination-head' }, [
      kidsLineIcon('group', 'kids-photo-row-icon'),
      el('strong', { textContent: '保存先' }),
      destinationSummary,
    ]),
    el('div', { class: 'kids-destination-options' }, destinationInputs.map(({ label }) => label)),
  ]);

  const save = el('button', { type: 'button', class: 'kids-photo-primary', textContent: '保存する' });
  save.addEventListener('click', async () => {
    const total = Math.round(Number(amount.value));
    if (!Number.isFinite(total) || total <= 0) return alert('金額を入力してください');
    const groupIds = selectedGroupIds();
    if (myGroups.length && !groupIds.length) return alert('保存先を1つ以上選んでください');
    save.disabled = true;
    const scannedTotal = ocrItems.reduce((sum, item) => sum + item.price, 0);
    const items = ocrItems.length && scannedTotal === total
      ? ocrItems.map((item) => ({
          ...item,
          genre: genreManual ? genreSelect.value : classifyItem(item.name, storeName),
        }))
      : [{ name: storeName || category, price: total, genre: genreSelect.value }];
    try {
      const result = await api.quickExpense({
        group_ids: groupIds.length ? groupIds : undefined,
        store_name: storeName || location.name || undefined,
        category,
        purchased_on: date.value || todayIso(),
        items,
        lat: location.lat,
        lng: location.lng,
        place_name: location.name,
      });
      pendingCelebrate = {
        kind: 'generic',
        name: `${items[0].name}${result.receipts.length > 1 ? `（${result.receipts.length}か所）` : ''}`,
        reward: result.reward,
      };
      recentCache = null;
      overviewCache = null;
      homeTab = 'home';
      await renderHome();
    } catch (error) {
      save.disabled = false;
      alert((error as Error).message);
    }
  });

  const body = [
    kidsRecordModeSwitch('record'),
    el('h1', { class: 'kids-photo-title', textContent: '支出を記録' }),
    el('div', { class: 'kids-photo-price' }, [el('span', { textContent: '¥' }), amount]),
    categoryRow,
    receiptButton,
    receiptInput,
    receiptStatus,
    el('div', { class: 'kids-photo-info-box' }, [
      el('label', { class: 'kids-photo-info-row' }, [
        kidsLineIcon('calendar', 'kids-photo-row-icon'),
        el('strong', { textContent: '日付' }),
        date,
        el('span', { class: 'kids-photo-chevron', textContent: '›' }),
      ]),
      el('label', { class: 'kids-photo-info-row' }, [
        kidsLineIcon('tag', 'kids-photo-row-icon'),
        el('strong', { textContent: '費目' }),
        genreControl,
      ]),
      placeRow,
      ...(myGroups.length > 1 ? [destinationsRow] : []),
    ]),
    save,
  ];
  return kidsPhotoShell({ active: 'add', family: o.settings?.usage_type !== 'personal', scene: 'record', body, goTab: (tab) => { homeTab = tab as HomeTab; void renderHome(); } });
}

function kidsReportPhoto(
  o: Overview,
  recent: RecentReceipt[],
  incomes: IncomeRow[],
  groupSwitcher: HTMLElement | null,
): HTMLElement[] {
  const now = new Date();
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thisMonth = recent.filter((receipt) => receipt.purchased_on.startsWith(currentKey));
  const monthSpend = thisMonth.reduce((sum, receipt) => sum + receipt.total, 0);
  const days = new Set(thisMonth.map((receipt) => receipt.purchased_on.slice(0, 10))).size;
  const backToRecord = el('button', { type: 'button', class: 'kids-photo-secondary kids-report-record-button' }, [
    kidsLineIcon('camera'),
    el('strong', { textContent: '記録画面へ戻る' }),
  ]);
  backToRecord.addEventListener('click', () => { homeTab = 'add'; void renderHome(); });
  const body = [
    kidsRecordModeSwitch('report'),
    el('h1', { class: 'kids-photo-title', textContent: 'レポート' }),
    el('section', { class: 'kids-report-summary' }, [
      ...(groupSwitcher ? [groupSwitcher] : []),
      el('span', { textContent: `${now.getMonth() + 1}月の支出` }),
      el('strong', { textContent: `-${yen(monthSpend)}` }),
      el('small', { textContent: `記録した日 ${days}日 ・ ${thisMonth.length}件` }),
    ]),
    genreReportSec(recent),
    ...reportPanel(recent),
    mapPanel(recent),
    calendarPanel(recent, false, incomes),
    backToRecord,
  ];
  return kidsPhotoShell({ active: 'add', family: o.settings?.usage_type !== 'personal', scene: 'report', body, goTab: (tab) => { homeTab = tab as HomeTab; void renderHome(); } });
}

function kidsSavingsPhoto(o: Overview): HTMLElement[] {
  let selected: SavingsGoal | null = featuredGoal(o);
  let depositAmount = 500;
  const goalSelect = el('select', { class: 'kids-photo-goal-select' },
    o.goals.map((goal) => el('option', { value: String(goal.id), textContent: goal.name })));
  if (selected) goalSelect.value = String(selected.id);
  const goalIcon = el('img', {
    class: 'kids-photo-goal-emoji',
    src: goalIconPath(selected?.emoji, o.settings?.iap_goal_icons),
    alt: '',
  });
  const name = el('strong', { class: 'kids-photo-goal-name', textContent: selected?.name ?? '最初の目標' });
  const numbers = el('div', { class: 'kids-photo-goal-numbers' });
  const percent = el('b', { class: 'kids-photo-goal-percent' });
  const fill = el('i');
  const nextText = el('span');
  const updateGoal = () => {
    selected = o.goals.find((goal) => String(goal.id) === goalSelect.value) ?? selected;
    const pct = selected ? Math.min(100, Math.floor(selected.saved / Math.max(1, selected.target) * 100)) : 0;
    goalIcon.src = goalIconPath(selected?.emoji, o.settings?.iap_goal_icons);
    name.textContent = selected?.name ?? '最初の目標';
    numbers.textContent = selected ? `${yen(selected.saved)} / ${yen(selected.target)}` : '目標を作成してください';
    percent.textContent = `${pct}%`;
    fill.style.width = `${pct}%`;
    const stage = selected ? currentStage(selected.saved, selected.target) : 0;
    const next = Math.min(4, stage + 1);
    const nextPct = next * 25;
    nextText.textContent = pct >= 100 ? '夢の街に到着しました' : `あと${Math.max(0, nextPct - pct)}%で ${STAGES[next].name}`;
  };
  goalSelect.addEventListener('change', updateGoal);

  const customAmount = el('input', { type: 'number', inputMode: 'numeric', placeholder: '金額入力', min: '1' });
  const quick = el('div', { class: 'kids-photo-quick-amounts' });
  const setQuick = (amount: number) => {
    depositAmount = amount;
    customAmount.value = '';
    quick.querySelectorAll('button').forEach((button) => button.classList.toggle('active', button.textContent === `¥${amount.toLocaleString('ja-JP')}`));
  };
  [500, 1000].forEach((value) => {
    const button = el('button', { type: 'button', textContent: `¥${value.toLocaleString('ja-JP')}` });
    button.addEventListener('click', () => setQuick(value));
    quick.append(button);
  });
  customAmount.addEventListener('input', () => {
    depositAmount = Math.round(Number(customAmount.value));
    quick.querySelectorAll('button').forEach((button) => button.classList.remove('active'));
  });
  quick.append(customAmount);
  setQuick(500);

  const deposit = el('button', { type: 'button', class: 'kids-photo-primary', textContent: '貯金する' });
  deposit.addEventListener('click', async () => {
    if (!selected) return alert('先に目標を作成してください');
    if (!Number.isFinite(depositAmount) || depositAmount <= 0) return alert('金額を入力してください');
    if (depositAmount > o.wallet && !confirm('お財布の残高より多い金額です。このまま貯金しますか？')) return;
    deposit.disabled = true;
    try {
      const result = await api.depositGoal(selected.id, depositAmount);
      overviewCache = null;
      pendingCelebrate = { kind: 'generic', name: `${depositAmount.toLocaleString('ja-JP')}円を貯金` };
      if (result.reward.done) alert(`🎉 目標「${selected.name}」を達成しました！`);
      homeTab = 'home';
      await renderHome();
    } catch (error) {
      deposit.disabled = false;
      alert((error as Error).message);
    }
  });

  const newName = el('input', { placeholder: '目標の名前' });
  const newTarget = el('input', { type: 'number', inputMode: 'numeric', placeholder: '目標金額', min: '1' });
  const iconOptions = [
    { emoji: '🚲', key: 'bike', label: '自転車', premium: false },
    { emoji: '🎮', key: 'game', label: 'ゲーム', premium: false },
    { emoji: '📱', key: 'phone', label: 'スマホ', premium: false },
    { emoji: '👟', key: 'shoes', label: '靴', premium: false },
    { emoji: '✈️', key: 'travel', label: '旅行', premium: false },
    { emoji: '🧸', key: 'teddy', label: 'ぬいぐるみ', premium: true },
    { emoji: '📷', key: 'camera', label: 'カメラ', premium: true },
    { emoji: '🎧', key: 'headphones', label: 'ヘッドホン', premium: true },
    { emoji: '💻', key: 'laptop', label: 'パソコン', premium: true },
    { emoji: '🎸', key: 'guitar', label: 'ギター', premium: true },
    { emoji: '📚', key: 'books', label: '本', premium: true },
    { emoji: '🐾', key: 'pet', label: 'ペット用品', premium: true },
    { emoji: '🛋️', key: 'sofa', label: '家具', premium: true },
    { emoji: '💄', key: 'cosmetics', label: 'コスメ', premium: true },
    { emoji: '🎁', key: 'gift', label: 'プレゼント', premium: true },
  ];
  let selectedEmoji = iconOptions[0].emoji;
  const iconPicker = el('div', { class: 'kids-goal-icon-picker' });
  const drawIconPicker = () => iconPicker.replaceChildren(...iconOptions.map((option) => {
    const locked = option.premium && !o.settings?.iap_goal_icons;
    const button = el('button', {
      type: 'button',
      class: 'kids-goal-icon-option' + (selectedEmoji === option.emoji ? ' active' : '') + (locked ? ' locked' : ''),
      'aria-label': option.label,
    } as any, [
      el('img', { src: option.premium
        ? `/assets/kids/premium/goals/premium-goal-${option.key}.png`
        : `/assets/kids/goal-${option.key}.webp`, alt: '' }),
      ...(locked ? [el('span', { class: 'kids-goal-icon-lock', textContent: '🔒' })] : []),
    ]);
    button.addEventListener('click', () => {
      if (locked) return alert('目標アイコンパックは「設定 → アカウント」から購入できます');
      selectedEmoji = option.emoji;
      drawIconPicker();
    });
    return button;
  }));
  drawIconPicker();
  const create = el('button', { type: 'button', class: 'kids-photo-secondary', textContent: '目標を追加' });
  create.addEventListener('click', async () => {
    const target = Math.round(Number(newTarget.value));
    if (!newName.value.trim() || !Number.isFinite(target) || target <= 0) return alert('目標名と金額を入力してください');
    create.disabled = true;
    try {
      await api.addGoal({ name: newName.value.trim(), emoji: selectedEmoji, target });
      overviewCache = null;
      await renderHome();
    } catch (error) {
      create.disabled = false;
      alert((error as Error).message);
    }
  });

  const nextJourney = el('button', { type: 'button', class: 'kids-photo-next-row' }, [
    el('span', { textContent: '🗺️' }),
    nextText,
    el('b', { textContent: '›' }),
  ]);
  nextJourney.addEventListener('click', () => openTownJourney(o, selected?.id));

  const body = [
    el('h1', { class: 'kids-photo-title', textContent: '目標貯金' }),
    ...(o.goals.length > 1 ? [goalSelect] : []),
    el('div', { class: 'kids-photo-goal-card' }, [
      goalIcon,
      el('div', { class: 'kids-photo-goal-main' }, [
        name,
        numbers,
        percent,
        el('div', { class: 'kids-photo-progress' }, [fill]),
      ]),
    ]),
    quick,
    deposit,
    nextJourney,
    el('details', { class: 'kids-photo-manage' }, [
      el('summary', { textContent: '目標を変更・追加' }),
      el('div', { class: 'kids-photo-manage-body' }, [
        el('span', { class: 'kids-goal-icon-label', textContent: '目標アイコン' }),
        iconPicker,
        newName,
        newTarget,
        create,
      ]),
    ]),
  ];
  updateGoal();
  return kidsPhotoShell({ active: 'savings', family: o.settings?.usage_type !== 'personal', scene: 'savings', body, goTab: (tab) => { homeTab = tab as HomeTab; void renderHome(); } });
}

async function kidsFamilyPhoto(o: Overview): Promise<HTMLElement[]> {
  const links = await api.getLinks().catch(() => null);
  const parentName = links?.asChild?.username;
  const childNames = links?.asParent.map((child) => child.username) ?? [];
  const connectedName = parentName ?? childNames[0] ?? '家族';
  const connection = el('div', { class: 'kids-family-connection' }, [
    el('div', { class: 'kids-family-person' }, [
      el('img', { src: '/assets/kids/maneko-stage-1.webp', alt: '' }),
      el('strong', { textContent: '自分' }),
    ]),
    el('div', { class: 'kids-family-heart' }, [
      el('span', { textContent: '···' }),
      el('b', { textContent: '♥' }),
      el('span', { textContent: '···' }),
    ]),
    el('div', { class: 'kids-family-person' }, [
      el('img', { src: '/assets/kids/maneko-family.webp', alt: '' }),
      el('strong', { textContent: connectedName }),
    ]),
  ]);

  const allowance = o.latestIncome?.amount ?? o.settings?.allowance ?? 0;
  const allowanceCard = el('section', { class: 'kids-family-block' }, [
    el('div', { class: 'kids-family-block-title' }, [el('span', { textContent: '🐷' }), el('strong', { textContent: 'おこづかい' })]),
    el('div', { class: 'kids-family-money-row' }, [
      el('span', { textContent: o.latestIncome ? `${o.latestIncome.name}をもらいました` : '設定中のおこづかい' }),
      el('strong', { textContent: allowance ? `+${yen(allowance)}` : '未設定' }),
      el('b', { textContent: '›' }),
    ]),
  ]);

  const choreRows = el('div', { class: 'kids-family-chore-list' });
  if (o.linkedAsChild) {
    const chores = await api.myChores().catch(() => null);
    const items = chores?.chores.slice(0, 3) ?? [];
    if (items.length) {
      choreRows.append(...items.map((chore, index) => {
        const icons = ['🍽️', '🧺', '🧹'];
        const button = el('button', { type: 'button', class: 'kids-family-chore' + (chore.pending ? ' pending' : '') }, [
          el('span', { class: 'kids-family-chore-icon', textContent: icons[index % icons.length] }),
          el('strong', { textContent: chore.name }),
          el('b', { textContent: chore.pending ? '確認待ち' : `+${chore.points}pt` }),
          el('i', { textContent: '›' }),
        ]);
        button.disabled = chore.pending;
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            await api.claimChore(chore.id);
            button.classList.add('pending');
            button.querySelector('b')!.textContent = '確認待ち';
          } catch (error) {
            button.disabled = false;
            alert((error as Error).message);
          }
        });
        return button;
      }));
    } else {
      choreRows.append(el('p', { class: 'kids-photo-empty', textContent: '現在のお手伝いはありません' }));
    }
  } else {
    choreRows.append(el('p', { class: 'kids-photo-empty', textContent: '家族と連携するとお手伝いが表示されます' }));
  }
  const choresCard = el('section', { class: 'kids-family-block' }, [
    el('div', { class: 'kids-family-block-title', textContent: 'お手伝い' }),
    choreRows,
  ]);

  const original = await settingsPanel(o, 'kids');
  const manage = el('details', { class: 'kids-photo-manage kids-family-manage' }, [
    el('summary', { textContent: '家族の連携・設定' }),
    el('div', { class: 'kids-photo-manage-body' }, original.slice(1)),
  ]);
  const replayTutorial = el('button', { type: 'button', class: 'kids-photo-history-row' }, [
    el('span', { textContent: '🐱' }),
    el('strong', { textContent: 'チュートリアルをもう一度見る' }),
    el('b', { textContent: '›' }),
  ]);
  replayTutorial.addEventListener('click', () => {
    const url = new URL(location.href);
    url.searchParams.set('tutorial', '1');
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
    homeTab = 'home';
    void renderHome();
  });
  const body = [
    el('h1', { class: 'kids-photo-title', textContent: '家族' }),
    connection,
    allowanceCard,
    choresCard,
    el('button', { type: 'button', class: 'kids-photo-history-row' }, [
      el('span', { textContent: '▣' }),
      el('strong', { textContent: '家族との履歴' }),
      el('b', { textContent: '›' }),
    ]),
    replayTutorial,
    manage,
  ];
  return kidsPhotoShell({ active: 'menu', family: true, scene: 'family', body, goTab: (tab) => { homeTab = tab as HomeTab; void renderHome(); } });
}

async function kidsSettingsPhoto(o: Overview): Promise<HTMLElement[]> {
  const sections = await settingsPanel(o, 'kids');
  const pageSections = (page: string) => sections.filter((section) => section.dataset.settingsPage === page);

  const preferenceRow = (
    title: string,
    description: string,
    key: PreferenceKey,
    fallback = true,
    onChange?: (enabled: boolean) => void,
  ) => {
    const input = el('input', { type: 'checkbox', checked: preferenceEnabled(key, fallback) }) as HTMLInputElement;
    input.addEventListener('change', () => {
      setPreference(key, input.checked);
      onChange?.(input.checked);
    });
    return el('label', { class: 'kids-settings-toggle-row' }, [
      el('span', { class: 'kids-settings-toggle-copy' }, [
        el('strong', { textContent: title }),
        el('small', { textContent: description }),
      ]),
      el('span', { class: 'kids-settings-switch' }, [input, el('i')]),
    ]);
  };

  const notifications = el('section', { class: 'card' }, [
    el('h2', { textContent: '🔔 通知' }),
    el('p', { class: 'muted', textContent: 'この端末で表示する記録後のお知らせを選べます。' }),
    preferenceRow(
      '記録完了のお知らせ',
      '支出や貯金を保存したあとにお祝いを表示する',
      PREF_KEYS.recordNotifications,
    ),
  ]);
  const reportBtn = el('button', { type: 'button', class: 'primary', textContent: '📊 支出レポートを開く' });
  reportBtn.addEventListener('click', () => { homeTab = 'report'; void renderHome(); });
  const tutorialBtn = el('button', { type: 'button', class: 'kids-settings-tutorial-button', textContent: '🐱 チュートリアルをもう一度見る' });
  tutorialBtn.addEventListener('click', () => {
    const url = new URL(location.href);
    url.searchParams.set('tutorial', '1');
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
    homeTab = 'home';
    void renderHome();
  });
  const seasonCostumes = [
    ['spring-sakura', '春・さくら'],
    ['spring-picnic', '春・ピクニック'],
    ['summer-marine', '夏・マリン'],
    ['summer-festival', '夏・お祭り'],
    ['autumn-artist', '秋・芸術'],
    ['autumn-harvest', '秋・実り'],
    ['winter-snow', '冬・雪あそび'],
    ['winter-holiday', '冬・ホリデー'],
  ] as const;
  const costumeGrid = el('div', { class: 'season-costume-grid' });
  const drawCostumes = () => {
    const selected = o.settings?.season_costume ?? null;
    costumeGrid.replaceChildren(
      ...seasonCostumes.map(([id, label]) => {
        const button = el('button', {
          type: 'button',
          class: 'season-costume-option' + (selected === id ? ' active' : '') + (!o.settings?.iap_season_costumes ? ' locked' : ''),
          'aria-label': label,
        } as any, [
          el('img', { src: `/assets/kids/premium/costumes/season-${id}.png`, alt: '' }),
          el('span', { textContent: label }),
          ...(!o.settings?.iap_season_costumes ? [el('b', { textContent: '🔒' })] : []),
        ]);
        button.addEventListener('click', async () => {
          if (!o.settings?.iap_season_costumes) return alert('季節の衣装パックは「アカウント」から購入できます');
          await api.setSeasonCostume(selected === id ? null : id);
          overviewCache = null;
          await renderHome();
        });
        return button;
      }),
    );
  };
  drawCostumes();
  const costumeSection = el('section', { class: 'card' }, [
    el('h2', { textContent: '👕 季節の着せ替え' }),
    el('p', { class: 'muted', textContent: o.settings?.iap_season_costumes
      ? 'マネコに着せる衣装を選べます。選択中の衣装をもう一度押すと外せます。'
      : '季節の衣装パックで春夏秋冬8種類を選べます。' }),
    costumeGrid,
  ]);
  const display = el('section', { class: 'card' }, [
    el('h2', { textContent: '▣ 表示' }),
    preferenceRow(
      'マネコのひとこと',
      'ホームでマネコのアドバイスを表示する',
      PREF_KEYS.speech,
    ),
    preferenceRow(
      'アニメーションを減らす',
      '画面の動きを控えめにする',
      PREF_KEYS.reduceMotion,
      false,
      applyDisplayPreferences,
    ),
    reportBtn,
    tutorialBtn,
  ]);

  const pages = {
    profile: pageSections('profile'),
    notifications: [notifications],
    display: [display, costumeSection],
    account: pageSections('account'),
  };
  const detailTitle = el('h1', { class: 'kids-photo-title', textContent: 'プロフィール' });
  const detailBody = el('div', { class: 'kids-photo-settings-body' });
  const back = el('button', { type: 'button', class: 'kids-settings-back', 'aria-label': '設定に戻る', textContent: '‹' } as any);
  const detailPane = el('section', { class: 'kids-settings-pane kids-settings-detail' }, [
    el('div', { class: 'kids-settings-detail-head' }, [back, detailTitle, el('span')]),
    detailBody,
  ]);

  const router = el('div', { class: 'kids-settings-router' });
  const topPane = el('section', { class: 'kids-settings-pane kids-settings-top' });
  const syncHeight = (pane: HTMLElement) => {
    router.style.height = `${Math.max(260, pane.scrollHeight)}px`;
  };
  const openPage = (title: string, content: HTMLElement[]) => {
    detailTitle.textContent = title;
    detailBody.replaceChildren(...content);
    syncHeight(detailPane);
    requestAnimationFrame(() => {
      router.classList.add('show-detail');
      syncHeight(detailPane);
    });
  };
  back.addEventListener('click', () => {
    router.classList.remove('show-detail');
    syncHeight(topPane);
  });

  const menuItems: Array<[string, string, string, keyof typeof pages]> = [
    ['♙', 'プロフィール', '表示名・利用タイプ・予算', 'profile'],
    ['♧', '通知', '記録後のお知らせ', 'notifications'],
    ['▣', '表示', 'マネコ・アニメーション・レポート', 'display'],
    ['♢', 'アカウント', '家計簿・メール・ログアウト', 'account'],
  ];
  const menu = el('div', { class: 'kids-photo-settings-menu' }, menuItems.map(([icon, label, description, page]) => {
    const button = el('button', { type: 'button' }, [
      el('span', { class: 'kids-settings-menu-icon', textContent: icon }),
      el('span', { class: 'kids-settings-menu-copy' }, [
        el('strong', { textContent: label }),
        el('small', { textContent: description }),
      ]),
      el('b', { textContent: '›' }),
    ]);
    button.addEventListener('click', () => openPage(label, pages[page]));
    return button;
  }));
  topPane.append(
    el('h1', { class: 'kids-photo-title', textContent: '設定' }),
    menu,
  );
  router.append(topPane, detailPane);
  requestAnimationFrame(() => syncHeight(topPane));

  return kidsPhotoShell({
    active: 'menu',
    family: false,
    scene: 'settings',
    body: [router],
    goTab: (tab) => { homeTab = tab as HomeTab; void renderHome(); },
  });
}

// 利用タイプ（家族/個人）選択。usage_type が未選択のユーザーは必ずここを通る。
// 新規・既存を問わず、家族・個人どちらもマネコタウンUIで開始する。
function renderUsagePicker() {
  document.documentElement.style.background = document.body.style.background = '';
  const pick = async (usage: UsageType) => {
    try {
      await api.saveSettings({ usage_type: usage, mode: 'kids' });
      overviewCache = null;
      homeTab = 'home';
      await renderHome();
    } catch (e) { alert((e as Error).message); }
  };
  const card = (usage: UsageType, emoji: string, title: string, desc: string) => {
    const b = el('button', { class: 'mode-card mode-' + usage }, [
      el('span', { class: 'mode-emoji', textContent: emoji }),
      el('strong', { textContent: title }),
      el('span', { class: 'mode-desc', textContent: desc }),
    ]);
    b.addEventListener('click', () => void pick(usage));
    return b;
  };
  app().replaceChildren(el('section', { class: 'card mode-pick' }, [
    el('h2', { textContent: '🐱 マネコをどう つかう?' }),
    el('p', { class: 'muted', textContent: 'あとで「せってい」からいつでも切りかえられます。' }),
    el('div', { class: 'mode-grid' }, [
      card('family', '🏠', '家族で使う', '家族とつながって、おこづかい・お手伝いも管理'),
      card('personal', '👤', '個人で使う', '一人でシンプルにお金を管理'),
    ]),
  ]));
}

// 初回チュートリアル。画面上の対象だけを照らし、予算と最初の貯金目標は
// コーチカード内から実際に保存できる。?tutorial=1 で完了済みの人も再生可能。
type TutorialStep = {
  selector: string;
  eyebrow: string;
  title: string;
  text: string;
  kind: 'welcome' | 'budget' | 'goal' | 'record' | 'finish';
};

function showTutorialOverlay(usage: UsageType, anchorPanel: HTMLElement, overview: Overview) {
  const canvas = anchorPanel.querySelector<HTMLElement>('.pc-canvas') ?? anchorPanel;
  const existingGoal = featuredGoal(overview);
  const steps: TutorialStep[] = [
    {
      selector: '#k-cat',
      eyebrow: 'はじめまして',
      title: 'ぼくがマネコ！',
      text: 'お金の記録と貯金を、街を育てながら一緒に続けよう。まずは2つだけ設定するにゃ。',
      kind: 'welcome',
    },
    {
      selector: '.kids-month-chip',
      eyebrow: '初期設定 1/2',
      title: '今月の予算を決めよう',
      text: '使える金額がホームですぐ分かるようになるよ。あとから設定で変更できます。',
      kind: 'budget',
    },
    {
      selector: '#k-goal',
      eyebrow: '初期設定 2/2',
      title: existingGoal ? '貯金目標は設定済み！' : '最初の貯金目標を作ろう',
      text: existingGoal
        ? `「${existingGoal.name}」までの道のりを、ここからいつでも確認できるよ。`
        : '欲しいものや、やってみたいことを1つ決めよう。貯金するとマネコが道を進みます。',
      kind: 'goal',
    },
    {
      selector: '[data-nav="add"]',
      eyebrow: '使い方',
      title: '買ったら「記録」',
      text: '金額を入力するか、レシートを撮るだけ。費目は自動判定したあと自分で直せます。',
      kind: 'record',
    },
    {
      selector: '[data-nav="menu"]',
      eyebrow: '準備完了',
      title: usage === 'family' ? '家族とも一緒に使えるよ' : '自分に合う設定へ',
      text: usage === 'family'
        ? 'ここから招待リンクを送り、おこづかいやお手伝いを家族と共有できます。'
        : '通知・表示・プロフィールは、ここからいつでも変更できます。',
      kind: 'finish',
    },
  ];
  let i = 0;
  const overlay = el('div', { class: 'tut-overlay' });
  const spotlight = el('div', { class: 'tut-spotlight', 'aria-hidden': 'true' } as any);
  const card = el('div', { class: 'tut-card' });
  const status = el('p', { class: 'tut-status', 'aria-live': 'polite' } as any);

  const removeReplayParam = () => {
    const url = new URL(location.href);
    if (!url.searchParams.has('tutorial')) return;
    url.searchParams.delete('tutorial');
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  };
  const finish = async () => {
    card.querySelectorAll('button,input').forEach((node) => node.setAttribute('disabled', 'true'));
    await api.saveSettings({ tutorial_done: true }).catch(() => { /* 次回また出るだけ */ });
    if (overviewCache?.settings) overviewCache.settings.tutorial_done = true;
    removeReplayParam();
    overlay.remove();
    overviewCache = null;
    void renderHome();
  };
  const advance = () => {
    if (i === steps.length - 1) void finish();
    else { i += 1; renderStep(); }
  };
  const placeSpotlight = () => {
    const target = canvas.querySelector<HTMLElement>(steps[i].selector);
    const canvasRect = canvas.getBoundingClientRect();
    const scaleX = canvasRect.width / Math.max(1, canvas.clientWidth);
    const scaleY = canvasRect.height / Math.max(1, canvas.clientHeight);
    if (!target) {
      spotlight.style.cssText = 'left:24px;top:110px;width:calc(100% - 48px);height:120px';
      return;
    }
    const rect = target.getBoundingClientRect();
    const pad = steps[i].kind === 'welcome' ? 12 : 7;
    const left = (rect.left - canvasRect.left) / scaleX - pad;
    const top = (rect.top - canvasRect.top) / scaleY - pad;
    const width = rect.width / scaleX + pad * 2;
    const height = rect.height / scaleY + pad * 2;
    spotlight.style.left = `${Math.max(5, left)}px`;
    spotlight.style.top = `${Math.max(5, top)}px`;
    spotlight.style.width = `${Math.min(canvas.clientWidth - 10, width)}px`;
    spotlight.style.height = `${height}px`;
    requestAnimationFrame(() => {
      const cardHeight = card.offsetHeight || 260;
      const below = top + height + 18;
      const desired = top < canvas.clientHeight * .42
        ? below
        : top - cardHeight - 18;
      card.style.top = `${Math.max(76, Math.min(canvas.clientHeight - cardHeight - 96, desired))}px`;
    });
  };
  const quickAmountButton = (label: string, amount: number, input: HTMLInputElement) => {
    const button = el('button', { type: 'button', class: 'tut-quick', textContent: label });
    button.addEventListener('click', () => {
      input.value = String(amount);
      button.parentElement?.querySelectorAll('.active').forEach((node) => node.classList.remove('active'));
      button.classList.add('active');
    });
    return button;
  };
  const renderStep = () => {
    const st = steps[i];
    const dots = el('div', { class: 'tut-dots' }, steps.map((_, idx) =>
      el('span', { class: 'tut-dot' + (idx === i ? ' active' : '') })));
    const skip = el('button', { type: 'button', class: 'tut-skip', textContent: 'あとで' });
    const prev = el('button', { type: 'button', class: 'tut-prev', textContent: '← 戻る' });
    const next = el('button', {
      type: 'button',
      class: 'tut-next',
      textContent: st.kind === 'finish' ? 'マネコタウンをはじめる' : st.kind === 'welcome' ? '一緒に設定する' : '次へ',
    });
    prev.disabled = i === 0;
    skip.addEventListener('click', () => void finish());
    prev.addEventListener('click', () => { i = Math.max(0, i - 1); renderStep(); });
    next.addEventListener('click', advance);

    const body: HTMLElement[] = [];
    if (st.kind === 'budget') {
      const budget = el('input', {
        type: 'number',
        inputmode: 'numeric',
        min: '0',
        class: 'tut-money-input',
        value: overview.settings?.monthly_budget != null ? String(overview.settings.monthly_budget) : '',
        placeholder: '例：50000',
        'aria-label': '月の予算',
      } as any);
      const save = el('button', { type: 'button', class: 'tut-next', textContent: '予算を保存して次へ' });
      save.addEventListener('click', async () => {
        const amount = Math.round(Number(budget.value));
        if (!Number.isFinite(amount) || amount <= 0) {
          status.textContent = '1円以上の予算を入力してね';
          return;
        }
        save.setAttribute('disabled', 'true');
        status.textContent = '保存中…';
        try {
          await api.saveSettings({ monthly_budget: amount });
          if (overview.settings) overview.settings.monthly_budget = amount;
          status.textContent = '予算を保存したよ！';
          window.setTimeout(advance, 350);
        } catch (error) {
          save.removeAttribute('disabled');
          status.textContent = (error as Error).message;
        }
      });
      body.push(
        el('label', { class: 'tut-input-label' }, ['月の予算', budget, el('span', { textContent: '円' })]),
        el('div', { class: 'tut-quicks' }, [
          quickAmountButton('3万円', 30000, budget),
          quickAmountButton('5万円', 50000, budget),
          quickAmountButton('10万円', 100000, budget),
        ]),
        save,
      );
    } else if (st.kind === 'goal' && !existingGoal) {
      const name = el('input', { class: 'tut-goal-name', value: '', placeholder: '例：旅行、ゲーム機' });
      const target = el('input', {
        type: 'number',
        inputmode: 'numeric',
        min: '1',
        class: 'tut-money-input',
        value: '',
        placeholder: '例：30000',
        'aria-label': '目標金額',
      } as any);
      const create = el('button', { type: 'button', class: 'tut-next', textContent: '目標を作って次へ' });
      create.addEventListener('click', async () => {
        const targetAmount = Math.round(Number(target.value));
        if (!name.value.trim() || !Number.isFinite(targetAmount) || targetAmount <= 0) {
          status.textContent = '目標名と金額を入力してね';
          return;
        }
        create.setAttribute('disabled', 'true');
        status.textContent = '目標を作成中…';
        try {
          await api.addGoal({ name: name.value.trim(), emoji: '🎯', target: targetAmount });
          status.textContent = '目標を作ったよ！';
          window.setTimeout(advance, 350);
        } catch (error) {
          create.removeAttribute('disabled');
          status.textContent = (error as Error).message;
        }
      });
      body.push(
        el('label', { class: 'tut-field' }, [el('span', { textContent: '目標' }), name]),
        el('label', { class: 'tut-input-label' }, ['目標金額', target, el('span', { textContent: '円' })]),
        create,
      );
    } else {
      body.push(next);
    }
    status.textContent = '';
    card.replaceChildren(
      skip,
      el('div', { class: 'tut-progress' }, [dots, el('span', { textContent: `${i + 1} / ${steps.length}` })]),
      el('div', { class: 'tut-guide' }, [
        el('img', { src: '/assets/kids/maneko-3d.webp', alt: '案内役のマネコ' }),
        el('div', {}, [
          el('span', { class: 'tut-eyebrow', textContent: st.eyebrow }),
          el('h3', { class: 'tut-title', textContent: st.title }),
        ]),
      ]),
      el('p', { class: 'tut-text', textContent: st.text }),
      ...body,
      status,
      el('div', { class: 'tut-nav' }, [prev]),
    );
    placeSpotlight();
  };
  renderStep();
  overlay.append(spotlight, card);
  canvas.append(overlay);
  window.addEventListener('resize', placeSpotlight, { once: true });
}

function reportGroupSwitcher(): HTMLElement | null {
  if (!myGroups.length) return null;
  const available = new Set(myGroups.map((group) => group.id));
  reportGroupIds = reportGroupIds.filter((id) => available.has(id));
  if (!reportGroupIds.length) reportGroupIds = [activeGroupId ?? myGroups[0].id];

  const rail = el('div', { class: 'report-group-rail', role: 'group', 'aria-label': '表示する家計簿' } as any);
  const renderButtons = () => {
    rail.replaceChildren(...myGroups.map((group) => {
      const selected = reportGroupIds.includes(group.id);
      const button = el('button', {
        type: 'button',
        class: 'report-group-button' + (selected ? ' active' : ''),
        'aria-pressed': String(selected),
      } as any, [
        el('span', { class: 'report-group-check', textContent: selected ? '✓' : '' }),
        el('span', { textContent: group.name }),
      ]);
      button.addEventListener('click', async () => {
        if (selected && reportGroupIds.length === 1) {
          button.classList.add('shake');
          window.setTimeout(() => button.classList.remove('shake'), 280);
          return;
        }
        reportGroupIds = selected
          ? reportGroupIds.filter((id) => id !== group.id)
          : [...reportGroupIds, group.id];
        recentCache = null;
        recentCacheScope = '';
        await renderHome();
      });
      return button;
    }));
  };
  renderButtons();
  return el('div', { class: 'report-group-switcher' }, [
    el('span', { class: 'report-group-label', textContent: '表示する家計簿' }),
    rail,
  ]);
}

// 家計簿スペース管理（一覧・作成・招待URLで参加）
function groupsCard(groups: Group[]) {
  const list = groups.length
    ? el('ul', { class: 'group-list' }, groups.map((g) =>
        (() => {
          const invite = el('button', { type: 'button', class: 'link-btn', textContent: '招待リンクを共有' });
          invite.addEventListener('click', async () => {
            invite.disabled = true;
            try {
              const result = await api.createGroupInvite(g.id);
              const shareData = { title: 'マネコ家計簿への招待', text: `${g.name}に参加しよう`, url: result.url };
              if (navigator.share) await navigator.share(shareData);
              else {
                await navigator.clipboard.writeText(result.url);
                alert('招待リンクをコピーしました');
              }
            } catch (e) {
              // 共有シートを閉じた場合はエラー表示しない。
              if ((e as Error).name !== 'AbortError') alert((e as Error).message);
            } finally { invite.disabled = false; }
          });
          return el('li', {}, [
          el('strong', { textContent: g.name }),
          el('span', { class: 'muted', textContent: ` ・ メンバー${g.members ?? '-'}人 ` }),
          invite,
          ]);
        })()
      ))
    : el('p', { class: 'muted', textContent: 'まだ家計簿スペースがありません。新しく作成してください。' });

  const newName = el('input', { placeholder: '例: ふたりの家計簿' });
  const createBtn = el('button', { type: 'button', class: 'primary', textContent: '作成' });
  createBtn.addEventListener('click', async () => {
    if (!newName.value.trim()) return alert('グループ名を入力してください。');
    try {
      const created = await api.createGroup(newName.value.trim());
      myGroups = await api.listGroups();
      activeGroupId = created.id;
      await api.saveSettings({ active_group_id: created.id });
      overviewCache = null; recentCache = null;
      await renderHome();
    } catch (e) { alert((e as Error).message); }
  });
  return el('section', { class: 'card', id: 'groups-sec' }, [
    el('h2', { textContent: '🏠 家計簿スペース' }),
    el('p', { class: 'muted', textContent: '自分用、ふたり用、家族用など複数作れます。ホーム上部でワンタップ切り替えできます。' }),
    list,
    el('div', { class: 'row' }, [labeled('新しいスペースを作る', newName), createBtn]),
  ]);
}

// 並行して走った古い renderHome が新しい画面を上書きしないための世代番号
let renderEpoch = 0;

async function renderHome() {
  const epoch = ++renderEpoch;
  document.body.classList.remove('theme-auth');
  charts.forEach((c) => c.destroy());
  charts = [];
  stopChipRotation();
  stopKidsSpeech();
  if (mapInstance) { try { mapInstance.remove(); } catch { /* noop */ } mapInstance = null; }

  // overview はモード判定に必須。失敗したら復帰導線つきエラーを出す
  try {
    if (!overviewCache) overviewCache = await api.overview(activeGroupId ?? undefined);
  } catch (e) {
    const retry = el('button', { class: 'primary', textContent: 'もう一度読み込む' });
    retry.addEventListener('click', () => { void renderHome(); });
    app().replaceChildren(el('section', { class: 'card' }, [
      el('h2', { textContent: 'うまく読み込めなかったにゃ…' }),
      el('p', { class: 'status err', textContent: (e as Error).message }),
      retry,
    ]));
    return;
  }
  if (epoch !== renderEpoch) return; // すでに新しい描画が始まっている
  const o = overviewCache;
  activeGroupId = o.settings?.active_group_id ?? activeGroupId ?? myGroups[0]?.id ?? null;
  if (!o.settings) { renderUsagePicker(); return; }
  if (o.settings.usage_type == null) { renderUsagePicker(); return; } // 既存ユーザーも初回だけ利用タイプを選ばせる
  const mode: AppMode = o.settings.mode;
  applyDisplayPreferences();
  syncEventsPolling(mode); // こどもモードなら着信ポーリング開始（おとなは停止）
  document.body.classList.toggle('theme-kids', mode === 'kids');
  document.body.classList.toggle('theme-adult', mode === 'adult');
  // アプリ自体を背景化: html/body の背景をキャンバス内と連続させ、スクロール/縮小しても
  // 「アプリの外の背景」が露出しないようにする。kids はステージ背景（kidsHome と同一算出）、
  // adult はおとなホームのキャンバスと同色 #F7F4EE。
  {
    const fg = featuredGoal(o);
    const bg = mode === 'kids'
      ? stageBackdrop(fg ? currentStage(fg.saved, fg.target) : 0)
      : '#F7F4EE';
    document.documentElement.style.background = document.body.style.background = bg;
  }

  // 直近支出は取れなくてもホーム自体は必ず表示する
  // レポートタブはカレンダーに収入も載せるので、recent と並行で incomes を取得する
  const incomesP = homeTab === 'report' && !incomesCache ? api.listIncomes().catch(() => null) : null;
  let recentFailed = false;
  const recentScopeIds = homeTab === 'report'
    ? (reportGroupIds.length ? reportGroupIds : [activeGroupId ?? myGroups[0]?.id].filter((id): id is number => id != null))
    : [activeGroupId].filter((id): id is number => id != null);
  const nextRecentScope = recentScopeIds.slice().sort((a, b) => a - b).join(',');
  if (recentCacheScope !== nextRecentScope) recentCache = null;
  if (!recentCache) {
    try {
      recentCache = (await api.recentExpenses(366, recentScopeIds)).receipts;
      recentCacheScope = nextRecentScope;
    }
    catch { recentFailed = true; }
  }
  if (incomesP) {
    const r = await incomesP;
    if (r) incomesCache = r.incomes; // 失敗時は収入なし表示（カレンダー自体は出す）
  }
  if (epoch !== renderEpoch) return; // ここまでの await 中に新しい描画が始まった
  const recent = recentCache ?? [];
  const insight = analyzeSpending(recent);
  // お祝いはホーム描画のときだけ消費（他タブで無言消費させない）
  const celebrate = homeTab === 'home' ? pendingCelebrate : null;
  if (homeTab === 'home') pendingCelebrate = null;

  const goTab = (t: KidsTab) => { homeTab = t as HomeTab; void renderHome(); };
  const common = { overview: o, recent, insight, celebrate, goTab };

  let panels: HTMLElement[];
  if (homeTab === 'home') {
    panels = mode === 'kids'
      ? kidsHome({
          ...common,
          // 🐷ちょきんばこから入金（達成したらボーナスのお知らせ。XPのみ表示・コインは撤去）
          onDeposit: async (goalId, amount) => {
            try {
              const r = await api.depositGoal(goalId, amount);
              overviewCache = null;
              pendingCelebrate = { kind: 'generic', name: `${amount.toLocaleString('ja-JP')}円を貯金` };
              if (r.reward.done) alert('🎉 もくひょう たっせい！ ボーナス +100XP');
              await renderHome();
            } catch (e) { alert((e as Error).message); }
          },
          // 掲示板からもくひょう作成
          onCreateGoal: async (body) => {
            try {
              await api.addGoal(body);
              overviewCache = null;
              pendingCelebrate = { kind: 'generic', name: `もくひょう「${body.name.slice(0, 6)}」` };
              await renderHome();
            } catch (e) { alert((e as Error).message); }
          },
        })
      : adultHome({ ...common, insights: monthlyInsights(recent, o), onReceiptChanged: () => { overviewCache = null; } });
    if (recentFailed) panels.push(el('p', { class: 'status err', textContent: '📡 通信が不安定で最近の記録を読めませんでした。再読み込みしてください。' }));
  } else if (homeTab === 'add') {
    panels = mode === 'kids' ? kidsRecordPhoto(o) : wrapPhone(mode, homeTab, quickAddPanel(mode));
  } else if (homeTab === 'report') {
    const incomes = incomesCache ?? [];
    const groupSwitcher = reportGroupSwitcher();
    panels = mode === 'kids'
      ? kidsReportPhoto(o, recent, incomes, groupSwitcher)
      : wrapPhone(mode, homeTab, [genreReportSec(recent, groupSwitcher), ...reportPanel(recent), calendarPanel(recent, false, incomes), mapPanel(recent)]);
  } else if (homeTab === 'savings') {
    panels = mode === 'kids' ? kidsSavingsPhoto(o) : wrapPhone(mode, homeTab, savingsPanel(o, mode));
  } else {
    panels = mode === 'kids'
      ? (o.settings?.usage_type === 'personal' ? await kidsSettingsPhoto(o) : await kidsFamilyPhoto(o))
      : wrapPhone(mode, homeTab, await settingsPanel(o, mode));
  }

  if (epoch !== renderEpoch) return; // 古い描画は捨てる（settingsPanel の await 対策）
  app().replaceChildren(...panels);
  window.scrollTo({ top: 0 });

  // 初回チュートリアル（利用タイプ選択の直後・ホームで1回だけ）。
  // モック確認用に ?tutorial=1 でも再生できる。
  const replayTutorial = new URLSearchParams(location.search).get('tutorial') === '1';
  if (homeTab === 'home' && mode === 'kids' && (!o.settings.tutorial_done || replayTutorial)) {
    showTutorialOverlay(o.settings.usage_type ?? 'personal', panels[0], o);
  } else if (homeTab === 'home' && mode === 'adult') {
    // 月初: 先月のかんたんサマリー（おとな・その月はじめて開いたときだけ）
    maybeShowMonthlySummary(o, recent, panels[0], recentFailed);
  }
}

// 月初サマリーモーダル（表示したら settings に記録して二度出さない）
function maybeShowMonthlySummary(o: Overview, recent: RecentReceipt[], anchor: HTMLElement | undefined, recentFailed = false) {
  if (recentFailed) return; // データが読めなかった回では判定もフラグ保存もしない（次の成功時に再評価）
  const now = new Date();
  const thisYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (!anchor || o.settings?.last_summary_shown === thisYm) return;
  const s = lastMonthSummary(recent, o, now);
  // 記録済みフラグは「先月データが無い月」でも立てる（毎回判定しない）
  void api.saveSettings({ last_summary_shown: thisYm }).then(() => {
    if (overviewCache?.settings) overviewCache.settings.last_summary_shown = thisYm;
  }).catch(() => { /* 次回また出るだけ */ });
  if (!s) return;
  const target = anchor.querySelector<HTMLElement>('.pc-canvas') ?? anchor;

  const genreRows = s.topGenres.map((g, i) => {
    const [bg, fg] = genreColor(g.genre);
    const chip = el('span', { class: 'ms-chip', textContent: `${i + 1}. ${g.genre}` });
    chip.style.background = bg; chip.style.color = fg;
    return el('div', { class: 'ms-row' }, [chip, el('strong', { textContent: yen(g.total) })]);
  });
  const diff = s.prevTotal > 0 ? s.total - s.prevTotal : null;
  const content = el('div', { class: 'ms-body' }, [
    el('div', { class: 'ms-total-label', textContent: `${s.label}の支出` }),
    el('div', { class: 'ms-total', textContent: yen(s.total) }),
    diff != null ? el('div', { class: 'ms-diff', textContent: `前の月より ${signedYen(diff)}` }) : el('span'),
    el('div', { class: 'ms-sec', textContent: 'つかいみち トップ3' }),
    ...genreRows,
    s.biggest ? el('div', { class: 'ms-note', textContent: `いちばん大きな買い物: ${s.biggest.store_name || s.biggest.items[0]?.name || ''} ${yen(s.biggest.total)}` }) : el('span'),
    el('div', { class: 'ms-note', textContent: `記録した日数: ${s.recordDays}日` }),
    el('div', { class: 'ms-comment', textContent: `🐱 ${s.comment}` }),
    (() => {
      const b = el('button', { class: 'primary big-add', textContent: '今月もがんばる' });
      b.addEventListener('click', () => b.closest('.cm-overlay')?.remove());
      return el('div', { class: 'center', style: 'margin-top:12px' as any }, [b]);
    })(),
  ]);
  canvasModal(target, content, { title: `📖 ${s.label}のまとめ` });
}

// --- 🌱 貯金（目標・おこづかい/収入） --------------------------------
function savingsPanel(o: Overview, mode: AppMode): HTMLElement[] {
  const kids = mode === 'kids';
  const out: HTMLElement[] = [];

  const savedAll = o.goals.reduce((a, g) => a + g.saved, 0);
  out.push(el('section', { class: 'card sv-head' }, [
    el('h2', { textContent: '🌱 貯金' }),
    el('div', { class: 'sv-stats' }, [
      el('div', { class: 'sv-stat' }, [el('span', { class: 'k', textContent: kids ? 'お財布' : '使えるお金（記録上）' }), el('strong', { textContent: yen(o.wallet) })]),
      el('div', { class: 'sv-stat' }, [el('span', { class: 'k', textContent: kids ? '貯金できた金額' : '貯金合計' }), el('strong', { textContent: yen(savedAll) })]),
    ]),
  ]));

  // 🧹 おてつだいポイント（親子連携）: ちょきん箱の直後。連携中 or 残高があるときだけ。
  if (kids && o.settings?.usage_type !== 'personal' && (o.linkedAsChild || o.chorePoints > 0)) out.push(choreKidsCard(o));

  // 収入（おこづかい / 給料）
  const amount = el('input', { type: 'number', class: 'price', placeholder: '金額', min: '1', value: kids && o.settings?.allowance ? String(o.settings.allowance) : '' });
  const nameIn = el('input', { class: 'grow', placeholder: kids ? 'おこづかい / お年玉 など' : '給料 / ボーナス など', value: kids ? 'おこづかい' : '給料' });
  const incomeBtn = el('button', { class: 'primary', textContent: kids ? '＋ もらったお金を追加' : '＋ 収入を記録' });
  incomeBtn.addEventListener('click', async () => {
    const a = Math.round(Number(amount.value));
    if (!Number.isFinite(a) || a <= 0) return alert('金額を入力してください');
    try {
      await api.addIncome({ name: nameIn.value.trim() || undefined, amount: a });
      overviewCache = null;
      incomesCache = null;
      await markEventsSeen(); // 自分で記録した収入にトーストを鳴らさない
      pendingCelebrate = { kind: 'generic', name: nameIn.value.trim() || 'おこづかい' };
      homeTab = 'home';
      await renderHome();
    } catch (e) { alert((e as Error).message); }
  });
  out.push(el('section', { class: 'card' }, [
    el('h2', { textContent: kids ? '💰 おこづかい・もらったお金' : '💰 収入' }),
    el('div', { class: 'row' }, [labeled('名前', nameIn), labeled('金額', amount), incomeBtn]),
  ]));

  // 目標一覧
  const goalRows = o.goals.map((g) => {
    const p = Math.min(100, Math.round((g.saved / g.target) * 100));
    const fill = el('div', { class: 'sv-fill' + (g.done ? ' done' : '') });
    fill.style.width = p + '%';
    // 期限つきなら「毎月あと¥X」ペース表示
    const pace = monthlyNeeded(g);
    const paceLine = pace
      ? el('p', { class: 'sv-pace', textContent: pace.overdue
          ? (kids ? `期限を過ぎています。あと ${yen(g.target - g.saved)}` : `期限を過ぎています（あと ${yen(g.target - g.saved)}）`)
          : (kids
              ? `${fmtDate(g.deadline!)}までに達成するには、毎月 ${yen(pace.perMonth)}ずつ`
              : `期限 ${fmtDate(g.deadline!)} ・ 今のペースなら毎月あと ${yen(pace.perMonth)} でOK（残り${pace.months}ヶ月）`) })
      : null;
    const dep = el('input', { type: 'number', class: 'price', placeholder: kids ? '貯金する金額' : '入金額', min: '1' });
    const depBtn = el('button', { class: 'primary', textContent: kids ? '貯金する' : '入金' });
    depBtn.addEventListener('click', async () => {
      const a = Math.round(Number(dep.value));
      if (!Number.isFinite(a) || a <= 0) return alert('金額を入力してください');
      if (kids && a > o.wallet && !confirm('お財布の残高より多い金額です。このまま貯金しますか？')) return;
      try {
        const r = await api.depositGoal(g.id, a);
        overviewCache = null;
        if (r.reward.done) alert(`🎉 目標「${g.name}」達成！ ボーナス +100XP`);
        if (kids) {
          pendingCelebrate = { kind: 'generic', name: `${a.toLocaleString('ja-JP')}円を貯金` };
          homeTab = 'home';
        }
        await renderHome();
      } catch (e) { alert((e as Error).message); }
    });
    const del = el('button', { class: 'link-btn danger', textContent: '削除' });
    del.addEventListener('click', async () => {
      if (!confirm(`「${g.name}」を削除しますか？（貯金した分はお財布に戻り、旅の進み具合も戻ります）`)) return;
      await api.deleteGoal(g.id);
      overviewCache = null;
      await renderHome();
    });
    return el('div', { class: 'sv-goal' + (g.done ? ' done' : '') }, [
      el('div', { class: 'sv-goal-head' }, [
        el('strong', { textContent: `${g.emoji ?? '⭐'} ${g.name}` }),
        el('span', { class: 'sv-goal-nums', textContent: `${yen(g.saved)} / ${yen(g.target)}（${p}%）` }),
        g.done ? el('span', { class: 'sv-done-badge', textContent: '達成！🎉' }) : del,
      ]),
      el('div', { class: 'sv-bar' }, [fill]),
      ...(paceLine ? [paceLine] : []),
      g.done ? el('span') : el('div', { class: 'row' }, [dep, depBtn]),
    ]);
  });

  // 新しい目標（期限は任意。設定すると「毎月あと¥X」を出す）
  const gName = el('input', { class: 'grow', placeholder: kids ? '欲しいもの（例: ゲーム機）' : '目標（例: 旅行資金）' });
  const gEmoji = el('select', {}, ['🎮', '⭐', '🚲', '✈️', '💻', '🎁', '📱', '👟'].map((e2) => el('option', { value: e2, textContent: e2 })));
  const gTarget = el('input', { type: 'number', class: 'price', placeholder: kids ? '目標金額' : '目標額', min: '1' });
  const gDeadline = el('input', { type: 'date' });
  const gBtn = el('button', { class: 'primary', textContent: '＋ 目標を作る' });
  gBtn.addEventListener('click', async () => {
    const t = Math.round(Number(gTarget.value));
    if (!gName.value.trim() || !Number.isFinite(t) || t <= 0) return alert('名前と金額を入力してください');
    try {
      await api.addGoal({ name: gName.value.trim(), emoji: gEmoji.value, target: t, deadline: gDeadline.value || undefined });
      overviewCache = null;
      await renderHome();
    } catch (e) { alert((e as Error).message); }
  });
  out.push(el('section', { class: 'card' }, [
    el('h2', { textContent: '⭐ 貯金目標' }),
    ...(goalRows.length ? goalRows : [el('p', { class: 'muted', textContent: kids ? '欲しいものを目標にして、貯金を始めよう。' : '目標を作って貯金を見える化しましょう。' })]),
    el('div', { class: 'row' }, [labeled('名前', gName), labeled('マーク', gEmoji), labeled('金額', gTarget), labeled('期限（任意）', gDeadline), gBtn]),
  ]));
  return out;
}

// 🧹 子のおてつだいカード（残高・お手伝いリスト・ポイント交換・履歴）
// savingsPanel は同期なので、カードは即返し・中身は myChores() で後埋めする。
function choreKidsCard(o: Overview): HTMLElement {
  const card = el('section', { class: 'card chore-card' }, [el('h2', { textContent: '🧹 お手伝い' })]);
  const ptsV = el('strong', { class: 'chore-pts-v', textContent: `⭐ ${o.chorePoints} pt` });
  card.append(el('div', { class: 'chore-pts' }, [
    el('span', { class: 'chore-pts-k', textContent: 'たまったポイント' }), ptsV,
  ]));
  const listWrap = el('div', { class: 'chore-list' });
  const exWrap = el('div', { class: 'chore-ex' });
  const histWrap = el('div', { class: 'chore-hist' });
  card.append(listWrap, exWrap, histWrap);

  // 交換ボタン（¥のみ。コインにかえるボタンはガチャ撤去とあわせて削除・サーバーAPIは残置）
  const drawExchange = (points: number) => {
    const yenBtn = el('button', { class: 'primary chore-ex-btn', textContent: `お金に交換（${points}pt → ¥${points}）` });
    yenBtn.disabled = points <= 0;
    yenBtn.addEventListener('click', async () => {
      yenBtn.disabled = true;
      try {
        const r = await api.exchangePoints('yen') as { yen: number };
        overviewCache = null;
        incomesCache = null; // ¥交換は incomes に1件できる
        await markEventsSeen(); // 自分の交換にトーストを鳴らさない
        alert(`¥${r.yen}をお財布に追加しました`);
        await renderHome();
      } catch (e) { alert((e as Error).message); yenBtn.disabled = false; }
    });
    exWrap.replaceChildren(yenBtn);
  };

  // 未連携（残高だけあるケース）: 残高と交換だけ
  if (!o.linkedAsChild) { drawExchange(o.chorePoints); return card; }

  // 連携中: リスト・履歴を後から埋める
  drawExchange(o.chorePoints);
  listWrap.append(el('p', { class: 'muted', textContent: '読み込み中…' }));
  void (async () => {
    let d: Awaited<ReturnType<typeof api.myChores>>;
    try { d = await api.myChores(); }
    catch { listWrap.replaceChildren(el('p', { class: 'muted', textContent: 'お手伝いを読み込めませんでした。' })); return; }
    ptsV.textContent = `⭐ ${d.points} pt`;
    drawExchange(d.points);
    listWrap.replaceChildren(...(d.chores.length
      ? d.chores.map(choreRow)
      : [el('p', { class: 'muted', textContent: 'お手伝いはまだありません。家族に作ってもらいましょう。' })]));
    const hist = d.history.slice(0, 3);
    if (hist.length) {
      histWrap.replaceChildren(
        el('div', { class: 'chore-hist-h', textContent: '最近の履歴' }),
        ...hist.map((h) => el('div', { class: 'chore-hist-row' }, [
          el('span', { class: 'chore-hist-name', textContent: `${h.name} +${h.points}pt` }),
          el('span', { class: 'chore-hist-mark ' + h.status,
            textContent: h.status === 'approved' ? '✓' : h.status === 'rejected' ? '×' : '⏳' }),
        ])),
      );
    }
  })();
  return card;
}

// お手伝い1行（「やった！」→ claim → 「かくにん まちだよ ⏳」に切替）
function choreRow(c: { id: number; name: string; points: number; pending: boolean }): HTMLElement {
  const btn = el('button', { class: 'primary chore-do' });
  const setPending = () => { btn.textContent = '確認待ち ⏳'; btn.disabled = true; btn.classList.add('waiting'); };
  if (c.pending) setPending();
  else {
    btn.textContent = 'やった！';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { await api.claimChore(c.id); setPending(); }
      catch (e) { alert((e as Error).message); btn.disabled = false; }
    });
  }
  return el('div', { class: 'chore-row' }, [
    el('span', { class: 'chore-name', textContent: c.name }),
    el('span', { class: 'chore-pt', textContent: `+${c.points}pt` }),
    btn,
  ]);
}

// --- ⚙️ せってい / メニュー ------------------------------------------------
const IAP_PRODUCTS = {
  plusMonthly: 'com.tomjo.maneko.plus.monthly',
  plusAnnual: 'com.tomjo.maneko.plus.annual',
  goalIcons: 'com.tomjo.maneko.goalicons.cute',
  seasonCostumes: 'com.tomjo.maneko.costumes.seasons',
} as const;

function iapCard(settings: UserSettings): HTMLElement {
  // 設定画面を開くたびにRevenueCatを待つと、Expo Goや通信不良時に最大45秒止まる。
  // 購入権限はoverviewへ同期済みのDB値で即時描画し、App Store通信は購入・復元時だけ行う。
  const status = {
    plus: !!settings.premium_until && new Date(settings.premium_until).getTime() > Date.now(),
    goal_icons: settings.iap_goal_icons === true,
    season_costumes: settings.iap_season_costumes === true,
  };
  const priceOf = (_id: string, fallback: string) => fallback;
  const monthlyOwned = status.plus;
  const annualOwned = status.plus;

  const card = el('section', { class: 'card iap-card' }, [
    el('div', { class: 'iap-heading' }, [
      el('div', {}, [
        el('span', { class: 'iap-kicker', textContent: 'MANEKO STORE' }),
        el('h2', { textContent: 'マネコプラス・アイテム' }),
      ]),
      ...(status.plus ? [el('span', { class: 'iap-owned-badge', textContent: 'PLUS' })] : []),
    ]),
    el('p', { class: 'muted', textContent: '購入はApple IDに紐づきます。買い切りアイテムは購入後ずっと使えます。' }),
  ]);

  const syncAfterPurchase = async () => {
    await api.syncIap();
    overviewCache = null;
    alert('購入情報を反映しました');
    await renderHome();
  };
  const buy = async (button: HTMLButtonElement, productId: string) => {
    if (!currentUser || !hasNativeIap()) return alert('購入はApp Store版で利用できます');
    button.disabled = true;
    const before = button.textContent;
    button.textContent = 'App Storeを確認中…';
    try {
      const result = await purchaseNativeIap(currentUser.id, productId);
      if (result.error) throw new Error(result.error);
      await syncAfterPurchase();
    } catch (error) {
      if ((error as Error).message !== '購入をキャンセルしました') alert((error as Error).message);
      button.disabled = false;
      button.textContent = before;
    }
  };
  const product = (
    title: string,
    description: string,
    price: string,
    productId: string,
    owned: boolean,
    accent = false,
  ) => {
    const button = el('button', {
      type: 'button',
      class: 'iap-buy' + (accent ? ' primary' : ''),
      textContent: owned ? '購入済み' : `${price}で購入`,
      disabled: owned,
    }) as HTMLButtonElement;
    if (!owned) button.addEventListener('click', () => void buy(button, productId));
    return el('div', { class: 'iap-product' + (accent ? ' featured' : '') }, [
      el('div', { class: 'iap-product-copy' }, [
        el('strong', { textContent: title }),
        el('small', { textContent: description }),
      ]),
      button,
    ]);
  };

  card.append(
    el('div', { class: 'iap-plus-box' }, [
      el('strong', { textContent: 'マネコプラス' }),
      el('span', { textContent: 'レシート読み取りが無制限' }),
      product('月額プラン', '毎月更新・いつでも変更できます', priceOf(IAP_PRODUCTS.plusMonthly, '¥380'), IAP_PRODUCTS.plusMonthly, monthlyOwned, true),
      product('年額プラン', '月額換算でお得な年間プラン', priceOf(IAP_PRODUCTS.plusAnnual, '¥2,980'), IAP_PRODUCTS.plusAnnual, annualOwned, true),
    ]),
    product('目標アイコンパック', '目標貯金で使えるプレミアムアイコン10種類以上', priceOf(IAP_PRODUCTS.goalIcons, '¥160'), IAP_PRODUCTS.goalIcons, status.goal_icons),
    product('季節の衣装パック', '春夏秋冬それぞれ2種類・合計8種類', priceOf(IAP_PRODUCTS.seasonCostumes, '¥320'), IAP_PRODUCTS.seasonCostumes, status.season_costumes),
  );

  const restore = el('button', { type: 'button', class: 'link-btn', textContent: '購入を復元' }) as HTMLButtonElement;
  restore.addEventListener('click', async () => {
    if (!currentUser || !hasNativeIap()) return alert('復元はApp Store版で利用できます');
    restore.disabled = true;
    try {
      const result = await restoreNativeIap(currentUser.id);
      if (result.error) throw new Error(result.error);
      await syncAfterPurchase();
    } catch (error) {
      alert((error as Error).message);
      restore.disabled = false;
    }
  });
  card.append(
    el('div', { class: 'iap-footer' }, [
      restore,
      el('a', { class: 'link-btn', href: 'https://apps.apple.com/account/subscriptions', target: '_blank', textContent: 'サブスクリプションを管理' }),
      el('a', { class: 'link-btn', href: '/terms.html', target: '_blank', textContent: '利用規約' }),
      el('a', { class: 'link-btn', href: '/privacy.html', target: '_blank', textContent: 'プライバシー' }),
    ]),
    el('p', { class: 'iap-note', textContent: 'マネコプラスは月額または年額の自動更新です。期間終了の24時間前までに解約しない限り、Apple IDへ課金され更新されます。' }),
    ...(!hasNativeIap() ? [el('p', { class: 'iap-note', textContent: '購入・復元はApp Storeからインストールしたアプリで利用できます。' })] : []),
  );
  return card;
}

async function settingsPanel(o: Overview, mode: AppMode): Promise<HTMLElement[]> {
  const s = o.settings!;
  const kids = mode === 'kids';

  const displayName = el('input', {
    type: 'text',
    value: currentUser?.username ?? '',
    maxLength: 30,
    autocomplete: 'name',
    placeholder: 'アプリに表示する名前',
  });
  const saveProfile = el('button', { class: 'primary', textContent: '表示名を保存' });
  saveProfile.addEventListener('click', async () => {
    const name = displayName.value.trim();
    if (!name) return alert('表示名を入力してください');
    saveProfile.disabled = true;
    try {
      const user = await api.updateProfile(name);
      currentUser = currentUser ? { ...currentUser, ...user } : user;
      displayName.value = user.username;
      alert('表示名を保存しました');
    } catch (error) {
      alert((error as Error).message);
    } finally {
      saveProfile.disabled = false;
    }
  });
  const modeSec = el('section', { class: 'card' }, [
    el('h2', { textContent: kids ? '👤 プロフィール' : '⚙️ 設定' }),
    el('p', { class: 'muted', textContent: `${kids ? 'マネコタウン' : '大人モード'}で表示する名前です。` }),
    el('div', { class: 'row' }, [labeled('表示名', displayName), saveProfile]),
  ]);
  modeSec.dataset.settingsPage = 'profile';
  if (!kids) {
    // 既存の大人モード利用者には、マネコタウンへの一方向の移行だけ残す。
    const townBtn = el('button', { class: 'primary', textContent: '🏘️ マネコタウンに切り替え' });
    townBtn.addEventListener('click', async () => {
      await api.saveSettings({ mode: 'kids' });
      overviewCache = null;
      homeTab = 'home';
      await renderHome();
    });
    modeSec.append(townBtn);
  }

  // 利用タイプ（家族⇔個人）切替。personal→family に切り替えても連携等のデータは消さない（非表示になるだけ）。
  const isPersonal = s.usage_type === 'personal';
  const usageBtn = el('button', { class: 'primary', textContent: isPersonal ? '🏠 家族利用に切り替え' : '👤 個人利用に切り替え' });
  usageBtn.addEventListener('click', async () => {
    try {
      await api.saveSettings({ usage_type: isPersonal ? 'family' : 'personal' });
      overviewCache = null;
      await renderHome();
    } catch (e) { alert((e as Error).message); }
  });
  const usageSec = el('section', { class: 'card' }, [
    el('h2', { textContent: '👤 利用タイプ' }),
    el('p', { class: 'muted', textContent: isPersonal
      ? '現在は個人利用です。' : '現在は家族利用です。' }),
    usageBtn,
  ]);
  usageSec.dataset.settingsPage = 'profile';

  // お金の設定（モードで出し分け）
  const budget = el('input', { type: 'number', class: 'price', value: s.monthly_budget != null ? String(s.monthly_budget) : '', placeholder: '例: 220000' });
  const income = el('input', { type: 'number', class: 'price', value: s.monthly_income != null ? String(s.monthly_income) : '', placeholder: '例: 280000' });
  const allowance = el('input', { type: 'number', class: 'price', value: s.allowance != null ? String(s.allowance) : '', placeholder: '例: 1000' });
  const startBal = el('input', { type: 'number', class: 'price', value: String(s.balance_start ?? 0) });
  const saveBtn = el('button', { class: 'primary', textContent: '保存' });
  saveBtn.addEventListener('click', async () => {
    const num = (i: HTMLInputElement) => (i.value.trim() === '' ? null : Math.round(Number(i.value)));
    try {
      await api.saveSettings(kids
        ? (isPersonal
          ? { monthly_budget: num(budget), balance_start: num(startBal) ?? 0 }
          : { allowance: num(allowance), monthly_budget: num(budget), balance_start: num(startBal) ?? 0 })
        : { monthly_budget: num(budget), monthly_income: num(income) });
      overviewCache = null;
      await renderHome();
    } catch (e) { alert((e as Error).message); }
  });
  const kidsMoneyFields = isPersonal
    ? [labeled('月の予算（任意）', budget), labeled('お財布のスタート額', startBal), saveBtn]
    : [labeled('月のお小遣い', allowance), labeled('月の予算（任意）', budget), labeled('お財布のスタート額', startBal), saveBtn];
  const moneySec = el('section', { class: 'card' }, [
    el('h2', { textContent: kids
      ? (isPersonal ? '💰 お財布の設定' : '💰 お小遣いの設定')
      : '💰 予算と収入' }),
    el('div', { class: 'row' }, kids
      ? kidsMoneyFields
      : [labeled('月の予算', budget), labeled('月の収入（手取り）', income), saveBtn]),
    el('p', { class: 'muted', textContent: kids
      ? '予算を設定するとホームに「今月あと使える」を表示します。未設定なら今月の支出を表示します。'
      : '予算を設定するとホームに「今月あと使える」が表示されます。' }),
  ]);
  moneySec.dataset.settingsPage = 'profile';

  const logout = el('button', { class: 'link-btn', textContent: 'ログアウト' });
  logout.addEventListener('click', async () => {
    await api.logout();
    stopEventsPolling();
    currentUser = null; myGroups = []; activeGroupId = null;
    overviewCache = null; recentCache = null; incomesCache = null;
    document.body.classList.remove('theme-kids', 'theme-adult');
    renderAuth();
  });
  const deleteAccount = el('button', { class: 'link-btn danger', textContent: 'アカウントを削除' });
  deleteAccount.addEventListener('click', async () => {
    const password = prompt('確認のため、現在のパスワードを入力してください');
    if (!password) return;
    if (!confirm('アカウントと自分専用の家計データを完全に削除します。この操作は取り消せません。')) return;
    deleteAccount.disabled = true;
    try {
      await api.deleteAccount(password);
      stopEventsPolling();
      currentUser = null; myGroups = []; activeGroupId = null;
      overviewCache = null; recentCache = null; incomesCache = null;
      renderAuth();
    } catch (e) {
      deleteAccount.disabled = false;
      alert((e as Error).message);
    }
  });
  const logoutSec = el('section', { class: 'card' }, [
    el('h2', { textContent: 'アカウント' }),
    el('p', { class: 'muted', textContent: currentUser?.email
      ? `${currentUser.email}（${currentUser.email_verified ? '確認済み' : '未確認'}）`
      : `表示名: ${currentUser?.username ?? ''}` }),
    el('div', { class: 'row' }, [logout, deleteAccount]),
    el('p', { class: 'muted', textContent: '削除すると、自分だけの家計簿データも削除され、元に戻せません。共有スペースは他のメンバーに残ります。' }),
    el('div', { class: 'row' }, [
      el('a', { href: '/privacy.html', target: '_blank', class: 'link-btn', textContent: 'プライバシー' }),
      el('a', { href: '/terms.html', target: '_blank', class: 'link-btn', textContent: '利用規約' }),
      el('a', { href: '/support.html', target: '_blank', class: 'link-btn', textContent: 'サポート' }),
    ]),
  ]);
  logoutSec.dataset.settingsPage = 'account';
  if (currentUser?.email && !currentUser.email_verified) {
    const resend = el('button', { class: 'link-btn', textContent: '確認メールを再送' });
    resend.addEventListener('click', async () => {
      resend.disabled = true;
      try {
        await api.resendVerification();
        alert('確認メールを送信しました。');
      } catch (error) {
        alert((error as Error).message);
      } finally {
        resend.disabled = false;
      }
    });
    logoutSec.insertBefore(resend, logoutSec.children[2]);
  }

  // 👨‍👩‍👧 かぞくと つながる（親子アカウント連携）。個人利用では非表示（データは消さない）。
  const familySec = isPersonal ? null : await familyLinkCard(mode, o);

  const spacesSec = groupsCard(myGroups);
  spacesSec.dataset.settingsPage = 'account';
  const storeSec = iapCard(s);
  storeSec.dataset.settingsPage = 'account';
  if (kids && familySec) {
    const intro = el('section', { class: 'card family-tab-intro' }, [
      el('span', { class: 'family-tab-kicker', textContent: 'FAMILY' }),
      el('h2', { textContent: '家族' }),
      el('p', { class: 'muted', textContent: 'おこづかいやお手伝いを、家族と一緒に管理できます。' }),
    ]);
    const settingsDrawer = el('details', { class: 'settings-drawer' }, [
      el('summary', { textContent: '⚙️ 設定とアカウント' }),
      el('div', { class: 'settings-drawer-body' }, [modeSec, storeSec, spacesSec, usageSec, moneySec, logoutSec]),
    ]);
    return [intro, familySec, settingsDrawer];
  }
  return [modeSec, storeSec, spacesSec, usageSec, moneySec, logoutSec];
}

// --- 👨‍👩‍👧 親子アカウント連携 --------------------------------------------
// おとな: 子リスト（ようすを見る/おこづかい/解除）＋連携コード発行。
// こども: コード入力でつながる／つながり中の表示・解除。
// 自分が子として連携中なら、親機能は出さず案内だけ。
async function familyLinkCard(mode: AppMode, o: Overview): Promise<HTMLElement> {
  const kids = mode === 'kids';
  const h2 = el('h2', { textContent: kids ? '👨‍👩‍👧 家族とつながる' : '👨‍👩‍👧 家族とつながる' });
  // 承認待ちがあれば見出しに🔔バッジ（親のみ）
  if (!kids && o.pendingChoreCount > 0) h2.append(el('span', { class: 'chore-badge', textContent: `🔔${o.pendingChoreCount}` }));
  const sec = el('section', { class: 'card' }, [h2]);

  let links: Awaited<ReturnType<typeof api.getLinks>>;
  try {
    links = await api.getLinks();
  } catch {
    sec.append(el('p', { class: 'muted', textContent: '連携情報を読み込めませんでした。' }));
    return sec;
  }

  // 自分が子として連携中
  if (links.asChild) {
    const parent = links.asChild.username;
    const linkId = links.asChild.id;
    if (kids) {
      sec.append(el('p', { class: 'link-connected', textContent: `✓ ${parent}さんと連携中` }));
      const stop = el('button', { class: 'link-btn', textContent: '連携を解除' });
      stop.addEventListener('click', async () => {
        if (!confirm(`${parent}さんとの連携を解除しますか？（記録は残ります）`)) return;
        try { await api.deleteLink(linkId); overviewCache = null; await renderHome(); }
        catch (e) { alert((e as Error).message); }
      });
      sec.append(stop);
    } else {
      sec.append(el('p', { class: 'muted', textContent: `${parent} と連携中のアカウントです` }));
    }
    return sec;
  }

  // こども・未連携: コード入力でつながる
  if (kids) {
    const code = el('input', { class: 'grow link-code-input', type: 'text', placeholder: '8桁の連携コード', maxLength: 8 });
    code.setAttribute('autocapitalize', 'characters');
    code.setAttribute('autocomplete', 'off');
    const btn = el('button', { class: 'primary', textContent: '連携する' });
    btn.addEventListener('click', async () => {
      const v = code.value.trim();
      if (!v) { alert('連携コードを入力してください'); return; }
      btn.disabled = true;
      try {
        const r = await api.joinLink(v);
        overviewCache = null;
        alert(`${r.parent.username}さんと連携しました！🎉`);
        await renderHome();
      } catch (e) { alert((e as Error).message); btn.disabled = false; }
    });
    sec.append(
      el('p', { class: 'muted', textContent: '家族のアプリに表示されたコードを入力してください。' }),
      el('div', { class: 'row' }, [labeled('連携コード', code), btn]),
    );
    return sec;
  }

  // おとな・親: 子リスト
  if (links.asParent.length) {
    for (const c of links.asParent) {
      const view = el('button', { class: 'link-btn', textContent: 'ようすを見る' });
      const allow = el('button', { class: 'link-btn', textContent: 'おこづかい' });
      const chore = el('button', { class: 'link-btn', textContent: 'おてつだい' });
      const unlink = el('button', { class: 'link-btn danger', textContent: '解除' });
      view.addEventListener('click', () => openChildView(sec, c.child_user_id, c.username));
      allow.addEventListener('click', () => openAllowance(sec, c.child_user_id, c.username));
      chore.addEventListener('click', () => openChoreParent(sec, c.child_user_id, c.username));
      unlink.addEventListener('click', async () => {
        if (!confirm(`${c.username} との連携を解除する?（データは消えません）`)) return;
        try { await api.deleteLink(c.id); overviewCache = null; await renderHome(); }
        catch (e) { alert((e as Error).message); }
      });
      sec.append(el('div', { class: 'link-row' }, [
        el('span', { class: 'link-name', textContent: `👧 ${c.username}` }),
        el('div', { class: 'link-btns' }, [view, allow, chore, unlink]),
      ]));
    }
  } else {
    sec.append(el('p', { class: 'muted', textContent: 'まだ つながっているお子さまはいません。下のコードを発行してください。' }));
  }

  // 連携コード発行
  const codeWrap = el('div', { class: 'link-code-block' });
  const issueBtn = el('button', { class: 'primary', textContent: '連携コードを発行' });
  const showIssueBtn = () => codeWrap.replaceChildren(issueBtn);
  issueBtn.addEventListener('click', async () => {
    issueBtn.disabled = true;
    try {
      const r = await api.createLinkCode();
      const codeEl = el('div', { class: 'link-code', textContent: r.code });
      const help = el('p', { class: 'muted', textContent: '10分間ゆうこう。お子さまの「メニュー → おうちと つながる」で入力してください。' });
      const again = el('button', { class: 'link-btn', textContent: '再発行' });
      again.addEventListener('click', () => { issueBtn.disabled = false; showIssueBtn(); });
      codeWrap.replaceChildren(codeEl, help, again);
    } catch (e) { alert((e as Error).message); issueBtn.disabled = false; }
  });
  showIssueBtn();
  sec.append(codeWrap);
  return sec;
}

// 親から見る「子のようす」（読み取り専用モーダル）
async function openChildView(anchor: HTMLElement, childId: number, username: string) {
  let d: Awaited<ReturnType<typeof api.childOverview>>;
  try { d = await api.childOverview(childId); }
  catch (e) { alert((e as Error).message); return; }

  const fg = featuredGoal({ goals: d.goals } as unknown as Overview);
  const stage = fg ? currentStage(fg.saved, fg.target) : 0;
  const pct = fg ? Math.max(0, Math.min(100, Math.floor((fg.saved / fg.target) * 100))) : 0;

  const body = el('div', { class: 'cv' }, [
    el('div', { class: 'cv-wallet' }, [
      el('span', { class: 'cv-wallet-k', textContent: 'おさいふ' }),
      el('strong', { class: 'cv-wallet-v', textContent: yen(d.wallet) }),
    ]),
    el('div', { class: 'cv-month' }, [
      el('div', { class: 'cv-stat' }, [el('span', { textContent: '今月つかった' }), el('strong', { textContent: yen(d.month.spend) })]),
      el('div', { class: 'cv-stat' }, [el('span', { textContent: '今月もらった' }), el('strong', { textContent: yen(d.month.income) })]),
    ]),
    el('div', { class: 'cv-stage', textContent: `🗺 いま ${STAGES[stage].name}（${pct}%）` }),
  ]);

  if (d.goals.length) {
    body.append(el('div', { class: 'cv-sec', textContent: '⭐ もくひょう' }));
    for (const g of d.goals) {
      const p = Math.min(100, Math.round((g.saved / g.target) * 100));
      const fill = el('div', { class: 'sv-fill' + (g.done ? ' done' : '') });
      fill.style.width = p + '%';
      body.append(el('div', { class: 'cv-goal' }, [
        el('div', { class: 'cv-goal-head' }, [
          el('strong', { textContent: `${g.emoji ?? '⭐'} ${g.name}` }),
          g.done
            ? el('span', { class: 'sv-done-badge', textContent: 'たっせい！🎉' })
            : el('span', { class: 'cv-goal-nums', textContent: `${yen(g.saved)} / ${yen(g.target)}` }),
        ]),
        el('div', { class: 'sv-bar' }, [fill]),
      ]));
    }
  }

  if (d.recent.length) {
    body.append(el('div', { class: 'cv-sec', textContent: '🧾 さいきんの きろく' }));
    for (const r of d.recent.slice(0, 5)) {
      body.append(el('div', { class: 'cv-rec' }, [
        el('span', { class: 'cv-rec-date', textContent: fmtDate(r.purchased_on) }),
        el('span', { class: 'cv-rec-name', textContent: r.store_name || r.first_item || 'かいもの' }),
        el('strong', { class: 'cv-rec-amt', textContent: yen(r.total) }),
      ]));
    }
  }

  canvasModal(anchor, body, { title: `👧 ${username}` });
}

// 親から子へ おこづかいを送る（モーダル内で完結）
function openAllowance(anchor: HTMLElement, childId: number, username: string) {
  const amt = el('input', { type: 'number', class: 'price', placeholder: '金額', min: '1' });
  const btn = el('button', { class: 'primary', textContent: '送る' });
  const msg = el('p', { class: 'link-sent' });
  const body = el('div', { class: 'kd-form' }, [
    el('p', { class: 'muted', textContent: `${username} に おこづかいを 送ります` }),
    labeled('金額', amt),
    el('div', { class: 'center' }, [btn]),
    msg,
  ]);
  canvasModal(anchor, body, { title: '🎁 おこづかい' });
  btn.addEventListener('click', async () => {
    const v = Math.round(Number(amt.value));
    if (!Number.isFinite(v) || v <= 0) { alert('金額を入れてね'); return; }
    btn.disabled = true;
    try {
      await api.sendAllowance(childId, v);
      overviewCache = null;
      msg.textContent = `¥${v.toLocaleString('ja-JP')} を送りました 🎁`;
      amt.disabled = true;
      btn.textContent = '送りました';
    } catch (e) { alert((e as Error).message); btn.disabled = false; }
  });
}

// 🧹 親のお手伝い管理（承認待ちの承認/却下＋メニュー追加/削除）
function openChoreParent(anchor: HTMLElement, childId: number, username: string) {
  const body = el('div', { class: 'chp' }, [el('p', { class: 'muted', textContent: 'よみこみちゅう…' })]);
  const overlay = canvasModal(anchor, body, { title: `🧹 ${username} の おてつだい` });
  // 閉じたら承認待ちバッジ更新のため overview を取り直してホーム再描画
  const onClose = () => { overviewCache = null; void renderHome(); };
  overlay.querySelector('.cm-close')?.addEventListener('click', onClose);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) onClose(); });

  const reload = async () => {
    let d: Awaited<ReturnType<typeof api.childChores>>;
    try { d = await api.childChores(childId); }
    catch (e) { body.replaceChildren(el('p', { class: 'muted', textContent: (e as Error).message })); return; }

    const parts: HTMLElement[] = [
      el('div', { class: 'chp-pts', textContent: `いまのポイント: ⭐ ${d.points} pt` }),
      el('div', { class: 'chp-sec', textContent: '⏳ しょうにん まち' }),
    ];
    if (!d.pending.length) {
      parts.push(el('p', { class: 'muted', textContent: 'まっている おてつだいは ないよ。' }));
    } else {
      for (const p of d.pending) {
        const ok = el('button', { class: 'link-btn chp-ok', textContent: 'よくできました ✓' });
        const ng = el('button', { class: 'link-btn danger', textContent: 'まだだよ ×' });
        const row = el('div', { class: 'chp-pend' }, [
          el('span', { class: 'chp-pname', textContent: `${p.chore_name} +${p.points}pt` }),
          el('span', { class: 'chp-date', textContent: fmtDate(p.created_at) }),
          ok, ng,
        ]);
        ok.addEventListener('click', async () => {
          ok.disabled = true; ng.disabled = true;
          try {
            await api.decideChore(p.id, true);
            overviewCache = null;
            row.replaceChildren(el('span', { class: 'chp-done', textContent: `+${p.points}pt を あげました` }));
            setTimeout(() => { void reload(); }, 800);
          } catch (e) { alert((e as Error).message); ok.disabled = false; ng.disabled = false; }
        });
        ng.addEventListener('click', async () => {
          ok.disabled = true; ng.disabled = true;
          try { await api.decideChore(p.id, false); overviewCache = null; row.remove(); }
          catch (e) { alert((e as Error).message); ok.disabled = false; ng.disabled = false; }
        });
        parts.push(row);
      }
    }

    parts.push(el('div', { class: 'chp-sec', textContent: '🧹 おてつだい メニュー' }));
    for (const m of d.menu.filter((x) => x.active)) {
      const del = el('button', { class: 'link-btn danger', textContent: '削除' });
      del.addEventListener('click', async () => {
        if (!confirm(`「${m.name}」を さくじょする?`)) return;
        try { await api.deleteChore(m.id); await reload(); }
        catch (e) { alert((e as Error).message); }
      });
      parts.push(el('div', { class: 'chp-menu' }, [
        el('span', { class: 'chp-mname', textContent: m.name }),
        el('span', { class: 'chp-mpt', textContent: `+${m.points}pt` }),
        del,
      ]));
    }

    // 追加フォーム
    const nameIn = el('input', { class: 'grow', placeholder: 'なまえ（れい: おふろそうじ）' });
    const ptIn = el('input', { type: 'number', class: 'price', placeholder: 'pt', min: '1' });
    const addBtn = el('button', { class: 'primary', textContent: '追加' });
    addBtn.addEventListener('click', async () => {
      const nm = nameIn.value.trim();
      const pt = Math.round(Number(ptIn.value));
      if (!nm || !Number.isFinite(pt) || pt <= 0) { alert('なまえと ポイントを いれてね'); return; }
      addBtn.disabled = true;
      try { await api.addChore(childId, { name: nm, points: pt }); await reload(); }
      catch (e) { alert((e as Error).message); addBtn.disabled = false; }
    });
    parts.push(el('div', { class: 'chp-add row' }, [labeled('なまえ', nameIn), labeled('pt', ptIn), addBtn]));

    body.replaceChildren(...parts);
  };
  void reload();
}

// --- ✏️ きろく（ワンタップ記録） ------------------------------------------
const QUICK_CATEGORIES = ['食費', '日用品', '交通', '買い物', '観光', 'その他'];
const KIDS_CATEGORIES = ['お菓子', '食事', 'ゲーム・趣味', '本・文房具', 'その他'];

function quickAddPanel(mode: AppMode): HTMLElement[] {
  const kids = mode === 'kids';
  const groupSelect = el('select', { class: 'quick-space-select' },
    myGroups.map((g) => el('option', { value: String(g.id), textContent: kids ? `👛 ${g.name}` : `🏠 ${g.name}` })));
  if (activeGroupId) groupSelect.value = String(activeGroupId);
  // おとなは詳細フォーム（店・場所・写真・複数明細＋自動ジャンル）がデフォルト
  if (!kids) {
    return adultAddForm({
      pickPlace: () => openMapPicker(null),
      spaces: myGroups,
      activeSpaceId: activeGroupId,
      onSaved: (res) => {
        pendingCelebrate = { kind: 'generic', name: res.name, reward: res.reward };
        recentCache = null;
        overviewCache = null;
        homeTab = 'home';
        void renderHome();
      },
    });
  }
  const cats = kids ? KIDS_CATEGORIES : QUICK_CATEGORIES;
  let category = cats[0];

  const priceInput = el('input', { class: 'quick-price', type: 'number', inputMode: 'numeric', placeholder: '0', min: '1' });
  const nameInput = el('input', { class: 'grow', placeholder: kids ? '何を買った？（例: お菓子）' : 'なにを買った?（例: ラーメン、シャンプー）' });
  const storeInput = el('input', { class: 'grow', placeholder: 'お店（任意）' });
  const dateInput = el('input', { type: 'date', value: todayIso() });
  let pickedLocation: { lat: number | null; lng: number | null; name: string | null } = { lat: null, lng: null, name: null };
  const locationStatus = el('p', { class: 'quick-place-status muted', textContent: '場所は未設定です' });
  const mapButton = el('button', { type: 'button', class: 'link-btn', textContent: '🗺️ 地図から場所を選ぶ' });
  mapButton.addEventListener('click', async () => {
    const result = await openMapPicker(pickedLocation.lat != null && pickedLocation.lng != null
      ? { lat: pickedLocation.lat, lng: pickedLocation.lng }
      : null);
    if (!result) return;
    pickedLocation = { lat: result.lat, lng: result.lng, name: result.name };
    locationStatus.textContent = `📍 場所を設定しました: ${result.name || `${result.lat.toFixed(4)}, ${result.lng.toFixed(4)}`}`;
    locationStatus.classList.add('found');
  });

  // カテゴリはチップで1タップ選択
  const chipRow = el('div', { class: 'chip-row' });
  const drawChips = () => {
    chipRow.replaceChildren(...cats.map((c) => {
      const b = el('button', { type: 'button', class: 'qchip' + (category === c ? ' active' : ''), textContent: c });
      b.addEventListener('click', () => { category = c; drawChips(); });
      return b;
    }));
  };
  drawChips();

  // 追加の品（任意・軽量）
  const extraRows: { name: HTMLInputElement; price: HTMLInputElement }[] = [];
  const extraWrap = el('div', { class: 'stack' });
  const addExtraRow = (): { name: HTMLInputElement; price: HTMLInputElement } => {
    const n = el('input', { class: 'grow', placeholder: '品名' });
    const p = el('input', { class: 'price', type: 'number', inputMode: 'numeric', placeholder: '金額', min: '1' });
    const row = { name: n, price: p };
    extraRows.push(row);
    extraWrap.append(el('div', { class: 'row' }, [n, p]));
    return row;
  };
  const addRowBtn = el('button', { type: 'button', class: 'link-btn', textContent: '＋ 品目を増やす' });
  addRowBtn.addEventListener('click', () => { addExtraRow(); });

  // 🧾 レシート読み取り（Gemini/Claude vision OCR）→ 品名・金額・お店・日付を自動入力
  // capture は付けない（iOSでカメラ直起動になりアルバム選択を塞ぐ。おとな詳細フォームと同挙動）
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
    ocrBtn.textContent = '読み取り中…';
    try {
      const dataUrl = await resizeImage(f, 1280, 0.8);
      const r = await runOcr(dataUrl);
      if (!r.items.length) {
        alert('レシートを読み取れませんでした。明るい場所でまっすぐ撮ってみてください。');
        return;
      }
      if (r.store_name) storeInput.value = r.store_name;
      if (r.purchased_on) dateInput.value = r.purchased_on;
      if (r.address) {
        pickedLocation = { lat: null, lng: null, name: r.address };
        locationStatus.textContent = `📍 レシートから場所を読み取りました: ${r.address}`;
        locationStatus.classList.add('found');
      } else if (r.store_name) {
        pickedLocation = { lat: null, lng: null, name: r.store_name };
        locationStatus.textContent = `📍 レシートからお店を読み取りました: ${r.store_name}`;
        locationStatus.classList.add('found');
      }
      // items[0] をメイン欄へ、items[1..] を追加行へ流し込む（既存の追加行は置き換え）
      nameInput.value = r.items[0].name;
      priceInput.value = String(r.items[0].price);
      extraRows.splice(0);
      extraWrap.replaceChildren();
      for (const it of r.items.slice(1)) {
        const row = addExtraRow();
        row.name.value = it.name;
        row.price.value = String(it.price);
      }
    } catch (e) {
      alert((e as Error).message);
    } finally {
      ocrBtn.disabled = false;
      ocrBtn.textContent = orig;
    }
  });

  const saveBtn = el('button', { type: 'submit', class: 'primary big-add', textContent: '🐱 記録する' });
  const form = el('form', { class: 'card quick-card' }, [
    el('h2', { textContent: kids ? '✏️ 支出を記録' : '✏️ きろく（かんたん記録）' }),
    el('p', { class: 'muted', textContent: kids ? '品名と金額だけでも記録できます。' : '品名と金額だけでOK。マネコがホームで反応するよ。' }),
    labeled(kids ? '記録するスペース' : '保存先の家計簿', groupSelect),
    ocrBtn,
    ocrInput,
    el('p', { class: 'muted af-ocr-note', textContent: 'レシート画像は読み取りだけに使い、保存しません。' }),
    el('div', { class: 'quick-amount-row' }, [el('span', { class: 'quick-yen', textContent: '¥' }), priceInput]),
    labeled('なにを買った?', nameInput),
    chipRow,
    extraWrap,
    addRowBtn,
    el('div', { class: 'row' }, [labeled('日付', dateInput), labeled('お店（任意）', storeInput)]),
    el('div', { class: 'quick-place' }, [mapButton, locationStatus]),
    el('div', { class: 'center' }, [saveBtn]),
  ]);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    const price = Math.round(Number(priceInput.value));
    const items = [{ name, price }, ...extraRows.map((r) => ({ name: r.name.value.trim(), price: Math.round(Number(r.price.value)) }))]
      .filter((i) => i.name && Number.isFinite(i.price) && i.price > 0);
    if (!items.length) { alert('品名と金額を入力してにゃ'); return; }
    saveBtn.disabled = true;
    try {
      const selectedGroupId = Number(groupSelect.value) || activeGroupId || undefined;
      const res = await api.quickExpense({
        group_id: selectedGroupId,
        store_name: storeInput.value.trim() || undefined,
        category,
        purchased_on: dateInput.value || todayIso(),
        items,
        lat: pickedLocation.lat,
        lng: pickedLocation.lng,
        place_name: pickedLocation.name,
      });
      // ホームに戻ってマネコがお祝い（ごほうびも一緒に表示）
      const pseudo = { store_name: storeInput.value, category, items, trip_title: '', purchased_on: dateInput.value } as unknown as RecentReceipt;
      pendingCelebrate = { kind: reactionFor(pseudo), name: items[0].name, reward: res.reward };
      recentCache = null;
      overviewCache = null;
      homeTab = 'home';
      await renderHome();
    } catch (err) {
      alert((err as Error).message);
      saveBtn.disabled = false;
    }
  });

  if (kids) return [form];
  // 詳細に記録したい人向けの入り口（割り勘・レシートOCR）
  const advanced = el('section', { class: 'card' }, [
    el('h2', { textContent: 'もっと詳しく記録したいとき' }),
    el('p', { class: 'muted', textContent: 'レシート読み取り（OCR）・割り勘・地図ピンはプロジェクトの画面から使えます（せってい → プロジェクト）。' }),
    (() => {
      const b = el('button', { textContent: '🧳 せっていを開く' });
      b.addEventListener('click', () => { homeTab = 'menu'; void renderHome(); });
      return b;
    })(),
  ]);
  return [form, advanced];
}

// --- 📅 カレンダー -------------------------------------------------------
function calendarPanel(recent: RecentReceipt[], readonly = false, incomes: IncomeRow[] = []): HTMLElement {
  const byDay = new Map<string, { total: number; rows: RecentReceipt[] }>();
  for (const r of recent) {
    const day = r.purchased_on.slice(0, 10);
    const e = byDay.get(day) ?? { total: 0, rows: [] };
    e.total += r.total;
    e.rows.push(r);
    byDay.set(day, e);
  }
  // 収入（おこづかい・給料・ポイント¥交換）も日別にまとめて、支出と並べて見せる
  const incByDay = new Map<string, IncomeRow[]>();
  for (const inc of incomes) {
    const day = inc.on_date.slice(0, 10);
    const arr = incByDay.get(day) ?? [];
    arr.push(inc);
    incByDay.set(day, arr);
  }
  const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const title = el('h2');
  const grid = el('div', { class: 'cal-grid' });
  const monthTotalEl = el('div', { class: 'cal-month-total' });

  // 日付タップ → カードが出てきて明細・思い出写真が見られる（収入も💰行で並ぶ）
  function showDay(day: string) {
    const e = byDay.get(day);
    const incRows = (incByDay.get(day) ?? []).map((inc) =>
      el('div', { class: 'cal-inc-row' }, [
        el('span', { class: 'cal-inc-name', textContent: `💰 ${inc.name}` }),
        el('strong', { class: 'cal-inc-amt', textContent: `+${yen(inc.amount)}` }),
      ]));
    const spendCards = e && e.rows.length
      ? e.rows.map((r) => receiptCard(r, { readonly, onChanged: () => { overviewCache = null; } }))
      : [];
    const content = el('div', { class: 'cal-day-cards' },
      incRows.length || spendCards.length
        ? [...incRows, ...spendCards]
        : [el('p', { class: 'muted', textContent: 'この日の記録はありません。' })]);
    canvasModal(grid, content, { title: fmtDate(day) + ' の記録' });
  }

  function rebuild() {
    const y = calMonth.getFullYear(), m = calMonth.getMonth();
    title.textContent = `${y}年${m + 1}月`;
    const firstDow = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const now = new Date();
    const todayIso = iso(now.getFullYear(), now.getMonth(), now.getDate());
    const cells: HTMLElement[] = ['日', '月', '火', '水', '木', '金', '土'].map((w) => el('div', { class: 'cal-w', textContent: w }));
    for (let i = 0; i < firstDow; i++) cells.push(el('div'));
    let monthSpend = 0;
    let monthIncome = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const day = iso(y, m, d);
      const e = byDay.get(day);
      const dayIncomes = incByDay.get(day) ?? [];
      const incomeTotal = dayIncomes.reduce((sum, income) => sum + income.amount, 0);
      const hasInc = incomeTotal > 0;
      if (e) monthSpend += e.total;
      monthIncome += incomeTotal;
      const cell = el('button', { class: 'cal-cell' + (e ? ' has' : '') + (day === todayIso ? ' today' : '') }, [
        el('span', {
          class: 'cal-d' + (e && hasInc ? ' has-both' : e ? ' has-expense' : hasInc ? ' has-income' : ''),
          textContent: String(d),
        }),
        ...(hasInc ? [el('span', { class: 'cal-t income', textContent: `+${yen(incomeTotal)}` })] : []),
        ...(e ? [el('span', { class: 'cal-t expense', textContent: `-${yen(e.total)}` })] : []),
      ]);
      cell.addEventListener('click', () => showDay(day));
      cells.push(cell);
    }
    grid.replaceChildren(...cells);
    monthTotalEl.replaceChildren(
      el('span', { class: 'cal-month-income', textContent: `収入 +${yen(monthIncome)}` }),
      el('span', { class: 'cal-month-expense', textContent: `支出 -${yen(monthSpend)}` }),
    );
  }
  const prev = el('button', { class: 'cal-nav', textContent: '‹' });
  const next = el('button', { class: 'cal-nav', textContent: '›' });
  // 直近366日ぶんしか読み込んでいないので、それより前の月へは戻れないようにする
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - 366);
  const minMonth = new Date(windowStart.getFullYear(), windowStart.getMonth(), 1);
  const syncNav = () => { prev.disabled = calMonth <= minMonth; };
  prev.addEventListener('click', () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); rebuild(); syncNav(); });
  next.addEventListener('click', () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); rebuild(); syncNav(); });
  rebuild();
  syncNav();

  return el('section', { class: 'card' }, [
    el('div', { class: 'cal-head' }, [prev, title, next, el('span', { class: 'spacer' }), monthTotalEl]),
    grid,
    el('p', { class: 'muted', textContent: '※ 日付をタップすると明細と思い出写真がカードで開きます。' }),
  ]);
}

// --- 📊 ジャンル別（今月・自動分類の結果） --------------------------------
function genreReportSec(recent: RecentReceipt[], groupSwitcher: HTMLElement | null = null): HTMLElement {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const map = new Map<string, number>();
  for (const r of recent) {
    if (!r.purchased_on.startsWith(ym)) continue;
    for (const it of r.items) {
      const g = it.genre ?? 'その他';
      map.set(g, (map.get(g) ?? 0) + it.price * Math.max(1, it.quantity ?? 1));
    }
  }
  const rows = [...map.entries()].sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map(([, v]) => v));
  const total = rows.reduce((s, [, v]) => s + v, 0);
  return el('section', { class: 'card' }, [
    el('h2', { textContent: `📊 今月のジャンル別（${now.getMonth() + 1}月 ・ ${yen(total)}）` }),
    ...(groupSwitcher ? [groupSwitcher] : []),
    ...(rows.length
      ? rows.map(([g, v]) => {
          const [bg, fg] = genreColor(g);
          const fill = el('div', { class: 'gr-fill' });
          fill.style.width = Math.max(4, Math.round((v / max) * 86)) + '%';
          fill.style.background = fg;
          const chip = el('span', { class: 'gr-chip', textContent: g });
          chip.style.background = bg;
          chip.style.color = fg;
          const percent = total ? Math.round((v / total) * 100) : 0;
          return el('div', { class: 'gr-row' }, [
            chip,
            el('div', { class: 'gr-bar' }, [fill]),
            el('span', { class: 'gr-value' }, [
              el('strong', { class: 'gr-amount', textContent: yen(v) }),
              el('small', { class: 'gr-percent', textContent: `${percent}%` }),
            ]),
          ]);
        })
      : [el('p', { class: 'muted', textContent: '今月の記録はまだありません。' })]),
    el('p', { class: 'muted', textContent: 'ジャンルは自動分類です。カレンダーの日付 → 明細をタップすると直せます。' }),
  ]);
}

// --- 🗺 買い物マップ（ピン→タップで明細・写真） ---------------------------
function mapPanel(recent: RecentReceipt[]): HTMLElement {
  const pinned = recent.filter((r) => r.lat != null && r.lng != null);
  const mapDiv = el('div', { class: 'report-map', id: 'report-map' });
  const nativeBtn = el('button', { type: 'button', class: 'primary native-map-button', textContent: '🗺 Googleマップで見る' });
  nativeBtn.addEventListener('click', () => {
    void openNativeMapViewer(pinned.map((r) => ({
      lat: r.lat!,
      lng: r.lng!,
      title: r.store_name || '買い物',
      subtitle: `${fmtDate(r.purchased_on)}・-${yen(r.total)}${
        r.group_member_count >= 2 && r.paid_by_name ? `・支払った人：${r.paid_by_name}` : ''
      }`,
    })), '買い物マップ');
  });
  const sec = el('section', { class: 'card' }, [
    el('h2', { textContent: '🗺 買い物マップ' }),
    pinned.length
      ? (hasNativeMap() ? nativeBtn : mapDiv)
      : el('p', { class: 'muted', textContent: 'まだ場所つきの記録がありません。きろくの「🗺 場所を選ぶ」で買った場所にピンが立ちます。' }),
    ...(pinned.length ? [el('p', { class: 'muted', textContent: 'ピンをタップすると、その買い物の明細と思い出写真が開きます。' })] : []),
  ]);
  if (pinned.length && !hasNativeMap()) {
    requestAnimationFrame(() => {
      if (!byId('report-map') || typeof L === 'undefined') return;
      const map = L.map('report-map');
      mapInstance = map;
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);
      const markers = pinned.map((r) => {
        const mk = L.marker([r.lat, r.lng]).addTo(map);
        mk.on('click', () => canvasModal(sec, receiptCard(r, { onChanged: () => { overviewCache = null; } }))); // カード自身に店名が出る
        return mk;
      });
      if (pinned.length === 1) map.setView([pinned[0].lat, pinned[0].lng], 15);
      else map.fitBounds(L.featureGroup(markers).getBounds().pad(0.3));
    });
  }
  return sec;
}

// --- 📊 レポート ---------------------------------------------------------
function reportPanel(recent: RecentReceipt[]): HTMLElement[] {
  // 月次推移（直近6ヶ月・クライアント集計）
  const byMonth = new Map<string, number>();
  const labels: string[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    byMonth.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, 0);
    labels.push(`${d.getMonth() + 1}月`);
  }
  for (const r of recent) {
    const key = r.purchased_on.slice(0, 7);
    if (byMonth.has(key)) byMonth.set(key, byMonth.get(key)! + r.total);
  }
  const trend = el('canvas');
  const trendSec = el('section', { class: 'card' }, [
    el('h2', { textContent: '📈 月次推移（直近6ヶ月）' }),
    el('div', { class: 'chart-box wide' }, [trend]),
  ]);
  requestAnimationFrame(() => {
    charts.push(new Chart(trend, {
      type: 'bar',
      data: { labels, datasets: [{ data: [...byMonth.values()], backgroundColor: '#C99B2E', borderRadius: 8 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
    }));
  });

  return [trendSec]; // カテゴリ内訳は genreReportSec（ジャンル別）が担う
}

// --- 🧳 プロジェクト -----------------------------------------------------
function projectsPanel(projects: Trip[], groups: Group[]): HTMLElement[] {
  const trips = projects.filter((p) => p.kind !== 'daily');
  const dailies = projects.filter((p) => p.kind === 'daily');

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
      el('p', { class: 'muted', textContent: '先に「グループ」タブでグループを作成（または参加）してください。プロジェクトはグループに属します。' }),
    ]);
  } else {
    const kindSel = el('select', { name: 'kind' }, [
      el('option', { value: 'daily', textContent: '日常（普段使い）' }),
      el('option', { value: 'trip', textContent: '旅行・イベント' }),
    ]);
    const groupSel = el('select', { name: 'group_id' }, groups.map((g) => el('option', { value: String(g.id), textContent: g.name })));
    const title = el('input', { name: 'title', placeholder: '例: わたしの家計簿 ／ 沖縄2泊3日', required: true });
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
      recentCache = null;
      await renderHome();
    });
    form = f;
  }
  form.id = 'create-form';

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
    section('🏠 日常', dailies, 'まだ日常の家計簿がありません。下のフォームで「日常」を選んで作成できます。'),
    section('🧳 旅行・イベント', trips, 'まだ旅行がありません。下のフォームから作成できます。'),
  ]);

  return [hero, projectsSec, form];
}

// --- 旅行詳細 ---------------------------------------------------------
async function renderTrip(id: number) {
  const epoch = ++renderEpoch; // ホームと同じ世代番号で、古い非同期描画の上書きを防ぐ
  const d = await api.getTrip(id);
  if (epoch !== renderEpoch) return;
  const nameOf = (mid: number | null) => d.members.find((m) => m.id === mid)?.name ?? '—';

  const isTrip = d.trip.kind !== 'daily';

  const headerMain = el('div', { class: 'trip-header-main' }, [
    el('h1', { textContent: d.trip.title }),
    el('div', { class: 'muted', textContent: isTrip
      ? `${dateRange(d.trip.start_date, d.trip.end_date)} ・ 合計 ${yen(d.summary.total)}`
      : `日常（普段使い）・ 合計 ${yen(d.summary.total)}` }),
  ]);
  const headerChildren: (Node | string)[] = [
    el('a', { class: 'back', href: '#/', textContent: '← ホーム' }),
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
    // 先頭は常に「ホーム」＝マネコのいるトップへ戻る（迷子防止）
    const homeBtn = el('button', { class: 'tabbar-item' }, [
      el('span', { class: 'ti-ico', textContent: '🐱' }),
      el('span', { textContent: 'ホーム' }),
    ]);
    homeBtn.addEventListener('click', () => { location.hash = '#/'; });
    tabbar.replaceChildren(homeBtn, ...tabDefs.map(([key, ico, label]) => {
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
  // タブ切替・再描画のたびに先頭へ（前タブで下までスクロールしていても新タブが見えるように）
  window.scrollTo({ top: 0 });
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
  const colors = ['#C99B2E', '#8FA98F', '#C88A6A', '#7E93AE', '#E3C56A', '#B8AE9C'];
  // canvas は DOM 追加後に描画する（次のマイクロタスク）
  Promise.resolve().then(() => {
    charts.push(new Chart(monthCv, {
      type: 'bar',
      data: { labels: months.map((m) => m.replace('-', '/')), datasets: [{ data: months.map((m) => byMonth.get(m)), backgroundColor: '#C99B2E' }] },
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
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&libraries=places&language=ja&region=JP`;
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
  if (hasNativeMap()) {
    const elc = byId('trip-map');
    if (!elc) return;
    const pinned = d.receipts.filter((r) => r.lat != null && r.lng != null);
    const button = el('button', { type: 'button', class: 'primary native-map-button', textContent: '🗺 Googleマップで見る' });
    button.addEventListener('click', () => {
      void openNativeMapViewer(pinned.map((r) => ({
        lat: r.lat!,
        lng: r.lng!,
        title: r.store_name || '買い物',
        subtitle: `${fmtDate(r.purchased_on)}・${yen(r.total)}`,
      })), d.trip.title);
    });
    elc.replaceWith(el('div', { class: 'native-map-placeholder' }, [
      el('p', { class: 'muted', textContent: pinned.length ? `${pinned.length}件の場所つき記録があります。` : '場所つきの記録はまだありません。' }),
      button,
    ]));
    return;
  }
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
    mk.bindPopup(`<b>${esc(r.store_name || '(店名なし)')}</b><br>${esc(r.category || '')} ${yen(r.total)}`);
    mk.on('click', () => openModal(d, r, nameOf));
    return mk;
  });
  map.fitBounds(L.featureGroup(markers).getBounds().pad(0.3));
}

// --- 場所ピッカー（tabikake 移植：タップ/検索/現在地でピンを決める） ----
type Picked = { lat: number; lng: number; name: string | null };
async function openMapPicker(initial: { lat: number; lng: number } | null): Promise<Picked | null> {
  const native = openNativeMapPicker(initial);
  if (native) {
    const point = await native;
    if (!point) return null;
    if (point.name) return { lat: point.lat, lng: point.lng, name: point.name };
    const place = await reverseGeocode(point.lat, point.lng);
    return { lat: point.lat, lng: point.lng, name: place.name || null };
  }
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

  let pickerMap: any = null; // Leaflet インスタンス（閉じるときに破棄しないとリスナーが残る）
  const finish = (result: Picked | null) => {
    document.removeEventListener('keydown', onKey);
    try { pickerMap?.remove(); } catch { /* noop */ }
    pickerMap = null;
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
    const map = new google.maps.Map(mapDiv, {
      center: { lat: start.lat, lng: start.lng },
      zoom: initial ? 16 : 13,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: true,
    });
    let marker: any = null;
    setPin = (lat, lng) => {
      if (!marker) {
        marker = new google.maps.Marker({ position: { lat, lng }, map, draggable: true });
        marker.addListener('dragend', (e: any) => setPicked(e.latLng.lat(), e.latLng.lng(), null, true));
      } else marker.setPosition({ lat, lng });
    };
    panTo = (lat, lng, zoom) => { map.panTo({ lat, lng }); if (zoom) map.setZoom(zoom); };
    map.addListener('click', (e: any) => {
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();
      if (!e.placeId) {
        void setPicked(lat, lng, null, true);
        return;
      }
      e.stop?.();
      const service = google.maps.places?.PlacesService
        ? new google.maps.places.PlacesService(map)
        : null;
      if (!service) {
        void setPicked(lat, lng, null, true);
        return;
      }
      service.getDetails(
        { placeId: e.placeId, fields: ['name', 'geometry'] },
        (place: any, status: any) => {
          const ok = status === google.maps.places.PlacesServiceStatus.OK;
          const point = place?.geometry?.location;
          void setPicked(
            point?.lat?.() ?? lat,
            point?.lng?.() ?? lng,
            ok ? place?.name ?? null : null,
            !ok || !place?.name,
          );
        },
      );
    });
    if (picked) setPin(picked.lat, picked.lng);
  };
  const initLeaflet = () => {
    const map = L.map(mapDiv).setView([start.lat, start.lng], initial ? 16 : 13);
    pickerMap = map;
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
const th = (t: string) => el('th', { textContent: t });
const td = (t: string) => el('td', { textContent: t });
function dateRange(a: string | null, b: string | null) {
  if (!a && !b) return '日付未設定';
  return [a, b].filter(Boolean).map((x) => fmtDate(String(x))).join(' – ');
}

// --- 認証ゲート -------------------------------------------------------
function inviteTokenFromLocation(): string | null {
  const path = location.pathname.match(/^\/invite\/([A-Za-z0-9_-]+)\/?$/)?.[1];
  const query = new URLSearchParams(location.search).get('invite');
  return path ?? query;
}

function renderAuth() {
  document.body.classList.remove('theme-kids', 'theme-adult');
  document.body.classList.add('theme-auth');
  document.documentElement.style.background = document.body.style.background = '#d8ebf1';
  let mode: 'login' | 'register' = 'login';
  const email = el('input', {
    name: 'email',
    type: 'text',
    placeholder: 'メールアドレス（旧ユーザーはユーザー名）',
    autocomplete: 'username',
    inputmode: 'email',
  } as any);
  const displayName = el('input', {
    name: 'display_name',
    placeholder: '例：ともき',
    autocomplete: 'name',
  });
  const password = el('input', {
    name: 'password',
    type: 'password',
    placeholder: 'パスワード',
    autocomplete: 'current-password',
  });
  const errBox = el('p', {
    class: 'auth-v2-error',
    role: 'alert',
    style: 'display:none' as any,
  });
  const submit = el('button', {
    type: 'submit',
    class: 'auth-v2-primary',
    textContent: 'マネコタウンへ',
  });
  const toggle = el('button', {
    type: 'button',
    class: 'auth-v2-switch-button',
    textContent: 'アカウントを作る',
  });
  const forgot = el('button', {
    type: 'button',
    class: 'auth-v2-forgot',
    textContent: '忘れた場合',
  });
  const eye = el('button', {
    type: 'button',
    class: 'auth-v2-eye',
    textContent: '👁',
    'aria-label': 'パスワードを表示',
  } as any);
  eye.addEventListener('click', () => {
    const reveal = password.type === 'password';
    password.type = reveal ? 'text' : 'password';
    eye.textContent = reveal ? '◉' : '👁';
    eye.setAttribute('aria-label', reveal ? 'パスワードを隠す' : 'パスワードを表示');
  });

  const authField = (
    labelText: string,
    input: HTMLInputElement,
    icon: string,
    trailing?: HTMLElement,
  ) => {
    const labelRow = el('span', { class: 'auth-v2-field-top' }, [
      el('span', { textContent: labelText }),
      ...(trailing ? [trailing] : []),
    ]);
    return el('label', { class: 'auth-v2-field' }, [
      labelRow,
      el('span', { class: 'auth-v2-input' }, [
        el('span', { class: 'auth-v2-input-icon', textContent: icon, 'aria-hidden': 'true' } as any),
        input,
        ...(input === password ? [eye] : []),
      ]),
    ]);
  };

  const displayNameField = authField('表示名', displayName, '猫');
  const emailField = authField('メールアドレス', email, '✉');
  const passwordField = authField('パスワード', password, '●', forgot);
  const heading = el('h2', { textContent: 'ログイン' });
  const sheetDescription = el('p', { textContent: '登録したアカウントで続ける' });
  const step = el('span', { class: 'auth-v2-step', textContent: 'いつもの街へ' });
  const eyebrow = el('span', { class: 'auth-v2-eyebrow', textContent: 'WELCOME BACK' });
  const heroLine1 = el('span', { textContent: 'おかえりなさい。' });
  const heroLine2 = el('span', { textContent: '今日も一緒に進もう。' });
  const heroHeading = el('h1', {}, [heroLine1, heroLine2]);
  const heroDescription = el('p', { textContent: '記録も貯金も、あなたの街で待っています。' });
  const switchLead = el('span', { textContent: 'はじめて使う方は' });
  const terms = el('div', { class: 'auth-v2-terms' }, [
    el('b', { textContent: '✓', 'aria-hidden': 'true' } as any),
    el('span', {}, [
      el('a', { href: '/terms.html', target: '_blank', textContent: '利用規約' }),
      ' と ',
      el('a', { href: '/privacy.html', target: '_blank', textContent: 'プライバシーポリシー' }),
      ' に同意して登録します。',
    ]),
  ]);
  const secure = el('div', { class: 'auth-v2-secure', textContent: '入力情報は安全に保護されます' });
  const inviteNotice = inviteTokenFromLocation()
    ? el('p', {
        class: 'auth-v2-invite',
        textContent: '招待された家計簿スペースに参加します',
      })
    : null;

  const form = el('form', { class: 'auth-v2-sheet' }, [
    el('div', { class: 'auth-v2-handle', 'aria-hidden': 'true' } as any),
    el('div', { class: 'auth-v2-sheet-head' }, [
      el('div', {}, [heading, sheetDescription]),
      step,
    ]),
    ...(inviteNotice ? [inviteNotice] : []),
    displayNameField,
    emailField,
    passwordField,
    terms,
    errBox,
    submit,
    el('p', { class: 'auth-v2-switch' }, [switchLead, ' ', toggle]),
    secure,
  ]);

  const page = el('section', { class: 'auth-v2-page' }, [
    el('div', { class: 'auth-v2-scene', 'aria-hidden': 'true' } as any),
    el('div', { class: 'auth-v2-shade', 'aria-hidden': 'true' } as any),
    el('div', { class: 'auth-v2-brand' }, [
      el('img', { src: '/icons/icon-192.png', alt: '' }),
      el('div', {}, [
        el('strong', { textContent: 'MANEKO' }),
        el('small', { textContent: 'マネコ家計簿' }),
      ]),
    ]),
    el('div', { class: 'auth-v2-hero' }, [eyebrow, heroHeading, heroDescription]),
    el('img', {
      class: 'auth-v2-maneko',
      src: '/assets/kids/maneko-3d.webp',
      alt: 'マネコ',
    }),
    form,
  ]);

  const setMode = (m: 'login' | 'register') => {
    mode = m;
    const register = m === 'register';
    page.classList.toggle('is-register', register);
    heading.textContent = register ? 'アカウントを作る' : 'ログイン';
    sheetDescription.textContent = register
      ? 'アプリ内では表示名が使われます'
      : '登録したアカウントで続ける';
    step.textContent = register ? '無料ではじめる' : 'いつもの街へ';
    eyebrow.textContent = register ? 'START YOUR JOURNEY' : 'WELCOME BACK';
    heroLine1.textContent = register ? 'マネコと、お金の旅を' : 'おかえりなさい。';
    heroLine2.textContent = register ? 'はじめよう。' : '今日も一緒に進もう。';
    heroDescription.textContent = register
      ? '小さな記録が、街の変化につながります。'
      : '記録も貯金も、あなたの街で待っています。';
    submit.textContent = register ? 'アカウントを作る' : 'マネコタウンへ';
    toggle.textContent = register ? 'ログイン' : 'アカウントを作る';
    switchLead.textContent = register ? 'すでにアカウントがある方は' : 'はじめて使う方は';
    displayNameField.hidden = !register;
    terms.hidden = !register;
    secure.hidden = register;
    forgot.hidden = register;
    email.type = register ? 'email' : 'text';
    email.placeholder = register ? 'name@example.com' : 'メールアドレス（旧ユーザーはユーザー名）';
    password.placeholder = register ? '8文字以上' : 'パスワード';
    password.type = 'password';
    eye.textContent = '👁';
    eye.setAttribute('aria-label', 'パスワードを表示');
    password.setAttribute('autocomplete', register ? 'new-password' : 'current-password');
    errBox.style.display = 'none';
  };
  toggle.addEventListener('click', () => setMode(mode === 'login' ? 'register' : 'login'));
  forgot.addEventListener('click', async () => {
    const address = prompt('登録したメールアドレスを入力してください', email.value);
    if (!address) return;
    forgot.setAttribute('disabled', 'true');
    try {
      await api.requestPasswordReset(address);
      alert('登録済みのメールアドレスであれば、再設定用のメールを送信しました。');
    } catch (error) {
      alert((error as Error).message);
    } finally {
      forgot.removeAttribute('disabled');
    }
  });
  setMode('login');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.style.display = 'none';
    submit.setAttribute('disabled', 'true');
    try {
      const res = mode === 'login'
        ? await api.login({ email: email.value, password: password.value })
        : await api.register({ email: email.value, display_name: displayName.value, password: password.value });
      currentUser = res.user;
      if (mode === 'register' && 'verificationSent' in res) {
        alert(res.verificationSent
          ? '確認メールを送りました。メール内のリンクを開いて登録を完了してください。'
          : '登録できました。メール送信設定が完了するまでは、そのまま利用できます。');
      }
      await boot();
    } catch (err) {
      submit.removeAttribute('disabled');
      errBox.textContent = (err as Error).message;
      errBox.style.display = 'block';
    }
  });
  app().replaceChildren(page);
}

async function renderAuthAction(): Promise<boolean> {
  if (location.pathname !== '/auth-action') return false;
  const params = new URLSearchParams(location.search);
  const action = params.get('action');
  const token = params.get('token') ?? '';
  document.body.classList.remove('theme-auth', 'theme-kids', 'theme-adult');
  document.documentElement.style.background = document.body.style.background = '';

  const card = el('section', { class: 'auth-wrap' }, [
    el('div', { class: 'card auth-card' }, [
      el('h2', { textContent: action === 'reset' ? 'パスワードを再設定' : 'メールアドレスを確認' }),
      el('p', { class: 'muted', textContent: '確認しています…' }),
    ]),
  ]);
  app().replaceChildren(card);
  const body = card.querySelector<HTMLElement>('.auth-card')!;

  if (!token || (action !== 'verify' && action !== 'reset')) {
    body.replaceChildren(
      el('h2', { textContent: 'リンクが無効です' }),
      el('p', { class: 'muted', textContent: 'メールに記載されたリンクをもう一度開いてください。' }),
      el('a', { href: '/', class: 'primary auth-action-link', textContent: 'ログイン画面へ' }),
    );
    return true;
  }

  if (action === 'verify') {
    try {
      await api.verifyEmail(token);
      body.replaceChildren(
        el('h2', { textContent: '✓ メールアドレスを確認しました' }),
        el('p', { class: 'muted', textContent: 'マネコを安心してご利用いただけます。' }),
        el('a', { href: '/', class: 'primary auth-action-link', textContent: 'アプリを開く' }),
      );
    } catch (error) {
      body.replaceChildren(
        el('h2', { textContent: '確認できませんでした' }),
        el('p', { class: 'status err', textContent: (error as Error).message }),
        el('a', { href: '/', class: 'primary auth-action-link', textContent: 'アプリへ戻る' }),
      );
    }
    return true;
  }

  const password = el('input', { type: 'password', autocomplete: 'new-password', placeholder: '8文字以上' });
  const confirmPassword = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'もう一度入力' });
  const errorBox = el('p', { class: 'status err', style: 'display:none' as any });
  const submit = el('button', { type: 'submit', class: 'primary', textContent: '新しいパスワードを保存' });
  const form = el('form', {}, [
    el('h2', { textContent: 'パスワードを再設定' }),
    labeled('新しいパスワード', password),
    labeled('確認用パスワード', confirmPassword),
    errorBox,
    submit,
  ]);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.style.display = 'none';
    if (password.value.length < 8 || password.value !== confirmPassword.value) {
      errorBox.textContent = password.value.length < 8 ? '8文字以上で入力してください' : 'パスワードが一致しません';
      errorBox.style.display = 'block';
      return;
    }
    submit.setAttribute('disabled', 'true');
    try {
      const result = await api.resetPassword(token, password.value);
      currentUser = result.user;
      body.replaceChildren(
        el('h2', { textContent: '✓ パスワードを変更しました' }),
        el('p', { class: 'muted', textContent: '同じアカウントにログインしました。データはそのまま引き継がれます。' }),
        el('a', { href: '/', class: 'primary auth-action-link', textContent: 'マネコタウンを開く' }),
      );
    } catch (error) {
      submit.removeAttribute('disabled');
      errorBox.textContent = (error as Error).message;
      errorBox.style.display = 'block';
    }
  });
  body.replaceChildren(form);
  return true;
}

async function boot() {
  if (await renderAuthAction()) return;
  // 旅マップを開いたままリロードした残留エントリを消費（戻る1回が無反応になるのを防ぐ）
  if ((history.state as any)?.jr) history.back();
  const me = await api.me().catch(() => null);
  if (!me) { currentUser = null; renderAuth(); return; }
  currentUser = me.user;
  myGroups = me.groups;
  if (hasNativeIap()) {
    void getNativeIapState(currentUser.id)
      .then((state) => state.configured ? api.syncIap() : null)
      .then((synced) => { if (synced) overviewCache = null; })
      .catch(() => { /* オフラインや未設定でも通常利用は継続する */ });
  }
  const inviteToken = inviteTokenFromLocation();
  if (inviteToken) {
    try {
      const joined = await api.joinInvite(inviteToken);
      myGroups = await api.listGroups();
      activeGroupId = joined.id;
      history.replaceState({}, '', '/');
      enqueueAppToast(`🏠「${joined.name}」に参加しました`);
    } catch (e) {
      alert((e as Error).message);
      history.replaceState({}, '', '/');
    }
  }
  route();
}

window.addEventListener('hashchange', () => { if (currentUser) route(); });
boot();
