# System Info — Cinnamon Desklet

A configurable desktop widget for the Cinnamon desktop (Linux Mint, or Cinnamon on Ubuntu) that displays live system metrics with optional history sparklines. The title includes your hostname — handy when the same desklet runs on more than one machine.

## Metrics

- **CPU** — usage % and package temperature
- **RAM** — used / total
- **Swap** — used / total
- **Disk** — used / total for `/`
- **Uptime** — days / hours / minutes since boot
- **Load average** — 1 / 5 / 15 minute
- **Battery** — capacity % and charging state (auto-hidden on desktops)
- **Network** — aggregate ↓/↑ throughput, optionally broken down per interface
- **IP addresses** — local IP and public IP are now separate sections (each can be enabled or hidden independently). Local IP tries `hostname -I` then falls back to `ip -4 addr`. Public IP goes through `curl ifconfig.me` and is cached for 5 minutes.

The desklet reads directly from `/proc` and `/sys` — no external daemons. Only `hostname`, `df`, and (optionally) `curl` are shelled out to; all are part of a standard Ubuntu install.

## Configurable (right-click → **Configure**)

- Refresh interval (1–60 s)
- Font size, theme (auto / dark / light), and **background opacity** (0–100 %, use 0 for a fully transparent panel)
- **Reorderable sections** — the *Sections* tab uses a list widget with Move Up / Move Down / Add / Remove / Show buttons, so you choose which stats appear and in which order
- Public-IP lookup on the IP row (opt-in)
- Sparkline graphs: on/off, width, height, history length (samples), and line color

## Install

```bash
git clone https://github.com/pessacheyal/cinnamon-sysinfo-desklet.git
mkdir -p ~/.local/share/cinnamon/desklets
cp -r cinnamon-sysinfo-desklet/sysinfo@pessacheyal ~/.local/share/cinnamon/desklets/
```

Then:

1. Open **Desklets** (right-click desktop → "Add desklets to desktop", or run `cinnamon-settings desklets`).
2. Find **System Info** in the list, click **+ Add to desktop**.
3. Right-click the desklet on your desktop → **Configure...** to tune settings.

To pick up code changes after editing files, restart Cinnamon (`Alt+F2`, type `r`, Enter).

## Tested on

- Cinnamon 5.x / 6.x
- Ubuntu 22.04 / 24.04 with the `cinnamon-desktop-environment` package
- Linux Mint 21 / 22

## Layout

```
sysinfo@pessacheyal/
├── metadata.json          # uuid, version, description
├── settings-schema.json   # user-facing settings surface
├── desklet.js             # main logic (metrics, drawing, settings binding)
└── stylesheet.css         # static fallback styles (colors are inlined)
```

## Screenshot

_TODO: add a screenshot once the desklet is running on an Ubuntu machine._

## License

MIT
