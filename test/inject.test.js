'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin, makeApp } = require('./fake-obsidian');

async function start(app) {
    const Plugin = loadPlugin();
    const p = new Plugin(app);
    await p.onload();
    await p.ready;
    return p;
}

function syncNewFile(disk, folder, name) {
    disk[folder].files.push(name);
    disk[folder].mtime += 1;
}

test('the injected file has its folder as parent and its disk stat', async () => {
    const disk = { notes: { mtime: 1, files: [] } };
    const app = makeApp({ disk, savedData: { watchedFolders: ['notes'] } });
    app.vault.adapter.stat = async (p) => (disk[p] ? { mtime: disk[p].mtime } : { mtime: 7, size: 3 });
    const p = await start(app);
    syncNewFile(disk, 'notes', 'a.md');
    await p.scanFolders();
    p.onunload();
    const f = app.vault.getAbstractFileByPath('notes/a.md');
    assert.equal(f.parent, app.vault.getAbstractFileByPath('notes'));
    assert.deepEqual(f.stat, { mtime: 7, size: 3 });
});

test('the metadata cache gets the file and its content', async () => {
    const disk = { notes: { mtime: 1, files: [] } };
    const app = makeApp({ disk, savedData: { watchedFolders: ['notes'] } });
    const resolved = [];
    const onCreated = [];
    app.vault.adapter.read = async (p) => `body of ${p}`;
    app.metadataCache = { trigger: (ev, ...a) => resolved.push([ev, ...a]), onCreate: (f) => onCreated.push(f.path) };
    const p = await start(app);
    syncNewFile(disk, 'notes', 'a.md');
    await p.scanFolders();
    p.onunload();
    assert.deepEqual(resolved, [['resolve', 'notes/a.md', 'body of notes/a.md', false]]);
    assert.deepEqual(onCreated, ['notes/a.md']);
});

test('an unreadable file is still shown', async () => {
    const disk = { notes: { mtime: 1, files: [] } };
    const app = makeApp({ disk, savedData: { watchedFolders: ['notes'] } });
    app.vault.adapter.read = async () => { throw new Error('EBUSY'); };
    const p = await start(app);
    syncNewFile(disk, 'notes', 'a.md');
    await p.scanFolders();
    p.onunload();
    assert.deepEqual(app.created, ['notes/a.md']);
});

test('hidden, non-markdown and already indexed files are skipped', async () => {
    const disk = { notes: { mtime: 1, files: [] } };
    const app = makeApp({ disk, indexed: ['notes/known.md'], savedData: { watchedFolders: ['notes'] } });
    const p = await start(app);
    for (const n of ['.hidden.md', 'scan.pdf', 'autorefresh-x.md', 'known.md', 'new.md']) disk.notes.files.push(n);
    disk.notes.mtime += 1;
    await p.scanFolders();
    p.onunload();
    assert.deepEqual(app.created, ['notes/new.md']);
});

test('a folder Obsidian does not know yet gets no orphan file', async () => {
    const disk = { notes: { mtime: 1, files: [] } };
    const app = makeApp({ disk, savedData: { watchedFolders: ['notes'] } });
    const realGet = app.vault.getAbstractFileByPath;
    app.vault.getAbstractFileByPath = (p) => (p === 'notes' ? null : realGet(p));
    const p = await start(app);
    syncNewFile(disk, 'notes', 'a.md');
    await p.scanFolders();
    p.onunload();
    assert.deepEqual(app.created, []);
});

test('a failing listing does not stop the scan of the next folder', async () => {
    const disk = { a: { mtime: 1, files: [] }, b: { mtime: 1, files: [] } };
    const app = makeApp({ disk, savedData: { watchedFolders: ['a', 'b'] } });
    const realList = app.vault.adapter.list;
    app.vault.adapter.list = async (p) => { if (p === 'a') throw new Error('EIO'); return realList(p); };
    const p = await start(app);
    syncNewFile(disk, 'a', 'x.md');
    syncNewFile(disk, 'b', 'y.md');
    await p.scanFolders();
    p.onunload();
    assert.deepEqual(app.created, ['b/y.md']);
});

test('the file explorer views are asked to redraw the folder', async () => {
    const disk = { notes: { mtime: 1, files: [] } };
    const app = makeApp({ disk, savedData: { watchedFolders: ['notes'] } });
    const calls = [];
    const view = {
        requestUpdate: () => calls.push('requestUpdate'),
        update: () => calls.push('update'),
        fileItems: { notes: { update: () => calls.push('folderItem') } },
    };
    app.workspace.getLeavesOfType = (t) => (t === 'file-explorer' ? [{ view }, { view: null }] : []);
    app.workspace.requestLayoutRefresh = () => calls.push('layoutRefresh');
    app.workspace.trigger = (ev) => calls.push(ev);
    const p = await start(app);
    syncNewFile(disk, 'notes', 'a.md');
    await p.scanFolders();
    p.onunload();
    assert.deepEqual(calls, ['layoutRefresh', 'layout-change', 'requestUpdate', 'update', 'folderItem']);
});

test('a broken explorer view does not lose the injected file', async () => {
    const disk = { notes: { mtime: 1, files: [] } };
    const app = makeApp({ disk, savedData: { watchedFolders: ['notes'] } });
    app.workspace.getLeavesOfType = () => { throw new Error('no explorer'); };
    const p = await start(app);
    syncNewFile(disk, 'notes', 'a.md');
    await p.scanFolders();
    p.onunload();
    assert.deepEqual(app.created, ['notes/a.md']);
});

test('an explorer view without the optional hooks does not block the next one', async () => {
    const disk = { notes: { mtime: 1, files: [] } };
    const app = makeApp({ disk, savedData: { watchedFolders: ['notes'] } });
    const calls = [];
    const full = { requestUpdate: () => calls.push('r'), update: () => calls.push('u'),
        fileItems: { notes: { update: () => calls.push('f') } } };
    app.workspace.getLeavesOfType = () => [{ view: {} }, { view: { fileItems: {} } }, { view: full }];
    const p = await start(app);
    syncNewFile(disk, 'notes', 'a.md');
    await p.scanFolders();
    p.onunload();
    assert.deepEqual(calls, ['r', 'u', 'f']);
});

test('the explorer is not redrawn when nothing new was found', async () => {
    const disk = { notes: { mtime: 1, files: ['known.md'] } };
    const app = makeApp({ disk, indexed: ['notes/known.md'], savedData: { watchedFolders: ['notes'] } });
    let redraws = 0;
    app.workspace.getLeavesOfType = () => { redraws += 1; return []; };
    const p = await start(app);
    disk.notes.mtime += 1;
    await p.scanFolders();
    p.onunload();
    assert.equal(redraws, 0);
});

test('a file whose stat is not ready yet gets an empty stat', async () => {
    const disk = { notes: { mtime: 1, files: [] } };
    const app = makeApp({ disk, savedData: { watchedFolders: ['notes'] } });
    const p = await start(app);
    syncNewFile(disk, 'notes', 'a.md');
    await p.scanFolders();
    p.onunload();
    assert.equal(app.vault.getAbstractFileByPath('notes/a.md').stat.size, 0);
});

test('Obsidian can still move an injected file to another folder', async () => {
    const disk = { notes: { mtime: 1, files: [] }, other: { mtime: 1, files: [] } };
    const app = makeApp({ disk, savedData: { watchedFolders: ['notes'] } });
    const p = await start(app);
    syncNewFile(disk, 'notes', 'a.md');
    await p.scanFolders();
    p.onunload();
    const f = app.vault.getAbstractFileByPath('notes/a.md');
    f.parent = app.vault.getAbstractFileByPath('other');
    assert.equal(f.parent.path, 'other');
});

test('two overlapping refreshes of one folder inject a file once', async () => {
    const disk = { notes: { mtime: 1, files: ['a.md'] } };
    const app = makeApp({ disk, savedData: { watchedFolders: ['notes'] } });
    const p = await start(app);
    await Promise.all([p.handleFolderChange('notes'), p.handleFolderChange('notes')]);
    p.onunload();
    assert.deepEqual(app.created, ['notes/a.md']);
});

test('a folder is handled again on its next change', async () => {
    const disk = { notes: { mtime: 1, files: [] } };
    const app = makeApp({ disk, savedData: { watchedFolders: ['notes'] } });
    const p = await start(app);
    syncNewFile(disk, 'notes', 'a.md');
    await p.scanFolders();
    syncNewFile(disk, 'notes', 'b.md');
    await p.scanFolders();
    p.onunload();
    assert.deepEqual(app.created, ['notes/a.md', 'notes/b.md']);
});

test('a folder item without a redraw hook does not block the next view', async () => {
    const disk = { notes: { mtime: 1, files: [] } };
    const app = makeApp({ disk, savedData: { watchedFolders: ['notes'] } });
    const calls = [];
    const full = { fileItems: { notes: { update: () => calls.push('f') } } };
    app.workspace.getLeavesOfType = () => [{ view: { fileItems: { notes: {} } } }, { view: full }];
    const p = await start(app);
    syncNewFile(disk, 'notes', 'a.md');
    await p.scanFolders();
    p.onunload();
    assert.deepEqual(calls, ['f']);
});

test('an attachment is injected without being parsed as text', async () => {
    const disk = { report: { mtime: 1, files: [] } };
    const app = makeApp({ disk, savedData: { watchedFolders: ['report'], includeAttachments: true } });
    const read = [];
    const resolved = [];
    app.vault.adapter.read = async (p) => { read.push(p); return 'x'; };
    app.metadataCache = { trigger: (ev, ...a) => resolved.push([ev, ...a]) };
    const p = await start(app);
    syncNewFile(disk, 'report', 'cr.pdf');
    await p.scanFolders();
    p.onunload();
    assert.deepEqual(app.created, ['report/cr.pdf']);
    assert.deepEqual(read, []);
    assert.deepEqual(resolved, []);
});
