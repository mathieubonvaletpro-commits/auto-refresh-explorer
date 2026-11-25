'use strict';
// A minimal stand-in for the `obsidian` module and an in-memory vault, so the
// plugin can be loaded and driven by node:test without Obsidian.
const Module = require('node:module');
const path = require('node:path');

class TAbstractFile {}
class TFile extends TAbstractFile {
    constructor(vault, filePath, stat) {
        super();
        this.vault = vault;
        this.path = filePath;
        this.stat = stat;
    }
}
class TFolder extends TAbstractFile {
    constructor(folderPath) {
        super();
        this.path = folderPath;
        this.children = [];
    }
}
class Notice { constructor(msg) { Notice.shown.push(msg); } }
Notice.shown = [];
class Plugin {
    constructor(app) { this.app = app; this.intervals = []; this.tabs = []; }
    registerInterval(id) { this.intervals.push(id); return id; }
    addCommand(cmd) { this.command = cmd; }
    addSettingTab(tab) { this.tabs.push(tab); }
    async loadData() { return this.app.savedData; }
    async saveData(d) { this.app.savedData = d; }
}
class PluginSettingTab {
    constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = new FakeEl(); }
}
class FakeEl {
    constructor() { this.children = []; }
    empty() { this.children = []; }
    createEl(tag, o) { const e = Object.assign(new FakeEl(), { tag }, o); this.children.push(e); return e; }
}
class Setting {
    constructor(el) { this.controls = []; el.children.push(this); }
    setName(n) { this.name = n; return this; }
    setDesc(d) { this.desc = d; return this; }
    addControl(kind, cb) {
        const c = { kind, setValue(v) { this.value = v; return this; }, setPlaceholder() { return this; },
            onChange(f) { this.change = f; return this; }, inputEl: {} };
        cb(c); this.controls.push(c); return this;
    }
    addTextArea(cb) { return this.addControl('textarea', cb); }
    addText(cb) { return this.addControl('text', cb); }
    addToggle(cb) { return this.addControl('toggle', cb); }
}

const fakeObsidian = { Plugin, Notice, TFile, TFolder, PluginSettingTab, Setting };

// Obsidian runs plugins in a browser window; node has timers on globalThis.
globalThis.window = globalThis.window || globalThis;

function loadPlugin() {
    const origLoad = Module._load;
    Module._load = function (request, ...rest) {
        return request === 'obsidian' ? fakeObsidian : origLoad.call(this, request, ...rest);
    };
    try {
        // From the working directory, not __dirname: a test runner may run the
        // suite against a copy of main.js while test/ stays a symlink.
        const file = path.resolve('main.js');
        delete require.cache[file];
        return require(file);
    } finally {
        Module._load = origLoad;
    }
}

// In-memory disk + Obsidian index. `disk` maps folder path -> {mtime, files[], folders[]}.
function makeApp({ disk, indexed = [], savedData } = {}) {
    const index = new Map();
    const folder = (p) => { if (!index.has(p)) index.set(p, new TFolder(p)); return index.get(p); };
    for (const p of Object.keys(disk)) folder(p);
    for (const p of indexed) index.set(p, new TFile(null, p, {}));
    for (const p of Object.keys(disk)) {
        const parent = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : null;
        if (parent && index.has(parent)) index.get(parent).children.push(index.get(p));
    }
    const created = [];
    const app = {
        savedData,
        created,
        vault: {
            getAbstractFileByPath: (p) => index.get(p) || null,
            trigger: (ev, f) => { if (ev === 'create') { created.push(f.path); index.set(f.path, f); } },
            adapter: {
                stat: async (p) => (disk[p] ? { type: 'folder', mtime: disk[p].mtime } : null),
                list: async (p) => ({
                    files: (disk[p]?.files || []).map((n) => `${p}/${n}`),
                    folders: Object.keys(disk).filter((k) => k.startsWith(`${p}/`) && !k.slice(p.length + 1).includes('/')),
                }),
                read: async () => '',
            },
        },
        metadataCache: { trigger() {} },
        workspace: { onLayoutReady: (f) => f(), getLeavesOfType: () => [] },
    };
    return app;
}

module.exports = { loadPlugin, makeApp, fakeObsidian };
