'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin } = require('./fake-obsidian');

const { parseSettings, foldersFromText, DEFAULT_SETTINGS } = loadPlugin().helpers;

test('no saved data gives the 1.0.0 behaviour', () => {
    assert.deepEqual(parseSettings(undefined), DEFAULT_SETTINGS);
    assert.deepEqual(DEFAULT_SETTINGS.watchedFolders, ['00 INBOX', '01 PROJET', '02 CAPS']);
    assert.equal(DEFAULT_SETTINGS.scanIntervalMs, 3000);
    assert.equal(DEFAULT_SETTINGS.includeSubfolders, false);
});

test('saved values are kept', () => {
    const s = parseSettings({ watchedFolders: ['notes', 'report'], scanIntervalMs: 5000, includeSubfolders: true });
    assert.deepEqual(s, { watchedFolders: ['notes', 'report'], scanIntervalMs: 5000, includeSubfolders: true, includeAttachments: false });
});

test('bad values fall back to defaults one by one', () => {
    const s = parseSettings({ watchedFolders: 'notes', scanIntervalMs: 'fast', includeSubfolders: 'yes' });
    assert.deepEqual(s, DEFAULT_SETTINGS);
});

test('interval is clamped to at least one second', () => {
    assert.equal(parseSettings({ scanIntervalMs: 10 }).scanIntervalMs, 1000);
    assert.equal(parseSettings({ scanIntervalMs: 2500.7 }).scanIntervalMs, 2500);
});

test('folder list is cleaned: slashes, blanks, duplicates, non-strings', () => {
    const s = parseSettings({ watchedFolders: [' /notes/ ', '', 'notes', 'a\\b', 42, 'report'] });
    assert.deepEqual(s.watchedFolders, ['notes', 'a/b', 'report']);
});

test('an emptied folder list stays empty (nothing watched)', () => {
    assert.deepEqual(parseSettings({ watchedFolders: [] }).watchedFolders, []);
});

test('the settings text area is one folder per line', () => {
    assert.deepEqual(foldersFromText('notes\r\n\n report/ \nnotes\n'), ['notes', 'report']);
});

test('non-finite intervals and non-object data fall back to defaults', () => {
    assert.equal(parseSettings({ scanIntervalMs: NaN }).scanIntervalMs, 3000);
    assert.equal(parseSettings({ scanIntervalMs: Infinity }).scanIntervalMs, 3000);
    assert.deepEqual(parseSettings(null), DEFAULT_SETTINGS);
    assert.deepEqual(parseSettings('notes'), DEFAULT_SETTINGS);
});

test('attachments are off unless asked for', () => {
    assert.equal(DEFAULT_SETTINGS.includeAttachments, false);
    assert.equal(parseSettings({}).includeAttachments, false);
    assert.equal(parseSettings({ includeAttachments: true }).includeAttachments, true);
    assert.equal(parseSettings({ includeAttachments: 'yes' }).includeAttachments, false);
});

test('the attachment toggle saves', async () => {
    const { makeApp } = require('./fake-obsidian');
    const app = makeApp({ disk: { a: { mtime: 1, files: [] } } });
    const Plugin = loadPlugin();
    const p = new Plugin(app);
    await p.onload();
    await p.ready;
    p.settingTab.display();
    const controls = p.settingTab.containerEl.children.filter((c) => c.controls).flatMap((c) => c.controls);
    const toggle = controls[2];
    assert.equal(toggle.kind, 'toggle');
    assert.equal(toggle.value, false);
    await toggle.change(true);
    p.onunload();
    assert.equal(app.savedData.includeAttachments, true);
});

test('temp files from sync tools are recognised on their own', () => {
    const { isTempFile } = loadPlugin().helpers;
    for (const name of ['~$cr.docx', '.syncthing.a.tmp', 'cr.pdf.part', 'cr.pdf.tmp', 'x.crdownload', 'backup~']) {
        assert.equal(isTempFile(name), true, name);
    }
    for (const name of ['cr.pdf', 'cr.md', 'shot~draft.png']) assert.equal(isTempFile(name), false, name);
});

test('what is indexable depends on the option and on the extension', () => {
    const { isIndexable } = loadPlugin().helpers;
    assert.equal(isIndexable('cr.md', false), true);
    assert.equal(isIndexable('cr.pdf', false), false);
    assert.equal(isIndexable('cr.pdf', true), true);
    assert.equal(isIndexable('CR.PDF', true), true);
    assert.equal(isIndexable('notes.zip', true), false);
    assert.equal(isIndexable('no-extension', true), false);
    assert.equal(isIndexable('.hidden.pdf', true), false);
    assert.equal(isIndexable('autorefresh-state.md', true), false);
});
