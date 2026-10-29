import express from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { networkInterfaces } from "node:os";
import { getEnv } from "./env.js";
import { createContext } from "./context.js";
import { Store } from "./store/store.js";
import { Hub } from "./ws/index.js";
import { publicRouter } from "./routes/public.js";
import { operatorRouter } from "./routes/operator.js";

const env = getEnv();
const store = new Store(env.DATA_DIR);
const ctx = createContext(env, store, (c) =>
  new Hub((station, counts, bits, from) => {
    void c.station(station).ingestBridge(counts, bits, from);
  }, c.log),
);

const app = express();
app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use("/api/operator", operatorRouter(ctx));
app.use("/api", publicRouter(ctx));

// In production the static kiosk build is served from the same origin.
if (existsSync(env.WEB_DIST)) {
  app.use(express.static(env.WEB_DIST, { extensions: ["html"] }));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    res.status(404).sendFile(path.join(env.WEB_DIST, "404.html"), (err) => err && next());
  });
}

const server = createServer(app);
ctx.hub.statusProvider = () => [...ctx.stations.values()].map((s) => s.status());
ctx.hub.attach(server);

for (const spec of env.STATIONS) {
  const station = ctx.station(spec.id);
  const opts = spec.source === "serial" ? { port: spec.arg ?? undefined } : spec.source === "replay" ? { file: spec.arg ?? undefined } : {};
  station.setSource(spec.source as Parameters<typeof station.setSource>[0], opts).catch((err: Error) => {
    ctx.log(`station ${spec.id}: ${err.message}`);
  });
}

server.listen(env.PORT, env.HOST, () => {
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i!.address);
  ctx.log(`API + WS on port ${env.PORT}. Data: ${env.DATA_DIR}`);
  for (const ip of ips) ctx.log(`kiosks on the LAN: http://${ip}:${env.PORT}  (WS ws://${ip}:${env.PORT}/ws)`);
  if (!existsSync(env.WEB_DIST)) ctx.log("web build not found; run the Next dev server on :3000 or `pnpm build`");
});

async function shutdown() {
  ctx.hub.close();
  await Promise.all([...ctx.stations.values()].map((s) => s.dispose()));
  server.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
