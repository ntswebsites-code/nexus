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
    var name = window.prompt('Model name');
    if (!name) return Promise.resolve();
    var purpose = window.prompt('Purpose and permitted use', 'Decision support for portfolio risk analytics.');
    if (!purpose) return Promise.resolve();
    var owner = window.prompt('Human owner', 'Risk Analytics');
    if (!owner) return Promise.resolve();
    return mx
      .post(V1 + '/models', {
        name: name,
        purpose: purpose,
        modelType: 'RISK',
        tier: 2,
        ownerName: owner,
        changeNote: 'Registered from prototype workspace',
      })
      .then(function (r) {
        var m = r.data || r;
        mx.toast('Model registered', (m.ref || m.id) + ' · independent validation required before production use.');
        return loadModels();
      })
      .catch(mx.fail);
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
                var reason = window.prompt('Rejection reason');
                if (!reason) return false;
                return mx.post(V1 + '/versions/' + encodeURIComponent(vid) + '/reject', { reason: reason }).then(function () {
                  mx.toast('Version rejected', m.ref);
                  return loadModels();
                });
              },
            },
          ].filter(Boolean),
        });
      })
      .catch(mx.fail);
  }

  mx.onLoad('risk.view', function () {
    if (!document.getElementById('page-model-governance')) return Promise.resolve();
    return loadModels();
  });

  mx.hydrate('model-governance', function () {
    if (!liveModels()) return Promise.resolve();
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
        mx.toast('Export register', 'Download the governed model register from ops-native usage tab.');
        return false;
      },
      { when: liveModels },
    );

    setTimeout(function () {
      if (liveModels()) loadModels().catch(mx.fail);
    }, 2500);
  });
})();
