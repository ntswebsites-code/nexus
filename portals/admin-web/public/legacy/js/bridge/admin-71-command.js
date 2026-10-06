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

  function parseMoneyAmount(v) {
    var n = Number(String(v).replace(/[^0-9.-]/g, ''));
    return isNaN(n) ? 0 : n;
  }

  function assetWeight(rows, keys) {
    if (!rows || !rows.length) return 0;
    var row = rows.find(function (b) {
      return keys.some(function (k) {
        return String(b.key).toLowerCase().indexOf(k) >= 0;
      });
    });
    return row ? Number(row.weightPct) : 0;
  }

  function buildGioScope(panels, today) {
    var alloc = panels && panels.allocation && panels.allocation[0];
    var topPerf =
      panels &&
      panels.performance &&
      panels.performance.find(function (r) {
        return !r.error;
      });
    var ccy =
      (alloc && alloc.currency) ||
      (today && today.aum && today.aum.byCurrency && today.aum.byCurrency[0] && today.aum.byCurrency[0].currency) ||
      'USD';
    var totalVal = alloc ? parseMoneyAmount(alloc.total) : 0;
    var equity = assetWeight(alloc && alloc.byAssetClass, ['equity', 'listed']);
    var fixed = assetWeight(alloc && alloc.byAssetClass, ['fixed', 'bond', 'credit']);
    var cash = assetWeight(alloc && alloc.byAssetClass, ['cash', 'liquidity', 'money']);
    var privatePct = assetWeight(alloc && alloc.byAssetClass, ['private', 'altern', 'real']);

    function entry(pct, note, scale) {
      var aum =
        totalVal > 0
          ? money(totalVal * pct / 100, ccy)
          : today && today.aum && today.aum.byCurrency && today.aum.byCurrency.length
            ? today.aum.byCurrency
                .map(function (a) {
                  return money(a.amount, a.currency);
                })
                .join(' · ')
            : '—';
      var active = topPerf && topPerf.activePct != null ? fmtPct(topPerf.activePct) : '—';
      var activeNote =
        topPerf && topPerf.twrPct != null && topPerf.benchmarkPct != null
          ? topPerf.twrPct.toFixed(2) + '% vs ' + topPerf.benchmarkPct.toFixed(2) + '% benchmark'
          : 'Portfolio scope';
      return {
        aum: aum,
        aumNote: note,
        active: active,
        activeNote: activeNote,
        risk: today && today.risk ? String(today.risk.open + (today.risk.unrecorded || 0)) : '—',
        riskNote: today && today.risk ? today.risk.acknowledged + ' acknowledged' : 'Risk snapshot',
        liq:
          today && today.cash && today.cash.byCurrency && today.cash.byCurrency[0]
            ? money(today.cash.byCurrency[0].available, today.cash.byCurrency[0].currency)
            : '—',
        liqNote: today && today.cash ? today.cash.ledgers + ' ledger(s)' : 'Cash position',
        private: pct.toFixed(1) + '%',
        privateNote: 'Weight in scope',
        exceptions: today && today.approvals ? String(today.approvals.total) : '0',
        exceptionNote:
          today && today.approvals && today.approvals.items
            ? today.approvals.items.filter(function (i) {
                return i.count;
              }).length + ' queues'
            : '',
        scale: scale || 1,
      };
    }

    return {
      whole: entry(
        100,
        today && today.aum
          ? today.aum.portfolios + ' portfolios · ' + today.aum.positions + ' positions · cash ' + today.aum.cashPct + '%'
          : 'Book of record',
        1,
      ),
      listed: entry(equity, 'Listed equity · ' + equity.toFixed(1) + '% of book', 1 + equity / 200),
      fixed: entry(fixed, 'Fixed income · ' + fixed.toFixed(1) + '% of book', 0.72),
      private: entry(privatePct, 'Private markets · ' + privatePct.toFixed(1) + '% of book', 0.88),
      liquidity: entry(cash, 'Cash and liquidity · ' + cash.toFixed(1) + '% of book', 0.48),
    };
  }

  function buildMiniLiquidity(today, workload) {
    var base = 2;
    if (today && today.cash && today.cash.byCurrency && today.cash.byCurrency[0]) {
      var posted = parseMoneyAmount(today.cash.byCurrency[0].posted);
      var avail = parseMoneyAmount(today.cash.byCurrency[0].available);
      if (posted > 0) base = Math.max(0.5, Math.min(4, (avail / posted) * 4));
    }
    var labs = ['Now', 'T+1', 'T+2', 'T+3', 'T+4', 'T+5', 'T+10', 'T+20', 'T+30'];
    var vals;
    if (workload && workload.cashByDay && workload.cashByDay.length) {
      var days = workload.cashByDay.slice(0, 9);
      while (days.length < 9) days.push(days[days.length - 1] || { label: labs[days.length], in: '0', out: '0' });
      vals = days.map(function (d, i) {
        var net = parseMoneyAmount(d.in) - parseMoneyAmount(d.out);
        return Math.max(0.5, Math.min(4, base - i * 0.04 - Math.max(0, net) / 1e7));
      });
      labs = days.map(function (d, i) {
        return d.label || labs[i];
      });
    } else {
      vals = [base, base * 0.97, base * 0.94, base * 0.91, base * 0.88, base * 0.85, base * 0.87, base * 0.86, base * 0.84];
    }
    return { vals: vals, labs: labs, cover: base, floor: 1.25 };
  }

  function stashGioCharts(panels, today, workload) {
    if (!mx.live || !mx.strict('command')) return;
    window.__mxData = window.__mxData || {};
    var alloc = panels && panels.allocation && panels.allocation[0];
    if (alloc) {
      if (alloc.byAssetClass && alloc.byAssetClass.length) {
        window.__mxData._gioAttribution = alloc.byAssetClass.slice(0, 5).map(function (b) {
          return [b.key, (Number(b.weightPct) / 100) * 5];
        });
      }
      if (alloc.bySector && alloc.bySector.length) {
        var sectors = alloc.bySector.slice(0, 5);
        window.__mxData._gioRiskHeatCols = sectors.map(function (s) {
          return s.key;
        });
        var factors = ['Growth', 'Rates', 'FX', 'Credit', 'Liquidity'];
        window.__mxData._gioRiskHeatRows = factors.map(function (f, fi) {
          return [
            f,
            sectors.map(function (s, si) {
              return Math.min(99, Math.round(Number(s.weightPct) * (0.6 + (fi + si) * 0.08)));
            }),
          ];
        });
      }
    }
    if (panels && panels.scenario && panels.scenario.length) {
      var preset =
        panels.scenario.find(function (s) {
          return s.key === 'MARKET_SHOCK';
        }) || panels.scenario[0];
      var vals = (preset.results || [])
        .filter(function (r) {
          return !r.error && r.lossPct != null;
        })
        .slice(0, 12);
      if (vals.length) {
        var loss = vals.map(function (r) {
          return -Number(r.lossPct) * 0.5;
        });
        while (loss.length < 13) loss.push(loss[loss.length - 1] || 0);
        window.__mxData._gioScenarioBase = [0].concat(loss.slice(0, 12));
      }
    }
    if (today && today.cash && today.cash.byCurrency && today.cash.byCurrency[0]) {
      var c = today.cash.byCurrency[0];
      var posted = parseMoneyAmount(c.posted) / 1e6;
      var reserved = parseMoneyAmount(c.reserved) / 1e6;
      var avail = parseMoneyAmount(c.available) / 1e6;
      window.__mxData._gioLiquidity = [
        ['Posted', posted],
        ['Reserved', -reserved],
        ['Available', avail],
        ['Closing', avail],
      ];
    }
    window.__mxData._commandPerfLive = !!(panels && panels.performance && panels.performance.length);
    window.__mxData._gioScope = buildGioScope(panels, today);
    window.__mxData._gioMiniLiquidity = buildMiniLiquidity(today, workload);
    var liqFoot = document.querySelector('.gio-liquidity-footer-v29 em');
    if (liqFoot && window.__mxData._gioMiniLiquidity) {
      liqFoot.textContent = 'Current ' + window.__mxData._gioMiniLiquidity.cover.toFixed(2) + '×';
    }
    if (typeof window.__mxApplyGioScope === 'function') window.__mxApplyGioScope('whole');
    else if (typeof window.__mxRerenderCommandCharts === 'function') window.__mxRerenderCommandCharts();
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
      mx.can('operations.view') ? mx.get('/api/v1/operations/workload') : Promise.resolve(null),
    ]).then(function (res) {
      mx.data.today = res[0];
      mx.data.panels = res[1];
      mx.data.workload = res[2];
      renderToday(res[0]);
      renderPanels(res[1]);
      stashGioCharts(res[1], res[0], res[2]);
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
