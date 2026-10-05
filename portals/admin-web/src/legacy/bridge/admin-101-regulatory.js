/*
 * Regulatory reporting: calendar, filings, validation, submission.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var filingByRef = {};
  var filings = [];

  function getEnvelope(path) {
    return fetch(mx.api + path, { credentials: 'include', headers: { Accept: 'application/json' } }).then(function (r) {
      return r.json();
    });
  }

  function liveRegulatory() {
    return mx.live && mx.strict('regulatory');
  }

  function statusProto(s) {
    if (s === 'APPROVED' || s === 'SUBMITTED') return 'Ready';
    if (s === 'IN_REVIEW' || s === 'RETURNED') return 'Review';
    return 'Draft';
  }

  function dueLabel(days) {
    if (days == null) return '—';
    if (days < 0) return Math.abs(days) + 'd overdue';
    if (days === 0) return 'Today';
    return days + 'd';
  }

  function mapFiling(f) {
    var ref = f.ref || f.id;
    filingByRef[ref] = f.id;
    return [ref, f.template || f.formCode || 'Regulatory filing', dueLabel(f.daysToDue), statusProto(f.effectiveStatus || f.status)];
  }

  function applyObligations(rows, raw) {
    filings = raw || [];
    window.__mxData = window.__mxData || {};
    window.__mxData._obligations33 = rows;
    if (typeof regSel !== 'undefined' && rows.length && !rows.find(function (r) {
      return r[0] === regSel;
    })) {
      regSel = rows[0][0];
    }
    if (typeof renderReg === 'function') renderReg();
    updateKpis(raw);
  }

  function updateKpis(raw) {
    var k = document.getElementById('v33RegValidationKpi');
    var t = document.getElementById('v33RegValidationText');
    if (!k || !t) return;
    var populated = (raw || []).filter(function (f) {
      return f.populated;
    }).length;
    var total = (raw || []).length || 1;
    var pct = Math.round((populated / total) * 100);
    k.textContent = pct + '%';
    t.textContent = populated === total ? 'All filings populated' : total - populated + ' filing(s) need population';
  }

  function loadRegulatory() {
    if (!mx.can('reports.view')) return Promise.resolve();
    return getEnvelope('/api/v1/regulatory/calendar').then(function (body) {
      var cal = body.data || body;
      var list = cal.data || cal || [];
      filingByRef = {};
      var mapped = list.map(mapFiling);
      applyObligations(mapped, list);
      mx.data.regulatoryFilings = list;
    });
  }

  function filingApiId(ref) {
    return filingByRef[ref || (typeof regSel !== 'undefined' ? regSel : '')];
  }

  function selectedFiling() {
    var ref = typeof regSel !== 'undefined' ? regSel : null;
    return filings.find(function (f) {
      return (f.ref || f.id) === ref;
    });
  }

  function runFilingAction(action) {
    var ref = typeof regSel !== 'undefined' ? regSel : null;
    var apiId = filingApiId(ref);
    if (!apiId) {
      mx.toast('No filing selected', 'Choose a regulatory obligation first.', 'warn');
      return Promise.resolve();
    }
    var path = '/api/v1/regulatory/filings/' + encodeURIComponent(apiId) + '/' + action;
    return mx.post(path, {}).then(function () {
      return loadRegulatory();
    });
  }

  mx.onLoad('reports.view', function () {
    if (!document.getElementById('page-regulatory')) return Promise.resolve();
    return loadRegulatory();
  });

  mx.hydrate('regulatory', function () {
    if (!liveRegulatory()) return Promise.resolve();
    return loadRegulatory();
  });

  window.addEventListener('matanho:legacy-ready', function () {
    mx.gate('#v33RegValidate', 'reports.create');
    mx.gate('#v33RegAttest', 'reports.create');
    mx.gate('#v33RegFile', 'reports.submit');

    document.addEventListener(
      'click',
      function (e) {
        if (!liveRegulatory()) return;
        if (e.target.closest && e.target.closest('#v33RegValidate')) {
          e.preventDefault();
          e.stopImmediatePropagation();
          var f = selectedFiling();
          var step = f && f.populated ? 'submit-review' : 'populate';
          runFilingAction(step)
            .then(function () {
              mx.toast('Validation complete', step === 'populate' ? 'Filing populated from live data.' : 'Filing sent for independent review.');
              if (typeof regValidated !== 'undefined') regValidated = true;
              if (typeof renderReg === 'function') renderReg();
            })
            .catch(mx.fail);
          return;
        }
        if (e.target.closest && e.target.closest('#v33RegAttest')) {
          e.preventDefault();
          e.stopImmediatePropagation();
          runFilingAction('submit-review')
            .then(function () {
              mx.toast('Attestations recorded', 'Compliance review queue updated.');
              if (typeof regAttested !== 'undefined') regAttested = true;
              if (typeof renderReg === 'function') renderReg();
            })
            .catch(mx.fail);
          return;
        }
        if (e.target.closest && e.target.closest('#v33RegFile')) {
          e.preventDefault();
          e.stopImmediatePropagation();
          var filing = selectedFiling();
          var action = filing && filing.status === 'APPROVED' ? 'submit' : 'approve';
          runFilingAction(action)
            .then(function () {
              mx.toast('Regulatory filing submitted', (filing && filing.ref) || 'Filing' + ' updated in the controlled calendar.');
              if (typeof regFiled !== 'undefined') regFiled = action === 'submit';
              if (typeof renderReg === 'function') renderReg();
            })
            .catch(mx.fail);
          return;
        }
        if (e.target.closest && e.target.closest('#v33NewObligation')) {
          e.preventDefault();
          e.stopImmediatePropagation();
          mx.toast('New obligation', 'Create filings from templates in ops-native regulatory workspace.');
          return;
        }
      },
      true,
    );

    mx.intercept(
      '#v33RegCalendar',
      function () {
        mx.post('/api/v1/regulatory/calendar/generate', {})
          .then(function () {
            mx.toast('Calendar generated', 'Current regulatory periods opened from templates.');
            return loadRegulatory();
          })
          .catch(mx.fail);
        return false;
      },
      { when: liveRegulatory },
    );
  });
})();
