// サーバー API を叩く薄いラッパー

export type ProjectKind = 'trip' | 'daily';
export type Trip = { id: number; title: string; kind: ProjectKind; group_id?: number; group_name?: string; start_date: string | null; end_date: string | null; monthly_budget?: number | null; total?: number };
export type User = { id: number; username: string; email?: string | null; email_verified?: boolean };
export type Group = { id: number; name: string; invite_code: string; role: string; members?: number };
export type Me = { user: User; groups: Group[] };
export type Member = { id: number; name: string; weight: number };
export type ItemShare = { member_id: number; weight: number | null };
export type Item = { id: number; name: string; price: number; quantity: number; member_ids: number[]; shares: ItemShare[] };
export type RecurringExpense = { id: number; name: string; amount: number; category: string | null; paid_by: number | null; active: boolean };
export type Receipt = {
  id: number;
  store_name: string | null;
  category: string | null;
  purchased_on: string;
  paid_by: number | null;
  lat: number | null;
  lng: number | null;
  place_name: string | null;
  has_photo: boolean;
  total: number;
  items: Item[];
};
export type Analytics = {
  byCategory: { category: string; total: number }[];
  byTrip: { title: string; total: number }[];
};
export type TripPhoto = { id: number; receipt_id: number | null; caption: string | null; taken_on: string | null; sort_order: number };
export type AppMode = 'kids' | 'adult';
export type UsageType = 'family' | 'personal';
export type UserSettings = {
  mode: AppMode;
  monthly_income: number | null;
  monthly_budget: number | null;
  allowance: number | null;
  balance_start: number;
  coins: number;
  xp: number;
  level: number;
  costume: string | null;
  costumes: { owned: string[]; equipped: string[] }; // v2 衣装（重ね小物6種）の所持/装備
  last_summary_shown: string | null; // 月初サマリーを表示済みの月（YYYY-MM）
  usage_type: UsageType | null; // 利用タイプ（家族/個人）。NULL=未選択（初回に選ばせる）
  tutorial_done: boolean;       // 初回チュートリアルの既読
  active_group_id: number | null; // 現在表示中の家計簿スペース
};
export type Rarity = 'normal' | 'rare' | 'super';
export type PresentResult = { costume: string; name: string; rarity: Rarity; coins: number };
export type SavingsGoal = { id: number; name: string; emoji: string | null; target: number; saved: number; done: boolean; deadline: string | null };
export type IncomeSummary = { id: number; amount: number; name: string; on_date: string };
export type IncomeRow = { id: number; name: string; amount: number; on_date: string };
export type AppEvents = { latestIncome: { id: number; name: string; amount: number } | null };
export type Overview = {
  settings: UserSettings | null;
  month: { spend: number; income: number; byCategory: { category: string; total: number }[] };
  wallet: number;
  goals: SavingsGoal[];
  todayRecorded: boolean;
  challengeDone: boolean;
  recordsCount: number;
  latestIncome: IncomeSummary | null; // 親からのおこづかい着信トースト用
  linkedAsChild: boolean;             // 子として連携中か（おとな切替ボタン非表示用）
  chorePoints: number;                // お手伝いポイント残高
  pendingChoreCount: number;          // 親として承認待ちの申請数（せってい バッジ用）
};
// お手伝いポイント
export type ChoreMenuItem = { id: number; name: string; points: number; pending: boolean };
export type ChoreHistory = { id: number; name: string; points: number; status: 'pending' | 'approved' | 'rejected'; created_at: string };
export type MyChores = { points: number; chores: ChoreMenuItem[]; history: ChoreHistory[] };
export type ChildChoreMenu = { id: number; name: string; points: number; active: boolean };
export type ChildChorePending = { id: number; chore_name: string; points: number; created_at: string };
export type ChildChores = { points: number; menu: ChildChoreMenu[]; pending: ChildChorePending[] };
// 親子アカウント連携
export type LinkCode = { code: string; expires_at: string };
export type ChildLink = { id: number; child_user_id: number; username: string; created_at: string };
export type ParentLink = { id: number; username: string };
export type Links = { asParent: ChildLink[]; asChild: ParentLink | null };
export type JoinResult = { id: number; parent: { username: string } };
export type ChildOverview = {
  username: string;
  wallet: number;
  month: { spend: number; income: number };
  goals: SavingsGoal[];
  recent: { store_name: string | null; total: number; purchased_on: string; first_item: string | null }[];
};
export type QuickReward = { xp: number; coins: number; level: number; levelUp: boolean; challengeCleared: boolean } | null;
export type RecentItem = { id: number; name: string; price: number; quantity: number; genre: string | null };
export type RecentReceipt = {
  id: number;
  trip_id: number;
  trip_title: string;
  kind: ProjectKind;
  store_name: string | null;
  category: string | null;
  purchased_on: string;
  created_at: string;
  lat: number | null;
  lng: number | null;
  place_name: string | null;
  total: number;
  items: RecentItem[];
  photo_ids: number[];
};
export type PerMember = { memberId: number; name: string; paid: number; owed: number; net: number };
export type Transfer = { from: number; to: number; amount: number };
export type TripDetail = {
  trip: Trip;
  members: Member[];
  receipts: Receipt[];
  photos: TripPhoto[];
  summary: { total: number; perMember: PerMember[]; settlement: Transfer[] };
};

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // 認証・グループ
  me: async (): Promise<Me | null> => {
    const r = await fetch('/api/auth/me');
    if (r.status === 401) return null;
    return json<Me>(r);
  },
  register: (body: { email: string; display_name: string; password: string }) =>
    fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<{ user: User; verificationSent: boolean }>(r)),
  login: (body: { email: string; password: string }) =>
    fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<{ user: User }>(r)),
  requestPasswordReset: (email: string) =>
    fetch('/api/auth/request-password-reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }).then((r) => json<{ ok: true }>(r)),
  verifyEmail: (token: string) =>
    fetch('/api/auth/verify-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) }).then((r) => json<{ ok: true }>(r)),
  resetPassword: (token: string, password: string) =>
    fetch('/api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) }).then((r) => json<{ ok: true }>(r)),
  resendVerification: () =>
    fetch('/api/auth/resend-verification', { method: 'POST' }).then((r) => json<{ ok: true; alreadyVerified?: boolean }>(r)),
  updateProfile: (display_name: string) =>
    fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name }),
    }).then((r) => json<User>(r)),
  logout: () => fetch('/api/auth/logout', { method: 'POST' }),
  deleteAccount: (password: string) =>
    fetch('/api/auth/account', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    }).then(async (r) => {
      if (!r.ok) await json(r);
    }),
  listGroups: () => fetch('/api/groups').then((r) => json<Group[]>(r)),
  createGroup: (name: string) =>
    fetch('/api/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }).then((r) => json<Group>(r)),
  joinGroup: (invite_code: string) =>
    fetch('/api/groups/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invite_code }) }).then((r) => json<Group>(r)),
  createGroupInvite: (groupId: number) =>
    fetch(`/api/groups/${groupId}/invites`, { method: 'POST' }).then((r) => json<{ token: string; url: string; expires_at: string }>(r)),
  joinInvite: (token: string) =>
    fetch(`/api/invites/${encodeURIComponent(token)}/join`, { method: 'POST' }).then((r) => json<{ id: number; name: string }>(r)),
  inviteInfo: (token: string) =>
    fetch(`/api/auth/invites/${encodeURIComponent(token)}`).then((r) => json<{ name: string; expires_at: string }>(r)),

  listTrips: () => fetch('/api/trips').then((r) => json<Trip[]>(r)),
  getTrip: (id: number) => fetch(`/api/trips/${id}`).then((r) => json<TripDetail>(r)),
  createTrip: (body: { title: string; kind?: ProjectKind; group_id: number; start_date?: string; end_date?: string }) =>
    fetch('/api/trips', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<Trip>(r)),
  addMember: (tripId: number, name: string, weight?: number) =>
    fetch(`/api/trips/${tripId}/members`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, weight }) }).then((r) => json<Member>(r)),
  updateMember: (id: number, body: { name?: string; weight?: number }) =>
    fetch(`/api/members/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<Member>(r)),
  deleteMember: (id: number) => fetch(`/api/members/${id}`, { method: 'DELETE' }),
  addReceipt: (tripId: number, body: unknown) =>
    fetch(`/api/trips/${tripId}/receipts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<{ id: number }>(r)),
  updateReceipt: (id: number, body: unknown) =>
    fetch(`/api/receipts/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<{ id: number }>(r)),
  deleteReceipt: (id: number) => fetch(`/api/receipts/${id}`, { method: 'DELETE' }),
  // 月次予算・繰り返し支出
  setBudget: (tripId: number, monthly_budget: number | null) =>
    fetch(`/api/trips/${tripId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ monthly_budget }) }).then((r) => json<{ id: number; monthly_budget: number | null }>(r)),
  listRecurring: (tripId: number) => fetch(`/api/trips/${tripId}/recurring`).then((r) => json<RecurringExpense[]>(r)),
  addRecurring: (tripId: number, body: { name: string; amount: number; category?: string; paid_by?: number | null }) =>
    fetch(`/api/trips/${tripId}/recurring`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<RecurringExpense>(r)),
  deleteRecurring: (id: number) => fetch(`/api/recurring/${id}`, { method: 'DELETE' }),
  generateRecurring: (tripId: number, month?: string) =>
    fetch(`/api/trips/${tripId}/recurring/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month }) }).then((r) => json<{ created: number; skipped: number; month: string }>(r)),
  analytics: () => fetch('/api/analytics').then((r) => json<Analytics>(r)),
  recentExpenses: (days = 30, groupId?: number) =>
    fetch(`/api/expenses/recent?days=${days}${groupId ? `&group_id=${groupId}` : ''}`).then((r) => json<{ receipts: RecentReceipt[] }>(r)),
  quickExpense: (body: {
    store_name?: string; category?: string; purchased_on: string;
    items: { name: string; price: number; genre?: string }[];
    lat?: number | null; lng?: number | null; place_name?: string | null;
    photos?: string[]; group_id?: number; group_ids?: number[];
  }) =>
    fetch('/api/expenses/quick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<{
      receipt_id: number;
      trip_id: number;
      receipts: { receipt_id: number; trip_id: number; group_id: number }[];
      reward: QuickReward;
    }>(r)),
  setItemGenre: (id: number, genre: string) =>
    fetch(`/api/items/${id}/genre`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ genre }) }).then((r) => json<{ id: number; genre: string }>(r)),
  // モード・ゲーミフィケーション
  overview: (groupId?: number) => fetch(`/api/overview${groupId ? `?group_id=${groupId}` : ''}`).then((r) => json<Overview>(r)),
  saveSettings: (body: Partial<{ mode: AppMode; monthly_income: number | null; monthly_budget: number | null; allowance: number | null; balance_start: number; costume: string | null; last_summary_shown: string; usage_type: UsageType; tutorial_done: boolean; active_group_id: number }>) =>
    fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<UserSettings>(r)),
  addGoal: (body: { name: string; emoji?: string; target: number; deadline?: string }) =>
    fetch('/api/goals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<SavingsGoal>(r)),
  deleteGoal: (id: number) => fetch(`/api/goals/${id}`, { method: 'DELETE' }),
  depositGoal: (id: number, amount: number) =>
    fetch(`/api/goals/${id}/deposit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount }) })
      .then((r) => json<{ goal: SavingsGoal; reward: { xp: number; coins: number; done: boolean; level: number } }>(r)),
  openPresent: () =>
    fetch('/api/present', { method: 'POST' }).then((r) => json<PresentResult>(r)),
  setCostume: (id: string, on: boolean) =>
    fetch('/api/costumes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, on }) }).then((r) => json<{ owned: string[]; equipped: string[] }>(r)),
  addIncome: (body: { name?: string; amount: number; on_date?: string }) =>
    fetch('/api/incomes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<{ id: number; name: string; amount: number; on_date: string }>(r)),
  listIncomes: () => fetch('/api/incomes').then((r) => json<{ incomes: IncomeRow[] }>(r)),
  events: () => fetch('/api/events').then((r) => json<AppEvents>(r)),
  // 親子アカウント連携
  createLinkCode: () => fetch('/api/links/code', { method: 'POST' }).then((r) => json<LinkCode>(r)),
  joinLink: (code: string) =>
    fetch('/api/links/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) }).then((r) => json<JoinResult>(r)),
  getLinks: () => fetch('/api/links').then((r) => json<Links>(r)),
  deleteLink: (id: number) => fetch(`/api/links/${id}`, { method: 'DELETE' }),
  childOverview: (childId: number) => fetch(`/api/children/${childId}/overview`).then((r) => json<ChildOverview>(r)),
  sendAllowance: (childId: number, amount: number, name?: string) =>
    fetch(`/api/children/${childId}/allowance`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount, name }) }).then((r) => json<{ id: number; amount: number; name: string }>(r)),
  // お手伝いポイント
  addChore: (childId: number, body: { name: string; points: number }) =>
    fetch(`/api/children/${childId}/chores`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<{ id: number; name: string; points: number }>(r)),
  deleteChore: (id: number) => fetch(`/api/chores/${id}`, { method: 'DELETE' }),
  myChores: () => fetch('/api/chores').then((r) => json<MyChores>(r)),
  claimChore: (id: number) => fetch(`/api/chores/${id}/claim`, { method: 'POST' }).then((r) => json<{ id: number }>(r)),
  childChores: (childId: number) => fetch(`/api/children/${childId}/chores`).then((r) => json<ChildChores>(r)),
  decideChore: (logId: number, approve: boolean) =>
    fetch(`/api/chore-logs/${logId}/${approve ? 'approve' : 'reject'}`, { method: 'POST' }).then((r) => json<{ status: 'approved' | 'rejected' }>(r)),
  exchangePoints: (to: 'yen' | 'coin') =>
    fetch('/api/chores/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to }) }).then((r) => json<{ yen: number } | { coins: number; restPoints: number }>(r)),
  photoUrl: (receiptId: number) => `/api/receipts/${receiptId}/photo`,
  config: () => fetch('/api/config').then((r) => json<{ mapsKey: string }>(r)),
  // 思い出写真
  addTripPhoto: (tripId: number, body: { photo: string; caption?: string; taken_on?: string; receipt_id?: number | null }) =>
    fetch(`/api/trips/${tripId}/photos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<TripPhoto>(r)),
  deleteTripPhoto: (id: number) => fetch(`/api/trip-photos/${id}`, { method: 'DELETE' }),
  tripPhotoUrl: (id: number) => `/api/trip-photos/${id}/photo`,
};
