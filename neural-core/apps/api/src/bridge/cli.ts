/**
 * Station bridge: use this when the Arduino is plugged into a kiosk laptop
 * rather than into the server. It reads the board (Neural Core sketch or
 * Chords firmware, detected automatically) and forwards 250 Hz raw samples
 * over WebSocket; the server does all the DSP.
 *
 *   pnpm bridge --port COM5 --server ws://192.168.1.10:3001/ws --station 2
 *   pnpm bridge --port COM5 --baud 230400 --rate 500 --server ...   (Chords on the UNO R4)
 *   pnpm bridge --list
 *   pnpm bridge --simulate --server ws://192.168.1.10:3001/ws --station 2   (LAN rehearsal, no hardware)
 */
import WebSocket from "ws";
import { BRIDGE_BATCH_SAMPLES, SERIAL_BAUD_DEFAULT } from "@neural-core/shared";
import { FakeSource } from "../sensor/fake-source.js";
import { SerialSource, listSerialPorts } from "../sensor/serial-source.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (process.argv.includes("--list")) {
    for (const p of await listSerialPorts()) console.log(`${p.path}\t${p.label}`);
    return;
  }
  const portPath = arg("port");
  const server = arg("server") ?? "ws://localhost:3001/ws";
  const station = Number(arg("station") ?? "1");
  const baud = Number(arg("baud") ?? SERIAL_BAUD_DEFAULT);
  const simulate = process.argv.includes("--simulate");
  const rateHz = Number(arg("rate") ?? 0);
  if (!portPath && !simulate) {
    console.error("usage: pnpm bridge --port <COMx|/dev/ttyACM0> --server ws://<server-ip>:3001/ws --station <n>");
    process.exit(1);
  }

  let ws: WebSocket | null = null;
  let batch: number[] = [];
  let sent = 0;
  let read = 0;

  const connectWs = () => {
    ws = new WebSocket(server);
    ws.on("open", () => {
      console.log(`[bridge] connected to ${server} as station ${station}`);
      ws?.send(JSON.stringify({ type: "hello", role: "bridge", station }));
    });
    ws.on("close", () => {
      console.log("[bridge] server connection lost, retrying in 2 s");
      setTimeout(connectWs, 2000);
    });
    ws.on("error", (e) => {
      const hint = /ETIMEDOUT|EHOSTUNREACH/.test(e.message)
        ? " (the server laptop is not answering on this port: check the port is 3001 and its firewall allows it)"
        : /ECONNREFUSED/.test(e.message)
          ? " (nothing is listening there: is pnpm dev running on the server laptop, with STATIONS=1=bridge?)"
          : "";
      console.log(`[bridge] ${e.message}${hint}`);
    });
  };
  connectWs();

  const source = simulate ? new FakeSource() : new SerialSource({ path: portPath!, baud, rateHz, log: (m) => console.log(`[bridge] ${m}`) });
  source.onSample((s) => {
    read += 1;
    batch.push(s.counts);
    if (batch.length < BRIDGE_BATCH_SAMPLES) return;
    if (ws?.readyState === WebSocket.OPEN) {
      const bits = Math.round(Math.log2(source.adcMax + 1));
      ws.send(JSON.stringify({ type: "bridge:samples", station, bits, counts: batch }));
      sent += batch.length;
    }
    batch = [];
  });
  await source.start();
  if (simulate) console.log("[bridge] simulating a headset (synthetic EEG)");

  setInterval(() => {
    // Board and network are reported separately, so a blocked server is not mistaken for a silent board.
    const board = `board ${(read / 5).toFixed(0)} Hz`;
    const net = ws?.readyState === WebSocket.OPEN ? `${(sent / 5).toFixed(0)} Hz to server` : `NOT connected to ${server} (samples dropped)`;
    console.log(`[bridge] ${board} · ${net}`);
    read = 0;
    sent = 0;
  }, 5000);
}

void main();
