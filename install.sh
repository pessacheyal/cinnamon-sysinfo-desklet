#!/usr/bin/env bash
#
# install.sh — install or upgrade the System Info Cinnamon desklet.
#
# Usage:
#   ./install.sh              # install / upgrade; try to reload Cinnamon
#   ./install.sh --no-reload  # install / upgrade only, don't touch Cinnamon
#
# What it does:
#   1. Copies sysinfo@pessacheyal/ into ~/.local/share/cinnamon/desklets/
#   2. On upgrade, replaces the deployed files (via rsync --delete when
#      available) without touching your saved settings at
#      ~/.config/cinnamon/spices/sysinfo@pessacheyal/.
#   3. Optionally reloads Cinnamon so the new code takes effect.

set -euo pipefail

UUID="sysinfo@pessacheyal"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="${SCRIPT_DIR}/${UUID}"
DEST_ROOT="${HOME}/.local/share/cinnamon/desklets"
DEST_DIR="${DEST_ROOT}/${UUID}"

RELOAD=1
for arg in "$@"; do
    case "$arg" in
        --no-reload) RELOAD=0 ;;
        -h|--help)
            sed -n '2,15p' "$0"
            exit 0
            ;;
        *)
            echo "install.sh: unknown option: $arg" >&2
            exit 2
            ;;
    esac
done

if [ ! -d "$SRC_DIR" ]; then
    echo "install.sh: source directory not found: $SRC_DIR" >&2
    echo "  Run this script from inside the cloned repo." >&2
    exit 1
fi

read_version() {
    python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('version','?'))" "$1" 2>/dev/null || echo "?"
}

new_ver=$(read_version "$SRC_DIR/metadata.json")

if [ -d "$DEST_DIR" ]; then
    cur_ver=$(read_version "$DEST_DIR/metadata.json")
    if [ "$cur_ver" = "$new_ver" ]; then
        echo "System Info $UUID is already at version $new_ver — reinstalling."
    else
        echo "Upgrading $UUID: $cur_ver → $new_ver"
    fi
    is_fresh=0
else
    echo "Installing $UUID $new_ver"
    is_fresh=1
fi

mkdir -p "$DEST_ROOT"

if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$SRC_DIR/" "$DEST_DIR/"
else
    rm -rf "$DEST_DIR"
    cp -r "$SRC_DIR" "$DEST_DIR"
fi

echo "Copied to $DEST_DIR"

reloaded=0
if [ "$RELOAD" -eq 1 ]; then
    if [ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ] && command -v gdbus >/dev/null 2>&1; then
        if gdbus call --session \
                --dest org.Cinnamon \
                --object-path /org/Cinnamon \
                --method org.Cinnamon.Eval 'global.reexec_self();' >/dev/null 2>&1; then
            echo "Requested Cinnamon reload via D-Bus."
            reloaded=1
        fi
    fi
fi

if [ "$reloaded" -eq 0 ] && [ "$RELOAD" -eq 1 ]; then
    echo "Could not reload Cinnamon automatically."
    echo "  Press Alt+F2, type r, and press Enter to reload it manually."
fi

if [ "$is_fresh" -eq 1 ]; then
    echo
    echo "First install — after Cinnamon reloads:"
    echo "  1. Right-click the desktop → Add desklets to desktop"
    echo "  2. Select 'System Info' → click '+ Add to desktop'"
fi
