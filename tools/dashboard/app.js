/* Matanho Nexus progress dashboard. Vanilla JS, no build step. Data: status.json (see README.md). */
(function () {
  'use strict';
  const qs = new URLSearchParams(location.search);
  const REFRESH_MS = Math.max(2, Number(qs.get('refresh')) || 300) * 1000;
  const STALE_MS = 10 * 60 * 1000;
  // test hook: ?now=+15 (minutes ahead) or ?now=<ISO date> shifts the page clock
  const NOW_OFFSET = (() => { const v = qs.get('now'); if (!v) return 0; if (/^[+-]?\d+(\.\d+)?$/.test(v)) return Number(v) * 60000; const t = Date.parse(v); return t ? t - Date.now() : 0; })();
  const now = () => Date.now() + NOW_OFFSET;

  const STATE_LABEL = { not_started: 'Not started', in_progress: 'In progress', awaiting_retest: 'Awaiting re-test', passed: 'Passed', failed: 'Failed', blocked: 'Blocked' };
  const STATE_ORDER = { failed: 0, blocked: 1, in_progress: 2, awaiting_retest: 3, not_started: 4, passed: 5 };
  const ISSUE_STATE_LABEL = { open: 'Open', fixed_awaiting_retest: 'Fixed, awaiting re-test', passed: 'Passed', failed: 'Re-test failed', not_a_defect: 'Not a defect' };
  const ISSUE_STATE_CLASS = { open: 'not_started', fixed_awaiting_retest: 'awaiting_retest', passed: 'passed', failed: 'failed', not_a_defect: 'not_started' };
  const ISSUE_STATE_ORDER = { failed: 0, open: 1, fixed_awaiting_retest: 2, not_a_defect: 3, passed: 4 };
  const SEV_ORDER = { critical: 0, major: 1, minor: 2 };
  const AGENT_LABEL = { active: 'Active', done: 'Done', failed: 'Failed', queued: 'Queued', stalled: 'Stalled' };
  const AGENT_CLASS = { active: 'in_progress', done: 'passed', failed: 'failed', queued: 'not_started', stalled: 'blocked' };
  const AGENT_ORDER = { active: 0, failed: 1, stalled: 2, queued: 3, done: 4 };

  let data = null; let lastFetchAt = null; let nextAt = now() + REFRESH_MS; let fetching = false; let fetchError = null;

  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const unknown = '<span class="muted">unknown</span>';
  const or = (v) => (v == null || v === '' ? unknown : esc(v));
  const pre = (v) => (v == null || v === '' ? unknown : `<p class="pre">${esc(v)}</p>`);
  const fmt = (iso) => { if (!iso) return 'unknown'; const d = new Date(iso); return isNaN(d) ? 'unknown' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); };
  const ago = (iso) => {
    if (!iso) return 'unknown'; const ms = now() - Date.parse(iso); if (isNaN(ms)) return 'unknown'; const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return 'just now'; const m = Math.round(s / 60); if (m < 60) return m + ' min ago'; const h = Math.round(m / 60); if (h < 48) return h + ' h ago'; return Math.round(h / 24) + ' d ago';
  };
  const timeCell = (iso) => (iso ? `<span title="${esc(fmt(iso))}">${esc(ago(iso))}</span>` : unknown);
  const badge = (s) => `<span class="badge s-${esc(s)}">${esc(STATE_LABEL[s] || s)}</span>`;
  const issueBadge = (s) => `<span class="badge s-${ISSUE_STATE_CLASS[s] || 'not_started'}">${esc(ISSUE_STATE_LABEL[s] || s)}</span>`;
  const sevBadge = (s) => `<span class="badge sev-${esc(s)}">${esc(s ? s[0].toUpperCase() + s.slice(1) : 'unknown')}</span>`;
  const agentBadge = (s) => `<span class="badge s-${AGENT_CLASS[s] || 'not_started'}">${esc(AGENT_LABEL[s] || s)}</span>`;
  const pct = (v) => (v == null ? 'unknown' : v + '%');
  const T = (id) => data.tasks.find((t) => t.id === id);
  const A = (id) => data.agents.find((a) => a.id === id);
  const I = (id) => data.issues.find((i) => i.id === id);
  const link = (href, text) => `<a href="${esc(href)}">${esc(text)}</a>`;
  const num = (n) => (n == null ? 'unknown' : n);

  // ---------- routing / URL state ----------
  function parseHash() {
    const h = location.hash.replace(/^#/, '') || '/'; const [p, q] = h.split('?');
    const parts = p.split('/').filter(Boolean).map(decodeURIComponent);
    return { parts, params: new URLSearchParams(q || ''), raw: h };
  }
  function hashFor(parts, params) { const q = params && [...params.keys()].length ? '?' + params.toString() : ''; return '#/' + parts.map(encodeURIComponent).join('/') + q; }
  function setParams(patch, replace) {
    const r = parseHash(); for (const [k, v] of Object.entries(patch)) { if (v == null || v === '') r.params.delete(k); else r.params.set(k, v); }
    const url = location.pathname + location.search + hashFor(r.parts, r.params);
    if (replace) { history.replaceState(null, '', url); render(); } else location.hash = hashFor(r.parts, r.params);
  }

  // ---------- generic list helpers ----------
  function sortRows(rows, key, dir, getters) {
    const g = getters[key] || getters.default; const m = dir === 'desc' ? -1 : 1;
    return rows.slice().sort((a, b) => { const x = g(a), y = g(b); if (x < y) return -1 * m; if (x > y) return 1 * m; return String(a.id).localeCompare(String(b.id)); });
  }
  function th(label, key, r, defaultKey) {
    const cur = r.params.get('sort') || defaultKey; const dir = r.params.get('dir') || 'asc';
    const aria = cur === key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none';
    return `<th scope="col" aria-sort="${aria}"><button type="button" data-sort="${esc(key)}" aria-label="Sort by ${esc(label)}">${esc(label)}</button></th>`;
  }
  function select(id, label, options, value) {
    return `<label>${esc(label)}<select id="f-${id}" data-param="${id}"><option value="">All</option>${options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === value ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  }
  function search(r) { return `<label>Search<input id="f-q" type="search" data-param="q" value="${esc(r.params.get('q') || '')}" placeholder="id, title, text" autocomplete="off"></label>`; }
  const reset = (r) => ([...r.params.keys()].length ? `<button type="button" class="btn" id="resetFilters">Clear filters</button>` : '');
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort();
  const stateOpts = () => Object.keys(STATE_ORDER).map((s) => [s, STATE_LABEL[s]]);
  const hay = (o, fields) => fields.map((f) => (Array.isArray(o[f]) ? o[f].join(' ') : o[f] || '')).join(' ').toLowerCase();

  // ---------- list views ----------
  function tasksTable(tasks, r, opts = {}) {
    const p = r.params; const f = { state: p.get('state'), ws: p.get('ws'), stage: p.get('stage'), agent: p.get('agent'), q: (p.get('q') || '').toLowerCase().trim() };
    let rows = tasks.filter((t) => (!f.state || t.state === f.state) && (!f.ws || t.workstream === f.ws) && (!f.stage || t.stage === f.stage) && (!f.agent || t.agent === f.agent) && (!f.q || hay(t, ['id', 'title', 'description', 'notes', 'issueIds', 'verification']).includes(f.q)));
    const key = p.get('sort') || 'state'; const dir = p.get('dir') || 'asc';
    rows = sortRows(rows, key, dir, { state: (t) => STATE_ORDER[t.state], title: (t) => t.title.toLowerCase(), workstream: (t) => t.workstream, stage: (t) => t.stage, agent: (t) => (t.agent ? (A(t.agent)?.label || t.agent) : ''), updated: (t) => t.updatedAt || '', default: (t) => STATE_ORDER[t.state] });
    const agentsUsed = uniq(tasks.map((t) => t.agent)).map((id) => [id, A(id)?.label || id]);
    const bar = `<div class="filters" role="search" aria-label="Filter tasks">${select('state', 'State', stateOpts(), f.state)}${opts.noWs ? '' : select('ws', 'Workstream', data.workstreams.map((w) => [w.id, w.title]), f.ws)}${opts.noStage ? '' : select('stage', 'Stage', data.stages.map((s) => [s.id, s.title]), f.stage)}${select('agent', 'Agent', agentsUsed, f.agent)}${search(r)}${reset(r)}</div>`;
    const body = rows.map((t) => `<tr data-href="#/task/${encodeURIComponent(t.id)}"><td><a class="t" href="#/task/${encodeURIComponent(t.id)}">${esc(t.id)}</a><div>${esc(t.title)}</div></td><td>${badge(t.state)}</td><td>${esc(t.workstream)}</td><td>${esc(stageTitle(t.stage))}</td><td>${t.agent ? link('#/agent/' + encodeURIComponent(t.agent), A(t.agent)?.label || t.agent) : '<span class="muted">none</span>'}</td><td>${timeCell(t.updatedAt)}</td></tr>`).join('');
    return `${bar}<div class="count" role="status">${rows.length} of ${tasks.length} tasks</div><div class="tablewrap"><table><thead><tr>${th('Task', 'title', r, 'state')}${th('State', 'state', r, 'state')}${th('Workstream', 'workstream', r, 'state')}${th('Stage', 'stage', r, 'state')}${th('Agent', 'agent', r, 'state')}${th('Updated', 'updated', r, 'state')}</tr></thead><tbody>${body || ''}</tbody></table>${rows.length ? '' : '<div class="empty">No tasks match these filters.</div>'}</div>`;
  }
  const stageTitle = (id) => data.stages.find((s) => s.id === id)?.title || id;

  function issuesTable(issues, r, opts = {}) {
    const p = r.params; const f = { sev: p.get('sev'), istate: p.get('istate'), group: p.get('group'), q: (p.get('q') || '').toLowerCase().trim() };
    let rows = issues.filter((i) => (!f.sev || i.severity === f.sev) && (!f.istate || (f.istate === 'open_all' ? ['open', 'failed'].includes(i.state) : i.state === f.istate)) && (!f.group || i.group === f.group) && (!f.q || hay(i, ['id', 'title', 'location', 'actual', 'expected', 'steps', 'evidence', 'group']).includes(f.q)));
    const key = p.get('sort') || 'severity'; const dir = p.get('dir') || 'asc';
    rows = sortRows(rows, key, dir, { severity: (i) => SEV_ORDER[i.severity] * 10 + ISSUE_STATE_ORDER[i.state], state: (i) => ISSUE_STATE_ORDER[i.state], title: (i) => i.title.toLowerCase(), group: (i) => i.group || '', updated: (i) => i.updatedAt || '', id: (i) => i.id, default: (i) => SEV_ORDER[i.severity] });
    const sevO = [['critical', 'Critical'], ['major', 'Major'], ['minor', 'Minor']];
    const stO = [['open_all', 'Open or re-test failed'], ...Object.keys(ISSUE_STATE_LABEL).map((s) => [s, ISSUE_STATE_LABEL[s]])];
    const bar = `<div class="filters" role="search" aria-label="Filter issues">${select('sev', 'Severity', sevO, f.sev)}${select('istate', 'Issue state', stO, f.istate)}${select('group', 'Fix group', uniq(issues.map((i) => i.group)).map((g) => [g, g]), f.group)}${search(r)}${reset(r)}</div>`;
    const body = rows.map((i) => `<tr data-href="#/issue/${encodeURIComponent(i.id)}"><td><a class="t" href="#/issue/${encodeURIComponent(i.id)}">${esc(i.id)}</a></td><td>${esc(i.title)}</td><td>${sevBadge(i.severity)}</td><td>${issueBadge(i.state)}</td><td>${i.group ? link('#/task/A-' + i.group, i.group) : unknown}</td><td>${timeCell(i.updatedAt)}</td></tr>`).join('');
    return `${bar}<div class="count" role="status">${rows.length} of ${issues.length} issues</div><div class="tablewrap"><table><thead><tr>${th('Issue', 'id', r, 'severity')}${th('Title', 'title', r, 'severity')}${th('Severity', 'severity', r, 'severity')}${th('State', 'state', r, 'severity')}${th('Group', 'group', r, 'severity')}${th('Updated', 'updated', r, 'severity')}</tr></thead><tbody>${body}</tbody></table>${rows.length ? '' : '<div class="empty">No issues match these filters.</div>'}</div>`;
  }

  function agentsTable(r) {
    const p = r.params; const f = { status: p.get('status'), q: (p.get('q') || '').toLowerCase().trim() };
    let rows = data.agents.filter((a) => (!f.status || a.status === f.status) && (!f.q || hay(a, ['id', 'label', 'description', 'branch', 'workflow']).includes(f.q)));
    const key = p.get('sort') || 'status'; const dir = p.get('dir') || 'asc';
    rows = sortRows(rows, key, dir, { status: (a) => AGENT_ORDER[a.status] * 1e0, label: (a) => (a.label || '').toLowerCase(), activity: (a) => a.lastActivityAt || '', branch: (a) => a.branch || '', default: (a) => AGENT_ORDER[a.status] });
    const bar = `<div class="filters" role="search" aria-label="Filter agents">${select('status', 'Status', Object.keys(AGENT_LABEL).map((s) => [s, AGENT_LABEL[s]]), f.status)}${search(r)}${reset(r)}</div>`;
    const body = rows.map((a) => `<tr data-href="#/agent/${encodeURIComponent(a.id)}"><td><a class="t" href="#/agent/${encodeURIComponent(a.id)}">${esc(a.label || a.id)}</a><div class="muted">${esc(a.workflow || 'not in a workflow journal')}</div></td><td>${agentBadge(a.status)}</td><td>${a.currentTask ? link('#/task/' + encodeURIComponent(a.currentTask), a.currentTask) : '<span class="muted">none</span>'}</td><td>${or(a.branch)}</td><td>${timeCell(a.lastActivityAt)}</td></tr>`).join('');
    return `${bar}<div class="count" role="status">${rows.length} of ${data.agents.length} agents</div><div class="tablewrap"><table><thead><tr>${th('Agent', 'label', r, 'status')}${th('Status', 'status', r, 'status')}<th scope="col">Task</th>${th('Branch', 'branch', r, 'status')}${th('Last activity', 'activity', r, 'status')}</tr></thead><tbody>${body}</tbody></table>${rows.length ? '' : '<div class="empty">No agents match.</div>'}</div>`;
  }

  // ---------- views ----------
  const backLink = (extra) => `<div class="crumbs"><a class="back" href="#/">&larr; Back to overview</a>${extra || ''}</div>`;
  const progressBar = (c, total) => `<div class="bar seg" role="img" aria-label="${esc(Object.keys(STATE_LABEL).map((s) => (c[s] || 0) + ' ' + STATE_LABEL[s]).join(', '))}">${Object.keys(STATE_ORDER).sort((a, b) => ({ passed: 0, awaiting_retest: 1, in_progress: 2, failed: 3, blocked: 4, not_started: 5 }[a] - { passed: 0, awaiting_retest: 1, in_progress: 2, failed: 3, blocked: 4, not_started: 5 }[b])).map((s) => (c[s] ? `<i class="s-${s}" style="width:${(c[s] / total) * 100}%"></i>` : '')).join('')}</div>`;
  const progressRow = (href, title, o) => `<li><a class="rowlink" href="${esc(href)}"><div class="top1"><span class="name">${esc(title)}</span><span><b>${esc(pct(o.progressPct))}</b> <small>${o.total} tasks</small></span></div><div class="bar thin"><i style="width:${o.progressPct || 0}%"></i></div><small>${Object.keys(STATE_LABEL).filter((s) => o.counts[s]).map((s) => `${o.counts[s]} ${STATE_LABEL[s].toLowerCase()}`).join(', ')}</small></a></li>`;

  function overview() {
    const p = data.project; const sc = p.stateCounts; const ic = p.issues;
    const bad = [];
    data.tasks.filter((t) => t.state === 'failed' || t.state === 'blocked').forEach((t) => bad.push(`${badge(t.state)} ${link('#/task/' + encodeURIComponent(t.id), t.id + ' ' + t.title)}${t.notes ? ' <span class="muted">(' + esc(t.notes) + ')</span>' : ''}`));
    data.issues.filter((i) => i.state === 'failed').forEach((i) => bad.push(`${issueBadge(i.state)} ${link('#/issue/' + encodeURIComponent(i.id), i.id + ' ' + i.title)}`));
    ['failed', 'stalled'].forEach((s) => { const n = data.agents.filter((a) => a.status === s).length; if (n) bad.push(`${agentBadge(s)} <a href="#/agents?status=${s}">${n} agent${n === 1 ? '' : 's'} ${s}</a> <span class="muted">(workflow journals: failed launches or no output for over 10 minutes without a result)</span>`); });
    const crit = data.issues.filter((i) => i.severity === 'critical' && ['open', 'failed'].includes(i.state));
    const attention = `<section class="alert${bad.length || crit.length ? '' : ' ok'}" aria-labelledby="att"><h2 id="att">${bad.length || crit.length ? 'Needs attention' : 'No failures or blockers'}</h2>${bad.length || crit.length ? `<ul>${crit.map((i) => `<li>${sevBadge('critical')} ${issueBadge(i.state)} ${link('#/issue/' + encodeURIComponent(i.id), i.id + ' ' + i.title)}</li>`).join('')}${bad.map((b) => `<li>${b}</li>`).join('')}</ul>` : '<p style="margin:0">No task is failed or blocked, no re-test failed, and no agent is failed or stalled.</p>'}</section>`;
    const active = data.agents.filter((a) => a.status === 'active');
    const recent = data.activity.slice(0, 15);
    return `<h1>Overview</h1><p class="muted" style="margin-top:0">${esc(p.name)} on <code>${esc(p.baseBranch)}</code>${p.baseCommit ? ' @ ' + esc(p.baseCommit) : ''}. ${data.sizes.worktrees} git worktrees, ${data.sizes.issues} QA issues, ${p.taskCount} tracked tasks.</p>
    <div class="grid g-overview">
      <section class="card" aria-labelledby="h-prog"><h2 id="h-prog">Overall progress</h2><div class="big">${esc(pct(p.progressPct))}</div>
        <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.progressPct || 0}" aria-label="Overall progress"><i style="width:${p.progressPct || 0}%"></i></div>
        ${progressBar(sc, p.taskCount)}
        <div class="sub">${p.progressPctExcludingBaseline != null ? `Excluding delivered baseline milestones (workstream C): <b>${esc(pct(p.progressPctExcludingBaseline))}</b>. ` : ''}Rule: ${esc(p.progressRule)}.</div></section>
      <section class="card" aria-labelledby="h-state"><h2 id="h-state">Tasks by state <small><a href="#/tasks">all tasks</a></small></h2><div class="tiles">${Object.keys(STATE_LABEL).map((s) => `<a class="tile s-${s}${sc[s] ? '' : ' zero'}" href="#/tasks?state=${s}"><b>${sc[s] || 0}</b><span>${STATE_LABEL[s]}</span></a>`).join('')}</div></section>
      <section class="card" aria-labelledby="h-iss"><h2 id="h-iss">Open issues <small><a href="#/issues">${ic.total} total</a></small></h2><div class="tiles" style="grid-template-columns:repeat(3,1fr)">${['critical', 'major', 'minor'].map((s) => `<a class="tile sev-${s}${ic.openBySeverity[s] ? '' : ' zero'}" href="#/issues?sev=${s}&istate=open_all"><b>${ic.openBySeverity[s]}</b><span>${s[0].toUpperCase() + s.slice(1)}</span></a>`).join('')}</div>
        <div class="sub">${Object.entries(ic.byState).map(([k, v]) => `${v} ${(ISSUE_STATE_LABEL[k] || k).toLowerCase()}`).join(', ')}</div>
        <div class="sub"><a href="#/agents?status=active"><b>${p.activeAgents}</b> active agent${p.activeAgents === 1 ? '' : 's'}</a> of ${data.agents.length} recorded</div></section>
    </div>
    <div style="margin:14px 0">${attention}</div>
    <div class="grid g-3">
      <section class="card" aria-labelledby="h-ws"><h2 id="h-ws">Workstreams</h2><ul class="rows">${data.workstreams.map((w) => progressRow('#/workstream/' + w.id, w.title, w)).join('')}</ul></section>
      <section class="card" aria-labelledby="h-st"><h2 id="h-st">Stages</h2><ul class="rows">${data.stages.map((s) => progressRow('#/stage/' + s.id, s.title, s)).join('')}</ul></section>
      <section class="card" aria-labelledby="h-ag"><h2 id="h-ag">Active agents <small><a href="#/agents">all agents</a></small></h2>${active.length ? `<ul class="rows">${active.map((a) => `<li><a class="rowlink" href="#/agent/${encodeURIComponent(a.id)}"><div class="top1"><span class="name">${esc(a.label || a.id)}</span>${agentBadge(a.status)}</div><small>${a.currentTask ? 'Working on ' + esc(a.currentTask) + '. ' : ''}Last activity ${esc(ago(a.lastActivityAt))}</small></a></li>`).join('')}</ul>` : '<p class="muted">No agent has written to its transcript in the last 10 minutes.</p>'}</section>
    </div>
    <section class="card" style="margin-top:14px" aria-labelledby="h-act"><h2 id="h-act">Recent activity <small>newest first, derived from state changes between builds and from watchdog / re-test logs</small></h2>${recent.length ? `<ul class="rows feed">${recent.map(activityItem).join('')}</ul>` : '<p class="muted">No state change has been observed yet; entries appear when a build detects a change.</p>'}</section>
    <p class="muted"><a href="#/decisions">Decision log (${data.decisions.length})</a> &middot; <a href="#/sources">Data sources and git worktrees</a></p>`;
  }
  function activityItem(a) {
    const href = { task: '#/task/', issue: '#/issue/', agent: '#/agent/' }[a.kind];
    const txt = esc(a.text);
    return `<li><time datetime="${esc(a.at)}" title="${esc(fmt(a.at))}">${esc(ago(a.at))}</time><span class="kind">${esc(a.kind)}</span><span>${href ? `<a href="${href}${encodeURIComponent(a.ref)}">${txt}</a>` : a.kind === 'retest' ? `<a href="#/issue/${encodeURIComponent(a.ref)}">${txt}</a>` : txt}</span></li>`;
  }

  function listPage(title, r, inner, crumb) { return `${backLink(crumb)}<h1>${esc(title)}</h1>${inner}`; }

  function groupDetail(kind, id, r) {
    const g = (kind === 'stage' ? data.stages : data.workstreams).find((x) => x.id === id);
    if (!g) return notFound(`${kind} "${id}"`);
    const tasks = data.tasks.filter((t) => (kind === 'stage' ? t.stage === id : t.workstream === id));
    const others = kind === 'stage' ? data.workstreams.filter((w) => w.id === g.workstream) : data.stages.filter((s) => s.workstream === id);
    return `${backLink(`<span class="muted">${kind === 'stage' ? 'Stage' : 'Workstream'}</span>`)}<h1>${esc(g.title)}</h1><p class="muted" style="margin-top:0">${esc(g.description || '')}</p>
    <div class="card" style="margin-bottom:14px"><div class="big" style="font-size:2rem">${esc(pct(g.progressPct))}</div><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${g.progressPct || 0}" aria-label="${esc(g.title)} progress"><i style="width:${g.progressPct || 0}%"></i></div>${progressBar(g.counts, g.total)}<div class="sub">${g.total} tasks: ${Object.keys(STATE_LABEL).filter((s) => g.counts[s]).map((s) => `<a href="#/${kind}/${esc(id)}?state=${s}">${g.counts[s]} ${STATE_LABEL[s].toLowerCase()}</a>`).join(', ')}.${others.length ? ' Related: ' + others.map((o) => link('#/' + (kind === 'stage' ? 'workstream' : 'stage') + '/' + o.id, o.title)).join(', ') + '.' : ''}</div></div>
    ${tasksTable(tasks, r, kind === 'stage' ? { noStage: true } : { noWs: true })}${id === 'qa-fix' ? `<h2 style="margin-top:20px">QA issues <small class="muted"><a href="#/issues">open the issue list</a></small></h2><p class="muted">${data.issues.length} issues across the fix groups: ${Object.entries(data.project.issues.byState).map(([k, v]) => `${v} ${(ISSUE_STATE_LABEL[k] || k).toLowerCase()}`).join(', ')}.</p>` : ''}`;
  }

  function taskDetail(id) {
    const t = T(id); if (!t) return notFound(`task "${id}"`);
    const ag = t.agent ? A(t.agent) : null;
    const ws = data.workstreams.find((w) => w.id === t.workstream); const st = data.stages.find((s) => s.id === t.stage);
    return `${backLink(`${st ? link('#/stage/' + st.id, st.title) : ''}${ws ? ' ' + link('#/workstream/' + ws.id, ws.title) : ''}`)}<h1>${esc(t.id)}: ${esc(t.title)}</h1><p>${badge(t.state)}${t.manualOverride ? ' <span class="muted">(edited in manual-status.json)</span>' : ''}</p>
    <div class="grid g-2"><section class="card"><h2>Details</h2><dl class="kv">
      <dt>Description</dt><dd>${pre(t.description)}</dd>
      <dt>Agent</dt><dd>${ag ? link('#/agent/' + encodeURIComponent(ag.id), ag.label || ag.id) + ' ' + agentBadge(ag.status) : '<span class="muted">none assigned</span>'}</dd>
      <dt>Started</dt><dd>${t.startedAt ? esc(fmt(t.startedAt)) + ' (' + esc(ago(t.startedAt)) + ')' : unknown}</dd>
      <dt>Last changed</dt><dd>${t.updatedAt ? esc(fmt(t.updatedAt)) + ' (' + esc(ago(t.updatedAt)) + ')' : unknown}</dd>
      <dt>State since</dt><dd>${t.stateChangedAt ? esc(fmt(t.stateChangedAt)) : unknown}</dd>
      <dt>Verification</dt><dd>${pre(t.verification)}</dd>
      ${t.notes ? `<dt>Notes</dt><dd>${pre(t.notes)}</dd>` : ''}
      <dt>Source</dt><dd>${or(t.source)}${t.boardState ? ' (board state: ' + esc(t.boardState) + ')' : ''}${t.todoState ? ' (TODO state: ' + esc(t.todoState) + ')' : ''}</dd></dl></section>
    <section class="card"><h2>Linked issues <small>${t.issueIds.length}</small></h2>${t.issueIds.length ? `<ul class="rows">${t.issueIds.map((iid) => { const i = I(iid); return i ? `<li><a class="rowlink" href="#/issue/${encodeURIComponent(iid)}"><div class="top1"><span class="name">${esc(iid)}</span><span>${sevBadge(i.severity)} ${issueBadge(i.state)}</span></div><small>${esc(i.title)}</small></a></li>` : ''; }).join('')}</ul>` : '<p class="muted">No issues linked to this task.</p>'}</section></div>
    <section class="card" style="margin-top:14px"><h2>Files touched <small>${t.files.length}${t.files.length >= 300 ? ' (first 300 shown)' : ''}</small></h2>${t.files.length ? `<ul class="filelist">${t.files.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '<p class="muted">No files recorded for this task (no worktree with changes against the base branch).</p>'}</section>`;
  }

  function agentDetail(id) {
    const a = A(id); if (!a) return notFound(`agent "${id}"`);
    const task = a.currentTask ? T(a.currentTask) : null;
    const lst = (arr, base) => (arr && arr.length ? `<ul class="rows">${arr.map((x) => `<li><a class="rowlink" href="#/${base}/${encodeURIComponent(x)}">${esc(x)}${base === 'issue' && I(x) ? ' <small>' + esc(I(x).title) + '</small>' : ''}</a></li>`).join('')}</ul>` : '<p class="muted">None.</p>');
    const base = (arr) => (arr && arr[0] && /^[A-Z]{3}-\d+$/.test(arr[0]) ? 'issue' : 'task');
    return `${backLink('<span class="muted">Agent</span>')}<h1>${esc(a.label || a.id)}</h1><p>${agentBadge(a.status)} <span class="muted">${esc(a.description || '')}</span></p>
    <div class="grid g-2"><section class="card"><h2>Doing now</h2><dl class="kv"><dt>Current task</dt><dd>${task ? link('#/task/' + encodeURIComponent(task.id), task.id + ' ' + task.title) + ' ' + badge(task.state) : '<span class="muted">none</span>'}</dd>
      <dt>Phase</dt><dd>${or(a.phase)}</dd><dt>Workflow</dt><dd>${or(a.workflow)}</dd><dt>Agent id</dt><dd><code>${esc(a.id)}</code></dd>
      <dt>Started</dt><dd>${a.startedAt ? esc(fmt(a.startedAt)) : unknown}</dd><dt>Last activity</dt><dd>${a.lastActivityAt ? esc(fmt(a.lastActivityAt)) + ' (' + esc(ago(a.lastActivityAt)) + ')' : unknown}</dd>
      <dt>Transcript size</dt><dd>${a.transcriptBytes != null ? esc((a.transcriptBytes / 1024 / 1024).toFixed(2)) + ' MB (size only, not read)' : unknown}</dd></dl></section>
    <section class="card"><h2>Branch and commits</h2><dl class="kv"><dt>Worktree</dt><dd>${or(a.worktree)}</dd><dt>Branch</dt><dd>${or(a.branch)}</dd>
      <dt>Commits ahead of base</dt><dd>${num(a.commitsAheadOfBase)}</dd><dt>Merged into base</dt><dd>${a.mergedIntoBase == null ? unknown : a.mergedIntoBase ? 'yes' : 'no'}</dd>
      <dt>Last commit</dt><dd>${a.lastCommitAt ? esc(fmt(a.lastCommitAt)) + ' (' + esc(ago(a.lastCommitAt)) + ')<br>' + esc(a.lastCommitSubject || '') : unknown}</dd>
      <dt>Files touched</dt><dd>${num(a.filesTouched)}</dd><dt>Uncommitted files</dt><dd>${num(a.dirtyFiles)}</dd></dl></section></div>
    <div class="grid g-2" style="margin-top:14px"><section class="card"><h2>Completed <small>${(a.completed || []).length}</small></h2>${lst(a.completed, base(a.completed))}</section>
    <section class="card"><h2>Queued <small>${(a.queued || []).length}</small></h2>${lst(a.queued, base(a.queued))}</section></div>
    ${a.resultSummary ? `<section class="card" style="margin-top:14px"><h2>Reported result (from workflow journal)</h2>${pre(a.resultSummary)}</section>` : ''}`;
  }

  function issueDetail(id) {
    const i = I(id); if (!i) return notFound(`issue "${id}"`);
    const fx = i.fix; const rv = data.reviews.filter((r) => r.group === i.group);
    return `${backLink(`<span class="muted">Issue</span>${i.group ? link('#/task/A-' + i.group, 'Fix group ' + i.group) : ''}`)}<h1>${esc(i.id)}: ${esc(i.title)}</h1><p>${sevBadge(i.severity)} ${issueBadge(i.state)}${i.severityRaw !== i.severity ? ` <span class="muted">(tester wrote "${esc(i.severityRaw)}")</span>` : ''}${i.manualOverride ? ' <span class="muted">(edited in manual-status.json)</span>' : ''}</p>
    <section class="card"><h2>Report</h2><dl class="kv"><dt>Location</dt><dd>${pre(i.location)}</dd><dt>Steps</dt><dd>${pre(i.steps)}</dd><dt>Evidence</dt><dd>${pre(i.evidence)}</dd>${i.notes ? `<dt>Notes</dt><dd>${pre(i.notes)}</dd>` : ''}<dt>Reported in</dt><dd>${or(i.sourceFile)}</dd></dl></section>
    <div class="compare" style="margin:14px 0"><div><h3>Expected</h3>${pre(i.expected)}</div><div><h3>Actual</h3>${pre(i.actual)}</div></div>
    <div class="grid g-2"><section class="card"><h2>Fix</h2><dl class="kv"><dt>Fixer</dt><dd>${i.group ? link('#/task/A-' + i.group, i.fixer) : unknown}</dd><dt>Fix status</dt><dd>${fx ? esc(fx.status || 'unknown') : '<span class="muted">no FIXES entry yet</span>'}</dd>
      ${fx ? `<dt>Root cause</dt><dd>${pre(fx.rootCause)}</dd><dt>What changed</dt><dd>${pre(fx.changed)}</dd><dt>Files</dt><dd>${fx.files.length ? '<ul class="filelist">' + fx.files.map((f) => `<li>${esc(f)}</li>`).join('') + '</ul>' : unknown}</dd><dt>How to re-test</dt><dd>${pre(fx.howToRetest)}</dd>${fx.notes ? `<dt>Other notes</dt><dd>${pre(fx.notes)}</dd>` : ''}${fx.reason ? `<dt>Reason</dt><dd>${pre(fx.reason)}</dd>` : ''}<dt>Entry updated</dt><dd>${timeCell(fx.mtime)} <span class="muted">(${esc(fx.file)} in ${esc(fx.where)})</span></dd>` : ''}
      <dt>Supervisor review</dt><dd>${i.reviewVerdict ? esc(i.reviewVerdict) : rv.length ? rv.map((r) => esc(r.file + ': ' + r.verdict)).join(', ') : '<span class="muted">no review yet</span>'}</dd></dl></section>
    <section class="card"><h2>Re-test history <small>${i.retestHistory.length}</small></h2>${i.retestHistory.length ? `<div class="tablewrap"><table><thead><tr><th>Result</th><th>Time</th><th>Note</th></tr></thead><tbody>${i.retestHistory.map((h) => `<tr><td>${h.result === 'PASS' ? badge('passed') : badge('failed')}</td><td>${h.at ? esc(fmt(h.at)) : unknown}</td><td>${esc(h.note)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No re-test has been recorded (RETEST*.md has no line for this issue).</p>'}</section></div>`;
  }

  function decisionsPage(r) {
    const q = (r.params.get('q') || '').toLowerCase();
    const rows = data.decisions.filter((d) => !q || hay(d, ['id', 'unclear', 'decision', 'reason']).includes(q));
    return `${backLink()}<h1>Decision log</h1><p class="muted" style="margin-top:0">From docs/DECISION-LOG.md: decisions made on the owner's behalf.</p><div class="filters">${search(r)}${reset(r)}</div><div class="count" role="status">${rows.length} of ${data.decisions.length} decisions</div>
    <div class="grid">${rows.map((d) => `<section class="card" id="${esc(d.id)}"><h2>${esc(d.id)} <small>${esc(d.date)}</small></h2><dl class="kv"><dt>What was unclear</dt><dd>${pre(d.unclear)}</dd><dt>Decision</dt><dd>${pre(d.decision)}</dd><dt>Why</dt><dd>${pre(d.reason)}</dd></dl></section>`).join('') || '<div class="empty">No decisions match.</div>'}</div>`;
  }

  function sourcesPage() {
    return `${backLink()}<h1>Data sources</h1><p class="muted" style="margin-top:0">Generated ${esc(fmt(data.generatedAt))} in ${data.sizes.buildMs} ms. status.json is ${(data.sizes.statusJsonBytes / 1024).toFixed(0)} KB.</p>
    ${data.warnings.length ? `<div class="alert"><h2>Build warnings</h2><ul>${data.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
    <h2 style="margin-top:16px">Sources</h2><div class="tablewrap"><table><thead><tr><th>Source</th><th>Found</th><th>Modified</th><th>Size</th></tr></thead><tbody>${data.sources.map((s) => `<tr><td>${esc(s.name)}</td><td>${s.found ? 'yes' : '<span class="muted">no</span>'}</td><td>${s.modifiedAt ? esc(fmt(s.modifiedAt)) : '<span class="muted">n/a</span>'}</td><td>${s.bytes != null ? s.bytes + ' B' : s.count != null ? s.count + ' items' : '<span class="muted">n/a</span>'}</td></tr>`).join('')}</tbody></table></div>
    <h2 style="margin-top:16px">Git worktrees (${data.worktrees.length})</h2><div class="tablewrap"><table><thead><tr><th>Worktree</th><th>Branch</th><th>Ahead of base</th><th>Merged</th><th>Last commit</th><th>Files vs base</th><th>Dirty</th></tr></thead><tbody>${data.worktrees.map((w) => `<tr><td>${esc(w.name)}${w.locked ? ' <span class="muted">(locked)</span>' : ''}</td><td>${or(w.branch)}</td><td>${num(w.commitsAheadOfBase)}</td><td>${w.mergedIntoBase == null ? 'n/a' : w.mergedIntoBase ? 'yes' : 'no'}</td><td>${w.lastCommitAt ? esc(ago(w.lastCommitAt)) + '<br><small class="muted">' + esc(w.lastCommitSubject || '') + '</small>' : unknown}</td><td>${num(w.filesTouched)}</td><td>${num(w.dirtyFiles)} <small class="muted">(${esc(w.dirtyScan || '')})</small></td></tr>`).join('')}</tbody></table></div>`;
  }
  const notFound = (what) => `${backLink()}<h1>Not found</h1><p>The ${esc(what)} does not exist in the current status.json. It may have been renamed or removed by the latest build.</p>`;

  // ---------- render ----------
  const NAV = [['#/', 'Overview', ''], ['#/tasks', 'Tasks', 'tasks'], ['#/issues', 'Issues', 'issues'], ['#/agents', 'Agents', 'agents'], ['#/decisions', 'Decisions', 'decisions'], ['#/sources', 'Sources', 'sources']];
  function renderNav(r) {
    const cur = r.parts[0] || '';
    const owner = { task: 'tasks', stage: '', workstream: '', issue: 'issues', agent: 'agents' }[cur] ?? cur;
    $('#nav').innerHTML = NAV.map(([h, l, k]) => `<a href="${h}"${(owner === k && (k !== '' || !r.parts.length)) ? ' aria-current="page"' : ''}>${l}</a>`).join('');
  }
  let lastPath = null;
  function render() {
    if (!data) return;
    const r = parseHash(); const y = window.scrollY; const ae = document.activeElement; const focusId = ae && ae.id && $('#app').contains(ae) ? ae.id : null;
    const sel = focusId && ae.setSelectionRange && ae.type === 'search' ? [ae.selectionStart, ae.selectionEnd] : null;
    const [route, id] = r.parts; let html;
    try {
      if (!route) html = overview();
      else if (route === 'tasks') html = listPage('Tasks', r, tasksTable(data.tasks, r));
      else if (route === 'issues') html = listPage('QA issues', r, issuesTable(data.issues, r));
      else if (route === 'agents') html = listPage('Agents', r, agentsTable(r));
      else if (route === 'stage' || route === 'workstream') html = groupDetail(route, id, r);
      else if (route === 'task') html = taskDetail(id);
      else if (route === 'agent') html = agentDetail(id);
      else if (route === 'issue') html = issueDetail(id);
      else if (route === 'decisions') html = decisionsPage(r);
      else if (route === 'sources') html = sourcesPage();
      else html = notFound('page "' + route + '"');
    } catch (e) { console.error(e); html = `${backLink()}<div class="alert"><h2>Display error</h2><p>${esc(e.message)}</p></div>`; }
    const path = r.parts.join('/');
    $('#app').innerHTML = html; renderNav(r);
    document.title = (route ? (id ? id + ' - ' : route[0].toUpperCase() + route.slice(1) + ' - ') : '') + 'Matanho Nexus progress';
    if (path !== lastPath) window.scrollTo(0, 0); else window.scrollTo(0, y);
    lastPath = path;
    if (focusId) { const el = document.getElementById(focusId); if (el) { el.focus({ preventScroll: true }); if (sel && el.setSelectionRange) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* ignore */ } } }
  }

  // ---------- data loading ----------
  async function load(manual) {
    if (fetching) return; fetching = true; const btn = $('#refreshBtn'); btn.disabled = true;
    try {
      const res = await fetch('status.json?_=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 120));
      const next = await res.json();
      const changed = !data || next.generatedAt !== data.generatedAt;
      data = next; fetchError = null; lastFetchAt = now();
      if (changed) render();
    } catch (e) { fetchError = e.message; }
    fetching = false; btn.disabled = false; nextAt = now() + REFRESH_MS; tick();
  }
  function tick() {
    const eb = $('#errorBanner'); eb.hidden = !fetchError; eb.textContent = fetchError ? 'Could not refresh status.json (' + fetchError + '). Showing the last data that loaded.' : '';
    if (!data) { $('#updated').textContent = fetchError ? 'No data' : 'Loading data...'; return; }
    const age = now() - Date.parse(data.generatedAt);
    $('#updated').innerHTML = `Last updated <b>${esc(fmt(data.generatedAt))}</b> (${Math.max(0, Math.round(age / 60000))} min ago)`;
    const left = Math.max(0, Math.round((nextAt - now()) / 1000));
    $('#countdown').textContent = fetching ? 'Refreshing...' : `Next refresh in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    const sb = $('#staleBanner'); const stale = age > STALE_MS; sb.hidden = !stale;
    if (stale) sb.textContent = `Data is stale: status.json was generated ${Math.round(age / 60000)} minutes ago (limit 10). The build watcher may not be running: node tools/dashboard/build-status.mjs --watch 120`;
    // keep relative times in the page fresh without losing state
    const t = Math.floor(now() / 60000); if (tick.minute !== undefined && t !== tick.minute) render(); tick.minute = t;
  }

  // ---------- events ----------
  document.addEventListener('click', (e) => {
    const sortBtn = e.target.closest('button[data-sort]');
    if (sortBtn) { const r = parseHash(); const k = sortBtn.dataset.sort; const cur = r.params.get('sort'); const dir = r.params.get('dir') || 'asc'; setParams({ sort: k, dir: cur === k && dir === 'asc' ? 'desc' : 'asc' }, true); return; }
    if (e.target.id === 'resetFilters') { const r = parseHash(); history.replaceState(null, '', location.pathname + location.search + hashFor(r.parts, new URLSearchParams())); render(); return; }
    const tr = e.target.closest('tr[data-href]'); if (tr && !e.target.closest('a,button')) location.hash = tr.dataset.href;
  });
  document.addEventListener('change', (e) => { const el = e.target; if (el.matches && el.matches('select[data-param]')) setParams({ [el.dataset.param]: el.value }, true); });
  let qt; document.addEventListener('input', (e) => { const el = e.target; if (el.matches && el.matches('input[data-param]')) { clearTimeout(qt); qt = setTimeout(() => setParams({ [el.dataset.param]: el.value.trim() }, true), 150); } });
  window.addEventListener('hashchange', render);
  $('#refreshBtn').addEventListener('click', () => load(true));
  setInterval(() => { if (now() >= nextAt) load(false); else tick(); }, 1000);
  window.__dash = { reload: () => load(true), get data() { return data; } };
  load(false);
})();
