/*
 * Collateral & Financing: facilities, margin calls, capacity KPIs.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var facilityByRef = {};

  function getEnvelope(path) {
    return fetch(mx.api + path, { credentials: 'include', headers: { Accept: 'application/json' } }).then(function (r) {
      return r.json();
    });
  }

  function liveFinancing() {
    return mx.live && mx.strict('financing');
  }

  function mMillions(v) {
    return Number(v || 0) / 1e6;
  }

  function facilityState(s) {
    if (s === 'ACTIVE') return 'Current';
    if (s === 'PENDING_APPROVAL' || s === 'SUSPENDED') return 'Review';
    return s || 'Current';
  }

  function marginState(c) {
    if (c.status === 'DISPUTED') return 'Disputed';
    if (c.status === 'ACKNOWLEDGED') return 'Due';
    if (c.status === 'RESOLVED' || c.status === 'FUNDED') return 'Funded';
    if (c.status === 'OPEN') return 'Due';
    return c.status || 'Due';
  }

  function mapFin52(facilities, calls) {
    return {
      facilities: facilities.map(function (f) {
        var ref = f.ref || f.id;
        facilityByRef[ref] = f.id;
        return {
          apiId: f.id,
          id: ref,
          provider: f.lender || f.name,
          name: f.name,
          committed: mMillions(f.limitAmount),
          drawn: mMillions(f.margin && f.margin.drawn),
          cost: Number(f.ratePct || 0),
          collateral: (f.poolName || 'Eligible collateral') + '',
          state: facilityState(f.status),
          source: 'Facility agreement · ' + (f.portfolioName || f.portfolioRef || 'portfolio'),
        };
      }),
      margin: calls.map(function (c) {
        return {
          apiId: c.id,
          id: c.ref || c.id,
          provider: c.lender || c.facilityName || 'Counterparty',
          call: mMillions(c.calledAmount),
          house: mMillions((c.current && c.current.counted) || c.eligibleValue),
          due: c.dueAt ? mx.date(c.dueAt) : '—',
          state: marginState(c),
          source: 'Margin call · ' + (c.facilityRef || ''),
        };
      }),
      imports: [],
    };
  }

  function mapFacilities33(facilities) {
    mx.data.facilityDisplayMap = {};
    return facilities.map(function (f) {
      var committed = Number(f.limitAmount || 0);
      var drawn = Number(f.margin && f.margin.drawn ? f.margin.drawn : 0);
      var label = (f.lender || f.name) + ' · ' + f.name;
      mx.data.facilityDisplayMap[label] = f.ref || f.id;
      return [
        label,
        committed,
        drawn,
        committed - drawn,
        Number(f.ratePct || 0).toFixed(2) + '%',
        f.poolName || 'Collateral pool',
        facilityState(f.status),
      ];
    });
  }

  function toggleFinancingDemoPanels(live) {
    document.querySelectorAll('#page-financing .mx-demo-only').forEach(function (el) {
      el.style.display = live ? 'none' : '';
    });
  }

  function clearFinancingKpis() {
    document.querySelectorAll('#page-financing .v33-kpi').forEach(function (k) {
      var s = k.querySelector('strong');
      var n = k.querySelector('small');
      if (s) s.textContent = '—';
      if (n) n.textContent = 'Loading…';
    });
  }

  function weightedRate(facilities) {
    var weighted = 0;
    var weight = 0;
    (facilities || []).forEach(function (f) {
      var drawn = Number(f.margin && f.margin.drawn ? f.margin.drawn : 0);
      var rate = Number(f.ratePct || 0);
      if (drawn > 0 && rate > 0) {
        weighted += drawn * rate;
        weight += drawn;
      }
    });
    return weight ? weighted / weight : null;
  }

  function collateralPosted(facilities) {
    var total = 0;
    (facilities || []).forEach(function (f) {
      if (f.margin && f.margin.counted != null) total += Number(f.margin.counted);
      else if (f.margin && f.margin.eligible != null) total += Number(f.margin.eligible);
    });
    return total;
  }

  function updateFinancingKpis(fin52, summary, facilities, calls) {
    var committed = fin52.facilities.reduce(function (a, x) {
      return a + x.committed;
    }, 0);
    var drawn = fin52.facilities.reduce(function (a, x) {
      return a + x.drawn;
    }, 0);
    var utilPct = committed ? Math.round((drawn / committed) * 100) : null;
    var collateral = collateralPosted(facilities);
    var openCalls = fin52.margin.filter(function (m) {
      return m.state !== 'Funded';
    });
    var callGross = openCalls.reduce(function (a, m) {
      return a + Number(m.call || 0);
    }, 0);
    var disputed = (calls || []).filter(function (c) {
      return c.status === 'DISPUTED';
    });
    var rate = weightedRate(facilities);
    var kpis = document.querySelectorAll('#page-financing .v33-kpi');
    if (kpis[0]) {
      kpis[0].querySelector('strong').textContent = 'US$ ' + drawn.toFixed(2) + 'm';
      kpis[0].querySelector('small').textContent = utilPct != null ? utilPct + '% of committed capacity' : 'No utilisation';
    }
    if (kpis[1]) {
      kpis[1].querySelector('strong').textContent = 'US$ ' + Math.max(0, committed - drawn).toFixed(2) + 'm';
      kpis[1].querySelector('small').textContent =
        (summary && summary.facilities != null ? summary.facilities : fin52.facilities.length) + ' active facilities';
    }
    if (kpis[2]) {
      kpis[2].querySelector('strong').textContent = collateral ? 'US$ ' + (collateral / 1e6).toFixed(2) + 'm' : '—';
      kpis[2].querySelector('small').textContent = collateral ? 'Eligible collateral counted' : 'No pool valuation';
    }
    if (kpis[3]) {
      kpis[3].querySelector('strong').textContent = String(openCalls.length);
      kpis[3].querySelector('small').textContent = callGross ? 'US$ ' + (callGross * 1e6).toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 2 }) + ' gross' : 'No open calls';
    }
    if (kpis[4]) {
      kpis[4].querySelector('strong').textContent = String(disputed.length);
      kpis[4].querySelector('small').textContent = disputed.length
        ? (disputed[0].lender || disputed[0].facilityName || 'Open dispute')
        : 'No disputed calls';
    }
    if (kpis[5]) {
      kpis[5].querySelector('strong').textContent = rate != null ? rate.toFixed(2) + '%' : '—';
      kpis[5].querySelector('small').textContent =
        summary && summary.overdueCalls ? summary.overdueCalls + ' overdue call(s)' : 'Draw-weighted facility rate';
    }
    if (liveFinancing()) {
      var optim = document.querySelector('#page-financing .v33-lane-grid');
      if (optim && optim.closest('.v33-card')) optim.closest('.v33-card').style.display = 'none';
      var curve = document.getElementById('v33FundingCurve');
      if (curve && curve.closest('.v33-card')) curve.closest('.v33-card').style.display = 'none';
    }
  }

  function applyFinancing(fin52, rows33, summary, facilities, calls) {
    window.__mxData = window.__mxData || {};
    window.__mxData._fin52 = fin52;
    window.__mxData._facilities33 = rows33;
    if (typeof fin52 !== 'undefined' && window.loadFin52) {
      try {
        window.fin52 = fin52;
      } catch (e) {}
    }
    updateFinancingKpis(fin52, summary, facilities, calls);
    if (typeof renderFacilities === 'function') renderFacilities();
    if (typeof renderFinancing52 === 'function') renderFinancing52();
    patchFacilityLifecycleButtons();
  }

  function loadFinancing() {
    if (!mx.can('risk.view')) return Promise.resolve();
    return Promise.all([
      getEnvelope('/api/v1/financing/summary').catch(function () {
        return null;
      }),
      getEnvelope('/api/v1/financing/facilities'),
      getEnvelope('/api/v1/financing/calls?status=OPEN,ACKNOWLEDGED,DISPUTED&limit=50'),
    ]).then(function (parts) {
      var summary = parts[0] && (parts[0].data || parts[0]);
      var facilities = parts[1].data || parts[1] || [];
      var calls = parts[2].data || parts[2] || [];
      facilityByRef = {};
      mapCallsForLookup(calls);
      var fin52 = mapFin52(facilities, calls);
      mx.data.financingSummary = summary;
      mx.data.financingFacilities = facilities;
      mx.data.financingCalls = calls;
      applyFinancing(fin52, mapFacilities33(facilities), summary, facilities, calls);
    });
  }

  mx.onLoad('risk.view', function () {
    if (!document.getElementById('page-financing')) return Promise.resolve();
    if (liveFinancing()) {
      clearFinancingKpis();
      toggleFinancingDemoPanels(true);
    }
    return loadFinancing();
  });

  mx.hydrate('financing', function () {
    if (!liveFinancing()) return Promise.resolve();
    clearFinancingKpis();
    toggleFinancingDemoPanels(true);
    return loadFinancing();
  });

  window.addEventListener('matanho:legacy-ready', function () {
    if (liveFinancing()) toggleFinancingDemoPanels(true);
  });

  function facilityRecord(ref) {
    return (mx.data.financingFacilities || []).find(function (f) {
      return (f.ref || f.id) === ref;
    });
  }

  function openFacilityLifecycleModal(ref) {
    var fac = facilityRecord(ref);
    var apiId = facilityByRef[ref] || (fac && fac.id);
    if (!apiId || !fac) {
      mx.toast('No facility', 'Select a facility row first.', 'warn');
      return;
    }
    var actions = [{ label: 'Close', run: function () {} }];
    if (mx.can('financing.manage') && (fac.status === 'DRAFT' || fac.status === 'PENDING_APPROVAL')) {
      actions.push({
        label: 'Submit for approval',
        primary: fac.status === 'DRAFT',
        run: function () {
          return mx.post('/api/v1/financing/facilities/' + encodeURIComponent(apiId) + '/submit', {}).then(function () {
            mx.toast('Facility submitted', ref + ' entered approval queue');
            return loadFinancing();
          });
        },
      });
    }
    if (mx.can('financing.approve') && fac.status === 'PENDING_APPROVAL') {
      actions.push({
        label: 'Approve facility',
        primary: true,
        run: function () {
          return mx.post('/api/v1/financing/facilities/' + encodeURIComponent(apiId) + '/approve', {}, { stepUp: true }).then(function () {
            mx.toast('Facility approved', ref + ' is now active');
            return loadFinancing();
          });
        },
      });
    }
    if (mx.can('financing.manage') && fac.status === 'ACTIVE') {
      actions.push({
        label: 'Draw',
        run: function () {
          openFacilityMovementModal(ref, 'DRAW');
        },
      });
      actions.push({
        label: 'Repay',
        run: function () {
          openFacilityMovementModal(ref, 'REPAY');
        },
      });
    }
    mx.modal({
      eyebrow: 'FINANCING · FACILITY',
      title: ref + ' · ' + (fac.name || 'Facility'),
      body:
        '<p class="ops-muted">Status <strong>' +
        mx.esc(fac.status) +
        '</strong> · limit ' +
        mx.esc(fac.currency || 'USD') +
        ' ' +
        mx.esc(String(fac.limitAmount || '0')) +
        '</p>',
      actions: actions,
    });
  }

  function patchFacilityLifecycleButtons() {
    if (!liveFinancing()) return;
    var host = document.getElementById('v33FacilityRows');
    if (!host) return;
    mx.$$('tr', host).forEach(function (row) {
      if (row.querySelector('[data-mx-fac-lifecycle]')) return;
      var refCell = row.querySelector('td strong');
      var label = refCell && refCell.textContent.trim();
      var ref = (mx.data.facilityDisplayMap && mx.data.facilityDisplayMap[label]) || null;
      if (!ref || !facilityByRef[ref]) return;
      row.style.cursor = 'pointer';
      row.setAttribute('data-mx-fac-lifecycle', ref);
    });
  }

  mx.wrapGlobal('renderFacilities', function (original) {
    var result = original.apply(this, arguments);
    patchFacilityLifecycleButtons();
    return result;
  });

  var lastFacilityRef = null;
  var callByRef = {};

  function mapCallsForLookup(calls) {
    callByRef = {};
    calls.forEach(function (c) {
      callByRef[c.ref || c.id] = c.id;
    });
  }

  function openFacilityMovementModal(ref, kind) {
    var apiId = facilityByRef[ref] || ref;
    if (!apiId) {
      mx.toast('No facility', 'Select a facility first.', 'warn');
      return;
    }
    mx.modal({
      eyebrow: 'FINANCING · ' + (kind === 'DRAW' ? 'DRAWDOWN' : 'REPAYMENT'),
      title: ref + ' · controlled movement',
      body:
        '<form id="mxFinMove"><label class="v34-field"><span>Amount</span><input class="v34-input" name="amount" type="number" step="0.01" min="0.01" required></label><label class="v34-field"><span>Note</span><input class="v34-input" name="note" maxlength="255"></label></form>',
      actions: [
        { label: 'Cancel', run: function () {} },
        {
          label: kind === 'DRAW' ? 'Post draw' : 'Post repayment',
          primary: true,
          run: function (m) {
            var fd = new FormData(m.querySelector('#mxFinMove'));
            var path = '/api/v1/financing/facilities/' + encodeURIComponent(apiId) + '/' + (kind === 'DRAW' ? 'draw' : 'repay');
            var opts = kind === 'DRAW' ? { stepUp: true } : {};
            return mx
              .post(path, { amount: String(fd.get('amount')), note: fd.get('note') || undefined }, opts)
              .then(function () {
                mx.toast(kind === 'DRAW' ? 'Draw posted' : 'Repayment posted', ref);
                return loadFinancing();
              });
          },
        },
      ],
    });
  }

  function openNewFacilityModal() {
    mx.get('/api/v1/portfolios?limit=20').then(function (body) {
      var ports = body.data || body || [];
      var opts = ports
        .map(function (p) {
          return '<option value="' + mx.esc(p.id) + '">' + mx.esc(p.name || p.ref) + '</option>';
        })
        .join('');
      mx.modal({
        eyebrow: 'FINANCING',
        title: 'New credit facility',
        body:
          '<form id="mxNewFacility"><label class="v34-field"><span>Name</span><input class="v34-input" name="name" required minlength="2"></label><label class="v34-field"><span>Lender</span><input class="v34-input" name="lender" required></label><label class="v34-field"><span>Portfolio</span><select class="v34-select" name="portfolioId">' +
          opts +
          '</select></label><label class="v34-field"><span>Type</span><select class="v34-select" name="type"><option value="MARGIN_LOAN">Margin loan</option><option value="REPO">Repo</option><option value="SEC_LENDING">Securities lending</option><option value="OVERDRAFT">Overdraft</option></select></label><label class="v34-field"><span>Limit amount</span><input class="v34-input" name="limitAmount" type="number" step="0.01" required></label><label class="v34-field"><span>Rate %</span><input class="v34-input" name="ratePct" type="number" step="0.01" value="5.5"></label></form>',
        actions: [
          { label: 'Cancel', run: function () {} },
          {
            label: 'Create facility',
            primary: true,
            run: function (m) {
              var fd = new FormData(m.querySelector('#mxNewFacility'));
              return mx
                .post('/api/v1/financing/facilities', {
                  name: fd.get('name'),
                  lender: fd.get('lender'),
                  portfolioId: fd.get('portfolioId'),
                  type: fd.get('type') || 'MARGIN_LOAN',
                  currency: 'USD',
                  limitAmount: String(fd.get('limitAmount')),
                  ratePct: String(fd.get('ratePct') || '0'),
                  initialRatio: '1.5',
                  maintenanceRatio: '1.25',
                })
                .then(function () {
                  mx.toast('Facility created', 'Draft facility saved; submit for approval when ready.');
                  return loadFinancing();
                });
            },
          },
        ],
      });
    }, mx.fail);
  }

  function openMarginCallModal(ref) {
    var apiId = callByRef[ref] || ref;
    mx.modal({
      eyebrow: 'FINANCING · MARGIN CALL',
      title: ref,
      body: '<p class="ops-muted">Acknowledge receipt, dispute with reason, or resolve when collateral is restored.</p>',
      actions: [
        {
          label: 'Acknowledge',
          run: function () {
            return mx.post('/api/v1/financing/calls/' + encodeURIComponent(apiId) + '/acknowledge', {}).then(function () {
              mx.toast('Call acknowledged', ref);
              return loadFinancing();
            });
          },
        },
        {
          label: 'Dispute',
          run: function () {
            mx.reasonModal({
              eyebrow: 'FINANCING · MARGIN CALL',
              title: 'Dispute call',
              subtitle: ref,
              label: 'Dispute reason',
              minLength: 5,
              confirmLabel: 'Dispute',
              onConfirm: function (reason) {
                return mx.post('/api/v1/financing/calls/' + encodeURIComponent(apiId) + '/dispute', { reason: reason }).then(function () {
                  mx.toast('Call disputed', ref);
                  return loadFinancing();
                });
              },
            });
            return false;
          },
        },
        {
          label: 'Resolve',
          primary: true,
          run: function () {
            mx.reasonModal({
              eyebrow: 'FINANCING · MARGIN CALL',
              title: 'Resolve call',
              subtitle: ref,
              label: 'Resolution note',
              minLength: 5,
              confirmLabel: 'Resolve',
              onConfirm: function (note) {
                return mx.post('/api/v1/financing/calls/' + encodeURIComponent(apiId) + '/resolve', { note: note }, { stepUp: true }).then(function () {
                  mx.toast('Call resolved', ref);
                  return loadFinancing();
                });
              },
            });
            return false;
          },
        },
        mx.can('financing.approve')
          ? {
              label: 'Waive',
              run: function () {
                mx.reasonModal({
                  eyebrow: 'FINANCING · MARGIN CALL',
                  title: 'Waive call',
                  subtitle: ref,
                  label: 'Waiver reason',
                  minLength: 5,
                  confirmLabel: 'Waive',
                  onConfirm: function (reason) {
                    return mx.post('/api/v1/financing/calls/' + encodeURIComponent(apiId) + '/waive', { reason: reason }, { stepUp: true }).then(function () {
                      mx.toast('Call waived', ref);
                      return loadFinancing();
                    });
                  },
                });
                return false;
              },
            }
          : null,
      ].filter(Boolean),
    });
  }

  mx.openFacilityMovementModal = openFacilityMovementModal;

  window.addEventListener('matanho:legacy-ready', function () {
    mx.gate('#v33NewFacility, #v52AddFacility, #v52AddFacilityOverview', 'financing.manage');
    mx.gate('#v52FacilityDraw, [data-v52-facility-draw]', 'financing.manage');

    document.addEventListener(
      'click',
      function (e) {
        if (!liveFinancing()) return;
        var facRow = e.target.closest && e.target.closest('[data-v52-facility], [data-v52-facility-bar]');
        if (facRow) {
          lastFacilityRef = facRow.getAttribute('data-v52-facility') || facRow.getAttribute('data-v52-facility-bar');
        }
        var drawBtn = e.target.closest && e.target.closest('#v52FacilityDraw, [data-v52-facility-draw]');
        if (drawBtn) {
          e.preventDefault();
          e.stopImmediatePropagation();
          var ref = lastFacilityRef || (window.__mxData._fin52 && window.__mxData._fin52.facilities[0] && window.__mxData._fin52.facilities[0].id);
          if (!ref) {
            mx.toast('No facility selected', 'Open a facility row first.', 'warn');
            return;
          }
          openFacilityMovementModal(ref, 'DRAW');
          return;
        }
        var facLife = e.target.closest && e.target.closest('[data-mx-fac-lifecycle]');
        if (facLife) {
          e.preventDefault();
          e.stopImmediatePropagation();
          openFacilityLifecycleModal(facLife.getAttribute('data-mx-fac-lifecycle'));
          return;
        }
        var marginBtn = e.target.closest && e.target.closest('#v52ResolveMargin, #v52MarkFunded, [data-v52-margin]');
        if (marginBtn) {
          e.preventDefault();
          e.stopImmediatePropagation();
          var mref = marginBtn.getAttribute('data-v52-margin') || (window.__mxData._fin52 && window.__mxData._fin52.margin[0] && window.__mxData._fin52.margin[0].id);
          if (!mref) {
            mx.toast('No margin call', 'No open margin calls.', 'warn');
            return;
          }
          openMarginCallModal(mref);
        }
      },
      true,
    );

    mx.intercept(
      '#v33NewFacility, #v52AddFacility, #v52AddFacilityOverview',
      function () {
        openNewFacilityModal();
        return false;
      },
      { when: liveFinancing },
    );
  });
})();
