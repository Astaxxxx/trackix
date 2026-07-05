# Trackix — Autopilot (build brief for a fresh chat)

**How to use this file:** open a brand-new Claude Code chat in this repo
(`astax-fullstack/astax-tracker`) and say: *"Read AUTOPILOT-BRIEF.md and build
Autopilot."* Starting fresh keeps context (and cost) low.

---

## The feature in one line
**Autopilot finishes an unfinished project for you — generating the missing code
in the user's own style by reusing the patterns they've already written across
their *other* tracked projects — with a diff-approval step before anything is
written.**

Why it's novel: no tool does *portfolio-aware* code generation for one developer.
Trackix is the only app that can see every project a person owns at once, so it can
build a project the way *they* build, from *their* code. That is the differentiator —
do NOT reduce this to "just call an LLM to write code" (that already exists).

## Intent it satisfies (from the user)
"Something that finishes off the code for you until all I have to do is my human
things" + a JARVIS feeling. The JARVIS feeling comes from it *acting* and reporting
back in Vega's voice — not from a 3D face. Do not build a 3D avatar.

---

## MVP scope (ship this, resist scope creep)
1. Entry point: a **"Autopilot"** button in `ProjectDetail` (only when AI is on and
   `provider === 'claude'` — this needs strong tool-use; Opus 4.8 default). Also
   surface it in the Cosmos star-dock.
2. On launch, open an **`ArchitectModal`** (full-screen, dark, cosmic red/ink like
   `CosmosModal`/`WarpModal`) that runs the agent loop and streams progress.
3. **Step 0 — safety snapshot:** before ANY write, if the project is a git repo,
   run `git add -A && git commit -m "Trackix Autopilot snapshot"` (or stash) so the
   user can always revert. If not a git repo, offer to `git init` first. Never write
   without this.
4. **Step 1 — gather context (portfolio-aware, the novel part):**
   - Read the target project's real files (reuse `gatherProjectContent` in
     `main.cjs`).
   - Scan the user's OTHER tracked projects for files whose stack matches the target
     (same key tools) and pull 2–4 short representative snippets ("your patterns").
     A simple heuristic is fine for v1: same primary tool + filename similarity
     (e.g. their `*auth*`, `*upload*`, `api` wrappers). Include these as "the user's
     existing style/components" in the system prompt.
5. **Step 2 — plan:** ask the model for an ordered list of concrete file changes to
   advance the project toward shipped (create/modify N files). Show the plan.
6. **Step 3 — agentic write loop** using the Anthropic SDK **tool-use** (see
   `/claude-api` skill; the SDK is already installed). Define client-side tools the
   MAIN PROCESS executes, all **scoped to the project folder** (reject any path that
   escapes it — mirror the guard already in `scanner.cjs`/`main.cjs`):
   - `read_file(path)` · `list_dir(path)` · `write_file(path, contents)`.
   - For every `write_file`, DO NOT write immediately: send the proposed diff to the
     renderer, show it in the modal, and require the user to **Approve / Skip**.
     Only on approve does main actually write the file. This is the core safety gate.
   - Loop until the model stops calling tools (`stop_reason: "end_turn"`) or the user
     ends the session. Cap iterations (e.g. 15) and total files.
7. **Step 4 — report** in Vega's voice: what it built, what files changed, and the
   remaining human tasks (deploy, add secrets, test). Optionally speak it via the
   existing `speechSynthesis` path used in `VegaModal`.

## Explicitly OUT of scope for v1
Running/compiling code, installing deps, terminal execution, multi-project builds,
a 3D avatar, "self-training". Keep it: read → plan → propose file writes → approve →
write → report.

---

## Architecture / where things go (match existing patterns)
- **`electron/main.cjs`** — add the agent loop + tool executors. New IPC:
  `autopilot:start` (kicks a session, returns a session id), and use
  `webContents.send` to stream events to the renderer (plan, tool call, diff
  request, file written, done, error). Add `autopilot:approve`/`autopilot:reject`/
  `autopilot:stop` handlers for the approval gate. Reuse `anthropicClient(apiKey)`,
  and the `messages.create` tool-use loop (manual agentic loop — see the claude-api
  skill's tool-use docs). Scope every path with the existing resolve+startsWith guard.
- **`electron/preload.cjs`** — expose `autopilotStart(payload)`, `autopilotApprove`,
  `autopilotReject`, `autopilotStop`, and an `onAutopilot(cb)` event subscription
  (like the existing `onBuddyDismissed` pattern).
- **`src/api.ts`** — thin wrappers + the bridge interface additions.
- **`src/types.ts`** — event/message types; optionally store a run summary on
  `Project` (e.g. `lastAutopilot?: { at:number; filesChanged:string[]; summary:string }`).
- **`src/components/ArchitectModal.tsx`** — the UI (plan list, live tool log, diff
  viewer with Approve/Skip, final report). Diff can be a simple before/after or
  added-lines view; a full diff lib is optional.
- **`src/App.tsx`** — state + wiring + render, following how `WarpModal`/`VegaModal`
  are wired (state id, AnimatePresence, Escape handling).
- **`src/styles.css`** — reuse the dark cosmic classes; add `.architect-*` styles.
- **Landing page** (`landing/index.html`) — add a feature card.

## Conventions that MUST be followed (this codebase is strict on them)
- **Type-check before every build:** `npx tsc --noEmit` (vite build does NOT
  type-check — this has bitten us).
- **Theme:** white/vermilion-red (#e0301e)/sumi-ink; dark modals use the Cosmos
  palette. Use existing CSS variables.
- **Privacy disclosure:** Autopilot sends code (target + your snippets) to Anthropic
  under the user's own key. State this plainly in the UI, like Deep Scan does.
- **Providers:** Claude only for v1 (tool-use). Gate the button on
  `settings.aiProvider === 'claude'` and a present key; if Ollama, show a note.
- **Ship pipeline (do exactly as prior releases):** bump `package.json` version →
  commit (author is already pinned to `Usmaan Malik <94316672+Astaxxxx@users.noreply.github.com>`;
  **do NOT add any `Co-Authored-By: Claude` trailer** — the user wants only himself as
  contributor; commit with `-c commit.gpgsign=false`) → `git push origin main` →
  `git tag vX.Y.0 && git push origin vX.Y.0` (CI at `.github/workflows/release.yml`
  builds Win/Mac/Linux) → after CI, delete the stray `latest-linux.yml` asset and set
  the release title/notes/`--latest` → for the laptop, either `npm run build:win` or
  `gh release download` the CI exe and silent-install (`/S`), verifying
  `Trackix.exe` ProductVersion. `gh` is at `/c/Program Files/GitHub CLI/gh.exe`,
  authed as `Astaxxxx`. Next version after v0.6.0 is **v0.7.0**.
- **Verify** the renderer in the preview server (`astax-tracker-web` launch config)
  where possible; canvas/continuous-animation screens need animations paused or just
  eval-checks. The desktop-only IPC (autopilot) can only be truly tested in the
  packaged app — reason carefully + test in the installed build.

## Safety (non-negotiable)
- Git snapshot before first write. Never write outside the project folder. Diff +
  explicit per-file approval before every write. Respect `.gitignore`; skip
  `node_modules`/build dirs. Cap file size and iteration count. Provide a visible
  **Stop** at all times.

## Cost note for the user
Runs on the user's own Anthropic key (pay-as-you-go). A full Autopilot pass on a
small project is typically well under a pound of API usage — comfortable within the
£500 project budget. The other worthwhile spend is a code-signing certificate to
remove the Windows SmartScreen warning.

---

### Current state of the repo (context for the fresh chat)
Trackix is an Electron 31 + React 18 + Vite 5 + TS local project tracker (by Astax
Labs), published at github.com/Astaxxxx/trackix, currently **v0.6.0**. Existing AI
features to mirror for style/plumbing: Deep Scan (`ai:deepscan` in main.cjs reads
real files) and Vega (`ai:chat`). AI settings live in `Settings` (provider =
ollama|claude, `claudeApiKey`, `claudeModel` default `claude-opus-4-8`). Read
`electron/main.cjs` (AI section), `src/api.ts`, `src/components/ProjectDetail.tsx`,
and `src/components/VegaModal.tsx` first — they show every pattern you need.
```
```
