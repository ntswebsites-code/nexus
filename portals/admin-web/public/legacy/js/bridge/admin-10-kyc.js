/*
 * Onboarding & KYC (v35 screen). Cases come from /api/v1/kyc/cases/legacy in the
 * `matanho-onboarding-v10` shape the prototype already reads; decisions,
 * evidence requests, messages and screening re-runs go to the KYC API.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var KEY = 'matanho-onboarding-v10';
  var CO = '/api/v1/client-ops';

  function load() {
    return mx.get('/api/v1/kyc/cases/legacy').then(function (r) {
      mx.data.kyc = r.data;
      mx.storageSet(KEY, r.data);
    });
  }
  mx.onLoad('onboarding.view', load);

  mx.kycRefresh = function () {
    return load().then(function () {
      mx.storagePing(KEY);
    });
  };

  /** The case open in the detail pane ("ONB-104831 · Individual · ..." kicker). */
  function currentCase() {
    var kicker = mx.$('#v35KycDetail .v35-kicker');
    var ref = kicker ? kicker.textContent.split('·')[0].trim() : '';
    var pool = [].concat(mx.data.onboardingQueue || [], mx.data.kyc || []);
    var rec = pool.find(function (x) {
      return x.id === ref;
    });
    if (!rec) throw new Error('This demo case is not stored on the server.');
    return rec;
  }
  function caseUrl(rec, suffix) {
    return '/api/v1/kyc/cases/' + encodeURIComponent(rec.caseId) + (suffix || '');
  }
  function slotFor(rec, label) {
    var e = (rec.v35 && rec.v35.evidence || []).find(function (x) {
      return x.label === label;
    });
    return e && e.slot;
  }

  /** Used by the patched previewKycDoc35: stream the original evidence file. */
  mx.fetchEvidence = function (c, e) {
    var rec = (mx.data.kyc || []).find(function (x) {
      return x.id === c.id;
    });
    if (!rec || !e || !e.slot || !e.docKey) return null;
    return mx
      .get(caseUrl(rec, '/evidence/' + e.slot + '/download-url'))
      .then(function (r) {
        return fetch(r.url);
      })
      .then(function (res) {
        if (!res.ok) throw new Error('Download failed');
        return res.blob();
      })
      .then(function (blob) {
        return { blob: blob, type: blob.type || e.type, name: e.name };
      })
      .catch(function (err) {
        mx.fail(err);
        return null;
      });
  };

  function live() {
    return mx.live && Array.isArray(mx.data.kyc);
  }

  function onboardingLive() {
    return mx.live && mx.strict('onboarding');
  }

  function clearOnboardingKpis() {
    document.querySelectorAll('#page-onboarding .v33-kpis article strong, #page-onboarding .v35-kpis article strong').forEach(function (el) {
      el.textContent = '—';
      el.className = '';
    });
    document.querySelectorAll('#page-onboarding .v33-kpis article small, #page-onboarding .v35-kpis article small').forEach(function (el) {
      el.textContent = 'Loading…';
    });
  }

  function patchOnboardingKpis() {
    var s = mx.data.onboardingSummary || {};
    var q = mx.data.onboardingQueue || [];
    var open = q.filter(function (x) {
      return x.status !== 'Ready';
    }).length;
    var ready = q.filter(function (x) {
      return x.status === 'Ready';
    }).length;
    var high = (s.byRisk && s.byRisk.High) || q.filter(function (x) {
      return x.risk === 'High';
    }).length;
    var values = {
      v33OnbKpiOpen: [open, 'Live review queue'],
      v33OnbKpiReady: [ready, 'Hard gates passed'],
      v33OnbKpiEdd: [high, 'Enhanced review'],
      v33OnbKpiEvidence: [s.evidenceOutstanding || 0, 'Documents requested'],
      v33OnbKpiCycle: [s.awaitingRiskApproval || 0, 'Maker-checker'],
      v33OnbKpiSla: [(s.bySla && s.bySla.Breached) || 0, 'Exception-led'],
    };
    Object.keys(values).forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.textContent = String(values[id][0]);
      var small = el.parentElement && el.parentElement.querySelector('small');
      if (small) small.textContent = values[id][1];
    });
    var host = document.getElementById('v35KycKpis');
    if (host && typeof mx.renderKycKpis35 === 'function') host.innerHTML = mx.renderKycKpis35();
  }

  mx.intercept(
    '#v35DecisionApprove',
    function () {
      var rec = currentCase();
      var reason = mx.$('#v35DecisionRationale').value.trim();
      if (live() && rec.caseId) {
        return loadWorkup(rec).then(function (w) {
          var pending = (w.assessments || []).find(function (a) {
            return a.status === 'PROPOSED';
          });
          if (pending) {
            return mx.post(CO + '/onboarding/risk/' + encodeURIComponent(pending.id) + '/approve', { note: reason });
          }
          return mx.post(caseUrl(rec, '/decision'), { decision: 'approve', reason: reason }).then(function () {
            return mx.post(caseUrl(rec, '/activate'));
          });
        }).then(function () {
          mx.toast('KYC approved and activated', rec.name + ' progressed.');
          return mx.kycRefresh().then(function () {
            return live() ? loadOnboardingDepth() : null;
          });
        }).catch(function (err) {
          mx.kycRefresh();
          throw err;
        });
      }
      return mx
        .post(caseUrl(rec, '/decision'), { decision: 'approve', reason: reason })
        .then(function () {
          return mx.post(caseUrl(rec, '/activate'));
        })
        .then(function (r) {
          mx.toast('KYC approved and activated', rec.name + ' is client ' + r.clientRef + '; investor invitation sent.');
          return mx.kycRefresh();
        })
        .catch(function (err) {
          mx.kycRefresh();
          throw err;
        });
    },
    { when: function () { return live() && mx.$('#v35DecisionRationale') && mx.$('#v35DecisionRationale').value.trim(); } },
  );

  mx.intercept(
    '#v35DecisionDecline',
    function () {
      var rec = currentCase();
      var reason = mx.$('#v35DecisionRationale').value.trim();
      return mx.post(caseUrl(rec, '/decision'), { decision: 'reject', reason: reason }).then(function () {
        mx.toast('Application declined', rec.name + ' - decision and rationale recorded.', 'warn');
        return mx.kycRefresh();
      });
    },
    { when: function () { return live() && mx.$('#v35DecisionRationale') && mx.$('#v35DecisionRationale').value.trim(); } },
  );

  mx.intercept(
    '#v35ReqSend',
    function (btn) {
      var rec = currentCase();
      var modal = btn.closest('.modal, [role="dialog"]') || document;
      var item = mx.$('#v35EvidenceItem', modal);
      var note = modal.querySelector('textarea');
      var label = item ? item.value : '';
      var slot = slotFor(rec, label);
      return mx
        .post(caseUrl(rec, '/request-evidence'), {
          slots: slot ? [slot] : [],
          message: (note && note.value.trim()) || 'Please upload: ' + label + '.',
        })
        .then(function () {
          setTimeout(mx.kycRefresh, 300);
        });
    },
    { thenNative: true, when: live },
  );

  mx.intercept(
    '#v35MsgSend',
    function (btn) {
      var rec = currentCase();
      var modal = btn.closest('.modal, [role="dialog"]') || document;
      var text = mx.$('#v35KycMessageText', modal);
      var topic = modal.querySelector('select');
      if (!text || !text.value.trim()) throw new Error('Write the message first.');
      return mx.post(caseUrl(rec, '/messages'), { message: text.value.trim(), topic: topic ? topic.value : undefined });
    },
    { thenNative: true, when: live },
  );

  mx.intercept(
    '#v35RefreshScreen',
    function () {
      var rec = currentCase();
      return mx.post(caseUrl(rec, '/screening/refresh')).then(function () {
        mx.toast('Screening re-run queued', 'Provider results will appear shortly; final disposition remains human.');
        setTimeout(mx.kycRefresh, 3500);
      });
    },
    { when: live },
  );

  mx.intercept(
    '#v35KycRefresh',
    function () {
      return load().then(function () {
        return live() ? loadOnboardingDepth() : null;
      });
    },
    { thenNative: true, when: live },
  );

  mx.intercept('#v35KycPublic, #v35KycNew', function () {
    window.open(mx.portalUrl('onboarding') + '/', '_blank', 'noopener');
  });

  // ------------------------------------------------------------ W7: onboarding queue, workup, risk, triage, assign

  var staff = [];
  var workupCache = {};
  var riskFactors = [];

  function mapQueueRow(item) {
    var stageMap = { Submitted: 0, Screening: 3, ComplianceReview: 5, ClientAction: 1, EnhancedReview: 3, Approved: 6, Activation: 6 };
    return {
      id: item.ref,
      caseId: item.id,
      name: item.name,
      type: item.type || 'Applicant',
      risk: item.risk || 'Pending',
      owner: item.owner || 'Unassigned',
      ownerId: item.ownerId,
      readiness: item.checks ? Math.round((item.checks.done / Math.max(item.checks.total, 1)) * 100) : 50,
      status: item.stage === 'Approved' || item.stage === 'Activation' ? 'Ready' : 'Action',
      blockers: item.checks ? item.checks.failed + item.checks.referred : 0,
      next: item.riskAssessment && item.riskAssessment.status === 'PROPOSED' ? 'Risk approval' : 'Review case',
      stage: stageMap[item.stage] != null ? stageMap[item.stage] : 0,
      screen: item.riskAssessment ? item.riskAssessment.rating : 'Review',
      screenRef: item.ref,
      screened: item.submittedAt ? mx.date(item.submittedAt) : '—',
      decision: item.riskAssessment && item.riskAssessment.status === 'APPROVED' ? 'Approved' : 'Pending',
      mandate: 'Review',
      identity: 'Review',
      ownership: 'Review',
      funds: 'Review',
      parties: [[item.name, 'Applicant', '100%', 'Submitted']],
      evidence: [],
      timeline: [],
      v35: { riskAssessmentId: item.riskAssessment && item.riskAssessment.id },
    };
  }

  function loadOnboardingDepth() {
    return Promise.all([
      mx.get(CO + '/onboarding/queue', { open: 'true' }).then(function (r) {
        mx.data.onboardingQueue = (r.data || []).map(mapQueueRow);
        mx.data.onboardingSummary = r.summary || {};
      }),
      mx.get(CO + '/staff').then(function (r) {
        staff = r.data || [];
      }),
      mx.get(CO + '/onboarding/risk-factors').then(function (r) {
        riskFactors = r.factors || r.data || [];
        mx.data.riskFactors = riskFactors;
      }),
    ]).then(function () {
      mx.storagePing(KEY);
      if (onboardingLive()) patchOnboardingKpis();
    });
  }

  mx.onLoad('onboarding.view', function () {
    if (onboardingLive()) clearOnboardingKpis();
    if (!live()) return load();
    return load().then(loadOnboardingDepth);
  });

  mx.hydrate('onboarding', function () {
    if (!onboardingLive()) return Promise.resolve();
    clearOnboardingKpis();
    return load().then(loadOnboardingDepth);
  });

  mx.renderKycKpis35 = function () {
    var s = mx.data.onboardingSummary || {};
    var q = mx.data.onboardingQueue || [];
    var open = q.filter(function (x) {
      return x.status !== 'Ready';
    }).length;
    var ready = q.filter(function (x) {
      return x.status === 'Ready';
    }).length;
    return (
      '<article class="v35-kpi"><span>Open cases</span><strong>' +
      open +
      '</strong><small>Live review queue</small></article>' +
      '<article class="v35-kpi"><span>Ready to activate</span><strong>' +
      ready +
      '</strong><small>Hard gates passed</small></article>' +
      '<article class="v35-kpi"><span>Awaiting risk approval</span><strong>' +
      (s.awaitingRiskApproval || 0) +
      '</strong><small>Maker-checker</small></article>' +
      '<article class="v35-kpi"><span>High risk</span><strong>' +
      ((s.byRisk && s.byRisk.High) || 0) +
      '</strong><small>Enhanced review</small></article>' +
      '<article class="v35-kpi"><span>SLA breached</span><strong>' +
      ((s.bySla && s.bySla.Breached) || 0) +
      '</strong><small>Exception-led</small></article>'
    );
  };

  function caseRef(rec) {
    return rec.caseId || rec.id;
  }

  function loadWorkup(rec) {
    return mx.get(CO + '/onboarding/cases/' + encodeURIComponent(caseRef(rec)) + '/workup').then(function (r) {
      workupCache[rec.id] = r;
      return r;
    });
  }

  mx.intercept(
    '#v35AssignOwner, [data-v35-assign-owner]',
    function () {
      var rec = currentCase();
      var opts = staff.map(function (s) {
        return '<option value="' + mx.esc(s.id) + '">' + mx.esc(s.name) + '</option>';
      }).join('');
      mx.modal({
        eyebrow: 'ONBOARDING · ASSIGN',
        title: rec.name,
        body: '<label class="v35-field"><span>Case owner</span><select class="v35-select" id="mxKycAssign">' + opts + '</select></label>',
        actions: [
          {
            label: 'Assign',
            primary: true,
            run: function () {
              var el = document.getElementById('mxKycAssign');
              return mx.post(CO + '/onboarding/cases/' + encodeURIComponent(caseRef(rec)) + '/assign', { userId: el ? el.value : null }).then(function () {
                return mx.kycRefresh().then(loadOnboardingDepth);
              });
            },
          },
        ],
      });
    },
    { when: live },
  );

  mx.intercept(
    '[data-v35-triage-run], #v35RunTriage',
    function () {
      var rec = currentCase();
      return mx.post(CO + '/onboarding/cases/' + encodeURIComponent(caseRef(rec)) + '/triage', {}).then(function (r) {
        mx.toast('AI triage complete', (r.note && r.note.summary) || 'Advisory note stored.');
        return loadWorkup(rec);
      });
    },
    { when: live },
  );

  mx.intercept(
    '#v35ProposeRisk, [data-v35-propose-risk]',
    function () {
      var rec = currentCase();
      var rating = window.prompt('Proposed risk rating (Low / Medium / High):', rec.risk || 'Medium');
      if (!rating) return;
      var rationale = window.prompt('Rationale for proposed rating:') || '';
      return mx.post(CO + '/onboarding/cases/' + encodeURIComponent(caseRef(rec)) + '/risk', { rating: rating, rationale: rationale }).then(function () {
        mx.toast('Risk proposed', 'Awaiting independent checker approval.');
        return mx.kycRefresh().then(loadOnboardingDepth);
      });
    },
    { when: live },
  );

  mx.intercept(
    '#v35RecordCheck, [data-v35-record-check]',
    function () {
      var rec = currentCase();
      var kind = window.prompt('Check kind (identity / sanctions / pep / source_of_funds):', 'identity');
      if (!kind) return;
      var outcome = window.prompt('Outcome (PASS / FAIL / REFER):', 'PASS');
      if (!outcome) return;
      return mx.post(CO + '/onboarding/cases/' + encodeURIComponent(caseRef(rec)) + '/checks', { kind: kind, outcome: outcome }).then(function () {
        mx.toast('Check recorded', kind + ' · ' + outcome);
        return loadWorkup(rec);
      });
    },
    { when: live },
  );

  function openRiskFactorsModal() {
    mx.get(CO + '/onboarding/risk-factors').then(function (r) {
      var factors = r.factors || r.data || riskFactors || [];
      riskFactors = factors;
      var canEdit = mx.can('onboarding.approve');
      mx.modal({
        eyebrow: 'ONBOARDING · RISK FACTORS',
        title: 'Configurable risk factors',
        subtitle: canEdit ? 'Changes require step-up MFA' : 'View only',
        wide: true,
        body:
          '<div class="v34-list">' +
          (factors.length
            ? factors
                .map(function (f) {
                  return (
                    '<div class="v34-row"><span><strong>' +
                    mx.esc(f.label || f.key) +
                    '</strong><small>' +
                    mx.esc(f.key) +
                    ' · ' +
                    (f.enabled ? f.points + ' pts' : 'disabled') +
                    '</small></span><em>' +
                    (canEdit
                      ? '<button type="button" class="v34-btn small" data-mx-rf-edit="' +
                        mx.esc(f.key) +
                        '">Edit</button>'
                      : mx.esc(f.updatedBy || '')) +
                    '</em></div>'
                  );
                })
                .join('')
            : '<p class="ops-muted">No factors loaded.</p>') +
          '</div>',
        actions: [{ label: 'Close', run: function () {} }],
      });
      document.querySelectorAll('[data-mx-rf-edit]').forEach(function (btn) {
        btn.onclick = function () {
          var key = btn.getAttribute('data-mx-rf-edit');
          var f = factors.find(function (x) {
            return x.key === key;
          });
          if (!f) return;
          mx.modal({
            eyebrow: 'RISK FACTOR',
            title: f.label || key,
            body:
              '<form id="mxRfEdit"><label class="v34-field"><span>Points</span><input class="v34-input" name="points" type="number" min="0" max="100" value="' +
              mx.esc(String(f.points != null ? f.points : '')) +
              '"></label><label class="v34-field"><span>Enabled</span><select class="v34-select" name="enabled"><option value="true"' +
              (f.enabled ? ' selected' : '') +
              '>Yes</option><option value="false"' +
              (!f.enabled ? ' selected' : '') +
              '>No</option></select></label><label class="v34-field"><span>Reason</span><textarea class="v34-input" name="reason" rows="3" required minlength="5"></textarea></label></form>',
            actions: [
              { label: 'Cancel', run: function () {} },
              {
                label: 'Save factor',
                primary: true,
                run: function (m) {
                  var fd = new FormData(m.querySelector('#mxRfEdit'));
                  return mx
                    .put(
                      CO + '/onboarding/risk-factors/' + encodeURIComponent(key),
                      {
                        points: Number(fd.get('points')),
                        enabled: fd.get('enabled') === 'true',
                        reason: fd.get('reason'),
                      },
                      { stepUp: true },
                    )
                    .then(function () {
                      mx.toast('Risk factor updated', key);
                      return loadOnboardingDepth().then(openRiskFactorsModal);
                    });
                },
              },
            ],
          });
        };
      });
    }, mx.fail);
  }

  mx.intercept(
    '#v35RiskFactors, [data-v35-risk-factors]',
    function () {
      openRiskFactorsModal();
    },
    { when: function () {
      return live() && onboardingLive();
    } },
  );
})();
