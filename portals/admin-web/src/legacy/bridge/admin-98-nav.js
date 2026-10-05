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

  function firstOpenException() {
    if (!currentRun || !currentRun.exceptions) return null;
    return currentRun.exceptions.find(function (e) {
      return e.status === 'OPEN' && e.material;
    });
  }

  mx.onLoad('valuation.view', function () {
    if (!document.getElementById('page-valuation')) return Promise.resolve();
    return loadNav();
  });

  mx.hydrate('valuation', function () {
    if (!liveNav()) return Promise.resolve();
    return loadNav();
  });

  window.addEventListener('matanho:legacy-ready', function () {
    mx.gate('#v33RunNav', 'valuation.run');
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
