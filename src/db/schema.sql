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
  quantity    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS item_shares (
  item_id   INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, member_id)
);

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

-- 思い出写真（レシートとは別。これだけがアルバムの素材になる）
CREATE TABLE IF NOT EXISTS trip_photos (
  id          SERIAL PRIMARY KEY,
  trip_id     INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  photo       BYTEA NOT NULL,            -- 縮小済みJPEG（案A）
  caption     TEXT,                      -- ひとことコメント（任意）
  taken_on    DATE,                      -- 撮影日（任意・アルバムの並び順に使う）
  sort_order  INTEGER NOT NULL DEFAULT 0,-- 手動並べ替え用（編集フェーズで使用）
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_members_trip   ON members (trip_id);
CREATE INDEX IF NOT EXISTS idx_receipts_trip  ON receipts (trip_id);
CREATE INDEX IF NOT EXISTS idx_items_receipt  ON items (receipt_id);
CREATE INDEX IF NOT EXISTS idx_trip_photos_trip ON trip_photos (trip_id);
CREATE INDEX IF NOT EXISTS idx_trips_group       ON trips (group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user      ON sessions (user_id);
