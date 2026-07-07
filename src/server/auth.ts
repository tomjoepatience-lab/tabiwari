// 共有家計簿の認証（ユーザー名＋パスワード＋cookieセッション）
// 外部ライブラリは足さず、Node 標準の crypto と素のcookie操作で実装。
import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { pool } from './db';

export const auth = Router();
const COOKIE = 'sid';
const MAX_AGE = 60 * 60 * 24 * 30; // 30日

// ---- パスワード（scrypt） --------------------------------------------
function hashPassword(password: string, salt = crypto.randomBytes(16).toString('hex')): string {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const known = Buffer.from(hash, 'hex');
  return known.length === test.length && crypto.timingSafeEqual(known, test);
}

// ---- cookie ----------------------------------------------------------
function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = req.headers.cookie;
  if (raw) for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
// 本番（DBがリモート=HTTPS運用）では Secure を付けて平文HTTPへのトークン送信を防ぐ
const SECURE = !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '') ? '; Secure' : '';
function setSessionCookie(res: Response, token: string) {
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${SECURE}`);
}
function clearSessionCookie(res: Response) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${SECURE}`);
}

// ---- ミドルウェア -----------------------------------------------------
// 有効なセッションがあれば req.userId を立てる（無くても通す）
// Neon の一時的な接続断でセッション照会が失敗すると「未ログイン扱い→401」になり
// 画面全体が壊れるため、失敗時は1回だけリトライする。
export async function attachUser(req: Request, _res: Response, next: NextFunction) {
  const token = parseCookies(req)[COOKIE];
  if (token) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // cookie の Max-Age と同じ30日でサーバー側も失効させる
        const { rows } = await pool.query(
          `SELECT user_id FROM sessions WHERE token = $1 AND created_at > now() - interval '30 days'`, [token]);
        if (rows[0]) (req as any).userId = rows[0].user_id as number;
        break;
      } catch {
        if (attempt === 0) await new Promise((r) => setTimeout(r, 150));
        // 2回目も失敗したら未ログイン扱いで通す
      }
    }
  }
  next();
}
// ログイン必須のルートに付ける
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!(req as any).userId) return res.status(401).json({ error: 'ログインが必要です' });
  next();
}

// ユーザーの所属グループID一覧
export async function userGroupIds(userId: number): Promise<number[]> {
  const { rows } = await pool.query(`SELECT group_id FROM group_members WHERE user_id = $1`, [userId]);
  return rows.map((r) => r.group_id as number);
}

async function createSession(res: Response, userId: number) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(`INSERT INTO sessions (token, user_id) VALUES ($1, $2)`, [token, userId]);
  // ついでに期限切れセッションを掃除（失敗しても致命的でない）
  pool.query(`DELETE FROM sessions WHERE created_at < now() - interval '30 days'`).catch(() => {});
  setSessionCookie(res, token);
}

// ---- ルート -----------------------------------------------------------
auth.post('/register', async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || username.trim().length < 2) {
    return res.status(400).json({ error: 'ユーザー名は2文字以上で入力してください' });
  }
  if (typeof password !== 'string' || password.length < 4) {
    return res.status(400).json({ error: 'パスワードは4文字以上で入力してください' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username`,
      [username.trim(), hashPassword(password)]
    );
    const userId = rows[0].id;
    // 個人利用にすぐ使えるよう、登録時に自分用グループを自動作成（共有は後から招待でOK）
    const code = crypto.randomBytes(16).toString('hex');
    const g = await client.query(
      `INSERT INTO user_groups (name, invite_code) VALUES ($1, $2) RETURNING id`,
      [`${username.trim()}の家計簿`, code]
    );
    await client.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')`, [g.rows[0].id, userId]);
    await client.query('COMMIT');
    await createSession(res, userId);
    res.status(201).json({ user: rows[0] });
  } catch (e: any) {
    await client.query('ROLLBACK');
    if (e?.code === '23505') return res.status(409).json({ error: 'そのユーザー名は既に使われています' });
    console.error(e);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  } finally {
    client.release();
  }
});

auth.post('/login', async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'ユーザー名とパスワードを入力してください' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, username, password_hash FROM users WHERE username = $1`,
      [username.trim()]
    );
    const u = rows[0];
    if (!u || !verifyPassword(password, u.password_hash)) {
      return res.status(401).json({ error: 'ユーザー名またはパスワードが違います' });
    }
    await createSession(res, u.id);
    res.json({ user: { id: u.id, username: u.username } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

auth.post('/logout', async (req, res) => {
  const token = parseCookies(req)[COOKIE];
  if (token) await pool.query(`DELETE FROM sessions WHERE token = $1`, [token]);
  clearSessionCookie(res);
  res.status(204).end();
});

// 現在のユーザー＋所属グループ
auth.get('/me', async (req, res) => {
  const userId = (req as any).userId as number | undefined;
  if (!userId) return res.status(401).json({ error: '未ログイン' });
  try {
    const userQ = await pool.query(`SELECT id, username FROM users WHERE id = $1`, [userId]);
    if (!userQ.rows[0]) return res.status(401).json({ error: '未ログイン' });
    const groupsQ = await pool.query(
      `SELECT g.id, g.name, g.invite_code, gm.role
         FROM group_members gm JOIN user_groups g ON g.id = gm.group_id
        WHERE gm.user_id = $1 ORDER BY g.id`,
      [userId]
    );
    res.json({ user: userQ.rows[0], groups: groupsQ.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});
