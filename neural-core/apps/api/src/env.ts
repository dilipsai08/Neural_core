import { z } from "zod";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { MAX_STATIONS, NOTCH_HZ_DEFAULT, SERIAL_BAUD_DEFAULT } from "@neural-core/shared";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
dotenv.config({ path: path.join(root, ".env") });
dotenv.config();

/**
 * STATIONS describes the kiosks and where each one's sensor is, e.g.
 *   STATIONS="1=serial:COM3,2=bridge,3=fake"
 * serial:<port>  Arduino plugged into this server machine
 * bridge         Arduino plugged into the kiosk laptop (node or browser bridge)
 * fake           synthetic EEG (demo / sensor failure fallback)
 * none           nothing yet; pick a source from the operator panel
 */
const stationSpecSchema = z
  .string()
  .default("1=fake")
  .transform((v, ctx) => {
    const out: Array<{ id: number; source: string; arg: string | null }> = [];
    for (const part of v.split(",").map((s) => s.trim()).filter(Boolean)) {
      const m = /^(\d+)=(none|fake|bridge|serial|replay)(?::(.+))?$/.exec(part);
      if (!m || Number(m[1]) < 1 || Number(m[1]) > MAX_STATIONS) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `bad STATIONS entry "${part}"` });
        return z.NEVER;
      }
      out.push({ id: Number(m[1]), source: m[2]!, arg: m[3] ?? null });
    }
    return out;
  });

const envSchema = z.object({
  /** Online PostgreSQL (e.g. Neon) for the leaderboard. Empty: leaderboard from the local ledger only. */
  DATABASE_URL: z.string().default(""),
  PORT: z.coerce.number().int().default(3001),
  HOST: z.string().default("0.0.0.0"),
  /** Leaderboard display screen (open http://<this laptop>:DISPLAY_PORT). 0 = off. */
  DISPLAY_PORT: z.coerce.number().int().min(0).default(4000),
  OPERATOR_PIN: z.string().min(4).default("2468"),
  DATA_DIR: z.string().default(path.join(root, "data")),
  WEB_DIST: z.string().default(path.join(root, "apps/web/out")),
  STATIONS: stationSpecSchema,
  SERIAL_BAUD: z.coerce.number().int().default(SERIAL_BAUD_DEFAULT),
  /** Board sample rate if known (Chords on the UNO R4: 500). 0 = measure it automatically. */
  SERIAL_RATE: z.coerce.number().int().min(0).default(0),
  MAINS_HZ: z.coerce.number().int().refine((v) => v === 50 || v === 60 || v === 0).default(NOTCH_HZ_DEFAULT),
  /** Same seed for everyone → same enemy sequence → fair leaderboard. */
  EVENT_SEED: z.coerce.number().int().default(20261031),
  EVENT_NAME: z.string().default("Neural Core Arena"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      console.error("Invalid environment configuration:", parsed.error.format());
      process.exit(1);
    }
    cached = parsed.data;
  }
  return cached;
}
