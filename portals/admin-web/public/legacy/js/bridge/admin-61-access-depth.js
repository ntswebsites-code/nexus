/*
 * Admin-core depth: access change requests, reviews, step-up policy,
 * platform settings history/numbering/retention, audit facets and drill-down.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var V1 = '/api/v1/admin';
  var AC = '/api/v1/admin-core';

  function has(fn) {
    return typeof window[fn] === 'function';
  }
  function call(fn) {
    if (has(fn)) return window[fn].apply(null, [].slice.call(arguments, 1));
  }

  function needReason(label) {
    var reason = window.prompt(label || 'Reason for this access change (recorded in the audit trail)');
    if (!reason || reason.trim().length < 5) {
      toast('Reason required', 'Access changes need at least five characters.', 'warn');
      return null;
    }
    return reason.trim();
  }

  function postRequest(body) {
    return mx.post(AC + '/rbac/requests', body).then(function (r) {
      var req = r.data || r;
      if (req.status === 'APPLIED') toast('Change applied', (req.ref || 'Request') + ' applied under step-up.');
      else toast('Waiting for approval', (req.ref || 'Request') + ' needs an independent checker.');
      return req;
    });
  }

  // ----------------------------------------------- system_admin role preview (UAT hotfix)

  mx.wrapGlobal('renderRoleSwitcherV8', function (original, args) {
    var result = original.apply(this, args);
    var sw = document.getElementById('roleSwitcher');
    if (!mx.live || !sw || typeof rolePrimary === 'undefined' || typeof roleLabels === 'undefined') return result;
    var holdsAdmin = (mx.user && mx.user.permissions.indexOf('admin.rbac') >= 0) || (mx.data.role === 'system_admin');
    if (!holdsAdmin) return result;
    var keys = Object.keys(rolePrimary).filter(function (k) {
      return roleLabels[k];
    });
    var my = (mx.data.roles || []).slice();
    sw.innerHTML = keys
      .map(function (k) {
        var label = roleLabels[k] || k;
        var held = my.indexOf(k) >= 0 || k === mx.data.role;
        return '<option value="' + mx.esc(k) + '">' + mx.esc(held ? label : 'Preview · ' + label) + '</option>';
      })
      .join('');
    if (typeof state !== 'undefined') sw.value = state.role;
    return result;
  });

  // ----------------------------------------------- privileged RBAC via change requests

  mx.wrapGlobal('togglePermissionV8', function (original, args) {
    if (!mx.live || !mx.can('admin.rbac')) return original.apply(this, args);
    var role = args[0],
      code = args[1],
      button = args[2];
    if (role === 'system_admin') return original.apply(this, args);
    var current = (rolePermissions[role] || []).slice();
    var i = current.indexOf(code);
    if (i >= 0) current.splice(i, 1);
    else current.push(code);
    var reason = needReason('Reason for changing ' + (roleLabels[role] || role) + ' permissions');
    if (!reason) return call('renderRbacMatrix');
    return postRequest({ kind: 'ROLE_PERMISSIONS', roleKey: role, permissions: current, reason: reason }).then(function (req) {
      if (req.status === 'APPLIED' && req.proposal && req.proposal.permissions) {
        rolePermissions[role] = req.proposal.permissions;
        if (button) button.classList.toggle('on', i < 0);
        call('applyRBAC', false);
        call('renderSodV8');
      }
      call('renderRbacMatrix');
    }, mx.fail);
  });

  mx.wrapGlobal('assignUserRoleV8', function (original, args) {
    if (!mx.live || !mx.can('admin.rbac')) return original.apply(this, args);
    var u = rbacUsersV8[args[0]],
      role = args[1];
    if (!u || !roleLabels[role]) return;
    if (String(u.id || '').indexOf('invite:') === 0) {
      toast('Invitation pending', u.email + ' has not accepted yet.', 'warn');
      return call('renderRbacUsersV8');
    }
    var roles = [role].concat((u.roles || []).filter(function (k) {
      return k !== u.role && k !== role;
    }));
    var reason = needReason('Reason for changing roles for ' + u.name);
    if (!reason) return call('renderRbacUsersV8');
    return postRequest({ kind: 'USER_ROLES', userId: u.id, roles: roles, reason: reason }).then(function () {
      return mx.get(V1 + '/users').then(function (r) {
        mx.replace(rbacUsersV8, r.data);
        call('renderRbacUsersV8');
        call('renderSodV8');
      });
    }, mx.fail);
  });

  document.addEventListener(
    'submit',
    function (ev) {
      if (!mx.live || !mx.can('admin.rbac')) return;
      var form = ev.target;
      if (!form || !form.matches) return;
      if (form.matches('#addUserFormV8')) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        var name = document.getElementById('addUserNameV8').value.trim();
        var email = document.getElementById('addUserEmailV8').value.trim();
        var role = document.getElementById('addUserRoleV8').value;
        var reason = needReason('Reason for inviting ' + name);
        if (!name || !email || !reason) return;
        postRequest({ kind: 'STAFF_INVITE', name: name, email: email, role: role, reason: reason })
          .then(function () {
            return mx.get(V1 + '/users').then(function (r) {
              mx.replace(rbacUsersV8, r.data);
              call('renderRbacUsersV8');
              closeDrawer();
            });
          })
          .catch(mx.fail);
      } else if (form.matches('#newRoleFormV8')) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        var label = document.getElementById('newRoleNameV8').value.trim();
        var template = document.getElementById('newRoleTemplateV8').value;
        var reason = needReason('Reason for creating role ' + label);
        if (!label || !reason) return;
        postRequest({ kind: 'ROLE_CREATE', label: label, template: template, reason: reason })
          .then(function () {
            closeDrawer();
            toast('Role request submitted', 'A different administrator must approve before the role exists.');
          })
          .catch(mx.fail);
      }
    },
    true,
  );

  // ----------------------------------------------- RBAC depth drawers (inject actions)

  function injectRbacActions() {
    var actions = document.querySelector('#page-rbac .page-actions');
    if (!actions || actions.querySelector('[data-mx-access-requests]')) return;
    ['Change requests', 'Access reviews', 'Step-up policy'].forEach(function (label, i) {
      var keys = ['requests', 'reviews', 'stepup'];
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn secondary';
      b.setAttribute('data-mx-access-' + keys[i], '1');
      b.textContent = label;
      actions.insertBefore(b, actions.querySelector('[data-action="new-role"]'));
    });
  }

  function openRequestsDrawer() {
    mx.get(AC + '/rbac/requests?limit=50').then(function (r) {
      var rows = r.data || r || [];
      openDrawer({
        eyebrow: 'RBAC',
        title: 'Access change requests',
        subtitle: 'Privileged grants need an independent checker.',
        body:
          rows.length
            ? '<div class="table-wrap"><table><thead><tr><th>Request</th><th>Target</th><th>Status</th><th></th></tr></thead><tbody>' +
              rows
                .map(function (x, i) {
                  return (
                    '<tr><td>' +
                    esc(x.ref) +
                    '<br><small>' +
                    mx.date(x.requestedAt) +
                    '</small></td><td>' +
                    esc(x.targetLabel) +
                    '</td><td>' +
                    esc(x.status) +
                    '</td><td>' +
                    (x.status === 'PENDING'
                      ? '<button type="button" class="row-action" data-mx-req-approve="' +
                        i +
                        '">Approve</button> <button type="button" class="row-action" data-mx-req-reject="' +
                        i +
                        '">Reject</button>'
                      : '—') +
                    '</td></tr>'
                  );
                })
                .join('') +
              '</tbody></table></div>'
            : '<p>No access change requests.</p>',
      });
      rows.forEach(function (x, i) {
        var ap = document.querySelector('#drawerBody [data-mx-req-approve="' + i + '"]');
        var rj = document.querySelector('#drawerBody [data-mx-req-reject="' + i + '"]');
        if (ap)
          ap.onclick = function () {
            mx.post(AC + '/rbac/requests/' + encodeURIComponent(x.id) + '/approve', { version: x.version })
              .then(function () {
                toast('Request approved', x.ref + ' applied.');
                closeDrawer();
                call('renderRbacMatrix');
                return mx.get(V1 + '/users').then(function (u) {
                  mx.replace(rbacUsersV8, u.data);
                  call('renderRbacUsersV8');
                });
              })
              .catch(mx.fail);
          };
        if (rj)
          rj.onclick = function () {
            var note = window.prompt('Reason for rejecting ' + x.ref);
            if (!note || note.trim().length < 3) return;
            mx.post(AC + '/rbac/requests/' + encodeURIComponent(x.id) + '/reject', { note: note.trim(), version: x.version })
              .then(function () {
                toast('Request rejected', x.ref);
                closeDrawer();
              })
              .catch(mx.fail);
          };
      });
    }, mx.fail);
  }

  function esc(s) {
    return mx.esc(s == null ? '' : String(s));
  }

  function openReviewsDrawer() {
    mx.get(AC + '/rbac/reviews').then(function (r) {
      var rows = r.data || r || [];
      openDrawer({
        eyebrow: 'RBAC',
        title: 'Access review campaigns',
        subtitle: 'Recertify or revoke staff access.',
        body:
          '<div class="form-actions" style="margin-bottom:12px"><button type="button" class="btn primary" id="mxStartReview">Start review</button></div>' +
          (rows.length
            ? '<ul style="margin:0;padding-left:18px">' +
              rows
                .map(function (x) {
                  return (
                    '<li style="margin-bottom:8px"><strong>' +
                    esc(x.ref) +
                    '</strong> ' +
                    esc(x.title) +
                    ' · due ' +
                    mx.date(x.dueDate) +
                    ' · ' +
                    esc(x.status) +
                    ' · ' +
                    x.counts.pending +
                    ' pending</li>'
                  );
                })
                .join('') +
              '</ul>'
            : '<p>No access reviews yet.</p>'),
      });
      var start = document.getElementById('mxStartReview');
      if (start)
        start.onclick = function () {
          var title = window.prompt('Review title', 'Staff access recertification');
          if (!title) return;
          var due = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
          mx.post(AC + '/rbac/reviews', { title: title.trim(), dueDate: due })
            .then(function () {
              toast('Review started', title);
              closeDrawer();
            })
            .catch(mx.fail);
        };
    }, mx.fail);
  }

  function openStepUpDrawer() {
    mx.get(AC + '/rbac/step-up').then(function (r) {
      var p = r.data || r;
      openDrawer({
        eyebrow: 'RBAC · STEP-UP',
        title: 'Step-up policy',
        subtitle: p.note || 'Fresh authenticator codes for sensitive actions.',
        body:
          '<section class="detail-section"><div class="detail-grid"><div class="detail-field"><span>MFA mandatory</span><strong>' +
          (p.mfaRequired ? 'Yes' : 'No') +
          '</strong></div><div class="detail-field"><span>Step-up window</span><strong>' +
          p.windowMinutes +
          ' min</strong></div><div class="detail-field"><span>Idle timeout</span><strong>' +
          p.sessionIdleMinutes +
          ' min</strong></div><div class="detail-field"><span>Authenticator enrolment</span><strong>' +
          p.enrolment.enrolled +
          ' / ' +
          p.enrolment.staff +
          '</strong></div></div></section><section class="detail-section"><h3>Guarded actions</h3><ul style="margin:0;padding-left:18px">' +
          (p.actions || [])
            .slice(0, 12)
            .map(function (a) {
              return '<li>' + esc(a.area) + ' · ' + esc(a.action) + ' <code>' + esc(a.permission) + '</code></li>';
            })
            .join('') +
          '</ul></section>',
      });
    }, mx.fail);
  }

  document.addEventListener('click', function (ev) {
    if (!mx.live || !mx.can('admin.rbac')) return;
    if (ev.target.closest('[data-mx-access-requests]')) openRequestsDrawer();
    if (ev.target.closest('[data-mx-access-reviews]')) openReviewsDrawer();
    if (ev.target.closest('[data-mx-access-stepup]')) openStepUpDrawer();
  });

  mx.wrapGlobal('renderSodV8', function (original, args) {
    var count = original.apply(this, args);
    if (mx.live && mx.can('admin.rbac')) {
      mx.get(AC + '/rbac/sod')
        .then(function (r) {
          var rep = r.data || r;
          var host = document.getElementById('sodDynamicList');
          if (!host || !rep.userConflicts) return;
          var extra = rep.userConflicts
            .slice(0, 3)
            .map(function (u) {
              return '<div class="sod-alert"><span>!</span><div><strong>' + esc(u.name) + '</strong><small>' + u.hits.length + ' SoD conflict(s) in effective permissions</small></div></div>';
            })
            .join('');
          if (extra) host.insertAdjacentHTML('beforeend', extra);
        })
        .catch(function () {});
    }
    return count;
  });

  // ----------------------------------------------- settings: history, numbering, retention

  function injectSettingsActions() {
    var actions = document.querySelector('#page-settings .page-actions');
    if (!actions || actions.querySelector('[data-mx-settings-numbering]')) return;
    ['Numbering', 'Retention'].forEach(function (label, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn secondary';
      b.setAttribute(i === 0 ? 'data-mx-settings-numbering' : 'data-mx-settings-retention', '1');
      b.textContent = label;
      actions.insertBefore(b, actions.querySelector('[data-action="save-platform-settings"]'));
    });
  }

  function loadSettingsHistory() {
    if (!mx.live || !mx.can('admin.settings')) return;
    mx.get(AC + '/settings/history?limit=8').then(function (r) {
      var rows = r.data || r || [];
      var host = document.getElementById('settingsAuditList');
      if (!host) return;
      host.innerHTML = rows.length
        ? rows
            .map(function (c) {
              return '<div><strong>' + esc(c.label || c.key) + '</strong><small>' + mx.date(c.changedAt) + ' · ' + esc(c.changedBy) + ' · ' + esc(c.reason) + '</small></div>';
            })
            .join('')
        : '<div><strong>No platform changes recorded</strong><small>Admin-core setting history is empty.</small></div>';
    }, function () {});
  }

  function openNumberingDrawer() {
    mx.get(AC + '/settings/numbering').then(function (r) {
      var rows = r.data || r || [];
      openDrawer({
        eyebrow: 'SETTINGS',
        title: 'Reference numbering',
        subtitle: 'Counters advance atomically; padding changes apply to new references only.',
        body:
          '<div class="table-wrap"><table><thead><tr><th>Series</th><th>Format</th><th>Next</th><th></th></tr></thead><tbody>' +
          rows
            .map(function (n, i) {
              return (
                '<tr><td>' +
                esc(n.kind) +
                '</td><td><code>' +
                esc(n.prefix + '#'.repeat(n.pad)) +
                '</code></td><td>' +
                esc(n.next) +
                '</td><td><button type="button" class="row-action" data-mx-num-pad="' +
                i +
                '">Padding</button></td></tr>'
              );
            })
            .join('') +
          '</tbody></table></div>',
      });
      rows.forEach(function (n, i) {
        var b = document.querySelector('#drawerBody [data-mx-num-pad="' + i + '"]');
        if (!b) return;
        b.onclick = function () {
          var pad = window.prompt('New zero padding for ' + n.kind + ' (current ' + n.pad + ')', String(n.pad));
          var reason = window.prompt('Reason for numbering change');
          if (!pad || !reason || reason.trim().length < 3) return;
          mx.put(AC + '/settings/numbering/' + encodeURIComponent(n.kind), { pad: Number(pad), reason: reason.trim() })
            .then(function () {
              toast('Numbering updated', n.kind + ' padding saved.');
              closeDrawer();
            })
            .catch(mx.fail);
        };
      });
    }, mx.fail);
  }

  function openRetentionDrawer() {
    mx.get(AC + '/retention/runs').then(function (r) {
      var body = r.data || r;
      var runs = body.data || body || [];
      openDrawer({
        eyebrow: 'SETTINGS · RETENTION',
        title: 'Retention purge runs',
        subtitle: 'Dry-run counts eligible rows; live purge needs step-up.',
        body:
          '<div class="form-actions" style="margin-bottom:12px"><button type="button" class="btn secondary" id="mxRetDry">Dry run</button><button type="button" class="btn primary" id="mxRetLive">Live purge</button></div>' +
          (runs.length
            ? '<ul style="margin:0;padding-left:18px">' +
              runs
                .slice(0, 8)
                .map(function (x) {
                  return '<li>' + mx.date(x.startedAt) + ' · ' + (x.dryRun ? 'dry run' : 'purged') + '</li>';
                })
                .join('') +
              '</ul>'
            : '<p>No purge runs yet.</p>'),
      });
      document.getElementById('mxRetDry').onclick = function () {
        mx.post(AC + '/retention/run', { dryRun: true })
          .then(function (res) {
            toast('Dry run complete', JSON.stringify((res.data || res).counts || res.data || res).slice(0, 120));
          })
          .catch(mx.fail);
      };
      document.getElementById('mxRetLive').onclick = function () {
        if (!confirm('Run a live retention purge now? This cannot be undone.')) return;
        mx.post(AC + '/retention/run', { dryRun: false })
          .then(function () {
            toast('Retention purge', 'Live purge recorded in the audit trail.');
            closeDrawer();
          })
          .catch(mx.fail);
      };
    }, mx.fail);
  }

  document.addEventListener('click', function (ev) {
    if (!mx.live || !mx.can('admin.settings')) return;
    if (ev.target.closest('[data-mx-settings-numbering]')) openNumberingDrawer();
    if (ev.target.closest('[data-mx-settings-retention]')) openRetentionDrawer();
  });

  // ----------------------------------------------- audit facets + admin-core event detail

  var auditFacets = null;

  function loadAuditFacets() {
    if (!mx.can('audit.view')) return Promise.resolve();
    return mx.get(AC + '/audit/facets').then(function (r) {
      auditFacets = r.data || r;
    }, function () {});
  }

  mx.wrapGlobal('navigate', function (original, args) {
    var result = original.apply(this, args);
    if (mx.live) {
      if (args[0] === 'rbac' && mx.can('admin.rbac')) setTimeout(injectRbacActions, 60);
      if (args[0] === 'settings' && mx.can('admin.settings')) {
        setTimeout(injectSettingsActions, 60);
        loadSettingsHistory();
      }
      if (args[0] === 'audit' && mx.can('audit.view')) loadAuditFacets();
    }
    return result;
  });

  document.addEventListener('click', function (ev) {
    var tr = ev.target.closest && ev.target.closest('#page-audit [data-mx-audit]');
    if (!tr || !mx.live || !mx.can('audit.view')) return;
    var eventId = tr.getAttribute('data-mx-audit-id');
    if (!eventId) return;
    ev.stopPropagation();
    ev.preventDefault();
    mx.get(AC + '/audit/events/' + encodeURIComponent(eventId)).then(function (r) {
      var e = r.data || r;
      var pre = function (v) {
        return '<pre style="white-space:pre-wrap;font-size:11px;max-height:200px;overflow:auto">' + esc(v == null ? '—' : JSON.stringify(v, null, 2)) + '</pre>';
      };
      openDrawer({
        eyebrow: 'AUDIT EVENT #' + e.id,
        title: e.action,
        subtitle: e.objectType + ' · ' + e.objectId,
        body:
          '<section class="detail-section"><div class="detail-grid"><div class="detail-field"><span>User</span><strong>' +
          esc(e.actor) +
          '</strong></div><div class="detail-field"><span>Chain</span><strong>' +
          (e.linkedToPrevious ? 'Links to previous' : 'Head') +
          (e.linkedToNext === false ? ' · break after' : '') +
          '</strong></div><div class="detail-field"><span>Object events</span><strong>' +
          e.eventsOnObject +
          '</strong></div></div></section>' +
          pre(e.before) +
          pre(e.after) +
          '<p><code style="word-break:break-all">' +
          esc(e.hash) +
          '</code></p>',
      });
    }, mx.fail);
  }, true);

  document.addEventListener('click', function (ev) {
    if (!ev.target.closest('[data-action="filter-audit"]') || !mx.live || !mx.can('audit.view')) return;
    ev.stopPropagation();
    ev.preventDefault();
    loadAuditFacets().then(function () {
        var f = window.__mxAuditFilters || {};
        var opts = function (id, label, items, v) {
          return (
            '<label class="detail-field"><span>' +
            label +
            '</span><select id="' +
            id +
            '"><option value="">All</option>' +
            (items || [])
              .map(function (a) {
                return '<option value="' + esc(a.value) + '"' + (v === a.value ? ' selected' : '') + '>' + esc(a.value) + ' (' + a.count + ')</option>';
              })
              .join('') +
            '</select></label>'
          );
        };
        var stats = auditFacets && auditFacets.stats;
        openDrawer({
          eyebrow: 'AUDIT EVIDENCE',
          title: 'Filter audit trail',
          subtitle: stats ? stats.total + ' events · ' + stats.last24h + ' in last 24h' : 'Trace sensitive events.',
          body:
            '<form id="mxAuditFilter"><section class="detail-section"><div class="detail-grid">' +
            '<label class="detail-field"><span>Search</span><input id="mxAfQ" value="' +
            esc(f.q || '') +
            '"></label>' +
            '<label class="detail-field"><span>User</span><input id="mxAfActor" value="' +
            esc(f.actor || '') +
            '"></label>' +
            (auditFacets ? opts('mxAfAction', 'Action', auditFacets.actions, f.action) : '') +
            (auditFacets ? opts('mxAfType', 'Object type', auditFacets.objectTypes, f.objectType) : '') +
            (auditFacets ? opts('mxAfPortal', 'Portal', auditFacets.portals, f.portal) : '') +
            '<label class="detail-field"><span>Object id</span><input id="mxAfId" value="' +
            esc(f.objectId || '') +
            '"></label>' +
            '<label class="detail-field"><span>From</span><input id="mxAfFrom" type="date" value="' +
            esc(f.from || '') +
            '"></label>' +
            '<label class="detail-field"><span>To</span><input id="mxAfTo" type="date" value="' +
            esc(f.to || '') +
            '"></label>' +
            '</div></section><section class="detail-section"><h3>Chain integrity</h3><p id="mxAfChain">Not verified in this session.</p><button type="button" class="btn secondary" id="mxAfVerify">Verify hash chain</button></section>' +
            '<div class="form-actions"><button type="button" class="btn secondary" id="mxAfClear">Clear</button><button type="submit" class="btn primary">Apply filters</button></div></form>',
        });
        var v = function (id) {
          var el = document.getElementById(id);
          return el ? el.value.trim() : '';
        };
        document.getElementById('mxAuditFilter').onsubmit = function (e) {
          e.preventDefault();
          var to = v('mxAfTo');
          window.__mxAuditFilters = {
            q: v('mxAfQ'),
            actor: v('mxAfActor'),
            action: v('mxAfAction'),
            objectType: v('mxAfType'),
            objectId: v('mxAfId'),
            portal: v('mxAfPortal'),
            from: v('mxAfFrom'),
            to: to ? to + 'T23:59:59' : '',
          };
          if (typeof renderAudit === 'function') renderAudit(window.__mxAuditFilters).then(closeDrawer, mx.fail);
          else closeDrawer();
        };
        document.getElementById('mxAfClear').onclick = function () {
          window.__mxAuditFilters = {};
          if (typeof renderAudit === 'function') renderAudit({}).then(closeDrawer, mx.fail);
        };
        document.getElementById('mxAfVerify').onclick = function () {
          var out = document.getElementById('mxAfChain');
          out.textContent = 'Verifying…';
          mx.get(V1 + '/audit-events/verify').then(function (res) {
            out.innerHTML = res.brokenAt
              ? '<strong style="color:#a9253e">Chain broken at #' + esc(res.brokenAt) + '</strong>'
              : '<strong>Intact</strong> · ' + res.checked + ' events verified.';
          }, mx.fail);
        };
      });
    }).catch(mx.fail);
  }, true);

  window.addEventListener('matanho:legacy-ready', function () {
    if (!mx.live) return;
    injectRbacActions();
    injectSettingsActions();
    loadSettingsHistory();
    loadAuditFacets();
  });
})();
