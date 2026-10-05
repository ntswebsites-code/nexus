/*
 * Topbar / shell: global search, notifications, role-focus lens.
 * Profile drawer remains in admin-60-access.js; this file adds search and bell.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var myRoles = [];

  mx.onLoad(null, function () {
    return mx.get('/api/v1/shell/me/role-focus').then(function (r) {
      mx.data.roleFocus = r;
      myRoles = (r.roles || []).map(function (x) {
        return x.key;
      });
    });
  });

  function esc(s) {
    return mx.esc(s);
  }

  function showSearchResults(q, hits) {
    mx.modal({
      eyebrow: 'SEARCH',
      title: 'Results for “' + q + '”',
      subtitle: hits.length ? hits.length + ' match(es)' : 'No matches',
      wide: true,
      body:
        hits.length === 0
          ? '<p class="detail-copy">Try a reference, client name or order id.</p>'
          : '<div class="v35-list">' +
            hits
              .map(function (h) {
                return (
                  '<a class="v35-row" href="' +
                  esc(h.href) +
                  '" data-mx-search-hit="1" style="text-decoration:none;color:inherit"><span><strong>' +
                  esc(h.title) +
                  '</strong><small>' +
                  esc(h.kindLabel) +
                  (h.ref ? ' · ' + esc(h.ref) : '') +
                  '</small></span><em>' +
                  esc(h.status || '') +
                  '</em></a>'
                );
              })
              .join('') +
            '</div>',
      actions: [{ label: 'Close', primary: true, run: function () {} }],
    });
    document.querySelectorAll('[data-mx-search-hit]').forEach(function (a) {
      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        if (a.getAttribute('href').indexOf('#') === 0 && typeof navigate === 'function') {
          navigate(a.getAttribute('href').replace(/^#/, ''));
        } else {
          window.location.assign(a.getAttribute('href'));
        }
      });
    });
  }

  window.addEventListener('matanho:legacy-ready', function () {
    var search = document.getElementById('globalSearch');
    if (search && !search.__mxShell) {
      search.__mxShell = true;
      search.addEventListener('keydown', function (ev) {
        if (!mx.live || ev.key !== 'Enter') return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        var q = search.value.trim();
        if (q.length < 2) {
          mx.toast('Search', 'Enter at least two characters.', 'warn');
          return;
        }
        mx.get('/api/v1/shell/search' + mx.qs({ q: q, limit: 12 })).then(function (r) {
          showSearchResults(q, r.hits || r || []);
        }, mx.fail);
      });
    }

    var bell = document.querySelector('.notify-btn');
    if (bell && !bell.__mxShell) {
      bell.__mxShell = true;
      mx.intercept(
        '.notify-btn',
        function () {
          return mx.get('/api/v1/notifications' + mx.qs({ pageSize: 12 })).then(function (page) {
            var items = page.items || page.rows || [];
            var unread = page.unread != null ? page.unread : items.filter(function (n) {
              return !n.readAt;
            }).length;
            var badge = bell.querySelector('em');
            if (badge) badge.textContent = unread > 0 ? String(unread) : '';
            mx.modal({
              eyebrow: 'NOTIFICATIONS',
              title: 'Inbox',
              subtitle: unread + ' unread',
              wide: true,
              body:
                items.length === 0
                  ? '<p class="detail-copy">No notifications yet.</p>'
                  : '<div class="v35-list">' +
                    items
                      .map(function (n) {
                        return (
                          '<button type="button" class="v35-row" data-nid="' +
                          esc(n.id) +
                          '" style="width:100%;text-align:left;border:0;background:transparent;cursor:pointer"><span><strong>' +
                          esc(n.title) +
                          '</strong><small>' +
                          esc(n.body || '') +
                          '</small></span><em>' +
                          (n.readAt ? 'read' : 'new') +
                          '</em></button>'
                        );
                      })
                      .join('') +
                    '</div>',
              actions: [
                {
                  label: 'Mark all read',
                  run: function () {
                    return mx.post('/api/v1/notifications/read-all', {}).then(function () {
                      mx.toast('Notifications', 'All marked read.');
                    });
                  },
                },
                { label: 'Close', primary: true, run: function () {} },
              ],
            });
            document.querySelectorAll('[data-nid]').forEach(function (btn) {
              btn.onclick = function () {
                var id = btn.getAttribute('data-nid');
                mx.post('/api/v1/notifications/' + encodeURIComponent(id) + '/read', {}).then(function () {
                  var item = items.find(function (x) {
                    return x.id === id;
                  });
                  if (item && item.link && item.link.charAt(0) === '/') window.location.assign(item.link);
                }, mx.fail);
              };
            });
          });
        },
        { when: function () {
          return mx.live;
        } },
      );
    }

    var sw = document.getElementById('roleSwitcher');
    if (sw && !sw.__mxFocus) {
      sw.__mxFocus = true;
      sw.addEventListener('change', function () {
        if (!mx.live) return;
        var role = sw.value || null;
        if (role && role.indexOf('Preview') >= 0) return;
        if (role && myRoles.indexOf(role) < 0) return;
        mx.put('/api/v1/shell/me/role-focus', { role: myRoles.indexOf(role) >= 0 ? role : null }).catch(function () {
          /* preview roles are local only */
        });
      });
    }
  });
})();
