/*
 * Onboarding & KYC (v35 screen). Cases come from /api/v1/kyc/cases/legacy in the
 * `matanho-onboarding-v10` shape the prototype already reads; decisions,
 * evidence requests, messages and screening re-runs go to the KYC API.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var KEY = 'matanho-onboarding-v10';

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
    var rec = (mx.data.kyc || []).find(function (x) {
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

  mx.intercept(
    '#v35DecisionApprove',
    function () {
      var rec = currentCase();
      var reason = mx.$('#v35DecisionRationale').value.trim();
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
      return load();
    },
    { thenNative: true, when: live },
  );

  mx.intercept('#v35KycPublic, #v35KycNew', function () {
    window.open(mx.portalUrl('onboarding') + '/', '_blank', 'noopener');
  });
})();
