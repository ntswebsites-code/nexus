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

  function renderKpis(summary) {
    if (!summary) return;
    var w = document.getElementById('v33WorkingCount');
    var a = document.getElementById('v33ApprovalCount');
    if (w) w.textContent = String(summary.working != null ? summary.working : 0);
    if (a) a.textContent = String(summary.awaitingApproval != null ? summary.awaitingApproval : 0);
    var kpis = document.querySelectorAll('#page-orders .v33-kpis article');
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
    }
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
          mx.toast('Order submitted', order.ref + ' entered the approval queue');
          return loadOrders();
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
    return {
      portfolioId: pf.id,
      securityId: sec.id,
      side: draft.side === 'Sell' ? 'SELL' : 'BUY',
      quantity: String(Math.round(Number(draft.qty) || 0)),
      orderType: draft.type === 'Market' ? 'MARKET' : 'LIMIT',
      limitPrice: draft.type === 'Market' ? undefined : String(draft.limit || sec.last || 0),
      tif: draft.tif === 'GTC' ? 'GTC' : 'DAY',
      urgency: 'Normal',
      brokerId: broker ? broker.id : undefined,
      rationale: draft.rationale || undefined,
    };
  }

  mx.onLoad('orders.view', function () {
    return Promise.all([loadCatalogs(), loadOrders()]);
  });

  mx.hydrate('orders', function () {
    if (!liveOrders()) return Promise.resolve();
    return Promise.all([loadCatalogs(), loadOrders()]);
  });

  window.addEventListener('matanho:legacy-ready', function () {
    mx.gate('#v33NewOrder', 'orders.create');
    mx.gate('#v33OrderImport', 'orders.create');

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
        return mx.download('/api/v1/orders/export' + mx.qs(Object.assign({ format: 'csv' }, filters))).then(function () {
          mx.toast('Order blotter exported', 'CSV downloaded from the server');
        });
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
              return submitTicket(body, true).then(function () {
                var box = document.getElementById('v33InlineComposer');
                if (box) box.remove();
              });
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
