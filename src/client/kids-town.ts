import { Overview, QuickReward, RecentReceipt } from './api';
import { phoneCanvas, esc } from './phone';
import { Insight } from './advice';
import { ReactionKind } from './character';
import { featuredGoal, currentStage, journeyPercent, STAGES } from './journey';
import { openJourney } from './journey-town';

export type KidsTab = 'home' | 'report' | 'add' | 'savings' | 'menu';

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

const navIcon = (tab: KidsTab) => {
  if (tab === 'home') return '🏘️';
  if (tab === 'add') return '✏️';
  if (tab === 'savings') return '🌱';
  return '👪';
};

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
        <span class="kids-nav-v3-icon" aria-hidden="true">${tab === 'menu' && !family ? '⚙️' : navIcon(tab)}</span>
        <span>${label}</span>
      </button>`).join('')}
  </nav>`;
}

export function wireNav(canvas: HTMLElement, goTab: (tab: KidsTab) => void) {
  canvas.querySelectorAll<HTMLElement>('[data-nav]').forEach((node) => {
    node.addEventListener('click', () => goTab(node.dataset.nav as KidsTab));
  });
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
    ? `${esc(goal.emoji ?? '⭐')} ${esc(goal.name)}`
    : '最初の目標を作ろう';
  const goalAmounts = goal
    ? `${goal.saved.toLocaleString('ja-JP')}円 / ${goal.target.toLocaleString('ja-JP')}円`
    : '貯金タブから始められます';
  const isFamily = settings.usage_type !== 'personal';
  const moving = percent > previousPercent;
  const html = `
    <main class="kids-home-v3 stage-${stage}" style="--walk-from-y:${walkFromY}px;--walk-to-y:${walkToY}px;--walk-from-scale:${walkFromScale};--walk-to-scale:${walkToScale}">
      <div class="kids-home-v3-bg" style="background-image:url('/assets/kids/stage-${stage}.webp')" aria-hidden="true"></div>
      <div class="kids-home-v3-shade" aria-hidden="true"></div>

      <header class="kids-home-v3-header">
        <button type="button" id="k-wallet" class="kids-wallet-chip" aria-label="現在の残高。貯金画面を開く">
          <span>お財布</span><strong>${overview.wallet.toLocaleString('ja-JP')}円</strong>
        </button>
        <button type="button" id="k-journey" class="kids-map-chip">
          <span aria-hidden="true">🗺️</span><span>世界を見る</span>
        </button>
      </header>

      <button type="button" id="k-goal" class="kids-goal-strip">
        <span class="kids-goal-strip-top">
          <strong>${goalLabel}</strong><b>${percent}%</b>
        </span>
        <span class="kids-goal-track"><i style="width:${percent}%"></i></span>
        <span class="kids-goal-meta">${goalAmounts}</span>
      </button>

      <button type="button" id="k-town" class="kids-town-open" aria-label="マネコの旅を見る"></button>

      <div id="k-cat" class="kids-maneko-v3${moving ? ' is-moving' : ''}" aria-label="マネコ">
        <span class="kids-maneko-v3-shadow"></span>
        <img id="m-cat-body" src="/assets/kids/maneko-stage-${stage}.webp" alt="マネコ">
      </div>

      <div id="k-bubble" class="kids-bubble-v3" aria-live="polite">
        <span id="k-bubble-text"></span>
      </div>

      <div class="kids-place-label">
        <span>STAGE ${stage + 1}</span>
        <strong>${esc(STAGES[stage].name)}</strong>
      </div>

      <button type="button" id="k-record" class="kids-record-fab">
        <span aria-hidden="true">＋</span> 支出を記録
      </button>
      <div id="k-toast" class="kids-toast-v3" aria-live="polite"></div>
      ${kidsNavHtml('home', isFamily)}
    </main>`;

  const { wrap, canvas } = phoneCanvas(html, { bg: '#d8ebf1' });
  wireNav(canvas, args.goTab);

  const openMap = () => openJourney(overview, goal?.id);
  canvas.querySelector('#k-town')?.addEventListener('click', openMap);
  canvas.querySelector('#k-journey')?.addEventListener('click', openMap);
  canvas.querySelector('#k-goal')?.addEventListener('click', () => args.goTab('savings'));
  canvas.querySelector('#k-wallet')?.addEventListener('click', () => args.goTab('savings'));
  canvas.querySelector('#k-record')?.addEventListener('click', () => args.goTab('add'));

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
