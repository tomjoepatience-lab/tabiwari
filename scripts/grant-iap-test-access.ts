import 'dotenv/config';
import { pool } from '../src/server/db';

const account = process.argv[2]?.trim();
if (!account) {
  console.error('使い方: npx tsx scripts/grant-iap-test-access.ts <username-or-email>');
  process.exit(1);
}

const run = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `ALTER TABLE user_settings
         ADD COLUMN IF NOT EXISTS iap_goal_icons boolean NOT NULL DEFAULT false`,
    );
    await client.query(
      `ALTER TABLE user_settings
         ADD COLUMN IF NOT EXISTS iap_season_costumes boolean NOT NULL DEFAULT false`,
    );
    await client.query(
      `ALTER TABLE user_settings
         ADD COLUMN IF NOT EXISTS iap_test_access boolean NOT NULL DEFAULT false`,
    );
    await client.query(`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS iap_synced_at timestamptz`);
    await client.query(`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS season_costume text`);

    let users = await client.query(
      `SELECT id, COALESCE(display_name, username) AS name
         FROM users
        WHERE lower(username) = lower($1)`,
      [account],
    );
    if (users.rowCount === 0) {
      users = await client.query(
        `SELECT id, COALESCE(display_name, username) AS name
           FROM users
          WHERE lower(COALESCE(email, '')) = lower($1)
          ORDER BY last_login_at DESC NULLS LAST`,
        [account],
      );
    }
    if (users.rowCount !== 1) {
      throw new Error(users.rowCount === 0
        ? '対象アカウントが見つかりません'
        : '対象が複数あります。ユーザー名を指定してください');
    }

    const user = users.rows[0];
    await client.query(
      `INSERT INTO user_settings
         (user_id, iap_goal_icons, iap_season_costumes, iap_test_access)
       VALUES ($1, true, true, true)
       ON CONFLICT (user_id) DO UPDATE SET
         iap_goal_icons = true,
         iap_season_costumes = true,
         iap_test_access = true`,
      [user.id],
    );
    await client.query('COMMIT');
    console.log(`IAP test packs granted: ${user.name}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
