// 既存の items.genre が NULL の明細を自動分類で埋める（冪等・手直し済みは触らない）
import 'dotenv/config';
import { pool } from '../src/server/db';
import { classifyItem } from '../src/shared/genre';

(async () => {
  try {
    const { rows } = await pool.query(
      `SELECT i.id, i.name, r.store_name FROM items i JOIN receipts r ON r.id = i.receipt_id WHERE i.genre IS NULL`
    );
    let n = 0;
    for (const row of rows) {
      await pool.query(`UPDATE items SET genre = $1 WHERE id = $2`, [classifyItem(row.name, row.store_name), row.id]);
      n++;
    }
    console.log(`✓ ジャンルバックフィル完了: ${n} 件`);
  } catch (e) {
    console.error('失敗:', (e as Error).message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
