# System Info — Cinnamon Desklet

A minimal desktop widget for the Cinnamon desktop (Linux Mint, or Cinnamon on Ubuntu) that displays live system metrics:

- **CPU** usage % and package temperature
- **RAM** used / total
- **Swap** used / total
- **Disk** used / total for `/`
- **Network** aggregate down / up throughput

The desklet reads directly from `/proc` and `/sys` — no external daemons or dependencies beyond a standard Cinnamon install.

## Install

```bash
git clone https://github.com/pessacheyal/cinnamon-sysinfo-desklet.git
mkdir -p ~/.local/share/cinnamon/desklets
cp -r cinnamon-sysinfo-desklet/sysinfo@pessacheyal ~/.local/share/cinnamon/desklets/
```

Then:

1. Open **Desklets** (right-click desktop → "Add desklets to desktop", or run `cinnamon-settings desklets`).
2. Find **System Info** in the list, click **+ Add to desktop**.

To pick up code changes, restart Cinnamon (`Alt+F2`, type `r`, Enter).

## Tested on

- Cinnamon 5.x / 6.x
- Ubuntu 22.04 / 24.04 with the `cinnamon-desktop-environment` package
- Linux Mint 21 / 22

## Configuration

Edit `desklet.js` and change `REFRESH_SECONDS` at the top of the file to adjust the refresh rate.

## Layout

```
sysinfo@pessacheyal/
├── metadata.json    # desklet metadata (uuid, version, description)
├── desklet.js       # main logic
└── stylesheet.css   # appearance
```

## License

MIT
