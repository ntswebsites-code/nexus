/*
 * Investment Copilot: ask, suggestions, history, integration banner.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var AC = '/api/v1/admin-core';
  var copilotOn = true;
  var suggestions = [];
  var historyRows = [];
  var integrationBanner = null;

  function liveCopilot() {
    return mx.live && mx.strict('copilot');
  }

  function clearCopilotChrome() {
    var ctx = document.querySelector('#page-copilot .v15-copilot-context');
    if (ctx) {
      var strong = ctx.querySelector('strong');
      var em = ctx.querySelector('em');
      if (strong) strong.textContent = 'Loading entitlements…';
      if (em) em.textContent = '—';
    }
    document.querySelectorAll('#page-copilot .v15-context-list em').forEach(function (el) {
      el.textContent = '—';
    });
  }

  function userInitials() {
    var u = mx.user;
    if (!u) return 'TM';
    var n = (u.name || u.email || '').trim();
    if (!n) return 'TM';
    return n
      .split(/\s+/)
      .map(function (p) {
        return p[0];
      })
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  function esc(s) {
    return mx.esc(s == null ? '' : String(s));
  }

  function renderUserBubble(q) {
    return (
      '<div class="v15-user-message"><div><p>' +
      esc(q) +
      '</p></div><span class="v15-ai-avatar">' +
      esc(userInitials()) +
      '</span></div>'
    );
  }

  function renderTableHtml(table, caption) {
    if (!table || !table.columns || !table.columns.length) return '';
    var head =
      '<div class="table-wrap" style="margin-top:10px"><table><thead><tr>' +
      table.columns
        .map(function (c) {
          return '<th>' + esc(c) + '</th>';
        })
        .join('') +
      '</tr></thead><tbody>' +
      (table.rows || [])
        .map(function (row) {
          return '<tr>' + row.map(function (cell) { return '<td>' + esc(cell) + '</td>'; }).join('') + '</tr>';
        })
        .join('') +
      '</tbody></table></div>';
    if (!caption) return head;
    return '<p style="margin:10px 0 6px;font-weight:600">' + esc(String(caption).replace(/_/g, ' ')) + '</p>' + head;
  }

  function renderAiBubble(reply) {
    var title = reply.intent ? String(reply.intent).replace(/_/g, ' ') : 'Answer';
    var chips = (reply.sources || [])
      .map(function (s) {
        return '<span>' + esc(s.label || s.endpoint || 'Source') + '</span>';
      })
      .join('');
    var table = renderTableHtml(reply.table);
    if (reply.extraTables && reply.extraTables.length) {
      reply.extraTables.forEach(function (t) {
        table += renderTableHtml({ columns: t.columns, rows: t.rows }, t.title);
      });
    }
    var engine =
      reply.engine === 'LLM'
        ? '<small style="display:block;margin-top:8px;opacity:.75">LLM adapter' + (reply.model ? ' · ' + esc(reply.model) : '') + '</small>'
        : reply.engine === 'ROUTER'
          ? '<small style="display:block;margin-top:8px;opacity:.75">Keyword router (no external model)</small>'
          : '';
    return (
      '<div class="v15-ai-message"><span class="v15-ai-avatar">m</span><div><strong>' +
      esc(title) +
      '</strong><p>' +
      esc(reply.answer) +
      '</p>' +
      (chips ? '<div class="v15-source-chips">' + chips + '</div>' : '') +
      table +
      engine +
      '</div></div>'
    );
  }

  function appendLive(q) {
    var box = document.getElementById('v15CopilotMessages');
    if (!box) return Promise.resolve();
    if (!copilotOn) {
      toast('Copilot disabled', 'Switch the Copilot on under Settings (Feature flags).', 'warn');
      return Promise.resolve();
    }
    box.insertAdjacentHTML('beforeend', renderUserBubble(q));
    box.scrollTop = box.scrollHeight;
    return mx
      .post(AC + '/copilot/ask', { question: q })
      .then(function (r) {
        var reply = r.data || r;
        box.insertAdjacentHTML('beforeend', renderAiBubble(reply));
        box.scrollTop = box.scrollHeight;
        return loadHistory();
      })
      .catch(function (e) {
        var last = box.querySelector('.v15-user-message:last-of-type');
        if (last) last.remove();
        mx.fail(e);
      });
  }

  function loadSuggestions() {
    return mx.get(AC + '/copilot/suggestions').then(function (r) {
      var body = r.data || r;
      copilotOn = !!body.enabled;
      suggestions = body.suggestions || [];
      patchSuggestions();
      patchBanner();
    });
  }

  function loadHistory() {
    return mx.get(AC + '/copilot/history').then(function (r) {
      historyRows = r.data || r || [];
    });
  }

  function loadBanner() {
    return mx.get(AC + '/integrations/banner').then(function (r) {
      integrationBanner = r.data || r;
      patchBanner();
    }, function () {
      integrationBanner = null;
    });
  }

  function patchSuggestions() {
    var host = document.querySelector('#page-copilot .v15-copilot-suggestions');
    if (!host || !liveCopilot() || !suggestions.length) return;
    host.innerHTML = suggestions
      .slice(0, 8)
      .map(function (s) {
        return '<button type="button" data-v15-copilot-prompt="' + esc(s) + '">' + esc(s.length > 42 ? s.slice(0, 40) + '…' : s) + '</button>';
      })
      .join('');
    if (typeof bindV15PageActions === 'function') bindV15PageActions(host);
  }

  function patchBanner() {
    var ctx = document.querySelector('#page-copilot .v15-copilot-context');
    if (!ctx || !liveCopilot()) return;
    var em = ctx.querySelector('em');
    if (em) em.textContent = 'Data as-of ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' CAT';
    var existing = document.getElementById('mxCopilotBanner');
    if (existing) existing.remove();
    if (!integrationBanner || !integrationBanner.production || !integrationBanner.count) return;
    var fake = (integrationBanner.fakeAdapters || []).join(', ');
    var el = document.createElement('div');
    el.id = 'mxCopilotBanner';
    el.className = 'v15-copilot-policy';
    el.style.marginTop = '10px';
    el.innerHTML =
      '<strong>Simulated integrations active</strong><p>' +
      esc(fake) +
      ' — answers use the keyword router until a live LLM adapter is configured.</p>';
    ctx.insertAdjacentElement('afterend', el);
  }

  function resetThread() {
    var box = document.getElementById('v15CopilotMessages');
    if (!box) return;
    box.innerHTML =
      '<div class="v15-ai-message"><span class="v15-ai-avatar">m</span><div><strong>New analysis started.</strong><p>What would you like to understand about the portfolio?</p></div></div>';
  }

  function openHistoryDrawer() {
    openDrawer({
      eyebrow: 'COPILOT',
      title: 'Conversation history',
      subtitle: 'Your recent questions are logged with intent and sources.',
      body:
        historyRows.length
          ? '<ul style="margin:0;padding-left:18px">' +
            historyRows
              .map(function (h) {
                return (
                  '<li style="margin-bottom:10px"><button type="button" class="text-btn" data-mx-copilot-hist="' +
                  esc(h.id) +
                  '">' +
                  esc(h.question) +
                  '</button><br><small>' +
                  esc(h.intent) +
                  ' · ' +
                  mx.date(h.at, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) +
                  '</small></li>'
                );
              })
              .join('') +
            '</ul>'
          : '<p>No questions yet.</p>',
    });
    document.querySelectorAll('#drawerBody [data-mx-copilot-hist]').forEach(function (b) {
      b.onclick = function () {
        var row = historyRows.find(function (h) {
          return h.id === b.getAttribute('data-mx-copilot-hist');
        });
        if (!row) return;
        closeDrawer();
        navigate('copilot');
        setTimeout(function () {
          appendLive(row.question).catch(mx.fail);
        }, 80);
      };
    });
  }

  function openSourcesDrawer() {
    var perms = (mx.user && mx.user.permissions) || [];
    openDrawer({
      eyebrow: 'COPILOT · GOVERNED SOURCES',
      title: 'Source permissions',
      subtitle: 'Copilot only queries domains your effective permissions allow.',
      body:
        '<section class="detail-section"><p><strong>' +
        perms.length +
        '</strong> effective permissions on this session.</p><div class="v15-source-chips">' +
        ['dashboard.view', 'portfolio.view', 'orders.view', 'risk.view', 'cash.view', 'operations.view', 'audit.view']
          .map(function (p) {
            return '<span>' + p + (perms.indexOf(p) >= 0 ? ' ✓' : ' —') + '</span>';
          })
          .join('') +
        '</div><p style="margin-top:12px">Copilot is advisory. It cannot approve orders, move cash, or publish official returns.</p></section>',
    });
  }

  mx.wrapGlobal('appendV15Copilot', function (original, args) {
    if (!liveCopilot()) return original.apply(this, args);
    return appendLive(args[0]);
  });

  mx.hydrate('copilot', function () {
    if (!mx.can('dashboard.view')) return Promise.resolve();
    mx.strict('copilot');
    if (liveCopilot()) clearCopilotChrome();
    return Promise.all([loadSuggestions(), loadHistory(), loadBanner()]).then(function () {
      if (liveCopilot()) resetThread();
    });
  });

  mx.interceptSubmit(
    '#v15CopilotForm',
    function () {
      var input = document.getElementById('v15CopilotInput');
      var q = input && input.value.trim();
      if (!q) return false;
      return appendLive(q).then(function () {
        if (input) input.value = '';
        return false;
      });
    },
    { when: function () { return liveCopilot(); } },
  );

  function openCopilotFab() {
    navigate('copilot');
    setTimeout(function () {
      var input = document.getElementById('v15CopilotInput');
      if (input) input.focus();
    }, 80);
  }

  document.addEventListener(
    'click',
    function (ev) {
      var fab = ev.target.closest && ev.target.closest('[data-v15-open-copilot]');
      if (fab && liveCopilot()) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        openCopilotFab();
        return;
      }
      var prompt = ev.target.closest && ev.target.closest('[data-v15-copilot-prompt]');
      if (prompt && liveCopilot()) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        var q = prompt.getAttribute('data-v15-copilot-prompt');
        navigate('copilot');
        setTimeout(function () {
          appendLive(q).catch(mx.fail);
        }, 80);
        return;
      }
      var btn = ev.target.closest && ev.target.closest('[data-v15-copilot-action]');
      if (!btn || !liveCopilot()) return;
      var a = btn.getAttribute('data-v15-copilot-action');
      if (a === 'new') resetThread();
      else if (a === 'history') openHistoryDrawer();
      else if (a === 'sources') openSourcesDrawer();
    },
    true,
  );

  document.addEventListener(
    'keydown',
    function (ev) {
      if (!liveCopilot()) return;
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'j') {
        ev.preventDefault();
        openCopilotFab();
      }
    },
    true,
  );
})();
