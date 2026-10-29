/*
 * Neural Core: raw EEG streamer
 * Board : Arduino UNO R4 (Minima or WiFi). Works on UNO R3 at 10-bit.
 * Sensor: Upside Down Labs BioAmp EXG Pill (default EEG/EOG configuration)
 *
 * Wiring (from the kit card):
 *   BioAmp VCC -> 5V
 *   BioAmp GND -> GND
 *   BioAmp OUT -> A0
 *
 * The firmware stays dumb on purpose: it samples A0 at a fixed 250 Hz and
 * prints one integer per line. All filtering, FFT and scoring run in the
 * Neural Core server, where they are tested and can be tuned without
 * reflashing.
 *
 * Protocol (115200 baud, '\n' line endings):
 *   #NC1 fs=250 bits=14 board=UNO_R4     header, on boot and when 'i' is received
 *   8231                                 one raw ADC sample per line
 *
 * Run on battery power (laptop unplugged from the wall) during play: it
 * removes most of the 50 Hz mains hum.
 */

#define SAMPLE_RATE_HZ 250
#define BAUD_RATE      115200
#define INPUT_PIN      A0

#if defined(ARDUINO_UNOR4_MINIMA) || defined(ARDUINO_UNOR4_WIFI)
  #define ADC_BITS 14
  #define BOARD_NAME "UNO_R4"
#else
  #define ADC_BITS 10
  #define BOARD_NAME "AVR"
#endif

const unsigned long SAMPLE_PERIOD_US = 1000000UL / SAMPLE_RATE_HZ;
unsigned long nextSampleUs = 0;

void printHeader() {
  Serial.print(F("#NC1 fs="));
  Serial.print(SAMPLE_RATE_HZ);
  Serial.print(F(" bits="));
  Serial.print(ADC_BITS);
  Serial.print(F(" board="));
  Serial.println(F(BOARD_NAME));
}

void setup() {
  Serial.begin(BAUD_RATE);
  // Native USB on the R4: wait briefly for the host, but never block forever.
  unsigned long start = millis();
  while (!Serial && millis() - start < 2000) {}
#if ADC_BITS == 14
  analogReadResolution(14);
#endif
  pinMode(INPUT_PIN, INPUT);
  printHeader();
  nextSampleUs = micros();
}

void loop() {
  // Host commands: 'i' re-sends the header (the server asks on connect).
  while (Serial.available() > 0) {
    if (Serial.read() == 'i') printHeader();
  }

  unsigned long now = micros();
  // Signed difference survives the micros() wrap every ~70 minutes.
  if ((long)(now - nextSampleUs) >= 0) {
    nextSampleUs += SAMPLE_PERIOD_US;
    // If we fell far behind (USB stall), resync instead of bursting.
    if ((long)(now - nextSampleUs) > (long)(SAMPLE_PERIOD_US * 10)) nextSampleUs = now + SAMPLE_PERIOD_US;
    int value = analogRead(INPUT_PIN);
    Serial.println(value);
  }
}
