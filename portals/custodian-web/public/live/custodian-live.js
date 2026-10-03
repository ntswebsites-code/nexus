/*
 * Custodian portal: live wiring of the V65 page to /api/v1/custodian (SRD 5E, FR-AUTH-018,
 * FR-REC-012..015). Loaded before the prototype script; it only touches the prototype's DOM.
 *
 * Mode comes from GET /api/v1/platform/flags (`custodian.live`):
 *   - live: sign-in card (portal `custodian`), counterparty header, account lists from the
 *     counterparty, execution and day-end submissions posted to the API (the day-end hash is
 *     computed by the server), approval by a second user, status panel from the API;
 *   - not live: amber "Demo data" ribbon; the prototype keeps its browser-only records;
 *   - flags unreachable: red ribbon and submissions are blocked.
 */
(function () {
  'use strict';
  var API = String(window.__MATANHO_API__ || '').replace(/\/+$/, '');
  var mode = 'pending';
  var me = null;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]; });
  };

  var legacyReady = new Promise(function (resolve) {
    if (document.documentElement.dataset.legacyReady) return resolve();
    window.addEventListener('matanho:legacy-ready', function () { resolve(); }, { once: true });
  });

  // ------------------------------------------------------------------ ui helpers
  function ribbon(kind, text) {
    var el = document.getElementById('mx-ribbon');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mx-ribbon';
      el.setAttribute('role', 'status');
      document.body.insertBefore(el, document.body.firstChild);
    }
    el.style.cssText = 'position:sticky;top:0;z-index:2147483000;padding:8px 16px;font:700 12px/1.4 Inter,system-ui,sans-serif;text-align:center;color:#fff;background:' + (kind === 'error' ? '#a9253e' : '#9a6400');
    el.textContent = text;
  }
  function toast(title, message, kind) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.querySelector('strong').textContent = title;
    t.querySelector('span').textContent = message || '';
    t.style.display = 'block';
    t.style.borderLeft = '4px solid ' + (kind === 'error' ? '#a9253e' : kind === 'warn' ? '#9a6400' : '#1f7a4d');
    clearTimeout(t._mx);
    t._mx = setTimeout(function () { t.style.display = 'none'; }, kind === 'error' ? 8000 : 4500);
  }
  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Harare' });
    } catch (e) { return iso; }
  }
  function num(v) { return Number(v).toLocaleString('en-GB', { maximumFractionDigits: 8 }); }
  function key() { return 'cx-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10); }

  // ------------------------------------------------------------------ api
  function request(method, path, body, headers) {
    var h = { Accept: 'application/json' };
    var payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      h['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    if (headers) Object.keys(headers).forEach(function (k) { h[k] = headers[k]; });
    return fetch(API + path, { method: method, headers: h, body: payload, credentials: 'include' }).then(function (res) {
      return res.text().then(function (text) {
        var json;
        try { json = text ? JSON.parse(text) : undefined; } catch (e) { json = undefined; }
        if (res.ok) return json;
        var e = json && json.error;
        var err = new Error((e && e.message) || 'Request failed (' + res.status + ')');
        err.status = res.status;
        err.code = (e && e.code) || 'http_error';
        err.details = e && e.details;
        throw err;
      });
    }, function () {
      var err = new Error('Matanho could not be reached. Check your connection and try again.');
      err.code = 'network';
      throw err;
    });
  }

  // ------------------------------------------------------------------ sign-in
  function overlay(html) {
    var wrap = document.getElementById('mx-auth');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'mx-auth';
      wrap.setAttribute('role', 'dialog');
      wrap.setAttribute('aria-modal', 'true');
      wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:rgba(15,24,38,.55);display:grid;place-items:center;font:13px/1.5 Inter,system-ui,sans-serif';
      document.body.appendChild(wrap);
    }
    wrap.innerHTML = '<div style="background:#fff;border-radius:14px;padding:24px 26px;width:min(400px,92vw);box-shadow:0 24px 60px rgba(15,34,65,.28);color:#10213a">' +
      '<div style="font-size:10px;letter-spacing:.08em;color:#5d6877;font-weight:700">MATANHO · CUSTODIAN DATA PORTAL</div>' + html + '</div>';
    return wrap;
  }
  var inputCss = 'width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #d5dce7;border-radius:9px;font-size:14px;margin:4px 0 10px';
  var btnCss = 'border:1px solid #0f2a4a;background:#0f2a4a;color:#fff;border-radius:9px;padding:9px 16px;font:700 12px Inter,system-ui,sans-serif;cursor:pointer';
  function closeOverlay() {
    var w = document.getElementById('mx-auth');
    if (w) w.remove();
  }
  function signIn(message) {
    return new Promise(function (resolve) {
      var w = overlay('<h2 style="margin:4px 0 12px;font-size:18px">Sign in</h2>' +
        (message ? '<p style="color:#a9253e;font-weight:600">' + esc(message) + '</p>' : '') +
        '<form id="mxLogin"><label>Email<input id="mxEmail" type="email" autocomplete="username" required style="' + inputCss + '"></label>' +
        '<label>Password<input id="mxPassword" type="password" autocomplete="current-password" required style="' + inputCss + '"></label>' +
        '<div id="mxCodeRow" style="display:none"><label>Authentication code<input id="mxCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" style="' + inputCss + '"></label></div>' +
        '<p id="mxErr" style="color:#a9253e;min-height:18px;margin:0 0 8px;font-size:12px"></p>' +
        '<div style="text-align:right"><button type="submit" style="' + btnCss + '">Sign in</button></div></form>' +
        '<p style="color:#5d6877;font-size:11px;margin-top:12px">Access is limited to users invited by Matanho operations for your organisation.</p>');
      var form = $('#mxLogin', w);
      var stage = 'password';
      $('#mxEmail', w).focus();
      form.onsubmit = function (ev) {
        ev.preventDefault();
        var err = $('#mxErr', w);
        err.textContent = '';
        var p = stage === 'password'
          ? request('POST', '/api/auth/login', { email: $('#mxEmail', w).value.trim(), password: $('#mxPassword', w).value, portal: 'custodian' })
          : request('POST', '/api/auth/mfa/verify', { code: $('#mxCode', w).value.replace(/\s+/g, '') });
        p.then(function (r) {
          if (stage === 'password' && r && r.mfa === 'verify') {
            stage = 'code';
            $('#mxCodeRow', w).style.display = '';
            $('#mxCode', w).required = true;
            $('#mxCode', w).focus();
            return;
          }
          if (stage === 'password' && r && r.mfa === 'enroll') {
            return request('POST', '/api/auth/mfa/enroll', {}).then(function (enrolled) {
              stage = 'code';
              $('#mxCodeRow', w).style.display = '';
              $('#mxCode', w).required = true;
              var hint = document.createElement('p');
              hint.style.cssText = 'font-size:12px;color:#243044;margin:0 0 8px';
              hint.textContent = 'Add this key to your authenticator app, then enter the 6-digit code. ' + (enrolled && enrolled.secret ? enrolled.secret : '');
              err.parentNode.insertBefore(hint, err);
              $('#mxCode', w).focus();
            });
          }
          closeOverlay();
          resolve();
        }).catch(function (e) {
          err.textContent = e.message;
        });
      };
    });
  }
  function blocked(message) {
    var w = overlay('<h2 style="margin:4px 0 12px;font-size:18px">Access not available</h2><p>' + esc(message) + '</p>' +
      '<div style="text-align:right"><button type="button" id="mxOut" style="' + btnCss + '">Sign out</button></div>');
    $('#mxOut', w).onclick = function () {
      request('POST', '/api/auth/logout', {}).finally(function () { window.location.reload(); });
    };
  }
  function loadMe() {
    return request('GET', '/api/v1/custodian/me').catch(function (err) {
      if (err.status === 401) return signIn(err.code === 'mfa_required' ? 'Enter your authentication code to continue.' : '').then(loadMe);
      if (err.status === 403) {
        blocked(err.code === 'no_counterparty' ? 'Your account is not linked to an active counterparty. Contact Matanho operations.' : 'This account is not authorised to use the custodian portal.');
        throw err;
      }
      throw err;
    });
  }

  // ------------------------------------------------------------------ page chrome
  function decorate() {
    var pill = $('.secure');
    if (pill) {
      pill.innerHTML = esc(me.counterparty.name) + ' · ' + esc(me.user.name || me.user.email) + ' (' + esc(me.role) + ') ' +
        '<button type="button" id="mxSignOut" style="margin-left:8px;border:1px solid currentColor;background:transparent;color:inherit;border-radius:7px;padding:2px 8px;font:700 11px Inter,system-ui,sans-serif;cursor:pointer">Sign out</button>';
      $('#mxSignOut').onclick = function () {
        request('POST', '/api/auth/logout', {}).finally(function () { window.location.reload(); });
      };
    }
    var list = document.createElement('datalist');
    list.id = 'mxAccounts';
    list.innerHTML = me.counterparty.accounts.map(function (a) { return '<option value="' + esc(a) + '">'; }).join('');
    document.body.appendChild(list);
    ['account', 'dayAccount'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.setAttribute('list', 'mxAccounts');
      if (me.counterparty.accounts.length && me.counterparty.accounts.indexOf(el.value) < 0) el.value = me.counterparty.accounts[0];
    });
    var note = $('[data-pane="execution"] .note');
    if (note) note.textContent = 'Each submission is stored by Matanho with your user identity, a server timestamp and an audit record. Until Matanho matches it, an execution can be amended or cancelled from the status panel with a reason; every change is kept in its history.';
    addBulkTab();
    addDayTotals();
    var label = $('#dayFileLabel');
    if (label && label.nextElementSibling) label.nextElementSibling.textContent = 'Required. The file is stored encrypted and Matanho computes its SHA-256 fingerprint on receipt.';
  }
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var PILL = { Received: '#1f7a4d', Matched: '#1f7a4d', Approved: '#1f7a4d', Accepted: '#1f7a4d', Exception: '#9a6400', Rejected: '#a9253e', Queried: '#3158e8', Superseded: '#6f7b8c', Cancelled: '#6f7b8c', Draft: '#6f7b8c' };
  var executionsById = {};
  function canSubmit() { return me.permissions.indexOf('custodian.executions.submit') >= 0; }

  // ------------------------------------------------------------------ bulk upload tab and day-end control totals
  function addDayTotals() {
    var form = $('#dayForm .form');
    if (!form || $('#mxDayQty')) return;
    var anchor = $('#trades') && $('#trades').closest('.field');
    var html = '<label class="field"><span>Control total: quantity (optional)</span><input id="mxDayQty" inputmode="decimal" placeholder="Sum of executed quantity"></label>' +
      '<label class="field"><span>Control total: notional (optional)</span><input id="mxDayNotional" inputmode="decimal" placeholder="Sum of quantity x price"></label>';
    if (anchor) anchor.insertAdjacentHTML('afterend', html);
    else form.insertAdjacentHTML('beforeend', html);
  }
  function addBulkTab() {
    var tabs = $('.tabs');
    if (!tabs || $('[data-tab="bulk"]')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-tab', 'bulk');
    btn.textContent = 'Bulk upload (CSV)';
    tabs.appendChild(btn);
    var pane = document.createElement('div');
    pane.className = 'pane';
    pane.setAttribute('data-pane', 'bulk');
    pane.innerHTML = '<form id="mxBulkForm"><div class="form">' +
      '<label class="field full"><span>Executions CSV</span><label class="drop"><input id="mxBulkFile" type="file" accept=".csv,text/csv"><strong id="mxBulkLabel">Select executions CSV</strong>' +
      '<small>Columns: tradeRef, executionAt (ISO 8601), accountRef, ticker, side, quantity, price, currency; optional isin, settlementDate, broker, note. Up to 1000 rows. The whole file is rejected if any row is invalid.</small></label></label>' +
      '<label class="field"><span>Declared trade count</span><input id="mxBulkCount" type="number" min="0"></label>' +
      '<label class="field"><span>Declared total quantity</span><input id="mxBulkQty" inputmode="decimal"></label>' +
      '<label class="field"><span>Declared total notional</span><input id="mxBulkNotional" inputmode="decimal"></label></div>' +
      '<div id="mxBulkResult" role="status" style="margin:10px 0;font-size:12px"></div>' +
      '<div class="actions"><button type="button" class="btn" id="mxBulkTemplate">Download template</button><button type="button" class="btn" id="mxBulkCheck">Validate only</button><button class="btn primary" type="submit">Upload executions</button></div></form>' +
      '<div class="note">Declared totals are optional control totals: when given, they must equal the file or nothing is stored. Trade references already on file are skipped and reported.</div>';
    var host = $('[data-pane="dayend"]');
    host.parentNode.appendChild(pane);
    btn.onclick = function () {
      $$('[data-tab]').forEach(function (x) { x.classList.toggle('active', x === btn); });
      $$('[data-pane]').forEach(function (p) { p.classList.toggle('active', p.getAttribute('data-pane') === 'bulk'); });
    };
    $('#mxBulkFile').onchange = function (e) {
      $('#mxBulkLabel').textContent = (e.target.files && e.target.files[0] && e.target.files[0].name) || 'Select executions CSV';
    };
    $('#mxBulkTemplate').onclick = function () {
      var csv = 'tradeRef,executionAt,accountRef,ticker,side,quantity,price,currency,settlementDate,broker,note\r\nTRD-0001,' + new Date().toISOString() + ',' + (me.counterparty.accounts[0] || 'ACCOUNT') + ',DLTA.ZW,BUY,1000,0.25,USD,,Broker name,\r\n';
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = 'executions-template.csv';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    };
    $('#mxBulkCheck').onclick = function () { runBulk(true); };
    $('#mxBulkForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      runBulk(false);
    });
  }
  var bulkSig = '';
  var bulkKey = null;
  function bulkMessage(html, kind) {
    var el = $('#mxBulkResult');
    el.style.color = kind === 'error' ? '#a9253e' : kind === 'ok' ? '#1f7a4d' : '#243044';
    el.innerHTML = html;
  }
  function runBulk(dry) {
    if (mode !== 'live' || !me) return bulkMessage('Sign in before uploading.', 'error');
    var file = $('#mxBulkFile').files[0];
    if (!file) return bulkMessage('Select the executions CSV first.', 'error');
    var fields = { declaredCount: $('#mxBulkCount').value.trim(), declaredQuantity: $('#mxBulkQty').value.trim(), declaredNotional: $('#mxBulkNotional').value.trim() };
    var sig = JSON.stringify(fields) + '|' + file.name + '|' + file.size + '|' + file.lastModified + '|' + dry;
    if (sig !== bulkSig) { bulkSig = sig; bulkKey = key(); }
    var fd = new FormData();
    Object.keys(fields).forEach(function (k) { if (fields[k] !== '') fd.append(k, fields[k]); });
    if (dry) fd.append('dryRun', 'true');
    fd.append('file', file, file.name);
    bulkMessage('Checking ' + esc(file.name) + '…');
    return request('POST', '/api/v1/custodian/executions/bulk', fd, { 'Idempotency-Key': bulkKey }).then(function (r) {
      bulkSig = '';
      if (dry) {
        var dup = r.duplicates && r.duplicates.length ? ' ' + r.duplicates.length + ' trade reference(s) are already on file and will be skipped.' : '';
        return bulkMessage('File is valid: ' + esc(r.rowCount) + ' rows, ' + esc(r.newCount) + ' new. Quantity ' + esc(num(r.totals.quantity)) + ', notional ' + esc(num(r.totals.notional)) + '.' + dup, 'ok');
      }
      var skipped = r.duplicates && r.duplicates.length ? ' ' + r.duplicates.length + ' already on file were skipped.' : '';
      bulkMessage('Batch ' + esc(r.batch.ref) + ' stored: ' + esc(r.batch.acceptedCount) + ' executions received.' + skipped, 'ok');
      toast('Bulk upload received', r.batch.ref + ' · ' + r.batch.acceptedCount + ' executions for Matanho Reconciliations.');
      $('#mxBulkFile').value = '';
      $('#mxBulkLabel').textContent = 'Select executions CSV';
      return refresh();
    }, function (err) {
      var d = err.details || {};
      var html = '<strong>' + esc(err.message) + '</strong>';
      if (d.errors && d.errors.length) {
        html += '<ul style="margin:6px 0 0 18px;padding:0">' + d.errors.slice(0, 15).map(function (e) { return '<li>Row ' + esc(e.row) + (e.field ? ' · ' + esc(e.field) : '') + ': ' + esc(e.message) + '</li>'; }).join('') + '</ul>' + (d.errors.length > 15 ? '<div>… and ' + (d.errors.length - 15) + ' more</div>' : '');
      }
      if (d.control) {
        html += '<ul style="margin:6px 0 0 18px;padding:0">' + Object.keys(d.control).filter(function (k) { return !d.control[k].matches; }).map(function (k) { return '<li>Declared ' + esc(k) + ' ' + esc(d.control[k].declared) + ' but the file totals ' + esc(d.control[k].actual) + '</li>'; }).join('') + '</ul>';
      }
      bulkMessage(html, 'error');
      if (!dry) refresh();
    });
  }

  // ------------------------------------------------------------------ amend, cancel, history
  function amendDialog(x) {
    var w = overlay('<h2 style="margin:4px 0 4px;font-size:18px">Amend ' + esc(x.tradeRef) + '</h2><p style="color:#5d6877;margin:0 0 10px">' + esc(x.side + ' ' + x.ticker + ' · ' + x.accountRef) + '. Change only what is wrong and say why.</p>' +
      '<form id="mxAmend"><label>Quantity<input id="mxAQty" value="' + esc(x.quantity.replace(/\.?0+$/, '')) + '" style="' + inputCss + '"></label>' +
      '<label>Price<input id="mxAPrice" value="' + esc(x.price.replace(/\.?0+$/, '')) + '" style="' + inputCss + '"></label>' +
      '<label>Settlement date<input id="mxASettle" type="date" value="' + esc(x.settlementDate || '') + '" style="' + inputCss + '"></label>' +
      '<label>Broker<input id="mxABroker" value="' + esc(x.broker || '') + '" style="' + inputCss + '"></label>' +
      '<label>Reason for the amendment<input id="mxAReason" required minlength="3" maxlength="500" style="' + inputCss + '"></label>' +
      '<p id="mxErr" style="color:#a9253e;min-height:18px;margin:0 0 8px;font-size:12px"></p>' +
      '<div style="text-align:right"><button type="button" id="mxACancel" style="' + btnCss.replace('background:#0f2a4a;color:#fff', 'background:#fff;color:#0f2a4a') + ';margin-right:8px">Close</button><button type="submit" style="' + btnCss + '">Save amendment</button></div></form>');
    $('#mxACancel', w).onclick = closeOverlay;
    $('#mxAmend', w).onsubmit = function (ev) {
      ev.preventDefault();
      var body = { reason: $('#mxAReason', w).value.trim() };
      var q = $('#mxAQty', w).value.trim();
      var p = $('#mxAPrice', w).value.trim();
      var s = $('#mxASettle', w).value;
      var b = $('#mxABroker', w).value.trim();
      if (q && Number(q) !== Number(x.quantity)) body.quantity = q;
      if (p && Number(p) !== Number(x.price)) body.price = p;
      if (s !== (x.settlementDate || '')) body.settlementDate = s;
      if (b !== (x.broker || '')) body.broker = b;
      if (Object.keys(body).length === 1) { $('#mxErr', w).textContent = 'Nothing changed.'; return; }
      request('PATCH', '/api/v1/custodian/executions/' + encodeURIComponent(x.id), body, { 'Idempotency-Key': key() }).then(function () {
        closeOverlay();
        toast('Execution amended', x.tradeRef + ' is back in the matching queue.');
        return refresh();
      }, function (err) { $('#mxErr', w).textContent = err.message; });
    };
  }
  function cancelDialog(x) {
    var w = overlay('<h2 style="margin:4px 0 4px;font-size:18px">Cancel ' + esc(x.tradeRef) + '</h2><p style="color:#5d6877;margin:0 0 10px">The execution is withdrawn from reconciliation. This cannot be undone; submit a new trade reference if it was cancelled in error.</p>' +
      '<form id="mxCancel"><label>Reason<input id="mxCReason" required minlength="3" maxlength="500" style="' + inputCss + '"></label>' +
      '<p id="mxErr" style="color:#a9253e;min-height:18px;margin:0 0 8px;font-size:12px"></p>' +
      '<div style="text-align:right"><button type="button" id="mxCClose" style="' + btnCss.replace('background:#0f2a4a;color:#fff', 'background:#fff;color:#0f2a4a') + ';margin-right:8px">Keep it</button><button type="submit" style="' + btnCss.replace('#0f2a4a', '#a9253e').replace('#0f2a4a', '#a9253e') + '">Cancel execution</button></div></form>');
    $('#mxCClose', w).onclick = closeOverlay;
    $('#mxCancel', w).onsubmit = function (ev) {
      ev.preventDefault();
      request('POST', '/api/v1/custodian/executions/' + encodeURIComponent(x.id) + '/cancel', { reason: $('#mxCReason', w).value.trim() }, { 'Idempotency-Key': key() }).then(function () {
        closeOverlay();
        toast('Execution cancelled', x.tradeRef + ' was withdrawn.');
        return refresh();
      }, function (err) { $('#mxErr', w).textContent = err.message; });
    };
  }
  function historyDialog(kind, id, title) {
    var path = kind === 'day' ? '/api/v1/custodian/day-end/' + encodeURIComponent(id) + '/history' : '/api/v1/custodian/executions/' + encodeURIComponent(id) + '/history';
    var w = overlay('<h2 style="margin:4px 0 10px;font-size:18px">' + esc(title) + ' history</h2><div id="mxHist">Loading…</div><div style="text-align:right;margin-top:10px"><button type="button" id="mxHClose" style="' + btnCss + '">Close</button></div>');
    $('#mxHClose', w).onclick = closeOverlay;
    request('GET', path).then(function (r) {
      $('#mxHist', w).innerHTML = '<ol style="margin:0;padding:0 0 0 18px;max-height:50vh;overflow:auto">' + r.events.map(function (e) {
        var what = kind === 'day' ? esc(e.action) + (e.status ? ' → ' + esc(e.status) : '') : esc(e.action) + ' · ' + esc((e.fromStatus || '—') + ' → ' + e.toStatus);
        var ch = e.changes ? '<div style="color:#5d6877">' + Object.keys(e.changes).map(function (k) { return esc(k) + ': ' + esc(e.changes[k].from) + ' → ' + esc(e.changes[k].to); }).join('; ') + '</div>' : '';
        return '<li style="margin-bottom:8px"><strong>' + what + '</strong> <span style="color:#5d6877">' + esc(fmtDate(e.at)) + ' · ' + esc(e.by) + '</span>' + (e.reason ? '<div>' + esc(e.reason) + '</div>' : '') + ch + '</li>';
      }).join('') + '</ol>';
    }, function (err) { $('#mxHist', w).textContent = err.message; });
  }
  function pill(status) {
    return '<span class="pill" style="background:' + (PILL[status] || '#6f7b8c') + ';color:#fff">' + esc(status === 'Received' ? 'Submitted' : status) + '</span>';
  }
  function canApprove() { return me.permissions.indexOf('custodian.dayend.approve') >= 0; }
  function renderStatus(data) {
    $('#executionCount').textContent = data.counts.executions;
    $('#dayCount').textContent = data.counts.dayEnds;
    executionsById = {};
    var items = data.executions.map(function (x) {
      executionsById[x.id] = x;
      var xa = '<button type="button" class="btn" data-mx-hist="' + esc(x.id) + '">History</button>';
      if (x.amendable && canSubmit()) xa = '<button type="button" class="btn" data-mx-amend="' + esc(x.id) + '">Amend</button> <button type="button" class="btn" data-mx-cancel="' + esc(x.id) + '">Cancel</button> ' + xa;
      return { at: x.submittedAt, html: '<div class="item"><div class="item-top"><strong>Execution · ' + esc(x.tradeRef) + '</strong>' + pill(x.status) + '</div>' +
        '<small>' + esc(x.side + ' ' + num(x.quantity) + ' ' + x.ticker + ' @ ' + num(x.price) + ' ' + x.currency) + ' · ' + esc(x.accountRef) + '</small>' +
        '<small>' + esc(x.ref) + ' · ' + esc(fmtDate(x.submittedAt)) + (x.amendCount ? ' · amended ' + esc(x.amendCount) + 'x' : '') + '</small><div style="margin-top:6px">' + xa + '</div></div>' };
    }).concat(data.dayEnds.map(function (d) {
      var actions = '';
      if (d.status === 'Draft' && d.submittedById === me.user.id) actions = '<button type="button" class="btn" data-mx-submit="' + esc(d.id) + '">Submit</button>';
      else if (d.status === 'Received' && canApprove() && d.submittedById !== me.user.id) actions = '<button type="button" class="btn primary" data-mx-approve="' + esc(d.id) + '">Approve</button>';
      else if (d.status === 'Received') actions = '<small>Awaiting approval by a second user</small>';
      actions += (actions ? ' ' : '') + '<button type="button" class="btn" data-mx-dhist="' + esc(d.id) + '" data-mx-ref="' + esc(d.ref) + '">History</button>';
      var review = d.review ? '<small>Matanho ' + esc(d.review.decision === 'ACCEPT' ? 'accepted' : 'rejected') + (d.review.note ? ': ' + esc(d.review.note) : '') + '</small>' : '';
      return { at: d.submittedAt, html: '<div class="item"><div class="item-top"><strong>Day-end · ' + esc(d.ref) + ' · ' + esc(d.accountRef) + '</strong>' + pill(d.status) + '</div>' +
        '<small>' + esc(d.statementDate) + ' · Cash ' + esc(d.currency) + ' ' + num(d.closingCash) + ' · Holdings ' + num(d.holdingsMv) + ' · ' + esc(d.tradeCount) + ' trades</small>' +
        (d.sha256 ? '<small title="' + esc(d.sha256) + '">Package SHA-256 ' + esc(d.sha256.slice(0, 16)) + '…</small>' : '') +
        (d.file ? '<small title="' + esc(d.file.sha256) + '">' + esc(d.file.name) + ' · file SHA-256 ' + esc(d.file.sha256.slice(0, 12)) + '…</small>' : '') +
        review + '<small>' + esc(fmtDate(d.submittedAt)) + '</small>' + (actions ? '<div style="margin-top:6px">' + actions + '</div>' : '') + '</div>' };
    }));
    items.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
    $('#activity').innerHTML = items.length ? items.slice(0, 12).map(function (i) { return i.html; }).join('') : '<div class="item"><strong>No submissions yet</strong><small>Enter the first execution or day-end package.</small></div>';
  }
  function refresh() {
    return request('GET', '/api/v1/custodian/submissions').then(renderStatus, function (err) {
      $('#activity').innerHTML = '<div class="item"><strong>Status unavailable</strong><small>' + esc(err.message) + '</small></div>';
    });
  }
  function setDefaults() {
    var d = new Date();
    var local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
    $('#execTime').value = local.slice(0, 16);
    $('#settlement').value = new Date(d.getTime() + 2 * 86400000).toISOString().slice(0, 10);
    $('#statementDate').value = local.slice(0, 10);
  }

  // ------------------------------------------------------------------ submissions
  var tradeKey = null;
  var tradeSig = '';
  function submitTrade(form) {
    var v = function (id) { return document.getElementById(id).value.trim(); };
    if (!v('execTime')) return Promise.reject(new Error('Enter the execution time.'));
    var x = {
      tradeRef: v('ref'),
      executionAt: new Date(v('execTime')).toISOString(),
      accountRef: v('account'),
      ticker: v('ticker').toUpperCase(),
      side: v('side'),
      quantity: v('qty'),
      price: v('price'),
      currency: v('currency'),
      settlementDate: v('settlement') || undefined,
      broker: v('broker') || undefined,
      note: v('tradeNote') || undefined,
    };
    var sig = JSON.stringify(x);
    // Same payload retried after a failure reuses its Idempotency-Key, so it is never stored twice.
    if (sig !== tradeSig) { tradeSig = sig; tradeKey = key(); }
    return request('POST', '/api/v1/custodian/executions', { executions: [x] }, { 'Idempotency-Key': tradeKey }).then(function (r) {
      tradeSig = '';
      var c = r.created[0];
      toast('Execution received', c.tradeRef + ' recorded as ' + c.ref + ' for Matanho Reconciliations.');
      form.reset();
      setDefaults();
      decorateDefaults();
      return refresh();
    }, function (err) {
      if (err.code === 'duplicate_trade_ref') tradeSig = '';
      throw err;
    });
  }
  function decorateDefaults() {
    ['account', 'dayAccount'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && me.counterparty.accounts.length && me.counterparty.accounts.indexOf(el.value) < 0) el.value = me.counterparty.accounts[0];
    });
  }
  var dayKey = null;
  var daySig = '';
  function submitDay(form) {
    var v = function (id) { return document.getElementById(id).value.trim(); };
    var file = document.getElementById('dayFile').files[0];
    if (!file) return Promise.reject(new Error('Attach the official day-end file.'));
    var fields = { statementDate: v('statementDate'), accountRef: v('dayAccount'), currency: v('dayCurrency'), closingCash: v('cash'), holdingsMv: v('holdings'), tradeCount: v('trades'), note: v('dayNote') };
    var qtyEl = document.getElementById('mxDayQty');
    var notEl = document.getElementById('mxDayNotional');
    if (qtyEl && qtyEl.value.trim()) fields.tradeQuantity = qtyEl.value.trim();
    if (notEl && notEl.value.trim()) fields.tradeNotional = notEl.value.trim();
    var sig = JSON.stringify(fields) + '|' + file.name + '|' + file.size + '|' + file.lastModified;
    if (sig !== daySig) { daySig = sig; dayKey = key(); }
    var fd = new FormData();
    Object.keys(fields).forEach(function (k) { fd.append(k, fields[k]); });
    fd.append('file', file, file.name);
    return request('POST', '/api/v1/custodian/day-end', fd, { 'Idempotency-Key': dayKey })
      .then(function (r) {
        return request('POST', '/api/v1/custodian/day-end/' + encodeURIComponent(r.package.id) + '/submit', {}, { 'Idempotency-Key': dayKey + '-submit' });
      })
      .then(function (r) {
        daySig = '';
        var p = r.package;
        var ctl = r.controls && !r.controls.matches ? ' Trade count ' + r.controls.tradeCount + ' differs from ' + r.controls.executionsReceived + ' executions received.' : '';
        toast('Day-end package submitted', p.ref + ' · SHA-256 ' + p.sha256.slice(0, 16) + '… · awaiting approval by a second user.' + ctl, ctl ? 'warn' : '');
        form.reset();
        document.getElementById('dayFileLabel').textContent = 'Select holdings / cash / settlement file';
        setDefaults();
        decorateDefaults();
        return refresh();
      }, function (err) {
        refresh();
        throw err;
      });
  }
  function onSubmit(event) {
    var form = event.target;
    if (!form || (form.id !== 'tradeForm' && form.id !== 'dayForm')) return;
    if (mode === 'demo') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (mode !== 'live' || !me) {
      toast('Not submitted', mode === 'error' ? 'Matanho cannot be reached; nothing was submitted.' : 'Sign in before submitting.', 'error');
      return;
    }
    var btn = form.querySelector('button[type=submit]');
    if (btn) btn.disabled = true;
    (form.id === 'tradeForm' ? submitTrade(form) : submitDay(form))
      .catch(function (err) {
        var title = err.code === 'duplicate_trade_ref' ? 'Trade reference already submitted' : err.code === 'account_out_of_scope' ? 'Account not available' : 'Not submitted';
        toast(title, err.message, 'error');
      })
      .finally(function () { if (btn) btn.disabled = false; });
  }
  function onClick(event) {
    var t = event.target;
    if (!t || !t.closest || mode !== 'live') return;
    var amend = t.closest('[data-mx-amend]');
    var cancel = t.closest('[data-mx-cancel]');
    var hist = t.closest('[data-mx-hist]');
    var dhist = t.closest('[data-mx-dhist]');
    if (amend || cancel || hist || dhist) {
      var xid = (amend || cancel || hist || dhist).getAttribute(amend ? 'data-mx-amend' : cancel ? 'data-mx-cancel' : hist ? 'data-mx-hist' : 'data-mx-dhist');
      var ex = executionsById[xid];
      if (amend && ex) amendDialog(ex);
      else if (cancel && ex) cancelDialog(ex);
      else if (hist && ex) historyDialog('exec', xid, ex.tradeRef);
      else if (dhist) historyDialog('day', xid, 'Day-end ' + (dhist.getAttribute('data-mx-ref') || ''));
      return;
    }
    var approve = t.closest('[data-mx-approve]');
    var submit = t.closest('[data-mx-submit]');
    if (!approve && !submit) return;
    var el = approve || submit;
    el.disabled = true;
    var id = el.getAttribute(approve ? 'data-mx-approve' : 'data-mx-submit');
    request('POST', '/api/v1/custodian/day-end/' + encodeURIComponent(id) + (approve ? '/approve' : '/submit'), {})
      .then(function (r) {
        toast(approve ? 'Package approved' : 'Package submitted', r.package.ref + (approve ? ' is now with Matanho Reconciliations.' : ' awaits approval by a second user.'));
        return refresh();
      })
      .catch(function (err) {
        toast(err.code === 'segregation_of_duties' ? 'Second approver required' : 'Not saved', err.message, 'error');
        el.disabled = false;
      });
  }
  document.addEventListener('submit', onSubmit, true);
  document.addEventListener('click', onClick, true);
  window.addEventListener('storage', function (e) {
    if (mode === 'live' && me && e.key === 'matanho-v61-custodian-submissions') refresh();
  });

  // ------------------------------------------------------------------ boot
  fetch(API + '/api/v1/platform/flags', { credentials: 'omit', cache: 'no-store' })
    .then(function (res) {
      if (!res.ok) throw new Error('flags ' + res.status);
      return res.json();
    })
    .then(function (flags) {
      mode = flags && flags.custodian && flags.custodian.live ? 'live' : 'demo';
      document.documentElement.dataset.mxMode = mode;
      return legacyReady.then(function () {
        if (mode !== 'live') {
          ribbon('demo', 'DEMO DATA · Submissions on this page stay in this browser and are not sent to Matanho.');
          return;
        }
        // Never show the prototype's browser-stored records as if they were live.
        $('#executionCount').textContent = '—';
        $('#dayCount').textContent = '—';
        $('#activity').innerHTML = '<div class="item"><strong>Loading submissions…</strong></div>';
        return loadMe().then(function (r) {
          me = r;
          decorate();
          return refresh();
        });
      });
    }, function () {
      mode = 'error';
      document.documentElement.dataset.mxMode = mode;
      return legacyReady.then(function () {
        ribbon('error', 'Matanho cannot be reached right now. Submissions are disabled.');
      });
    })
    .catch(function (err) {
      if (err && err.status !== 403) ribbon('error', 'The custodian service is unavailable: ' + (err && err.message ? err.message : 'unknown error') + '. Submissions are disabled.');
    });
})();
