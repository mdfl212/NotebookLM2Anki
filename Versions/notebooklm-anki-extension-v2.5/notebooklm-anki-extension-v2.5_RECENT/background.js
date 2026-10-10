// background.js - v10.0 (quiz + flashcard support, progress reporting, request timeouts)

const ANKI_URL = "http://127.0.0.1:8765";
const PARENT_DECK = "NotebookLM";
const NOTE_TYPE_QUIZ = "NotebookLM Markdown";
const NOTE_TYPE_FLASH = "NotebookLM Flashcard";
const ANKI_TIMEOUT_MS = 30000;
const BUILDER_TIMEOUT_MS = 120000;

const ANKI_HINT = "Is Anki open? A dialog box open in Anki (sync, import, add-on prompt) blocks AnkiConnect until it is closed.";

function deckFor(request) {
  const notebook = request.deckTitle || "Default Notebook";
  const suffix   = request.contentType === "flashcard" ? "_FLASHCARDS" : "_QUIZ";
  return `${PARENT_DECK}::${notebook}::${notebook}${suffix}`;
}

async function ankiRequest(action, params = {}, timeoutMs = ANKI_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(ANKI_URL, {
      method: "POST",
      body: JSON.stringify({ action, version: 6, params }),
      signal: ctrl.signal
    });
    return await res.json();
  } catch (e) {
    if (e && e.name === "AbortError") {
      throw new Error(`Anki did not respond within ${Math.round(timeoutMs / 1000)}s (${action}). ${ANKI_HINT}`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ---- quiz notes (unchanged field set) ----
function buildQuizNotes(request, targetDeck) {
  return request.batchData.map(card => ({
    deckName: targetDeck,
    modelName: NOTE_TYPE_QUIZ,
    fields: {
      Question: card.question,
      Hint: card.hint,
      ArchDiagram: "",
      Option1: card.option1, Rationale1: card.rationale1, Flag1: card.flag1,
      Option2: card.option2, Flag2: card.flag2, Rationale2: card.rationale2,
      Option3: card.option3, Flag3: card.flag3, Rationale3: card.rationale3,
      Option4: card.option4, Flag4: card.flag4, Rationale4: card.rationale4
    },
    options: {
      allowDuplicate: false,
      duplicateScope: "deck",
      duplicateScopeOptions: { deckName: targetDeck, checkChildren: false, checkAllModels: false }
    },
    tags: ["notebooklm_export"]
  }));
}

// ---- flashcard notes ----
function buildFlashNotes(request, targetDeck) {
  return request.batchData.map(card => ({
    deckName: targetDeck,
    modelName: NOTE_TYPE_FLASH,
    fields: {
      Front: card.front || "",
      Back: card.back || ""
    },
    options: {
      allowDuplicate: false,
      duplicateScope: "deck",
      duplicateScopeOptions: { deckName: targetDeck, checkChildren: false, checkAllModels: false }
    },
    tags: ["notebooklm_flashcards"]
  }));
}

// ---- ensure "NotebookLM Flashcard" note type exists in Anki ----
async function ensureFlashNoteType(progress) {
  progress(33, `Checking for "${NOTE_TYPE_FLASH}" note type…`, "info", ANKI_HINT);
  const existing = await ankiRequest("modelNames");
  if (!existing.error && Array.isArray(existing.result) && existing.result.includes(NOTE_TYPE_FLASH)) {
    progress(36, `Note type "${NOTE_TYPE_FLASH}" already exists`, "ok");
    return null; // no error
  }
  progress(35, `Creating note type "${NOTE_TYPE_FLASH}"…`, "info", ANKI_HINT);

  // We load the CSS from the extension file that the offscreen page can read.
  // In the background service worker we can fetch extension-local URLs.
  let css = "";
  try {
    const r = await fetch(chrome.runtime.getURL("anki_templates/styling.css"));
    if (r.ok) css = await r.text();
  } catch (e) { /* use empty CSS */ }

  let frontHtml = "", backHtml = "";
  try {
    const rf = await fetch(chrome.runtime.getURL("anki_templates/flashcard_front.html"));
    if (rf.ok) frontHtml = await rf.text();
    const rb = await fetch(chrome.runtime.getURL("anki_templates/flashcard_back.html"));
    if (rb.ok) backHtml = await rb.text();
  } catch (e) { /* plain fallback */ }

  if (!frontHtml) frontHtml = "{{Front}}";
  if (!backHtml)  backHtml  = "{{FrontSide}}<hr>{{Back}}";

  const created = await ankiRequest("createModel", {
    modelName: NOTE_TYPE_FLASH,
    inOrderFields: ["Front", "Back"],
    css,
    cardTemplates: [{
      Name: "Card 1",
      Front: frontHtml,
      Back: backHtml
    }]
  });
  if (created.error) return `Could not create note type "${NOTE_TYPE_FLASH}": ${created.error}`;
  progress(38, `Note type "${NOTE_TYPE_FLASH}" created`, "ok");
  return null;
}

// ---- shared AnkiConnect add loop ----
async function addNotesWithDupCheck(notes, targetDeck, progress, startPct, noteType) {
  let addable = notes, duplicates = 0, firstError = null, precheck = false;
  progress(startPct, `Checking ${notes.length} card(s) for duplicates…`, "info", ANKI_HINT);
  const check = await ankiRequest("canAddNotesWithErrorDetail", { notes });
  if (!check.error && Array.isArray(check.result)) {
    precheck = true;
    addable = [];
    check.result.forEach((r, i) => {
      if (r.canAdd) addable.push(notes[i]);
      else if (/duplicate/i.test(r.error || "")) duplicates++;
      else if (!firstError) firstError = r.error || "Unknown error";
    });
    progress(startPct + 13, `Duplicate check: ${addable.length} new, ${duplicates} already in deck`, "ok");
    if (addable.length === 0 && firstError) return { success: false, error: `Anki Error: ${firstError}` };
  } else {
    progress(startPct + 13, "Older AnkiConnect: skipping detailed duplicate check", "warn");
  }

  let added = 0;
  if (addable.length > 0) {
    progress(startPct + 23, `Adding ${addable.length} note(s) to Anki…`, "info", ANKI_HINT);
    const res = await ankiRequest("addNotes", { notes: addable }, ANKI_TIMEOUT_MS * 2);
    if (res.error) return { success: false, error: "Anki Error: " + res.error };
    const ids = res.result || [];
    added = ids.filter(id => id !== null).length;
    const rejected = addable.length - added;
    progress(startPct + 33, `Anki accepted ${added} note(s)`, "ok");
    if (!precheck && added === 0) {
      return { success: false, error: `0 cards added. They may already exist, or the '${noteType}' note type is missing/mismatched.` };
    }
    if (precheck && rejected > 0 && !firstError) firstError = `${rejected} note(s) were rejected by Anki.`;
    if (!precheck) duplicates += (addable.length - added);
  } else {
    progress(startPct + 33, "Nothing new to add", "ok");
  }
  return { success: true, count: added, duplicates, total: notes.length, warning: firstError || undefined };
}

// ---------- AnkiConnect export ----------
async function handleAnkiConnect(request, progress) {
  const targetDeck = deckFor(request);
  const isFlash = request.contentType === "flashcard";
  try {
    progress(30, "Connecting to Anki (127.0.0.1:8765)…", "info", ANKI_HINT);
    const created = await ankiRequest("createDeck", { deck: targetDeck });
    if (created.error) return { success: false, error: "Anki Error: " + created.error };
    progress(32, `Deck "${targetDeck}" ready`, "ok");

    if (isFlash) {
      const err = await ensureFlashNoteType(progress);
      if (err) return { success: false, error: err };
      const notes = buildFlashNotes(request, targetDeck);
      return await addNotesWithDupCheck(notes, targetDeck, progress, 52, NOTE_TYPE_FLASH);
    } else {
      progress(36, "Deck ready", "ok");
      const notes = buildQuizNotes(request, targetDeck);
      return await addNotesWithDupCheck(notes, targetDeck, progress, 45, NOTE_TYPE_QUIZ);
    }
  } catch (err) {
    console.error(err);
    const msg = /did not respond/.test(String(err && err.message))
      ? err.message
      : "Connection Failed: Is Anki open + AnkiConnect running? (" + (err && err.message ? err.message : err) + ")";
    return { success: false, error: msg };
  }
}

// ---------- .apkg export ----------
let creatingOffscreen = null;
async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (contexts.length > 0) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["BLOBS"],
      justification: "Build the .apkg file (SQLite + zip) and create a downloadable blob"
    }).finally(() => { creatingOffscreen = null; });
  }
  await creatingOffscreen;
}

let activeProgress = null;

async function handleApkg(request, progress) {
  activeProgress = progress;
  try {
    progress(30, "Starting the .apkg builder…");
    await ensureOffscreen();
    progress(34, "Builder ready", "ok");

    let timer;
    const timeout = new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error(`The .apkg builder did not respond within ${BUILDER_TIMEOUT_MS / 1000}s`)), BUILDER_TIMEOUT_MS);
    });
    const res = await Promise.race([
      chrome.runtime.sendMessage({
        target: "offscreen", type: "buildApkg",
        deckTitle: request.deckTitle, cards: request.batchData,
        contentType: request.contentType || "quiz"
      }),
      timeout
    ]).finally(() => clearTimeout(timer));
    if (!res || !res.ok) return { success: false, error: (res && res.error) || "Could not build the .apkg file." };

    progress(95, `Saving ${res.filename} to Downloads…`);
    await chrome.downloads.download({
      url: res.url, filename: res.filename, saveAs: false, conflictAction: "uniquify"
    });
    progress(100, "Download started", "ok");
    return { success: true, count: res.count, total: res.count, filename: res.filename };
  } catch (err) {
    console.error(err);
    return { success: false, error: ".apkg export failed: " + (err && err.message ? err.message : err) };
  } finally {
    activeProgress = null;
  }
}

// ---------- wiring ----------
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "export") return;
  port.onMessage.addListener(async (req) => {
    const progress = (pct, step, level, hint) => {
      try { port.postMessage({ type: "progress", pct, step, level: level || "info", hint: hint || "" }); } catch (e) { /* port closed */ }
    };
    let result;
    try {
      result = req.action === "exportApkg" ? await handleApkg(req, progress) : await handleAnkiConnect(req, progress);
    } catch (e) {
      result = { success: false, error: String((e && e.message) || e) };
    }
    try { port.postMessage({ type: "done", result }); } catch (e) { /* port closed */ }
  });
});

chrome.runtime.onMessage.addListener((request) => {
  if (!request || request.target === "offscreen") return;
  if (request.target === "background" && request.type === "apkgProgress") {
    if (activeProgress) activeProgress(request.pct, request.step, request.level, request.hint);
  }
});
