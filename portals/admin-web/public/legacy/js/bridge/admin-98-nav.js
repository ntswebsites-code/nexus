/*
 * Valuation / NAV: runs, exceptions, maker review, release.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var currentRun = null;
  var runByPortfolio = {};

  function getEnvelope(path) {
    return fetch(mx.api + path, { credentials: 'include', headers: { Accept: 'application/json' } }).then(function (r) {
      return r.json();
    });
  }

  function liveNav() {
    return mx.live && mx.strict('valuation');
  }

  function toggleNavDemoPanels(live) {
    document.querySelectorAll('#page-valuation .mx-demo-only').forEach(function (el) {
      el.style.display = live ? 'none' : '';
    });
  }

  function clearNavKpis() {
    document.querySelectorAll('#page-valuation .v33-kpis .v33-kpi strong').forEach(function (el) {
      if (el.id !== 'v33NavReleaseState') el.textContent = '—';
    });
    document.querySelectorAll('#page-valuation .v33-kpis .v33-kpi small').forEach(function (el) {
      if (el.id !== 'v33NavReleaseReason') el.textContent = 'Loading…';
    });
    var state = document.getElementById('v33NavReleaseState');
    var reason = document.getElementById('v33NavReleaseReason');
    if (state) state.textContent = '—';
    if (reason) reason.textContent = 'Loading…';
    var lanes = document.getElementById('v33NavLanes');
    if (lanes) {
      lanes.querySelectorAll('.v33-lane strong').forEach(function (el) {
        el.textContent = '—';
      });
      lanes.querySelectorAll('.v33-lane small').forEach(function (el) {
        el.textContent = 'Loading…';
      });
    }
  }

  function setNavKpi(id, value, hint) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = value;
    if (hint != null) {
      var small = el.parentElement && el.parentElement.querySelector('small');
      if (small) small.textContent = hint;
    }
  }

  function patchNavKpis(detail) {
    if (!detail) return;
    setNavKpi('v33NavKpiDraft', money(detail.nav, detail.baseCurrency), detail.navDate ? mx.date(detail.navDate) : '—');
    setNavKpi(
      'v33NavKpiUnit',
      detail.navPerUnit != null ? Number(detail.navPerUnit).toFixed(4) : '—',
      detail.units != null ? (Number(detail.units) / 1e6).toFixed(2) + 'm units' : '—'
    );
    var openEx = Number(detail.openMaterialExceptions || 0);
    setNavKpi(
      'v33NavKpiCoverage',
      detail.priceCoverage != null ? Number(detail.priceCoverage).toFixed(1) + '%' : '—',
      openEx ? openEx + ' material exception' + (openEx === 1 ? '' : 's') : 'All within tolerance'
    );
    var cashPct = detail.cashReconciledPct != null ? Number(detail.cashReconciledPct) : detail.cashReconciled ? 100 : null;
    setNavKpi('v33NavKpiCash', cashPct != null ? cashPct + '%' : '—', cashPct === 100 ? 'All banks signed' : 'From cash reconciliation');
    var fees = (detail.bridge || []).find(function (b) {
      return b.key === 'FEES';
    });
    setNavKpi('v33NavKpiFees', fees ? money(fees.amount, detail.baseCurrency) : '—', 'Management + admin');
    patchNavLanes(detail);
  }

  function patchNavLanes(detail) {
    var host = document.getElementById('v33NavLanes');
    if (!host || !detail) return;
    var lanes = host.querySelectorAll('.v33-lane');
    var openEx = Number(detail.openMaterialExceptions || 0);
    if (lanes[0]) {
      lanes[0].querySelector('strong').textContent = detail.ref || '—';
      lanes[0].querySelector('small').textContent = detail.updatedAt ? 'Updated ' + mx.date(detail.updatedAt) : '—';
    }
    if (lanes[1]) {
      lanes[1].querySelector('strong').textContent = openEx ? 'Conditional' : 'Clear';
      lanes[1].querySelector('small').textContent = openEx ? 'Pricing break open' : 'Reconciled';
    }
    if (lanes[2]) {
      lanes[2].querySelector('strong').textContent = openEx ? String(openEx) + ' pending' : '0';
      lanes[2].querySelector('small').textContent = openEx ? 'Evidence required' : 'No overrides';
    }
    if (lanes[3]) {
      lanes[3].querySelector('strong').textContent = detail.status === 'RELEASED' ? 'Released' : 'Not released';
      lanes[3].querySelector('small').textContent = detail.status === 'RELEASED' ? 'PBOR updated' : 'PBOR unchanged';
    }
  }

  function money(v, ccy) {
    if (v == null || v === '') return '—';
    var n = Number(v);
    if (isNaN(n)) return '—';
    var prefix = ccy === 'ZWG' ? 'ZWG ' : 'US$ ';
    if (Math.abs(n) >= 1e6) return prefix + (n / 1e6).toFixed(2) + 'm';
    return prefix + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function syncPrototypeFlags(detail) {
    if (!detail) return;
    var openMaterial = Number(detail.openMaterialExceptions || 0);
    if (typeof navPriceResolved !== 'undefined') {
      navPriceResolved = openMaterial === 0;
    }
    if (typeof navMaker !== 'undefined') {
      navMaker = detail.status === 'MAKER_REVIEWED' || detail.status === 'RELEASED';
    }
    if (typeof navReleased !== 'undefined') {
      navReleased = detail.status === 'RELEASED';
    }
  }

  function mapNavState49(detail) {
    if (!detail || !detail.portfolioName) return null;
    var name = detail.portfolioName;
    var prev = 0;
    var market = 0;
    var flows = 0;
    var fees = 0;
    (detail.bridge || []).forEach(function (b) {
      var amt = Number(b.amount || 0);
      if (b.key === 'PREV_NAV') prev = amt;
      else if (b.key === 'MARKET') market = amt;
      else if (b.key === 'FLOWS') flows = amt;
      else if (b.key === 'FEES') fees = amt;
    });
    return {
      ccy: detail.baseCurrency || 'USD',
      prev: prev / 1e6,
      market: market / 1e6,
      flows: flows / 1e6,
      fees: fees / 1e6,
      draft: Number(detail.nav || 0) / 1e6,
      unit: Number(detail.navPerUnit || 0),
      units: Number(detail.units || 0) / 1e6,
      coverage: Number(detail.priceCoverage || 100),
      exception: Number(detail.openMaterialExceptions || 0) > 0,
      resolved: Number(detail.openMaterialExceptions || 0) === 0,
      maker: detail.status === 'MAKER_REVIEWED' || detail.status === 'RELEASED',
      released: detail.status === 'RELEASED',
      version: detail.version || 1,
      cutoff: '16:00 CAT',
    };
  }

  function patchNavExceptions(detail) {
    var host = document.getElementById('v33NavExceptions');
    if (!host || !detail) return;
    var items = detail.exceptions || [];
    if (!items.length) {
      host.innerHTML =
        '<tr><td colspan="6"><strong>No valuation exceptions</strong><small>All material inputs are within tolerance.</small></td></tr>';
      return;
    }
    host.innerHTML = items
      .slice(0, 12)
      .map(function (ex) {
        var resolved = ex.status === 'RESOLVED';
        var cur = ex.currentValue != null ? money(ex.currentValue) : '—';
        var ref = ex.referenceValue != null ? money(ex.referenceValue) : '—';
        var pct = ex.difference != null && ex.referenceValue ? ((Number(ex.difference) / Number(ex.referenceValue)) * 100).toFixed(1) + '%' : '—';
        return (
          '<tr data-nav-ex="' +
          ex.id +
          '"><td><strong>' +
          (ex.ticker || ex.type || 'Exception') +
          '</strong><small>' +
          (ex.detail || '') +
          '</small></td><td>' +
          cur +
          '</td><td>' +
          ref +
          '</td><td>' +
          pct +
          '</td><td>' +
          (ex.material ? 'Material' : 'Immaterial') +
          '</td><td>' +
          (resolved
            ? '<span class="v33-chip pass">Resolved</span>'
            : '<button class="v33-btn" data-nav-resolve="' + ex.id + '">Review evidence</button>') +
          '</td></tr>'
        );
      })
      .join('');
  }

  function patchNavBridge(detail) {
    var host = document.getElementById('v33NavBridge');
    if (!host || !detail) return;
    var rows = (detail.bridge || [])
      .map(function (b) {
        return (
          '<div class="v33-row"><span><strong>' +
          b.label +
          '</strong></span><em>' +
          money(b.amount, detail.baseCurrency) +
          '</em></div>'
        );
      })
      .join('');
    host.innerHTML = rows ? '<div class="v33-list">' + rows + '</div>' : host.innerHTML;
    var state = document.getElementById('v33NavReleaseState');
    var reason = document.getElementById('v33NavReleaseReason');
    if (state) {
      state.textContent =
        detail.status === 'RELEASED'
          ? 'Released'
          : detail.status === 'MAKER_REVIEWED'
            ? 'Ready for checker'
            : Number(detail.openMaterialExceptions || 0) > 0
              ? 'Blocked'
              : 'Ready for maker';
    }
    if (reason) {
      reason.textContent =
        detail.status === 'RELEASED'
          ? 'PBOR updated with controlled release'
          : Number(detail.openMaterialExceptions || 0) > 0
            ? 'Material exceptions require review'
            : 'All material inputs resolved';
    }
  }

  function applyNav49(states) {
    if (!states || typeof navState === 'undefined') return;
    Object.keys(states).forEach(function (k) {
      navState[k] = states[k];
    });
    window.__mxData._navState49 = navState;
    if (typeof renderNav49 === 'function') renderNav49();
  }

  function applyNavDetail(detail) {
    currentRun = detail;
    syncPrototypeFlags(detail);
    if (typeof renderNav === 'function') renderNav();
    patchNavExceptions(detail);
    patchNavBridge(detail);
    if (liveNav()) patchNavKpis(detail);
    var state49 = mapNavState49(detail);
    if (state49 && detail.portfolioName) {
      applyNav49({ [detail.portfolioName]: state49 });
      if (typeof navFund !== 'undefined') navFund = detail.portfolioName;
    }
  }

  function loadNav() {
    if (!mx.can('valuation.view')) return Promise.resolve();
    return getEnvelope('/api/v1/nav/runs?limit=20')
      .then(function (body) {
        var list = body.data || [];
        runByPortfolio = {};
        list.forEach(function (r) {
          if (r.status !== 'SUPERSEDED' && r.portfolioName) runByPortfolio[r.portfolioName] = r;
        });
        var pick =
          list.find(function (r) {
            return r.status !== 'RELEASED' && r.status !== 'SUPERSEDED';
          }) || list[0];
        if (!pick) {
          currentRun = null;
          if (liveNav()) clearNavKpis();
          return null;
        }
        return getEnvelope('/api/v1/nav/runs/' + encodeURIComponent(pick.id)).then(function (d) {
          return d.data || d;
        });
      })
      .then(function (detail) {
        if (!detail) return;
        applyNavDetail(detail);
        mx.data.navRun = detail;
      });
  }

  function runId() {
    return currentRun && currentRun.id;
  }

  function openNavInputsModal() {
    if (!mx.can('valuation.run')) {
      mx.toast('Access restricted', 'You need valuation.run to edit NAV inputs.', 'error');
      return;
    }
    if (!runId() || !currentRun) {
      mx.toast('No NAV run', 'Create or open a valuation run first.', 'warn');
      return;
    }
    var d = currentRun;
    mx.modal({
      eyebrow: 'NAV · INPUTS',
      title: 'Edit run inputs · ' + (d.ref || ''),
      body:
        '<form id="mxNavInputs"><label class="detail-field"><span>Accruals</span><input class="detail-input" name="accruals" type="number" step="0.0001" min="0" value="' +
        mx.esc(d.accruals != null ? d.accruals : '') +
        '"></label><label class="detail-field"><span>Fees (manual)</span><input class="detail-input" name="fees" type="number" step="0.0001" min="0" value="' +
        mx.esc(d.fees != null ? d.fees : '') +
        '"></label><label class="detail-field"><span>Fee rate % p.a.</span><input class="detail-input" name="feeRatePct" type="number" step="0.0001" min="0" max="100" value="' +
        mx.esc(d.feeRatePct != null ? d.feeRatePct : '') +
        '"></label><label class="detail-field"><span>Liabilities</span><input class="detail-input" name="liabilities" type="number" step="0.0001" min="0" value="' +
        mx.esc(d.liabilities != null ? d.liabilities : '') +
        '"></label><label class="detail-field"><span>Units</span><input class="detail-input" name="units" type="number" step="0.000001" min="0" value="' +
        mx.esc(d.units != null ? d.units : '') +
        '"></label><label class="detail-field wide"><span>Notes</span><textarea class="detail-input" name="notes" rows="3">' +
        mx.esc(d.notes || '') +
        '</textarea></label><p class="ops-muted">Set either manual fees or a fee rate, not both.</p></form>',
      actions: [
        { label: 'Cancel', run: function () {} },
        {
          label: 'Save inputs',
          primary: true,
          run: function (m) {
            var fd = new FormData(m.querySelector('#mxNavInputs'));
            var payload = {};
            ['accruals', 'fees', 'feeRatePct', 'liabilities', 'units'].forEach(function (k) {
              var v = fd.get(k);
              if (v !== null && String(v).trim() !== '') payload[k] = String(v).trim();
            });
            var notes = fd.get('notes');
            if (notes !== null) payload.notes = String(notes).trim() || null;
            if (!Object.keys(payload).length) {
              mx.toast('Nothing to save', 'Change at least one input.', 'warn');
              return;
            }
            return mx
              .patch('/api/v1/nav/runs/' + encodeURIComponent(runId()) + '/inputs', payload)
              .then(function () {
                mx.toast('NAV inputs saved', (d.ref || 'Run') + ' recalculated from updated inputs.');
                return loadNav();
              })
              .catch(mx.fail);
          },
        },
      ],
    });
  }

  function downloadNavPack() {
    if (!runId()) {
      mx.toast('No NAV run', 'Create or open a valuation run first.', 'warn');
      return;
    }
    return getEnvelope('/api/v1/nav/runs/' + encodeURIComponent(runId()) + '/pack')
      .then(function (body) {
        var pack = body.data || body;
        var blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = ((pack.ref || currentRun.ref || 'nav-pack') + '-pack.json').replace(/\s+/g, '-');
        a.click();
        URL.revokeObjectURL(a.href);
        mx.toast('NAV pack downloaded', a.download);
      })
      .catch(mx.fail);
  }

  function firstOpenException() {
    if (!currentRun || !currentRun.exceptions) return null;
    return currentRun.exceptions.find(function (e) {
      return e.status === 'OPEN' && e.material;
    });
  }

  mx.onLoad('valuation.view', function () {
    if (!document.getElementById('page-valuation')) return Promise.resolve();
    if (liveNav()) {
      clearNavKpis();
      toggleNavDemoPanels(true);
    }
    return loadNav();
  });

  mx.hydrate('valuation', function () {
    if (!liveNav()) return Promise.resolve();
    clearNavKpis();
    toggleNavDemoPanels(true);
    return loadNav();
  });

  window.addEventListener('matanho:legacy-ready', function () {
    if (liveNav()) toggleNavDemoPanels(true);
    mx.gate('#v33RunNav', 'valuation.run');
    mx.gate('#v33NavInputs', 'valuation.run');
    mx.gate('#v33NavPack', 'valuation.view');
    mx.gate('#v33NavExternal', 'valuation.run');
    mx.gate('#v33NavMaker', 'valuation.maker');
    mx.gate('#v33NavChecker', 'valuation.release');
    mx.gate('#v49NavRecalc', 'valuation.run');
    mx.gate('#v49Maker', 'valuation.maker');
    mx.gate('#v49Release', 'valuation.release');

    document.addEventListener(
      'click',
      function (e) {
        if (!liveNav()) return;
        var resolveBtn = e.target.closest && e.target.closest('[data-nav-resolve]');
        if (resolveBtn) {
          e.preventDefault();
          e.stopImmediatePropagation();
          var exId = resolveBtn.dataset.navResolve;
          if (!runId() || !exId) return;
          mx.modal({
            title: 'Resolve valuation exception',
            body:
              '<form id="mxNavResolveForm"><label class="detail-field wide"><span>Resolution rationale</span><textarea id="mxNavResolveText" rows="4" required placeholder="Explain accepted evidence and correcting action."></textarea></label></form>',
            actions: [
              { label: 'Cancel', run: function () {} },
              {
                label: 'Resolve',
                primary: true,
                run: function (m) {
                  var text = ((m.querySelector('#mxNavResolveText') || {}).value || '').trim();
                  if (text.length < 5) {
                    mx.toast('Rationale required', 'Give at least 5 characters.', 'warn');
                    return;
                  }
                  return mx
                    .patch('/api/v1/nav/runs/' + encodeURIComponent(runId()) + '/exceptions/' + encodeURIComponent(exId), {
                      resolution: text,
                    })
                    .then(function () {
                      mx.toast('Exception resolved', 'Material valuation exception marked resolved.');
                      return loadNav();
                    })
                    .catch(mx.fail);
                },
              },
            ],
          });
          return;
        }
        var target = e.target.closest && e.target.closest('#v33RunNav, #v49NavRecalc');
        if (target) {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (runId()) {
            mx.post('/api/v1/nav/runs/' + encodeURIComponent(runId()) + '/recalculate', {})
              .then(function () {
                mx.toast('NAV recalculated', (currentRun.ref || 'Run') + ' refreshed from current inputs.');
                return loadNav();
              })
              .catch(mx.fail);
          } else {
            getEnvelope('/api/v1/portfolios?limit=1').then(function (p) {
              var port = (p.data || p || [])[0];
              if (!port) return mx.toast('No portfolio', 'Create a portfolio before running NAV.', 'warn');
              var today = new Date().toISOString().slice(0, 10);
              return mx
                .post('/api/v1/nav/runs', { portfolioId: port.id, navDate: today })
                .then(function () {
                  mx.toast('NAV run created', 'New valuation run prepared from live positions.');
                  return loadNav();
                })
                .catch(mx.fail);
            });
          }
          return;
        }
        if (e.target.closest && e.target.closest('#v33NavMaker, #v49Maker')) {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (!runId()) return;
          mx.post('/api/v1/nav/runs/' + encodeURIComponent(runId()) + '/maker-review', {})
            .then(function () {
              mx.toast('Maker review submitted', 'Independent checker release is now required.');
              return loadNav();
            })
            .catch(mx.fail);
          return;
        }
        if (e.target.closest && e.target.closest('#v33NavChecker, #v49Release')) {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (!runId()) return;
          mx.post('/api/v1/nav/runs/' + encodeURIComponent(runId()) + '/release', {})
            .then(function () {
              mx.toast('NAV released', 'Official NAV and PBOR publication state updated.');
              return loadNav();
            })
            .catch(mx.fail);
          return;
        }
        if (e.target.closest && e.target.closest('#v49ResolveNav')) {
          e.preventDefault();
          e.stopImmediatePropagation();
          var ex = firstOpenException();
          if (!ex || !runId()) {
            mx.toast('No open exception', 'All material exceptions are already resolved.', 'warn');
            return;
          }
          var btn = document.querySelector('[data-nav-resolve="' + ex.id + '"]');
          if (btn) btn.click();
          else {
            var ghost = document.createElement('button');
            ghost.dataset.navResolve = ex.id;
            ghost.style.display = 'none';
            document.body.appendChild(ghost);
            ghost.click();
            ghost.remove();
          }
        }
      },
      true,
    );

    mx.intercept(
      '#v33NavInputs',
      function () {
        openNavInputsModal();
        return false;
      },
      { when: liveNav },
    );

    mx.intercept(
      '#v33NavPack',
      function () {
        return downloadNavPack();
      },
      { when: liveNav },
    );

    mx.intercept(
      '#v33NavHistory',
      function () {
        getEnvelope('/api/v1/nav/history?limit=10').then(function (body) {
          var rows = body.data || body || [];
          var text = rows.length
            ? rows
                .map(function (r) {
                  return r.ref + ' · ' + mx.date(r.navDate) + ' · ' + (r.status || '');
                })
                .join('\n')
            : 'No prior official NAV runs.';
          mx.modal({ title: 'NAV history', body: '<pre style="white-space:pre-wrap;font-size:11px">' + text + '</pre>' });
        });
        return false;
      },
      { when: liveNav },
    );

    mx.intercept(
      '#v33NavExternal',
      function () {
        if (!runId()) {
          mx.toast('No NAV run', 'Create or open a valuation run first.', 'warn');
          return false;
        }
        var ext = (currentRun && currentRun.external) || {};
        mx.modal({
          eyebrow: 'NAV · EXTERNAL FIGURE',
          title: 'Record external NAV',
          subtitle: (currentRun.ref || '') + ' · ABOR ' + money(currentRun.nav, currentRun.baseCurrency),
          body:
            '<form id="mxNavExternalForm"><label class="detail-field"><span>External NAV</span><input class="detail-input" id="mxNavExtAmount" type="number" step="0.01" min="0" value="' +
            mx.esc(ext.nav || '') +
            '"></label><label class="detail-field"><span>Source</span><input class="detail-input" id="mxNavExtSource" value="' +
            mx.esc(ext.source || 'Administrator') +
            '"></label><label class="detail-field wide"><span>Note</span><textarea id="mxNavExtNote" rows="3">' +
            mx.esc(ext.note || '') +
            '</textarea></label></form>',
          actions: [
            { label: 'Cancel', run: function () {} },
            {
              label: 'Save external NAV',
              primary: true,
              run: function (m) {
                var amt = Number((m.querySelector('#mxNavExtAmount') || {}).value || 0);
                var source = ((m.querySelector('#mxNavExtSource') || {}).value || '').trim();
                if (!(amt > 0) || !source) {
                  mx.toast('Required fields', 'Enter external NAV and source.', 'warn');
                  return;
                }
                return mx
                  .put('/api/v1/nav/runs/' + encodeURIComponent(runId()) + '/external-nav', {
                    externalNav: amt,
                    source: source,
                    note: ((m.querySelector('#mxNavExtNote') || {}).value || '').trim() || undefined,
                  })
                  .then(function () {
                    mx.toast('External NAV recorded', currentRun.ref || 'Run');
                    return loadNav();
                  })
                  .catch(mx.fail);
              },
            },
          ],
        });
        return false;
      },
      { when: liveNav },
    );

    mx.intercept(
      '#v33ValuationPolicy',
      function () {
        getEnvelope('/api/v1/nav/policy').then(function (body) {
          var p = body.data || body || {};
          mx.modal({
            title: 'Valuation policy',
            body:
              '<p>Stale price: ' +
              (p.staleDays != null ? p.staleDays + ' days' : '—') +
              '</p><p>Move tolerance: ' +
              (p.priceMovePct != null ? p.priceMovePct + '%' : '—') +
              '</p><p>Absolute tolerance: ' +
              (p.toleranceAbs != null ? p.toleranceAbs : '—') +
              '</p>',
          });
        });
        return false;
      },
      { when: liveNav },
    );
  });
})();
