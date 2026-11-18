# Finance Tracker

Personal macOS app that pulls in bank/investment data, charts trajectories, and uses AI for suggestions and analytics.

Stack: Tauri 2 + React + TypeScript (Vite). See [decisions.md](./decisions.md) for why.

## Prerequisites

- Node 20+
- Rust (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)
- Xcode Command Line Tools

## Run

```sh
npm install
npm run tauri dev     # native app window with hot reload
npm run dev           # frontend only, in the browser at http://localhost:1420
npm run tauri build   # produce a .app / .dmg
```

## Layout

```
src/          React frontend
src-tauri/    Rust shell (window, native APIs, Keychain later)
```
