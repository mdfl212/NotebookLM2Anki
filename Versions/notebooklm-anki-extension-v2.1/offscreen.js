// offscreen.js - builds the .apkg (needs WASM + Blob APIs that a service worker can't host)

let sqlPromise = null;
function getSQL() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({ locateFile: f => chrome.runtime.getURL("lib/" + f) });
  }
  return sqlPromise;
}

function safeName(title) {
  const t = String(title || "Notebook").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);
  return "NotebookLM - " + (t || "Notebook") + ".apkg";
}

async function readTemplate(path) {
  const r = await fetch(chrome.runtime.getURL(path));
  if (!r.ok) throw new Error("Could not load " + path);
  return r.text();
}

async function buildApkg(msg) {
  const [front, back, css] = await Promise.all([
    readTemplate("anki_templates/front.html"),
    readTemplate("anki_templates/back.html"),
    readTemplate("anki_templates/styling.css")
  ]);
  const SQL = await getSQL();
  const bytes = await ApkgBuilder.build({
    SQL, JSZip, deckTitle: msg.deckTitle, cards: msg.cards, templates: { front, back, css }
  });
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
  return { ok: true, url, filename: safeName(msg.deckTitle), count: msg.cards.length };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== "offscreen" || msg.type !== "buildApkg") return;
  buildApkg(msg)
    .then(sendResponse)
    .catch(e => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true;
});
