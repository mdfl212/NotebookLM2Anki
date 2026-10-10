# NotebookLM → Anki

DOWNLOAD:
See Releases or https://github.com/mdfl212/NotebookLM2Anki/releases/download/Current/notebooklm-anki-extension-v2.5_RECENT.zip

Convert NotebookLM quizzes and flashcard sets into Anki cards in one click.

This Chrome extension lets you export NotebookLM content into Anki via AnkiConnect or as a downloadable `.apkg` file, making it easy to turn study material into reusable review decks.

> Forked from [searchswapnil-prog/notebooklm-anki-extension](https://github.com/searchswapnil-prog/notebooklm-anki-extension)  
> fork Maintained by mdfl212

<p align="center">
  <img src="./How it looks like in notebooklm .png" alt="Exporting NotebookLM content into Anki" width="900" />
</p>

## Why this project exists

NotebookLM is excellent for study and synthesis, but learning is much easier when the output becomes review cards in Anki. This extension bridges that gap without manual copy/paste.

## Features

- One-click export from NotebookLM to Anki
- Supports both quiz exports and flashcard exports
- Auto-detects the content type in the open notebook
- Creates clean nested deck structures such as:
  `NotebookLM / <NotebookName> / <NotebookName>_QUIZ`
  and `NotebookLM / <NotebookName> / <NotebookName>_FLASHCARDS`
- Preserves math formatting with LaTeX / MathJax support
- Exports directly to AnkiConnect or as a `.apkg` package
- Includes a built-in export log for card counts and deck targets

## Quick start

1. Install AnkiConnect
2. Install the NotebookLM note type
3. Load this extension in Chrome
4. Open a NotebookLM notebook and click the extension icon
5. Export to Anki or save as `.apkg`

## Installation

You need three things: AnkiConnect, the NotebookLM note type, and the extension itself.

### 1) Install AnkiConnect

1. Open Anki
2. Go to `Tools → Add-ons → Get Add-ons…`
3. Paste `2055492159`
4. Click `OK`

<p align="center">
  <img src="./Step 1 (ankiconnect).png" alt="Install AnkiConnect" width="850" />
</p>

### 2) Install the NotebookLM note type

1. In Anki, go to `Tools → Add-ons → Get Add-ons…`
2. Paste `1282137893`
3. Click `OK`
4. Restart Anki

<p align="center">
  <img src="./Step 2 (Note type).png" alt="Install the NotebookLM note type" width="850" />
</p>

> This note type is required so the exported cards render correctly in Anki.

### 3) Load the extension in Chrome

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable `Developer Mode`
4. Click `Load Unpacked`
5. Select the repository folder
6. Pin the extension for faster access

<p align="center">
  <img src="./Step 3 (Enable Developer Option and Press Load Unpacked).png" alt="Load this extension in Chrome" width="850" />
</p>

## How to use it

1. Open a NotebookLM notebook containing a quiz or flashcard set
2. Click the extension icon in Chrome
3. Choose one of the export methods:
   - `AnkiConnect` → sends cards directly to Anki
   - `.apkg` → downloads a package for manual import
4. Review the export log to confirm how many cards were found and where they were written

<p align="center">
  <img src="./new_included Log for easier error monitoring.png" alt="Export log panel showing card counts and deck information" width="900" />
</p>

## Troubleshooting

| Issue | Fix |
|---|---|
| "Could not find quiz data" | Refresh the NotebookLM tab and try again. |
| Math shows as `$\pi$` instead of `π` | Restart Anki and confirm the note type add-on is installed. |
| Math appears with literal dollar signs in AnkiDroid | Export a fresh package; dollar-delimited inline and display math is converted to Anki-compatible `\(...\)` and `\[...\]` delimiters. |
| Deck name is incorrect after a notebook rename | This is a known issue; see [`CHANGELOG.md`](./CHANGELOG.md) for the latest status. |
| AnkiDroid reports "Dictionary mismatch", "stream did not contain valid UTF-8", a protobuf/Zstandard error, or "no such notetype" while importing an `.apkg` | Reload the updated extension, export a fresh package, and import that new file; the exporter now uses Anki's legacy schema-v11 package format to avoid newer package metadata and note-type schema incompatibilities. |
| Quiz cards look different or answer choices are not tappable on AnkiDroid | Reload the updated extension, export a fresh package, and import that new file; the `.apkg` includes its own templates modeled after the desktop note type add-on. |
| Extension button does nothing | Make sure you're on a NotebookLM notebook page, not the homepage. |

## Project status

This project is designed for fast, low-friction conversion of NotebookLM content into Anki decks for study, revision, and spaced repetition workflows.

## Credits

- Original project: [searchswapnil-prog/notebooklm-anki-extension](https://github.com/searchswapnil-prog/notebooklm-anki-extension)
- Fork maintained by: [[YOUR_HANDLE]]
- Built with AI-assisted development

See [`CHANGELOG.md`](./CHANGELOG.md) for release notes and version history.
