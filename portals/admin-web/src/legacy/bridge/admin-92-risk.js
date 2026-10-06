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

  function limitActionButtons(lim) {
    if (!mx.can('risk.manage') || !lim || !lim.id) return '';
    var isMaker = mx.user && lim.makerId && mx.user.id === lim.makerId;
    var out = [];
    if (lim.status === 'DRAFT') {
      out.push('<button type="button" class="btn secondary" data-mx-limit-action="submit" data-limit-id="' + mx.esc(lim.id) + '">Submit</button>');
    }
    if (lim.status === 'PENDING_APPROVAL') {
      if (!isMaker) {
        out.push('<button type="button" class="btn primary" data-mx-limit-action="approve" data-limit-id="' + mx.esc(lim.id) + '">Approve</button>');
      } else {
        out.push('<small>Awaiting checker</small>');
      }
      out.push('<button type="button" class="btn secondary" data-mx-limit-action="reject" data-limit-id="' + mx.esc(lim.id) + '">Return</button>');
    }
    if (lim.status === 'ACTIVE') {
      out.push('<button type="button" class="btn secondary" data-mx-limit-action="retire" data-limit-id="' + mx.esc(lim.id) + '">Retire</button>');
    }
    return out.length ? '<div class="form-actions" style="margin-top:6px;gap:6px">' + out.join('') + '</div>' : '';
  }

  function renderLimitRows(evaluations, limits) {
    var body = document.getElementById('riskLimitRows');
    if (!body) return;
    limits = limits || [];
    evaluations = evaluations || [];
    var rows = evaluations.map(function (e) {
      var lim = limits.find(function (l) {
        return l.id === e.limitId || l.ref === e.ref;
      });
      var label = e.metricLabel || e.metric;
      var scope = lim && lim.scopeName ? lim.scopeName : e.scopeType === 'FIRM' ? 'All portfolios' : 'Portfolio';
      return {
        limitId: e.limitId || (lim && lim.id) || '',
        html:
          '<tr data-limit-id="' +
          mx.esc(e.limitId || (lim && lim.id) || '') +
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
          limitActionButtons(lim) +
          '</td></tr>',
      };
    });
    limits
      .filter(function (l) {
        return l.status !== 'ACTIVE' && !rows.some(function (r) {
          return r.limitId === l.id;
        });
      })
      .forEach(function (lim) {
        rows.push({
          limitId: lim.id,
          html:
            '<tr data-limit-id="' +
            mx.esc(lim.id) +
            '"><td><strong>' +
            mx.esc(lim.metricLabel || lim.metric) +
            '</strong><small>' +
            mx.esc(lim.scopeName || 'Portfolio') +
            '</small></td><td>—</td><td>—</td><td>' +
            mx.esc(lim.threshold) +
            '%</td><td>—</td><td>' +
            mx.esc(lim.breachAction || 'ALERT') +
            '</td><td><small>' +
            statusLabel(lim.status) +
            '</small>' +
            limitActionButtons(lim) +
            '</td></tr>',
        });
      });
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7"><span class="ops-muted">No limits for this portfolio.</span></td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (r) {
      return r.html;
    }).join('');
  }

  function clearRiskChrome() {
    var bar = document.querySelector('#page-risk .risk-statusbar-v7');
    if (bar) {
      var title = bar.querySelector('strong');
      if (title) title.textContent = '—';
      var small = bar.querySelector('small');
      if (small) small.textContent = 'Loading…';
    }
    ['riskClosestLimit', 'riskHeadlineStress', 'riskHeadlineLiquidity', 'riskOpenExceptions', 'riskScenarioLoss', 'riskScenarioLiquidity', 'riskScenarioCash', 'riskScenarioState'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.textContent = '—';
        el.className = '';
      }
    });
    var reason = document.getElementById('riskScenarioReason');
    if (reason) reason.textContent = 'Awaiting scenario run';
    var body = document.getElementById('riskLimitRows');
    if (body) body.innerHTML = '<tr><td colspan="7"><span class="ops-muted">Loading limits…</span></td></tr>';
  }

  function toggleRiskDemoPanels(live) {
    document.querySelectorAll('#page-risk .risk-work-grid-bottom-v7').forEach(function (el) {
      el.style.display = live ? 'none' : '';
    });
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
    var closest = document.getElementById('riskClosestLimit');
    if (tight && closest) {
      var pct = tight.threshold && Number(tight.threshold) ? Math.round((Number(tight.value) / Number(tight.threshold)) * 100) : null;
      closest.textContent = pct != null ? tight.metricLabel + ' · ' + pct + '%' : '—';
    }
    var exc = document.getElementById('riskOpenExceptions');
    if (exc && summary) {
      var total = (summary.openCases || 0) + (summary.openBreaches || 0);
      exc.textContent = String(total);
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
      getEnvelope('/api/v1/risk/limits?portfolioId=' + encodeURIComponent(portfolioId)),
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

  function limitReasonModal(title, onConfirm) {
    mx.modal({
      eyebrow: 'RISK LIMIT',
      title: title,
      body: '<form id="mxLimitReason"><label class="v34-field"><span>Reason</span><textarea class="v34-input" name="reason" required rows="3" minlength="3"></textarea></label></form>',
      actions: [
        { label: 'Cancel', run: function () {} },
        {
          label: 'Continue',
          primary: true,
          run: function (m) {
            var reason = m.querySelector('[name="reason"]').value.trim();
            if (reason.length < 3) throw new Error('A reason is required');
            return onConfirm(reason);
          },
        },
      ],
    });
  }

  function runLimitAction(limitId, action) {
    var lim = (mx.data.riskLimits || []).find(function (l) {
      return l.id === limitId;
    });
    if (!lim) {
      mx.toast('Limit not found', 'Reload the risk workspace.', 'error');
      return Promise.resolve();
    }
    var base = '/api/v1/risk/limits/' + encodeURIComponent(limitId);
    if (action === 'submit') {
      return mx.post(base + '/submit', {}).then(function () {
        mx.toast('Limit submitted', (lim.ref || 'Limit') + ' is pending approval');
        return loadLimitsForPortfolio(selectedPortfolioId);
      });
    }
    if (action === 'approve') {
      if (mx.user && lim.makerId === mx.user.id) {
        mx.toast('Maker-checker', 'You created this limit; another approver must approve it.', 'error');
        return Promise.resolve();
      }
      return mx.post(base + '/approve', {}, { stepUp: true }).then(function () {
        mx.toast('Limit approved', (lim.ref || 'Limit') + ' is now active');
        return loadRisk();
      });
    }
    if (action === 'reject') {
      return new Promise(function (resolve) {
        limitReasonModal('Return ' + (lim.ref || 'limit') + ' to draft', function (reason) {
          return mx.post(base + '/reject', { reason: reason }).then(function () {
            mx.toast('Limit returned', (lim.ref || 'Limit') + ' moved back to draft');
            return loadLimitsForPortfolio(selectedPortfolioId).then(resolve);
          });
        });
      });
    }
    if (action === 'retire') {
      return new Promise(function (resolve) {
        limitReasonModal('Retire ' + (lim.ref || 'limit'), function (reason) {
          return mx.post(base + '/retire', { reason: reason }).then(function () {
            mx.toast('Limit retired', (lim.ref || 'Limit') + ' is no longer effective');
            return loadRisk().then(resolve);
          });
        });
      });
    }
    return Promise.resolve();
  }

  function openNewRiskCaseModal() {
    if (!mx.can('risk.manage')) {
      mx.toast('Access restricted', 'You need risk.manage to open a case.', 'error');
      return;
    }
    mx.modal({
      eyebrow: 'RISK',
      title: 'New compliance case',
      body:
        '<form id="mxRiskCase"><label class="v34-field"><span>Type</span><input class="v34-input" name="type" value="MANUAL" required></label><label class="v34-field"><span>Description</span><textarea class="v34-input" name="description" rows="4" required minlength="3"></textarea></label><label class="v34-field"><span>Severity</span><select class="v34-select" name="severity"><option>MEDIUM</option><option>LOW</option><option>HIGH</option><option>CRITICAL</option></select></label></form>',
      actions: [
        { label: 'Cancel', run: function () {} },
        {
          label: 'Create case',
          primary: true,
          run: function (m) {
            var fd = new FormData(m.querySelector('#mxRiskCase'));
            return mx
              .post('/api/v1/risk/cases', {
                type: fd.get('type') || 'MANUAL',
                description: fd.get('description'),
                severity: fd.get('severity') || 'MEDIUM',
                portfolioId: selectedPortfolioId || undefined,
              })
              .then(function (c) {
                mx.toast('Case opened', (c.ref || 'Case') + ' added to the exception queue');
                return loadRisk();
              });
          },
        },
      ],
    });
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
    if (liveRisk()) clearRiskChrome();
    return loadRisk();
  });

  mx.hydrate('risk', function () {
    if (!liveRisk()) return Promise.resolve();
    clearRiskChrome();
    return loadRisk();
  });

  window.addEventListener('matanho:legacy-ready', function () {
    toggleRiskDemoPanels(liveRisk());
    mx.gate('#riskAddLimit', 'risk.manage');
    mx.gate('#riskRunScenario', 'risk.view');
    mx.gate('#riskRunScenarioTop', 'risk.view');
    mx.gate('[data-risk-new-case="true"]', 'risk.manage');

    mx.intercept('[data-action="generate-compliance-report"]', function () {
      mx.modal({
        eyebrow: 'RISK',
        title: 'Compliance report',
        subtitle: 'Limit book vs live positions',
        body: '<p>Export the daily risk and compliance pack from the server.</p>',
        actions: [
          {
            label: 'CSV',
            run: function () {
              return mx.streamDownload('/api/v1/risk/compliance-report?format=csv', 'risk-compliance-report.csv').then(function () {
                mx.toast('Compliance report', 'CSV exported from live limits.');
              });
            },
          },
          {
            label: 'XLSX',
            primary: true,
            run: function () {
              return mx.streamDownload('/api/v1/risk/compliance-report?format=xlsx', 'risk-compliance-report.xlsx').then(function () {
                mx.toast('Compliance report', 'XLSX exported from live limits.');
              });
            },
          },
        ],
      });
      return false;
    }, { when: liveRisk });

    mx.intercept('[data-action="open-issuer-headroom"]', function () {
      return openHeadroomDrawer().catch(mx.fail);
    }, { when: liveRisk });

    mx.intercept('[data-risk-new-case="true"]', function () {
      openNewRiskCaseModal();
      return false;
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
          return;
        }
        var limitBtn = e.target.closest && e.target.closest('[data-mx-limit-action]');
        if (limitBtn) {
          e.preventDefault();
          e.stopImmediatePropagation();
          runLimitAction(limitBtn.getAttribute('data-limit-id'), limitBtn.getAttribute('data-mx-limit-action')).catch(mx.fail);
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
