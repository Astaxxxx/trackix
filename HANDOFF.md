# Trackix — full handoff (build in a fresh chat)

**How to use this file:** open a brand-new Claude Code chat in this repo
(`astax-fullstack/astax-tracker`) and say:
*"Read HANDOFF.md. Build Feature A (Autopilot) and Feature B (3D avatar)."*
Starting fresh keeps the context small → cheaper Claude usage and better output.
(This project's memory `MEMORY.md` also auto-loads and has deep history.)

---

## 1. What Trackix is
A **local-first desktop project tracker for vibe coders / developers**, by Astax
Labs. It scans a folder the user picks, auto-detects their coding projects + tools +
hosting, and tracks them as cards in three columns (**In Progress / Finished /
Dropped**). White + vermilion-red (`#e0301e`) + sumi-ink theme. 100% local; optional
AI (local Ollama **or** the user's own Claude API key).

- **Stack:** Electron 31 (CommonJS `electron/main.cjs` + `preload.cjs` + pure
  `scanner.cjs`) · React 18 · Vite 5 · TypeScript · Framer Motion · lucide-react ·
  `@anthropic-ai/sdk`. (Feature B will add `three` + `@react-three/fiber`.)
- **Published:** github.com/Astaxxxx/trackix — currently **v0.6.0**. Next release is
  **v0.7.0**.
- **Run dev:** `npm run dev` (Electron) or `npm run dev:web` (renderer only, the
  `astax-tracker-web` preview config on :5173, with a browser mock in `src/api.ts`).

## 2. Features already built (mirror these for style/plumbing)
Board scan/track · **Cosmos** (canvas star-map of all projects) · **Oracle**
(picks what to work on) · **Revival Ritual** (revive a stalled project) · **Warp**
(deep-focus timer that brightens a project's star) · **Ship Card** (shareable board
snapshot) · **Vega** (`ai:chat` — AI companion that knows the whole board, can speak
via `speechSynthesis`) · **Deep Scan** (`ai:deepscan` — AI reads a project's real
files and returns a health audit) · desktop **buddy** (floating mascot) · AI provider
picker in Settings.

## 3. Architecture map (read these first)
- `electron/main.cjs` — window + all IPC. **AI section** has `anthropicClient()`,
  the Ollama helpers, and the `ai:refine/revive/chat/deepscan` handlers +
  `gatherProjectContent(dir)` (reads a project's real files, path-scoped). Copy these
  patterns.
- `electron/preload.cjs` — the ONLY renderer→OS bridge (contextIsolation on). Every
  capability is an explicit allow-listed function. Add new IPC here.
- `electron/scanner.cjs` — pure scanner; shows the path-scope guard (resolve +
  `startsWith`) you MUST reuse for any file access.
- `src/api.ts` — single data-access layer + `AstaxBridge` interface + browser mock.
- `src/types.ts` — `Project`, `Settings` (provider=`ollama|claude`, `claudeApiKey`,
  `claudeModel` default `claude-opus-4-8`), `AiConfig`, `ChatMsg`, `Audit`.
- `src/App.tsx` — all state + modal wiring (see how `VegaModal`/`WarpModal` are
  wired: a state id, `AnimatePresence`, Escape closes).
- `src/components/VegaModal.tsx` + `ProjectDetail.tsx` — the closest existing
  patterns to what you're building; read them fully.
- `src/styles.css` — theme vars + dark cosmic modal classes to reuse.

## 4. Conventions — STRICT, do not skip
- **Type-check before every build:** `npx tsc --noEmit` (⚠ `vite build` does NOT
  type-check — this has caused real bugs).
- **Theme:** use existing CSS vars; dark modals use the Cosmos palette.
- **Privacy:** any feature that sends code to Claude must say so plainly in the UI
  (like Deep Scan). Ollama stays local.
- **Ship pipeline (do exactly as prior releases):** bump `package.json` version →
  `git add -A && git -c commit.gpgsign=false commit -m "…"` (git identity is already
  pinned to `Usmaan Malik <94316672+Astaxxxx@users.noreply.github.com>`;
  **NEVER add a `Co-Authored-By: Claude` trailer** — the user must be the sole
  contributor) → `git push origin main` → `git tag vX.Y.0 && git push origin vX.Y.0`
  (CI `.github/workflows/release.yml` builds Win/Mac/Linux) → after CI, delete the
  stray `latest-linux.yml` asset and set the release title/notes + `--latest` → for
  the laptop, either `npm run build:win` or `gh release download vX.Y.0 --pattern
  Trackix-Setup.exe` then silent-install (`Start-Process … -ArgumentList "/S" -Wait`)
  and verify `Trackix.exe` ProductVersion. `gh` = `/c/Program Files/GitHub CLI/gh.exe`,
  authed as `Astaxxxx`. Close running `Trackix` procs before reinstalling.
- **Verify** the renderer via the `astax-tracker-web` preview server where possible.
  Continuous-animation / canvas / WebGL screens can block the screenshot tool — verify
  via `preview_eval` DOM checks, or pause animation before a screenshot. Desktop-only
  IPC can only be truly exercised in the packaged app — reason carefully and test the
  installed build.
- **Update `MEMORY.md`** + the project memory file at the end.

---

## FEATURE A — Autopilot (the never-been-done one)

**One line:** Autopilot finishes an unfinished project for the user by generating the
missing code **in their own style, reusing patterns they've already written across
their *other* tracked projects**, with a diff-approval gate before anything is written.

**Why novel:** no tool does *portfolio-aware* code generation for one developer.
Trackix is the only app that sees every project a person owns, so it can build a
project the way *they* build, from *their* code. Do NOT reduce this to "call an LLM to
write code" — the cross-project style transfer is the whole point.

**MVP (resist scope creep):**
1. **Entry:** an "Autopilot" button in `ProjectDetail` and the Cosmos star-dock, shown
   only when AI is on and `provider === 'claude'` (needs strong tool-use; Opus 4.8).
2. **`ArchitectModal`** — full-screen dark cosmic modal that runs the loop and streams
   progress (plan → tool calls → diffs → report).
3. **Safety snapshot first:** before ANY write, `git add -A && git commit -m "Trackix
   Autopilot snapshot"` (offer `git init` if not a repo). Never write without this.
4. **Gather context (the novel part):** read the target's real files
   (`gatherProjectContent`), then scan the user's OTHER tracked projects for files
   whose stack matches (same primary tools / filename similarity — e.g. their
   `*auth*`, `*upload*`, api wrappers) and include 2–4 short snippets as "the user's
   existing style/components" in the system prompt.
5. **Agentic write loop** via the Anthropic SDK **tool-use** (see the `/claude-api`
   skill's tool-use docs; SDK already installed). Client-side tools executed by
   MAIN, all **path-scoped to the project folder**: `read_file`, `list_dir`,
   `write_file`. Every `write_file` must NOT write immediately — send the proposed
   diff to the renderer, show **Approve / Skip**, and only write on approve. Loop
   until `stop_reason: "end_turn"` or the user stops; cap iterations (~15) and files.
   Keep a visible **Stop** at all times.
6. **Report in Vega's voice:** what it built, files changed, remaining human tasks
   (deploy, secrets, test). Optionally speak it.

**Out of scope v1:** running/compiling code, installing deps, terminal exec,
multi-project builds, "self-training."

**Plumbing:** new IPC `autopilot:start` (+ `webContents.send` events: plan, tool_call,
diff_request, file_written, done, error) and `autopilot:approve/reject/stop`; expose
in preload (event subscription like `onBuddyDismissed`); wrappers in `api.ts`; wire in
`App.tsx`; `ArchitectModal.tsx` (plan list, live log, diff viewer with Approve/Skip,
final report); `.architect-*` styles.

---

## FEATURE B — the 3D avatar (JARVIS-style)

**The honest version to build:** upgrade Vega's little orb into a **three.js
holographic reactive core** — the Iron-Man-holo-UI look, fully achievable. NOT a
rigged talking human with lip-sync (that's a separate months-long art project; leave a
note that it's a future upgrade).

**Build:**
- Add `three`, `@react-three/fiber`, `@react-three/drei`. Create
  `src/components/VegaAvatar.tsx` (a `<Canvas>`), used inside `VegaModal` (replace the
  CSS orb) and optionally as a bigger "assistant" presence.
- **The core:** a glowing icosahedron/sphere with a **particle shell** + 2–3 rotating
  rings, in the cosmic red/ink palette (emissive material, bloom via
  `@react-three/postprocessing` if cheap enough, else fake glow with additive
  sprites). Idle = slow rotation + gentle drift. Add subtle mouse parallax (rotate
  toward pointer).
- **Reactive to speech:** when Vega is speaking (`speechSynthesis`), drive the core to
  pulse/spike and the particles to energize. Reliable approach: derive a pseudo
  amplitude envelope from `SpeechSynthesisUtterance` `onstart`/`onboundary`/`onend`
  events + a noise function while `speaking` (route real audio amplitude only if you
  can get an AnalyserNode reliably — SpeechSynthesis output isn't easily tappable, so
  don't block on it). Idle vs thinking vs speaking = three visual states.
- **Optional (adds the JARVIS feel, flag as experimental):** voice INPUT via
  `webkitSpeechRecognition` so the user can *talk* to Vega — a mic button that
  transcribes into the chat input. Note it may need network in Electron; make it
  degrade gracefully.
- **Perf:** cap DPR (≤2), dispose geometries/materials on unmount, keep particle count
  modest, pause the loop when the modal is closed. Respect `prefers-reduced-motion`.

**Tie-in:** Autopilot (Feature A) reports through this avatar — when Autopilot finishes
a step, Vega's core reacts + optionally speaks the update. That's the "JARVIS reporting
in" moment; it's what sells the whole thing, so wire them together.

---

## Safety · privacy · cost
- Git snapshot before first write; never write outside the project folder; diff +
  explicit per-file approval; respect `.gitignore`; skip `node_modules`/build; cap
  file size + iterations; always-visible Stop.
- Autopilot & Deep Scan send code to Anthropic under the **user's own key** — disclose
  it in the UI.
- Runs pay-as-you-go on the user's key; a small-project Autopilot pass is typically
  well under a pound (budget is £500, plenty). The other worthwhile spend is a
  code-signing cert to kill the Windows SmartScreen warning.

## Ship it
Bump to **v0.7.0**, follow the ship pipeline in §4 exactly, install on the laptop and
verify the ProductVersion, update the landing page (`landing/index.html`) with two new
feature cards, and update memory.
