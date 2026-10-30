/* Reads a pasted Outlook email (or ERS text) and proposes register updates.
 * Nothing is saved here — the admin reviews and confirms the proposal in the Inbox screen. */
(function () {
  const T = window.T;

  const SRR_RE = /\b(?:SRR|ERS)\s*[-_#:/.]?\s*(?:no\.?\s*)?(\d{2,6})\b/gi;
  // order matters: NONOC before NONO before NOO
  const CODE_RE = /\b(NONOC|NONO|NOO|NR)\b/i;
  const PHRASES = [
    [/no\s+objection\s+with\s+comments?/i, 'NONOC'],
    [/notice\s+of\s+no\s+objection/i, 'NONO'],
    [/notice\s+of\s+objection/i, 'NOO'],
    [/not\s+reviewed/i, 'NR'],
  ];
  const MONTHS = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');

  function findCode(line) {
    const m = line.match(CODE_RE);
    if (m) return m[1].toUpperCase();
    for (const [re, c] of PHRASES) if (re.test(line)) return c;
    return null;
  }

  function findSrrs(line) {
    const out = [];
    let m;
    SRR_RE.lastIndex = 0;
    while ((m = SRR_RE.exec(line))) out.push('SRR-' + m[1]);
    return out;
  }

  // Accepts 20-10-26, 20/10/2026, 20.10.2026, "20 Oct 2026", "October 20, 2026"
  T.parseLooseDate = function (s) {
    if (!s) return null;
    let m = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
    if (m) {
      let y = +m[3]; if (y < 100) y += 2000;
      const d = new Date(y, +m[2] - 1, +m[1]);
      return isNaN(d) ? null : T.iso(d);
    }
    m = s.match(/\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*,?\s+(\d{4})\b/);
    if (m && MONTHS.includes(m[2].toLowerCase()))
      return T.iso(new Date(+m[3], MONTHS.indexOf(m[2].toLowerCase()), +m[1]));
    m = s.match(/\b([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})\b/);
    if (m && MONTHS.includes(m[1].toLowerCase()))
      return T.iso(new Date(+m[3], MONTHS.indexOf(m[1].toLowerCase()), +m[2]));
    return null;
  };

  // code → deliverable for one station; range codes ("24015–24022") and sub-sheet codes both resolve
  function codeIndex(db, station) {
    const idx = new Map();
    for (const d of db.deliverables) {
      if (d.station !== station || d.removed) continue;
      const add = (c) => { if (c && !idx.has(c)) idx.set(c, d); };
      const code = String(d.code || '');
      add(code);
      const r = code.match(/^(\d+)\s*[–-]\s*(\d+)$/);
      if (r && +r[2] - +r[1] < 200) for (let n = +r[1]; n <= +r[2]; n++) add(String(n));
      for (const s of d.subs || []) add(String(s[1]));
    }
    return idx;
  }

  T.stations = (db) => [...new Set(db.deliverables.map((d) => d.station))];

  /**
   * @returns {{srrs:string[], code:string|null, date:string, station:string|null,
   *   mode:'ers'|'tcap', rows:{d:object, srr:string|null, code:string|null}[], unmatched:string[]}}
   */
  T.parseEmail = function (text, db, opts) {
    opts = opts || {};
    const lines = text.split(/\r?\n/);
    const stations = T.stations(db);

    // station: explicit choice, else the station named most often in the mail
    let station = opts.station || null;
    if (!station) {
      let best = 0;
      for (const s of stations) {
        const n = (text.match(new RegExp('\\b' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi')) || []).length;
        if (n > best) { best = n; station = s; }
      }
    }

    // received date: Outlook "Sent:" / "Date:" header, else today
    let date = null;
    for (const l of lines) {
      if (/^\s*(sent|date|received)\s*:/i.test(l)) { date = T.parseLooseDate(l); if (date) break; }
    }
    date = opts.date || date || T.today();

    const allSrrs = [...new Set(findSrrs(text))];
    const allCodes = [...new Set(lines.map(findCode).filter(Boolean))];
    const globalCode = allCodes.length === 1 ? allCodes[0] : null;
    const mode = opts.mode || (allCodes.length ? 'ers' : 'tcap');

    const idx = station ? codeIndex(db, station) : new Map();
    const rows = new Map();
    const unmatched = new Set();
    let ctxSrr = allSrrs[0] || null, ctxCode = null;

    for (const line of lines) {
      const srrs = findSrrs(line);
      const code = findCode(line);
      const nums = line.match(/\b\d{5}\b/g) || [];
      if (srrs.length) ctxSrr = srrs[0];
      if (!nums.length) { if (code) ctxCode = code; continue; }
      for (const n of nums) {
        const d = idx.get(n);
        if (!d) { unmatched.add(n); continue; }
        if (rows.has(d.id)) continue;
        rows.set(d.id, { d, srr: srrs[0] || ctxSrr, code: code || ctxCode || globalCode });
      }
    }
    return { srrs: allSrrs, codes: allCodes, date, station, mode, rows: [...rows.values()], unmatched: [...unmatched] };
  };
})();
