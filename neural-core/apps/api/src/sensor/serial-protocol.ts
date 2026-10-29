/**
 * Line protocol spoken by firmware/neural_core_streamer:
 *
 *   #NC1 fs=250 bits=14 board=UNO_R4   header (on boot and on "i")
 *   8231                               one raw ADC sample per line
 *
 * Anything else is ignored so stray debug prints never crash the reader.
 */
export type SerialLine =
  | { kind: "sample"; counts: number }
  | { kind: "header"; raw: string; bits: number | null; fs: number | null }
  | { kind: "ignored" };

export function parseSerialLine(line: string): SerialLine {
  const s = line.trim();
  if (s.length === 0) return { kind: "ignored" };
  if (s.startsWith("#")) {
    const bits = /bits=(\d+)/.exec(s);
    const fs = /fs=(\d+)/.exec(s);
    return {
      kind: "header",
      raw: s,
      bits: bits ? Number(bits[1]) : null,
      fs: fs ? Number(fs[1]) : null,
    };
  }
  if (!/^\d{1,5}$/.test(s)) return { kind: "ignored" };
  const counts = Number(s);
  return counts <= 65535 ? { kind: "sample", counts } : { kind: "ignored" };
}
