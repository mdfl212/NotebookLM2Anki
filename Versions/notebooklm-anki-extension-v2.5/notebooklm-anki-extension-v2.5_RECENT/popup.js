// popup.js - shows the log of the most recent export (written by the progress panel in content.js)

const $ = id => document.getElementById(id);
const ICON = { ok: "✓", warn: "⚠", error: "✗", info: "•" };
let current = null;

function fmtT(t) { return "+" + Number(t).toFixed(1) + "s"; }

function render(s) {
  current = s || null;
  const log = $("log"), status = $("status"), fill = $("fill");
  log.innerHTML = "";
  if (!s) {
    status.className = "empty";
    status.textContent = "No export yet. Open a NotebookLM quiz and click “Anki Export” or “Export .apkg”.";
    fill.style.width = "0%"; fill.className = "fill"; $("timer").textContent = "";
    return;
  }
  (s.lines || []).forEach(l => {
    const d = document.createElement("div");
    d.className = "line " + l.level;
    const t = document.createElement("span"); t.className = "t"; t.textContent = fmtT(l.t);
    d.appendChild(t); d.appendChild(document.createTextNode((ICON[l.level] || "•") + " " + l.text));
    log.appendChild(d);
  });
  log.scrollTop = log.scrollHeight;

  fill.style.width = Math.max(2, Math.min(100, s.pct || 0)) + "%";
  fill.className = "fill " + (s.running ? "" : s.ok ? "ok" : "error");

  const what = (s.mode === "apkg" ? ".apkg export" : "Anki export") + " — " + s.deck;
  if (s.running) {
    const stale = Math.round((Date.now() - s.updatedAt) / 1000);
    status.className = stale > 40 ? "warn" : "";
    status.textContent = stale > 40
      ? `${what}: no update for ${stale}s — it may have stalled. Check the NotebookLM tab.`
      : `${what}: running… ${Math.round(s.pct || 0)}%`;
    $("timer").textContent = "";
  } else {
    status.className = s.ok ? "ok" : "error";
    status.textContent = `${what}: ${s.summary || (s.ok ? "done" : "failed")}`;
    const secs = Math.max(0, ((s.updatedAt || 0) - (s.startedAt || 0)) / 1000);
    $("timer").textContent = secs.toFixed(1) + "s";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get("lastExport", r => render(r && r.lastExport));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.lastExport) render(changes.lastExport.newValue);
  });

  $("copy").onclick = () => {
    if (!current) return;
    const head = `NotebookLM → Anki (${current.mode}) — ${current.deck}\n`;
    const body = (current.lines || []).map(l => `${fmtT(l.t)} ${ICON[l.level] || "•"} ${l.text}`).join("\n");
    navigator.clipboard.writeText(head + body).then(() => {
      $("copy").textContent = "Copied!"; setTimeout(() => { $("copy").textContent = "Copy log"; }, 1500);
    });
  };
  $("clear").onclick = () => chrome.storage.local.remove("lastExport", () => render(null));
});
