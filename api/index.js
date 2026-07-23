// Vercel サーバーレス関数のエントリポイント（CommonJS・コンパイル済みJSを参照）。
//
// TypeScript のまま（api/index.ts）にすると、Vercel の新ランタイムが「型を剥がすだけ」の
// ネイティブTS実行を試み、拡張子なしの相対 import（'./db' 等）を解決できずクラッシュする。
// そのため buildCommand（npm run build）で tsc が出力した CommonJS の dist/ を require する。
// ルーティング・ミドルウェアは Render 用（src/server/index.ts 経由）と完全に共通。
const { app } = require('../dist/server/app');

module.exports = app;
