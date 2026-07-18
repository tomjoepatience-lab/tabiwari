import 'dotenv/config';
import express from 'express';
import path from 'path';
import { checkDb } from './db';
import { api } from './api';
import { auth, attachUser, requireAuth } from './auth';

// 保険: 想定外の未処理エラーでサーバプロセスごと落とさない（Neon の接続断など）
// ※ Vercel(サーバーレス)では1関数=1リクエストなのでプロセス継続の恩恵は薄いが、
//   Render(常駐)側の挙動を変えないためそのまま残す。害はない。
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection（継続）:', reason instanceof Error ? reason.message : reason);
});
process.on('uncaughtException', (err) => {
  console.error('uncaughtException（継続）:', err.message);
});

export const app = express();

// Vercel（や一般的なリバースプロキシ）越しのアクセスでは実際の接続はプロキシ→アプリの間はHTTPになるが、
// X-Forwarded-Proto 等のヘッダーで元がHTTPSだったことが分かる。trust proxy を立てておくと
// Express がそのヘッダーを見て req.secure / req.protocol を正しく解決する（Render も同様にプロキシ越しなので影響なし）。
// auth.ts の Secure cookie 判定は DATABASE_URL の中身で決めており req.secure には依存していないため、
// この設定を入れても既存のログイン挙動は変わらない（保険的に追加）。
app.set('trust proxy', 1);

app.use(express.json({ limit: '8mb' })); // 縮小済み写真(base64)を受け取れるよう拡張
// ※ Vercel はサーバーレス関数のリクエストボディに4.5MBのプラットフォーム上限がある（Hobby/Pro共通）。
//   express側の8mb設定はRender向けの上限で、Vercelではそれより先にプラットフォーム側で切られる。
//   実運用の画像はクライアント側でリサイズ済みのため通常は収まる想定（docs/デプロイ.md参照）。

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
// ※ Vercel では public/ はプラットフォームが自動で静的配信する想定のため、この行は主に
//   ローカル開発(npm run dev)とRenderでの配信を担う。Vercel環境でも到達すれば動作するが、
//   通常は静的アセットへのリクエストが関数まで届く前にVercel側で処理される。
