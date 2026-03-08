# Aliases Check

An [Obsidian](https://obsidian.md) plugin that detects conflicts between note filenames and aliases, helping you find and resolve duplicate notes in your vault.

## Features

- Scans all markdown files for filename and alias conflicts (case-insensitive)
- Groups conflicting notes using Union-Find for accurate transitive detection
- Displays results in a sidebar view with conflict details
- One-click "Compare" to open conflicting files in split panes
- Clickable file links to navigate directly to each note

## Installation

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release
2. Create a folder `aliases-check` inside your vault's `.obsidian/plugins/` directory
3. Copy the downloaded files into that folder
4. Open Obsidian Settings > Community Plugins and enable **Aliases Check**

## Usage

- **Ribbon icon**: Click the search icon in the left sidebar to run the check
- **Command palette**: Open the command palette (`Ctrl/Cmd + P`) and search for "Check duplicate aliases"

Results appear in a right sidebar panel. Each conflict group shows the shared names and the affected files. Click **Compare** to open files side by side for review.

## Development

```bash
git clone https://github.com/pennn778/obsidian-aliases-check.git
cd obsidian-aliases-check
npm install
npm run build
```

For development with auto-rebuild on changes:

```bash
npm run dev
```
