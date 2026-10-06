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

  function toggleCaDemoPanels(live) {
    document.querySelectorAll('#page-corporate-actions .v15-demo-only').forEach(function (el) {
      el.style.display = live ? 'none' : '';
    });
  }

  function clearCaChrome() {
    document.querySelectorAll('#page-corporate-actions .v15-statebar strong').forEach(function (el) {
      el.textContent = '—';
      el.className = '';
    });
    document.querySelectorAll('#page-corporate-actions .v15-statebar small').forEach(function (el) {
      el.textContent = 'Loading…';
    });
    var dl = document.getElementById('v15CaDeadlines');
    if (dl) dl.innerHTML = '<p class="ops-muted" style="padding:12px">Loading…</p>';
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

  function updateStateBar(summary, mapped) {
    if (!summary && !mapped) return;
    var bar = document.querySelector('#page-corporate-actions .v15-statebar');
    if (!bar) return;
    var cells = bar.querySelectorAll('div');
    mapped = mapped || [];
    var elective = mapped.filter(function (e) {
      return e.raw && e.raw.electionOpen;
    });
    var openCount =
      (summary && summary.upcoming + summary.awaitingConfirmation + summary.awaitingProcessing + summary.processed) || mapped.length;
    var processed = (summary && summary.processed) || mapped.filter(function (e) {
      return e.raw && e.raw.status === 'PROCESSED';
    }).length;
    var stp = openCount ? Math.round((processed / openCount) * 1000) / 10 : 0;
    if (cells[0]) {
      cells[0].querySelector('strong').textContent = String(openCount);
      cells[0].querySelector('small').textContent = elective.length + ' require election';
    }
    if (cells[1]) {
      var strong = cells[1].querySelector('strong');
      strong.textContent = String(elective.length);
      strong.className = elective.length ? 'attention-text' : '';
      cells[1].querySelector('small').textContent = elective.length ? 'Election window open' : 'No open elections';
    }
    if (cells[2]) {
      cells[2].querySelector('strong').textContent = '—';
      cells[2].querySelector('small').textContent = 'From entitlement projections';
    }
    if (cells[3]) {
      cells[3].querySelector('strong').textContent = '—';
      cells[3].querySelector('small').textContent = 'From reconciliation feed';
    }
    if (cells[4]) {
      cells[4].querySelector('strong').textContent = String((summary && summary.awaitingConfirmation) || 0);
      cells[4].querySelector('small').textContent = 'Awaiting confirmation';
    }
    if (cells[5]) {
      cells[5].querySelector('strong').textContent = openCount ? stp + '%' : '—';
      cells[5].querySelector('small').textContent = processed + ' processed';
    }
  }

  function patchDeadlineSidebar(mapped) {
    var host = document.getElementById('v15CaDeadlines');
    if (!host) return;
    var elective = (mapped || [])
      .filter(function (e) {
        return e.raw && e.raw.electionOpen;
      })
      .slice(0, 6);
    if (!elective.length) {
      host.innerHTML = '<p class="ops-muted" style="padding:12px">No open elections.</p>';
      return;
    }
    host.innerHTML = elective
      .map(function (e, i) {
        var tone = i === 0 ? 'critical' : i === 1 ? 'warn' : 'info';
        return (
          '<button data-v15-ca="' +
          mx.esc(e.id) +
          '"><i class="' +
          tone +
          '">' +
          (i + 1) +
          '</i><span><strong>' +
          mx.esc(e.event) +
          '</strong><small>' +
          mx.esc(e.security) +
          ' · ' +
          mx.esc(e.date) +
          '</small></span><em>' +
          mx.esc(e.state) +
          '</em></button>'
        );
      })
      .join('');
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
      var summary = parts[0].summary || {};
      updateStateBar(summary, mapped);
      patchDeadlineSidebar(mapped);
      applyEvents(mapped);
      mx.data.corporateActions = mapped;
    });
  }

  function eventApiId(ref) {
    return eventByRef[ref];
  }

  function openNewEventModal() {
    mx.get('/api/v1/securities?limit=30').then(function (body) {
      var secs = body.data || body || [];
      var opts = (Array.isArray(secs) ? secs : secs.data || [])
        .map(function (s) {
          return '<option value="' + mx.esc(s.id) + '">' + mx.esc(s.ticker || s.name) + '</option>';
        })
        .join('');
      var today = new Date().toISOString().slice(0, 10);
      mx.modal({
        eyebrow: 'CORPORATE ACTIONS',
        title: 'New corporate action',
        body:
          '<form id="mxNewCa"><label class="v34-field"><span>Security</span><select class="v34-select" name="securityId">' +
          opts +
          '</select></label><label class="v34-field"><span>Type</span><select class="v34-select" name="type"><option value="CASH_DIVIDEND">Cash dividend</option><option value="SCRIP_DIVIDEND">Scrip dividend</option><option value="STOCK_SPLIT">Stock split</option><option value="RIGHTS_ISSUE">Rights issue</option></select></label><label class="v34-field"><span>Ex-date</span><input class="v34-input" name="exDate" type="date" value="' +
          today +
          '"></label><label class="v34-field"><span>Record date</span><input class="v34-input" name="recordDate" type="date" value="' +
          today +
          '"></label><label class="v34-field"><span>Pay date</span><input class="v34-input" name="payDate" type="date" value="' +
          today +
          '"></label><label class="v34-field"><span>Description</span><input class="v34-input" name="description"></label></form>',
        actions: [
          { label: 'Cancel', run: function () {} },
          {
            label: 'Create event',
            primary: true,
            run: function (m) {
              var fd = new FormData(m.querySelector('#mxNewCa'));
              return mx
                .post('/api/v1/corporate-actions/events', {
                  securityId: fd.get('securityId'),
                  type: fd.get('type'),
                  exDate: fd.get('exDate'),
                  recordDate: fd.get('recordDate'),
                  payDate: fd.get('payDate'),
                  description: fd.get('description') || undefined,
                })
                .then(function () {
                  mx.toast('Event created', 'Corporate action announced.');
                  return loadCorporateActions();
                });
            },
          },
        ],
      });
    }, mx.fail);
  }

  function openEventDrawer(ref) {
    var apiId = eventApiId(ref);
    if (!apiId) return;
    mx.get('/api/v1/corporate-actions/events/' + encodeURIComponent(apiId)).then(function (body) {
      var ev = body.data || body;
      var allowed = ev.allowed || {};
      var actions = [];
      if (allowed.confirm) {
        actions.push({
          label: 'Confirm announced',
          primary: true,
          run: function () {
            return mx.post('/api/v1/corporate-actions/events/' + encodeURIComponent(apiId) + '/confirm', {}).then(function () {
              mx.toast('Event confirmed', ref);
              return loadCorporateActions();
            });
          },
        });
      }
      if (allowed.calculateEntitlements) {
        actions.push({
          label: 'Project entitlements',
          run: function () {
            return mx.post('/api/v1/corporate-actions/events/' + encodeURIComponent(apiId) + '/entitlements/calculate', {}).then(function () {
              mx.toast('Entitlements projected', ev.ticker || ref);
              return loadCorporateActions();
            });
          },
        });
      }
      if (allowed.instruct) {
        actions.push({
          label: 'Instruct custodian',
          run: function () {
            return mx.post('/api/v1/corporate-actions/events/' + encodeURIComponent(apiId) + '/instruct', {}).then(function () {
              mx.toast('Instructions sent', ref);
              return loadCorporateActions();
            });
          },
        });
      }
      if (allowed.process && mx.can('corporate_actions.process')) {
        actions.push({
          label: 'Process event',
          primary: true,
          run: function () {
            return mx.post('/api/v1/corporate-actions/events/' + encodeURIComponent(apiId) + '/process', {}, { stepUp: true }).then(function () {
              mx.toast('Event processed', ref + ' applied to positions and cash.');
              return loadCorporateActions();
            });
          },
        });
      }
      if (allowed.reconcile) {
        actions.push({
          label: 'Reconcile',
          run: function () {
            return mx.post('/api/v1/corporate-actions/events/' + encodeURIComponent(apiId) + '/reconcile', {}).then(function () {
              mx.toast('Event reconciled', ref);
              return loadCorporateActions();
            });
          },
        });
      }
      if (allowed.reverse && mx.can('corporate_actions.process')) {
        actions.push({
          label: 'Reverse',
          run: function () {
            mx.reasonModal({
              eyebrow: 'CORPORATE ACTIONS',
              title: 'Reverse event',
              subtitle: ref,
              label: 'Reason for reversal',
              minLength: 5,
              confirmLabel: 'Reverse',
              onConfirm: function (reason) {
                return mx.post('/api/v1/corporate-actions/events/' + encodeURIComponent(apiId) + '/reverse', { reason: reason }, { stepUp: true }).then(function () {
                  mx.toast('Event reversed', ref);
                  return loadCorporateActions();
                });
              },
            });
            return false;
          },
        });
      }
      if (allowed.cancel) {
        actions.push({
          label: 'Cancel event',
          run: function () {
            mx.reasonModal({
              eyebrow: 'CORPORATE ACTIONS',
              title: 'Cancel event',
              subtitle: ref,
              label: 'Cancellation reason',
              minLength: 5,
              confirmLabel: 'Cancel event',
              onConfirm: function (reason) {
                return mx.post('/api/v1/corporate-actions/events/' + encodeURIComponent(apiId) + '/cancel', { reason: reason }).then(function () {
                  mx.toast('Event cancelled', ref);
                  return loadCorporateActions();
                });
              },
            });
            return false;
          },
        });
      }
      if (ev.electionOpen) {
        actions.push({
          label: 'Record election',
          run: function () {
            return mx.get('/api/v1/portfolios?limit=50').then(function (body) {
              var ports = body.data || body || [];
              var opts =
                '<option value="CASH">Cash</option><option value="SCRIP">Scrip / reinvest</option><option value="SELL">Sell rights</option>';
              var portOpts = ports
                .map(function (p) {
                  return '<option value="' + mx.esc(p.id) + '">' + mx.esc(p.name) + '</option>';
                })
                .join('');
              mx.modal({
                eyebrow: 'CORPORATE ACTION · ELECTION',
                title: 'Record portfolio election',
                body:
                  '<form id="mxCaElection"><label class="v34-field"><span>Portfolio</span><select class="v34-select" name="portfolioId" required>' +
                  portOpts +
                  '</select></label><label class="v34-field"><span>Option</span><select class="v34-select" name="option">' +
                  opts +
                  '</select></label></form>',
                actions: [
                  { label: 'Cancel', run: function () {} },
                  {
                    label: 'Save election',
                    primary: true,
                    run: function (m) {
                      var fd = new FormData(m.querySelector('#mxCaElection'));
                      return mx
                        .put('/api/v1/corporate-actions/events/' + encodeURIComponent(apiId) + '/elections', {
                          portfolioId: fd.get('portfolioId'),
                          option: fd.get('option') || 'CASH',
                        })
                        .then(function () {
                          mx.toast('Election recorded', ref);
                          return loadCorporateActions();
                        });
                    },
                  },
                ],
              });
            });
          },
        });
      }
      mx.modal({
        eyebrow: 'CORPORATE ACTION · ' + ref,
        title: ev.description || ev.type || 'Event',
        subtitle: (ev.ticker || '') + ' · ' + (ev.status || '') + ' · ex ' + mx.date(ev.exDate),
        wide: true,
        body:
          '<p>' +
          mx.esc(ev.description || 'Controlled corporate action with maker-checker on processing.') +
          '</p><p class="ops-muted">Entitlements: ' +
          String(ev.entitlementCount || 0) +
          ' · Elected: ' +
          String(ev.electedCount || 0) +
          '</p>',
        actions: actions.length ? actions : [{ label: 'Close', run: function () {} }],
      });
    }, mx.fail);
  }

  mx.openCorpActionDrawer = openEventDrawer;

  mx.onLoad('operations.view', function () {
    if (!document.getElementById('page-corporate-actions')) return Promise.resolve();
    if (liveCa()) {
      clearCaChrome();
      toggleCaDemoPanels(true);
    }
    return loadCorporateActions();
  });

  mx.hydrate('corporate-actions', function () {
    if (!liveCa()) return Promise.resolve();
    clearCaChrome();
    toggleCaDemoPanels(true);
    return loadCorporateActions();
  });

  window.addEventListener('matanho:legacy-ready', function () {
    if (liveCa()) toggleCaDemoPanels(true);
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
          openNewEventModal();
          return;
        }
        var openBtn = e.target.closest && e.target.closest('[data-v15-ca]');
        if (openBtn) {
          e.preventDefault();
          e.stopImmediatePropagation();
          openEventDrawer(openBtn.getAttribute('data-v15-ca'));
        }
      },
      true,
    );
  });
})();
