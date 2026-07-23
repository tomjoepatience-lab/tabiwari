/**
 * メール必須化前の旧アカウントを、同じ利用者のメールアカウントへ統合する。
 *
 * 既定は dry-run:
 *   npx tsx scripts/merge-legacy-account.ts <legacyUserId> <emailUserId>
 * 実行:
 *   npx tsx scripts/merge-legacy-account.ts <legacyUserId> <emailUserId> --apply
 *
 * 旧側の家計データ・貯金・収入・設定を保ち、メールと新しいパスワードは
 * emailUserId 側のものを使う。処理全体を1トランザクションで行う。
 */
import 'dotenv/config';
import { pool } from '../src/server/db';

const legacyUserId = Number(process.argv[2]);
const emailUserId = Number(process.argv[3]);
const apply = process.argv.includes('--apply');

if (!Number.isInteger(legacyUserId) || !Number.isInteger(emailUserId) || legacyUserId === emailUserId) {
  console.error('使い方: npx tsx scripts/merge-legacy-account.ts <legacyUserId> <emailUserId> [--apply]');
  process.exit(1);
}

async function main() {
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const usersQ = await client.query(
    `SELECT id, username, email, display_name, password_hash, created_at
       FROM users
      WHERE id = ANY($1::int[])
      ORDER BY id
      FOR UPDATE`,
    [[legacyUserId, emailUserId]],
  );
  if (usersQ.rows.length !== 2) throw new Error('指定した2アカウントの一方が存在しません');
  const legacy = usersQ.rows.find((u) => u.id === legacyUserId);
  const emailUser = usersQ.rows.find((u) => u.id === emailUserId);
  if (!legacy || !emailUser) throw new Error('指定したアカウントを取得できません');
  if (legacy.email) throw new Error('旧アカウント側に既にメールがあります');
  if (!emailUser.email) throw new Error('統合先にメールがありません');
  if ((emailUser.display_name ?? '').toLowerCase() !== legacy.username.toLowerCase()) {
    throw new Error('旧ユーザー名とメールアカウントの表示名が一致しません');
  }

  const legacyGroupsQ = await client.query(
    `SELECT gm.group_id, gm.role,
            (SELECT count(*)::int FROM receipts r JOIN trips t ON t.id = r.trip_id WHERE t.group_id = gm.group_id) AS receipts
       FROM group_members gm
      WHERE gm.user_id = $1
      ORDER BY receipts DESC, gm.group_id`,
    [legacyUserId],
  );
  const preferredGroupId = legacyGroupsQ.rows[0]?.group_id ?? null;

  if (!apply) {
    console.log({
      dryRun: true,
      legacyUserId,
      emailUserId,
      preferredGroupId,
      legacyGroups: legacyGroupsQ.rows,
    });
    await client.query('ROLLBACK');
    return;
  }

  // 旧側の全スペースを統合先へ追加。既に参加済みなら owner 権限を優先する。
  await client.query(
    `INSERT INTO group_members (group_id, user_id, role)
     SELECT group_id, $2, role FROM group_members WHERE user_id = $1
     ON CONFLICT (group_id, user_id) DO UPDATE
       SET role = CASE
         WHEN group_members.role = 'owner' OR EXCLUDED.role = 'owner' THEN 'owner'
         ELSE 'member'
       END`,
    [legacyUserId, emailUserId],
  );

  await client.query(`UPDATE group_invites SET created_by = $2 WHERE created_by = $1`, [legacyUserId, emailUserId]);
  await client.query(`UPDATE sessions SET user_id = $2 WHERE user_id = $1`, [legacyUserId, emailUserId]);
  await client.query(`UPDATE auth_tokens SET user_id = $2 WHERE user_id = $1`, [legacyUserId, emailUserId]);
  await client.query(`UPDATE savings_goals SET user_id = $2 WHERE user_id = $1`, [legacyUserId, emailUserId]);
  await client.query(`UPDATE incomes SET user_id = $2 WHERE user_id = $1`, [legacyUserId, emailUserId]);
  await client.query(`UPDATE link_codes SET parent_user_id = $2 WHERE parent_user_id = $1`, [legacyUserId, emailUserId]);
  await client.query(`UPDATE chore_logs SET child_user_id = $2 WHERE child_user_id = $1`, [legacyUserId, emailUserId]);

  // 親子連携は同一人物が両側に重複していない場合だけ安全に置換できる。
  const linkConflictQ = await client.query(
    `SELECT 1
       FROM account_links
      WHERE (parent_user_id = $1 AND child_user_id = $2)
         OR (parent_user_id = $2 AND child_user_id = $1)
         OR (child_user_id IN ($1, $2)
             AND child_user_id <> $1
             AND EXISTS (SELECT 1 FROM account_links x WHERE x.child_user_id = $2))
      LIMIT 1`,
    [legacyUserId, emailUserId],
  );
  if (linkConflictQ.rows.length) throw new Error('親子連携に競合があるため自動統合できません');
  await client.query(`UPDATE account_links SET parent_user_id = $2 WHERE parent_user_id = $1`, [legacyUserId, emailUserId]);
  await client.query(`UPDATE account_links SET child_user_id = $2 WHERE child_user_id = $1`, [legacyUserId, emailUserId]);

  const legacySettingsQ = await client.query(`SELECT * FROM user_settings WHERE user_id = $1`, [legacyUserId]);
  const emailSettingsQ = await client.query(`SELECT * FROM user_settings WHERE user_id = $1`, [emailUserId]);
  const oldS = legacySettingsQ.rows[0] ?? {};
  const newS = emailSettingsQ.rows[0] ?? {};
  const owned = [...new Set([...(oldS.costumes?.owned ?? []), ...(newS.costumes?.owned ?? [])])];
  const equipped = [...new Set([...(oldS.costumes?.equipped ?? []), ...(newS.costumes?.equipped ?? [])])]
    .filter((id) => owned.includes(id));
  await client.query(
    `INSERT INTO user_settings (
       user_id, mode, monthly_income, monthly_budget, allowance, balance_start,
       coins, xp, costume, last_challenge_date, last_summary_shown, usage_type,
       tutorial_done, active_group_id, costumes, chore_points, last_ocr_on,
       ocr_used, ocr_week_on, ocr_week_used, premium_until
     ) VALUES (
       $1, 'kids', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
       $12, $13, $14, $15, $16, $17, $18, $19, $20
     )
     ON CONFLICT (user_id) DO UPDATE SET
       mode = 'kids', monthly_income = EXCLUDED.monthly_income,
       monthly_budget = EXCLUDED.monthly_budget, allowance = EXCLUDED.allowance,
       balance_start = EXCLUDED.balance_start, coins = EXCLUDED.coins,
       xp = EXCLUDED.xp, costume = EXCLUDED.costume,
       last_challenge_date = EXCLUDED.last_challenge_date,
       last_summary_shown = EXCLUDED.last_summary_shown,
       usage_type = EXCLUDED.usage_type, tutorial_done = EXCLUDED.tutorial_done,
       active_group_id = EXCLUDED.active_group_id, costumes = EXCLUDED.costumes,
       chore_points = EXCLUDED.chore_points, last_ocr_on = EXCLUDED.last_ocr_on,
       ocr_used = EXCLUDED.ocr_used, ocr_week_on = EXCLUDED.ocr_week_on,
       ocr_week_used = EXCLUDED.ocr_week_used, premium_until = EXCLUDED.premium_until`,
    [
      emailUserId,
      newS.monthly_income ?? oldS.monthly_income ?? null,
      newS.monthly_budget ?? oldS.monthly_budget ?? null,
      newS.allowance ?? oldS.allowance ?? null,
      (oldS.balance_start ?? 0) + (newS.balance_start ?? 0),
      (oldS.coins ?? 0) + (newS.coins ?? 0),
      (oldS.xp ?? 0) + (newS.xp ?? 0),
      newS.costume ?? oldS.costume ?? null,
      [oldS.last_challenge_date, newS.last_challenge_date].filter(Boolean).sort().at(-1) ?? null,
      [oldS.last_summary_shown, newS.last_summary_shown].filter(Boolean).sort().at(-1) ?? null,
      newS.usage_type ?? oldS.usage_type ?? null,
      Boolean(oldS.tutorial_done || newS.tutorial_done),
      preferredGroupId,
      JSON.stringify({ owned, equipped }),
      (oldS.chore_points ?? 0) + (newS.chore_points ?? 0),
      [oldS.last_ocr_on, newS.last_ocr_on].filter(Boolean).sort().at(-1) ?? null,
      (oldS.last_ocr_on && newS.last_ocr_on && oldS.last_ocr_on === newS.last_ocr_on)
        ? (oldS.ocr_used ?? 0) + (newS.ocr_used ?? 0)
        : (oldS.last_ocr_on > newS.last_ocr_on ? oldS.ocr_used : newS.ocr_used) ?? 0,
      [oldS.ocr_week_on, newS.ocr_week_on].filter(Boolean).sort().at(-1) ?? null,
      (oldS.ocr_week_on && newS.ocr_week_on && oldS.ocr_week_on === newS.ocr_week_on)
        ? (oldS.ocr_week_used ?? 0) + (newS.ocr_week_used ?? 0)
        : (oldS.ocr_week_on > newS.ocr_week_on ? oldS.ocr_week_used : newS.ocr_week_used) ?? 0,
      [oldS.premium_until, newS.premium_until].filter(Boolean).sort().at(-1) ?? null,
    ],
  );

  await client.query(`DELETE FROM group_members WHERE user_id = $1`, [legacyUserId]);
  await client.query(`DELETE FROM user_settings WHERE user_id = $1`, [legacyUserId]);
  await client.query(`DELETE FROM users WHERE id = $1`, [legacyUserId]);
  await client.query('COMMIT');
  console.log({ merged: true, legacyUserId, emailUserId, activeGroupId: preferredGroupId });
} catch (error) {
  await client.query('ROLLBACK');
  console.error('統合失敗:', (error as Error).message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
}

void main();
