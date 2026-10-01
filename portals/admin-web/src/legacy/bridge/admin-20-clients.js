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
})();
