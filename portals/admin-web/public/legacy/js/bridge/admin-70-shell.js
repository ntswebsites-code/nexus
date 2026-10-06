/*
 * Topbar / shell: profile, global search, command palette, notifications,
 * sidebar badges, health line, record drawer.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var myRoles = [];
  var searchTimer = null;
  var paletteHits = [];

  var OPS_PAGE = {
    command: 'command',
    portfolios: 'portfolios',
    'private-markets': 'private-markets',
    'portfolio-lab': 'portfolio-lab',
    orders: 'orders',
    research: 'research',
    risk: 'risk',
    performance: 'performance',
    clients: 'clients',
    'investor-services': 'investor-services',
    onboarding: 'onboarding',
    reports: 'reports',
    vault: 'vault',
    ibor: 'ibor',
    cash: 'cash',
    operations: 'operations',
    reconciliation: 'reconciliations',
    reconciliations: 'reconciliations',
    'corporate-actions': 'corporate-actions',
    nav: 'valuation',
    accounting: 'accounting',
    regulatory: 'regulatory',
    data: 'data',
    'model-governance': 'model-governance',
    copilot: 'copilot',
    rbac: 'rbac',
    settings: 'settings',
    audit: 'audit',
    financing: 'financing',
  };

  var APPROVAL_PAGE = {
    orders: 'orders',
    nav: 'valuation',
    accounting: 'accounting',
    cash: 'cash',
    corporateActions: 'corporate-actions',
    recon: 'reconciliations',
  };

  mx.onLoad(null, function () {
    return Promise.all([
      mx.get('/api/v1/shell/me/role-focus').then(function (r) {
        mx.data.roleFocus = r;
        myRoles = (r.roles || []).map(function (x) {
          return x.key;
        });
      }),
      refreshShellChrome(),
    ]);
  });

  function esc(s) {
    return mx.esc(s);
  }

  function initials(name, email) {
    var n = String(name || email || '?').trim();
    var parts = n.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return n.slice(0, 2).toUpperCase();
  }

  function relativeSync(iso) {
    if (!iso) return 'just now';
    var ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return 'just now';
    if (ms < 3_600_000) return Math.round(ms / 60_000) + ' min ago';
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function hydrateProfile() {
    if (!mx.live || !mx.user) return;
    var u = mx.user;
    var roleKey = typeof state !== 'undefined' ? state.role : mx.data.role;
    var roleText = typeof roleLabels !== 'undefined' && roleLabels[roleKey] ? roleLabels[roleKey] : roleKey || '—';
    var nameEl = document.querySelector('.profile-copy strong');
    var roleEl = document.getElementById('roleLabel');
    var avatar = document.querySelector('.profile-button .avatar');
    if (nameEl) nameEl.textContent = u.name || u.email;
    if (roleEl) roleEl.textContent = roleText;
    if (avatar) avatar.textContent = initials(u.name, u.email);
  }

  function clearSidebarBadges() {
    document.querySelectorAll('.nav-item[data-page] em').forEach(function (em) {
      var page = em.closest('.nav-item').getAttribute('data-page');
      if (page) mx.badge(page, 0);
    });
  }

  function applyTodayBadges(t) {
    if (!t) return;
    if (t.approvals && t.approvals.total != null) mx.badge('command', t.approvals.total);
    if (t.approvals && t.approvals.items) {
      t.approvals.items.forEach(function (item) {
        var page = APPROVAL_PAGE[item.key];
        if (page && item.count) mx.badge(page, item.count);
      });
    }
    if (t.ordersWorking) mx.badge('orders', t.ordersWorking.awaitingApproval || t.ordersWorking.total);
    if (t.breaks) mx.badge('reconciliations', t.breaks.open);
    if (t.runbookDueToday != null) mx.badge('operations', t.runbookDueToday);
    if (t.risk) {
      var riskN = (t.risk.open || 0) + (t.risk.unrecorded || 0);
      if (riskN) mx.badge('risk', riskN);
    }
  }

  function applyOpsBadges(status) {
    if (!status || !status.kpis) return;
    if (status.kpis.corporateActions) mx.badge('corporate-actions', status.kpis.corporateActions);
    if (status.kpis.cashDeadlines) mx.badge('cash', status.kpis.cashDeadlines);
    if (status.kpis.closeBlockers) mx.badge('accounting', status.kpis.closeBlockers);
  }

  function renderHealth(status, asOf) {
    var line = document.querySelector('.health-line span:last-child');
    var dot = document.querySelector('.health-dot');
    var label = 'All services operational';
    if (status === 'CRITICAL') label = 'Critical platform alert';
    else if (status === 'WARNING') label = 'Some services need attention';
    else if (status === 'degraded') label = 'Services degraded';
    if (line) line.textContent = label;
    if (dot) {
      dot.classList.toggle('warn', status === 'WARNING' || status === 'degraded');
      dot.classList.toggle('fail', status === 'CRITICAL');
    }
    var sync = document.getElementById('lastSync');
    if (sync) sync.textContent = relativeSync(asOf);
  }

  function refreshShellChrome() {
    if (!mx.live) return Promise.resolve();
    var tasks = [mx.get('/api/v1/dashboard/today').catch(function () {
      return null;
    })];
    if (mx.can('operations.view')) {
      tasks.push(
        mx.get('/api/v1/operations/status').catch(function () {
          return null;
        }),
      );
    }
    if (mx.can('admin.settings')) {
      tasks.push(
        mx.get('/api/v1/admin-core/ops-health').catch(function () {
          return null;
        }),
      );
    }
    tasks.push(
      mx.get('/api/v1/notifications' + mx.qs({ pageSize: 1 })).catch(function () {
        return null;
      }),
    );
    return Promise.all(tasks).then(function (res) {
      var today = res[0];
      var opsIdx = mx.can('operations.view') ? 1 : -1;
      var healthIdx = mx.can('admin.settings') ? (mx.can('operations.view') ? 2 : 1) : -1;
      var notifyIdx = res.length - 1;
      clearSidebarBadges();
      applyTodayBadges(today);
      if (opsIdx >= 0) applyOpsBadges(res[opsIdx]);
      var healthStatus = 'OK';
      var asOf = today && today.asOf;
      if (healthIdx >= 0 && res[healthIdx] && res[healthIdx].status) {
        healthStatus = res[healthIdx].status;
        asOf = res[healthIdx].checkedAt || asOf;
      } else if (opsIdx >= 0 && res[opsIdx] && res[opsIdx].kpis) {
        healthStatus = res[opsIdx].kpis.serviceHealth === 'ok' ? 'OK' : 'degraded';
        asOf = res[opsIdx].asOf || asOf;
      }
      renderHealth(healthStatus, asOf);
      var notify = res[notifyIdx];
      if (notify) {
        var bell = document.querySelector('.notify-btn');
        var badge = bell && bell.querySelector('span');
        var unread = notify.unread != null ? notify.unread : 0;
        if (badge) badge.textContent = unread > 0 ? String(unread) : '';
      }
      hydrateProfile();
    });
  }

  function legacyPageFromHref(href) {
    if (!href) return null;
    if (href.charAt(0) === '#') return href.replace(/^#/, '');
    var m = href.match(/^\/ops(?:-native)?\/([^/?#]+)/);
    if (!m) return null;
    if (m[1] === 'record') return null;
    return OPS_PAGE[m[1]] || null;
  }

  function parseShellLink(link) {
    if (!link) return null;
    var record = link.match(/^\/ops(?:-native)?\/record\/([^/]+)\/([^/?#]+)/);
    if (record) return { action: 'record', kind: decodeURIComponent(record[1]), id: decodeURIComponent(record[2]) };
    var order = link.match(/^\/ops(?:-native)?\/orders\/([^/?#]+)/);
    if (order && order[1] !== 'export') return { action: 'record', kind: 'order', id: decodeURIComponent(order[1]) };
    var page = legacyPageFromHref(link.split('?')[0]);
    if (page) return { action: 'navigate', page: page };
    if (link.charAt(0) === '#') return { action: 'navigate', page: link.replace(/^#/, '') };
    return { action: 'href', href: link };
  }

  function followShellLink(link) {
    var parsed = parseShellLink(link);
    if (!parsed) return;
    if (parsed.action === 'record') openRecordDrawer(parsed.kind, parsed.id);
    else if (parsed.action === 'navigate' && typeof navigate === 'function') navigate(parsed.page);
    else if (parsed.action === 'href') window.location.assign(parsed.href);
  }

  function fieldValue(v) {
    return /^\d{4}-\d{2}-\d{2}T/.test(String(v))
      ? new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : String(v);
  }

  function openRecordDrawer(kind, id) {
    if (typeof openDrawer !== 'function') return Promise.resolve();
    return mx
      .get('/api/v1/shell/record/' + encodeURIComponent(kind) + '/' + encodeURIComponent(id))
      .then(function (res) {
        var rec = res.record || res;
        var hist = res.history || [];
        var fields = (rec.fields || [])
          .slice(0, 14)
          .map(function (f) {
            return '<div class="detail-field"><span>' + esc(f.label) + '</span><strong>' + esc(fieldValue(f.value)) + '</strong></div>';
          })
          .join('');
        var histHtml =
          hist.length === 0
            ? ''
            : '<section class="detail-section"><h3>Recent activity</h3><ul class="v35-list">' +
              hist
                .map(function (h) {
                  return (
                    '<li><strong>' +
                    esc(h.action) +
                    '</strong> <small>' +
                    esc(fieldValue(h.at)) +
                    (h.role ? ' · ' + esc(h.role) : '') +
                    '</small>' +
                    (h.reason ? '<div><small>' + esc(h.reason) + '</small></div>' : '') +
                    '</li>'
                  );
                })
                .join('') +
              '</ul></section>';
        var modulePage = legacyPageFromHref(rec.route);
        openDrawer({
          eyebrow: (rec.kindLabel || 'RECORD').toUpperCase(),
          title: rec.title,
          subtitle: (rec.ref ? rec.ref + ' · ' : '') + (rec.status || ''),
          body:
            '<section class="detail-section"><div class="detail-grid compact">' +
            fields +
            '</div></section>' +
            histHtml +
            '<div class="form-actions"><button type="button" class="btn secondary" data-mx-rec-close>Close</button>' +
            (modulePage
              ? '<button type="button" class="btn primary" data-mx-rec-open>Open in module</button>'
              : '') +
            '</div>',
        });
        var closeBtn = document.querySelector('#drawerBody [data-mx-rec-close]');
        if (closeBtn) closeBtn.onclick = function () {
          closeDrawer();
        };
        var openBtn = document.querySelector('#drawerBody [data-mx-rec-open]');
        if (openBtn)
          openBtn.onclick = function () {
            closeDrawer();
            navigate(modulePage);
          };
      }, mx.fail);
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
              .map(function (h, i) {
                return (
                  '<button type="button" class="v35-row" data-mx-search-hit="' +
                  i +
                  '" style="width:100%;text-align:left;border:0;background:transparent;cursor:pointer"><span><strong>' +
                  esc(h.title) +
                  '</strong><small>' +
                  esc(h.kindLabel) +
                  (h.ref ? ' · ' + esc(h.ref) : '') +
                  '</small></span><em>' +
                  esc(h.status || '') +
                  '</em></button>'
                );
              })
              .join('') +
            '</div>',
      actions: [{ label: 'Close', primary: true, run: function () {} }],
    });
    document.querySelectorAll('[data-mx-search-hit]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var hit = hits[Number(btn.getAttribute('data-mx-search-hit'))];
        if (!hit) return;
        followShellLink(hit.href);
      });
    });
  }

  function renderPaletteHits(host, q, activeIndex) {
    if (!host || !paletteHits.length) return false;
    host.innerHTML = paletteHits
      .map(function (h, i) {
        return (
          '<button type="button" class="v17-command-item' +
          (i === activeIndex ? ' active' : '') +
          '" data-mx-palette-hit="' +
          i +
          '"><span class="v17-command-icon">↗</span><span><strong>' +
          esc((h.ref ? h.ref + ' · ' : '') + h.title) +
          '</strong><small>' +
          esc(h.kindLabel + (h.status ? ' · ' + h.status : '')) +
          '</small></span><em>Record</em></button>'
        );
      })
      .join('');
    host.querySelectorAll('[data-mx-palette-hit]').forEach(function (btn) {
      btn.onclick = function () {
        var hit = paletteHits[Number(btn.getAttribute('data-mx-palette-hit'))];
        if (typeof v17CloseCommand === 'function') v17CloseCommand();
        if (hit) followShellLink(hit.href);
      };
    });
    return true;
  }

  mx.wrapGlobal('v17RenderCommands', function (original, args) {
    var q = args[0] || '';
    if (!mx.live || q.trim().length < 2) {
      paletteHits = [];
      return original.apply(this, args);
    }
    var host = document.getElementById('v17CommandList');
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      mx.get('/api/v1/shell/search' + mx.qs({ q: q.trim(), limit: 12 }))
        .then(function (r) {
          paletteHits = r.hits || r || [];
          if (!renderPaletteHits(host, q, 0) && typeof original === 'function') original(q);
        })
        .catch(function () {
          paletteHits = [];
          original(q);
        });
    }, 180);
    if (host && !host.querySelector('[data-mx-palette-wait]')) {
      host.innerHTML =
        '<div data-mx-palette-wait style="padding:22px;text-align:center;font-size:12px;color:#6f7c8e">Searching records…</div>';
    }
  });

  mx.wrapGlobal('v17OpenCommand', function (original, args) {
    paletteHits = [];
    return original.apply(this, args);
  });

  function bindRecordLinkDelegation() {
    if (document.documentElement.dataset.mxShellRecords) return;
    document.documentElement.dataset.mxShellRecords = '1';
    document.addEventListener(
      'click',
      function (e) {
        if (!mx.live) return;
        var rec = e.target.closest && e.target.closest('[data-mx-record-kind][data-mx-record-id]');
        if (rec) {
          e.preventDefault();
          e.stopImmediatePropagation();
          openRecordDrawer(rec.getAttribute('data-mx-record-kind'), rec.getAttribute('data-mx-record-id'));
          return;
        }
        var link = e.target.closest && e.target.closest('a[href], button[data-mx-shell-link]');
        if (!link) return;
        var href = link.getAttribute('data-mx-shell-link') || link.getAttribute('href');
        if (!href) return;
        var parsed = parseShellLink(href);
        if (!parsed || parsed.action !== 'record') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        openRecordDrawer(parsed.kind, parsed.id);
      },
      true,
    );
  }

  window.addEventListener('matanho:legacy-ready', function () {
    hydrateProfile();
    bindRecordLinkDelegation();

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

    var cmdBtn = document.getElementById('v17CommandTrigger');
    if (cmdBtn && !cmdBtn.__mxShell) {
      cmdBtn.__mxShell = true;
      cmdBtn.addEventListener('click', function (ev) {
        if (!mx.live) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        if (typeof v17OpenCommand === 'function') v17OpenCommand();
      }, true);
    }

    document.addEventListener(
      'keydown',
      function (ev) {
        if (!mx.live) return;
        if (!(ev.metaKey || ev.ctrlKey) || ev.key.toLowerCase() !== 'k') return;
        var typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement && document.activeElement.tagName) || '');
        if (typing && document.activeElement !== document.getElementById('v17CommandInput')) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        if (typeof v17OpenCommand === 'function') v17OpenCommand();
      },
      true,
    );

    var bell = document.querySelector('.notify-btn');
    if (bell && !bell.__mxShell) {
      bell.__mxShell = true;
      mx.intercept(
        '.notify-btn',
        function () {
          return mx.get('/api/v1/notifications' + mx.qs({ pageSize: 12 })).then(function (page) {
            var items = page.items || page.rows || [];
            var unread =
              page.unread != null
                ? page.unread
                : items.filter(function (n) {
                    return !n.readAt;
                  }).length;
            var badge = bell.querySelector('span');
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
                  if (item && item.link) followShellLink(item.link);
                }, mx.fail);
              };
            });
          });
        },
        {
          when: function () {
            return mx.live;
          },
        },
      );
    }

    var sw = document.getElementById('roleSwitcher');
    if (sw && !sw.__mxFocus) {
      sw.__mxFocus = true;
      sw.addEventListener('change', function () {
        if (!mx.live) return;
        var role = sw.value || null;
        if (role && role.indexOf('Preview') >= 0) {
          hydrateProfile();
          return;
        }
        if (role && myRoles.indexOf(role) < 0) {
          hydrateProfile();
          return;
        }
        mx.put('/api/v1/shell/me/role-focus', { role: myRoles.indexOf(role) >= 0 ? role : null })
          .then(function () {
            hydrateProfile();
          })
          .catch(function () {
            hydrateProfile();
          });
      });
    }
  });

  window.mxOpenRecordDrawer = openRecordDrawer;
  window.mxFollowShellLink = followShellLink;
})();
