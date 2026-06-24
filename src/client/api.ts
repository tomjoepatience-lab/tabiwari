// サーバー API を叩く薄いラッパー

export type ProjectKind = 'trip' | 'daily';
export type Trip = { id: number; title: string; kind: ProjectKind; group_id?: number; group_name?: string; start_date: string | null; end_date: string | null; monthly_budget?: number | null; total?: number };
export type User = { id: number; username: string };
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
  register: (body: { username: string; password: string }) =>
    fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<{ user: User }>(r)),
  login: (body: { username: string; password: string }) =>
    fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<{ user: User }>(r)),
  logout: () => fetch('/api/auth/logout', { method: 'POST' }),
  listGroups: () => fetch('/api/groups').then((r) => json<Group[]>(r)),
  createGroup: (name: string) =>
    fetch('/api/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }).then((r) => json<Group>(r)),
  joinGroup: (invite_code: string) =>
    fetch('/api/groups/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invite_code }) }).then((r) => json<Group>(r)),

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
  photoUrl: (receiptId: number) => `/api/receipts/${receiptId}/photo`,
  config: () => fetch('/api/config').then((r) => json<{ mapsKey: string }>(r)),
  // 思い出写真
  addTripPhoto: (tripId: number, body: { photo: string; caption?: string; taken_on?: string; receipt_id?: number | null }) =>
    fetch(`/api/trips/${tripId}/photos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<TripPhoto>(r)),
  deleteTripPhoto: (id: number) => fetch(`/api/trip-photos/${id}`, { method: 'DELETE' }),
  tripPhotoUrl: (id: number) => `/api/trip-photos/${id}/photo`,
};
