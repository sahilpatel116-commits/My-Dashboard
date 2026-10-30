/* UI: routing, role-based views and all screens. Data lives in localStorage for v1
 * (see docs/PLAN.md for the shared-database phase). */
(function () {
  const T = window.T;
  const KEY = 'submittrack.db.v1', USER_KEY = 'submittrack.user';
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- storage ---------- */
  let db;
  function load() {
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { db = null; }
    if (!db || !db.deliverables) db = T.blankDb();
    db.settings = { ...T.blankDb().settings, ...db.settings };
    db.outbox = db.outbox || []; db.log = db.log || [];
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); }
    catch (e) { toast('Could not save — browser storage is full or blocked. Download a backup now.'); }
  }
  function log(text) { db.log.unshift({ ts: new Date().toISOString(), user: me().name, text }); db.log.length = Math.min(db.log.length, 500); }

  /* ---------- session & permissions ---------- */
  const me = () => db.people.find((p) => p.id === localStorage.getItem(USER_KEY)) || db.people[0];
  const isAdmin = () => me().role === 'admin';
  const isClient = () => me().role === 'client';
  function allowedEvents(d) {
    const u = me();
    if (u.role === 'admin') return Object.keys(T.EVENTS);
    if (u.role === 'client') return [];
    const out = ['NOTE'];
    if (u.team === 'BIM') out.push('BIM_RETURNED');
    if (u.team === T.teamFor(d, db.settings)) out.push('TEAM_SUBMITTED');
    return out;
  }

  /* ---------- small UI helpers ---------- */
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.classList.add('on');
    clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 3200);
  }
  const codeChip = (c, closed) => c ? `<span class="code code-${c}">${c}${closed && c === 'NONOC' ? ' ✓' : ''}</span>` : '<span class="muted">—</span>';
  function stageChip(s) {
    let label = T.STAGES[s.stage].label;
    // the client sees our internal steps as one "in preparation" stage
    if (isClient() && ['with_us', 'with_team', 'review', 'with_bim'].includes(s.stage)) label = 'In preparation (Design Consultant)';
    return `<span class="stage st-${s.stage}">${esc(label)}</span>`;
  }
  const ageChip = (s) => s.age == null ? '' : `<span class="age ${s.delayed ? 'late' : ''}">${s.age}d</span>`;
  const st = (d) => T.state(d, db.settings);
  const live = () => db.deliverables.filter((d) => !d.removed);
  const opts = (list, sel, all) => (all ? `<option value="">${all}</option>` : '') + list.map((v) => {
    const [val, lab] = Array.isArray(v) ? v : [v, v];
    return `<option value="${esc(val)}" ${val === sel ? 'selected' : ''}>${esc(lab)}</option>`;
  }).join('');
  const disciplines = () => [...new Set(db.deliverables.map((d) => d.discipline))];

  /* ---------- notifications (queued in outbox; sent by one click on WhatsApp / email) ---------- */
  function recipients(team) { return db.people.filter((p) => p.team === team && p.role !== 'client'); }
  function queue(team, subject, lines, kind) {
    const people = recipients(team);
    const body = `${db.settings.projectName} – ${subject}\n\n${lines.join('\n')}\n\n— ${db.settings.appName}`;
    const targets = people.length ? people : [{ id: null, name: `${team} (no contact saved)` }];
    for (const p of targets)
      db.outbox.unshift({ id: T.uid(), ts: new Date().toISOString(), to: p.id, toName: p.name, team, subject, body, kind, status: 'queued' });
    return targets.length;
  }
  const line = (d, extra) => `• ${d.station} | ${d.discipline} | ${d.code} ${d.title}${extra ? ' — ' + extra : ''}`;

  /* ---------- Excel export (SheetJS, loaded on demand; CSV fallback when offline) ---------- */
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = () => res(window.XLSX); s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  function exportRows(list) {
    const reg = [], hist = [], cyc = [];
    for (const d of list) {
      const a = T.analytics(d, db.settings);
      reg.push({
        Station: d.station, Discipline: d.discipline, Group: d.group, Code: d.code, Title: d.title, Type: d.type,
        Sheets: d.sheets, 'Added later': d.baseline ? '' : 'Yes', 'Latest SRR': a.srr || '', 'Latest code': a.code || '',
        Stage: T.STAGES[a.stage].label, 'With': a.owner || '', 'Days in stage': a.age ?? '', Delayed: a.delayed ? 'YES' : '',
      });
      for (const e of T.sortedEvents(d)) {
        if (isClient() && e.type === 'NOTE') continue;
        hist.push({
          Station: d.station, Discipline: d.discipline, Code: d.code, Title: d.title, Date: e.date || '',
          Event: T.EVENTS[e.type].label, SRR: e.srr || '', 'Response code': e.code || '', Note: e.note || '', By: e.by || '',
        });
      }
      cyc.push({
        Station: d.station, Discipline: d.discipline, Code: d.code, Title: d.title, 'Total SRRs received': a.cycles,
        'SRR chain': a.chain.join(' → '), 'First submitted': a.firstSubmit || '', 'Closed on': a.closedOn || '',
        'Days to close': a.daysToClose ?? '', 'Open for (days)': a.openDays ?? '',
        'Days with team': a.stageDays.with_team || 0, 'Days with BIM': a.stageDays.with_bim || 0,
        'Days in our review': (a.stageDays.review || 0) + (a.stageDays.with_us || 0),
        'Days with SCC': a.stageDays.with_scc || 0, 'Days with TCAP': a.stageDays.with_tcap || 0,
      });
    }
    return { Register: reg, 'SRR history': hist, 'Cycle summary': cyc };
  }
  async function exportExcel(list, name) {
    const sheets = exportRows(list);
    try {
      const X = await loadXlsx();
      const wb = X.utils.book_new();
      for (const [n, rows] of Object.entries(sheets)) X.utils.book_append_sheet(wb, X.utils.json_to_sheet(rows), n);
      X.writeFile(wb, `${name}-${T.today()}.xlsx`);
    } catch (e) {
      const rows = sheets['SRR history'];
      const cols = Object.keys(rows[0] || { Empty: '' });
      const csv = [cols.join(',')].concat(rows.map((r) => cols.map((c) => `"${String(r[c]).replace(/"/g, '""')}"`).join(','))).join('\n');
      download(`${name}-history-${T.today()}.csv`, csv, 'text/csv');
      toast('Excel library unavailable offline — downloaded CSV instead.');
    }
  }
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- layout ---------- */
  const NAV = [
    ['dashboard', 'Dashboard', ['admin', 'team', 'client']],
    ['mywork', 'My work', ['team']],
    ['register', 'Register', ['admin', 'team', 'client']],
    ['inbox', 'SRR Inbox', ['admin']],
    ['followup', 'Follow-ups', ['admin']],
    ['outbox', 'Outbox', ['admin']],
    ['analytics', 'Analytics', ['admin', 'client']],
    ['team', 'Team', ['admin']],
    ['settings', 'Settings', ['admin']],
  ];
  function shell() {
    const u = me(), page = route();
    const queued = db.outbox.filter((m) => m.status === 'queued').length;
    document.title = `${db.settings.appName} · ${db.settings.projectName}`;
    $('#brand').innerHTML = `<b>${esc(db.settings.appName)}</b><span>${esc(db.settings.projectName)} · deliverable tracking</span>`;
    $('#nav').innerHTML = NAV.filter((n) => n[2].includes(u.role)).map((n) =>
      `<a href="#/${n[0]}" class="${page === n[0] ? 'on' : ''}">${n[1]}${n[0] === 'outbox' && queued ? ` <i class="badge">${queued}</i>` : ''}</a>`).join('');
    $('#who').innerHTML = `<label>Viewing as <select data-act="switch-user">${opts(db.people.map((p) => [p.id, `${p.name} · ${p.role === 'team' ? p.team : T.ROLES[p.role]}`]), u.id)}</select></label>`;
  }
  const route = () => {
    const p = (location.hash.replace(/^#\/?/, '').split('?')[0]) || 'dashboard';
    const ok = NAV.find((n) => n[0] === p && n[2].includes(me().role));
    return ok ? p : 'dashboard';
  };
  function render() {
    shell();
    const page = route();
    $('#main').innerHTML = PAGES[page]();
    if (AFTER[page]) AFTER[page]();
  }

  /* ================= PAGES ================= */
  const ui = { week: null, f: { station: '', discipline: '', stage: '', code: '', q: '', delayed: false }, limit: 200, sel: new Set(), parsed: null };

  const PAGES = {};
  const AFTER = {};

  /* ----- Dashboard ----- */
  PAGES.dashboard = function () {
    if (!db.deliverables.length) return emptyState();
    const w = T.weekly(db, ui.week || T.today());
    const client = isClient();
    const list = live();
    const states = list.map((d) => [d, st(d)]);
    const byStage = {};
    for (const [, s] of states) byStage[s.stage] = (byStage[s.stage] || 0) + 1;
    const p = T.progress(list, db.settings);
    const srrRows = [...w.srrIn.entries()].map(([srr, n]) => `<li><b>${esc(srr)}</b> · ${n} doc${n > 1 ? 's' : ''}</li>`).join('') || '<li class="muted">None this week</li>';
    const late = w.delayed.slice().sort((a, b) => st(b).age - st(a).age).slice(0, 12);

    const tiles = [
      ['SRRs received', w.srrIn.size, `${w.docsIn} documents`],
      ['Resubmitted to SCC', w.docsOut, 'documents this week'],
      ['Closed (NONO)', w.closed, 'this week'],
    ];
    if (!client) tiles.push(['Delayed > ' + db.settings.delayDays + ' days', w.delayed.length, 'pending on our side, now', w.delayed.length ? 'bad' : '']);

    const stageBar = Object.keys(T.STAGES).filter((k) => byStage[k] && k !== 'removed').map((k) =>
      `<div class="seg st-${k}" style="flex:${byStage[k]}" title="${esc(T.STAGES[k].label)}: ${byStage[k]}"></div>`).join('');
    const stageLegend = Object.keys(T.STAGES).filter((k) => byStage[k] && k !== 'removed').map((k) =>
      `<a class="leg" href="#/register" data-act="filter-stage" data-stage="${k}"><i class="dot st-${k}"></i>${esc(T.STAGES[k].label)} <b>${byStage[k]}</b></a>`).join('');

    return `
      <section class="titleblock">
        <div class="tb-row">
          <div><div class="eyebrow">Weekly report</div><h1>${esc(db.settings.projectName)} — week of ${T.fmt(w.range.start)}</h1>
            <div class="sub">${T.fmt(w.range.start)} to ${T.fmt(w.range.end)} · ${list.length} deliverables · ${p.total} sheets</div></div>
          <div class="weeknav">
            <button data-act="week" data-d="-7">‹ Prev</button><button data-act="week" data-d="0">This week</button><button data-act="week" data-d="7">Next ›</button>
          </div>
        </div>
        <div class="kpis">${tiles.map((t) => `<div class="kpi ${t[3] || ''}"><b>${t[0]}</b><span>${t[1]}</span><small>${t[2]}</small></div>`).join('')}
          <div class="kpi"><b>Overall closed</b><span>${p.pct}%</span><small>${p.closed} of ${p.total} sheets</small></div></div>
      </section>

      <section class="card">
        <h2>Where is everything right now?</h2>
        <div class="bar">${stageBar}</div>
        <div class="legend">${stageLegend}</div>
      </section>

      <div class="grid2">
        <section class="card"><h2>SRRs received this week</h2><ul class="plain">${srrRows}</ul></section>
        ${client ? progressCard(list) : `<section class="card"><h2>Delayed — ball in our court</h2>${late.length ? table(late, ['station', 'discipline', 'code', 'title', 'with', 'age']) : '<p class="muted">Nothing delayed. 👍</p>'}</section>`}
      </div>
      ${client ? '' : progressCard(list)}`;
  };
  function progressCard(list) {
    const stations = [...new Set(list.map((d) => d.station))], discs = [...new Set(list.map((d) => d.discipline))];
    const cell = (s, di) => {
      const sub = list.filter((d) => d.station === s && d.discipline === di);
      if (!sub.length) return '<td class="muted">—</td>';
      const p = T.progress(sub, db.settings);
      return `<td><div class="pbar"><i style="width:${p.pct}%"></i></div><small>${p.closed}/${p.total}</small></td>`;
    };
    return `<section class="card"><h2>Closure progress by station (sheets closed / total)</h2><div class="scroll"><table class="tbl matrix">
      <tr><th></th>${discs.map((d) => `<th>${esc(d)}</th>`).join('')}</tr>
      ${stations.map((s) => `<tr><th>${esc(s)}</th>${discs.map((di) => cell(s, di)).join('')}</tr>`).join('')}</table></div></section>`;
  }
  function emptyState() {
    return `<section class="card empty"><h1>Welcome${isAdmin() ? ', ' + esc(me().name) : ''}</h1>
      <p>The register is empty. ${isAdmin() ? 'Import your current MTC dashboard (the HTML file), or load demo data to try the app.' : 'Ask the administrator to load the register.'}</p>
      ${isAdmin() ? `<div class="row"><label class="btn primary">Import old dashboard HTML<input type="file" accept=".html,.htm" data-act="import-html" hidden></label>
      <button class="btn" data-act="demo">Load demo data</button></div>` : ''}</section>`;
  }

  /* ----- generic deliverable table ----- */
  function table(list, cols, selectable) {
    const H = { station: 'Station', discipline: 'Discipline', code: 'Code', title: 'Title', srr: 'Latest SRR', rc: 'Code', stage: 'Stage', with: 'With', age: 'Days', cycles: 'SRRs' };
    return `<div class="scroll"><table class="tbl">
      <tr>${selectable ? '<th><input type="checkbox" data-act="sel-all"></th>' : ''}${cols.map((c) => `<th>${H[c]}</th>`).join('')}</tr>
      ${list.map((d) => {
        const s = st(d);
        const v = {
          station: esc(d.station), discipline: esc(d.discipline), code: `<span class="mono">${esc(d.code)}</span>`,
          title: `${esc(d.title)}${d.sheets > 1 ? ` <small class="muted">(${d.sheets} sh)</small>` : ''}${d.baseline ? '' : ' <small class="new">added</small>'}`,
          srr: `<span class="mono">${esc(s.srr || '—')}</span>`, rc: codeChip(s.code, s.lastErs && s.lastErs.closed), stage: stageChip(s),
          with: isClient() ? '' : esc(s.owner || '—'), age: isClient() ? '' : ageChip(s), cycles: s.cycles || '',
        };
        return `<tr data-act="open" data-id="${d.id}" class="${s.delayed && !isClient() ? 'late' : ''}">
          ${selectable ? `<td data-stop><input type="checkbox" data-act="sel" data-id="${d.id}" ${ui.sel.has(d.id) ? 'checked' : ''}></td>` : ''}
          ${cols.map((c) => `<td>${v[c]}</td>`).join('')}</tr>`;
      }).join('')}</table></div>`;
  }

  /* ----- Register ----- */
  function filtered() {
    const f = ui.f, q = f.q.toLowerCase();
    return db.deliverables.filter((d) => {
      if (f.station && d.station !== f.station) return false;
      if (f.discipline && d.discipline !== f.discipline) return false;
      const s = st(d);
      if (f.stage ? s.stage !== f.stage : s.stage === 'removed') return false;
      if (f.code && s.code !== f.code) return false;
      if (f.delayed && !s.delayed) return false;
      if (q && !`${d.code} ${d.title} ${s.srr || ''} ${d.group}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }
  PAGES.register = function () {
    if (!db.deliverables.length) return emptyState();
    const f = ui.f, list = filtered();
    const cols = isClient() ? ['station', 'discipline', 'code', 'title', 'srr', 'rc', 'stage', 'cycles'] : ['station', 'discipline', 'code', 'title', 'srr', 'rc', 'stage', 'with', 'age', 'cycles'];
    return `<section class="card">
      <div class="filters">
        <input type="search" placeholder="Search code, title, SRR…" value="${esc(f.q)}" data-f="q">
        <select data-f="station">${opts(T.stations(db), f.station, 'All stations')}</select>
        <select data-f="discipline">${opts(disciplines(), f.discipline, 'All disciplines')}</select>
        <select data-f="stage">${opts(Object.keys(T.STAGES).map((k) => [k, T.STAGES[k].label]), f.stage, 'All stages')}</select>
        <select data-f="code">${opts(T.CODES, f.code, 'Any code')}</select>
        ${isClient() ? '' : `<label class="chk"><input type="checkbox" data-f="delayed" ${f.delayed ? 'checked' : ''}> Delayed only</label>`}
        <span class="grow"></span>
        <button class="btn" data-act="export-filtered">Export Excel</button>
        ${isAdmin() ? '<button class="btn" data-act="new-deliverable">+ New sheet</button>' : ''}
      </div>
      <div class="muted small">${list.length} deliverables shown${list.length > ui.limit ? ` (first ${ui.limit})` : ''}. Click a row for its full SRR history.</div>
      ${isAdmin() ? bulkBar() : ''}
      ${table(list.slice(0, ui.limit), cols, isAdmin())}
      ${list.length > ui.limit ? '<button class="btn wide" data-act="more">Show more</button>' : ''}
    </section>`;
  };
  function bulkBar() {
    if (!ui.sel.size) return '';
    return `<div class="bulk"><b>${ui.sel.size} selected</b>
      <select id="bulk-type">${opts(Object.keys(T.EVENTS).filter((k) => k !== 'REMOVED').map((k) => [k, T.EVENTS[k].label]))}</select>
      <input type="date" id="bulk-date" value="${T.today()}">
      <input id="bulk-srr" placeholder="SRR no. (optional)" size="10">
      <select id="bulk-code">${opts(T.CODES, '', 'code…')}</select>
      <label class="chk"><input type="checkbox" id="bulk-notify" checked> Notify team</label>
      <button class="btn primary" data-act="bulk-apply">Apply to selected</button>
      <button class="btn" data-act="bulk-clear">Clear</button></div>`;
  }

  /* ----- My work (team members) ----- */
  PAGES.mywork = function () {
    const u = me();
    const mine = live().filter((d) => {
      const s = st(d);
      return s.owner === u.team && !['closed', 'removed'].includes(s.stage);
    }).sort((a, b) => (st(b).age || 0) - (st(a).age || 0));
    return `<section class="card"><h2>Pending with ${esc(u.team)} — ${mine.length}</h2>
      <p class="muted small">Oldest first. Rows in red are past ${db.settings.delayDays} days. Open a row and add “${u.team === 'BIM' ? 'BIM returned Revit sheets' : 'Team returned revised drawing / calc'}” when you send it back.</p>
      ${mine.length ? table(mine, ['station', 'discipline', 'code', 'title', 'srr', 'rc', 'stage', 'age']) : '<p class="muted">Nothing pending. 👍</p>'}</section>`;
  };

  /* ----- SRR Inbox: paste email → review → confirm ----- */
  PAGES.inbox = function () {
    const p = ui.parsed;
    return `<section class="card">
      <h2>SRR Inbox — paste the Outlook email</h2>
      <p class="muted small">Copy the whole mail from the SCC document controller (subject, “Sent:” line and the document list) and paste it below, or drop a saved .eml / .txt file. The app finds the SRR number, response codes and drawing numbers, and shows you what it will update. Nothing is saved until you confirm.</p>
      <textarea id="mail" rows="9" placeholder="Paste email here…">${esc(ui.mailText || '')}</textarea>
      <div class="filters">
        <label>Station <select id="in-station">${opts(T.stations(db), p ? p.station : '', 'Auto-detect')}</select></label>
        <label>This email is <select id="in-mode">${opts([['ers', 'TCAP response (ERS / SRR codes received)'], ['tcap', 'SCC forwarded our submission to TCAP (SRR no. raised)']], p ? p.mode : '', 'Auto-detect')}</select></label>
        <label>Received on <input type="date" id="in-date" value="${p ? p.date : ''}"></label>
        <label class="btn">Load .eml / .txt<input type="file" accept=".eml,.txt" data-act="mail-file" hidden></label>
        <button class="btn primary" data-act="parse">Read email</button>
      </div>
    </section>
    ${p ? inboxPreview(p) : ''}`;
  };
  function inboxPreview(p) {
    const ers = p.mode === 'ers';
    return `<section class="card">
      <h2>Proposed update — ${p.rows.length} deliverable${p.rows.length === 1 ? '' : 's'}</h2>
      <div class="muted small">SRRs found: <b>${esc(p.srrs.join(', ') || 'none')}</b> · codes found: <b>${esc(p.codes.join(', ') || 'none')}</b> · station: <b>${esc(p.station || 'not detected')}</b>
      ${p.unmatched.length ? `<br>Numbers not in the ${esc(p.station || '')} register (ignored): <span class="mono">${esc(p.unmatched.join(', '))}</span>` : ''}</div>
      <div class="scroll"><table class="tbl"><tr><th>✓</th><th>Discipline</th><th>Code</th><th>Title</th><th>SRR</th>${ers ? '<th>Response</th><th>NONOC closed?</th>' : ''}<th>Now</th></tr>
      ${p.rows.map((r, i) => `<tr><td><input type="checkbox" data-row="${i}" data-k="on" ${r.on !== false ? 'checked' : ''}></td>
        <td>${esc(r.d.discipline)}</td><td class="mono">${esc(r.d.code)}</td><td>${esc(r.d.title)}</td>
        <td><input size="9" data-row="${i}" data-k="srr" value="${esc(r.srr || '')}"></td>
        ${ers ? `<td><select data-row="${i}" data-k="code">${opts(T.CODES, r.code, '?')}</select></td>
        <td><input type="checkbox" data-row="${i}" data-k="closed" ${r.closed ? 'checked' : ''}></td>` : ''}
        <td>${stageChip(st(r.d))}</td></tr>`).join('')}
      </table></div>
      <div class="filters"><input id="add-row" placeholder="Add a deliverable by code or title…" list="dl-codes"><datalist id="dl-codes">${
        db.deliverables.filter((d) => !p.station || d.station === p.station).slice(0, 2000).map((d) => `<option value="${esc(d.code)} · ${esc(d.title)}">`).join('')}</datalist>
        <button class="btn" data-act="add-row">Add row</button></div>
      ${ers ? `<label class="chk"><input type="checkbox" id="fwd" checked> Also mark as forwarded to the design team today (starts their ${db.settings.delayDays}-day clock)</label>` : ''}
      <label class="chk"><input type="checkbox" id="notify" checked> Queue WhatsApp / email messages for the teams involved</label>
      <div class="row"><button class="btn primary" data-act="confirm-mail">Confirm & update register</button><button class="btn" data-act="discard-mail">Discard</button></div>
    </section>`;
  }

  /* ----- Follow-ups ----- */
  PAGES.followup = function () {
    const groups = {}, chase = [];
    const warnAt = Math.max(1, db.settings.delayDays - 2);
    for (const d of live()) {
      const s = st(d);
      if (T.STAGES[s.stage].ours && s.age != null && s.age >= warnAt) (groups[s.owner] = groups[s.owner] || []).push(d);
      if (['with_scc', 'with_tcap', 'vendor'].includes(s.stage) && s.age > db.settings.delayDays) chase.push(d);
    }
    const teams = Object.keys(groups);
    return `<section class="card"><h2>Follow-ups — pending on our side for ${warnAt}+ days</h2>
      <p class="muted small">Red = past ${db.settings.delayDays} days. “Queue reminder” prepares one WhatsApp/email per person in that team (see Outbox).</p>
      ${teams.length ? teams.map((t) => `<div class="group"><div class="row"><h3>${esc(t)} · ${groups[t].length}</h3><span class="grow"></span>
        <button class="btn primary" data-act="remind" data-team="${esc(t)}">Queue reminder</button></div>
        ${table(groups[t].sort((a, b) => st(b).age - st(a).age), ['station', 'discipline', 'code', 'title', 'srr', 'rc', 'stage', 'age'])}</div>`).join('') : '<p class="muted">Nothing pending. 👍</p>'}
    </section>
    <section class="card"><h2>Waiting on SCC / TCAP / vendor for ${db.settings.delayDays}+ days — ${chase.length}</h2>
      ${chase.length ? `<div class="row"><span class="grow"></span><button class="btn" data-act="remind-scc">Queue chaser to SCC</button></div>${table(chase.sort((a, b) => st(b).age - st(a).age), ['station', 'discipline', 'code', 'title', 'srr', 'stage', 'age'])}` : '<p class="muted">Nothing waiting too long.</p>'}
    </section>`;
  };

  /* ----- Outbox ----- */
  PAGES.outbox = function () {
    const q = db.outbox.filter((m) => m.status === 'queued'), sent = db.outbox.filter((m) => m.status !== 'queued').slice(0, 50);
    const item = (m) => {
      const p = db.people.find((x) => x.id === m.to) || {};
      const phone = (p.phone || '').replace(/\D/g, '');
      const wa = phone ? `https://wa.me/${phone.length === 10 ? db.settings.waPrefix + phone : phone}?text=${encodeURIComponent(m.body)}` : '';
      const mail = p.email ? `mailto:${encodeURIComponent(p.email)}?subject=${encodeURIComponent(db.settings.projectName + ' – ' + m.subject)}&body=${encodeURIComponent(m.body)}` : '';
      return `<div class="msg ${m.status}"><div class="row"><b>${esc(m.toName)}</b><span class="muted small">${esc(m.team)} · ${new Date(m.ts).toLocaleString('en-GB')}</span><span class="grow"></span>
        ${wa ? `<a class="btn wa" target="_blank" rel="noopener" href="${wa}" data-act="sent" data-id="${m.id}">WhatsApp</a>` : ''}
        ${mail ? `<a class="btn" href="${mail}" data-act="sent" data-id="${m.id}">Email</a>` : ''}
        <button class="btn" data-act="copy" data-id="${m.id}">Copy</button>
        ${m.status === 'queued' ? `<button class="btn" data-act="sent" data-id="${m.id}">Mark sent</button>` : '<span class="muted small">sent</span>'}
        <button class="btn ghost" data-act="del-msg" data-id="${m.id}">✕</button></div>
        ${!wa && !mail ? '<div class="warn small">No phone or email saved for this person — add it under Team.</div>' : ''}
        <pre>${esc(m.body)}</pre></div>`;
    };
    return `<section class="card"><h2>Outbox — ${q.length} to send</h2>
      <p class="muted small">v1 opens WhatsApp / your mail app with the message ready — one tap to send. Fully automatic sending comes in phase 2 (see docs/PLAN.md).</p>
      ${q.map(item).join('') || '<p class="muted">Nothing queued.</p>'}</section>
      ${sent.length ? `<section class="card"><h2>Recently sent</h2>${sent.map(item).join('')}</section>` : ''}`;
  };

  /* ----- Analytics ----- */
  PAGES.analytics = function () {
    const rows = {};
    const all = live().map((d) => [d, T.analytics(d, db.settings)]);
    for (const [d, a] of all) {
      const r = (rows[d.discipline] = rows[d.discipline] || { n: 0, closed: 0, close: [], cyc: [], team: [], bim: [], us: [], tcap: [] });
      r.n++;
      if (a.stage === 'closed') r.closed++;
      if (a.daysToClose != null) r.close.push(a.daysToClose);
      if (a.cycles) r.cyc.push(a.cycles);
      r.team.push(a.stageDays.with_team || 0); r.bim.push(a.stageDays.with_bim || 0);
      r.us.push((a.stageDays.review || 0) + (a.stageDays.with_us || 0)); r.tcap.push(a.stageDays.with_tcap || 0);
    }
    const avg = (x) => x.length ? (x.reduce((s, v) => s + v, 0) / x.length).toFixed(1) : '—';
    const longest = all.filter(([, a]) => a.openDays != null).sort((x, y) => y[1].openDays - x[1].openDays).slice(0, 15);
    const mostCycles = all.filter(([, a]) => a.cycles > 1).sort((x, y) => y[1].cycles - x[1].cycles).slice(0, 15);
    const client = isClient();
    return `<section class="card"><h2>Time to close, by discipline</h2>
      <p class="muted small">Days to close = first submission to SCC → NONO. ${client ? '' : 'Average days are only counted where dates are recorded in the app (imported history has fewer dates).'}</p>
      <div class="scroll"><table class="tbl"><tr><th>Discipline</th><th>Deliverables</th><th>Closed</th><th>Avg days to close</th><th>Avg SRRs per deliverable</th>${client ? '' : '<th>Avg days with team</th><th>Avg days with BIM</th><th>Avg days our review</th>'}<th>Avg days with TCAP</th></tr>
      ${Object.entries(rows).map(([k, r]) => `<tr><td>${esc(k)}</td><td>${r.n}</td><td>${r.closed}</td><td>${avg(r.close)}</td><td>${avg(r.cyc)}</td>${client ? '' : `<td>${avg(r.team)}</td><td>${avg(r.bim)}</td><td>${avg(r.us)}</td>`}<td>${avg(r.tcap)}</td></tr>`).join('')}
      </table></div><div class="row"><span class="grow"></span><button class="btn" data-act="export-all">Export full Excel (register + history + cycles)</button></div></section>
      <div class="grid2">
        <section class="card"><h2>Open the longest (since first submission)</h2>${listA(longest, (a) => a.openDays + ' days')}</section>
        <section class="card"><h2>Most review cycles</h2>${listA(mostCycles, (a) => a.chain.join(' → '))}</section>
      </div>`;
  };
  const listA = (l, f) => l.length ? `<ul class="plain">${l.map(([d, a]) => `<li data-act="open" data-id="${d.id}" class="link"><b class="mono">${esc(d.code)}</b> ${esc(d.title)} <small class="muted">${esc(d.station)} · ${esc(f(a))}</small></li>`).join('')}</ul>` : '<p class="muted">No data yet.</p>';

  /* ----- Team ----- */
  PAGES.team = function () {
    return `<section class="card"><h2>People & access</h2>
      <p class="muted small">Administrator: everything. Internal team: sees the full register, updates only their own items. Client: read-only, no internal remarks or BIM steps. Phone numbers: 10 digits get +${esc(db.settings.waPrefix)} added for WhatsApp.</p>
      <div class="scroll"><table class="tbl"><tr><th>Name</th><th>Access</th><th>Team</th><th>WhatsApp no.</th><th>Email</th><th></th></tr>
      ${db.people.map((p) => `<tr>
        <td><input data-p="${p.id}" data-k="name" value="${esc(p.name)}"></td>
        <td><select data-p="${p.id}" data-k="role">${opts(Object.entries(T.ROLES), p.role)}</select></td>
        <td><select data-p="${p.id}" data-k="team">${opts(T.TEAMS, p.team)}</select></td>
        <td><input data-p="${p.id}" data-k="phone" value="${esc(p.phone)}" size="13"></td>
        <td><input data-p="${p.id}" data-k="email" value="${esc(p.email)}"></td>
        <td>${p.id === 'admin' ? '' : `<button class="btn ghost" data-act="del-person" data-id="${p.id}">✕</button>`}</td></tr>`).join('')}
      </table></div><button class="btn" data-act="add-person">+ Add person</button></section>
      <section class="card"><h2>Which team handles which discipline</h2><div class="filters">
      ${disciplines().map((d) => `<label>${esc(d)} <select data-disc="${esc(d)}">${opts(T.TEAMS.filter((t) => !['Admin', 'SCC', 'Client', 'BIM'].includes(t)), T.teamFor({ discipline: d }, db.settings))}</select></label>`).join('')}
      </div></section>`;
  };

  /* ----- Settings ----- */
  PAGES.settings = function () {
    const s = db.settings;
    return `<section class="card"><h2>Project</h2><div class="filters">
      <label>App name <input data-s="appName" value="${esc(s.appName)}"></label>
      <label>Project <input data-s="projectName" value="${esc(s.projectName)}"></label>
      <label>Delay alert after (days) <input type="number" min="1" data-s="delayDays" value="${s.delayDays}" style="width:70px"></label>
      <label>WhatsApp country code <input data-s="waPrefix" value="${esc(s.waPrefix)}" style="width:60px"></label></div></section>
    <section class="card"><h2>Data</h2>
      <p class="muted small">v1 keeps data in this browser on this device. Download a backup regularly (and before clearing browser data).</p>
      <div class="row wrap">
        <label class="btn primary">Import old dashboard HTML<input type="file" accept=".html,.htm" data-act="import-html" hidden></label>
        <button class="btn" data-act="backup">Download backup (.json)</button>
        <label class="btn">Restore backup<input type="file" accept=".json" data-act="restore" hidden></label>
        <button class="btn" data-act="export-all">Export Excel</button>
        <button class="btn" data-act="demo">Load demo data</button>
        <button class="btn danger" data-act="reset">Erase all data</button>
      </div></section>
    <section class="card"><h2>Activity log</h2><ul class="plain small">${db.log.slice(0, 40).map((l) => `<li><span class="muted">${new Date(l.ts).toLocaleString('en-GB')} · ${esc(l.user)}</span> — ${esc(l.text)}</li>`).join('') || '<li class="muted">No activity yet.</li>'}</ul></section>`;
  };

  /* ----- Deliverable drawer ----- */
  function openDrawer(id) {
    const d = db.deliverables.find((x) => x.id === id);
    if (!d) return;
    const a = T.analytics(d, db.settings), client = isClient(), allowed = allowedEvents(d);
    const evs = T.sortedEvents(d).filter((e) => !(client && e.type === 'NOTE'));
    const hiddenForClient = ['SENT_TO_TEAM', 'TEAM_SUBMITTED', 'SENT_TO_BIM', 'BIM_RETURNED'];
    $('#drawer').innerHTML = `<div class="dr-head"><div><div class="eyebrow">${esc(d.station)} · ${esc(d.discipline)}${d.group ? ' · ' + esc(d.group) : ''}</div>
        <h2><span class="mono">${esc(d.code)}</span> ${esc(d.title)}</h2>
        <div class="row wrap">${stageChip(a)} ${codeChip(a.code, a.lastErs && a.lastErs.closed)} ${client ? '' : ageChip(a)}
        <span class="muted small">${d.type} · ${d.sheets} sheet${d.sheets > 1 ? 's' : ''} · ${a.cycles} SRR${a.cycles === 1 ? '' : 's'} received${a.daysToClose != null ? ` · closed in ${a.daysToClose} days` : ''}</span></div></div>
        <button class="btn ghost" data-act="close">✕</button></div>
      ${a.chain.length ? `<div class="chain">${a.chain.map((c) => `<span>${esc(c)}</span>`).join('<i>→</i>')}</div>` : ''}
      ${d.subs && d.subs.length ? `<details><summary>${d.subs.length} sheets in this set</summary><ul class="plain small">${d.subs.map((s) => `<li><span class="mono">${esc(s[1])}</span> ${esc(s[0])}</li>`).join('')}</ul></details>` : ''}
      <h3>History</h3>
      <ol class="timeline">${evs.map((e) => (client && hiddenForClient.includes(e.type)) ? '' : `<li class="ev-${e.type}">
        <span class="date">${e.date ? T.fmt(e.date) : '<i class="muted">date n/a</i>'}</span>
        <span class="what"><b>${esc(T.EVENTS[e.type].label)}</b> ${e.srr ? `<span class="mono">${esc(e.srr)}</span>` : ''} ${e.type === 'ERS_RECEIVED' ? codeChip(e.code, e.closed) : ''}
        ${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}<small class="muted">${esc(e.by || '')}</small></span>
        ${isAdmin() ? `<button class="btn ghost small" data-act="del-ev" data-id="${d.id}" data-ev="${e.id}" title="Delete">✕</button>` : ''}</li>`).join('') || '<li class="muted">No events yet.</li>'}</ol>
      ${allowed.length ? `<h3>Add update</h3><div class="filters" id="ev-form">
        <select id="ev-type">${opts(allowed.filter((k) => k !== 'REMOVED').map((k) => [k, T.EVENTS[k].label]))}</select>
        <input type="date" id="ev-date" value="${T.today()}">
        <input id="ev-srr" placeholder="SRR no." size="9">
        <select id="ev-code">${opts(T.CODES, '', 'code…')}</select>
        <label class="chk"><input type="checkbox" id="ev-closed"> NONOC accepted as closed</label>
        <input id="ev-note" placeholder="Note (optional)" class="grow">
        <label class="chk"><input type="checkbox" id="ev-notify" checked> Notify</label>
        <button class="btn primary" data-act="add-ev" data-id="${d.id}">Save</button></div>` : ''}
      ${isAdmin() ? `<details class="edit"><summary>Edit deliverable</summary><div class="filters">
        <label>Code <input id="ed-code" value="${esc(d.code)}"></label><label>Title <input id="ed-title" value="${esc(d.title)}" size="40"></label>
        <label>Sheets <input type="number" id="ed-sheets" value="${d.sheets}" style="width:70px"></label>
        <label>Type <select id="ed-type">${opts(['drawing', 'calculation'], d.type)}</select></label>
        <label class="chk"><input type="checkbox" id="ed-removed" ${d.removed ? 'checked' : ''}> Removed</label>
        <button class="btn" data-act="save-ed" data-id="${d.id}">Save changes</button></div></details>` : ''}
      <div class="row"><span class="grow"></span><button class="btn" data-act="export-one" data-id="${d.id}">Export history to Excel</button></div>`;
    $('#overlay').classList.add('on');
  }
  const closeDrawer = () => $('#overlay').classList.remove('on');

  /* ================= ACTIONS ================= */
  function addEvent(d, ev, notify) {
    d.events.push({ id: T.uid(), by: me().name, ...ev });
    if (notify) notifyFor([d], ev);
  }
  function notifyFor(list, ev) {
    const team = (d) => T.teamFor(d, db.settings);
    const groups = {};
    const to = (t, d) => (groups[t] = groups[t] || []).push(d);
    for (const d of list) {
      if (ev.type === 'SENT_TO_TEAM' || ev.type === 'ERS_RECEIVED') to(team(d), d);
      else if (ev.type === 'SENT_TO_BIM') to('BIM', d);
      else if (ev.type === 'TEAM_SUBMITTED' || ev.type === 'BIM_RETURNED') to('Admin', d);
    }
    let n = 0;
    for (const [t, items] of Object.entries(groups)) {
      const subj = {
        ERS_RECEIVED: `New SRR received${ev.srr ? ' ' + ev.srr : ''}`,
        SENT_TO_TEAM: 'SRR compliance required',
        SENT_TO_BIM: 'Drawings for BIM modelling',
        TEAM_SUBMITTED: 'Revised drawings received from team',
        BIM_RETURNED: 'BIM sheets returned for review',
      }[ev.type];
      const due = ev.type === 'SENT_TO_TEAM' || ev.type === 'SENT_TO_BIM' ? [`Please return within ${db.settings.delayDays} days (by ${T.fmt(T.addDays(ev.date || T.today(), db.settings.delayDays))}).`] : [];
      n += queue(t, subj, items.map((d) => line(d, [ev.srr || st(d).srr, ev.code].filter(Boolean).join(' '))).concat(due), ev.type);
    }
    return n;
  }

  function confirmMail() {
    const p = ui.parsed;
    const rows = p.rows.filter((r) => r.on !== false);
    if (!rows.length) return toast('Nothing selected.');
    if (p.mode === 'ers' && rows.some((r) => !r.code)) return toast('Choose a response code for every selected row.');
    const fwd = $('#fwd') && $('#fwd').checked, notify = $('#notify').checked;
    for (const r of rows) {
      if (p.mode === 'ers') {
        addEvent(r.d, { type: 'ERS_RECEIVED', date: p.date, srr: r.srr || null, code: r.code, closed: r.code === 'NONOC' && r.closed ? true : undefined });
        if (fwd && T.ersStage({ code: r.code, closed: r.closed }) !== 'closed') addEvent(r.d, { type: 'SENT_TO_TEAM', date: T.today() });
      } else {
        addEvent(r.d, { type: 'SCC_TO_TCAP', date: p.date, srr: r.srr || null });
      }
    }
    let n = 0;
    if (notify) {
      if (p.mode === 'ers') {
        const open = rows.filter((r) => st(r.d).stage !== 'closed');
        const bySrr = {};
        for (const r of rows) (bySrr[r.srr || ''] = bySrr[r.srr || ''] || []).push(r);
        for (const [srr, rs] of Object.entries(bySrr)) {
          const teams = {};
          for (const r of rs) (teams[T.teamFor(r.d, db.settings)] = teams[T.teamFor(r.d, db.settings)] || []).push(r);
          for (const [t, list] of Object.entries(teams)) {
            const pend = list.filter((r) => open.includes(r));
            n += queue(t, `New SRR received${srr ? ' ' + srr : ''} (${list.length} doc${list.length > 1 ? 's' : ''})`,
              list.map((r) => line(r.d, r.code)).concat(pend.length ? [`Compliance needed for ${pend.length}. Please send revised drawings/calcs within ${db.settings.delayDays} days (by ${T.fmt(T.addDays(T.today(), db.settings.delayDays))}).`] : ['All closed — no action needed.']), 'SRR');
          }
        }
      } else {
        const teams = {};
        for (const r of rows) (teams[T.teamFor(r.d, db.settings)] = teams[T.teamFor(r.d, db.settings)] || []).push(r);
        for (const [t, list] of Object.entries(teams)) n += queue(t, 'Submitted to TCAP', list.map((r) => line(r.d, r.srr)), 'TCAP');
      }
    }
    log(`Inbox: ${p.mode === 'ers' ? 'SRR response' : 'SCC→TCAP'} ${p.srrs.join(', ')} applied to ${rows.length} deliverables`);
    ui.parsed = null; ui.mailText = '';
    save();
    toast(`Updated ${rows.length} deliverables${n ? `, ${n} message(s) queued in Outbox` : ''}.`);
    location.hash = n ? '#/outbox' : '#/register';
    render();
  }

  function readFile(input, cb) {
    const f = input.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => cb(String(r.result), f.name);
    r.readAsText(f);
    input.value = '';
  }
  // .eml files are MIME; keep the readable text parts (quoted-printable is decoded roughly)
  function emlText(raw) {
    const body = raw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
    return body.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>|<\/(p|div|tr|li)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
  }

  const ACT = {
    'switch-user': (el) => { localStorage.setItem(USER_KEY, el.value); ui.sel.clear(); render(); },
    week: (el) => { const n = +el.dataset.d; ui.week = n ? T.addDays(ui.week || T.today(), n) : null; render(); },
    'filter-stage': (el) => { ui.f = { ...ui.f, stage: el.dataset.stage }; },
    open: (el) => openDrawer(el.dataset.id),
    close: closeDrawer,
    more: () => { ui.limit += 300; render(); },
    sel: (el) => { el.checked ? ui.sel.add(el.dataset.id) : ui.sel.delete(el.dataset.id); render(); },
    'sel-all': (el) => { filtered().slice(0, ui.limit).forEach((d) => (el.checked ? ui.sel.add(d.id) : ui.sel.delete(d.id))); render(); },
    'bulk-clear': () => { ui.sel.clear(); render(); },
    'bulk-apply': () => {
      const ev = { type: $('#bulk-type').value, date: $('#bulk-date').value || T.today(), srr: $('#bulk-srr').value.trim() || null };
      if (ev.type === 'ERS_RECEIVED') { ev.code = $('#bulk-code').value; if (!ev.code) return toast('Choose the response code.'); }
      const list = db.deliverables.filter((d) => ui.sel.has(d.id));
      list.forEach((d) => addEvent(d, ev, false));
      const n = $('#bulk-notify').checked ? notifyFor(list, ev) : 0;
      log(`${T.EVENTS[ev.type].label} — ${list.length} deliverables`);
      ui.sel.clear(); save(); render();
      toast(`Updated ${list.length}${n ? `, ${n} message(s) queued` : ''}.`);
    },
    'add-ev': (el) => {
      const d = db.deliverables.find((x) => x.id === el.dataset.id);
      const ev = { type: $('#ev-type').value, date: $('#ev-date').value || T.today(), srr: $('#ev-srr').value.trim() || null, note: $('#ev-note').value.trim() || undefined };
      if (ev.type === 'ERS_RECEIVED') {
        ev.code = $('#ev-code').value;
        if (!ev.code) return toast('Choose the response code.');
        if (ev.code === 'NONOC' && $('#ev-closed').checked) ev.closed = true;
      }
      if (ev.type === 'NOTE' && !ev.note) return toast('Write the note first.');
      addEvent(d, ev, $('#ev-notify').checked);
      log(`${d.code} ${d.title}: ${T.EVENTS[ev.type].label}`);
      save(); render(); openDrawer(d.id); toast('Saved.');
    },
    'del-ev': (el) => {
      if (!confirm('Delete this history entry?')) return;
      const d = db.deliverables.find((x) => x.id === el.dataset.id);
      d.events = d.events.filter((e) => e.id !== el.dataset.ev);
      log(`${d.code}: deleted a history entry`);
      save(); render(); openDrawer(d.id);
    },
    'save-ed': (el) => {
      const d = db.deliverables.find((x) => x.id === el.dataset.id);
      Object.assign(d, { code: $('#ed-code').value.trim(), title: $('#ed-title').value.trim(), sheets: +$('#ed-sheets').value || 1, type: $('#ed-type').value, removed: $('#ed-removed').checked });
      log(`${d.code}: details edited`);
      save(); render(); openDrawer(d.id); toast('Saved.');
    },
    'new-deliverable': () => {
      const station = prompt('Station?', ui.f.station || T.stations(db)[0] || ''); if (!station) return;
      const discipline = prompt('Discipline?', ui.f.discipline || disciplines()[0] || ''); if (!discipline) return;
      const code = prompt('Drawing / document code?'); if (code == null) return;
      const title = prompt('Title?'); if (!title) return;
      const d = { id: T.uid(), station, discipline, group: '', code, title, type: /calc/i.test(title) ? 'calculation' : 'drawing', sheets: 1, subs: [], baseline: false, removed: false, events: [] };
      db.deliverables.push(d);
      log(`New sheet added: ${code} ${title}`);
      save(); render(); openDrawer(d.id);
    },
    'export-filtered': () => exportExcel(filtered(), 'register'),
    'export-all': () => exportExcel(live(), db.settings.projectName.replace(/\W+/g, '_')),
    'export-one': (el) => { const d = db.deliverables.find((x) => x.id === el.dataset.id); exportExcel([d], d.code.replace(/\W+/g, '_') || 'deliverable'); },
    parse: () => {
      ui.mailText = $('#mail').value;
      if (!ui.mailText.trim()) return toast('Paste the email first.');
      ui.parsed = T.parseEmail(ui.mailText, db, { station: $('#in-station').value, mode: $('#in-mode').value, date: $('#in-date').value });
      render();
      if (!ui.parsed.station) toast('Could not tell the station — choose it and press “Read email” again.');
    },
    'add-row': () => {
      const v = $('#add-row').value.trim(); if (!v) return;
      const code = v.split(' · ')[0];
      const p = ui.parsed;
      const d = db.deliverables.find((x) => (!p.station || x.station === p.station) && (x.code === code || x.title.toLowerCase() === v.toLowerCase()));
      if (!d) return toast('Not found in the register.');
      if (!p.rows.some((r) => r.d.id === d.id)) p.rows.push({ d, srr: p.srrs[0] || null, code: p.codes.length === 1 ? p.codes[0] : null });
      render();
    },
    'discard-mail': () => { ui.parsed = null; render(); },
    'confirm-mail': confirmMail,
    'mail-file': (el) => readFile(el, (t, name) => { ui.mailText = /\.eml$/i.test(name) ? emlText(t) : t; ui.parsed = null; render(); }),
    remind: (el) => {
      const t = el.dataset.team, warnAt = Math.max(1, db.settings.delayDays - 2);
      const items = live().filter((d) => { const s = st(d); return s.owner === t && T.STAGES[s.stage].ours && s.age >= warnAt; });
      const n = queue(t, `Reminder: ${items.length} item(s) pending`, items.map((d) => { const s = st(d); return line(d, `${s.srr || ''} ${s.code || ''} · ${s.age} days`.trim()); }), 'reminder');
      log(`Reminder queued for ${t} (${items.length} items)`); save(); render(); toast(`${n} reminder(s) queued in Outbox.`);
    },
    'remind-scc': () => {
      const items = live().filter((d) => { const s = st(d); return ['with_scc', 'with_tcap', 'vendor'].includes(s.stage) && s.age > db.settings.delayDays; });
      const n = queue('SCC', `Status request: ${items.length} submission(s) awaiting response`, items.map((d) => { const s = st(d); return line(d, `${T.STAGES[s.stage].label} · ${s.age} days`); }), 'chaser');
      save(); render(); toast(`${n} message(s) queued in Outbox.`);
    },
    sent: (el) => { const m = db.outbox.find((x) => x.id === el.dataset.id); if (m) { m.status = 'sent'; m.sentAt = new Date().toISOString(); save(); setTimeout(render, 300); } return true; },
    copy: (el) => { const m = db.outbox.find((x) => x.id === el.dataset.id); navigator.clipboard.writeText(m.body).then(() => toast('Copied.'), () => toast('Copy failed.')); },
    'del-msg': (el) => { db.outbox = db.outbox.filter((x) => x.id !== el.dataset.id); save(); render(); },
    'add-person': () => { db.people.push({ id: T.uid(), name: 'New person', role: 'team', team: 'MEPF', phone: '', email: '' }); save(); render(); },
    'del-person': (el) => { if (confirm('Remove this person?')) { db.people = db.people.filter((p) => p.id !== el.dataset.id); save(); render(); } },
    'import-html': (el) => readFile(el, (t) => {
      try {
        const list = T.importDashboardHtml(t);
        if (db.deliverables.length && !confirm(`Replace the current register (${db.deliverables.length} items) with ${list.length} imported items?`)) return;
        db.deliverables = list; if (db.settings.projectName === 'Demo Project') db.settings.projectName = 'MTC'; log(`Imported ${list.length} deliverables from old dashboard`); save(); location.hash = '#/dashboard'; render();
        toast(`Imported ${list.length} deliverables.`);
      } catch (e) { toast('Import failed: ' + e.message); }
    }),
    backup: () => download(`${db.settings.projectName}-backup-${T.today()}.json`, JSON.stringify(db, null, 1), 'application/json'),
    restore: (el) => readFile(el, (t) => {
      try { const x = JSON.parse(t); if (!x.deliverables) throw new Error('not a backup file'); if (!confirm('Replace all current data with this backup?')) return; db = x; save(); load(); render(); toast('Backup restored.'); }
      catch (e) { toast('Restore failed: ' + e.message); }
    }),
    demo: () => { if (db.deliverables.length && !confirm('Replace current data with demo data?')) return; db = T.sampleDb(); localStorage.setItem(USER_KEY, 'admin'); save(); render(); toast('Demo data loaded. Try “Viewing as” at the top to see other roles.'); },
    reset: () => { if (confirm('Erase ALL data in this browser? Download a backup first.') && confirm('Really erase?')) { db = T.blankDb(); save(); render(); } },
  };

  /* ---------- event wiring ---------- */
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'SELECT' || (el.type === 'file')) return;
    if (el.dataset.act === 'open' && e.target.closest('[data-stop]')) return;
    if (el.type === 'checkbox' && el.dataset.act !== 'sel' && el.dataset.act !== 'sel-all') return;
    const keepDefault = el.tagName === 'A' && el.getAttribute('href') && !el.getAttribute('href').startsWith('#');
    if (el.dataset.act === 'filter-stage') { ACT['filter-stage'](el); return; }
    if (!keepDefault && el.tagName !== 'INPUT') e.preventDefault();
    ACT[el.dataset.act] && ACT[el.dataset.act](el, e);
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.act && (el.tagName === 'SELECT' || el.type === 'file')) return ACT[el.dataset.act](el);
    if (el.dataset.f) { ui.f[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value; ui.limit = 200; return render(); }
    if (el.dataset.row != null && ui.parsed) { const r = ui.parsed.rows[+el.dataset.row]; r[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; return; }
    if (el.dataset.p) { const p = db.people.find((x) => x.id === el.dataset.p); p[el.dataset.k] = el.value; save(); if (el.dataset.k === 'role') shell(); return; }
    if (el.dataset.disc) { db.settings.discTeam[el.dataset.disc] = el.value; save(); return; }
    if (el.dataset.s) { db.settings[el.dataset.s] = el.type === 'number' ? Math.max(1, +el.value || 7) : el.value; save(); shell(); return; }
    if (el.id === 'mail') ui.mailText = el.value;
  });
  // search box filters as you type
  document.addEventListener('input', (e) => {
    if (e.target.dataset.f === 'q') {
      ui.f.q = e.target.value; ui.limit = 200;
      clearTimeout(ACT.qt); ACT.qt = setTimeout(() => { const pos = e.target.selectionStart; render(); const s = $('[data-f="q"]'); s.focus(); s.setSelectionRange(pos, pos); }, 250);
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
  $('#overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay') closeDrawer(); });
  window.addEventListener('hashchange', () => { closeDrawer(); render(); window.scrollTo(0, 0); });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});

  load();
  render();
})();
