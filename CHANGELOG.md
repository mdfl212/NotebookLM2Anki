# Changelog

All notable changes to this project are documented below.

## [v2.5] - 2026-10-10

### Fixed
- Fixed the stale deck-name issue after renaming a NotebookLM notebook.
- Fixed AnkiDroid `.apkg` import errors by correcting the `collection.anki21b` Zstandard frame header, splitting payloads into valid-size blocks, and removing ZIP header rewriting that corrupted the archive and its UTF-8 filename flags.
- Root cause: the export logic was reading the notebook title from the wrong execution context (offscreen iframe instead of the active NotebookLM page), allowing the old embedded JSON title to override the live page title.
- Updated title resolution priority to:
  1. DOM selectors
  2. click-time title
  3. embedded JSON title

### Added
- Added a permanent diagnostic export log:
  `[Anki Bridge] document.title at export: "..."`
- This makes it easy to validate the exact title used for deck naming and exported filenames without rebuilding the extension.

### Documentation
- Improved the README installation flow and clarified the two required Anki add-ons.
- Added stronger feature descriptions, a usage walkthrough, and a troubleshooting section.
- Added clearer project attribution and AI-assisted development notes.

### Known issues
- Deck-name propagation may still be inconsistent in some edge cases until the live-title fix is fully validated.

### Compatibility
- Supports both `notebook.google.com` / "Gemini Notebook" and the older `notebooklm.google.com` host.
- Manifest compatibility remains aligned with both hosts.

## [v2.4] - 2026-10-10

### Added
- Added a 3-level deck hierarchy by default:
  `NotebookLM / NotebookName / NotebookName_QUIZ`
  `NotebookLM / NotebookName / NotebookName_FLASHCARDS`
- Separated quiz and flashcard sets from the same notebook into distinct child decks.
- Added `.apkg` filename suffixes for content type.
- Improved export logging to show the full deck path on completion.
- Ensured the intermediate notebook deck is registered correctly so Anki imports the full tree without orphaned parent decks.

## [v2.3] - 2026-10-10

### Added
- Added support for exporting flashcard sets.
- Auto-detects whether the current notebook contains a quiz or a flashcard set.
- Added support for common flashcard key variants such as `front/back`, `question/answer`, `term/definition`, and `f/b`.
- Added a new Anki note type: `NotebookLM Flashcard`.
- Improved `.apkg` export formatting and card rendering.
- Export logs now clearly state whether the extension found flashcards or quiz questions.

## [v2.2] - 2026-10-10

### Added
- Added a progress bar and live export log panel.
- Added progress tracking across extraction, card generation, export assembly, and download.
- Replaced the idle status with contextual pipeline updates.
- Added popup diagnostics to inspect tab and frame state.

## [v2.1 and earlier] - upstream

### Added
- Initial AnkiConnect export support for quiz sets.
- Initial `.apkg` export support for quiz sets.
- NotebookLM scraping via offscreen iframe + content script.
- Flat deck naming format: `NotebookLM::<NotebookName>`
- Original `NotebookLM Markdown` note type with LaTeX / MathJax support.

### Credit
- Original implementation by [searchswapnil-prog](https://github.com/searchswapnil-prog/notebooklm-anki-extension)
