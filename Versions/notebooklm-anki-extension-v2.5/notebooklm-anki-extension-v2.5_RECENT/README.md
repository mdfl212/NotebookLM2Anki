# NotebookLM → Anki Extension — v2.3

Exports **quizzes** and **flashcards** from NotebookLM to Anki, either via AnkiConnect or as a downloadable `.apkg` file.

## What's new in v2.3

- **Flashcard support.** Notebooks with flashcards now export as "NotebookLM Flashcard" notes (two fields: Front / Back), tagged `notebooklm_flashcards`. The extension auto-detects content type — you click the same buttons either way.
- **AnkiConnect path** creates the "NotebookLM Flashcard" note type in Anki automatically on first use — no manual setup needed.
- **.apkg path** embeds the flashcard note type with its styled templates so it works with File → Import as-is.
- **Log clarity.** The panel header and copy log now name the content type (Quiz / Flashcard), and success messages use the right word.
- Flashcard key shapes handled: `f`/`b`, `front`/`back`, `question`/`answer`, `term`/`definition`, and their title-cased variants. If none match, the log lists the keys it found so you can report it.

## Content types

| NotebookLM content | Note type | Tag |
|--------------------|-----------|-----|
| Multiple-choice quiz | NotebookLM Markdown | notebooklm\_export |
| Flashcard set | NotebookLM Flashcard | notebooklm\_flashcards |

## Setup

### AnkiConnect export
1. Install [AnkiConnect](https://ankiweb.net/shared/info/2055492159) in Anki.
2. Anki must be open while exporting.

### .apkg export
No Anki connection needed. File → Import the downloaded file in Anki.

## Usage
1. Open a notebook in NotebookLM and open its quiz or flashcard set.
2. Wait for the content to fully load.
3. Click **Anki Export** or **Export .apkg** — the extension detects quiz or flashcard content automatically.
4. Watch the progress panel at the bottom-right. If something stalls, click **Copy log** and send it for debugging.

## Progress panel
- **Progress bar + elapsed timer** — visible the whole time.
- **Timestamped step log** — each major step is logged; "Adding card x of N" updates in place instead of flooding the log.
- **Stall warnings** — after ~8 s with no update, the panel names what it's waiting for.
- **Idle timeout** — gives up after 30 s with no progress at all.
- **Copy log** button stays available after the export finishes.

## Troubleshooting
| Symptom | Likely cause |
|---------|-------------|
| "0 questions or flashcards found" | Content hasn't loaded yet — wait and try again |
| "Flashcards were found but none could be parsed" | Unexpected key shape — Copy log and report |
| Anki Export hangs | Anki has a dialog open (sync, prompt) — close it |
| "Connection Failed" | Anki is closed or AnkiConnect isn't installed |
