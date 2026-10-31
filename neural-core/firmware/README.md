# Firmware

**Both sketches read the BioAmp signal from A1**, because A0 on our board is
faulty. Wiring: VCC → 5V, GND → GND, **OUT → A1**.

## `chords_uno_r4` (the one we run at the event)

The Upside Down Labs Chords firmware with one line changed: channel 0 of each
packet, the one the game reads, is sampled from A1 instead of A0. Everything
else (500 Hz, 230400 baud, 6-channel packets, START/STOP) is unchanged, so the
bridge and game work exactly as before (`--rate 500`, `SERIAL_RATE=500`).

Arduino IDE → open `chords_uno_r4/chords_uno_r4.ino` → Board *Arduino UNO R4
Minima* → your port → Upload. Close the bridge, `sensor:check` and the Serial
Monitor first.

## `neural_core_streamer` (alternative)

Streams raw BioAmp EXG Pill samples from **A1** at **250 Hz** over USB serial
(115200 baud), one integer per line, with a `#NC1 fs=250 bits=14` header.

1. Arduino IDE → Boards Manager → install **Arduino UNO R4 Boards**.
2. Open `neural_core_streamer/neural_core_streamer.ino`, select *Arduino UNO R4 Minima/WiFi* and the port, then upload.
3. Open the Serial Monitor at 115200: you should see the header and then a
   stream of numbers around 8192 (mid-scale of the 14-bit ADC). Close the
   monitor before starting the server, because only one program can hold the port.

Wiring: VCC → 5V, GND → GND, OUT → A1 (the kit card says A0; ours is faulty). Do not swap VCC and GND, because that destroys the Pill.

The full pipeline, protocol and tuning notes are in [`docs/HARDWARE_ROADMAP.md`](../docs/HARDWARE_ROADMAP.md).
