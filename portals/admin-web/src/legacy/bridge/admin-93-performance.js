/*
 * Performance & Attribution: returns, attribution export, official periods.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var selectedPortfolioId = null;
  var filters = { from: '', to: '' };

  function getEnvelope(path) {
    return fetch(mx.api + path, { credentials: 'include', headers: { Accept: 'application/json' } }).then(function (r) {
      return r.json();
    });
  }

  function livePerformance() {
    return mx.live && mx.strict('performance');
  }

  function fmtPct(v) {
    if (v == null || v === '') return '—';
    var n = Number(v);
    if (isNaN(n)) return '—';
    return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function fmtPctPlain(v) {
    if (v == null || v === '') return '—';
    var n = Number(v);
    if (isNaN(n)) return '—';
    return n.toFixed(2) + '%';
  }

  function fmtBps(v) {
    if (v == null) return '—';
    var n = Number(v);
    if (isNaN(n)) return '—';
    return (n >= 0 ? '+' : '') + Math.round(n) + ' bps';
  }

  function toneClass(v) {
    var n = Number(v);
    if (isNaN(n) || n === 0) return '';
    return n > 0 ? 'positive-text' : 'attention-text';
  }

  function updateControlBar(row) {
    var bar = document.querySelector('#page-performance .platform-control-bar');
    if (!bar || !row) return;
    var cells = bar.querySelectorAll('div');
    if (cells[0]) cells[0].querySelector('strong').textContent = row.portfolioName;
    if (cells[1])
      cells[1].querySelector('strong').textContent =
        row.periodStart && row.periodEnd ? row.periodStart + ' – ' + row.periodEnd : 'YTD';
    if (cells[3]) {
      var state = row.lastOfficial ? 'Official · ' + row.lastOfficial.ref : 'Provisional';
      cells[3].querySelector('strong').textContent = state;
      cells[3].querySelector('strong').className = row.lastOfficial ? 'positive-text' : '';
    }
  }

  function updateStatLine(row, returns) {
    var line = document.querySelector('#page-performance .performance-stat-line');
    if (!line) return;
    var cells = line.querySelectorAll('div');
    if (cells[0] && row) {
      cells[0].querySelector('strong').textContent = fmtPctPlain(row.twrPct);
      cells[0].querySelector('strong').className = toneClass(row.twrPct);
    }
    if (cells[1] && row) cells[1].querySelector('strong').textContent = fmtPctPlain(row.benchmarkPct);
    if (cells[2] && row) {
      cells[2].querySelector('strong').textContent = fmtPct(row.activePct);
      cells[2].querySelector('strong').className = toneClass(row.activePct);
    }
    if (cells[5] && returns) {
      var pending = returns.controlsPending != null ? returns.controlsPending : 0;
      cells[5].querySelector('strong').textContent = pending ? pending + ' pending' : 'Ready';
      cells[5].querySelector('small').textContent = pending ? 'Controls before lock' : 'All controls done';
    }
    var legend = document.querySelector('#page-performance .premium-legend');
    if (legend && row) {
      legend.innerHTML =
        '<span><i class="legend-line primary"></i>Portfolio <b>' +
        fmtPctPlain(row.twrPct) +
        '</b></span><span><i class="legend-line benchmark"></i>Benchmark <b>' +
        fmtPctPlain(row.benchmarkPct) +
        '</b></span><span class="chart-note">Active ' +
        fmtPct(row.activePct) +
        '</span>';
    }
  }

  function updateAttributionBridge(attr) {
    var bars = document.querySelector('#page-performance .attribution-bars');
    if (bars && attr && attr.totals) {
      var t = attr.totals;
      var items = bars.querySelectorAll('div');
      if (items[0]) items[0].querySelector('strong').textContent = fmtBps(t.selectionBps);
      if (items[1]) items[1].querySelector('strong').textContent = fmtBps(t.allocationBps);
      if (items[2]) items[2].querySelector('strong').textContent = fmtBps(t.interactionBps);
      if (items[3]) items[3].querySelector('strong').textContent = fmtBps(t.unexplainedBps);
    }
    var table = document.querySelector('#page-performance .performance-bottom tbody');
    if (table && attr && attr.segments) {
      table.innerHTML = attr.segments
        .slice(0, 8)
        .map(function (s) {
          return (
            '<tr><td><strong>' +
            mx.esc(s.sector) +
            '</strong></td><td>' +
            fmtPctPlain(s.avgWeightPct) +
            '</td><td>' +
            fmtPctPlain(s.benchWeightPct) +
            '</td><td class="' +
            toneClass(s.allocationBps) +
            '">' +
            fmtBps(s.allocationBps) +
            '</td><td class="' +
            toneClass(s.selectionBps) +
            '">' +
            fmtBps(s.selectionBps) +
            '</td><td class="' +
            toneClass(s.interactionBps) +
            '">' +
            fmtBps(s.interactionBps) +
            '</td><td class="' +
            toneClass(s.totalBps) +
            '">' +
            fmtBps(s.totalBps) +
            '</td></tr>'
          );
        })
        .join('');
    }
  }

  function updateControlsList(returns) {
    var list = document.querySelector('#page-performance .control-checklist');
    if (!list || !returns || !returns.controls) return;
    list.innerHTML = returns.controls
      .map(function (c) {
        var cls = c.done ? 'done' : 'warning';
        var mark = c.done ? '✓' : '!';
        return (
          '<div class="' +
          cls +
          '"><span>' +
          mark +
          '</span><p><strong>' +
          mx.esc(c.label) +
          '</strong><small>' +
          mx.esc(c.detail || '') +
          '</small></p></div>'
        );
      })
      .join('');
    var badge = document.querySelector('#page-performance .performance-bottom .outline-status');
    if (badge) {
      badge.textContent = returns.controlsPending ? returns.controlsPending + ' pending' : 'Ready';
      badge.className = 'outline-status ' + (returns.controlsPending ? 'amber' : 'green');
    }
  }

  function toV17Rows(series) {
    if (!series || !series.length) return null;
    window.__mxData._v17PerfRows = series.map(function (p) {
      return {
        date: new Date(p.date + 'T12:00:00Z'),
        portfolio: Number(p.cum != null ? p.cum : 0) * 100,
        benchmark: p.benchCum != null ? Number(p.benchCum) * 100 : Number(p.cum || 0) * 83.6,
        active: (Number(p.cum || 0) - Number(p.benchCum || 0)) * 100,
        drawdown: 0,
      };
    });
    var peak = -Infinity;
    window.__mxData._v17PerfRows.forEach(function (r) {
      peak = Math.max(peak, r.portfolio);
      r.drawdown = r.portfolio - peak;
    });
    return window.__mxData._v17PerfRows;
  }

  function loadPortfolioDetail(portfolioId, summaryRow) {
    if (!portfolioId) return Promise.resolve();
    selectedPortfolioId = portfolioId;
    var qs =
      '/api/v1/performance/returns' +
      mx.qs({ portfolioId: portfolioId, from: filters.from || undefined, to: filters.to || undefined });
    var qsAttr =
      '/api/v1/performance/attribution' +
      mx.qs({ portfolioId: portfolioId, from: filters.from || undefined, to: filters.to || undefined });
    return Promise.all([getEnvelope(qs), getEnvelope(qsAttr)]).then(function (res) {
      var returns = res[0].data || res[0];
      var attr = res[1].data || res[1];
      mx.data.performanceReturns = returns;
      mx.data.performanceAttribution = attr;
      var row = summaryRow || { portfolioName: returns.portfolioName, twrPct: returns.twrPct, benchmarkPct: returns.benchmarkPct, activePct: returns.activePct, periodStart: returns.periodStart, periodEnd: returns.periodEnd };
      updateControlBar(row);
      updateStatLine(row, returns);
      updateAttributionBridge(attr);
      updateControlsList(returns);
      toV17Rows(returns.series);
      if (typeof v17DrawPerformance === 'function') v17DrawPerformance();
    });
  }

  function loadPerformance() {
    if (!mx.can('reports.view')) return Promise.resolve();
    return getEnvelope('/api/v1/performance/summary' + mx.qs({ from: filters.from || undefined, to: filters.to || undefined })).then(function (body) {
      var rows = body.data || body;
      mx.data.performanceSummary = rows;
      if (!selectedPortfolioId && rows.length) selectedPortfolioId = rows[0].portfolioId;
      var row = rows.find(function (r) {
        return r.portfolioId === selectedPortfolioId;
      }) || rows[0];
      if (row) return loadPortfolioDetail(row.portfolioId, row);
    });
  }

  function openLockModal() {
    if (!mx.can('reports.create')) {
      mx.toast('Access restricted', 'You need reports.create to prepare an official period.', 'error');
      return;
    }
    var row = (mx.data.performanceSummary || []).find(function (r) {
      return r.portfolioId === selectedPortfolioId;
    });
    mx.modal({
      eyebrow: 'PERFORMANCE',
      title: 'Prepare official period',
      body:
        '<form id="mxPerfPeriod"><label class="v34-field"><span>Period start</span><input class="v34-input" type="date" name="periodStart" value="' +
        mx.esc((row && row.periodStart) || '') +
        '" required></label><label class="v34-field"><span>Period end</span><input class="v34-input" type="date" name="periodEnd" value="' +
        mx.esc((row && row.periodEnd) || '') +
        '" required></label><p class="ops-muted">Creates a DRAFT period. A different user locks it after all controls clear.</p></form>',
      actions: [
        { label: 'Cancel', run: function () {} },
        {
          label: 'Prepare draft',
          primary: true,
          run: function (m) {
            var fd = new FormData(m.querySelector('#mxPerfPeriod'));
            return mx
              .post('/api/v1/performance/periods', {
                portfolioId: selectedPortfolioId,
                periodStart: fd.get('periodStart'),
                periodEnd: fd.get('periodEnd'),
              })
              .then(function (period) {
                mx.toast('Official period prepared', (period.ref || 'Period') + ' saved as draft.');
                return loadPerformance();
              });
          },
        },
      ],
    });
  }

  mx.onLoad('reports.view', function () {
    return loadPerformance();
  });

  mx.hydrate('performance', function () {
    if (!livePerformance()) return Promise.resolve();
    return loadPerformance();
  });

  window.addEventListener('matanho:legacy-ready', function () {
    mx.gate('[data-action="lock-official-return"]', 'reports.create');
    mx.gate('[data-action="performance-export"]', 'reports.view');

    mx.intercept(
      '[data-action="performance-export"]',
      function () {
        if (!selectedPortfolioId) return false;
        return mx
          .download(
            '/api/v1/performance/attribution/export' +
              mx.qs({ portfolioId: selectedPortfolioId, from: filters.from || undefined, to: filters.to || undefined, format: 'csv' }),
            'performance-attribution.csv',
          )
          .then(function () {
            mx.toast('Attribution exported', 'Brinson attribution downloaded from PBOR.');
          });
      },
      { when: livePerformance },
    );

    mx.intercept(
      '[data-action="lock-official-return"]',
      function () {
        openLockModal();
        return false;
      },
      { when: livePerformance },
    );

    mx.intercept(
      '[data-action="performance-methodology"]',
      function () {
        mx.toast('Methodology', 'Net TWR with daily geometric chaining; official periods require five controls and independent lock.', 'success');
        return false;
      },
      { when: livePerformance },
    );

    if (typeof v17SetupPerformance === 'function') {
      var baseSetup = v17SetupPerformance;
      window.v17SetupPerformance = function () {
        baseSetup();
        if (livePerformance() && typeof v17DrawPerformance === 'function') v17DrawPerformance();
      };
    }
  });
})();
