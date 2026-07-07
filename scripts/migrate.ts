// schema.sql だけを実行するマイグレーション（seed は流さない・冪等）
import 'dotenv/config';
import { readFileSync } from 'fs';
import path from 'path';
import { pool } from '../src/server/db';

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL が未設定です（.env を確認してください）');
    process.exit(1);
  }
  try {
    const sql = readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf8');
    await pool.query(sql);
    console.log('✓ schema.sql 適用完了');
  } catch (e) {
    console.error('失敗:', (e as Error).message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
