// Render(常駐プロセス)・ローカル開発(npm run dev)用のエントリポイント。
// アプリ本体の組み立ては app.ts に分離した（Vercelのサーバーレス関数 api/index.ts と共用するため）。
// ここでは import して listen するだけで、既存の起動フロー・ミドルウェア順は変えていない。
import { app } from './app';

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`TabiWari server listening on http://localhost:${port}`);
});
