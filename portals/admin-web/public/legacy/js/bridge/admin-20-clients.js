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
      mx.data.clients = r.data || r;
      // Feed the v49 prototype's global array in place so its renderer shows server data.
      try {
        if (typeof clients !== 'undefined' && Array.isArray(clients) && Array.isArray(mx.data.clients)) {
          mx.replace(clients, mx.data.clients);
        }
        if (typeof renderClientsV49 === 'function') renderClientsV49();
      } catch (e) {
        /* prototype renderer not ready yet; hydrate() re-renders */
      }
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
      mx.data.cashAccounts = r.data || r;
      try {
        if (typeof cashAccounts !== 'undefined' && Array.isArray(cashAccounts) && Array.isArray(mx.data.cashAccounts)) {
          mx.replace(cashAccounts, mx.data.cashAccounts);
        }
      } catch (e) {
        /* ignore */
      }
      mx.storageSet('matanho-cash-accounts-v43', mx.data.cashAccounts);
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
      mx.toast('Cash account ' + r.account.status.replace('_', ' ').toLowerCase(), id + ' Â· version ' + r.account.version);
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

  function clientsLive() {
    return mx.live && mx.strict('clients');
  }

  function clearClientsKpis() {
    document.querySelectorAll('#page-clients .client-kpis article strong, #page-clients .v49-kpis article strong, #page-clients .stat-grid .stat-card strong').forEach(function (el) {
      el.textContent = 'â€”';
      el.className = '';
    });
    document.querySelectorAll('#page-clients .client-kpis article small, #page-clients .v49-kpis article small').forEach(function (el) {
      el.textContent = 'Loadingâ€¦';
    });
  }

  function loadDepthMeta() {
    return Promise.all([
      mx.get(CO + '/staff').then(function (r) {
        staff = r.data || [];
      }),
      mx.can('clients.edit')
        ? mx.get(CO + '/change-requests', { status: 'PENDING' }).then(function (r) {
            pendingChanges = r.data || [];
            updatePendingChangesBadge();
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
        mx.data.clients = r.data || r;
      }),
      mx.get('/api/v1/cash-accounts').then(function (r) {
        mx.data.cashAccounts = r.data || r;
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
    var host = document.querySelector('#page-clients .client-kpis, #page-clients .v49-kpis, #page-clients .stat-grid');
    if (!s || !host) return;
    var tiles = host.querySelectorAll('article, .stat-card');
    var accounts = mx.data.cashAccounts || [];
    var approved = accounts.filter(function (a) {
      return a.status === 'APPROVED' || a.status === 'ACTIVE';
    });
    if (tiles[0]) {
      var t0 = tiles[0].querySelector('strong');
      if (t0) t0.textContent = String(s.total || 0);
      var sm0 = tiles[0].querySelector('small');
      if (sm0) {
        var inst = (s.byKyc && s.byKyc.APPROVED) || s.total || 0;
        sm0.textContent = (s.onHold || 0) + ' on hold Â· ' + (s.reviewDueIn30Days || 0) + ' reviews due';
      }
    }
    if (tiles[1]) {
      var t1 = tiles[1].querySelector('strong');
      if (t1) t1.textContent = String(approved.length || (s.accountsByStatus && (s.accountsByStatus.APPROVED || s.accountsByStatus.ACTIVE)) || 0);
      var sm1 = tiles[1].querySelector('small');
      if (sm1) sm1.textContent = accounts.length ? accounts.length + ' total accounts' : 'Cash account registry';
    }
    if (tiles[2]) {
      var t2 = tiles[2].querySelector('strong');
      if (t2) {
        var totalCash = accounts.reduce(function (sum, a) {
          return sum + Number(a.balance || a.availableBalance || 0);
        }, 0);
        t2.textContent = totalCash ? mx.money(totalCash, 'USD') : 'â€”';
      }
      var sm2 = tiles[2].querySelector('small');
      if (sm2) sm2.textContent = 'Across bank, broker and custody accounts';
    }
    if (tiles[3]) {
      var exc = Number(s.onHold || 0) + Number(s.reviewOverdue || 0);
      var t3 = tiles[3].querySelector('strong');
      if (t3) {
        t3.textContent = String(exc);
        t3.className = exc ? 'attention' : '';
      }
      var sm3 = tiles[3].querySelector('small');
      if (sm3) sm3.textContent = (s.reviewOverdue || 0) + ' overdue reviews Â· ' + (s.onHold || 0) + ' dealing holds';
    }
  }

  function updatePendingChangesBadge() {
    var btn = document.querySelector('[data-mx-pending-changes]');
    if (!btn) return;
    var n = pendingChanges.length;
    btn.textContent = n ? 'Pending changes (' + n + ')' : 'Pending changes';
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
      (cl.dealingHold ? 'Active Â· ' + mx.esc(cl.holdReason || '') : 'None') +
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
          '<button type="button" class="btn secondary" data-mx-portal-users="1">Portal users</button>' +
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
          eyebrow: 'CLIENT Â· RELATIONSHIP OWNER',
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
          eyebrow: 'CLIENT Â· REVIEW DATE',
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
    box.querySelector('[data-mx-portal-users]') &&
      (box.querySelector('[data-mx-portal-users]').onclick = function () {
        openInvestorUsersModal(c);
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
          hero.lastElementChild.textContent = 'Next review Â· ' + mx.date(detail.client.nextReviewDate, { day: '2-digit', month: 'short', year: 'numeric' });
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
          mx.toast('Identifier revealed', 'Access logged Â· ' + (r.identifier || r.account && r.account.identifier));
          btn.textContent = 'Identifier: ' + (r.identifier || (r.account && r.account.identifier) || 'â€”');
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

  mx.onLoad('clients.view', function () {
    if (!document.getElementById('page-clients')) return;
    if (clientsLive()) clearClientsKpis();
    return loadDepthMeta().then(function () {
      patchClientSummaryKpis();
      ensureClientsPageActions();
    });
  });

  mx.hydrate('clients', function () {
    if (!clientsLive()) return Promise.resolve();
    clearClientsKpis();
    return loadDepthMeta().then(function () {
      patchClientSummaryKpis();
      ensureClientsPageActions();
    });
  });

  window.addEventListener('matanho:legacy-ready', function () {
    ensureClientsPageActions();
    if (clientsLive()) {
      loadDepthMeta().then(function () {
        patchClientSummaryKpis();
      });
    }
  });

  function openInvestorUsersModal(c) {
    if (!mx.can('clients.view')) return;
    mx.get('/api/v1/clients/investor-users?clientId=' + encodeURIComponent(c.id)).then(function (body) {
      var members = body.data || [];
      var invites = body.invitations || [];
      mx.modal({
        eyebrow: 'INVESTOR PORTAL',
        title: 'Portal users Â· ' + c.name,
        subtitle: members.length + ' active Â· ' + invites.length + ' invited',
        wide: true,
        body:
          '<div class="v34-list">' +
          members
            .map(function (u) {
              return (
                '<div class="v34-row"><span><strong>' +
                mx.esc(u.name || u.email) +
                '</strong><small>' +
                mx.esc(u.email) +
                ' Â· ' +
                mx.esc(u.role) +
                ' Â· ' +
                mx.esc(u.status) +
                '</small></span><em>' +
                (mx.can('clients.edit')
                  ? '<button type="button" class="v34-btn small" data-mx-inv-remove="' +
                    mx.esc(u.id) +
                    '">Remove</button>'
                  : '') +
                '</em></div>'
              );
            })
            .join('') +
          invites
            .map(function (u) {
              return (
                '<div class="v34-row"><span><strong>' +
                mx.esc(u.email) +
                '</strong><small>Invited Â· expires ' +
                mx.esc(u.expiresAt ? String(u.expiresAt).slice(0, 10) : 'â€”') +
                '</small></span><em>' +
                (mx.can('clients.edit')
                  ? '<button type="button" class="v34-btn small" data-mx-inv-revoke="' +
                    mx.esc(u.id) +
                    '">Revoke</button>'
                  : '') +
                '</em></div>'
              );
            })
            .join('') +
          '</div>' +
          (mx.can('clients.edit')
            ? '<form id="mxInviteUser" style="margin-top:12px"><label class="v34-field"><span>Email</span><input class="v34-input" name="email" type="email" required></label><label class="v34-field"><span>Name</span><input class="v34-input" name="name"></label><label class="v34-field"><span>Role</span><select class="v34-select" name="role"><option value="finance">Finance</option><option value="investment">Investment</option><option value="admin">Admin</option><option value="auditor">Auditor</option></select></label></form>'
            : ''),
        actions: mx.can('clients.edit')
          ? [
              {
                label: 'Invite user',
                primary: true,
                run: function (m) {
                  var fd = new FormData(m.querySelector('#mxInviteUser'));
                  return mx
                    .post('/api/v1/clients/investor-users', {
                      clientId: c.id,
                      email: fd.get('email'),
                      name: fd.get('name') || undefined,
                      role: fd.get('role') || 'finance',
                    })
                    .then(function () {
                      mx.toast('Invitation sent', String(fd.get('email')));
                      return openInvestorUsersModal(c);
                    });
                },
              },
              { label: 'Close', run: function () {} },
            ]
          : [{ label: 'Close', run: function () {} }],
      });
      mx.$$('[data-mx-inv-remove]').forEach(function (b) {
        b.onclick = function () {
          mx.del('/api/v1/clients/investor-users/' + encodeURIComponent(b.getAttribute('data-mx-inv-remove'))).then(function () {
            mx.toast('Portal access removed', c.name);
            return openInvestorUsersModal(c);
          }, mx.fail);
        };
      });
      mx.$$('[data-mx-inv-revoke]').forEach(function (b) {
        b.onclick = function () {
          mx.del('/api/v1/clients/investor-users/' + encodeURIComponent(b.getAttribute('data-mx-inv-revoke'))).then(function () {
            mx.toast('Invitation revoked', c.name);
            return openInvestorUsersModal(c);
          }, mx.fail);
        };
      });
    }, mx.fail);
  }
  mx.openInvestorUsersModal = openInvestorUsersModal;

  function ensureClientsPageActions() {
    if (!depthLive()) return;
    var head = document.querySelector('#page-clients .page-actions');
    if (!head || head.querySelector('[data-mx-pending-changes]')) return;
    if (mx.can('clients.edit')) {
      var btn = document.createElement('button');
      btn.className = 'btn secondary';
      btn.setAttribute('data-mx-pending-changes', '1');
      btn.textContent = 'Pending changes';
      btn.onclick = function () {
        mx.showChangeRequests();
      };
      head.insertBefore(btn, head.firstChild);
    }
  }

  mx.showChangeRequests = function () {
    return mx.get(CO + '/change-requests', { status: 'PENDING' }).then(function (r) {
      var rows = r.data || [];
      mx.modal({
        eyebrow: 'CLIENT OPS Â· PENDING CHANGES',
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
                ' Â· ' +
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

