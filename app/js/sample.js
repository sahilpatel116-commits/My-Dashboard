/* Fictional demo data so the app can be tried before importing the real register. */
(function () {
  const T = window.T;
  const t = T.today();
  const ago = (n) => T.addDays(t, -n);
  const ev = (type, date, extra) => ({ id: T.uid(), type, date, by: 'demo', ...extra });
  const D = (station, discipline, code, title, events, more) => ({
    id: T.uid(), station, discipline, group: '', code, title,
    type: /calc|dbr/i.test(title) ? 'calculation' : 'drawing',
    sheets: 1, subs: [], baseline: true, removed: false, events, ...more,
  });

  T.sampleDb = function () {
    const db = T.blankDb();
    db.settings.projectName = 'Demo Project';
    db.people = [
      { id: 'admin', name: 'Sahil', role: 'admin', team: 'Admin', phone: '', email: '' },
      { id: T.uid(), name: 'MEPF Lead (demo)', role: 'team', team: 'MEPF', phone: '', email: 'mepf@example.com' },
      { id: T.uid(), name: 'Structure Lead (demo)', role: 'team', team: 'Structure', phone: '', email: 'str@example.com' },
      { id: T.uid(), name: 'Architect (demo)', role: 'team', team: 'Architecture', phone: '', email: 'arch@example.com' },
      { id: T.uid(), name: 'BIM Coordinator (demo)', role: 'team', team: 'BIM', phone: '', email: 'bim@example.com' },
      { id: T.uid(), name: 'Client Viewer (demo)', role: 'client', team: 'Client', phone: '', email: '' },
    ];
    db.deliverables = [
      D('Station A', 'HVAC', '24000', 'HVAC Design Basis Report', [
        ev('SCC_TO_TCAP', ago(120), { srr: 'SRR-101' }),
        ev('ERS_RECEIVED', ago(100), { srr: 'SRR-101', code: 'NOO' }),
        ev('SENT_TO_TEAM', ago(99)),
        ev('TEAM_SUBMITTED', ago(90)),
        ev('SENT_TO_SCC', ago(88)),
        ev('ERS_RECEIVED', ago(60), { srr: 'SRR-160', code: 'NONO' }),
      ]),
      D('Station A', 'HVAC', '24001', 'Heat Load Calculation', [
        ev('SENT_TO_SCC', ago(40)),
        ev('ERS_RECEIVED', ago(4), { srr: 'SRR-210', code: 'NONOC' }),
      ]),
      D('Station A', 'HVAC', '24015–24018', 'Ventilation Layout GF–3F (4 nos)', [
        ev('ERS_RECEIVED', ago(20), { srr: 'SRR-190', code: 'NOO' }),
        ev('SENT_TO_TEAM', ago(19)),
        ev('TEAM_SUBMITTED', ago(15)),
        ev('SENT_TO_BIM', ago(14)),
      ], { sheets: 4, subs: [['Ground Floor', '24015'], ['First Floor', '24016'], ['Second Floor', '24017'], ['Third Floor', '24018']] }),
      D('Station A', 'Fire Fighting', '26010', 'Fire Fighting Layout – Site Plan', [
        ev('ERS_RECEIVED', ago(12), { srr: 'SRR-195', code: 'NOO' }),
        ev('SENT_TO_TEAM', ago(11)),
      ]),
      D('Station A', 'Structural', '30001', 'Foundation Layout', [
        ev('SENT_TO_SCC', ago(30)),
        ev('SCC_TO_TCAP', ago(27), { srr: 'SRR-200' }),
      ]),
      D('Station A', 'Architectural', '10001', 'Ground Floor Plan', [
        ev('ERS_RECEIVED', ago(2), { srr: 'SRR-215', code: 'NR' }),
      ]),
      D('Station B', 'Electrical', '28001', 'Electrical SLD', [
        ev('ERS_RECEIVED', ago(16), { srr: 'SRR-180', code: 'NOO' }),
        ev('SENT_TO_TEAM', ago(15)),
        ev('TEAM_SUBMITTED', ago(9)),
        ev('SENT_TO_BIM', ago(8)),
        ev('BIM_RETURNED', ago(5)),
        ev('SENT_TO_BIM', ago(4), { note: 'Correction: tag names' }),
        ev('BIM_RETURNED', ago(3)),
        ev('SENT_TO_SCC', ago(2)),
      ]),
      D('Station B', 'Plumbing (PHE)', '27001', 'Water Supply Calculation', []),
      D('Station B', 'ELV', '29001', 'BMS Schematic', [ev('VENDOR_WAIT', ago(25))]),
    ];
    return db;
  };
})();
