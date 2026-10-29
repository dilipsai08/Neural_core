import { Router, type Request, type Response } from "express";
import { getEnv } from "../env.js";
import { checkDbHealth, getLeaderboard, createPlayer, getPlayerByContact } from "../db/index.js";
import { registerPlayerSchema, leaderboardQuerySchema } from "@neural-core/shared";

export const apiRouter: Router = Router();

apiRouter.get("/health", async (_req: Request, res: Response) => {
  const dbOk = await checkDbHealth();
  const env = getEnv();
  res.json({
    db: dbOk ? "ok" : "error",
    serial: "not_configured",
    source: env.SENSOR_SOURCE,
    uptime: process.uptime(),
  });
});

apiRouter.get("/leaderboard", async (req: Request, res: Response) => {
  const parsed = leaderboardQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
    return;
  }
  try {
    const list = await getLeaderboard(parsed.data.limit);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: { code: "DB_ERROR", message: "Failed to fetch leaderboard" } });
  }
});

apiRouter.post("/players", async (req: Request, res: Response) => {
  const parsed = registerPlayerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
    return;
  }
  try {
    const existing = await getPlayerByContact(parsed.data.contactKey);
    if (existing) {
      res.status(409).json({ error: { code: "DUPLICATE_CONTACT", message: "Contact already registered" } });
      return;
    }
    const player = await createPlayer(parsed.data.fullName, parsed.data.contactKey);
    res.status(201).json(player);
  } catch (err) {
    res.status(500).json({ error: { code: "DB_ERROR", message: "Failed to register player" } });
  }
});
