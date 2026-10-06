/*
 * Orders & Execution: blotter, approvals, lifecycle, broker instruction modal.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var filters = { status: '', portfolioId: '', securityId: '', q: '' };
  var catalogs = { portfolios: [], securities: [], brokers: [] };
  var apiByRef = {};

  function getEnvelope(path) {
    return fetch(mx.api + path, { credentials: 'include', headers: { Accept: 'application/json' } }).then(function (r) {
      return r.json();
    });
  }

  function liveOrders() {
    return mx.live && mx.strict('orders');
  }

  function statusProto(s) {
    var map = {
      Draft: 'Draft',
      Validated: 'Draft',
      AwaitingApproval: 'Awaiting approval',
      Approved: 'Approved',
      Routing: 'Routing',
      PartiallyFilled: 'Partially filled',
      Filled: 'Filled',
      Settled: 'Filled',
      Rejected: 'Rejected',
      Cancelled: 'Cancelled',
    };
    return map[s] || s;
  }

  function statusV33(s) {
    if (s === 'AwaitingApproval') return 'Awaiting approval';
    if (s === 'Approved') return 'Approved';
    if (s === 'Filled' || s === 'Settled') return 'Filled';
    if (s === 'Rejected' || s === 'Cancelled') return statusProto(s);
    return 'Working';
  }

  function fmtTime(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '—';
    }
  }

  function fmtQty(v) {
    return Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  function fillPct(o) {
    var q = Number(o.quantity || 0);
    var f = Number(o.filledQty || 0);
    if (!q) return 0;
    return Math.round((f / q) * 100);
  }

  function controlFrom(o) {
    if (!o.precheck) return 'Within';
    if (o.precheck.overall === 'Blocked') return 'Blocked';
    if (o.precheck.overall === 'Review') return 'Amber';
    return 'Within';
  }

  function money2(v, ccy) {
    return (ccy || 'USD') + ' ' + Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function refreshCash() {
    if (mx.can('cash.view') && typeof mx.refresh === 'function') return mx.refresh('cash');
    return Promise.resolve();
  }

  function slippageLabel(bp) {
    if (bp == null || bp === '') return '—';
    var n = Number(bp);
    if (isNaN(n)) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + ' bps';
  }

  function priceLabel(o) {
    if (o.orderType === 'MARKET') return 'Market';
    var p = o.limitPrice || o.stopPrice || o.decisionPrice;
    return (o.currency || '') + ' ' + Number(p || 0).toFixed(4);
  }

  function toProtoInline(o) {
    var pct = fillPct(o);
    return {
      apiId: o.id,
      id: o.ref,
      time: fmtTime(o.createdAt),
      security: o.security.ticker,
      name: o.security.name,
      market: o.security.market,
      side: o.side === 'BUY' ? 'Buy' : 'Sell',
      qty: fmtQty(o.quantity),
      limit: priceLabel(o),
      notional:
        (o.currency || 'USD') +
        ' ' +
        Number(o.notional || 0).toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 2 }),
      broker: o.broker ? o.broker.name : '—',
      portfolio: o.portfolio.name,
      portfolioId: o.portfolio.id,
      securityId: o.security.id,
      status: statusProto(o.status),
      owner: o.maker ? o.maker.name : '—',
      fill: pct,
      filledQty: fmtQty(o.filledQty),
      avg: o.avgPrice ? (o.currency || '') + ' ' + Number(o.avgPrice).toFixed(4) : '—',
      control: controlFrom(o),
      approval: o.approver ? 'Approved by ' + o.approver.name : o.status === 'AwaitingApproval' ? 'Investment Director' : '—',
      route: o.routedAt ? (o.broker ? o.broker.name : 'Broker') + ' · routed' : 'Not routed',
      settlement: o.tif || 'Day',
      tif: o.tif === 'GTC' ? 'GTC' : o.tif === 'IOC' ? 'IOC' : 'Day',
      urgency: o.urgency || 'Normal',
      allocation: 'Single portfolio',
      age: '—',
      slippage: slippageLabel(o.slippageBp),
      decisionPrice: (o.currency || '') + ' ' + Number(o.decisionPrice || 0).toFixed(4),
      risk:
        o.precheck && o.precheck.warnings && o.precheck.warnings.length
          ? o.precheck.warnings[0]
          : controlFrom(o) === 'Amber'
            ? 'Review required'
            : 'All controls passed',
      version: o.version,
      reservedAmount: o.reservedAmount || '0',
      reservedLabel: money2(o.reservedAmount, o.currency),
    };
  }

  function toProtoV33(o) {
    return {
      apiId: o.id,
      id: o.ref,
      ticker: o.security.ticker,
      name: o.security.name,
      side: o.side === 'BUY' ? 'Buy' : 'Sell',
      qty: Number(o.quantity),
      limit: o.orderType === 'MARKET' ? null : Number(o.limitPrice || 0),
      state: statusV33(o.status),
      filled: Number(o.filledQty || 0),
      broker: o.broker ? o.broker.name : '—',
      portfolio: o.portfolio.name,
      tif: o.tif === 'GTC' ? 'GTC' : 'Day',
      created: fmtTime(o.createdAt),
    };
  }

  var postTradeCache = {};

  function postTradeEligible(status) {
    return ['Routing', 'PartiallyFilled', 'Filled', 'Settled'].indexOf(status) >= 0;
  }

  function noteStatusLabel(status) {
    if (status === 'MATCHED') return 'Matched';
    if (status === 'BREAK') return 'Break';
    if (status === 'PARTIAL') return 'Partial';
    return 'No note';
  }

  function fetchPostTrade(apiId) {
    if (!apiId) return Promise.resolve(null);
    if (postTradeCache[apiId]) return Promise.resolve(postTradeCache[apiId]);
    return mx
      .get('/api/v1/orders/' + encodeURIComponent(apiId) + '/post-trade')
      .then(function (pt) {
        postTradeCache[apiId] = pt;
        return pt;
      })
      .catch(function () {
        return null;
      });
  }

  function rollupSettlementKpis(summary, rows) {
    var by = (summary && summary.byStatus) || {};
    var filled = (by.Filled || 0) + (by.Settled || 0);
    var settled = by.Settled || 0;
    var awaiting = by.Filled || 0;
    var readyPct = filled ? Math.round((settled / filled) * 100) : null;
    var warnings = 0;
    var blocked = 0;
    (rows || []).forEach(function (r) {
      if (!r.precheck) return;
      if (r.precheck.overall === 'Review') warnings++;
      if (r.precheck.overall === 'Blocked') blocked++;
    });
    return { readyPct: readyPct, awaiting: awaiting, warnings: warnings, blocked: blocked };
  }

  function marketBreakdown(rows) {
    var zse = 0;
    var vfex = 0;
    var other = 0;
    (rows || []).forEach(function (r) {
      if (['Approved', 'Routing', 'PartiallyFilled'].indexOf(r.status) < 0) return;
      var m = ((r.security && r.security.market) || '').toUpperCase();
      if (m.indexOf('VFEX') >= 0) vfex++;
      else if (m.indexOf('ZSE') >= 0) zse++;
      else other++;
    });
    var parts = [];
    if (zse) parts.push(zse + ' ZSE');
    if (vfex) parts.push(vfex + ' VFEX');
    if (other) parts.push(other + ' other');
    return parts.length ? parts.join(' · ') : 'No working orders';
  }

  function approvalNotionalLabel(rows) {
    var pending = (rows || []).filter(function (r) {
      return r.status === 'AwaitingApproval';
    });
    if (!pending.length) return 'No pending notional';
    var byCcy = {};
    pending.forEach(function (r) {
      var c = r.currency || 'USD';
      var n = Number(r.notional || r.reservedAmount || 0);
      byCcy[c] = (byCcy[c] || 0) + n;
    });
    return Object.keys(byCcy)
      .map(function (c) {
        return (
          c +
          ' ' +
          byCcy[c].toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 2 })
        );
      })
      .join(' · ');
  }

  function clearOrdersKpis() {
    document.querySelectorAll('#page-orders .v33-kpis article').forEach(function (k) {
      var s = k.querySelector('strong');
      var n = k.querySelector('small');
      if (s) s.textContent = '—';
      if (n) n.textContent = 'Loading…';
    });
    if (liveOrders()) patchOrdersDemoChrome(null, []);
  }

  function normalizeOrderType(type) {
    var s = String(type || '').toLowerCase();
    if (s.indexOf('stop') >= 0) return 'STOP_LIMIT';
    if (s.indexOf('market') >= 0) return 'MARKET';
    return 'LIMIT';
  }

  function applyOrderTypeFields(body, type, limit, stop, overrideReason) {
    body.orderType = type;
    if (type === 'MARKET') {
      body.limitPrice = undefined;
      body.stopPrice = undefined;
      body.priceOverrideReason = undefined;
      return body;
    }
    body.limitPrice = limit != null && limit !== '' ? String(limit) : undefined;
    if (type === 'STOP_LIMIT') {
      body.stopPrice = stop != null && stop !== '' ? String(stop) : undefined;
      body.priceOverrideReason = overrideReason ? String(overrideReason).trim() : undefined;
    } else {
      body.stopPrice = undefined;
      body.priceOverrideReason = overrideReason ? String(overrideReason).trim() : undefined;
    }
    return body;
  }

  function parseCsvRows(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map(function (line) {
        return line.trim();
      })
      .filter(Boolean)
      .map(function (line) {
        var parts = [];
        var cur = '';
        var inQ = false;
        for (var i = 0; i < line.length; i++) {
          var ch = line[i];
          if (ch === '"') {
            inQ = !inQ;
            continue;
          }
          if (ch === ',' && !inQ) {
            parts.push(cur.trim());
            cur = '';
            continue;
          }
          cur += ch;
        }
        parts.push(cur.trim());
        return parts;
      });
  }

  function openOrderImportModal() {
    if (!mx.can('orders.create')) {
      mx.toast('Access restricted', 'You need orders.create to import instructions.', 'error');
      return;
    }
    mx.modal({
      eyebrow: 'ORDERS · IMPORT',
      title: 'Import dealing instructions',
      subtitle: 'CSV columns: portfolio, ticker, side, quantity, orderType, limitPrice, stopPrice, rationale',
      body:
        '<form id="mxOrderImport"><label class="v34-field v34-wide"><span>Instruction file (CSV)</span><input class="v34-input" type="file" id="mxOrderImportFile" accept=".csv,.txt" required></label><p class="ops-muted">Each row creates a DRAFT order via POST /orders. Rows with validation errors are skipped.</p><pre class="v34-code" id="mxOrderImportPreview" style="max-height:120px;overflow:auto">No file selected.</pre></form>',
      actions: [
        { label: 'Cancel', run: function () {} },
        {
          label: 'Import drafts',
          primary: true,
          run: function (m) {
            var fileInput = m.querySelector('#mxOrderImportFile');
            var file = fileInput && fileInput.files && fileInput.files[0];
            if (!file) {
              mx.toast('File required', 'Choose a CSV instruction file.', 'warn');
              return;
            }
            return file.text().then(function (text) {
              var rows = parseCsvRows(text);
              if (!rows.length) {
                mx.toast('Empty file', 'No instruction rows found.', 'warn');
                return;
              }
              var header = rows[0].map(function (c) {
                return c.toLowerCase();
              });
              var start = header.indexOf('portfolio') >= 0 || header.indexOf('ticker') >= 0 ? 1 : 0;
              var idx = function (name, fallback) {
                var i = header.indexOf(name);
                return i >= 0 ? i : fallback;
              };
              return loadCatalogs().then(function () {
                var created = 0;
                var failed = 0;
                var chain = Promise.resolve();
                rows.slice(start).forEach(function (cols) {
                  chain = chain.then(function () {
                    var pfName = cols[idx('portfolio', 0)] || '';
                    var ticker = cols[idx('ticker', 1)] || '';
                    var sideRaw = (cols[idx('side', 2)] || 'BUY').toUpperCase();
                    var qty = Math.round(Number(cols[idx('quantity', 3)] || 0));
                    var type = normalizeOrderType(cols[idx('ordertype', 4)] || 'LIMIT');
                    var limit = cols[idx('limitprice', 5)];
                    var stop = cols[idx('stopprice', 6)];
                    var rationale = cols[idx('rationale', 7)] || undefined;
                    var pf = portfolioByName(pfName);
                    var sec = catalogs.securities.find(function (s) {
                      return s.ticker === ticker;
                    });
                    if (!pf || !sec || !qty) {
                      failed += 1;
                      return Promise.resolve();
                    }
                    var body = applyOrderTypeFields(
                      {
                        portfolioId: pf.id,
                        securityId: sec.id,
                        side: sideRaw === 'SELL' ? 'SELL' : 'BUY',
                        quantity: String(qty),
                        tif: 'DAY',
                        urgency: 'Normal',
                        rationale: rationale,
                      },
                      type,
                      limit,
                      stop,
                      undefined,
                    );
                    return mx
                      .post('/api/v1/orders', body)
                      .then(function () {
                        created += 1;
                      })
                      .catch(function () {
                        failed += 1;
                      });
                  });
                });
                return chain.then(function () {
                  mx.toast('Import complete', created + ' draft(s) created' + (failed ? ' · ' + failed + ' skipped' : ''));
                  return loadOrders();
                });
              });
            });
          },
        },
      ],
    });
    var fileEl = document.getElementById('mxOrderImportFile');
    if (fileEl) {
      fileEl.addEventListener('change', function () {
        var f = fileEl.files && fileEl.files[0];
        var preview = document.getElementById('mxOrderImportPreview');
        if (!preview) return;
        if (!f) {
          preview.textContent = 'No file selected.';
          return;
        }
        f.text()
          .then(function (t) {
            var rows = parseCsvRows(t);
            preview.textContent = rows.slice(0, 6).map(function (r) {
              return r.join(' · ');
            }).join('\n');
          })
          .catch(function () {
            preview.textContent = 'Could not read file.';
          });
      });
    }
  }

  function promptStopLimitFields(body) {
    return new Promise(function (resolve) {
      mx.modal({
        eyebrow: 'STOP LIMIT',
        title: 'Stop-limit prices',
        body:
          '<form id="mxStopLimit"><label class="v34-field"><span>Stop price</span><input class="v34-input" name="stopPrice" type="number" step="0.000001" min="0" required value="' +
          mx.esc(body.stopPrice || body.limitPrice || '') +
          '"></label><label class="v34-field"><span>Limit price</span><input class="v34-input" name="limitPrice" type="number" step="0.000001" min="0" required value="' +
          mx.esc(body.limitPrice || '') +
          '"></label><label class="v34-field wide"><span>Price override reason (if &gt;2% from last)</span><input class="v34-input" name="priceOverrideReason" maxlength="255" placeholder="Optional unless required by pre-trade"></label></form>',
        actions: [
          { label: 'Cancel', run: function () { resolve(null); } },
          {
            label: 'Continue',
            primary: true,
            run: function (m) {
              var fd = new FormData(m.querySelector('#mxStopLimit'));
              var stop = fd.get('stopPrice');
              var limit = fd.get('limitPrice');
              if (!stop || !limit) {
                mx.toast('Prices required', 'Enter stop and limit prices.', 'warn');
                return;
              }
              applyOrderTypeFields(body, 'STOP_LIMIT', limit, stop, fd.get('priceOverrideReason'));
              resolve(body);
            },
          },
        ],
      });
    });
  }

  function patchOrdersDemoChrome(summary, rows) {
    if (!liveOrders()) return;
    var strip = document.querySelector('#page-orders .v35-order-market-strip');
    if (strip) strip.style.display = 'none';
    var prov = document.querySelector('#page-orders .v34-order-provenance small');
    if (prov) {
      prov.textContent =
        'Order rows open Order 360 from the live blotter; post-trade evidence and contract-note match come from GET /orders/:id/post-trade.';
    }
  }

  function renderKpis(summary) {
    if (!summary) return;
    var rows = mx.data.orderRows || [];
    var w = document.getElementById('v33WorkingCount');
    var a = document.getElementById('v33ApprovalCount');
    if (w) w.textContent = String(summary.working != null ? summary.working : 0);
    if (a) a.textContent = String(summary.awaitingApproval != null ? summary.awaitingApproval : 0);
    var kpis = document.querySelectorAll('#page-orders .v33-kpis article');
    if (liveOrders()) {
      if (kpis[0]) {
        var n0 = kpis[0].querySelector('small');
        if (n0) n0.textContent = marketBreakdown(rows);
      }
      if (kpis[1]) {
        var n1 = kpis[1].querySelector('small');
        if (n1) n1.textContent = approvalNotionalLabel(rows);
      }
      patchOrdersDemoChrome(summary, rows);
    }
    if (kpis[2]) {
      var s2 = kpis[2].querySelector('strong');
      var n2 = kpis[2].querySelector('small');
      if (s2) s2.textContent = String(summary.filled != null ? summary.filled : '—');
      if (n2) n2.textContent = 'Filled orders in blotter';
    }
    if (kpis[3]) {
      var s3 = kpis[3].querySelector('strong');
      var n3 = kpis[3].querySelector('small');
      if (s3) s3.textContent = summary.slippageBp == null ? '—' : slippageLabel(summary.slippageBp);
      if (n3) n3.textContent = 'Fill-weighted vs decision price';
    }
    if (liveOrders()) {
      var roll = rollupSettlementKpis(summary, mx.data.orderRows);
      if (kpis[4]) {
        var s4 = kpis[4].querySelector('strong');
        var n4 = kpis[4].querySelector('small');
        if (s4) s4.textContent = roll.readyPct == null ? '—' : roll.readyPct + '%';
        if (n4) {
          n4.textContent =
            roll.awaiting > 0
              ? roll.awaiting + ' filled awaiting settlement'
              : roll.readyPct === 100
                ? 'All fills settled'
                : 'Settlement progress';
        }
      }
      if (kpis[5]) {
        var s5 = kpis[5].querySelector('strong');
        var n5 = kpis[5].querySelector('small');
        var total = roll.warnings + roll.blocked;
        if (s5) s5.textContent = total ? total + (total === 1 ? ' warning' : ' warnings') : 'Clear';
        if (n5) {
          n5.textContent = roll.blocked
            ? roll.blocked + ' blocked · ' + roll.warnings + ' review'
            : roll.warnings
              ? roll.warnings + ' orders need review'
              : 'Pre-trade controls within limits';
        }
      }
    }
  }

  function syncTables() {
    var rows = mx.data.orders || [];
    if (typeof orders !== 'undefined' && Array.isArray(orders)) {
      mx.replace(orders, rows);
      if (typeof renderOrders === 'function') renderOrders();
    }
    if (window.__mxData && window.__mxData._v33Orders) {
      mx.replace(window.__mxData._v33Orders, mx.data.v33Orders || rows.map(toProtoV33));
      if (typeof updateOrderKpis === 'function') updateOrderKpis();
      if (typeof renderOrdersView === 'function') renderOrdersView();
      if (typeof orderMain !== 'undefined' && orderMain === 'posttrade') renderLivePostTradeTab();
    }
  }

  function renderLivePostTradeTab() {
    if (!liveOrders() || typeof orderMain === 'undefined' || orderMain !== 'posttrade') return;
    var host = document.querySelector('#page-orders #v33OrdersView');
    if (!host) return;
    var rows = (mx.data.orderRows || []).filter(function (o) {
      return postTradeEligible(o.status);
    });
    var main = host.querySelector('.v33-card');
    if (!main) return;
    var wrap = main.querySelector('.v33-table-wrap');
    if (!wrap) return;
    wrap.outerHTML =
      '<div class="v33-table-wrap"><table class="v33-table"><thead><tr><th>Order</th><th>Security</th><th>Side</th><th>Filled</th><th>Slippage</th><th>Contract note</th><th>Settlement</th></tr></thead><tbody>' +
      rows
        .map(function (o) {
          var pt = postTradeCache[o.id];
          var note = pt ? noteStatusLabel(pt.contractNote.status) : '—';
          var settle = o.status === 'Settled' ? 'Settled' : pt && pt.settlement.readyToSettle ? 'Ready' : pt && pt.settlement.settled ? 'Settled' : 'Open';
          var chip = settle === 'Settled' ? 'pass' : settle === 'Ready' ? 'info' : 'warn';
          return (
            '<tr class="clickable" data-v33-order-id="' +
            mx.esc(o.ref) +
            '"><td><strong>' +
            mx.esc(o.ref) +
            '</strong><small>' +
            mx.esc(o.portfolio.name) +
            '</small></td><td>' +
            mx.esc(o.security.ticker) +
            '</td><td>' +
            (o.side === 'BUY' ? 'Buy' : 'Sell') +
            '</td><td>' +
            fmtQty(o.filledQty) +
            ' / ' +
            fmtQty(o.quantity) +
            '</td><td>' +
            slippageLabel(o.slippageBp) +
            '</td><td>' +
            mx.esc(note) +
            '</td><td><span class="v33-chip ' +
            chip +
            '">' +
            mx.esc(settle) +
            '</span></td></tr>'
          );
        })
        .join('') +
      (rows.length ? '' : '<tr><td colspan="7"><div class="v33-empty">No filled instructions in the blotter.</div></td></tr>') +
      '</tbody></table></div>';
    rows.slice(0, 12).forEach(function (o) {
      if (!postTradeCache[o.id]) fetchPostTrade(o.id).then(renderLivePostTradeTab);
    });
  }

  function patchOrderDrawerPostTrade(pt, detail) {
    if (!pt || !detail) return;
    var body = document.getElementById('drawerBody');
    if (!body) return;
    var pane = body.querySelector('[data-order-pane="posttrade"]');
    if (!pane) return;
    var fill = pane.querySelector('.order360-fill');
    if (fill) {
      var pct = fillPct(detail);
      var strong = fill.querySelector('strong');
      var bar = fill.querySelector('b');
      var track = fill.querySelector('u');
      if (strong) strong.textContent = fmtQty(detail.filledQty) + ' / ' + fmtQty(detail.quantity);
      if (bar) bar.textContent = pct + '%';
      if (track) track.style.width = pct + '%';
    }
    var mini = pane.querySelector('.order360-mini-grid');
    if (mini) {
      var cells = mini.querySelectorAll('div');
      if (cells[0]) cells[0].querySelector('strong').textContent = pt.allocation.avgPrice
        ? detail.currency + ' ' + Number(pt.allocation.avgPrice).toFixed(4)
        : '—';
      if (cells[1]) cells[1].querySelector('strong').textContent = detail.currency + ' ' + Number(pt.slippage.decisionPrice || detail.decisionPrice).toFixed(4);
      if (cells[2]) cells[2].querySelector('strong').textContent = slippageLabel(pt.slippage.bp);
      if (cells[3]) {
        var rem = Number(detail.quantity || 0) - Number(detail.filledQty || 0);
        cells[3].querySelector('strong').textContent = rem > 0 ? fmtQty(rem) : '0';
      }
    }
    var settle = pane.querySelector('.order360-settle-summary');
    if (settle) {
      var rows = settle.querySelectorAll('div');
      if (rows[0]) rows[0].querySelector('strong').textContent = pt.allocation.portfolio.name + ' · 100%';
      if (rows[1]) {
        rows[1].querySelector('strong').textContent = pt.settlement.settled
          ? 'Settled'
          : pt.settlement.readyToSettle
            ? 'Ready to settle'
            : 'Awaiting evidence';
      }
    }
    var checklist = pane.querySelector('.order360-checklist');
    if (checklist) {
      var ext = checklist.querySelector('div:last-child');
      if (ext) {
        var matched = pt.contractNote.status === 'MATCHED';
        var broken = pt.contractNote.status === 'BREAK';
        ext.className = matched ? 'done' : broken ? 'pending' : 'pending';
        ext.querySelector('i').textContent = matched ? '✓' : broken ? '!' : '4';
        ext.querySelector('small').textContent = matched
          ? pt.contractNote.lines.length + ' contract-note line(s) matched'
          : broken
            ? 'Contract-note break — open Reconciliations'
            : 'Broker/custodian evidence completes reconciliation';
      }
    }
    if (!pane.querySelector('[data-mx-contract-note]')) {
      var card = document.createElement('section');
      card.className = 'workspace-360-card';
      card.setAttribute('data-mx-contract-note', '1');
      card.style.gridColumn = '1 / -1';
      card.innerHTML =
        '<div class="section-title"><div><span>CONTRACT NOTE</span><h4>Broker feed match</h4></div><span class="tag ' +
        (pt.contractNote.status === 'MATCHED' ? 'green' : pt.contractNote.status === 'BREAK' ? 'red' : 'blue') +
        '">' +
        mx.esc(noteStatusLabel(pt.contractNote.status)) +
        '</span></div>' +
        (pt.allocation.fills.length
          ? '<div class="order360-mini-grid" style="margin-bottom:8px"><div><span>Fills</span><strong>' +
            pt.allocation.fills.length +
            '</strong></div><div><span>Gross</span><strong>' +
            mx.esc(detail.currency + ' ' + pt.allocation.gross) +
            '</strong></div><div><span>Net</span><strong>' +
            mx.esc(detail.currency + ' ' + pt.allocation.net) +
            '</strong></div><div><span>Worst fill</span><strong>' +
            slippageLabel(pt.slippage.worstFillBp) +
            '</strong></div></div>'
          : '<p class="ops-muted">No fills recorded yet.</p>') +
        (pt.contractNote.lines.length
          ? '<div class="v33-table-wrap"><table class="v33-table"><thead><tr><th>Line</th><th>Trade ref</th><th>State</th><th>Qty</th><th>Price</th></tr></thead><tbody>' +
            pt.contractNote.lines
              .map(function (l) {
                return (
                  '<tr><td>' +
                  mx.esc(l.ref) +
                  '</td><td>' +
                  mx.esc(l.externalRef) +
                  '</td><td>' +
                  mx.esc(l.status) +
                  (l.breakReason ? '<small> · ' + mx.esc(l.detail || l.breakReason) + '</small>' : '') +
                  '</td><td>' +
                  mx.esc(l.quantity) +
                  '</td><td>' +
                  mx.esc(l.price) +
                  '</td></tr>'
                );
              })
              .join('') +
            '</tbody></table></div>'
          : '<p class="ops-muted">No contract-note lines refer to this order yet.</p>') +
        (mx.can('orders.route') && detail.broker && detail.broker.id
          ? '<div style="margin-top:10px"><label class="v34-field"><span>Read contract note (CSV/JSON/text)</span><textarea class="v34-input" rows="3" id="mxContractNotePaste" placeholder="Paste broker note text or upload via ops-native"></textarea></label><button class="v34-btn" type="button" id="mxContractNoteSend">Parse & match</button></div>'
          : '');
      var grid = pane.querySelector('.order360-posttrade-grid');
      if (grid) grid.appendChild(card);
      var send = card.querySelector('#mxContractNoteSend');
      if (send) {
        send.onclick = function () {
          var text = (card.querySelector('#mxContractNotePaste') || {}).value || '';
          if (text.trim().length < 8) return mx.toast('Contract note', 'Paste note text first.', 'warn');
          return mx
            .post('/api/v1/trading-feeds/contract-notes', {
              brokerId: detail.broker.id,
              filename: 'contract-note.txt',
              content: text.trim(),
              format: 'TEXT',
            })
            .then(function (r) {
              delete postTradeCache[detail.id];
              mx.toast('Contract note parsed', (r.matched || 0) + ' matched · ' + (r.breaks || 0) + ' breaks');
              return fetchPostTrade(detail.id).then(function (fresh) {
                patchOrderDrawerPostTrade(fresh, detail);
              });
            }, mx.fail);
        };
      }
    }
  }

  function buildOrderModalBody(ref, row, pt) {
    var state = row ? statusProto(row.status) : 'Order';
    var sec = row ? row.security.ticker + ' · ' + row.security.name : ref;
    var pf = row ? row.portfolio.name : '—';
    var exec =
      row && Number(row.filledQty) > 0
        ? fmtQty(row.filledQty) + ' / ' + fmtQty(row.quantity) + ' filled'
        : 'No execution evidence yet';
    var slip = pt ? slippageLabel(pt.slippage.bp) : row ? slippageLabel(row.slippageBp) : '—';
    var note = pt ? noteStatusLabel(pt.contractNote.status) : 'Pending';
    var settle = pt
      ? pt.settlement.settled
        ? 'Settled'
        : pt.settlement.readyToSettle
          ? 'Ready to settle'
          : 'Awaiting evidence'
      : 'Post-trade workflow';
    return (
      '<div class="v34-order-lifecycle"><div class="done"><span>01</span><strong>Instruction</strong></div><div class="done"><span>02</span><strong>Pre-trade controls</strong></div><div class="' +
      (state === 'Awaiting approval' ? 'active' : 'done') +
      '"><span>03</span><strong>Approval</strong></div><div class="' +
      (['Routing', 'Partially filled', 'Filled', 'Working', 'Approved'].indexOf(state) >= 0 ? 'active' : '') +
      '"><span>04</span><strong>Execution</strong></div><div class="' +
      (state === 'Filled' || state === 'Settled' ? 'active' : '') +
      '"><span>05</span><strong>Allocation / settle</strong></div><div><span>06</span><strong>Reconcile</strong></div></div><div class="v34-grid" style="margin-top:12px"><section class="v34-card v34-span-7"><div class="v34-card-head"><div><div class="v34-kicker">ORDER DETAILS</div><h2>' +
      mx.esc(row ? (row.side === 'BUY' ? 'Buy' : 'Sell') + ' ' + fmtQty(row.quantity) + ' · ' + sec : ref) +
      '</h2></div></div><div class="v34-card-body"><div class="v34-list"><div class="v34-row"><span><strong>Limit / instruction</strong></span><em>' +
      mx.esc(row ? priceLabel(row) : '—') +
      '</em></div><div class="v34-row"><span><strong>Broker / route</strong></span><em>' +
      mx.esc(row && row.broker ? row.broker.name : '—') +
      '</em></div><div class="v34-row"><span><strong>Execution</strong><small>' +
      mx.esc(exec) +
      '</small></span><em>' +
      mx.esc(state) +
      '</em></div><div class="v34-row"><span><strong>Slippage</strong><small>Vs decision price</small></span><em>' +
      mx.esc(slip) +
      '</em></div><div class="v34-row"><span><strong>Settlement</strong><small>' +
      mx.esc(settle) +
      '</small></span><em>Post-trade</em></div></div></div></section><aside class="v34-card v34-span-5"><div class="v34-card-head"><div><div class="v34-kicker">POST-TRADE EVIDENCE</div><h2>Contract note & fills</h2></div></div><div class="v34-card-body"><div class="v34-list"><div class="v34-row"><span><strong>Contract note</strong><small>Broker feed match</small></span><em>' +
      mx.esc(note) +
      '</em></div><div class="v34-row"><span><strong>Fills recorded</strong><small>' +
      (pt && pt.allocation.fills.length ? pt.allocation.fills.length + ' execution line(s)' : 'None yet') +
      '</small></span><em>' +
      (pt && pt.allocation.fills.length ? 'Live' : 'Pending') +
      '</em></div><div class="v34-row"><span><strong>Allocation</strong><small>' +
      mx.esc(pt ? pt.allocation.portfolio.name + ' · ' + pt.allocation.sharePct + '%' : pf) +
      '</small></span><em>IBOR</em></div></div><button class="v34-btn" style="width:100%;margin-top:10px" id="v34OrderRecon">Open post-trade reconciliation</button></div></aside></div>'
    );
  }

  function loadOrders() {
    if (!mx.can('orders.view')) return Promise.resolve();
    return getEnvelope(
      '/api/v1/orders' +
        mx.qs(
          Object.assign({ limit: 100 }, filters, {
            q: filters.q || undefined,
            status: filters.status || undefined,
            portfolioId: filters.portfolioId || undefined,
            securityId: filters.securityId || undefined,
          }),
        ),
    ).then(function (body) {
      postTradeCache = {};
      var apiRows = body.data || body;
      apiByRef = {};
      apiRows.forEach(function (r) {
        apiByRef[r.ref] = r;
      });
      mx.data.orderRows = apiRows;
      mx.data.orders = apiRows.map(toProtoInline);
      mx.data.v33Orders = apiRows.map(toProtoV33);
      mx.data.orderSummary = body.summary;
      renderKpis(body.summary);
      syncTables();
      if (mx.badge) mx.badge('orders', body.summary && body.summary.awaitingApproval != null ? body.summary.awaitingApproval : apiRows.length);
    });
  }

  function resolveApiId(ref) {
    var row = apiByRef[ref];
    if (row) return row.id;
    if (typeof orders !== 'undefined') {
      var local = orders.find(function (o) {
        return o.id === ref;
      });
      if (local && local.apiId) return local.apiId;
    }
    return ref;
  }

  function loadCatalogs() {
    return Promise.all([
      mx.get('/api/v1/portfolios?status=Active').catch(function () {
        return [];
      }),
      mx.get('/api/v1/securities?limit=200').catch(function () {
        return [];
      }),
      mx.get('/api/v1/brokers').catch(function () {
        return [];
      }),
    ]).then(function (res) {
      catalogs.portfolios = Array.isArray(res[0]) ? res[0] : res[0].data || [];
      catalogs.securities = Array.isArray(res[1]) ? res[1] : res[1].data || [];
      catalogs.brokers = Array.isArray(res[2]) ? res[2] : res[2].data || [];
    });
  }

  function portfolioByName(name) {
    return (
      catalogs.portfolios.find(function (p) {
        return p.name === name;
      }) || catalogs.portfolios[0]
    );
  }

  function brokerByName(name) {
    return catalogs.brokers.find(function (b) {
      return b.name === name;
    });
  }

  function submitTicket(body, andSubmit) {
    return mx.post('/api/v1/orders', body).then(function (order) {
      if (!andSubmit) {
        mx.toast('Order saved', order.ref + ' saved as draft');
        return loadOrders();
      }
      var base = '/api/v1/orders/' + encodeURIComponent(order.id);
      return mx
        .post(base + '/validate', {})
        .then(function (v) {
          if (v.status !== 'Validated') throw new Error('Pre-trade check blocked this order');
          return mx.post(base + '/submit', { rationale: body.rationale || 'Submitted from order workstation' });
        })
        .then(function () {
          mx.toast('Order submitted', order.ref + ' entered the approval queue · cash reserved');
          return loadOrders().then(refreshCash);
        })
        .catch(function (err) {
          mx.fail(err);
          return loadOrders();
        });
    });
  }

  function ticketFromV33Draft(draft, sec) {
    var pf = portfolioByName(draft.portfolio);
    if (!pf || !sec || !sec.id) {
      mx.toast('Order blocked', 'Choose a portfolio and security that exist in the master.', 'error');
      return null;
    }
    var broker = brokerByName(draft.broker);
    var type = normalizeOrderType(draft.type);
    var body = {
      portfolioId: pf.id,
      securityId: sec.id,
      side: draft.side === 'Sell' ? 'SELL' : 'BUY',
      quantity: String(Math.round(Number(draft.qty) || 0)),
      tif: draft.tif === 'GTC' ? 'GTC' : 'DAY',
      urgency: 'Normal',
      brokerId: broker ? broker.id : undefined,
      rationale: draft.rationale || undefined,
    };
    return applyOrderTypeFields(body, type, draft.limit || sec.last || 0, draft.stop || draft.stopPrice, draft.priceOverrideReason);
  }

  mx.onLoad('orders.view', function () {
    if (liveOrders()) clearOrdersKpis();
    return Promise.all([loadCatalogs(), loadOrders()]);
  });

  mx.hydrate('orders', function () {
    if (!liveOrders()) return Promise.resolve();
    clearOrdersKpis();
    return Promise.all([loadCatalogs(), loadOrders()]);
  });

  function patchOrderDrawerCash(detail) {
    var body = document.getElementById('drawerBody');
    if (!body || !detail) return;
    var snapshot = body.querySelector('.order360-snapshot');
    if (snapshot && !snapshot.querySelector('[data-mx-cash-reserved]')) {
      var reserved = Number(detail.reservedAmount || 0);
      var art = document.createElement('article');
      art.setAttribute('data-mx-cash-reserved', '1');
      var avail = detail.cash && detail.cash.ledger ? detail.cash.ledger.available : null;
      art.innerHTML =
        '<span>Cash reserved</span><strong>' +
        mx.esc(money2(reserved, detail.currency)) +
        '</strong><small>' +
        mx.esc(avail ? money2(avail, detail.currency) + ' available now' : 'Linked to cash ledger') +
        '</small>';
      snapshot.appendChild(art);
    }
    var cashRow = body.querySelector('.order360-control-table div:nth-child(2)');
    if (cashRow && detail.cash && detail.cash.ledger) {
      var label = cashRow.querySelector('b');
      var small = cashRow.querySelector('small');
      var cashCheck = detail.precheck && detail.precheck.checks
        ? detail.precheck.checks.find(function (c) {
            return c.key === 'cash';
          })
        : null;
      if (label) label.className = cashCheck && cashCheck.result === 'Fail' ? 'fail' : 'pass';
      if (small) {
        small.textContent =
          money2(detail.cash.ledger.available, detail.currency) +
          ' available · ' +
          money2(detail.reservedAmount, detail.currency) +
          ' reserved for this order';
      }
    }
    var actions = body.querySelector('.order360-toolbar-actions');
    if (!actions || !detail.allowed) return;
    if (detail.allowed.indexOf('reject') >= 0 && !actions.querySelector('[data-mx-reject-order]')) {
      var rejectBtn = document.createElement('button');
      rejectBtn.className = 'btn secondary';
      rejectBtn.setAttribute('data-mx-reject-order', detail.ref);
      rejectBtn.textContent = 'Reject';
      rejectBtn.onclick = function () {
        rejectLiveOrder(detail);
      };
      actions.insertBefore(rejectBtn, actions.firstChild);
    }
    if (detail.allowed.indexOf('settle') >= 0 && !actions.querySelector('[data-mx-settle-order]')) {
      var settleBtn = document.createElement('button');
      settleBtn.className = 'btn primary';
      settleBtn.setAttribute('data-mx-settle-order', detail.ref);
      settleBtn.textContent = 'Settle';
      settleBtn.onclick = function () {
        settleLiveOrder(detail);
      };
      actions.appendChild(settleBtn);
    }
    if (detail.allowed.indexOf('cancel') >= 0 && !actions.querySelector('[data-mx-cancel-order]')) {
      var btn = document.createElement('button');
      btn.className = 'btn secondary';
      btn.setAttribute('data-mx-cancel-order', detail.ref);
      btn.textContent = 'Cancel';
      btn.onclick = function () {
        cancelLiveOrder(detail);
      };
      actions.insertBefore(btn, actions.firstChild);
    }
  }

  function rejectLiveOrder(detail) {
    mx.modal({
      eyebrow: 'REJECT ORDER',
      title: 'Reject · ' + detail.ref,
      body:
        '<form id="mxRejectOrder"><label class="v34-field"><span>Reason</span><textarea class="v34-input" name="reason" required rows="3"></textarea></label>' +
        (Number(detail.reservedAmount || 0) > 0
          ? '<p class="ops-muted">Releases ' + mx.esc(money2(detail.reservedAmount, detail.currency)) + ' reserved for this buy.</p>'
          : '') +
        '</form>',
      actions: [
        { label: 'Dismiss', run: function () {} },
        {
          label: 'Reject order',
          primary: true,
          run: function (m) {
            var reason = m.querySelector('[name="reason"]').value.trim();
            if (reason.length < 3) throw new Error('A reason is required');
            return mx
              .post(
                '/api/v1/orders/' + encodeURIComponent(detail.id) + '/reject',
                { reason: reason, version: detail.version },
                { stepUp: true, version: detail.version },
              )
              .then(function () {
                mx.toast('Order rejected', detail.ref + ' returned to maker · reservation released');
                closeDrawer();
                return loadOrders().then(refreshCash);
              });
          },
        },
      ],
    });
  }

  function settleLiveOrder(detail) {
    mx.modal({
      eyebrow: 'SETTLEMENT',
      title: 'Settle · ' + detail.ref,
      body: '<p class="ops-muted">Marks the filled order as settled and posts settlement journals.</p>',
      actions: [
        { label: 'Dismiss', run: function () {} },
        {
          label: 'Settle order',
          primary: true,
          run: function () {
            return mx.post('/api/v1/orders/' + encodeURIComponent(detail.id) + '/settle', {}).then(function () {
              mx.toast('Order settled', detail.ref + ' is now settled');
              closeDrawer();
              return loadOrders();
            });
          },
        },
      ],
    });
  }

  function cancelLiveOrder(detail) {
    mx.modal({
      eyebrow: 'CANCEL ORDER',
      title: 'Cancel · ' + detail.ref,
      body:
        '<form id="mxCancelOrder"><label class="v34-field"><span>Reason</span><textarea class="v34-input" name="reason" required rows="3"></textarea></label>' +
        (Number(detail.reservedAmount || 0) > 0
          ? '<p class="ops-muted">Releases ' + mx.esc(money2(detail.reservedAmount, detail.currency)) + ' reserved for this buy.</p>'
          : '') +
        '</form>',
      actions: [
        { label: 'Dismiss', run: function () {} },
        {
          label: 'Cancel order',
          primary: true,
          run: function (m) {
            var reason = m.querySelector('[name="reason"]').value.trim();
            if (reason.length < 3) throw new Error('A reason is required');
            return mx
              .post(
                '/api/v1/orders/' + encodeURIComponent(detail.id) + '/cancel',
                { reason: reason, version: detail.version },
                { version: detail.version },
              )
              .then(function () {
                mx.toast('Order cancelled', detail.ref + ' · reservation released');
                closeDrawer();
                return loadOrders().then(refreshCash);
              });
          },
        },
      ],
    });
  }

  function readPrecheckTicket() {
    var portfolioEl = document.getElementById('orderPortfolio');
    var tickerEl = document.getElementById('orderTicker');
    if (!portfolioEl || !tickerEl) return null;
    var pf = portfolioByName(portfolioEl.value);
    var sec =
      catalogs.securities.find(function (s) {
        return s.ticker === tickerEl.value;
      }) || null;
    if (!pf || !sec) return null;
    var qty = document.getElementById('orderQty');
    var price = document.getElementById('orderPrice');
    var side = document.getElementById('orderSide');
    var type = document.getElementById('orderType');
    var quantity = Math.round(Number(qty && qty.value) || 0);
    if (!quantity) return null;
    var stopEl = document.getElementById('orderStop');
    var overrideEl = document.getElementById('orderPriceOverrideReason');
    var body = {
      portfolioId: pf.id,
      securityId: sec.id,
      side: side && side.value === 'Sell' ? 'SELL' : 'BUY',
      quantity: String(quantity),
      tif: 'DAY',
      urgency: 'Normal',
    };
    return applyOrderTypeFields(
      body,
      normalizeOrderType(type && type.value),
      Number(price && price.value) || 0,
      stopEl && stopEl.value,
      overrideEl && overrideEl.value,
    );
  }

  function ticketFromV37() {
    if (typeof ticket37 === 'undefined' || !ticket37 || typeof currentSecurity37 !== 'function') return null;
    var s = currentSecurity37();
    var pf = portfolioByName(ticket37.portfolio);
    var sec =
      catalogs.securities.find(function (x) {
        return x.ticker === s.ticker;
      }) || null;
    if (!pf || !sec) return null;
    var type = normalizeOrderType(ticket37.type);
    var body = {
      portfolioId: pf.id,
      securityId: sec.id,
      side: ticket37.side === 'Sell' ? 'SELL' : 'BUY',
      quantity: String(Math.round(Number(ticket37.qty) || 0)),
      tif: ticket37.tif === 'GTC' ? 'GTC' : 'DAY',
      urgency: 'Normal',
      brokerId: brokerByName(ticket37.broker) ? brokerByName(ticket37.broker).id : undefined,
      rationale: ticket37.rationale || undefined,
    };
    return applyOrderTypeFields(body, type, ticket37.price, ticket37.stop || ticket37.stopPrice, ticket37.priceOverrideReason);
  }

  mx.wrapGlobal('openOrderDrawer', function (original, args) {
    if (!liveOrders()) return original.apply(this, args);
    var o = args[0];
    if (!o) return original.apply(this, args);
    var apiId = o.apiId || resolveApiId(o.id);
    if (!apiId) return original.apply(this, args);
    return mx
      .get('/api/v1/orders/' + encodeURIComponent(apiId))
      .then(function (detail) {
        var enriched = Object.assign({}, o, {
          apiId: detail.id,
          version: detail.version,
          reservedAmount: detail.reservedAmount,
          reservedLabel: money2(detail.reservedAmount, detail.currency),
        });
        if (Number(detail.reservedAmount || 0) > 0) {
          enriched.risk = (enriched.risk ? enriched.risk + ' · ' : '') + 'Cash reserved ' + enriched.reservedLabel;
        }
        original.call(this, enriched);
        patchOrderDrawerCash(detail);
        if (postTradeEligible(detail.status)) {
          return fetchPostTrade(detail.id).then(function (pt) {
            patchOrderDrawerPostTrade(pt, detail);
          });
        }
      })
      .catch(function () {
        return original.apply(this, args);
      });
  });

  mx.wrapGlobal('orderModal', function (original, ref) {
    if (!liveOrders() || !ref) return original.apply(this, arguments);
    var row = apiByRef[ref];
    var apiId = row ? row.id : resolveApiId(ref);
    var openLive = function (detail, pt) {
      if (typeof openModal !== 'function') return original.apply(this, arguments);
      openModal({
        eyebrow: 'ORDER 360 · DECISION → EXECUTION → SETTLEMENT',
        title: mx.esc(ref),
        subtitle:
          (row ? mx.esc(row.security.ticker + ' · ' + row.portfolio.name) : ref) +
          ' · ' +
          mx.esc(row ? statusProto(row.status) : 'Order'),
        wide: true,
        body: buildOrderModalBody(ref, row || detail, pt),
      });
      var recon = document.getElementById('v34OrderRecon');
      if (recon) {
        recon.onclick = function () {
          if (typeof closeModal === 'function') closeModal();
          if (typeof nav === 'function') nav('reconciliations');
        };
      }
    };
    if (!apiId) return original.apply(this, arguments);
    return mx
      .get('/api/v1/orders/' + encodeURIComponent(apiId))
      .then(function (detail) {
        var ptPromise = postTradeEligible(detail.status) ? fetchPostTrade(detail.id) : Promise.resolve(null);
        return ptPromise.then(function (pt) {
          openLive(detail, pt);
        });
      })
      .catch(function () {
        return original.apply(this, arguments);
      });
  });

  mx.wrapGlobal('renderOrdersView', function (original) {
    var result = original.apply(this, arguments);
    if (!liveOrders()) return result;
    if (typeof orderMain !== 'undefined' && orderMain === 'posttrade') {
      renderLivePostTradeTab();
    }
    if (typeof orderMain !== 'undefined' && orderMain === 'approvals' && mx.data.orderSummary) {
      renderKpis(mx.data.orderSummary);
    }
    return result;
  });

  mx.wrapGlobal('updateOrderKpis', function (original) {
    if (liveOrders() && mx.data.orderSummary) {
      renderKpis(mx.data.orderSummary);
      return;
    }
    return original.apply(this, arguments);
  });

  mx.wrapGlobal('renderPretrade', function (original, args) {
    var result = original.apply(this, args);
    if (!liveOrders() || !mx.can('orders.create')) return result;
    var ticket = readPrecheckTicket();
    if (!ticket) return result;
    loadCatalogs()
      .then(function () {
        return mx.post('/api/v1/orders/precheck', ticket);
      })
      .then(function (pc) {
        var cash = (pc.checks || []).find(function (c) {
          return c.key === 'cash';
        });
        if (!cash || !cash.metrics) return;
        var m = cash.metrics;
        var ccy = m.currency || pc.currency;
        var fmt = function (v) {
          return Number(v).toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 2 });
        };
        var free = Number(m.free != null ? m.free : m.available);
        var elAfter = document.getElementById('cashAfter');
        var elSide = document.getElementById('sideCashUsage');
        if (elAfter) elAfter.textContent = ccy + ' ' + fmt(free);
        if (elSide) elSide.textContent = ccy + ' ' + fmt(free);
      })
      .catch(function () {});
    return result;
  });

  window.addEventListener('matanho:legacy-ready', function () {
    mx.gate('#v33NewOrder', 'orders.create');
    mx.gate('#v33OrderImport', 'orders.create');

    mx.intercept(
      '#v33OrderImport',
      function () {
        openOrderImportModal();
        return false;
      },
      { when: liveOrders },
    );

    mx.wrapGlobal('submitTicket37', function (original) {
      if (!liveOrders() || !mx.can('orders.create')) return original.apply(this, arguments);
      return loadCatalogs()
        .then(function () {
          var body = ticketFromV37();
          if (!body) {
            mx.toast('Order blocked', 'Choose a portfolio and security that exist in the master.', 'error');
            return;
          }
          var submit = function (ticket) {
            return submitTicket(ticket, true).then(function () {
              if (typeof closeTicket37 === 'function') closeTicket37();
            });
          };
          if (body.orderType === 'STOP_LIMIT' && !body.stopPrice) {
            return promptStopLimitFields(body).then(function (patched) {
              if (!patched) return;
              return submit(patched);
            });
          }
          return submit(body);
        })
        .catch(mx.fail);
    });

    mx.wrapGlobal('approveOrder', function (original, args) {
      if (!liveOrders()) return original.apply(this, args);
      var ref = args[0];
      return mx
        .post('/api/v1/orders/' + encodeURIComponent(resolveApiId(ref)) + '/approve', {}, { stepUp: true })
        .then(function () {
          mx.toast('Order approved', ref + ' is now available for routing');
          closeDrawer();
          return loadOrders();
        })
        .catch(mx.fail);
    });

    mx.wrapGlobal('routeOrder', function (original, args) {
      if (!liveOrders()) return original.apply(this, args);
      var ref = args[0];
      return mx
        .post('/api/v1/orders/' + encodeURIComponent(resolveApiId(ref)) + '/route', {}, { stepUp: true })
        .then(function () {
          mx.toast('Order routed', ref + ' transmitted to the broker');
          closeDrawer();
          return loadOrders();
        })
        .catch(mx.fail);
    });

    mx.wrapGlobal('recordOrderFill', function (original, args) {
      if (!liveOrders()) return original.apply(this, args);
      var ref = args[0];
      var apiId = resolveApiId(ref);
      return mx.get('/api/v1/orders/' + encodeURIComponent(apiId)).then(function (detail) {
        var remaining = Number(detail.remainingQty || detail.quantity || 0);
        var price = detail.limitPrice || detail.decisionPrice || detail.avgPrice || '';
        return new Promise(function (resolve) {
          mx.modal({
            eyebrow: 'EXECUTION',
            title: 'Record fill · ' + ref,
            body:
              '<form id="mxFill"><label class="v34-field"><span>Quantity</span><input class="v34-input" name="quantity" required value="' +
              mx.esc(String(remaining)) +
              '"></label><label class="v34-field"><span>Price</span><input class="v34-input" name="price" required value="' +
              mx.esc(price ? String(price) : '') +
              '"></label><label class="v34-field"><span>Source</span><select class="v34-select" name="source"><option value="MANUAL">Manual</option><option value="BROKER_FEED">Broker feed</option><option value="FIX">FIX</option></select></label></form>',
            actions: [
              {
                label: 'Cancel',
                run: function () {
                  resolve(false);
                },
              },
              {
                label: 'Record fill',
                primary: true,
                run: function (m) {
                  var fd = new FormData(m.querySelector('#mxFill'));
                  return mx
                    .post('/api/v1/orders/' + encodeURIComponent(apiId) + '/fills', {
                      quantity: fd.get('quantity'),
                      price: String(fd.get('price')).replace(/,/g, ''),
                      source: fd.get('source') || 'MANUAL',
                    })
                    .then(function () {
                      mx.toast('Fill recorded', ref + ' updated');
                      closeDrawer();
                      return loadOrders().then(function () {
                        resolve(true);
                      });
                    });
                },
              },
            ],
          });
        });
      });
    });

    mx.wrapGlobal('openBrokerModal', function (original) {
      if (!liveOrders()) return original.apply(this, arguments);
      var ref = state.currentOrder;
      if (!ref) return original.apply(this, arguments);
      var apiId = resolveApiId(ref);
      return mx
        .get('/api/v1/orders/' + encodeURIComponent(apiId) + '/broker-instruction/preview')
        .then(function (preview) {
          var payload = preview.instruction || {};
          var node = document.querySelector('#brokerModal .email-preview');
          if (node) {
            node.innerHTML =
              '<div><span>To</span><strong>' +
              mx.esc(payload.to || (preview.broker && preview.broker.email) || '') +
              '</strong></div><div><span>Subject</span><strong>' +
              mx.esc(payload.subject || '') +
              '</strong></div><article><pre style="white-space:pre-wrap;font:inherit">' +
              mx.esc(payload.text || '') +
              '</pre></article>';
          }
          var send = document.querySelector('#brokerModal [data-action="send-broker-email"]');
          if (send) {
            var enabled = preview.routable && mx.can('orders.route');
            send.disabled = !enabled;
            send.classList.toggle('disabled-by-rbac', !enabled);
          }
          openModal('brokerModal');
        })
        .catch(mx.fail);
    });

    mx.intercept(
      '[data-action="send-broker-email"]',
      function () {
        var ref = state.currentOrder;
        if (!ref) {
          mx.toast('Transmission blocked', 'Select an approved order first.', 'error');
          return false;
        }
        return mx
          .post('/api/v1/orders/' + encodeURIComponent(resolveApiId(ref)) + '/route', {}, { stepUp: true })
          .then(function () {
            mx.toast('Broker instruction sent', ref + ' routed to the broker');
            closeModals();
            return loadOrders();
          });
      },
      { when: liveOrders },
    );

    mx.intercept(
      '[data-action="export-orders"]',
      function () {
        mx.modal({
          eyebrow: 'ORDERS',
          title: 'Export order blotter',
          subtitle: 'Current filter and tab',
          body: '<p>Download the blotter from the server as CSV or XLSX.</p>',
          actions: [
            {
              label: 'CSV',
              run: function () {
                return mx
                  .streamDownload('/api/v1/orders/export' + mx.qs(Object.assign({ format: 'csv' }, filters)), 'order-blotter.csv')
                  .then(function () {
                    mx.toast('Order blotter exported', 'CSV downloaded from the server');
                  });
              },
            },
            {
              label: 'XLSX',
              primary: true,
              run: function () {
                return mx
                  .streamDownload('/api/v1/orders/export' + mx.qs(Object.assign({ format: 'xlsx' }, filters)), 'order-blotter.xlsx')
                  .then(function () {
                    mx.toast('Order blotter exported', 'XLSX downloaded from the server');
                  });
              },
            },
          ],
        });
        return false;
      },
      { when: liveOrders },
    );

    mx.intercept(
      '[data-action="refresh-order-book"]',
      function () {
        return loadOrders().then(function () {
          mx.toast('Order workspace refreshed', 'Blotter and queues reloaded from the server');
        });
      },
      { when: liveOrders },
    );

    document.addEventListener(
      'click',
      function (e) {
        if (!liveOrders()) return;
        var approve = e.target.closest && e.target.closest('#v33ApproveOrder');
        if (approve) {
          e.preventDefault();
          e.stopImmediatePropagation();
          var pending =
            typeof orders !== 'undefined'
              ? orders.find(function (o) {
                  return o.status === 'Awaiting approval';
                })
              : null;
          if (pending) approveOrder(pending.id);
          return;
        }
        var submitBtn = e.target.closest && e.target.closest('#v33SubmitOrder,#v44OrderSubmit,[data-v56-action="submit"]');
        if (!submitBtn || !document.getElementById('page-orders')?.classList.contains('active')) return;
        if (!mx.can('orders.create')) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        loadCatalogs()
          .then(function () {
            if (typeof draft !== 'undefined' && typeof selectedSecurity !== 'undefined') {
              if (typeof syncDraft === 'function') syncDraft();
              var body = ticketFromV33Draft(draft, selectedSecurity);
              if (!body) return;
              var submit = function (ticket) {
                return submitTicket(ticket, true).then(function () {
                  var box = document.getElementById('v33InlineComposer');
                  if (box) box.remove();
                });
              };
              if (body.orderType === 'STOP_LIMIT' && !body.stopPrice) {
                return promptStopLimitFields(body).then(function (patched) {
                  if (!patched) return;
                  return submit(patched);
                });
              }
              return submit(body);
            }
            mx.toast('Order ticket', 'Use the security workstation composer to submit orders.', 'warn');
          })
          .catch(mx.fail);
      },
      true,
    );

    var blotterSearch = document.getElementById('v33BlotterSearch');
    if (blotterSearch) {
      var timer;
      blotterSearch.addEventListener('input', function () {
        if (!liveOrders()) return;
        clearTimeout(timer);
        timer = setTimeout(function () {
          filters.q = blotterSearch.value.trim();
          loadOrders().catch(mx.fail);
        }, 350);
      });
    }

    ['orderStatusFilter', 'orderSearch'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var handler = function () {
        if (!liveOrders()) return;
        if (id === 'orderSearch') filters.q = el.value.trim();
        if (id === 'orderStatusFilter') {
          var v = el.value;
          filters.status =
            v === 'all' || !v
              ? ''
              : v === 'Awaiting approval'
                ? 'AwaitingApproval'
                : v === 'Partially filled'
                  ? 'PartiallyFilled'
                  : v.replace(/\s+/g, '');
        }
        loadOrders().catch(mx.fail);
      };
      el.addEventListener('change', handler);
      if (id === 'orderSearch') {
        var t;
        el.addEventListener('input', function () {
          if (!liveOrders()) return;
          clearTimeout(t);
          t = setTimeout(handler, 350);
        });
      }
    });
  });
})();
