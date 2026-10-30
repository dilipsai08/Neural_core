# Hardware → Game Roadmap

How a focus score gets from the BioAmp EXG Pill on a player's forehead into the
zombies on screen, and how to build, test and run that link at the event.

> The focus score is a relative, per-player engagement estimate used as a game
> mechanic. It is **not** a medical or clinical measurement, and nothing in the
> product should claim otherwise.

---

## 1. The whole chain at a glance

```
 Player's forehead
   │  IN+ (Fp1)  IN− (left mastoid)  REF (right mastoid)
   ▼
 BioAmp EXG Pill  ── analog µV-level EEG, amplified, centred at VCC/2
   │  OUT → A0
   ▼
 Arduino UNO R4  ── samples A0 at 250 Hz, 14-bit, prints one integer per line
   │  USB serial 115200
   ▼
 ┌─────────────── one of ───────────────┐
 │ A. server laptop reads serial itself │  STATIONS="1=serial:COM3"
 │ B. node bridge on the kiosk laptop   │  pnpm bridge --port COM5 --server ws://SERVER:3001/ws --station 2
 │ C. browser bridge (Web Serial)       │  "Connect sensor on this laptop" button on /setup
 └──────────────────────────────────────┘
   │ raw ADC counts (bridges batch 10 samples per WebSocket message)
   ▼
 Neural Core server (Node)  apps/api/src/sensor
   1. spike removal, band-pass 0.5–45 Hz, 50 Hz ×2 + 100 Hz notches (biquads)
   2. 2 s window, 0.25 s hop, Welch PSD           (Hann, 1 s segments, FFT 256)
   3. theta / alpha / beta / 30–45 Hz power
   4. engagement index = beta / (alpha + theta)
   5. artifacts: blink hold, jaw-tension penalty
   6. signal quality: rails, flat line, mains hum
   7. calibration map → 0–100, EMA smoothing
   │  WebSocket frame, 4 Hz:  { type:"focus", station, t, score, raw, quality, artifact }
   ▼
 Kiosk browser (three.js game)  apps/web/game/arena.ts
   focus → distortion (smoothed) → enemy jitter, speed surges, blur, glitch, fade
   focus → focus chain → ×1 ×2 ×3 ×5 ×8 points, arc jumps, boss shield
   │  run events + the exact focus frames it received
   ▼
 Server verifies and stores the run (ledger.jsonl) → leaderboard → projector
```

**Design rule:** the firmware is dumb and the browser never computes the score.
All signal processing lives in one tested TypeScript module on the server, so
every kiosk, the projector and the operator see the same number, and tuning
never needs a reflash.

---

## 2. Hardware and wiring

| Item (from the kit) | Role |
|---|---|
| BioAmp EXG Pill | Bio-potential amplifier. Default configuration records EEG/EOG, which is what we want. No solder jumper changes needed. |
| Arduino UNO R4 (Minima or WiFi) | 14-bit ADC, native USB serial |
| BioAmp cable (3 leads, JST PH) | IN+, IN−, REF to the electrodes |
| Gel electrodes or BioAmp band | Skin contact |
| Nuprep skin-prep gel, alcohol wipes | Lower skin impedance → cleaner signal |
| Jumper cables | Pill ↔ Arduino |

Wiring, exactly as on the kit card:

```
BioAmp EXG Pill   Arduino UNO R4
VCC  ───────────► 5V
GND  ───────────► GND
OUT  ───────────► A0
```

⚠ **Never swap VCC and GND.** The Pill is destroyed instantly. Double-check
before plugging USB in.

Plug the BioAmp cable into the Pill's JST PH connector.

### Electrode placement for focus (forehead EEG)

| Lead | Where | Why |
|---|---|---|
| IN+ | Forehead, about 2 cm above the **left** eyebrow (Fp1) | Prefrontal activity, where engagement-related beta shows up |
| IN− | Forehead, about 2 cm above the **right** eyebrow (Fp2) | Second forehead site; the Pill records the difference between the two |
| REF | Bony bump behind the ear (mastoid) | Body reference |

Lead colours vary between cable versions. Check the IN+/IN−/REF markings on
your cable or the Upside Down Labs guide (QR code on the kit card).
Step-by-step fitting is in [`EEG_SETUP_GUIDE.md`](EEG_SETUP_GUIDE.md).

Skin prep matters more than anything else: a pea-sized dab of Nuprep, rub 5–10 s
with a cotton swab, wipe with alcohol, let it dry, then apply the gel electrode.

**Power:** run kiosk laptops **on battery** while a player is wired up. Mains
chargers inject 50 Hz hum that can swamp a forehead EEG.

---

## 3. Firmware

Two firmwares work, and the server tells them apart automatically:

| Firmware | Format | Rate | Baud |
|---|---|---|---|
| **Chords firmware** (Upside Down Labs, the one the Chords web visualiser uses) | binary packets `C7 7C counter ch0..chN 01`, A0 = channel 0 | 500 Hz on the UNO R4, averaged to 250 Hz | 230400 |
| **`firmware/neural_core_streamer`** (this repo) | one number per line | 250 Hz | 115200 |

If you already see your signal in Chords, keep that firmware and set
`SERIAL_BAUD=230400`. The server sends `START` to begin streaming and `STOP`
when it closes the port.

The Neural Core sketch:

- `analogReadResolution(14)` on the R4 (0–16383, mid-scale ≈ 8192).
- A `micros()`-paced loop samples A0 at exactly **250 Hz** and resyncs after USB stalls.
- Prints one integer per line at **115200 baud**, with a header line
  `#NC1 fs=250 bits=14 board=UNO_R4` on boot and whenever it receives `i`.

Bandwidth: ~6 bytes × 250 Hz = 1.5 kB/s, about 13% of a 115200 link.

Flash and verify:

1. Arduino IDE → Boards Manager → *Arduino UNO R4 Boards* → install.
2. Open the sketch, select the board and port, then click **Upload**.
3. Tools → Serial Plotter at 115200. Touch the IN+ electrode: the trace
   should jump; blink with the electrodes on: you should see big slow bumps.
4. **Close the plotter.** Only one program can own a serial port.

---

## 4. Connecting stations at the event (5–7 devices)

| Device | Count | Opens |
|---|---|---|
| Server laptop (runs `pnpm start`) | 1 | can also be station 1 |
| Kiosk laptops, one per kit | 1–4 | `http://SERVER:3001/?station=N` (once; it's remembered) |
| Projector / TV | 1 | `http://SERVER:3001/leaderboard/`, and `/winners/` at the end |
| Volunteer phone or tablet | 1 | `http://SERVER:3001/operator/` (PIN) |

Network: one offline router or switch. Give the server a fixed IP (DHCP
reservation). Everything is a single port (3001) on the server: website, REST
API and WebSocket. The server prints its LAN URLs on start.

Choose a path per station:

| Path | When | Setup |
|---|---|---|
| **A. Serial on server** | The kit is plugged into the server laptop | `.env`: `STATIONS="1=serial:COM3"` (Linux `/dev/ttyACM0`, macOS `/dev/cu.usbmodem…`), or pick the port in the operator panel |
| **B. Node bridge** | The kit is on a kiosk laptop (recommended for 2+ stations) | On the kiosk laptop: `pnpm bridge --port COM5 --server ws://SERVER:3001/ws --station 2`. The station switches to bridge mode by itself. `pnpm bridge --list` shows ports. |
| **C. Browser bridge** | Kiosk laptop has no Node installed | Chrome only. Web Serial needs a secure context, so either open the kiosk at `http://localhost` (if it is the server) or start Chrome with `--unsafely-treat-insecure-origin-as-secure=http://SERVER:3001`. Then use **Connect sensor on this laptop** on the headset screen. |
| **Fake** | Demo, rehearsal, or a dead sensor mid-event | Operator panel → *fake*. Slider or "wander". Runs are flagged `source was fake` in the operator log. |

Rehearse the network without hardware: `pnpm bridge --simulate --server ws://SERVER:3001/ws --station 2`.

---

## 5. Server pipeline (`apps/api/src/sensor`), step by step

All constants live in `packages/shared/src/constants.ts`.

1. **Centre and filter.** Subtract mid-scale, then a 2nd-order high-pass at
   0.5 Hz (removes electrode drift), two 2nd-order low-pass stages at 45 Hz,
   two cascaded notches at 50 Hz (Q 20 and 35, so a drifting venue mains is
   still caught) plus one at 100 Hz, its first harmonic (`MAINS_HZ=60` for
   60 Hz countries). The output is held for 1.5 s while the filters settle.
   **Before** the filters, a sample that jumps more than 8× the recent noise
   level away from the median of the last 5 samples (a static discharge, a
   cable knock, a phone transmitting next to the leads) is replaced by that
   median, so the filters never ring on it.
2. **Window.** Keep the last 2 s (500 samples). Every 0.25 s (62 samples) run
   an analysis, giving 4 frames per second.
3. **Spectrum.** Each 2 s window is clipped to median ± 5 robust std-devs
   (any surviving impulse cannot flood every band), then Welch's method: 1 s
   Hann segments with 50% overlap, zero-padded to a 256-point FFT, averaged.
4. **Bands.** theta 4–8, alpha 8–13, beta 13–30, "muscle" 30–45 Hz.
5. **Engagement index** `beta / (alpha + theta)`. Rises with task
   engagement and falls with relaxation or drowsiness.
6. **Artifacts.**
   - *Blink*: the newest 0.25 s contains a peak above 6× the robust std-dev of
     the window. The score is **held** (not penalised) for up to 500 ms.
   - *Jaw/forehead tension*: 30–45 Hz power above 35% of the total. This fakes
     high beta, so it is treated as distraction: up to −35 points, and the HUD
     says "unclench".
7. **Quality.** `bad` if >5% of samples are railed or the signal is flat
   (the EEG is unusable). Strong 50 Hz mains hum alone is `fair`: the notch
   removes it, so it warns instead of blocking. Otherwise `good`. The headset
   screen only lets a player continue on `good` (a volunteer override appears
   after 20 s). While quality is `bad` the focus score is **held** at its last
   value instead of following garbage, and the index fed to the score is the
   median of the last 5 windows, so one noisy window cannot move it.
8. **Calibration** (15 s relax with the breathing beacon, then 15 s focus by
   counting down from 100 in sevens). Windows with artifacts or bad quality are
   dropped. `low` = 10th percentile of relax, `high` = 90th percentile of focus.
   If those don't separate, the player's own 10th–90th range over both phases
   is used. Skipped calibration falls back to tonight's median calibration
   (after three players), then to a built-in default.
9. **Map and smooth.** `score = clamp((index − low)/(high − low), 0, 1) × 100`,
   then an EMA with α = 0.15 (≈1.7 s time constant).
10. **Broadcast.** One `focus` frame per hop to that station's kiosk, the
    projector and the operator. A `signal` frame (decimated waveform and band
    powers) goes out at 2 Hz for the headset screen.

Every function here is pure and covered by `apps/api/src/sensor/*.test.ts`
(filters, FFT, Welch, blink, tension, mains, rails, scorer).

### Latency budget

| Stage | Typical |
|---|---|
| Sampling + USB | < 10 ms |
| Window centre-of-mass (2 s window) | ~1 s of "memory" |
| Hop | ≤ 250 ms |
| EMA smoothing | ~1.7 s time constant |
| WebSocket on LAN | < 10 ms |
| Game distortion smoothing | 0.8 s time constant |

So the game responds to a change of mental state within about 1–2 s. That is
deliberate: fast enough to feel causal, slow enough that a single noisy window
never yanks the targets around.

---

## 6. How focus drives the game (`apps/web/game/arena.ts`)

### 6.1 Distortion: what a wandering mind does to the zombies

```
distortion d = smoothstep((60 − focus) / (60 − 30))             // 0 when focus ≥ 60, 1 at ≤ 30
d_display   += (d − d_display) × (1 − e^(−dt/0.8 s))           // no sudden jumps
```

At focus ≥ 60 every zombie walks at its fixed speed along its lane, with no
shake or blur. Below 30 it is as chaotic as the game gets.

| Effect | Formula / behaviour | Cap |
|---|---|---|
| **Speed surges and stalls** | progress = steady walk + `d × 0.12 × fbm(seed, 1.4t)` | ±12% of the crossing, so the average speed stays fixed and verification still works |
| **Lateral tremor** | `x += d(0.35 + 0.6d) × noise(seed, 11t) + 0.9d × fbm(seed, 2.6t)` | ≈ 1.6 m |
| **Depth wander** | `z += 2.4d × fbm(seed, 1.6t)` plus a fast shake | ≈ 2.6 m |
| **Hops** | `y = 0.35d × noise(seed, 7t)` | 0.35 m |
| **Glitch jumps** | above d = 0.3, more often as d rises: 2.2d m sideways teleports with flicker | 2.2 m |
| **Blur** | motion trails (after-image), a whole-screen radial blur that is strongest at the edges, chromatic split | trails damp ≤ 0.9 |
| **Lens** | chromatic split, desaturation, static grain, rolling bars, vignette | — |
| **Wraiths** | opacity `0.1 + 0.85 × (1 − d/0.85)`: they fade out when you drift | never fully invisible |
| **Crosshair** | ring opens with d; red dashed when scattered, arc-blue when locked | — |
| **Sound** | the substation hum detunes and wobbles with d; a clean tone fades in when locked | — |
| **World** | street lamps stutter; the Neural Core reactor glows with focus | — |

All of the noise is seeded per enemy, so two players with the same focus
curve see exactly the same motion. Hit boxes follow the **displayed**
position, so what you see is what you can hit.

### 6.2 Focus chain: the reward for staying steady

| Sustained focus ≥ 60 for | Multiplier | Extra |
|---|---|---|
| 0 s | ×1 | |
| 4 s | ×2 | Conductor's shield drops |
| 9 s | ×3 | each kill **arcs** into the nearest zombie |
| 15 s | ×5 | the arc **forks** to two zombies |
| 23 s | ×8 | "Overcharge" |

Dips shorter than 1.5 s are forgiven, so a blink or a cough doesn't break the
chain. The kiosk and the server run the same `ChainTracker` over the same
frames, so the multiplier on screen is the one the server pays out.

### 6.3 Scoring and fairness

- Points per kill: `base(enemy) × multiplier at that moment`. Shambler 100,
  Sparker 150, Wraith 200, Brute 300 (3 hits), Conductor 1500 (14 hits, shielded).
- Breach (a zombie reaches the gate): −100 points. **You can't die**: every
  shift runs the full 45 seconds. One game per registration.
- The same seeded wave (`EVENT_SEED`) for everyone, so skill and focus decide
  the board.
- **Server verification**: the kiosk submits its events and the focus frames
  it received, each tagged with the server timestamp of that frame. The server
  keeps 10 minutes of its own frames per station and keeps only frames it
  actually sent, with its own value. It then re-scores from scratch: unknown
  enemies, kills outside an enemy's life span, duplicate kills, kills without
  enough hits, arcs without an arc-level chain, and more hits than shots are
  all rejected. Breaches are derived, not reported. The server score is the
  official one; mismatches and fake-source runs are flagged for the operator.
- Signal lost for 2.5 s or "bad" quality for 4 s pauses the shift with the
  clock stopped, and it resumes by itself when the signal returns.

---

## 7. Build order and test plan

| # | Milestone | Done when |
|---|---|---|
| 1 | Flash firmware, see the trace in Serial Plotter | Blinks and jaw clenches are visible |
| 2 | `STATIONS="1=serial:<port>" pnpm start`, open `/setup/` | Waveform moves, quality reaches **good** with electrodes on |
| 3 | Record 2 minutes (operator → *Record*) of relax / focus / blinks / jaw | CSV in `data/recordings/` |
| 4 | Replay it: `STATIONS="1=replay:data/recordings/<file>.csv"` | Same numbers every run, so tuning is reproducible |
| 5 | Calibrate 5+ people, check the relax→focus separation in the operator log | Most people get `measured` calibrations |
| 6 | Play-test with 5+ people; tune `DISTORTION_FOCUS_CLEAN`, `CHAIN_FOCUS_THRESHOLD`, `TENSION_RATIO`, `BLINK_SIGMA` in `constants.ts` | Median player reaches ×3 at least once; nobody gets stuck at ×1 for the whole run |
| 7 | Full dry run with every kiosk, the projector and the operator device on the event router | 3 back-to-back players per station without a restart |

Automated checks: `pnpm test` (DSP, scoring, RNG, store), `pnpm typecheck`, `pnpm lint`.

---

## 8. Event-day checklist

- [ ] Server laptop on mains power; kiosk laptops **on battery** during play.
- [ ] `.env`: `OPERATOR_PIN`, `STATIONS`, `EVENT_NAME`.
- [ ] `pnpm build` done the day before. At the venue just run `pnpm start` (fully offline).
- [ ] Chrome kiosk mode: `chrome --kiosk --autoplay-policy=no-user-gesture-required http://SERVER:3001/?station=N`.
- [ ] Projector on `/leaderboard/`. Operator device unlocked on `/operator/`.
- [ ] Spare electrodes, wipes, prep gel, a spare Pill and Arduino.
- [ ] If a sensor dies: operator → station → **fake** (the run is flagged), then **Redo** later if needed.
- [ ] Back up `data/ledger.jsonl` at breaks (it is append-only and human-readable). **Export CSV** at the end.
- [ ] Freeze the board at the announced time, then open `/winners/` and press space to reveal 3rd, 2nd and 1st.

---

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "No headset data" | Wrong port, Serial Monitor still open, bridge not running | Close the IDE monitor; check `pnpm bridge --list`; check the operator log |
| Quality stuck on **bad**, waveform clipped | Electrode off the skin, cable unplugged, railing | Re-seat the electrodes, prep the skin, check the JST plug |
| Quality **fair/bad**, "mains hum" unchecked | Laptop charger, nearby lights or cables | Unplug the kiosk charger and move the cable away from power strips |
| Score pinned at 0 or 100 | Calibration range off | Recalibrate (result screen → Recalibrate) |
| "Jaw tension" warnings | Clenching or frowning | Tell the player to drop the shoulders and part the lips slightly |
| Big swings on every blink | Normal for forehead EEG; blink hold is 500 ms | Ask for soft eyes. Raise `BLINK_HOLD_MS` slightly if needed |
| Web Serial button missing | Not a secure context / not Chrome | Use the node bridge, or the Chrome flag in §4 |
| Kiosk shows "Reconnecting" | Wi-Fi drop | It reconnects by itself, and finished runs are kept in the browser until the server confirms them |

---

## 10. Next steps after the event

- Per-player adaptive normalisation (rolling percentiles) to cut calibration below 15 s.
- Second channel (Fp2) and frontal alpha asymmetry as an extra "calm" signal.
- Use the recorded CSVs to fit `TENSION_RATIO` and `BLINK_SIGMA` from real data.
- A head-to-head mode for two stations, with the same wave mirrored.
