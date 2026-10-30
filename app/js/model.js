/* Core data model: event types, stages, delay rules, weekly counts, cycle analytics.
 * A deliverable's status is never stored directly — it is derived from its event history,
 * so every date in the chain (SRR received → team → BIM → SCC → TCAP → ERS) is kept. */
(function () {
  const T = (window.T = window.T || {});

  T.CODES = ['NONO', 'NONOC', 'NOO', 'NR'];
  T.CODE_LABEL = {
    NONO: 'Notice of No Objection',
    NONOC: 'No Objection with Comments',
    NOO: 'Notice of Objection',
    NR: 'Not Reviewed',
  };

  T.TEAMS = ['Admin', 'Architecture', 'Structure', 'MEPF', 'BIM', 'SCC', 'Client'];
  T.ROLES = { admin: 'Administrator', team: 'Internal team', client: 'Client (read-only)' };

  T.DEFAULT_DISC_TEAM = {
    Architectural: 'Architecture',
    Structural: 'Structure',
    HVAC: 'MEPF',
    'Plumbing (PHE)': 'MEPF',
    'Fire Fighting': 'MEPF',
    Electrical: 'MEPF',
    ELV: 'MEPF',
  };

  // stage: the stage the deliverable enters after this event (null = no change)
  T.EVENTS = {
    ERS_RECEIVED: { label: 'SRR / ERS received from SCC', short: 'SRR received', who: 'SCC → Us' },
    SENT_TO_TEAM: { label: 'Sent to design team', short: 'To team', who: 'Us → Team', stage: 'with_team' },
    TEAM_SUBMITTED: { label: 'Team returned revised drawing / calc', short: 'Team returned', who: 'Team → Us', stage: 'review' },
    SENT_TO_BIM: { label: 'Sent to BIM team', short: 'To BIM', who: 'Us → BIM', stage: 'with_bim' },
    BIM_RETURNED: { label: 'BIM returned Revit sheets', short: 'BIM returned', who: 'BIM → Us', stage: 'review' },
    SENT_TO_SCC: { label: 'Submitted to SCC', short: 'To SCC', who: 'Us → SCC', stage: 'with_scc' },
    SCC_TO_TCAP: { label: 'SCC forwarded to TCAP (SRR raised)', short: 'SCC → TCAP', who: 'SCC → TCAP', stage: 'with_tcap' },
    VENDOR_WAIT: { label: 'Waiting for vendor / SCC input', short: 'Vendor wait', who: 'Vendor', stage: 'vendor' },
    REMOVED: { label: 'Removed from deliverable list', short: 'Removed', who: 'Us', stage: 'removed' },
    NOTE: { label: 'Note / remark', short: 'Note', who: '' },
  };

  // ours = the ball is in our court (design team, BIM, us) → counts for delay alerts
  T.STAGES = {
    not_started: { label: 'Not started', owner: null, ours: false, order: 0 },
    with_us: { label: 'SRR received – forward to team', owner: 'Admin', ours: true, order: 1 },
    with_team: { label: 'With design team', owner: '@discipline', ours: true, order: 2 },
    review: { label: 'Under our review', owner: 'Admin', ours: true, order: 3 },
    with_bim: { label: 'With BIM', owner: 'BIM', ours: true, order: 4 },
    with_scc: { label: 'With SCC (to forward)', owner: 'SCC', ours: false, order: 5 },
    with_tcap: { label: 'Under TCAP review', owner: 'TCAP', ours: false, order: 6 },
    vendor: { label: 'Waiting vendor / SCC input', owner: 'SCC', ours: false, order: 7 },
    closed: { label: 'Closed', owner: null, ours: false, order: 8 },
    removed: { label: 'Removed', owner: null, ours: false, order: 9 },
  };

  /* ---------- dates (all stored as YYYY-MM-DD) ---------- */
  T.today = () => T.iso(new Date());
  T.iso = (d) => {
    const z = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  };
  T.parseIso = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  T.days = (from, to) => {
    if (!from || !to) return null;
    const a = T.parseIso(from), b = T.parseIso(to);
    return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
      Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
  };
  T.addDays = (s, n) => { const d = T.parseIso(s); d.setDate(d.getDate() + n); return T.iso(d); };
  T.fmt = (s) => {
    if (!s) return '—';
    const d = T.parseIso(s);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
  };
  // Monday-based week containing `s`
  T.weekOf = (s) => {
    const d = T.parseIso(s);
    const dow = (d.getDay() + 6) % 7;
    const start = T.addDays(s, -dow);
    return { start, end: T.addDays(start, 6) };
  };
  T.inRange = (s, r) => !!s && s >= r.start && s <= r.end;

  T.uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  /* ---------- events & derived state ---------- */
  // Events without a date (imported history) sort before dated ones; ties keep entry order.
  T.sortedEvents = (d) =>
    d.events.map((e, i) => [e, i])
      .sort((a, b) => (a[0].date || '').localeCompare(b[0].date || '') || a[1] - b[1])
      .map((x) => x[0]);

  T.ersStage = (e) => (e.code === 'NONO' || e.closed ? 'closed' : 'with_us');

  T.teamFor = (d, settings) => (settings.discTeam || T.DEFAULT_DISC_TEAM)[d.discipline] || 'MEPF';

  T.state = (d, settings, today) => {
    today = today || T.today();
    let stage = 'not_started', since = null, srr = null, code = null, cycles = 0;
    let lastErs = null, firstSubmit = null, closedOn = null;
    for (const e of T.sortedEvents(d)) {
      let next = null;
      if (e.type === 'ERS_RECEIVED') {
        next = T.ersStage(e);
        cycles++;
        lastErs = e;
        if (e.code) code = e.code;
        if (next === 'closed') closedOn = e.date;
      } else if (T.EVENTS[e.type] && T.EVENTS[e.type].stage) {
        next = T.EVENTS[e.type].stage;
        if ((e.type === 'SENT_TO_SCC' || e.type === 'SCC_TO_TCAP') && !firstSubmit) firstSubmit = e.date;
      }
      if (e.srr) srr = e.srr;
      if (next) { stage = next; since = e.date || since; }
    }
    if (d.removed) stage = 'removed';
    const st = T.STAGES[stage];
    const owner = st.owner === '@discipline' ? T.teamFor(d, settings) : st.owner;
    const age = since ? T.days(since, today) : null;
    const delayed = st.ours && age !== null && age > (settings.delayDays || 7);
    return { stage, since, age, owner, delayed, srr, code, cycles, lastErs, firstSubmit, closedOn };
  };

  /* Time the ball spent with each party, and total days from first submission to closure. */
  T.analytics = (d, settings, today) => {
    const evs = T.sortedEvents(d).filter((e) => e.date);
    const stageDays = {};
    let cur = null, curDate = null;
    for (const e of evs) {
      const next = e.type === 'ERS_RECEIVED' ? T.ersStage(e) : (T.EVENTS[e.type] || {}).stage;
      if (!next) continue;
      if (cur && curDate) stageDays[cur] = (stageDays[cur] || 0) + Math.max(0, T.days(curDate, e.date));
      cur = next; curDate = e.date;
    }
    if (cur && curDate && cur !== 'closed' && cur !== 'removed')
      stageDays[cur] = (stageDays[cur] || 0) + Math.max(0, T.days(curDate, today || T.today()));
    const s = T.state(d, settings, today);
    const chain = d.events.filter((e) => e.type === 'ERS_RECEIVED').map((e) => `${e.srr || '?'} ${e.code || ''}`.trim());
    return {
      ...s,
      stageDays,
      chain,
      daysToClose: s.closedOn && s.firstSubmit ? T.days(s.firstSubmit, s.closedOn) : null,
      openDays: !s.closedOn && s.firstSubmit ? T.days(s.firstSubmit, today || T.today()) : null,
    };
  };

  /* Weekly report: SRRs received, resubmissions made, closures, current delays. */
  T.weekly = (db, weekStartIso, today) => {
    const r = T.weekOf(weekStartIso);
    const srrIn = new Map(), srrOut = new Set();
    let docsIn = 0, docsOut = 0, closed = 0, toBim = 0, toTeam = 0;
    for (const d of db.deliverables) {
      for (const e of d.events) {
        if (!T.inRange(e.date, r)) continue;
        if (e.type === 'ERS_RECEIVED') {
          docsIn++;
          if (e.srr) srrIn.set(e.srr, (srrIn.get(e.srr) || 0) + 1);
          if (T.ersStage(e) === 'closed') closed++;
        }
        if (e.type === 'SENT_TO_SCC') { docsOut++; if (e.srr) srrOut.add(e.srr); }
        if (e.type === 'SENT_TO_BIM') toBim++;
        if (e.type === 'SENT_TO_TEAM') toTeam++;
      }
    }
    const delayed = db.deliverables.filter((d) => T.state(d, db.settings, today).delayed);
    return { range: r, srrIn, srrOut, docsIn, docsOut, closed, toBim, toTeam, delayed };
  };

  T.isClosed = (s) => s.stage === 'closed';

  /* Sheet-weighted progress (useful for payment milestones). */
  T.progress = (list, settings, today) => {
    let total = 0, closed = 0, submitted = 0;
    for (const d of list) {
      const s = T.state(d, settings, today);
      if (s.stage === 'removed') continue;
      const n = d.sheets || 1;
      total += n;
      if (s.stage === 'closed') closed += n;
      if (s.firstSubmit || s.cycles) submitted += n;
    }
    return { total, closed, submitted, pct: total ? Math.round((closed / total) * 100) : 0 };
  };

  T.blankDb = () => ({
    version: 1,
    settings: {
      appName: 'SubmitTrack',
      projectName: 'MTC',
      delayDays: 7,
      discTeam: { ...T.DEFAULT_DISC_TEAM },
      waPrefix: '91',
    },
    people: [
      { id: 'admin', name: 'Sahil', role: 'admin', team: 'Admin', phone: '', email: '' },
    ],
    deliverables: [],
    outbox: [],
    log: [],
  });
})();
