import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z.string().default("postgresql://postgres:postgres@localhost:5432/neural_core"),
  API_PORT: z.coerce.number().default(3001),
  API_HOST: z.string().default("0.0.0.0"),
  WS_PORT: z.coerce.number().default(3001),
  OPERATOR_PIN: z.string().min(4).default("1234"),
  SENSOR_SOURCE: z.enum(["serial", "fake", "replay"]).default("fake"),
  SERIAL_PORT: z.string().default("COM3"),
  SERIAL_BAUD: z.coerce.number().default(115200),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (!cachedEnv) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      console.error("Invalid environment configuration:", parsed.error.format());
      process.exit(1);
    }
    cachedEnv = parsed.data;
  }
  return cachedEnv;
}
