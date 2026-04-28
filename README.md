# Auto Refresh Explorer

An [Obsidian](https://obsidian.md) plugin that automatically refreshes the file explorer when new files arrive from external sync tools (Syncthing, Dropbox, rsync, etc.).

## Why this plugin?

Obsidian's built-in file watcher sometimes fails to detect files created by external sync tools, especially on Windows. You close a note on your phone, it syncs via Syncthing, but the file doesn't appear in Obsidian's sidebar until you manually reload the vault.

This plugin detects those changes in **~3 seconds** and injects the new files directly into Obsidian's index — no reload needed.

## How it works

1. **Polls watched folders** (`00 INBOX`, `01 PROJET`, `02 CAPS` by default) every 3 seconds using low-cost `adapter.stat()` calls
2. **Detects changes** — when a folder's modification time changes, something new arrived
3. **Finds missing files** — compares disk contents with Obsidian's internal index
4. **Injects TFile objects** — creates proper `TFile` instances with correct parent folders and fires `vault.trigger('create')` so the file explorer and metadata cache pick them up instantly

## Installation

### Manual (BRAT or folder)

1. Download `main.js` and `manifest.json`
2. Copy them to `.obsidian/plugins/auto-refresh-explorer/` inside your vault
3. Enable **Auto Refresh Explorer** in Settings → Community Plugins

### From Obsidian Community Plugins (soon)

Once approved, search "Auto Refresh Explorer" in Settings → Community Plugins → Browse.

## Configuration

No settings UI yet. To change watched folders or interval, edit the constants at the top of `main.js`:

```js
const DEFAULT_WATCHED_FOLDERS = ['00 INBOX', '01 PROJET', '02 CAPS'];
const DEFAULT_INTERVAL_MS = 3000;
```

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
