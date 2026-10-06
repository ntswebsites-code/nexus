/*
 * Portfolio Construction (portfolio-lab): what-if, save proposal, send to orders.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var labState = { portfolioId: '', modelId: '', drift: '0.5', preview: null, rebalanceId: null };

  function liveLab() {
    return mx.live && mx.strict('portfolio-lab');
  }

  function patchLabConstructionLive() {
    if (!liveLab() || typeof renderConstruction !== 'function' || renderConstruction.__mxLabPatched) return;
    var base = renderConstruction;
    window.renderConstruction = function () {
      if (!liveLab()) return base.apply(this, arguments);
      var host = document.getElementById('v33ConstructionView');
      if (!host) return base.apply(this, arguments);
      if (typeof buildTab !== 'undefined' && buildTab === 'targets' && !labState.preview) {
        document.querySelectorAll('[data-v33-build-tab]').forEach(function (b) {
          b.classList.toggle('active', b.dataset.v33BuildTab === buildTab);
        });
        host.innerHTML =
          '<article class="v33-card"><div class="v33-card-body"><p class="ops-muted">Live construction uses portfolio-lab what-if output — not demo slider weights. Choose portfolio and model, then <strong>Run optimiser</strong> to populate targets and KPIs.</p></div></article>';
        return;
      }
      return base.apply(this, arguments);
    };
    window.renderConstruction.__mxLabPatched = true;
  }

  function clearLabKpis() {
    document.querySelectorAll('#page-portfolio-lab .v33-kpis article').forEach(function (k) {
      var s = k.querySelector('strong');
      var n = k.querySelector('small');
      if (s) s.textContent = '—';
      if (n) n.textContent = 'Run optimiser';
    });
  }

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
    if (document.getElementById('page-portfolio-lab') && liveLab()) clearLabKpis();
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

  function openCreateModelModal() {
    if (!mx.can('portfolio.manage')) {
      mx.toast('Permission denied', 'Model create needs portfolio.manage.', 'error');
      return;
    }
    mx.modal({
      eyebrow: 'PORTFOLIO LAB',
      title: 'New construction model',
      body:
        '<form id="mxLabModel"><label class="v34-field"><span>Name</span><input class="v34-input" name="name" required minlength="2"></label><label class="v34-field"><span>Description</span><textarea class="v34-input" name="description" rows="3"></textarea></label><label class="v34-field"><span>Cash target %</span><input class="v34-input" name="cashTargetPct" type="number" step="0.1" value="0"></label></form>',
      actions: [
        { label: 'Cancel', run: function () {} },
        {
          label: 'Create draft',
          primary: true,
          run: function (m) {
            var fd = new FormData(m.querySelector('#mxLabModel'));
            return mx
              .post('/api/v1/portfolio-lab/models', {
                name: fd.get('name'),
                description: fd.get('description') || undefined,
                cashTargetPct: Number(fd.get('cashTargetPct') || 0),
                weights: [],
              })
              .then(function (model) {
                var row = model.data || model;
                mx.toast('Model created', (row.ref || row.id) + ' saved as DRAFT');
                if (row.id) labState.modelId = row.id;
                return mx.get('/api/v1/portfolio-lab/models?status=ACTIVE').then(function (models) {
                  mx.data.labModels = models;
                });
              });
          },
        },
      ],
    });
  }

  function runModelAction(model, action) {
    var base = '/api/v1/portfolio-lab/models/' + encodeURIComponent(model.id);
    if (action === 'activate') {
      return mx.post(base + '/activate', {}).then(function () {
        mx.toast('Model activated', model.ref || model.name);
      });
    }
    if (action === 'retire') {
      return new Promise(function (resolve) {
        mx.reasonModal({
          eyebrow: 'PORTFOLIO LAB',
          title: 'Retire model',
          subtitle: model.ref || model.name,
          label: 'Retirement reason',
          minLength: 3,
          confirmLabel: 'Retire',
          onConfirm: function (reason) {
            return mx.post(base + '/retire', { reason: reason }).then(function () {
              mx.toast('Model retired', model.ref || model.name);
              resolve();
            });
          },
        });
      });
    }
    if (action === 'clone') {
      return mx.post(base + '/clone', {}).then(function (copy) {
        var row = copy.data || copy;
        mx.toast('Model cloned', (row.ref || row.id) + ' created as DRAFT');
      });
    }
    if (action === 'delete') {
      if (!window.confirm('Delete draft model ' + (model.ref || model.name) + '?')) return Promise.resolve();
      return mx.del(base).then(function () {
        mx.toast('Model deleted', model.ref || model.name);
      });
    }
    return Promise.resolve();
  }

  function openModelsModal() {
    mx.get('/api/v1/portfolio-lab/models?limit=50')
      .then(function (body) {
        var rows = Array.isArray(body) ? body : body.data || [];
        mx.modal({
          eyebrow: 'PORTFOLIO LAB',
          title: 'Construction models',
          subtitle: rows.length + ' model(s)',
          wide: true,
          body:
            '<div class="v34-list">' +
            (rows.length
              ? rows
                  .map(function (m) {
                    var acts = [];
                    if (mx.can('portfolio.manage') && m.status === 'DRAFT') {
                      acts.push('<button type="button" class="v34-btn small" data-mx-lab-model-act="activate" data-mx-lab-model-id="' + mx.esc(m.id) + '">Activate</button>');
                      acts.push('<button type="button" class="v34-btn small" data-mx-lab-model-act="delete" data-mx-lab-model-id="' + mx.esc(m.id) + '">Delete</button>');
                    }
                    if (mx.can('portfolio.manage') && m.status === 'ACTIVE') {
                      acts.push('<button type="button" class="v34-btn small" data-mx-lab-model-act="retire" data-mx-lab-model-id="' + mx.esc(m.id) + '">Retire</button>');
                    }
                    if (mx.can('portfolio.manage')) {
                      acts.push('<button type="button" class="v34-btn small" data-mx-lab-model-act="clone" data-mx-lab-model-id="' + mx.esc(m.id) + '">Clone</button>');
                    }
                    return (
                      '<div class="v34-row"><span><strong>' +
                      mx.esc(m.ref || m.name) +
                      '</strong><small>' +
                      mx.esc(m.name) +
                      ' · ' +
                      mx.esc(m.status) +
                      ' · ' +
                      (m.holdings != null ? m.holdings + ' holdings' : '—') +
                      '</small></span><em>' +
                      acts.join(' ') +
                      '</em></div>'
                    );
                  })
                  .join('')
              : '<p class="ops-muted">No models yet.</p>') +
            (mx.can('portfolio.manage') ? '<div class="form-actions" style="margin-top:12px"><button type="button" class="btn primary" id="mxLabNewModel">New model</button></div>' : ''),
          actions: [{ label: 'Close', run: function () {} }],
        });
        var nm = document.getElementById('mxLabNewModel');
        if (nm) nm.onclick = openCreateModelModal;
        document.querySelectorAll('[data-mx-lab-model-act]').forEach(function (btn) {
          btn.onclick = function () {
            var id = btn.getAttribute('data-mx-lab-model-id');
            var model = rows.find(function (x) {
              return x.id === id;
            });
            if (!model) return;
            runModelAction(model, btn.getAttribute('data-mx-lab-model-act')).then(function () {
              return openModelsModal();
            }, mx.fail);
          };
        });
      })
      .catch(mx.fail);
  }

  mx.hydrate('portfolio-lab', function () {
    if (!liveLab()) return Promise.resolve();
    clearLabKpis();
    labState.preview = null;
    labState.rebalanceId = null;
    patchLabConstructionLive();
    if (typeof renderConstruction === 'function') renderConstruction();
    return mx.get('/api/v1/portfolio-lab/models?status=ACTIVE').then(function (models) {
      mx.data.labModels = models;
    });
  });

  window.addEventListener('matanho:legacy-ready', function () {
    if (liveLab()) patchLabConstructionLive();
    mx.gate('#v33LabModels', 'portfolio.view');
    document.getElementById('v33LabModels')?.addEventListener('click', function () {
      if (!liveLab()) return;
      openModelsModal();
    });
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
        when: liveLab,
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
        when: liveLab,
      },
    );

    document.addEventListener(
      'click',
      function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest('#v33PromoteOrders') : null;
        if (!btn || !liveLab()) return;
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
