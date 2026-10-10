// apkg.js - builds an Anki .apkg from NotebookLM quiz OR flashcard content.
// Supports two note types: "NotebookLM Markdown" (quiz) and "NotebookLM Flashcard".
// Runs in the offscreen document (browser) and in Node (for testing).
// Needs: sql.js (SQL), JSZip, WebCrypto (crypto.subtle).
// Produces legacy schema-v11 .apkg files for broad Anki/AnkiDroid compatibility.

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ApkgBuilder = factory();
})(typeof self !== "undefined" ? self : this, function () {

  // ---- quiz note type ----
  const QUIZ_MODEL_NAME = "NotebookLM Markdown";
  const QUIZ_MODEL_ID   = 1766000000001;
  const QUIZ_FIELDS = [
    "Question", "Hint", "ArchDiagram",
    "Option1", "Flag1", "Rationale1",
    "Option2", "Flag2", "Rationale2",
    "Option3", "Flag3", "Rationale3",
    "Option4", "Flag4", "Rationale4"
  ];

  // ---- flashcard note type ----
  const FLASH_MODEL_NAME = "NotebookLM Flashcard";
  const FLASH_MODEL_ID   = 1766000000002;
  const FLASH_FIELDS = ["Front", "Back"];

  const PARENT_DECK = "NotebookLM";
  const QUIZ_TAG  = "notebooklm_export";
  const FLASH_TAG = "notebooklm_flashcards";

  const B91 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~";

  // ---- quiz templates with touch-friendly answer choices ----
  const QUIZ_QFMT =
`<div class="quiz">
  <div class="question">{{Question}}</div>
  {{#Hint}}<details class="hint"><summary>💡 Hint</summary><div class="hint-content">{{Hint}}</div></details>{{/Hint}}
  <div class="options">
    <button type="button" class="option{{#Flag1}} answer-correct{{/Flag1}}" onclick="event.preventDefault();event.stopPropagation();var box=this.parentNode;box.querySelectorAll('.option').forEach(function(o){o.classList.remove('state-correct','state-wrong');o.querySelector('.feedback').style.display='none';});this.classList.add(this.classList.contains('answer-correct')?'state-correct':'state-wrong');this.querySelector('.feedback').style.display='block';return false;">A. {{Option1}}<span class="feedback" style="display:none">{{#Flag1}}✓ That's right!{{/Flag1}}{{^Flag1}}✗ Not quite{{/Flag1}}{{#Rationale1}}<span class="rationale">{{Rationale1}}</span>{{/Rationale1}}</span></button>
    <button type="button" class="option{{#Flag2}} answer-correct{{/Flag2}}" onclick="event.preventDefault();event.stopPropagation();var box=this.parentNode;box.querySelectorAll('.option').forEach(function(o){o.classList.remove('state-correct','state-wrong');o.querySelector('.feedback').style.display='none';});this.classList.add(this.classList.contains('answer-correct')?'state-correct':'state-wrong');this.querySelector('.feedback').style.display='block';return false;">B. {{Option2}}<span class="feedback" style="display:none">{{#Flag2}}✓ That's right!{{/Flag2}}{{^Flag2}}✗ Not quite{{/Flag2}}{{#Rationale2}}<span class="rationale">{{Rationale2}}</span>{{/Rationale2}}</span></button>
    <button type="button" class="option{{#Flag3}} answer-correct{{/Flag3}}" onclick="event.preventDefault();event.stopPropagation();var box=this.parentNode;box.querySelectorAll('.option').forEach(function(o){o.classList.remove('state-correct','state-wrong');o.querySelector('.feedback').style.display='none';});this.classList.add(this.classList.contains('answer-correct')?'state-correct':'state-wrong');this.querySelector('.feedback').style.display='block';return false;">C. {{Option3}}<span class="feedback" style="display:none">{{#Flag3}}✓ That's right!{{/Flag3}}{{^Flag3}}✗ Not quite{{/Flag3}}{{#Rationale3}}<span class="rationale">{{Rationale3}}</span>{{/Rationale3}}</span></button>
    <button type="button" class="option{{#Flag4}} answer-correct{{/Flag4}}" onclick="event.preventDefault();event.stopPropagation();var box=this.parentNode;box.querySelectorAll('.option').forEach(function(o){o.classList.remove('state-correct','state-wrong');o.querySelector('.feedback').style.display='none';});this.classList.add(this.classList.contains('answer-correct')?'state-correct':'state-wrong');this.querySelector('.feedback').style.display='block';return false;">D. {{Option4}}<span class="feedback" style="display:none">{{#Flag4}}✓ That's right!{{/Flag4}}{{^Flag4}}✗ Not quite{{/Flag4}}{{#Rationale4}}<span class="rationale">{{Rationale4}}</span>{{/Rationale4}}</span></button>
  </div>
</div>`;

  const QUIZ_AFMT =
`<div class="quiz">
  <div class="question">{{Question}}</div>
  <div class="options">
    <div class="option{{#Flag1}} state-correct{{/Flag1}}{{^Flag1}} state-dimmed{{/Flag1}}">A. {{Option1}}{{#Flag1}}<div class="feedback">✓ That's right!{{#Rationale1}}<div class="rationale">{{Rationale1}}</div>{{/Rationale1}}</div>{{/Flag1}}</div>
    <div class="option{{#Flag2}} state-correct{{/Flag2}}{{^Flag2}} state-dimmed{{/Flag2}}">B. {{Option2}}{{#Flag2}}<div class="feedback">✓ That's right!{{#Rationale2}}<div class="rationale">{{Rationale2}}</div>{{/Rationale2}}</div>{{/Flag2}}</div>
    <div class="option{{#Flag3}} state-correct{{/Flag3}}{{^Flag3}} state-dimmed{{/Flag3}}">C. {{Option3}}{{#Flag3}}<div class="feedback">✓ That's right!{{#Rationale3}}<div class="rationale">{{Rationale3}}</div>{{/Rationale3}}</div>{{/Flag3}}</div>
    <div class="option{{#Flag4}} state-correct{{/Flag4}}{{^Flag4}} state-dimmed{{/Flag4}}">D. {{Option4}}{{#Flag4}}<div class="feedback">✓ That's right!{{#Rationale4}}<div class="rationale">{{Rationale4}}</div>{{/Rationale4}}</div>{{/Flag4}}</div>
  </div>
</div>`;

  const QUIZ_CSS =
`html{overflow-x:hidden}
body{margin:0;padding:0;width:100%;background:#1e1e1e;color:#e3e3e3;font-family:Roboto,"Segoe UI",sans-serif}
.card{font-size:16px;line-height:1.6;text-align:left;background:#1e1e1e;min-height:100vh}
.quiz{width:100%;max-width:580px;box-sizing:border-box;margin:0 auto;padding:40px 20px 80px}
.question{font-size:1.35rem;font-weight:500;margin-bottom:24px;color:#fff;line-height:1.5}
.hint{margin-bottom:24px}
.hint summary{display:inline-block;background:#2d2d2d;border:1px solid #444746;border-radius:20px;padding:8px 16px;color:#a8c7fa;font-size:.9rem;font-weight:500;cursor:pointer;list-style:none}
.hint summary::-webkit-details-marker{display:none}
.hint-content{margin-top:12px;background:#252525;border-left:4px solid #a8c7fa;padding:12px 15px;color:#e3e3e3;border-radius:0 8px 8px 0}
.options{display:flex;flex-direction:column;gap:12px;padding-bottom:20px}
.option{-webkit-appearance:none;appearance:none;display:block;width:100%;box-sizing:border-box;text-align:left;background:#2d2d2d;border:1px solid #444746;border-radius:12px;padding:16px 18px;color:inherit;font:inherit;cursor:pointer;touch-action:manipulation}
.option:active{background:#383838}
.state-correct{border:2px solid #6dd58c!important;background:#252525!important}
.state-wrong{border:2px solid #e87c7c!important;background:#252525!important}
.state-dimmed{opacity:.5}
.feedback{display:block;margin-top:12px;padding-top:12px;border-top:1px solid #444;font-weight:600;color:#e87c7c}
.state-correct .feedback{color:#6dd58c}
.rationale{display:block;margin-top:8px;color:#ccc;font-size:.95rem;font-weight:400}
@media(max-width:600px){.quiz{padding:24px 16px 60px}.question{font-size:1.2rem}.option{padding:14px}}`;

  const FLASH_QFMT = `{{Front}}`;
  const FLASH_AFMT = `{{FrontSide}}<hr id=answer>{{Back}}`;
  const FLASH_CSS  = `.card{font-family:sans-serif;font-size:16px;background:#1e1e1e;color:#e3e3e3;padding:16px;line-height:1.5}`;

  async function sha1(str) {
    const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(str));
    return new Uint8Array(buf);
  }

  function guidFromBytes(bytes) {
    let n = 0n;
    for (let i = 0; i < 8; i++) n = (n << 8n) | BigInt(bytes[i]);
    let s = "";
    do { s = B91[Number(n % 91n)] + s; n /= 91n; } while (n > 0n);
    return s;
  }

  function stripHtml(s) { return String(s || "").replace(/<[^>]*>/g, ""); }

  function normalizeMathDelimiters(value) {
    return String(value || "")
      .replace(/\$\$([\s\S]*?)\$\$/g, "\\[$1\\]")
      .replace(/\$((?:[^$]|\\$)+?)\$/g, "\\($1\\)");
  }

  function csumOf(text) {
    return sha1(stripHtml(text)).then(b => ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0);
  }

  /** Map flag values to Anki-safe "true" or "" (never "False"/"True"). */
  function flagVal(v) {
    return (v === true || String(v).toLowerCase() === "true") ? "true" : "";
  }

  function quizCardToFields(c) {
    const m = {
      Question: c.question, Hint: c.hint, ArchDiagram: "",
      Option1: c.option1, Flag1: flagVal(c.flag1), Rationale1: c.rationale1,
      Option2: c.option2, Flag2: flagVal(c.flag2), Rationale2: c.rationale2,
      Option3: c.option3, Flag3: flagVal(c.flag3), Rationale3: c.rationale3,
      Option4: c.option4, Flag4: flagVal(c.flag4), Rationale4: c.rationale4
    };
    return QUIZ_FIELDS.map(f => normalizeMathDelimiters(m[f]));
  }

  function flashCardToFields(c) {
    return [normalizeMathDelimiters(c.front), normalizeMathDelimiters(c.back)];
  }

  function deckObj(id, name, nowSec) {
    return {
      id, name, mod: nowSec, usn: -1, lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0],
      timeToday: [0, 0], collapsed: false, browserCollapsed: false, desc: "", dyn: 0, conf: 1,
      extendNew: 0, extendRev: 0
    };
  }

  // Legacy schema v11 stores note types and decks in the col JSON columns.
  const SCHEMA = [
    "CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null)",
    "CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null)",
    "CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null)",
    "CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null)",
    "CREATE TABLE graves (usn integer not null, type integer not null, oid integer not null)",
    "CREATE INDEX ix_notes_usn on notes (usn)",
    "CREATE INDEX ix_cards_usn on cards (usn)",
    "CREATE INDEX ix_revlog_usn on revlog (usn)",
    "CREATE INDEX ix_cards_nid on cards (nid)",
    "CREATE INDEX ix_cards_sched on cards (did, queue, due)",
    "CREATE INDEX ix_revlog_cid on revlog (cid)",
    "CREATE INDEX ix_notes_csum on notes (csum)"
  ];

  /**
   * @param {object} o
   * @param {object}   o.SQL         initialised sql.js module
   * @param {function} o.JSZip       JSZip constructor
   * @param {string}   o.deckTitle   notebook title (sub-deck name)
   * @param {Array}    o.cards       cards from content.js  (quiz or flashcard objects)
   * @param {object}   o.templates   { front, back, css, type: "quiz"|"flashcard" }
   * @param {function} [o.onProgress]  (fraction 0..1, label)
   * @returns {Promise<Uint8Array>}
   */
  async function build(o) {
    const { SQL, JSZip, cards, templates } = o;
    const prog = typeof o.onProgress === "function" ? o.onProgress : function () {};
    const title = String(o.deckTitle || "Default Notebook").replace(/::/g, " - ").trim() || "Default Notebook";
    const isFlash = templates && templates.type === "flashcard";
    const suffix   = isFlash ? "_FLASHCARDS" : "_QUIZ";
    const notebookDeck = PARENT_DECK + "::" + title;
    const deckName     = notebookDeck + "::" + title + suffix;

    const MODEL_ID   = isFlash ? FLASH_MODEL_ID   : QUIZ_MODEL_ID;
    const MODEL_NAME = isFlash ? FLASH_MODEL_NAME  : QUIZ_MODEL_NAME;
    const FIELDS     = isFlash ? FLASH_FIELDS      : QUIZ_FIELDS;
    const TAG        = isFlash ? FLASH_TAG         : QUIZ_TAG;
    const cardToFields = isFlash ? flashCardToFields : quizCardToFields;

    // Quiz uses the bundled touch-enabled template; flashcards use their supplied template.
    let qfmt, afmt, css;
    if (isFlash) {
      qfmt = (templates && templates.front) || FLASH_QFMT;
      afmt = (templates && templates.back)  || FLASH_AFMT;
      css  = (templates && templates.css)   || FLASH_CSS;
    } else {
      qfmt = QUIZ_QFMT;
      afmt = QUIZ_AFMT;
      css  = QUIZ_CSS;
    }

    const now = Date.now();
    const nowSec = Math.floor(now / 1000);
    const dayStart = Math.floor(new Date(new Date().setHours(4, 0, 0, 0)).getTime() / 1000);

    const parentId = 1766100000000 + parseInt((await sha1(PARENT_DECK))[0]);
    const nb = await sha1(notebookDeck);
    const notebookId = 1766150000000 + ((nb[0] << 16) | (nb[1] << 8) | nb[2]);
    const hh = await sha1(deckName);
    const deckId = 1766200000000 + ((hh[0] << 16) | (hh[1] << 8) | hh[2]);

    const model = {
      id: MODEL_ID, name: MODEL_NAME, type: 0, mod: nowSec, usn: -1, sortf: 0, did: deckId,
      tags: [], vers: [], latexPre: "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
      latexPost: "\\end{document}", latexsvg: false,
      req: [[0, "any", [0]]],
      css: css,
      flds: FIELDS.map((name, ord) => ({ name, ord, sticky: false, rtl: false, font: "Arial", size: 20, media: [] })),
      tmpls: [{ name: "Card 1", ord: 0, qfmt: qfmt, afmt: afmt, bqfmt: "", bafmt: "", did: null, bfont: "", bsize: 0 }]
    };

    const conf = {
      nextPos: 1, estTimes: true, activeDecks: [deckId], sortType: "noteFld", timeLim: 0, sortBackwards: false,
      addToCur: true, curDeck: deckId, newBury: true, newSpread: 0, dueCounts: true, curModel: String(MODEL_ID), collapseTime: 1200
    };
    const dconf = {
      "1": {
        id: 1, name: "Default", mod: 0, usn: 0, maxTaken: 60, autoplay: true, timer: 0, replayq: true, dyn: false,
        new: { bury: true, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 7], order: 1, perDay: 20, separate: true },
        lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
        rev: { bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, minSpace: 1, perDay: 100 }
      }
    };
    const decks = {
      "1": deckObj(1, "Default", nowSec),
      [String(parentId)]:   deckObj(parentId,   PARENT_DECK,  nowSec),
      [String(notebookId)]: deckObj(notebookId, notebookDeck, nowSec),
      [String(deckId)]:     deckObj(deckId,     deckName,     nowSec)
    };

    const db = new SQL.Database();
    try {
      prog(0, "Creating database");
      SCHEMA.forEach(s => db.run(s));

      db.run("INSERT INTO col VALUES (1,?,?,?,11,0,0,0,?,?,?,?,'{}')", [
        dayStart, now, now,
        JSON.stringify(conf),
        JSON.stringify({ [String(MODEL_ID)]: model }),
        JSON.stringify(decks),
        JSON.stringify(dconf)
      ]);

      const insNote = db.prepare("INSERT INTO notes VALUES (?,?,?,?,-1,?,?,?,?,0,'')");
      const insCard = db.prepare("INSERT INTO cards VALUES (?,?,?,0,?,-1,0,0,?,0,0,0,0,0,0,0,0,'')");
      const seen = new Map();
      for (let i = 0; i < cards.length; i++) {
        const fields = cardToFields(cards[i]);
        const base = deckName + "\u0000" + stripHtml(fields[0]);
        const n = (seen.get(base) || 0) + 1; seen.set(base, n);
        const guid = guidFromBytes(await sha1(n === 1 ? base : base + "#" + n));
        const noteId = now + i;
        insNote.run([noteId, guid, MODEL_ID, nowSec, " " + TAG + " ", fields.join("\x1f"), stripHtml(fields[0]), await csumOf(fields[0])]);
        insCard.run([noteId + 100000, noteId, deckId, nowSec, i]);
        prog((i + 1) / cards.length, `Adding card ${i + 1} of ${cards.length}`);
      }
      insNote.free(); insCard.free();
      prog(1, "Compressing .apkg");

      const sqliteBytes = db.export();
      const zip = new JSZip();
      zip.file("collection.anki2", sqliteBytes);
      zip.file("media", "{}");
      return await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    } finally {
      db.close();
    }
  }

  return { build, QUIZ_FIELDS, FLASH_FIELDS, QUIZ_MODEL_NAME, FLASH_MODEL_NAME, QUIZ_MODEL_ID, FLASH_MODEL_ID };
});
