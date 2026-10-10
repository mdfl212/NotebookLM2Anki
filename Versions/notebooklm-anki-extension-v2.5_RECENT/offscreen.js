// offscreen.js - builds the .apkg (needs WASM + Blob APIs that a service worker can't host)

let sqlPromise = null;
function getSQL() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({ locateFile: f => chrome.runtime.getURL("lib/" + f) });
  }
  return sqlPromise;
}

let lastSent = 0;
function report(pct, step, level, hint, force) {
  const now = Date.now();
  if (!force && now - lastSent < 80) return;
  lastSent = now;
  chrome.runtime.sendMessage({ target: "background", type: "apkgProgress", pct, step, level: level || "info", hint })
    .catch(() => {});
}

function safeName(title, contentType) {
  const t = String(title || "Notebook").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);
  const suffix = contentType === "flashcard" ? "_FLASHCARDS" : "_QUIZ";
  return (t || "Notebook") + suffix + ".apkg";
}

async function readTemplate(path) {
  const r = await fetch(chrome.runtime.getURL(path));
  if (!r.ok) throw new Error("Could not load " + path);
  return r.text();
}

async function buildApkg(msg) {
  const isFlash = msg.contentType === "flashcard";

  report(36, "Loading card templates…", "info", "", true);

  let templates;
  if (isFlash) {
    const [front, back, css] = await Promise.all([
      readTemplate("anki_templates/flashcard_front.html"),
      readTemplate("anki_templates/flashcard_back.html"),
      readTemplate("anki_templates/styling.css")
    ]);
    templates = { front, back, css, type: "flashcard" };
  } else {
    const [front, back, css] = await Promise.all([
      readTemplate("anki_templates/front.html"),
      readTemplate("anki_templates/back.html"),
      readTemplate("anki_templates/styling.css")
    ]);
    templates = { front, back, css, type: "quiz" };
  }

  const firstLoad = !sqlPromise;
  report(42, firstLoad ? "Loading SQLite engine… (first export is slower)" : "SQLite engine already loaded", "info",
    "Loading the ~650 KB SQLite engine; this can take a few seconds the first time.", true);
  const SQL = await getSQL();
  report(52, "SQLite engine ready", "ok", "", true);

  const bytes = await ApkgBuilder.build({
    SQL, JSZip, deckTitle: msg.deckTitle, cards: msg.cards, templates,
    onProgress: (frac, label) => report(55 + 30 * frac, label, "info", "", !/^Adding card/.test(label) || frac >= 1)
  });

  report(90, `Package built (${Math.max(1, Math.round(bytes.length / 1024))} KB)`, "ok", "", true);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
  return { ok: true, url, filename: safeName(msg.deckTitle, msg.contentType), count: msg.cards.length };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== "offscreen" || msg.type !== "buildApkg") return;
  buildApkg(msg)
    .then(sendResponse)
    .catch(e => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true;
});
