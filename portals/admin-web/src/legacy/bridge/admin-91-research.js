/*
 * Research & IC: cases, valuation model, analyst notes and catalysts.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var caseByTicker = {};
  var securities = [];
  var icDecisions = [];

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

  function openFilingImportModal() {
    if (!mx.can('research.edit')) {
      mx.toast('Access restricted', 'You need research.edit to import issuer filings.', 'error');
      return;
    }
    var ticker = selectedTicker();
    var c = ticker ? caseForTicker(ticker) : null;
    if (!c || !c.securityId) {
      mx.toast('Select issuer', 'Choose a covered security before importing a filing.', 'warn');
      return;
    }
    var today = new Date().toISOString().slice(0, 10);
    mx.modal({
      eyebrow: 'RESEARCH · FILING',
      title: 'Import issuer filing · ' + (ticker || ''),
      body:
        '<form id="mxFilingImport"><label class="v34-field"><span>Filing type</span><select class="v34-select" name="filingType" required><option value="ANNUAL_REPORT">Annual report</option><option value="INTERIM_REPORT">Interim report</option><option value="TRADING_UPDATE">Trading update</option><option value="CIRCULAR">Circular</option><option value="PROSPECTUS">Prospectus</option><option value="OTHER">Other</option></select></label><label class="v34-field"><span>Title</span><input class="v34-input" name="title" required minlength="3" placeholder="FY2025 annual report"></label><label class="v34-field"><span>Filed on</span><input class="v34-input" type="date" name="filedOn" required value="' +
        mx.esc(today) +
        '"></label><label class="v34-field"><span>Source</span><input class="v34-input" name="source" required minlength="2" value="Issuer website"></label><label class="v34-field"><span>Period (optional)</span><input class="v34-input" name="period" maxlength="16" placeholder="FY2025"></label><label class="v34-field wide"><span>Filing file</span><input class="v34-input" type="file" name="file" required accept=".pdf,.doc,.docx,.xlsx,.xls,.csv,.txt,.png,.jpg"></label></form>',
      actions: [
        { label: 'Cancel', run: function () {} },
        {
          label: 'Import filing',
          primary: true,
          run: function (m) {
            var form = m.querySelector('#mxFilingImport');
            var fd = new FormData(form);
            var file = fd.get('file');
            if (!file || !file.name) {
              mx.toast('File required', 'Attach the filing document.', 'warn');
              return;
            }
            var upload = new FormData();
            upload.append('filingType', fd.get('filingType'));
            upload.append('title', fd.get('title'));
            upload.append('filedOn', fd.get('filedOn'));
            upload.append('source', fd.get('source'));
            if (fd.get('period')) upload.append('period', fd.get('period'));
            upload.append('file', file, file.name);
            return mx
              .post('/api/v1/research/issuers/' + encodeURIComponent(c.securityId) + '/filings', upload)
              .then(function () {
                mx.toast('Filing imported', (fd.get('title') || 'Filing') + ' stored in the issuer vault.');
                return loadIssuerDepth(ticker);
              })
              .catch(mx.fail);
          },
        },
      ],
    });
  }

  function clearResearchChrome() {
    var bar = document.querySelector('#page-research .research-sourcebar-v7');
    if (bar) {
      var cells = bar.querySelectorAll('div');
      [1, 2, 3, 4].forEach(function (i) {
        if (cells[i]) {
          var s = cells[i].querySelector('strong');
          if (s) s.textContent = '—';
        }
      });
    }
    ['researchAvatar', 'researchCompanyName', 'researchTicker', 'researchSector', 'researchExchange', 'researchSpotPrice', 'researchSpotChange', 'researchTarget', 'researchUpside', 'researchConviction'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.textContent = '—';
    });
    var rec = document.getElementById('researchRecommendation');
    if (rec) {
      rec.textContent = '—';
      rec.className = 'outline-status';
    }
    var asOf = document.getElementById('researchSpotAsOf');
    if (asOf) asOf.textContent = 'Loading coverage…';
    var thesis = document.getElementById('researchThesisText');
    if (thesis) thesis.textContent = '';
  }

  function renderSummaryBar(summary) {
    var bar = document.querySelector('#page-research .research-sourcebar-v7');
    if (!bar || !summary) return;
    var cells = bar.querySelectorAll('div');
    var published = summary.cases ? summary.cases.published : 0;
    var inReview = summary.cases ? (summary.cases.inReview || 0) + (summary.cases.draft || 0) : summary.myOpenCases || 0;
    if (cells[1]) cells[1].querySelector('strong').textContent = String(published) + ' published';
    if (cells[2]) cells[2].querySelector('strong').textContent = String(published) + ' loaded';
    if (cells[3]) {
      var review = cells[3].querySelector('strong');
      if (review) {
        review.textContent = String(inReview);
        review.className = inReview ? 'attention-text' : '';
      }
    }
    if (cells[4]) {
      cells[4].setAttribute('data-mx-ic-queue', '1');
      cells[4].style.cursor = 'pointer';
      var queue = summary.openDecisions != null ? summary.openDecisions : icDecisions.length;
      cells[4].querySelector('strong').textContent = String(queue);
    }
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

  function loadIcDecisions() {
    return getEnvelope('/api/v1/research/decisions?limit=50')
      .then(function (body) {
        var rows = body.data || body;
        icDecisions = rows.filter(function (d) {
          return d.status === 'PROPOSED' || d.status === 'VOTING';
        });
        mx.data.icDecisions = icDecisions;
        return icDecisions;
      })
      .catch(function () {
        icDecisions = [];
        return [];
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
      loadIcDecisions(),
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

  function isProposer(d) {
    return mx.user && d.proposerId && mx.user.id === d.proposerId;
  }

  function openIcQueueDrawer() {
    if (typeof openDrawer !== 'function') return;
    openDrawer({
      eyebrow: 'INVESTMENT COMMITTEE',
      title: 'IC decision queue',
      subtitle: icDecisions.length + ' open proposal(s)',
      body:
        (icDecisions.length
          ? '<div class="table-wrap"><table class="institution-table"><thead><tr><th>Ref</th><th>Case</th><th>Action</th><th>Status</th><th></th></tr></thead><tbody>' +
            icDecisions
              .map(function (d) {
            return (
              '<tr><td><strong>' +
              mx.esc(d.ref) +
              '</strong></td><td>' +
              mx.esc(d.caseRef || d.ticker || '—') +
              '</td><td>' +
              mx.esc(d.action) +
              (d.quantity ? ' · ' + mx.esc(d.quantity) : '') +
              '</td><td>' +
              mx.esc(d.status) +
              '</td><td><button type="button" class="btn secondary" data-mx-ic-decision="' +
              mx.esc(d.id) +
              '">Open</button></td></tr>'
            );
              })
              .join('') +
            '</tbody></table></div>'
          : '<p class="ops-muted">No open committee decisions.</p>') +
        (mx.can('research.edit')
          ? '<div class="form-actions" style="margin-top:12px"><button type="button" class="btn secondary" id="mxIcNewProposal">New proposal</button><button type="button" class="btn secondary" id="mxIcNewMeeting">Schedule meeting</button></div>'
          : ''),
    });
    document.querySelectorAll('[data-mx-ic-decision]').forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute('data-mx-ic-decision');
        var d = icDecisions.find(function (x) {
          return x.id === id;
        });
        if (d) openIcDecisionModal(d);
      };
    });
    var np = document.getElementById('mxIcNewProposal');
    if (np) np.onclick = openIcProposalModal;
    var nm = document.getElementById('mxIcNewMeeting');
    if (nm) nm.onclick = openIcMeetingModal;
  }

  function openIcDecisionModal(d) {
    var tallyTxt = d.tally ? d.tally.for + ' for · ' + d.tally.against + ' against · ' + d.tally.abstain + ' abstain' : '—';
    var actions = [];
    if (d.status === 'PROPOSED' && isProposer(d) && mx.can('research.edit')) {
      actions.push({
        label: 'Open voting',
        primary: true,
        run: function () {
          return mx.post('/api/v1/research/decisions/' + encodeURIComponent(d.id) + '/open-voting', {}).then(function () {
            mx.toast('Voting opened', d.ref + ' is open for committee votes');
            return loadResearch().then(function () {
              var fresh = icDecisions.find(function (x) {
                return x.id === d.id;
              });
              if (fresh) openIcDecisionModal(fresh);
            });
          });
        },
      });
    }
    if (d.status === 'VOTING' && mx.can('research.edit')) {
      ['FOR', 'AGAINST', 'ABSTAIN'].forEach(function (vote) {
        actions.push({
          label: 'Vote ' + vote.toLowerCase(),
          run: function () {
            return mx
              .post('/api/v1/research/decisions/' + encodeURIComponent(d.id) + '/vote', { vote: vote })
              .then(function () {
                mx.toast('Vote recorded', d.ref + ' · ' + vote);
                return loadResearch();
              });
          },
        });
      });
    }
    if (d.status === 'VOTING' && mx.can('research.ic.decide') && !isProposer(d)) {
      actions.push({
        label: 'Ratify result',
        primary: true,
        run: function (m) {
          if (isProposer(d)) {
            mx.fail(new Error('The proposer cannot ratify their own decision (maker-checker)'));
            return;
          }
          var note = m.querySelector('[name="note"]');
          return mx
            .post(
              '/api/v1/research/decisions/' + encodeURIComponent(d.id) + '/ratify',
              { note: note && note.value ? note.value.trim() : undefined },
              { stepUp: true },
            )
            .then(function () {
              mx.toast('Decision ratified', d.ref + ' outcome recorded');
              closeDrawer();
              return loadResearch();
            });
        },
      });
    }
    mx.modal({
      eyebrow: 'IC DECISION',
      title: d.ref + ' · ' + (d.ticker || d.caseRef || ''),
      body:
        '<p><strong>' +
        mx.esc(d.action) +
        '</strong>' +
        (d.quantity ? ' · qty ' + mx.esc(d.quantity) : '') +
        '</p><p class="ops-muted">' +
        mx.esc(d.rationale || '') +
        '</p><p>Status: <strong>' +
        mx.esc(d.status) +
        '</strong> · tally: ' +
        mx.esc(tallyTxt) +
        (d.projected && d.projected.outcome ? ' · projected ' + mx.esc(d.projected.outcome) : '') +
        '</p>' +
        (d.status === 'VOTING' && mx.can('research.ic.decide') && !isProposer(d)
          ? '<label class="v34-field"><span>Ratification note</span><input class="v34-input" name="note" maxlength="500"></label>'
          : ''),
      actions: actions.length ? actions.concat([{ label: 'Close', run: function () {} }]) : [{ label: 'Close', run: function () {} }],
    });
  }

  function openIcProposalModal() {
    var cases = mx.data.researchCases || [];
    if (!cases.length) {
      mx.toast('IC proposal', 'Publish a research case before proposing to the committee.', 'warn');
      return;
    }
    mx.modal({
      eyebrow: 'IC',
      title: 'New committee proposal',
      body:
        '<form id="mxIcProposal"><label class="v34-field"><span>Research case</span><select class="v34-select" name="caseId" required>' +
        cases
          .map(function (c) {
            return '<option value="' + mx.esc(c.id) + '">' + mx.esc(c.ref || c.ticker) + ' · ' + mx.esc(c.title || c.securityName || '') + '</option>';
          })
          .join('') +
        '</select></label><label class="v34-field"><span>Action</span><select class="v34-select" name="action"><option>BUY</option><option>SELL</option><option>HOLD</option></select></label><label class="v34-field"><span>Quantity</span><input class="v34-input" name="quantity" inputmode="decimal"></label><label class="v34-field"><span>Rationale</span><textarea class="v34-input" name="rationale" rows="4" required minlength="10"></textarea></label></form>',
      actions: [
        { label: 'Cancel', run: function () {} },
        {
          label: 'Propose',
          primary: true,
          run: function (m) {
            var fd = new FormData(m.querySelector('#mxIcProposal'));
            var action = fd.get('action');
            var body = {
              caseId: fd.get('caseId'),
              action: action,
              rationale: fd.get('rationale'),
              quantity: action === 'HOLD' ? undefined : fd.get('quantity'),
            };
            return mx.post('/api/v1/research/decisions', body).then(function () {
              mx.toast('Proposal created', 'IC decision saved as PROPOSED');
              return loadResearch().then(openIcQueueDrawer);
            });
          },
        },
      ],
    });
  }

  function openIcMeetingModal() {
    var when = new Date(Date.now() + 86400000).toISOString();
    mx.modal({
      eyebrow: 'IC',
      title: 'Schedule committee meeting',
      body:
        '<form id="mxIcMeeting"><label class="v34-field"><span>Title</span><input class="v34-input" name="title" required value="Investment Committee"></label><label class="v34-field"><span>Scheduled at (ISO)</span><input class="v34-input" name="scheduledAt" required value="' +
        mx.esc(when) +
        '"></label><label class="v34-field"><span>Agenda</span><textarea class="v34-input" name="agenda" rows="3"></textarea></label></form>',
      actions: [
        { label: 'Cancel', run: function () {} },
        {
          label: 'Schedule',
          primary: true,
          run: function (m) {
            var fd = new FormData(m.querySelector('#mxIcMeeting'));
            return mx
              .post('/api/v1/research/meetings', {
                title: fd.get('title'),
                scheduledAt: fd.get('scheduledAt'),
                agenda: fd.get('agenda') || undefined,
              })
              .then(function () {
                mx.toast('Meeting scheduled', 'IC meeting added to the calendar');
                return loadResearch();
              });
          },
        },
      ],
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
    if (liveResearch()) clearResearchChrome();
    return loadResearch();
  });

  mx.hydrate('research', function () {
    if (!liveResearch()) return Promise.resolve();
    clearResearchChrome();
    return loadResearch();
  });

  window.addEventListener('matanho:legacy-ready', function () {
    mx.gate('[data-action="new-research"]', 'research.edit');
    mx.gate('#researchSaveModel', 'research.edit');
    mx.gate('#researchSaveNote', 'research.edit');
    mx.gate('#researchImportFiling', 'research.edit');

    mx.intercept('[data-action="new-research"]', function () {
      return openNewCaseModal();
    }, { when: liveResearch });

    mx.intercept(
      '#researchImportFiling',
      function () {
        openFilingImportModal();
        return false;
      },
      { when: liveResearch },
    );

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
        if (e.target.closest && e.target.closest('[data-mx-ic-queue]')) {
          e.preventDefault();
          e.stopImmediatePropagation();
          openIcQueueDrawer();
        }
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
