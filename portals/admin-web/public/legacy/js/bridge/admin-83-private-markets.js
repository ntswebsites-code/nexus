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

  function clearPmChrome() {
    document.querySelectorAll('#page-private-markets .v15-statebar > div').forEach(function (cell) {
      var s = cell.querySelector('strong');
      var n = cell.querySelector('small');
      if (s) {
        s.textContent = '—';
        s.className = '';
      }
      if (n) n.textContent = 'Loading…';
    });
    ['v15PrivateCalls', 'v15PrivateDists', 'v15PrivateNet', 'v15PrivateFloor', 'v15PmNetCash90', 'v15PmLookthroughPct'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.textContent = '—';
        el.className = '';
      }
    });
    var rows = document.getElementById('v15PrivateAssetRows');
    if (rows) rows.innerHTML = '<tr><td colspan="10"><span class="ops-muted">Loading commitments…</span></td></tr>';
  }

  function togglePmDemoPanels(live) {
    document.querySelectorAll('#page-private-markets .v15-demo-only').forEach(function (el) {
      el.style.display = live ? 'none' : '';
    });
  }

  function patchNetCash90(s) {
    var el = document.getElementById('v15PmNetCash90');
    if (!el || !s) return;
    var net = (s.upcomingCashflows || []).reduce(function (acc, f) {
      var amt = Number(f.amount || 0);
      if (f.kind === 'DISTRIBUTION') return acc + amt;
      if (f.kind === 'CALL') return acc - amt;
      return acc;
    }, 0);
    el.textContent = (net < 0 ? '−' : '+') + money(Math.abs(net), s.reportCurrency);
    el.className = net < 0 ? 'negative-text' : net > 0 ? 'positive-text' : '';
  }

  function patchLookthroughCoverage() {
    return mx.get(V1 + '/lookthrough').then(function (body) {
      var lt = body.data || body;
      var rows = lt.rows || [];
      var el = document.getElementById('v15PmLookthroughPct');
      if (!el) return;
      if (!rows.length) {
        el.textContent = '—';
        return;
      }
      var mapped = rows.filter(function (r) {
        return r.navReport != null;
      }).length;
      el.textContent = ((mapped / rows.length) * 100).toFixed(1) + '%';
    });
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
    patchNetCash90(s);
    if (cells[3]) cells[3].querySelector('strong').textContent = pct(s.totals.irrPct);
    if (cells[4]) {
      var exc = Number(s.pendingMarks || 0) + Number(s.staleMarks || 0);
      var strong = cells[4].querySelector('strong');
      strong.textContent = String(exc);
      strong.className = exc ? 'attention-text' : '';
      cells[4].querySelector('small').textContent = (s.pendingMarks || 0) + ' pending · ' + (s.staleMarks || 0) + ' stale';
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
        return patchLookthroughCoverage();
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
                  mx.reasonModal({
                    eyebrow: 'PRIVATE MARKETS · MARK',
                    title: 'Return to preparer',
                    subtitle: m.ref,
                    label: 'What needs to be corrected?',
                    minLength: 3,
                    confirmLabel: 'Return',
                    onConfirm: function (reason) {
                      return mx.post(V1 + '/marks/' + encodeURIComponent(m.id) + '/return', { reason: reason }).then(function () {
                        mx.toast('Mark returned', m.ref + ' sent back to preparer.');
                        return loadPrivateMarkets();
                      });
                    },
                  });
                  return false;
                },
              },
              {
                label: 'Reject mark',
                run: function () {
                  mx.reasonModal({
                    eyebrow: 'PRIVATE MARKETS · MARK',
                    title: 'Reject mark',
                    subtitle: m.ref,
                    label: 'Rejection reason',
                    minLength: 5,
                    confirmLabel: 'Reject',
                    onConfirm: function (reason) {
                      return mx.post(V1 + '/marks/' + encodeURIComponent(m.id) + '/reject', { reason: reason }).then(function () {
                        mx.toast('Mark rejected', m.ref);
                        return loadPrivateMarkets();
                      });
                    },
                  });
                  return false;
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
    var apiId = d.id || ref;
    mx.get(V1 + '/pipeline/' + encodeURIComponent(apiId)).then(function (body) {
      var detail = body.data || body;
      var stages = (detail.nextStages && detail.nextStages.length ? detail.nextStages : ['DILIGENCE', 'IC', 'APPROVED']).slice(0, 3);
      var diligence = (detail.diligence || [])[0];
      openDrawer({
        eyebrow: 'PRIVATE MARKETS · PIPELINE',
        title: detail.name || d.name,
        subtitle: (detail.ref || ref) + ' · ' + (detail.stage || d.stage || 'SCREENING') + ' · ' + money(detail.proposedAmount || d.proposedAmount, detail.currency || d.currency),
        body:
          '<section class="detail-section"><h3>Opportunity</h3><p>' +
          mx.esc(detail.sponsor || d.sponsor || 'Sponsor not recorded') +
          ' · ' +
          mx.esc(strategyLabel(detail.strategy || d.strategy)) +
          '</p></section><section class="detail-section"><h3>Pipeline controls</h3><div style="display:grid;gap:6px">' +
          (mx.can('portfolio.manage')
            ? stages
                .map(function (st) {
                  return '<button type="button" class="btn secondary" data-mx-pm-stage="' + mx.esc(st) + '">Advance to ' + mx.esc(st) + '</button>';
                })
                .join('') +
              (diligence && diligence.status !== 'COMPLETE'
                ? '<button type="button" class="btn primary" data-mx-pm-diligence="' + mx.esc(diligence.id) + '">Complete diligence</button>'
                : '')
            : '') +
          '</div></section>',
      });
      mx.$$('[data-mx-pm-stage]').forEach(function (b) {
        b.onclick = function () {
          mx.post(V1 + '/pipeline/' + encodeURIComponent(apiId) + '/stage', { stage: b.getAttribute('data-mx-pm-stage') }).then(function () {
            mx.toast('Stage updated', detail.ref || ref);
            return loadPrivateMarkets().then(function () {
              return openDealDrawer(ref);
            });
          }, mx.fail);
        };
      });
      var digBtn = document.querySelector('[data-mx-pm-diligence]');
      if (digBtn) {
        digBtn.onclick = function () {
          mx.post(V1 + '/diligence/' + encodeURIComponent(digBtn.getAttribute('data-mx-pm-diligence')) + '/complete', {}).then(function () {
            mx.toast('Diligence completed', detail.ref || ref);
            return loadPrivateMarkets();
          }, mx.fail);
        };
      }
    }, mx.fail);
  }

  function openNewCommitmentModal() {
    if (!mx.can('portfolio.manage')) {
      mx.toast('Access restricted', 'You need portfolio.manage to record a commitment.', 'error');
      return;
    }
    Promise.all([mx.get(V1 + '/funds?status=ACTIVE&limit=100'), mx.get('/api/v1/portfolios?status=Active')])
      .then(function (res) {
        var fundsBody = res[0];
        var funds = Array.isArray(fundsBody) ? fundsBody : fundsBody.data || [];
        var portfolios = Array.isArray(res[1]) ? res[1] : res[1].data || [];
        if (!funds.length || !portfolios.length) {
          mx.toast('Private markets', 'Register a fund and portfolio before adding a commitment.', 'warn');
          return;
        }
        mx.modal({
          eyebrow: 'PRIVATE MARKETS',
          title: 'New commitment',
          body:
            '<form id="mxNewCommitment"><label class="v34-field"><span>Fund</span><select class="v34-select" name="fundId" required>' +
            funds
              .map(function (f) {
                return '<option value="' + mx.esc(f.id) + '">' + mx.esc(f.ref || f.name) + ' · ' + mx.esc(f.name) + '</option>';
              })
              .join('') +
            '</select></label><label class="v34-field"><span>Portfolio</span><select class="v34-select" name="portfolioId" required>' +
            portfolios
              .map(function (p) {
                return '<option value="' + mx.esc(p.id) + '">' + mx.esc(p.name) + '</option>';
              })
              .join('') +
            '</select></label><label class="v34-field"><span>Committed amount</span><input class="v34-input" name="amount" inputmode="decimal" required></label><label class="v34-field"><span>Committed on</span><input class="v34-input" type="date" name="committedOn" required value="' +
            new Date().toISOString().slice(0, 10) +
            '"></label></form>',
          actions: [
            { label: 'Cancel', run: function () {} },
            {
              label: 'Create commitment',
              primary: true,
              run: function (m) {
                var fd = new FormData(m.querySelector('#mxNewCommitment'));
                return mx
                  .post(V1 + '/funds/' + encodeURIComponent(fd.get('fundId')) + '/commitments', {
                    portfolioId: fd.get('portfolioId'),
                    amount: fd.get('amount'),
                    committedOn: fd.get('committedOn'),
                  })
                  .then(function () {
                    mx.toast('Commitment recorded', 'Fund commitment saved to the private book.');
                    return loadPrivateMarkets();
                  });
              },
            },
          ],
        });
      })
      .catch(mx.fail);
  }

  function openNewFundModal() {
    mx.modal({
      eyebrow: 'PRIVATE MARKETS',
      title: 'Register fund',
      body:
        '<form id="mxNewFund"><label class="v34-field"><span>Name</span><input class="v34-input" name="name" required></label><label class="v34-field"><span>Strategy</span><select class="v34-select" name="strategy"><option value="PRIVATE_EQUITY">Private equity</option><option value="VENTURE">Venture</option><option value="PRIVATE_CREDIT">Private credit</option></select></label><label class="v34-field"><span>Vintage</span><input class="v34-input" name="vintage" type="number" value="' +
        new Date().getFullYear() +
        '"></label><label class="v34-field"><span>Currency</span><input class="v34-input" name="currency" value="USD"></label></form>',
      actions: [
        { label: 'Cancel', run: function () {} },
        {
          label: 'Create fund',
          primary: true,
          run: function (m) {
            var fd = new FormData(m.querySelector('#mxNewFund'));
            return mx.post(V1 + '/funds', {
              name: fd.get('name'),
              strategy: fd.get('strategy'),
              vintage: Number(fd.get('vintage')),
              currency: fd.get('currency') || 'USD',
            }).then(function () {
              mx.toast('Fund registered', String(fd.get('name')));
              return loadPrivateMarkets();
            });
          },
        },
      ],
    });
  }

  function createPipelineDeal(kind) {
    var stageLabel = kind === 'diligence' ? 'diligence' : 'screening';
    mx.modal({
      eyebrow: 'PRIVATE MARKETS · PIPELINE',
      title: kind === 'diligence' ? 'New diligence case' : 'New pipeline investment',
      subtitle: 'Creates a ' + stageLabel + ' record on the private markets pipeline',
      body:
        '<form id="mxPmPipeline"><label class="v34-field"><span>Investment / opportunity name</span><input class="v34-input" name="name" required minlength="2"></label>' +
        '<label class="v34-field"><span>Sponsor or manager</span><input class="v34-input" name="sponsor" required value="GP / sponsor"></label>' +
        '<label class="v34-field"><span>Proposed commitment amount</span><input class="v34-input" name="amount" inputmode="decimal" required value="1000000"></label></form>',
      actions: [
        { label: 'Cancel', run: function () {} },
        {
          label: 'Create',
          primary: true,
          run: function (m) {
            var fd = new FormData(m.querySelector('#mxPmPipeline'));
            var name = String(fd.get('name') || '').trim();
            var sponsor = String(fd.get('sponsor') || '').trim();
            var amount = String(fd.get('amount') || '').trim();
            return mx
              .post(V1 + '/pipeline', {
                name: name,
                sponsor: sponsor,
                strategy: 'PRIVATE_EQUITY',
                vintage: new Date().getFullYear(),
                currency: 'USD',
                proposedAmount: amount.replace(/,/g, ''),
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
          },
        },
      ],
    });
  }

  function openCashflowNoticeModal(commitmentId, kind, currency) {
    if (!mx.can('portfolio.manage')) {
      mx.toast('Access restricted', 'You need portfolio.manage to notice cashflows.', 'error');
      return;
    }
    var today = new Date().toISOString().slice(0, 10);
    var label = kind === 'CALL' ? 'Capital call' : 'Distribution';
    mx.modal({
      eyebrow: 'PRIVATE MARKETS · CASHFLOW',
      title: 'Notice ' + label.toLowerCase(),
      body:
        '<form id="mxPmCashflow"><label class="v34-field"><span>Amount</span><input class="v34-input" name="amount" inputmode="decimal" required></label><label class="v34-field"><span>Notice date</span><input class="v34-input" type="date" name="noticeDate" value="' +
        mx.esc(today) +
        '"></label><label class="v34-field"><span>Due date</span><input class="v34-input" type="date" name="dueDate" required value="' +
        mx.esc(today) +
        '"></label>' +
        (kind === 'DISTRIBUTION'
          ? '<label class="v34-field"><span>Return of capital (optional)</span><input class="v34-input" name="returnOfCapital" inputmode="decimal"></label>'
          : '') +
        '<label class="v34-field wide"><span>Note</span><textarea class="v34-input" name="note" rows="2"></textarea></label><p class="ops-muted">Creates a NOTICED cashflow on the commitment (' +
        mx.esc(currency || 'USD') +
        ').</p></form>',
      actions: [
        { label: 'Cancel', run: function () {} },
        {
          label: 'Notice ' + label.toLowerCase(),
          primary: true,
          run: function (m) {
            var fd = new FormData(m.querySelector('#mxPmCashflow'));
            var body = {
              kind: kind,
              amount: String(fd.get('amount') || '').trim(),
              noticeDate: fd.get('noticeDate') || today,
              dueDate: fd.get('dueDate'),
              note: (fd.get('note') || '').trim() || undefined,
            };
            if (kind === 'DISTRIBUTION' && fd.get('returnOfCapital')) {
              body.returnOfCapital = String(fd.get('returnOfCapital')).trim();
            }
            return mx
              .post(V1 + '/commitments/' + encodeURIComponent(commitmentId) + '/cashflows', body)
              .then(function () {
                mx.toast(label + ' noticed', 'Cashflow saved — settle when paid.');
                return loadPrivateMarkets().then(function () {
                  return openCommitmentDrawer(commitmentId);
                });
              })
              .catch(mx.fail);
          },
        },
      ],
    });
  }

  function settleCashflow(flowId, commitmentId) {
    return mx
      .post(V1 + '/cashflows/' + encodeURIComponent(flowId) + '/pay', {})
      .then(function () {
        mx.toast('Cashflow settled', 'Payment recorded and journals staged.');
        return loadPrivateMarkets().then(function () {
          return openCommitmentDrawer(commitmentId);
        });
      })
      .catch(mx.fail);
  }

  function cancelCashflow(flowId, commitmentId) {
    mx.modal({
      eyebrow: 'PRIVATE MARKETS · CASHFLOW',
      title: 'Cancel cashflow notice',
      body:
        '<form id="mxPmCancelFlow"><label class="v34-field wide"><span>Cancellation reason</span><textarea class="v34-input" name="reason" rows="3" required minlength="5"></textarea></label></form>',
      actions: [
        { label: 'Keep notice', run: function () {} },
        {
          label: 'Cancel cashflow',
          primary: true,
          run: function (m) {
            var reason = String(new FormData(m.querySelector('#mxPmCancelFlow')).get('reason') || '').trim();
            if (reason.length < 5) throw new Error('Give at least 5 characters');
            return mx
              .post(V1 + '/cashflows/' + encodeURIComponent(flowId) + '/cancel', { reason: reason })
              .then(function () {
                mx.toast('Cashflow cancelled', 'Notice removed from the commitment.');
                return loadPrivateMarkets().then(function () {
                  return openCommitmentDrawer(commitmentId);
                });
              })
              .catch(mx.fail);
          },
        },
      ],
    });
  }

  function bindCommitmentDrawerActions(c) {
    var body = document.getElementById('drawerBody');
    if (!body || !c) return;
    var callBtn = body.querySelector('[data-pm-notice-call]');
    var distBtn = body.querySelector('[data-pm-notice-dist]');
    if (callBtn) {
      callBtn.onclick = function () {
        openCashflowNoticeModal(c.id, 'CALL', c.currency);
      };
    }
    if (distBtn) {
      distBtn.onclick = function () {
        openCashflowNoticeModal(c.id, 'DISTRIBUTION', c.currency);
      };
    }
    body.querySelectorAll('[data-pm-flow-settle]').forEach(function (btn) {
      btn.onclick = function () {
        settleCashflow(btn.getAttribute('data-pm-flow-settle'), c.id);
      };
    });
    body.querySelectorAll('[data-pm-flow-cancel]').forEach(function (btn) {
      btn.onclick = function () {
        cancelCashflow(btn.getAttribute('data-pm-flow-cancel'), c.id);
      };
    });
  }

  function openCommitmentDrawer(apiId) {
    if (!apiId) return Promise.resolve();
    return mx
      .get(V1 + '/commitments/' + encodeURIComponent(apiId))
      .then(function (body) {
        var c = body.data || body;
        var ccy = c.currency || 'USD';
        var flows = c.cashflows || [];
        var flowHtml =
          flows.length === 0
            ? '<p class="ops-muted">No cashflows on this commitment yet.</p>'
            : '<div class="table-wrap"><table class="institution-table"><thead><tr><th>Ref</th><th>Kind</th><th>Amount</th><th>Status</th><th>Due</th><th></th></tr></thead><tbody>' +
              flows
                .map(function (f) {
                  var acts =
                    f.status === 'NOTICED' && mx.can('portfolio.manage')
                      ? '<button type="button" class="v34-btn small" data-pm-flow-settle="' +
                        mx.esc(f.id) +
                        '">Settle</button> <button type="button" class="v34-btn small" data-pm-flow-cancel="' +
                        mx.esc(f.id) +
                        '">Cancel</button>'
                      : '—';
                  return (
                    '<tr><td>' +
                    mx.esc(f.ref) +
                    '</td><td>' +
                    mx.esc(f.kind) +
                    '</td><td>' +
                    money(f.amount, ccy) +
                    '</td><td>' +
                    mx.esc(f.status) +
                    '</td><td>' +
                    mx.esc(f.dueDate || '—') +
                    '</td><td>' +
                    acts +
                    '</td></tr>'
                  );
                })
                .join('') +
              '</tbody></table></div>';
        openDrawer({
          eyebrow: 'PRIVATE MARKETS · COMMITMENT',
          title: c.fundName || c.ref,
          subtitle: c.ref + ' · ' + money(c.nav, ccy) + ' NAV · ' + money(c.unfunded, ccy) + ' unfunded',
          body:
            '<section class="detail-section"><h3>Performance</h3><div class="v14-queue-metrics"><div><span>TVPI</span><strong>' +
            mult(c.tvpi) +
            '</strong></div><div><span>DPI</span><strong>' +
            mult(c.dpi) +
            '</strong></div><div><span>IRR</span><strong>' +
            pct(c.irrPct) +
            '</strong></div></div></section><section class="detail-section"><h3>Cashflows</h3>' +
            flowHtml +
            (mx.can('portfolio.manage')
              ? '<div class="form-actions" style="margin-top:12px"><button type="button" class="btn secondary" data-pm-notice-call>Notice call</button><button type="button" class="btn secondary" data-pm-notice-dist>Notice distribution</button></div>'
              : '') +
            '</section>',
        });
        bindCommitmentDrawerActions(c);
      })
      .catch(mx.fail);
  }

  function createScenario() {
    mx.modal({
      eyebrow: 'PRIVATE MARKETS · SCENARIO',
      title: 'New liquidity scenario',
      subtitle: 'Draft cashflow case for portfolio review',
      body:
        '<form id="mxPmScenario"><label class="v34-field"><span>Scenario name</span><input class="v34-input" name="name" required value="90-day liquidity case"></label></form>',
      actions: [
        { label: 'Cancel', run: function () {} },
        {
          label: 'Save scenario',
          primary: true,
          run: function (m) {
            var name = String(new FormData(m.querySelector('#mxPmScenario')).get('name') || '').trim();
            if (!name) throw new Error('Scenario name is required');
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
          },
        },
      ],
    });
  }

  mx.onLoad('portfolio.view', function () {
    if (!document.getElementById('page-private-markets')) return Promise.resolve();
    if (livePm()) clearPmChrome();
    return loadPrivateMarkets();
  });

  mx.hydrate('private-markets', function () {
    if (!livePm()) return Promise.resolve();
    clearPmChrome();
    return loadPrivateMarkets();
  });

  window.addEventListener('matanho:legacy-ready', function () {
    togglePmDemoPanels(livePm());
    mx.gate('[data-v15-private-action="fund"]', 'portfolio.manage');
    mx.gate('[data-v15-private-action="commitment"]', 'portfolio.manage');
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
          mx.modal({
            eyebrow: 'PRIVATE MARKETS',
            title: 'Export look-through',
            subtitle: 'Fund and commitment exposure',
            body: '<p>Download the current look-through register from the server.</p>',
            actions: [
              {
                label: 'CSV',
                run: function () {
                  return mx.streamDownload(V1 + '/lookthrough/export?format=csv', 'private-lookthrough.csv').then(function () {
                    mx.toast('Look-through exported', 'CSV downloaded from the server.');
                  });
                },
              },
              {
                label: 'XLSX',
                primary: true,
                run: function () {
                  return mx.streamDownload(V1 + '/lookthrough/export?format=xlsx', 'private-lookthrough.xlsx').then(function () {
                    mx.toast('Look-through exported', 'XLSX downloaded from the server.');
                  });
                },
              },
            ],
          });
          return;
        }
        var fundBtn = e.target.closest && e.target.closest('[data-v15-private-action="fund"]');
        if (fundBtn) {
          e.preventDefault();
          e.stopImmediatePropagation();
          openNewFundModal();
          return;
        }
        var commitBtn = e.target.closest && e.target.closest('[data-v15-private-action="commitment"]');
        if (commitBtn) {
          e.preventDefault();
          e.stopImmediatePropagation();
          openNewCommitmentModal();
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
            openCommitmentDrawer(row.apiId);
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
