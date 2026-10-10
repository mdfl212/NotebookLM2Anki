// background.js - v9.3 (AnkiConnect with real duplicate detection + .apkg export)

const ANKI_URL = "http://127.0.0.1:8765";
const PARENT_DECK = "NotebookLM";
const NOTE_TYPE = "NotebookLM Markdown";

function deckFor(request) {
  return `${PARENT_DECK}::${request.deckTitle || "Default Notebook"}`;
}

async function ankiRequest(action, params = {}) {
  const res = await fetch(ANKI_URL, {
    method: "POST",
    body: JSON.stringify({ action, version: 6, params })
  });
  return res.json(); // { result, error }
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
async function handleAnkiConnect(request) {
  const targetDeck = deckFor(request);
  try {
    const created = await ankiRequest("createDeck", { deck: targetDeck });
    if (created.error) return { success: false, error: "Anki Error: " + created.error };

    const notes = buildNotes(request, targetDeck);
    let addable = notes;
    let duplicates = 0;
    let firstError = null;
    let precheck = false;

    // Pre-check so "duplicate" can be told apart from a real failure (missing note type, bad field...).
    const check = await ankiRequest("canAddNotesWithErrorDetail", { notes });
    if (!check.error && Array.isArray(check.result)) {
      precheck = true;
      addable = [];
      check.result.forEach((r, i) => {
        if (r.canAdd) addable.push(notes[i]);
        else if (/duplicate/i.test(r.error || "")) duplicates++;
        else if (!firstError) firstError = r.error || "Unknown error";
      });
      if (addable.length === 0 && firstError) {
        return { success: false, error: "Anki Error: " + firstError };
      }
    }

    let added = 0;
    if (addable.length > 0) {
      const res = await ankiRequest("addNotes", { notes: addable });
      if (res.error) return { success: false, error: "Anki Error: " + res.error };
      const ids = res.result || [];
      added = ids.filter(id => id !== null).length;
      const rejected = addable.length - added;
      if (!precheck) {
        // Older AnkiConnect without the detailed pre-check: a null is a duplicate OR a rejected note.
        if (added === 0) {
          return { success: false, error: `0 cards added. They may already exist, or the '${NOTE_TYPE}' note type is missing/mismatched.` };
        }
        duplicates += rejected;
      } else if (rejected > 0 && !firstError) {
        firstError = `${rejected} note(s) were rejected by Anki.`;
      }
    }

    return {
      success: true,
      count: added,
      duplicates,
      total: notes.length,
      warning: firstError || undefined
    };
  } catch (err) {
    console.error(err);
    return { success: false, error: "Connection Failed: Is Anki open + AnkiConnect running?" };
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

async function handleApkg(request) {
  try {
    await ensureOffscreen();
    const res = await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "buildApkg",
      deckTitle: request.deckTitle,
      cards: request.batchData
    });
    if (!res || !res.ok) return { success: false, error: (res && res.error) || "Could not build the .apkg file." };

    await chrome.downloads.download({
      url: res.url,
      filename: res.filename,
      saveAs: false,
      conflictAction: "uniquify"
    });
    return { success: true, count: res.count, total: res.count, filename: res.filename };
  } catch (err) {
    console.error(err);
    return { success: false, error: ".apkg export failed: " + (err && err.message ? err.message : err) };
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || request.target === "offscreen") return; // addressed to the offscreen page
  if (request.action === "sendBatchToAnki") {
    handleAnkiConnect(request).then(sendResponse);
    return true;
  }
  if (request.action === "exportApkg") {
    handleApkg(request).then(sendResponse);
    return true;
  }
});
