/*
 * Cash & Ledgers: balances, journals, reservations, expectations, statement imports.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var context = null;
  var filters = { clientId: '', portfolioId: '', accountId: '', currency: '', asOf: '' };
  var journalByRef = {};

  function getEnvelope(path) {
    return fetch(mx.api + path, { credentials: 'include', headers: { Accept: 'application/json' } }).then(function (r) {
      return r.json();
    });
  }

  function liveCash() {
    return mx.live && mx.strict('cash');
  }

  function money(v, ccy) {
    if (v == null || v === '') return '—';
    var n = Number(v);
    if (isNaN(n)) return String(v);
    return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function signedMoney(v, ccy) {
    var n = Number(v);
    if (isNaN(n)) return '0.00';
    var s = money(Math.abs(n), ccy);
    return (n >= 0 ? '+' : '-') + s;
  }

  function statusTag(s) {
    return s === 'POSTED' ? 'POSTED' : s === 'PENDING_APPROVAL' ? 'PENDING_APPROVAL' : s === 'DRAFT' ? 'DRAFT' : s;
  }

  function mapJournal(j) {
    var debit = Number(j.totalDebit || 0);
    var credit = Number(j.totalCredit || 0);
    var signed = debit > credit ? '+' + money(debit - credit, j.currency) : '-' + money(credit - debit, j.currency);
    var row = {
      apiId: j.id,
      id: j.ref || j.id,
      source: j.sourceRef || j.description || '—',
      purpose: j.purpose || 'MANUAL',
      valueDate: mx.date(j.entryDate),
      posting: j.postedAt ? mx.time(j.postedAt) : 'Draft',
      cashLine: j.portfolioName || j.portfolioId || '—',
      debit: debit ? money(debit, j.currency) : '0.00',
      credit: credit ? money(credit, j.currency) : '0.00',
      signed: signed,
      currency: j.currency || 'USD',
      status: statusTag(j.status),
      recon: j.reservationId ? 'Linked' : 'Not matched',
      maker: j.makerName || '—',
      checker: j.postedByName || '—',
      offsets: [],
    };
    journalByRef[row.id] = j.id;
    return row;
  }

  function mapReservation(r) {
    return {
      apiId: r.id,
      id: r.ref || r.id,
      source: r.source || '—',
      purpose: r.purpose || '—',
      original: money(r.amount, r.currency),
      consumed: money(r.consumed, r.currency),
      remaining: money(r.remaining, r.currency),
      currency: r.currency || 'USD',
      required: mx.date(r.requiredDate),
      expiry: r.expiresOn ? mx.date(r.expiresOn) : '—',
      status: r.status || 'ACTIVE',
      owner: r.createdByName || '—',
    };
  }

  function mapExpectation(e) {
    return {
      apiId: e.id,
      id: e.ref || e.id,
      direction: e.direction === 'IN' ? 'INFLOW' : 'OUTFLOW',
      event: e.kind || '—',
      amount: money(e.amount, e.currency),
      currency: e.currency || 'USD',
      due: mx.date(e.expectedDate),
      account: e.ledgerRef || e.ledgerName || '—',
      source: e.source || '—',
      reservation: e.journalId ? 'Linked' : '—',
      status: e.status || 'EXPECTED',
    };
  }

  function mapImport(b) {
    var movement = Number(b.closingBalance || 0) - Number(b.openingBalance || 0);
    return {
      apiId: b.id,
      id: b.ref || b.id,
      provider: b.ledgerName || 'Statement',
      account: (b.ledgerRef || '—') + ' / ' + (b.currency || '—'),
      period: mx.date(b.statementTo || b.statementFrom),
      lines: b.lineCount != null ? String(b.lineCount) : '—',
      opening: money(b.openingBalance, b.currency),
      movement: signedMoney(movement, b.currency),
      closing: money(b.closingBalance, b.currency),
      checks: b.variance && Number(b.variance) !== 0 ? 'Variance ' + money(b.variance, b.currency) : 'Passed',
      status: b.status || 'RECEIVED',
      file: b.filename || '—',
      hash: 'api',
      maker: b.makerName || '—',
      checker: b.checkerName || '—',
    };
  }

  function queryString() {
    return mx.qs({
      clientId: filters.clientId || undefined,
      portfolioId: filters.portfolioId || undefined,
      accountId: filters.accountId || undefined,
      currency: filters.currency || undefined,
      asOf: filters.asOf || undefined,
    });
  }

  function sumLedgers(ledgers, key, ccy) {
    var n = 0;
    (ledgers || []).forEach(function (l) {
      if (ccy && l.currency && l.currency !== ccy) return;
      var v = Number(l[key]);
      if (!isNaN(v)) n += v;
    });
    return n;
  }

  function updateReservationButton(rows) {
    var btn = document.querySelector('#page-cash [data-action="view-reservations"]');
    if (!btn) return;
    var open = (rows || []).filter(function (r) {
      return r.status && r.status !== 'RELEASED' && r.status !== 'EXPIRED';
    }).length;
    btn.textContent = open + ' reservation' + (open === 1 ? '' : 's');
  }

  function updateExpectationButton(rows) {
    var btn = document.querySelector('#page-cash [data-action="view-expectations"]');
    if (!btn) return;
    var open = (rows || []).filter(function (r) {
      return r.status && r.status !== 'CANCELLED' && r.status !== 'SETTLED';
    }).length;
    btn.textContent = open + ' movement' + (open === 1 ? '' : 's');
  }

  function clearCashTiles() {
    document.querySelectorAll('#page-cash .cash-state-grid article strong').forEach(function (el) {
      el.textContent = '—';
    });
    document.querySelectorAll('#page-cash .cash-state-grid article small').forEach(function (el) {
      el.textContent = 'Loading…';
    });
    var formula = document.querySelectorAll('#page-cash .cash-formula .formula-row b, #page-cash .cash-formula .formula-total strong');
    formula.forEach(function (el) {
      el.textContent = '—';
    });
    var strip = document.querySelectorAll('#page-cash .ledger-control-strip strong');
    strip.forEach(function (el) {
      el.textContent = '—';
    });
  }

  function updateBalanceTiles(bal) {
    if (!bal || !bal.totals || !bal.totals.length) return;
    var t = bal.totals[0];
    var ccy = t.currency || 'USD';
    var prefix = ccy === 'USD' ? 'US$ ' : ccy + ' ';
    var ledgers = bal.ledgers || [];
    var blocked = sumLedgers(ledgers, 'minBuffer', ccy);
    var withdrawable = sumLedgers(ledgers, 'withdrawable', ccy);
    var grid = document.querySelector('#page-cash .cash-state-grid');
    if (!grid) return;
    var articles = grid.querySelectorAll('article');
    if (articles[0]) articles[0].querySelector('strong').textContent = prefix + money(t.posted, ccy);
    if (articles[1]) articles[1].querySelector('strong').textContent = prefix + money(t.reserved, ccy);
    if (articles[2]) articles[2].querySelector('strong').textContent = prefix + money(blocked, ccy);
    if (articles[3]) {
      var en = Number(t.expectedNet || 0);
      var sign = en >= 0 ? '+' : '-';
      articles[3].querySelector('strong').textContent = sign + prefix + money(Math.abs(en), ccy);
    }
    if (articles[4]) articles[4].querySelector('strong').textContent = prefix + money(t.available, ccy);
    if (articles[5]) articles[5].querySelector('strong').textContent = prefix + money(withdrawable || t.available, ccy);
    var formula = document.querySelector('#page-cash .cash-formula');
    if (formula) {
      var rows = formula.querySelectorAll('.formula-row b');
      if (rows[0]) rows[0].textContent = prefix + money(t.posted, ccy);
      if (rows[3]) rows[3].textContent = prefix + money(t.reserved, ccy);
      if (rows[5]) rows[5].textContent = prefix + money(t.available, ccy);
    }
    var strip = document.querySelector('#page-cash .ledger-control-strip');
    if (strip) {
      var cells = strip.querySelectorAll('strong');
      if (cells[0]) cells[0].textContent = prefix + money(t.posted, ccy);
      if (cells[3]) cells[3].textContent = prefix + money(t.posted, ccy);
      if (cells[4]) cells[4].textContent = 'Debits = Credits';
    }
    var fresh = document.querySelector('#page-cash .cash-freshness strong');
    if (fresh && liveCash()) fresh.textContent = 'Ledger current';
    var freshSmall = document.querySelector('#page-cash .cash-freshness small');
    if (freshSmall && liveCash()) freshSmall.textContent = 'Balances from posted journals';
  }

  function hydrateContext(ctx) {
    context = ctx;
    var clientSel = document.getElementById('cashClientContext');
    var portSel = document.getElementById('cashPortfolioContext');
    var acctSel = document.getElementById('cashAccountContext');
    var ccySel = document.getElementById('cashCurrencyContext');
    if (clientSel && ctx.clients && ctx.clients.length) {
      clientSel.innerHTML =
        '<option value="">All clients</option>' +
        ctx.clients
          .map(function (c) {
            return '<option value="' + mx.esc(c.id) + '">' + mx.esc(c.name) + '</option>';
          })
          .join('');
    }
    if (portSel && ctx.portfolios && ctx.portfolios.length) {
      portSel.innerHTML =
        '<option value="">All portfolios</option>' +
        ctx.portfolios
          .map(function (p) {
            return '<option value="' + mx.esc(p.id) + '">' + mx.esc(p.name) + '</option>';
          })
          .join('');
    }
    if (acctSel && ctx.cashAccounts && ctx.cashAccounts.length) {
      acctSel.innerHTML =
        '<option value="">All cash accounts</option>' +
        ctx.cashAccounts
          .map(function (a) {
            return '<option value="' + mx.esc(a.id) + '">' + mx.esc(a.ref) + ' · ' + mx.esc(a.masked) + '</option>';
          })
          .join('');
    }
    if (ccySel && ctx.currencies && ctx.currencies.length) {
      ccySel.innerHTML =
        '<option value="">All currencies</option>' +
        ctx.currencies
          .map(function (cc) {
            return '<option value="' + mx.esc(cc) + '">' + mx.esc(cc) + '</option>';
          })
          .join('');
    }
  }

  function readFiltersFromDom() {
    var c = document.getElementById('cashClientContext');
    var p = document.getElementById('cashPortfolioContext');
    var a = document.getElementById('cashAccountContext');
    var y = document.getElementById('cashCurrencyContext');
    filters.clientId = c && c.value ? c.value : '';
    filters.portfolioId = p && p.value ? p.value : '';
    filters.accountId = a && a.value ? a.value : '';
    filters.currency = y && y.value ? y.value : '';
    if (!filters.asOf) filters.asOf = new Date().toISOString().slice(0, 10);
  }

  function applyStore(rows) {
    window.__mxData = window.__mxData || {};
    window.__mxData.cashJournals = rows.journals;
    window.__mxData.cashReservations = rows.reservations;
    window.__mxData.cashExpectations = rows.expectations;
    window.__mxData.statementImports = rows.imports;
    if (typeof renderCashControl === 'function') renderCashControl();
  }

  function loadCash() {
    if (!mx.can('cash.view')) return Promise.resolve();
    readFiltersFromDom();
    return Promise.all([
      getEnvelope('/api/v1/cash/context'),
      getEnvelope('/api/v1/cash/balances' + queryString()),
      getEnvelope('/api/v1/cash/journals' + queryString({ limit: '50' })),
      getEnvelope('/api/v1/cash/reservations' + queryString({ limit: '50' })),
      getEnvelope('/api/v1/cash/expectations' + queryString({ limit: '50' })),
      getEnvelope('/api/v1/cash/statement-imports' + queryString({ limit: '50' })),
    ]).then(function (parts) {
      var ctxBody = parts[0];
      var balBody = parts[1];
      var jBody = parts[2];
      var rBody = parts[3];
      var eBody = parts[4];
      var iBody = parts[5];
      hydrateContext(ctxBody.data || ctxBody);
      var bal = balBody.data || balBody;
      updateBalanceTiles(bal);
      var reservationRows = rBody.data || rBody || [];
      var expectationRows = eBody.data || eBody || [];
      updateReservationButton(reservationRows);
      updateExpectationButton(expectationRows);
      journalByRef = {};
      applyStore({
        journals: (jBody.data || jBody || []).map(mapJournal),
        reservations: reservationRows.map(mapReservation),
        expectations: (eBody.data || eBody || []).map(mapExpectation),
        imports: (iBody.data || iBody || []).map(mapImport),
      });
    });
  }

  function journalApiId(ref) {
    var j = (window.__mxData.cashJournals || []).find(function (x) {
      return x.id === ref;
    });
    return (j && j.apiId) || journalByRef[ref];
  }

  function importApiId(ref) {
    var b = (window.__mxData.statementImports || []).find(function (x) {
      return x.id === ref;
    });
    return b && b.apiId;
  }

  function reservationApiId(ref) {
    var r = (window.__mxData.cashReservations || []).find(function (x) {
      return x.id === ref;
    });
    return r && r.apiId;
  }

  function expectationApiId(ref) {
    var e = (window.__mxData.cashExpectations || []).find(function (x) {
      return x.id === ref;
    });
    return e && e.apiId;
  }

  function reasonDrawer(title, minLen) {
    minLen = minLen || 5;
    return new Promise(function (resolve) {
      if (typeof openDrawer !== 'function') {
        resolve(null);
        return;
      }
      openDrawer({
        eyebrow: 'REASON REQUIRED',
        title: title || 'Reason for this change',
        subtitle: 'Recorded in the audit trail.',
        body:
          '<form id="mxReasonForm"><label class="detail-field"><span>Reason</span><textarea id="mxReasonText" required rows="3" style="width:100%"></textarea></label><div class="form-actions"><button type="button" class="btn secondary" id="mxReasonCancel">Cancel</button><button type="submit" class="btn primary">Continue</button></div></form>',
      });
      document.getElementById('mxReasonCancel').onclick = function () {
        closeDrawer();
        resolve(null);
      };
      document.getElementById('mxReasonForm').onsubmit = function (e) {
        e.preventDefault();
        var t = document.getElementById('mxReasonText').value.trim();
        if (t.length < minLen) {
          mx.toast('Reason required', 'Need at least ' + minLen + ' characters.', 'warn');
          return;
        }
        closeDrawer();
        resolve(t);
      };
    });
  }

  function resolveBankLedger() {
    readFiltersFromDom();
    var portfolioId = filters.portfolioId || (context && context.portfolios && context.portfolios[0] && context.portfolios[0].id);
    if (!portfolioId) return Promise.reject(new Error('Select a portfolio in the cash context bar.'));
    return getEnvelope('/api/v1/cash/ledgers' + mx.qs({ portfolioId: portfolioId, kind: 'BANK', status: 'ACTIVE' })).then(function (body) {
      var rows = body.data || body || [];
      if (!rows.length) throw new Error('No active bank ledger for this portfolio.');
      return rows[0];
    });
  }

  function patchJournalDrawer(id) {
    if (!liveCash()) return;
    var j = (window.__mxData.cashJournals || []).find(function (x) {
      return x.id === id;
    });
    var apiId = journalApiId(id);
    if (!j || !apiId) return;
    var actions = document.querySelector('.drawer .form-actions, #drawer .form-actions, .form-actions');
    if (!actions) return;
    var html = '';
    if (j.status === 'DRAFT' && mx.can('cash.journal.create')) {
      html += '<button type="button" class="btn primary" id="mxJournalSubmit">Submit for approval</button>';
    }
    if (j.status === 'PENDING_APPROVAL') {
      if (mx.can('cash.journal.approve')) {
        html += '<button type="button" class="btn secondary" id="mxJournalReturn">Return to maker</button>';
        html += '<button type="button" class="btn secondary" id="mxJournalReject">Reject</button>';
        html += '<button type="button" class="btn primary" onclick="approveJournal(\'' + id + '\')">Approve & post</button>';
      }
    } else if (j.status === 'POSTED') {
      html += '<button type="button" class="btn secondary" onclick="reverseJournal(\'' + id + '\')">Create reversal</button>';
    }
    if (!html) return;
    actions.innerHTML = html;
    var submit = document.getElementById('mxJournalSubmit');
    if (submit) {
      submit.onclick = function () {
        mx.post('/api/v1/cash/journals/' + encodeURIComponent(apiId) + '/submit', {})
          .then(function () {
            mx.toast('Journal submitted', id + ' routed for independent approval.');
            if (typeof closeDrawer === 'function') closeDrawer();
            return loadCash();
          })
          .catch(mx.fail);
      };
    }
    var ret = document.getElementById('mxJournalReturn');
    if (ret) {
      ret.onclick = function () {
        reasonDrawer('Reason for returning ' + id + ' to maker').then(function (reason) {
          if (!reason) return;
          mx.post('/api/v1/cash/journals/' + encodeURIComponent(apiId) + '/return', { reason: reason })
            .then(function () {
              mx.toast('Journal returned', id + ' sent back to the maker.');
              if (typeof closeDrawer === 'function') closeDrawer();
              return loadCash();
            })
            .catch(mx.fail);
        });
      };
    }
    var rej = document.getElementById('mxJournalReject');
    if (rej) {
      rej.onclick = function () {
        reasonDrawer('Reason for rejecting ' + id).then(function (reason) {
          if (!reason) return;
          mx.post('/api/v1/cash/journals/' + encodeURIComponent(apiId) + '/reject', { reason: reason })
            .then(function () {
              mx.toast('Journal rejected', id + ' rejected with audit reason.');
              if (typeof closeDrawer === 'function') closeDrawer();
              return loadCash();
            })
            .catch(mx.fail);
        });
      };
    }
  }

  function openNewReservationModal() {
    if (!mx.can('cash.reservation') && !mx.can('cash.journal.create')) {
      mx.toast('Permission denied', 'This role cannot reserve client cash.', 'error');
      return Promise.resolve();
    }
    return resolveBankLedger().then(function (ledger) {
      var today = new Date().toISOString().slice(0, 10);
      var expiry = new Date();
      expiry.setDate(expiry.getDate() + 2);
      return mx.modal({
        eyebrow: 'CASH CONTROL',
        title: 'New cash reservation',
        subtitle: 'Authorisation checks available cash before creating the hold',
        body:
          '<form id="mxRsvForm"><label class="detail-field"><span>Source event</span><input class="detail-input" name="source" value="MANUAL"></label><label class="detail-field"><span>Purpose</span><select class="detail-input" name="purpose"><option>BUY_SETTLEMENT</option><option>WITHDRAWAL</option><option>TRANSFER</option></select></label><label class="detail-field"><span>Amount</span><input class="detail-input" name="amount" type="number" min="0.01" step="0.01" required></label><label class="detail-field"><span>Required date</span><input class="detail-input" name="requiredDate" type="date" value="' +
          today +
          '"></label><label class="detail-field"><span>Expires</span><input class="detail-input" name="expiresOn" type="date" value="' +
          expiry.toISOString().slice(0, 10) +
          '"></label></form><p class="ops-muted">Ledger: ' +
          mx.esc(ledger.ref || ledger.id) +
          ' · ' +
          mx.esc(ledger.currency || '') +
          '</p>',
        actions: [
          { label: 'Cancel', run: function () {} },
          {
            label: 'Create reservation',
            primary: true,
            run: function (m) {
              var fd = new FormData(m.querySelector('#mxRsvForm'));
              var amount = Number(fd.get('amount'));
              if (!(amount > 0)) throw new Error('Amount must be positive.');
              return mx
                .post('/api/v1/cash/reservations', {
                  ledgerId: ledger.id,
                  source: fd.get('source') || 'MANUAL',
                  purpose: fd.get('purpose') || 'BUY_SETTLEMENT',
                  amount: String(amount),
                  requiredDate: fd.get('requiredDate') || today,
                  expiresOn: fd.get('expiresOn') || expiry.toISOString().slice(0, 10),
                })
                .then(function () {
                  mx.toast('Reservation active', 'Cash hold created against available balance.');
                  if (typeof switchCashTab === 'function') switchCashTab('reservations');
                  return loadCash();
                });
            },
          },
        ],
      });
    });
  }

  function openNewExpectationModal() {
    if (!mx.can('cash.journal.create')) {
      mx.toast('Permission denied', 'This role cannot create expected movements.', 'error');
      return;
    }
    return resolveBankLedger().then(function (ledger) {
      return mx.modal({
        eyebrow: 'CASH CONTROL',
        title: 'New expected cash movement',
        subtitle: 'Projection only — does not post to the ledger.',
        body:
          '<form id="mxExpectForm"><label class="detail-field"><span>Direction</span><select name="direction" class="v34-input"><option value="IN">Inflow</option><option value="OUT">Outflow</option></select></label><label class="detail-field"><span>Amount</span><input name="amount" class="v34-input" type="number" min="0.01" step="0.01" required></label><label class="detail-field"><span>Expected date</span><input name="expectedDate" class="v34-input" type="date" required value="' +
          new Date().toISOString().slice(0, 10) +
          '"></label><label class="detail-field"><span>Source / purpose</span><input name="source" class="v34-input" placeholder="Dividend, subscription, settlement..."></label></form><p class="ops-muted">Ledger: ' +
          mx.esc(ledger.ref || ledger.id) +
          ' · ' +
          mx.esc(ledger.currency || '') +
          '</p>',
        actions: [
          {
            label: 'Create expectation',
            primary: true,
            run: function (m) {
              var fd = new FormData(m.querySelector('#mxExpectForm'));
              var amount = Number(fd.get('amount'));
              if (!(amount > 0)) throw new Error('Amount must be positive.');
              return mx
                .post('/api/v1/cash/expectations', {
                  ledgerId: ledger.id,
                  direction: fd.get('direction') || 'IN',
                  kind: 'OTHER',
                  amount: String(amount),
                  expectedDate: fd.get('expectedDate'),
                  source: fd.get('source') || null,
                })
                .then(function () {
                  mx.toast('Expected movement created', 'Forecast saved; balances refresh on reload.');
                  if (typeof switchCashTab === 'function') switchCashTab('expectations');
                  return loadCash();
                });
            },
          },
        ],
      });
    });
  }

  mx.wrapGlobal('openJournalDrawer', function (original, args) {
    original.apply(this, args);
    setTimeout(function () {
      patchJournalDrawer(args[0]);
    }, 0);
  });

  mx.wrapGlobal('renderExpectations', function (original) {
    original.apply(this, arguments);
    if (!liveCash() || !mx.can('cash.journal.create')) return;
    document.querySelectorAll('#expectationRows tr').forEach(function (row, i) {
      var e = (window.__mxData.cashExpectations || [])[i];
      if (!e || !e.apiId) return;
      if (e.status === 'POSTED' || e.status === 'CANCELLED') return;
      if (row.querySelector('[data-mx-cancel-exp]')) return;
      var td = document.createElement('td');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'row-action';
      btn.setAttribute('data-mx-cancel-exp', e.id);
      btn.textContent = 'Cancel';
      td.appendChild(btn);
      row.appendChild(td);
      btn.onclick = function () {
        reasonDrawer('Reason for cancelling ' + e.id).then(function (reason) {
          if (!reason) return;
          mx.post('/api/v1/cash/expectations/' + encodeURIComponent(e.apiId) + '/cancel', { reason: reason })
            .then(function () {
              mx.toast('Expectation cancelled', e.id + ' removed from the forecast.');
              return loadCash();
            })
            .catch(mx.fail);
        });
      };
    });
  });

  mx.wrapGlobal('saveReservation', function (original) {
    if (!liveCash()) return original.apply(this, arguments);
    try {
      var amount = Number((document.getElementById('rsvAmount') && document.getElementById('rsvAmount').value) || 0);
      if (!amount || amount <= 0) throw new Error('Amount must be positive.');
      var purpose = (document.getElementById('rsvPurpose') && document.getElementById('rsvPurpose').value) || 'BUY_SETTLEMENT';
      var source = (document.getElementById('rsvSource') && document.getElementById('rsvSource').value) || 'MANUAL';
      var today = new Date().toISOString().slice(0, 10);
      var expiry = new Date();
      expiry.setDate(expiry.getDate() + 2);
      return resolveBankLedger()
        .then(function (ledger) {
          return mx.post('/api/v1/cash/reservations', {
            ledgerId: ledger.id,
            source: source,
            purpose: purpose,
            amount: String(amount),
            requiredDate: today,
            expiresOn: expiry.toISOString().slice(0, 10),
          });
        })
        .then(function () {
          mx.toast('Reservation active', 'Cash hold created against available balance.');
          if (typeof closeDrawer === 'function') closeDrawer();
          if (typeof switchCashTab === 'function') switchCashTab('reservations');
          return loadCash();
        })
        .catch(mx.fail);
    } catch (e) {
      mx.toast('Reservation blocked', e.message, 'error');
    }
  });

  function openExplainDrawer() {
    readFiltersFromDom();
    return getEnvelope('/api/v1/cash/balances/explain' + queryString({ state: 'AVAILABLE' })).then(function (body) {
      var ex = body.data || body;
      if (typeof openControlDrawer !== 'function') return;
      openControlDrawer(
        'Cash balance explanation',
        (ex.ref || 'Cash') + ' · ' + (ex.currency || '') + ' · as of ' + (filters.asOf || 'today'),
        '<section class="detail-section"><h3>' +
          mx.esc(ex.formula || 'Available cash') +
          '</h3><div class="balance-proof"><div><span>Posted</span><b>' +
          mx.esc(ex.currency) +
          ' ' +
          mx.esc(ex.posted) +
          '</b></div><div><span>Reserved</span><b>' +
          mx.esc(ex.currency) +
          ' ' +
          mx.esc(ex.reserved) +
          '</b></div><div><span>Buffer</span><b>' +
          mx.esc(ex.currency) +
          ' ' +
          mx.esc(ex.minBuffer) +
          '</b></div><div class="subtotal"><span>Available</span><strong>' +
          mx.esc(ex.currency) +
          ' ' +
          mx.esc(ex.available) +
          '</strong></div></div><p class="ops-muted">' +
          mx.esc(ex.note || 'Derived from posted journals and active reservations.') +
          '</p></section>',
      );
    });
  }

  function uploadStatement(file) {
    var fd = new FormData();
    fd.append('file', file);
    return fetch(mx.api + '/api/v1/cash/statement-imports', { method: 'POST', credentials: 'include', body: fd }).then(function (r) {
      return r.json().then(function (body) {
        if (!r.ok) throw body;
        return body;
      });
    });
  }

  mx.onLoad('cash.view', function () {
    if (liveCash()) clearCashTiles();
    return loadCash();
  });

  mx.hydrate('cash', function () {
    if (!liveCash()) return Promise.resolve();
    clearCashTiles();
    return loadCash();
  });

  window.addEventListener('matanho:legacy-ready', function () {
    mx.gate('[data-action="new-cash-journal"]', 'cash.journal.create');
    mx.gate('[data-action="new-reservation"]', 'cash.reservation');
    mx.gate('[data-action="import-statement"]', 'cash.import');

    ['cashClientContext', 'cashPortfolioContext', 'cashAccountContext', 'cashCurrencyContext'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', function () {
        if (!liveCash()) return;
        loadCash().catch(mx.fail);
      });
    });

    mx.intercept(
      '[data-action="cash-explain"]',
      function () {
        openExplainDrawer().catch(mx.fail);
        return false;
      },
      { when: liveCash },
    );

    mx.intercept(
      '[data-action="import-statement"]',
      function () {
        if (!mx.can('cash.import')) {
          mx.toast('Permission denied', 'This role cannot stage external cash evidence.', 'error');
          return false;
        }
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv,.json,.xml,.txt,.sta,.940';
        input.onchange = function () {
          var f = input.files && input.files[0];
          if (!f) return;
          uploadStatement(f)
            .then(function () {
              mx.toast('Statement received', f.name + ' staged for validation.');
              if (typeof switchCashTab === 'function') switchCashTab('imports');
              return loadCash();
            })
            .catch(mx.fail);
        };
        input.click();
        return false;
      },
      { when: liveCash },
    );

    if (typeof window.approveJournal === 'function') {
      var protoApprove = window.approveJournal;
      window.approveJournal = function (id) {
        if (!liveCash()) return protoApprove(id);
        var apiId = journalApiId(id);
        if (!apiId) return protoApprove(id);
        mx.post('/api/v1/cash/journals/' + encodeURIComponent(apiId) + '/post', {}, { noStepUp: false })
          .then(function () {
            mx.toast('Journal posted', id + ' approved and posted.');
            if (typeof closeDrawer === 'function') closeDrawer();
            return loadCash();
          })
          .catch(mx.fail);
      };
    }

    if (typeof window.reverseJournal === 'function') {
      var protoReverse = window.reverseJournal;
      window.reverseJournal = function (id) {
        if (!liveCash()) return protoReverse(id);
        var apiId = journalApiId(id);
        if (!apiId) return protoReverse(id);
        mx.reasonModal('Reverse journal', 'State the reason for this reversal.').then(function (reason) {
          if (!reason) return;
          return mx.post('/api/v1/cash/journals/' + encodeURIComponent(apiId) + '/reverse', { reason: reason });
        }).then(function () {
          mx.toast('Reversal proposed', 'Reversal journal created and routed for checker.');
          if (typeof closeDrawer === 'function') closeDrawer();
          return loadCash();
        }).catch(function (e) {
          if (e && e.code === 'step_up_cancelled') return;
          mx.fail(e);
        });
      };
    }

    if (typeof window.releaseReservation === 'function') {
      var protoRelease = window.releaseReservation;
      window.releaseReservation = function (id) {
        if (!liveCash()) return protoRelease(id);
        var apiId = reservationApiId(id);
        if (!apiId) return protoRelease(id);
        mx.reasonModal('Release reservation', 'Why is this reservation remainder being released?').then(function (reason) {
          if (!reason) return;
          return mx.post('/api/v1/cash/reservations/' + encodeURIComponent(apiId) + '/release', { reason: reason });
        }).then(function () {
          mx.toast('Reservation released', id + ' remainder released.');
          if (typeof closeDrawer === 'function') closeDrawer();
          return loadCash();
        }).catch(function (e) {
          if (e && e.code === 'step_up_cancelled') return;
          mx.fail(e);
        });
      };
    }

    if (typeof window.statementBatchAction === 'function') {
      var protoStmt = window.statementBatchAction;
      window.statementBatchAction = function (id, action) {
        if (!liveCash()) return protoStmt(id, action);
        var apiId = importApiId(id);
        if (!apiId) return protoStmt(id, action);
        var path =
          action === 'commit'
            ? '/commit'
            : action === 'reject'
              ? '/reject'
              : null;
        if (!path) return protoStmt(id, action);
        var finish = function () {
          mx.toast('Import updated', id + ' · ' + action);
          if (typeof closeDrawer === 'function') closeDrawer();
          return loadCash();
        };
        if (path === '/reject') {
          mx.reasonModal('Reject import', 'Reason for rejecting this statement import.').then(function (reason) {
            if (!reason) return;
            return mx.post('/api/v1/cash/statement-imports/' + encodeURIComponent(apiId) + path, { reason: reason });
          }).then(function () { return finish(); }).catch(function (e) {
            if (e && e.code === 'step_up_cancelled') return;
            mx.fail(e);
          });
        } else {
          mx.post('/api/v1/cash/statement-imports/' + encodeURIComponent(apiId) + path, {})
            .then(function () { return finish(); })
            .catch(mx.fail);
        }
      };
    }

    if (typeof window.saveDraftJournal === 'function') {
      var protoSave = window.saveDraftJournal;
      window.saveDraftJournal = function () {
        if (!liveCash()) return protoSave();
        try {
          var debitEl = document.getElementById('newJournalDebit');
          var creditEl = document.getElementById('newJournalCredit');
          var amount = Number((creditEl && creditEl.value) || 0);
          if (!amount || amount <= 0) throw new Error('Amount must be positive.');
          var ccy = (document.getElementById('newJournalCurrency') && document.getElementById('newJournalCurrency').value) || 'USD';
          var portfolioId = filters.portfolioId || (context && context.portfolios && context.portfolios[0] && context.portfolios[0].id);
          if (!portfolioId) throw new Error('Select a portfolio in the cash context bar.');
          return mx
            .post('/api/v1/cash/journals', {
              portfolioId: portfolioId,
              entryDate: new Date().toISOString().slice(0, 10),
              description: (document.getElementById('newJournalReason') && document.getElementById('newJournalReason').value) || 'Controlled manual journal',
              purpose: (document.getElementById('newJournalPurpose') && document.getElementById('newJournalPurpose').value) || 'MANUAL_CORRECTION',
              sourceRef: (document.getElementById('newJournalSource') && document.getElementById('newJournalSource').value) || 'MANUAL',
              currency: ccy,
              lines: [
                { ledgerId: 'CLEARING', debit: String(amount), credit: '0', memo: 'Debit' },
                { ledgerId: 'BANK', debit: '0', credit: String(amount), memo: 'Credit' },
              ],
            })
            .then(function () {
              mx.toast('Journal draft created', 'Balanced journal saved and routed for approval.');
              if (typeof closeDrawer === 'function') closeDrawer();
              return loadCash();
            })
            .catch(mx.fail);
        } catch (e) {
          mx.toast('Journal validation failed', e.message, 'error');
        }
      };
    }

    mx.intercept(
      '[data-action="new-reservation"]',
      function () {
        openNewReservationModal().catch(mx.fail);
        return false;
      },
      { when: liveCash },
    );

    mx.intercept(
      '[data-action="new-expectation"]',
      function () {
        openNewExpectationModal().catch(mx.fail);
        return false;
      },
      { when: liveCash },
    );

    mx.intercept(
      '[data-action="period-close-precheck"]',
      function () {
        readFiltersFromDom();
        var portfolioId = filters.portfolioId || (context && context.portfolios && context.portfolios[0] && context.portfolios[0].id);
        if (!portfolioId) {
          mx.toast('Select portfolio', 'Choose a portfolio in the cash context bar.', 'warn');
          return false;
        }
        getEnvelope(
          '/api/v1/cash/period-closes/precheck' +
            mx.qs({ portfolioId: portfolioId, periodEnd: filters.asOf || new Date().toISOString().slice(0, 10) }),
        )
          .then(function (body) {
            var items = (body.data && body.data.items) || body.checklist || body.items || [];
            var blockers = items.filter(function (x) {
              return !x.ok;
            });
            mx.toast(
              blockers.length ? 'Close blocked' : 'Close ready',
              blockers.length ? blockers.length + ' blocker(s) remain.' : 'All pre-check controls passed.',
              blockers.length ? 'warn' : 'success',
            );
          })
          .catch(mx.fail);
        return false;
      },
      { when: liveCash },
    );
  });
})();
