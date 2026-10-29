# Neural Core: AI-Assisted Development Spec

> Read this file fully before writing code. It is the source of truth for scope, architecture, conventions and UI quality. If something here conflicts with a quick idea, follow this file and ask before deviating.

---

## 1. Project Summary

**Neural Core** is a live-event target-shooting game controlled by the player's concentration. A forehead EEG sensor (BioAmp EXG Pill on an ESP32/Arduino) produces a 0-100 focus score. That score drives target stability, scoring multipliers and enemy behavior. Players register, calibrate, play one scored 90-second round, and appear on a live leaderboard. Winners are announced at the end of the day.

- **Context:** single-venue kiosk event, one player at a time per station, 100-300 players total.
- **Primary users:** players (public), volunteers (operator panel), audience (projector leaderboard).
- **Hard constraints:** must work offline on a local network, must survive sensor failure (fake-focus fallback), must never lose a recorded run.
- **Tone:** a polished product demo, not a hackathon toy.

### Non-goals
- No medical claims. The score is a relative engagement estimate, shown as a game metric.
- No cloud dependency, no user accounts or passwords, no mobile-first layout (kiosk and projector first).
- No multiplayer duel in v1.

---

## 2. Tech Stack

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere (`strict: true`) |
| Frontend | Next.js (App Router), React |
| Styling | **Vanilla CSS only**: CSS Modules + global design tokens as CSS custom properties. No Tailwind, no UI kits, no CSS-in-JS |
| 3D | `three` (WebGL) for the game scene; CSS 3D transforms for UI depth. `@react-three/fiber` is allowed if it keeps the scene code clean |
| Backend | Node.js + Express |
| Realtime | `ws` WebSocket server inside the Express process |
| Database | PostgreSQL via `pg` with plain SQL migrations (`node-pg-migrate`) |
| Validation | `zod` schemas in a shared package |
| Sensor bridge | `serialport` in the Node API, reading the ESP32 over USB serial |
| Tests | `vitest` (unit), `playwright` (one end-to-end happy path) |
| Tooling | pnpm workspaces, ESLint, Prettier, `tsx` for scripts |

---

## 3. Repository Layout

```
neural-core/
├─ apps/
│  ├─ web/                 # Next.js app (kiosk, projector, operator)
│  │  ├─ app/
│  │  │  ├─ (kiosk)/       # attract, register, setup, calibrate, practice, play, result
│  │  │  ├─ leaderboard/   # projector display
│  │  │  ├─ operator/      # volunteer panel (PIN protected)
│  │  │  └─ winners/       # end-of-day reveal
│  │  ├─ components/
│  │  ├─ game/             # three.js scene, entities, input, systems
│  │  ├─ lib/              # ws client, api client, session state machine
│  │  └─ styles/           # tokens.css, base.css, utilities
│  └─ api/
│     └─ src/
│        ├─ routes/        # players, runs, leaderboard, operator, health
│        ├─ sensor/        # serial reader, DSP, scorer, fake source
│        ├─ ws/            # focus broadcast, session events
│        ├─ db/            # pool, queries, migrations/
│        └─ index.ts
├─ packages/
│  └─ shared/              # zod schemas, types, constants, seeded RNG
├─ firmware/               # ESP32/Arduino sketch (raw sample streamer)
├─ docs/
└─ NEURAL_CORE_DEV_SPEC.md
```

Rules: shared types and constants live only in `packages/shared`. The web app never talks to serial hardware directly.

---

## 4. System Architecture

```
BioAmp EXG Pill → ESP32 (ADC, 250 Hz) → USB serial
      → Node API: serial reader → DSP → focus scorer → WebSocket broadcast
      → Next.js kiosk (game) ──REST──► Express ──► PostgreSQL
                              Projector /leaderboard ◄── WebSocket
```

**Design decisions**
1. **Firmware stays dumb.** It streams raw samples with timestamps. All filtering, FFT and scoring happen in TypeScript so they are unit-testable and tunable without reflashing.
2. **One source of truth for the focus score:** the API. The browser only receives `focus` frames.
3. **Sensor sources are swappable** behind one interface: `SerialSource`, `FakeSource` (slider or random walk), `ReplaySource` (recorded CSV). The game cannot tell them apart.
4. **The server validates runs.** The client submits events; the server computes the final score where practical, or at least sanity-checks bounds.

```ts
interface FocusSource {
  start(): Promise<void>;
  stop(): Promise<void>;
  onSample(cb: (s: { t: number; uv: number }) => void): void;
}
```

---

## 5. Signal Processing and Focus Score

Implemented in `apps/api/src/sensor/`. Every function pure and covered by tests.

1. **Sampling:** 250 Hz (configurable). Convert ADC counts to microvolts using the board gain constants in `shared/constants.ts`.
2. **Filtering:** 0.5-45 Hz band-pass plus 50 Hz notch (India mains).
3. **Windowing:** 2 s window, 0.5 s hop, Hann window, Welch-style averaging.
4. **Band power:** theta 4-8 Hz, alpha 8-13 Hz, beta 13-30 Hz. High-frequency band 30-45 Hz for artifact detection.
5. **Engagement index:** `beta / (alpha + theta)`.
6. **Artifact handling**
   - Amplitude spike above threshold: treat as blink, hold the previous score for up to 500 ms.
   - 30-45 Hz power dominant: treat as jaw/forehead tension and subtract from the score (counts as distraction).
   - Flat or railing signal: mark signal quality `bad`.
7. **Calibration:** record 30 s relaxed and 30 s focused. Use the 10th percentile of the relaxed index as `low` and the 90th percentile of the focused index as `high`.
8. **Mapping:** `score = clamp((index - low) / (high - low), 0, 1) * 100`.
9. **Smoothing:** exponential moving average, `alpha = 0.15`, applied to the score. Output rate 4 Hz to clients.
10. **Signal quality:** `good | fair | bad` derived from noise floor, line-noise ratio and rail detection. The game cannot start unless it is `good`.

WebSocket frame:

```ts
type FocusFrame = {
  type: "focus";
  t: number;          // server ms timestamp
  score: number;      // 0-100, smoothed
  raw: number;        // 0-100, unsmoothed
  quality: "good" | "fair" | "bad";
  artifact: "none" | "blink" | "tension";
};
```

---

## 6. Game Design (v1 scope)

**Round:** 90 s, scored, one official attempt per player. A 30-45 s practice round is unscored.

**Controls:** mouse, arrow keys or joystick to move the crosshair; click or space to fire.

**Focus mechanic**

| Focus | State | Target jitter | Multiplier |
|---|---|---|---|
| 0-40 | Scattered | high, capped | 1x |
| 40-70 | Engaged | low | 2x |
| 70-100 | Locked in | minimal | 3x |

- Jitter amplitude is a smooth function of focus (no hard steps), clamped so a target is always hittable.
- Apply smoothing to jitter amplitude so changes feel gradual and avoid a frustration spiral.

**Enemies:** Grunt (jitter follows focus), Phantom (fades when focus is low), Sniper (appears in calm/alpha state), Boss (final 20 s, vulnerable after sustained focus fills a ring).

**Extras:** Zen meter and Zen Shot (slow-motion steady shot), distraction events (visual/audio) with a recovery bonus.

**Fairness**
- Spawn sequence generated from a **seeded RNG** (`mulberry32`) with the same seed for every player.
- All gameplay constants (durations, thresholds, multipliers, jitter curve) in `shared/constants.ts`.
- **Tie-breakers:** higher average focus, then higher accuracy.
- Mid-round signal loss pauses the game and notifies the operator.

**Scoring (server-verified)**
`points = base(enemy) * multiplier(focus at hit) * accuracyBonus`. Store hit events with timestamps and focus values so any run can be audited.

---

## 7. Screens and Session Flow

Session state machine (implement with a typed reducer, not scattered booleans):

```
IDLE → REGISTER → SENSOR_SETUP → CALIBRATE_RELAX → CALIBRATE_FOCUS
     → PLAYING → RESULT → (reset) IDLE
     any state → PAUSED (signal loss / operator) → resume
```

| Route | Purpose |
|---|---|
| `/` | Attract screen with live top 5 |
| `/register` | Name, phone/roll number, consent |
| `/setup` | Electrode diagram, live signal quality, waveform |
| `/calibrate` | Relax then focus, countdown rings |
| `/practice` | Unscored round with focus meter |
| `/play` | Scored round, 3D scene and HUD |
| `/result` | Score, rank, focus-over-time chart, stats |
| `/leaderboard` | Projector view, top 10, live updates |
| `/winners` | Top 3 reveal at the end of day |
| `/operator` | PIN-protected volunteer controls |

---

## 8. Database Schema (PostgreSQL)

```sql
create table players (
  id            serial primary key,
  display_id    text unique not null,          -- e.g. NC-027
  full_name     text not null,
  contact_key   text unique not null,          -- phone or roll number (one entry per ID)
  consent_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create table runs (
  id             serial primary key,
  player_id      int not null references players(id),
  status         text not null check (status in ('valid','redo','disqualified','aborted')),
  score          int not null,
  accuracy       numeric(5,2) not null,
  avg_focus      numeric(5,2) not null,
  best_streak_s  numeric(6,2) not null,
  seed           int not null,
  calibration    jsonb not null,               -- { low, high }
  started_at     timestamptz not null,
  finished_at    timestamptz
);
create unique index one_valid_run_per_player on runs(player_id) where status = 'valid';

create table run_events (
  id        bigserial primary key,
  run_id    int not null references runs(id) on delete cascade,
  t_ms      int not null,
  kind      text not null,                     -- hit | miss | zen_shot | distraction
  focus     numeric(5,2) not null,
  data      jsonb
);

create table focus_samples (
  run_id  int not null references runs(id) on delete cascade,
  t_ms    int not null,
  score   numeric(5,2) not null,
  primary key (run_id, t_ms)
);

create table audit_log (
  id         bigserial primary key,
  actor      text not null,
  action     text not null,
  details    jsonb,
  created_at timestamptz not null default now()
);
```

Leaderboard query orders by `score desc, avg_focus desc, accuracy desc` over `status = 'valid'`. Store `focus_samples` downsampled to 4 Hz.

---

## 9. API Surface

REST under `/api`, validated with shared zod schemas. Errors return `{ error: { code, message } }`.

| Method | Path | Notes |
|---|---|---|
| POST | `/players` | Register; rejects duplicate `contact_key` |
| POST | `/runs/start` | Creates run, returns seed and run id |
| POST | `/runs/:id/finish` | Submits events and focus samples; server verifies and stores |
| GET | `/leaderboard?limit=10` | Top N valid runs |
| GET | `/runs/:id` | Result data for the result screen |
| POST | `/operator/runs/:id/disqualify` | PIN required, writes `audit_log` |
| POST | `/operator/runs/:id/redo` | Marks run `redo`, allows a new attempt |
| POST | `/operator/calibration/skip` | Sensor-failure fallback |
| GET | `/operator/export.csv` | Full run export |
| GET | `/health` | DB, serial and source status |

WebSocket `/ws`: broadcasts `focus` frames, `leaderboard:update`, and `session:event` messages.

---

## 10. UI and Visual Design Standard

**Goal:** it should look like a premium, purpose-built product (think flight-simulator instrumentation or a high-end audio console), not a generic AI-generated landing page. Deliberate, restrained, and physical.

### 10.1 Direction
- **Material:** dark graphite surfaces with real depth. Panels feel like machined layers: subtle bevels, inner shadows, thin 1px edge highlights, soft ambient occlusion.
- **Depth through light, not glow.** Use directional light (top-left), gradients that model a surface, and layered shadows. Glow is reserved for one thing: the live focus state.
- **3D where it earns its place**
  - The game scene is true WebGL: perspective camera, depth of field or fog, real shadows, physically plausible materials, a shooting range with distance cues.
  - Menus and cards use restrained CSS 3D: `perspective`, small `rotateX/rotateY` on hover or focus (max about 6 degrees), `transform-style: preserve-3d`, parallax between layers.
  - The focus meter is an instrument (arc gauge with a needle or a segmented bar with depth), not a flat progress bar.
- **Motion:** purposeful and short (150-300 ms), `cubic-bezier(0.2, 0.8, 0.2, 1)`. Every animation communicates state. Respect `prefers-reduced-motion`.

### 10.2 Design tokens (`styles/tokens.css`)

```css
:root {
  /* surfaces */
  --bg-0: #0b0d10;
  --bg-1: #111418;
  --bg-2: #171b21;
  --bg-3: #1e232b;
  --edge-hi: rgba(255, 255, 255, 0.08);
  --edge-lo: rgba(0, 0, 0, 0.6);

  /* text */
  --text-1: #e8ecf1;
  --text-2: #a3adba;
  --text-3: #6b7685;

  /* signal colors: used with discipline */
  --focus: #3fd6c0;        /* locked in */
  --focus-dim: #1f6f64;
  --warn: #f2a43a;         /* drifting */
  --alert: #e5584a;        /* scattered / error */
  --accent: #7d8cff;       /* rare, interactive highlight */

  /* depth */
  --shadow-1: 0 1px 0 var(--edge-hi) inset, 0 8px 24px rgba(0, 0, 0, 0.35);
  --shadow-2: 0 1px 0 var(--edge-hi) inset, 0 24px 60px rgba(0, 0, 0, 0.5);
  --radius-1: 10px;
  --radius-2: 16px;

  /* type */
  --font-ui: "IBM Plex Sans", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;
  --font-display: "Barlow Condensed", "IBM Plex Sans", sans-serif;
}
```

- Load fonts with `next/font` (self-hosted, no external requests; the venue may be offline).
- Use **tabular numerals** (`font-variant-numeric: tabular-nums`) for scores, timers and meters.
- Type scale for distance viewing: body 20px minimum on kiosk, leaderboard rows 40px+.

### 10.3 "Does not look vibe-coded" checklist
Do:
- Align everything to an 8px grid. Consistent spacing, consistent radii, consistent border treatment.
- Use real hierarchy: one clear primary element per screen, quiet secondary elements.
- Use a single accent color plus status colors. Everything else is neutral.
- Write specific, short, human microcopy ("Hold still, reading signal" not "Loading magic...").
- Use custom SVG icons from one consistent set with a uniform stroke weight.
- Design empty, loading, error, disconnected and sensor-lost states for every screen.
- Make every interactive element have visible `:hover`, `:focus-visible`, `:active` and `:disabled` states.

Do not:
- Rainbow or purple-to-pink gradients, neon outlines on everything, blurry blob backgrounds.
- Glassmorphism on every card (allow it for at most one overlay layer).
- Emoji as icons or decoration.
- Centered-everything layouts with identical rounded cards in a grid.
- Default system fonts, default Inter, or mixing more than two typefaces plus one mono.
- Generic copy ("Welcome to the future of...", "Unleash your mind").
- Drop shadows with a single large blur on every element.

### 10.4 Key components
- **Focus Gauge:** arc or segmented instrument with a damped needle (spring physics), color shifts between `--alert`, `--warn`, `--focus`, numeric readout in mono.
- **Panel:** layered surface with edge highlight, inner shadow, optional CSS 3D tilt.
- **Crosshair:** vector reticle whose ring tightens and brightens with focus.
- **Target:** 3D model with idle sway plus focus-driven jitter (Perlin noise, not random per frame).
- **Leaderboard row:** tabular layout, rank plate for top 3 in brushed metal tones (gold/silver/bronze used as material, not neon).
- **Signal Quality:** three-state indicator plus a live waveform on a canvas, with a grid.
- **Step rail:** persistent progress rail (Register, Setup, Calibrate, Play).

### 10.5 Performance and display
- Target 60 fps on a mid-range laptop. Budget: under 150 draw calls, compressed textures, instanced targets, no per-frame allocations in the render loop.
- Design at 1920x1080, scale with `clamp()` and `rem`; test at 1366x768 and on a 4K projector.
- Fullscreen kiosk mode, cursor hidden during play, no scrollbars, text selection disabled except in inputs.
- Fully functional offline.

---

## 11. Coding Conventions

- TypeScript `strict`, no `any` (use `unknown` and narrow). No default exports except Next.js pages/layouts.
- Validate every external input (HTTP body, WS message, serial line) with zod.
- Server components by default in Next.js; mark client components only where state or WebGL is needed. The game scene is client-only.
- CSS Modules per component, tokens only (no hardcoded colors or spacing values), logical class names (`.panel`, `.panelHeader`), no `!important`.
- Game loop: fixed-timestep simulation, interpolated rendering, all gameplay randomness through the seeded RNG. No `Math.random()` in gameplay code.
- SQL: parameterized queries only, migrations are forward-only files.
- Errors: never swallow. Log with context; surface a friendly message to the UI and a technical one to the operator panel.
- Commits: small, conventional (`feat:`, `fix:`, `chore:`).
- Environment config in `.env` with a typed loader; no secrets in the repo. Operator PIN from env.

---

## 12. Reliability for Event Day

- Auto-reconnect for serial (if the USB drops) and WebSocket with backoff.
- Every finished run is written to Postgres **and** appended to a local `runs-backup.jsonl` file.
- Operator panel has: start, pause, redo, disqualify, skip calibration (fallback), switch source (Serial / Fake), next player, export CSV.
- A `FakeSource` mode must be one click away if the sensor fails.
- Health banner in the operator panel for DB, serial and WebSocket status.
- Nightly-style export: the CSV export must work with zero extra setup.

---

## 13. Build Milestones (implement in order)

1. **Foundation:** pnpm workspace, shared package, Postgres + migrations, Express skeleton, Next.js skeleton, design tokens and base styles.
2. **Fake-focus vertical slice:** `FakeSource` with a slider, WebSocket focus broadcast, focus gauge component.
3. **Game core:** three.js scene, crosshair, targets with focus-driven jitter, scoring, 90 s timer, seeded spawns.
4. **Session flow:** state machine, register, setup, calibration, practice, result screens.
5. **Persistence:** runs, events, samples, leaderboard API and projector page.
6. **Real sensor:** firmware, serial source, DSP, calibration, artifact detection, signal quality.
7. **Operator panel and fairness:** PIN auth, redo, disqualify, audit log, CSV export, backups.
8. **Polish:** materials, lighting, audio, motion, empty/error states, winner reveal, performance pass.
9. **Rehearsal:** playtest with 5+ people, tune jitter curve and thresholds, run a full dry-run with the real hardware.

Definition of done for each milestone: typechecks, lint clean, relevant tests pass, works with `FakeSource`, and screenshots at 1920x1080 reviewed against Section 10.

---

## 14. Rules for the AI Assistant

1. Read this file and the relevant folder before changing code. Do not invent endpoints, tables or constants that conflict with this spec; propose changes first.
2. Work one milestone (or sub-task) at a time. Keep diffs small and reviewable. Explain what changed and why in two or three sentences.
3. Put shared constants in `packages/shared`, never duplicate them.
4. Write tests for DSP, scoring, seeded RNG and API validation as you build them.
5. For any UI work, check Section 10 explicitly and list which checklist items you satisfied. Do not use placeholder lorem ipsum or stock gradients.
6. Do not add dependencies without stating the reason. Prefer the standard library and the stack above.
7. If requirements are ambiguous, ask a specific question rather than guessing.
8. Never claim the focus score is a medical or clinical measurement in code, UI text or docs.

---

## 15. Open Decisions (confirm with the owner before building)

- Exact event date, venue network, and whether two stations are needed.
- Prize rules and the leaderboard freeze time.
- Input device for aiming (mouse vs joystick).
- Audio assets and brand name styling (logo wordmark).
- Whether registration data needs a retention/deletion policy after the event.
