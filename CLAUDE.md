# kakeibo / マネコ家計簿（3Dキャラクターと暮らす家計簿）

## 概要
**2026-07 リニューアル**: 3Dキャラクター「マネコ」（トゥーン調の猫、three.js でプロシージャル生成）が主役の家計簿。
ホームでマネコが買ったものに反応（食べる・飲む・持つ・着る）し、支出パターンから**叱らずアドバイス**する
（ラーメン続き→「丸くなってきた…頻度減らそ?」、飲み会続き→「肝臓きつい〜」。日用品・固定費は警告しない）。
食べすぎ月は体型が丸くなる。**2アプリ構成（モード切替・初回ログインで選択）**:
- 🏘️ **こどもモード「マネコタウン」**（デザイン2a）: 3Dの街＋おさいふ/コイン/XP・Lv/ごきげん♥/きょうのチャレンジ/もくひょう・ちょきん箱/🎁衣装ガチャ
- 💼 **おとなモード「マネコ家計簿」**（デザイン3a）: 墨色ヒーローカード（今月あと使える/予算バー）＋覗きマネコ＋つかいみち＋最近の記録
- 下部ナビ共通: ホーム/レポート/きろく(中央)/ちょきん/せってい。詳細機能（割り勘・OCR・アルバム）はおとなの「せってい→プロジェクト」に温存
- デザイン原本: `../マネコのキャラクター・ホーム画面デザイン/design_handoff_maneko_home/`（README にトークン一式）
リニューアル構想の詳細は docs/キャラ家計簿リニューアル.md を参照（決済連携CSV・地図ルート再生はフェーズ2）。

旧来（TabiWari）から温存: レシート明細単位の割り勘＋精算、レシートOCR（Claude vision）、
思い出写真＋スクラップブック風アルバム、地図ピン、認証（cookieセッション）＋家族グループ。
慶應「実践のための Web プログラミング」課題として制作、現在は個人利用のクオリティ優先で開発。
- デモログイン: `demo` / `demo1234`（seed 投入時）。
- 旧設計書: docs/設計書.md

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
├── docs/設計書.md       # 旧設計書（提出物）
├── docs/キャラ家計簿リニューアル.md  # リニューアル構想（マネコ）
├── public/              # 静的配信（index.html / style.css）＋ main.js(生成物)
├── src/
│   ├── server/          # Express（index.ts / db.ts / api.ts / auth.ts / ocr.ts）
│   ├── client/          # フロント TS（main.ts / character.ts=3Dマネコ / advice.ts=アドバイス）
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
