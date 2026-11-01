# Neural Core: Substation 07

A brain-controlled arena game for live events. A forehead EEG sensor (Upside
Down Labs BioAmp EXG Pill on an Arduino UNO R4) turns the player's
concentration into a 0–100 focus score in real time. Zombies charged with
stray current walk across a rain-soaked street toward the last live
substation. You fire the arc with the mouse. **When your mind wanders the
zombies shake, blur, lurch and glitch. When you stay focused they steady and
your kills chain ×2 → ×3 → ×5 → ×8.** Every shift lasts exactly 45 seconds, each
registration plays once, and you can't die.

```
BioAmp EXG Pill → Arduino UNO R4 (250 Hz) → USB → Node server (DSP → focus score)
      → WebSocket 4 Hz → three.js game on each kiosk → verified runs → live leaderboard
```

- **Connect your headset (start here):** [`docs/EEG_SETUP_GUIDE.md`](docs/EEG_SETUP_GUIDE.md)
- **Hardware link, DSP and tuning:** [`docs/HARDWARE_ROADMAP.md`](docs/HARDWARE_ROADMAP.md)
- **Firmware:** [`firmware/`](firmware/README.md)

## Run it locally

Requirements: Node 20+ and pnpm 9. The leaderboard database is online (free),
so there is nothing to install for it.

```bash
pnpm install
cp .env.example .env     # Windows: copy .env.example .env
pnpm dev                 # game on http://localhost:3000, server on http://localhost:3001
```

Or run the built version on a single port:

```bash
pnpm build
pnpm start               # everything on http://localhost:3001
```

### Online leaderboard database (Neon, free)

Players and runs are stored in a free hosted PostgreSQL database on
[Neon](https://neon.tech) (no credit card needed).

1. Sign up at <https://console.neon.tech> (GitHub or Google login works).
2. **Create project** → name `neural-core`, Postgres version: default, region: closest to the venue (e.g. *AWS Asia Pacific (Singapore)* for India) → **Create**.
3. On the project dashboard click **Connect**, keep database `neondb`, and copy the connection string. It looks like
   `postgresql://neondb_owner:xxxx@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require`
4. Paste it into `.env`:
   ```
   DATABASE_URL=postgresql://neondb_owner:xxxx@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
   ```
5. `pnpm dev`. The server log shows `postgres: connected to ep-xxxx…neon.tech, synced …`. The `players` and `runs` tables are created automatically.

**Where to see the data:** <https://console.neon.tech> → your project → **Tables**
(sidebar) to browse `players` and `runs`, or **SQL Editor** to query, e.g.

```sql
select p.full_name, r.score, r.avg_focus, r.accuracy, r.finished_at
from runs r join players p on p.id = r.player_id
where r.status = 'valid'
order by r.score desc;
```

`.env` is git-ignored, so the connection string (it contains the password)
never gets committed. Share it with teammates privately.

If the internet drops at the venue the game keeps working: every run is
written to `data/ledger.jsonl` first, the leaderboard is served from it, and
the online database is re-synced automatically when the connection returns.
Leave `DATABASE_URL` empty to run fully offline.

**Kiosk backup (24 h).** Each kiosk browser also keeps its own backup of
name, roll number and score, for when Neon can't be reached. It is encrypted
(AES-GCM; the key is a non-extractable browser key that can't be read out),
never leaves that browser, and every entry deletes itself 24 hours after it
was saved. View, download as CSV or delete it in the operator console
(`/operator/`, bottom panel). Browsers only allow the encryption on
`http://localhost` or HTTPS, so open the kiosk via localhost; elsewhere the
backup switches itself off rather than store anything unencrypted.

| Screen | URL (dev: port 3000, built: port 3001) |
|---|---|
| Kiosk N (remembered after the first visit) | `http://localhost:3000/?station=N` |
| Projector leaderboard | `http://localhost:3000/leaderboard/` |
| Operator console (PIN) | `http://localhost:3000/operator/` |
| End-of-day winner reveal | `http://localhost:3000/winners/` |

Other laptops on the same network can open the same pages using the server
laptop's IP instead of `localhost`.

Sensor on a kiosk laptop instead of the server? Run the bridge there:

```bash
pnpm bridge --port COM5 --server ws://SERVER:3001/ws --station 2
```

No hardware yet? `STATIONS="1=fake"` (the default) runs synthetic EEG through
the real pipeline, and the operator console has a focus slider.

## Leaderboard display screen

The game server also serves a full-screen leaderboard for a second monitor
or laptop on its own port, **`http://localhost:4000`** (`DISPLAY_PORT`). From
another laptop open `http://<game laptop IP>:4000`.

- Top 10 with the NIT Warangal, EES and Technozion logos; names and scores only.
- **No polling.** The page keeps one WebSocket open. When a shift finishes the
  server builds the board once, from its ledger (the same data the online
  database mirrors, so no database query), and pushes it to every screen.
- Changes animate: rows slide to their new rank, a new entry slides in and
  glows, scores count up, and a "Shift complete" banner names the player.
- Kiosk mode: `chrome --kiosk http://localhost:4000` (F11 in any browser).

## Develop

```bash
pnpm dev          # API on :3001 (tsx watch) + Next dev server on :3000
pnpm test         # DSP, scoring, RNG and store tests (vitest)
pnpm typecheck
pnpm lint
```

## Layout

```
apps/api        Express + ws server: sensor sources, DSP, stations, run verification, ledger + PostgreSQL store, operator API
apps/web        Next.js (static export): kiosk flow, three.js arena, projector, operator console
packages/shared Types, zod schemas, constants, seeded RNG, wave generator, chain tracker, authoritative scoring
firmware        Arduino UNO R4 raw sample streamer
docs            Hardware → game roadmap
```

## The game

| | |
|---|---|
| Story | The Neural Core, a city-wide brain-computer grid, fed back at 23:14. The dead walk on stray current toward Substation 07. A calm human mind jams their signal, which is why the emitter runs on your headset. |
| Acts | Brownout (0–11 s), Surge (11–22 s), Overload (22–31 s), The Conductor (31–45 s) |
| Enemies | Shambler, Sparker (fast), Brute (3 hits), Wraith (fades when you drift), the Conductor (boss; shielded until you hold a ×2 chain) |
| Score | base × focus-chain multiplier; −100 per breach; ties broken by average focus, then accuracy |
| After the shift | One game per registration. The score card shows for 15 s (Skip to move on), an arc wipe reveals tonight's top 3 for 10 s, then the kiosk returns to the home screen. Rank titles unlock four story logs |
| Fairness | Same seeded wave for everyone; the server re-scores every run from the focus frames it actually sent |

## Decisions that supersede `info.md`

The current brief takes priority over the original spec:

- **45-second** round (was 90 s). No practice round. Calibration is 15 s relax + 15 s focus.
- **Electrical-zombie** theme and story replace the abstract shooting range.
- **Focus-chain multipliers** ×1/2/3/5/8 for sustained focus replace the flat 1×/2×/3× tiers.
- **Online PostgreSQL leaderboard (Neon) plus a local ledger.** Players and runs are stored in a free hosted PostgreSQL database (`players`, `runs` tables), which serves the leaderboard. Every change is also appended to `data/ledger.jsonl` first, so a lost connection never loses a run. CSV export is in the operator console.
- **One game per registration.** The server refuses a second run for the same player (`ALREADY_PLAYED`); a volunteer can give the attempt back with "redo" in the operator console. `ATTEMPTS_PER_PLAYER` in an old `.env` is ignored.
- **Single process, single port:** the API serves the static Next export, so the venue runs one command.

The focus score is a relative game metric, not a medical measurement.
