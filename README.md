# System Info — Cinnamon Desklet

A configurable desktop widget for the Cinnamon desktop (Linux Mint, or Cinnamon on Ubuntu) that displays live system metrics with optional history sparklines.

## Metrics

- **CPU** — usage % and package temperature
- **RAM** — used / total
- **Swap** — used / total
- **Disk** — used / total for `/`
- **Uptime** — days / hours / minutes since boot
- **Load average** — 1 / 5 / 15 minute
- **Battery** — capacity % and charging state (auto-hidden on desktops)
- **Network** — aggregate ↓/↑ throughput, optionally broken down per interface
- **IP addresses** — local IP always; public IP on demand (via `curl ifconfig.me`, cached 5 min)

The desklet reads directly from `/proc` and `/sys` — no external daemons. Only `hostname`, `df`, and (optionally) `curl` are shelled out to; all are part of a standard Ubuntu install.

## Configurable (right-click → **Configure**)

- Refresh interval (1–60 s)
- Font size and theme (auto / dark / light)
- Toggle each section individually
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
