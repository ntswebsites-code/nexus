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

  function updateBalanceTiles(bal) {
    if (!bal || !bal.totals || !bal.totals.length) return;
    var t = bal.totals[0];
    var ccy = t.currency || 'USD';
    var prefix = ccy === 'USD' ? 'US$ ' : ccy + ' ';
    var grid = document.querySelector('#page-cash .cash-state-grid');
    if (!grid) return;
    var articles = grid.querySelectorAll('article');
    if (articles[0]) articles[0].querySelector('strong').textContent = prefix + money(t.posted, ccy);
    if (articles[2]) articles[2].querySelector('strong').textContent = prefix + money(t.available, ccy);
    if (articles[3]) articles[3].querySelector('strong').textContent = prefix + money(t.withdrawable || t.available, ccy);
    var formula = document.querySelector('#page-cash .cash-formula');
    if (formula) {
      var rows = formula.querySelectorAll('.formula-row b');
      if (rows[0]) rows[0].textContent = prefix + money(t.posted, ccy);
      if (rows[3]) rows[3].textContent = prefix + money(t.reserved, ccy);
      if (rows[5]) rows[5].textContent = prefix + money(t.available, ccy);
    }
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
      updateBalanceTiles(balBody.data || balBody);
      journalByRef = {};
      applyStore({
        journals: (jBody.data || jBody || []).map(mapJournal),
        reservations: (rBody.data || rBody || []).map(mapReservation),
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
    return loadCash();
  });

  mx.hydrate('cash', function () {
    if (!liveCash()) return Promise.resolve();
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
        mx.post('/api/v1/cash/journals/' + encodeURIComponent(apiId) + '/approve', {})
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
        mx.post('/api/v1/cash/journals/' + encodeURIComponent(apiId) + '/reverse', { reason: 'Prototype reversal' })
          .then(function () {
            mx.toast('Reversal proposed', 'Reversal journal created and routed for checker.');
            if (typeof closeDrawer === 'function') closeDrawer();
            return loadCash();
          })
          .catch(mx.fail);
      };
    }

    if (typeof window.releaseReservation === 'function') {
      var protoRelease = window.releaseReservation;
      window.releaseReservation = function (id) {
        if (!liveCash()) return protoRelease(id);
        var apiId = reservationApiId(id);
        if (!apiId) return protoRelease(id);
        mx.post('/api/v1/cash/reservations/' + encodeURIComponent(apiId) + '/release', { reason: 'Released from prototype' })
          .then(function () {
            mx.toast('Reservation released', id + ' remainder released.');
            if (typeof closeDrawer === 'function') closeDrawer();
            return loadCash();
          })
          .catch(mx.fail);
      };
    }

    if (typeof window.statementBatchAction === 'function') {
      var protoStmt = window.statementBatchAction;
      window.statementBatchAction = function (id, action) {
        if (!liveCash()) return protoStmt(id, action);
        var apiId = importApiId(id);
        if (!apiId) return protoStmt(id, action);
        var path =
          action === 'validate'
            ? '/validate'
            : action === 'submit'
              ? '/submit'
              : action === 'commit'
                ? '/commit'
                : action === 'reject'
                  ? '/reject'
                  : null;
        if (!path) return protoStmt(id, action);
        var body = action === 'reject' ? { reason: 'Rejected from prototype' } : {};
        mx.post('/api/v1/cash/statement-imports/' + encodeURIComponent(apiId) + path, body)
          .then(function () {
            mx.toast('Import updated', id + ' · ' + action);
            if (typeof closeDrawer === 'function') closeDrawer();
            return loadCash();
          })
          .catch(mx.fail);
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
                { ledgerKind: 'CLEARING', debit: String(amount), credit: '0', memo: 'Debit' },
                { ledgerKind: 'BANK', debit: '0', credit: String(amount), memo: 'Credit' },
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
            var items = body.data || body.checklist || body.items || [];
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
