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
  const { email, display_name, username, password } = req.body ?? {};
  const displayName = typeof display_name === 'string' ? display_name.trim()
    : typeof username === 'string' ? username.trim() : '';
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: '有効なメールアドレスを入力してください' });
  }
  if (displayName.length < 2 || displayName.length > 30) {
    return res.status(400).json({ error: '表示名は2〜30文字で入力してください' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'パスワードは8文字以上で入力してください' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // username列は旧版互換の内部IDとして残す。画面表示にはdisplay_nameだけを使う。
    const internalUsername = `u_${crypto.randomBytes(12).toString('hex')}`;
    const { rows } = await client.query(
      `INSERT INTO users (username, email, display_name, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, display_name, display_name AS username`,
      [internalUsername, normalizedEmail, displayName, hashPassword(password)]
    );
    const userId = rows[0].id;
    // 個人利用にすぐ使えるよう、登録時に自分用グループを自動作成（共有は後から招待でOK）
    const code = crypto.randomBytes(16).toString('hex');
    const g = await client.query(
      `INSERT INTO user_groups (name, invite_code) VALUES ($1, $2) RETURNING id`,
      [`${displayName}の家計簿`, code]
    );
    await client.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')`, [g.rows[0].id, userId]);
    await client.query('COMMIT');
    // 登録は自動ログインを兼ねるので、初回ログインとして記録する
    await pool.query(`UPDATE users SET last_login_at = now(), login_count = 1 WHERE id = $1`, [userId]);
    console.log(`[auth] register: ${normalizedEmail} (id ${userId})`);
    await createSession(res, userId);
    res.status(201).json({ user: rows[0] });
  } catch (e: any) {
    await client.query('ROLLBACK');
    if (e?.code === '23505') return res.status(409).json({ error: 'そのメールアドレスは既に登録されています' });
    console.error(e);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  } finally {
    client.release();
  }
});

auth.post('/login', async (req, res) => {
  const { email, username, password } = req.body ?? {};
  // 旧ユーザーはメール未登録なので、移行期間中は従来のユーザー名でもログインできる。
  const identifier = typeof email === 'string' ? email.trim() : typeof username === 'string' ? username.trim() : '';
  if (!identifier || typeof password !== 'string') {
    return res.status(400).json({ error: 'メールアドレスとパスワードを入力してください' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, username, email, display_name, password_hash
         FROM users
        WHERE lower(email) = lower($1) OR username = $1
        LIMIT 1`,
      [identifier]
    );
    const u = rows[0];
    if (!u || !verifyPassword(password, u.password_hash)) {
      return res.status(401).json({ error: 'メールアドレスまたはパスワードが違います' });
    }
    await pool.query(`UPDATE users SET last_login_at = now(), login_count = login_count + 1 WHERE id = $1`, [u.id]);
    console.log(`[auth] login: ${u.email ?? u.username} (id ${u.id})`);
    await createSession(res, u.id);
    res.json({ user: { id: u.id, email: u.email, username: u.display_name ?? u.username } });
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

// App Store要件: アプリ内でアカウントと関連データを完全削除できる。
// 誤操作・セッション乗っ取り対策として現在のパスワードを再確認する。
auth.delete('/account', async (req, res) => {
  const userId = (req as any).userId as number | undefined;
  const { password } = req.body ?? {};
  if (!userId) return res.status(401).json({ error: 'ログインが必要です' });
  if (typeof password !== 'string') return res.status(400).json({ error: 'パスワードを入力してください' });
  try {
    const { rows } = await pool.query(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
    if (!rows[0] || !verifyPassword(password, rows[0].password_hash)) {
      return res.status(401).json({ error: 'パスワードが違います' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // 本人しかいないスペースは家計データごと削除。共有中のスペースは他メンバーのため残し、
      // 本人のmembershipだけがusersのCASCADEで外れる。
      await client.query(
        `DELETE FROM user_groups g
          WHERE EXISTS (
            SELECT 1 FROM group_members mine WHERE mine.group_id = g.id AND mine.user_id = $1
          )
            AND NOT EXISTS (
            SELECT 1 FROM group_members other WHERE other.group_id = g.id AND other.user_id <> $1
          )`,
        [userId]
      );
      await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    clearSessionCookie(res);
    res.status(204).end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'アカウントを削除できませんでした' });
  }
});

// 招待URLを未ログインでもプレビューできる。トークン自体以外の個人情報は返さない。
auth.get('/invites/:token', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.name, gi.expires_at
         FROM group_invites gi
         JOIN user_groups g ON g.id = gi.group_id
        WHERE gi.token = $1
          AND gi.revoked_at IS NULL
          AND gi.expires_at > now()
          AND gi.use_count < gi.max_uses`,
      [req.params.token]
    );
    if (!rows[0]) return res.status(404).json({ error: 'この招待は無効または期限切れです' });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

// 現在のユーザー＋所属グループ
auth.get('/me', async (req, res) => {
  const userId = (req as any).userId as number | undefined;
  if (!userId) return res.status(401).json({ error: '未ログイン' });
  try {
    const userQ = await pool.query(
      `SELECT id, email, COALESCE(display_name, username) AS username FROM users WHERE id = $1`,
      [userId]
    );
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
