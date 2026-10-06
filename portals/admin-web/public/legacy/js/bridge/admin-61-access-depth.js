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

  function reasonDrawer(title, minLen) {
    minLen = minLen || 5;
    return new Promise(function (resolve) {
      openDrawer({
        eyebrow: 'REASON REQUIRED',
        title: title || 'Reason for this change',
        subtitle: 'Recorded in the audit trail.',
        body:
          '<form id="mxReasonForm"><label class="detail-field"><span>Reason</span><textarea id="mxReasonText" required rows="3" style="width:100%"></textarea></label><div class="form-actions"><button type="button" class="btn secondary" id="mxReasonCancel">Cancel</button><button type="submit" class="btn primary">Continue</button></div></form>',
      });
      document.getElementById('mxReasonCancel').onclick = function () {
        closeDrawer();
        resolve(null);
      };
      document.getElementById('mxReasonForm').onsubmit = function (e) {
        e.preventDefault();
        var t = document.getElementById('mxReasonText').value.trim();
        if (t.length < minLen) {
          toast('Reason required', 'Need at least ' + minLen + ' characters.', 'warn');
          return;
        }
        closeDrawer();
        resolve(t);
      };
    });
  }

  function showSettingValue(s) {
    if (s.type === 'boolean') return s.value ? 'On' : 'Off';
    return String(s.value);
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
    if (!mx.live || !mx.can('admin.rbac')) {
      if (mx.live && mx.strict('rbac')) {
        mx.toast('Proposal required', 'Use Propose role change to submit permission updates when signed in live.', 'warn');
        return call('renderRbacMatrix');
      }
      return original.apply(this, args);
    }
    var role = args[0],
      code = args[1],
      button = args[2];
    if (role === 'system_admin') return original.apply(this, args);
    var current = (rolePermissions[role] || []).slice();
    var i = current.indexOf(code);
    if (i >= 0) current.splice(i, 1);
    else current.push(code);
    return reasonDrawer('Reason for changing ' + (roleLabels[role] || role) + ' permissions').then(function (reason) {
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
  });

  mx.wrapGlobal('assignUserRoleV8', function (original, args) {
    if (!mx.live || !mx.can('admin.rbac')) {
      if (mx.live && mx.strict('rbac')) {
        mx.toast('Proposal required', 'Staff role changes go through Propose role change when signed in live.', 'warn');
        return call('renderRbacUsersV8');
      }
      return original.apply(this, args);
    }
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
    return reasonDrawer('Reason for changing roles for ' + u.name).then(function (reason) {
      if (!reason) return call('renderRbacUsersV8');
      return postRequest({ kind: 'USER_ROLES', userId: u.id, roles: roles, reason: reason }).then(function () {
        return mx.get(V1 + '/users').then(function (r) {
          mx.replace(rbacUsersV8, r.data);
          call('renderRbacUsersV8');
          call('renderSodV8');
        });
      }, mx.fail);
    });
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
        if (!name || !email) return;
        reasonDrawer('Reason for inviting ' + name).then(function (reason) {
          if (!reason) return;
          postRequest({ kind: 'STAFF_INVITE', name: name, email: email, role: role, reason: reason })
            .then(function () {
              return mx.get(V1 + '/users').then(function (r) {
                mx.replace(rbacUsersV8, r.data);
                call('renderRbacUsersV8');
                closeDrawer();
              });
            })
            .catch(mx.fail);
        });
      } else if (form.matches('#newRoleFormV8')) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        var label = document.getElementById('newRoleNameV8').value.trim();
        var template = document.getElementById('newRoleTemplateV8').value;
        if (!label) return;
        reasonDrawer('Reason for creating role ' + label).then(function (reason) {
          if (!reason) return;
          postRequest({ kind: 'ROLE_CREATE', label: label, template: template, reason: reason })
            .then(function () {
              closeDrawer();
              toast('Role request submitted', 'A different administrator must approve before the role exists.');
            })
            .catch(mx.fail);
        });
      }
    },
    true,
  );

  // ----------------------------------------------- RBAC depth drawers (inject actions)

  function injectRbacActions() {
    var actions = document.querySelector('#page-rbac .page-actions');
    if (!actions || actions.querySelector('[data-mx-access-requests]')) return;
    var propose = document.createElement('button');
    propose.type = 'button';
    propose.className = 'btn secondary';
    propose.setAttribute('data-mx-access-propose', '1');
    propose.textContent = 'Propose role change';
    actions.insertBefore(propose, actions.querySelector('[data-action="new-role"]'));
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
            reasonDrawer('Reason for rejecting ' + x.ref, 3).then(function (note) {
              if (!note) return;
              mx.post(AC + '/rbac/requests/' + encodeURIComponent(x.id) + '/reject', { note: note, version: x.version })
                .then(function () {
                  toast('Request rejected', x.ref);
                  closeDrawer();
                })
                .catch(mx.fail);
            });
          };
      });
    }, mx.fail);
  }

  function esc(s) {
    return mx.esc(s == null ? '' : String(s));
  }

  function openReviewDetail(reviewId) {
    mx.get(AC + '/rbac/reviews/' + encodeURIComponent(reviewId)).then(function (r) {
      var review = r.data || r;
      var items = review.items || [];
      openDrawer({
        eyebrow: 'ACCESS REVIEW · ' + esc(review.ref),
        title: review.title,
        subtitle:
          'Due ' +
          mx.date(review.dueDate) +
          ' · ' +
          review.counts.pending +
          ' pending · ' +
          review.counts.certified +
          ' certified · ' +
          review.counts.revoke +
          ' revoke',
        body:
          (review.status === 'OPEN' && review.counts.pending === 0
            ? '<div class="form-actions" style="margin-bottom:12px"><button type="button" class="btn primary" id="mxReviewComplete">Complete review</button></div>'
            : '') +
          '<div class="table-wrap"><table><thead><tr><th>User</th><th>Roles</th><th>MFA</th><th>Decision</th><th></th></tr></thead><tbody>' +
          items
            .map(function (item, i) {
              var roles = (item.roles || []).map(function (x) {
                return x.label || x.key;
              }).join(', ');
              return (
                '<tr><td>' +
                esc(item.userName) +
                '<br><small>' +
                esc(item.email) +
                '</small></td><td>' +
                esc(roles) +
                '</td><td>' +
                (item.mfaEnrolled ? 'Enrolled' : 'None') +
                '</td><td>' +
                esc(item.decision) +
                (item.note ? '<br><small>' + esc(item.note) + '</small>' : '') +
                '</td><td>' +
                (review.status === 'OPEN' && item.decision === 'PENDING'
                  ? '<button type="button" class="row-action" data-mx-review-cert="' +
                    i +
                    '">Certify</button> <button type="button" class="row-action" data-mx-review-revoke="' +
                    i +
                    '">Revoke</button>'
                  : '—') +
                '</td></tr>'
              );
            })
            .join('') +
          '</tbody></table></div><div class="form-actions" style="margin-top:12px"><button type="button" class="btn secondary" id="mxReviewBack">Back to list</button></div>',
      });
      var complete = document.getElementById('mxReviewComplete');
      if (complete)
        complete.onclick = function () {
          if (!confirm('Complete this review? Revoked users get a disable request for an independent approver.')) return;
          mx.post(AC + '/rbac/reviews/' + encodeURIComponent(review.id) + '/complete', {})
            .then(function () {
              toast('Review completed', review.ref);
              openReviewDetail(review.id);
            })
            .catch(mx.fail);
        };
      document.getElementById('mxReviewBack').onclick = openReviewsDrawer;
      items.forEach(function (item, i) {
        var cert = document.querySelector('#drawerBody [data-mx-review-cert="' + i + '"]');
        var rev = document.querySelector('#drawerBody [data-mx-review-revoke="' + i + '"]');
        if (cert)
          cert.onclick = function () {
            mx.post(AC + '/rbac/reviews/' + encodeURIComponent(review.id) + '/items/' + encodeURIComponent(item.id) + '/decide', { decision: 'CERTIFIED' })
              .then(function () {
                toast('Access certified', item.userName);
                openReviewDetail(review.id);
              })
              .catch(mx.fail);
          };
        if (rev)
          rev.onclick = function () {
            reasonDrawer('Why should access be revoked for ' + item.userName + '?', 3).then(function (note) {
              if (!note) return;
              mx.post(AC + '/rbac/reviews/' + encodeURIComponent(review.id) + '/items/' + encodeURIComponent(item.id) + '/decide', { decision: 'REVOKE', note: note })
                .then(function () {
                  toast('Marked for revocation', item.userName);
                  openReviewDetail(review.id);
                })
                .catch(mx.fail);
            });
          };
      });
    }, mx.fail);
  }

  function openReviewsDrawer() {
    mx.get(AC + '/rbac/reviews').then(function (r) {
      var rows = r.data || r || [];
      var dueDefault = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      openDrawer({
        eyebrow: 'RBAC',
        title: 'Access review campaigns',
        subtitle: 'Recertify or revoke staff access. Reviewers cannot certify their own access.',
        body:
          '<form id="mxStartReviewForm" class="form-actions" style="margin-bottom:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end">' +
          '<label class="detail-field"><span>Title</span><input id="mxReviewTitle" value="Staff access recertification"></label>' +
          '<label class="detail-field"><span>Due date</span><input id="mxReviewDue" type="date" value="' +
          esc(dueDefault) +
          '"></label>' +
          '<button type="submit" class="btn primary">Start review</button></form>' +
          (rows.length
            ? '<div class="table-wrap"><table><thead><tr><th>Review</th><th>Due</th><th>Status</th><th class="r">Pending</th></tr></thead><tbody>' +
              rows
                .map(function (x, i) {
                  return (
                    '<tr><td><button type="button" class="row-action" data-mx-review-open="' +
                    i +
                    '">' +
                    esc(x.ref) +
                    '</button> ' +
                    esc(x.title) +
                    '</td><td>' +
                    mx.date(x.dueDate) +
                    '</td><td>' +
                    esc(x.status) +
                    '</td><td class="r">' +
                    x.counts.pending +
                    '</td></tr>'
                  );
                })
                .join('') +
              '</tbody></table></div>'
            : '<p>No access reviews yet.</p>'),
      });
      document.getElementById('mxStartReviewForm').onsubmit = function (e) {
        e.preventDefault();
        var title = document.getElementById('mxReviewTitle').value.trim();
        var due = document.getElementById('mxReviewDue').value;
        if (!title || !due) return;
        mx.post(AC + '/rbac/reviews', { title: title, dueDate: due })
          .then(function (res) {
            toast('Review started', title);
            var created = (res.data || res).id;
            if (created) openReviewDetail(created);
            else openReviewsDrawer();
          })
          .catch(mx.fail);
      };
      rows.forEach(function (x, i) {
        var btn = document.querySelector('#drawerBody [data-mx-review-open="' + i + '"]');
        if (btn) btn.onclick = function () {
          openReviewDetail(x.id);
        };
      });
    }, mx.fail);
  }

  function openProposeRoleDrawer() {
    mx.get(AC + '/rbac/matrix').then(function (r) {
      var matrix = r.data || r;
      var roles = (matrix.roles || []).filter(function (role) {
        return role.key !== 'system_admin' && !role.locked;
      });
      openDrawer({
        eyebrow: 'RBAC · ACCESS CHANGE',
        title: 'Propose role permission change',
        subtitle: matrix.privilegedRule || 'Privileged grants need an independent checker.',
        body:
          '<form id="mxProposeRoleForm"><label class="detail-field"><span>Role</span><select id="mxProposeRoleKey" required>' +
          roles
            .map(function (role) {
              return '<option value="' + esc(role.key) + '">' + esc(role.label) + '</option>';
            })
            .join('') +
          '</select></label><div id="mxProposePermHost" style="max-height:280px;overflow:auto;margin:12px 0"></div><label class="detail-field"><span>Reason</span><textarea id="mxProposeReason" required rows="3" style="width:100%"></textarea></label><div class="form-actions"><button type="submit" class="btn primary">Submit change</button></div></form>',
      });
      function currentPermsForRole(roleKey) {
        var perms = [];
        (matrix.areas || []).forEach(function (area) {
          area.permissions.forEach(function (p) {
            if (p.roles.indexOf(roleKey) >= 0) perms.push(p.code);
          });
        });
        return perms;
      }
      function renderPermEditor(roleKey) {
        var roleRow = null;
        for (var ri = 0; ri < roles.length; ri++) {
          if (roles[ri].key === roleKey) {
            roleRow = roles[ri];
            break;
          }
        }
        var current = new Set(currentPermsForRole(roleKey));
        var host = document.getElementById('mxProposePermHost');
        if (!host) return;
        host.innerHTML = (matrix.areas || [])
          .map(function (area) {
            return (
              '<section class="detail-section"><h3>' +
              esc(area.area) +
              '</h3><div style="display:flex;flex-wrap:wrap;gap:6px 14px">' +
              area.permissions
                .map(function (p) {
                  return (
                    '<label style="font-size:12px"><input type="checkbox" data-mx-propose-perm="' +
                    esc(p.code) +
                    '"' +
                    (current.has(p.code) ? ' checked' : '') +
                    '> ' +
                    esc(p.code) +
                    (p.privileged ? ' <span style="color:#a9253e">●</span>' : '') +
                    '</label>'
                  );
                })
                .join('') +
              '</div></section>'
            );
          })
          .join('');
        host.setAttribute('data-mx-role-key', roleKey);
        host.setAttribute('data-mx-role-label', roleRow ? roleRow.label : roleKey);
      }
      var sel = document.getElementById('mxProposeRoleKey');
      renderPermEditor(sel.value);
      sel.onchange = function () {
        renderPermEditor(sel.value);
      };
      document.getElementById('mxProposeRoleForm').onsubmit = function (e) {
        e.preventDefault();
        var roleKey = sel.value;
        var reason = document.getElementById('mxProposeReason').value.trim();
        if (reason.length < 5) {
          toast('Reason required', 'Need at least five characters.', 'warn');
          return;
        }
        var perms = [];
        document.querySelectorAll('#mxProposePermHost [data-mx-propose-perm]').forEach(function (cb) {
          if (cb.checked) perms.push(cb.getAttribute('data-mx-propose-perm'));
        });
        postRequest({ kind: 'ROLE_PERMISSIONS', roleKey: roleKey, permissions: perms, reason: reason })
          .then(function (req) {
            if (req.status === 'APPLIED' && req.proposal && req.proposal.permissions) {
              rolePermissions[roleKey] = req.proposal.permissions;
              call('applyRBAC', false);
              call('renderSodV8');
            }
            call('renderRbacMatrix');
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

  function liveRbac() {
    return mx.live && mx.strict('rbac');
  }

  function clearRbacChrome() {
    var top = document.querySelector('#page-rbac .rbac-top');
    if (top) {
      top.querySelectorAll('article strong').forEach(function (el) {
        el.textContent = '—';
        el.className = '';
      });
      top.querySelectorAll('article small').forEach(function (el) {
        el.textContent = 'Loading…';
      });
    }
  }

  function patchRbacTopCounts() {
    if (!liveRbac()) return;
    var users = mx.data.rbacUsers || (typeof rbacUsersV8 !== 'undefined' ? rbacUsersV8 : []);
    var userCount = document.getElementById('rbacUserCount');
    var roleCount = document.getElementById('rbacRoleCount');
    if (userCount) userCount.textContent = String(users.length || '—');
    if (roleCount) roleCount.textContent = String(typeof rolesV8 !== 'undefined' && rolesV8 ? rolesV8.length : '—');
  }

  function toggleRbacDemoPanels(live) {
    document.querySelectorAll('#page-rbac .mx-demo-only').forEach(function (el) {
      el.style.display = live ? 'none' : '';
    });
  }

  function switchRbacTab(tab) {
    var matrix = document.querySelector('#page-rbac .rbac-matrix-card-v8');
    var lower = document.querySelector('#page-rbac .rbac-lower-grid-v8');
    var userCard = lower && lower.querySelector('.card:not(.rbac-sod-card-v8)');
    var sodCard = document.querySelector('#page-rbac .rbac-sod-card-v8');
    if (matrix) matrix.style.display = tab === 'matrix' ? '' : 'none';
    if (lower) lower.style.display = tab === 'matrix' ? 'none' : '';
    if (userCard) userCard.style.display = tab === 'staff' ? '' : 'none';
    if (sodCard) sodCard.style.display = tab === 'governance' ? '' : 'none';
    document.querySelectorAll('#mxRbacTabs [data-mx-rbac-tab]').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-mx-rbac-tab') === tab);
    });
  }

  function injectRbacTabs() {
    if (!liveRbac() || document.getElementById('mxRbacTabs')) return;
    var top = document.querySelector('#page-rbac .rbac-top');
    if (!top) return;
    var nav = document.createElement('div');
    nav.id = 'mxRbacTabs';
    nav.className = 'rbac-tabs-v8';
    nav.style.cssText = 'display:flex;gap:8px;margin:12px 0 16px;flex-wrap:wrap';
    ['matrix', 'staff', 'governance'].forEach(function (tab, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn secondary' + (i === 0 ? ' active' : '');
      b.setAttribute('data-mx-rbac-tab', tab);
      b.textContent = tab === 'matrix' ? 'Permission matrix' : tab === 'staff' ? 'Staff & roles' : 'SoD & governance';
      b.onclick = function () {
        switchRbacTab(tab);
      };
      nav.appendChild(b);
    });
    top.insertAdjacentElement('afterend', nav);
    switchRbacTab('matrix');
  }

  mx.wrapGlobal('renderRbacUsersV8', function (original, args) {
    var result = original.apply(this, args);
    if (!liveRbac() || !mx.can('admin.rbac') || typeof rbacUsersV8 === 'undefined') return result;
    mx.$$('#rbacUserRows tr').forEach(function (tr, i) {
      var u = rbacUsersV8[i];
      if (!u || !u.id || String(u.id).indexOf('invite:') >= 0 || u.access !== 'Active' || u.role === 'system_admin') return;
      if (tr.querySelector('[data-mx-disable-user]')) return;
      var cell = tr.querySelector('td:last-child');
      if (!cell) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'row-action';
      btn.setAttribute('data-mx-disable-user', u.id);
      btn.textContent = 'Disable';
      cell.appendChild(btn);
      btn.onclick = function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        reasonDrawer('Reason for disabling ' + u.name, 5).then(function (reason) {
          if (!reason) return;
          return postRequest({ kind: 'USER_DISABLE', userId: u.id, reason: reason }).then(function () {
            return mx.get(V1 + '/users').then(function (r) {
              mx.replace(rbacUsersV8, r.data);
              call('renderRbacUsersV8');
            });
          }, mx.fail);
        });
      };
    });
    return result;
  });

  function liveSettings() {
    return mx.live && mx.strict('settings');
  }

  function toggleSettingsDemoPanels(live) {
    document.querySelectorAll('#page-settings .mx-demo-only').forEach(function (el) {
      el.style.display = live ? 'none' : '';
    });
  }

  function clearSettingsChrome() {
    document.querySelectorAll('#page-settings .settings-status-v8 strong').forEach(function (el) {
      el.textContent = '—';
    });
  }

  mx.hydrate('settings', function () {
    if (!liveSettings()) return Promise.resolve();
    clearSettingsChrome();
    toggleSettingsDemoPanels(true);
    injectSettingsActions();
    return loadSettingsHistory();
  });

  mx.hydrate('rbac', function () {
    if (!liveRbac()) return Promise.resolve();
    clearRbacChrome();
    toggleRbacDemoPanels(true);
    injectRbacTabs();
    patchRbacTopCounts();
    return Promise.resolve();
  });

  document.addEventListener('click', function (ev) {
    if (!mx.live || !mx.can('admin.rbac')) return;
    if (ev.target.closest('[data-mx-access-propose]')) openProposeRoleDrawer();
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

  var integrationBanner = null;

  function injectSettingsActions() {
    var actions = document.querySelector('#page-settings .page-actions');
    if (!actions || actions.querySelector('[data-mx-settings-numbering]')) return;
    ['Platform settings', 'Numbering', 'Retention', 'Platform health'].forEach(function (label, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn secondary';
      b.setAttribute(['data-mx-settings-platform', 'data-mx-settings-numbering', 'data-mx-settings-retention', 'data-mx-settings-health'][i], '1');
      b.textContent = label;
      actions.insertBefore(b, actions.querySelector('[data-action="save-platform-settings"]'));
    });
  }

  function loadIntegrationsBanner() {
    if (!mx.can('admin.settings')) return Promise.resolve();
    return mx.get(AC + '/integrations/banner').then(function (r) {
      integrationBanner = r.data || r;
      patchSettingsIntegrationsBanner();
    }, function () {
      integrationBanner = null;
    });
  }

  function patchSettingsIntegrationsBanner() {
    var host = document.querySelector('#page-settings .page-head');
    if (!host || !mx.live || !mx.can('admin.settings')) return;
    var existing = document.getElementById('mxSettingsIntegrationsBanner');
    if (existing) existing.remove();
    if (!integrationBanner || !integrationBanner.production || !integrationBanner.count) return;
    var fake = (integrationBanner.fakeAdapters || []).join(', ');
    var el = document.createElement('div');
    el.id = 'mxSettingsIntegrationsBanner';
    el.className = 'sod-alert';
    el.style.marginTop = '12px';
    el.innerHTML =
      '<span>!</span><div><strong>Simulated integrations active</strong><small>' +
      esc(fake) +
      ' — adapter mode is simulated in this environment. Admin-core settings below still govern email, retention and feature flags.</small></div>';
    host.appendChild(el);
  }

  function openSettingChangeDrawer(setting) {
    var valueField;
    if (setting.type === 'boolean') {
      valueField =
        '<select id="mxSetValue" class="detail-field" style="width:100%"><option value="true"' +
        (setting.value ? ' selected' : '') +
        '>On</option><option value="false"' +
        (setting.value ? '' : ' selected') +
        '>Off</option></select>';
    } else if (setting.type === 'enum') {
      valueField =
        '<select id="mxSetValue" style="width:100%">' +
        (setting.options || [])
          .map(function (o) {
            return '<option value="' + esc(o) + '"' + (setting.value === o ? ' selected' : '') + '>' + esc(o.replace(/_/g, ' ')) + '</option>';
          })
          .join('') +
        '</select>';
    } else {
      valueField =
        '<input id="mxSetValue" type="number" step="1" min="' +
        (setting.min != null ? setting.min : '') +
        '" max="' +
        (setting.max != null ? setting.max : '') +
        '" value="' +
        esc(String(setting.value)) +
        '" style="width:100%">';
    }
    openDrawer({
      eyebrow: setting.category.toUpperCase(),
      title: setting.label,
      subtitle: setting.help + (setting.stepUp ? ' · needs step-up when enrolled.' : ''),
      body:
        '<form id="mxSetChangeForm"><label class="detail-field"><span>Value</span>' +
        valueField +
        '</label><label class="detail-field"><span>Reason</span><textarea id="mxSetReason" required rows="3" style="width:100%"></textarea></label><div class="form-actions"><button type="submit" class="btn primary">Save change</button></div></form>',
    });
    document.getElementById('mxSetChangeForm').onsubmit = function (e) {
      e.preventDefault();
      var raw = document.getElementById('mxSetValue').value;
      var value = setting.type === 'boolean' ? raw === 'true' : setting.type === 'int' ? Number(raw) : raw;
      var reason = document.getElementById('mxSetReason').value.trim();
      if (reason.length < 3) {
        toast('Reason required', 'Need at least three characters.', 'warn');
        return;
      }
      mx.put(AC + '/settings/' + encodeURIComponent(setting.key), { value: value, reason: reason, version: setting.version })
        .then(function () {
          toast('Setting updated', setting.label);
          closeDrawer();
          loadSettingsHistory();
        })
        .catch(mx.fail);
    };
  }

  function openPlatformSettingsDrawer() {
    mx.get(AC + '/settings').then(function (r) {
      var rows = r.data || r || [];
      var cats = ['Feature flags', 'Security', 'Retention', 'Notifications'];
      openDrawer({
        eyebrow: 'SETTINGS · ADMIN CORE',
        title: 'Platform settings',
        subtitle: 'Feature flags, security, retention and notifications. Every change needs a reason.',
        body: cats
          .map(function (cat) {
            var list = rows.filter(function (s) {
              return s.category === cat;
            });
            if (!list.length) return '';
            return (
              '<section class="detail-section"><h3>' +
              esc(cat) +
              '</h3><div class="table-wrap"><table><thead><tr><th>Setting</th><th>Value</th><th></th></tr></thead><tbody>' +
              list
                .map(function (s, i) {
                  return (
                    '<tr><td><strong>' +
                    esc(s.label) +
                    '</strong><br><small>' +
                    esc(s.help) +
                    (s.stepUp ? ' · step-up' : '') +
                    (!s.enforced ? ' · recorded' : '') +
                    '</small></td><td>' +
                    esc(showSettingValue(s)) +
                    '</td><td><button type="button" class="row-action" data-mx-set-change="' +
                    cat +
                    '-' +
                    i +
                    '">Change</button></td></tr>'
                  );
                })
                .join('') +
              '</tbody></table></div></section>'
            );
          })
          .join(''),
      });
      cats.forEach(function (cat) {
        rows
          .filter(function (s) {
            return s.category === cat;
          })
          .forEach(function (s, i) {
            var btn = document.querySelector('#drawerBody [data-mx-set-change="' + cat + '-' + i + '"]');
            if (btn)
              btn.onclick = function () {
                openSettingChangeDrawer(s);
              };
          });
      });
    }, mx.fail);
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
          openDrawer({
            eyebrow: 'SETTINGS · NUMBERING',
            title: 'Change padding · ' + n.kind,
            subtitle: 'Current padding ' + n.pad + '. Applies to new references only.',
            body:
              '<form id="mxNumPadForm"><label class="detail-field"><span>Zero padding</span><input id="mxNumPad" type="number" min="1" max="12" value="' +
              esc(String(n.pad)) +
              '" required></label><label class="detail-field"><span>Reason</span><textarea id="mxNumReason" required rows="2" style="width:100%"></textarea></label><div class="form-actions"><button type="submit" class="btn primary">Save</button></div></form>',
          });
          document.getElementById('mxNumPadForm').onsubmit = function (e) {
            e.preventDefault();
            var pad = document.getElementById('mxNumPad').value;
            var reason = document.getElementById('mxNumReason').value.trim();
            if (!pad || reason.length < 3) return;
            mx.put(AC + '/settings/numbering/' + encodeURIComponent(n.kind), { pad: Number(pad), reason: reason })
              .then(function () {
                toast('Numbering updated', n.kind + ' padding saved.');
                closeDrawer();
              })
              .catch(mx.fail);
          };
        };
      });
    }, mx.fail);
  }

  function openPlatformHealthDrawer() {
    mx.get(AC + '/ops-health').then(function (r) {
      var h = r.data || r;
      var workers = h.workers || [];
      var alerts = h.alerts || [];
      openDrawer({
        eyebrow: 'PLATFORM HEALTH',
        title: (h.status || 'OK') + ' · ' + String(h.liveWorkers != null ? h.liveWorkers : workers.filter(function (w) { return w.live; }).length) + ' live workers',
        subtitle: 'Checked ' + (h.checkedAt ? mx.date(h.checkedAt, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'now'),
        body:
          '<section class="detail-section"><div class="detail-grid"><div class="detail-field"><span>Outbox pending</span><strong>' +
          esc(String(h.outbox && h.outbox.pending != null ? h.outbox.pending : '—')) +
          '</strong></div><div class="detail-field"><span>Dead letters</span><strong>' +
          esc(String(h.outbox && h.outbox.dead != null ? h.outbox.dead : '—')) +
          '</strong></div><div class="detail-field"><span>Open alerts</span><strong>' +
          esc(String(alerts.length)) +
          '</strong></div></div></section>' +
          (alerts.length
            ? '<section class="detail-section"><h3>Alerts</h3><ul style="margin:0;padding-left:18px">' +
              alerts
                .slice(0, 8)
                .map(function (a) {
                  return '<li><strong>' + esc(a.severity) + '</strong> · ' + esc(a.title) + '<br><small>' + esc(a.detail) + '</small></li>';
                })
                .join('') +
              '</ul></section>'
            : '<p class="ops-muted">No open platform alerts.</p>') +
          (workers.length
            ? '<section class="detail-section"><h3>Workers</h3><ul style="margin:0;padding-left:18px">' +
              workers
                .slice(0, 6)
                .map(function (w) {
                  return '<li>' + esc(w.instanceId) + ' · ' + (w.live ? 'live' : 'stale') + ' · last beat ' + mx.date(w.lastBeatAt, { hour: '2-digit', minute: '2-digit' }) + '</li>';
                })
                .join('') +
              '</ul></section>'
            : ''),
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
    if (ev.target.closest('[data-mx-settings-platform]')) openPlatformSettingsDrawer();
    if (ev.target.closest('[data-mx-settings-numbering]')) openNumberingDrawer();
    if (ev.target.closest('[data-mx-settings-retention]')) openRetentionDrawer();
    if (ev.target.closest('[data-mx-settings-health]')) openPlatformHealthDrawer();
  });

  // ----------------------------------------------- audit facets + admin-core event detail

  var auditFacets = null;

  function loadAuditFacets() {
    if (!mx.can('audit.view')) return Promise.resolve();
    return mx.get(AC + '/audit/facets').then(function (r) {
      auditFacets = r.data || r;
    }, function () {});
  }

  function clearAuditChrome() {
    var tbody = document.querySelector('#page-audit table tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8">Loading audit events…</td></tr>';
  }

  mx.hydrate('audit', function () {
    if (!mx.live || !mx.strict('audit') || !mx.can('audit.view')) return Promise.resolve();
    clearAuditChrome();
    var loads = [loadAuditFacets()];
    if (typeof renderAudit === 'function') loads.push(renderAudit({}));
    return Promise.all(loads);
  });

  mx.hydrate('settings', function () {
    if (!mx.live || !mx.can('admin.settings')) return Promise.resolve();
    injectSettingsActions();
    return Promise.all([loadSettingsHistory(), loadIntegrationsBanner()]);
  });

  mx.wrapGlobal('navigate', function (original, args) {
    var result = original.apply(this, args);
    if (mx.live) {
      if (args[0] === 'rbac' && mx.can('admin.rbac')) setTimeout(injectRbacActions, 60);
      if (args[0] === 'settings' && mx.can('admin.settings')) {
        setTimeout(injectSettingsActions, 60);
        loadSettingsHistory();
        loadIntegrationsBanner();
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
    }).catch(mx.fail);
  }, true);

  window.addEventListener('matanho:legacy-ready', function () {
    if (!mx.live) return;
    injectRbacActions();
    injectSettingsActions();
    loadSettingsHistory();
    loadIntegrationsBanner();
    loadAuditFacets();
    if (liveRbac()) {
      toggleRbacDemoPanels(true);
      injectRbacTabs();
      call('renderRbacUsersV8');
    }
    if (liveSettings()) toggleSettingsDemoPanels(true);
  });
})();
