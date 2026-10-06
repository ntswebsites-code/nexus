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

  /** Annualised TE / IR from daily portfolio vs benchmark returns in the live series payload. */
  function computeExcessRisk(series) {
    if (!series || series.length < 2) return { trackingErrorPct: null, informationRatio: null };
    var active = [];
    for (var i = 1; i < series.length; i++) {
      var p = series[i];
      if (p.bench == null) continue;
      active.push(Number(p.ret || 0) - Number(p.bench || 0));
    }
    if (active.length < 2) return { trackingErrorPct: null, informationRatio: null };
    var mean = active.reduce(function (a, x) {
      return a + x;
    }, 0) / active.length;
    var variance =
      active.reduce(function (a, x) {
        return a + (x - mean) * (x - mean);
      }, 0) /
      (active.length - 1);
    var std = Math.sqrt(variance);
    if (!std) return { trackingErrorPct: null, informationRatio: null };
    var ann = Math.sqrt(252);
    return {
      trackingErrorPct: std * ann * 100,
      informationRatio: (mean / std) * ann,
    };
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

  function togglePerformanceDemoPanels(live) {
    document.querySelectorAll('#page-performance .mx-demo-only').forEach(function (el) {
      el.style.display = live ? 'none' : '';
    });
  }

  function clearPerformanceChrome() {
    var bar = document.querySelector('#page-performance .platform-control-bar');
    if (bar) {
      bar.querySelectorAll('div strong').forEach(function (el) {
        el.textContent = '—';
        el.className = '';
      });
    }
    var line = document.querySelector('#page-performance .performance-stat-line');
    if (line) {
      line.querySelectorAll('div strong').forEach(function (el) {
        el.textContent = '—';
        el.className = '';
      });
      line.querySelectorAll('div small').forEach(function (el) {
        if (el.previousElementSibling && el.previousElementSibling.tagName === 'STRONG') el.textContent = 'Loading…';
      });
    }
    var legend = document.querySelector('#page-performance .premium-legend');
    if (legend) legend.innerHTML = '<span><i class="legend-line primary"></i>Portfolio <b>—</b></span><span><i class="legend-line benchmark"></i>Benchmark <b>—</b></span><span class="chart-note">Active —</span>';
    var bars = document.querySelector('#page-performance .attribution-bars');
    if (bars) {
      bars.querySelectorAll('div strong').forEach(function (el) {
        el.textContent = '—';
        el.className = '';
      });
      bars.querySelectorAll('div i').forEach(function (el) {
        el.style.setProperty('--w', '0%');
      });
    }
    var table = document.querySelector('#page-performance .performance-bottom tbody');
    if (table) {
      table.innerHTML = '<tr><td colspan="7"><strong>Loading attribution…</strong></td></tr>';
    }
    var list = document.querySelector('#page-performance .control-checklist');
    if (list) list.innerHTML = '<div class="ops-muted" style="padding:8px 0">Loading controls…</div>';
    var badge = document.querySelector('#page-performance .performance-bottom .outline-status');
    if (badge) {
      badge.textContent = '—';
      badge.className = 'outline-status';
    }
    var svg = document.querySelector('#page-performance .perf-svg-wrap svg');
    if (svg) {
      svg.querySelectorAll('path.perf-area, path.perf-line').forEach(function (p) {
        p.setAttribute('d', 'M65 255');
        p.style.opacity = '0';
      });
    }
  }

  function openMethodologyModal() {
    function show(returns) {
      var method =
        (returns && returns.method) ||
        'Net time-weighted return with daily geometric chaining; external flows neutralised at the start of the day.';
      var body = '<p>' + mx.esc(method) + '</p>';
      if (returns && returns.controls && returns.controls.length) {
        body +=
          '<h3 style="margin:12px 0 8px">Official-return controls</h3><ul>' +
          returns.controls
            .map(function (c) {
              return '<li>' + mx.esc(c.label || c.name || 'Control') + (c.done ? ' ✓' : ' — pending') + '</li>';
            })
            .join('') +
          '</ul>';
      }
      if (returns && returns.issues && returns.issues.length) {
        body +=
          '<p class="ops-muted" style="margin-top:8px">' +
          returns.issues.length +
          ' data quality note(s) on the current window.</p>';
      }
      mx.modal({
        eyebrow: 'PERFORMANCE',
        title: 'Return methodology',
        subtitle: (returns && returns.portfolioName) || '',
        body: body,
      });
    }
    var cached = mx.data.performanceReturns;
    if (cached && cached.method) return show(cached);
    if (!selectedPortfolioId) {
      mx.toast('Load performance', 'Select a portfolio to view methodology.', 'warn');
      return;
    }
    getEnvelope(
      '/api/v1/performance/returns' +
        mx.qs({ portfolioId: selectedPortfolioId, from: filters.from || undefined, to: filters.to || undefined }),
    )
      .then(function (body) {
        show(body.data || body);
      })
      .catch(mx.fail);
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
    if (cells[3] && returns && returns.trackingErrorPct != null) cells[3].querySelector('strong').textContent = fmtPctPlain(returns.trackingErrorPct);
    if (cells[4] && returns && returns.informationRatio != null) cells[4].querySelector('strong').textContent = Number(returns.informationRatio).toFixed(2);
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
        benchmark: p.benchCum != null ? Number(p.benchCum) * 100 : 0,
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
      var risk = computeExcessRisk(returns.series);
      if (risk.trackingErrorPct != null) returns.trackingErrorPct = risk.trackingErrorPct;
      if (risk.informationRatio != null) returns.informationRatio = risk.informationRatio;
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

  function openPreparePeriodModal() {
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

  function openOfficialLockModal(period) {
    if (!mx.can('performance.lock')) {
      mx.toast('Access restricted', 'You need performance.lock to certify an official return.', 'error');
      return;
    }
    if (mx.user && period.makerId && mx.user.id === period.makerId) {
      mx.toast('Maker-checker', 'The preparer cannot lock their own period. Ask an independent locker.', 'error');
      return;
    }
    mx.modal({
      eyebrow: 'OFFICIAL RETURN',
      title: 'Lock · ' + (period.ref || 'Period'),
      body:
        '<form id="mxPerfLock"><p class="ops-muted">' +
        mx.esc(period.periodStart + ' to ' + period.periodEnd) +
        ' · net TWR ' +
        mx.esc(fmtPctPlain(period.twrPct)) +
        '</p><label class="v34-field"><span>Certification note</span><input class="v34-input" name="note" maxlength="500"></label><p class="ops-muted">Locks the return as Official (step-up MFA). This cannot be edited without a correction workflow.</p></form>',
      actions: [
        { label: 'Cancel', run: function () {} },
        {
          label: 'Lock official return',
          primary: true,
          run: function (m) {
            var note = m.querySelector('[name="note"]').value.trim();
            return mx
              .post('/api/v1/performance/periods/' + encodeURIComponent(period.id) + '/lock', { note: note || undefined }, { stepUp: true })
              .then(function () {
                mx.toast('Official return locked', (period.ref || 'Period') + ' is now Official');
                return loadPerformance();
              });
          },
        },
      ],
    });
  }

  function openCorrectionModal(period) {
    if (!mx.can('reports.create')) {
      mx.toast('Access restricted', 'You need reports.create to start a performance correction.', 'error');
      return;
    }
    mx.modal({
      eyebrow: 'PERFORMANCE · CORRECTION',
      title: 'Start correction · ' + (period.ref || 'Period'),
      body:
        '<form id="mxPerfCorrect"><p class="ops-muted">' +
        mx.esc(period.periodStart + ' to ' + period.periodEnd) +
        ' · official net TWR ' +
        mx.esc(fmtPctPlain(period.twrPct)) +
        '</p><label class="v34-field wide"><span>Correction reason</span><textarea class="v34-input" name="reason" rows="4" required minlength="5" maxlength="500" placeholder="Explain why this official return must be corrected."></textarea></label></form>',
      actions: [
        { label: 'Cancel', run: function () {} },
        {
          label: 'Start correction',
          primary: true,
          run: function (m) {
            var reason = ((m.querySelector('[name="reason"]') || {}).value || '').trim();
            if (reason.length < 5) {
              mx.toast('Reason required', 'Give at least 5 characters.', 'warn');
              return;
            }
            return mx
              .post('/api/v1/performance/periods/' + encodeURIComponent(period.id) + '/correct', { reason: reason })
              .then(function (draft) {
                mx.toast('Correction started', (draft.ref || period.ref || 'Period') + ' reopened as a draft correction.');
                return loadPerformance();
              })
              .catch(mx.fail);
          },
        },
      ],
    });
  }

  function handleCorrectionAction() {
    if (!selectedPortfolioId) {
      mx.toast('Performance', 'Choose a portfolio first.', 'warn');
      return Promise.resolve();
    }
    return getEnvelope(
      '/api/v1/performance/periods?portfolioId=' + encodeURIComponent(selectedPortfolioId) + '&status=LOCKED&limit=1',
    )
      .then(function (body) {
        var locked = (body.data || body)[0];
        if (!locked) {
          mx.toast('No official period', 'Lock an official return before starting a correction.', 'warn');
          return;
        }
        return getEnvelope('/api/v1/performance/periods/' + encodeURIComponent(locked.id)).then(function (detailBody) {
          openCorrectionModal(detailBody.data || detailBody);
        });
      })
      .catch(mx.fail);
  }

  function handleOfficialReturnAction() {
    if (!selectedPortfolioId) {
      mx.toast('Performance', 'Choose a portfolio first.', 'warn');
      return Promise.resolve();
    }
    return getEnvelope('/api/v1/performance/periods?portfolioId=' + encodeURIComponent(selectedPortfolioId) + '&status=DRAFT&limit=1')
      .then(function (body) {
        var drafts = body.data || body;
        var draft = drafts[0];
        if (draft && mx.can('performance.lock')) {
          return getEnvelope('/api/v1/performance/periods/' + encodeURIComponent(draft.id)).then(function (detailBody) {
            var period = detailBody.data || detailBody;
            if (period.canLock) {
              openOfficialLockModal(period);
              return;
            }
            if (period.makerId && mx.user && period.makerId === mx.user.id) {
              mx.toast('Draft prepared', (period.ref || 'Period') + ' awaits an independent locker.', 'warn');
              return;
            }
            if (period.controlsPending > 0) {
              mx.toast('Controls pending', period.controlsPending + ' control(s) must clear before lock.', 'warn');
              return;
            }
            if (period.stale) {
              if (mx.can('reports.create')) {
                return mx.post('/api/v1/performance/periods/' + encodeURIComponent(period.id) + '/recompute', {}).then(function () {
                  mx.toast('Draft recomputed', (period.ref || 'Period') + ' refreshed from live IBOR');
                  return getEnvelope('/api/v1/performance/periods/' + encodeURIComponent(period.id)).then(function (freshBody) {
                    var fresh = freshBody.data || freshBody;
                    if (fresh.canLock) openOfficialLockModal(fresh);
                    else if (fresh.stale) mx.toast('Stale draft', 'Recompute again after IBOR refresh.', 'warn');
                    else mx.toast('Draft updated', (fresh.ref || 'Period') + ' awaits controls or an independent locker.');
                  });
                });
              }
              mx.toast('Stale draft', 'Recompute the draft before locking.', 'warn');
              return;
            }
            openOfficialLockModal(period);
          });
        }
        if (mx.can('reports.create')) {
          openPreparePeriodModal();
          return;
        }
        mx.toast('Access restricted', 'No draft period to lock and you cannot prepare one.', 'error');
      })
      .catch(mx.fail);
  }

  mx.onLoad('reports.view', function () {
    if (livePerformance()) {
      clearPerformanceChrome();
      togglePerformanceDemoPanels(true);
    }
    return loadPerformance();
  });

  mx.hydrate('performance', function () {
    if (!livePerformance()) return Promise.resolve();
    clearPerformanceChrome();
    togglePerformanceDemoPanels(true);
    return loadPerformance();
  });

  window.addEventListener('matanho:legacy-ready', function () {
    if (livePerformance()) togglePerformanceDemoPanels(true);
    document.querySelectorAll('[data-action="lock-official-return"]').forEach(function (el) {
      if (!mx.can('reports.create') && !mx.can('performance.lock')) {
        el.disabled = true;
        el.setAttribute('aria-disabled', 'true');
        el.title = 'You need reports.create or performance.lock for official returns';
      }
    });
    mx.gate('[data-action="performance-export"]', 'reports.view');

    mx.intercept(
      '[data-action="performance-export"]',
      function () {
        if (!selectedPortfolioId) return false;
        var exportQs = function (format) {
          return mx.qs({
            portfolioId: selectedPortfolioId,
            from: filters.from || undefined,
            to: filters.to || undefined,
            format: format,
          });
        };
        mx.modal({
          eyebrow: 'PERFORMANCE',
          title: 'Export attribution',
          subtitle: 'Brinson-Fachler breakdown',
          body: '<p>Download the current portfolio window from PBOR.</p>',
          actions: [
            {
              label: 'CSV',
              run: function () {
                return mx.streamDownload('/api/v1/performance/attribution/export' + exportQs('csv'), 'performance-attribution.csv').then(function () {
                  mx.toast('Attribution exported', 'CSV downloaded from PBOR.');
                });
              },
            },
            {
              label: 'XLSX',
              primary: true,
              run: function () {
                return mx.streamDownload('/api/v1/performance/attribution/export' + exportQs('xlsx'), 'performance-attribution.xlsx').then(function () {
                  mx.toast('Attribution exported', 'XLSX downloaded from PBOR.');
                });
              },
            },
          ],
        });
        return false;
      },
      { when: livePerformance },
    );

    mx.intercept(
      '[data-action="lock-official-return"]',
      function () {
        handleOfficialReturnAction();
        return false;
      },
      { when: livePerformance },
    );

    mx.gate('[data-action="performance-correction"]', 'reports.create');

    mx.intercept(
      '[data-action="performance-correction"]',
      function () {
        handleCorrectionAction();
        return false;
      },
      { when: livePerformance },
    );

    mx.intercept(
      '[data-action="performance-methodology"]',
      function () {
        openMethodologyModal();
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
