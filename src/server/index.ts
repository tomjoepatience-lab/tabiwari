import 'dotenv/config';
import express from 'express';
import path from 'path';
import { checkDb } from './db';
import { api } from './api';
import { auth, attachUser, requireAuth } from './auth';

// 保険: 想定外の未処理エラーでサーバプロセスごと落とさない（Neon の接続断など）
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection（継続）:', reason instanceof Error ? reason.message : reason);
});
process.on('uncaughtException', (err) => {
  console.error('uncaughtException（継続）:', err.message);
});

const app = express();
app.use(express.json({ limit: '8mb' })); // 縮小済み写真(base64)を受け取れるよう拡張

// public/ は repo ルート。dev(tsx)=src/server, 本番(dist/server) どちらからも ../../public に解決される。
const publicDir = path.join(__dirname, '..', '..', 'public');

// 3層が繋がっているかの確認用エンドポイント
app.get('/api/health', async (_req, res) => {
  const db = (await checkDb()) ? 'connected' : 'down';
  res.json({ ok: true, db });
});

app.use(attachUser);              // 有効セッションなら req.userId を付与
app.use('/api/auth', auth);       // 登録・ログイン・ログアウト・me（認証不要）
app.use('/api', requireAuth, api);// プロジェクト系APIはログイン必須＋グループで絞り込み

app.use(express.static(publicDir));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`TabiWari server listening on http://localhost:${port}`);
});
