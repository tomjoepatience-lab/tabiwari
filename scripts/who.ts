// アクセスの見える化: 全ユーザーを最終ログイン順に一覧表示する（DB直読みのみ・管理エンドポイントは作らない）
// 実行: npx tsx scripts/who.ts
import 'dotenv/config';
import { pool } from '../src/server/db';

// pool は options: '-c timezone=Asia/Tokyo' 済みなので to_char はそのままJST表示になる
const FMT = `to_char($COL$ AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI')`;

(async () => {
  try {
    const { rows } = await pool.query(
      `SELECT username,
              ${FMT.replace('$COL$', 'created_at')} AS created_at,
              ${FMT.replace('$COL$', 'last_login_at')} AS last_login_at,
              login_count
         FROM users
        ORDER BY last_login_at DESC NULLS LAST, created_at DESC`
    );
    if (!rows.length) {
      console.log('ユーザーがいません');
      return;
    }
    const w = Math.max(8, ...rows.map((r) => r.username.length));
    console.log(`${'username'.padEnd(w)}  作成日時          最終ログイン       回数`);
    for (const r of rows) {
      console.log(
        `${r.username.padEnd(w)}  ${r.created_at ?? '-'}  ${(r.last_login_at ?? '(未ログイン)').padEnd(16)}  ${r.login_count}`
      );
    }
  } catch (e) {
    console.error('失敗:', (e as Error).message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
