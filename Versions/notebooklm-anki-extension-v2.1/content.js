// content.js - v9.0 (AnkiConnect export + .apkg export)

(function () {
  // popup.js re-injects this file; don't register everything twice.
  if (window.__nlmAnkiLoaded) return;
  window.__nlmAnkiLoaded = true;

  const CONFIG = {
    ANKI_BTN_ID: "notebooklm-to-anki-btn",
    APKG_BTN_ID: "notebooklm-to-apkg-btn",
    PENDING_TIMEOUT_MS: 20000,
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

  // ---------------------------------------------------------------- DATA MINER (runs in the quiz iframe)
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

  function buildCards(quizData) {
    return quizData.map(q => {
      const o = q.answerOptions || [];
      const card = { question: q.question, hint: q.hint || "" };
      for (let i = 0; i < 4; i++) {
        card["option" + (i + 1)] = (o[i] && o[i].text) || "";
        card["flag" + (i + 1)] = o[i] && o[i].isCorrect ? "True" : "False";
        card["rationale" + (i + 1)] = (o[i] && o[i].rationale) || "";
      }
      return card;
    });
  }

  function processBatch(jsonString, customNotebookTitle, mode) {
    mode = mode === "apkg" ? "apkg" : "anki";
    try {
      const data = JSON.parse(unescapeHtml(jsonString));
      const quizData = data.quiz || (data.mostRecentQuery && data.mostRecentQuery.quiz);

      if (!quizData || !Array.isArray(quizData) || quizData.length === 0) {
        window.top.postMessage({ action: "ANKI_REAL_FAIL", mode, error: "0 Questions Found." }, "*");
        return;
      }

      let finalTitle = customNotebookTitle;
      if (!finalTitle || finalTitle === "NotebookLM") finalTitle = data.title;
      if (!finalTitle) finalTitle = "Unknown Notebook";
      finalTitle = finalTitle.replace(/::/g, " - ").trim();

      const cards = buildCards(quizData);

      chrome.runtime.sendMessage({
        action: mode === "apkg" ? "exportApkg" : "sendBatchToAnki",
        batchData: cards,
        deckTitle: finalTitle
      }, (res) => {
        if (chrome.runtime.lastError) {
          window.top.postMessage({ action: "ANKI_REAL_FAIL", mode, error: chrome.runtime.lastError.message }, "*");
          return;
        }
        if (res && res.success) {
          window.top.postMessage({
            action: "ANKI_REAL_SUCCESS", mode,
            count: res.count, duplicates: res.duplicates || 0, total: res.total || cards.length,
            deck: finalTitle, filename: res.filename, warning: res.warning
          }, "*");
        } else {
          window.top.postMessage({ action: "ANKI_REAL_FAIL", mode, error: res ? res.error : "Unknown Error" }, "*");
        }
      });
    } catch (e) {
      console.error(e);
      window.top.postMessage({ action: "ANKI_REAL_FAIL", mode, error: "JSON Parse Error: " + e.message }, "*");
    }
  }

  // ---------------------------------------------------------------- UI INJECTOR (runs in the top page)
  let isMinerConnected = false;
  let pendingTimer = null;

  function initUiInjector() {
    window.addEventListener("message", (event) => {
      const d = event.data;
      if (!d || typeof d.action !== "string") return;
      if (d.action === "ANKI_MINER_READY") {
        isMinerConnected = true;
        updateButtonState("anki", "ready");
        updateButtonState("apkg", "ready");
      } else if (d.action === "ANKI_REAL_SUCCESS") {
        clearPending();
        updateButtonState(d.mode, "success", successText(d));
        if (d.warning) alert("⚠️ " + d.warning);
      } else if (d.action === "ANKI_REAL_FAIL") {
        clearPending();
        alert("⚠️ Export Failed: " + d.error);
        updateButtonState(d.mode, "error");
      }
    });

    const observer = new MutationObserver(() => {
      if (document.getElementById(CONFIG.ANKI_BTN_ID) && document.getElementById(CONFIG.APKG_BTN_ID)) return;
      let anchorBtn = null;
      for (const selector of CONFIG.ANCHOR_SELECTORS) {
        const found = document.querySelector(selector);
        if (found) { anchorBtn = found; break; }
      }
      if (!anchorBtn) return;
      const container = anchorBtn.closest("div.flex") || anchorBtn.parentElement;
      if (!container) return;
      // Insert so the order reads: [Anki Export] [Export .apkg] [native buttons]
      if (!document.getElementById(CONFIG.APKG_BTN_ID)) container.insertBefore(createButton("apkg"), container.firstChild);
      if (!document.getElementById(CONFIG.ANKI_BTN_ID)) container.insertBefore(createButton("anki"), container.firstChild);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function successText(d) {
    if (d.mode === "apkg") return `Saved ${d.total} to file!`;
    if (d.count === 0 && d.duplicates > 0) return `All ${d.duplicates} already in Anki`;
    return d.duplicates > 0 ? `Saved ${d.count}, skipped ${d.duplicates} dup` : `Saved ${d.count}!`;
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
    if (isMinerConnected) setTimeout(() => updateButtonState(mode, "ready"), 0); // miner announced itself before the button existed
    return btn;
  }

  function onExportClick(mode) {
    if (!isMinerConnected) { alert("Wait for page to fully load..."); return; }
    if (pendingTimer) return; // an export is already running

    let deckName = getNotebookTitle();
    if (!deckName) {
      deckName = prompt("Enter Notebook Name:");
      if (!deckName) return;
    }

    setBusy(mode);
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      alert("⚠️ Export Failed: no response from the quiz frame. Refresh the NotebookLM page and try again.");
      updateButtonState(mode, "error");
    }, CONFIG.PENDING_TIMEOUT_MS);

    document.querySelectorAll("iframe").forEach(iframe => {
      iframe.contentWindow.postMessage({ action: "ANKI_TRIGGER_EXTRACT", notebookTitle: deckName, mode }, "*");
    });
  }

  function clearPending() {
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
  }

  function labelEl(btn) { return btn.querySelector(".mdc-button__label span:last-child"); }

  function setBusy(mode) {
    const btn = document.getElementById(BUTTONS[mode].id);
    if (!btn) return;
    const l = labelEl(btn);
    if (l) l.innerText = mode === "apkg" ? "Building..." : "Extracting...";
    btn.style.borderColor = "#a8c7fa"; btn.style.color = "#a8c7fa";
  }

  function updateButtonState(mode, state, text) {
    if (!BUTTONS[mode]) return;
    const btn = document.getElementById(BUTTONS[mode].id);
    if (!btn) return;
    const l = labelEl(btn);
    if (state === "ready") {
      if (l) l.innerText = BUTTONS[mode].label;
      btn.style.opacity = "1"; btn.style.cursor = "pointer";
      btn.style.borderColor = "rgb(55, 56, 59)"; btn.style.color = "#e3e3e3";
      btn.disabled = false;
    } else if (state === "success") {
      if (l) l.innerText = text || "Saved!";
      btn.style.borderColor = "#6dd58c"; btn.style.color = "#6dd58c";
      setTimeout(() => updateButtonState(mode, "ready"), 3500);
    } else if (state === "error") {
      if (l) l.innerText = "Error";
      btn.style.borderColor = "#ffb4ab"; btn.style.color = "#ffb4ab";
      setTimeout(() => updateButtonState(mode, "ready"), 3000);
    }
  }

  initDataMiner();
  initUiInjector();
})();
