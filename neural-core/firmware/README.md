# Firmware: `neural_core_streamer`

Streams raw BioAmp EXG Pill samples from **A0** at **250 Hz** over USB serial
(115200 baud), one integer per line, with a `#NC1 fs=250 bits=14` header.

1. Arduino IDE → Boards Manager → install **Arduino UNO R4 Boards**.
2. Open `neural_core_streamer/neural_core_streamer.ino`, select *Arduino UNO R4 Minima/WiFi* and the port, then upload.
3. Open the Serial Monitor at 115200: you should see the header and then a
   stream of numbers around 8192 (mid-scale of the 14-bit ADC). Close the
   monitor before starting the server, because only one program can hold the port.

Wiring: VCC → 5V, GND → GND, OUT → A0 (as on the kit card). Do not swap VCC and GND, because that destroys the Pill.

The full pipeline, protocol and tuning notes are in [`docs/HARDWARE_ROADMAP.md`](../docs/HARDWARE_ROADMAP.md).
