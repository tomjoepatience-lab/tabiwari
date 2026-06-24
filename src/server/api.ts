import { Router, Request } from 'express';
import crypto from 'crypto';
import { pool } from './db';
import { summarize, CalcReceipt } from './calc';
import { extractReceipt } from './ocr';
import { userGroupIds } from './auth';

export const api = Router();

// requireAuth 通過後なので userId は必ずある
const uid = (req: Request) => (req as any).userId as number;

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
  const code = crypto.randomBytes(4).toString('hex');
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
    res.status(500).json({ error: (e as Error).message });
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

// ---- レシートOCR（Claude vision で明細抽出） -------------------------
api.post('/ocr', async (req, res) => {
  const { image } = req.body ?? {};
  if (typeof image !== 'string' || !image) {
    return res.status(400).json({ error: 'image（レシート画像）は必須です' });
  }
  try {
    res.json(await extractReceipt(image));
  } catch (e) {
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
    `SELECT id, name FROM members WHERE trip_id = $1 ORDER BY id`,
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
        `SELECT item_id, member_id FROM item_shares WHERE item_id = ANY($1::int[])`,
        [itemIds]
      )
    : { rows: [] as any[] };

  // item_id -> member_ids
  const sharesByItem = new Map<number, number[]>();
  for (const s of sharesQ.rows) {
    const arr = sharesByItem.get(s.item_id) ?? [];
    arr.push(s.member_id);
    sharesByItem.set(s.item_id, arr);
  }

  // receipt_id -> items（負担者付き）
  const itemsByReceipt = new Map<number, any[]>();
  for (const it of itemsQ.rows) {
    const arr = itemsByReceipt.get(it.receipt_id) ?? [];
    arr.push({ ...it, member_ids: sharesByItem.get(it.id) ?? [] });
    itemsByReceipt.set(it.receipt_id, arr);
  }

  const receipts = receiptsQ.rows.map((r) => {
    const items = itemsByReceipt.get(r.id) ?? [];
    const total = items.reduce((s, it) => s + it.price, 0);
    return { ...r, items, total };
  });

  // 思い出写真（レシートとは別。アルバムの素材）
  const photosQ = await pool.query(
    `SELECT id, caption, taken_on, sort_order FROM trip_photos
      WHERE trip_id = $1 ORDER BY sort_order, taken_on NULLS LAST, id`,
    [tripId]
  );

  const memberIds = membersQ.rows.map((m) => m.id);
  const calcReceipts: CalcReceipt[] = receipts.map((r) => ({
    paidBy: r.paid_by,
    items: r.items.map((it: any) => ({ price: it.price, memberIds: it.member_ids })),
  }));
  const summary = summarize(memberIds, calcReceipts);

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
  const { name } = req.body ?? {};
  if (!Number.isInteger(tripId)) return res.status(400).json({ error: 'invalid id' });
  if (!(await tripAccessible(uid(req), tripId))) return res.status(404).json({ error: 'not found' });
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name は必須です' });
  const { rows } = await pool.query(
    `INSERT INTO members (trip_id, name) VALUES ($1, $2) RETURNING id, name`,
    [tripId, name]
  );
  res.status(201).json(rows[0]);
});

// ---- レシート（明細＋負担者をまとめて登録） --------------------------

api.post('/trips/:id/receipts', async (req, res) => {
  const tripId = Number(req.params.id);
  if (!Number.isInteger(tripId)) return res.status(400).json({ error: 'invalid id' });
  if (!(await tripAccessible(uid(req), tripId))) return res.status(404).json({ error: 'not found' });

  const { store_name, category, purchased_on, paid_by, lat, lng, place_name, photo, items } = req.body ?? {};
  if (!purchased_on) return res.status(400).json({ error: 'purchased_on は必須です' });
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: '明細(items)を1件以上指定してください' });
  }
  for (const it of items) {
    if (!it || typeof it.name !== 'string' || !it.name) {
      return res.status(400).json({ error: '明細の name は必須です' });
    }
    if (!Number.isInteger(it.price) || it.price <= 0) {
      return res.status(400).json({ error: '明細の price は正の整数で指定してください' });
    }
  }

  // 写真は dataURL or 素の base64 で受け取り、Buffer にして BYTEA へ
  let photoBuf: Buffer | null = null;
  if (typeof photo === 'string' && photo) {
    const base64 = photo.includes(',') ? photo.split(',')[1] : photo;
    photoBuf = Buffer.from(base64, 'base64');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const receiptQ = await client.query(
      `INSERT INTO receipts (trip_id, store_name, category, purchased_on, paid_by, lat, lng, place_name, photo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [tripId, store_name || null, category || null, purchased_on, paid_by || null, lat ?? null, lng ?? null, place_name || null, photoBuf]
    );
    const receiptId = receiptQ.rows[0].id;

    for (const it of items) {
      const itemQ = await client.query(
        `INSERT INTO items (receipt_id, name, price, quantity) VALUES ($1,$2,$3,$4) RETURNING id`,
        [receiptId, it.name, it.price, it.quantity && it.quantity > 0 ? it.quantity : 1]
      );
      const itemId = itemQ.rows[0].id;
      const memberIds: number[] = Array.isArray(it.member_ids) ? it.member_ids : [];
      for (const m of memberIds) {
        await client.query(
          `INSERT INTO item_shares (item_id, member_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [itemId, m]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ id: receiptId });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: (e as Error).message });
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
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(buf);
});

// ---- 思い出写真（旅行のアルバム素材。レシートとは別） ----------------

// dataURL or 素の base64 → Buffer
function decodePhoto(photo: unknown): Buffer | null {
  if (typeof photo !== 'string' || !photo) return null;
  const base64 = photo.includes(',') ? photo.split(',')[1] : photo;
  return Buffer.from(base64, 'base64');
}

// 1枚アップロード
api.post('/trips/:id/photos', async (req, res) => {
  const tripId = Number(req.params.id);
  if (!Number.isInteger(tripId)) return res.status(400).json({ error: 'invalid id' });
  if (!(await tripAccessible(uid(req), tripId))) return res.status(404).json({ error: 'not found' });
  const { photo, caption, taken_on } = req.body ?? {};
  const buf = decodePhoto(photo);
  if (!buf) return res.status(400).json({ error: 'photo（写真）は必須です' });
  const { rows } = await pool.query(
    `INSERT INTO trip_photos (trip_id, photo, caption, taken_on)
     VALUES ($1,$2,$3,$4) RETURNING id, caption, taken_on, sort_order`,
    [tripId, buf, caption || null, taken_on || null]
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
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(buf);
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
