import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import { ADC_BITS_DEFAULT, type FocusSource, type RawSample } from "@neural-core/shared";
import { parseSerialLine } from "./serial-protocol.js";

export interface SerialSourceOptions {
  path: string;
  baud: number;
  log: (msg: string) => void;
}

/**
 * Reads the Arduino UNO R4 streamer over USB serial. Reconnects with backoff
 * if the cable is pulled or the board resets.
 */
export class SerialSource implements FocusSource {
  readonly kind = "serial" as const;
  adcMax = 2 ** ADC_BITS_DEFAULT - 1;
  connected = false;
  lastError: string | null = null;

  private port: SerialPort | null = null;
  private listeners: Array<(s: RawSample) => void> = [];
  private bitsListeners: Array<(adcMax: number) => void> = [];
  private stopped = true;
  private retryMs = 1000;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: SerialSourceOptions) {}

  async start(): Promise<void> {
    this.stopped = false;
    this.open();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const port = this.port;
    this.port = null;
    if (port?.isOpen) await new Promise<void>((resolve) => port.close(() => resolve()));
    this.connected = false;
  }

  onSample(cb: (s: RawSample) => void): void {
    this.listeners.push(cb);
  }

  onAdcMax(cb: (adcMax: number) => void): void {
    this.bitsListeners.push(cb);
  }

  private open(): void {
    if (this.stopped) return;
    const port = new SerialPort({ path: this.opts.path, baudRate: this.opts.baud, autoOpen: false });
    const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));
    this.port = port;

    parser.on("data", (line: string) => {
      const parsed = parseSerialLine(line);
      if (parsed.kind === "sample") {
        const s: RawSample = { t: Date.now(), counts: parsed.counts };
        for (const cb of this.listeners) cb(s);
      } else if (parsed.kind === "header" && parsed.bits) {
        this.adcMax = 2 ** parsed.bits - 1;
        for (const cb of this.bitsListeners) cb(this.adcMax);
        this.opts.log(`serial ${this.opts.path}: firmware ${parsed.raw}`);
      }
    });

    port.on("close", () => {
      this.connected = false;
      this.opts.log(`serial ${this.opts.path}: closed`);
      this.scheduleRetry();
    });
    port.on("error", (err) => {
      this.lastError = err.message;
      this.opts.log(`serial ${this.opts.path}: ${err.message}`);
    });

    port.open((err) => {
      if (err) {
        this.lastError = err.message;
        this.connected = false;
        this.opts.log(`serial ${this.opts.path}: open failed, ${err.message}`);
        this.scheduleRetry();
        return;
      }
      this.connected = true;
      this.lastError = null;
      this.retryMs = 1000;
      this.opts.log(`serial ${this.opts.path}: open @ ${this.opts.baud}`);
      // Ask the firmware to (re)print its header.
      port.write("i\n");
    });
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 5000);
  }
}

export async function listSerialPorts(): Promise<Array<{ path: string; label: string }>> {
  const ports = await SerialPort.list();
  return ports.map((p) => ({
    path: p.path,
    label: [p.manufacturer, p.vendorId && `${p.vendorId}:${p.productId}`].filter(Boolean).join(" ") || p.path,
  }));
}
