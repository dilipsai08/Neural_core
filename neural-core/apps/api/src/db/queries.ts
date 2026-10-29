import { getPool } from "./pool.js";
import { formatDisplayId } from "@neural-core/shared";
import type { Player, Run, LeaderboardEntry } from "@neural-core/shared";

export async function createPlayer(fullName: string, contactKey: string): Promise<Player> {
  const pool = getPool();
  const countRes = await pool.query<{ count: string }>("SELECT COUNT(*) as count FROM players");
  const count = Number(countRes.rows[0]?.count ?? 0) + 1;
  const displayId = formatDisplayId(count);

  const res = await pool.query<Player>(
    `INSERT INTO players (display_id, full_name, contact_key)
     VALUES ($1, $2, $3)
     RETURNING id, display_id as "displayId", full_name as "fullName",
               contact_key as "contactKey", consent_at as "consentAt", created_at as "createdAt"`,
    [displayId, fullName, contactKey]
  );
  return res.rows[0]!;
}

export async function getPlayerByContact(contactKey: string): Promise<Player | null> {
  const pool = getPool();
  const res = await pool.query<Player>(
    `SELECT id, display_id as "displayId", full_name as "fullName",
            contact_key as "contactKey", consent_at as "consentAt", created_at as "createdAt"
     FROM players WHERE contact_key = $1`,
    [contactKey]
  );
  return res.rows[0] ?? null;
}

export async function getLeaderboard(limit = 10): Promise<LeaderboardEntry[]> {
  const pool = getPool();
  const res = await pool.query<LeaderboardEntry>(
    `SELECT
       ROW_NUMBER() OVER (ORDER BY r.score DESC, r.avg_focus DESC, r.accuracy DESC)::int as rank,
       p.id as "playerId",
       p.display_id as "displayId",
       p.full_name as "fullName",
       r.score,
       r.avg_focus as "avgFocus",
       r.accuracy
     FROM runs r
     JOIN players p ON p.id = r.player_id
     WHERE r.status = 'valid'
     ORDER BY r.score DESC, r.avg_focus DESC, r.accuracy DESC
     LIMIT $1`,
    [limit]
  );
  return res.rows;
}

export async function createAuditLog(actor: string, action: string, details: Record<string, unknown>): Promise<void> {
  const pool = getPool();
  await pool.query(
    "INSERT INTO audit_log (actor, action, details) VALUES ($1, $2, $3)",
    [actor, action, JSON.stringify(details)]
  );
}
