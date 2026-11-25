const { Plugin, Notice, TFile, PluginSettingTab, Setting } = require('obsidian');

const DEFAULT_SETTINGS = Object.freeze({
    watchedFolders: Object.freeze(['00 INBOX', '01 PROJET', '02 CAPS']),
    scanIntervalMs: 3000,
    includeSubfolders: false,
});
const MIN_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 1000;
const DEBUG = false; // Set to true for verbose console logging

function log(...args) {
    if (DEBUG) console.log('[AutoRefresh]', ...args);
}

/** ── Settings (parsed once, where they come in) ──────────── */

function normaliseFolder(value) {
    if (typeof value !== 'string') return '';
    return value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function cleanFolderList(values) {
    return [...new Set(values.map(normaliseFolder).filter(Boolean))];
}

function foldersFromText(text) {
    return cleanFolderList(String(text).split(/\r?\n/));
}

function parseInterval(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SETTINGS.scanIntervalMs;
    return Math.max(MIN_INTERVAL_MS, Math.floor(value));
}

function parseSettings(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    return {
        watchedFolders: Array.isArray(data.watchedFolders)
            ? cleanFolderList(data.watchedFolders)
            : [...DEFAULT_SETTINGS.watchedFolders],
        scanIntervalMs: parseInterval(data.scanIntervalMs),
        includeSubfolders: typeof data.includeSubfolders === 'boolean'
            ? data.includeSubfolders
            : DEFAULT_SETTINGS.includeSubfolders,
    };
}

function nudgeExplorerView(view, folderPath) {
    view.requestUpdate?.();
    view.update?.();
    view.fileItems?.[folderPath]?.update?.();
}

/**
 * Auto Refresh Explorer — Injects externally-created files into Obsidian's index.
 *
 * When Syncthing (or any external tool) drops new files into the vault,
 * Obsidian's desktop file watcher often misses them. This plugin detects
 * folder changes via low-cost adapter.stat() polling and manually
 * creates TFile objects + fires vault 'create' events so the file explorer
 * and metadata cache pick them up instantly.
 */
class AutoRefreshExplorerPlugin extends Plugin {
    async onload() {
        log('Loaded');

        this.pollInterval = null;
        this.mtimeStore = new Map();
        this.isRefreshing = new Map();
        this.trackedFolders = [];
        this.listTimeoutMs = DEFAULT_TIMEOUT_MS;
        this.settings = parseSettings(await this.loadData());

        this.ready = new Promise((resolve) => {
            const init = () => this.restartPolling().then(() => {
                new Notice('Auto Refresh: active');
                resolve();
            });
            this.app.workspace.onLayoutReady(init);
        });

        this.addCommand({
            id: 'refresh-explorer-now',
            name: 'Refresh file explorer now',
            callback: () => this.refreshAll()
        });

        this.settingTab = new AutoRefreshSettingTab(this.app, this);
        this.addSettingTab(this.settingTab);
    }

    async updateSettings(changes) {
        this.settings = parseSettings({ ...this.settings, ...changes });
        await this.saveData(this.settings);
        await this.restartPolling();
    }

    async restartPolling() {
        this.stopPolling();
        this.mtimeStore.clear();
        this.trackedFolders = await this.expandFolders(this.settings.watchedFolders);
        await this.initMtimeBaseline(this.trackedFolders);
        this.warnMissingFolders();
        this.pollInterval = window.setInterval(() => this.scanFolders(), this.settings.scanIntervalMs);
        this.registerInterval(this.pollInterval);
    }

    warnMissingFolders() {
        const missing = this.settings.watchedFolders.filter((p) => this.mtimeStore.get(p) === null);
        if (missing.length > 0) {
            new Notice(`Auto Refresh: folder not found: ${missing.join(', ')}`);
        }
    }

    stopPolling() {
        if (this.pollInterval) {
            window.clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }

    /** A folder's mtime only moves for its direct children, so with
     *  includeSubfolders every subfolder is tracked on its own. */
    async expandFolders(roots) {
        if (!this.settings.includeSubfolders) return [...roots];
        const found = [];
        const queue = [...roots];
        while (queue.length) {
            const folderPath = queue.shift();
            if (found.includes(folderPath)) continue;
            found.push(folderPath);
            queue.push(...await this.listSubfolders(folderPath));
        }
        return found;
    }

    async listSubfolders(folderPath) {
        try {
            const listing = await this.app.vault.adapter.list(folderPath);
            return listing.folders.map((p) => p.replace(/\\/g, '/'))
                .filter((p) => !p.split('/').pop().startsWith('.'));
        } catch {
            return [];
        }
    }

    /** ── Polling ─────────────────────────────────────────────── */

    async scanFolders() {
        for (const folderPath of [...this.trackedFolders]) {
            try {
                const changed = await this.checkMtimeChange(folderPath);
                if (changed) {
                    log('Change detected:', folderPath);
                    await this.handleFolderChange(folderPath);
                    await this.trackNewSubfolders(folderPath);
                }
            } catch (e) {
                log('Scan error:', e.message);
            }
        }
    }

    async trackNewSubfolders(folderPath) {
        if (!this.settings.includeSubfolders) return;
        const added = (await this.expandFolders([folderPath]))
            .filter((p) => !this.trackedFolders.includes(p));
        this.trackedFolders.push(...added);
        for (const p of added) {
            await this.handleFolderChange(p);
        }
    }

    /** The folder's mtime, or null when it is missing or unreadable. */
    async folderMtime(folderPath) {
        const stat = await this.app.vault.adapter.stat(folderPath).catch(() => null);
        if (!stat) return null;
        return stat.mtime;
    }

    async initMtimeBaseline(folders) {
        for (const folderPath of folders) {
            await this.updateMtimeBaseline(folderPath);
        }
    }

    async checkMtimeChange(folderPath) {
        const current = await this.folderMtime(folderPath);
        const changed = current !== this.mtimeStore.get(folderPath);
        this.mtimeStore.set(folderPath, current);
        return changed;
    }

    async updateMtimeBaseline(folderPath) {
        this.mtimeStore.set(folderPath, await this.folderMtime(folderPath));
    }

    /** ── Core handler ──────────────────────────────────────── */

    async refreshAll() {
        this.trackedFolders = await this.expandFolders(this.settings.watchedFolders);
        for (const folderPath of this.trackedFolders) {
            await this.handleFolderChange(folderPath);
        }
        new Notice('File explorer refreshed');
    }

    async handleFolderChange(folderPath) {
        if (this.isRefreshing.get(folderPath)) return;
        this.isRefreshing.set(folderPath, true);

        try {
            const newFiles = await this.findNewFiles(folderPath);

            if (newFiles.length > 0) {
                log('Found', newFiles.length, 'new file(s) in', folderPath);
                for (const filePath of newFiles) {
                    await this.injectFile(filePath, folderPath);
                }
                this.forceFileExplorerUpdate(folderPath);
            } else {
                log('No new files in', folderPath);
            }
        } catch (e) {
            log('Handler error:', e.message);
        } finally {
            this.isRefreshing.set(folderPath, false);
            await this.updateMtimeBaseline(folderPath);
        }
    }

    /** ── File discovery ────────────────────────────────────── */

    async findNewFiles(folderPath) {
        return new Promise((resolve) => {
            const timer = setTimeout(() => resolve([]), this.listTimeoutMs);

            this._doFindNewFiles(folderPath)
                .then(files => { clearTimeout(timer); resolve(files); })
                .catch(() => { clearTimeout(timer); resolve([]); });
        });
    }

    async _doFindNewFiles(folderPath) {
        const listing = await this.app.vault.adapter.list(folderPath);
        const newFiles = [];

        for (const item of listing.files) {
            const path = item.replace(/\\/g, '/');
            const name = path.split('/').pop();

            // Only .md, skip hidden & sentinel artefacts
            if (!name.endsWith('.md') || name.startsWith('.') || name.startsWith('autorefresh')) {
                continue;
            }

            if (!this.app.vault.getAbstractFileByPath(path)) {
                newFiles.push(path);
            }
        }
        return newFiles;
    }

    /** ── Injection ─────────────────────────────────────────── */

    async injectFile(filePath, folderPath) {
        log('Injecting:', filePath);

        const parent = this.app.vault.getAbstractFileByPath(folderPath);
        if (!parent) {
            log('Parent missing:', folderPath);
            return;
        }

        try {
            const stat = await this.app.vault.adapter.stat(filePath);
            const fileStat = stat || { ctime: Date.now(), mtime: Date.now(), size: 0 };

            // 1. Build a real TFile with the correct parent
            const tFile = new TFile(this.app.vault, filePath, fileStat);
            Object.defineProperty(tFile, 'parent', { value: parent, writable: true });

            // 2. Fire vault 'create' → file explorer + metadata cache react
            this.app.vault.trigger('create', tFile);
            log('Injected:', filePath);

            // 3. Push into metadata cache
            try {
                const content = await this.app.vault.adapter.read(filePath);
                this.app.metadataCache.trigger('resolve', filePath, content, false);
            } catch { /* not yet readable */ }

            // 4. Extra metadata cache nudge
            if (typeof this.app.metadataCache.onCreate === 'function') {
                this.app.metadataCache.onCreate(tFile);
            }
        } catch (e) {
            log('Injection error:', e.message);
        }
    }

    /** ── UI refresh ────────────────────────────────────────── */

    forceFileExplorerUpdate(folderPath) {
        try {
            // Workspace-level nudge
            this.app.workspace.requestLayoutRefresh?.();
            this.app.workspace.trigger?.('layout-change');

            // Leaf-level nudge
            const leaves = this.app.workspace.getLeavesOfType('file-explorer');
            for (const leaf of leaves) {
                if (leaf.view) nudgeExplorerView(leaf.view, folderPath);
            }

            log('UI refresh for:', folderPath);
        } catch (e) {
            log('UI refresh error:', e.message);
        }
    }

    /** ── Lifecycle ─────────────────────────────────────────── */

    onunload() {
        log('Unloaded');
        this.stopPolling();
    }
}

/** ── Settings tab ─────────────────────────────────────────── */

class AutoRefreshSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        const settings = this.plugin.settings;
        containerEl.empty();

        new Setting(containerEl)
            .setName('Watched folders')
            .setDesc('One folder per line, relative to the vault root.')
            .addTextArea((text) => text
                .setPlaceholder('00 INBOX')
                .setValue(settings.watchedFolders.join('\n'))
                .onChange((value) => this.plugin.updateSettings({ watchedFolders: foldersFromText(value) })));

        new Setting(containerEl)
            .setName('Include subfolders')
            .setDesc('Also watch every folder below the watched folders.')
            .addToggle((toggle) => toggle
                .setValue(settings.includeSubfolders)
                .onChange((value) => this.plugin.updateSettings({ includeSubfolders: value })));

        new Setting(containerEl)
            .setName('Scan interval (ms)')
            .setDesc(`How often folders are checked. Minimum ${MIN_INTERVAL_MS}.`)
            .addText((text) => text
                .setValue(String(settings.scanIntervalMs))
                .onChange((value) => {
                    const ms = Number(value);
                    if (!Number.isFinite(ms) || value.trim() === '') return Promise.resolve();
                    return this.plugin.updateSettings({ scanIntervalMs: ms });
                }));
    }
}

AutoRefreshExplorerPlugin.helpers = { parseSettings, foldersFromText, DEFAULT_SETTINGS };
module.exports = AutoRefreshExplorerPlugin;
