"use client";

import { ADC_BITS_DEFAULT, BRIDGE_BATCH_SAMPLES, SERIAL_BAUD_DEFAULT } from "@neural-core/shared";
import { link } from "./link";

/**
 * Browser bridge: reads the Arduino over Web Serial on the kiosk laptop and
 * forwards raw samples to the server, which still does all the DSP.
 *
 * Web Serial needs a secure context: http://localhost works; for a LAN address
 * launch Chrome with --unsafely-treat-insecure-origin-as-secure=http://<server>:3001
 * (see docs/HARDWARE_ROADMAP.md), or use the node bridge instead.
 */
interface SerialPortLike {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}

class WebSerialBridge {
  private port: SerialPortLike | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private listeners = new Set<() => void>();
  running = false;
  samples = 0;
  error: string | null = null;

  get supported(): boolean {
    return typeof navigator !== "undefined" && "serial" in navigator && window.isSecureContext;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  async start(station: number): Promise<void> {
    if (this.running) return;
    this.error = null;
    try {
      const serial = (navigator as unknown as { serial: { requestPort(): Promise<SerialPortLike> } }).serial;
      this.port = await serial.requestPort();
      await this.port.open({ baudRate: SERIAL_BAUD_DEFAULT });
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Could not open the USB port";
      this.emit();
      return;
    }
    this.running = true;
    this.emit();
    link.connect("kiosk", station);
    void this.pump(station);
  }

  private async pump(station: number): Promise<void> {
    const decoder = new TextDecoder();
    let buf = "";
    let bits = ADC_BITS_DEFAULT;
    let batch: number[] = [];
    try {
      const w = this.port!.writable?.getWriter();
      await w?.write(new TextEncoder().encode("i\n"));
      w?.releaseLock();
      this.reader = this.port!.readable!.getReader();
      while (this.running) {
        const { value, done } = await this.reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl = buf.indexOf("\n");
        while (nl >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          nl = buf.indexOf("\n");
          if (line.startsWith("#")) {
            const m = /bits=(\d+)/.exec(line);
            if (m) bits = Number(m[1]);
          } else if (/^\d{1,5}$/.test(line)) {
            batch.push(Number(line));
            if (batch.length >= BRIDGE_BATCH_SAMPLES) {
              link.send({ type: "bridge:samples", station, bits, counts: batch });
              this.samples += batch.length;
              batch = [];
            }
          }
        }
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : "USB read failed";
    } finally {
      this.running = false;
      this.emit();
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    try {
      await this.reader?.cancel();
      await this.port?.close();
    } catch {
      // Port already gone (cable pulled): nothing left to release.
    }
    this.port = null;
    this.emit();
  }
}

export const webSerialBridge = new WebSerialBridge();
