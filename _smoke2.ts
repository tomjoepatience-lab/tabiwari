import 'dotenv/config';
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const B = 'http://localhost:3998';
let cookie = '';
async function call(method: string, path: string, body?: any) {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const t = await r.text(); try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; }
}
(async () => {
  try {
    await pool.query("DELETE FROM trips WHERE title='__smoke_daily'"); // 前回残骸も掃除
    await call('POST', '/api/auth/login', { username: 'demo', password: 'demo1234' });
    const gid = (await call('GET', '/api/auth/me')).body.groups[0].id;
    const tid = (await call('POST', '/api/trips', { title: '__smoke_daily', kind: 'daily', group_id: gid })).body.id;
    const m1 = (await call('POST', `/api/trips/${tid}/members`, { name: 'A', weight: 1 })).body.id;
    const m2 = (await call('POST', `/api/trips/${tid}/members`, { name: 'B', weight: 1 })).body.id;
    // 家賃100000 既定(1:1=50/50), 食費1000 override 7:3
    const rid = (await call('POST', `/api/trips/${tid}/receipts`, { purchased_on: '2026-06-10', paid_by: m1, store_name: 'rent', category: '宿泊', items: [{ name: 'rent', price: 100000, shares: [{ member_id: m1, weight: null }, { member_id: m2, weight: null }] }] })).body.id;
    await call('POST', `/api/trips/${tid}/receipts`, { purchased_on: '2026-06-11', paid_by: m1, store_name: 'food', category: '食費', items: [{ name: 'food', price: 1000, shares: [{ member_id: m1, weight: 7 }, { member_id: m2, weight: 3 }] }] });
    let d = (await call('GET', `/api/trips/${tid}`)).body;
    console.log('owed:', d.summary.perMember.map((p: any) => [p.name, p.owed]), '期待 A=50700 B=50300');
    console.log('settlement:', d.summary.settlement.map((t: any) => [t.amount]), '期待 50300');
    console.log('food shares:', JSON.stringify(d.receipts.find((r: any) => r.store_name === 'food').items[0].shares));
    // edit: 家賃を 6:4 に
    await call('PUT', `/api/receipts/${rid}`, { purchased_on: '2026-06-10', paid_by: m1, store_name: 'rent', category: '宿泊', items: [{ name: 'rent', price: 100000, shares: [{ member_id: m1, weight: 6 }, { member_id: m2, weight: 4 }] }] });
    d = (await call('GET', `/api/trips/${tid}`)).body;
    console.log('edit後 owed:', d.summary.perMember.map((p: any) => [p.name, p.owed]), '期待 A=60700 B=40300');
    // budget
    console.log('budget:', (await call('PUT', `/api/trips/${tid}`, { monthly_budget: 150000 })).body);
    // recurring add + generate
    await call('POST', `/api/trips/${tid}/recurring`, { name: 'subsc', amount: 1500, category: 'その他', paid_by: m2 });
    console.log('generate:', (await call('POST', `/api/trips/${tid}/recurring/generate`, { month: '2026-06' })).body);
    console.log('generate再実行(重複skip):', (await call('POST', `/api/trips/${tid}/recurring/generate`, { month: '2026-06' })).body);
    await pool.query("DELETE FROM trips WHERE title='__smoke_daily'");
    console.log('cleanup 完了');
  } catch (e) { console.log('NG', (e as Error).message); }
  finally { await pool.end(); }
})();
