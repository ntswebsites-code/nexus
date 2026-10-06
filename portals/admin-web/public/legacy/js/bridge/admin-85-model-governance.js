/*
 * Model governance: registry, versions, validation, approval, usage summary.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var V1 = '/api/v1/model-governance';
  var models = [];
  var modelByRef = {};
  var mgSummary = null;

  function liveModels() {
    return mx.live && mx.strict('model-governance');
  }

  function clearModelKpis() {
    document.querySelectorAll('#page-model-governance .v33-kpis .v33-kpi strong, #page-model-governance .v37-model-kpi strong').forEach(function (el) {
      el.textContent = '—';
    });
    document.querySelectorAll('#page-model-governance .v33-kpis .v33-kpi small, #page-model-governance .v37-model-kpi small').forEach(function (el) {
      el.textContent = 'Loading…';
    });
  }

  function statusProto(s) {
    if (s === 'APPROVED') return 'Production';
    if (s === 'PENDING_VALIDATION' || s === 'PENDING_APPROVAL') return 'Validation';
    if (s === 'RETIRED') return 'Retired';
    if (s === 'REJECTED') return 'Review';
    return s || 'Draft';
  }

  function typeProto(t) {
    return (
      {
        PRICING: 'Valuation',
        RISK: 'Risk',
        CREDIT: 'Credit',
        SCORING: 'Scoring',
        FORECAST: 'Forecast',
        OTHER: 'AI / ML',
      }[t] || t || 'Risk'
    );
  }

  function mapModelV33(m) {
    return [
      m.ref || m.id,
      m.name,
      m.purpose || typeProto(m.modelType),
      m.currentVersion ? 'v' + m.currentVersion : '—',
      m.ownerName || '—',
      m.nextReviewOn ? mx.date(m.nextReviewOn) : '—',
      statusProto(m.status),
    ];
  }

  function mapModelV37(m) {
    return {
      apiId: m.id,
      id: m.ref || m.id,
      name: m.name,
      purpose: m.purpose || typeProto(m.modelType),
      version: m.currentVersion || (m.inFlightVersion && m.inFlightVersion.version) || '0.1',
      owner: m.ownerName || '—',
      validation: m.nextReviewOn ? mx.date(m.nextReviewOn) : '—',
      state: statusProto(m.status),
      dataset: 'Governed dataset',
      method: typeProto(m.modelType),
      tests: m.status === 'APPROVED',
      validator: 'Independent Model Risk',
      monitor: 'Monthly drift + performance threshold',
      inFlightId: m.inFlightVersion && m.inFlightVersion.id,
      inFlightStatus: m.inFlightVersion && m.inFlightVersion.status,
    };
  }

  function patchV33Kpis() {
    var kpis = document.querySelectorAll('#page-model-governance .v33-kpis .v33-kpi');
    if (!kpis.length || !mgSummary) return;
    if (kpis[0]) {
      kpis[0].querySelector('strong').textContent = String(models.length);
      kpis[0].querySelector('small').textContent = ((mgSummary.byStatus && mgSummary.byStatus.APPROVED) || 0) + ' production';
    }
    if (kpis[1]) kpis[1].querySelector('strong').textContent = String(mgSummary.awaitingValidation || 0);
    if (kpis[2]) kpis[2].querySelector('strong').textContent = String((mgSummary.awaitingValidation || 0) + (mgSummary.awaitingApproval || 0));
    if (kpis[3]) kpis[3].querySelector('strong').textContent = String(mgSummary.reviewsOverdue || 0);
    if (kpis[4]) kpis[4].querySelector('strong').textContent = String(mgSummary.usesLast30Days || 0);
    if (kpis[5]) kpis[5].querySelector('strong').textContent = '0';
  }

  function patchV37Kpis() {
    var kpis = document.querySelectorAll('#page-model-governance .v37-model-kpi');
    if (!kpis.length || !mgSummary) return;
    if (kpis[0]) {
      kpis[0].querySelector('strong').textContent = String(models.length);
      kpis[0].querySelector('small').textContent = ((mgSummary.byStatus && mgSummary.byStatus.APPROVED) || 0) + ' production';
    }
    if (kpis[1]) kpis[1].querySelector('strong').textContent = String(mgSummary.awaitingValidation || 0);
    if (kpis[2]) kpis[2].querySelector('strong').textContent = String(mgSummary.reviewsOverdue || 0);
    if (kpis[4]) kpis[4].querySelector('strong').textContent = String(mgSummary.usesLast30Days || 0);
  }

  function applyModels(rows) {
    window.__mxData = window.__mxData || {};
    if (!window.__mxData._models33) window.__mxData._models33 = [];
    if (!window.__mxData._models37) window.__mxData._models37 = [];
    mx.replace(window.__mxData._models33, rows.map(mapModelV33));
    mx.replace(window.__mxData._models37, rows.map(mapModelV37));
    modelByRef = {};
    rows.forEach(function (m) {
      modelByRef[m.ref || m.id] = m;
    });
    if (typeof modelSelected37 !== 'undefined' && !modelByRef[modelSelected37]) {
      modelSelected37 = window.__mxData._models37[0] && window.__mxData._models37[0].id;
    }
    if (typeof renderModels === 'function' && document.getElementById('v33ModelRows')) renderModels();
    if (document.querySelector('#page-model-governance.v37-model')) refreshV37Registry();
    patchV33Kpis();
    patchV37Kpis();
  }

  function refreshV37Registry() {
    var host = document.getElementById('v37ModelRows');
    if (!host || typeof modelRows37 !== 'function') return;
    host.innerHTML = modelRows37(document.getElementById('v37ModelSearch')?.value || '');
    if (typeof bindModelRows37 === 'function') bindModelRows37();
  }

  function loadModels() {
    if (!mx.can('risk.view')) return Promise.resolve();
    return Promise.all([mx.get(V1 + '/models?limit=100'), mx.get(V1 + '/summary')])
      .then(function (r) {
        var body = r[0].data || r[0];
        models = body.data || body || [];
        mgSummary = r[1].data || r[1];
        applyModels(models);
        mx.data.modelSummary = mgSummary;
      })
      .catch(mx.fail);
  }

  function registerModel() {
    return new Promise(function (resolve) {
      mx.modal({
        eyebrow: 'MODEL GOVERNANCE',
        title: 'Register model',
        subtitle: 'Creates a draft model record for validation',
        body:
          '<form id="mxMgRegister"><label class="v34-field"><span>Name</span><input class="v34-input" name="name" required minlength="2" maxlength="200"></label>' +
          '<label class="v34-field"><span>Purpose and permitted use</span><textarea class="v34-input" name="purpose" rows="3" required>Decision support for portfolio risk analytics.</textarea></label>' +
          '<label class="v34-field"><span>Human owner</span><input class="v34-input" name="ownerName" required value="Risk Analytics"></label>' +
          '<label class="v34-field"><span>Model type</span><select class="v34-select" name="modelType"><option value="RISK">Risk</option><option value="VALUATION">Valuation</option><option value="PERFORMANCE">Performance</option><option value="OTHER">Other</option></select></label>' +
          '<label class="v34-field"><span>Tier</span><select class="v34-select" name="tier"><option value="1">1 — material</option><option value="2" selected>2 — standard</option><option value="3">3 — low</option></select></label></form>',
        actions: [
          { label: 'Cancel', run: function () { resolve(false); } },
          {
            label: 'Register',
            primary: true,
            run: function (m) {
              var fd = new FormData(m.querySelector('#mxMgRegister'));
              return mx
                .post(V1 + '/models', {
                  name: String(fd.get('name') || '').trim(),
                  purpose: String(fd.get('purpose') || '').trim(),
                  modelType: String(fd.get('modelType') || 'RISK'),
                  tier: Number(fd.get('tier') || 2),
                  ownerName: String(fd.get('ownerName') || '').trim(),
                  changeNote: 'Registered from admin workspace',
                })
                .then(function (r) {
                  var model = r.data || r;
                  mx.toast('Model registered', (model.ref || model.id) + ' · independent validation required before production use.');
                  return loadModels().then(function () {
                    resolve(true);
                  });
                });
            },
          },
        ],
      });
    });
  }

  function openModelActions(ref) {
    var m = modelByRef[ref];
    if (!m) return;
    mx.get(V1 + '/models/' + encodeURIComponent(m.id))
      .then(function (body) {
        var detail = body.data || body;
        var vid = detail.inFlightVersion && detail.inFlightVersion.id;
        var v = (detail.versionList || []).find(function (x) {
          return x.id === vid;
        });
        var actions = (v && v.actions) || {};
        mx.modal({
          eyebrow: 'MODEL · ' + mx.esc(m.ref || m.id),
          title: mx.esc(m.name),
          subtitle: (m.currentVersion ? 'v' + m.currentVersion : 'No approved version') + ' · ' + statusProto(m.status),
          body: '<p>' + mx.esc(m.purpose || '') + '</p>',
          actions: [
            actions.submit && {
              label: 'Submit version',
              run: function () {
                return mx.post(V1 + '/versions/' + encodeURIComponent(vid) + '/submit', {}).then(function () {
                  mx.toast('Version submitted', m.ref + ' awaiting validation.');
                  return loadModels();
                });
              },
            },
            actions.approve && {
              label: 'Approve version',
              primary: true,
              run: function () {
                return mx.post(V1 + '/versions/' + encodeURIComponent(vid) + '/approve', {}).then(function () {
                  mx.toast('Version approved', m.ref + ' promoted to production.');
                  return loadModels();
                });
              },
            },
            actions.reject && {
              label: 'Reject version',
              run: function () {
                mx.modal({
                  eyebrow: 'MODEL GOVERNANCE',
                  title: 'Reject version',
                  subtitle: m.ref,
                  body:
                    '<form id="mxMgReject"><label class="v34-field wide"><span>Rejection reason</span><textarea class="v34-input" name="reason" rows="3" required minlength="3"></textarea></label></form>',
                  actions: [
                    { label: 'Cancel', run: function () {} },
                    {
                      label: 'Reject',
                      primary: true,
                      run: function (modal) {
                        var reason = String(new FormData(modal.querySelector('#mxMgReject')).get('reason') || '').trim();
                        if (reason.length < 3) throw new Error('A reason is required');
                        return mx.post(V1 + '/versions/' + encodeURIComponent(vid) + '/reject', { reason: reason }).then(function () {
                          mx.toast('Version rejected', m.ref);
                          return loadModels();
                        });
                      },
                    },
                  ],
                });
              },
            },
          ].filter(Boolean),
        });
      })
      .catch(mx.fail);
  }

  function openReviewsModal() {
    return mx.get(V1 + '/reviews?status=OPEN&limit=30').then(function (body) {
      var rows = (body.data || body).data || body.data || body || [];
      mx.modal({
        eyebrow: 'MODEL GOVERNANCE',
        title: 'Scheduled reviews',
        subtitle: rows.length + ' open',
        wide: true,
        body:
          '<div class="v34-list">' +
          (rows.length
            ? rows
                .map(function (r) {
                  return '<div class="v34-row"><span><strong>' + mx.esc(r.modelName || r.modelRef) + '</strong><small>' + mx.esc(r.status) + ' · due ' + mx.esc(r.dueOn || '—') + '</small></span><em>' + mx.esc(r.reviewerName || '') + '</em></div>';
                })
                .join('')
            : '<p class="ops-muted">No open reviews.</p>') +
          '</div>',
        actions: [{ label: 'Close', run: function () {} }],
      });
    });
  }

  function openBindingsModal() {
    return mx.get(V1 + '/bindings').then(function (body) {
      var rows = body.data || body || [];
      mx.modal({
        eyebrow: 'MODEL GOVERNANCE',
        title: 'Production bindings',
        subtitle: rows.length + ' purposes',
        wide: true,
        body:
          '<div class="v34-list">' +
          (rows.length
            ? rows
                .map(function (b) {
                  return '<div class="v34-row"><span><strong>' + mx.esc(b.purpose || b.key) + '</strong><small>' + mx.esc(b.modelName || b.modelRef || '') + ' · v' + mx.esc(b.version || '—') + '</small></span><em>' + mx.esc(b.status || '') + '</em></div>';
                })
                .join('')
            : '<p class="ops-muted">No bindings configured.</p>') +
          '</div>',
        actions: [{ label: 'Close', run: function () {} }],
      });
    });
  }

  function openUsageModal() {
    return mx.get(V1 + '/usage?limit=30').then(function (body) {
      var rows = (body.data || body).data || body.data || body || [];
      mx.modal({
        eyebrow: 'MODEL GOVERNANCE',
        title: 'Recent model usage',
        subtitle: 'Last 30 days',
        wide: true,
        body:
          '<div class="v34-list">' +
          (rows.length
            ? rows
                .map(function (u) {
                  return '<div class="v34-row"><span><strong>' + mx.esc(u.modelName || u.modelRef) + '</strong><small>' + mx.esc(u.context || '') + ' · ' + mx.esc(u.objectRef || '') + '</small></span><em>' + mx.esc(u.usedAt ? mx.date(u.usedAt) : '') + '</em></div>';
                })
                .join('')
            : '<p class="ops-muted">No usage logged.</p>') +
          '</div>',
        actions: [{ label: 'Close', run: function () {} }],
      });
    });
  }

  function ensureModelGovActions() {
    var actions = document.querySelector('#page-model-governance .v33-actions, #page-model-governance .v37-model-actions');
    if (!actions || actions.querySelector('#mxMgBindings')) return;
    var bind = document.createElement('button');
    bind.className = actions.classList.contains('v37-model-actions') ? 'v37-btn' : 'v33-btn';
    bind.id = 'mxMgBindings';
    bind.textContent = 'Bindings';
    bind.setAttribute('data-mg-bindings', '1');
    var use = document.createElement('button');
    use.className = bind.className;
    use.id = 'mxMgUsage';
    use.textContent = 'Usage';
    use.setAttribute('data-mg-usage', '1');
    actions.insertBefore(use, actions.firstChild);
    actions.insertBefore(bind, actions.firstChild);
  }

  mx.onLoad('risk.view', function () {
    if (!document.getElementById('page-model-governance')) return Promise.resolve();
    if (liveModels()) {
      clearModelKpis();
      ensureModelGovActions();
    }
    return loadModels();
  });

  mx.hydrate('model-governance', function () {
    if (!liveModels()) return Promise.resolve();
    clearModelKpis();
    ensureModelGovActions();
    return loadModels();
  });

  window.addEventListener('matanho:legacy-ready', function () {
    mx.gate('#v33ModelNew, #v34NewModel, #v37ModelNew', 'risk.manage');

    document.addEventListener(
      'click',
      function (e) {
        if (!liveModels()) return;
        var newBtn = e.target.closest && e.target.closest('#v33ModelNew, #v34NewModel, #v37ModelNew');
        if (newBtn) {
          e.preventDefault();
          e.stopImmediatePropagation();
          registerModel();
          return;
        }
        var row = e.target.closest && e.target.closest('[data-model-id]');
        if (row && document.querySelector('#page-model-governance.v37-model')) {
          var ref = row.getAttribute('data-model-id');
          if (ref && modelByRef[ref] && e.detail === 2) openModelActions(ref);
        }
      },
      true,
    );

    mx.intercept(
      '#v37ModelExport',
      function () {
        mx.get(V1 + '/models?limit=500').then(function (body) {
          var rows = (body.data || body).data || body.data || body || [];
          var csv =
            'ref,name,type,status,owner,version\n' +
            rows
              .map(function (m) {
                return [m.ref, m.name, m.modelType, m.status, m.ownerName, m.currentVersion].map(function (v) {
                  return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
                }).join(',');
              })
              .join('\n');
          var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'model-register.csv';
          a.click();
          URL.revokeObjectURL(a.href);
        }, mx.fail);
        return false;
      },
      { when: liveModels },
    );

    document.addEventListener(
      'click',
      function (e) {
        if (!liveModels()) return;
        var reviews = e.target.closest && e.target.closest('#v33ModelCalendar, #v37ModelCalendar, #v37ModelReviews, [data-mg-reviews]');
        if (reviews) {
          e.preventDefault();
          e.stopImmediatePropagation();
          openReviewsModal().catch(mx.fail);
          return;
        }
        var bindings = e.target.closest && e.target.closest('[data-mg-bindings]');
        if (bindings) {
          e.preventDefault();
          e.stopImmediatePropagation();
          openBindingsModal().catch(mx.fail);
          return;
        }
        var usage = e.target.closest && e.target.closest('[data-mg-usage]');
        if (usage) {
          e.preventDefault();
          e.stopImmediatePropagation();
          openUsageModal().catch(mx.fail);
          return;
        }
        var row = e.target.closest && e.target.closest('[data-model-id]');
        if (row && !document.querySelector('#page-model-governance.v37-model')) {
          var ref = row.getAttribute('data-model-id');
          if (ref && modelByRef[ref]) {
            e.preventDefault();
            e.stopImmediatePropagation();
            openModelActions(ref);
          }
        }
      },
      true,
    );

    setTimeout(function () {
      if (liveModels()) loadModels().catch(mx.fail);
    }, 2500);
  });
})();
