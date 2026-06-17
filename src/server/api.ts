import { Router } from 'express';
import { pool } from './db';
import { summarize, CalcReceipt } from './calc';

export const api = Router();

// ---- 旅行 -------------------------------------------------------------

// 一覧（各旅行の合計付き）
api.get('/trips', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT t.id, t.title, t.start_date, t.end_date,
            COALESCE(SUM(i.price), 0)::int AS total
       FROM trips t
       LEFT JOIN receipts r ON r.trip_id = t.id
       LEFT JOIN items i    ON i.receipt_id = r.id
      GROUP BY t.id
      ORDER BY t.created_at DESC`
  );
  res.json(rows);
});

// 作成
api.post('/trips', async (req, res) => {
  const { title, start_date, end_date } = req.body ?? {};
  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'title は必須です' });
  }
  const { rows } = await pool.query(
    `INSERT INTO trips (title, start_date, end_date) VALUES ($1, $2, $3) RETURNING *`,
    [title, start_date || null, end_date || null]
  );
  res.status(201).json(rows[0]);
});

// 詳細（メンバー・レシート・集計・精算をまとめて返す）
api.get('/trips/:id', async (req, res) => {
  const tripId = Number(req.params.id);
  if (!Number.isInteger(tripId)) return res.status(400).json({ error: 'invalid id' });

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
    summary: { total: summary.total, perMember, settlement: summary.settlement },
  });
});

// ---- メンバー ---------------------------------------------------------

api.post('/trips/:id/members', async (req, res) => {
  const tripId = Number(req.params.id);
  const { name } = req.body ?? {};
  if (!Number.isInteger(tripId)) return res.status(400).json({ error: 'invalid id' });
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
  await pool.query(`DELETE FROM receipts WHERE id = $1`, [id]);
  res.status(204).end();
});

// レシート写真を配信（BYTEA をそのまま返す）
api.get('/receipts/:id/photo', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  const { rows } = await pool.query(`SELECT photo FROM receipts WHERE id = $1`, [id]);
  const buf = rows[0]?.photo as Buffer | null | undefined;
  if (!buf) return res.status(404).end();
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(buf);
});

// ---- 分析（旅行横断） -------------------------------------------------

api.get('/analytics', async (_req, res) => {
  const byCategory = await pool.query(
    `SELECT COALESCE(r.category, '未分類') AS category, SUM(i.price)::int AS total
       FROM receipts r JOIN items i ON i.receipt_id = r.id
      GROUP BY 1 ORDER BY total DESC`
  );
  const byTrip = await pool.query(
    `SELECT t.title, COALESCE(SUM(i.price), 0)::int AS total
       FROM trips t
       LEFT JOIN receipts r ON r.trip_id = t.id
       LEFT JOIN items i    ON i.receipt_id = r.id
      GROUP BY t.id ORDER BY total DESC`
  );
  res.json({ byCategory: byCategory.rows, byTrip: byTrip.rows });
});
