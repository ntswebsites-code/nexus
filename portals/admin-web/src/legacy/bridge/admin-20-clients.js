/*
 * Clients & cash accounts (v43/v49 screens). The prototype's global `clients`
 * and `cashAccounts` arrays read mx.data first (data hooks); creates, profile
 * edits and the cash-account lifecycle go to /api/v1/clients and /cash-accounts.
 */
(function () {
  'use strict';
  var mx = window.mx;

  mx.onLoad('clients.view', function () {
    return mx.get('/api/v1/clients').then(function (r) {
      mx.data.clients = r.data;
      // Local profile overrides from the prototype would mask server values.
      try {
        localStorage.removeItem('matanho-client-profiles-v10');
      } catch (e) {
        /* ignore */
      }
    });
  });
  mx.onLoad(null, function () {
    if (!mx.can('cash.view') && !mx.can('clients.view')) return;
    return mx.get('/api/v1/cash-accounts').then(function (r) {
      mx.data.cashAccounts = r.data;
      mx.storageSet('matanho-cash-accounts-v43', r.data);
    });
  });

  function live() {
    return mx.live && Array.isArray(mx.data.clients);
  }
  function serverClient(id) {
    return (mx.data.clients || []).find(function (c) {
      return c.id === id;
    });
  }

  /** Called from the patched saveClientsV10(): push changed profile fields. */
  var FIELDS = ['name', 'type', 'owner', 'ccy', 'mandate', 'risk', 'kyc', 'email', 'phone', 'registration', 'address', 'notes'];
  mx.saveClients = function (list) {
    if (!live() || !mx.can('clients.edit')) return;
    (list || []).forEach(function (c) {
      var s = serverClient(c.id);
      if (!s) return;
      var patch = {};
      FIELDS.forEach(function (f) {
        if (c[f] !== undefined && String(c[f] || '') !== String(s[f] || '')) patch[f] = c[f];
      });
      if (!Object.keys(patch).length) return;
      patch.version = s.version;
      mx.patch('/api/v1/clients/' + encodeURIComponent(c.id), patch).then(
        function (r) {
          Object.assign(s, r.client);
          c.version = r.client.version;
        },
        mx.fail,
      );
    });
  };

  mx.interceptSubmit(
    '#v49NewClientForm',
    function () {
      var v = function (id) {
        var el = document.getElementById(id);
        return el ? el.value.trim() : '';
      };
      return mx
        .post('/api/v1/clients', {
          name: v('v49NcName'),
          type: v('v49NcType'),
          ccy: v('v49NcCcy') || 'USD',
          risk: v('v49NcRisk') || 'Medium',
          mandate: v('v49NcMandate') || undefined,
          owner: v('v49NcOwner') || undefined,
        })
        .then(function (r) {
          mx.data.clients.push(r.client);
          return r.client;
        });
    },
    {
      when: function () {
        return live() && document.getElementById('v49NcName').value.trim();
      },
      after: function (client) {
        // The prototype allocated its own id; align it with the server reference.
        var local = typeof clients !== 'undefined' && clients.find(function (c) {
          return c.name === client.name && c.id !== client.id && !serverClient(c.id);
        });
        if (local) Object.assign(local, client);
      },
    },
  );

  mx.interceptSubmit(
    '#v49NewCashForm',
    function () {
      var v = function (id) {
        var el = document.getElementById(id);
        return el ? el.value.trim() : '';
      };
      return mx
        .post('/api/v1/cash-accounts', {
          clientId: v('v49CaClient'),
          provider: v('v49CaProvider'),
          identifier: v('v49CaId'),
          currency: v('v49CaCcy') || 'USD',
          portfolio: v('v49CaPortfolio') || undefined,
          type: v('v49CaType') || undefined,
        })
        .then(function (r) {
          mx.data.cashAccounts.push(r.account);
          return r.account;
        });
    },
    {
      when: function () {
        return live() && document.getElementById('v49CaProvider').value.trim() && document.getElementById('v49CaId').value.trim();
      },
      after: function (account) {
        var local = typeof cashAccounts !== 'undefined' && cashAccounts.find(function (a) {
          return a.status === 'DRAFT' && a.clientId === account.clientId && a.id !== account.id && a.provider === account.provider;
        });
        if (local) Object.assign(local, account);
        mx.storageSet('matanho-cash-accounts-v43', cashAccounts);
      },
    },
  );

  /** Cash-account lifecycle buttons call the global cashAccountLifecycle(id, action). */
  var ACTIONS = { submit: 'submit', approve: 'approve', reject: 'return', suspend: 'suspend', close: 'close', reactivate: 'reactivate' };
  mx.wrapGlobal('cashAccountLifecycle', function (original, args) {
    var id = args[0];
    var action = ACTIONS[args[1]];
    var known = (mx.data.cashAccounts || []).some(function (a) {
      return a.id === id;
    });
    if (!mx.live || !known || !action) return original.apply(this, args);
    var body = action === 'return' ? { reason: window.prompt('Reason for returning this account to the maker:') || '' } : {};
    if (action === 'return' && !body.reason) return;
    mx.post('/api/v1/cash-accounts/' + encodeURIComponent(id) + '/' + action, body).then(function (r) {
      var local = typeof cashAccounts !== 'undefined' && cashAccounts.find(function (a) {
        return a.id === id;
      });
      if (local) Object.assign(local, r.account);
      var s = mx.data.cashAccounts.find(function (a) {
        return a.id === id;
      });
      if (s) Object.assign(s, r.account);
      mx.storageSet('matanho-cash-accounts-v43', cashAccounts);
      mx.toast('Cash account ' + r.account.status.replace('_', ' ').toLowerCase(), id + ' · version ' + r.account.version);
      if (typeof window.openCashAccountDrawer === 'function') window.openCashAccountDrawer(id);
    }, mx.fail);
  });

  // ------------------------------------------------------------ W7: client 360 depth

  var CO = '/api/v1/client-ops';
  var staff = [];
  var pendingChanges = [];
  var depth360 = {};

  function depthLive() {
    return live() && mx.can('clients.view');
  }

  function loadDepthMeta() {
    return Promise.all([
      mx.get(CO + '/staff').then(function (r) {
        staff = r.data || [];
      }),
      mx.can('clients.edit')
        ? mx.get(CO + '/change-requests', { status: 'PENDING' }).then(function (r) {
            pendingChanges = r.data || [];
          })
        : null,
      mx.get(CO + '/clients/summary').then(function (r) {
        mx.data.clientSummary = r;
      }),
    ]);
  }

  mx.onLoad(null, function () {
    if (!depthLive()) return;
    return loadDepthMeta();
  });

  mx.clientsRefresh = function () {
    return Promise.all([
      mx.get('/api/v1/clients').then(function (r) {
        mx.data.clients = r.data;
      }),
      mx.get('/api/v1/cash-accounts').then(function (r) {
        mx.data.cashAccounts = r.data;
      }),
      loadDepthMeta(),
    ]);
  };

  function fetch360(clientId) {
    return mx.get(CO + '/clients/' + encodeURIComponent(clientId) + '/360').then(function (r) {
      depth360[clientId] = r;
      return r;
    });
  }

  function patchClientSummaryKpis() {
    var s = mx.data.clientSummary;
    var host = document.querySelector('#page-clients .v49-kpis, #page-clients .stat-grid');
    if (!s || !host) return;
    var tiles = host.querySelectorAll('article, .stat-card');
    if (tiles.length >= 4) {
      var t = tiles[0].querySelector('strong');
      if (t) t.textContent = String(s.total || 0);
      t = tiles[1] && tiles[1].querySelector('strong');
      if (t) t.textContent = String(s.onHold || 0);
      t = tiles[2] && tiles[2].querySelector('strong');
      if (t) t.textContent = String(s.reviewOverdue || 0);
    }
  }

  function inject360Controls(c, detail) {
    var drawer = document.querySelector('.drawer .drawer-body, #detailDrawer .drawer-body');
    if (!drawer || drawer.querySelector('.mx-client-depth')) return;
    var cl = detail.client || {};
    var mandates = detail.mandates || [];
    var box = document.createElement('div');
    box.className = 'mx-client-depth detail-section';
    box.innerHTML =
      '<h3>Relationship controls</h3><div class="detail-grid compact">' +
      '<div class="detail-field"><span>Dealing hold</span><strong>' +
      (cl.dealingHold ? 'Active · ' + mx.esc(cl.holdReason || '') : 'None') +
      '</strong></div><div class="detail-field"><span>Pending changes</span><strong>' +
      (detail.pendingChanges || 0) +
      '</strong></div></div>' +
      (mx.can('clients.edit')
        ? '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">' +
          '<button type="button" class="btn secondary" data-mx-hold="1">Place dealing hold</button>' +
          (cl.dealingHold ? '<button type="button" class="btn secondary" data-mx-hold-release="1">Request hold release</button>' : '') +
          '<button type="button" class="btn secondary" data-mx-owner="1">Assign owner</button>' +
          '<button type="button" class="btn secondary" data-mx-review="1">Set review date</button>' +
          '<button type="button" class="btn secondary" data-mx-report="1">Generate report</button>' +
          '</div>'
        : '') +
      (mandates.length
        ? '<div class="detail-section" style="margin-top:12px"><h4>Mandates</h4><div class="detail-grid">' +
          mandates
            .map(function (m) {
              return (
                '<div class="detail-field"><span>' +
                mx.esc(m.name) +
                '</span><strong>' +
                mx.esc(m.status) +
                '</strong>' +
                (mx.can('clients.edit') && m.status === 'Shell'
                  ? ' <button type="button" class="text-btn" data-mx-mandate="' +
                    mx.esc(m.id) +
                    '" data-mx-mstatus="Active">Activate</button>'
                  : mx.can('clients.edit') && m.status === 'Active'
                    ? ' <button type="button" class="text-btn" data-mx-mandate="' +
                      mx.esc(m.id) +
                      '" data-mx-mstatus="Closed">Close</button>'
                    : '') +
                '</div>'
              );
            })
            .join('') +
          '</div></div>'
        : '');
    drawer.appendChild(box);
    box.querySelector('[data-mx-hold]') &&
      (box.querySelector('[data-mx-hold]').onclick = function () {
        var reason = window.prompt('Reason for placing a dealing hold (min 5 characters):');
        if (!reason || reason.trim().length < 5) return;
        mx.post(CO + '/clients/' + encodeURIComponent(c.id) + '/dealing-hold', { hold: true, reason: reason.trim() }).then(function () {
          mx.toast('Dealing hold placed', c.name);
          return fetch360(c.id).then(function () {
            box.remove();
            inject360Controls(c, depth360[c.id]);
          });
        }, mx.fail);
      });
    box.querySelector('[data-mx-hold-release]') &&
      (box.querySelector('[data-mx-hold-release]').onclick = function () {
        var reason = window.prompt('Reason for requesting hold release (checker required):');
        if (!reason || reason.trim().length < 5) return;
        mx.post(CO + '/clients/' + encodeURIComponent(c.id) + '/change-requests', {
          kind: 'DEALING_HOLD_RELEASE',
          reason: reason.trim(),
        }).then(function () {
          mx.toast('Change request submitted', 'An independent approver must release the hold.');
          return mx.clientsRefresh();
        }, mx.fail);
      });
    box.querySelector('[data-mx-owner]') &&
      (box.querySelector('[data-mx-owner]').onclick = function () {
        var opts = staff
          .map(function (s) {
            return '<option value="' + mx.esc(s.id) + '">' + mx.esc(s.name) + '</option>';
          })
          .join('');
        mx.modal({
          eyebrow: 'CLIENT · RELATIONSHIP OWNER',
          title: c.name,
          body:
            '<label class="detail-field"><span>Owner</span><select class="v34-select" id="mxOwnerPick">' +
            opts +
            '</select></label>',
          actions: [
            {
              label: 'Save',
              primary: true,
              run: function () {
                var el = document.getElementById('mxOwnerPick');
                return mx
                  .post(CO + '/clients/' + encodeURIComponent(c.id) + '/relationship-owner', { userId: el ? el.value : null })
                  .then(function () {
                    mx.toast('Relationship owner updated', c.id);
                    return fetch360(c.id);
                  });
              },
            },
          ],
        });
      });
    box.querySelector('[data-mx-review]') &&
      (box.querySelector('[data-mx-review]').onclick = function () {
        mx.modal({
          eyebrow: 'CLIENT · REVIEW DATE',
          title: c.name,
          body:
            '<label class="detail-field"><span>Next review</span><input type="date" class="v34-input" id="mxReviewDate"></label>' +
            '<label class="detail-field"><span>Note</span><textarea class="v34-textarea" id="mxReviewNote"></textarea></label>',
          actions: [
            {
              label: 'Save',
              primary: true,
              run: function () {
                var d = document.getElementById('mxReviewDate');
                var n = document.getElementById('mxReviewNote');
                return mx
                  .post(CO + '/clients/' + encodeURIComponent(c.id) + '/review-date', {
                    nextReviewDate: d && d.value ? d.value : null,
                    note: n && n.value.trim() ? n.value.trim() : undefined,
                  })
                  .then(function () {
                    mx.toast('Review date saved', c.id);
                  });
              },
            },
          ],
        });
      });
    box.querySelector('[data-mx-report]') &&
      (box.querySelector('[data-mx-report]').onclick = function () {
        mx.runClientReport(c.id, detail);
      });
    mx.$$('[data-mx-mandate]', box).forEach(function (btn) {
      btn.onclick = function () {
        var mref = btn.getAttribute('data-mx-mandate');
        var st = btn.getAttribute('data-mx-mstatus');
        var reason = window.prompt('Reason for mandate ' + st.toLowerCase() + ' (maker-checker):');
        if (!reason || reason.trim().length < 5) return;
        mx.post(CO + '/clients/' + encodeURIComponent(c.id) + '/change-requests', {
          kind: 'MANDATE_STATUS',
          mandate: mref,
          status: st,
          reason: reason.trim(),
        }).then(function () {
          mx.toast('Mandate change submitted', mref + ' awaits checker approval.');
        }, mx.fail);
      };
    });
  }

  mx.runClientReport = function (clientId, detail) {
    detail = detail || depth360[clientId];
    var portfolioId = detail && detail.portfolios && detail.portfolios[0] && detail.portfolios[0].id;
    if (!portfolioId) {
      mx.toast('No portfolio mapped', 'Link a portfolio to this client before generating a holdings report.', 'warn');
      return Promise.resolve(false);
    }
    return mx
      .post('/api/v1/reports/runs', {
        report: 'HOLDINGS',
        format: 'PDF',
        params: { portfolioId: portfolioId, asOf: new Date().toISOString().slice(0, 10) },
      })
      .then(function (r) {
        mx.toast('Client report queued', (r.run && r.run.ref) || 'HOLDINGS run created.');
        if (r.run && r.run.id) return mx.download('/api/v1/reports/runs/' + encodeURIComponent(r.run.id) + '/link');
      }, mx.fail);
  };

  mx.wrapGlobal('openClientDrawer', function (original, c) {
    var result = original.apply(this, arguments);
    if (!depthLive() || !c || !c.id) return result;
    fetch360(c.id)
      .then(function (detail) {
        inject360Controls(c, detail);
        var hero = document.querySelector('.client-360-hero .hero-status-line');
        if (hero && detail.client && detail.client.nextReviewDate) {
          hero.lastElementChild.textContent = 'Next review · ' + mx.date(detail.client.nextReviewDate, { day: '2-digit', month: 'short', year: 'numeric' });
        }
      })
      .catch(mx.fail);
    return result;
  });

  mx.wrapGlobal('exportCash49', function (original) {
    if (!depthLive()) return original.apply(this, arguments);
    var rows = cashAccounts || [];
    var lines = ['Account,Client,Portfolio,Provider,Currency,Available,Reconciliation,State'];
    rows.forEach(function (a) {
      lines.push(
        [a.id, a.client, a.portfolio, a.provider, a.currency, a.available, a.recon, a.status]
          .map(function (v) {
            return '"' + String(v).replace(/"/g, '""') + '"';
          })
          .join(','),
      );
    });
    var csv = lines.join('\n');
    if (typeof downloadTextFile === 'function') downloadTextFile('matanho-cash-account-register.csv', csv);
    mx.toast('Cash register exported', rows.length + ' controlled accounts exported from live data.');
  });

  mx.wrapGlobal('openCashAccountDrawer', function (original, id) {
    var result = original.apply(this, arguments);
    if (!depthLive() || !mx.can('clients.view')) return result;
    setTimeout(function () {
      var drawer = document.querySelector('.drawer .drawer-body, #detailDrawer .drawer-body');
      if (!drawer || drawer.querySelector('[data-mx-reveal-id]')) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn secondary';
      btn.setAttribute('data-mx-reveal-id', id);
      btn.textContent = 'Reveal full identifier (audited)';
      btn.style.marginTop = '10px';
      btn.onclick = function () {
        mx.post('/api/v1/cash-accounts/' + encodeURIComponent(id) + '/reveal-identifier', {}).then(function (r) {
          mx.toast('Identifier revealed', 'Access logged · ' + (r.identifier || r.account && r.account.identifier));
          btn.textContent = 'Identifier: ' + (r.identifier || (r.account && r.account.identifier) || '—');
          btn.disabled = true;
        }, mx.fail);
      };
      drawer.appendChild(btn);
    }, 50);
    return result;
  });

  mx.intercept(
    '#v49ClientReport, #v49ClientReport2',
    function () {
      var c =
        typeof activeClientId !== 'undefined' && clients.find(function (x) {
          return x.id === activeClientId;
        });
      if (!c) throw new Error('Select a client first');
      return fetch360(c.id).then(function (detail) {
        return mx.runClientReport(c.id, detail);
      });
    },
    { when: depthLive },
  );

  mx.intercept(
    '[data-action="export-cash-accounts"], [data-action="generate-client-report"]',
    function (el) {
      var action = el.getAttribute('data-action');
      if (action === 'export-cash-accounts') {
        if (typeof exportCash49 === 'function') exportCash49();
        return false;
      }
      if (typeof openReportEditor === 'function') {
        var c = typeof clients !== 'undefined' && clients[0];
        if (c) return fetch360(c.id).then(function (d) {
          return mx.runClientReport(c.id, d);
        });
      }
    },
    { when: depthLive },
  );

  if (mx.can('clients.edit')) {
    mx.onLoad('clients.view', function () {
      setTimeout(patchClientSummaryKpis, 800);
    });
  }

  mx.showChangeRequests = function () {
    return mx.get(CO + '/change-requests', { status: 'PENDING' }).then(function (r) {
      var rows = r.data || [];
      mx.modal({
        eyebrow: 'CLIENT OPS · PENDING CHANGES',
        title: 'Maker-checker queue',
        subtitle: rows.length + ' pending',
        wide: true,
        body:
          '<div class="v34-list">' +
          rows
            .map(function (cr) {
              return (
                '<div class="v34-row"><span><strong>' +
                mx.esc(cr.kind) +
                '</strong><small>' +
                mx.esc(cr.clientName || cr.clientRef) +
                ' · ' +
                mx.esc(cr.makerName || '') +
                '</small></span><em>' +
                (mx.can('clients.edit')
                  ? '<button type="button" class="v34-btn small" data-mx-cr-approve="' +
                    cr.id +
                    '">Approve</button> <button type="button" class="v34-btn small" data-mx-cr-reject="' +
                    cr.id +
                    '">Reject</button>'
                  : mx.esc(cr.status)) +
                '</em></div>'
              );
            })
            .join('') +
          '</div>',
        actions: [],
      });
      mx.$$('[data-mx-cr-approve]').forEach(function (b) {
        b.onclick = function () {
          var note = window.prompt('Approval note:') || '';
          mx.post(CO + '/change-requests/' + b.getAttribute('data-mx-cr-approve') + '/approve', { note: note }).then(function () {
            mx.toast('Change approved', 'Applied to client record.');
            mx.clientsRefresh();
          }, mx.fail);
        };
      });
      mx.$$('[data-mx-cr-reject]').forEach(function (b) {
        b.onclick = function () {
          var note = window.prompt('Rejection reason:') || '';
          if (!note.trim()) return;
          mx.post(CO + '/change-requests/' + b.getAttribute('data-mx-cr-reject') + '/reject', { note: note.trim() }).then(function () {
            mx.toast('Change rejected', 'Maker notified.');
          }, mx.fail);
        };
      });
    });
  };
})();
