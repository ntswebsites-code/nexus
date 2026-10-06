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

  function toggleAccountingDemoPanels(live) {
    document.querySelectorAll('#page-accounting .mx-demo-only').forEach(function (el) {
      el.style.display = live ? 'none' : '';
    });
  }

  function clearAccountingChrome() {
    document.querySelectorAll('#page-accounting .accounting-stat-line strong').forEach(function (el) {
      el.textContent = '—';
      el.className = '';
    });
    document.querySelectorAll('#page-accounting .accounting-stat-line small').forEach(function (el) {
      el.textContent = 'Loading…';
    });
    var tbody = document.querySelector('#page-accounting .institution-table tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6"><span class="ops-muted">Loading fund control state…</span></td></tr>';
    var host = document.querySelector('#page-accounting .journal-list');
    if (host) host.innerHTML = '<p style="padding:12px;color:#607088">Loading journals…</p>';
    var journalBadge = document.querySelector('#page-accounting .accounting-bottom .institution-panel .outline-status');
    if (journalBadge) {
      journalBadge.textContent = '—';
      journalBadge.className = 'outline-status';
    }
    var closePanels = document.querySelectorAll('#page-accounting .accounting-bottom .institution-panel');
    if (closePanels[1]) {
      var closeHead = closePanels[1].querySelector('h2');
      if (closeHead) closeHead.textContent = 'Period close checklist';
      var closeBadge = closePanels[1].querySelector('.outline-status');
      if (closeBadge) {
        closeBadge.textContent = '—';
        closeBadge.className = 'outline-status';
      }
      var checklist = closePanels[1].querySelector('.control-checklist');
      if (checklist) checklist.innerHTML = '<div class="ops-muted">Loading close controls…</div>';
    }
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

  function compactNav(v, ccy) {
    var n = Number(v || 0);
    if (isNaN(n)) return '—';
    var c = ccy || 'USD';
    if (Math.abs(n) >= 1e6) return c + ' ' + (n / 1e6).toFixed(3) + 'M';
    return money(n, c);
  }

  function sumTbBalance(rows, pred) {
    var total = 0;
    (rows || []).forEach(function (r) {
      if (!pred(r)) return;
      total += Number(r.balance || 0);
    });
    return total;
  }

  function updateStatLine(portfolioKpis, opsStatus, trialBalance) {
    var line = document.querySelector('#page-accounting .accounting-stat-line');
    if (!line) return;
    var cells = line.querySelectorAll('div');
    var pending = journals.filter(function (j) {
      return j.status === 'DRAFT' || j.status === 'PENDING_APPROVAL';
    });
    var pendingAmt = pending.reduce(function (sum, j) {
      return sum + Number(String(j.amount).replace(/[^0-9.-]/g, '') || 0);
    }, 0);
    if (cells[0] && portfolioKpis) {
      cells[0].querySelector('strong').textContent = String(portfolioKpis.portfolios || 0);
      var c0 = cells[0].querySelector('small');
      if (c0) c0.textContent = 'Active portfolios';
    }
    if (cells[1] && portfolioKpis) {
      cells[1].querySelector('strong').textContent = money(portfolioKpis.totalAum, portfolioKpis.currency);
      var c1 = cells[1].querySelector('small');
      if (c1) c1.textContent = 'Aggregate IBOR market value';
    }
    if (cells[2]) {
      cells[2].querySelector('strong').textContent = String(pending.length);
      var c2 = cells[2].querySelector('small');
      if (c2) c2.textContent = pendingAmt ? money(pendingAmt) + ' net' : 'No pending journals';
    }
    if (cells[3] && trialBalance && trialBalance.rows) {
      var unreal = sumTbBalance(trialBalance.rows, function (r) {
        return /unreal|investment/i.test(String(r.name)) && r.type !== 'LIABILITY';
      });
      cells[3].querySelector('strong').textContent = money(unreal);
      var c3 = cells[3].querySelector('small');
      if (c3) c3.textContent = trialBalance.asOf ? 'Trial balance · ' + trialBalance.asOf : 'Trial balance';
    }
    if (cells[4] && trialBalance && trialBalance.rows) {
      var income = sumTbBalance(trialBalance.rows, function (r) {
        return r.type === 'INCOME' || /^2/.test(String(r.code));
      });
      cells[4].querySelector('strong').textContent = money(Math.abs(income));
      var c4 = cells[4].querySelector('small');
      if (c4) c4.textContent = 'Income / accrual accounts';
    }
    if (cells[5]) {
      var openPeriod = periods.find(function (p) {
        return p.status === 'OPEN' || p.status === 'CLOSING';
      });
      var blockers = openPeriod && openPeriod.blockers ? openPeriod.blockers.length : 0;
      if (!blockers && opsStatus && opsStatus.kpis) blockers = opsStatus.kpis.closeBlockers || blockers;
      cells[5].querySelector('strong').textContent = String(blockers);
      cells[5].querySelector('small').textContent = blockers ? blockers + ' close blockers' : 'From live period checklist';
    }
  }

  function updateNavOversight(portfoliosBody, navHistory) {
    var tbody = document.querySelector('#page-accounting .institution-table tbody');
    if (!tbody || !liveAccounting()) return;
    var ports = (portfoliosBody && portfoliosBody.data) || portfoliosBody || [];
    var hist = (navHistory && navHistory.data) || navHistory || [];
    if (!ports.length) return;
    var latest = {};
    hist.forEach(function (h) {
      if (h.status !== 'RELEASED' && !h.official) return;
      var key = h.portfolioId;
      if (!key || latest[key]) return;
      latest[key] = h;
    });
    tbody.innerHTML = ports
      .slice(0, 8)
      .map(function (p) {
        var nav = latest[p.id];
        var ibor = Number(p.marketValueBase || 0);
        var abor = nav ? Number(nav.nav || 0) : null;
        var ext = nav && nav.external && nav.external.amount != null ? Number(nav.external.amount) : null;
        var variance = abor != null ? ibor - abor : null;
        var state = abor == null ? 'No NAV' : Math.abs(variance || 0) < 1 ? 'Agree' : nav.openExceptions ? 'Exception' : 'Review';
        var cls = state === 'Agree' ? 'green' : 'amber';
        return (
          '<tr><td><strong>' +
          mx.esc(p.name) +
          '</strong></td><td>' +
          compactNav(ibor, p.baseCurrency) +
          '</td><td>' +
          (abor != null ? compactNav(abor, p.baseCurrency) : '—') +
          '</td><td>' +
          (ext != null ? compactNav(ext, p.baseCurrency) : '—') +
          '</td><td>' +
          (variance != null ? compactNav(variance, p.baseCurrency) : '—') +
          '</td><td><span class="outline-status ' +
          cls +
          '">' +
          state +
          '</span></td></tr>'
        );
      })
      .join('');
  }

  function updateJournalList() {
    var host = document.querySelector('#page-accounting .journal-list');
    if (!host) return;
    var pending = journals.filter(function (j) {
      return j.status === 'DRAFT' || j.status === 'PENDING_APPROVAL';
    });
    var badge = document.querySelector('#page-accounting .accounting-bottom .institution-panel .outline-status');
    if (badge) {
      badge.textContent = pending.length ? pending.length + ' pending' : 'Clear';
      badge.className = 'outline-status ' + (pending.length ? 'amber' : 'green');
    }
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
    var closePanel = document.querySelectorAll('#page-accounting .accounting-bottom .institution-panel')[1];
    var panel = closePanel ? closePanel.querySelector('.control-checklist') : document.querySelector('#page-accounting .control-checklist');
    if (!panel || !detail) return;
    var items = detail.checklist || detail.items || [];
    if (!items.length && detail.blockers) {
      items = detail.blockers.map(function (b) {
        return { label: b, ok: false, detail: '' };
      });
    }
    if (closePanel) {
      var head = closePanel.querySelector('h2');
      if (head) {
        head.textContent = detail.periodEnd
          ? String(detail.periodEnd).slice(0, 10) + ' control checklist'
          : detail.ref
            ? detail.ref + ' checklist'
            : 'Period close checklist';
      }
      var status = closePanel.querySelector('.outline-status');
      if (status) {
        var blockers = detail.blockers || [];
        status.textContent = blockers.length ? 'Blocked' : detail.canClose ? 'Ready' : detail.status === 'CLOSED' ? 'Closed' : 'Open';
        status.className =
          'outline-status ' + (blockers.length ? 'red' : detail.canClose ? 'green' : detail.status === 'CLOSED' ? 'green' : 'amber');
      }
    }
    if (!items.length) {
      panel.innerHTML = '<div class="ops-muted">No close controls loaded for this period.</div>';
      return;
    }
    panel.innerHTML = items
      .map(function (item) {
        var done = item.ok || item.state === 'done' || item.passed;
        var warn = !done && (item.state === 'warning' || item.state === 'fail' || item.blockers && item.blockers.length);
        return (
          '<div class="' +
          (done ? 'done' : warn ? 'warning' : '') +
          '"><span>' +
          (done ? '✓' : '!') +
          '</span><p><strong>' +
          (item.label || item.title || 'Control') +
          '</strong><small>' +
          (item.detail || item.message || (item.blockers && item.blockers[0]) || '') +
          '</small></p></div>'
        );
      })
      .join('');
  }

  function openChartOfAccountsModal() {
    return getEnvelope('/api/v1/portfolios?status=Active&limit=30').then(function (body) {
      var ports = body.data || body || [];
      if (!ports.length) {
        mx.toast('No portfolio', 'Create a portfolio before managing the chart of accounts.', 'warn');
        return;
      }
      function renderForPortfolio(portfolioId) {
        return getEnvelope('/api/v1/accounting/accounts?portfolioId=' + encodeURIComponent(portfolioId) + '&active=true').then(function (acctBody) {
          var accounts = acctBody.data || acctBody || [];
          var port = ports.find(function (p) {
            return p.id === portfolioId;
          });
          var rows =
            accounts.length
              ? '<div class="v35-list">' +
                accounts
                  .slice(0, 50)
                  .map(function (a) {
                    return (
                      '<div class="v35-row"><span><strong>' +
                      mx.esc(a.code) +
                      '</strong><small>' +
                      mx.esc(a.name) +
                      '</small></span><em>' +
                      mx.esc(a.type) +
                      '</em></div>'
                    );
                  })
                  .join('') +
                (accounts.length > 50 ? '<p class="ops-muted">+' + (accounts.length - 50) + ' more accounts</p>' : '') +
                '</div>'
              : '<p class="ops-muted">No accounts yet. Seed the default chart for this entity.</p>';
          mx.modal({
            eyebrow: 'ACCOUNTING',
            title: 'Chart of accounts',
            subtitle: (port && port.name) || 'Entity ledger',
            wide: true,
            body:
              '<label class="v34-field"><span>Entity</span><select class="v34-select" id="mxCoaPortfolio">' +
              ports
                .map(function (p) {
                  return (
                    '<option value="' +
                    mx.esc(p.id) +
                    '"' +
                    (p.id === portfolioId ? ' selected' : '') +
                    '>' +
                    mx.esc(p.name) +
                    '</option>'
                  );
                })
                .join('') +
              '</select></label><section class="detail-section" id="mxCoaList">' +
              rows +
              '</section>',
            actions: [
              mx.can('accounting.post')
                ? {
                    label: 'Seed default chart',
                    primary: !accounts.length,
                    run: function () {
                      return mx.post('/api/v1/accounting/accounts/default-chart', { portfolioId: portfolioId }).then(function (r) {
                        var created = r.created != null ? r.created : (r.data && r.data.length) || 0;
                        mx.toast('Chart seeded', created + ' account(s) added.');
                        return renderForPortfolio(portfolioId);
                      });
                    },
                  }
                : null,
              { label: 'Close', run: function () {} },
            ].filter(Boolean),
          });
          var sel = document.getElementById('mxCoaPortfolio');
          if (sel) {
            sel.onchange = function () {
              renderForPortfolio(sel.value).catch(mx.fail);
            };
          }
        });
      }
      return renderForPortfolio(ports[0].id);
    });
  }

  function loadAccounting() {
    if (!mx.can('valuation.view')) return Promise.resolve();
    var live = liveAccounting();
    return Promise.all([
      getEnvelope('/api/v1/accounting/journals?limit=50'),
      getEnvelope('/api/v1/accounting/periods?limit=20'),
      live ? getEnvelope('/api/v1/portfolios?status=Active&kpis=1&limit=12') : Promise.resolve(null),
      live ? getEnvelope('/api/v1/nav/history?limit=40') : Promise.resolve(null),
      live && mx.can('operations.view') ? getEnvelope('/api/v1/operations/status') : Promise.resolve(null),
    ]).then(function (parts) {
      var jRows = parts[0].data || parts[0] || [];
      var pRows = parts[1].data || parts[1] || [];
      var portfoliosBody = parts[2];
      var navHistory = parts[3];
      var opsStatus = parts[4] && (parts[4].data || parts[4]);
      journalByRef = {};
      journals = jRows.map(mapJournal);
      periods = pRows;
      mx.data.accountingJournals = journals;
      updateJournalList();
      var firstPort = portfoliosBody && (portfoliosBody.data || portfoliosBody)[0];
      var tbPromise =
        live && firstPort
          ? getEnvelope('/api/v1/accounting/trial-balance?portfolioId=' + encodeURIComponent(firstPort.id))
          : Promise.resolve(null);
      return tbPromise.then(function (tbBody) {
        var tb = tbBody && (tbBody.data || tbBody);
        updateStatLine(portfoliosBody && portfoliosBody.kpis, opsStatus, tb);
        if (portfoliosBody) updateNavOversight(portfoliosBody, navHistory);
        var open = pRows.find(function (p) {
          return p.status === 'OPEN' || p.status === 'CLOSING';
        });
        if (open && open.id) {
          return getEnvelope('/api/v1/accounting/periods/' + encodeURIComponent(open.id)).then(function (body) {
            var detail = body.data || body;
            updateChecklist(detail);
            mx.data.accountingPeriod = detail;
            if (detail.trialBalance) updateStatLine(portfoliosBody && portfoliosBody.kpis, opsStatus, detail.trialBalance);
          });
        }
      });
    });
  }

  function openPeriodId() {
    var open = periods.find(function (p) {
      return p.status === 'OPEN' || p.status === 'CLOSING';
    });
    return open && open.id;
  }

  function openNewJournalModal() {
    return Promise.all([
      getEnvelope('/api/v1/portfolios?status=Active&limit=30'),
      getEnvelope('/api/v1/portfolios?limit=1'),
    ]).then(function (parts) {
      var ports = parts[0].data || parts[0] || [];
      var first = ports[0] || (parts[1].data || parts[1] || [])[0];
      if (!first) {
        mx.toast('No portfolio', 'Create a portfolio before drafting journals.', 'warn');
        return;
      }
      return getEnvelope('/api/v1/accounting/accounts?portfolioId=' + encodeURIComponent(first.id) + '&active=true').then(function (body) {
        var accounts = body.data || body || [];
        if (accounts.length < 2) {
          mx.toast('Chart required', 'Seed the default chart of accounts for this entity first.', 'warn');
          return;
        }
        var acctOpts = accounts
          .map(function (a) {
            return '<option value="' + mx.esc(a.id) + '">' + mx.esc(a.code) + ' · ' + mx.esc(a.name) + '</option>';
          })
          .join('');
        var portOpts = ports
          .map(function (p) {
            return '<option value="' + mx.esc(p.id) + '"' + (p.id === first.id ? ' selected' : '') + '>' + mx.esc(p.name) + '</option>';
          })
          .join('');
        var today = new Date().toISOString().slice(0, 10);
        mx.modal({
          eyebrow: 'ACCOUNTING',
          title: 'New ABOR journal',
          subtitle: 'Balanced draft routed for independent posting',
          wide: true,
          body:
            '<form id="mxAcctJournal"><label class="v34-field"><span>Portfolio</span><select class="v34-select" name="portfolioId">' +
            portOpts +
            '</select></label><label class="v34-field"><span>Entry date</span><input class="v34-input" type="date" name="entryDate" value="' +
            today +
            '"></label><label class="v34-field v34-wide"><span>Description</span><input class="v34-input" name="description" required minlength="3" placeholder="Accrued custody fee"></label><label class="v34-field"><span>Debit account</span><select class="v34-select" name="debitId">' +
            acctOpts +
            '</select></label><label class="v34-field"><span>Credit account</span><select class="v34-select" name="creditId">' +
            acctOpts +
            '</select></label><label class="v34-field"><span>Amount</span><input class="v34-input" type="number" step="0.01" min="0.01" name="amount" required></label></form>',
          actions: [
            { label: 'Cancel', run: function () {} },
            {
              label: 'Create draft',
              primary: true,
              run: function (m) {
                var fd = new FormData(m.querySelector('#mxAcctJournal'));
                var amt = String(fd.get('amount') || '');
                return mx
                  .post('/api/v1/accounting/journals', {
                    portfolioId: fd.get('portfolioId'),
                    entryDate: fd.get('entryDate'),
                    description: fd.get('description'),
                    lines: [
                      { accountId: fd.get('debitId'), debit: amt, credit: '0' },
                      { accountId: fd.get('creditId'), debit: '0', credit: amt },
                    ],
                  })
                  .then(function (r) {
                    var j = r.data || r;
                    mx.toast('Journal drafted', (j.ref || j.id) + ' awaiting checker post.');
                    return loadAccounting();
                  });
              },
            },
          ],
        });
      });
    });
  }

  function openJournalWorkflow(ref) {
    var apiId = journalByRef[ref];
    var j = journals.find(function (x) {
      return x.ref === ref;
    });
    if (!apiId || !j) return;
    var actions = [];
    if (j.status === 'DRAFT') {
      actions.push({
        label: 'Submit for approval',
        run: function () {
          return mx.post('/api/v1/accounting/journals/' + encodeURIComponent(apiId) + '/submit', {}).then(function () {
            mx.toast('Journal submitted', ref);
            return loadAccounting();
          });
        },
      });
    }
    if (j.status === 'PENDING_APPROVAL' && mx.can('accounting.post')) {
      actions.push({
        label: 'Post journal',
        primary: true,
        run: function () {
          return mx.post('/api/v1/accounting/journals/' + encodeURIComponent(apiId) + '/post', {}, { stepUp: true }).then(function () {
            mx.toast('Journal posted', ref);
            return loadAccounting();
          });
        },
      });
      actions.push({
        label: 'Return to maker',
        run: function () {
          mx.reasonModal({
            eyebrow: 'ACCOUNTING · JOURNAL',
            title: 'Return to maker',
            subtitle: ref,
            label: 'Return reason',
            minLength: 5,
            confirmLabel: 'Return',
            onConfirm: function (reason) {
              return mx.post('/api/v1/accounting/journals/' + encodeURIComponent(apiId) + '/return', { reason: reason }).then(function () {
                mx.toast('Journal returned', ref);
                return loadAccounting();
              });
            },
          });
          return false;
        },
      });
    }
    mx.modal({
      eyebrow: 'ACCOUNTING · ' + ref,
      title: j.title,
      subtitle: j.portfolio + ' · ' + j.amount + ' · ' + j.status,
      body: '<p>Maker: ' + mx.esc(j.maker) + '</p>',
      actions: actions.length ? actions : [{ label: 'Close', run: function () {} }],
    });
  }

  mx.onLoad('valuation.view', function () {
    if (!document.getElementById('page-accounting')) return Promise.resolve();
    if (liveAccounting()) {
      clearAccountingChrome();
      toggleAccountingDemoPanels(true);
    }
    return loadAccounting();
  });

  mx.hydrate('accounting', function () {
    if (!liveAccounting()) return Promise.resolve();
    clearAccountingChrome();
    toggleAccountingDemoPanels(true);
    return loadAccounting();
  });

  window.addEventListener('matanho:legacy-ready', function () {
    if (liveAccounting()) toggleAccountingDemoPanels(true);
    mx.gate('[data-action="accounting-close"]', 'accounting.close');
    mx.gate('[data-action="accounting-new-journal"]', 'valuation.view');

    document.addEventListener(
      'click',
      function (e) {
        if (!liveAccounting()) return;
        var action = e.target.closest && e.target.closest('[data-action]');
        if (!action) return;
        var name = action.dataset.action;
        if (name === 'accounting-new-journal') {
          e.preventDefault();
          e.stopImmediatePropagation();
          openNewJournalModal().catch(mx.fail);
          return;
        }
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
        if (name === 'accounting-chart') {
          e.preventDefault();
          e.stopImmediatePropagation();
          openChartOfAccountsModal().catch(mx.fail);
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
          var j = journals.find(function (x) {
            return x.ref === ref;
          });
          if (j && (j.status === 'DRAFT' || j.status === 'PENDING_APPROVAL')) {
            openJournalWorkflow(ref);
            return;
          }
          var apiId = journalByRef[ref];
          if (!apiId) return;
          mx.post('/api/v1/accounting/journals/' + encodeURIComponent(apiId) + '/post', {}, { stepUp: true })
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
