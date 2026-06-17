-- TabiWari スキーマ（M0）
-- 実行例: psql "$DATABASE_URL" -f src/db/schema.sql

CREATE TABLE IF NOT EXISTS trips (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  start_date  DATE,
  end_date    DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  id       SERIAL PRIMARY KEY,
  trip_id  INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  name     TEXT NOT NULL
);

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

CREATE INDEX IF NOT EXISTS idx_members_trip   ON members (trip_id);
CREATE INDEX IF NOT EXISTS idx_receipts_trip  ON receipts (trip_id);
CREATE INDEX IF NOT EXISTS idx_items_receipt  ON items (receipt_id);
