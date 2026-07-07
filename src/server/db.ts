import { Pool, types } from 'pg';

// DATE(oid=1082) は Date オブジェクトにせず 'YYYY-MM-DD' 文字列のまま返す。
// （JS Date 化すると JSON 化時に UTC へずれて日付が1日前後する問題を防ぐ）
types.setTypeParser(1082, (v) => v);

// DATABASE_URL があればそれを使う（Neon / Render）。なければローカルの既定（PG 環境変数）にフォールバック。
const connectionString = process.env.DATABASE_URL;

// localhost 以外（Neon/Render など）は SSL 必須。localhost は SSL なし。
function needsSsl(cs?: string): boolean {
  if (!cs) return false;
  return !/@(localhost|127\.0\.0\.1)[:/]/.test(cs);
}

export const pool = new Pool(
  connectionString
    ? {
        connectionString,
        ssl: needsSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
        // CURRENT_DATE / date_trunc を日本時間基準にそろえる（Neon/Render は既定UTCで、
        // 深夜の記録が「昨日」扱いになる月境界ズレを防ぐ）
        options: '-c timezone=Asia/Tokyo',
      }
    : { options: '-c timezone=Asia/Tokyo' }
);

// Neon 無料枠は無通信でサスペンドし、アイドル接続が切られることがある。
// このイベントを拾わないと「Connection terminated unexpectedly」でプロセスごと落ちるので握りつぶす
// （次回クエリでプールが新しい接続を張り直すため実害なし）。
pool.on('error', (err) => {
  console.error('pg pool idle client error（無視して継続）:', err.message);
});

// 接続できるかを返す（DB が無くてもサーバは起動させたいので、ここでは投げない）
export async function checkDb(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
