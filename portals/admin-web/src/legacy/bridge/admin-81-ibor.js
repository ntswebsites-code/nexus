/*
 * IBOR & Positions: overview KPIs, ledger, refresh job, reconcile, column prefs.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var iborFilters = { q: '', assetClass: '', state: '', portfolioId: '', asOf: '' };
  var refreshJob = null;
  var refreshTimer = null;
  var COLUMN_GROUPS = ['position', 'settlement', 'valuation', 'cost', 'availability', 'control'];
  var columnGroups = COLUMN_GROUPS.slice();

  function getEnvelope(path) {
    return fetch(mx.api + path, { credentials: 'include', headers: { Accept: 'application/json' } }).then(function (r) {
      return r.json();
    });
  }

  function qty(v) {
    if (v == null || v === '') return '—';
    var n = Number(v);
    if (isNaN(n)) return String(v);
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  function signed(v) {
    if (v == null || v === '') return '—';
    var n = Number(v);
    if (isNaN(n)) return String(v);
    return (n > 0 ? '+' : '') + qty(n);
  }

  function toProtoPosition(r) {
    return {
      id: r.portfolioId + '-' + r.securityId,
      portfolioId: r.portfolioId,
      securityId: r.securityId,
      ticker: r.ticker,
      name: r.name,
      portfolio: r.portfolioName,
      asset: r.assetClass,
      qty: qty(r.quantity),
      settled: qty(r.settled),
      unsettled: signed(r.unsettled),
      local: r.marketValueLocal ? mx.money(r.marketValueLocal, r.currency) : '—',
      base: r.marketValueBase ? mx.money(r.marketValueBase, r.baseCurrency) : '—',
      cost: r.costBase ? mx.money(r.costBase, r.baseCurrency) : '—',
      accrued: r.accrued ? mx.money(r.accrued, r.baseCurrency) : '—',
      available: r.restricted ? 'Restricted' : qty(r.available),
      state: r.state || 'Current',
    };
  }

  function renderOverview(o) {
    if (!o) return;
    var bar = document.querySelector('#page-ibor .platform-control-bar');
    if (bar) {
      var cells = bar.querySelectorAll('div');
      if (cells[0]) cells[0].querySelector('strong').textContent = mx.date(o.asOf);
      if (cells[1]) {
        var st = cells[1].querySelector('strong');
        st.textContent = o.control.bookState;
        st.className = o.control.bookState === 'Current' ? 'positive-text' : 'attention';
      }
      if (cells[2] && o.control.lastEvent)
        cells[2].querySelector('strong').textContent =
          (o.control.lastEvent.type || 'Event') + ' · ' + o.control.lastEvent.ref;
      if (cells[3] && o.control.lastRefresh)
        cells[3].querySelector('strong').textContent = (o.control.lastRefresh.durationMs || '—') + ' ms';
    }
    var stats = document.querySelector('#page-ibor .ibor-stat-line');
    if (stats && o.kpis) {
      var items = stats.querySelectorAll('div');
      var k = o.kpis;
      var ccy = k.currency || 'USD';
      if (items[0]) items[0].querySelector('strong').textContent = ccy + ' ' + mx.money(k.marketValueBase);
      if (items[1]) {
        items[1].querySelector('strong').textContent = String(k.positions);
        var sn = items[1].querySelector('small');
        if (sn) sn.textContent = k.portfolios + ' portfolio' + (k.portfolios === 1 ? '' : 's');
      }
      if (items[2]) items[2].querySelector('strong').textContent = ccy + ' ' + mx.money(k.availableCash);
      if (items[3]) {
        items[3].querySelector('strong').textContent = ccy + ' ' + mx.money(k.unsettledBuys);
        var ub = items[3].querySelector('small');
        if (ub) ub.textContent = k.unsettledBuyCount + ' live instruction' + (k.unsettledBuyCount === 1 ? '' : 's');
      }
      if (items[4]) items[4].querySelector('strong').textContent = ccy + ' ' + mx.money(k.accruedIncome);
      if (items[5]) {
        items[5].querySelector('strong').textContent = String(k.exceptions);
        items[5].querySelector('strong').className = k.exceptions ? 'attention' : '';
      }
    }
    if (o.health && o.health.items) {
      var checklist = document.querySelector('#page-ibor .control-checklist');
      if (checklist) {
        checklist.innerHTML = o.health.items
          .map(function (h) {
            return (
              '<div class="' +
              (h.ok ? 'done' : 'warning') +
              '"><span>' +
              (h.ok ? '✓' : '!') +
              '</span><p><strong>' +
              mx.esc(h.title) +
              '</strong><small>' +
              mx.esc(h.detail) +
              '</small></p></div>'
            );
          })
          .join('');
      }
    }
  }

  function renderLadder(lad) {
    if (!lad || !lad.buckets) return;
    var ladder = document.querySelector('#page-ibor .settlement-ladder');
    if (!ladder) return;
    var labels = { TODAY: 'Today', T1: 'T+1', T2: 'T+2', T3: 'T+3', T4: 'T+4' };
    ladder.innerHTML = lad.buckets
      .slice(0, 4)
      .map(function (b) {
        var net = b.flows && b.flows[0];
        var amt = net ? net.currency + ' ' + signed(net.netCash) : '—';
        return (
          '<div><span>' +
          (labels[b.bucket] || b.bucket) +
          '</span><strong>' +
          amt +
          '</strong><small>' +
          (b.flows.length ? b.flows.map(function (f) {
            return f.buys + ' buy / ' + f.sells + ' sell';
          }).join('; ') : 'Nothing settling') +
          '</small><i class="positive"></i></div>'
        );
      })
      .join('');
  }

  function syncIborTable() {
    if (typeof institutionalPositions === 'undefined') return;
    mx.replace(
      institutionalPositions,
      mx.data.institutionalPositions || [],
    );
    if (typeof renderIbor === 'function') renderIbor();
  }

  function loadIbor() {
    if (!mx.can('portfolio.view')) return Promise.resolve();
    var qs = mx.qs({
      portfolioId: iborFilters.portfolioId || undefined,
      asOf: iborFilters.asOf || undefined,
      q: iborFilters.q || undefined,
      assetClass: iborFilters.assetClass && iborFilters.assetClass !== 'all' ? iborFilters.assetClass : undefined,
      state: iborFilters.state && iborFilters.state !== 'all' ? iborFilters.state : undefined,
      limit: '200',
    });
    return Promise.all([
      getEnvelope('/api/v1/ibor/overview' + mx.qs({ portfolioId: iborFilters.portfolioId || undefined, asOf: iborFilters.asOf || undefined })),
      getEnvelope('/api/v1/ibor/ledger' + qs),
      getEnvelope('/api/v1/ibor/settlement-ladder' + mx.qs({ portfolioId: iborFilters.portfolioId || undefined })),
      getEnvelope('/api/v1/views?scope=ibor.columns').catch(function () {
        return { data: [] };
      }),
    ]).then(function (res) {
      var overview = res[0].data || res[0];
      var ledger = res[1];
      var ladder = res[2].data || res[2];
      var views = res[3].data || res[3] || [];
      var g = views[0] && views[0].config && views[0].config.groups;
      if (g && g.length) columnGroups = g.filter(function (x) {
        return COLUMN_GROUPS.indexOf(x) >= 0;
      });
      mx.data.iborOverview = overview;
      mx.data.institutionalPositions = (ledger.data || []).map(toProtoPosition);
      renderOverview(overview);
      renderLadder(ladder);
      syncIborTable();
    });
  }

  function pollRefreshJob() {
    if (!refreshJob || !refreshJob.id) return;
    if (refreshJob.status !== 'QUEUED' && refreshJob.status !== 'RUNNING') return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      mx.get('/api/v1/ibor/refresh-jobs/' + encodeURIComponent(refreshJob.id))
        .then(function (job) {
          refreshJob = job;
          if (job.status === 'SUCCEEDED') {
            mx.toast('IBOR refreshed', (job.result && job.result.ref) || 'Refresh complete');
            return loadIbor();
          }
          if (job.status === 'FAILED') {
            mx.toast('Refresh failed', job.error || 'Job failed', 'error');
            return;
          }
          pollRefreshJob();
        })
        .catch(mx.fail);
    }, 1500);
  }

  mx.onLoad('portfolio.view', function () {
    return getEnvelope('/api/v1/views?scope=ibor.columns')
      .then(function (views) {
        var g = (views.data && views.data[0] && views.data[0].config && views.data[0].config.groups) || null;
        if (g && g.length) columnGroups = g;
      })
      .catch(function () {
        return undefined;
      });
  });

  mx.hydrate('ibor', function () {
    if (!mx.strict('ibor')) return Promise.resolve();
    return loadIbor();
  });

  window.addEventListener('matanho:legacy-ready', function () {
    ['iborSearch', 'iborAssetFilter', 'iborStateFilter'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var timer;
      el.addEventListener(id === 'iborSearch' ? 'input' : 'change', function () {
        if (!mx.strict('ibor')) return;
        clearTimeout(timer);
        timer = setTimeout(function () {
          iborFilters.q = (document.getElementById('iborSearch') && document.getElementById('iborSearch').value.trim()) || '';
          iborFilters.assetClass = (document.getElementById('iborAssetFilter') && document.getElementById('iborAssetFilter').value) || 'all';
          iborFilters.state = (document.getElementById('iborStateFilter') && document.getElementById('iborStateFilter').value) || 'all';
          loadIbor().catch(mx.fail);
        }, 300);
      });
    });

    mx.intercept(
      '[data-action="refresh-ibor"]',
      function () {
        if (!mx.can('portfolio.manage')) {
          mx.toast('Permission denied', 'Refresh IBOR needs portfolio.manage.', 'error');
          return false;
        }
        return mx.post('/api/v1/ibor/refresh', { async: true, portfolioId: iborFilters.portfolioId || undefined }).then(function (job) {
          refreshJob = job;
          mx.toast('Refresh queued', (job.ref || job.id) + ' · ' + job.status);
          pollRefreshJob();
        });
      },
      {
        when: function () {
          return mx.live && mx.strict('ibor');
        },
      },
    );

    mx.intercept(
      '[data-action="reconcile-positions"]',
      function () {
        if (!mx.can('recon.manage')) {
          mx.toast('Permission denied', 'Reconcile positions needs recon.manage.', 'error');
          return false;
        }
        return mx.get('/api/v1/portfolios').then(function (rows) {
          var list = Array.isArray(rows) ? rows : rows.data || [];
          if (!list.length) {
            mx.toast('Reconcile', 'No portfolios available.', 'warn');
            return false;
          }
          return new Promise(function (resolve) {
            mx.modal({
              eyebrow: 'IBOR',
              title: 'Reconcile positions',
              subtitle: 'Runs holdings reconciliation for the selected portfolio',
              body:
                '<form id="mxReconPf"><label class="v34-field"><span>Portfolio</span><select class="v34-select" name="portfolioId" required>' +
                list
                  .map(function (p) {
                    return '<option value="' + mx.esc(p.id) + '">' + mx.esc(p.name) + ' (' + mx.esc(p.ref) + ')</option>';
                  })
                  .join('') +
                '</select></label></form>',
              actions: [
                { label: 'Cancel', run: function () {
                  resolve(false);
                } },
                {
                  label: 'Reconcile',
                  primary: true,
                  run: function (m) {
                    var pid = m.querySelector('[name=portfolioId]').value;
                    return mx.post('/api/v1/ibor/reconcile', { portfolioId: pid }).then(function (r) {
                      var run = r.run || r;
                      mx.toast(
                        'Reconciliation ' + (run.ref || ''),
                        (run.breaks || 0) + ' break(s) · ' + (run.status || ''),
                        run.breaks ? 'warn' : 'success',
                      );
                      return loadIbor().then(function () {
                        resolve(true);
                      });
                    });
                  },
                },
              ],
            });
          });
        });
      },
      {
        when: function () {
          return mx.live && mx.strict('ibor');
        },
      },
    );

    mx.intercept(
      '[data-action="ibor-columns"]',
      function () {
        return new Promise(function (resolve) {
          mx.modal({
            eyebrow: 'IBOR',
            title: 'Position columns',
            subtitle: 'Saved to your profile (scope ibor.columns)',
            body:
              '<div style="display:flex;flex-wrap:wrap;gap:12px">' +
              COLUMN_GROUPS.map(function (g) {
                return (
                  '<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-mx-col="' +
                  g +
                  '" ' +
                  (columnGroups.indexOf(g) >= 0 ? 'checked' : '') +
                  '> ' +
                  g +
                  '</label>'
                );
              }).join('') +
              '</div>',
            actions: [
              { label: 'Close', run: function () {
                resolve(false);
              } },
              {
                label: 'Save',
                primary: true,
                run: function (m) {
                  var next = [];
                  m.querySelectorAll('[data-mx-col]').forEach(function (cb) {
                    if (cb.checked) next.push(cb.getAttribute('data-mx-col'));
                  });
                  if (!next.length) {
                    mx.toast('Columns', 'Keep at least one group visible.', 'warn');
                    return false;
                  }
                  columnGroups = next;
                  return mx
                    .put('/api/v1/views', { scope: 'ibor.columns', name: 'default', isDefault: true, config: { groups: next } })
                    .then(function () {
                      mx.toast('Columns saved', next.length + ' group(s)');
                      resolve(true);
                    });
                },
              },
            ],
          });
        });
      },
      {
        when: function () {
          return mx.live && mx.strict('ibor');
        },
      },
    );

    mx.intercept(
      '[data-action="ibor-snapshot"]',
      function () {
        return new Promise(function (resolve) {
          mx.modal({
            eyebrow: 'IBOR',
            title: 'Historical snapshot',
            body:
              '<form id="mxIborAsOf"><label class="v34-field"><span>As-of date</span><input class="v34-input" type="date" name="asOf" max="' +
              new Date().toISOString().slice(0, 10) +
              '"></label></form>',
            actions: [
              { label: 'Cancel', run: function () {
                resolve(false);
              } },
              {
                label: 'Load snapshot',
                primary: true,
                run: function (m) {
                  iborFilters.asOf = m.querySelector('[name=asOf]').value || '';
                  return loadIbor().then(function () {
                    mx.toast('Snapshot loaded', iborFilters.asOf || 'current');
                    resolve(true);
                  });
                },
              },
            ],
          });
        });
      },
      {
        when: function () {
          return mx.live && mx.strict('ibor');
        },
      },
    );

    mx.wrapGlobal('openSecondLayer', function (original, args) {
      var kind = args[0];
      var ctx = args[1] || {};
      if (!mx.live || !mx.strict('ibor') || kind !== 'position') return original.apply(this, args);
      var p = (mx.data.institutionalPositions || []).find(function (x) {
        return x.id === ctx.id;
      });
      if (p && typeof openPosition360 === 'function') {
        openPosition360(p.id);
        return;
      }
      return original.apply(this, args);
    });
  });
})();
