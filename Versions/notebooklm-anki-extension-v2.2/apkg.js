// apkg.js - builds an Anki .apkg (legacy collection.anki2 format) from NotebookLM quiz cards.
// Runs in the offscreen document (browser) and in Node (for testing).
// Needs: sql.js (SQL), JSZip, WebCrypto (crypto.subtle).

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ApkgBuilder = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const MODEL_NAME = "NotebookLM Markdown";
  const MODEL_ID = 1766000000001; // fixed so repeated imports reuse one note type
  const PARENT_DECK = "NotebookLM";
  const TAG = "notebooklm_export";

  // Same 15 fields the AnkiConnect export fills (matched by name, so order is free).
  const FIELDS = [
    "Question", "Hint", "ArchDiagram",
    "Option1", "Flag1", "Rationale1",
    "Option2", "Flag2", "Rationale2",
    "Option3", "Flag3", "Rationale3",
    "Option4", "Flag4", "Rationale4"
  ];

  const B91 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~";

  async function sha1(str) {
    const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(str));
    return new Uint8Array(buf);
  }

  // Anki-style GUID: first 8 bytes of a hash as a base-91 number.
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

  function cardToFields(c) {
    const m = {
      Question: c.question, Hint: c.hint, ArchDiagram: "",
      Option1: c.option1, Flag1: c.flag1, Rationale1: c.rationale1,
      Option2: c.option2, Flag2: c.flag2, Rationale2: c.rationale2,
      Option3: c.option3, Flag3: c.flag3, Rationale3: c.rationale3,
      Option4: c.option4, Flag4: c.flag4, Rationale4: c.rationale4
    };
    return FIELDS.map(f => (m[f] == null ? "" : String(m[f])));
  }

  function deckObj(id, name, nowSec) {
    return {
      id, name, mod: nowSec, usn: -1, lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0],
      timeToday: [0, 0], collapsed: false, browserCollapsed: false, desc: "", dyn: 0, conf: 1,
      extendNew: 0, extendRev: 0
    };
  }

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
   * @param {object} o.SQL        initialised sql.js module
   * @param {function} o.JSZip    JSZip constructor
   * @param {string} o.deckTitle  notebook title (sub-deck name)
   * @param {Array} o.cards       cards as produced by content.js
   * @param {{front:string,back:string,css:string}} o.templates
   * @param {function} [o.onProgress]  (fraction 0..1, label) called while building
   * @returns {Promise<Uint8Array>} the .apkg bytes
   */
  async function build(o) {
    const { SQL, JSZip, cards, templates } = o;
    const prog = typeof o.onProgress === "function" ? o.onProgress : function () {};
    const title = String(o.deckTitle || "Default Notebook").replace(/::/g, " - ").trim() || "Default Notebook";
    const deckName = PARENT_DECK + "::" + title;

    const now = Date.now();
    const nowSec = Math.floor(now / 1000);
    const dayStart = Math.floor(new Date(new Date().setHours(4, 0, 0, 0)).getTime() / 1000);

    // Deterministic deck ids so re-imports land in the same decks.
    const parentId = 1766100000000 + parseInt((await sha1(PARENT_DECK))[0]);
    const hh = await sha1(deckName);
    const deckId = 1766200000000 + ((hh[0] << 16) | (hh[1] << 8) | hh[2]);

    const model = {
      id: MODEL_ID, name: MODEL_NAME, type: 0, mod: nowSec, usn: -1, sortf: 0, did: deckId,
      tags: [], vers: [], latexPre: "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
      latexPost: "\\end{document}", latexsvg: false,
      req: [[0, "any", [0]]],
      css: templates.css,
      flds: FIELDS.map((name, ord) => ({ name, ord, sticky: false, rtl: false, font: "Arial", size: 20, media: [] })),
      tmpls: [{ name: "Card 1", ord: 0, qfmt: templates.front, afmt: templates.back, bqfmt: "", bafmt: "", did: null, bfont: "", bsize: 0 }]
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
      [String(parentId)]: deckObj(parentId, PARENT_DECK, nowSec),
      [String(deckId)]: deckObj(deckId, deckName, nowSec)
    };

    const db = new SQL.Database();
    try {
      prog(0, "Creating database");
      SCHEMA.forEach(s => db.run(s));
      db.run("INSERT INTO col VALUES (1,?,?,?,11,0,0,0,?,?,?,?,'{}')", [
        dayStart, now, now, JSON.stringify(conf), JSON.stringify({ [String(MODEL_ID)]: model }),
        JSON.stringify(decks), JSON.stringify(dconf)
      ]);

      const insNote = db.prepare("INSERT INTO notes VALUES (?,?,?,?,-1,?,?,?,?,0,'')");
      const insCard = db.prepare("INSERT INTO cards VALUES (?,?,?,0,?,-1,0,0,?,0,0,0,0,0,0,0,0,'')");
      const seen = new Map();
      for (let i = 0; i < cards.length; i++) {
        const fields = cardToFields(cards[i]);
        // GUID from notebook + question, so re-importing the same quiz updates instead of duplicating.
        const base = deckName + "\u0000" + stripHtml(fields[0]);
        const n = (seen.get(base) || 0) + 1; seen.set(base, n);
        const guid = guidFromBytes(await sha1(n === 1 ? base : base + "#" + n));
        const noteId = now + i; // unique per note within this export
        insNote.run([noteId, guid, MODEL_ID, nowSec, " " + TAG + " ", fields.join("\x1f"), stripHtml(fields[0]), await csumOf(fields[0])]);
        insCard.run([noteId + 100000, noteId, deckId, nowSec, i]);
        prog((i + 1) / cards.length, `Adding card ${i + 1} of ${cards.length}`);
      }
      insNote.free(); insCard.free();
      prog(1, "Compressing .apkg");

      const zip = new JSZip();
      zip.file("collection.anki2", db.export());
      zip.file("media", "{}");
      return await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    } finally {
      db.close();
    }
  }

  return { build, FIELDS, MODEL_NAME, MODEL_ID };
});
