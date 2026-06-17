# TabiWari（タビワリ）

旅行・イベントごとに支出を記録し、**レシートの明細単位で「誰の負担か」を割り当てて精算**する Web アプリ。
写真・地図・グラフで「どこで何にいくら使ったか」を振り返れる。

慶應「実践のための Web プログラミング」課題。設計の詳細は [docs/設計書.md](docs/設計書.md)。

## 主な機能
- 旅行・イベントの作成、メンバー登録
- レシートの明細ごとに負担者を複数選択 → **人ごとの負担額・精算（誰が誰にいくら）を自動計算**
- **写真添付**：思い出タブに写真カード → クリックで大きい写真＋割り勘詳細
- **地図**：レシートを Leaflet のピンで表示（店名・カテゴリ・写真と連動）
- **分析**：カテゴリ別・旅行別の支出グラフ（Chart.js）
- **レシートOCR**：画像から店名・日付・カテゴリ・明細を自動抽出（Claude vision／手修正前提）

## 技術スタック
- フロント: HTML / CSS / TypeScript（素の DOM、esbuild でバンドル）。Leaflet / Chart.js
- OCR: Claude vision（`@anthropic-ai/sdk`、サーバー経由）
- バック: Node.js + Express
- DB: PostgreSQL
- デプロイ: GitHub → Render

## セットアップ（ローカル）
```bash
npm install
cp .env.example .env          # DATABASE_URL を設定（Neon など）
npm run db:setup              # schema.sql + seed.sql を投入
npm run dev                   # http://localhost:3000
```

## よく使うコマンド
| コマンド | 説明 |
|---|---|
| `npm run dev` | 開発サーバ（client=esbuild watch ＋ server=tsx watch）|
| `npm run typecheck` | 型チェック（`tsc --noEmit`）|
| `npm run db:setup` | DB に schema＋seed を投入 |
| `npm run build` | 本番ビルド（client バンドル＋server を dist へ）|
| `npm start` | 本番起動（`node dist/server/index.js`）|

## デプロイ（Render）
- Build Command: `npm install --include=dev && npm run build`
- Start Command: `npm start`
- 環境変数: `DATABASE_URL`（Neon または Render Postgres の接続URL）、`ANTHROPIC_API_KEY`（OCR用）
- ※ `NODE_ENV=production` は設定不要（SSL は接続先ホストで自動判定）。設定するとビルド時に devDependencies が入らず失敗するので注意。

## ディレクトリ構成
```
├── docs/設計書.md          # 設計書
├── public/                 # 静的配信（index.html / style.css）＋ main.js(生成物)
├── src/
│   ├── server/             # Express（index.ts / api.ts / calc.ts / db.ts）
│   ├── client/             # フロント TS（main.ts / api.ts / image.ts / ocr.ts）
│   └── db/                 # schema.sql / seed.sql
└── scripts/db-setup.ts     # DB セットアップ
```
