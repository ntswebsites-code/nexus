/*
 * Accounting & Close: journals, periods, trial balance, close controls.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var journals = [];
  var periods = [];
  var journalByRef = {};

  function getEnvelope(path) {
    return fetch(mx.api + path, { credentials: 'include', headers: { Accept: 'application/json' } }).then(function (r) {
      return r.json();
    });
  }

  function liveAccounting() {
    return mx.live && mx.strict('accounting');
  }

  function money(v, ccy) {
    if (v == null || v === '') return '—';
    var n = Number(v);
    if (isNaN(n)) return '—';
    return (ccy || 'USD') + ' ' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function mapJournal(j) {
    var ref = j.ref || j.id;
    journalByRef[ref] = j.id;
    var amt = Number(j.totalDebit || j.totalCredit || 0);
    return {
      apiId: j.id,
      ref: ref,
      title: j.description || j.purpose || 'Journal',
      portfolio: j.portfolioName || j.portfolioRef || '—',
      amount: money(amt, j.currency),
      maker: j.makerName || '—',
      status: j.status,
    };
  }

  function updateStatLine() {
    var line = document.querySelector('#page-accounting .accounting-stat-line');
    if (!line) return;
    var cells = line.querySelectorAll('div');
    var pending = journals.filter(function (j) {
      return j.status === 'DRAFT' || j.status === 'PENDING_APPROVAL';
    });
    if (cells[2]) cells[2].querySelector('strong').textContent = String(pending.length);
    if (cells[5]) {
      var openPeriod = periods.find(function (p) {
        return p.status === 'OPEN' || p.status === 'CLOSING';
      });
      var blockers = openPeriod && openPeriod.blockers ? openPeriod.blockers.length : 0;
      cells[5].querySelector('strong').textContent = String(blockers || (openPeriod ? 0 : 2));
      cells[5].querySelector('small').textContent = blockers ? blockers + ' close blockers' : 'From live period checklist';
    }
  }

  function updateJournalList() {
    var host = document.querySelector('#page-accounting .journal-list');
    if (!host) return;
    var pending = journals.filter(function (j) {
      return j.status === 'DRAFT' || j.status === 'PENDING_APPROVAL';
    });
    if (!pending.length) {
      host.innerHTML = '<p style="padding:12px;color:#607088">No journals awaiting approval.</p>';
      return;
    }
    host.innerHTML = pending
      .slice(0, 6)
      .map(function (j) {
        return (
          '<button data-acct-journal="' +
          j.ref +
          '"><div><strong>' +
          j.ref +
          ' · ' +
          j.title +
          '</strong><small>' +
          j.portfolio +
          '</small></div><span><b>' +
          j.amount +
          '</b><small>Maker ' +
          j.maker +
          '</small></span></button>'
        );
      })
      .join('');
  }

  function updateChecklist(detail) {
    var panel = document.querySelector('#page-accounting .control-checklist');
    if (!panel || !detail) return;
    var items = detail.checklist || detail.items || [];
    if (!items.length && detail.blockers) {
      items = detail.blockers.map(function (b) {
        return { label: b, state: 'warning' };
      });
    }
    if (!items.length) return;
    panel.innerHTML = items
      .map(function (item) {
        var done = item.state === 'done' || item.passed;
        var warn = item.state === 'warning' || item.state === 'fail';
        return (
          '<div class="' +
          (done ? 'done' : warn ? 'warning' : '') +
          '"><span>' +
          (done ? '✓' : '!') +
          '</span><p><strong>' +
          (item.label || item.title || 'Control') +
          '</strong><small>' +
          (item.detail || item.message || '') +
          '</small></p></div>'
        );
      })
      .join('');
  }

  function loadAccounting() {
    if (!mx.can('valuation.view')) return Promise.resolve();
    return Promise.all([
      getEnvelope('/api/v1/accounting/journals?limit=50'),
      getEnvelope('/api/v1/accounting/periods?limit=20'),
    ]).then(function (parts) {
      var jRows = parts[0].data || parts[0] || [];
      var pRows = parts[1].data || parts[1] || [];
      journalByRef = {};
      journals = jRows.map(mapJournal);
      periods = pRows;
      mx.data.accountingJournals = journals;
      updateStatLine();
      updateJournalList();
      var open = pRows.find(function (p) {
        return p.status === 'OPEN' || p.status === 'CLOSING';
      });
      if (open && open.id) {
        return getEnvelope('/api/v1/accounting/periods/' + encodeURIComponent(open.id)).then(function (body) {
          var detail = body.data || body;
          updateChecklist(detail);
          mx.data.accountingPeriod = detail;
        });
      }
    });
  }

  function openPeriodId() {
    var open = periods.find(function (p) {
      return p.status === 'OPEN' || p.status === 'CLOSING';
    });
    return open && open.id;
  }

  mx.onLoad('valuation.view', function () {
    if (!document.getElementById('page-accounting')) return Promise.resolve();
    return loadAccounting();
  });

  mx.hydrate('accounting', function () {
    if (!liveAccounting()) return Promise.resolve();
    return loadAccounting();
  });

  window.addEventListener('matanho:legacy-ready', function () {
    mx.gate('[data-action="accounting-close"]', 'accounting.close');

    document.addEventListener(
      'click',
      function (e) {
        if (!liveAccounting()) return;
        var action = e.target.closest && e.target.closest('[data-action]');
        if (!action) return;
        var name = action.dataset.action;
        if (name === 'accounting-precheck' || name === 'accounting-close') {
          e.preventDefault();
          e.stopImmediatePropagation();
          var pid = openPeriodId();
          if (!pid) {
            mx.toast('No open period', 'Create or open an accounting period in ops-native.', 'warn');
            return;
          }
          getEnvelope('/api/v1/accounting/periods/' + encodeURIComponent(pid)).then(function (body) {
            var detail = body.data || body;
            updateChecklist(detail);
            var blockers = detail.blockers || [];
            if (name === 'accounting-precheck') {
              mx.modal({
                title: 'Period close pre-check',
                body: blockers.length
                  ? '<p><strong>' + blockers.length + ' blocker(s)</strong></p><ul>' +
                    blockers
                      .map(function (b) {
                        return '<li>' + b + '</li>';
                      })
                      .join('') +
                    '</ul>'
                  : '<p>All close controls passed. Period is ready to close.</p>',
              });
              return;
            }
            if (blockers.length) {
              mx.toast('Close blocked', blockers[0], 'error');
              return;
            }
            var start =
              detail.status === 'OPEN'
                ? mx.post('/api/v1/accounting/periods/' + encodeURIComponent(pid) + '/start-close', {})
                : Promise.resolve();
            start
              .then(function () {
                return mx.post('/api/v1/accounting/periods/' + encodeURIComponent(pid) + '/close', {});
              })
              .then(function () {
                mx.toast('Period closed', (detail.ref || pid) + ' locked with maker-checker controls.');
                return loadAccounting();
              })
              .catch(mx.fail);
          });
          return;
        }
        if (name === 'accounting-report') {
          e.preventDefault();
          e.stopImmediatePropagation();
          getEnvelope('/api/v1/portfolios?limit=1').then(function (p) {
            var port = (p.data || p || [])[0];
            if (!port) return mx.toast('No portfolio', 'Choose a portfolio for the accounting report.', 'warn');
            return mx
              .post('/api/v1/reports/runs', { key: 'NAV_PACK', params: { portfolioId: port.id }, format: 'HTML' })
              .then(function (run) {
                var id = (run.data || run).id;
                return getEnvelope('/api/v1/reports/runs/' + encodeURIComponent(id) + '/link').then(function (link) {
                  var url = (link.data || link).url;
                  if (url) window.open(url, '_blank');
                  mx.toast('Accounting report', 'NAV pack generated from live ABOR data.');
                });
              })
              .catch(mx.fail);
          });
          return;
        }
        if (name === 'journal-control') {
          e.preventDefault();
          e.stopImmediatePropagation();
          var pending = journals.filter(function (j) {
            return j.status === 'PENDING_APPROVAL';
          });
          var html =
            '<section class="detail-section"><h3>Pending approval</h3>' +
            (pending.length
              ? pending
                  .map(function (j) {
                    return '<p>' + j.ref + ' · ' + j.title + ' · ' + j.amount + '</p>';
                  })
                  .join('')
              : '<p>No journals awaiting checker approval.</p>') +
            '</section>';
          if (typeof openControlDrawer === 'function') {
            openControlDrawer('Accounting journal control', 'Maker-checker queue for investment accounting journals.', html);
          } else {
            mx.modal({ title: 'Accounting journal control', body: html });
          }
          return;
        }
        var journalBtn = e.target.closest && e.target.closest('[data-acct-journal]');
        if (journalBtn) {
          e.preventDefault();
          e.stopImmediatePropagation();
          var ref = journalBtn.dataset.acctJournal;
          var apiId = journalByRef[ref];
          if (!apiId) return;
          mx.post('/api/v1/accounting/journals/' + encodeURIComponent(apiId) + '/post', {})
            .then(function () {
              mx.toast('Journal posted', ref + ' posted to the ABOR.');
              return loadAccounting();
            })
            .catch(mx.fail);
        }
      },
      true,
    );
  });
})();
