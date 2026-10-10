// background.js - v9.4 (progress reporting + request timeouts)
//
// Exports run over a long-lived port named "export". The content script sends one request
// ({action, batchData, deckTitle}) and receives {type:"progress", pct, step, level, hint}
// messages followed by one {type:"done", result}.

const ANKI_URL = "http://127.0.0.1:8765";
const PARENT_DECK = "NotebookLM";
const NOTE_TYPE = "NotebookLM Markdown";
const ANKI_TIMEOUT_MS = 30000;
const BUILDER_TIMEOUT_MS = 120000;

const ANKI_HINT = "Is Anki open? A dialog box open in Anki (sync, import, add-on prompt) blocks AnkiConnect until it is closed.";

function deckFor(request) {
  return `${PARENT_DECK}::${request.deckTitle || "Default Notebook"}`;
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
    return await res.json(); // { result, error }
  } catch (e) {
    if (e && e.name === "AbortError") {
      throw new Error(`Anki did not respond within ${Math.round(timeoutMs / 1000)}s (${action}). ${ANKI_HINT}`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function buildNotes(request, targetDeck) {
  return request.batchData.map(card => ({
    deckName: targetDeck,
    modelName: NOTE_TYPE,
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
      allowDuplicate: false,            // skip cards already in this deck
      duplicateScope: "deck",
      duplicateScopeOptions: { deckName: targetDeck, checkChildren: false, checkAllModels: false }
    },
    tags: ["notebooklm_export"]
  }));
}

// ---------- AnkiConnect export ----------
async function handleAnkiConnect(request, progress) {
  const targetDeck = deckFor(request);
  try {
    progress(30, "Connecting to Anki (127.0.0.1:8765)…", "info", ANKI_HINT);
    progress(36, `Creating deck "${targetDeck}"…`, "info", ANKI_HINT);
    const created = await ankiRequest("createDeck", { deck: targetDeck });
    if (created.error) {
      return { success: false, error: "Anki Error: " + created.error };
    }
    progress(45, "Connected to Anki, deck ready", "ok");

    const notes = buildNotes(request, targetDeck);
    let addable = notes;
    let duplicates = 0;
    let firstError = null;
    let precheck = false;

    // Pre-check so "duplicate" can be told apart from a real failure (missing note type, bad field...).
    progress(52, `Checking ${notes.length} cards for duplicates…`, "info", ANKI_HINT);
    const check = await ankiRequest("canAddNotesWithErrorDetail", { notes });
    if (!check.error && Array.isArray(check.result)) {
      precheck = true;
      addable = [];
      check.result.forEach((r, i) => {
        if (r.canAdd) addable.push(notes[i]);
        else if (/duplicate/i.test(r.error || "")) duplicates++;
        else if (!firstError) firstError = r.error || "Unknown error";
      });
      progress(65, `Duplicate check: ${addable.length} new, ${duplicates} already in the deck`, "ok");
      if (addable.length === 0 && firstError) {
        return { success: false, error: "Anki Error: " + firstError };
      }
    } else {
      progress(65, "Older AnkiConnect: skipping detailed duplicate check", "warn");
    }

    let added = 0;
    if (addable.length > 0) {
      progress(75, `Adding ${addable.length} notes to Anki…`, "info", ANKI_HINT);
      const res = await ankiRequest("addNotes", { notes: addable }, ANKI_TIMEOUT_MS * 2);
      if (res.error) {
        return { success: false, error: "Anki Error: " + res.error };
      }
      const ids = res.result || [];
      added = ids.filter(id => id !== null).length;
      const rejected = addable.length - added;
      progress(95, `Anki accepted ${added} notes`, "ok");
      if (!precheck) {
        // Older AnkiConnect without the detailed pre-check: a null is a duplicate OR a rejected note.
        if (added === 0) {
          const msg = `0 cards added. They may already exist, or the '${NOTE_TYPE}' note type is missing/mismatched.`;
          return { success: false, error: msg };
        }
        duplicates += rejected;
      } else if (rejected > 0 && !firstError) {
        firstError = `${rejected} note(s) were rejected by Anki.`;
      }
    } else {
      progress(95, "Nothing new to add", "ok");
    }

    return { success: true, count: added, duplicates, total: notes.length, warning: firstError || undefined };
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

let activeProgress = null; // receives per-step updates from the offscreen page

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
      chrome.runtime.sendMessage({ target: "offscreen", type: "buildApkg", deckTitle: request.deckTitle, cards: request.batchData }),
      timeout
    ]).finally(() => clearTimeout(timer));
    if (!res || !res.ok) return { success: false, error: (res && res.error) || "Could not build the .apkg file." };

    progress(95, `Saving ${res.filename} to Downloads…`);
    await chrome.downloads.download({
      url: res.url,
      filename: res.filename,
      saveAs: false,
      conflictAction: "uniquify"
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
  if (!request || request.target === "offscreen") return; // addressed to the offscreen page
  if (request.target === "background" && request.type === "apkgProgress") {
    if (activeProgress) activeProgress(request.pct, request.step, request.level, request.hint);
  }
});
