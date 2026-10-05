/*
 * Corporate Actions: event book, entitlements, elections, processing.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var eventByRef = {};

  function getEnvelope(path) {
    return fetch(mx.api + path, { credentials: 'include', headers: { Accept: 'application/json' } }).then(function (r) {
      return r.json();
    });
  }

  function liveCa() {
    return mx.live && mx.strict('corporate-actions');
  }

  function typeProto(t) {
    if (t === 'CASH_DIVIDEND' || t === 'SCRIP_DIVIDEND') return 'Choice';
    if (t === 'RIGHTS_ISSUE') return 'Voluntary';
    return 'Mandatory';
  }

  function stateProto(e) {
    if (e.electionOpen) return 'Election required';
    if (e.status === 'ANNOUNCED') return 'Awaiting confirmation';
    if (e.status === 'CONFIRMED') return 'Confirmed';
    if (e.status === 'PROCESSED') return 'Processed';
    if (e.stageLabel) return e.stageLabel;
    return e.status || 'Review';
  }

  function toneFor(e) {
    if (e.electionOpen) return 'amber';
    if (e.status === 'PROCESSED') return 'green';
    if (e.status === 'ANNOUNCED') return 'blue';
    return 'blue';
  }

  function entitlementLabel(e) {
    if (e.netCash && Number(e.netCash) !== 0) return 'US$ ' + Number(e.netCash).toLocaleString();
    if (e.ratioNew && e.ratioOld) return e.ratioNew + ':' + e.ratioOld;
    return e.rate ? String(e.rate) : '—';
  }

  function mapEvent(e) {
    var ref = e.ref || e.id;
    eventByRef[ref] = e.id;
    return {
      apiId: e.id,
      id: ref,
      event: e.description || e.type || 'Corporate action',
      security: e.ticker || e.securityName || '—',
      type: typeProto(e.type),
      date: e.electionDeadline ? mx.date(e.electionDeadline) : mx.date(e.exDate),
      entitlement: entitlementLabel(e),
      portfolios: String(e.entitlementCount || e.electedCount || '—'),
      state: stateProto(e),
      tone: toneFor(e),
      raw: e,
    };
  }

  function updateStateBar(summary) {
    if (!summary) return;
    var bar = document.querySelector('#page-corporate-actions .v15-statebar');
    if (!bar) return;
    var cells = bar.querySelectorAll('div');
    if (cells[0]) cells[0].querySelector('strong').textContent = String(summary.upcoming + summary.awaitingConfirmation + summary.awaitingProcessing + summary.processed);
    if (cells[1]) cells[1].querySelector('strong').textContent = String(summary.upcoming || 0);
    if (cells[3] && summary.awaitingProcessing) cells[3].querySelector('strong').textContent = '—';
  }

  function applyEvents(rows) {
    window.__mxData = window.__mxData || {};
    window.__mxData._v15CorpActions = rows;
    if (typeof renderV15CorpActions === 'function') renderV15CorpActions();
  }

  function loadCorporateActions() {
    if (!mx.can('operations.view')) return Promise.resolve();
    return Promise.all([
      getEnvelope('/api/v1/corporate-actions/events?limit=50'),
      getEnvelope('/api/v1/corporate-actions/upcoming?days=90'),
    ]).then(function (parts) {
      var list = parts[0].data || parts[0] || [];
      var upcoming = parts[1].data || parts[1] || [];
      var merged = {};
      list.concat(upcoming).forEach(function (e) {
        merged[e.id] = e;
      });
      eventByRef = {};
      var mapped = Object.keys(merged).map(function (id) {
        return mapEvent(merged[id]);
      });
      updateStateBar(parts[0].summary || {});
      applyEvents(mapped);
      mx.data.corporateActions = mapped;
    });
  }

  function eventApiId(ref) {
    return eventByRef[ref];
  }

  mx.onLoad('operations.view', function () {
    if (!document.getElementById('page-corporate-actions')) return Promise.resolve();
    return loadCorporateActions();
  });

  mx.hydrate('corporate-actions', function () {
    if (!liveCa()) return Promise.resolve();
    return loadCorporateActions();
  });

  window.addEventListener('matanho:legacy-ready', function () {
    mx.gate('[data-v15-ca-action="new"]', 'operations.view');
    mx.gate('[data-v15-ca-action="project"]', 'operations.view');

    mx.intercept(
      '[data-v15-ca-action="project"]',
      function () {
        var first = (window.__mxData._v15CorpActions || [])[0];
        if (!first || !first.apiId) {
          mx.toast('No events', 'Create or load a corporate action first.', 'warn');
          return false;
        }
        mx.post('/api/v1/corporate-actions/events/' + encodeURIComponent(first.apiId) + '/entitlements/calculate', {})
          .then(function () {
            mx.toast('Entitlements projected', first.security + ' entitlements recalculated from live positions.');
            return loadCorporateActions();
          })
          .catch(mx.fail);
        return false;
      },
      { when: liveCa },
    );

    document.addEventListener(
      'click',
      function (e) {
        if (!liveCa()) return;
        var action = e.target.closest && e.target.closest('[data-v15-ca-action]');
        if (action && action.dataset.v15CaAction === 'new') {
          e.preventDefault();
          e.stopImmediatePropagation();
          mx.toast('New event', 'Record corporate action announcements in ops-native with security and dates.');
          return;
        }
        var row = e.target.closest && e.target.closest('[data-v15-ca]');
        if (!row) return;
        var ref = row.dataset.v15Ca;
        var apiId = eventApiId(ref);
        if (!apiId) return;
        var ev = (window.__mxData._v15CorpActions || []).find(function (x) {
          return x.id === ref;
        });
        if (!ev || !ev.raw) return;
        if (ev.raw.status === 'ANNOUNCED' && e.target.closest('.btn.primary')) {
          e.preventDefault();
          e.stopImmediatePropagation();
          mx.post('/api/v1/corporate-actions/events/' + encodeURIComponent(apiId) + '/confirm', {})
            .then(function () {
              mx.toast('Event confirmed', ref + ' is confirmed for entitlement calculation.');
              return loadCorporateActions();
            })
            .catch(mx.fail);
        }
      },
      true,
    );
  });
})();
