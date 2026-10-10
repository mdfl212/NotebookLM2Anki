// content.js - v11.0 (AnkiConnect + .apkg export, quiz + flashcard support, live progress panel)

(function () {
  if (window.__nlmAnkiLoaded) return;
  window.__nlmAnkiLoaded = true;

  const IS_TOP = window.top === window;

  const CONFIG = {
    ANKI_BTN_ID: "notebooklm-to-anki-btn",
    APKG_BTN_ID: "notebooklm-to-apkg-btn",
    STALL_WARN_MS: 8000,
    IDLE_TIMEOUT_MS: 30000,
    MAX_LOG_LINES: 300,
    ANCHOR_SELECTORS: [
      'button[aria-label="Good content rating"]',
      'button[aria-label="Copy"]',
      'button[aria-label="Download"]'
    ]
  };

  const BUTTONS = {
    anki: { id: CONFIG.ANKI_BTN_ID, label: "Anki Export" },
    apkg: { id: CONFIG.APKG_BTN_ID, label: "Export .apkg" }
  };

  // ================================================================ DATA MINER
  function say(pct, step, level, hint) {
    window.top.postMessage({ action: "ANKI_PROGRESS", pct, step, level: level || "info", hint: hint || "" }, "*");
  }
  function failTop(mode, error) {
    window.top.postMessage({ action: "ANKI_REAL_FAIL", mode, error }, "*");
  }

  function initDataMiner() {
    const appRoot = document.querySelector("[data-app-data]");
    if (!appRoot) return;
    console.log("[Anki Bridge] ⛏️ Miner Ready");
    window.top.postMessage({ action: "ANKI_MINER_READY" }, "*");
    window.addEventListener("message", (event) => {
      if (!event.data || event.data.action !== "ANKI_TRIGGER_EXTRACT") return;
      processBatch(appRoot.getAttribute("data-app-data"), event.data.notebookTitle, event.data.mode);
    });
  }

  function unescapeHtml(str) {
    if (!str) return "";
    return str.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'");
  }

  // ---- quiz card builder (unchanged) ----
  function buildQuizCards(quizData) {
    return quizData.map(q => {
      const o = q.answerOptions || [];
      const card = { question: q.question, hint: q.hint || "", type: "quiz" };
      for (let i = 0; i < 4; i++) {
        card["option" + (i + 1)] = (o[i] && o[i].text) || "";
        card["flag" + (i + 1)] = o[i] && o[i].isCorrect ? "True" : "False";
        card["rationale" + (i + 1)] = (o[i] && o[i].rationale) || "";
      }
      return card;
    });
  }

  // ---- flashcard parser ----
  // NotebookLM flashcard objects use several possible key shapes; we try them all.
  function extractFlashText(item, frontKeys, backKeys) {
    let front = "", back = "";
    for (const k of frontKeys) { if (item[k] != null && String(item[k]).trim()) { front = String(item[k]).trim(); break; } }
    for (const k of backKeys)  { if (item[k] != null && String(item[k]).trim()) { back  = String(item[k]).trim(); break; } }
    return (front || back) ? { front, back } : null;
  }

  const FRONT_KEYS = ["f", "front", "question", "q", "term", "Front", "Question"];
  const BACK_KEYS  = ["b", "back",  "answer",   "a", "definition", "Back", "Answer"];

  function buildFlashCards(flashData) {
    const cards = [];
    const unknownKeys = new Set();
    for (const item of flashData) {
      const pair = extractFlashText(item, FRONT_KEYS, BACK_KEYS);
      if (pair) {
        cards.push({ ...pair, type: "flashcard" });
      } else {
        Object.keys(item).forEach(k => unknownKeys.add(k));
      }
    }
    return { cards, unknownKeys: [...unknownKeys] };
  }

  function processBatch(jsonString, customNotebookTitle, mode) {
    mode = mode === "apkg" ? "apkg" : "anki";
    try {
      say(5, "Reading quiz data from the page…");
      say(10, "Parsing quiz JSON…");
      const data = JSON.parse(unescapeHtml(jsonString));

      // ---- detect content type ----
      const quizData  = data.quiz        || (data.mostRecentQuery && data.mostRecentQuery.quiz);
      const flashData = data.flashcards  || (data.mostRecentQuery && data.mostRecentQuery.flashcards)
                      || data.flash_cards || (data.mostRecentQuery && data.mostRecentQuery.flash_cards);

      let cards = null;
      let contentType = null;

      if (quizData && Array.isArray(quizData) && quizData.length > 0) {
        say(15, `Found ${quizData.length} quiz questions`, "ok");
        cards = buildQuizCards(quizData);
        contentType = "quiz";
      } else if (flashData && Array.isArray(flashData) && flashData.length > 0) {
        say(15, `Found ${flashData.length} flashcard(s) — parsing…`, "ok");
        const { cards: fc, unknownKeys } = buildFlashCards(flashData);
        if (fc.length === 0) {
          const keyList = unknownKeys.length ? " (keys found: " + unknownKeys.join(", ") + ")" : "";
          failTop(mode, "Flashcards were found but none could be parsed. Please Copy log and report it." + keyList);
          return;
        }
        if (unknownKeys.length) {
          say(16, `Parsed ${fc.length} of ${flashData.length} cards (${flashData.length - fc.length} skipped — unexpected key shape)`, "warn");
        } else {
          say(16, `Parsed ${fc.length} flashcard(s)`, "ok");
        }
        cards = fc;
        contentType = "flashcard";
      } else {
        failTop(mode, "0 questions or flashcards found. Open a quiz or flashcard set and wait for it to finish loading, then try again.");
        return;
      }

      let finalTitle = customNotebookTitle;
      if (!finalTitle || finalTitle === "NotebookLM") finalTitle = data.title;
      if (!finalTitle) finalTitle = "Unknown Notebook";
      finalTitle = finalTitle.replace(/::/g, " - ").trim();
      say(18, `Notebook: ${finalTitle}`);

      say(22, `Building ${contentType === "flashcard" ? "flashcard" : "quiz"} cards…`);
      say(25, `Built ${cards.length} card(s)`, "ok");

      sendToBackground(mode, cards, finalTitle, contentType);
    } catch (e) {
      console.error(e);
      failTop(mode, "JSON Parse Error: " + e.message);
    }
  }

  function sendToBackground(mode, cards, deckTitle, contentType) {
    let port;
    try {
      port = chrome.runtime.connect({ name: "export" });
    } catch (e) {
      failTop(mode, "The extension was reloaded or updated. Refresh this NotebookLM page and try again.");
      return;
    }
    let finished = false;
    say(28, "Sending cards to the extension…");

    port.onMessage.addListener((msg) => {
      if (!msg) return;
      if (msg.type === "progress") {
        say(msg.pct, msg.step, msg.level, msg.hint);
      } else if (msg.type === "done") {
        finished = true;
        const res = msg.result || {};
        if (res.success) {
          window.top.postMessage({
            action: "ANKI_REAL_SUCCESS", mode,
            count: res.count, duplicates: res.duplicates || 0, total: res.total || cards.length,
            deck: deckTitle, filename: res.filename, warning: res.warning, contentType
          }, "*");
        } else {
          failTop(mode, res.error || "Unknown Error");
        }
        try { port.disconnect(); } catch (e) { /* already closed */ }
      }
    });
    port.onDisconnect.addListener(() => {
      if (finished) return;
      const why = chrome.runtime.lastError ? chrome.runtime.lastError.message : "the background worker stopped";
      failTop(mode, `Lost connection to the extension (${why}). Try again; if it keeps happening, reload the extension.`);
    });

    port.postMessage({
      action: mode === "apkg" ? "exportApkg" : "sendBatchToAnki",
      batchData: cards,
      deckTitle,
      contentType
    });
  }

  // ================================================================ PROGRESS PANEL
  const Panel = (function () {
    let host = null, shadow = null, E = {}, S = null, ticker = null, persistTimer = null, onTimeout = null;

    const CSS = `
      :host { all: initial; }
      .panel { position: fixed; right: 16px; bottom: 16px; width: 360px; max-width: calc(100vw - 32px);
        background: #1f1f1f; color: #e3e3e3; border: 1px solid #444746; border-radius: 12px;
        box-shadow: 0 8px 28px rgba(0,0,0,.55); font: 12px/1.45 'Roboto','Segoe UI',sans-serif; z-index: 2147483647; overflow: hidden; }
      .head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #333; }
      .title { font-weight: 600; font-size: 13px; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .timer { color: #9aa0a6; font-variant-numeric: tabular-nums; }
      .x { background: none; border: none; color: #9aa0a6; font-size: 18px; line-height: 1; cursor: pointer; padding: 0 2px; }
      .x:hover { color: #fff; }
      .bar { height: 6px; background: #333; margin: 10px 12px 6px; border-radius: 3px; overflow: hidden; }
      .fill { height: 100%; width: 0%; background: #a8c7fa; border-radius: 3px; transition: width .25s ease; }
      .fill.running { animation: pulse 1.2s ease-in-out infinite; }
      .fill.ok { background: #6dd58c; } .fill.error { background: #ffb4ab; }
      @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .6; } }
      .status { padding: 0 12px 8px; color: #e3e3e3; min-height: 17px; word-break: break-word; }
      .status.warn { color: #e6b455; } .status.ok { color: #6dd58c; } .status.error { color: #ffb4ab; }
      .log { max-height: 170px; overflow-y: auto; padding: 6px 12px; background: #181818; border-top: 1px solid #333;
        font: 11px/1.5 Consolas, Monaco, monospace; }
      .line { white-space: pre-wrap; word-break: break-word; }
      .line .t { color: #7d838a; margin-right: 6px; }
      .line.ok { color: #6dd58c; } .line.warn { color: #e6b455; } .line.error { color: #ffb4ab; } .line.info { color: #c4c7c5; }
      .foot { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-top: 1px solid #333; }
      .copy { background: #2d2d2d; color: #a8c7fa; border: 1px solid #444746; border-radius: 14px; padding: 4px 12px; cursor: pointer; font-size: 11px; }
      .copy:hover { background: #383838; }
      .pct { color: #9aa0a6; font-variant-numeric: tabular-nums; }
    `;

    function q(sel) { return shadow.querySelector(sel); }

    function ensure() {
      if (host && host.isConnected) return;
      host = document.createElement("div");
      host.id = "nlm-anki-progress";
      shadow = host.attachShadow({ mode: "open" });
      shadow.innerHTML = `<style>${CSS}</style>
        <div class="panel">
          <div class="head"><span class="title"></span><span class="timer"></span><button class="x" title="Hide">×</button></div>
          <div class="bar"><div class="fill"></div></div>
          <div class="status"></div>
          <div class="log"></div>
          <div class="foot"><button class="copy">Copy log</button><span class="pct"></span></div>
        </div>`;
      document.body.appendChild(host);
      E = { title: q(".title"), timer: q(".timer"), x: q(".x"), fill: q(".fill"), status: q(".status"), log: q(".log"), copy: q(".copy"), pct: q(".pct") };
      E.x.onclick = () => { if (host) { host.remove(); host = null; } };
      E.copy.onclick = copyLog;
      renderAll();
    }

    function fmtT(t) { return "+" + t.toFixed(1) + "s"; }
    const ICON = { ok: "✓", warn: "⚠", error: "✗", info: "•" };

    function lineEl(l) {
      const d = document.createElement("div");
      d.className = "line " + l.level;
      const t = document.createElement("span"); t.className = "t"; t.textContent = fmtT(l.t);
      d.appendChild(t); d.appendChild(document.createTextNode(ICON[l.level] + " " + l.text));
      return d;
    }

    function renderAll() {
      if (!S || !host) return;
      const typeLabel = S.contentType === "flashcard" ? "Flashcard" : "Quiz";
      E.title.textContent = (S.mode === "apkg" ? ".apkg" : "Anki") + " " + typeLabel + " Export — " + S.deck;
      E.log.innerHTML = "";
      S.lines.forEach(l => E.log.appendChild(lineEl(l)));
      E.log.scrollTop = E.log.scrollHeight;
      renderBar();
    }

    function renderBar() {
      if (!S || !host) return;
      E.fill.style.width = Math.max(2, Math.min(100, S.pct)) + "%";
      E.fill.className = "fill " + (S.running ? "running" : S.ok ? "ok" : "error");
      E.pct.textContent = Math.round(S.pct) + "%";
      E.timer.textContent = elapsed().toFixed(1) + "s";
    }

    function setStatus(text, cls) {
      if (!host) return;
      E.status.textContent = text;
      E.status.className = "status " + (cls || "");
    }

    function elapsed() { return ((S.endedAt || Date.now()) - S.startedAt) / 1000; }

    function addLine(level, text) {
      if (!S) return;
      const last = S.lines[S.lines.length - 1];
      const l = { t: (Date.now() - S.startedAt) / 1000, level, text };
      const replace = last && /^Adding card \d+ of \d+$/.test(text) && /^Adding card \d+ of \d+$/.test(last.text);
      if (replace) {
        S.lines[S.lines.length - 1] = l;
        if (host) { E.log.replaceChild(lineEl(l), E.log.lastChild); }
      } else {
        S.lines.push(l);
        if (S.lines.length > CONFIG.MAX_LOG_LINES) { S.lines.shift(); if (host && E.log.firstChild) E.log.removeChild(E.log.firstChild); }
        if (host) E.log.appendChild(lineEl(l));
      }
      if (host) E.log.scrollTop = E.log.scrollHeight;
      persist(false);
    }

    function snapshot() {
      return { running: S.running, ok: S.ok, mode: S.mode, deck: S.deck, contentType: S.contentType,
        startedAt: S.startedAt, updatedAt: Date.now(), pct: S.pct, summary: S.summary, lines: S.lines };
    }

    function persist(now) {
      if (!S) return;
      const write = () => {
        persistTimer = null;
        try { chrome.storage.local.set({ lastExport: snapshot() }); } catch (e) { /* extension context gone */ }
      };
      if (now) { if (persistTimer) clearTimeout(persistTimer); write(); }
      else if (!persistTimer) persistTimer = setTimeout(write, 700);
    }

    function copyLog() {
      if (!S) return;
      const head = `NotebookLM → Anki (${S.mode} ${S.contentType || ""}) — ${S.deck}\n`;
      const body = S.lines.map(l => `${fmtT(l.t)} ${ICON[l.level]} ${l.text}`).join("\n");
      const done = () => { E.copy.textContent = "Copied!"; setTimeout(() => { if (E.copy) E.copy.textContent = "Copy log"; }, 1500); };
      try { navigator.clipboard.writeText(head + body).then(done, () => { E.copy.textContent = "Copy failed"; }); }
      catch (e) { E.copy.textContent = "Copy failed"; }
    }

    function tick() {
      if (!S || !S.running) return;
      const now = Date.now();
      const idle = now - S.lastEventAt;
      if (host) E.timer.textContent = elapsed().toFixed(1) + "s";
      if (idle > CONFIG.STALL_WARN_MS) {
        const secs = Math.round(idle / 1000);
        setStatus(`Still working: ${S.lastStep} (${secs}s since last update)`, "warn");
        if (now - S.lastWarnAt >= CONFIG.STALL_WARN_MS) {
          S.lastWarnAt = now;
          addLine("warn", `Still working on "${S.lastStep}" — ${secs}s since last update.` + (S.lastHint ? " " + S.lastHint : ""));
        }
      }
      if (idle > CONFIG.IDLE_TIMEOUT_MS && onTimeout) onTimeout(Math.round(idle / 1000), S.lastStep);
    }

    return {
      isRunning() { return !!(S && S.running); },
      mode() { return S ? S.mode : null; },
      setTimeoutHandler(fn) { onTimeout = fn; },
      start(mode, deck, contentType) {
        if (ticker) clearInterval(ticker);
        S = { mode, deck, contentType: contentType || "quiz", startedAt: Date.now(), endedAt: 0,
          lastEventAt: Date.now(), lastStep: "Starting…", lastHint: "", lastWarnAt: 0,
          pct: 0, running: true, ok: null, summary: "", lines: [] };
        ensure(); renderAll();
        setStatus("Starting…");
        addLine("info", `Export started (${mode === "apkg" ? ".apkg file" : "Anki via AnkiConnect"})`);
        ticker = setInterval(tick, 500);
        persist(true);
      },
      setContentType(ct) { if (S) { S.contentType = ct; renderAll(); } },
      progress(d) {
        if (!S || !S.running) return;
        ensure();
        S.lastEventAt = Date.now(); S.lastWarnAt = 0;
        S.lastStep = d.step; S.lastHint = d.hint || "";
        S.pct = Math.max(S.pct, Number(d.pct) || 0);
        setStatus(d.step, d.level === "warn" ? "warn" : "");
        addLine(d.level || "info", d.step);
        renderBar();
        return S.pct;
      },
      note(level, text) { if (S) addLine(level, text); },
      finish(ok, summary) {
        if (!S) return;
        if (ticker) { clearInterval(ticker); ticker = null; }
        S.running = false; S.ok = ok; S.summary = summary; S.endedAt = Date.now();
        if (ok) S.pct = 100;
        ensure();
        addLine(ok ? "ok" : "error", `${summary} (${elapsed().toFixed(1)}s)`);
        setStatus(summary, ok ? "ok" : "error");
        renderBar();
        persist(true);
      }
    };
  })();

  // ================================================================ UI INJECTOR
  let isMinerConnected = false;

  function successText(d) {
    if (d.mode === "apkg") return `Saved ${d.total} to file!`;
    if (d.count === 0 && d.duplicates > 0) return `All ${d.duplicates} already in Anki`;
    return d.duplicates > 0 ? `Saved ${d.count}, skipped ${d.duplicates} dup` : `Saved ${d.count}!`;
  }

  function summaryText(d) {
    const typeLabel = d.contentType === "flashcard" ? "flashcard" : "card";
    if (d.mode === "apkg") return `Saved "${d.filename || ".apkg"}" with ${d.total} ${typeLabel}s to your Downloads folder. In Anki: File → Import.`;
    if (d.count === 0 && d.duplicates > 0) return `Nothing new: all ${d.duplicates} ${typeLabel}s already exist in the deck.`;
    const suffix = d.contentType === "flashcard" ? "_FLASHCARDS" : "_QUIZ";
    return `Added ${d.count} ${typeLabel}s` + (d.duplicates > 0 ? `, skipped ${d.duplicates} duplicates` : "") + ` to "NotebookLM::${d.deck}::${d.deck}${suffix}".`;
  }

  function initUiInjector() {
    window.addEventListener("message", (event) => {
      const d = event.data;
      if (!d || typeof d.action !== "string") return;
      if (d.action === "ANKI_MINER_READY") {
        isMinerConnected = true;
        updateButtonState("anki", "ready");
        updateButtonState("apkg", "ready");
      } else if (d.action === "ANKI_PROGRESS") {
        const pct = Panel.progress(d);
        if (pct != null && Panel.mode()) setBusyLabel(Panel.mode(), pct);
      } else if (d.action === "ANKI_REAL_SUCCESS") {
        if (d.contentType) Panel.setContentType(d.contentType);
        if (d.warning) Panel.note("warn", d.warning);
        Panel.finish(true, summaryText(d));
        updateButtonState(d.mode, "success", successText(d));
      } else if (d.action === "ANKI_REAL_FAIL") {
        Panel.finish(false, d.error);
        updateButtonState(d.mode, "error");
      }
    });

    Panel.setTimeoutHandler((secs, step) => {
      const mode = Panel.mode();
      Panel.finish(false, `No progress for ${secs}s during "${step}". The export may still finish in the background — check Anki or your Downloads folder, or refresh the page and try again.`);
      updateButtonState(mode, "error");
    });

    const tryInject = () => {
      if (document.getElementById(CONFIG.ANKI_BTN_ID) && document.getElementById(CONFIG.APKG_BTN_ID)) return;
      let anchorBtn = null;
      for (const selector of CONFIG.ANCHOR_SELECTORS) {
        const found = document.querySelector(selector);
        if (found) { anchorBtn = found; break; }
      }
      if (!anchorBtn) return;
      const container = anchorBtn.closest("div.flex") || anchorBtn.parentElement;
      if (!container) return;
      if (!document.getElementById(CONFIG.APKG_BTN_ID)) container.insertBefore(createButton("apkg"), container.firstChild);
      if (!document.getElementById(CONFIG.ANKI_BTN_ID)) container.insertBefore(createButton("anki"), container.firstChild);
    };
    tryInject();
    new MutationObserver(tryInject).observe(document.body, { childList: true, subtree: true });
  }

  function getNotebookTitle() {
    const input = document.querySelector('input[placeholder="Notebook title"]');
    if (input && input.value) return input.value.trim();
    const label = document.querySelector(".title-label");
    if (label && label.textContent) return label.textContent.trim();
    if (document.title && document.title.includes("- NotebookLM")) return document.title.replace("- NotebookLM", "").trim();
    return null;
  }

  const ICONS = {
    anki: `<svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18" fill="currentColor"><path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/></svg>`,
    apkg: `<svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z"/></svg>`
  };

  function createButton(mode) {
    const cfg = BUTTONS[mode];
    const btn = document.createElement("button");
    btn.id = cfg.id;
    btn.className = "mdc-button mat-mdc-button mat-mdc-outlined-button mat-unthemed mat-mdc-button-base";
    btn.style.cssText = "border: 1px solid rgb(55, 56, 59); border-radius: 18px; padding: 0 20px; margin-right: 10px; color: #e3e3e3; height: 40px; display: inline-flex; align-items: center; justify-content: center; cursor: not-allowed; opacity: 0.5;";
    btn.innerHTML = `<span class="mat-mdc-button-persistent-ripple mdc-button__ripple"></span><span class="mat-mdc-button-touch-target"></span><span class="mdc-button__label" style="display: flex; align-items: center; gap: 8px;">${ICONS[mode]}<span>${cfg.label}</span></span>`;
    btn.disabled = true;
    btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onExportClick(mode); };
    if (isMinerConnected) setTimeout(() => updateButtonState(mode, "ready"), 0);
    return btn;
  }

  function onExportClick(mode) {
    if (Panel.isRunning()) return;
    let deckName = getNotebookTitle();
    if (!deckName) {
      deckName = prompt("Enter Notebook Name:");
      if (!deckName) return;
    }
    Panel.start(mode, deckName, "quiz"); // will be corrected by setContentType when content type is known
    setBusyLabel(mode, 0);

    if (!isMinerConnected) {
      Panel.finish(false, "The page hasn't finished loading yet. Wait a moment and try again.");
      updateButtonState(mode, "error");
      return;
    }
    Panel.progress({
      pct: 2, step: "Looking for content on this page…", level: "info",
      hint: "No data frame has answered yet. Is the quiz or flashcard set open and fully loaded?"
    });
    const trigger = { action: "ANKI_TRIGGER_EXTRACT", notebookTitle: deckName, mode };
    document.querySelectorAll("iframe").forEach(iframe => {
      try { iframe.contentWindow.postMessage(trigger, "*"); } catch (e) { /* inaccessible frame */ }
    });
    window.postMessage(trigger, "*");
  }

  function labelEl(btn) { return btn.querySelector(".mdc-button__label span:last-child"); }

  function setBusyLabel(mode, pct) {
    const btn = document.getElementById(BUTTONS[mode].id);
    if (!btn) return;
    const l = labelEl(btn);
    if (l) l.textContent = `Exporting ${Math.round(pct)}%`;
    btn.style.borderColor = "#a8c7fa"; btn.style.color = "#a8c7fa";
  }

  function updateButtonState(mode, state, text) {
    if (!BUTTONS[mode]) return;
    const btn = document.getElementById(BUTTONS[mode].id);
    if (!btn) return;
    const l = labelEl(btn);
    if (state === "ready") {
      if (l) l.textContent = BUTTONS[mode].label;
      btn.style.opacity = "1"; btn.style.cursor = "pointer";
      btn.style.borderColor = "rgb(55, 56, 59)"; btn.style.color = "#e3e3e3";
      btn.disabled = false;
    } else if (state === "success") {
      if (l) l.textContent = text || "Saved!";
      btn.style.borderColor = "#6dd58c"; btn.style.color = "#6dd58c";
      setTimeout(() => updateButtonState(mode, "ready"), 3500);
    } else if (state === "error") {
      if (l) l.textContent = "Error";
      btn.style.borderColor = "#ffb4ab"; btn.style.color = "#ffb4ab";
      setTimeout(() => updateButtonState(mode, "ready"), 3000);
    }
  }

  initDataMiner();
  if (IS_TOP) initUiInjector();
})();
