/*
 * Reconciliations: overview KPIs, breaks queue, run matching, sign-off.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var breakByRef = {};

  function getEnvelope(path) {
    return fetch(mx.api + path, { credentials: 'include', headers: { Accept: 'application/json' } }).then(function (r) {
      return r.json();
    });
  }

  function liveRecon() {
    return mx.live && mx.strict('reconciliations');
  }

  function familyProto(f) {
    return (
      {
        TRADES: 'Trades',
        CASH: 'Cash',
        HOLDINGS: 'Holdings',
        DAYEND_COUNT: 'Units',
        POSITIONS_VS_CUSTODY: 'Holdings',
        SETTLEMENT_FAILS: 'Settlement',
        CORP_ACTIONS: 'Corporate actions',
      }[f] || f
    );
  }

  function severityProto(s) {
    if (s === 'CRITICAL') return 'Critical';
    if (s === 'HIGH') return 'High';
    if (s === 'MEDIUM') return 'Medium';
    return 'Low';
  }

  function stateProto(s) {
    return (
      {
        NEW: 'Investigating',
        ASSIGNED: 'Assigned',
        INVESTIGATING: 'Investigating',
        PENDING_CHECKER: 'Pending checker',
        MATCHED: 'Matched',
        CLOSED: 'Closed',
      }[s] || s
    );
  }

  function valueText(v) {
    if (v == null) return '—';
    if (typeof v === 'string' || typeof v === 'number') return String(v);
    if (v.amount != null) return String(v.amount) + (v.currency ? ' ' + v.currency : '');
    if (v.quantity != null) return String(v.quantity);
    try {
      return JSON.stringify(v);
    } catch (e) {
      return '—';
    }
  }

  function mapBreak(b) {
    var ref = b.ref || b.id;
    breakByRef[ref] = b.id;
    return {
      apiId: b.id,
      id: ref,
      family: familyProto(b.family),
      record: b.label || b.itemKey || '—',
      source: (b.counterparty && b.counterparty.name) || 'Internal book',
      age: Number(b.ageDays != null ? b.ageDays : (b.ageHours || 0) / 24),
      severity: severityProto(b.severity),
      internal: valueText(b.internalValue),
      external: valueText(b.externalValue),
      diff: b.difference || b.differencePct || '—',
      confidence: b.differencePct ? Math.min(99, Math.round(100 - Math.abs(Number(b.differencePct)))) : 90,
      candidate: b.label || 'Candidate match',
      cause: b.cause || 'Under investigation',
      action: 'Review and resolve',
      state: stateProto(b.status),
      owner: b.ownerName || 'Unassigned',
      maker: b.makerName,
      checker: b.checkerName,
    };
  }

  function mapV12Case(b) {
    var ref = b.ref || b.id;
    return {
      id: ref,
      apiId: b.id,
      control: familyProto(b.family),
      item: b.label || b.itemKey,
      internal: valueText(b.internalValue),
      external: valueText(b.externalValue),
      difference: b.difference || '—',
      cause: b.cause || 'Open break',
      owner: b.ownerName || 'Unassigned',
      age: (b.ageDays != null ? b.ageDays : 0).toFixed(1) + 'd',
      state: stateProto(b.status),
      severity: severityProto(b.severity),
      counterparty: (b.counterparty && b.counterparty.name) || 'Counterparty',
      evidence: ['IBOR position', 'External source file'],
    };
  }

  function updateKpis(overview, breaks) {
    var matchEl = document.getElementById('v33ReconMatch');
    var openEl = document.getElementById('v33ReconOpen');
    if (matchEl && overview && overview.families && overview.families.length) {
      var matched = overview.families.reduce(function (a, f) {
        return a + Number(f.matched || 0);
      }, 0);
      var total = overview.families.reduce(function (a, f) {
        return a + Number(f.matched || 0) + Number(f.breaks || 0);
      }, 0);
      matchEl.textContent = total ? ((matched / total) * 100).toFixed(2) + '%' : '—';
    }
    if (openEl && breaks) {
      openEl.textContent = breaks.filter(function (b) {
        return b.state !== 'Closed';
      }).length;
    }
  }

  function applyBreaks(rows) {
    window.__mxData = window.__mxData || {};
    window.__mxData._reconBreaks33 = rows.v33;
    if (typeof reconCasesV12 === 'object') {
      rows.v12.forEach(function (c) {
        reconCasesV12[c.id] = c;
      });
    }
    if (typeof renderBreakList === 'function') renderBreakList();
    if (typeof renderBreakDetail === 'function') renderBreakDetail();
    if (typeof renderReconRowsV12 === 'function') renderReconRowsV12();
  }

  function loadRecon() {
    if (!mx.can('operations.view')) return Promise.resolve();
    return Promise.all([
      getEnvelope('/api/v1/recon/overview'),
      getEnvelope('/api/v1/recon/breaks?status=NEW&status=ASSIGNED&status=INVESTIGATING&status=PENDING_CHECKER&limit=100'),
    ]).then(function (parts) {
      var overview = parts[0].data || parts[0];
      var list = parts[1].data || parts[1] || [];
      breakByRef = {};
      var mapped = list.map(mapBreak);
      updateKpis(overview, mapped);
      applyBreaks({ v33: mapped, v12: list.map(mapV12Case) });
      mx.data.reconOverview = overview;
    });
  }

  function breakApiId(ref) {
    return breakByRef[ref];
  }

  mx.onLoad('operations.view', function () {
    if (!document.getElementById('page-reconciliations')) return Promise.resolve();
    return loadRecon();
  });

  mx.hydrate('reconciliations', function () {
    if (!liveRecon()) return Promise.resolve();
    return loadRecon();
  });

  window.addEventListener('matanho:legacy-ready', function () {
    document.addEventListener(
      'click',
      function (e) {
        if (!liveRecon()) return;
        if (e.target.closest && e.target.closest('#v33RunRecon')) {
          e.preventDefault();
          e.stopImmediatePropagation();
          mx.post('/api/v1/recon/runs', { family: 'TRADES', asOfDate: new Date().toISOString().slice(0, 10) })
            .then(function () {
              mx.toast('Reconciliation run started', 'Matching job queued; breaks refresh when complete.');
              return loadRecon();
            })
            .catch(mx.fail);
          return;
        }
        if (e.target.closest && e.target.closest('#v33ReconSignoff')) {
          e.preventDefault();
          e.stopImmediatePropagation();
          mx.post('/api/v1/recon/signoffs', { asOfDate: new Date().toISOString().slice(0, 10), note: 'Daily sign-off from prototype' })
            .then(function () {
              mx.toast('Daily sign-off recorded', 'Reconciliation evidence frozen with checker identity.');
            })
            .catch(mx.fail);
          return;
        }
        if (e.target.closest && e.target.closest('#v33ReconSubmit')) {
          var rationale = document.getElementById('v33ReconRationale');
          var note = rationale ? rationale.value.trim() : '';
          if (!note) return;
          var active = (window.__mxData._reconBreaks33 || []).find(function (b) {
            return b.state !== 'Closed';
          });
          if (!active || !active.apiId) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          mx.post('/api/v1/recon/breaks/' + encodeURIComponent(active.apiId) + '/resolve', {
            resolutionNote: note,
            cause: (document.getElementById('v33ReconCause') && document.getElementById('v33ReconCause').value) || 'OTHER',
          })
            .then(function () {
              mx.toast('Resolution submitted', active.id + ' awaiting independent checker.');
              return loadRecon();
            })
            .catch(mx.fail);
          return;
        }
        if (e.target.closest && e.target.closest('#v33ReconChecker')) {
          var active2 = (window.__mxData._reconBreaks33 || []).find(function (b) {
            return b.state === 'Pending checker';
          });
          if (!active2 || !active2.apiId) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          mx.post('/api/v1/recon/breaks/' + encodeURIComponent(active2.apiId) + '/approve', {})
            .then(function () {
              mx.toast('Break closed', active2.id + ' approved by checker.');
              return loadRecon();
            })
            .catch(mx.fail);
          return;
        }
        if (e.target.closest && e.target.closest('#v33ReconCandidate, #v33ReconRematch')) {
          var card = document.querySelector('#v33BreakDetail .v33-kicker');
          var ref = card ? card.textContent.split(' · ')[0] : null;
          var apiId = ref && breakApiId(ref);
          if (!apiId) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          mx.post('/api/v1/recon/breaks/' + encodeURIComponent(apiId) + '/accept-match', {})
            .then(function () {
              mx.toast('Candidate accepted', 'Match candidate linked to ' + ref + '.');
              return loadRecon();
            })
            .catch(mx.fail);
        }
      },
      true,
    );
  });
})();
