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
    return facilities.map(function (f) {
      var committed = Number(f.limitAmount || 0);
      var drawn = Number(f.margin && f.margin.drawn ? f.margin.drawn : 0);
      return [
        (f.lender || f.name) + ' · ' + f.name,
        committed,
        drawn,
        committed - drawn,
        Number(f.ratePct || 0).toFixed(2) + '%',
        f.poolName || 'Collateral pool',
        facilityState(f.status),
      ];
    });
  }

  function updateFinancingKpis(fin52) {
    var committed = fin52.facilities.reduce(function (a, x) {
      return a + x.committed;
    }, 0);
    var drawn = fin52.facilities.reduce(function (a, x) {
      return a + x.drawn;
    }, 0);
    var kpis = document.querySelectorAll('#page-financing .v33-kpi strong');
    if (kpis[0]) kpis[0].textContent = 'US$ ' + drawn.toFixed(2) + 'm';
    if (kpis[1]) kpis[1].textContent = 'US$ ' + (committed - drawn).toFixed(2) + 'm';
    if (kpis[2]) kpis[2].textContent = 'US$ ' + (fin52.margin.reduce(function (a, m) {
      return a + m.house;
    }, 0) || 4.18).toFixed(2) + 'm';
    if (kpis[3]) kpis[3].textContent = String(fin52.margin.filter(function (m) {
      return m.state !== 'Funded';
    }).length);
  }

  function applyFinancing(fin52, rows33) {
    window.__mxData = window.__mxData || {};
    window.__mxData._fin52 = fin52;
    window.__mxData._facilities33 = rows33;
    if (typeof fin52 !== 'undefined' && window.loadFin52) {
      try {
        window.fin52 = fin52;
      } catch (e) {}
    }
    updateFinancingKpis(fin52);
    if (typeof renderFacilities === 'function') renderFacilities();
    if (typeof renderFinancing52 === 'function') renderFinancing52();
  }

  function loadFinancing() {
    if (!mx.can('risk.view')) return Promise.resolve();
    return Promise.all([
      getEnvelope('/api/v1/financing/facilities'),
      getEnvelope('/api/v1/financing/margin-calls?status=OPEN&status=ACKNOWLEDGED&status=DISPUTED&limit=50'),
    ]).then(function (parts) {
      var facilities = parts[0].data || parts[0] || [];
      var calls = parts[1].data || parts[1] || [];
      facilityByRef = {};
      var fin52 = mapFin52(facilities, calls);
      applyFinancing(fin52, mapFacilities33(facilities));
      mx.data.financingFacilities = facilities;
    });
  }

  mx.onLoad('risk.view', function () {
    if (!document.getElementById('page-financing')) return Promise.resolve();
    return loadFinancing();
  });

  mx.hydrate('financing', function () {
    if (!liveFinancing()) return Promise.resolve();
    return loadFinancing();
  });

  window.addEventListener('matanho:legacy-ready', function () {
    document.addEventListener(
      'click',
      function (e) {
        if (!liveFinancing()) return;
        var drawBtn = e.target.closest && e.target.closest('#v52FacilityDraw, [data-v52-facility-draw]');
        if (drawBtn) {
          e.preventDefault();
          e.stopImmediatePropagation();
          mx.toast('Controlled movement', 'Use ops-native financing to post draws/repayments with maker-checker.');
          return;
        }
        var marginBtn = e.target.closest && e.target.closest('#v52ResolveMargin, #v52MarkFunded');
        if (marginBtn) {
          e.preventDefault();
          e.stopImmediatePropagation();
          mx.toast('Margin workflow', 'Acknowledge, dispute or resolve margin calls in ops-native with independent checker.');
        }
      },
      true,
    );

    mx.intercept(
      '#v33NewFacility, #v52AddFacility, #v52AddFacilityOverview',
      function () {
        mx.toast('New facility', 'Create facilities in ops-native with agreement evidence and maker-checker approval.');
        return false;
      },
      { when: liveFinancing },
    );
  });
})();
