/**
 * Headset check in the terminal, without the game. Runs the exact pipeline the
 * game uses (filters → band powers → engagement index → focus %) on the real
 * Arduino and prints it twice a second.
 *
 *   pnpm sensor:check --list
 *   pnpm sensor:check --port COM5               live readout (typical calibration)
 *   pnpm sensor:check --port COM5 --calibrate   20 s relax + 20 s focus first, then live
 *   pnpm sensor:check --simulate                no hardware: synthetic EEG
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

void main();
