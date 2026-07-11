const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Settings = imports.ui.settings;
const Cairo = imports.cairo;

const HISTORY_MAX_CAP = 240;
const PUBLIC_IP_TTL_SEC = 300;
const DARK_THEME_PATTERN = /dark|noir|black|nord|dracula|mint-y-d|arc-dark|adwaita-dark/;

const SECTION_MAP = {
    "hostname":       { line: "hostname",  graph: false },
    "clock":          { line: "clock",     graph: false },
    "cpu":            { line: "cpu",       graph: true  },
    "mem":            { line: "mem",       graph: true  },
    "swap":           { line: "swap",      graph: false },
    "disk":           { line: "disk",      graph: false },
    "uptime":         { line: "uptime",    graph: false },
    "loadavg":        { line: "loadavg",   graph: false },
    "battery":        { line: "battery",   graph: false },
    "network":        { line: "net",       graph: true  },
    "network-ifaces": { line: "netIfaces", graph: false },
    "ip-local":       { line: "localIp",   graph: false },
    "ip-public":      { line: "publicIp",  graph: false }
};

// Default label prefix per section. User can override via the "label"
// column in the sections list. For "hostname", the label is a full-text
// override (not a prefix) so people can rewrite "System Info: <host>".
const DEFAULT_LABELS = {
    "hostname":       "",
    "clock":          "",
    "cpu":            "CPU: ",
    "mem":            "RAM: ",
    "swap":           "Swap: ",
    "disk":           "Disk: ",
    "uptime":         "Uptime: ",
    "loadavg":        "Load: ",
    "battery":        "Battery: ",
    "network":        "Net: ",
    "network-ifaces": "",
    "ip-local":       "Local: ",
    "ip-public":      ""
};

const DEFAULT_CLOCK_FORMAT = "%H:%M:%S %d-%m-%Y";

const DEFAULT_SECTIONS_LIST = [
    { section: "hostname",       enabled: true,  label: "", color: "", size: 0 },
    { section: "clock",          enabled: true,  label: "", color: "", size: 0 },
    { section: "cpu",            enabled: true,  label: "", color: "", size: 0 },
    { section: "mem",            enabled: true,  label: "", color: "", size: 0 },
    { section: "swap",           enabled: true,  label: "", color: "", size: 0 },
    { section: "disk",           enabled: true,  label: "", color: "", size: 0 },
    { section: "uptime",         enabled: true,  label: "", color: "", size: 0 },
    { section: "loadavg",        enabled: true,  label: "", color: "", size: 0 },
    { section: "battery",        enabled: true,  label: "", color: "", size: 0 },
    { section: "network",        enabled: true,  label: "", color: "", size: 0 },
    { section: "network-ifaces", enabled: false, label: "", color: "", size: 0 },
    { section: "ip-local",       enabled: true,  label: "", color: "", size: 0 },
    { section: "ip-public",      enabled: false, label: "", color: "", size: 0 }
];

function SysInfoDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

SysInfoDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this.metadata = metadata;
        this._removed = false;
        this._prevCpu = null;
        this._prevNet = null;
        this._history = { cpu: [], mem: [], net: [] };
        this._netMax = 1024;
        this._localIP = null;
        this._publicIPv4 = null;
        this._publicIPv6 = null;
        this._publicIPFetchedAt = 0;
        this._publicIPFetching = false;
        this._pendingIpFetches = 0;
        this._enabledSet = new Set();
        this._orderedSections = [];
        this._sectionStyle = {};

        this._bindSettings(desklet_id);
        this._bindTheme();

        this._buildUI();
        this._applyStyle();
        this._update();
        this._reschedule();
    },

    _bindSettings: function(desklet_id) {
        this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, desklet_id);
        const b = Settings.BindingDirection.IN;
        const onSection = Lang.bind(this, this._rebuildUI);
        const onStyle = Lang.bind(this, this._applyStyle);
        const onSchedule = Lang.bind(this, this._reschedule);
        const onColor = Lang.bind(this, this._repaintGraphs);

        this.settings.bindProperty(b, "refresh",         "refresh",       onSchedule);
        this.settings.bindProperty(b, "font-size",       "fontSize",      onStyle);
        this.settings.bindProperty(b, "theme-mode",      "themeMode",     onStyle);
        this.settings.bindProperty(b, "bg-opacity",      "bgOpacity",     onStyle);
        this.settings.bindProperty(b, "border-width",    "borderWidth",   onStyle);
        this.settings.bindProperty(b, "border-color",    "borderColor",   onStyle);
        this.settings.bindProperty(b, "clock-format",    "clockFormat",   onSection);

        this.settings.bindProperty(b, "fetch-public-ip", "fetchPublicIp", onSection);
        this.settings.bindProperty(b, "sections-list",   "sectionsList",  onSection);

        this.settings.bindProperty(b, "show-graphs",     "showGraphs",    onSection);
        this.settings.bindProperty(b, "graph-width",     "graphWidth",    onSection);
        this.settings.bindProperty(b, "graph-height",    "graphHeight",   onSection);
        this.settings.bindProperty(b, "graph-samples",   "graphSamples",  onSection);
        this.settings.bindProperty(b, "graph-color",     "graphColor",    onColor);
    },

    _bindTheme: function() {
        try {
            this._ifaceSettings = new Gio.Settings({ schema_id: "org.cinnamon.desktop.interface" });
            this._themeConn = this._ifaceSettings.connect(
                "changed::gtk-theme",
                Lang.bind(this, this._applyStyle)
            );
        } catch (e) {
            this._ifaceSettings = null;
        }
    },

    _isDarkTheme: function() {
        const mode = this.themeMode || "auto";
        if (mode === "dark") return true;
        if (mode === "light") return false;
        if (!this._ifaceSettings) return true;
        const name = (this._ifaceSettings.get_string("gtk-theme") || "").toLowerCase();
        return DARK_THEME_PATTERN.test(name);
    },

    _applyStyle: function() {
        if (!this._container) return;
        const dark = this._isDarkTheme();
        const opacity = Math.max(0, Math.min(100, (this.bgOpacity === undefined ? 65 : this.bgOpacity))) / 100;
        const bg = dark
            ? "rgba(0,0,0," + opacity.toFixed(2) + ")"
            : "rgba(255,255,255," + opacity.toFixed(2) + ")";
        const fg = dark ? "#eeeeee" : "#222222";
        const fs = this.fontSize || 12;
        const bw = Math.max(0, Math.min(10, this.borderWidth || 0));
        const border = bw > 0
            ? "border: " + bw + "px solid " + (this.borderColor || "rgba(255,255,255,0.35)") + ";"
            : "";
        this._container.set_style(
            "background-color: " + bg + ";" +
            "color: " + fg + ";" +
            "font-size: " + fs + "px;" +
            border +
            "border-radius: 10px;" +
            "padding: 14px 18px;"
        );
        this._repaintGraphs();
    },

    _reschedule: function() {
        if (this._timeout) {
            Mainloop.source_remove(this._timeout);
            this._timeout = null;
        }
        if (this._removed) return;
        const secs = Math.max(1, this.refresh || 2);
        this._timeout = Mainloop.timeout_add_seconds(secs, Lang.bind(this, this._tick));
    },

    _tick: function() {
        if (this._removed) return false;
        this._update();
        return true;
    },

    _rebuildUI: function() {
        if (this._container) {
            this._container.destroy();
            this._container = null;
        }
        this._buildUI();
        this._applyStyle();
        this._update();
    },

    _computeSectionsFromList: function() {
        this._orderedSections = [];
        this._enabledSet = new Set();
        this._sectionStyle = {};
        const list = Array.isArray(this.sectionsList) ? this.sectionsList : [];

        const push = Lang.bind(this, function(key, style) {
            if (this._enabledSet.has(key)) return;
            if (!SECTION_MAP[key]) return;
            this._enabledSet.add(key);
            this._orderedSections.push(key);
            this._sectionStyle[key] = {
                label: (style && style.label) || "",
                color: (style && style.color) || "",
                size:  (style && style.size)  || 0
            };
        });

        for (let i = 0; i < list.length; i++) {
            const row = list[i];
            if (!row || !row.section) continue;
            if (row.enabled === false) continue;

            // Legacy migration: a saved "ip" row becomes ip-local (and ip-public if
            // the user previously had fetch-public-ip enabled).
            if (row.section === "ip") {
                push("ip-local", row);
                if (this.fetchPublicIp) push("ip-public", row);
                continue;
            }

            push(row.section, row);
        }
    },

    _styleStrFor: function(sectionKey) {
        const s = this._sectionStyle[sectionKey];
        if (!s) return "";
        const parts = [];
        if (s.color) parts.push("color: " + s.color);
        if (s.size && s.size > 0) parts.push("font-size: " + s.size + "px");
        return parts.length ? parts.join(";") + ";" : "";
    },

    _labelPrefix: function(sectionKey) {
        const s = this._sectionStyle[sectionKey];
        if (s && s.label) return s.label;
        return DEFAULT_LABELS[sectionKey] || "";
    },

    _buildUI: function() {
        this._computeSectionsFromList();

        this._labels = {};
        this._graphs = {};
        this._title = null;
        this._container = new St.BoxLayout({ vertical: true, style_class: "sysinfo-container" });

        for (let i = 0; i < this._orderedSections.length; i++) {
            const key = this._orderedSections[i];
            this._addLine(key);
            if (SECTION_MAP[key].graph) this._addGraph(key);
        }

        this.setContent(this._container);
    },

    _addLine: function(sectionKey) {
        const lineKey = SECTION_MAP[sectionKey].line;
        const label = new St.Label({ style_class: "sysinfo-line" });
        const style = this._styleStrFor(sectionKey);
        if (style) label.set_style(style);
        this._labels[lineKey] = label;
        this._container.add(label);
    },

    _addGraph: function(sectionKey) {
        if (!this.showGraphs) return;
        const lineKey = SECTION_MAP[sectionKey].line;
        const area = new St.DrawingArea({ reactive: false });
        const w = Math.max(60, Math.min(500, this.graphWidth || 220));
        const h = Math.max(16, Math.min(100, this.graphHeight || 32));
        area.set_width(w);
        area.set_height(h);
        area.connect("repaint", Lang.bind(this, function(a) { this._drawGraph(a, lineKey); }));
        this._graphs[lineKey] = area;
        this._container.add(area);
    },

    // ------------- readers -------------
    _readFile: function(path) {
        try {
            const file = Gio.File.new_for_path(path);
            const [ok, contents] = file.load_contents(null);
            if (ok) return contents.toString();
        } catch (e) {}
        return null;
    },

    _getCpu: function() {
        const stat = this._readFile("/proc/stat");
        if (!stat) return null;
        const parts = stat.split("\n")[0].trim().split(/\s+/).slice(1).map(function(x) { return parseInt(x); });
        const idle = parts[3] + (parts[4] || 0);
        const nonIdle = parts[0] + parts[1] + parts[2] +
                        (parts[5] || 0) + (parts[6] || 0) + (parts[7] || 0);
        return { idle: idle, total: idle + nonIdle };
    },

    _getCpuTemp: function() {
        for (let i = 0; i < 12; i++) {
            const type = this._readFile("/sys/class/thermal/thermal_zone" + i + "/type");
            if (!type) continue;
            const t = type.trim().toLowerCase();
            if (t.indexOf("cpu") !== -1 || t.indexOf("x86_pkg_temp") !== -1 ||
                t.indexOf("coretemp") !== -1 || t.indexOf("k10temp") !== -1 ||
                t.indexOf("acpitz") !== -1) {
                const raw = this._readFile("/sys/class/thermal/thermal_zone" + i + "/temp");
                if (raw) return parseInt(raw) / 1000;
            }
        }
        const raw = this._readFile("/sys/class/thermal/thermal_zone0/temp");
        return raw ? parseInt(raw) / 1000 : null;
    },

    _getMem: function() {
        const m = this._readFile("/proc/meminfo");
        if (!m) return null;
        const v = {};
        m.split("\n").forEach(function(line) {
            const x = line.match(/^(\S+):\s+(\d+)/);
            if (x) v[x[1]] = parseInt(x[2]) * 1024;
        });
        const total = v.MemTotal || 0;
        const avail = v.MemAvailable !== undefined ? v.MemAvailable : (v.MemFree || 0);
        return {
            total: total,
            used: total - avail,
            swapTotal: v.SwapTotal || 0,
            swapUsed: (v.SwapTotal || 0) - (v.SwapFree || 0)
        };
    },

    _getDisk: function() {
        try {
            const [ok, stdout] = GLib.spawn_command_line_sync("df -B1 --output=size,used /");
            if (!ok) return null;
            const lines = stdout.toString().trim().split("\n");
            if (lines.length < 2) return null;
            const p = lines[1].trim().split(/\s+/);
            return { total: parseInt(p[0]), used: parseInt(p[1]) };
        } catch (e) {
            return null;
        }
    },

    _getUptime: function() {
        const u = this._readFile("/proc/uptime");
        if (!u) return null;
        return parseFloat(u.split(/\s+/)[0]);
    },

    _getLoadAvg: function() {
        const l = this._readFile("/proc/loadavg");
        if (!l) return null;
        const p = l.trim().split(/\s+/);
        return [parseFloat(p[0]), parseFloat(p[1]), parseFloat(p[2])];
    },

    _getBattery: function() {
        let bats = [];
        try {
            const dir = Gio.File.new_for_path("/sys/class/power_supply");
            const en = dir.enumerate_children("standard::name", Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = en.next_file(null)) !== null) {
                const name = info.get_name();
                if (name.indexOf("BAT") === 0) bats.push(name);
            }
            en.close(null);
        } catch (e) {
            return null;
        }
        if (bats.length === 0) return null;

        let capSum = 0, count = 0, status = "Unknown";
        for (let i = 0; i < bats.length; i++) {
            const b = bats[i];
            const cap = this._readFile("/sys/class/power_supply/" + b + "/capacity");
            if (cap) { capSum += parseInt(cap); count++; }
            const s = this._readFile("/sys/class/power_supply/" + b + "/status");
            if (s && s.trim() !== "Unknown") status = s.trim();
        }
        if (count === 0) return null;
        return { capacity: Math.round(capSum / count), status: status };
    },

    _getNet: function() {
        const data = this._readFile("/proc/net/dev");
        if (!data) return null;
        const lines = data.split("\n").slice(2);
        const ifaces = {};
        let totalRx = 0, totalTx = 0;
        lines.forEach(function(line) {
            const m = line.match(/^\s*(\S+):\s*(.+)/);
            if (!m) return;
            const iface = m[1];
            if (iface === "lo") return;
            const cols = m[2].trim().split(/\s+/);
            const rx = parseInt(cols[0]), tx = parseInt(cols[8]);
            ifaces[iface] = { rx: rx, tx: tx };
            totalRx += rx;
            totalTx += tx;
        });
        return {
            total: { rx: totalRx, tx: totalTx },
            ifaces: ifaces,
            time: GLib.get_monotonic_time() / 1000000
        };
    },

    _getLocalIp: function() {
        try {
            const [ok, stdout] = GLib.spawn_command_line_sync("hostname -I");
            if (ok) {
                const parts = stdout.toString().trim().split(/\s+/)
                    .filter(function(s) { return s && s.indexOf(":") === -1; });
                if (parts.length) return parts[0];
            }
        } catch (e) {}
        try {
            const [ok, stdout] = GLib.spawn_command_line_sync("ip -4 -o addr show scope global");
            if (ok) {
                const m = stdout.toString().match(/inet\s+(\d+\.\d+\.\d+\.\d+)/);
                if (m) return m[1];
            }
        } catch (e) {}
        return null;
    },

    _fetchPublicIpAsync: function() {
        if (this._publicIPFetching) return;
        const now = GLib.get_monotonic_time() / 1000000;
        const haveAny = this._publicIPv4 || this._publicIPv6;
        if (haveAny && (now - this._publicIPFetchedAt) < PUBLIC_IP_TTL_SEC) return;
        this._publicIPFetching = true;
        this._pendingIpFetches = 2;
        this._fetchOnePublicIp("-4", "_publicIPv4");
        this._fetchOnePublicIp("-6", "_publicIPv6");
    },

    _fetchOnePublicIp: function(flag, key) {
        try {
            const proc = Gio.Subprocess.new(
                ["curl", "-s", flag, "-m", "3", "https://ifconfig.me"],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            );
            proc.communicate_utf8_async(null, null, Lang.bind(this, function(p, res) {
                if (this._removed) return;
                try {
                    const result = p.communicate_utf8_finish(res);
                    const stdout = (result[1] || "").trim();
                    if (stdout.length > 0 && stdout.length <= 45 &&
                        /^[0-9a-f\.\:]+$/i.test(stdout)) {
                        this[key] = stdout;
                    } else {
                        this[key] = null;
                    }
                } catch (e) {
                    this[key] = null;
                }
                this._onPublicIpFetchDone();
            }));
        } catch (e) {
            this[key] = null;
            this._onPublicIpFetchDone();
        }
    },

    _onPublicIpFetchDone: function() {
        if (--this._pendingIpFetches > 0) return;
        this._publicIPFetching = false;
        this._publicIPFetchedAt = GLib.get_monotonic_time() / 1000000;
        this._refreshPublicIpLabel();
    },

    _refreshPublicIpLabel: function() {
        if (!this._labels || !this._labels.publicIp) return;
        const prefix = this._labelPrefix("ip-public");
        const lines = [];
        if (this._publicIPv4) lines.push(prefix + "Public v4: " + this._publicIPv4);
        if (this._publicIPv6) lines.push(prefix + "Public v6: " + this._publicIPv6);
        let text;
        if (lines.length) {
            text = lines.join("\n");
        } else if (this._publicIPFetching) {
            text = prefix + "Public: fetching…";
        } else {
            text = prefix + "Public: unavailable";
        }
        this._labels.publicIp.set_text(text);
    },

    // ------------- formatting -------------
    _fmt: function(bytes) {
        if (!bytes || bytes < 0) bytes = 0;
        if (bytes < 1) return "0 B";
        const units = ["B", "KB", "MB", "GB", "TB"];
        const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
        return (bytes / Math.pow(1024, i)).toFixed(1) + " " + units[i];
    },

    _fmtUptime: function(s) {
        s = Math.floor(s);
        const d = Math.floor(s / 86400); s %= 86400;
        const h = Math.floor(s / 3600);  s %= 3600;
        const m = Math.floor(s / 60);
        if (d > 0) return d + "d " + h + "h " + m + "m";
        if (h > 0) return h + "h " + m + "m";
        return m + "m";
    },

    _pushHistory: function(key, value) {
        const cap = Math.max(20, Math.min(HISTORY_MAX_CAP, this.graphSamples || 60));
        const arr = this._history[key];
        arr.push(value);
        while (arr.length > cap) arr.shift();
    },

    _parseColor: function(str) {
        const m = String(str || "").match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d\.]+)\s*)?\)/);
        if (!m) return [0.38, 0.63, 0.92, 1];
        return [
            parseInt(m[1]) / 255,
            parseInt(m[2]) / 255,
            parseInt(m[3]) / 255,
            m[4] !== undefined ? parseFloat(m[4]) : 1
        ];
    },

    _drawGraph: function(area, key) {
        const size = area.get_surface_size();
        const w = size[0], h = size[1];
        const cr = area.get_context();

        const dark = this._isDarkTheme();
        cr.setSourceRGBA(dark ? 1 : 0, dark ? 1 : 0, dark ? 1 : 0, 0.08);
        cr.rectangle(0, 0, w, h);
        cr.fill();

        const arr = this._history[key];
        if (!arr || arr.length < 2) return;

        let maxV = 100;
        if (key === "net") maxV = Math.max(1, this._netMax);

        const color = this._parseColor(this.graphColor);
        const r = color[0], g = color[1], b = color[2], a = color[3];

        cr.setSourceRGBA(r, g, b, 0.25);
        cr.moveTo(0, h);
        for (let i = 0; i < arr.length; i++) {
            const x = (i / (arr.length - 1)) * w;
            const y = h - Math.min(1, arr[i] / maxV) * h;
            cr.lineTo(x, y);
        }
        cr.lineTo(w, h);
        cr.closePath();
        cr.fill();

        cr.setSourceRGBA(r, g, b, a);
        cr.setLineWidth(1.5);
        for (let i = 0; i < arr.length; i++) {
            const x = (i / (arr.length - 1)) * w;
            const y = h - Math.min(1, arr[i] / maxV) * h;
            if (i === 0) cr.moveTo(x, y); else cr.lineTo(x, y);
        }
        cr.stroke();
    },

    _repaintGraphs: function() {
        if (!this._graphs) return;
        for (const k in this._graphs) this._graphs[k].queue_repaint();
    },

    // ------------- settings-button callbacks -------------
    _onApplyClicked: function() {
        this._rebuildUI();
    },

    _onResetClicked: function() {
        const defaults = JSON.parse(JSON.stringify(DEFAULT_SECTIONS_LIST));
        try {
            this.settings.setValue("sections-list", defaults);
        } catch (e) {
            // Best-effort: at least reflect defaults locally
            this.sectionsList = defaults;
            this._rebuildUI();
        }
    },

    // ------------- update loop -------------
    _update: function() {
        if (this._removed || !this._labels) return;
        const on = this._enabledSet;

        if (on.has("hostname") && this._labels.hostname) {
            const custom = this._sectionStyle.hostname && this._sectionStyle.hostname.label;
            const host = GLib.get_host_name() || "";
            this._labels.hostname.set_text(custom || host);
        }

        if (on.has("clock") && this._labels.clock) {
            let text = "";
            try {
                const fmt = this.clockFormat || DEFAULT_CLOCK_FORMAT;
                const dt = GLib.DateTime.new_now_local();
                text = dt.format(fmt) || dt.format(DEFAULT_CLOCK_FORMAT) || "";
            } catch (e) {}
            this._labels.clock.set_text(this._labelPrefix("clock") + text);
        }

        if (on.has("cpu")) {
            const cpu = this._getCpu();
            let cpuPct = 0;
            if (cpu && this._prevCpu) {
                const td = cpu.total - this._prevCpu.total;
                const id = cpu.idle - this._prevCpu.idle;
                if (td > 0) cpuPct = 100 * (td - id) / td;
            }
            this._prevCpu = cpu;
            const t = this._getCpuTemp();
            if (this._labels.cpu) {
                this._labels.cpu.set_text(
                    this._labelPrefix("cpu") + cpuPct.toFixed(1) + "%" +
                    (t !== null ? "   " + t.toFixed(0) + "°C" : "")
                );
            }
            this._pushHistory("cpu", cpuPct);
        }

        const needMem = on.has("mem") || on.has("swap");
        const mem = needMem ? this._getMem() : null;
        if (on.has("mem") && mem && mem.total > 0 && this._labels.mem) {
            const pct = 100 * mem.used / mem.total;
            this._labels.mem.set_text(
                this._labelPrefix("mem") + this._fmt(mem.used) + " / " + this._fmt(mem.total) +
                "  (" + pct.toFixed(0) + "%)"
            );
            this._pushHistory("mem", pct);
        }
        if (on.has("swap") && this._labels.swap) {
            if (mem && mem.swapTotal > 0) {
                const pct = 100 * mem.swapUsed / mem.swapTotal;
                this._labels.swap.set_text(
                    this._labelPrefix("swap") + this._fmt(mem.swapUsed) + " / " + this._fmt(mem.swapTotal) +
                    "  (" + pct.toFixed(0) + "%)"
                );
            } else {
                this._labels.swap.set_text(this._labelPrefix("swap") + "none");
            }
        }

        if (on.has("disk") && this._labels.disk) {
            const d = this._getDisk();
            if (d && d.total > 0) {
                const pct = 100 * d.used / d.total;
                this._labels.disk.set_text(
                    this._labelPrefix("disk") + this._fmt(d.used) + " / " + this._fmt(d.total) +
                    "  (" + pct.toFixed(0) + "%)"
                );
            }
        }

        if (on.has("uptime") && this._labels.uptime) {
            const u = this._getUptime();
            if (u !== null) this._labels.uptime.set_text(this._labelPrefix("uptime") + this._fmtUptime(u));
        }

        if (on.has("loadavg") && this._labels.loadavg) {
            const la = this._getLoadAvg();
            if (la) {
                this._labels.loadavg.set_text(
                    this._labelPrefix("loadavg") + la[0].toFixed(2) + "  " + la[1].toFixed(2) + "  " + la[2].toFixed(2)
                );
            }
        }

        if (on.has("battery") && this._labels.battery) {
            const bat = this._getBattery();
            if (bat) {
                const mark = bat.status === "Charging" ? " ⚡" :
                             bat.status === "Full"     ? " ✓"  : "";
                this._labels.battery.set_text(
                    this._labelPrefix("battery") + bat.capacity + "%  " + bat.status + mark
                );
            } else {
                this._labels.battery.set_text(this._labelPrefix("battery") + "N/A");
            }
        }

        const needNet = on.has("network") || on.has("network-ifaces");
        if (needNet) {
            const net = this._getNet();
            if (net && this._prevNet) {
                const dt = net.time - this._prevNet.time;
                if (dt > 0) {
                    const rxRate = Math.max(0, (net.total.rx - this._prevNet.total.rx) / dt);
                    const txRate = Math.max(0, (net.total.tx - this._prevNet.total.tx) / dt);
                    if (on.has("network") && this._labels.net) {
                        this._labels.net.set_text(
                            this._labelPrefix("network") + "↓ " + this._fmt(rxRate) + "/s  ↑ " + this._fmt(txRate) + "/s"
                        );
                    }
                    const combined = rxRate + txRate;
                    this._netMax = Math.max(this._netMax * 0.97, combined, 1024);
                    this._pushHistory("net", combined);

                    if (on.has("network-ifaces") && this._labels.netIfaces) {
                        const lines = [];
                        const prefix = this._labelPrefix("network-ifaces");
                        for (const iface in net.ifaces) {
                            const prev = this._prevNet.ifaces[iface];
                            if (!prev) continue;
                            const rr = Math.max(0, (net.ifaces[iface].rx - prev.rx) / dt);
                            const tr = Math.max(0, (net.ifaces[iface].tx - prev.tx) / dt);
                            if (rr + tr < 100) continue;
                            lines.push(prefix + iface + ": ↓ " + this._fmt(rr) + "/s  ↑ " + this._fmt(tr) + "/s");
                        }
                        this._labels.netIfaces.set_text(lines.length ? lines.join("\n") : prefix + "(all interfaces idle)");
                    }
                }
            } else if (on.has("network") && this._labels.net) {
                this._labels.net.set_text(this._labelPrefix("network") + "measuring...");
            }
            this._prevNet = net;
        }

        if (on.has("ip-local") && this._labels.localIp) {
            this._localIP = this._getLocalIp();
            this._labels.localIp.set_text(this._labelPrefix("ip-local") + (this._localIP || "unavailable"));
        }

        if (on.has("ip-public") && this._labels.publicIp) {
            this._fetchPublicIpAsync();
            this._refreshPublicIpLabel();
        }

        this._repaintGraphs();
    },

    on_desklet_removed: function() {
        this._removed = true;
        if (this._timeout) {
            Mainloop.source_remove(this._timeout);
            this._timeout = null;
        }
        if (this._ifaceSettings && this._themeConn) {
            try { this._ifaceSettings.disconnect(this._themeConn); } catch (e) {}
            this._themeConn = 0;
        }
        if (this.settings) {
            try { this.settings.finalize(); } catch (e) {}
        }
    }
};

function main(metadata, desklet_id) {
    return new SysInfoDesklet(metadata, desklet_id);
}
