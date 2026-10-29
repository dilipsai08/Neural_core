import { z } from "zod";
import { MAX_STATIONS } from "./constants.js";

export const stationIdSchema = z.coerce.number().int().min(1).max(MAX_STATIONS);

// ─── REST bodies ───────────────────────────────────────────────────────
export const registerPlayerSchema = z.object({
  fullName: z.string().trim().min(2).max(60),
  contactKey: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .transform((v) => v.replace(/\s+/g, "").toUpperCase()),
  consent: z.literal(true),
});
export type RegisterPlayerInput = z.infer<typeof registerPlayerSchema>;

export const startRunSchema = z.object({
  playerId: z.number().int().positive(),
  station: stationIdSchema,
});
export type StartRunInput = z.infer<typeof startRunSchema>;

export const runEventSchema = z.object({
  tMs: z.number().int(),
  kind: z.enum(["shot", "hit", "kill", "breach", "deflect"]),
  enemyId: z.number().int().positive().optional(),
  cause: z.enum(["bolt", "arc"]).optional(),
  focus: z.number().min(0).max(100),
});

export const focusPointSchema = z.object({
  tMs: z.number().int(),
  score: z.number().min(0).max(100),
  frameT: z.number(),
});

export const finishRunSchema = z.object({
  events: z.array(runEventSchema).max(5000),
  focus: z.array(focusPointSchema).max(2000),
  clientScore: z.number().int().nonnegative(),
  aborted: z.boolean().optional(),
});
export type FinishRunInput = z.infer<typeof finishRunSchema>;

export const calibrationStartSchema = z.object({
  phase: z.enum(["relax", "focus"]),
});

export const leaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

// ─── Operator ──────────────────────────────────────────────────────────
export const operatorSourceSchema = z.object({
  kind: z.enum(["none", "serial", "fake", "replay"]),
  port: z.string().min(1).max(120).optional(),
  baud: z.number().int().positive().optional(),
  file: z.string().min(1).max(260).optional(),
});

export const operatorFakeSchema = z.object({
  target: z.number().min(0).max(100).nullable(),
});

export const operatorCommandSchema = z.object({
  action: z.enum(["pause", "resume", "abort", "reset", "skip-calibration"]),
});

export const operatorFreezeSchema = z.object({
  frozen: z.boolean(),
});

// ─── WebSocket: client → server ────────────────────────────────────────
export const wsHelloSchema = z.object({
  type: z.literal("hello"),
  role: z.enum(["kiosk", "display", "operator", "bridge"]),
  station: stationIdSchema.optional(),
});

export const wsBridgeSamplesSchema = z.object({
  type: z.literal("bridge:samples"),
  station: stationIdSchema,
  bits: z.number().int().min(8).max(16),
  counts: z.array(z.number().int().min(0).max(65535)).min(1).max(500),
});

export const wsClientMessageSchema = z.discriminatedUnion("type", [wsHelloSchema, wsBridgeSamplesSchema]);
export type WsClientMessage = z.infer<typeof wsClientMessageSchema>;

// ─── WebSocket: server → client ────────────────────────────────────────
const qualitySchema = z.enum(["good", "fair", "bad"]);

export const focusFrameSchema = z.object({
  type: z.literal("focus"),
  station: z.number(),
  t: z.number(),
  score: z.number().min(0).max(100),
  raw: z.number().min(0).max(100),
  quality: qualitySchema,
  artifact: z.enum(["none", "blink", "tension"]),
});

export const signalFrameSchema = z.object({
  type: z.literal("signal"),
  station: z.number(),
  t: z.number(),
  wave: z.array(z.number()),
  bands: z.object({ theta: z.number(), alpha: z.number(), beta: z.number(), high: z.number() }),
  index: z.number(),
  quality: qualitySchema,
  mainsRatio: z.number(),
  railShare: z.number(),
});

export const calibrationMessageSchema = z.object({
  type: z.literal("calibration"),
  station: z.number(),
  phase: z.enum(["relax", "focus"]),
  progress: z.number().min(0).max(1),
  done: z.boolean(),
  result: z
    .object({
      low: z.number(),
      high: z.number(),
      source: z.enum(["measured", "default", "event-median", "previous"]),
    })
    .nullable(),
  error: z.string().nullable(),
});

export const stationMessageSchema = z.object({
  type: z.literal("station"),
  station: z.number(),
  // Full StationStatus; kept loose here, the API owns the shape.
  status: z.record(z.unknown()),
});

export const commandMessageSchema = z.object({
  type: z.literal("command"),
  station: z.number(),
  action: z.enum(["pause", "resume", "abort", "reset", "skip-calibration"]),
});

export const leaderboardMessageSchema = z.object({
  type: z.literal("leaderboard:update"),
});

export const wsServerMessageSchema = z.discriminatedUnion("type", [
  focusFrameSchema,
  signalFrameSchema,
  calibrationMessageSchema,
  stationMessageSchema,
  commandMessageSchema,
  leaderboardMessageSchema,
]);
export type WsServerMessage = z.infer<typeof wsServerMessageSchema>;
export type CalibrationMessage = z.infer<typeof calibrationMessageSchema>;
export type CommandMessage = z.infer<typeof commandMessageSchema>;
