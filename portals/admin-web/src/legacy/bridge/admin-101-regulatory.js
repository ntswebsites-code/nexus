/*
 * Regulatory reporting: calendar, filings, validation, submission.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var filingByRef = {};
  var filings = [];
  var filingDetail = null;
  var lastRegRef = null;

  function getEnvelope(path) {
    return fetch(mx.api + path, { credentials: 'include', headers: { Accept: 'application/json' } }).then(function (r) {
      return r.json();
    });
  }

  function liveRegulatory() {
    return mx.live && mx.strict('regulatory');
  }

  function pickFile() {
    return new Promise(function (resolve) {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pdf,.doc,.docx,.xlsx,.xls,.csv,.txt,.png,.jpg';
      input.onchange = function () {
        resolve(input.files && input.files[0]);
      };
      input.click();
    });
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

  function wrapRenderReg() {
    if (window.__mxRegWrapped || typeof renderReg !== 'function') return;
    window.__mxRegWrapped = true;
    var orig = renderReg;
    renderReg = function () {
      orig.apply(this, arguments);
      patchRegPackage();
    };
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
    wrapRenderReg();
    if (typeof renderReg === 'function') renderReg();
    else patchRegPackage();
    updateKpis(raw, mx.data.regulatoryCounts);
  }

  function clearRegKpis() {
    ['v33RegOpenCount', 'v33RegDueCount', 'v33RegValidationKpi', 'v33RegReviewCount', 'v33RegSubmittedCount', 'v33RegOverdueCount'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.textContent = '—';
        el.className = '';
      }
    });
    var t = document.getElementById('v33RegValidationText');
    if (t) t.textContent = 'Loading…';
  }

  function updateKpis(raw, counts) {
    var k = document.getElementById('v33RegValidationKpi');
    var t = document.getElementById('v33RegValidationText');
    if (k && t) {
      var populated = (raw || []).filter(function (f) {
        return f.populated;
      }).length;
      var total = (raw || []).length || 1;
      var pct = Math.round((populated / total) * 100);
      k.textContent = pct + '%';
      t.textContent = populated === total ? 'All filings populated' : total - populated + ' filing(s) need population';
    }
    counts = counts || {};
    var set = function (id, val, small) {
      var el = document.getElementById(id);
      if (!el) return;
      el.textContent = String(val != null ? val : '—');
      if (id === 'v33RegOverdueCount' && val) el.className = 'attention-text';
      if (small) {
        var sm = el.parentElement && el.parentElement.querySelector('small');
        if (sm) sm.textContent = small;
      }
    };
    set('v33RegOpenCount', counts.open, 'Active obligations');
    set('v33RegDueCount', counts.dueIn14Days, 'Due within 14 days');
    set('v33RegReviewCount', counts.inReview, 'Awaiting attestation');
    set('v33RegSubmittedCount', counts.submitted, 'Receipts retained');
    set('v33RegOverdueCount', counts.overdue, 'Requires immediate action');
  }

  function loadRegulatory() {
    if (!mx.can('reports.view')) return Promise.resolve();
    return getEnvelope('/api/v1/regulatory/calendar').then(function (body) {
      var list = Array.isArray(body.data) ? body.data : body.data && body.data.data ? body.data.data : body.data || [];
      mx.data.regulatoryCounts = body.counts || (body.data && body.data.counts) || {};
      filingByRef = {};
      filingDetail = null;
      lastRegRef = null;
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
      filingDetail = null;
      return loadRegulatory();
    });
  }

  function exportFiling(apiId, ref) {
    return mx.get('/api/v1/regulatory/filings/' + encodeURIComponent(apiId) + '/export').then(function (r) {
      var d = r.data || r;
      var blob = new Blob([d.csv], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = d.filename || (ref || 'filing') + '.csv';
      a.click();
      URL.revokeObjectURL(a.href);
      mx.toast('Export ready', d.filename || ref);
    });
  }

  function attachEvidence(apiId) {
    return pickFile().then(function (file) {
      if (!file) return;
      var fd = new FormData();
      fd.append('file', file, file.name);
      return mx.post('/api/v1/regulatory/filings/' + encodeURIComponent(apiId) + '/evidence', fd).then(function () {
        mx.toast('Evidence attached', file.name);
        filingDetail = null;
        return loadRegulatory();
      });
    });
  }

  function renderRegDepth(box, f) {
    var evidence = f.evidence || [];
    var actions = f.actions || {};
    box.innerHTML =
      '<hr/><strong>Filing evidence</strong> (' +
      evidence.length +
      ')' +
      '<div class="v34-list" style="margin-top:8px">' +
      (evidence.length
        ? evidence
            .map(function (e) {
              return (
                '<div class="v34-row"><span><strong>' +
                mx.esc(e.name) +
                '</strong><small>' +
                mx.esc(e.uploadedBy || '') +
                ' · ' +
                mx.esc((e.sha256 || '').slice(0, 10)) +
                '</small></span><em>' +
                (actions.attachEvidence
                  ? '<button type="button" class="v34-btn small" data-mx-reg-ev-del="' +
                    mx.esc(e.id) +
                    '">Remove</button>'
                  : '') +
                '</em></div>'
              );
            })
            .join('')
        : '<p class="ops-muted">No evidence attached yet.</p>') +
      '</div>' +
      '<div style="display:grid;gap:6px;margin-top:12px">' +
      (actions.attachEvidence ? '<button type="button" class="btn secondary" data-mx-reg-ev-add="1">Attach evidence file</button>' : '') +
      (f.populated ? '<button type="button" class="btn secondary" data-mx-reg-export="1">Export CSV</button>' : '') +
      (actions.waive ? '<button type="button" class="btn secondary" data-mx-reg-waive="1">Waive obligation</button>' : '') +
      '</div>';
    var add = box.querySelector('[data-mx-reg-ev-add]');
    if (add) {
      add.onclick = function () {
        attachEvidence(f.id).catch(mx.fail);
      };
    }
    box.querySelectorAll('[data-mx-reg-ev-del]').forEach(function (b) {
      b.onclick = function () {
        if (!window.confirm('Remove this evidence file?')) return;
        mx.del('/api/v1/regulatory/filings/' + encodeURIComponent(f.id) + '/evidence/' + encodeURIComponent(b.getAttribute('data-mx-reg-ev-del'))).then(function () {
          mx.toast('Evidence removed', f.ref);
          filingDetail = null;
          return loadRegulatory();
        }, mx.fail);
      };
    });
    var exp = box.querySelector('[data-mx-reg-export]');
    if (exp) {
      exp.onclick = function () {
        exportFiling(f.id, f.ref).catch(mx.fail);
      };
    }
    var waive = box.querySelector('[data-mx-reg-waive]');
    if (waive) {
      waive.onclick = function () {
        mx.reasonModal({
          eyebrow: 'REGULATORY',
          title: 'Waive obligation',
          subtitle: f.ref,
          label: 'Reason for waiving this obligation',
          minLength: 3,
          confirmLabel: 'Waive',
          onConfirm: function (reason) {
            return mx.post('/api/v1/regulatory/filings/' + encodeURIComponent(f.id) + '/waive', { reason: reason }).then(function () {
              mx.toast('Obligation waived', f.ref);
              filingDetail = null;
              return loadRegulatory();
            });
          },
        });
      };
    }
  }

  function patchRegPackage() {
    if (!liveRegulatory()) return;
    var ref = typeof regSel !== 'undefined' ? regSel : null;
    if (ref !== lastRegRef) {
      lastRegRef = ref;
      filingDetail = null;
    }
    var apiId = filingApiId(ref);
    var host = document.getElementById('v33RegPackage');
    if (!host || !apiId) return;
    var body = host.querySelector('.v33-card-body') || host;
    var box = body.querySelector('.mx-reg-depth');
    if (!box) {
      box = document.createElement('div');
      box.className = 'mx-reg-depth';
      body.appendChild(box);
    }
    if (filingDetail && (filingDetail.ref === ref || filingDetail.id === apiId)) {
      renderRegDepth(box, filingDetail);
      return;
    }
    mx.get('/api/v1/regulatory/filings/' + encodeURIComponent(apiId)).then(function (r) {
      filingDetail = r.data || r;
      renderRegDepth(box, filingDetail);
    }, mx.fail);
  }

  function openCreateFilingModal() {
    return mx.get('/api/v1/regulatory/templates').then(function (r) {
      var templates = r.data || r || [];
      if (!templates.length) {
        mx.toast('No templates', 'Regulatory templates are not configured.', 'warn');
        return;
      }
      mx.modal({
        eyebrow: 'REGULATORY',
        title: 'New filing obligation',
        body:
          '<form id="mxNewFiling"><label class="v34-field"><span>Template</span><select class="v34-select" name="templateKey">' +
          templates
            .map(function (t) {
              return '<option value="' + mx.esc(t.key) + '">' + mx.esc(t.name) + ' (' + mx.esc(t.regulator) + ')</option>';
            })
            .join('') +
          '</select></label><label class="v34-field"><span>Period end (optional)</span><input class="v34-input" name="periodEnd" type="date"></label><label class="v34-field"><span>Notes</span><input class="v34-input" name="notes" maxlength="200"></label></form>',
        actions: [
          { label: 'Cancel', run: function () {} },
          {
            label: 'Create filing',
            primary: true,
            run: function (m) {
              var fd = new FormData(m.querySelector('#mxNewFiling'));
              return mx
                .post('/api/v1/regulatory/filings', {
                  templateKey: fd.get('templateKey'),
                  periodEnd: fd.get('periodEnd') || undefined,
                  notes: fd.get('notes') || undefined,
                })
                .then(function (res) {
                  var row = res.data || res;
                  mx.toast('Filing created', row.ref || 'New obligation opened.');
                  return loadRegulatory();
                });
            },
          },
        ],
      });
    });
  }

  mx.onLoad('reports.view', function () {
    if (!document.getElementById('page-regulatory')) return Promise.resolve();
    if (liveRegulatory()) clearRegKpis();
    return loadRegulatory();
  });

  mx.hydrate('regulatory', function () {
    if (!liveRegulatory()) return Promise.resolve();
    clearRegKpis();
    return loadRegulatory();
  });

  window.addEventListener('matanho:legacy-ready', function () {
    wrapRenderReg();
    mx.gate('#v33RegValidate', 'reports.create');
    mx.gate('#v33RegAttest', 'reports.create');
    mx.gate('#v33RegFile', 'reports.submit');
    mx.gate('#v33NewObligation', 'reports.create');

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
          openCreateFilingModal().catch(mx.fail);
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
