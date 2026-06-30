# Trackix 追跡 🔴

**A local-first project tracker for vibe coders & developers.** Built by **Astax Labs**.

> Bold, clean, Japanese-inspired UI — white · vermilion red · sumi ink.

Trackix scans a folder *you* choose, finds your coding projects automatically,
and lays them out as beautiful cards across three columns — **In Progress**,
**Finished**, and **Dropped**. It detects the tools each project uses, where it's
hosted, and gives each one an AI-style "how finished does this look?" suggestion so
you can see at a glance what you've shipped and what you've quietly abandoned.

Perfect for people who spin up a lot of projects with ChatGPT / Claude and lose
track of them.

![status: works on Windows · macOS · Linux](https://img.shields.io/badge/platform-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-e0301e)

---

## ✨ Features

- **Auto-discovery** — point it at a folder; it finds every project inside (even
  marker-less, vibe-coded ones with just `.html` / `.js` / `.lua` files).
- **Smart status suggestions** — a built-in heuristic reads README, git, deploy
  configs, tests and TODO markers to suggest *In Progress / Finished / Dropped*.
- **Info cards** — tools used, where it's hosted, completion %, last worked on, and
  a "why I made it" + notes field you fill in.
- **Drag to organise** — drag a card between columns, or drag it onto the trash to
  remove it (with a satisfying animation).
- **Refresh** — re-scan one project or all of them to update their status after you
  worked on them.
- **100% local** — everything stays on your device. Nothing is uploaded, ever.

## 🔒 Privacy by design

This is the part that matters most:

- Astax **only ever reads inside the folder you explicitly pick** in the dialog.
- It **never** scans your whole computer, your home directory, or system files.
- It skips `node_modules`, caches, build output, and hidden/system folders.
- It only reads small text files (manifests, README) and caps how much it reads.
- **Nothing leaves your machine** — there is no server, no telemetry, no account.

Technically, the UI runs sandboxed (`contextIsolation: true`, `nodeIntegration:
false`, `sandbox: true`) and can only talk to the filesystem through a tiny,
allow-listed bridge — and only for the folder you chose.

## 🚀 Run it (development)

```bash
npm install
npm run dev        # launches the desktop app with hot reload
```

To preview just the UI in a browser (no desktop features):

```bash
npm run dev:web    # http://localhost:5173
```

## 📦 Build installers

```bash
npm run build:win     # → release/  (Windows .exe / NSIS installer)
npm run build:mac     # → release/  (macOS .dmg)   — build on a Mac
npm run build:linux   # → release/  (Linux AppImage)
```

Each command produces an installer in `release/` for that OS.

## 🤖 Optional: smarter detection with local AI

The free version uses a fast heuristic. You can optionally enable **local AI**
(via [Ollama](https://ollama.com)) for sharper finished/unfinished judgements. It
runs entirely on your machine — no API keys, no cloud, no per-use cost.

## 🧱 Tech

Electron · React · TypeScript · Vite · Framer Motion · Lucide.

---

Made with 💜 by **Astax Labs**.
