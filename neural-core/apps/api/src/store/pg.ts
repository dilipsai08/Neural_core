import pg from "pg";
import { titleForScore, type LeaderboardEntry } from "@neural-core/shared";
import type { LedgerEntry, Store, StoredRun } from "./store.js";

const SCHEMA = /* sql */ `
create table if not exists players (
  id           int primary key,
  display_id   text unique not null,
  full_name    text not null,
  contact_key  text unique not null,
  consent_at   timestamptz not null,
  created_at   timestamptz not null
);

create table if not exists runs (
  id            int primary key,
  player_id     int not null references players(id),
  station       int not null,
  status        text not null,
  ranked        boolean not null,
  seed          int not null,
  calibration   jsonb not null,
  started_at    timestamptz not null,
  finished_at   timestamptz,
  score         int,
  kills         int,
  shots         int,
  hits          int,
  accuracy      numeric(5,2),
  avg_focus     numeric(5,2),
  best_chain_s  numeric(6,2),
  max_mult      int,
  breaches      int,
  boss_down     boolean,
  client_score  int,
  verification  jsonb
);

create index if not exists runs_leaderboard on runs (status, score desc, avg_focus desc, accuracy desc);
`;

/** Best valid run per player, ranked by score, then average focus, then accuracy. */
const LEADERBOARD = /* sql */ `
select * from (
  select distinct on (r.player_id)
         r.id as run_id, r.player_id, p.display_id, p.full_name, r.station,
         r.score, r.avg_focus::float8 as avg_focus, r.accuracy::float8 as accuracy,
         r.max_mult, r.finished_at
  from runs r
  join players p on p.id = r.player_id
  where r.status = 'valid' and r.score is not null
    and ($1::timestamptz is null or r.finished_at <= $1)
  order by r.player_id, r.score desc, r.avg_focus desc, r.accuracy desc, r.id
) best
order by score desc, avg_focus desc, accuracy desc, run_id
`;

interface Row {
  run_id: number;
  player_id: number;
  display_id: string;
  full_name: string;
  station: number;
  score: number;
  avg_focus: number;
  accuracy: number;
  max_mult: number;
  finished_at: Date;
}

/**
 * PostgreSQL copy of players and runs that serves the leaderboard. The
 * append-only ledger stays the crash-safe record: it is replayed into the
 * database on every start, and each new entry is mirrored as it is written.
 * If the database is unreachable the event keeps running on the ledger.
 */
export class LeaderboardDb {
  private readonly pool: pg.Pool;
  private queue: Promise<void> = Promise.resolve();
  private retry: ReturnType<typeof setTimeout> | null = null;
  ready = false;
  lastError: string | null = null;

  constructor(
    url: string,
    private readonly store: Store,
    private readonly log: (m: string) => void,
  ) {
    this.pool = new pg.Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 3000 });
    this.pool.on("error", (err) => this.fail(err));
  }

  async start(): Promise<void> {
    try {
      await this.pool.query(SCHEMA);
      const client = await this.pool.connect();
      try {
        await client.query("begin");
        for (const p of this.store.players.values()) await this.upsertPlayer(client, p.id);
        for (const r of this.store.runs.values()) await this.upsertRun(client, r);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw err;
      } finally {
        client.release();
      }
      this.ready = true;
      this.lastError = null;
      this.log(`postgres: connected, synced ${this.store.players.size} players and ${this.store.runs.size} runs`);
    } catch (err) {
      this.fail(err);
    }
  }

  /** Mirror one ledger entry. Writes are queued so they land in order. */
  mirror(entry: LedgerEntry): void {
    if (!this.ready) return;
    let runId: number | null = null;
    switch (entry.op) {
      case "player":
        this.queue = this.queue.then(() => this.upsertPlayer(this.pool, entry.player.id)).catch((err) => this.fail(err));
        return;
      case "run:start":
        runId = entry.run.id;
        break;
      case "run:go":
      case "run:finish":
      case "run:status":
        runId = entry.runId;
        break;
      default:
        return;
    }
    const run = this.store.runs.get(runId);
    if (run) this.queue = this.queue.then(() => this.upsertRun(this.pool, run)).catch((err) => this.fail(err));
  }

  async leaderboard(frozenAt: string | null): Promise<LeaderboardEntry[]> {
    const { rows } = await this.pool.query<Row>(LEADERBOARD, [frozenAt]);
    return rows.map((r, i) => ({
      rank: i + 1,
      playerId: r.player_id,
      displayId: r.display_id,
      fullName: r.full_name,
      runId: r.run_id,
      score: r.score,
      avgFocus: r.avg_focus,
      accuracy: r.accuracy,
      maxMult: r.max_mult,
      title: titleForScore(r.score).label,
      station: r.station,
      finishedAt: r.finished_at.toISOString(),
    }));
  }

  private async upsertPlayer(db: pg.Pool | pg.PoolClient, id: number): Promise<void> {
    const p = this.store.players.get(id);
    if (!p) return;
    await db.query(
      `insert into players (id, display_id, full_name, contact_key, consent_at, created_at)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (id) do update set full_name = excluded.full_name`,
      [p.id, p.displayId, p.fullName, p.contactKey, p.consentAt, p.createdAt],
    );
  }

  private async upsertRun(db: pg.Pool | pg.PoolClient, r: StoredRun): Promise<void> {
    const s = r.stats;
    await db.query(
      `insert into runs (id, player_id, station, status, ranked, seed, calibration, started_at, finished_at,
                         score, kills, shots, hits, accuracy, avg_focus, best_chain_s, max_mult, breaches,
                         boss_down, client_score, verification)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       on conflict (id) do update set
         status = excluded.status, finished_at = excluded.finished_at, score = excluded.score,
         kills = excluded.kills, shots = excluded.shots, hits = excluded.hits, accuracy = excluded.accuracy,
         avg_focus = excluded.avg_focus, best_chain_s = excluded.best_chain_s, max_mult = excluded.max_mult,
         breaches = excluded.breaches, boss_down = excluded.boss_down, client_score = excluded.client_score,
         verification = excluded.verification`,
      [
        r.id, r.playerId, r.station, r.status, r.ranked, r.seed, JSON.stringify(r.calibration), r.startedAt,
        r.finishedAt, s?.score ?? null, s?.kills ?? null, s?.shots ?? null, s?.hits ?? null, s?.accuracy ?? null,
        s?.avgFocus ?? null, s?.bestChainS ?? null, s?.maxMult ?? null, s?.breaches ?? null, s?.bossDown ?? null,
        r.clientScore, r.verification ? JSON.stringify(r.verification) : null,
      ],
    );
  }

  private fail(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg !== this.lastError) {
      this.log(`postgres: ${msg}`);
      this.log("postgres: leaderboard is served from the local ledger until the database is back");
    }
    this.lastError = msg;
    this.ready = false;
    // Keep retrying; a successful start replays the whole ledger, so nothing is missed.
    if (!this.retry) {
      this.retry = setTimeout(() => {
        this.retry = null;
        void this.start();
      }, 15_000);
    }
  }

  async close(): Promise<void> {
    if (this.retry) clearTimeout(this.retry);
    await this.queue;
    await this.pool.end();
  }
}
