// Vercel サーバーレス関数のエントリポイント。
// src/server/app.ts の Express アプリをそのまま default export するだけ（@vercel/node が
// Express アプリを http のリクエストハンドラとしてそのまま扱える）。
// ルーティング・ミドルウェアの中身は Render 用(src/server/index.ts経由)と完全に共通。
//
// vercel.json の rewrites で "/api/(.*)" → "/api/index" にまとめているが、Vercel は
// リライト先の関数を「どの関数が処理するか」の選択に使うだけで、関数が受け取る req.url は
// 書き換えられずブラウザが要求した元のパス（例: /api/auth/register）のまま渡ってくる。
// そのため src/server/app.ts 側の `app.use('/api/auth', auth)` 等のパスは変更不要。
import { app } from '../src/server/app';

export default app;
