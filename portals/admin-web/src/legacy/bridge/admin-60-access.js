/*
 * Admin bridge - RBAC, platform settings and audit evidence.
 * The role context is the signed-in user's real roles: the prototype role
 * switcher only offers roles the user holds (plus an explicit preview), and
 * every matrix / assignment / policy / settings change persists through
 * /api/v1/admin with an audit event. The audit trail lists the hash-chained
 * server events; filter and CSV export query the API.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var V1 = '/api/v1/admin';
  var storedSettings = null;
  var myRoles = [];

  function policyShape(p) {
    return { orderApproval: p.orderApproval, cashApproval: p.cashApproval, navApproval: p.navApproval, bankApproval: p.bankApproval, sessionTimeout: p.sessionTimeout, mfa: p.mfa };
  }

  mx.onLoad(null, function () {
    return Promise.all([
      mx.get(V1 + '/access-context').then(function (r) {
        myRoles = r.roles;
        if (r.role) mx.data.role = r.role;
        mx.data.roleLabels = r.roleLabels;
        mx.data.rolePermissions = r.rolePermissions;
      }),
      mx.get(V1 + '/policy').then(function (p) {
        mx.data.accessPolicy = policyShape(p);
      }),
      mx.get(V1 + '/settings').then(function (r) {
        storedSettings = r.settings;
      }),
    ]);
  });

  mx.onLoad('admin.rbac', function () {
    return mx.get(V1 + '/users').then(function (r) {
      mx.data.rbacUsers = r.data;
    });
  });

  function has(fn) {
    return typeof window[fn] === 'function';
  }
  function call(fn) {
    if (has(fn)) return window[fn].apply(null, [].slice.call(arguments, 1));
  }

  /** Downloads a CSV (or any file) the API streams with the session cookie. */
  function downloadFile(path, fallbackName) {
    return fetch(mx.api + path, { credentials: 'include' }).then(function (res) {
      if (!res.ok) {
        return res.json().then(
          function (j) { throw new Error((j && j.error && j.error.message) || 'Export failed'); },
          function () { throw new Error('Export failed (' + res.status + ')'); },
        );
      }
      var name = ((res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1] || fallbackName;
      return res.blob().then(function (blob) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          URL.revokeObjectURL(a.href);
          a.remove();
        }, 1000);
      });
    });
  }

  // ------------------------------------------------------------ role context

  function realContext() {
    return mx.live && mx.user && typeof state !== 'undefined' && state.role === mx.data.role;
  }

  // Multi-role users: effective permissions are the union of every role held.
  mx.wrapGlobal('hasPermission', function (original, args) {
    if (realContext()) return mx.user.permissions.indexOf(args[0]) >= 0;
    return original.apply(this, args);
  });

  mx.wrapGlobal('renderRoleSwitcherV8', function (original, args) {
    var result = original.apply(this, args);
    var sw = document.getElementById('roleSwitcher');
    if (!mx.live || !sw || !myRoles.length) return result;
    var keys = myRoles.slice();
    if (keys.indexOf(state.role) < 0) keys.push(state.role);
    sw.innerHTML = keys
      .map(function (k) {
        var label = roleLabels[k] || k;
        return '<option value="' + mx.esc(k) + '">' + mx.esc(myRoles.indexOf(k) >= 0 ? label : 'Preview · ' + label) + '</option>';
      })
      .join('');
    sw.value = state.role;
    return result;
  });

  mx.intercept(
    '#profileButton',
    function () {
      var u = mx.user;
      openDrawer({
        eyebrow: 'USER & SESSION',
        title: u.name || u.email,
        subtitle: u.email,
        body:
          '<section class="detail-section"><h3>Access</h3><p>Roles: <strong>' +
          mx.esc(myRoles.map(function (k) { return roleLabels[k] || k; }).join(', ') || '—') +
          '</strong></p><p>' + u.permissions.length + ' effective permissions · controlled session · audit logging enabled.</p></section>' +
          '<div class="form-actions"><button type="button" class="btn secondary" data-mx-mfa>Two-factor authentication</button><button type="button" class="btn secondary" data-mx-signout>Sign out</button></div>',
      });
      document.querySelector('#drawerBody [data-mx-mfa]').onclick = function () {
        mx.mfaSetup().catch(mx.fail);
      };
      document.querySelector('#drawerBody [data-mx-signout]').onclick = function () {
        mx.post('/api/auth/logout', {}).finally(function () {
          window.location.assign('/login');
        });
      };
    },
    { when: function () { return mx.live && !!mx.user; } },
  );

  // ------------------------------------------------------------ RBAC matrix & users

  mx.wrapGlobal('togglePermissionV8', function (original, args) {
    var role = args[0], code = args[1], button = args[2];
    if (!mx.live || role === 'system_admin') return original.apply(this, args);
    var current = (rolePermissions[role] || []).slice();
    var i = current.indexOf(code);
    if (i >= 0) current.splice(i, 1);
    else current.push(code);
    return mx.put(V1 + '/roles/' + encodeURIComponent(role) + '/permissions', { permissions: current }).then(function (r) {
      rolePermissions[role] = r.role.permissions;
      if (button) button.classList.toggle('on', i < 0);
      call('applyRBAC', false);
      call('renderSodV8');
      toast('Permission updated', roleLabels[role] + ' ' + (i >= 0 ? 'no longer has' : 'now has') + ' ' + code + '. Change recorded in the audit trail.');
    }, function (e) {
      mx.fail(e);
      call('renderRbacMatrix');
    });
  });

  function refreshUsers(data) {
    mx.replace(rbacUsersV8, data);
    call('renderRbacUsersV8');
    call('renderSodV8');
  }

  mx.wrapGlobal('assignUserRoleV8', function (original, args) {
    if (!mx.live) return original.apply(this, args);
    var u = rbacUsersV8[args[0]], role = args[1];
    if (!u || !roleLabels[role]) return;
    if (String(u.id || '').indexOf('invite:') === 0) {
      toast('Invitation pending', u.email + ' has not accepted yet. Revoke and re-invite to change the role.', 'warn');
      return call('renderRbacUsersV8');
    }
    if (u.role === 'system_admin' && role !== 'system_admin' && !confirm('Remove this user from the protected System Administrator role?')) return call('renderRbacUsersV8');
    if (role === 'system_admin' && u.role !== 'system_admin' && !confirm('Assign privileged System Administrator access? This role remains platform-only and has no monetary transaction permissions.')) return call('renderRbacUsersV8');
    var roles = [role].concat((u.roles || []).filter(function (k) { return k !== u.role && k !== role; }));
    return mx.put(V1 + '/users/' + encodeURIComponent(u.id) + '/roles', { roles: roles }).then(function (r) {
      refreshUsers(r.data);
      toast('User role updated', u.name + ' is now assigned to ' + roleLabels[role] + '.');
    }, function (e) {
      mx.fail(e);
      call('renderRbacUsersV8');
    });
  });

  mx.wrapGlobal('renderRbacUsersV8', function (original, args) {
    var result = original.apply(this, args);
    if (!mx.live) return result;
    mx.$$('#rbacUserRows [data-preview-user]').forEach(function (b) {
      var u = rbacUsersV8[+b.getAttribute('data-preview-user')];
      if (!u || !u.mfa || u.id === mx.user.id) return;
      var reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'row-action';
      reset.textContent = 'Reset MFA';
      reset.onclick = function () {
        var reason = window.prompt('Reason for resetting ' + u.name + '’s second factor (e.g. lost device, identity verified by phone)');
        if (!reason) return;
        mx.post(V1 + '/users/' + encodeURIComponent(u.id) + '/mfa-reset', { reason: reason }).then(function (r) {
          refreshUsers(r.data);
          toast('Second factor reset', u.name + ' will set up a new authenticator at next sign-in.');
        }, mx.fail);
      };
      b.insertAdjacentElement('afterend', reset);
    });
    return result;
  });

  mx.wrapGlobal('resetRbacV8', function (original, args) {
    if (!mx.live) return original.apply(this, args);
    toast('Managed on the server', 'Role bundles are controlled records. Change permissions individually - every change is audited.', 'warn');
  });

  mx.interceptSubmit(
    '#addUserFormV8',
    function () {
      var name = document.getElementById('addUserNameV8').value.trim();
      var email = document.getElementById('addUserEmailV8').value.trim();
      var role = document.getElementById('addUserRoleV8').value;
      if (!name || !email) return false;
      return mx.post(V1 + '/users', { name: name, email: email, role: role }).then(function (r) {
        refreshUsers(r.data);
        closeDrawer();
        toast('Invitation sent', name + ' will set a password and join as ' + roleLabels[role] + '.');
        return false;
      });
    },
    { when: function () { return mx.live; } },
  );

  mx.interceptSubmit(
    '#newRoleFormV8',
    function () {
      var label = document.getElementById('newRoleNameV8').value.trim();
      var template = document.getElementById('newRoleTemplateV8').value;
      if (!label) return false;
      return mx.post(V1 + '/roles', { label: label, template: template }).then(function (r) {
        roleLabels[r.role.key] = r.role.label;
        rolePermissions[r.role.key] = r.role.permissions;
        ['renderRoleSwitcherV8', 'renderRbacMatrix', 'renderRbacUsersV8', 'renderSodV8'].forEach(function (f) { call(f); });
        closeDrawer();
        toast('Role created', label + ' created. Refine it in the permission matrix.');
        return false;
      });
    },
    { when: function () { return mx.live; } },
  );

  // ------------------------------------------------------------ policy & SoD

  mx.wrapGlobal('saveRbacPolicyV8', function (original, args) {
    if (!mx.live) return original.apply(this, args);
    var val = function (id, d) { var e = document.getElementById(id); return (e && e.value) || d; };
    var body = {
      orderApproval: val('policyOrderApproval', 'independent'),
      cashApproval: val('policyCashApproval', 'independent'),
      navApproval: val('policyNavApproval', 'independent'),
      bankApproval: val('policyBankApproval', 'dual'),
      sessionTimeout: Number(val('policySessionTimeout', 30)),
      mfa: !!(document.getElementById('policyMfa') || {}).checked,
    };
    return mx.put(V1 + '/policy', body).then(function (p) {
      Object.assign(accessPolicyV8, policyShape(p));
      call('renderSodV8');
      toast('Access policy saved', 'Maker-checker and session policy applied platform-wide.');
    }, mx.fail);
  });

  var sodSeq = 0;
  mx.wrapGlobal('renderSodV8', function (original, args) {
    var count = original.apply(this, args);
    if (!mx.live || !mx.can('admin.rbac')) return count;
    var seq = ++sodSeq;
    mx.get(V1 + '/sod-scan').then(function (r) {
      if (seq !== sodSeq) return;
      var host = document.getElementById('sodDynamicList');
      if (!host) return;
      host.innerHTML = r.findings
        .map(function (f) {
          var alert = f.severity !== 'ok';
          return '<div class="' + (alert ? 'sod-alert' : '') + '"><span>' + (alert ? '!' : '✓') + '</span><div><strong>' + mx.esc(f.title) + '</strong><small>' + mx.esc(f.detail) + '</small><b>' + mx.esc(f.action) + '</b></div></div>';
        })
        .join('');
      var n = r.blocking;
      var c = document.getElementById('rbacConflictCount'), s = document.getElementById('rbacConflictSub');
      if (c) c.textContent = n;
      if (s) s.textContent = n ? n + ' finding' + (n === 1 ? '' : 's') + ' require review' : 'No blocking conflicts';
    }, function () { /* keep the local findings */ });
    return count;
  });

  mx.intercept(
    '[data-action="export-access-review"]',
    function () {
      return downloadFile(V1 + '/access-review.csv', 'matanho-access-review.csv').then(function () {
        toast('Access review exported', 'Users, roles, effective permissions, MFA and last sign-in downloaded as CSV.');
      });
    },
    { when: function () { return mx.live && mx.can('admin.rbac'); } },
  );

  // ------------------------------------------------------------ settings

  mx.wrapGlobal('saveSettingsV8', function (original, args) {
    if (!mx.live) return original.apply(this, args);
    var settings = collectSettingsV8();
    return mx.put(V1 + '/settings', { settings: settings }).then(function () {
      return original.apply(null, args);
    }, mx.fail);
  });

  mx.wrapGlobal('resetSettingsV8', function (original, args) {
    var result = original.apply(this, args);
    if (mx.live) mx.put(V1 + '/settings', { settings: platformSettingsV8 }).catch(mx.fail);
    return result;
  });

  window.addEventListener('matanho:legacy-ready', function () {
    if (!mx.live) return;
    if (storedSettings && typeof platformSettingsV8 !== 'undefined') {
      Object.assign(platformSettingsV8, storedSettings);
      call('renderSettingsV8');
    }
    call('renderRoleSwitcherV8');
    if (mx.can('audit.view')) renderAudit({});
  });

  // ------------------------------------------------------------ audit trail

  var auditFilters = {};
  var auditRows = [];

  function qs(o) {
    return Object.keys(o)
      .filter(function (k) { return o[k] !== undefined && o[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); })
      .join('&');
  }

  function when(iso) {
    var d = new Date(iso);
    var t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return d.toDateString() === new Date().toDateString() ? t : mx.date(iso, { day: '2-digit', month: 'short' }) + ' ' + t;
  }

  function renderAudit(filters, append) {
    auditFilters = filters;
    var tbody = document.querySelector('#page-audit table tbody');
    if (!tbody) return Promise.resolve();
    var q = Object.assign({ limit: 100 }, filters, append && auditRows.length ? { before: auditRows[auditRows.length - 1].id } : {});
    return mx.get(V1 + '/audit-events?' + qs(q)).then(function (r) {
      auditRows = append ? auditRows.concat(r.data) : r.data;
      tbody.innerHTML =
        auditRows
          .map(function (e, i) {
            return '<tr data-mx-audit="' + i + '" style="cursor:pointer"><td>' + when(e.at) + '</td><td>' + mx.esc(e.user) + '</td><td>' + mx.esc(e.role) + '</td><td>' + mx.esc(e.actionLabel) +
              '</td><td>' + mx.esc(e.objectType + ' · ' + e.objectId) + '</td><td>' + mx.esc(e.previous) + '</td><td>' + mx.esc(e.next) + '</td><td>' + mx.esc(e.reason) + '</td></tr>';
          })
          .join('') +
        (r.nextBefore ? '<tr><td colspan="8"><button type="button" class="text-btn" data-mx-audit-more>Load older events</button></td></tr>' : '') +
        (!auditRows.length ? '<tr><td colspan="8">No audit events match these filters.</td></tr>' : '');
      var more = tbody.querySelector('[data-mx-audit-more]');
      if (more) more.onclick = function () { renderAudit(auditFilters, true).catch(mx.fail); };
    });
  }

  document.addEventListener('click', function (ev) {
    var tr = ev.target.closest && ev.target.closest('#page-audit [data-mx-audit]');
    if (!tr) return;
    var e = auditRows[+tr.getAttribute('data-mx-audit')];
    if (!e) return;
    var pre = function (v) { return '<pre style="white-space:pre-wrap;font-size:11px;max-height:260px;overflow:auto">' + mx.esc(v == null ? '—' : JSON.stringify(v, null, 2)) + '</pre>'; };
    openDrawer({
      eyebrow: 'AUDIT EVENT #' + e.id,
      title: e.actionLabel,
      subtitle: e.objectType + ' · ' + e.objectId + ' · ' + new Date(e.at).toLocaleString('en-GB'),
      body:
        '<section class="detail-section"><div class="detail-grid"><div class="detail-field"><span>User</span><strong>' + mx.esc(e.user) + '</strong></div><div class="detail-field"><span>Role</span><strong>' + mx.esc(e.role || '—') +
        '</strong></div><div class="detail-field"><span>Portal</span><strong>' + mx.esc(e.portal || '—') + '</strong></div><div class="detail-field"><span>IP / request</span><strong>' + mx.esc((e.ip || '—') + ' · ' + (e.requestId || '—')) + '</strong></div></div></section>' +
        (e.reason ? '<section class="detail-section"><h3>Reason</h3><p>' + mx.esc(e.reason) + '</p></section>' : '') +
        '<section class="detail-section"><h3>Previous state</h3>' + pre(e.before) + '</section><section class="detail-section"><h3>New state</h3>' + pre(e.after) + '</section>' +
        '<section class="detail-section"><h3>Chain hash</h3><p><code style="word-break:break-all">' + mx.esc(e.hash) + '</code></p></section>',
    });
  });

  mx.wrapGlobal('navigate', function (original, args) {
    var result = original.apply(this, args);
    if (mx.live && args[0] === 'audit' && mx.can('audit.view')) renderAudit(auditFilters).catch(mx.fail);
    return result;
  });

  mx.intercept(
    '[data-action="filter-audit"]',
    function () {
      var f = auditFilters;
      var field = function (id, label, type, v) {
        return '<label class="detail-field"><span>' + label + '</span><input id="' + id + '" type="' + type + '" value="' + mx.esc(v || '') + '"></label>';
      };
      openDrawer({
        eyebrow: 'AUDIT EVIDENCE',
        title: 'Filter audit trail',
        subtitle: 'Trace sensitive events by user, action, object and time window.',
        body:
          '<form id="mxAuditFilter"><section class="detail-section"><div class="detail-grid">' +
          field('mxAfQ', 'Search', 'text', f.q) + field('mxAfActor', 'User (name or email)', 'text', f.actor) + field('mxAfAction', 'Action starts with', 'text', f.action) +
          field('mxAfType', 'Object type', 'text', f.objectType) + field('mxAfId', 'Object id / ref', 'text', f.objectId) +
          field('mxAfFrom', 'From', 'date', f.from) + field('mxAfTo', 'To', 'date', f.to) +
          '</div></section><section class="detail-section"><h3>Chain integrity</h3><p id="mxAfChain">Not verified in this session.</p><button type="button" class="btn secondary" id="mxAfVerify">Verify hash chain</button></section>' +
          '<div class="form-actions"><button type="button" class="btn secondary" id="mxAfClear">Clear</button><button type="submit" class="btn primary">Apply filters</button></div></form>',
      });
      var v = function (id) { return document.getElementById(id).value.trim(); };
      document.getElementById('mxAuditFilter').onsubmit = function (ev) {
        ev.preventDefault();
        var to = v('mxAfTo');
        renderAudit({ q: v('mxAfQ'), actor: v('mxAfActor'), action: v('mxAfAction'), objectType: v('mxAfType'), objectId: v('mxAfId'), from: v('mxAfFrom'), to: to ? to + 'T23:59:59' : '' })
          .then(function () { closeDrawer(); toast('Filters applied', auditRows.length + ' event' + (auditRows.length === 1 ? '' : 's') + ' shown.'); }, mx.fail);
      };
      document.getElementById('mxAfClear').onclick = function () {
        renderAudit({}).then(closeDrawer, mx.fail);
      };
      document.getElementById('mxAfVerify').onclick = function () {
        var out = document.getElementById('mxAfChain');
        out.textContent = 'Verifying…';
        mx.get(V1 + '/audit-events/verify').then(function (r) {
          out.innerHTML = r.brokenAt
            ? '<strong style="color:#a9253e">Chain broken at event #' + mx.esc(r.brokenAt) + '</strong> after ' + r.checked + ' verified events.'
            : '<strong>Intact</strong> · ' + r.checked + ' events verified.';
        }, mx.fail);
      };
    },
    { when: function () { return mx.live && mx.can('audit.view'); } },
  );

  mx.intercept(
    '[data-action="export-audit"]',
    function () {
      var f = Object.assign({}, auditFilters);
      delete f.before;
      return downloadFile(V1 + '/audit-events.csv?' + qs(f), 'matanho-audit-evidence.csv').then(function () {
        toast('Audit evidence exported', 'Filtered, hash-chained audit events downloaded as CSV. The export itself is audited.');
      });
    },
    { when: function () { return mx.live && mx.can('audit.view'); } },
  );
})();
