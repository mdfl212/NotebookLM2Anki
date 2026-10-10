// apkg.js - builds an Anki .apkg from NotebookLM quiz OR flashcard content.
// Supports two note types: "NotebookLM Markdown" (quiz) and "NotebookLM Flashcard".
// Runs in the offscreen document (browser) and in Node (for testing).
// Needs: sql.js (SQL), JSZip, WebCrypto (crypto.subtle).
// Produces modern AnkiDroid 2.17+ compatible packages (schema v18 + zstd).

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

  // ---- static templates (no <script>) for AnkiDroid WebView ----
  const QUIZ_QFMT =
`<div class="question">{{Question}}</div>
{{#Hint}}<div class="hint">💡 {{Hint}}</div>{{/Hint}}
<div class="options">
  <div class="option">A. {{Option1}}</div>
  <div class="option">B. {{Option2}}</div>
  <div class="option">C. {{Option3}}</div>
  <div class="option">D. {{Option4}}</div>
</div>`;

  const QUIZ_AFMT =
`<div class="question">{{Question}}</div>
{{#Hint}}<div class="hint">💡 {{Hint}}</div>{{/Hint}}
<hr>
<div class="options">
  <div class="option{{#Flag1}} correct{{/Flag1}}">{{#Flag1}}✓ {{/Flag1}}A. {{Option1}}{{#Rationale1}}<div class="rationale">{{Rationale1}}</div>{{/Rationale1}}</div>
  <div class="option{{#Flag2}} correct{{/Flag2}}">{{#Flag2}}✓ {{/Flag2}}B. {{Option2}}{{#Rationale2}}<div class="rationale">{{Rationale2}}</div>{{/Rationale2}}</div>
  <div class="option{{#Flag3}} correct{{/Flag3}}">{{#Flag3}}✓ {{/Flag3}}C. {{Option3}}{{#Rationale3}}<div class="rationale">{{Rationale3}}</div>{{/Rationale3}}</div>
  <div class="option{{#Flag4}} correct{{/Flag4}}">{{#Flag4}}✓ {{/Flag4}}D. {{Option4}}{{#Rationale4}}<div class="rationale">{{Rationale4}}</div>{{/Rationale4}}</div>
</div>`;

  const QUIZ_CSS =
`.card{font-family:sans-serif;font-size:15px;background:#1e1e1e;color:#e3e3e3;padding:16px;line-height:1.6}
.question{font-size:17px;font-weight:500;color:#fff;margin-bottom:12px}
.hint{background:#252525;border-left:4px solid #a8c7fa;padding:10px 14px;color:#a8c7fa;border-radius:0 8px 8px 0;margin-bottom:12px;font-size:14px}
hr{border-color:#444;margin:14px 0}
.options{display:flex;flex-direction:column;gap:10px}
.option{background:#2d2d2d;border:1px solid #444;border-radius:10px;padding:12px 16px}
.correct{border:2px solid #6dd58c!important;background:#1a2e1e!important;color:#6dd58c!important}
.rationale{margin-top:8px;color:#ccc;font-size:14px;font-weight:normal}`;

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
    return QUIZ_FIELDS.map(f => (m[f] == null ? "" : String(m[f])));
  }

  function flashCardToFields(c) {
    return [String(c.front || ""), String(c.back || "")];
  }

  function deckObj(id, name, nowSec) {
    return {
      id, name, mod: nowSec, usn: -1, lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0],
      timeToday: [0, 0], collapsed: false, browserCollapsed: false, desc: "", dyn: 0, conf: 1,
      extendNew: 0, extendRev: 0
    };
  }

  // Schema v11 base + v14/v15/v17/v18 upgrade tables (empty rows; col still carries JSON).
  const SCHEMA = [
    "CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null)",
    "CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null)",
    "CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null)",
    "CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null)",
    "CREATE TABLE graves (oid integer not null, type integer not null, usn integer not null, PRIMARY KEY (oid, type)) WITHOUT ROWID",
    // schema 14
    "CREATE TABLE deck_config (id integer PRIMARY KEY NOT NULL, name text NOT NULL, mtime_secs integer NOT NULL, usn integer NOT NULL, config blob NOT NULL)",
    "CREATE TABLE config (KEY text NOT NULL PRIMARY KEY, usn integer NOT NULL, mtime_secs integer NOT NULL, val blob NOT NULL) WITHOUT ROWID",
    // schema 15
    "CREATE TABLE fields (ntid integer NOT NULL, ord integer NOT NULL, name text NOT NULL, config blob NOT NULL, PRIMARY KEY (ntid, ord)) WITHOUT ROWID",
    "CREATE UNIQUE INDEX idx_fields_name_ntid ON fields (name, ntid)",
    "CREATE TABLE templates (ntid integer NOT NULL, ord integer NOT NULL, name text NOT NULL, mtime_secs integer NOT NULL, usn integer NOT NULL, config blob NOT NULL, PRIMARY KEY (ntid, ord)) WITHOUT ROWID",
    "CREATE UNIQUE INDEX idx_templates_name_ntid ON templates (name, ntid)",
    "CREATE INDEX idx_templates_usn ON templates (usn)",
    "CREATE TABLE notetypes (id integer NOT NULL PRIMARY KEY, name text NOT NULL, mtime_secs integer NOT NULL, usn integer NOT NULL, config blob NOT NULL)",
    "CREATE UNIQUE INDEX idx_notetypes_name ON notetypes (name)",
    "CREATE INDEX idx_notetypes_usn ON notetypes (usn)",
    "CREATE TABLE decks (id integer PRIMARY KEY NOT NULL, name text NOT NULL, mtime_secs integer NOT NULL, usn integer NOT NULL, common blob NOT NULL, kind blob NOT NULL)",
    "CREATE UNIQUE INDEX idx_decks_name ON decks (name)",
    // schema 17 tags (with collapsed/config)
    "CREATE TABLE tags (tag text NOT NULL PRIMARY KEY, usn integer NOT NULL, collapsed boolean NOT NULL, config blob NULL) WITHOUT ROWID",
    // indexes
    "CREATE INDEX ix_notes_usn on notes (usn)",
    "CREATE INDEX ix_cards_usn on cards (usn)",
    "CREATE INDEX ix_revlog_usn on revlog (usn)",
    "CREATE INDEX ix_cards_nid on cards (nid)",
    "CREATE INDEX ix_cards_sched on cards (did, queue, due)",
    "CREATE INDEX ix_revlog_cid on revlog (cid)",
    "CREATE INDEX ix_notes_csum on notes (csum)",
    "CREATE INDEX idx_notes_mid ON notes (mid)",
    "CREATE INDEX idx_cards_odid ON cards (odid) WHERE odid != 0",
    "CREATE INDEX idx_graves_pending ON graves (usn)"
  ];

  /** Encode a standards-compliant zstd frame using raw blocks. */
  function zstdCompress(data) {
    const u8 = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
    const n = u8.length;
    if (n > 0xffffffff) throw new Error("payload too large for zstd frame");

    // Prefer Node zlib when available; browser extension pages use raw blocks below.
    if (typeof process !== "undefined" && process.versions && process.versions.node) {
      try {
        const zlib = require("zlib");
        if (typeof zlib.zstdCompressSync === "function") {
          return new Uint8Array(zlib.zstdCompressSync(Buffer.from(u8)));
        }
      } catch (_) { /* fall through */ }
    }

    const maxBlockSize = 128 * 1024;
    const blockCount = Math.max(1, Math.ceil(n / maxBlockSize));
    const out = new Uint8Array(9 + n + blockCount * 3);
    out.set([0x28, 0xb5, 0x2f, 0xfd], 0);
    out[4] = 0xa0; // Single segment with a 4-byte frame content size; no dictionary.
    out[5] = n & 0xff;
    out[6] = (n >>> 8) & 0xff;
    out[7] = (n >>> 16) & 0xff;
    out[8] = (n >>> 24) & 0xff;

    let inputOffset = 0;
    let outputOffset = 9;
    do {
      const size = Math.min(maxBlockSize, n - inputOffset);
      const lastBlock = inputOffset + size === n;
      const blockHeader = (size << 3) | (lastBlock ? 1 : 0);
      out[outputOffset++] = blockHeader & 0xff;
      out[outputOffset++] = (blockHeader >>> 8) & 0xff;
      out[outputOffset++] = (blockHeader >>> 16) & 0xff;
      if (size > 0) {
        out.set(u8.subarray(inputOffset, inputOffset + size), outputOffset);
      }
      inputOffset += size;
      outputOffset += size;
    } while (inputOffset < n);

    return out;
  }

  // The package metadata is protobuf (version=Latest), while the media list is zstd.
  const META = new Uint8Array([0x08, 0x03]);
  const MEDIA_ZSTD = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x20, 0x02, 0x11, 0x00, 0x00, 0x7b, 0x7d]); // {}

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

    // Prefer the static templates that AnkiDroid can render; fall back to supplied ones.
    let qfmt, afmt, css;
    if (isFlash) {
      qfmt = (templates && templates.front) || FLASH_QFMT;
      afmt = (templates && templates.back)  || FLASH_AFMT;
      css  = (templates && templates.css)   || FLASH_CSS;
    } else {
      // Force static quiz templates (BUG 4)
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

      // BUG 2: use seconds (nowSec), schema version 18
      db.run("INSERT INTO col VALUES (1,?,?,?,18,0,0,0,?,?,?,?,'{}')", [
        dayStart, nowSec, nowSec,
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

      const sqliteBytes = db.export();                 // Uint8Array
      const anki21b     = zstdCompress(sqliteBytes);   // zstd of schema-18 DB

      // Build ZIP with STORED entries only (BUG 1, 5, 6, 7)
      const zip = new JSZip();
      // Use a fixed epoch date so JSZip does not inject UT extra fields
      const epoch = new Date(0);
      const storeOpts = { compression: "STORE", date: epoch };

      zip.file("meta",              META,       storeOpts);
      zip.file("collection.anki21b", anki21b,    storeOpts);
      zip.file("collection.anki2",   sqliteBytes, storeOpts); // uncompressed fallback
      zip.file("media",             MEDIA_ZSTD, storeOpts);

      let raw = await zip.generateAsync({
        type: "uint8array",
        compression: "STORE",
        // platform / encodeFileName left default
      });

      return raw;
    } finally {
      db.close();
    }
  }

  return { build, QUIZ_FIELDS, FLASH_FIELDS, QUIZ_MODEL_NAME, FLASH_MODEL_NAME, QUIZ_MODEL_ID, FLASH_MODEL_ID };
});
