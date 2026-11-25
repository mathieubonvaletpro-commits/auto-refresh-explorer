'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin, makeApp, fakeObsidian } = require('./fake-obsidian');

async function start(app) {
    const Plugin = loadPlugin();
    const p = new Plugin(app);
    await p.onload();
    await p.ready;
    return p;
}
const after = (ms) => new Promise((r) => setTimeout(r, ms));
function stop(p) { p.onunload(); }

test('a file synced into a configured folder is injected', async () => {
    const disk = { report: { mtime: 1, files: ['old.md'] } };
    const app = makeApp({ disk, indexed: ['report/old.md'], savedData: { watchedFolders: ['report'] } });
    const p = await start(app);
    disk.report.files.push('new.md');
    disk.report.mtime = 2;
    await p.scanFolders();
    stop(p);
    assert.deepEqual(app.created, ['report/new.md']);
});

test('the 1.0.0 default folders are ignored once the user sets their own', async () => {
    const disk = { '00 INBOX': { mtime: 1, files: [] }, notes: { mtime: 1, files: [] } };
    const app = makeApp({ disk, savedData: { watchedFolders: ['notes'] } });
    const p = await start(app);
    disk['00 INBOX'].files.push('x.md'); disk['00 INBOX'].mtime = 2;
    disk.notes.files.push('y.md'); disk.notes.mtime = 2;
    await p.scanFolders();
    stop(p);
    assert.deepEqual(app.created, ['notes/y.md']);
});

test('subfolders are scanned only when includeSubfolders is on', async () => {
    for (const includeSubfolders of [false, true]) {
        const disk = { notes: { mtime: 1, files: [] }, 'notes/suivi': { mtime: 1, files: [] } };
        const app = makeApp({ disk, savedData: { watchedFolders: ['notes'], includeSubfolders } });
        const p = await start(app);
        disk['notes/suivi'].files.push('t.md'); disk['notes/suivi'].mtime = 2;
        await p.scanFolders();
        stop(p);
        assert.deepEqual(app.created, includeSubfolders ? ['notes/suivi/t.md'] : []);
    }
});

test('the refresh command also walks subfolders', async () => {
    const disk = { notes: { mtime: 1, files: ['a.md'] }, 'notes/suivi': { mtime: 1, files: ['b.md'] } };
    const app = makeApp({ disk, savedData: { watchedFolders: ['notes'], includeSubfolders: true } });
    const p = await start(app);
    await p.command.callback();
    stop(p);
    assert.deepEqual(app.created.sort(), ['notes/a.md', 'notes/suivi/b.md']);
});

test('nothing happens when the folder did not change', async () => {
    const disk = { notes: { mtime: 1, files: ['a.md'] } };
    const app = makeApp({ disk, savedData: { watchedFolders: ['notes'] } });
    const p = await start(app);
    await p.scanFolders();
    stop(p);
    assert.deepEqual(app.created, []);
});

test('saving new settings restarts the poller on the new folders', async () => {
    const disk = { a: { mtime: 1, files: [] }, b: { mtime: 1, files: [] } };
    const app = makeApp({ disk, savedData: { watchedFolders: ['a'], scanIntervalMs: 1000 } });
    const p = await start(app);
    const firstTimer = p.pollInterval;
    await p.updateSettings({ watchedFolders: ['b'] });
    assert.notEqual(p.pollInterval, firstTimer);
    assert.deepEqual(app.savedData.watchedFolders, ['b']);
    disk.b.files.push('n.md'); disk.b.mtime = 2;
    await p.scanFolders();
    stop(p);
    assert.deepEqual(app.created, ['b/n.md']);
});

test('the poller really fires on its interval', async () => {
    const disk = { a: { mtime: 1, files: [] } };
    const app = makeApp({ disk, savedData: { watchedFolders: ['a'], scanIntervalMs: 1000 } });
    const p = await start(app);
    disk.a.files.push('n.md'); disk.a.mtime = 2;
    await after(1300);
    stop(p);
    assert.deepEqual(app.created, ['a/n.md']);
});

test('the settings tab edits and saves each setting', async () => {
    const disk = { a: { mtime: 1, files: [] } };
    const app = makeApp({ disk });
    const p = await start(app);
    const tab = p.settingTab;
    assert.ok(tab instanceof fakeObsidian.PluginSettingTab);
    tab.display();
    const controls = tab.containerEl.children.filter((c) => c.controls).flatMap((c) => c.controls);
    const byKind = Object.fromEntries(controls.map((c) => [c.kind, c]));
    assert.equal(byKind.textarea.value, '00 INBOX\n01 PROJET\n02 CAPS');
    await byKind.textarea.change('notes\nreport/');
    await byKind.text.change('4000');
    await byKind.toggle.change(true);
    await byKind.text.change('soon');
    stop(p);
    assert.deepEqual(app.savedData, { watchedFolders: ['notes', 'report'], scanIntervalMs: 4000, includeSubfolders: true });
});

test('a subfolder created after start is picked up with its files', async () => {
    const disk = { notes: { mtime: 1, files: [] } };
    const app = makeApp({ disk, savedData: { watchedFolders: ['notes'], includeSubfolders: true } });
    const p = await start(app);
    disk['notes/new'] = { mtime: 1, files: ['x.md'] };
    disk.notes.mtime += 1;
    app.vault.trigger('create', new fakeObsidian.TFolder('notes/new'));
    app.created.length = 0;
    await p.scanFolders();
    disk['notes/new'].files.push('y.md');
    disk['notes/new'].mtime += 1;
    await p.scanFolders();
    p.onunload();
    assert.deepEqual(app.created, ['notes/new/x.md', 'notes/new/y.md']);
});

test('a missing watched folder is reported, not silently ignored', async () => {
    fakeObsidian.Notice.shown.length = 0;
    const disk = { notes: { mtime: 1, files: [] } };
    const app = makeApp({ disk, savedData: { watchedFolders: ['notes', '00 INBOX'] } });
    const p = await start(app);
    p.onunload();
    assert.ok(fakeObsidian.Notice.shown.includes('Auto Refresh: folder not found: 00 INBOX'));
});

test('a watched folder created later starts being watched', async () => {
    const disk = {};
    const app = makeApp({ disk, savedData: { watchedFolders: ['notes'] } });
    const p = await start(app);
    disk.notes = { mtime: 5, files: ['a.md'] };
    app.vault.trigger('create', new fakeObsidian.TFolder('notes'));
    app.created.length = 0;
    await p.scanFolders();
    p.onunload();
    assert.deepEqual(app.created, ['notes/a.md']);
});

test('no warning when every watched folder exists', async () => {
    fakeObsidian.Notice.shown.length = 0;
    const disk = { notes: { mtime: 1, files: [] }, report: { mtime: 1, files: [] } };
    const app = makeApp({ disk, savedData: { watchedFolders: ['notes', 'report/'] } });
    const p = await start(app);
    p.onunload();
    assert.deepEqual(fakeObsidian.Notice.shown, ['Auto Refresh: active']);
});
