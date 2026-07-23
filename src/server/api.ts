import { Router, Request } from 'express';
import crypto from 'crypto';
import { pool } from './db';
import { summarize, CalcReceipt } from './calc';
import { extractReceipt } from './ocr';
import { userGroupIds } from './auth';
import { classifyItem, isGenre } from '../shared/genre';

export const api = Router();

// クライアント設定（Google Maps キーなど）。requireAuth 配下なのでログイン済みのみ取得可
api.get('/config', (_req, res) => {
  res.json({ mapsKey: process.env.GOOGLE_MAPS_API_KEY || '' });
});

// requireAuth 通過後なので userId は必ずある
const uid = (req: Request) => (req as any).userId as number;
const publicAppUrl = () => (process.env.PUBLIC_APP_URL || 'https://tabiwari-mu.vercel.app').replace(/\/+$/, '');

// 指定されたスペースが本人の所属先ならその1件、未指定なら設定中のスペース、
// それも無ければ最初の所属先を返す。
async function scopedGroupIds(req: Request): Promise<number[]> {
  const userId = uid(req);
  const available = await userGroupIds(userId);
  if (!available.length) return [];
  const requested = Number(req.query.group_id);
  if (Number.isInteger(requested) && available.includes(requested)) return [requested];
  const { rows } = await pool.query(`SELECT active_group_id FROM user_settings WHERE user_id = $1`, [userId]);
  const active = rows[0]?.active_group_id as number | null | undefined;
  return active && available.includes(active) ? [active] : [available[0]];
}

// 500 応答でDBの生エラー（テーブル名・制約名など）を漏らさない。詳細はサーバーログのみ。
function serverError(res: any, e: unknown) {
  console.error(e);
  res.status(500).json({ error: 'サーバーエラーが発生しました' });
}

// サーバーのタイムゾーンに依らず JST の今日（YYYY-MM-DD）
const jstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

// アプリ内に表示する名前を変更する。ログインID・メールアドレスは変更しない。
api.put('/profile', async (req, res) => {
  const displayName = typeof req.body?.display_name === 'string' ? req.body.display_name.trim() : '';
  if (!displayName || displayName.length > 30) {
    return res.status(400).json({ error: '表示名は1〜30文字で入力してください' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE users
          SET display_name = $1
        WHERE id = $2
        RETURNING id, email, display_name AS username,
                  (email_verified_at IS NOT NULL) AS email_verified`,
      [displayName, uid(req)],
    );
    if (!rows[0]) return res.status(404).json({ error: 'ユーザーが見つかりません' });
    res.json(rows[0]);
  } catch (error) {
    serverError(res, error);
  }
});

// ---- アクセス権チェック（所属グループのデータだけ触れる） -------------
async function tripAccessible(userId: number, tripId: number): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM trips t JOIN group_members gm ON gm.group_id = t.group_id
      WHERE t.id = $1 AND gm.user_id = $2`,
    [tripId, userId]
  );
  return rows.length > 0;
}
async function receiptAccessible(userId: number, receiptId: number): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM receipts r JOIN trips t ON t.id = r.trip_id
       JOIN group_members gm ON gm.group_id = t.group_id
      WHERE r.id = $1 AND gm.user_id = $2`,
    [receiptId, userId]
  );
  return rows.length > 0;
}
async function photoAccessible(userId: number, photoId: number): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM trip_photos p JOIN trips t ON t.id = p.trip_id
       JOIN group_members gm ON gm.group_id = t.group_id
      WHERE p.id = $1 AND gm.user_id = $2`,
    [photoId, userId]
  );
  return rows.length > 0;
}
async function memberAccessible(userId: number, memberId: number): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM members mb JOIN trips t ON t.id = mb.trip_id
       JOIN group_members gm ON gm.group_id = t.group_id
      WHERE mb.id = $1 AND gm.user_id = $2`,
    [memberId, userId]
  );
  return rows.length > 0;
}
async function recurringAccessible(userId: number, recId: number): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM recurring_expenses re JOIN trips t ON t.id = re.trip_id
       JOIN group_members gm ON gm.group_id = t.group_id
      WHERE re.id = $1 AND gm.user_id = $2`,
    [recId, userId]
  );
  return rows.length > 0;
}
// weight を 1以上の整数に丸める（不正値は 1）
const normWeight = (w: unknown) => (Number.isInteger(w) && (w as number) > 0 ? (w as number) : 1);

// ---- マネコの衣装（重ね小物6種・排出率はサーバー側の真実） -----------------
type Rarity = 'normal' | 'rare' | 'super';
const COSTUMES: { id: string; name: string; rarity: Rarity; weight: number }[] = [
  { id: 'rib',  name: '🎀 しっぽリボン',       rarity: 'normal', weight: 23 },
  { id: 'star', name: '⭐ ほっぺスター',        rarity: 'normal', weight: 23 },
  { id: 'bal',  name: '🎈 あかいふうせん',      rarity: 'normal', weight: 24 },
  { id: 'bag',  name: '🎒 ちいさなリュック',    rarity: 'rare',   weight: 12.5 },
  { id: 'bfly', name: '🦋 あたまのちょうちょ',  rarity: 'rare',   weight: 12.5 },
  { id: 'aura', name: '✨ きんのオーラ',        rarity: 'super',  weight: 5 },
];
const isCostumeId = (id: unknown): id is string => typeof id === 'string' && COSTUMES.some((c) => c.id === id);

// JSONB costumes を必ず { owned, equipped }（衣装IDのみ）に正規化する
function normCostumes(raw: unknown): { owned: string[]; equipped: string[] } {
  const c = (raw ?? {}) as { owned?: unknown; equipped?: unknown };
  const owned = Array.isArray(c.owned) ? c.owned.filter(isCostumeId) : [];
  const equipped = Array.isArray(c.equipped) ? c.equipped.filter((e) => isCostumeId(e) && owned.includes(e)) : [];
  return { owned, equipped };
}

// 未所持のみを対象に、weight を正規化した重み付き抽選。全所持なら null。
function drawCostume(owned: string[]): { id: string; name: string; rarity: Rarity } | null {
  const pool = COSTUMES.filter((c) => !owned.includes(c.id));
  if (pool.length === 0) return null;
  const total = pool.reduce((s, c) => s + c.weight, 0);
  let r = Math.random() * total;
  for (const c of pool) {
    r -= c.weight;
    if (r < 0) return { id: c.id, name: c.name, rarity: c.rarity };
  }
  const last = pool[pool.length - 1]; // 端数保険（浮動小数で最後まで残った場合）
  return { id: last.id, name: last.name, rarity: last.rarity };
}

// ---- グループ（家族の共有単位） --------------------------------------
api.get('/groups', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT g.id, g.name, g.invite_code, gm.role,
            (SELECT count(*)::int FROM group_members x WHERE x.group_id = g.id) AS members
       FROM group_members gm JOIN user_groups g ON g.id = gm.group_id
      WHERE gm.user_id = $1 ORDER BY g.id`,
    [uid(req)]
  );
  res.json(rows);
});

api.post('/groups', async (req, res) => {
  const { name } = req.body ?? {};
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'グループ名は必須です' });
  const code = crypto.randomBytes(16).toString('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const g = await client.query(
      `INSERT INTO user_groups (name, invite_code) VALUES ($1, $2) RETURNING id, name, invite_code`,
      [name.trim(), code]
    );
    await client.query(
      `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [g.rows[0].id, uid(req)]
    );
    await client.query('COMMIT');
    res.status(201).json({ ...g.rows[0], role: 'owner', members: 1 });
  } catch (e) {
    await client.query('ROLLBACK');
    serverError(res, e);
  } finally {
    client.release();
  }
});

api.post('/groups/join', async (req, res) => {
  const { invite_code } = req.body ?? {};
  if (!invite_code || typeof invite_code !== 'string') return res.status(400).json({ error: '招待コードを入力してください' });
  const g = await pool.query(`SELECT id, name, invite_code FROM user_groups WHERE invite_code = $1`, [invite_code.trim()]);
  if (!g.rows[0]) return res.status(404).json({ error: '招待コードが見つかりません' });
  await pool.query(
    `INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [g.rows[0].id, uid(req)]
  );
  res.status(201).json({ ...g.rows[0], role: 'member' });
});

// 家計簿スペースの期限付き招待URLを発行（既定7日・10回まで）。
api.post('/groups/:id/invites', async (req, res) => {
  const groupId = Number(req.params.id);
  const userId = uid(req);
  const access = await pool.query(
    `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, userId]
  );
  if (!access.rows[0]) return res.status(403).json({ error: 'この家計簿スペースには参加していません' });
  const token = crypto.randomBytes(24).toString('base64url');
  const { rows } = await pool.query(
    `INSERT INTO group_invites (token, group_id, created_by, expires_at)
     VALUES ($1, $2, $3, now() + interval '7 days')
     RETURNING token, expires_at`,
    [token, groupId, userId]
  );
  res.status(201).json({
    ...rows[0],
    url: `${publicAppUrl()}/invite/${token}`,
  });
});

api.post('/invites/:token/join', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT gi.group_id, g.name
         FROM group_invites gi
         JOIN user_groups g ON g.id = gi.group_id
        WHERE gi.token = $1
          AND gi.revoked_at IS NULL
          AND gi.expires_at > now()
          AND gi.use_count < gi.max_uses
        FOR UPDATE OF gi`,
      [req.params.token]
    );
    const invite = rows[0];
    if (!invite) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'この招待は無効または期限切れです' });
    }
    const joined = await client.query(
      `INSERT INTO group_members (group_id, user_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING group_id`,
      [invite.group_id, uid(req)]
    );
    if (joined.rows.length) {
      await client.query(`UPDATE group_invites SET use_count = use_count + 1 WHERE token = $1`, [req.params.token]);
    }
    await client.query(
      `INSERT INTO user_settings (user_id, active_group_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET active_group_id = EXCLUDED.active_group_id`,
      [uid(req), invite.group_id]
    );
    await client.query('COMMIT');
    res.status(201).json({ id: invite.group_id, name: invite.name });
  } catch (e) {
    await client.query('ROLLBACK');
    serverError(res, e);
  } finally {
    client.release();
  }
});

// ---- レシートOCR（Gemini vision で明細抽出） -------------------------
// 有料APIを呼ぶため、無料ユーザーは 1日2回 かつ 1週5回（月曜はじまり・JST）までに制限する。
// premium_until が未来（IAP実装=M3が書く）のユーザーは無制限。サーバー側で永続化。
api.post('/ocr', async (req, res) => {
  const { image } = req.body ?? {};
  if (typeof image !== 'string' || !image) {
    return res.status(400).json({ error: 'image（レシート画像）は必須です' });
  }
  if (image.length > 8_000_000) {
    return res.status(400).json({ error: '画像が大きすぎます（縮小してから送ってください）' });
  }
  const userId = uid(req);
  try {
    // 制限チェックも try 内に置く（Neon の一時エラーで未捕捉 reject になりリクエストがハングするのを防ぐ）
    const { rows } = await pool.query(
      `SELECT (now() AT TIME ZONE 'Asia/Tokyo')::date AS today,
              date_trunc('week', (now() AT TIME ZONE 'Asia/Tokyo'))::date AS this_week,
              (SELECT last_ocr_on FROM user_settings WHERE user_id = $1) AS last_ocr_on,
              (SELECT ocr_used FROM user_settings WHERE user_id = $1) AS ocr_used,
              (SELECT ocr_week_on FROM user_settings WHERE user_id = $1) AS ocr_week_on,
              (SELECT ocr_week_used FROM user_settings WHERE user_id = $1) AS ocr_week_used,
              (SELECT premium_until FROM user_settings WHERE user_id = $1) AS premium_until,
              (SELECT mode FROM user_settings WHERE user_id = $1) AS mode`,
      [userId]
    );
    const {
      today, this_week: thisWeek,
      last_ocr_on: lastOcrOn, ocr_used: ocrUsed,
      ocr_week_on: ocrWeekOn, ocr_week_used: ocrWeekUsed,
      premium_until: premiumUntil,
      mode,
    } = rows[0];
    const isKids = mode === 'kids';
    const isPremium = !!premiumUntil && new Date(premiumUntil).getTime() > Date.now();
    if (!isPremium) {
      const usedToday = lastOcrOn === today ? (ocrUsed ?? 0) : 0;
      if (usedToday >= 2) {
        return res.status(429).json({
          error: isKids
            ? 'きょうの よみとりは 2回までだよ。またあした！'
            : 'レシート読み取りは1日2回までです。また明日お試しください。',
        });
      }
      const usedThisWeek = ocrWeekOn === thisWeek ? (ocrWeekUsed ?? 0) : 0;
      if (usedThisWeek >= 5) {
        return res.status(429).json({
          error: isKids
            ? 'こんしゅうの よみとりは 5回までだよ。また らいしゅう！'
            : '今週の読み取り上限（5回）に達しました。また来週お試しください。',
        });
      }
    }
    const result = await extractReceipt(image);
    // OCR成功時のみ消費を記録する（通信エラー・プロバイダ失敗では消費しない）。
    // 日次(last_ocr_on/ocr_used)と週次(ocr_week_on/ocr_week_used)を1つのUPSERTで原子的に更新。
    // 日付/週が変わっていればそれぞれ 1 にリセット、変わっていなければ +1。設定行が無くても安全（冪等）。
    await pool.query(
      `INSERT INTO user_settings (user_id, last_ocr_on, ocr_used, ocr_week_on, ocr_week_used)
       VALUES ($1, (now() AT TIME ZONE 'Asia/Tokyo')::date, 1,
                   date_trunc('week', (now() AT TIME ZONE 'Asia/Tokyo'))::date, 1)
       ON CONFLICT (user_id) DO UPDATE SET
         ocr_used = CASE WHEN user_settings.last_ocr_on = (now() AT TIME ZONE 'Asia/Tokyo')::date
                         THEN user_settings.ocr_used + 1 ELSE 1 END,
         last_ocr_on = (now() AT TIME ZONE 'Asia/Tokyo')::date,
         ocr_week_used = CASE WHEN user_settings.ocr_week_on = date_trunc('week', (now() AT TIME ZONE 'Asia/Tokyo'))::date
                         THEN user_settings.ocr_week_used + 1 ELSE 1 END,
         ocr_week_on = date_trunc('week', (now() AT TIME ZONE 'Asia/Tokyo'))::date`,
      [userId]
    );
    res.json(result);
  } catch (e) {
    // OCRのエラーはアプリ由来のメッセージ（APIキー未設定・読み取り失敗）なのでそのまま出す
    res.status(500).json({ error: (e as Error).message });
  }
});

// ---- 旅行 -------------------------------------------------------------

// 一覧（所属グループのプロジェクトのみ・各合計付き）
api.get('/trips', async (req, res) => {
  const gids = await userGroupIds(uid(req));
  if (!gids.length) return res.json([]);
  const { rows } = await pool.query(
    `SELECT t.id, t.title, t.kind, t.group_id, g.name AS group_name, t.start_date, t.end_date,
            COALESCE(SUM(i.price), 0)::int AS total
       FROM trips t
       JOIN user_groups g ON g.id = t.group_id
       LEFT JOIN receipts r ON r.trip_id = t.id
       LEFT JOIN items i    ON i.receipt_id = r.id
      WHERE t.group_id = ANY($1::int[])
      GROUP BY t.id, g.name
      ORDER BY t.created_at DESC`,
    [gids]
  );
  res.json(rows);
});

// 作成（参加しているグループにのみ作れる）
api.post('/trips', async (req, res) => {
  const { title, kind, group_id, start_date, end_date } = req.body ?? {};
  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'title は必須です' });
  }
  if (!Number.isInteger(group_id)) return res.status(400).json({ error: 'group_id は必須です' });
  const gids = await userGroupIds(uid(req));
  if (!gids.includes(group_id)) return res.status(403).json({ error: 'そのグループに参加していません' });
  const k = kind === 'daily' ? 'daily' : 'trip';
  const { rows } = await pool.query(
    `INSERT INTO trips (title, kind, group_id, start_date, end_date) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [title, k, group_id, start_date || null, end_date || null]
  );
  res.status(201).json(rows[0]);
});

// 詳細（メンバー・レシート・集計・精算をまとめて返す）
api.get('/trips/:id', async (req, res) => {
  const tripId = Number(req.params.id);
  if (!Number.isInteger(tripId)) return res.status(400).json({ error: 'invalid id' });
  if (!(await tripAccessible(uid(req), tripId))) return res.status(404).json({ error: 'not found' });

  const tripQ = await pool.query(`SELECT * FROM trips WHERE id = $1`, [tripId]);
  if (tripQ.rowCount === 0) return res.status(404).json({ error: 'not found' });

  const membersQ = await pool.query(
    `SELECT id, name, weight FROM members WHERE trip_id = $1 ORDER BY id`,
    [tripId]
  );
  const receiptsQ = await pool.query(
    `SELECT id, store_name, category, purchased_on, paid_by, lat, lng, place_name,
            (photo IS NOT NULL) AS has_photo
       FROM receipts WHERE trip_id = $1 ORDER BY purchased_on, id`,
    [tripId]
  );
  const receiptIds = receiptsQ.rows.map((r) => r.id);

  const itemsQ = receiptIds.length
    ? await pool.query(
        `SELECT id, receipt_id, name, price, quantity FROM items
          WHERE receipt_id = ANY($1::int[]) ORDER BY id`,
        [receiptIds]
      )
    : { rows: [] as any[] };
  const itemIds = itemsQ.rows.map((i) => i.id);

  const sharesQ = itemIds.length
    ? await pool.query(
        `SELECT item_id, member_id, weight FROM item_shares WHERE item_id = ANY($1::int[])`,
        [itemIds]
      )
    : { rows: [] as any[] };

  // item_id -> shares（負担者＋比重オーバーライド）
  const sharesByItem = new Map<number, { member_id: number; weight: number | null }[]>();
  for (const s of sharesQ.rows) {
    const arr = sharesByItem.get(s.item_id) ?? [];
    arr.push({ member_id: s.member_id, weight: s.weight });
    sharesByItem.set(s.item_id, arr);
  }

  // receipt_id -> items（負担者付き）。member_ids は表示用、shares は比重付き。
  const itemsByReceipt = new Map<number, any[]>();
  for (const it of itemsQ.rows) {
    const arr = itemsByReceipt.get(it.receipt_id) ?? [];
    const shares = sharesByItem.get(it.id) ?? [];
    arr.push({ ...it, shares, member_ids: shares.map((s) => s.member_id) });
    itemsByReceipt.set(it.receipt_id, arr);
  }

  const receipts = receiptsQ.rows.map((r) => {
    const items = itemsByReceipt.get(r.id) ?? [];
    const total = items.reduce((s, it) => s + it.price, 0);
    return { ...r, items, total };
  });

  // 思い出写真（レシートとは別。アルバムの素材）。会計(receipt_id)に紐付け可
  const photosQ = await pool.query(
    `SELECT id, receipt_id, caption, taken_on, sort_order FROM trip_photos
      WHERE trip_id = $1 ORDER BY sort_order, taken_on NULLS LAST, id`,
    [tripId]
  );

  const calcReceipts: CalcReceipt[] = receipts.map((r) => ({
    paidBy: r.paid_by,
    items: r.items.map((it: any) => ({ price: it.price, shares: it.shares })),
  }));
  const summary = summarize(membersQ.rows.map((m) => ({ id: m.id, weight: m.weight })), calcReceipts);

  // 集計に名前を添える
  const nameOf = new Map(membersQ.rows.map((m) => [m.id, m.name]));
  const perMember = summary.perMember.map((p) => ({ ...p, name: nameOf.get(p.memberId) }));

  res.json({
    trip: tripQ.rows[0],
    members: membersQ.rows,
    receipts,
    photos: photosQ.rows,
    summary: { total: summary.total, perMember, settlement: summary.settlement },
  });
});

// ---- メンバー ---------------------------------------------------------

api.post('/trips/:id/members', async (req, res) => {
  const tripId = Number(req.params.id);
  const { name, weight } = req.body ?? {};
  if (!Number.isInteger(tripId)) return res.status(400).json({ error: 'invalid id' });
  if (!(await tripAccessible(uid(req), tripId))) return res.status(404).json({ error: 'not found' });
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name は必須です' });
  const { rows } = await pool.query(
    `INSERT INTO members (trip_id, name, weight) VALUES ($1, $2, $3) RETURNING id, name, weight`,
    [tripId, name, normWeight(weight)]
  );
  res.status(201).json(rows[0]);
});

// メンバー削除（支払者だった会計は paid_by を NULL に、負担割当は CASCADE で外れる）
api.delete('/members/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  if (!(await memberAccessible(uid(req), id))) return res.status(404).json({ error: 'not found' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE receipts SET paid_by = NULL WHERE paid_by = $1`, [id]);
    await client.query(`DELETE FROM members WHERE id = $1`, [id]);
    await client.query('COMMIT');
    res.status(204).end();
  } catch (e) {
    await client.query('ROLLBACK');
    serverError(res, e);
  } finally {
    client.release();
  }
});

// メンバー更新（名前・比重）
api.put('/members/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  if (!(await memberAccessible(uid(req), id))) return res.status(404).json({ error: 'not found' });
  const { name, weight } = req.body ?? {};
  const { rows } = await pool.query(
    `UPDATE members
        SET name   = COALESCE($2, name),
            weight = COALESCE($3, weight)
      WHERE id = $1
      RETURNING id, name, weight`,
    [id, typeof name === 'string' && name ? name : null, weight === undefined ? null : normWeight(weight)]
  );
  res.json(rows[0]);
});

// ---- レシート（明細＋負担者＋比重をまとめて登録／編集） --------------

function validateReceiptItems(items: any): string | null {
  if (!Array.isArray(items) || items.length === 0) return '明細(items)を1件以上指定してください';
  for (const it of items) {
    if (!it || typeof it.name !== 'string' || !it.name) return '明細の name は必須です';
    if (!Number.isInteger(it.price) || it.price <= 0) return '明細の price は正の整数で指定してください';
  }
  return null;
}

// 対象tripのメンバーID集合（paid_by / shares の他trip混入を防ぐ検証に使う）
async function tripMemberIds(client: any, tripId: number): Promise<Set<number>> {
  const { rows } = await client.query(`SELECT id FROM members WHERE trip_id = $1`, [tripId]);
  return new Set(rows.map((r: any) => r.id as number));
}

// items を items + item_shares として書き込む（shares=[{member_id, weight}] / 後方互換で member_ids: number[]）
// genre は指定があれば尊重、なければ自動分類。allowed 外の member_id は無視する。
async function insertItemsAndShares(client: any, receiptId: number, items: any[], storeName: string | null, allowed: Set<number>) {
  for (const it of items) {
    const genre = isGenre(it.genre) ? it.genre : classifyItem(String(it.name ?? ''), storeName);
    const itemQ = await client.query(
      `INSERT INTO items (receipt_id, name, price, quantity, genre) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [receiptId, it.name, it.price, it.quantity && it.quantity > 0 ? it.quantity : 1, genre]
    );
    const itemId = itemQ.rows[0].id;
    const shares: any[] = Array.isArray(it.shares)
      ? it.shares
      : Array.isArray(it.member_ids) ? it.member_ids.map((m: number) => ({ member_id: m, weight: null })) : [];
    for (const s of shares) {
      const mid = Number(s.member_id);
      if (!Number.isInteger(mid) || !allowed.has(mid)) continue;
      const w = Number.isInteger(s.weight) && s.weight > 0 ? s.weight : null;
      await client.query(
        `INSERT INTO item_shares (item_id, member_id, weight) VALUES ($1,$2,$3)
         ON CONFLICT (item_id, member_id) DO UPDATE SET weight = EXCLUDED.weight`,
        [itemId, mid, w]
      );
    }
  }
}

api.post('/trips/:id/receipts', async (req, res) => {
  const tripId = Number(req.params.id);
  if (!Number.isInteger(tripId)) return res.status(400).json({ error: 'invalid id' });
  if (!(await tripAccessible(uid(req), tripId))) return res.status(404).json({ error: 'not found' });

  const { store_name, category, purchased_on, paid_by, lat, lng, place_name, photo, items } = req.body ?? {};
  if (!purchased_on) return res.status(400).json({ error: 'purchased_on は必須です' });
  const err = validateReceiptItems(items);
  if (err) return res.status(400).json({ error: err });

  const photoBuf = decodePhoto(photo);
  if (photo && !photoBuf) return res.status(400).json({ error: '写真の形式が不正です' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const allowed = await tripMemberIds(client, tripId);
    if (paid_by && !allowed.has(Number(paid_by))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: '支払者がこのプロジェクトのメンバーではありません' });
    }
    const receiptQ = await client.query(
      `INSERT INTO receipts (trip_id, store_name, category, purchased_on, paid_by, lat, lng, place_name, photo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [tripId, store_name || null, category || null, purchased_on, paid_by || null, lat ?? null, lng ?? null, place_name || null, photoBuf]
    );
    const receiptId = receiptQ.rows[0].id;
    await insertItemsAndShares(client, receiptId, items, store_name || null, allowed);
    await client.query('COMMIT');
    res.status(201).json({ id: receiptId });
  } catch (e) {
    await client.query('ROLLBACK');
    serverError(res, e);
  } finally {
    client.release();
  }
});

// レシート編集（フィールド＋明細＋負担者比重をまるごと差し替え）
// photo: 未指定=既存維持 / null=削除 / 文字列=差し替え
api.put('/receipts/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  if (!(await receiptAccessible(uid(req), id))) return res.status(404).json({ error: 'not found' });

  const body = req.body ?? {};
  const { store_name, category, purchased_on, paid_by, lat, lng, place_name, items } = body;
  if (!purchased_on) return res.status(400).json({ error: 'purchased_on は必須です' });
  const err = validateReceiptItems(items);
  if (err) return res.status(400).json({ error: err });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tripQ = await client.query(`SELECT trip_id FROM receipts WHERE id = $1`, [id]);
    const allowed = await tripMemberIds(client, tripQ.rows[0].trip_id);
    if (paid_by && !allowed.has(Number(paid_by))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: '支払者がこのプロジェクトのメンバーではありません' });
    }
    await client.query(
      `UPDATE receipts SET store_name=$2, category=$3, purchased_on=$4, paid_by=$5, lat=$6, lng=$7, place_name=$8 WHERE id=$1`,
      [id, store_name || null, category || null, purchased_on, paid_by || null, lat ?? null, lng ?? null, place_name || null]
    );
    if ('photo' in body) {
      // null=削除、文字列=差し替え（未指定なら触らない）
      await client.query(`UPDATE receipts SET photo=$2 WHERE id=$1`, [id, decodePhoto(body.photo)]);
    }
    await client.query(`DELETE FROM items WHERE receipt_id=$1`, [id]); // item_shares は CASCADE
    await insertItemsAndShares(client, id, items, store_name || null, allowed);
    await client.query('COMMIT');
    res.json({ id });
  } catch (e) {
    await client.query('ROLLBACK');
    serverError(res, e);
  } finally {
    client.release();
  }
});

api.delete('/receipts/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  if (!(await receiptAccessible(uid(req), id))) return res.status(404).json({ error: 'not found' });
  await pool.query(`DELETE FROM receipts WHERE id = $1`, [id]);
  res.status(204).end();
});

// レシート写真を配信（BYTEA をそのまま返す）
api.get('/receipts/:id/photo', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  if (!(await receiptAccessible(uid(req), id))) return res.status(404).end();
  const { rows } = await pool.query(`SELECT photo FROM receipts WHERE id = $1`, [id]);
  const buf = rows[0]?.photo as Buffer | null | undefined;
  if (!buf) return res.status(404).end();
  res.set('Content-Type', 'image/jpeg');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'private, max-age=86400'); // 認可つき画像なので共有キャッシュ禁止
  res.send(buf);
});

// ---- 思い出写真（旅行のアルバム素材。レシートとは別） ----------------

// dataURL or 素の base64 → Buffer（サイズ上限＋JPEGマジックバイト検査）
function decodePhoto(photo: unknown): Buffer | null {
  if (typeof photo !== 'string' || !photo) return null;
  if (photo.length > 4_000_000) return null; // デコード後 ~3MB まで（クライアントは縮小済みのはず）
  const base64 = photo.includes(',') ? photo.split(',')[1] : photo;
  const buf = Buffer.from(base64, 'base64');
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return null; // JPEG のみ
  return buf;
}

// 1枚アップロード
api.post('/trips/:id/photos', async (req, res) => {
  const tripId = Number(req.params.id);
  if (!Number.isInteger(tripId)) return res.status(400).json({ error: 'invalid id' });
  if (!(await tripAccessible(uid(req), tripId))) return res.status(404).json({ error: 'not found' });
  const { photo, caption, taken_on, receipt_id } = req.body ?? {};
  const buf = decodePhoto(photo);
  if (!buf) return res.status(400).json({ error: 'photo（写真）は必須か、形式が不正です' });
  const rid = Number.isInteger(receipt_id) ? receipt_id : null;
  if (rid != null) {
    // 紐付け先レシートは同じ trip のものだけ（他人のレシートIDを指すIDOR防止）
    const chk = await pool.query(`SELECT 1 FROM receipts WHERE id = $1 AND trip_id = $2`, [rid, tripId]);
    if (!chk.rows[0]) return res.status(400).json({ error: 'receipt_id がこのプロジェクトのレシートではありません' });
  }
  const { rows } = await pool.query(
    `INSERT INTO trip_photos (trip_id, photo, caption, taken_on, receipt_id)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, receipt_id, caption, taken_on, sort_order`,
    [tripId, buf, caption || null, taken_on || null, rid]
  );
  res.status(201).json(rows[0]);
});

// メタ更新（キャプション・撮影日・並び順）。編集フェーズで使用
api.put('/trip-photos/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  if (!(await photoAccessible(uid(req), id))) return res.status(404).json({ error: 'not found' });
  const { caption, taken_on, sort_order } = req.body ?? {};
  const { rows } = await pool.query(
    `UPDATE trip_photos
        SET caption    = COALESCE($2, caption),
            taken_on   = COALESCE($3, taken_on),
            sort_order = COALESCE($4, sort_order)
      WHERE id = $1
      RETURNING id, caption, taken_on, sort_order`,
    [id, caption ?? null, taken_on ?? null, Number.isInteger(sort_order) ? sort_order : null]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
});

api.delete('/trip-photos/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  if (!(await photoAccessible(uid(req), id))) return res.status(404).json({ error: 'not found' });
  await pool.query(`DELETE FROM trip_photos WHERE id = $1`, [id]);
  res.status(204).end();
});

// 写真本体を配信
api.get('/trip-photos/:id/photo', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  if (!(await photoAccessible(uid(req), id))) return res.status(404).end();
  const { rows } = await pool.query(`SELECT photo FROM trip_photos WHERE id = $1`, [id]);
  const buf = rows[0]?.photo as Buffer | null | undefined;
  if (!buf) return res.status(404).end();
  res.set('Content-Type', 'image/jpeg');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'private, max-age=86400'); // 認可つき画像なので共有キャッシュ禁止
  res.send(buf);
});

// ---- 月次予算・繰り返し支出（日常家計簿向け） ------------------------

// 月次予算の設定（null/空でクリア）
api.put('/trips/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  if (!(await tripAccessible(uid(req), id))) return res.status(404).json({ error: 'not found' });
  const mbRaw = (req.body ?? {}).monthly_budget;
  const mb = Number.isInteger(mbRaw) && mbRaw >= 0 ? mbRaw : null;
  const { rows } = await pool.query(
    `UPDATE trips SET monthly_budget = $2 WHERE id = $1 RETURNING id, monthly_budget`,
    [id, mb]
  );
  res.json(rows[0]);
});

api.get('/trips/:id/recurring', async (req, res) => {
  const tripId = Number(req.params.id);
  if (!Number.isInteger(tripId)) return res.status(400).json({ error: 'invalid id' });
  if (!(await tripAccessible(uid(req), tripId))) return res.status(404).json({ error: 'not found' });
  const { rows } = await pool.query(
    `SELECT id, name, amount, category, paid_by, active FROM recurring_expenses
      WHERE trip_id = $1 ORDER BY id`,
    [tripId]
  );
  res.json(rows);
});

api.post('/trips/:id/recurring', async (req, res) => {
  const tripId = Number(req.params.id);
  if (!Number.isInteger(tripId)) return res.status(400).json({ error: 'invalid id' });
  if (!(await tripAccessible(uid(req), tripId))) return res.status(404).json({ error: 'not found' });
  const { name, amount, category, paid_by } = req.body ?? {};
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name は必須です' });
  if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: 'amount は正の整数で指定してください' });
  if (Number.isInteger(paid_by)) {
    const allowed = await tripMemberIds(pool, tripId);
    if (!allowed.has(paid_by)) return res.status(400).json({ error: '支払者がこのプロジェクトのメンバーではありません' });
  }
  const { rows } = await pool.query(
    `INSERT INTO recurring_expenses (trip_id, name, amount, category, paid_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, name, amount, category, paid_by, active`,
    [tripId, name, amount, category || null, Number.isInteger(paid_by) ? paid_by : null]
  );
  res.status(201).json(rows[0]);
});

api.delete('/recurring/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  if (!(await recurringAccessible(uid(req), id))) return res.status(404).json({ error: 'not found' });
  await pool.query(`DELETE FROM recurring_expenses WHERE id = $1`, [id]);
  res.status(204).end();
});

// 指定月（既定は当月）の繰り返し支出をレシートとして計上。重複（同月・同名）はスキップ。
api.post('/trips/:id/recurring/generate', async (req, res) => {
  const tripId = Number(req.params.id);
  if (!Number.isInteger(tripId)) return res.status(400).json({ error: 'invalid id' });
  if (!(await tripAccessible(uid(req), tripId))) return res.status(404).json({ error: 'not found' });
  const monthRaw = (req.body ?? {}).month;
  const month = typeof monthRaw === 'string' && /^\d{4}-\d{2}$/.test(monthRaw) ? monthRaw : jstToday().slice(0, 7);
  const purchasedOn = `${month}-01`;

  const tmpl = await pool.query(`SELECT * FROM recurring_expenses WHERE trip_id=$1 AND active=true ORDER BY id`, [tripId]);
  const members = (await pool.query(`SELECT id FROM members WHERE trip_id=$1`, [tripId])).rows.map((m) => m.id);

  let created = 0, skipped = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const t of tmpl.rows) {
      const dup = await client.query(
        `SELECT 1 FROM receipts WHERE trip_id=$1 AND store_name=$2 AND to_char(purchased_on,'YYYY-MM')=$3 LIMIT 1`,
        [tripId, t.name, month]
      );
      if (dup.rows.length) { skipped++; continue; }
      const r = await client.query(
        `INSERT INTO receipts (trip_id, store_name, category, purchased_on, paid_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [tripId, t.name, t.category, purchasedOn, t.paid_by]
      );
      const items = [{ name: t.name, price: t.amount, member_ids: members }];
      await insertItemsAndShares(client, r.rows[0].id, items, t.name, new Set(members));
      created++;
    }
    await client.query('COMMIT');
    res.json({ created, skipped, month });
  } catch (e) {
    await client.query('ROLLBACK');
    serverError(res, e);
  } finally {
    client.release();
  }
});

// ---- 分析（旅行横断） -------------------------------------------------

api.get('/analytics', async (req, res) => {
  const gids = await userGroupIds(uid(req));
  if (!gids.length) return res.json({ byCategory: [], byTrip: [] });
  const byCategory = await pool.query(
    `SELECT COALESCE(r.category, '未分類') AS category, SUM(i.price)::int AS total
       FROM receipts r
       JOIN items i ON i.receipt_id = r.id
       JOIN trips t ON t.id = r.trip_id
      WHERE t.group_id = ANY($1::int[])
      GROUP BY 1 ORDER BY total DESC`,
    [gids]
  );
  const byTrip = await pool.query(
    `SELECT t.title, COALESCE(SUM(i.price), 0)::int AS total
       FROM trips t
       LEFT JOIN receipts r ON r.trip_id = t.id
       LEFT JOIN items i    ON i.receipt_id = r.id
      WHERE t.group_id = ANY($1::int[])
      GROUP BY t.id ORDER BY total DESC`,
    [gids]
  );
  res.json({ byCategory: byCategory.rows, byTrip: byTrip.rows });
});

// ---- 直近の支出（キャラ反応・カレンダー・レポート用の横断取得） --------
api.get('/expenses/recent', async (req, res) => {
  const gids = await scopedGroupIds(req);
  if (!gids.length) return res.json({ receipts: [] });
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 400);
  const { rows } = await pool.query(
    `SELECT r.id, r.trip_id, t.title AS trip_title, t.kind, r.store_name, r.category,
            r.purchased_on, r.created_at, r.lat, r.lng, r.place_name,
            COALESCE(SUM(i.price), 0)::int AS total,
            COALESCE(json_agg(json_build_object('id', i.id, 'name', i.name, 'price', i.price, 'quantity', i.quantity, 'genre', i.genre)
                              ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL), '[]') AS items,
            COALESCE((SELECT json_agg(p.id ORDER BY p.id) FROM trip_photos p WHERE p.receipt_id = r.id AND p.trip_id = r.trip_id), '[]') AS photo_ids
       FROM receipts r
       JOIN trips t ON t.id = r.trip_id
       LEFT JOIN items i ON i.receipt_id = r.id
      WHERE t.group_id = ANY($1::int[])
        AND r.purchased_on >= (CURRENT_DATE - $2::int)
      GROUP BY r.id, t.title, t.kind
      ORDER BY r.purchased_on DESC, r.id DESC`,
    [gids, days]
  );
  res.json({ receipts: rows });
});

// ---- モード設定・ゲーミフィケーション ------------------------------------
// Lv はXPから導出（記録+10 / チャレンジ+5 / ちょきん+20 / 目標達成+100）
const levelOf = (xp: number) => 1 + Math.floor(Math.sqrt(Math.max(0, xp)) / 5);

// ホームに必要な数字をまとめて返す（モード・残高・今月収支・目標・チャレンジ）
api.get('/overview', async (req, res) => {
  const userId = uid(req);
  try {
    const gids = await scopedGroupIds(req);
    const sQ = await pool.query(`SELECT * FROM user_settings WHERE user_id = $1`, [userId]);
    const s = sQ.rows[0] ?? null;

    const zero = { rows: [{ total: 0 }] };
    const monthSpendQ = gids.length ? await pool.query(
      `SELECT COALESCE(SUM(i.price), 0)::int AS total
         FROM receipts r JOIN items i ON i.receipt_id = r.id JOIN trips t ON t.id = r.trip_id
        WHERE t.group_id = ANY($1::int[])
          AND date_trunc('month', r.purchased_on) = date_trunc('month', CURRENT_DATE)`, [gids]) : zero;
    const allSpendQ = gids.length ? await pool.query(
      `SELECT COALESCE(SUM(i.price), 0)::int AS total
         FROM receipts r JOIN items i ON i.receipt_id = r.id JOIN trips t ON t.id = r.trip_id
        WHERE t.group_id = ANY($1::int[])`, [gids]) : zero;
    // つかいみちは明細の自動ジャンル単位で集計（レシート単位のカテゴリではなく）
    const byCatQ = gids.length ? await pool.query(
      `SELECT COALESCE(i.genre, 'その他') AS category, SUM(i.price)::int AS total
         FROM receipts r JOIN items i ON i.receipt_id = r.id JOIN trips t ON t.id = r.trip_id
        WHERE t.group_id = ANY($1::int[])
          AND date_trunc('month', r.purchased_on) = date_trunc('month', CURRENT_DATE)
        GROUP BY 1 ORDER BY total DESC`, [gids]) : { rows: [] };
    const todayQ = gids.length ? await pool.query(
      `SELECT 1 FROM receipts r JOIN trips t ON t.id = r.trip_id
        WHERE t.group_id = ANY($1::int[]) AND r.created_at::date = CURRENT_DATE LIMIT 1`, [gids]) : { rows: [] };
    const countQ = gids.length ? await pool.query(
      `SELECT COUNT(*)::int AS n FROM receipts r JOIN trips t ON t.id = r.trip_id
        WHERE t.group_id = ANY($1::int[])`, [gids]) : { rows: [{ n: 0 }] };
    const incomeQ = await pool.query(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE date_trunc('month', on_date) = date_trunc('month', CURRENT_DATE)), 0)::int AS month,
              COALESCE(SUM(amount), 0)::int AS total
         FROM incomes WHERE user_id = $1`, [userId]);
    const goalsQ = await pool.query(
      `SELECT id, name, emoji, target, saved, done, deadline FROM savings_goals WHERE user_id = $1 ORDER BY done, id DESC`, [userId]);
    const savedAll = goalsQ.rows.reduce((a, g) => a + g.saved, 0);
    const challengeQ = await pool.query(
      `SELECT (last_challenge_date = CURRENT_DATE) AS done FROM user_settings WHERE user_id = $1`, [userId]);
    // 親からのおこづかい着信トースト用に最新の収入1件＋子として連携中か
    const latestIncomeQ = await pool.query(
      `SELECT id, amount, name, on_date FROM incomes WHERE user_id = $1 ORDER BY on_date DESC, id DESC LIMIT 1`, [userId]);
    const linkedAsChild = await isLinkedChild(userId);
    // お手伝いポイント: 自分の残高＋（親として）承認待ちの申請数（せってい バッジ用）
    const pendingChoreQ = await pool.query(
      `SELECT COUNT(*)::int AS n FROM chore_logs cl
         JOIN chores c ON c.id = cl.chore_id
         JOIN account_links al ON al.id = c.link_id
        WHERE al.parent_user_id = $1 AND cl.status = 'pending'`, [userId]);

    const wallet = (s?.balance_start ?? 0) + incomeQ.rows[0].total - allSpendQ.rows[0].total - savedAll;
    res.json({
      settings: s ? { ...s, level: levelOf(s.xp), costumes: normCostumes(s.costumes) } : null,
      month: { spend: monthSpendQ.rows[0].total, income: incomeQ.rows[0].month, byCategory: byCatQ.rows },
      wallet,
      goals: goalsQ.rows,
      todayRecorded: todayQ.rows.length > 0,
      challengeDone: challengeQ.rows[0]?.done === true,
      recordsCount: countQ.rows[0].n,
      latestIncome: latestIncomeQ.rows[0] ?? null,
      linkedAsChild,
      chorePoints: s?.chore_points ?? 0,
      pendingChoreCount: pendingChoreQ.rows[0].n,
    });
  } catch (e) {
    serverError(res, e);
  }
});

// 設定の作成/部分更新（初回のモード選択もここ）
api.put('/settings', async (req, res) => {
  const userId = uid(req);
  const { mode, monthly_income, monthly_budget, allowance, balance_start, costume, last_summary_shown, usage_type, tutorial_done, active_group_id } = req.body ?? {};
  if (mode !== undefined && mode !== 'kids' && mode !== 'adult') {
    return res.status(400).json({ error: 'mode は kids / adult です' });
  }
  if (usage_type !== undefined && usage_type !== 'family' && usage_type !== 'personal') {
    return res.status(400).json({ error: 'usage_type は family / personal です' });
  }
  const num = (v: unknown) => (v === null ? null : Number.isFinite(Number(v)) ? Math.round(Number(v)) : undefined);
  try {
    // 連携中の子は おとなモードへ切り替えできない（見守りを外せてしまうため）
    if (mode === 'adult' && (await isLinkedChild(userId))) {
      return res.status(403).json({ error: '連携中は おとなモードに きりかえできないよ' });
    }
    if (active_group_id !== undefined) {
      const groupId = Number(active_group_id);
      const allowed = Number.isInteger(groupId) && (await userGroupIds(userId)).includes(groupId);
      if (!allowed) return res.status(403).json({ error: 'この家計簿スペースには参加していません' });
    }
    const cur = (await pool.query(`SELECT * FROM user_settings WHERE user_id = $1`, [userId])).rows[0] ?? {};
    const next = {
      mode: mode ?? cur.mode ?? 'adult',
      monthly_income: monthly_income !== undefined ? num(monthly_income) : cur.monthly_income ?? null,
      monthly_budget: monthly_budget !== undefined ? num(monthly_budget) : cur.monthly_budget ?? null,
      allowance: allowance !== undefined ? num(allowance) : cur.allowance ?? null,
      balance_start: balance_start !== undefined ? (num(balance_start) ?? 0) : cur.balance_start ?? 0,
      costume: costume !== undefined ? costume : cur.costume ?? null,
      last_summary_shown: typeof last_summary_shown === 'string' && /^\d{4}-\d{2}$/.test(last_summary_shown)
        ? last_summary_shown : cur.last_summary_shown ?? null,
      usage_type: usage_type !== undefined ? usage_type : cur.usage_type ?? null,
      tutorial_done: tutorial_done !== undefined ? Boolean(tutorial_done) : cur.tutorial_done ?? false,
      active_group_id: active_group_id !== undefined ? Number(active_group_id) : cur.active_group_id ?? null,
    };
    const { rows } = await pool.query(
      `INSERT INTO user_settings (user_id, mode, monthly_income, monthly_budget, allowance, balance_start, costume, last_summary_shown, usage_type, tutorial_done, active_group_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (user_id) DO UPDATE SET mode = $2, monthly_income = $3, monthly_budget = $4,
         allowance = $5, balance_start = $6, costume = $7, last_summary_shown = $8, usage_type = $9,
         tutorial_done = $10, active_group_id = $11
       RETURNING *`,
      [userId, next.mode, next.monthly_income, next.monthly_budget, next.allowance, next.balance_start, next.costume, next.last_summary_shown, next.usage_type, next.tutorial_done, next.active_group_id]
    );
    res.json({ ...rows[0], level: levelOf(rows[0].xp) });
  } catch (e) {
    serverError(res, e);
  }
});

// 明細ジャンルの手直し（自動分類はあくまで下書き）
api.put('/items/:id/genre', async (req, res) => {
  const { genre } = req.body ?? {};
  if (!isGenre(genre)) return res.status(400).json({ error: '不正なジャンルです' });
  try {
    const { rows } = await pool.query(
      `UPDATE items i SET genre = $1
        FROM receipts r, trips t, group_members gm
       WHERE i.id = $2 AND r.id = i.receipt_id AND t.id = r.trip_id
         AND gm.group_id = t.group_id AND gm.user_id = $3
       RETURNING i.id, i.genre`,
      [genre, Number(req.params.id), uid(req)]
    );
    if (!rows[0]) return res.status(404).json({ error: '明細が見つかりません' });
    res.json(rows[0]);
  } catch (e) {
    serverError(res, e);
  }
});

// ちょきん目標
api.post('/goals', async (req, res) => {
  const { name, emoji, target, deadline } = req.body ?? {};
  const t = Math.round(Number(target));
  // target は PostgreSQL の integer 上限（2^31-1）未満に制限。超えると INSERT で例外になる。
  if (typeof name !== 'string' || !name.trim() || !Number.isFinite(t) || t <= 0 || t > 2_000_000_000) {
    return res.status(400).json({ error: '目標の名前と金額を入れてね' });
  }
  // deadline は形式だけでなく暦日として実在するかも検証（2026-13-99 / 2026-02-30 等を弾く）。
  let dl: string | null = null;
  if (typeof deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
    const d = new Date(deadline + 'T00:00:00Z');
    if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === deadline) dl = deadline;
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO savings_goals (user_id, name, emoji, target, deadline) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, emoji, target, saved, done, deadline`,
      [uid(req), name.trim(), typeof emoji === 'string' ? emoji.slice(0, 4) : null, t, dl]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    serverError(res, e);
  }
});
api.delete('/goals/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM savings_goals WHERE id = $1 AND user_id = $2`, [Number(req.params.id), uid(req)]);
    res.status(204).end();
  } catch (e) {
    serverError(res, e);
  }
});
// ちょきんする（入金）。達成したらボーナス（コイン+50 / XP+100）
api.post('/goals/:id/deposit', async (req, res) => {
  const userId = uid(req);
  const amount = Math.round(Number((req.body ?? {}).amount));
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: '金額を入れてね' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const gQ = await client.query(
      `SELECT * FROM savings_goals WHERE id = $1 AND user_id = $2 FOR UPDATE`, [Number(req.params.id), userId]);
    const g = gQ.rows[0];
    if (!g) { await client.query('ROLLBACK'); return res.status(404).json({ error: '目標が見つかりません' }); }
    const saved = g.saved + amount;
    const nowDone = !g.done && saved >= g.target;
    await client.query(`UPDATE savings_goals SET saved = $1, done = done OR $2 WHERE id = $3`, [saved, nowDone, g.id]);
    const xpGain = 20 + (nowDone ? 100 : 0);
    const coinGain = nowDone ? 50 : 0;
    const sQ = await client.query(
      `UPDATE user_settings SET xp = xp + $1, coins = coins + $2 WHERE user_id = $3 RETURNING xp, coins`,
      [xpGain, coinGain, userId]);
    await client.query('COMMIT');
    res.json({
      goal: { ...g, saved, done: g.done || nowDone },
      reward: { xp: xpGain, coins: coinGain, done: nowDone, level: sQ.rows[0] ? levelOf(sQ.rows[0].xp) : 1 },
    });
  } catch (e) {
    await client.query('ROLLBACK');
    serverError(res, e);
  } finally {
    client.release();
  }
});

// プレゼント: 30コインでマネコの衣装ガチャ（こどものごほうび消費先）
// 未所持のみから重み抽選し、owned に追加＋自動で equipped にも追加（引いたらすぐ着る）。
api.post('/present', async (req, res) => {
  const userId = uid(req);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sQ = await client.query(`SELECT coins, costumes FROM user_settings WHERE user_id = $1 FOR UPDATE`, [userId]);
    const s = sQ.rows[0];
    if (!s) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'さきにモードを選んでね' }); }
    const { owned, equipped } = normCostumes(s.costumes);
    // 全所持ならコインを引かずコンプリート応答
    if (owned.length >= COSTUMES.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'ぜんぶあつめたよ！コンプリート！' });
    }
    if (s.coins < 30) { await client.query('ROLLBACK'); return res.status(400).json({ error: `コインが足りないよ（30コイン必要・いま${s.coins}）` }); }
    const drawn = drawCostume(owned);
    if (!drawn) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'ぜんぶあつめたよ！コンプリート！' }); }
    const nextOwned = [...owned, drawn.id];
    const nextEquipped = equipped.includes(drawn.id) ? equipped : [...equipped, drawn.id];
    const uQ = await client.query(
      `UPDATE user_settings SET coins = coins - 30, costumes = $1 WHERE user_id = $2 RETURNING coins`,
      [JSON.stringify({ owned: nextOwned, equipped: nextEquipped }), userId]);
    await client.query('COMMIT');
    res.json({ costume: drawn.id, name: drawn.name, rarity: drawn.rarity, coins: uQ.rows[0].coins });
  } catch (e) {
    await client.query('ROLLBACK');
    serverError(res, e);
  } finally {
    client.release();
  }
});

// 衣装の着せ替え: 所持している衣装の equipped を on/off する
api.put('/costumes', async (req, res) => {
  const userId = uid(req);
  const { id, on } = req.body ?? {};
  if (!isCostumeId(id)) return res.status(400).json({ error: 'その衣装は存在しないよ' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sQ = await client.query(`SELECT costumes FROM user_settings WHERE user_id = $1 FOR UPDATE`, [userId]);
    const s = sQ.rows[0];
    if (!s) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'さきにモードを選んでね' }); }
    const { owned, equipped } = normCostumes(s.costumes);
    if (!owned.includes(id)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'まだ持っていない衣装だよ' }); }
    const nextEquipped = on === true
      ? (equipped.includes(id) ? equipped : [...equipped, id])
      : equipped.filter((e) => e !== id);
    await client.query(
      `UPDATE user_settings SET costumes = $1 WHERE user_id = $2`,
      [JSON.stringify({ owned, equipped: nextEquipped }), userId]);
    await client.query('COMMIT');
    res.json({ owned, equipped: nextEquipped });
  } catch (e) {
    await client.query('ROLLBACK');
    serverError(res, e);
  } finally {
    client.release();
  }
});

// 収入（おこづかい・給料・おとしだま）
api.post('/incomes', async (req, res) => {
  const { name, amount, on_date } = req.body ?? {};
  const a = Math.round(Number(amount));
  if (!Number.isFinite(a) || a <= 0) return res.status(400).json({ error: '金額を入れてね' });
  const day = typeof on_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(on_date) ? on_date : null;
  const { rows } = await pool.query(
    `INSERT INTO incomes (user_id, name, amount, on_date) VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE))
     RETURNING id, name, amount, on_date`,
    [uid(req), typeof name === 'string' && name.trim() ? name.trim() : 'おこづかい', a, day]
  );
  res.status(201).json(rows[0]);
});

// 収入の一覧（自分のぶんのみ・レポートのカレンダーに載せる）。最新300件。
api.get('/incomes', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, amount, on_date FROM incomes WHERE user_id = $1 ORDER BY on_date DESC, id DESC LIMIT 300`,
      [uid(req)]);
    res.json({ incomes: rows });
  } catch (e) {
    serverError(res, e);
  }
});

// こどもモードの軽量ポーリング用: 自分に届いた最新の収入1件だけ（親からのおこづかい着信トースト）。
api.get('/events', async (req, res) => {
  try {
    const incQ = await pool.query(
      `SELECT id, name, amount FROM incomes WHERE user_id = $1 ORDER BY on_date DESC, id DESC LIMIT 1`,
      [uid(req)]);
    res.json({ latestIncome: incQ.rows[0] ?? null });
  } catch (e) {
    serverError(res, e);
  }
});

// ---- ワンタップ記録 -----------------------------------------------------
// グループ・日常プロジェクト・自分メンバーが無ければ全部自動作成して、
// 品名＋金額だけで記録できるようにする（記録までの道のりを最短に）。
api.post('/expenses/quick', async (req, res) => {
  const userId = uid(req);
  const { group_id, group_ids, store_name, category, purchased_on, items, lat, lng, place_name, photos } = req.body ?? {};
  const storeStr = typeof store_name === 'string' && store_name.trim() ? store_name.trim() : null;
  const list: { name: string; price: number; genre: string }[] = Array.isArray(items)
    ? items
        .map((i: any) => ({
          name: typeof i?.name === 'string' ? i.name.trim() : '',
          price: Math.round(Number(i?.price)),
          // ジャンルは指定があれば尊重、なければ自動分類（あとから手直し可）
          genre: isGenre(i?.genre) ? i.genre : classifyItem(typeof i?.name === 'string' ? i.name : '', storeStr),
        }))
        .filter((i) => i.name && Number.isFinite(i.price) && i.price > 0)
    : [];
  if (!list.length) return res.status(400).json({ error: '品名と金額を入力してください' });
  const day = typeof purchased_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(purchased_on)
    ? purchased_on
    : jstToday();
  // 注意: Number(null) は 0 になるので、null/空はさきに弾く（lat=0,lng=0 の幽霊ピン防止）
  const numOrNull = (v: unknown) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const latNum = numOrNull(lat);
  const lngNum = numOrNull(lng);
  // 思い出写真（縮小済みJPEGのbase64・最大3枚。サイズ/形式は decodePhoto で検査）
  const photoBufs: Buffer[] = Array.isArray(photos)
    ? photos.slice(0, 3).map((p: unknown) => decodePhoto(p)).filter((b): b is Buffer => b != null)
    : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const uname = (await client.query(`SELECT COALESCE(display_name, username) AS username FROM users WHERE id = $1`, [userId])).rows[0]?.username ?? 'わたし';
    // 1) グループ（無ければ個人用を自動作成）
    let gids = (await client.query(`SELECT group_id FROM group_members WHERE user_id = $1 ORDER BY group_id`, [userId]))
      .rows.map((r) => r.group_id as number);
    if (!gids.length) {
      const code = crypto.randomBytes(16).toString('hex');
      const g = await client.query(`INSERT INTO user_groups (name, invite_code) VALUES ($1, $2) RETURNING id`, [`${uname}の家計簿`, code]);
      await client.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')`, [g.rows[0].id, userId]);
      gids = [g.rows[0].id];
    }
    const requestedGroups = Array.isArray(group_ids)
      ? [...new Set(group_ids.map(Number).filter(Number.isInteger))]
      : [];
    const requestedGroup = Number(group_id);
    let targetGroupIds: number[];
    if (requestedGroups.length) {
      if (requestedGroups.some((id) => !gids.includes(id))) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: '選択した家計簿スペースの一部に参加していません' });
      }
      targetGroupIds = requestedGroups;
    } else if (Number.isInteger(requestedGroup)) {
      if (!gids.includes(requestedGroup)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'この家計簿スペースには参加していません' });
      }
      targetGroupIds = [requestedGroup];
    } else {
      const active = (await client.query(`SELECT active_group_id FROM user_settings WHERE user_id = $1`, [userId])).rows[0]?.active_group_id;
      targetGroupIds = [active && gids.includes(active) ? active : gids[0]];
    }
    // 2〜4) 選択した各家計簿の日常プロジェクトへ同じ記録を保存する。
    // ごほうび計算はループ外で一度だけ行うため、複数保存でも二重付与されない。
    const savedReceipts: { receipt_id: number; trip_id: number; group_id: number }[] = [];
    for (const targetGroupId of targetGroupIds) {
      let trip = (await client.query(
        `SELECT id FROM trips WHERE group_id = $1 AND kind = 'daily' ORDER BY id LIMIT 1`, [targetGroupId]
      )).rows[0];
      if (!trip) {
        trip = (await client.query(
          `INSERT INTO trips (title, kind, group_id) VALUES ($1, 'daily', $2) RETURNING id`,
          [`${uname}の家計簿`, targetGroupId]
        )).rows[0];
      }
      let member = (await client.query(`SELECT id FROM members WHERE trip_id = $1 AND name = $2 LIMIT 1`, [trip.id, uname])).rows[0]
        ?? (await client.query(`SELECT id FROM members WHERE trip_id = $1 ORDER BY id LIMIT 1`, [trip.id])).rows[0];
      if (!member) {
        member = (await client.query(`INSERT INTO members (trip_id, name) VALUES ($1, $2) RETURNING id`, [trip.id, uname])).rows[0];
      }
      const receipt = await client.query(
        `INSERT INTO receipts (trip_id, store_name, purchased_on, paid_by, category, lat, lng, place_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [trip.id, storeStr, day, member.id,
         typeof category === 'string' && category ? category : null,
         latNum, lngNum,
         typeof place_name === 'string' && place_name.trim() ? place_name.trim() : null]
      );
      for (const it of list) {
        const item = await client.query(
          `INSERT INTO items (receipt_id, name, price, quantity, genre) VALUES ($1, $2, $3, 1, $4) RETURNING id`,
          [receipt.rows[0].id, it.name, it.price, it.genre]
        );
        await client.query(`INSERT INTO item_shares (item_id, member_id) VALUES ($1, $2)`, [item.rows[0].id, member.id]);
      }
      for (const buf of photoBufs) {
        await client.query(
          `INSERT INTO trip_photos (trip_id, receipt_id, photo, taken_on) VALUES ($1, $2, $3, $4)`,
          [trip.id, receipt.rows[0].id, buf, day]
        );
      }
      savedReceipts.push({ receipt_id: receipt.rows[0].id, trip_id: trip.id, group_id: targetGroupId });
    }

    // ごほうび: 記録+10XP、その日はじめての記録=チャレンジクリアで+5コイン+5XP、
    // レベルアップしたら+10コイン（設定行がまだ無い＝モード未選択なら何もしない）
    let reward: { xp: number; coins: number; level: number; levelUp: boolean; challengeCleared: boolean } | null = null;
    const sQ = await client.query(`SELECT xp, coins, last_challenge_date FROM user_settings WHERE user_id = $1 FOR UPDATE`, [userId]);
    if (sQ.rows[0]) {
      const cur = sQ.rows[0];
      const todayQ = await client.query(`SELECT (($1::date IS NULL) OR ($1::date < CURRENT_DATE)) AS fresh`, [cur.last_challenge_date]);
      const challengeCleared = todayQ.rows[0].fresh === true;
      let xpGain = 10 + (challengeCleared ? 5 : 0);
      let coinGain = challengeCleared ? 5 : 0;
      const before = levelOf(cur.xp);
      const after = levelOf(cur.xp + xpGain);
      if (after > before) coinGain += 10;
      await client.query(
        `UPDATE user_settings SET xp = xp + $1, coins = coins + $2,
                last_challenge_date = CASE WHEN $3 THEN CURRENT_DATE ELSE last_challenge_date END
          WHERE user_id = $4`,
        [xpGain, coinGain, challengeCleared, userId]
      );
      reward = { xp: xpGain, coins: coinGain, level: after, levelUp: after > before, challengeCleared };
    }

    await client.query('COMMIT');
    res.status(201).json({
      receipt_id: savedReceipts[0].receipt_id,
      trip_id: savedReceipts[0].trip_id,
      receipts: savedReceipts,
      reward,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    serverError(res, e);
  } finally {
    client.release();
  }
});

// ---- 親子アカウント連携（親=おとな が 子=こども を見守る） -------------------
// 連携コードの英数字（紛らわしい I/O/0/1 を除外）。crypto.randomInt で偏りなく生成。
const LINK_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LINK_CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;
function genLinkCode(): string {
  let out = '';
  for (let i = 0; i < 8; i++) out += LINK_ALPHABET[crypto.randomInt(LINK_ALPHABET.length)];
  return out;
}

// このユーザーは誰かの子として連携中か（true=おとなモード切替禁止 等）
async function isLinkedChild(userId: number): Promise<boolean> {
  const { rows } = await pool.query(`SELECT 1 FROM account_links WHERE child_user_id = $1`, [userId]);
  return rows.length > 0;
}
// parentId が childId の親として連携しているか（子データ閲覧・送金の権限チェック）
async function isParentOf(parentId: number, childId: number): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM account_links WHERE parent_user_id = $1 AND child_user_id = $2`, [parentId, childId]);
  return rows.length > 0;
}

// 連携コード発行（親側）。既存の未使用コードは破棄して1親1コードに保つ。
api.post('/links/code', async (req, res) => {
  const userId = uid(req);
  try {
    if (await isLinkedChild(userId)) {
      return res.status(400).json({ error: '連携中のアカウントは 親になれません' });
    }
    await pool.query(`DELETE FROM link_codes WHERE parent_user_id = $1 AND used = false`, [userId]);
    // PK 衝突は極めて稀だが、数回だけ引き直す
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = genLinkCode();
      try {
        const { rows } = await pool.query(
          `INSERT INTO link_codes (code, parent_user_id, expires_at)
           VALUES ($1, $2, now() + interval '10 minutes') RETURNING code, expires_at`,
          [code, userId]);
        return res.json({ code: rows[0].code, expires_at: rows[0].expires_at });
      } catch (e: any) {
        if (e?.code !== '23505') throw e; // コード重複以外は本物のエラー
      }
    }
    return res.status(500).json({ error: 'コードの発行に失敗しました。もう一度お試しください' });
  } catch (e) {
    serverError(res, e);
  }
});

// 連携（子側）。コードを入力して親と結ぶ。1ユーザー1分10回の簡易レート制限。
// ※ メモリ上(Mapインスタンス毎)のため、Vercel等のサーバーレスでは関数インスタンスが複数
//   立ち上がると制限がインスタンス毎にリセットされ実質弱まる。実害の小さい簡易ガードなので
//   許容し、DB化などの対応はしない（コメントのみ追記）。
const joinHits = new Map<number, number[]>();
api.post('/links/join', async (req, res) => {
  const userId = uid(req);
  const now = Date.now();
  const hits = (joinHits.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= 10) return res.status(429).json({ error: '回数制限に達しました。少し待ってから試してください' });
  hits.push(now);
  joinHits.set(userId, hits);

  const code = typeof (req.body ?? {}).code === 'string' ? (req.body.code as string).trim().toUpperCase() : '';
  const badCode = { error: 'コードが ちがうか きげんぎれだよ' };
  if (!LINK_CODE_RE.test(code)) return res.status(400).json(badCode);
  try {
    const cQ = await pool.query(
      `SELECT parent_user_id FROM link_codes WHERE code = $1 AND used = false AND expires_at > now()`, [code]);
    const codeRow = cQ.rows[0];
    if (!codeRow) return res.status(400).json(badCode);
    const parentId = codeRow.parent_user_id as number;
    if (parentId === userId) return res.status(400).json({ error: 'じぶんのコードは つかえないよ' });
    if (await isLinkedChild(userId)) return res.status(400).json({ error: 'もう おうちと つながってるよ' });
    // 親自身が誰かの子として連携中なら親になれない
    if (await isLinkedChild(parentId)) return res.status(400).json({ error: 'そのコードは いま つかえないよ' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const linkQ = await client.query(
        `INSERT INTO account_links (parent_user_id, child_user_id) VALUES ($1, $2) RETURNING id`,
        [parentId, userId]);
      await client.query(`UPDATE link_codes SET used = true WHERE code = $1`, [code]);
      const pQ = await client.query(`SELECT COALESCE(display_name, username) AS username FROM users WHERE id = $1`, [parentId]);
      await client.query('COMMIT');
      res.status(201).json({ id: linkQ.rows[0].id, parent: { username: pQ.rows[0]?.username ?? '' } });
    } catch (e: any) {
      await client.query('ROLLBACK');
      if (e?.code === '23505') return res.status(400).json({ error: 'もう おうちと つながってるよ' });
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    serverError(res, e);
  }
});

// 連携の一覧（親としての子ども達＋子としての親）
api.get('/links', async (req, res) => {
  const userId = uid(req);
  try {
    const asParentQ = await pool.query(
      `SELECT al.id, al.child_user_id, COALESCE(u.display_name, u.username) AS username, al.created_at
         FROM account_links al JOIN users u ON u.id = al.child_user_id
        WHERE al.parent_user_id = $1 ORDER BY al.id`, [userId]);
    const asChildQ = await pool.query(
      `SELECT al.id, COALESCE(u.display_name, u.username) AS username
         FROM account_links al JOIN users u ON u.id = al.parent_user_id
        WHERE al.child_user_id = $1`, [userId]);
    res.json({ asParent: asParentQ.rows, asChild: asChildQ.rows[0] ?? null });
  } catch (e) {
    serverError(res, e);
  }
});

// 連携の解除（当事者=親か子のどちらかのみ。他人は 404）
api.delete('/links/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM account_links WHERE id = $1 AND ($2 IN (parent_user_id, child_user_id))`,
      [id, uid(req)]);
    if (!rowCount) return res.status(404).json({ error: 'not found' });
    res.status(204).end();
  } catch (e) {
    serverError(res, e);
  }
});

// 子の様子（親のみ・読み取り専用）。おさいふ・今月収支・目標・直近の記録。
api.get('/children/:childId/overview', async (req, res) => {
  const parentId = uid(req);
  const childId = Number(req.params.childId);
  if (!Number.isInteger(childId)) return res.status(400).json({ error: 'invalid id' });
  try {
    if (!(await isParentOf(parentId, childId))) return res.status(404).json({ error: 'not found' });
    const gids = await userGroupIds(childId);
    const zero = { rows: [{ total: 0 }] };

    const userQ = await pool.query(`SELECT COALESCE(display_name, username) AS username FROM users WHERE id = $1`, [childId]);
    const settingsQ = await pool.query(`SELECT balance_start FROM user_settings WHERE user_id = $1`, [childId]);
    const balanceStart = settingsQ.rows[0]?.balance_start ?? 0;

    const monthSpendQ = gids.length ? await pool.query(
      `SELECT COALESCE(SUM(i.price), 0)::int AS total
         FROM receipts r JOIN items i ON i.receipt_id = r.id JOIN trips t ON t.id = r.trip_id
        WHERE t.group_id = ANY($1::int[])
          AND date_trunc('month', r.purchased_on) = date_trunc('month', CURRENT_DATE)`, [gids]) : zero;
    const allSpendQ = gids.length ? await pool.query(
      `SELECT COALESCE(SUM(i.price), 0)::int AS total
         FROM receipts r JOIN items i ON i.receipt_id = r.id JOIN trips t ON t.id = r.trip_id
        WHERE t.group_id = ANY($1::int[])`, [gids]) : zero;
    const incomeQ = await pool.query(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE date_trunc('month', on_date) = date_trunc('month', CURRENT_DATE)), 0)::int AS month,
              COALESCE(SUM(amount), 0)::int AS total
         FROM incomes WHERE user_id = $1`, [childId]);
    const goalsQ = await pool.query(
      `SELECT id, name, emoji, target, saved, done, deadline FROM savings_goals WHERE user_id = $1 ORDER BY done, id DESC`, [childId]);
    const savedAll = goalsQ.rows.reduce((a, g) => a + g.saved, 0);
    // 直近10件: 子が所属するグループのレシート。先頭品名と合計だけ。
    const recentQ = gids.length ? await pool.query(
      `SELECT r.store_name, COALESCE(SUM(i.price), 0)::int AS total, r.purchased_on,
              (SELECT i2.name FROM items i2 WHERE i2.receipt_id = r.id ORDER BY i2.id LIMIT 1) AS first_item
         FROM receipts r
         JOIN trips t ON t.id = r.trip_id
         JOIN group_members gm ON gm.group_id = t.group_id AND gm.user_id = $1
         LEFT JOIN items i ON i.receipt_id = r.id
        GROUP BY r.id
        ORDER BY r.purchased_on DESC, r.id DESC
        LIMIT 10`, [childId]) : { rows: [] };

    const wallet = balanceStart + incomeQ.rows[0].total - allSpendQ.rows[0].total - savedAll;
    res.json({
      username: userQ.rows[0]?.username ?? '',
      wallet,
      month: { spend: monthSpendQ.rows[0].total, income: incomeQ.rows[0].month },
      goals: goalsQ.rows,
      recent: recentQ.rows,
    });
  } catch (e) {
    serverError(res, e);
  }
});

// おこづかい送金（親のみ）。子の incomes に1件作成する。
api.post('/children/:childId/allowance', async (req, res) => {
  const parentId = uid(req);
  const childId = Number(req.params.childId);
  if (!Number.isInteger(childId)) return res.status(400).json({ error: 'invalid id' });
  const { amount, name } = req.body ?? {};
  const a = Math.round(Number(amount));
  if (!Number.isInteger(a) || a < 1 || a > 2_000_000_000) {
    return res.status(400).json({ error: '金額は 1〜20億の整数で入れてね' });
  }
  const label = typeof name === 'string' && name.trim() ? name.trim() : 'おこづかい（おうちから）';
  try {
    if (!(await isParentOf(parentId, childId))) return res.status(404).json({ error: 'not found' });
    const { rows } = await pool.query(
      `INSERT INTO incomes (user_id, name, amount) VALUES ($1, $2, $3) RETURNING id, amount, name`,
      [childId, label, a]);
    res.status(201).json(rows[0]);
  } catch (e) {
    serverError(res, e);
  }
});

// ---- お手伝いポイント（親がメニュー登録→子が申請→親が承認で加点） -----------------
// 子の残高（user_settings.chore_points）を安全に読む。設定行が無ければ 0。
async function childChorePoints(userId: number): Promise<number> {
  const { rows } = await pool.query(`SELECT chore_points FROM user_settings WHERE user_id = $1`, [userId]);
  return rows[0]?.chore_points ?? 0;
}

// メニュー登録（親のみ）。名前1〜20文字・ポイント1〜100000。
api.post('/children/:childId/chores', async (req, res) => {
  const parentId = uid(req);
  const childId = Number(req.params.childId);
  if (!Number.isInteger(childId)) return res.status(400).json({ error: 'invalid id' });
  const name = typeof (req.body ?? {}).name === 'string' ? req.body.name.trim() : '';
  const points = Math.round(Number((req.body ?? {}).points));
  if (name.length < 1 || name.length > 20) return res.status(400).json({ error: 'なまえは 1〜20文字で いれてね' });
  if (!Number.isInteger(points) || points < 1 || points > 100000) {
    return res.status(400).json({ error: 'ポイントは 1〜100000の整数で いれてね' });
  }
  try {
    const linkQ = await pool.query(
      `SELECT id FROM account_links WHERE parent_user_id = $1 AND child_user_id = $2`, [parentId, childId]);
    const linkId = linkQ.rows[0]?.id;
    if (!linkId) return res.status(404).json({ error: 'not found' });
    const { rows } = await pool.query(
      `INSERT INTO chores (link_id, name, points) VALUES ($1, $2, $3) RETURNING id, name, points`,
      [linkId, name, points]);
    res.status(201).json(rows[0]);
  } catch (e) {
    serverError(res, e);
  }
});

// メニュー削除（親のみ・ソフト削除）。pending の申請は残し、承認/却下は引き続き可能。
api.delete('/chores/:id', async (req, res) => {
  const parentId = uid(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const { rowCount } = await pool.query(
      `UPDATE chores c SET active = false
         FROM account_links al
        WHERE c.id = $1 AND al.id = c.link_id AND al.parent_user_id = $2`,
      [id, parentId]);
    if (!rowCount) return res.status(404).json({ error: 'not found' });
    res.status(204).end();
  } catch (e) {
    serverError(res, e);
  }
});

// 子側: 選べるメニュー＋自分の申請状況＋残高。連携なしでも残高は見える。
api.get('/chores', async (req, res) => {
  const userId = uid(req);
  try {
    const points = await childChorePoints(userId);
    const choresQ = await pool.query(
      `SELECT c.id, c.name, c.points,
              EXISTS (SELECT 1 FROM chore_logs cl
                       WHERE cl.chore_id = c.id AND cl.child_user_id = $1 AND cl.status = 'pending') AS pending
         FROM chores c JOIN account_links al ON al.id = c.link_id
        WHERE al.child_user_id = $1 AND c.active
        ORDER BY c.id`, [userId]);
    const histQ = await pool.query(
      `SELECT cl.id, c.name, cl.points, cl.status, cl.created_at
         FROM chore_logs cl JOIN chores c ON c.id = cl.chore_id
        WHERE cl.child_user_id = $1
        ORDER BY cl.id DESC LIMIT 10`, [userId]);
    res.json({ points, chores: choresQ.rows, history: histQ.rows });
  } catch (e) {
    serverError(res, e);
  }
});

// 子側: お手伝い申請。同一メニューに pending が既にあれば 400。1分10回のレート制限。
// ※ joinHits 同様メモリ上の制限。サーバーレスでは弱まるが許容（DB化はしない）。
const claimHits = new Map<number, number[]>();
api.post('/chores/:id/claim', async (req, res) => {
  const userId = uid(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  const now = Date.now();
  const hits = (claimHits.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= 10) return res.status(429).json({ error: '回数制限に達しました。少し待ってから試してください' });
  hits.push(now);
  claimHits.set(userId, hits);
  try {
    const cQ = await pool.query(
      `SELECT c.id, c.points FROM chores c JOIN account_links al ON al.id = c.link_id
        WHERE c.id = $1 AND al.child_user_id = $2 AND c.active`, [id, userId]);
    const chore = cQ.rows[0];
    if (!chore) return res.status(404).json({ error: 'not found' });
    const dupQ = await pool.query(
      `SELECT 1 FROM chore_logs WHERE chore_id = $1 AND child_user_id = $2 AND status = 'pending'`, [id, userId]);
    if (dupQ.rows.length) return res.status(400).json({ error: 'もう おうちのひとに つたえてあるよ' });
    const { rows } = await pool.query(
      `INSERT INTO chore_logs (chore_id, child_user_id, points) VALUES ($1, $2, $3) RETURNING id`,
      [id, userId, chore.points]);
    res.status(201).json({ id: rows[0].id });
  } catch (e) {
    serverError(res, e);
  }
});

// 親側: 子のメニュー一覧（active のみ）＋pending 申請＋残高。
api.get('/children/:childId/chores', async (req, res) => {
  const parentId = uid(req);
  const childId = Number(req.params.childId);
  if (!Number.isInteger(childId)) return res.status(400).json({ error: 'invalid id' });
  try {
    const linkQ = await pool.query(
      `SELECT id FROM account_links WHERE parent_user_id = $1 AND child_user_id = $2`, [parentId, childId]);
    const linkId = linkQ.rows[0]?.id;
    if (!linkId) return res.status(404).json({ error: 'not found' });
    const points = await childChorePoints(childId);
    const menuQ = await pool.query(
      `SELECT id, name, points, active FROM chores WHERE link_id = $1 AND active ORDER BY id`, [linkId]);
    const pendingQ = await pool.query(
      `SELECT cl.id, c.name AS chore_name, cl.points, cl.created_at
         FROM chore_logs cl JOIN chores c ON c.id = cl.chore_id
        WHERE c.link_id = $1 AND cl.status = 'pending'
        ORDER BY cl.id`, [linkId]);
    res.json({ points, menu: menuQ.rows, pending: pendingQ.rows });
  } catch (e) {
    serverError(res, e);
  }
});

// 親側: 申請の承認/却下（当事者の親のみ・pending のみ）。承認は残高に加点。
async function decideChore(req: Request, res: any, approve: boolean) {
  const parentId = uid(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const logQ = await client.query(
      `SELECT cl.id, cl.status, cl.points, cl.child_user_id
         FROM chore_logs cl JOIN chores c ON c.id = cl.chore_id
         JOIN account_links al ON al.id = c.link_id
        WHERE cl.id = $1 AND al.parent_user_id = $2 FOR UPDATE OF cl`,
      [id, parentId]);
    const log = logQ.rows[0];
    if (!log) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'not found' }); }
    if (log.status !== 'pending') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'もう しょりずみだよ' }); }
    const status = approve ? 'approved' : 'rejected';
    await client.query(
      `UPDATE chore_logs SET status = $1, decided_at = now() WHERE id = $2`, [status, id]);
    if (approve) {
      // 残高加点。設定行が無くても安全に作る（ON CONFLICT で加算）。
      await client.query(
        `INSERT INTO user_settings (user_id, chore_points) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET chore_points = user_settings.chore_points + EXCLUDED.chore_points`,
        [log.child_user_id, log.points]);
    }
    await client.query('COMMIT');
    res.json({ status });
  } catch (e) {
    await client.query('ROLLBACK');
    serverError(res, e);
  } finally {
    client.release();
  }
}
api.post('/chore-logs/:id/approve', (req, res) => decideChore(req, res, true));
api.post('/chore-logs/:id/reject', (req, res) => decideChore(req, res, false));

// 子側: ポイントを ¥ かコインへ全額交換（連携不要・残高があれば可）。
api.post('/chores/exchange', async (req, res) => {
  const userId = uid(req);
  const to = (req.body ?? {}).to;
  if (to !== 'yen' && to !== 'coin') return res.status(400).json({ error: 'to は yen か coin です' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sQ = await client.query(
      `SELECT chore_points, coins FROM user_settings WHERE user_id = $1 FOR UPDATE`, [userId]);
    const pt = sQ.rows[0]?.chore_points ?? 0;
    if (to === 'yen') {
      if (pt <= 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'ポイントが ないよ' }); }
      await client.query(
        `INSERT INTO incomes (user_id, name, amount) VALUES ($1, $2, $3)`,
        [userId, 'おてつだいポイント（¥にこうかん）', pt]);
      await client.query(`UPDATE user_settings SET chore_points = 0 WHERE user_id = $1`, [userId]);
      await client.query('COMMIT');
      return res.json({ yen: pt });
    } else {
      if (pt < 5) { await client.query('ROLLBACK'); return res.status(400).json({ error: '5ポイントから コインにできるよ' }); }
      const coins = Math.floor(pt / 5);
      const rest = pt % 5;
      await client.query(
        `UPDATE user_settings SET coins = coins + $1, chore_points = $2 WHERE user_id = $3`,
        [coins, rest, userId]);
      await client.query('COMMIT');
      return res.json({ coins, restPoints: rest });
    }
  } catch (e) {
    await client.query('ROLLBACK');
    serverError(res, e);
  } finally {
    client.release();
  }
});
