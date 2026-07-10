const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Mainloop = imports.mainloop;
const Lang = imports.lang;

const REFRESH_SECONDS = 2;

function SysInfoDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

SysInfoDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this._prevCpu = null;
        this._prevNet = null;
        this._removed = false;
        this._lastUpdateMs = 0;

        this._buildUI();
        this._update();
        this._timeout = Mainloop.timeout_add_seconds(REFRESH_SECONDS, Lang.bind(this, this._update));
    },

    _buildUI: function() {
        this._container = new St.BoxLayout({
            vertical: true,
            style_class: "sysinfo-container"
        });

        this._title = new St.Label({ text: "System Info", style_class: "sysinfo-title" });
        this._cpuLabel = new St.Label({ style_class: "sysinfo-line" });
        this._memLabel = new St.Label({ style_class: "sysinfo-line" });
        this._swapLabel = new St.Label({ style_class: "sysinfo-line" });
        this._diskLabel = new St.Label({ style_class: "sysinfo-line" });
        this._netLabel = new St.Label({ style_class: "sysinfo-line" });

        this._container.add(this._title);
        this._container.add(this._cpuLabel);
        this._container.add(this._memLabel);
        this._container.add(this._swapLabel);
        this._container.add(this._diskLabel);
        this._container.add(this._netLabel);

        this.setContent(this._container);
    },

    _readFile: function(path) {
        try {
            let file = Gio.File.new_for_path(path);
            let [ok, contents] = file.load_contents(null);
            if (ok) return contents.toString();
        } catch (e) {}
        return null;
    },

    _getCpu: function() {
        let stat = this._readFile("/proc/stat");
        if (!stat) return null;
        let firstLine = stat.split("\n")[0];
        let parts = firstLine.trim().split(/\s+/).slice(1).map(function(x) { return parseInt(x); });
        let idle = parts[3] + (parts[4] || 0);
        let nonIdle = parts[0] + parts[1] + parts[2] +
                      (parts[5] || 0) + (parts[6] || 0) + (parts[7] || 0);
        return { idle: idle, total: idle + nonIdle };
    },

    _getCpuTemp: function() {
        for (let i = 0; i < 12; i++) {
            let type = this._readFile("/sys/class/thermal/thermal_zone" + i + "/type");
            if (!type) continue;
            type = type.trim().toLowerCase();
            if (type.indexOf("cpu") !== -1 ||
                type.indexOf("x86_pkg_temp") !== -1 ||
                type.indexOf("coretemp") !== -1 ||
                type.indexOf("k10temp") !== -1 ||
                type.indexOf("acpitz") !== -1) {
                let raw = this._readFile("/sys/class/thermal/thermal_zone" + i + "/temp");
                if (raw) return parseInt(raw) / 1000;
            }
        }
        let raw = this._readFile("/sys/class/thermal/thermal_zone0/temp");
        if (raw) return parseInt(raw) / 1000;
        return null;
    },

    _getMem: function() {
        let mem = this._readFile("/proc/meminfo");
        if (!mem) return null;
        let vals = {};
        mem.split("\n").forEach(function(line) {
            let m = line.match(/^(\S+):\s+(\d+)/);
            if (m) vals[m[1]] = parseInt(m[2]) * 1024;
        });
        let total = vals.MemTotal || 0;
        let avail = vals.MemAvailable !== undefined ? vals.MemAvailable : (vals.MemFree || 0);
        return {
            total: total,
            used: total - avail,
            swapTotal: vals.SwapTotal || 0,
            swapUsed: (vals.SwapTotal || 0) - (vals.SwapFree || 0)
        };
    },

    _getDisk: function() {
        try {
            let [ok, stdout] = GLib.spawn_command_line_sync("df -B1 --output=size,used /");
            if (!ok) return null;
            let text = stdout.toString().trim();
            let lines = text.split("\n");
            if (lines.length < 2) return null;
            let parts = lines[1].trim().split(/\s+/);
            return { total: parseInt(parts[0]), used: parseInt(parts[1]) };
        } catch (e) {
            return null;
        }
    },

    _getNet: function() {
        let net = this._readFile("/proc/net/dev");
        if (!net) return null;
        let lines = net.split("\n").slice(2);
        let rx = 0, tx = 0;
        lines.forEach(function(line) {
            let m = line.match(/^\s*(\S+):\s*(.+)/);
            if (!m) return;
            let iface = m[1];
            if (iface === "lo") return;
            let cols = m[2].trim().split(/\s+/);
            rx += parseInt(cols[0]);
            tx += parseInt(cols[8]);
        });
        return { rx: rx, tx: tx, time: GLib.get_monotonic_time() / 1000 };
    },

    _fmt: function(bytes) {
        if (!bytes || bytes < 0) bytes = 0;
        if (bytes < 1) return "0 B";
        const units = ["B", "KB", "MB", "GB", "TB"];
        let i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
        return (bytes / Math.pow(1024, i)).toFixed(1) + " " + units[i];
    },

    _update: function() {
        if (this._removed) return false;

        let cpu = this._getCpu();
        let cpuPct = 0;
        if (cpu && this._prevCpu) {
            let totalDiff = cpu.total - this._prevCpu.total;
            let idleDiff = cpu.idle - this._prevCpu.idle;
            if (totalDiff > 0) cpuPct = 100 * (totalDiff - idleDiff) / totalDiff;
        }
        this._prevCpu = cpu;
        let temp = this._getCpuTemp();
        this._cpuLabel.set_text(
            "CPU:  " + cpuPct.toFixed(1) + "%" +
            (temp !== null ? "   " + temp.toFixed(0) + "°C" : "")
        );

        let mem = this._getMem();
        if (mem && mem.total > 0) {
            let memPct = 100 * mem.used / mem.total;
            this._memLabel.set_text(
                "RAM:  " + this._fmt(mem.used) + " / " + this._fmt(mem.total) +
                "  (" + memPct.toFixed(0) + "%)"
            );
            if (mem.swapTotal > 0) {
                let swapPct = 100 * mem.swapUsed / mem.swapTotal;
                this._swapLabel.set_text(
                    "Swap: " + this._fmt(mem.swapUsed) + " / " + this._fmt(mem.swapTotal) +
                    "  (" + swapPct.toFixed(0) + "%)"
                );
            } else {
                this._swapLabel.set_text("Swap: none");
            }
        }

        let disk = this._getDisk();
        if (disk && disk.total > 0) {
            let diskPct = 100 * disk.used / disk.total;
            this._diskLabel.set_text(
                "Disk: " + this._fmt(disk.used) + " / " + this._fmt(disk.total) +
                "  (" + diskPct.toFixed(0) + "%)"
            );
        }

        let net = this._getNet();
        if (net && this._prevNet) {
            let dt = (net.time - this._prevNet.time) / 1000;
            if (dt > 0) {
                let rxRate = Math.max(0, (net.rx - this._prevNet.rx) / dt);
                let txRate = Math.max(0, (net.tx - this._prevNet.tx) / dt);
                this._netLabel.set_text(
                    "Net:  ↓ " + this._fmt(rxRate) + "/s  ↑ " + this._fmt(txRate) + "/s"
                );
            }
        } else {
            this._netLabel.set_text("Net:  measuring...");
        }
        this._prevNet = net;

        return true;
    },

    on_desklet_removed: function() {
        this._removed = true;
        if (this._timeout) {
            Mainloop.source_remove(this._timeout);
            this._timeout = null;
        }
    }
};

function main(metadata, desklet_id) {
    return new SysInfoDesklet(metadata, desklet_id);
}
