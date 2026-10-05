/*
 * Research & IC: cases, valuation model, analyst notes and catalysts.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var caseByTicker = {};
  var securities = [];

  function getEnvelope(path) {
    return fetch(mx.api + path, { credentials: 'include', headers: { Accept: 'application/json' } }).then(function (r) {
      return r.json();
    });
  }

  function liveResearch() {
    return mx.live && mx.strict('research');
  }

  function ratingProto(r) {
    return (
      {
        BUY: 'Buy',
        ACCUMULATE: 'Accumulate',
        HOLD: 'Hold',
        REDUCE: 'Reduce',
        SELL: 'Sell',
      }[r] || r
    );
  }

  function convictionProto(n) {
    var c = Number(n);
    if (c >= 5) return 'A';
    if (c >= 4) return 'A-';
    if (c >= 3) return 'B+';
    if (c >= 2) return 'B';
    return 'C';
  }

  function marketFromTicker(t) {
    if (!t) return 'ZSE';
    if (t.indexOf('.VX') >= 0) return 'VFEX';
    return 'ZSE';
  }

  function avatar(t) {
    return (t || '??').replace('.ZW', '').replace('.VX', '').slice(0, 2).toUpperCase();
  }

  function clearEquityStore(store) {
    Object.keys(store).forEach(function (k) {
      delete store[k];
    });
  }

  function toEquityEntry(c, extra) {
    var ticker = c.ticker || c.ref;
    var val = extra && extra.valuation && extra.valuation.current;
    var inputs = val && val.inputs;
    var model = inputs
      ? {
          growth: Number(inputs.growthPct && inputs.growthPct.base != null ? inputs.growthPct.base : 10),
          margin: Number(inputs.marginPct && inputs.marginPct.base != null ? inputs.marginPct.base : 15),
          discount: Number(inputs.discountPct && inputs.discountPct.base != null ? inputs.discountPct.base : 17),
          target: Number(val.targetPrice || c.targetPrice || 0),
          recommendation: ratingProto(c.rating),
          conviction: convictionProto(c.conviction),
        }
      : {
          growth: 10,
          margin: 15,
          discount: 17,
          target: Number(c.targetPrice || 0),
          recommendation: ratingProto(c.rating),
          conviction: convictionProto(c.conviction),
        };
    return {
      apiCaseId: c.id,
      securityId: c.securityId,
      avatar: avatar(ticker),
      name: c.securityName || c.title,
      exchange: marketFromTicker(ticker),
      sector: c.sector || 'Equity',
      price: c.latestPrice ? c.currency + ' ' + c.latestPrice : '—',
      change: '—',
      asOf: c.publishedAt ? 'Published · ' + new Date(c.publishedAt).toLocaleDateString() : 'Research case',
      recommendation: ratingProto(c.rating),
      conviction: convictionProto(c.conviction),
      target: c.currency + ' ' + c.targetPrice,
      upside: c.upsidePct == null ? '—' : (Number(c.upsidePct) >= 0 ? '+' : '') + c.upsidePct + '%',
      market: marketFromTicker(ticker),
      period: (c.horizonMonths || 12) + ' month horizon',
      thesis: c.thesis || '',
      facts: [
        ['Case ref', c.ref, c.status],
        ['Rating', ratingProto(c.rating), 'Published view'],
        ['Analyst', c.analystName || '—', 'Case owner'],
        ['Target', c.currency + ' ' + c.targetPrice, 'Approved target'],
      ],
      financials: (extra && extra.financials ? extra.financials : []).map(function (f) {
        return [f.period, f.revenue != null ? String(f.revenue) : '—', f.source || 'Issuer'];
      }),
      readThrough: c.risks ? [c.risks] : ['Thesis and risks are maintained in the controlled research record.'],
      docs: (extra && extra.filings ? extra.filings : []).map(function (f) {
        return { title: f.title, date: f.filedOn || f.period || '—', source: f.source || 'Issuer', summary: f.title };
      }),
      model: model,
      valuationInputs: inputs,
      version: c.version,
    };
  }

  function toInlineResearch(c) {
    return {
      apiCaseId: c.id,
      ticker: c.ticker || c.ref,
      name: c.securityName || c.title,
      view: ratingProto(c.rating),
      score: convictionProto(c.conviction),
      target: c.upsidePct == null ? c.currency + ' ' + c.targetPrice : (Number(c.upsidePct) >= 0 ? '+' : '') + c.upsidePct + '%',
      owner: c.analystName || '—',
      review: c.publishedAt ? new Date(c.publishedAt).toLocaleDateString() : '—',
      tags: [c.sector || 'Equity', marketFromTicker(c.ticker)],
    };
  }

  function renderSummaryBar(summary) {
    var bar = document.querySelector('#page-research .research-sourcebar-v7');
    if (!bar || !summary) return;
    var cells = bar.querySelectorAll('div');
    if (cells[1]) cells[1].querySelector('strong').textContent = String(summary.cases ? summary.cases.published : 0) + ' published cases';
    if (cells[2]) cells[2].querySelector('strong').textContent = String(summary.openDecisions || 0) + ' open';
    if (cells[3]) cells[3].querySelector('strong').textContent = String(summary.awaitingRatification || 0);
    if (cells[4]) cells[4].querySelector('strong').textContent = String(summary.awaitingMyVote || summary.openDecisions || 0);
  }

  function syncResearchArrays(rows) {
    if (window.__mxData && window.__mxData._research && Array.isArray(window.__mxData._research)) {
      mx.replace(window.__mxData._research, rows.map(toInlineResearch));
      if (typeof renderResearch === 'function') renderResearch();
    }
  }

  function hydrateEquityStore(cases) {
    var store = window.__mxData && window.__mxData._equityResearch;
    if (!store) return Promise.resolve();
    clearEquityStore(store);
    caseByTicker = {};
    cases.forEach(function (c) {
      if (!c.ticker) return;
      caseByTicker[c.ticker] = c;
      store[c.ticker] = toEquityEntry(c);
    });
    syncResearchArrays(cases);
    if (typeof renderResearchList === 'function') renderResearchList();
    var first = cases.find(function (c) {
      return c.ticker && store[c.ticker];
    });
    if (first && typeof selectResearchSecurity === 'function') selectResearchSecurity(first.ticker);
    return Promise.resolve();
  }

  function loadIssuerDepth(ticker) {
    var c = caseByTicker[ticker];
    if (!c || !c.securityId) return Promise.resolve();
    return getEnvelope('/api/v1/research/issuers/' + encodeURIComponent(c.securityId)).then(function (body) {
      var d = body.data || body;
      var store = window.__mxData && window.__mxData._equityResearch;
      if (!store || !store[ticker]) return;
      store[ticker] = toEquityEntry(c, { financials: d.financials || [], filings: d.filings || [], valuation: d.valuation });
      if (typeof selectResearchSecurity === 'function') selectResearchSecurity(ticker);
    });
  }

  function loadResearch() {
    if (!mx.can('research.view')) return Promise.resolve();
    return Promise.all([
      getEnvelope('/api/v1/research/summary'),
      getEnvelope('/api/v1/research/cases?status=PUBLISHED&limit=100'),
      mx.get('/api/v1/securities?limit=200').catch(function () {
        return [];
      }),
    ]).then(function (res) {
      var summary = res[0].data || res[0];
      var cases = res[1].data || res[1];
      securities = Array.isArray(res[2]) ? res[2] : res[2].data || [];
      mx.data.researchSummary = summary;
      mx.data.researchCases = cases;
      renderSummaryBar(summary);
      return hydrateEquityStore(cases);
    });
  }

  function selectedTicker() {
    if (typeof selectedResearchTicker !== 'undefined') return selectedResearchTicker;
    return null;
  }

  function caseForTicker(ticker) {
    return caseByTicker[ticker];
  }

  function triple(v) {
    var n = Number(v);
    return { low: n, base: n, high: n };
  }

  function saveValuation(ticker) {
    var c = caseForTicker(ticker);
    if (!c) {
      mx.toast('Research', 'No published case for this security.', 'error');
      return Promise.resolve();
    }
    var store = window.__mxData._equityResearch[ticker];
    var base = (store && store.valuationInputs) || {};
    var body = {
      inputs: {
        revenue: Number(base.revenue || 1e8),
        sharesOutstanding: Number(base.sharesOutstanding || 1e8),
        netDebt: Number(base.netDebt || 0),
        terminalGrowthPct: Number(base.terminalGrowthPct || 2),
        growthPct: triple(document.getElementById('modelRevenueGrowth').value),
        marginPct: triple(document.getElementById('modelMargin').value),
        discountPct: triple(document.getElementById('modelDiscountRate').value),
      },
      targetPrice: Number(document.getElementById('modelTargetPrice').value),
      note: 'Updated from legacy research valuation panel',
    };
    return mx
      .put('/api/v1/research/cases/' + encodeURIComponent(c.id) + '/valuation', body)
      .then(function () {
        mx.toast('Analyst model saved', ticker + ' valuation assumptions saved to the research case.');
        return loadIssuerDepth(ticker);
      })
      .catch(mx.fail);
  }

  function saveEntry(kind, ticker) {
    var c = caseForTicker(ticker);
    if (!c) return Promise.resolve();
    var text = (document.getElementById('researchAnalystNote') && document.getElementById('researchAnalystNote').value) || '';
    if (!text.trim()) {
      mx.toast('Note required', 'Enter text before saving.', 'error');
      return Promise.resolve();
    }
    var title =
      kind === 'CATALYST'
        ? 'Catalyst · ' + ticker
        : kind === 'RISK'
          ? 'Risk · ' + ticker
          : 'Working note · ' + ticker;
    return mx
      .post('/api/v1/research/entries', {
        caseId: c.id,
        securityId: c.securityId,
        kind: kind,
        title: title,
        body: text.trim(),
        eventDate: kind === 'CATALYST' ? new Date().toISOString().slice(0, 10) : undefined,
        trigger: kind === 'CATALYST' ? text.trim().slice(0, 280) : undefined,
        severity: kind === 'RISK' ? 'MEDIUM' : undefined,
      })
      .then(function () {
        mx.toast('Analyst entry saved', title + ' recorded on the case.');
        if (window.__mxData._researchNotes) window.__mxData._researchNotes[ticker] = text.trim();
        return loadIssuerDepth(ticker);
      })
      .catch(mx.fail);
  }

  function openNewCaseModal() {
    if (!mx.can('research.edit')) {
      mx.toast('Access restricted', 'You need research.edit to create a case.', 'error');
      return;
    }
    mx.modal({
      eyebrow: 'RESEARCH',
      title: 'New investment case',
      body:
        '<form id="mxNewCase"><label class="v34-field"><span>Security</span><select class="v34-select" name="securityId" required><option value="">Choose security</option>' +
        securities
          .map(function (s) {
            return '<option value="' + mx.esc(s.id) + '">' + mx.esc(s.ticker) + ' · ' + mx.esc(s.name) + '</option>';
          })
          .join('') +
        '</select></label><label class="v34-field"><span>Title</span><input class="v34-input" name="title" required minlength="3"></label><label class="v34-field"><span>Thesis</span><textarea class="v34-input" name="thesis" rows="4" required minlength="20"></textarea></label><label class="v34-field"><span>Rating</span><select class="v34-select" name="rating"><option>HOLD</option><option>ACCUMULATE</option><option>BUY</option><option>REDUCE</option><option>SELL</option></select></label><label class="v34-field"><span>Target price</span><input class="v34-input" name="targetPrice" inputmode="decimal" required></label><label class="v34-field"><span>Conviction (1-5)</span><input class="v34-input" name="conviction" type="number" min="1" max="5" value="3"></label></form>',
      actions: [
        { label: 'Cancel', run: function () {} },
        {
          label: 'Create draft',
          primary: true,
          run: function (m) {
            var fd = new FormData(m.querySelector('#mxNewCase'));
            return mx
              .post('/api/v1/research/cases', {
                securityId: fd.get('securityId'),
                title: fd.get('title'),
                thesis: fd.get('thesis'),
                rating: fd.get('rating'),
                targetPrice: fd.get('targetPrice'),
                conviction: Number(fd.get('conviction') || 3),
                horizonMonths: 12,
              })
              .then(function () {
                mx.toast('Research case created', 'Draft case saved — submit for review when ready.');
                return loadResearch();
              });
          },
        },
      ],
    });
  }

  mx.onLoad('research.view', function () {
    return loadResearch();
  });

  mx.hydrate('research', function () {
    if (!liveResearch()) return Promise.resolve();
    return loadResearch();
  });

  window.addEventListener('matanho:legacy-ready', function () {
    mx.gate('[data-action="new-research"]', 'research.edit');
    mx.gate('#researchSaveModel', 'research.edit');
    mx.gate('#researchSaveNote', 'research.edit');

    mx.intercept('[data-action="new-research"]', function () {
      return openNewCaseModal();
    }, { when: liveResearch });

    document.addEventListener(
      'click',
      function (e) {
        if (!liveResearch()) return;
        var ticker = selectedTicker();
        if (e.target.closest && e.target.closest('#researchSaveModel')) {
          e.preventDefault();
          e.stopImmediatePropagation();
          saveValuation(ticker).catch(mx.fail);
          return;
        }
        if (e.target.closest && e.target.closest('#researchSaveNote')) {
          e.preventDefault();
          e.stopImmediatePropagation();
          saveEntry('NOTE', ticker).catch(mx.fail);
          return;
        }
        if (e.target.closest && e.target.closest('#researchAddCatalyst')) {
          e.preventDefault();
          e.stopImmediatePropagation();
          saveEntry('CATALYST', ticker).catch(mx.fail);
          return;
        }
        if (e.target.closest && e.target.closest('#researchAddRisk')) {
          e.preventDefault();
          e.stopImmediatePropagation();
          saveEntry('RISK', ticker).catch(mx.fail);
          return;
        }
        var pick = e.target.closest && e.target.closest('[data-equity-ticker]');
        if (pick) loadIssuerDepth(pick.dataset.equityTicker).catch(mx.fail);
      },
      true,
    );

    var search = document.getElementById('equityResearchSearch');
    if (search) {
      var timer;
      search.addEventListener('input', function () {
        if (!liveResearch()) return;
        clearTimeout(timer);
        timer = setTimeout(function () {
          var q = search.value.trim();
          getEnvelope('/api/v1/research/cases?status=PUBLISHED&q=' + encodeURIComponent(q))
            .then(function (body) {
              return hydrateEquityStore(body.data || body);
            })
            .catch(mx.fail);
        }, 300);
      });
    }
  });
})();
