import express from "express";
import cors from "cors";
import { createServer } from "http";
import { getEnv } from "./env.js";
import { apiRouter } from "./routes/index.js";
import { initWebSocketServer } from "./ws/index.js";
import { closePool } from "./db/index.js";

const env = getEnv();
const app = express();

app.use(cors());
app.use(express.json());
app.use("/api", apiRouter);

const server = createServer(app);
initWebSocketServer(server);

server.listen(env.API_PORT, env.API_HOST, () => {
  console.log(`[Neural Core API] Running on http://${env.API_HOST}:${env.API_PORT}/api`);
  console.log(`[Neural Core WS] Running on ws://${env.API_HOST}:${env.API_PORT}/ws`);
});

const handleExit = async () => {
  server.close();
  await closePool();
  process.exit(0);
};

process.on("SIGINT", handleExit);
process.on("SIGTERM", handleExit);
