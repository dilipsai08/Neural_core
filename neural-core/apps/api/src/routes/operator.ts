import { Router, type NextFunction, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import {
  ATTEMPTS_PER_PLAYER,
  operatorCommandSchema,
  operatorFakeSchema,
  operatorFreezeSchema,
  operatorSourceSchema,
  stationIdSchema,
} from "@neural-core/shared";
import { z } from "zod";
import { HttpError, type AppContext } from "../context.js";
import { listSerialPorts } from "../sensor/index.js";
import { parse, wrap } from "./public.js";

const runStatusSchema = z.object({ status: z.enum(["valid", "disqualified", "redo"]) });

function pinMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function operatorRouter(ctx: AppContext): Router {
  const r = Router();
  const { store } = ctx;

  r.use((req: Request, res: Response, next: NextFunction) => {
    const pin = req.header("x-operator-pin") ?? (typeof req.query.pin === "string" ? req.query.pin : "");
    if (!pinMatches(pin, ctx.env.OPERATOR_PIN)) {
      res.status(401).json({ error: { code: "BAD_PIN", message: "Operator PIN required" } });
      return;
    }
    next();
  });

  r.get(
    "/state",
    wrap(ctx, (_req, res) => {
      const runs = [...store.runs.values()]
        .sort((a, b) => b.id - a.id)
        .slice(0, 40)
        .map(({ events: _e, focus: _f, ...run }) => ({ ...run, player: store.players.get(run.playerId) }));
      res.json({
        stations: [...ctx.stations.values()].map((s) => s.status()),
        runs,
        connections: ctx.hub.connections(),
        frozenAt: store.frozenAt,
        database: ctx.db ? (ctx.db.ready ? "connected" : "unavailable") : "disabled",
        logs: ctx.logs.slice(-60),
        players: store.players.size,
        attemptsAllowed: ATTEMPTS_PER_PLAYER,
      });
    }),
  );

  r.get(
    "/serial-ports",
    wrap(ctx, async (_req, res) => {
      try {
        res.json(await listSerialPorts());
      } catch (err) {
        throw new HttpError(503, "PORT_SCAN", `Could not list serial ports: ${err instanceof Error ? err.message : err}`);
      }
    }),
  );

  r.post(
    "/stations/:id/source",
    wrap(ctx, async (req, res) => {
      const station = ctx.station(parse(stationIdSchema, req.params.id));
      const body = parse(operatorSourceSchema, req.body);
      try {
        await station.setSource(body.kind, body);
      } catch (err) {
        throw new HttpError(400, "SOURCE_FAILED", err instanceof Error ? err.message : "Could not switch source");
      }
      store.logAudit("operator", "source", { station: station.id, ...body });
      res.json(station.status());
    }),
  );

  r.post(
    "/stations/:id/fake",
    wrap(ctx, (req, res) => {
      const station = ctx.station(parse(stationIdSchema, req.params.id));
      station.setFakeTarget(parse(operatorFakeSchema, req.body).target);
      res.json(station.status());
    }),
  );

  r.post(
    "/stations/:id/record",
    wrap(ctx, (req, res) => {
      const station = ctx.station(parse(stationIdSchema, req.params.id));
      const file = station.setRecording(Boolean(req.body?.on));
      res.json({ status: station.status(), file });
    }),
  );

  r.post(
    "/stations/:id/command",
    wrap(ctx, (req, res) => {
      const station = ctx.station(parse(stationIdSchema, req.params.id));
      const { action } = parse(operatorCommandSchema, req.body);
      if (action === "pause") station.paused = true;
      if (action === "resume") station.paused = false;
      if (action === "skip-calibration") station.skipCalibration();
      if (action === "abort" && station.runId) {
        const run = store.runs.get(station.runId);
        if (run?.status === "active") store.setRunStatus(run.id, "aborted", "operator");
        station.runId = null;
      }
      if (action === "reset") station.reset();
      ctx.hub.command(station.id, action);
      store.logAudit("operator", action, { station: station.id });
      station.broadcastStatus();
      res.json(station.status());
    }),
  );

  r.post(
    "/runs/:id/status",
    wrap(ctx, (req, res) => {
      const run = store.runs.get(Number(req.params.id));
      if (!run) throw new HttpError(404, "NO_RUN", "Run not found");
      const { status } = parse(runStatusSchema, req.body);
      store.setRunStatus(run.id, status, "operator");
      store.logAudit("operator", `run:${status}`, { runId: run.id, playerId: run.playerId, reason: req.body?.reason ?? null });
      ctx.hub.leaderboardChanged();
      res.json({ ok: true });
    }),
  );

  r.post(
    "/freeze",
    wrap(ctx, (req, res) => {
      const { frozen } = parse(operatorFreezeSchema, req.body);
      store.setFrozen(frozen);
      store.logAudit("operator", frozen ? "freeze" : "unfreeze", {});
      ctx.hub.leaderboardChanged();
      res.json({ frozenAt: store.frozenAt });
    }),
  );

  r.get(
    "/export.csv",
    wrap(ctx, (_req, res) => {
      const head = [
        "run_id", "display_id", "name", "contact", "station", "status", "ranked", "score", "kills", "shots", "hits",
        "accuracy", "avg_focus", "best_chain_s", "max_mult", "breaches", "boss_down", "client_score", "verified",
        "notes", "started_at", "finished_at",
      ];
      const esc = (v: unknown) => {
        const s = v === null || v === undefined ? "" : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const rows = [...store.runs.values()].map((r) => {
        const p = store.players.get(r.playerId);
        const s = r.stats;
        return [
          r.id, p?.displayId, p?.fullName, p?.contactKey, r.station, r.status, r.ranked, s?.score, s?.kills, s?.shots,
          s?.hits, s?.accuracy, s?.avgFocus, s?.bestChainS, s?.maxMult, s?.breaches, s?.bossDown, r.clientScore,
          r.verification?.ok, r.verification?.notes.join("; "), r.startedAt, r.finishedAt,
        ].map(esc).join(",");
      });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="neural-core-runs-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.send([head.join(","), ...rows].join("\n"));
    }),
  );

  return r;
}
