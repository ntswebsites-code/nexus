/*
 * Command Centre (Today): KPIs, panels, investment pack.
 */
(function () {
  'use strict';
  var mx = window.mx;

  function money(v, ccy) {
    return mx.money(v, ccy);
  }

  function fmtPct(v) {
    if (v == null || isNaN(v)) return '—';
    return (v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%';
  }

  function setText(sel, text) {
    var el = document.querySelector(sel);
    if (el) el.textContent = text;
  }

  function renderToday(t) {
    if (!t) return;
    setText('#gioAsOf', 'As of ' + mx.date(t.asOf, { hour: '2-digit', minute: '2-digit' }));
    if (t.aum) {
      var aum =
        t.aum.byCurrency && t.aum.byCurrency.length
          ? t.aum.byCurrency.map(function (a) {
              return money(a.amount, a.currency);
            }).join(' · ')
          : '—';
      setText('#gioAum', aum);
      setText('#gioAumNote', t.aum.portfolios + ' portfolios · ' + t.aum.positions + ' positions · cash ' + t.aum.cashPct + '%');
    }
    if (t.ordersWorking) {
      setText('#gioActive', String(t.ordersWorking.total));
      setText('#gioActiveNote', (t.ordersWorking.awaitingApproval || 0) + ' awaiting approval');
    }
    if (t.risk) {
      setText('#gioRisk', String(t.risk.open + (t.risk.unrecorded || 0)));
      setText('#gioRiskNote', t.risk.acknowledged + ' acknowledged');
    }
    if (t.cash && t.cash.byCurrency && t.cash.byCurrency[0]) {
      setText('#gioLiquidity', money(t.cash.byCurrency[0].available, t.cash.byCurrency[0].currency));
      setText('#gioLiquidityNote', t.cash.ledgers + ' ledger(s)');
    }
    if (t.nav) {
      setText('#gioPrivate', t.nav.latestReleasedDate || '—');
      setText('#gioPrivateNote', t.nav.portfoliosReleasedThisWeek + '/' + t.nav.portfolios + ' released this week');
    }
    setText('#gioExceptions', String(t.approvals ? t.approvals.total : 0));
    setText('#gioExceptionsNote', t.approvals && t.approvals.items ? t.approvals.items.filter(function (i) {
      return i.count;
    }).length + ' queues' : '');
    if (t.runbookDueToday != null) mx.badge('operations', t.runbookDueToday);
    if (t.breaks) mx.badge('reconciliations', t.breaks.open);
    if (t.ordersWorking) mx.badge('orders', t.ordersWorking.total);
  }

  function renderPanels(p) {
    if (!p || !p.performance || !p.performance.length) return;
    var row = p.performance.find(function (r) {
      return !r.error && r.series && r.series.length;
    });
    if (!row) return;
    var last = row.series[row.series.length - 1];
    setText('#commandCompositeValue', (last.cumPct != null ? last.cumPct.toFixed(2) : '0') + '%');
    setText('#commandBenchmarkValue', last.benchCumPct != null ? last.benchCumPct.toFixed(2) + '%' : 'n/a');
    if (last.cumPct != null && last.benchCumPct != null) {
      var active = last.cumPct - last.benchCumPct;
      setText('#commandActiveValue', (active >= 0 ? '+' : '') + active.toFixed(2) + '%');
    }
    var svg = document.getElementById('commandPerformanceSvg');
    if (!svg || !row.series.length) return;
    var W = 920,
      H = 300,
      L = 52,
      R = 72,
      T = 19,
      B = 38;
    var pVals = row.series.map(function (s) {
      return s.cumPct;
    });
    var bVals = row.series.map(function (s) {
      return s.benchCumPct != null ? s.benchCumPct : s.cumPct * 0.85;
    });
    var min = Math.min.apply(null, pVals.concat(bVals).concat([0]));
    var max = Math.max.apply(null, pVals.concat(bVals).concat([1]));
    var x = function (i) {
      return L + ((W - L - R) * i) / Math.max(1, pVals.length - 1);
    };
    var y = function (v) {
      return T + (H - T - B) * (1 - (v - min) / (max - min || 1));
    };
    var path = function (vals) {
      return vals
        .map(function (v, i) {
          return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
        })
        .join(' ');
    };
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML =
      '<path fill="none" stroke="#2864ff" stroke-width="2" d="' +
      path(pVals) +
      '"/><path fill="none" stroke="#d58b1d" stroke-width="1.5" stroke-dasharray="4 3" d="' +
      path(bVals) +
      '"/>';
  }

  function loadCommand() {
    return Promise.all([
      mx.get('/api/v1/dashboard/today'),
      mx.can('dashboard.view') ? mx.get('/api/v1/dashboard/panels') : Promise.resolve(null),
    ]).then(function (res) {
      mx.data.today = res[0];
      mx.data.panels = res[1];
      renderToday(res[0]);
      renderPanels(res[1]);
    });
  }

  mx.onLoad('dashboard.view', function () {
    return loadCommand();
  });

  mx.hydrate('command', function () {
    if (!mx.strict('command')) return Promise.resolve();
    return loadCommand();
  });

  mx.intercept(
    '[data-action="generate-investment-pack"]',
    function () {
      if (!mx.can('reports.create')) {
        mx.toast('Access restricted', 'You need reports.create to generate the investment pack.', 'error');
        return false;
      }
      return mx.get('/api/v1/reports/lookups').then(function (lookups) {
        var portfolios = lookups.portfolios || [];
        var range = (function () {
          var to = new Date();
          var from = new Date();
          from.setMonth(from.getMonth() - 3);
          return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
        })();
        return new Promise(function (resolve) {
          mx.modal({
            eyebrow: 'INVESTMENT PACK',
            title: 'Generate investment pack',
            subtitle: 'Released NAV runs for the period as a PDF',
            body:
              '<form id="mxPackForm"><label>Portfolio<select class="v34-input" name="portfolioId" required>' +
              portfolios
                .map(function (p) {
                  return '<option value="' + mx.esc(p.id) + '">' + mx.esc(p.name) + '</option>';
                })
                .join('') +
              '</select></label><label>From<input class="v34-input" type="date" name="from" value="' +
              range.from +
              '" required></label><label>To<input class="v34-input" type="date" name="to" value="' +
              range.to +
              '" required></label></form>',
            actions: [
              { label: 'Cancel', run: function () {
                resolve(false);
              } },
              {
                label: 'Generate',
                primary: true,
                run: function (modal) {
                  var fd = new FormData(modal.querySelector('#mxPackForm'));
                  return mx
                    .post('/api/v1/reports/runs', {
                      key: 'NAV_PACK',
                      format: 'PDF',
                      params: { portfolioId: fd.get('portfolioId'), from: fd.get('from'), to: fd.get('to') },
                    })
                    .then(function (run) {
                      if (run.hasFile) return mx.download('/api/v1/reports/runs/' + encodeURIComponent(run.id) + '/link');
                      mx.toast('Investment pack', 'Run ' + (run.ref || run.id) + ' created under Reports.');
                      resolve(true);
                    });
                },
              },
            ],
          });
        });
      });
    },
    { when: function () {
      return mx.live && mx.strict('command');
    } },
  );
})();
