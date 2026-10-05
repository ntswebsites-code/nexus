/*
 * Whole Portfolio list: KPIs, filters, saved views, create, drawer detail.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var filters = { q: '', currency: '', status: '', strategy: '', riskProfile: '', managerId: '' };
  var managerNames = {};
  var facets = { strategies: [], riskProfiles: [], managers: [] };

  function getEnvelope(path) {
    return fetch(mx.api + path, { credentials: 'include', headers: { Accept: 'application/json' } }).then(function (r) {
      return r.json();
    });
  }

  function riskLabel(p) {
    if (p.status && p.status !== 'Active') return p.status;
    if (p.warnings > 0 || (p.stalePrices && p.stalePrices > 0)) return 'Amber';
    return 'Within';
  }

  function toProtoRow(p) {
    return {
      id: p.id,
      ref: p.ref,
      name: p.name,
      type: p.type,
      ccy: p.baseCurrency,
      aum: mx.money(p.marketValueBase, p.baseCurrency),
      cash: (p.cashPct != null ? p.cashPct : '0') + '%',
      ret: '—',
      bm: p.benchmark ? 'vs ' + p.benchmark : '—',
      risk: riskLabel(p),
      manager: (p.managerUserId && managerNames[p.managerUserId]) || '—',
    };
  }

  function renderKpis(kpis, count) {
    var grid = document.querySelector('#page-portfolios .portfolio-summary-grid');
    if (grid && kpis) {
      var articles = grid.querySelectorAll('article');
      if (articles[0]) {
        articles[0].querySelector('strong').textContent =
          (kpis.currency || 'USD') + ' ' + Number(kpis.totalAum || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
        var note = articles[0].querySelector('small');
        if (note) note.textContent = kpis.portfolios + ' portfolio' + (kpis.portfolios === 1 ? '' : 's');
      }
      if (articles[1]) {
        var cashTotal = (mx.data.portfolioRows || []).reduce(function (a, r) {
          return a + Number(r.cashBase || 0);
        }, 0);
        articles[1].querySelector('strong').textContent = (kpis.currency || 'USD') + ' ' + mx.money(cashTotal);
        var cashNote = articles[1].querySelector('small');
        if (cashNote && mx.data.portfolioRows && mx.data.portfolioRows.length && kpis.totalAum) {
          var cashPct = (cashTotal / Number(kpis.totalAum)) * 100;
          cashNote.textContent = cashPct.toFixed(1) + '% of AUM';
        }
      }
      if (articles[2]) {
        articles[2].querySelector('strong').textContent =
          kpis.weightedTwrPct == null ? '—' : fmtPct(kpis.weightedTwrPct);
        var twrNote = articles[2].querySelector('small');
        if (twrNote)
          twrNote.textContent =
            kpis.weightedTwrPct == null
              ? 'No locked performance period'
              : kpis.twrCoverage.portfolios + ' of ' + kpis.twrCoverage.of + ' portfolios';
      }
      if (articles[3]) {
        articles[3].querySelector('strong').textContent = String(kpis.openBreaches || 0);
        var brNote = articles[3].querySelector('small');
        if (brNote) brNote.textContent = (kpis.openBreaches ? 'Open limit breaches' : 'No open breaches');
      }
    }
    var fc = document.querySelector('#page-portfolios .filter-count');
    if (fc) fc.textContent = (count != null ? count : mx.data.portfolioRows ? mx.data.portfolioRows.length : 0) + ' active portfolios';
  }

  function fmtPct(v) {
    var n = Number(v);
    if (isNaN(n)) return '—';
    return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function syncTable() {
    if (typeof portfolios === 'undefined' || !Array.isArray(portfolios)) return;
    mx.replace(
      portfolios,
      (mx.data.portfolioRows || []).map(toProtoRow),
    );
    if (typeof renderPortfolios === 'function') {
      var q = (document.getElementById('portfolioSearch') && document.getElementById('portfolioSearch').value) || '';
      renderPortfolios(q);
    }
  }

  function loadPortfolios() {
    if (!mx.can('portfolio.view')) return Promise.resolve();
    return Promise.all([
      getEnvelope('/api/v1/portfolios/facets'),
      getEnvelope('/api/v1/views?scope=portfolio.list').catch(function () {
        return { data: [] };
      }),
      getEnvelope(
        '/api/v1/portfolios' +
          mx.qs(
            Object.assign({ kpis: '1' }, filters, {
              q: filters.q || (document.getElementById('portfolioSearch') && document.getElementById('portfolioSearch').value) || undefined,
            }),
          ),
      ),
    ]).then(function (res) {
      var f = res[0].data || res[0];
      facets = f;
      managerNames = {};
      (f.managers || []).forEach(function (m) {
        managerNames[m.id] = m.name;
      });
      mx.data.savedViews = res[1].data || res[1] || [];
      var body = res[2];
      mx.data.portfolioRows = body.data || body;
      mx.data.portfolioKpis = body.kpis;
      mx.data.portfolios = (mx.data.portfolioRows || []).map(toProtoRow);
      renderKpis(body.kpis, (body.data || body).length);
      syncTable();
    });
  }

  mx.onLoad('portfolio.view', function () {
    return loadPortfolios();
  });

  mx.hydrate('portfolios', function () {
    if (!mx.strict('portfolios')) return Promise.resolve();
    return loadPortfolios();
  });

  function openPortfolioDrawer(id) {
    return mx.get('/api/v1/portfolios/' + encodeURIComponent(id)).then(function (snap) {
      var p = snap.portfolio || snap;
      var lines = snap.lines || [];
      var holdings = lines
        .slice(0, 8)
        .map(function (l) {
          return (
            '<tr><td><strong>' +
            mx.esc(l.ticker) +
            '</strong><small>' +
            mx.esc(l.name) +
            '</small></td><td>' +
            mx.esc(l.assetClass) +
            '</td><td>' +
            mx.money(l.marketValueBase, p.baseCurrency) +
            '</td><td>—</td><td>—</td><td>—</td></tr>'
          );
        })
        .join('');
      openDrawer({
        eyebrow: 'PORTFOLIO · ' + p.ref,
        title: p.name,
        subtitle: p.type + ' · ' + p.baseCurrency + ' · ' + p.status,
        body:
          '<section class="detail-section"><h3>Summary</h3><div class="detail-grid compact"><div class="detail-field"><span>Market value</span><strong>' +
          mx.money(snap.totals ? snap.totals.totalValueBase : 0, p.baseCurrency) +
          '</strong></div><div class="detail-field"><span>Cash</span><strong>' +
          (snap.totals ? snap.totals.cashPct : p.cashPct) +
          '%</strong></div><div class="detail-field"><span>Positions</span><strong>' +
          (lines.length || p.positionCount || 0) +
          '</strong></div><div class="detail-field"><span>Strategy</span><strong>' +
          mx.esc(p.strategy || '—') +
          '</strong></div></div></section>' +
          (holdings
            ? '<section class="detail-section"><h3>Top positions</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Security</th><th>Class</th><th>Value</th><th></th><th></th><th></th></tr></thead><tbody>' +
              holdings +
              '</tbody></table></div></section>'
            : '') +
          '<div class="form-actions"><button class="btn secondary" onclick="closeDrawer();navigate(\'ibor\')">IBOR</button><button class="btn primary" onclick="closeDrawer();navigate(\'orders\')">New order</button></div>',
      });
    });
  }

  window.addEventListener('matanho:legacy-ready', function () {
    mx.wrapGlobal('openSecondLayer', function (original, args) {
      var kind = args[0];
      var ctx = args[1] || {};
      if (!mx.live || !mx.strict('portfolios') || kind !== 'portfolio') return original.apply(this, args);
      var row =
        typeof portfolios !== 'undefined' && Number.isInteger(ctx.index) ? portfolios[ctx.index] : null;
      if (row && row.id) {
        openPortfolioDrawer(row.id).catch(mx.fail);
        return;
      }
      return original.apply(this, args);
    });

    var search = document.getElementById('portfolioSearch');
    if (search) {
      var timer;
      search.addEventListener('input', function () {
        if (!mx.strict('portfolios')) return;
        clearTimeout(timer);
        timer = setTimeout(function () {
          filters.q = search.value.trim();
          loadPortfolios().catch(mx.fail);
        }, 350);
      });
    }

    mx.intercept(
      '[data-action="create-portfolio"]',
      function () {
        if (!mx.can('portfolio.manage')) {
          mx.toast('Permission denied', 'You need portfolio.manage to create portfolios.', 'error');
          return false;
        }
        return new Promise(function (resolve) {
          mx.modal({
            eyebrow: 'PORTFOLIO',
            title: 'New portfolio',
            subtitle: 'Setup status raises activation tasks in Operations',
            body:
              '<form id="mxNewPf"><div class="v34-form"><label class="v34-field v34-wide"><span>Name *</span><input class="v34-input" name="name" required minlength="2"></label><label class="v34-field"><span>Type</span><input class="v34-input" name="type" value="Balanced Fund"></label><label class="v34-field"><span>Base currency</span><input class="v34-input" name="baseCurrency" value="USD" maxlength="3"></label><label class="v34-field"><span>Strategy</span><input class="v34-input" name="strategy" list="mxPfStrategies"></label><datalist id="mxPfStrategies">' +
              (facets.strategies || [])
                .map(function (s) {
                  return '<option value="' + mx.esc(s) + '">';
                })
                .join('') +
              '</datalist><label class="v34-field"><span>Risk profile</span><select class="v34-select" name="riskProfile"><option value="">Not set</option><option value="LOW">Low</option><option value="MODERATE">Moderate</option><option value="HIGH">High</option></select></label><label class="v34-field"><span>Status</span><select class="v34-select" name="status"><option value="Setup">Setup</option><option value="Active">Active</option></select></label><label class="v34-field"><span>Benchmark</span><input class="v34-input" name="benchmark"></label></div></form>',
            actions: [
              {
                label: 'Cancel',
                run: function () {
                  resolve(false);
                },
              },
              {
                label: 'Create portfolio',
                primary: true,
                run: function (m) {
                  var fd = new FormData(m.querySelector('#mxNewPf'));
                  var body = {
                    name: fd.get('name'),
                    type: fd.get('type') || 'Balanced Fund',
                    baseCurrency: String(fd.get('baseCurrency') || 'USD').toUpperCase(),
                    strategy: fd.get('strategy') || undefined,
                    riskProfile: fd.get('riskProfile') || undefined,
                    status: fd.get('status') || 'Setup',
                    benchmark: fd.get('benchmark') || undefined,
                  };
                  return mx.post('/api/v1/portfolios', body).then(function (snap) {
                    mx.toast('Portfolio created', (snap.portfolio && snap.portfolio.ref) || 'Saved');
                    return loadPortfolios().then(function () {
                      resolve(true);
                    });
                  });
                },
              },
            ],
          });
        });
      },
      {
        when: function () {
          return mx.live && mx.strict('portfolios');
        },
      },
    );

    mx.intercept(
      '[data-action="save-view"]',
      function () {
        var active = Object.keys(filters).some(function (k) {
          return filters[k];
        });
        if (!active) {
          mx.toast('Save view', 'Apply a filter first.', 'warn');
          return false;
        }
        return new Promise(function (resolve) {
          mx.modal({
            eyebrow: 'PORTFOLIO',
            title: 'Save view',
            body:
              '<form id="mxSaveView"><label class="v34-field"><span>View name</span><input class="v34-input" name="name" required maxlength="80"></label><label style="display:flex;gap:8px;margin-top:8px"><input type="checkbox" name="isDefault"> Open with this view</label></form>',
            actions: [
              { label: 'Cancel', run: function () {
                resolve(false);
              } },
              {
                label: 'Save view',
                primary: true,
                run: function (m) {
                  var fd = new FormData(m.querySelector('#mxSaveView'));
                  return mx
                    .put('/api/v1/views', {
                      scope: 'portfolio.list',
                      name: fd.get('name'),
                      isDefault: fd.get('isDefault') === 'on',
                      config: Object.fromEntries(
                        Object.entries(filters).filter(function (e) {
                          return e[1];
                        }),
                      ),
                    })
                    .then(function () {
                      mx.toast('View saved', String(fd.get('name')));
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
          return mx.live && mx.strict('portfolios');
        },
      },
    );

    mx.intercept(
      '[data-action="open-portfolio-filters"]',
      function () {
        return new Promise(function (resolve) {
          mx.modal({
            eyebrow: 'PORTFOLIO',
            title: 'Portfolio filters',
            wide: true,
            body:
              '<form id="mxPfFilters" class="v34-form"><label class="v34-field"><span>Currency</span><select class="v34-select" name="currency"><option value="">All</option><option value="USD">USD</option><option value="ZWG">ZWG</option><option value="ZAR">ZAR</option></select></label><label class="v34-field"><span>Status</span><select class="v34-select" name="status"><option value="">All</option><option>Setup</option><option>Active</option><option>Suspended</option><option>Closed</option></select></label><label class="v34-field"><span>Strategy</span><select class="v34-select" name="strategy"><option value="">All</option>' +
              (facets.strategies || [])
                .map(function (s) {
                  return '<option>' + mx.esc(s) + '</option>';
                })
                .join('') +
              '</select></label><label class="v34-field"><span>Risk profile</span><select class="v34-select" name="riskProfile"><option value="">All</option><option value="LOW">Low</option><option value="MODERATE">Moderate</option><option value="HIGH">High</option></select></label><label class="v34-field"><span>Manager</span><select class="v34-select" name="managerId"><option value="">All</option>' +
              (facets.managers || [])
                .map(function (m) {
                  return '<option value="' + mx.esc(m.id) + '">' + mx.esc(m.name) + '</option>';
                })
                .join('') +
              '</select></label></form>',
            actions: [
              {
                label: 'Clear',
                run: function () {
                  filters = { q: '', currency: '', status: '', strategy: '', riskProfile: '', managerId: '' };
                  return loadPortfolios().then(function () {
                    resolve(true);
                  });
                },
              },
              {
                label: 'Apply',
                primary: true,
                run: function (m) {
                  var fd = new FormData(m.querySelector('#mxPfFilters'));
                  filters = {
                    q: filters.q,
                    currency: fd.get('currency') || '',
                    status: fd.get('status') || '',
                    strategy: fd.get('strategy') || '',
                    riskProfile: fd.get('riskProfile') || '',
                    managerId: fd.get('managerId') || '',
                  };
                  return loadPortfolios().then(function () {
                    resolve(true);
                  });
                },
              },
            ],
          });
          var form = document.getElementById('mxPfFilters');
          if (form) {
            ['currency', 'status', 'strategy', 'riskProfile', 'managerId'].forEach(function (k) {
              var el = form.querySelector('[name="' + k + '"]');
              if (el && filters[k]) el.value = filters[k];
            });
          }
        });
      },
      {
        when: function () {
          return mx.live && mx.strict('portfolios');
        },
      },
    );
  });
})();
