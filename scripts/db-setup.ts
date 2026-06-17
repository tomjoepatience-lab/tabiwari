import 'dotenv/config';
import { readFileSync } from 'fs';
import path from 'path';
import { pool } from '../src/server/db';

async function exec(file: string): Promise<void> {
  const sql = readFileSync(path.join(__dirname, '..', 'src', 'db', file), 'utf8');
  await pool.query(sql);
  console.log(`✓ ${file} 実行完了`);
}

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL が未設定です（.env を確認してください）');
    process.exit(1);
  }
  try {
    await exec('schema.sql');
    await exec('seed.sql');
    const r = await pool.query(
      'SELECT (SELECT count(*) FROM trips) AS trips, (SELECT count(*) FROM receipts) AS receipts, (SELECT count(*) FROM item_shares) AS shares'
    );
    console.log('件数:', r.rows[0]);
    console.log('DB セットアップ成功');
  } catch (e) {
    console.error('失敗:', (e as Error).message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
