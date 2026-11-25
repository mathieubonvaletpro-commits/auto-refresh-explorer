# Auto Refresh Explorer

An [Obsidian](https://obsidian.md) plugin that automatically refreshes the file explorer when new files arrive from external sync tools (Syncthing, Dropbox, rsync, etc.).

## Why this plugin?

Obsidian's built-in file watcher sometimes fails to detect files created by external sync tools, especially on Windows. You close a note on your phone, it syncs via Syncthing, but the file doesn't appear in Obsidian's sidebar until you manually reload the vault.

This plugin detects those changes in **~3 seconds** and injects the new files directly into Obsidian's index — no reload needed.

## How it works

1. **Polls the watched folders** every 3 seconds (configurable) using low-cost `adapter.stat()` calls
2. **Detects changes** — when a folder's modification time changes, something new arrived
3. **Finds missing files** — compares disk contents with Obsidian's internal index
4. **Injects TFile objects** — creates proper `TFile` instances with correct parent folders and fires `vault.trigger('create')` so the file explorer and metadata cache pick them up instantly

A folder's mtime only moves when one of its direct children changes, so with **Include subfolders** on, every subfolder is polled on its own and folded in as it appears.

## Installation

### Manual (BRAT or folder)

1. Download `main.js` and `manifest.json`
2. Copy them to `.obsidian/plugins/auto-refresh-explorer/` inside your vault
3. Enable **Auto Refresh Explorer** in Settings → Community Plugins

### From Obsidian Community Plugins (soon)

Once approved, search "Auto Refresh Explorer" in Settings → Community Plugins → Browse.

## Configuration

Settings → Community Plugins → Auto Refresh Explorer:

- **Watched folders** — one folder per line, relative to the vault root. Defaults to `00 INBOX`, `01 PROJET`, `02 CAPS`.
- **Include subfolders** — also watch every folder below the watched ones (off by default).
- **Include attachments** — also add the files Obsidian can open besides notes: PDF, Canvas, images, audio and video (off by default). Partial files left by sync tools and other extensions are never added.
- **Scan interval (ms)** — how often the folders are checked. Minimum 1000, default 3000.

Settings are stored in `.obsidian/plugins/auto-refresh-explorer/data.json` and the poller restarts as soon as one changes. A watched folder that does not exist is reported once with a notice, so a typo does not fail silently.

Also available as the command **Refresh file explorer now** (reloads the whole list without waiting for a change).

Notes are indexed in the metadata cache when they are added; attachments are only handed to the file explorer, since they are not text. With **Include attachments** off, only Markdown notes are added.

## Compatibility

- **Desktop**: Windows, macOS, Linux
- **Mobile**: Android, iOS (via manual install or BRAT)
- **Obsidian**: v0.15.0+

Works with any sync tool that writes files directly to the filesystem: Syncthing, Dropbox, Google Drive, OneDrive, rsync, etc.

## Performance

- **Zero impact on vault loading** — plugin initialises after layout is ready
- **O(1) detection** — only checks folder mtimes, never lists full directory contents
- **1-second timeout** on file listing to prevent freezes on large vaults
- **Debounced** — won't refresh the same folder twice simultaneously

## Support

Made with ❤️ by **Mathieu BONVALET**.

If this plugin saves you time:

☕ [Buy Me a Coffee](https://buymeacoffee.com/mathieu.bonvalet)

Or just star the repo and tell your friends.

## License

MIT
