# ASCII Life Terminal

A fully functional Windows terminal emulator with a living ASCII animation behind the text.

It is a real PTY-backed terminal (PowerShell by default), built with Electron + [xterm.js](https://xtermjs.org/) + [node-pty](https://github.com/microsoft/node-pty). Anything you can run in Windows Terminal — including OpenCode TUI — runs here, with koi, butterflies, jellyfish, dragonflies or frogs swimming behind the prompt.

## Run it

### Packaged app (recommended)
Build it once with `npm run dist`, then run either:

- `dist/ASCII-Life-Terminal-Setup.exe` — installer (desktop + start menu shortcuts)
- `dist/ASCII-Life-Terminal-Portable.exe` — portable, no install needed

Or just double-click `ASCII Life Terminal.exe` if installed.

### During development
```powershell
npm install
npm start
```

## What you can do

- Everything a normal terminal does: real PowerShell, colors, cursor, escape sequences, scrollback, `opencode`, `vim`, `npm`, etc.
- **New tab:** `Ctrl+Shift+T` or the `+` button — each tab is its own independent shell.
- **Close tab:** `Ctrl+Shift+W` or the `×` on the tab.
- **Copy:** select text (copies automatically) or `Ctrl+Shift+C`.
- **Paste:** right-click in the terminal or `Ctrl+Shift+V`.
- **Change the background:** click one of the five scene chips in the title bar (Butterfly / Koi / Jellyfish / Dragonfly / Frog). Your choice is remembered between launches.
- Move the mouse to make the creatures react.

## Build from source

```powershell
npm install
npm run build:renderer   # bundles the renderer with esbuild
npm run dist             # electron-builder -> installer + portable .exe
```

`node-pty` ships N-API prebuilds for Windows x64, so no native compilation is normally required. If you ever need to rebuild it against a different Electron version, run `npm run rebuild`.

## Verification

`npm run verify` launches the app headlessly through CDP and checks:

- real PowerShell command execution,
- OpenCode running inside the terminal,
- the ASCII Life engine animating,
- scene switching,
- multi-tab support,

and writes `verify-screenshot.png` for visual inspection. All 8 checks pass in the tested environment.

## Credits

The animated background uses the [ASCII Life Engine](https://github.com/howdeploy/ascii-life-engine) by [howdeploy](https://github.com/howdeploy), MIT-licensed. The unmodified engine file and its license are in `vendor/`.
