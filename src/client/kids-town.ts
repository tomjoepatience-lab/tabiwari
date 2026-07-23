import { Overview, QuickReward, RecentReceipt } from './api';
import { phoneCanvas, esc } from './phone';
import { Insight } from './advice';
import { ReactionKind } from './character';
import { featuredGoal, currentStage, journeyPercent, STAGES } from './journey';
import { openJourney } from './journey-town';

export type KidsTab = 'home' | 'report' | 'add' | 'savings' | 'menu';

export function goalIconPath(emoji?: string | null): string {
  const key =
    emoji === '🎮' ? 'game' :
    emoji === '📱' ? 'phone' :
    emoji === '👟' ? 'shoes' :
    emoji === '✈️' || emoji === '🧳' ? 'travel' :
    'bike';
  return `/assets/kids/goal-${key}.webp`;
}

export interface KidsHomeArgs {
  overview: Overview;
  recent: RecentReceipt[];
  insight: Insight;
  celebrate: { kind: ReactionKind; name: string; reward?: QuickReward } | null;
  goTab(tab: KidsTab): void;
  onDeposit(goalId: number, amount: number): void;
  onCreateGoal(body: { name: string; emoji: string; target: number; deadline?: string }): void;
}

let speechTimer: number | undefined;
let hideTimer: number | undefined;

export function stopKidsSpeech() {
  if (speechTimer) window.clearInterval(speechTimer);
  if (hideTimer) window.clearTimeout(hideTimer);
  speechTimer = undefined;
  hideTimer = undefined;
}

export function kidsNavHtml(active: KidsTab, family = true): string {
  const items: Array<[KidsTab, string]> = [
    ['home', '街'],
    ['add', '記録'],
    ['savings', '貯金'],
    ['menu', family ? '家族' : '設定'],
  ];
  return `<nav class="kids-nav-v3" aria-label="メインメニュー">
    ${items.map(([tab, label]) => `
      <button type="button" data-nav="${tab}" class="kids-nav-v3-item${active === tab ? ' active' : ''}">
        <img class="kids-nav-v3-icon" src="/assets/kids/nav-${tab === 'home' ? 'town' : tab === 'add' ? 'record' : tab === 'savings' ? 'savings' : family ? 'family' : 'settings'}.webp" alt="" aria-hidden="true">
        <span>${label}</span>
      </button>`).join('')}
  </nav>`;
}

export function wireNav(canvas: HTMLElement, goTab: (tab: KidsTab) => void) {
  canvas.querySelectorAll<HTMLElement>('[data-nav]').forEach((node) => {
    node.addEventListener('click', () => goTab(node.dataset.nav as KidsTab));
  });
}

export type KidsPhotoScene = 'record' | 'report' | 'savings' | 'family' | 'settings';

export function kidsPhotoShell(options: {
  active: KidsTab;
  family: boolean;
  scene: KidsPhotoScene;
  body: HTMLElement[];
  goTab(tab: KidsTab): void;
}): HTMLElement[] {
  const pose: Record<KidsPhotoScene, string> = {
    record: 'receipt',
    report: 'receipt',
    savings: 'walking',
    family: 'family',
    settings: 'settings',
  };
  const html = `
    <main class="kids-photo-page kids-photo-${options.scene}">
      <div class="kids-photo-scene" aria-hidden="true">
        <div class="kids-photo-scene-bg"></div>
        <div class="kids-photo-scene-shade"></div>
        <img class="kids-photo-scene-maneko" src="/assets/kids/maneko-${pose[options.scene]}.webp" alt="">
      </div>
      <section class="kids-photo-sheet">
        <div class="kids-photo-scroll"></div>
      </section>
      ${kidsNavHtml(options.active, options.family)}
    </main>`;
  const { wrap, canvas, refit } = phoneCanvas(html, { bg: '#f7edd9', fillHeight: true });
  const content = document.createElement('div');
  content.className = 'kids-photo-content-card';
  content.append(...options.body);
  canvas.querySelector<HTMLElement>('.kids-photo-scroll')!.append(content);
  wireNav(canvas, options.goTab);
  // 中身を追加した後に実画面高へ合わせる。これが無いとiPhoneでスクロール領域と
  // 下部ナビが840px基準のまま残り、目標入力やタブ下端が画面外へ落ちる。
  refit();
  requestAnimationFrame(refit);
  return [wrap];
}

function localStageProgress(percent: number, stage: number): number {
  if (stage >= STAGES.length - 1) return 1;
  return Math.max(0, Math.min(1, (percent - stage * 25) / 25));
}

function storedProgress(goalId: number | undefined, current: number): number {
  if (goalId == null) return current;
  const key = `maneko_journey_pct_${goalId}`;
  let previous = current;
  try {
    const value = Number(localStorage.getItem(key));
    if (Number.isFinite(value)) previous = Math.min(current, Math.max(0, value));
    localStorage.setItem(key, String(current));
  } catch {
    // Local storage is only used to animate from the previous visible position.
  }
  return previous;
}

export function kidsHome(args: KidsHomeArgs): HTMLElement[] {
  const overview = args.overview;
  const settings = overview.settings!;
  const goal = featuredGoal(overview);
  const stage = goal ? currentStage(goal.saved, goal.target) : 0;
  const percent = goal ? journeyPercent(goal.saved, goal.target) : 0;
  const previousPercent = storedProgress(goal?.id, percent);
  const stageProgress = localStageProgress(percent, stage);
  const previousStageProgress = localStageProgress(previousPercent, stage);
  const walkFromY = Math.round(126 + previousStageProgress * 88);
  const walkToY = Math.round(126 + stageProgress * 88);
  const walkFromScale = (1 - previousStageProgress * .14).toFixed(3);
  const walkToScale = (1 - stageProgress * .14).toFixed(3);
  const goalLabel = goal
    ? esc(goal.name)
    : '最初の目標を作ろう';
  const goalAmounts = goal
    ? `${goal.saved.toLocaleString('ja-JP')}円 / ${goal.target.toLocaleString('ja-JP')}円`
    : '貯金タブから始められます';
  const budget = settings.monthly_budget;
  const remaining = budget != null ? budget - overview.month.spend : null;
  const month = new Date().getMonth() + 1;
  const monthCardLabel = remaining != null ? '今月あと使える' : `${month}月の支出`;
  const monthCardValue = remaining != null ? remaining : overview.month.spend;
  const monthCardMeta = remaining != null
    ? `支出 ${overview.month.spend.toLocaleString('ja-JP')}円 / 予算 ${budget!.toLocaleString('ja-JP')}円`
    : '';
  const isFamily = settings.usage_type !== 'personal';
  const moving = percent > previousPercent;
  const html = `
    <main class="kids-home-v3 stage-${stage}" style="--walk-from-y:${walkFromY}px;--walk-to-y:${walkToY}px;--walk-from-scale:${walkFromScale};--walk-to-scale:${walkToScale}">
      <div class="kids-home-v3-bg" style="background-image:url('/assets/kids/home-stage-${stage}.webp')" aria-hidden="true"></div>
      <div class="kids-home-v3-shade" aria-hidden="true"></div>

      <header class="kids-home-v3-header">
        <section class="kids-month-chip" aria-label="${monthCardLabel} ${monthCardValue.toLocaleString('ja-JP')}円">
          <span>${monthCardLabel}</span>
          <strong>¥${monthCardValue.toLocaleString('ja-JP')}</strong>
          ${monthCardMeta ? `<small>${monthCardMeta}</small>` : ''}
        </section>
      </header>
      <button type="button" id="k-journey" class="kids-map-chip" aria-label="世界を見る">
        <span aria-hidden="true">🗺️</span>
      </button>

      <button type="button" id="k-goal" class="kids-goal-strip">
        <img class="kids-goal-icon" src="${goalIconPath(goal?.emoji)}" alt="">
        <span class="kids-goal-strip-top">
          <strong>${goalLabel}</strong><b>${percent}%</b>
        </span>
        <span class="kids-goal-track"><i style="width:${percent}%"></i></span>
        <span class="kids-goal-meta">${goalAmounts}</span>
      </button>

      <button type="button" id="k-town" class="kids-town-open" aria-label="風景をタップするとマネコ以外を隠します"></button>

      <div id="k-cat" class="kids-maneko-v3${moving ? ' is-moving' : ''}" aria-label="マネコ">
        <span class="kids-maneko-v3-shadow"></span>
        <img id="m-cat-body" src="/assets/kids/maneko-stage-${stage}.webp" alt="マネコ">
      </div>

      <div id="k-bubble" class="kids-bubble-v3" aria-live="polite">
        <span id="k-bubble-text"></span>
      </div>

      <div id="k-toast" class="kids-toast-v3" aria-live="polite"></div>
      ${kidsNavHtml('home', isFamily)}
    </main>`;

  const { wrap, canvas } = phoneCanvas(html, { bg: '#d8ebf1' });
  wireNav(canvas, args.goTab);

  const openMap = () => openJourney(overview, goal?.id);
  canvas.querySelector('#k-journey')?.addEventListener('click', openMap);
  canvas.querySelector('#k-goal')?.addEventListener('click', () => args.goTab('savings'));
  const town = canvas.querySelector<HTMLElement>('#k-town');
  const homeRoot = canvas.querySelector<HTMLElement>('.kids-home-v3') ?? canvas;
  town?.addEventListener('click', () => {
    const hidden = homeRoot.classList.toggle('kids-home-v3-ui-hidden');
    town.setAttribute('aria-label', hidden
      ? '風景をタップするとカードとメニューを表示します'
      : '風景をタップするとマネコ以外を隠します');
  });

  const bubble = canvas.querySelector<HTMLElement>('#k-bubble');
  const bubbleText = canvas.querySelector<HTMLElement>('#k-bubble-text');
  const cat = canvas.querySelector<HTMLElement>('#k-cat');
  const say = (text: string) => {
    if (!bubble || !bubbleText) return;
    bubbleText.textContent = text;
    bubble.classList.add('show');
    if (hideTimer) window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => bubble.classList.remove('show'), 4200);
  };
  const lines = args.insight.messages.length
    ? args.insight.messages
    : ['今日も一歩ずつ進もう。', '記録すると街の変化が分かりやすいよ。'];
  let line = 0;
  stopKidsSpeech();
  speechTimer = window.setInterval(() => {
    if (!canvas.isConnected) return stopKidsSpeech();
    say(lines[line++ % lines.length]);
  }, 11000);
  window.setTimeout(() => say(lines[0]), args.celebrate ? 3200 : 900);
  cat?.addEventListener('click', () => {
    cat.classList.remove('is-tapped');
    requestAnimationFrame(() => cat.classList.add('is-tapped'));
    say(['今日も一緒に進もう！', '貯金すると街が育つよ。', 'いい調子！'][Math.floor(Math.random() * 3)]);
  });

  if (args.celebrate) {
    const toast = canvas.querySelector<HTMLElement>('#k-toast');
    window.setTimeout(() => {
      if (!toast) return;
      toast.textContent = `「${args.celebrate!.name.slice(0, 12)}」を記録しました`;
      toast.classList.add('show');
      window.setTimeout(() => toast.classList.remove('show'), 4200);
    }, 500);
  }

  return [wrap];
}
