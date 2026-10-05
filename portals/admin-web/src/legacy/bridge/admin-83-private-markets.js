/*
 * Private markets: commitments, J-curve, marks, pipeline, diligence, look-through.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var V1 = '/api/v1/private-markets';
  var summary = null;
  var marks = [];
  var markByRef = {};
  var pipeline = [];
  var pipelineByRef = {};

  function livePm() {
    return mx.live && mx.strict('private-markets');
  }

  function money(v, ccy) {
    if (v == null || v === '') return '—';
    var n = Number(v);
    if (isNaN(n)) return '—';
    var prefix = (ccy || 'USD') === 'ZWG' ? 'ZWG ' : 'US$ ';
    if (Math.abs(n) >= 1e6) return prefix + (n / 1e6).toFixed(2) + 'M';
    if (Math.abs(n) >= 1e3) return prefix + (n / 1e3).toFixed(0) + 'k';
    return prefix + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  function pct(v) {
    if (v == null || v === '') return '—';
    return Number(v).toFixed(1) + '%';
  }

  function mult(v) {
    if (v == null || v === '') return '—';
    return Number(v).toFixed(2) + '×';
  }

  function valuationTone(c) {
    if (c.markStale) return { label: 'Stale', tone: 'amber' };
    if (c.status === 'PENDING_MARK') return { label: 'Review', tone: 'amber' };
    return { label: 'Current', tone: 'green' };
  }

  function strategyLabel(s) {
    return (
      {
        PRIVATE_EQUITY: 'PE fund',
        VENTURE: 'VC fund',
        REAL_ASSETS: 'Real assets',
        PRIVATE_CREDIT: 'Private credit',
        INFRASTRUCTURE: 'Infrastructure',
        OTHER: 'Private',
      }[s] || s || 'Private'
    );
  }

  function mapCommitment(c) {
    var val = valuationTone(c);
    return {
      apiId: c.id,
      id: c.ref || c.id,
      name: c.fundName || c.ref || 'Commitment',
      type: strategyLabel(c.strategy),
      vintage: c.vintage != null ? String(c.vintage) : '—',
      cost: money(c.committed, c.currency),
      nav: money(c.nav, c.currency),
      unfunded: money(c.unfunded, c.currency),
      irr: pct(c.irrPct),
      multiple: mult(c.tvpi),
      valuation: val.label,
      tone: val.tone,
    };
  }

  function patchStatebar(s) {
    var bar = document.querySelector('#page-private-markets .v15-statebar');
    if (!bar || !s || !s.totals) return;
    var cells = bar.querySelectorAll(':scope > div');
    if (cells[0]) {
      cells[0].querySelector('strong').textContent = money(s.totals.nav, s.reportCurrency);
      var pctNav = s.wholePortfolioNavPct != null ? Number(s.wholePortfolioNavPct).toFixed(1) + '% of whole portfolio' : (s.commitments ? s.commitments.length + ' commitments' : 'Live book');
      cells[0].querySelector('small').textContent = pctNav;
    }
    if (cells[1]) {
      cells[1].querySelector('strong').textContent = money(s.totals.unfunded, s.reportCurrency);
      cells[1].querySelector('small').textContent = (s.commitments ? s.commitments.length : 0) + ' vehicles';
    }
    if (cells[4]) cells[4].querySelector('strong').textContent = pct(s.totals.irrPct);
    if (cells[5]) {
      var exc = Number(s.pendingMarks || 0) + Number(s.staleMarks || 0);
      cells[5].querySelector('strong').textContent = String(exc);
      cells[5].querySelector('small').textContent = (s.pendingMarks || 0) + ' pending · ' + (s.staleMarks || 0) + ' stale';
    }
  }

  function patchJcurveMetrics(points, ccy) {
    if (!points || !points.length) return;
    var calls = 0;
    var dists = 0;
    points.forEach(function (p) {
      calls += Math.abs(Number(p.calls || 0));
      dists += Math.abs(Number(p.distributions || 0));
    });
    var net = dists - calls;
    var callsEl = document.getElementById('v15PrivateCalls');
    var distsEl = document.getElementById('v15PrivateDists');
    var netEl = document.getElementById('v15PrivateNet');
    if (callsEl) callsEl.textContent = money(calls, ccy);
    if (distsEl) distsEl.textContent = money(dists, ccy);
    if (netEl) netEl.textContent = (net < 0 ? '−' : '+') + money(Math.abs(net), ccy);
  }

  function applyPrivateAssets(rows) {
    window.__mxData = window.__mxData || {};
    if (!window.__mxData._privateAssets15) window.__mxData._privateAssets15 = [];
    mx.replace(window.__mxData._privateAssets15, rows);
    if (typeof renderV15PrivateAssets === 'function') renderV15PrivateAssets();
  }

  function patchValuationsTable() {
    var pane = document.querySelector('#page-private-markets [data-v15-pane="valuations"] tbody');
    if (!pane || !marks.length) return;
    pane.innerHTML = marks
      .slice(0, 12)
      .map(function (m) {
        var tone = m.status === 'APPROVED' ? 'green' : m.status === 'PENDING_APPROVAL' ? 'amber' : 'amber';
        var label = m.status === 'APPROVED' ? 'Approved' : m.status === 'PENDING_APPROVAL' ? 'Pending approval' : m.status === 'DRAFT' ? 'Draft' : m.status;
        return (
          '<tr data-pm-mark="' +
          m.id +
          '"><td><strong>' +
          mx.esc(m.fundName || m.commitmentRef || 'Mark') +
          '</strong></td><td>' +
          mx.esc(m.method || 'Manager NAV') +
          '</td><td>' +
          mx.date(m.asOf) +
          '</td><td>—</td><td>' +
          (m.evidence && m.evidence.length ? 'Complete' : 'Partial') +
          '</td><td>' +
          mx.esc(m.approverName || 'Pending') +
          '</td><td><span class="outline-status ' +
          tone +
          '">' +
          label +
          '</span></td></tr>'
        );
      })
      .join('');
    mx.$$('[data-pm-mark]', pane).forEach(function (row) {
      row.style.cursor = 'pointer';
      row.onclick = function () {
        openMarkModal(row.getAttribute('data-pm-mark'));
      };
    });
  }

  function patchPipelinePane() {
    var funnel = document.querySelector('#page-private-markets [data-v15-pane="pipeline"] .v15-funnel');
    var list = document.querySelector('#page-private-markets [data-v15-pane="pipeline"] .v15-diligence-list');
    if (!funnel && !list) return;
    mx.get(V1 + '/pipeline/summary')
      .then(function (body) {
        var s = body.data || body;
        if (funnel && s.stages) {
          var order = ['SOURCED', 'SCREENING', 'DILIGENCE', 'IC', 'APPROVED'];
          var labels = { SOURCED: 'Screening', SCREENING: 'Screening', DILIGENCE: 'Diligence', IC: 'IC review', APPROVED: 'Approved' };
          var blocks = funnel.querySelectorAll(':scope > div');
          order.forEach(function (stage, i) {
            var st = (s.stages || []).find(function (x) {
              return x.stage === stage;
            });
            if (blocks[i]) {
              blocks[i].querySelector('strong').textContent = String(st ? st.count : 0);
            }
          });
        }
      })
      .catch(mx.fail);
    mx.get(V1 + '/pipeline?limit=6')
      .then(function (body) {
        var rows = body.data || body;
        pipeline = rows.data || rows || [];
        pipelineByRef = {};
        pipeline.forEach(function (d) {
          pipelineByRef[d.ref || d.id] = d;
        });
        if (!list) return;
        list.innerHTML = pipeline
          .slice(0, 6)
          .map(function (d) {
            return (
              '<button data-pm-deal="' +
              mx.esc(d.ref || d.id) +
              '"><span><strong>' +
              mx.esc(d.name) +
              '</strong><small>' +
              mx.esc(strategyLabel(d.strategy)) +
              ' · ' +
              mx.esc(d.stage) +
              '</small></span><em>Score ' +
              (d.diligenceCases || '—') +
              '</em></button>'
            );
          })
          .join('');
        mx.$$('[data-pm-deal]', list).forEach(function (b) {
          b.onclick = function () {
            openDealDrawer(b.getAttribute('data-pm-deal'));
          };
        });
      })
      .catch(mx.fail);
  }

  function loadMarks() {
    return mx.get(V1 + '/marks?limit=50').then(function (body) {
      var rows = body.data || body;
      marks = rows.data || rows || [];
      markByRef = {};
      marks.forEach(function (m) {
        markByRef[m.ref || m.id] = m;
      });
      patchValuationsTable();
    });
  }

  function loadPrivateMarkets() {
    if (!mx.can('portfolio.view')) return Promise.resolve();
    return Promise.all([
      mx.get(V1 + '/summary'),
      mx.get(V1 + '/jcurve'),
      loadMarks(),
    ])
      .then(function (r) {
        summary = r[0].data || r[0];
        var j = r[1].data || r[1];
        var rows = (summary.commitments || []).map(mapCommitment);
        applyPrivateAssets(rows);
        patchStatebar(summary);
        patchJcurveMetrics(j.points || [], j.currency || summary.reportCurrency);
        patchPipelinePane();
        mx.data.privateSummary = summary;
      })
      .catch(mx.fail);
  }

  function openMarkModal(id) {
    var m = marks.find(function (x) {
      return x.id === id;
    });
    if (!m) return;
    var canApprove = mx.can('portfolio.manage') && m.status === 'PENDING_APPROVAL';
    var canSubmit = mx.can('portfolio.manage') && m.status === 'DRAFT';
    mx.modal({
      eyebrow: 'NAV MARK · ' + mx.esc(m.ref || m.id),
      title: mx.esc(m.fundName || m.commitmentRef || 'Valuation mark'),
      subtitle: mx.date(m.asOf) + ' · ' + mx.esc(m.status) + ' · ' + money(m.nav, 'USD'),
      body:
        '<p>' +
        mx.esc(m.note || 'Controlled NAV mark with maker-checker approval.') +
        '</p>',
      actions: canSubmit
        ? [
            {
              label: 'Submit for approval',
              primary: true,
              run: function () {
                return mx.post(V1 + '/marks/' + encodeURIComponent(m.id) + '/submit', {}).then(function () {
                  mx.toast('Mark submitted', m.ref + ' awaiting independent approval.');
                  return loadPrivateMarkets();
                });
              },
            },
          ]
        : canApprove
          ? [
              {
                label: 'Approve mark',
                primary: true,
                run: function () {
                  return mx.post(V1 + '/marks/' + encodeURIComponent(m.id) + '/approve', {}).then(function () {
                    mx.toast('Mark approved', m.ref + ' is now the official valuation.');
                    return loadPrivateMarkets();
                  });
                },
              },
              {
                label: 'Return to preparer',
                run: function () {
                  var reason = window.prompt('What needs to be corrected?');
                  if (!reason) return false;
                  return mx.post(V1 + '/marks/' + encodeURIComponent(m.id) + '/return', { reason: reason }).then(function () {
                    mx.toast('Mark returned', m.ref + ' sent back to preparer.');
                    return loadPrivateMarkets();
                  });
                },
              },
            ]
          : [],
    });
  }

  function openDealDrawer(ref) {
    var d = pipeline.find(function (x) {
      return (x.ref || x.id) === ref;
    });
    if (!d) return;
    openDrawer({
      eyebrow: 'PRIVATE MARKETS · PIPELINE',
      title: d.name,
      subtitle: (d.ref || d.id) + ' · ' + (d.stage || 'SCREENING') + ' · ' + money(d.proposedAmount, d.currency),
      body:
        '<section class="detail-section"><h3>Opportunity</h3><p>' +
        mx.esc(d.sponsor || 'Sponsor not recorded') +
        ' · ' +
        mx.esc(strategyLabel(d.strategy)) +
        ' · vintage ' +
        (d.vintage || '—') +
        '</p></section><section class="detail-section"><h3>Next stages</h3><p>' +
        (d.nextStages && d.nextStages.length ? d.nextStages.join(' → ') : 'Advance from the current stage when diligence is complete.') +
        '</p></section>',
    });
  }

  function createPipelineDeal(kind) {
    var name = window.prompt('Investment / opportunity name');
    if (!name) return Promise.resolve();
    var sponsor = window.prompt('Sponsor or manager', 'GP / sponsor');
    if (!sponsor) return Promise.resolve();
    var amount = window.prompt('Proposed commitment amount', '1000000');
    if (!amount) return Promise.resolve();
    return mx
      .post(V1 + '/pipeline', {
        name: name,
        sponsor: sponsor,
        strategy: 'PRIVATE_EQUITY',
        vintage: new Date().getFullYear(),
        currency: 'USD',
        proposedAmount: String(amount).replace(/,/g, ''),
        stage: kind === 'diligence' ? 'DILIGENCE' : 'SCREENING',
      })
      .then(function (r) {
        var deal = r.data || r;
        mx.toast('Pipeline record created', (deal.ref || deal.id) + ' · ' + name);
        if (kind === 'diligence' && deal.id) {
          return mx.post(V1 + '/pipeline/' + encodeURIComponent(deal.id) + '/diligence', {
            title: name + ' diligence',
            leadName: mx.user && mx.user.name ? mx.user.name : 'Lead',
          });
        }
        return loadPrivateMarkets();
      })
      .then(loadPrivateMarkets)
      .catch(mx.fail);
  }

  function createScenario() {
    var name = window.prompt('Scenario name', '90-day liquidity case');
    if (!name) return Promise.resolve();
    return mx
      .post(V1 + '/scenarios', {
        name: name,
        kind: 'LIQUIDITY',
        currency: 'USD',
        flows: [],
      })
      .then(function (r) {
        var sc = r.data || r;
        mx.toast('Scenario saved', (sc.ref || sc.id) + ' · draft cashflow case retained for review.');
      })
      .catch(mx.fail);
  }

  mx.onLoad('portfolio.view', function () {
    if (!document.getElementById('page-private-markets')) return Promise.resolve();
    return loadPrivateMarkets();
  });

  mx.hydrate('private-markets', function () {
    if (!livePm()) return Promise.resolve();
    return loadPrivateMarkets();
  });

  window.addEventListener('matanho:legacy-ready', function () {
    mx.gate('[data-v15-private-action="investment"]', 'portfolio.manage');
    mx.gate('[data-v15-private-action="diligence"]', 'portfolio.manage');

    document.addEventListener(
      'click',
      function (e) {
        if (!livePm()) return;
        var portfolio = e.target.closest && e.target.closest('[data-v15-private-action="portfolio"]');
        if (portfolio) {
          e.preventDefault();
          e.stopImmediatePropagation();
          mx.download(V1 + '/lookthrough/export?format=csv', 'private-lookthrough.csv').catch(mx.fail);
          return;
        }
        var investment = e.target.closest && e.target.closest('[data-v15-private-action="investment"]');
        if (investment) {
          e.preventDefault();
          e.stopImmediatePropagation();
          createPipelineDeal('investment');
          return;
        }
        var diligence = e.target.closest && e.target.closest('[data-v15-private-action="diligence"]');
        if (diligence) {
          e.preventDefault();
          e.stopImmediatePropagation();
          createPipelineDeal('diligence');
          return;
        }
        var cashflow = e.target.closest && e.target.closest('[data-v15-private-action="cashflow"]');
        if (cashflow) {
          e.preventDefault();
          e.stopImmediatePropagation();
          createScenario();
          return;
        }
        var asset = e.target.closest && e.target.closest('[data-v15-private-asset]');
        if (asset && asset.getAttribute('data-pm-deal')) return;
        if (asset && livePm()) {
          var id = asset.getAttribute('data-v15-private-asset');
          var row = (window.__mxData._privateAssets15 || []).find(function (x) {
            return x.id === id;
          });
          if (row && row.apiId) {
            e.preventDefault();
            e.stopImmediatePropagation();
            mx.get(V1 + '/commitments/' + encodeURIComponent(row.apiId))
              .then(function (body) {
                var c = body.data || body;
                openDrawer({
                  eyebrow: 'PRIVATE MARKETS · COMMITMENT',
                  title: c.fundName || c.ref,
                  subtitle: c.ref + ' · ' + money(c.nav, c.currency) + ' NAV · ' + money(c.unfunded, c.currency) + ' unfunded',
                  body:
                    '<section class="detail-section"><h3>Performance</h3><div class="v14-queue-metrics"><div><span>TVPI</span><strong>' +
                    mult(c.tvpi) +
                    '</strong></div><div><span>DPI</span><strong>' +
                    mult(c.dpi) +
                    '</strong></div><div><span>IRR</span><strong>' +
                    pct(c.irrPct) +
                    '</strong></div></div></section>',
                });
              })
              .catch(mx.fail);
          }
        }
      },
      true,
    );

    setTimeout(function () {
      if (livePm()) loadPrivateMarkets().catch(mx.fail);
    }, 3500);
  });
})();
