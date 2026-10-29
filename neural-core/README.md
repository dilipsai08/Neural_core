# Neural Core: Substation 07

A brain-controlled arena game for live events. A forehead EEG sensor (Upside
Down Labs BioAmp EXG Pill on an Arduino UNO R4) turns the player's
concentration into a 0–100 focus score in real time. Zombies charged with
stray current walk across a rain-soaked street toward the last live
substation. You fire the arc with the mouse. **When your mind wanders the
zombies shake, blur, lurch and glitch. When you stay focused they steady and
your kills chain ×2 → ×3 → ×5 → ×8.** Every shift lasts exactly 60 seconds, and
you can't die.

```
BioAmp EXG Pill → Arduino UNO R4 (250 Hz) → USB → Node server (DSP → focus score)
      → WebSocket 4 Hz → three.js game on each kiosk → verified runs → live leaderboard
```

- **Hardware link, DSP and tuning:** [`docs/HARDWARE_ROADMAP.md`](docs/HARDWARE_ROADMAP.md)
- **Firmware:** [`firmware/`](firmware/README.md)

## Run it at the event

Requirements: Node 20+ and pnpm 9 on the server laptop. Kiosks only need Chrome.

```bash
pnpm install
pnpm build
cp .env.example .env     # set OPERATOR_PIN, STATIONS, EVENT_NAME
pnpm start               # one process, one port (3001): site + API + WebSocket
```

The server prints its LAN address. Then open:

| Screen | URL |
|---|---|
| Kiosk N (remembered after the first visit) | `http://SERVER:3001/?station=N` |
| Projector leaderboard | `http://SERVER:3001/leaderboard/` |
| Operator console (PIN) | `http://SERVER:3001/operator/` |
| End-of-day winner reveal | `http://SERVER:3001/winners/` |

Sensor on a kiosk laptop instead of the server? Run the bridge there:

```bash
pnpm bridge --port COM5 --server ws://SERVER:3001/ws --station 2
```

No hardware yet? `STATIONS="1=fake"` (the default) runs synthetic EEG through
the real pipeline, and the operator console has a focus slider.

## Develop

```bash
pnpm dev          # API on :3001 (tsx watch) + Next dev server on :3000
pnpm test         # DSP, scoring, RNG and store tests (vitest)
pnpm typecheck
pnpm lint
```

## Layout

```
apps/api        Express + ws server: sensor sources, DSP, stations, run verification, ledger store, operator API
apps/web        Next.js (static export): kiosk flow, three.js arena, projector, operator console
packages/shared Types, zod schemas, constants, seeded RNG, wave generator, chain tracker, authoritative scoring
firmware        Arduino UNO R4 raw sample streamer
docs            Hardware → game roadmap
```

## The game

| | |
|---|---|
| Story | The Neural Core, a city-wide brain-computer grid, fed back at 23:14. The dead walk on stray current toward Substation 07. A calm human mind jams their signal, which is why the emitter runs on your headset. |
| Acts | Brownout (0–14 s), Surge (14–28 s), Overload (28–41 s), The Conductor (41–60 s) |
| Enemies | Shambler, Sparker (fast), Brute (3 hits), Wraith (fades when you drift), the Conductor (boss; shielded until you hold a ×2 chain) |
| Score | base × focus-chain multiplier; −100 per breach; ties broken by average focus, then accuracy |
| Replay loop | 3 ranked shifts per player (`ATTEMPTS_PER_PLAYER`), best one counts, encore shifts after that; rank titles unlock four story logs; the result screen shows the gap to the next place |
| Fairness | Same seeded wave for everyone; the server re-scores every run from the focus frames it actually sent |

## Decisions that supersede `info.md`

The current brief takes priority over the original spec:

- **60-second** round (was 90 s). No practice round. Calibration is 20 s + 20 s.
- **Electrical-zombie** theme and story replace the abstract shooting range.
- **Focus-chain multipliers** ×1/2/3/5/8 for sustained focus replace the flat 1×/2×/3× tiers.
- **Append-only JSONL ledger** (`data/ledger.jsonl`, fsynced per write) instead of PostgreSQL. It needs zero setup offline, never loses a finished run and is easy to audit. CSV export is in the operator console.
- **Up to 3 ranked attempts** per player (configurable, `1` restores the original rule), best run ranked.
- **Single process, single port:** the API serves the static Next export, so the venue runs one command.

The focus score is a relative game metric, not a medical measurement.
