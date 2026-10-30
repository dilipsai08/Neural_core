/**
 * Headset check in the terminal, without the game. Runs the exact pipeline the
 * game uses (filters → band powers → engagement index → focus %) on the real
 * Arduino and prints it twice a second.
 *
 *   pnpm sensor:check --list
 *   pnpm sensor:check --port COM5               live readout (typical calibration)
 *   pnpm sensor:check --port COM5 --calibrate   20 s relax + 20 s focus first, then live
 *   pnpm sensor:check --simulate                no hardware: synthetic EEG
 *   pnpm sensor:check --port COM5 --raw         transport diagnostics: bytes, packets, losses, A0 range
 */
import {
  CALIBRATION_FOCUS_S,
  CALIBRATION_HIGH_PERCENTILE,
  CALIBRATION_LOW_PERCENTILE,
  CALIBRATION_MIN_SPAN,
  CALIBRATION_RELAX_S,
  DEFAULT_CALIBRATION,
  NOTCH_HZ_DEFAULT,
  SAMPLE_RATE_HZ,
  SERIAL_BAUD_DEFAULT,
  percentile,
  type Calibration,
  type FocusSource,
} from "@neural-core/shared";
import { FakeSource } from "../sensor/fake-source.js";
import { FocusProcessor, FocusScorer, type Analysis } from "../sensor/processor.js";
import { SerialSource, listSerialPorts } from "../sensor/serial-source.js";
import { StreamDecoder } from "../sensor/stream-decoder.js";
import { SerialPort } from "serialport";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const bar = (v: number, width = 20) => "█".repeat(Math.round((v / 100) * width)).padEnd(width, "·");
const pct = (x: number, total: number) => String(Math.round((x / Math.max(1e-12, total)) * 100)).padStart(3);

async function main() {
  if (process.argv.includes("--list")) {
    const ports = await listSerialPorts();
    if (ports.length === 0) console.log("No serial ports found. Is the Arduino plugged in?");
    for (const p of ports) console.log(`${p.path}\t${p.label}`);
    return;
  }
  const portPath = arg("port");
  const simulate = process.argv.includes("--simulate");
  if (portPath && process.argv.includes("--raw")) {
    rawDiagnostics(portPath, Number(arg("baud") ?? SERIAL_BAUD_DEFAULT));
    return;
  }
  if (!portPath && !simulate) {
    console.error("usage: pnpm sensor:check --port COM5 [--calibrate]   (pnpm sensor:check --list to find the port)");
    process.exit(1);
  }

  const source: FocusSource = simulate
    ? new FakeSource()
    : new SerialSource({ path: portPath!, baud: Number(arg("baud") ?? SERIAL_BAUD_DEFAULT), log: (m) => console.log(`  ${m}`) });
  const processor = new FocusProcessor({ fs: SAMPLE_RATE_HZ, adcMax: source.adcMax, mainsHz: Number(arg("mains") ?? NOTCH_HZ_DEFAULT) });
  if (source instanceof SerialSource) source.onAdcMax((max) => processor.setAdcMax(max));

  let calibration: Calibration = { ...DEFAULT_CALIBRATION, source: "default" };
  const scorer = new FocusScorer(calibration);
  let phase: "relax" | "focus" | "live" = process.argv.includes("--calibrate") ? "relax" : "live";
  let phaseStart = 0;
  const relax: number[] = [];
  const focus: number[] = [];
  let lastPrint = 0;
  let samples = 0;

  const banner = (text: string) => console.log(`\n=== ${text} ===\n`);
  if (phase === "relax") {
    banner(`CALIBRATION 1/2 · RELAX ${CALIBRATION_RELAX_S}s: eyes soft, breathe slowly, jaw loose`);
  } else {
    banner("LIVE · relax to push focus down, do mental arithmetic (100 − 7 − 7 …) to push it up");
  }

  const onAnalysis = (a: Analysis) => {
    const now = Date.now();
    phaseStart ||= now;
    const elapsed = (now - phaseStart) / 1000;
    const clean = a.artifact === "none" && a.quality !== "bad";
    if (phase === "relax" && clean) relax.push(a.index);
    if (phase === "focus" && clean) focus.push(a.index);

    if (phase === "relax" && elapsed >= CALIBRATION_RELAX_S) {
      phase = "focus";
      phaseStart = now;
      banner(`CALIBRATION 2/2 · FOCUS ${CALIBRATION_FOCUS_S}s: count down from 100 in sevens, silently`);
    } else if (phase === "focus" && elapsed >= CALIBRATION_FOCUS_S) {
      let low = percentile(relax, CALIBRATION_LOW_PERCENTILE);
      let high = percentile(focus, CALIBRATION_HIGH_PERCENTILE);
      if (high - low < CALIBRATION_MIN_SPAN) {
        const all = [...relax, ...focus];
        low = percentile(all, CALIBRATION_LOW_PERCENTILE);
        high = percentile(all, CALIBRATION_HIGH_PERCENTILE);
      }
      if (relax.length + focus.length < 40 || high - low < CALIBRATION_MIN_SPAN) {
        console.log("\n  Calibration too noisy (lots of blinks/jaw tension or bad contact). Using typical values.");
      } else {
        calibration = { low: Math.round(low * 1000) / 1000, high: Math.round(high * 1000) / 1000, source: "measured" };
        scorer.setCalibration(calibration);
        scorer.reset();
      }
      phase = "live";
      banner(`LIVE · your range: index ${calibration.low} (relaxed) → ${calibration.high} (focused)`);
    }

    const s = scorer.next(a);
    if (now - lastPrint < 500) return;
    lastPrint = now;
    const total = a.bands.theta + a.bands.alpha + a.bands.beta + a.bands.high;
    const note = a.artifact === "blink" ? "blink (held)" : a.artifact === "tension" ? "JAW TENSION: relax" : "";
    const tag = phase === "live" ? "" : ` [${phase} ${Math.max(0, Math.ceil((phase === "relax" ? CALIBRATION_RELAX_S : CALIBRATION_FOCUS_S) - elapsed))}s]`;
    console.log(
      `${a.quality.toUpperCase().padEnd(4)} θ${pct(a.bands.theta, total)}% α${pct(a.bands.alpha, total)}% β${pct(a.bands.beta, total)}% hi${pct(a.bands.high, total)}%` +
        `  idx ${a.index.toFixed(2)}  focus ${bar(s.score)} ${String(Math.round(s.score)).padStart(3)}%${tag} ${note}`,
    );
  };

  source.onSample((smp) => {
    samples += 1;
    const a = processor.push(smp.counts);
    if (a) onAnalysis(a);
  });
  await source.start();

  setTimeout(() => {
    if (samples === 0) {
      console.log("\n  No samples yet. Check: right port? Arduino IDE Serial Monitor / Chords tab closed? USB cable firmly in?");
    }
  }, 8000);

  process.on("SIGINT", () => {
    void source.stop().then(() => process.exit(0));
  });
}

/**
 * What exactly is the board sending? Separates software problems (lost or
 * garbled packets) from hardware ones (amplifier output stuck at a rail).
 */
function rawDiagnostics(path: string, baud: number): void {
  const port = new SerialPort({ path, baudRate: baud, autoOpen: false });
  const decoder = new StreamDecoder();
  let bytes = 0;
  let hexShown = false;
  let head = "";
  let win: number[] = [];
  let seconds = 0;
  let totalBytes = 0;
  let prev = { packets: 0, skippedBytes: 0, lostPackets: 0 };

  port.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    totalBytes += chunk.length;
    if (!hexShown) {
      head += chunk.toString("hex").replace(/(..)/g, "$1 ");
      if (head.length >= 64 * 3) {
        console.log(`  first bytes: ${head.slice(0, 64 * 3).trim()}`);
        hexShown = true;
      }
    }
    win.push(...decoder.push(chunk).samples);
  });
  port.on("error", (e) => console.log(`  error: ${e.message}`));

  port.open((err) => {
    if (err) {
      console.log(`  could not open ${path}: ${err.message}`);
      process.exit(1);
    }
    console.log(`  ${path} open @ ${baud} baud. Sending START. Watch for 10–15 s, then Ctrl+C.\n`);
    port.set({ dtr: true, rts: true }, () => undefined);
    const poke = () => decoder.protocol === "unknown" && port.write("START\n");
    setTimeout(poke, 400);
    const pokeTimer = setInterval(poke, 1000);

    setInterval(() => {
      seconds += 1;
      const st = decoder.stats;
      const d = {
        packets: st.packets - prev.packets,
        skippedBytes: st.skippedBytes - prev.skippedBytes,
        lostPackets: st.lostPackets - prev.lostPackets,
      };
      prev = { ...st };
      if (decoder.protocol !== "unknown") clearInterval(pokeTimer);
      const max = 2 ** (decoder.bits ?? 14) - 1;
      const n = win.length;
      const mn = n ? Math.min(...win) : 0;
      const mx = n ? Math.max(...win) : 0;
      const mean = n ? Math.round(win.reduce((a, v) => a + v, 0) / n) : 0;
      const railed = n ? win.filter((v) => v <= max * 0.01 || v >= max * 0.99).length / n : 0;
      console.log(
        `  ${String(bytes).padStart(6)} B/s · ${decoder.protocol}${decoder.channels ? ` ${decoder.channels}ch ${decoder.byteOrder}` : ""}` +
          ` · packets ${d.packets}/s · lost ${d.lostPackets}/s · skipped ${d.skippedBytes} B/s` +
          ` · A0 min ${mn} mean ${mean} max ${mx} (of ${max}) · at rail ${Math.round(railed * 100)}%`,
      );
      if (seconds % 5 === 0) verdict(bytes, d, mn, mx, mean, max, railed, decoder.protocol, totalBytes);
      bytes = 0;
      win = [];
    }, 1000);
  });
}

function verdict(
  bytes: number,
  d: { packets: number; skippedBytes: number; lostPackets: number },
  mn: number,
  mx: number,
  mean: number,
  max: number,
  railed: number,
  protocol: string,
  totalBytes: number,
): void {
  const say = (m: string) => console.log(`\n  → ${m}\n`);
  if (totalBytes === 0) return say("No bytes at all: the board is not sending. Close Chords/Arduino IDE, replug USB, press RESET.");
  if (protocol === "unknown") return say("Bytes arrive but are not Chords packets or text samples. Paste the 'first bytes' line.");
  if (d.packets < 400) {
    if (d.skippedBytes > bytes * 0.2) return say("SOFTWARE/TRANSPORT: many bytes do not form valid packets (framing errors). Paste this output.");
    if (d.lostPackets > d.packets * 0.1) return say("SOFTWARE/TRANSPORT: the board's packet counter shows packets lost before they reach the PC. Paste this output.");
    return say(`BOARD: only ${d.packets} packets/s arrive with no losses, so the sketch itself is running slower than 500 Hz.`);
  }
  if (railed > 0.05 || mx - mn > max * 0.8) {
    return say("HARDWARE: transport is fine (≈500 packets/s, no losses) but A0 hits the rails. Check electrodes on skin, cable in the Pill, VCC→5V, GND→GND, OUT→A0.");
  }
  if (Math.abs(mean - max / 2) > max * 0.25) {
    return say("HARDWARE: transport is fine but A0 sits far from mid-scale. Check the Pill's wiring and power.");
  }
  return say(`ALL GOOD: ≈${d.packets} packets/s, no losses, A0 around ${mean} (mid-scale) and within range. Run without --raw now.`);
}

void main();
