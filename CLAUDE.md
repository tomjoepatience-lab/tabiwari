# kakeibo / TabiWari（旅行・イベント割り勘アプリ）

## 概要
旅行・イベントごとに支出を記録し、**レシートの明細単位で「誰の負担か」を割り当てて精算**する Web アプリ。
慶應「実践のための Web プログラミング」第10回以降の課題として制作。仮称 TabiWari。
着想元は自作モバイルアプリ tabikake（支出をイベント単位でまとめる構造）。
分析タブで旅行ごと・旅行横断の支出を可視化。拡張枠として OCR(M3)・認証・AI相談を設計に残す。
設計の詳細は docs/設計書.md を参照。

## 技術スタック（授業で固定）
- フロント: HTML / CSS / TypeScript（フレームワークなし、素の DOM 操作）
- バック: Node.js + Express
- DB: PostgreSQL
- デプロイ: GitHub → Render（push で自動デプロイ）

## よく使うコマンド
- `npm install` … 依存をインストール
- `npm run dev` … 開発サーバ起動（client=esbuild watch ＋ server=tsx watch、http://localhost:3000）
- `npm run typecheck` … 型チェック（`tsc --noEmit`）
- `npm run build` … 本番ビルド（client バンドル＋server を dist へ）
- `npm start` … 本番起動（`node dist/server/index.js`、Render が実行）

## 環境変数（.env）
- `DATABASE_URL` … PostgreSQL 接続URL（Neon など）
- `ANTHROPIC_API_KEY` … レシートOCR（Claude vision）用。https://console.anthropic.com で取得
- `PORT` … 既定 3000

## DB セットアップ（ローカル）
1. PostgreSQL を用意（ローカルインストール or Render/Neon 等のクラウド）
2. `.env.example` を `.env` にコピーし `DATABASE_URL`（と `ANTHROPIC_API_KEY`）を設定
3. スキーマ投入: `psql "$DATABASE_URL" -f src/db/schema.sql`
4. テストデータ投入: `psql "$DATABASE_URL" -f src/db/seed.sql`（再現可能・何度でもOK）
5. `npm run dev` → 画面の状態表示が「DB: 接続OK」になれば3層完成

DB を Neon→Render 等に切り替えるときは、新しい `DATABASE_URL` に対して 3〜4 を流すだけ
（コード変更不要。`DATABASE_URL` を差し替えるだけで繋ぎ先が変わる）。

## Render デプロイ（push したときだけ）
- Build Command: `npm install --include=dev && npm run build`
- Start Command: `npm start`
- 環境変数: `DATABASE_URL`（Neon の接続URL）＋ `ANTHROPIC_API_KEY`（OCR用）
- ※ `NODE_ENV=production` は設定しない（SSL は接続先ホストで判定。設定すると build 時に devDeps が入らず失敗する）

## ディレクトリ構成
```
kakeibo/
├── docs/設計書.md       # 設計書（提出物）
├── public/              # 静的配信（index.html / style.css）＋ main.js(生成物)
├── src/
│   ├── server/          # Express（index.ts / db.ts）
│   ├── client/          # フロント TS（main.ts）
│   └── db/schema.sql    # テーブル定義
├── tsconfig.json        # 型チェック用（noEmit）
├── tsconfig.server.json # server ビルド用（dist 出力）
└── package.json
```

## ルール・規約
- シンプル・読みやすさ優先。素の TS/DOM で構築（過剰なライブラリを足さない）。
- 命名: テーブル・カラムは snake_case、TS の変数は camelCase。
- デプロイはユーザーが「デプロイして」と言ったときだけ（既定はローカル確認のみ）。

## Obsidian 連携
このプロジェクトのノートは Projects/kakeibo.md に保存する。
