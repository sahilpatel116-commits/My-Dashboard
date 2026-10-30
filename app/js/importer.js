/* Imports the existing MTC MEPF dashboard HTML (its embedded DATA_JSON) into the event model.
 * Old records only hold the latest status, so each is turned into the events it implies. */
(function () {
  const T = window.T;

  const ddmmyy = (s) => {
    const m = (s || '').match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
    if (!m) return null;
    let y = +m[3]; if (y < 100) y += 2000;
    return T.iso(new Date(y, +m[2] - 1, +m[1]));
  };
  const srrOf = (s) => (s && /\d/.test(s) ? s.replace(/\s+/g, '') : null);
  const typeOf = (title) => (/calc|dbr|statement|report|schedule|boq|spec/i.test(title) ? 'calculation' : 'drawing');

  function eventsFor(r) {
    const date = ddmmyy(r.date), srr = srrOf(r.srr), ev = [];
    const e = (type, extra) => ev.push({ id: T.uid(), type, by: 'import', ...extra });
    switch (r.status) {
      case 'NONO':
      case 'NONOC':
      case 'NOO':
      case 'NR':
        if (r.action === 'resubmitted') {
          e('ERS_RECEIVED', { srr, code: r.status, date: null });
          e('SENT_TO_SCC', { date });
        } else {
          e('ERS_RECEIVED', { srr, code: r.status, date, closed: r.action === 'closed' || undefined });
        }
        break;
      case 'Submitted':
        if (r.res) e('ERS_RECEIVED', { srr, code: r.res, date: null });
        e('SENT_TO_SCC', { date, srr: r.res ? null : srr });
        break;
      case 'BIM':
        if (r.res) e('ERS_RECEIVED', { srr, code: r.res, date: null });
        e('SENT_TO_BIM', { date });
        break;
      case 'Vendor':
        e('VENDOR_WAIT', { date });
        break;
      case 'Blank':
        if (date) e('VENDOR_WAIT', { date });
        break;
    }
    if (r.remark) e('NOTE', { date: null, note: r.remark });
    return ev;
  }

  T.importDashboardHtml = function (html) {
    const m = html.match(/<script[^>]*id=["']DATA_JSON["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!m) throw new Error('No DATA_JSON block found in this file.');
    const data = JSON.parse(m[1]);
    const out = [];
    for (const [station, discs] of Object.entries(data)) {
      if (!discs || typeof discs !== 'object') continue;
      for (const [discipline, items] of Object.entries(discs)) {
        if (!Array.isArray(items)) continue;
        for (const r of items) {
          out.push({
            id: T.uid(),
            station,
            discipline,
            group: r.sg || '',
            code: r.code || '',
            title: r.title || '',
            type: typeOf(r.title || ''),
            sheets: r.count || 1,
            subs: r.sub || [],
            baseline: true,
            removed: r.status === 'Removed',
            events: eventsFor(r),
          });
        }
      }
    }
    return out;
  };
})();
