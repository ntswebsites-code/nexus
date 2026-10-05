/*
 * Portfolio Construction (portfolio-lab): what-if, save proposal, send to orders.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var labState = { portfolioId: '', modelId: '', drift: '0.5', preview: null, rebalanceId: null };

  function setKpi(index, value, hint) {
    var items = document.querySelectorAll('#page-portfolio-lab .v33-kpis article');
    if (!items[index]) return;
    var strong = items[index].querySelector('strong');
    var small = items[index].querySelector('small');
    if (strong) strong.textContent = value;
    if (hint != null && small) small.textContent = hint;
  }

  function renderPreview(p) {
    if (!p) return;
    labState.preview = p;
    var failing = (p.lines || []).filter(function (l) {
      return l.checkResult === 'Fail';
    }).length;
    var review = (p.lines || []).filter(function (l) {
      return l.checkResult === 'Review';
    }).length;
    setKpi(0, p.turnoverPct ? '+' + Number(p.turnoverPct).toFixed(1) + '% turnover' : '—', p.portfolioName + ' → ' + p.modelName);
    setKpi(1, p.turnoverPct + '%', (p.lines || []).length + ' trade(s)');
    setKpi(2, p.cashAfterPct + '%', mx.money(p.cashAfterBase, p.baseCurrency) + ' cash after');
    setKpi(3, p.constraintsPassed ? 'Within' : 'Breached', p.constraintsPassed ? 'Whole-book checks pass' : 'Fix model or threshold');
    setKpi(4, failing || review ? failing + ' fail · ' + review + ' review' : 'All pass', (p.lines || []).length + ' proposed trades');
    setKpi(5, String(failing), (p.constraints || []).filter(function (c) {
      return c.state === 'Fail';
    }).length + ' mandate fail · ' + (p.warnings || []).length + ' warnings');
  }

  function whatifBody() {
    return {
      portfolioId: labState.portfolioId,
      modelId: labState.modelId,
      driftThresholdPct: labState.drift || '0.5',
      keepUnmodelled: false,
    };
  }

  function pickPortfolioModel(title, onPick) {
    return Promise.all([
      mx.get('/api/v1/portfolios'),
      mx.get('/api/v1/portfolio-lab/models?status=ACTIVE'),
    ]).then(function (res) {
      var portfolios = Array.isArray(res[0]) ? res[0] : res[0].data || [];
      var models = Array.isArray(res[1]) ? res[1] : res[1].data || res[1] || [];
      if (!portfolios.length || !models.length) {
        mx.toast('Portfolio lab', 'Need at least one portfolio and one active model.', 'warn');
        return false;
      }
      return new Promise(function (resolve) {
        mx.modal({
          eyebrow: 'PORTFOLIO CONSTRUCTION',
          title: title,
          body:
            '<form id="mxLabPick"><label class="v34-field"><span>Portfolio</span><select class="v34-select" name="portfolioId" required>' +
            portfolios
              .map(function (p) {
                var sel = p.id === labState.portfolioId ? ' selected' : '';
                return '<option value="' + mx.esc(p.id) + '"' + sel + '>' + mx.esc(p.name) + '</option>';
              })
              .join('') +
            '</select></label><label class="v34-field"><span>Active model</span><select class="v34-select" name="modelId" required>' +
            models
              .map(function (m) {
                var sel = m.id === labState.modelId ? ' selected' : '';
                return '<option value="' + mx.esc(m.id) + '"' + sel + '>' + mx.esc(m.ref) + ' · ' + mx.esc(m.name) + '</option>';
              })
              .join('') +
            '</select></label><label class="v34-field"><span>Drift threshold (pp)</span><input class="v34-input" name="drift" value="' +
            mx.esc(labState.drift) +
            '"></label></form>',
          actions: [
            { label: 'Cancel', run: function () {
              resolve(false);
            } },
            {
              label: 'Continue',
              primary: true,
              run: function (m) {
                var fd = new FormData(m.querySelector('#mxLabPick'));
                labState.portfolioId = fd.get('portfolioId');
                labState.modelId = fd.get('modelId');
                labState.drift = fd.get('drift') || '0.5';
                return Promise.resolve(onPick()).then(function (r) {
                  resolve(r !== false);
                });
              },
            },
          ],
        });
      });
    });
  }

  mx.onLoad('portfolio.view', function () {
    return Promise.all([
      mx.get('/api/v1/portfolio-lab/models?status=ACTIVE').catch(function () {
        return [];
      }),
      mx.get('/api/v1/portfolios').catch(function () {
        return [];
      }),
    ]).then(function (res) {
      mx.data.labModels = res[0];
      mx.data.labPortfolios = res[1];
      if (!labState.portfolioId && mx.data.labPortfolios && mx.data.labPortfolios[0]) labState.portfolioId = mx.data.labPortfolios[0].id;
      if (!labState.modelId && mx.data.labModels && mx.data.labModels[0]) labState.modelId = mx.data.labModels[0].id;
    });
  });

  mx.hydrate('portfolio-lab', function () {
    if (!mx.strict('portfolio-lab')) return Promise.resolve();
    labState.preview = null;
    labState.rebalanceId = null;
    return mx.get('/api/v1/portfolio-lab/models?status=ACTIVE').then(function (models) {
      mx.data.labModels = models;
    });
  });

  window.addEventListener('matanho:legacy-ready', function () {
    mx.intercept(
      '#v33Optimise',
      function () {
        return pickPortfolioModel('Run what-if rebalance', function () {
          return mx.post('/api/v1/portfolio-lab/whatif', whatifBody()).then(function (preview) {
            renderPreview(preview);
            mx.toast('What-if complete', (preview.lines || []).length + ' proposed trade(s)');
            return true;
          });
        });
      },
      {
        when: function () {
          return mx.live && mx.strict('portfolio-lab');
        },
      },
    );

    mx.intercept(
      '#v33ConstructionSave',
      function () {
        if (!labState.preview) {
          return pickPortfolioModel('Save scenario', function () {
            return mx.post('/api/v1/portfolio-lab/whatif', whatifBody()).then(function (preview) {
              renderPreview(preview);
              return mx.post('/api/v1/portfolio-lab/rebalances', whatifBody()).then(function (reb) {
                labState.rebalanceId = reb.id;
                mx.toast('Scenario saved', reb.ref || reb.id);
                return true;
              });
            });
          });
        }
        if (!mx.can('portfolio.manage')) {
          mx.toast('Permission denied', 'Save proposal needs portfolio.manage.', 'error');
          return false;
        }
        return mx.post('/api/v1/portfolio-lab/rebalances', whatifBody()).then(function (reb) {
          labState.rebalanceId = reb.id;
          mx.toast('Scenario saved', reb.ref || reb.id);
        });
      },
      {
        when: function () {
          return mx.live && mx.strict('portfolio-lab');
        },
      },
    );

    document.addEventListener(
      'click',
      function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest('#v33PromoteOrders') : null;
        if (!btn || !mx.live || !mx.strict('portfolio-lab')) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        if (!mx.can('portfolio.manage') || !mx.can('orders.create')) {
          mx.toast('Permission denied', 'Promote needs portfolio.manage and orders.create.', 'error');
          return;
        }
        var run = function (id) {
          return mx.post('/api/v1/portfolio-lab/rebalances/' + encodeURIComponent(id) + '/orders', {}).then(function () {
            mx.toast('Orders staged', 'Draft orders created in Order Management.');
            if (typeof go === 'function') go('orders');
          });
        };
        if (labState.rebalanceId) {
          run(labState.rebalanceId).catch(mx.fail);
          return;
        }
        pickPortfolioModel('Promote to orders', function () {
          return mx
            .post('/api/v1/portfolio-lab/rebalances', whatifBody())
            .then(function (reb) {
              labState.rebalanceId = reb.id;
              return run(reb.id);
            })
            .then(function () {
              return true;
            });
        }).catch(mx.fail);
      },
      true,
    );
  });
})();
