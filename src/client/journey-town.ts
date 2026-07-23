import { Overview, SavingsGoal } from './api';
import { esc } from './phone';
import { currentStage, featuredGoal, journeyPercent, stageAt, STAGES } from './journey';

function orderedGoals(overview: Overview): SavingsGoal[] {
  const byId = [...overview.goals].sort((a, b) => a.id - b.id);
  return [...byId.filter((goal) => !goal.done), ...byId.filter((goal) => goal.done)];
}

const points = [
  { x: 34, y: 82 },
  { x: 43, y: 68 },
  { x: 33, y: 54 },
  { x: 44, y: 40 },
  { x: 35, y: 26 },
];

function goalIcon(emoji?: string | null): string {
  const key =
    emoji === '🎮' ? 'game' :
    emoji === '📱' ? 'phone' :
    emoji === '👟' ? 'shoes' :
    emoji === '✈️' || emoji === '🧳' ? 'travel' :
    'bike';
  return `/assets/kids/goal-${key}.webp`;
}

function markerPoint(percent: number): { x: number; y: number } {
  const segment = Math.min(3, Math.floor(percent / 25));
  const progress = percent >= 100 ? 1 : (percent - segment * 25) / 25;
  const from = points[segment];
  const to = points[segment + 1];
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
  };
}

export function journeyView(overview: Overview, goalId?: number): HTMLElement {
  const goals = orderedGoals(overview);
  let selected = goals.find((goal) => goal.id === goalId) ?? featuredGoal(overview);
  const overlay = document.createElement('div');
  overlay.className = 'jr-overlay journey-v3-overlay';
  let closed = false;

  const finish = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener('popstate', finish);
    overlay.classList.add('jr-out');
    window.setTimeout(() => overlay.remove(), 260);
  };
  history.pushState({ journey: true }, '');
  window.addEventListener('popstate', finish);

  const changeGoal = (direction: number) => {
    if (!selected || goals.length < 2) return;
    const index = goals.findIndex((goal) => goal.id === selected!.id);
    selected = goals[(index + direction + goals.length) % goals.length];
    render();
  };

  const render = () => {
    const target = Math.max(1, selected?.target ?? 10000);
    const saved = Math.max(0, selected?.saved ?? 0);
    const percent = journeyPercent(saved, target);
    const stage = currentStage(saved, target);
    const nextStage = Math.min(4, stage + 1);
    const remaining = Math.max(0, stageAt(nextStage, target) - saved);
    const point = markerPoint(percent);
    const goalName = selected
      ? esc(selected.name)
      : '最初の目標';

    overlay.innerHTML = `
      <div class="journey-v3-canvas">
        <div class="journey-v3-mist" style="--reveal:${Math.max(10, percent)}%"></div>
        <header class="journey-v3-header">
          <button type="button" class="journey-v3-back" aria-label="閉じる">←</button>
          <div>
            <span>マネコの旅</span>
            <strong>${percent}%</strong>
          </div>
        </header>

        <div class="journey-v3-goal">
          ${goals.length > 1 ? '<button type="button" data-step="-1" aria-label="前の目標">‹</button>' : ''}
          <img src="${goalIcon(selected?.emoji)}" alt="">
          <span><strong>${goalName}</strong><small>${saved.toLocaleString('ja-JP')}円 / ${target.toLocaleString('ja-JP')}円</small></span>
          ${goals.length > 1 ? '<button type="button" data-step="1" aria-label="次の目標">›</button>' : ''}
        </div>

        ${STAGES.map((item, index) => `
          <div class="journey-v3-stage ${index < stage ? 'done' : index === stage ? 'current' : 'future'}"
               style="left:63%;top:${points[index].y}%">
            <span>${index < stage ? '✓' : index + 1}</span>
            <strong>${esc(item.name)}</strong>
            <img src="/assets/kids/maneko-stage-${index}.webp" alt="">
          </div>`).join('')}

        <div class="journey-v3-marker" style="left:${point.x}%;top:${point.y}%">
          <span>いまここ</span>
          <img src="/assets/kids/maneko-walking.webp" alt="現在地のマネコ">
        </div>

        <footer class="journey-v3-footer">
          <div><strong>${esc(STAGES[stage].name)}</strong><span>${percent}%</span></div>
          <i><b style="width:${percent}%"></b></i>
          <p>${percent >= 100 ? '目標達成！夢の街に到着しました。' : `次の「${esc(STAGES[nextStage].name)}」まで あと ${remaining.toLocaleString('ja-JP')}円`}</p>
        </footer>
      </div>`;

    overlay.querySelector('.journey-v3-back')?.addEventListener('click', () => history.back());
    overlay.querySelectorAll<HTMLElement>('[data-step]').forEach((button) => {
      button.addEventListener('click', () => changeGoal(Number(button.dataset.step)));
    });
  };

  render();
  requestAnimationFrame(() => overlay.classList.add('jr-in'));
  return overlay;
}

export function openJourney(overview: Overview, goalId?: number) {
  if (document.querySelector('.jr-overlay')) return;
  document.body.append(journeyView(overview, goalId));
}
