/**
 * Station bridge: use this when the Arduino is plugged into a kiosk laptop
 * rather than into the server. It forwards raw samples over WebSocket; the
 * server does all the DSP.
 *
 *   pnpm bridge --port COM5 --server ws://192.168.1.10:3001/ws --station 2
 *   pnpm bridge --list
 *   pnpm bridge --simulate --server ws://192.168.1.10:3001/ws --station 2   (LAN rehearsal, no hardware)
 */
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import WebSocket from "ws";
import { ADC_BITS_DEFAULT, BRIDGE_BATCH_SAMPLES, SERIAL_BAUD_DEFAULT } from "@neural-core/shared";
import { parseSerialLine } from "../sensor/serial-protocol.js";
import { listSerialPorts } from "../sensor/serial-source.js";
import { FakeSource } from "../sensor/fake-source.js";

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
  if (!portPath && !simulate) {
    console.error("usage: pnpm bridge --port <COMx|/dev/ttyACM0> --server ws://<server-ip>:3001/ws --station <n>");
    process.exit(1);
  }

  let bits = ADC_BITS_DEFAULT;
  let batch: number[] = [];
  let ws: WebSocket | null = null;
  let sent = 0;

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
    ws.on("error", (e) => console.log(`[bridge] ${e.message}`));
  };
  connectWs();

  const forward = (counts: number) => {
    batch.push(counts);
    if (batch.length >= BRIDGE_BATCH_SAMPLES) {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "bridge:samples", station, bits, counts: batch }));
        sent += batch.length;
      }
      batch = [];
    }
  };

  if (simulate) {
    const fake = new FakeSource();
    fake.onSample((s) => forward(s.counts));
    await fake.start();
    console.log("[bridge] simulating a headset (synthetic EEG)");
  }

  const openSerial = (portPath: string) => {
    const port = new SerialPort({ path: portPath, baudRate: baud, autoOpen: false });
    const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));
    parser.on("data", (line: string) => {
      const p = parseSerialLine(line);
      if (p.kind === "header" && p.bits) {
        bits = p.bits;
        console.log(`[bridge] firmware: ${p.raw}`);
      }
      if (p.kind === "sample") forward(p.counts);
    });
    port.on("close", () => {
      console.log("[bridge] serial closed, reopening in 2 s");
      setTimeout(() => openSerial(portPath), 2000);
    });
    port.open((err) => {
      if (err) {
        console.log(`[bridge] cannot open ${portPath}: ${err.message}; retrying in 2 s`);
        setTimeout(() => openSerial(portPath), 2000);
        return;
      }
      console.log(`[bridge] reading ${portPath} @ ${baud}`);
      port.write("i\n");
    });
  };
  if (portPath) openSerial(portPath);

  setInterval(() => {
    console.log(`[bridge] ${sent} samples/5s (${(sent / 5).toFixed(0)} Hz)`);
    sent = 0;
  }, 5000);
}

void main();
