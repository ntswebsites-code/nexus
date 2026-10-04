#!/usr/bin/env node
// Generates tools/dashboard/status.json from real repo/git/journal sources.
// Usage: node tools/dashboard/build-status.mjs [--watch <seconds>]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(HERE, 'status.json');
const MANUAL = path.join(HERE, 'manual-status.json');
const BASE_BRANCH = 'feat/admin-recon-nav';
const JOURNAL_ROOT = path.join(os.homedir(), '.claude', 'projects', 'C--Users-lysp-Downloads-matanho-nexus-v56-deployment',
  'c700b56f-5789-4c78-8fc0-323e7ec573bf', 'subagents', 'workflows');
const SUBAGENT_DIR = path.dirname(JOURNAL_ROOT);
const ACTIVE_MS = 10 * 60 * 1000;
const STATES = ['not_started', 'in_progress', 'awaiting_retest', 'passed', 'failed', 'blocked'];
const WEIGHT = { passed: 1, awaiting_retest: 0.8, in_progress: 0.5, not_started: 0, failed: 0, blocked: 0 };

const sources = [];
const warnings = [];
const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
const stat = (p) => { try { return fs.statSync(p); } catch { return null; } };
const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const ms = (x) => Date.parse(x) || 0;

function addSource(name, p, extra = {}) {
  const st = p ? stat(p) : null;
  sources.push({ name, path: p ? path.relative(ROOT, p).replace(/\\/g, '/') || p : null, found: !!st || extra.found === true,
    modifiedAt: st ? iso(st.mtimeMs) : null, bytes: st && st.isFile() ? st.size : null, ...extra });
}

// ---------- git helpers ----------
function git(cwd, args, timeout = 60000) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout) => resolve(err ? null : stdout));
  });
}
async function pool(items, n, fn) {
  const res = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; res[k] = await fn(items[k], k); } }));
  return res;
}

// ---------- markdown helpers ----------
function mdTables(text) {
  const out = []; let heading = ''; let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) { heading = h[1].trim(); cur = null; continue; }
    if (/^\s*\|/.test(line)) {
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      if (!cur) { cur = { heading, header: cells, rows: [] }; out.push(cur); }
      else { const r = {}; cur.header.forEach((k, i) => { r[k] = cells[i] ?? ''; }); cur.rows.push(r); }
    } else cur = null;
  }
  return out;
}
function localTime(s) {
  const m = String(s).match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?/);
  if (!m) { const d = String(s).match(/(\d{4}-\d{2}-\d{2})/); return d ? new Date(d[1] + 'T00:00:00').toISOString() : null; }
  return new Date(`${m[1]}T${m[2]}:${m[3] || '00'}`).toISOString();
}
function stateFromText(t, fallback = 'not_started') {
  const s = String(t || '').toLowerCase();
  if (/block/.test(s)) return 'blocked';
  if (/fail/.test(s)) return 'failed';
  if (/awaiting/.test(s)) return 'awaiting_retest';
  if (/passed|done|deployed/.test(s)) return 'passed';
  if (/in progress|verifying|running|merged/.test(s)) return 'in_progress';
  if (/queued|not started|^\s*$/.test(s)) return 'not_started';
  return fallback;
}
const sevMap = { blocker: 'critical', critical: 'critical', major: 'major', minor: 'minor', polish: 'minor' };

// ---------- issues ----------
function parseIssueFile(file) {
  const text = readText(file); if (!text) return [];
  const issues = []; let cur = null; let key = null;
  const finish = () => { if (cur) { issues.push(cur); cur = null; } };
  for (const raw of text.split(/\r?\n/)) {
    const h = raw.match(/^###\s+ISS-([A-Z]+-\d+)\s+\[severity:\s*([a-z]+)\]\s*(.*)$/i);
    if (h) {
      finish();
      cur = { id: h[1].toUpperCase(), severityRaw: h[2].toLowerCase(), severity: sevMap[h[2].toLowerCase()] || 'minor', title: h[3].trim(),
        location: null, steps: null, expected: null, actual: null, evidence: null, notes: null, sourceFile: path.basename(file) };
      key = null; continue;
    }
    if (!cur) continue;
    if (/^#{1,3}\s/.test(raw)) { finish(); continue; }
    const f = raw.match(/^-\s+(Where|Steps|Expected|Actual|Evidence):\s*(.*)$/i);
    if (f) { key = f[1].toLowerCase(); const k = key === 'where' ? 'location' : key; cur[k] = f[2].trim(); continue; }
    if (/^-\s+\S/.test(raw)) { key = 'notes'; cur.notes = ((cur.notes || '') + '\n' + raw.replace(/^-\s+/, '')).trim(); continue; }
    if (raw.trim() === '') continue;
    const k = key ? (key === 'where' ? 'location' : key) : 'notes';
    cur[k] = ((cur[k] || '') + '\n' + raw.trim()).trim();
  }
  finish();
  return issues;
}

// FIXES-F*.md: tolerant parser (heading per issue id, "- Key: value" bullets).
function parseFixes(text, group) {
  const out = {}; if (!text) return out;
  let curs = []; let key = null;
  const norm = (s) => { s = s.toLowerCase(); if (/not[- ]a[- ]defect/.test(s)) return 'not-a-defect'; if (/needs[- ]other/.test(s)) return 'needs-other-group'; if (/not[- ]fixed/.test(s)) return 'not-fixed'; if (/fixed/.test(s)) return 'fixed'; return s.trim(); };
  const fileList = (s) => {
    const ticks = [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
    const parts = ticks.length ? ticks : s.split(/[,;]+/).map((x) => x.replace(/^[-*\s]+/, '').replace(/[.\s]+$/, '').trim());
    return parts.filter((x) => x.length > 2 && /[\/]|\.\w{1,5}$/.test(x));
  };
  const KEYS = /^[-*]\s+\**(status|root cause|what changed|changes?|files?|how to re-?test|re-?test|reason|needs other group)\**\s*:\**\s*(.*)$/i;
  const apply = (k, v) => {
    for (const cur of curs) {
      if (k === 'status') cur.status = norm(v); else if (k === 'files') cur.files = fileList(v); else cur[k] = v;
    }
  };
  for (const raw of text.split(/\r?\n/)) {
    const h = raw.match(/^#{2,4}\s+(?:ISS-)?((?:ADA|ADB|LPC|INO)-\d{3})\b(.*)$/i);
    if (h) {
      const ids = [...raw.matchAll(/\b((?:ADA|ADB|LPC|INO)-\d{3})\b/gi)].map((m) => m[1].toUpperCase());
      curs = ids.map((id) => (out[id] = { id, group, title: h[2].replace(/^[\s:,-]+/, '').trim() || null, status: null, rootCause: null, changed: null, files: [], howToRetest: null, reason: null, notes: null }));
      key = null; continue;
    }
    if (/^#{1,4}\s/.test(raw)) { curs = []; continue; }
    if (!curs.length) {
      const t = raw.match(/^\|\s*(?:ISS-)?((?:ADA|ADB|LPC|INO)-\d{3})\s*\|(.*)$/i);
      if (t) { const c = t[2].split('|').map((x) => x.trim()).filter((x) => x !== ''); const id = t[1].toUpperCase(); out[id] = { id, group, status: norm(c[c.length - 1] || ''), rootCause: c[0] || null, changed: null, files: [], howToRetest: null, reason: null, notes: null }; }
      continue;
    }
    const f = raw.match(KEYS);
    if (f) {
      const k0 = f[1].toLowerCase(); key = /status/.test(k0) ? 'status' : /root/.test(k0) ? 'rootCause' : /^files?/.test(k0) ? 'files' : /test/.test(k0) ? 'howToRetest' : /chang/.test(k0) ? 'changed' : 'reason';
      let v = f[2];
      // inline "Files: x. Re-test: y" on one line
      const inline = key === 'files' ? v.match(/^(.*?)\s+(?:Re-?test|Status):\s*(.*)$/i) : null;
      if (inline) { apply('files', inline[1]); apply('howToRetest', inline[2]); key = 'howToRetest'; continue; }
      apply(key, v); continue;
    }
    if (/^[-*]\s+\S/.test(raw)) { key = 'notes'; for (const c of curs) c.notes = ((c.notes || '') + '\n' + raw.replace(/^[-*]\s+/, '')).trim(); continue; }
    if (key && raw.trim()) {
      for (const c of curs) {
        if (key === 'files') c.files.push(...fileList(raw));
        else if (key !== 'status') c[key] = ((c[key] || '') + '\n' + raw.trim()).trim();
      }
    }
  }
  return out;
}

// ---- issue-state derivation from FIXES-F*.md (first pass + "Rework round"), REVIEW tables and test-run records ----
function expandIds(s) {
  const ids = []; const re = /\b(ADA|ADB|LPC|INO)-(\d{3})((?:\s*\/\s*\d{3})*)/g; let m;
  while ((m = re.exec(s || ''))) { ids.push(`${m[1]}-${m[2]}`); for (const n of (m[3].match(/\d{3}/g) || [])) ids.push(`${m[1]}-${n}`); }
  return ids;
}
function classifyFix(s) {
  s = String(s || '').toLowerCase();
  const pats = [['partial', /mostly|partly|partial/], ['not-a-defect', /not[- ]a[- ]defect/], ['not-fixed', /not[- ]fixed/], ['fixed', /fixed/], ['needs-other', /needs[- ]other/]];
  let best = null;
  for (const [k, re] of pats) { const m = s.match(re); if (m && (!best || m.index < best.i)) best = { k, i: m.index }; }
  return best ? best.k : null;
}
const REWORK_NEGATIVE = /\bnot done\b|\bremains?\b|\bleft\b|\bnot fixed\b|\bnot touched\b|\bnot edited\b|\bnot mine\b|\bnot browser|\(not run\)|\bneeds e2e/i;
// Reads one FIXES-F*.md into facts: base[id] = {status, notDone}; rework[id] = [{negative}]
function collectFixFacts(text, facts) {
  let rework = false; let cur = null;
  const flush = () => {
    if (!cur) return;
    const all = [cur.heading, ...cur.body].join('\n');
    for (const id of cur.ids) {
      if (!cur.rework) {
        const st = classifyFix(cur.statusLine != null ? cur.statusLine : cur.heading) || (/\bchang|replaced|added|\bnow\b/i.test(all) ? 'fixed' : null);
        if (!facts.base[id]) facts.base[id] = { status: st, notDone: /\bnot done\b|not built|no api/i.test(all) };
      } else (facts.rework[id] ||= []).push({ negative: REWORK_NEGATIVE.test(all) });
    }
    cur = null;
  };
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (/^#{1,4}\s+rework round/i.test(raw)) { flush(); rework = true; continue; }
    const h = raw.match(/^#{2,4}\s+(.*)$/); const bl = rework ? raw.match(/^[-*]\s+(.*)$/) : null;
    const lead = h ? h[1] : bl ? bl[1] : null;
    if (lead !== null) {
      const c = lead.indexOf(':'); const idsText = rework ? lead.slice(0, c > 0 && c < 160 ? c : 160) : lead;
      const ids = expandIds(idsText);
      if (ids.length && (rework || /^(?:ISS-)?(?:ADA|ADB|LPC|INO)-\d{3}/.test(lead))) { flush(); cur = { ids, heading: lead, body: [], rework, statusLine: null }; continue; }
      if (h) { flush(); continue; }
    }
    if (cur) { cur.body.push(raw); const sm = raw.match(/^[-*\s]*\**status\**\s*:\s*(.*)$/i); if (sm && !cur.rework) cur.statusLine = sm[1]; }
  }
  flush();
}
// "ADB-001, 002, 003 ... ADA-006 (note), ADA-007 and ADA-009": ids with bare numbers carry the previous prefix; "028(c)" sub-items are skipped
function scanIdList(s) {
  s = String(s || '').replace(/\b(?:(?:ADA|ADB|LPC|INO)-)?\d{3}\(\w\)/g, ' ').replace(/\([^)]*\)/g, ' ');
  const ids = []; let pre = null; const re = /\b(ADA|ADB|LPC|INO)-(\d{3})\b|(?<![\w-])(\d{3})\b/g; let m;
  while ((m = re.exec(s))) { if (m[1]) { pre = m[1]; ids.push(`${m[1]}-${m[2]}`); } else if (pre) ids.push(`${pre}-${m[3]}`); }
  return ids;
}
function parseTestRun(text, name) {
  const ids = new Set(); const t = String(text || '');
  const passing = /\b\d+ passed, 0 failed\b|all passing/i.test(t);
  if (/^FE-/.test(name) && passing) {
    const sec = t.match(/##\s+Issue ids with regression tests\s*\r?\n([\s\S]*?)(?=\r?\n##\s|$)/i);
    if (sec) scanIdList(sec[1]).forEach((i) => ids.add(i));
  }
  if (/^TRIAGE-/.test(name)) for (const l of t.split(/\r?\n/)) if (/\b0 fail/i.test(l)) expandIds(l).forEach((i) => ids.add(i));
  return ids;
}

function parseRetest(text, file, mtime) {
  const hist = [];
  for (const raw of (text || '').split(/\r?\n/)) {
    const m = raw.match(/^\W*(?:ISS-)?((?:ADA|ADB|LPC|INO)-\d{3})\s+(PASS|FAIL)\w*\s*(.*)$/i);
    if (!m) continue;
    const rest = m[3].trim();
    const t = rest.match(/^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?|\d{1,2}:\d{2})\s*(.*)$/);
    let at = null; let note = rest;
    if (t) {
      note = t[2];
      if (/^\d{1,2}:\d{2}$/.test(t[1])) { const d = new Date(mtime); const [h, mi] = t[1].split(':'); d.setHours(+h, +mi, 0, 0); at = d.toISOString(); }
      else at = /Z|[+-]\d{2}:?\d{2}$/.test(t[1]) ? new Date(t[1].replace(' ', 'T')).toISOString() : localTime(t[1]);
    }
    hist.push({ id: m[1].toUpperCase(), result: m[2].toUpperCase() === 'PASS' ? 'PASS' : 'FAIL', at, note: note.trim(), file });
  }
  return hist;
}

function parseGroups(text) {
  const groups = {}; let g = null;
  for (const l of text.split(/\r?\n/)) {
    const h = l.match(/^###\s+(F\d+)\s+(.*)$/); if (h) { g = groups[h[1]] = { id: h[1], title: h[2].trim(), issueIds: [], owns: '' }; continue; }
    if (!g) continue;
    if (/^Owns:/.test(l)) g.owns = l.replace(/^Owns:\s*/, '');
    if (/^Issues:/.test(l)) {
      const body = l.replace(/^Issues:\s*/, '');
      const re = /(not\s+)?\b(ADA|ADB|LPC|INO)-(\d{3})((?:\s*\.\.\s*(?:(?:ADA|ADB|LPC|INO)-)?\d{3})|(?:\s*\/\s*\d{3})+)?(\s+is\s+F\d)?/gi;
      let m;
      while ((m = re.exec(body))) {
        if (m[1] || m[5]) continue;
        const p = m[2].toUpperCase(); const a = +m[3]; const ids = [a];
        if (m[4]) {
          if (m[4].includes('..')) { const b = +m[4].match(/(\d{3})\s*$/)[1]; for (let i = a + 1; i <= b; i++) ids.push(i); }
          else m[4].split('/').slice(1).forEach((x) => ids.push(+x));
        }
        ids.forEach((n) => g.issueIds.push(`${p}-${String(n).padStart(3, '0')}`));
      }
    }
  }
  return groups;
}

// ---------- main build ----------
async function build() {
  const t0 = Date.now();
  sources.length = 0; warnings.length = 0;
  const prev = readJson(OUT);
  const manual = readJson(MANUAL) || {};
  addSource('manual-status.json (lead overrides, optional)', MANUAL, { found: !!stat(MANUAL) });

  // ----- worktrees -----
  const wtRaw = (await git(ROOT, ['worktree', 'list', '--porcelain'])) || '';
  const worktrees = [];
  for (const block of wtRaw.split(/\r?\n\r?\n/)) {
    const w = {}; for (const l of block.split(/\r?\n/)) { const [k, ...v] = l.split(' '); w[k] = v.join(' ') || true; }
    if (!w.worktree) continue;
    worktrees.push({ path: path.resolve(w.worktree), name: path.basename(w.worktree), head: (w.HEAD || '').slice(0, 7), branch: w.branch ? String(w.branch).replace('refs/heads/', '') : null,
      locked: !!w.locked, isMain: path.resolve(w.worktree).toLowerCase() === ROOT.toLowerCase() });
  }
  const baseSha = ((await git(ROOT, ['rev-parse', '--short', BASE_BRANCH])) || '').trim();
  const CACHE_FILE = path.join(os.tmpdir(), 'nexus-dashboard-git-cache.json');
  const cache = readJson(CACHE_FILE) || {}; const newCache = {};
  await pool(worktrees, 8, async (w) => {
    const ck = `${w.path}|${w.head}|${baseSha}`;
    if (cache[ck]) { Object.assign(w, cache[ck]); newCache[ck] = cache[ck]; return; }
    const c = {};
    const log = await git(w.path, ['log', '-1', '--format=%cI%x1f%s%x1f%an']);
    if (log) { const [d, s, a] = log.trim().split(''); c.lastCommitAt = d || null; c.lastCommitSubject = s || null; c.lastCommitAuthor = a || null; }
    if (!w.isMain) {
      const ahead = await git(w.path, ['rev-list', '--count', `${BASE_BRANCH}..HEAD`]);
      c.commitsAheadOfBase = ahead ? +ahead.trim() : null;
      const names = await git(w.path, ['diff', '--name-only', `${BASE_BRANCH}...HEAD`]);
      c.committedFiles = names ? names.split(String.fromCharCode(10)).map((x) => x.trim()).filter(Boolean) : [];
      const stt = await git(w.path, ['diff', '--shortstat', `${BASE_BRANCH}...HEAD`]);
      c.diffStat = stt ? stt.trim() : '';
      c.mergedIntoBase = (await git(w.path, ['merge-base', '--is-ancestor', 'HEAD', BASE_BRANCH])) !== null;
    }
    Object.assign(w, c); newCache[ck] = c;
  });
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(newCache)); } catch { /* ignore */ }
  // dirty state (cheap -uno scan everywhere; full untracked scan only for worktrees of recently active agents)
  const recentWt = new Set();
  try {
    for (const wf of fs.readdirSync(JOURNAL_ROOT)) {
      const d = path.join(JOURNAL_ROOT, wf);
      for (const f of fs.readdirSync(d)) if (f.endsWith('.meta.json')) {
        const j = stat(path.join(d, f.replace('.meta.json', '.jsonl')));
        if (j && Date.now() - j.mtimeMs < 30 * 60 * 1000) { const m = readJson(path.join(d, f)); if (m?.worktreePath) recentWt.add(path.resolve(m.worktreePath).toLowerCase()); }
      }
    }
  } catch { /* ignore */ }
  await pool(worktrees, 8, async (w) => {
    const full = w.isMain || recentWt.has(w.path.toLowerCase());
    const st = await git(w.path, full ? ['status', '--porcelain'] : ['status', '--porcelain', '-uno']);
    const lines = st ? st.split(String.fromCharCode(10)).map((x) => x.split(String.fromCharCode(13)).join('')).filter(Boolean) : [];
    w.dirtyFiles = lines.length; w.dirtyPaths = lines.slice(0, 200).map((l) => l.slice(3).trim().replace(/^"|"$/g, ''));
    w.dirtyScan = full ? 'full' : 'tracked-only';
    const mt = w.dirtyPaths.map((p) => stat(path.join(w.path, p))?.mtimeMs || 0);
    w.lastDirtyEditAt = mt.length ? iso(Math.max(...mt)) : null;
    w.files = [...new Set([...(w.committedFiles || []), ...w.dirtyPaths])];
  });
  addSource('git worktree list + per-worktree git log/diff/status', null, { found: true, count: worktrees.length });
  const wtByPath = Object.fromEntries(worktrees.map((w) => [w.path.toLowerCase(), w]));
  const wtByName = (n) => worktrees.find((w) => w.name === n);

  // ----- docs -----
  const D = (f) => path.join(ROOT, f);
  const boardText = readText(D('docs/STATUS-BOARD.md')); addSource('docs/STATUS-BOARD.md', D('docs/STATUS-BOARD.md'));
  const todoText = readText(D('docs/TODO.md')); addSource('docs/TODO.md', D('docs/TODO.md'));
  const decText = readText(D('docs/DECISION-LOG.md')); addSource('docs/DECISION-LOG.md', D('docs/DECISION-LOG.md'));
  const groupsText = readText(D('docs/issues/FIX-GROUPS.md')); addSource('docs/issues/FIX-GROUPS.md', D('docs/issues/FIX-GROUPS.md'));
  const groups = groupsText ? parseGroups(groupsText) : {};
  const gitTime = async (f) => ((await git(ROOT, ['log', '-1', '--format=%cI', '--', f])) || '').trim() || iso(stat(D(f))?.mtimeMs);
  const boardTime = iso(Math.max(stat(D('docs/STATUS-BOARD.md'))?.mtimeMs || 0, ms(await gitTime('docs/STATUS-BOARD.md'))));
  const todoTime = iso(Math.max(stat(D('docs/TODO.md'))?.mtimeMs || 0, ms(await gitTime('docs/TODO.md'))));

  // ----- issues -----
  const issueFiles = fs.existsSync(D('docs/issues')) ? fs.readdirSync(D('docs/issues')).filter((f) => /^ISSUES-.*\.md$/.test(f)) : [];
  const issues = []; const issueById = {};
  for (const f of issueFiles) {
    addSource(`docs/issues/${f}`, D('docs/issues/' + f));
    for (const i of parseIssueFile(D('docs/issues/' + f))) { if (!issueById[i.id]) { issueById[i.id] = i; issues.push(i); } }
  }
  const groupOfIssue = {};
  for (const g of Object.values(groups)) g.issueIds.forEach((id) => { if (!groupOfIssue[id]) groupOfIssue[id] = g.id; });

  function newestFiles(re) {
    const found = {};
    const dirs = [{ dir: D('docs/issues'), where: 'main checkout' }, ...worktrees.filter((w) => !w.isMain).map((w) => ({ dir: path.join(w.path, 'docs', 'issues'), where: w.name }))];
    for (const { dir, where } of dirs) {
      let names = []; try { names = fs.readdirSync(dir); } catch { continue; }
      for (const n of names) {
        if (!re.test(n)) continue; const p = path.join(dir, n); const st = stat(p); if (!st) continue;
        if (!found[n] || st.mtimeMs > found[n].mtimeMs) found[n] = { name: n, path: p, mtimeMs: st.mtimeMs, where };
      }
    }
    return Object.values(found);
  }
  const fixesByIssue = {}; const fixesFiles = newestFiles(/^FIXES-.*\.md$/);
  for (const f of fixesFiles) {
    addSource(`docs/issues/${f.name} (newest: ${f.where})`, f.path);
    const g = (f.name.match(/F\d+/) || [null])[0];
    for (const [id, e] of Object.entries(parseFixes(readText(f.path), g))) { Object.assign(e, { file: f.name, where: f.where, mtime: iso(f.mtimeMs) }); fixesByIssue[id] = e; }
  }
  const reviews = [];
  for (const f of newestFiles(/^REVIEW-.*\.md$/)) {
    addSource(`docs/issues/${f.name} (newest: ${f.where})`, f.path);
    const text = readText(f.path) || ''; const g = (f.name.match(/F\d+/) || [null])[0];
    const perIssue = {};
    const flags = {};
    for (const l of text.split(/\r?\n/)) {
      const tb = l.match(/^\|([^|]*)\|([^|]*)\|/);
      if (tb && expandIds(tb[1]).length) { const rw = /REWORK/.test(tb[2]); for (const id of expandIds(tb[1])) { perIssue[id] = rw ? 'REWORK' : 'OK'; flags[id] = { rework: rw, partial: /partial/i.test(tb[2]) }; } continue; }
      const m = l.match(/\b((?:ADA|ADB|LPC|INO)-\d{3})\b.*?\b(OK|REWORK)\b/); if (m && !perIssue[m[1]]) perIssue[m[1]] = m[2];
    }
    const all = [...text.matchAll(/\b(REWORK|OK)\b/g)].map((m) => m[1]);
    const vm = text.match(/verdict\W+(OK|REWORK)\b/i);
    const verdict = vm ? vm[1].toUpperCase() : all.includes('REWORK') ? 'REWORK' : all.length ? 'OK' : 'unknown';
    reviews.push({ group: g, file: f.name, where: f.where, verdict, perIssue, flags, updatedAt: iso(f.mtimeMs), excerpt: text.trim().slice(0, 1200) });
  }
  const retestAll = [];
  for (const f of newestFiles(/^RETEST(-.*)?\.md$/)) { addSource(`docs/issues/${f.name} (newest: ${f.where})`, f.path); retestAll.push(...parseRetest(readText(f.path), f.name, f.mtimeMs)); }
  const watchdogText = readText(D('docs/issues/WATCHDOG.md')); addSource('docs/issues/WATCHDOG.md', D('docs/issues/WATCHDOG.md'));
  const watchdog = [];
  for (const l of (watchdogText || '').split(/\r?\n/)) {
    const m = l.match(/^-\s+(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})\s*\|\s*([^|]*)\|\s*([^|]*)(?:\|\s*(.*))?$/);
    if (m) watchdog.push({ at: localTime(m[1]), subject: m[2].trim(), observation: m[3].trim(), action: (m[4] || '').trim() });
  }

  // ----- journals / agents -----
  const agents = []; const workflows = []; const now = Date.now();
  let wfDirs = []; try { wfDirs = fs.readdirSync(JOURNAL_ROOT).filter((d) => d.startsWith('wf_')); } catch { warnings.push('workflow journal directory not found: ' + JOURNAL_ROOT); }
  for (const wf of wfDirs) {
    const jp = path.join(JOURNAL_ROOT, wf, 'journal.jsonl'); const js = stat(jp); if (!js) continue;
    addSource(`workflow journal ${wf}`, jp, { found: true });
    const evs = (readText(jp) || '').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const byId = {}; let launchFailures = 0;
    for (const e of evs) {
      if (e.type === 'started') byId[e.agentId] = { ...(byId[e.agentId] || {}), id: e.agentId, label: e.label, phase: e.phase };
      else if (e.type === 'result' && e.agentId) byId[e.agentId] = { ...(byId[e.agentId] || { id: e.agentId }), result: String(e.result || '') };
      else if (e.type === 'failed') { if (e.agentId) byId[e.agentId] = { ...(byId[e.agentId] || { id: e.agentId }), failed: true }; else launchFailures++; }
    }
    const wfAgents = [];
    for (const a of Object.values(byId)) {
      const meta = readJson(path.join(JOURNAL_ROOT, wf, `agent-${a.id}.meta.json`)) || {};
      const jl = stat(path.join(JOURNAL_ROOT, wf, `agent-${a.id}.jsonl`));
      const wt = meta.worktreePath ? wtByPath[path.resolve(meta.worktreePath).toLowerCase()] : null;
      const lastMs = jl ? jl.mtimeMs : null;
      const status = a.failed ? 'failed' : a.result !== undefined ? 'done' : (lastMs && now - lastMs < ACTIVE_MS ? 'active' : 'stalled');
      const rec = { id: a.id, kind: 'workflow-agent', label: a.label || null, workflow: wf, phase: a.phase || meta.workflowPhase || null, description: meta.description || a.label || null,
        status, startedAt: jl ? iso(jl.birthtimeMs || jl.ctimeMs) : null, lastActivityAt: iso(lastMs), transcriptBytes: jl ? jl.size : null,
        worktree: wt ? wt.name : (meta.worktreePath ? path.basename(meta.worktreePath) : null), branch: wt ? wt.branch : null, lastCommitAt: wt ? wt.lastCommitAt : null,
        lastCommitSubject: wt ? wt.lastCommitSubject : null, commitsAheadOfBase: wt ? wt.commitsAheadOfBase : null, mergedIntoBase: wt ? wt.mergedIntoBase : null,
        filesTouched: wt ? wt.files.length : null, dirtyFiles: wt ? wt.dirtyFiles : null, resultSummary: a.result ? a.result.slice(0, 1500) : null, currentTask: null, completed: [], queued: [] };
      wfAgents.push(rec); agents.push(rec);
    }
    for (let i = 0; i < launchFailures; i++) agents.push({ id: `${wf}-launchfail-${i + 1}`, kind: 'workflow-agent', label: '(launch failed, no agent id)', workflow: wf, phase: null, description: 'Journal records a failed launch with an empty agentId.', status: 'failed', startedAt: null, lastActivityAt: iso(js.mtimeMs), completed: [], queued: [], currentTask: null });
    workflows.push({ id: wf, journalModifiedAt: iso(js.mtimeMs), agents: wfAgents.length, launchFailures, active: wfAgents.filter((x) => x.status === 'active').length });
  }

  // ----- issue facts: FIXES (main checkout first, then worktree copies), rework sections, supervisor flags, automated test records -----
  function allCopies(re, sub) {
    const out = []; const dirs = [{ dir: D(sub), where: 'main checkout' }, ...worktrees.filter((w) => !w.isMain).map((w) => ({ dir: path.join(w.path, ...sub.split('/')), where: w.name }))];
    for (const { dir, where } of dirs) { let names = []; try { names = fs.readdirSync(dir); } catch { continue; } for (const n of names) if (re.test(n)) { const p = path.join(dir, n); const st = stat(p); if (st) out.push({ name: n, path: p, where }); } }
    return out;
  }
  const facts = { base: {}, rework: {} };
  for (const f of allCopies(/^FIXES-F\d+\.md$/, 'docs/issues')) collectFixFacts(readText(f.path), facts);
  const autoPass = {};
  for (const f of allCopies(/^(FE|TRIAGE)-.*\.md$/, 'docs/test-runs')) { addSource(`docs/test-runs/${f.name} (${f.where})`, f.path); for (const id of parseTestRun(readText(f.path), f.name)) (autoPass[id] ||= new Set()).add(f.name); }
  const reviewFlag = (id) => { for (const r of reviews) if (r.flags && r.flags[id]) return r.flags[id]; return null; };

  // ----- issue state derivation -----
  const retestByIssue = {}; for (const r of retestAll) (retestByIssue[r.id] ||= []).push(r);
  for (const i of issues) {
    i.group = groupOfIssue[i.id] || null; i.fixer = i.group ? `fix agent ${i.group}` : null;
    const fx = fixesByIssue[i.id]; i.fix = fx || null;
    const hist = (retestByIssue[i.id] || []).slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
    i.retestHistory = hist.map((h) => ({ result: h.result, at: h.at, note: h.note }));
    const last = hist[hist.length - 1];
    i.reviewVerdict = reviews.find((r) => r.perIssue[i.id])?.perIssue[i.id] || null;
    let state = 'open';
    const fact = facts.base[i.id]; const rwk = facts.rework[i.id] || []; const reworked = rwk.some((e) => !e.negative); const rf = reviewFlag(i.id);
    let fstat = fact ? fact.status : (fx ? fx.status : null); const notes = [];
    if ((fstat === 'needs-other' || fstat === 'partial') && reworked) { fstat = 'fixed'; notes.push('resolved in rework round'); }
    if (fstat === 'fixed' && rf && rf.partial && !(reworked && !(fact && fact.notDone))) { fstat = 'partial'; notes.push('supervisor: partial'); }
    if (rf && rf.rework) notes.push(reworked ? 'supervisor REWORK, rework round recorded' : 'supervisor REWORK pending');
    if (fstat === 'fixed') { if (autoPass[i.id]) { state = 'passed_automated'; notes.push('passing automated test: ' + [...autoPass[i.id]].join(', ')); } else state = 'fixed_awaiting_retest'; }
    else if (fstat === 'partial') state = 'partially_fixed';
    else if (fstat === 'not-a-defect') state = 'not_a_defect';
    i.stateNote = notes.join('; ') || null;
    if (false && fx && fx.status === 'fixed') state = 'fixed_awaiting_retest';
    // (legacy status mapping replaced by the facts-based derivation above)
    if (last) {
      const fixNewer = fx && fx.status === 'fixed' && fx.mtime && last.at && fx.mtime > last.at;
      if (last.result === 'PASS') state = 'passed'; else if (!fixNewer) state = 'failed';
    }
    i.state = state; i.fixStatus = fstat || (fx ? fx.status : null);
    i.rootCause = fx ? fx.rootCause : null; i.fixFiles = fx ? fx.files : []; i.howToRetest = fx ? fx.howToRetest : null;
    i.updatedAt = iso(Math.max(ms(fx?.mtime), ms(last?.at)) || null);
  }

  // ----- tasks -----
  const tasks = []; const taskById = {};
  const addTask = (t) => { const full = { description: '', agent: null, startedAt: null, updatedAt: null, files: [], verification: null, issueIds: [], notes: null, source: null, ...t }; tasks.push(full); taskById[full.id] = full; return full; };
  const tables = boardText ? mdTables(boardText) : [];
  const boardA = tables.find((t) => /Workstream A/i.test(t.heading));
  const boardB = tables.find((t) => /Workstream B/i.test(t.heading));
  const todoTables = todoText ? mdTables(todoText) : [];
  const milestones = todoTables.find((t) => /High level/i.test(t.heading));
  const r4 = todoTables.find((t) => /Round 4/i.test(t.heading));
  const agentFor = (label) => agents.filter((a) => a.label === label).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0];

  for (const row of boardA ? boardA.rows : []) {
    const gm = String(row.Group || '').match(/^(F\d+)\b/);
    const gid = gm ? gm[1] : null; const label = String(row.Group).replace(/^F\d+\s*/, '');
    if (gid) {
      const gi = issues.filter((i) => i.group === gid);
      let ag = agentFor(`fix:${gid}`);
      const fixFile = fixesFiles.find((f) => f.name.includes(gid));
      const wt = ag?.worktree ? wtByName(ag.worktree) : (fixFile ? wtByName(fixFile.where) : null);
      if (!ag) {
        const recent = (fixFile && now - fixFile.mtimeMs < ACTIVE_MS) || (wt && wt.lastDirtyEditAt && now - ms(wt.lastDirtyEditAt) < ACTIVE_MS);
        const relaunched = watchdog.some((w) => w.subject.includes(gid) && /relaunch/i.test(w.action));
        ag = { id: `fix-${gid}`, kind: 'logical', label: `fix:${gid}`, workflow: null, phase: 'Fix', description: `Fix agent ${gid}: not in a workflow journal${relaunched ? '; relaunched manually per WATCHDOG.md (no journal entry)' : ''}`,
          status: recent ? 'active' : 'queued', startedAt: null, lastActivityAt: fixFile ? iso(fixFile.mtimeMs) : (wt?.lastDirtyEditAt || null), worktree: wt ? wt.name : null, branch: wt ? wt.branch : null,
          lastCommitAt: wt ? wt.lastCommitAt : null, lastCommitSubject: wt ? wt.lastCommitSubject : null, commitsAheadOfBase: wt ? wt.commitsAheadOfBase : null, filesTouched: wt ? wt.files.length : null, dirtyFiles: wt ? wt.dirtyFiles : null, completed: [], queued: [], currentTask: null };
        agents.push(ag);
      }
      const counts = (s) => gi.filter((i) => i.state === s).length;
      const fixedN = gi.filter((i) => i.fix && i.fix.status).length;
      let state = stateFromText(row.State);
      if (gi.length) {
        const resolved = gi.filter((i) => ['passed', 'passed_automated', 'not_a_defect'].includes(i.state)).length;
        if (counts('failed')) state = 'failed';
        else if (resolved === gi.length) state = 'passed';
        else if (gi.every((i) => i.state !== 'open')) state = 'awaiting_retest';
        else if (fixedN > 0 || ag.status === 'active') state = 'in_progress';
        else if (ag.status === 'failed') state = 'failed';
      } else if (ag.status === 'active') state = 'in_progress';
      const t = addTask({ id: `A-${gid}`, title: `${gid} ${label}`, description: `${groups[gid]?.title || label}. Issues: ${row.Issues}. Owns: ${groups[gid]?.owns || 'see FIX-GROUPS.md'}`.slice(0, 1500),
        stage: 'qa-fix', workstream: 'A', agent: ag.id, state, issueIds: gi.map((i) => i.id), files: wt ? wt.files.slice(0, 300) : [],
        startedAt: ag.startedAt, updatedAt: iso(Math.max(ms(ag.lastActivityAt), ms(ag.lastCommitAt), ms(boardTime)) || null),
        verification: gi.length ? `${fixedN} of ${gi.length} issues have a FIXES entry; ${counts('passed') + counts('passed_automated')} passed (retest or automated test); ${counts('failed')} FAIL; ${counts('not_a_defect')} not a defect` : 'no issues mapped from FIX-GROUPS.md',
        source: 'STATUS-BOARD.md + FIXES/RETEST files', boardState: row.State });
      ag.currentTask = t.id; ag.completed = gi.filter((i) => i.fix).map((i) => i.id); ag.queued = gi.filter((i) => !i.fix).map((i) => i.id);
    } else {
      const isWatch = /watchdog/i.test(row.Group);
      let state = stateFromText(row.State);
      if (isWatch && watchdog.length) state = 'in_progress';
      if (!isWatch && reviews.length) state = 'in_progress';
      addTask({ id: isWatch ? 'A-WATCHDOG' : 'A-SUPERVISOR', title: row.Group, description: `${row.Issues} (owner: ${row.Owner})`, stage: 'qa-fix', workstream: 'A', state, updatedAt: boardTime,
        verification: isWatch ? `${watchdog.length} watchdog events logged in WATCHDOG.md` : `${reviews.length} REVIEW-F*.md files found (${reviews.filter((r) => r.verdict === 'OK').length} OK, ${reviews.filter((r) => r.verdict === 'REWORK').length} REWORK)`,
        source: 'STATUS-BOARD.md', boardState: row.State });
    }
  }
  const tok = (s) => new Set(String(s).toLowerCase().replace(/\(.*?\)/g, ' ').split(/[^a-z0-9]+/).filter((w) => w.length > 3));
  const usedMilestones = new Set();
  for (const row of boardB ? boardB.rows : []) {
    if (/Round 4 feature/i.test(row.Stage)) continue; // represented by R4-n tasks
    let desc = row.Owner ? `Owner: ${row.Owner}` : '';
    const tk = tok(row.Stage);
    const m = (milestones ? milestones.rows : []).find((x) => [...tok(x.Milestone)].filter((w) => tk.has(w)).length >= 2);
    if (m) { usedMilestones.add(m['#']); desc += ` | TODO ${m['#']}: ${m.Milestone}`; }
    addTask({ id: `B-${row.Stage.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`, title: row.Stage, description: desc, stage: 'release', workstream: 'B', state: stateFromText(row.State), updatedAt: boardTime, source: 'STATUS-BOARD.md', boardState: row.State });
  }
  for (const m of milestones ? milestones.rows : []) {
    if (usedMilestones.has(m['#'])) continue;
    const cb = (m.State.match(/\[(.)\]/) || [])[1];
    addTask({ id: m['#'], title: m.Milestone.slice(0, 160), description: m.Milestone, stage: 'milestones', workstream: 'C', state: cb === 'x' ? 'passed' : cb === '~' ? 'awaiting_retest' : 'not_started',
      updatedAt: todoTime, verification: m.State.replace(/\[.\]\s*/, '') || null, source: 'TODO.md section 1' });
  }
  const unlabelledFails = agents.filter((a) => /8fa38168/.test(a.workflow || '') && a.status === 'failed' && /launch failed/.test(a.label || '')).length;
  for (const p of r4 ? r4.rows : []) {
    const n = (p.Pkg.match(/R4-(\d+)/) || [])[1]; const ag = agentFor(`build:r4-${n}`);
    const wt = ag?.worktree ? wtByName(ag.worktree) : null;
    let state = 'not_started'; let note = null;
    const cb = (p.State.match(/\[(.)\]/) || [])[1];
    if (cb === 'x') state = 'passed';
    if (ag) {
      if (ag.status === 'active') state = 'in_progress';
      else if (ag.status === 'failed') state = 'failed';
      else if (ag.status === 'done') state = cb === 'x' ? 'passed' : (wt && wt.mergedIntoBase ? 'awaiting_retest' : 'in_progress');
      if (ag.status === 'done') note = wt?.mergedIntoBase ? 'Journal result present and branch merged into base; not verified end to end.' : 'Journal result present; branch not yet merged into base.';
    } else note = unlabelledFails ? `No journal result for this package; round-4 journal has ${unlabelledFails} failed launch(es) with no label or agent id.` : 'No journal entry found.';
    addTask({ id: p.Pkg, title: `${p.Pkg}: ${p.Scope.slice(0, 110)}`, description: p.Scope, stage: 'r4', workstream: 'B', state, agent: ag ? ag.id : null,
      startedAt: ag?.startedAt || null, updatedAt: iso(Math.max(ms(ag?.lastActivityAt), ms(ag?.lastCommitAt), ms(todoTime)) || null), files: wt ? wt.files.slice(0, 300) : [],
      verification: ag?.resultSummary ? ag.resultSummary.slice(0, 600) : null, notes: note, source: 'TODO.md section 7 + workflow journal', todoState: p.State });
    if (ag) { ag.currentTask = p.Pkg; ag.completed = ag.status === 'done' ? [p.Pkg] : []; }
  }

  // ----- manual overrides -----
  const manualAt = iso(stat(MANUAL)?.mtimeMs);
  for (const [id, o] of Object.entries(manual.tasks || {})) if (taskById[id]) Object.assign(taskById[id], { updatedAt: manualAt }, o, { manualOverride: true });
  for (const t of manual.addTasks || []) if (t && t.id && !taskById[t.id]) addTask({ stage: 'manual', workstream: 'B', state: 'not_started', manualOverride: true, updatedAt: iso(stat(MANUAL)?.mtimeMs), ...t });
  for (const t of tasks) if (!STATES.includes(t.state)) { warnings.push(`task ${t.id}: invalid state '${t.state}' reset to not_started`); t.state = 'not_started'; }
  for (const [id, o] of Object.entries(manual.issues || {})) { const i = issueById[id]; if (i) Object.assign(i, o, { manualOverride: true }); }
  for (const [id, o] of Object.entries(manual.agents || {})) { const a = agents.find((x) => x.id === id || x.label === id); if (a) Object.assign(a, o, { manualOverride: true }); }
  const prevTask = Object.fromEntries((prev?.tasks || []).map((t) => [t.id, t]));
  const gen = new Date().toISOString();
  for (const t of tasks) { const p = prevTask[t.id]; t.stateChangedAt = p && p.state === t.state && p.stateChangedAt ? p.stateChangedAt : (p ? gen : (t.updatedAt || gen)); if (!t.updatedAt) t.updatedAt = t.stateChangedAt; }

  // ----- stages / workstreams -----
  const stageDefs = [
    { id: 'milestones', title: 'Milestones (TODO.md)', workstream: 'C', description: 'TODO.md section 1 milestones' },
    { id: 'qa-fix', title: 'QA fix round (F1-F9, supervisor, watchdog)', workstream: 'A', description: 'Fix groups from docs/issues/FIX-GROUPS.md and their re-test' },
    { id: 'r4', title: 'Round 4 feature packages', workstream: 'B', description: 'TODO.md section 7 packages R4-1..R4-10' },
    { id: 'release', title: 'Release and live data', workstream: 'B', description: 'STATUS-BOARD.md workstream B rows' },
    { id: 'manual', title: 'Added by lead', workstream: 'B', description: 'Tasks added in manual-status.json' },
  ];
  const wsDefs = [
    { id: 'A', title: 'A: Fixes and re-test', description: 'Resolve the browser-QA issues, review, and re-test' },
    { id: 'B', title: 'B: Next stages', description: 'Round 4 packages, release, live data' },
    { id: 'C', title: 'C: Delivered baseline', description: 'TODO.md milestones (done and pending)' },
  ];
  const prog = (ts) => { const c = Object.fromEntries(STATES.map((s) => [s, 0])); ts.forEach((t) => c[t.state]++); return { total: ts.length, counts: c, progressPct: ts.length ? Math.round((ts.reduce((a, t) => a + WEIGHT[t.state], 0) / ts.length) * 1000) / 10 : null }; };
  const stages = stageDefs.map((s) => ({ ...s, ...prog(tasks.filter((t) => t.stage === s.id)), taskIds: tasks.filter((t) => t.stage === s.id).map((t) => t.id), ...(manual.stages?.[s.id] || {}) })).filter((s) => s.total > 0);
  const workstreams = wsDefs.map((w) => ({ ...w, ...prog(tasks.filter((t) => t.workstream === w.id)), taskIds: tasks.filter((t) => t.workstream === w.id).map((t) => t.id), ...(manual.workstreams?.[w.id] || {}) }));

  const agentsOut = agents.sort((x, y) => String(y.lastActivityAt).localeCompare(String(x.lastActivityAt)));

  const decisions = [];
  if (decText) for (const tb of mdTables(decText)) for (const r of tb.rows) if (/^D-/.test(r['#'] || '')) decisions.push({ id: r['#'], date: r.Date, unclear: r['What was unclear'], decision: r.Decision, reason: r.Why });

  const pAll = prog(tasks); const pAct = prog(tasks.filter((t) => t.workstream !== 'C'));
  const issueCounts = { total: issues.length, byState: {}, openBySeverity: { critical: 0, major: 0, minor: 0 }, bySeverity: { critical: 0, major: 0, minor: 0 } };
  for (const i of issues) { issueCounts.byState[i.state] = (issueCounts.byState[i.state] || 0) + 1; issueCounts.bySeverity[i.severity]++; if (['open', 'failed'].includes(i.state)) issueCounts.openBySeverity[i.severity]++; }
  const project = { name: 'Matanho Nexus', baseBranch: BASE_BRANCH, baseCommit: baseSha, progressPct: pAll.progressPct, progressPctExcludingBaseline: pAct.progressPct, taskCount: pAll.total, stateCounts: pAll.counts,
    progressRule: 'passed=1, awaiting_retest=0.8, in_progress=0.5, others 0; every task weighted equally', activeAgents: agentsOut.filter((a) => a.status === 'active').length, issues: issueCounts, ...(manual.project || {}) };

  // ----- activity (append-only, newest first, max 200) -----
  const activity = (prev?.activity || []).slice(); const seen = new Set(activity.map((a) => a.key));
  const push = (e) => { if (!seen.has(e.key)) { seen.add(e.key); activity.push(e); } };
  for (const w of watchdog) push({ key: `wd:${w.at}:${w.subject}`, at: w.at, kind: 'watchdog', ref: w.subject, text: `Watchdog ${w.subject}: ${w.observation}${w.action ? ' -> ' + w.action : ''}` });
  for (const r of retestAll) if (r.at) push({ key: `rt:${r.id}:${r.at}:${r.result}`, at: r.at, kind: 'retest', ref: r.id, text: `Re-test ${r.id} ${r.result}${r.note ? ': ' + r.note : ''}` });
  if (prev) {
    const pi = Object.fromEntries((prev.issues || []).map((i) => [i.id, i])); const pa = Object.fromEntries((prev.agents || []).map((a) => [a.id, a]));
    const pw = Object.fromEntries((prev.worktrees || []).map((w) => [w.name, w]));
    for (const t of tasks) { const p = prevTask[t.id]; if (p && p.state !== t.state) push({ key: `task:${t.id}:${p.state}>${t.state}:${gen}`, at: gen, kind: 'task', ref: t.id, text: `Task ${t.id} ${p.state} -> ${t.state}` }); else if (!p) push({ key: `tasknew:${t.id}:${gen}`, at: gen, kind: 'task', ref: t.id, text: `New task ${t.id}: ${t.title}` }); }
    for (const i of issues) { const p = pi[i.id]; if (p && p.state !== i.state) push({ key: `iss:${i.id}:${p.state}>${i.state}:${gen}`, at: gen, kind: 'issue', ref: i.id, text: `Issue ${i.id} ${p.state} -> ${i.state}` }); }
    for (const a of agentsOut) { const p = pa[a.id]; if (p && p.status !== a.status) push({ key: `ag:${a.id}:${p.status}>${a.status}:${gen}`, at: gen, kind: 'agent', ref: a.id, text: `Agent ${a.label || a.id} ${p.status} -> ${a.status}` }); else if (!p) push({ key: `agnew:${a.id}:${gen}`, at: gen, kind: 'agent', ref: a.id, text: `Agent ${a.label || a.id} appeared (${a.status})` }); }
    for (const w of worktrees) { const p = pw[w.name]; if (p && p.head !== w.head) push({ key: `commit:${w.name}:${w.head}`, at: w.lastCommitAt || gen, kind: 'commit', ref: w.name, text: `New commit ${w.head} on ${w.branch || w.name}: ${w.lastCommitSubject || ''}` }); }
  }
  activity.sort((a, b) => String(b.at).localeCompare(String(a.at))); activity.length = Math.min(activity.length, 200);

  const sizes = { sourceBytes: sources.reduce((a, s) => a + (s.bytes || 0), 0), issues: issues.length, tasks: tasks.length, agents: agentsOut.length, worktrees: worktrees.length, decisions: decisions.length, activity: activity.length, buildMs: Date.now() - t0 };
  const status = { schemaVersion: 1, generatedAt: gen, sources, warnings, project, workstreams, stages, tasks, agents: agentsOut, issues, reviews, watchdog, decisions, workflows,
    worktrees: worktrees.map(({ dirtyPaths, committedFiles, files, path: _p, ...w }) => ({ ...w, filesTouched: files ? files.length : null })), activity, notes: manual.notes || [], sizes };
  status.sizes.statusJsonBytes = Buffer.byteLength(JSON.stringify(status, null, 1));
  fs.writeFileSync(OUT + '.tmp', JSON.stringify(status, null, 1)); fs.renameSync(OUT + '.tmp', OUT);
  console.log(`[${gen}] status.json written: ${tasks.length} tasks, ${issues.length} issues, ${agentsOut.length} agents, ${worktrees.length} worktrees, ${sizes.buildMs} ms`);
}

const wi = process.argv.indexOf('--watch');
if (wi === -1) { build().catch((e) => { console.error(e); process.exit(1); }); }
else {
  const secs = Math.max(10, +process.argv[wi + 1] || 120);
  let running = false; let last = 0; let lastManual = stat(MANUAL)?.mtimeMs || 0;
  const run = async () => { if (running) return; running = true; try { await build(); } catch (e) { console.error('build failed:', e); } running = false; last = Date.now(); };
  await run();
  setInterval(() => {
    const m = stat(MANUAL)?.mtimeMs || 0;
    if (m !== lastManual) { lastManual = m; run(); } else if (Date.now() - last >= secs * 1000) run();
  }, 3000);
}
