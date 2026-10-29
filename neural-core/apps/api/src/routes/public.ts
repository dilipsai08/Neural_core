import { Router, type Request, type Response } from "express";
import {
  ATTRACT_TOP_N,
  calibrationStartSchema,
  finishRunSchema,
  leaderboardQuerySchema,
  registerPlayerSchema,
  scoreRun,
  startRunSchema,
  stationIdSchema,
  titleForScore,
  type FocusPoint,
  type RunResult,
  type VerificationReport,
} from "@neural-core/shared";
import { HttpError, sendError, type AppContext } from "../context.js";
import type { z } from "zod";

export function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new HttpError(400, "VALIDATION_ERROR", first ? `${first.path.join(".") || "body"}: ${first.message}` : "Invalid input");
  }
  return r.data;
}

type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;

export function wrap(ctx: AppContext, fn: Handler) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (err) {
      sendError(res, err, ctx.log);
    }
  };
}

export function publicRouter(ctx: AppContext): Router {
  const r = Router();
  const { store, env } = ctx;

  r.get(
    "/health",
    wrap(ctx, (_req, res) => {
      res.json({
        ok: true,
        event: env.EVENT_NAME,
        uptimeS: Math.round(process.uptime()),
        players: store.players.size,
        runs: store.runs.size,
        stations: [...ctx.stations.values()].map((s) => s.status()),
      });
    }),
  );

  // ─── Stations ─────────────────────────────────────────────────────────
  r.get(
    "/stations/:id",
    wrap(ctx, (req, res) => {
      res.json(ctx.station(parse(stationIdSchema, req.params.id)).status());
    }),
  );

  r.post(
    "/stations/:id/assign",
    wrap(ctx, (req, res) => {
      const station = ctx.station(parse(stationIdSchema, req.params.id));
      const playerId = Number(req.body?.playerId);
      if (!store.players.has(playerId)) throw new HttpError(404, "NO_PLAYER", "Player not found");
      station.assignPlayer(playerId);
      res.json({ status: station.status(), previousCalibration: store.lastCalibrationFor(playerId) });
    }),
  );

  r.post(
    "/stations/:id/calibration",
    wrap(ctx, (req, res) => {
      const station = ctx.station(parse(stationIdSchema, req.params.id));
      const { phase } = parse(calibrationStartSchema, req.body);
      if (!station.status().connected) throw new HttpError(409, "NO_SIGNAL", "No signal from the headset yet");
      try {
        station.startCalibration(phase);
      } catch (err) {
        throw new HttpError(409, "CALIBRATION_ORDER", err instanceof Error ? err.message : "Cannot start");
      }
      res.json({ ok: true });
    }),
  );

  r.post(
    "/stations/:id/calibration/skip",
    wrap(ctx, (req, res) => {
      const station = ctx.station(parse(stationIdSchema, req.params.id));
      res.json({ calibration: station.skipCalibration() });
    }),
  );

  r.post(
    "/stations/:id/calibration/previous",
    wrap(ctx, (req, res) => {
      const station = ctx.station(parse(stationIdSchema, req.params.id));
      const playerId = station.playerId;
      const prev = playerId ? store.lastCalibrationFor(playerId) : null;
      if (!prev) throw new HttpError(404, "NO_CALIBRATION", "No earlier calibration for this player");
      station.applyCalibration({ ...prev, source: "previous" });
      res.json({ calibration: station.currentCalibration() });
    }),
  );

  // ─── Players ──────────────────────────────────────────────────────────
  r.post(
    "/players",
    wrap(ctx, (req, res) => {
      const body = parse(registerPlayerSchema, req.body);
      const existing = store.playerByContact(body.contactKey);
      if (existing) {
        throw new HttpError(409, "DUPLICATE_CONTACT", "This ID is already registered", {
          player: { id: existing.id, displayId: existing.displayId, fullName: existing.fullName },
        });
      }
      const player = store.createPlayer(body.fullName, body.contactKey);
      ctx.log(`registered ${player.displayId} ${player.fullName}`);
      res.status(201).json(player);
    }),
  );

  r.get(
    "/players/:id",
    wrap(ctx, (req, res) => {
      const player = store.players.get(Number(req.params.id));
      if (!player) throw new HttpError(404, "NO_PLAYER", "Player not found");
      res.json({
        ...player,
        attemptsUsed: store.rankedAttempts(player.id),
        attemptsAllowed: env.ATTEMPTS_PER_PLAYER,
        personalBest: store.personalBest(player.id),
      });
    }),
  );

  // ─── Runs ─────────────────────────────────────────────────────────────
  r.post(
    "/runs/start",
    wrap(ctx, (req, res) => {
      const body = parse(startRunSchema, req.body);
      if (!store.players.has(body.playerId)) throw new HttpError(404, "NO_PLAYER", "Player not found");
      const station = ctx.station(body.station);
      if (station.runId) {
        const prev = store.runs.get(station.runId);
        if (prev?.status === "active") store.setRunStatus(prev.id, "aborted", "system:superseded");
      }
      station.assignPlayer(body.playerId);
      const calibration = station.currentCalibration() ?? station.skipCalibration();
      const encore = store.rankedAttempts(body.playerId) >= env.ATTEMPTS_PER_PLAYER;
      const run = store.startRun({ playerId: body.playerId, station: body.station, seed: env.EVENT_SEED, calibration, encore });
      station.runId = run.id;
      station.paused = false;
      station.broadcastStatus();
      res.status(201).json({ runId: run.id, seed: run.seed, ranked: run.ranked, calibration });
    }),
  );

  r.post(
    "/runs/:id/go",
    wrap(ctx, (req, res) => {
      const run = store.runs.get(Number(req.params.id));
      if (!run || run.status !== "active") throw new HttpError(404, "NO_RUN", "Run not active");
      const goAt = Date.now();
      store.markGo(run.id, goAt);
      res.json({ goAt });
    }),
  );

  r.post(
    "/runs/:id/finish",
    wrap(ctx, (req, res) => {
      const run = store.runs.get(Number(req.params.id));
      if (!run) throw new HttpError(404, "NO_RUN", "Run not found");
      if (run.status !== "active") throw new HttpError(409, "RUN_CLOSED", "Run already finished");
      const body = parse(finishRunSchema, req.body);
      const station = ctx.station(run.station);

      // The focus timeline must be made of frames this server actually sent.
      const verified: FocusPoint[] = [];
      let corrected = 0;
      let unknown = 0;
      for (const p of body.focus) {
        const server = station.frameScore(p.frameT);
        if (server === undefined) {
          unknown += 1;
          continue;
        }
        if (Math.abs(server - p.score) > 0.11) corrected += 1;
        verified.push({ tMs: p.tMs, score: server, frameT: p.frameT });
      }

      const out = scoreRun({ seed: run.seed, events: body.events, focus: verified });
      const notes = [...out.notes];
      if (station.sourceKind !== "serial" && station.sourceKind !== "bridge") notes.push(`source was ${station.sourceKind}`);
      if (corrected) notes.push(`${corrected} focus point(s) corrected to server values`);
      if (unknown) notes.push(`${unknown} focus point(s) not issued by this server`);
      const verification: VerificationReport = {
        ok: out.rejected === 0 && unknown <= body.focus.length * 0.1 && Math.abs(out.stats.score - body.clientScore) <= Math.max(200, body.clientScore * 0.1),
        serverScore: out.stats.score,
        clientScore: body.clientScore,
        rejectedEvents: out.rejected,
        notes,
      };
      const status = body.aborted ? "aborted" : run.ranked ? "valid" : "encore";
      store.finishRun({
        runId: run.id,
        status,
        stats: out.stats,
        clientScore: body.clientScore,
        verification,
        events: body.events,
        focus: verified,
      });
      if (station.runId === run.id) {
        station.runId = null;
        station.paused = false;
        station.broadcastStatus();
      }
      ctx.log(`run #${run.id} ${status} score ${out.stats.score} (client ${body.clientScore})${verification.ok ? "" : " ⚠ check"}`);
      ctx.hub.leaderboardChanged();
      res.json({ runId: run.id, status, stats: out.stats, verification });
    }),
  );

  r.get(
    "/runs/:id",
    wrap(ctx, (req, res) => {
      const run = store.runs.get(Number(req.params.id));
      if (!run) throw new HttpError(404, "NO_RUN", "Run not found");
      const player = store.players.get(run.playerId)!;
      const ranked = store.rankedRuns();
      const mine = ranked.find((e) => e.runId === run.id) ?? null;
      const score = run.stats?.score ?? 0;
      // The closest ranked score ahead of this one: the "so close" target for a replay.
      const above = mine
        ? ranked[mine.rank - 2]
        : [...ranked].reverse().find((e) => e.score > score && e.playerId !== player.id);
      const nextAbove: RunResult["nextAbove"] = above
        ? { rank: above.rank, score: above.score, name: above.fullName }
        : null;
      const { events, focus, ...plain } = run;
      const result: RunResult = {
        run: plain,
        player,
        rank: mine?.rank ?? null,
        totalRanked: ranked.length,
        title: titleForScore(score),
        focusTimeline: focus,
        events,
        personalBest: store.personalBest(player.id, run.id),
        nextAbove,
        attemptsUsed: store.rankedAttempts(player.id),
        attemptsAllowed: env.ATTEMPTS_PER_PLAYER,
      };
      res.json(result);
    }),
  );

  // ─── Leaderboard ──────────────────────────────────────────────────────
  r.get(
    "/leaderboard",
    wrap(ctx, (req, res) => {
      const { limit } = parse(leaderboardQuerySchema, req.query);
      const all = store.rankedRuns();
      res.json({
        entries: all.slice(0, limit),
        totalRanked: all.length,
        totalRuns: [...store.runs.values()].filter((r) => r.stats).length,
        frozenAt: store.frozenAt,
        event: env.EVENT_NAME,
        top: all.slice(0, ATTRACT_TOP_N).length,
      });
    }),
  );

  return r;
}
