# EEG Setup Guide: from electrodes to zombies

Step by step, from a working Chords visualiser to playing Neural Core with
your own focus. No Python is needed: the game server (Node) reads the Arduino
over USB, filters the EEG and turns it into a focus percentage in real time.

```
Electrodes → BioAmp EXG Pill → Arduino UNO R4 (A0) → USB cable
  → game server: reads Chords packets, filters 0.5–45 Hz + 50/100 Hz notches, removes spikes,
    measures theta/alpha/beta, engagement = beta / (alpha + theta),
    maps it to 0–100 % with your calibration (4 times a second)
  → game: low focus = shaking, blurring, lurching zombies;
          steady focus = still targets and ×2…×8 points
```

The focus score is a relative game metric, not a medical measurement.

---

## 0. What you need

From the DIY Neuroscience Kit Pro:

- BioAmp EXG Pill, wired to the **Arduino UNO R4**: VCC → 5V, GND → GND, OUT → A0
- BioAmp cable (3 leads: IN+, IN−, REF)
- 3 gel electrodes (or the BioAmp band), Nuprep skin-prep gel, alcohol wipes / cotton
- USB cable to the laptop that runs the game

On the laptop: the Neural Core project with `pnpm install` done, and the
Arduino IDE (only to find the port or reflash).

---

## 1. Keep the firmware you already have

The sketch you used with the **Chords visualiser** is the right one. The game
understands Chords packets directly, so there is nothing to reflash.

- It streams at **500 Hz** and **230400 baud**. The game averages pairs of
  samples down to the 250 Hz it analyses.
- It only streams after it receives `START`, which the game sends for you.

> Only one program can use the serial port. **Close the Chords browser tab and
> the Arduino IDE Serial Monitor/Plotter** before starting the game.

(Alternative: flash `firmware/neural_core_streamer` from this repo. It sends plain
text at 250 Hz and 115200 baud, and the game detects that automatically too.)

---

## 2. Find the Arduino's port

Plug the Arduino in, then either:

- Arduino IDE → **Tools → Port**: note it, e.g. `COM5` (Windows), `/dev/cu.usbmodem…` (Mac), `/dev/ttyACM0` (Linux); or
- in the `neural-core` folder:

  ```bash
  pnpm sensor:check --list
  ```

The examples below use `COM5`; use your own.

---

## 3. Fit the electrodes

1. **Prep the skin** at each spot: a pea-sized dab of Nuprep, rub for 5–10 s with
   a cotton swab, wipe with an alcohol wipe, let it dry. This matters more than
   anything else for a clean signal.
2. Stick on the gel electrodes:

   | Lead | Where |
   |---|---|
   | **IN+** | Forehead, about 2 cm above the **left** eyebrow (Fp1) |
   | **IN−** | Forehead, about 2 cm above the **right** eyebrow (Fp2) |
   | **REF** | The bony bump **behind the ear** (mastoid) |

   Check the IN+/IN−/REF labels on your cable; colours differ between versions.
3. Clip the leads on and push the cable into the Pill's JST connector.
4. **Unplug the laptop charger** while recording. The mains charger adds 50 Hz hum
   that can swamp forehead EEG. Run on battery.
5. Sit comfortably, shoulders down, jaw loose, eyes open and soft.

---

## 4. Check the signal in the terminal (before the game)

From the `neural-core` folder:

```bash
pnpm sensor:check --port COM5 --baud 230400 --rate 500
```

(`--rate 500` tells it the Chords sketch's `SAMP_RATE`; without it the rate is
detected automatically over the first ~8 s.) Within a few seconds you should see:

```
  serial COM5: open @ 230400 baud
  serial COM5: Chords firmware, 6 channels (using A0) @ 230400 baud
  serial COM5: 500 Hz in, averaging every 2 samples to 250 Hz
GOOD θ 34% α 49% β 17% hi  0%  idx 0.19  focus ██······  8%
```

Each line is half a second: signal quality, the share of theta (θ), alpha (α),
beta (β) and muscle noise (hi), the engagement index, and the focus %.

Try these, so you know the pipeline reacts to *you*:

| Do this | Expect |
|---|---|
| Blink a few times | `blink (held)`: the score is frozen for up to half a second, not punished |
| Clench your jaw | `hi` jumps and `JAW TENSION: relax`: the score drops |
| Close your eyes and relax for 10 s | α goes up, focus goes down |
| Eyes open, count down 100, 93, 86 … in your head | β goes up, focus rises within 1–2 s |

Now run it with a personal calibration, which is what the game does too:

```bash
pnpm sensor:check --port COM5 --baud 230400 --rate 500 --calibrate
```

Follow the prompts: **15 s relax** (slow breathing), then **15 s focus** (count
down in sevens). After that it prints your range, e.g.
`your range: index 0.31 (relaxed) → 1.12 (focused)`, and the live focus % uses it.
Relaxing should bring the bar down, and doing arithmetic should push it up.

If you see `BAD`: press the electrodes down, re-prep the skin, check the cable
clip. If `hi` is high all the time, relax the forehead and jaw. Press Ctrl+C to quit.

---

## 5. Point the game at the headset

Edit `neural-core/.env` and change these two lines (keep everything else):

```env
STATIONS=1=serial:COM5
SERIAL_BAUD=230400
SERIAL_RATE=500
```

Start the game:

```bash
pnpm dev
```

The server terminal should show the same detection lines as in step 4:

```
[neural-core] Station 01: source → serial COM5 @ 230400
[neural-core] serial COM5: Chords firmware, 6 channels (using A0) @ 230400 baud
[neural-core] serial COM5: 500 Hz in, averaging every 2 samples to 250 Hz
```

(If `SERIAL_BAUD` is left at 115200 it still works: after about 3 s the server says
`no recognisable data @ 115200, trying 230400 baud` and switches by itself.)

You can also switch sources without restarting: open `http://localhost:3000/operator/`
(PIN from `.env`) → Station 01 → **Serial port…** → pick `COM5` → **Use**.

---

## 6. Play with your brain

1. Open **http://localhost:3000** and click **Start your shift**.
2. **Register** (name, roll number, consent).
3. **Headset screen.** The live waveform is your EEG. The lamp must turn green
   (**Signal clean**) and the checklist should be all ticks:
   - *Headset streaming*: data is arriving
   - *Within amplifier range*: not clipping
   - *Low mains hum*: charger unplugged
   - *Jaw relaxed*: little muscle noise

   The needle on the right is your live focus.
4. **Calibrate**: 15 s relax with the breathing beacon, then 15 s counting down
   from 100 in sevens. This sets *your* personal 0–100 % scale.
5. **Play.** The focus gauge at the bottom is your live score, and the enemies react to it:

   | Your focus | What the zombies do | Points |
   |---|---|---|
   | 60 %+ (focused) | Walk at a fixed speed on their lane, crisp and still: easy to hit | chain grows |
   | 30–60 % (drifting) | Tremble, wander in depth, speed up and slow down; the edges blur | |
   | under 30 % (scattered) | Shake hard, hop, glitch-jump sideways and flicker, leave blur trails; wraiths fade out; the whole picture smears | chain breaks |
   | ≥ 60 % held for 4 / 9 / 15 / 23 s | | ×2 / ×3 (kills arc to the next zombie) / ×5 / ×8 |

   Changes are smoothed over about a second, so they feel gradual rather than jumpy.
6. After 45 s you get your score card (15 s, or press **Skip**), then tonight's top 3,
   then the kiosk goes back to the home screen. Each registration plays once.

**Tips for a strong, readable signal while playing:** keep your head still and
look at the screen rather than around it. Breathe out slowly when the zombies
start to blur, and keep your jaw and forehead soft. Big eye movements and
frowning show up on forehead electrodes.

---

## 6b. Two laptops: one for the Arduino, one for the game

Everything above uses one laptop. You can also split it: **Laptop H** has the
Arduino plugged in, **Laptop G** runs the game. Laptop H runs a small bridge
that forwards the raw samples over Wi-Fi; Laptop G does all the processing.

1. Put both laptops on the **same Wi-Fi or hotspot**.
2. On **Laptop G**, find its IP address: `ipconfig` (Windows; IPv4 Address,
   e.g. `192.168.1.20`) or `ipconfig getifaddr en0` (Mac).
3. On **Laptop G**, in `.env` set `STATIONS=1=bridge`, then run `pnpm dev`.
   The first time, Windows asks whether Node.js may use the network: tick
   **Private networks** and click **Allow**.
4. On **Laptop H** (it also needs Node, pnpm, the project and `pnpm install`;
   no `.env` needed), close Chords and the Arduino Serial Monitor, then run:

   ```bash
   pnpm bridge --port COM5 --baud 230400 --server ws://192.168.1.20:3001/ws --station 1
   ```

   You should see `Chords firmware … @ 230400 baud`, `connected to ws://…`, and
   every 5 s `… (250 Hz to server)`. You can still check the signal on Laptop H
   first with `pnpm sensor:check --port COM5 --baud 230400`.
5. Play on **Laptop G** at `http://localhost:3000`. The headset screen and the
   operator console show the station as *bridge · Bridge 192.168.1.x*.

If the bridge says `ECONNREFUSED` or keeps retrying: check the IP, that both are
on the same network, and the firewall prompt (Windows Defender Firewall → Allow
an app → Node.js → Private). Public/guest Wi-Fi often blocks laptops from
talking to each other; use a phone hotspot instead.

## 7. If something is off

| Symptom | Fix |
|---|---|
| `Access denied` / `Resource busy` on COM5 | Close the Chords tab, Arduino Serial Monitor/Plotter, or any other program using the port |
| `no recognisable data` on every baud | Wrong port, or the board is running another sketch. Re-check the port; reflash the Chords firmware or our sketch |
| `open failed … File not found` | Unplug and replug the USB cable; the COM number may have changed |
| Quality **BAD**, waveform flat or clipped | Electrode off the skin, cable clip loose, or VCC/GND/OUT wiring. Reseat everything |
| Quality **FAIR** in the terminal / "Signal noisy" in the game, "Low mains hum" unchecked | Unplug the laptop charger, move away from power strips |
| `BAD` with beta near 100 % and a huge `idx` | Wrong sample rate: set `--rate 500` / `SERIAL_RATE=500` for the Chords sketch. Run `pnpm sensor:check --port COM5 --raw` to see packets/s |
| Focus stuck near 0 % or 100 % | Re-seat the electrodes and recalibrate (`--calibrate` in the terminal; in the game, calibration runs before the shift) |
| Focus jumps around in a noisy hall | Keep the BioAmp cable short and away from power strips, phones and the laptop charger; twist the three leads together; run on battery. The server already drops spikes, notches 50/100 Hz and holds the score while the signal is bad |
| Focus jumps on every blink | Normal on the forehead; the game holds the score through blinks. Soft eyes help |
| Game pauses with "Headset signal lost" | No data for 2.5 s (cable pulled or the port closed). It resumes by itself when data returns |
| No hardware today | `.env`: `STATIONS=1=fake`, or operator console → Station → **fake**, with a slider to fake focus |

Want to tune with real data? Operator console → **Record** saves your raw
signal to `data/recordings/*.csv`. Replay it any time with
`STATIONS=1=replay:data/recordings/<file>.csv`.

More detail on the signal processing and the event setup:
[`HARDWARE_ROADMAP.md`](HARDWARE_ROADMAP.md).
