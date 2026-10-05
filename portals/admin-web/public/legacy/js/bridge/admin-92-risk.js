/*
 * Risk & Compliance: limits, stress scenarios, compliance report, issuer headroom.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var portfolios = [];
  var portfolioByName = {};
  var selectedPortfolioId = null;

  function getEnvelope(path) {
    return fetch(mx.api + path, { credentials: 'include', headers: { Accept: 'application/json' } }).then(function (r) {
      return r.json();
    });
  }

  function liveRisk() {
    return mx.live && mx.strict('risk');
  }

  function metricKey(label) {
    var l = String(label || '').toLowerCase();
    if (l.indexOf('issuer') >= 0 || l.indexOf('single') >= 0) return 'SINGLE_NAME_PCT';
    if (l.indexOf('equit') >= 0 || l.indexOf('sector') >= 0) return 'SECTOR_PCT';
    if (l.indexOf('cash') >= 0 || l.indexOf('liquidity') >= 0) return 'CASH_FLOOR_PCT';
    if (l.indexOf('top') >= 0 || l.indexOf('concentr') >= 0) return 'TOP5_PCT';
    return 'SINGLE_NAME_PCT';
  }

  function actionKey(label) {
    var l = String(label || '').toLowerCase();
    if (l.indexOf('block') >= 0) return 'BLOCK';
    if (l.indexOf('escal') >= 0 || l.indexOf('approval') >= 0) return 'ESCALATE';
    return 'ALERT';
  }

  function stateChip(state) {
    if (state === 'BREACH') return '<span class="outline-status red">Breach</span>';
    if (state === 'WARNING') return '<span class="outline-status amber">Tight</span>';
    return '<span class="outline-status green">Within</span>';
  }

  function statusLabel(status) {
    return (
      {
        DRAFT: 'Draft',
        PENDING_APPROVAL: 'Pending approval',
        ACTIVE: 'Active',
        RETIRED: 'Retired',
      }[status] || status
    );
  }

  function portfolioIdFromSelect() {
    var sel = document.getElementById('riskScenarioPortfolio');
    var name = sel ? sel.value : '';
    var p = portfolioByName[name];
    return p ? p.id : selectedPortfolioId;
  }

  function shocksFromForm() {
    return {
      equityPct: Number(document.getElementById('riskEquityShock').value || 0),
      fxPct: Number(document.getElementById('riskFxShock').value || 0),
      ratePctPoints: Number(document.getElementById('riskRateShock').value || 0) / 100,
      redemptionPct: Number(document.getElementById('riskRedemptionShock').value || 0),
    };
  }

  function applyScenarioResult(result) {
    var r = result.results || result;
    var loss = Number(r.lossPct || 0);
    var lossText = (loss >= 0 ? '+' : '−') + Math.abs(loss).toFixed(2) + '%';
    var cover = r.liquidity && r.liquidity.coverage != null ? Number(r.liquidity.coverage) : null;
    var cash = r.liquidity && r.liquidity.cashAfterRedemptionBase != null ? Number(r.liquidity.cashAfterRedemptionBase) : null;
    var stateTxt = r.status === 'ESCALATE' ? 'Escalate' : r.status === 'REVIEW' ? 'Review' : 'Within';
    var reason = (r.reasons && r.reasons[0]) || 'Scenario evaluated against live portfolio book';
    var set = function (id, val) {
      var el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    set('riskScenarioLoss', lossText);
    set('riskHeadlineStress', lossText);
    if (cover != null) {
      set('riskScenarioLiquidity', cover.toFixed(2) + '×');
      set('riskHeadlineLiquidity', cover.toFixed(2) + '×');
    }
    if (cash != null) set('riskScenarioCash', (cash >= 0 ? 'US$ ' : '−US$ ') + Math.abs(cash / 1e6).toFixed(2) + 'M');
    var stateEl = document.getElementById('riskScenarioState');
    if (stateEl) {
      stateEl.textContent = stateTxt;
      stateEl.className = stateTxt === 'Within' ? 'positive-text' : 'attention-text';
    }
    set('riskScenarioReason', reason);
    return { lossText: lossText, cover: cover || 0, stateTxt: stateTxt };
  }

  function renderLimitRows(evaluations, limits) {
    var body = document.getElementById('riskLimitRows');
    if (!body) return;
    if (!evaluations || !evaluations.length) {
      body.innerHTML =
        '<tr><td colspan="7"><span class="ops-muted">No active limits for this portfolio.</span></td></tr>';
      return;
    }
    body.innerHTML = evaluations
      .map(function (e) {
        var lim = limits.find(function (l) {
          return l.id === e.limitId || l.ref === e.ref;
        });
        var label = e.metricLabel || e.metric;
        var scope = lim && lim.scopeName ? lim.scopeName : e.scopeType === 'FIRM' ? 'All portfolios' : 'Portfolio';
        return (
          '<tr data-limit-id="' +
          mx.esc(e.limitId || '') +
          '"><td><strong>' +
          mx.esc(label) +
          '</strong><small>' +
          mx.esc(scope) +
          '</small></td><td>' +
          mx.esc(e.value) +
          '%</td><td>—</td><td>' +
          mx.esc(e.threshold) +
          '%</td><td>' +
          mx.esc(e.headroom || '—') +
          '</td><td>' +
          mx.esc((lim && lim.breachAction) || e.breachAction || 'ALERT') +
          '</td><td>' +
          stateChip(e.state) +
          (lim && lim.status && lim.status !== 'ACTIVE' ? ' <small>' + statusLabel(lim.status) + '</small>' : '') +
          '</td></tr>'
        );
      })
      .join('');
  }

  function renderStatusBar(summary, evaluations) {
    var bar = document.querySelector('#page-risk .risk-statusbar-v7');
    if (!bar) return;
    var warnings = (evaluations || []).filter(function (e) {
      return e.state === 'WARNING';
    }).length;
    var breaches = (evaluations || []).filter(function (e) {
      return e.state === 'BREACH';
    }).length;
    var tight = (evaluations || [])
      .slice()
      .sort(function (a, b) {
        return Number(a.headroom) - Number(b.headroom);
      })[0];
    var title = bar.querySelector('strong');
    if (title) title.textContent = breaches ? breaches + ' hard breach(es)' : warnings ? 'No hard mandate breach' : 'Within mandate';
    var small = bar.querySelector('small');
    if (small) small.textContent = warnings + ' amber limits · ' + (summary && summary.openCases != null ? summary.openCases : 0) + ' open cases';
    if (tight && bar.querySelectorAll('div')[2]) {
      var pct = tight.threshold && Number(tight.threshold) ? Math.round((Number(tight.value) / Number(tight.threshold)) * 100) : null;
      bar.querySelectorAll('div')[2].querySelector('strong').textContent = pct != null ? tight.metricLabel + ' · ' + pct + '%' : '—';
    }
  }

  function syncV37Limits(evaluations, limits) {
    if (!window.__mxData || !window.__mxData._riskLimits37) return;
    mx.replace(
      window.__mxData._riskLimits37,
      (evaluations || []).map(function (e, i) {
        var lim = limits[i] || {};
        return {
          metric: e.metricLabel || e.metric,
          scope: lim.scopeName || 'Portfolio',
          current: Number(e.value),
          stress: Number(e.value),
          threshold: Number(e.threshold),
          unit: '%',
          action: lim.breachAction || 'Warn',
          state: e.state === 'BREACH' ? 'Breach' : e.state === 'WARNING' ? 'Amber' : 'Within',
        };
      }),
    );
  }

  function loadLimitsForPortfolio(portfolioId) {
    if (!portfolioId) return Promise.resolve();
    selectedPortfolioId = portfolioId;
    return Promise.all([
      getEnvelope('/api/v1/risk/portfolios/' + encodeURIComponent(portfolioId) + '/limits'),
      getEnvelope('/api/v1/risk/limits?status=ACTIVE&portfolioId=' + encodeURIComponent(portfolioId)),
    ]).then(function (res) {
      var evalBody = res[0].data || res[0];
      var limits = res[1].data || res[1];
      var evaluations = evalBody.evaluations || [];
      mx.data.riskEvaluations = evaluations;
      mx.data.riskLimits = limits;
      renderLimitRows(evaluations, limits);
      renderStatusBar(mx.data.riskSummary, evaluations);
      syncV37Limits(evaluations, limits);
    });
  }

  function loadRisk() {
    if (!mx.can('risk.view')) return Promise.resolve();
    return Promise.all([
      mx.get('/api/v1/portfolios?status=Active').catch(function () {
        return [];
      }),
      getEnvelope('/api/v1/risk/breaches?status=OPEN&limit=1'),
      getEnvelope('/api/v1/risk/cases?status=OPEN&limit=1'),
    ]).then(function (res) {
      portfolios = Array.isArray(res[0]) ? res[0] : res[0].data || [];
      portfolioByName = {};
      portfolios.forEach(function (p) {
        portfolioByName[p.name] = p;
      });
      mx.data.riskSummary = {
        openBreaches: (res[1].total != null ? res[1].total : (res[1].data || []).length) || 0,
        openCases: (res[2].total != null ? res[2].total : (res[2].data || []).length) || 0,
      };
      var sel = document.getElementById('riskScenarioPortfolio');
      if (sel && portfolios.length && sel.options.length <= 3) {
        sel.innerHTML = portfolios
          .map(function (p) {
            return '<option>' + mx.esc(p.name) + '</option>';
          })
          .join('');
      }
      var pid = portfolioIdFromSelect() || (portfolios[0] && portfolios[0].id);
      return loadLimitsForPortfolio(pid);
    });
  }

  function runScenarioLive() {
    var pid = portfolioIdFromSelect();
    if (!pid) {
      mx.toast('Scenario blocked', 'Choose a portfolio first.', 'error');
      return Promise.resolve();
    }
    return mx
      .post('/api/v1/risk/scenarios/preview', { portfolioId: pid, shocks: shocksFromForm() })
      .then(function (data) {
        var r = applyScenarioResult(data);
        mx.toast('Stress scenario calculated', (document.getElementById('riskScenarioName').value || 'Scenario') + ': ' + r.lossText + ' · ' + r.cover.toFixed(2) + '× liquidity cover.');
      })
      .catch(mx.fail);
  }

  function addLimitLive() {
    if (!mx.can('risk.manage')) {
      mx.toast('Access restricted', 'You need risk.manage to create limits.', 'error');
      return Promise.resolve();
    }
    var scopeName = document.getElementById('riskLimitScope').value;
    var scopeType = scopeName === 'All portfolios' ? 'FIRM' : 'PORTFOLIO';
    var scopeId = scopeType === 'PORTFOLIO' ? (portfolioByName[scopeName] && portfolioByName[scopeName].id) || selectedPortfolioId : undefined;
    var thr = Number(document.getElementById('riskLimitThreshold').value);
    if (!Number.isFinite(thr) || thr <= 0) {
      mx.toast('Invalid threshold', 'Enter a positive limit threshold.', 'error');
      return Promise.resolve();
    }
    return mx
      .post('/api/v1/risk/limits', {
        metric: metricKey(document.getElementById('riskLimitMetric').value),
        scopeType: scopeType,
        scopeId: scopeId,
        threshold: thr,
        breachAction: actionKey(document.getElementById('riskLimitAction').value),
        description: document.getElementById('riskLimitMetric').value + ' · ' + scopeName,
      })
      .then(function () {
        mx.toast('Draft limit added', 'Limit saved as DRAFT — submit and approve before it becomes effective.');
        return loadRisk();
      })
      .catch(mx.fail);
  }

  function openHeadroomDrawer() {
    var pid = portfolioIdFromSelect();
    if (!pid) return Promise.resolve();
    return getEnvelope('/api/v1/risk/portfolios/' + encodeURIComponent(pid) + '/limits').then(function (body) {
      var evals = (body.data && body.data.evaluations) || body.evaluations || [];
      openDrawer({
        eyebrow: 'RISK · ISSUER HEADROOM',
        title: 'Portfolio limit utilisation',
        subtitle: 'Live measurements from the risk engine',
        body:
          '<div class="table-wrap"><table class="institution-table"><thead><tr><th>Limit</th><th>Current</th><th>Threshold</th><th>Headroom</th><th>State</th></tr></thead><tbody>' +
          evals
            .map(function (e) {
              return (
                '<tr><td><strong>' +
                mx.esc(e.metricLabel) +
                '</strong></td><td>' +
                mx.esc(e.value) +
                '%</td><td>' +
                mx.esc(e.threshold) +
                '%</td><td>' +
                mx.esc(e.headroom) +
                '</td><td>' +
                stateChip(e.state) +
                '</td></tr>'
              );
            })
            .join('') +
          '</tbody></table></div>',
      });
    });
  }

  mx.onLoad('risk.view', function () {
    return loadRisk();
  });

  mx.hydrate('risk', function () {
    if (!liveRisk()) return Promise.resolve();
    return loadRisk();
  });

  window.addEventListener('matanho:legacy-ready', function () {
    mx.gate('#riskAddLimit', 'risk.manage');
    mx.gate('#riskRunScenario', 'risk.view');
    mx.gate('#riskRunScenarioTop', 'risk.view');

    mx.intercept('[data-action="generate-compliance-report"]', function () {
      return mx.download('/api/v1/risk/compliance-report?format=csv', 'risk-compliance-report.csv').then(function () {
        mx.toast('Compliance report', 'Daily risk & compliance pack exported from live limits.');
      });
    }, { when: liveRisk });

    mx.intercept('[data-action="open-issuer-headroom"]', function () {
      return openHeadroomDrawer().catch(mx.fail);
    }, { when: liveRisk });

    document.addEventListener(
      'click',
      function (e) {
        if (!liveRisk()) return;
        if (e.target.closest && (e.target.closest('#riskRunScenario') || e.target.closest('#riskRunScenarioTop'))) {
          e.preventDefault();
          e.stopImmediatePropagation();
          runScenarioLive();
          return;
        }
        if (e.target.closest && e.target.closest('#riskAddLimit')) {
          e.preventDefault();
          e.stopImmediatePropagation();
          addLimitLive();
          return;
        }
        if (e.target.closest && e.target.closest('#riskSaveScenario')) {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (!mx.can('risk.manage')) return;
          mx
            .post('/api/v1/risk/scenarios', { name: document.getElementById('riskScenarioName').value || 'Custom scenario', shocks: shocksFromForm() })
            .then(function () {
              mx.toast('Scenario saved', 'Scenario stored in the library.');
            })
            .catch(mx.fail);
        }
      },
      true,
    );

    var pf = document.getElementById('riskScenarioPortfolio');
    if (pf) {
      pf.addEventListener('change', function () {
        if (!liveRisk()) return;
        loadLimitsForPortfolio(portfolioIdFromSelect()).catch(mx.fail);
      });
    }
  });
})();
