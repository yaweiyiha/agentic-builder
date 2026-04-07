---
name: desktop-electron
description: >-
  Guide for developing Electron desktop features in this Next.js + Electron Blueprint
  orchestration app. Use when working on desktop-specific functionality, IPC communication,
  native menus, system tray, file system access for .blueprint/ directory, or Electron main/preload code.
---

# Desktop Electron Development

## Architecture

- **Next.js** handles all UI and API routes (`src/`)
- **Electron** wraps Next.js for desktop distribution (`electron/`)
- **`.blueprint/`** directory is managed locally (Local-First principle)
- Dev mode: Electron loads `http://localhost:3000`
- Production: `next build` with `output: "export"` → Electron loads static files

## Key Files

- `electron/main.js` — Main process (window, IPC, native APIs)
- `electron/preload.js` — Bridge (`window.electronAPI`)
- `src/types/electron.d.ts` — TypeScript declarations

## Local-First .blueprint/ Management

Desktop-specific features for `.blueprint/` directory:
1. File watching for real-time context updates
2. Git sync (push/pull) for cloud SSOT
3. Direct file system read/write for context documents

## Adding Desktop Features

1. Add IPC handler in `electron/main.js`
2. Expose in `electron/preload.js`
3. Update types in `src/types/electron.d.ts`
4. Guard with `window.electronAPI?.isElectron` in React

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Next.js dev (web mode) |
| `npm run electron:dev` | Desktop dev (Next + Electron) |
| `npm run electron:build` | Production desktop build |
