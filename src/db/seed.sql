-- TabiWari テストデータ（再現可能・何度流してもOK）
-- 実行例: psql "$DATABASE_URL" -f src/db/seed.sql
-- RESTART IDENTITY で id を 1 から振り直すので、下の固定 id が常に一致する。

TRUNCATE trips, members, receipts, items, item_shares RESTART IDENTITY CASCADE;

-- 旅行
INSERT INTO trips (title, start_date, end_date) VALUES
  ('沖縄2泊3日', '2026-06-01', '2026-06-03');           -- id=1

-- メンバー
INSERT INTO members (trip_id, name) VALUES
  (1, '太郎'),   -- id=1
  (1, '花子'),   -- id=2
  (1, '次郎');   -- id=3

-- レシート（paid_by = 実際に払った人）
INSERT INTO receipts (trip_id, store_name, purchased_on, paid_by, category, lat, lng, place_name) VALUES
  (1, '国際通り',       '2026-06-01', 1, '食費', 26.2146, 127.6792, '那覇市・国際通り'),     -- id=1
  (1, 'ステーキ屋',     '2026-06-01', 2, '食費', 26.2160, 127.6850, '那覇市'),               -- id=2
  (1, '美ら海水族館',   '2026-06-02', 1, '観光', 26.6943, 127.8779, '本部町・美ら海水族館'); -- id=3

-- 明細
INSERT INTO items (receipt_id, name, price, quantity) VALUES
  (1, 'お土産',   3200, 1),   -- id=1
  (2, 'ステーキ', 6000, 1),   -- id=2
  (2, 'サラダ',   1200, 1),   -- id=3
  (2, 'ドリンク', 1200, 1),   -- id=4
  (3, '入館料',   6000, 1);   -- id=5

-- 負担者（複数行＝割り勘・等分）
INSERT INTO item_shares (item_id, member_id) VALUES
  (1, 1), (1, 2), (1, 3),   -- お土産: 全員
  (2, 1),                   -- ステーキ: 太郎だけ
  (3, 1), (3, 2),           -- サラダ: 太郎・花子
  (4, 1), (4, 2), (4, 3),   -- ドリンク: 全員
  (5, 1), (5, 2), (5, 3);   -- 入館料: 全員
