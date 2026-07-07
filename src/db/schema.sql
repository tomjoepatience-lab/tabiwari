-- TabiWari スキーマ（M0）
-- 実行例: psql "$DATABASE_URL" -f src/db/schema.sql

CREATE TABLE IF NOT EXISTS trips (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'trip',  -- 'trip'=旅行 / 'daily'=日常（普段使い）
  start_date  DATE,
  end_date    DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 既存DB向け（テーブルが既にある場合のマイグレーション・冪等）
ALTER TABLE trips ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'trip';

CREATE TABLE IF NOT EXISTS members (
  id       SERIAL PRIMARY KEY,
  trip_id  INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  weight   INTEGER NOT NULL DEFAULT 1   -- 割り勘の比重（例: 6対4なら 6 と 4）。全員1なら等分
);
-- 既存DB向け（冪等）
ALTER TABLE members ADD COLUMN IF NOT EXISTS weight INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS receipts (
  id           SERIAL PRIMARY KEY,
  trip_id      INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  store_name   TEXT,
  purchased_on DATE NOT NULL,
  paid_by      INTEGER REFERENCES members(id),
  category     TEXT,
  lat          DOUBLE PRECISION,
  lng          DOUBLE PRECISION,
  place_name   TEXT,
  photo        BYTEA,
  image_url    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  id          SERIAL PRIMARY KEY,
  receipt_id  INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  price       INTEGER NOT NULL CHECK (price > 0),
  quantity    INTEGER NOT NULL DEFAULT 1,
  genre       TEXT                          -- 自動ジャンル分け（手直し可）。NULL=未分類
);
-- 既存DB向け（冪等）
ALTER TABLE items ADD COLUMN IF NOT EXISTS genre TEXT;

CREATE TABLE IF NOT EXISTS item_shares (
  item_id   INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  weight    INTEGER,   -- この明細だけの比重オーバーライド。NULL なら members.weight を継承
  PRIMARY KEY (item_id, member_id)
);
-- 既存DB向け（冪等）
ALTER TABLE item_shares ADD COLUMN IF NOT EXISTS weight INTEGER;

-- 共有家計簿: ユーザー・グループ・メンバー・セッション ----------------
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,           -- scrypt（salt:hash の16進）
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_groups (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,      -- 家族で共有する参加コード
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id INTEGER NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role     TEXT NOT NULL DEFAULT 'member',  -- 'owner' / 'member'
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,           -- ランダムな不透明トークン（cookie に保存）
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- プロジェクト（trips）はグループに属する。ログイン中ユーザーは自分の所属グループの分だけ見える。
ALTER TABLE trips ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES user_groups(id) ON DELETE CASCADE;
-- 日常家計簿の月次予算（任意）
ALTER TABLE trips ADD COLUMN IF NOT EXISTS monthly_budget INTEGER;

-- 繰り返し支出（家賃・サブスク等）のテンプレ。日常プロジェクトで「今月分を計上」に使う。
CREATE TABLE IF NOT EXISTS recurring_expenses (
  id          SERIAL PRIMARY KEY,
  trip_id     INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  amount      INTEGER NOT NULL CHECK (amount > 0),
  category    TEXT,
  paid_by     INTEGER REFERENCES members(id) ON DELETE SET NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 思い出写真（レシートとは別。これだけがアルバムの素材になる）
CREATE TABLE IF NOT EXISTS trip_photos (
  id          SERIAL PRIMARY KEY,
  trip_id     INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  receipt_id  INTEGER REFERENCES receipts(id) ON DELETE SET NULL,  -- 紐付ける会計（任意）
  photo       BYTEA NOT NULL,            -- 縮小済みJPEG（案A）
  caption     TEXT,                      -- ひとことコメント（任意）
  taken_on    DATE,                      -- 撮影日（任意・アルバムの並び順に使う）
  sort_order  INTEGER NOT NULL DEFAULT 0,-- 手動並べ替え用（編集フェーズで使用）
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 既存DB向け（冪等）
ALTER TABLE trip_photos ADD COLUMN IF NOT EXISTS receipt_id INTEGER REFERENCES receipts(id) ON DELETE SET NULL;

-- モード付きユーザー設定＋ゲーミフィケーション（こども=kids / おとな=adult） ----
CREATE TABLE IF NOT EXISTS user_settings (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mode           TEXT NOT NULL DEFAULT 'adult',   -- 'kids' | 'adult'
  monthly_income INTEGER,                          -- おとな: 月収（表示用）
  monthly_budget INTEGER,                          -- おとな: 月予算
  allowance      INTEGER,                          -- こども: 月のおこづかい額
  balance_start  INTEGER NOT NULL DEFAULT 0,       -- こども: おさいふの最初の金額
  coins          INTEGER NOT NULL DEFAULT 0,       -- こども: ごほうびコイン
  xp             INTEGER NOT NULL DEFAULT 0,       -- こども: 経験値（Lv導出）
  costume        TEXT,                             -- マネコの衣装（beret/scarf）
  last_challenge_date DATE,                        -- きょうのチャレンジ達成日
  last_summary_shown TEXT,                         -- 月初サマリーを表示済みの月（YYYY-MM）
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 既存DB向け（冪等）
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS last_summary_shown TEXT;

-- ちょきん目標（こども/おとな共通。ゲーム機¥25,000 など）
CREATE TABLE IF NOT EXISTS savings_goals (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  emoji      TEXT,
  target     INTEGER NOT NULL CHECK (target > 0),
  saved      INTEGER NOT NULL DEFAULT 0,
  done       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 収入（おとな=給料 / こども=おこづかい・おとしだま）
CREATE TABLE IF NOT EXISTS incomes (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  amount     INTEGER NOT NULL CHECK (amount > 0),
  on_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_goals_user   ON savings_goals (user_id);
CREATE INDEX IF NOT EXISTS idx_incomes_user ON incomes (user_id);

CREATE INDEX IF NOT EXISTS idx_members_trip   ON members (trip_id);
CREATE INDEX IF NOT EXISTS idx_receipts_trip  ON receipts (trip_id);
CREATE INDEX IF NOT EXISTS idx_items_receipt  ON items (receipt_id);
CREATE INDEX IF NOT EXISTS idx_trip_photos_trip ON trip_photos (trip_id);
CREATE INDEX IF NOT EXISTS idx_trips_group       ON trips (group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user      ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_recurring_trip      ON recurring_expenses (trip_id);
