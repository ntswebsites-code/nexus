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

  function openBreakQueryModal(refQ, apiId) {
    mx.modal({
      eyebrow: 'RECONCILIATIONS · QUERY',
      title: 'Raise counterparty query',
      subtitle: refQ,
      body:
        '<form id="mxReconQuery"><label class="v34-field"><span>Subject</span><input class="v34-input" name="subject" required minlength="3" maxlength="200"></label>' +
        '<label class="v34-field wide"><span>Message</span><textarea class="v34-input" name="body" rows="4" required minlength="5"></textarea></label></form>',
      actions: [
        { label: 'Cancel', run: function () {} },
        {
          label: 'Send query',
          primary: true,
          run: function (m) {
            var fd = new FormData(m.querySelector('#mxReconQuery'));
            var subject = String(fd.get('subject') || '').trim();
            var body = String(fd.get('body') || '').trim();
            if (subject.length < 3 || body.length < 5) throw new Error('Subject and message are required');
            return mx
              .post('/api/v1/recon/breaks/' + encodeURIComponent(apiId) + '/query', { subject: subject, body: body })
              .then(function () {
                mx.toast('Counterparty query raised', refQ);
                return loadRecon();
              });
          },
        },
      ],
    });
  }

  function openAcceptCandidateModal(ref, apiId) {
    mx.modal({
      eyebrow: 'RECONCILIATIONS · MATCH',
      title: 'Accept candidate break',
      subtitle: ref,
      body:
        '<form id="mxReconCandidate"><label class="v34-field"><span>Candidate break ID</span><input class="v34-input" name="candidateBreakId" required></label>' +
        '<label class="v34-field wide"><span>Rationale</span><textarea class="v34-input" name="rationale" rows="3" required minlength="10"></textarea></label></form>',
      actions: [
        { label: 'Cancel', run: function () {} },
        {
          label: 'Accept candidate',
          primary: true,
          run: function (m) {
            var fd = new FormData(m.querySelector('#mxReconCandidate'));
            var candId = String(fd.get('candidateBreakId') || '').trim();
            var rationale = String(fd.get('rationale') || '').trim();
            if (!candId || rationale.length < 10) throw new Error('Candidate ID and rationale (10+ chars) are required');
            return mx
              .post('/api/v1/recon/breaks/' + encodeURIComponent(apiId) + '/accept-candidate', {
                candidateBreakId: candId,
                cause: 'OTHER',
                rationale: rationale,
              })
              .then(function () {
                mx.toast('Candidate accepted', 'Match candidate linked to ' + ref + '.');
                return loadRecon();
              });
          },
        },
      ],
    });
  }

  function ensureReconExportButton() {
    var actions = document.querySelector('#page-reconciliations .v33-actions');
    if (!actions || actions.querySelector('[data-mx-recon-export]') || !liveRecon()) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'v33-btn';
    btn.setAttribute('data-mx-recon-export', '1');
    btn.textContent = 'Export breaks';
    actions.insertBefore(btn, actions.firstChild);
    btn.onclick = function () {
      mx.streamDownload('/api/v1/recon/breaks' + mx.qs({ format: 'csv', status: 'open' }), 'recon-breaks.csv')
        .then(function () {
          mx.toast('Breaks exported', 'Open breaks CSV downloaded from the server.');
        })
        .catch(mx.fail);
    };
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
      apiStatus: b.status,
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

  function clearReconKpis() {
    ['v33ReconMatch', 'v33ReconOpen', 'v33ReconUnmatched', 'v33ReconOldest', 'v33ReconSources', 'v33ReconReady'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.textContent = '—';
      var small = el.parentElement && el.parentElement.querySelector('small');
      if (small) small.textContent = 'Loading…';
    });
    var step = document.getElementById('v33ReconStepOpen');
    if (step) step.textContent = '— open breaks';
  }

  function parseDiffAmount(b) {
    var raw = b.difference || b.diff || '';
    if (typeof raw === 'number') return Math.abs(raw);
    var n = Number(String(raw).replace(/[^\d.-]/g, ''));
    return isNaN(n) ? 0 : Math.abs(n);
  }

  function updateKpis(overview, breaks) {
    var matchEl = document.getElementById('v33ReconMatch');
    var openEl = document.getElementById('v33ReconOpen');
    var unmatchedEl = document.getElementById('v33ReconUnmatched');
    var oldestEl = document.getElementById('v33ReconOldest');
    var sourcesEl = document.getElementById('v33ReconSources');
    var readyEl = document.getElementById('v33ReconReady');
    var openCount = breaks
      ? breaks.filter(function (b) {
          return b.state !== 'Closed';
        }).length
      : overview && overview.openTotal != null
        ? overview.openTotal
        : 0;
    if (matchEl && overview && overview.families && overview.families.length) {
      var matched = overview.families.reduce(function (a, f) {
        return a + Number(f.matched || 0);
      }, 0);
      var total = overview.families.reduce(function (a, f) {
        return a + Number(f.matched || 0) + Number(f.breaks || 0);
      }, 0);
      matchEl.textContent = total ? ((matched / total) * 100).toFixed(2) + '%' : '—';
      var matchSmall = matchEl.parentElement && matchEl.parentElement.querySelector('small');
      if (matchSmall) matchSmall.textContent = overview.asOfDate ? 'As of ' + overview.asOfDate : 'Across all daily controls';
    }
    if (openEl) {
      openEl.textContent = String(openCount);
      var openSmall = openEl.parentElement && openEl.parentElement.querySelector('small');
      if (openSmall && overview && overview.openBySeverity) {
        var mat = Number(overview.openBySeverity.CRITICAL || 0) + Number(overview.openBySeverity.HIGH || 0);
        openSmall.textContent = mat + ' material · ' + (overview.overdue || 0) + ' overdue';
      }
    }
    if (unmatchedEl && breaks) {
      var gross = breaks.reduce(function (a, b) {
        return a + parseDiffAmount(b);
      }, 0);
      unmatchedEl.textContent = gross ? 'US$ ' + gross.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 2 }) : '—';
      var unSmall = unmatchedEl.parentElement && unmatchedEl.parentElement.querySelector('small');
      if (unSmall) unSmall.textContent = gross ? 'Gross difference in queue' : 'No open variance';
    }
    if (oldestEl && breaks && breaks.length) {
      var oldest = breaks.reduce(function (max, b) {
        return Math.max(max, Number(b.age || 0));
      }, 0);
      oldestEl.textContent = oldest ? oldest.toFixed(1) + 'd' : '—';
      var oldSmall = oldestEl.parentElement && oldestEl.parentElement.querySelector('small');
      if (oldSmall) {
        var top = breaks.slice().sort(function (a, b) {
          return Number(b.age || 0) - Number(a.age || 0);
        })[0];
        oldSmall.textContent = top ? top.family + ' · ' + top.record : 'No open breaks';
      }
    }
    if (sourcesEl && overview && overview.families) {
      var families = overview.families.filter(function (f) {
        return f.runs > 0 || f.openBreaks > 0;
      });
      var missing = overview.families.filter(function (f) {
        return f.sourceMissing;
      }).length;
      var signed = overview.families.filter(function (f) {
        return f.signedOff;
      }).length;
      var denom = families.length || overview.families.length;
      sourcesEl.textContent = denom ? signed + ' / ' + denom : '—';
      var srcSmall = sourcesEl.parentElement && sourcesEl.parentElement.querySelector('small');
      if (srcSmall) srcSmall.textContent = missing ? missing + ' source file(s) missing' : 'All sources received';
    }
    if (readyEl && overview) {
      var blockers = Number(overview.openBySeverity && overview.openBySeverity.CRITICAL) + Number(overview.overdue || 0);
      readyEl.textContent = blockers ? 'Conditional' : openCount ? 'Review' : 'Ready';
      var readySmall = readyEl.parentElement && readyEl.parentElement.querySelector('small');
      if (readySmall) {
        readySmall.textContent = blockers
          ? blockers + ' blocker(s) before sign-off'
          : openCount
            ? openCount + ' open break(s) remain'
            : 'No material blockers';
      }
    }
    var step = document.getElementById('v33ReconStepOpen');
    if (step) step.textContent = openCount + ' open break' + (openCount === 1 ? '' : 's');
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
      ensureReconExportButton();
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

  function activeBreakRef() {
    var card = document.querySelector('#v33BreakDetail .v33-kicker');
    return card ? card.textContent.split(' · ')[0].trim() : null;
  }

  function postBreakAction(ref, action, body) {
    var apiId = breakApiId(ref);
    if (!apiId) return Promise.reject(new Error('Break not found'));
    return mx.post('/api/v1/recon/breaks/' + encodeURIComponent(apiId) + '/' + action, body || {}).then(function () {
      return loadRecon();
    });
  }

  function reasonDrawer(title, minLen) {
    minLen = minLen || 5;
    return new Promise(function (resolve) {
      if (typeof openDrawer !== 'function') {
        resolve(null);
        return;
      }
      openDrawer({
        eyebrow: 'REASON REQUIRED',
        title: title || 'Reason for this change',
        subtitle: 'Recorded in the audit trail.',
        body:
          '<form id="mxReasonForm"><label class="detail-field"><span>Note</span><textarea id="mxReasonText" required rows="3" style="width:100%"></textarea></label><div class="form-actions"><button type="button" class="btn secondary" id="mxReasonCancel">Cancel</button><button type="submit" class="btn primary">Continue</button></div></form>',
      });
      document.getElementById('mxReasonCancel').onclick = function () {
        closeDrawer();
        resolve(null);
      };
      document.getElementById('mxReasonForm').onsubmit = function (e) {
        e.preventDefault();
        var t = document.getElementById('mxReasonText').value.trim();
        if (t.length < minLen) {
          mx.toast('Note required', 'Need at least ' + minLen + ' characters.', 'warn');
          return;
        }
        closeDrawer();
        resolve(t);
      };
    });
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

  function openReconRulesModal() {
    return Promise.all([
      getEnvelope('/api/v1/recon/tolerances'),
      getEnvelope('/api/v1/recon/account-map'),
      getEnvelope('/api/v1/recon/counterparties'),
      mx.get('/api/v1/portfolios').catch(function () {
        return [];
      }),
    ]).then(function (parts) {
      var tols = parts[0].data || parts[0] || [];
      var maps = parts[1].data || parts[1] || [];
      var cps = parts[2].data || parts[2] || [];
      var pfs = Array.isArray(parts[3]) ? parts[3] : parts[3].data || [];
      var tolHtml =
        tols.length
          ? '<div class="v35-list">' +
            tols
              .slice(0, 15)
              .map(function (t) {
                return (
                  '<div class="v35-row"><span><strong>' +
                  mx.esc(t.familyLabel || t.family) +
                  '</strong><small>' +
                  mx.esc(t.effectiveFrom) +
                  (t.counterparty ? ' · ' + mx.esc(t.counterparty.name) : '') +
                  '</small></span><em>' +
                  mx.esc([t.price, t.cash, t.holdingsPct, t.positionQty].filter(Boolean).join(' / ') || '—') +
                  '</em></div>'
                );
              })
              .join('') +
            '</div>'
          : '<p>No tolerance rows configured yet.</p>';
      var mapHtml =
        maps.length
          ? '<div class="v35-list">' +
            maps
              .slice(0, 15)
              .map(function (m) {
                return (
                  '<div class="v35-row"><span><strong>' +
                  mx.esc(m.counterparty.name) +
                  ' · ' +
                  mx.esc(m.accountRef) +
                  '</strong><small>' +
                  mx.esc(m.portfolio.name || m.portfolio.ref || '') +
                  '</small></span></div>'
                );
              })
              .join('') +
            '</div>'
          : '<p>No account mappings yet.</p>';
      mx.modal({
        eyebrow: 'RECONCILIATION',
        title: 'Rules, tolerances & custodian feeds',
        subtitle: 'Effective-dated tolerances, account mapping and custody uploads.',
        wide: true,
        body:
          '<section class="detail-section"><h3>Effective tolerances</h3>' +
          tolHtml +
          (mx.can('recon.signoff')
            ? '<form id="mxReconTol" class="v34-form" style="margin-top:12px"><label class="v34-field"><span>Family</span><select class="v34-select" name="family"><option value="TRADES">Trades</option><option value="CASH">Cash</option><option value="HOLDINGS">Holdings</option><option value="SETTLEMENT_FAILS">Settlement</option><option value="CORP_ACTIONS">Corporate actions</option></select></label><label class="v34-field"><span>Effective from</span><input class="v34-input" type="date" name="effectiveFrom" required min="' +
              new Date().toISOString().slice(0, 10) +
              '"></label><label class="v34-field"><span>Price tol</span><input class="v34-input" name="price" placeholder="0.01"></label><label class="v34-field"><span>Cash tol</span><input class="v34-input" name="cash" placeholder="100"></label><label class="v34-field v34-wide"><span>Note</span><input class="v34-input" name="note"></label></form>'
            : '') +
          '</section><section class="detail-section"><h3>Account map</h3>' +
          mapHtml +
          (mx.can('recon.manage')
            ? '<form id="mxReconMap" class="v34-form" style="margin-top:12px"><label class="v34-field"><span>Counterparty</span><select class="v34-select" name="counterpartyId" required>' +
              cps
                .map(function (c) {
                  return '<option value="' + mx.esc(c.id) + '">' + mx.esc(c.name) + '</option>';
                })
                .join('') +
              '</select></label><label class="v34-field"><span>Account ref</span><input class="v34-input" name="accountRef" required></label><label class="v34-field"><span>Portfolio</span><select class="v34-select" name="portfolioId" required>' +
              pfs
                .map(function (p) {
                  return '<option value="' + mx.esc(p.id) + '">' + mx.esc(p.name) + ' (' + mx.esc(p.ref) + ')</option>';
                })
                .join('') +
              '</select></label></form>'
            : '') +
          '</section>' +
          (mx.can('recon.manage')
            ? '<section class="detail-section"><h3>Custodian positions feed</h3><form id="mxReconFeed" class="v34-form"><label class="v34-field"><span>Counterparty</span><select class="v34-select" name="counterpartyId" required>' +
              cps
                .map(function (c) {
                  return '<option value="' + mx.esc(c.id) + '">' + mx.esc(c.name) + '</option>';
                })
                .join('') +
              '</select></label><label class="v34-field"><span>Account ref</span><input class="v34-input" name="accountRef" required></label><label class="v34-field"><span>As-of date</span><input class="v34-input" type="date" name="asOfDate" required value="' +
              new Date().toISOString().slice(0, 10) +
              '"></label><label class="v34-field v34-wide"><span>CSV file</span><input class="v34-input" type="file" name="file" accept=".csv,.txt" required></label></form></section><section class="detail-section"><h3>Connector import</h3><p class="ops-muted">Pull positions from the configured custodian adapter when available.</p><form id="mxReconConnector" class="v34-form"><label class="v34-field"><span>Counterparty</span><select class="v34-select" name="counterpartyId" required>' +
              cps
                .map(function (c) {
                  return '<option value="' + mx.esc(c.id) + '">' + mx.esc(c.name) + '</option>';
                })
                .join('') +
              '</select></label><label class="v34-field"><span>Account ref</span><input class="v34-input" name="accountRef" required></label><label class="v34-field"><span>As-of date</span><input class="v34-input" type="date" name="asOfDate" required value="' +
              new Date().toISOString().slice(0, 10) +
              '"></label><label class="v34-field v34-wide"><span>Note</span><input class="v34-input" name="note" placeholder="Optional import note"></label></form></section>'
            : ''),
        actions: [
          mx.can('recon.signoff')
            ? {
                label: 'Save tolerance',
                primary: true,
                run: function (m) {
                  var fd = new FormData(m.querySelector('#mxReconTol'));
                  var body = {
                    family: fd.get('family'),
                    effectiveFrom: fd.get('effectiveFrom'),
                    price: fd.get('price') || undefined,
                    cash: fd.get('cash') || undefined,
                    note: fd.get('note') || undefined,
                  };
                  return mx.post('/api/v1/recon/tolerances', body).then(function () {
                    mx.toast('Tolerance saved', String(body.family));
                    return openReconRulesModal();
                  });
                },
              }
            : null,
          mx.can('recon.manage')
            ? {
                label: 'Save account map',
                run: function (m) {
                  var fd = new FormData(m.querySelector('#mxReconMap'));
                  return mx
                    .put('/api/v1/recon/account-map', {
                      counterpartyId: fd.get('counterpartyId'),
                      accountRef: String(fd.get('accountRef') || '').trim(),
                      portfolioId: fd.get('portfolioId'),
                    })
                    .then(function () {
                      mx.toast('Account mapped', String(fd.get('accountRef')));
                      return openReconRulesModal();
                    });
                },
              }
            : null,
          mx.can('recon.manage')
            ? {
                label: 'Upload custody file',
                run: function (m) {
                  var form = m.querySelector('#mxReconFeed');
                  var fd = new FormData(form);
                  var file = form.querySelector('[name=file]').files[0];
                  if (!file) throw new Error('Choose a custody CSV file.');
                  var upload = new FormData();
                  upload.append('counterpartyId', fd.get('counterpartyId'));
                  upload.append('accountRef', fd.get('accountRef'));
                  upload.append('asOfDate', fd.get('asOfDate'));
                  upload.append('file', file, file.name);
                  return mx.post('/api/v1/recon/custody-positions', upload).then(function (r) {
                    mx.toast('Custody feed received', (r.rows || 0) + ' row(s) loaded.');
                  });
                },
              }
            : null,
          mx.can('recon.manage')
            ? {
                label: 'Pull from connector',
                run: function (m) {
                  var form = m.querySelector('#mxReconConnector');
                  if (!form) throw new Error('Connector form unavailable.');
                  var fd = new FormData(form);
                  var body = {
                    counterpartyId: fd.get('counterpartyId'),
                    accountRef: String(fd.get('accountRef') || '').trim(),
                    asOfDate: fd.get('asOfDate'),
                    note: String(fd.get('note') || '').trim() || undefined,
                  };
                  return mx.post('/api/v1/recon/connector-imports', body).then(
                    function (r) {
                      var data = r.data || r;
                      mx.toast(
                        'Connector import received',
                        (data.connector || 'Adapter') + ' · ' + (data.rows || 0) + ' row(s)',
                      );
                      return loadRecon();
                    },
                    function (err) {
                      if (err && (err.status === 503 || err.code === 'adapter_unavailable')) {
                        mx.toast('Connector unavailable', 'Configure a custodian feed adapter for this counterparty.', 'warn');
                        return;
                      }
                      return mx.fail(err);
                    },
                  );
                },
              }
            : null,
          { label: 'Close', run: function () {} },
        ].filter(Boolean),
      });
    });
  }

  function attachBreakEvidence(ref) {
    var apiId = breakApiId(ref);
    if (!apiId) return Promise.resolve();
    return pickFile().then(function (file) {
      if (!file) return;
      var fd = new FormData();
      fd.append('file', file, file.name);
      return mx.post('/api/v1/recon/breaks/' + encodeURIComponent(apiId) + '/evidence', fd).then(function () {
        mx.toast('Evidence attached', file.name);
        return loadRecon();
      });
    });
  }

  function reopenBreak(ref) {
    return reasonDrawer('Reopen ' + ref + ' (10+ characters)', 10).then(function (note) {
      if (!note) return;
      return postBreakAction(ref, 'reopen', { reason: note, revokeSignoff: true }).then(function () {
        mx.toast('Break reopened', ref + ' is active again.');
      });
    });
  }

  function patchV33ReconActions() {
    if (!liveRecon()) return;
    var ref = activeBreakRef();
    if (!ref || !breakApiId(ref)) return;
    var toolbar = document.querySelector('#v33BreakDetail .v33-span-7 .v33-card-body div[style*="flex"]');
    if (!toolbar) return;
    var br = (window.__mxData._reconBreaks33 || []).find(function (b) {
      return b.id === ref;
    });
    if (!toolbar.querySelector('[data-mx-recon-assign]') && mx.can('recon.manage')) {
      ['assign', 'investigate', 'escalate'].forEach(function (kind) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'v33-btn';
        btn.setAttribute('data-mx-recon-' + kind, '1');
        btn.textContent = kind === 'assign' ? 'Assign to me' : kind === 'investigate' ? 'Start investigation' : 'Escalate';
        toolbar.appendChild(btn);
      });
      var evBtn = document.createElement('button');
      evBtn.type = 'button';
      evBtn.className = 'v33-btn';
      evBtn.setAttribute('data-mx-recon-evidence', '1');
      evBtn.textContent = 'Attach evidence';
      toolbar.appendChild(evBtn);
    }
    if (!toolbar.querySelector('[data-mx-recon-reopen]') && mx.can('recon.signoff') && br && (br.apiStatus === 'CLOSED' || br.apiStatus === 'MATCHED')) {
      var reopenBtn = document.createElement('button');
      reopenBtn.type = 'button';
      reopenBtn.className = 'v33-btn';
      reopenBtn.setAttribute('data-mx-recon-reopen', '1');
      reopenBtn.textContent = 'Reopen break';
      toolbar.appendChild(reopenBtn);
      reopenBtn.onclick = function (ev) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        reopenBreak(ref).catch(mx.fail);
      };
    }
    if (!mx.can('recon.manage')) return;
    toolbar.querySelector('[data-mx-recon-assign]').onclick = function (ev) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (!mx.user || !mx.user.id) {
        mx.toast('Sign in required', 'Reload the workspace to continue.', 'error');
        return;
      }
      postBreakAction(ref, 'assign', { ownerUserId: mx.user.id })
        .then(function () {
          mx.toast('Break assigned', ref + ' assigned to you.');
        })
        .catch(mx.fail);
    };
    toolbar.querySelector('[data-mx-recon-investigate]').onclick = function (ev) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      reasonDrawer('Investigation note for ' + ref).then(function (note) {
        if (!note) return;
        postBreakAction(ref, 'investigate', { note: note })
          .then(function () {
            mx.toast('Investigation started', ref + ' is now under active review.');
          })
          .catch(mx.fail);
      });
    };
    var evAttach = toolbar.querySelector('[data-mx-recon-evidence]');
    if (evAttach) {
      evAttach.onclick = function (ev) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        attachBreakEvidence(ref).catch(mx.fail);
      };
    }
    toolbar.querySelector('[data-mx-recon-escalate]').onclick = function (ev) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (!mx.user || !mx.user.id) {
        mx.toast('Sign in required', 'Reload the workspace to continue.', 'error');
        return;
      }
      mx.modal({
        eyebrow: 'RECONCILIATION',
        title: 'Escalate ' + ref,
        subtitle: 'Hand the break to a senior resolver with a recorded reason.',
        body:
          '<form id="mxReconEscForm"><label class="detail-field"><span>Level</span><select name="level" class="v34-input"><option value="1">Level 1</option><option value="2">Level 2</option><option value="3">Level 3</option></select></label><label class="detail-field"><span>Reason</span><textarea name="reason" class="v34-input" rows="3" required></textarea></label></form>',
        actions: [
          {
            label: 'Escalate',
            primary: true,
            run: function (m) {
              var fd = new FormData(m.querySelector('#mxReconEscForm'));
              var reason = String(fd.get('reason') || '').trim();
              if (reason.length < 5) throw new Error('Give a reason (5+ characters).');
              return postBreakAction(ref, 'escalate', {
                toUserId: mx.user.id,
                level: Number(fd.get('level') || 1),
                reason: reason,
              }).then(function () {
                mx.toast('Break escalated', ref + ' escalated with audit trail.');
              });
            },
          },
        ],
      });
    };
  }

  mx.wrapGlobal('renderBreakDetail', function (original) {
    original.apply(this, arguments);
    setTimeout(patchV33ReconActions, 0);
  });

  mx.onLoad('operations.view', function () {
    if (!document.getElementById('page-reconciliations')) return Promise.resolve();
    if (liveRecon()) clearReconKpis();
    return loadRecon();
  });

  mx.hydrate('reconciliations', function () {
    if (!liveRecon()) return Promise.resolve();
    clearReconKpis();
    return loadRecon();
  });

  window.addEventListener('matanho:legacy-ready', function () {
    document.addEventListener(
      'click',
      function (e) {
        if (!liveRecon()) return;
        if (e.target.closest && e.target.closest('#v33ReconRules')) {
          e.preventDefault();
          e.stopImmediatePropagation();
          openReconRulesModal().catch(mx.fail);
          return;
        }
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
        if (e.target.closest && e.target.closest('#v33ReconQuery')) {
          var refQ = activeBreakRef();
          if (!refQ || !breakApiId(refQ)) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          openBreakQueryModal(refQ, breakApiId(refQ));
          return;
        }
        if (e.target.closest && e.target.closest('[data-recon-v12="assign"]')) {
          var btn = e.target.closest('[data-recon-v12="assign"]');
          var refA = btn && btn.dataset.id;
          if (!refA || !breakApiId(refA) || !mx.user || !mx.user.id) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          postBreakAction(refA, 'assign', { ownerUserId: mx.user.id })
            .then(function () {
              mx.toast('Break assigned', refA + ' assigned to you.');
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
          openAcceptCandidateModal(ref, apiId);
        }
      },
      true,
    );
  });
})();
