import { Overview, SavingsGoal } from './api';
import { esc } from './phone';
import { currentStage, featuredGoal, journeyPercent, stageAt, STAGES } from './journey';

function orderedGoals(overview: Overview): SavingsGoal[] {
  const byId = [...overview.goals].sort((a, b) => a.id - b.id);
  return [...byId.filter((goal) => !goal.done), ...byId.filter((goal) => goal.done)];
}

const stageY = [82, 68, 54, 40, 26];
// ルート右端に近い第3地点だけカードを左へ逃がし、マネコと重ならないようにする。
const stageX = [66, 66, 4, 66, 66];

// journey-3d.webp の石畳の中心線。5地点を直線で結ぶとカーブを横切るため、
// 道の曲がりごとに通過点を置き、足元が常に石畳の上を進むようにする。
const routePoints = [
  { x: 57, y: 82 },
  { x: 58, y: 78 },
  { x: 56, y: 74 },
  { x: 57, y: 70 },
  { x: 60, y: 66 },
  { x: 61, y: 62 },
  { x: 60, y: 58 },
  { x: 63, y: 54 },
  { x: 61, y: 50 },
  { x: 57, y: 46 },
  { x: 53, y: 42 },
  { x: 49, y: 38 },
  { x: 46, y: 34 },
  { x: 49, y: 30 },
  { x: 50, y: 26 },
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
  const bounded = Math.max(0, Math.min(100, percent));
  const distances = routePoints.slice(1).map((point, index) => {
    const previous = routePoints[index];
    return Math.hypot(point.x - previous.x, point.y - previous.y);
  });
  const totalDistance = distances.reduce((sum, distance) => sum + distance, 0);
  let remaining = totalDistance * (bounded / 100);
  let segment = 0;
  while (segment < distances.length - 1 && remaining > distances[segment]) {
    remaining -= distances[segment];
    segment += 1;
  }
  const from = routePoints[segment];
  const to = routePoints[segment + 1] ?? from;
  const progress = distances[segment] ? remaining / distances[segment] : 0;
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
               style="left:${stageX[index]}%;top:${stageY[index]}%">
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
    const canvas = overlay.querySelector<HTMLElement>('.journey-v3-canvas');
    canvas?.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      // 戻る・目標切替・進捗カードそのものを操作したときは表示状態を変えない。
      if (target.closest('.journey-v3-header button,.journey-v3-goal,.journey-v3-footer')) return;
      const hidden = canvas.classList.toggle('journey-v3-ui-hidden');
      canvas.setAttribute('aria-label', hidden
        ? '背景をタップすると目標と進捗を表示します'
        : '背景をタップすると目標と進捗を隠します');
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
