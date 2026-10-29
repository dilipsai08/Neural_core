import { z } from "zod";

export const registerPlayerSchema = z.object({
  fullName: z.string().min(2).max(100).trim(),
  contactKey: z.string().min(3).max(50).trim(),
});

export type RegisterPlayerInput = z.infer<typeof registerPlayerSchema>;

export const startRunSchema = z.object({
  playerId: z.number().int().positive(),
});

export type StartRunInput = z.infer<typeof startRunSchema>;

export const runEventSchema = z.object({
  tMs: z.number().int().nonnegative(),
  kind: z.enum(["hit", "miss", "zen_shot", "distraction"]),
  focus: z.number().min(0).max(100),
  data: z.record(z.unknown()).nullable().optional(),
});

export const focusSampleSchema = z.object({
  tMs: z.number().int().nonnegative(),
  score: z.number().min(0).max(100),
});

export const finishRunSchema = z.object({
  events: z.array(runEventSchema),
  focusSamples: z.array(focusSampleSchema),
  score: z.number().int().nonnegative(),
  accuracy: z.number().min(0).max(100),
  avgFocus: z.number().min(0).max(100),
  bestStreakS: z.number().nonnegative(),
});

export type FinishRunInput = z.infer<typeof finishRunSchema>;

export const operatorPinSchema = z.object({
  pin: z.string().length(4),
});

export type OperatorPinInput = z.infer<typeof operatorPinSchema>;

export const leaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export type LeaderboardQueryInput = z.infer<typeof leaderboardQuerySchema>;

export const focusFrameSchema = z.object({
  type: z.literal("focus"),
  t: z.number(),
  score: z.number().min(0).max(100),
  raw: z.number().min(0).max(100),
  quality: z.enum(["good", "fair", "bad"]),
  artifact: z.enum(["none", "blink", "tension"]),
});
