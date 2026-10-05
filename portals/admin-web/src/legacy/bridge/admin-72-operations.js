/*
 * Operations Control: status KPIs, runbook tasks, calendar, workload.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var liveTasks = [];
  var opsFilter = 'All';

  function stateLabel(state) {
    if (state === 'BLOCKED') return 'Blocked';
    if (state === 'DUE') return 'Due';
    if (state === 'SCHEDULED') return 'Scheduled';
    if (state === 'DONE') return 'Done';
    return state;
  }

  function toProtoRow(t) {
    var due = t.dueAt ? new Date(t.dueAt) : new Date();
    var time = due.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return [
      time,
      t.area ? t.area.replace(/_/g, ' ') : 'Ops',
      t.title,
      stateLabel(t.state),
      t.dependsOn ? t.dependsOn.ref : t.detail || '',
      t.ownerName || '—',
    ];
  }

  function renderRunbook() {
    var host = document.getElementById('v33OpsRunbook') || document.getElementById('v36OpsRunbook');
    if (!host || !mx.strict('operations')) return;
    var rows = (mx.data.opsTaskRows || []).filter(function (t) {
      var label = stateLabel(t.state);
      return opsFilter === 'All' || label === opsFilter;
    });
    host.innerHTML = rows
      .map(function (t) {
        var label = stateLabel(t.state);
        var time = t.dueAt ? new Date(t.dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
        return (
          '<div class="v33-row clickable" data-task-id="' +
          mx.esc(t.id) +
          '"><span><strong>' +
          mx.esc(time + ' · ' + (t.area || '') + ' · ' + t.title) +
          '</strong><small>' +
          mx.esc(t.dependsOn ? t.dependsOn.ref : t.detail || '') +
          '</small></span><span class="v33-chip ' +
          (label === 'Blocked' ? 'fail' : label === 'Due' ? 'warn' : 'info') +
          '">' +
          mx.esc(label) +
          '</span></div>'
        );
      })
      .join('');
    host.querySelectorAll('[data-task-id]').forEach(function (el) {
      el.onclick = function () {
        openTaskModal(el.getAttribute('data-task-id'));
      };
    });
  }

  function openTaskModal(taskId) {
    var task = (mx.data.opsTaskRows || []).find(function (t) {
      return t.id === taskId;
    });
    if (!task) return;
    var canWork = mx.can('operations.task.manage');
    mx.modal({
      eyebrow: 'OPERATIONS · ' + task.area,
      title: task.title,
      subtitle: task.ref + ' · ' + task.state.toLowerCase(),
      body:
        '<p>' +
        mx.esc(task.detail || '') +
        '</p><p><strong>Owner:</strong> ' +
        mx.esc(task.ownerName || '—') +
        '</p>',
      actions: [
        canWork && task.state !== 'DONE' && task.state !== 'CANCELLED'
          ? {
              label: task.state === 'BLOCKED' ? 'Reopen' : task.state === 'DUE' ? 'Start' : 'Complete',
              primary: true,
              run: function () {
                var action = task.state === 'BLOCKED' ? 'reopen' : task.state === 'DUE' ? 'start' : 'complete';
                return mx
                  .post('/api/v1/operations/tasks/' + encodeURIComponent(task.id) + '/' + action, {}, { version: task.version })
                  .then(function () {
                    mx.toast('Task updated', task.ref);
                    return mx.refresh('operations');
                  });
              },
            }
          : null,
        canWork && task.state === 'DUE'
          ? {
              label: 'Block',
              run: function () {
                return mx
                  .post('/api/v1/operations/tasks/' + encodeURIComponent(task.id) + '/block', { reason: 'Blocked from workspace' }, { version: task.version })
                  .then(function () {
                    return mx.refresh('operations');
                  });
              },
            }
          : null,
        { label: 'Close', run: function () {} },
      ].filter(Boolean),
    });
  }

  function renderStatus(s) {
    if (!s || !s.kpis) return;
    document.querySelectorAll('.v33-kpi strong, .v36-ops-kpi strong').forEach(function (el, i) {
      var vals = [
        s.kpis.dueToday,
        s.kpis.settlementExposure.length
          ? s.kpis.settlementExposure
              .map(function (e) {
                return mx.money(e.amount, e.currency);
              })
              .join(' · ')
          : '0',
        s.kpis.cashDeadlines,
        s.kpis.corporateActions,
        s.kpis.closeBlockers,
        s.kpis.serviceHealth === 'ok' ? 'Live' : 'Degraded',
      ];
      if (vals[i] != null) el.textContent = vals[i];
    });
    mx.badge('operations', s.kpis.dueToday);
  }

  function loadOps() {
    return Promise.all([
      mx.get('/api/v1/operations/status'),
      mx.list('/api/v1/operations/tasks', { filter: 'all', pageSize: 50 }),
    ]).then(function (res) {
      var status = res[0];
      var list = res[1];
      mx.data.opsStatus = status;
      mx.data.opsTaskRows = list.rows || [];
      liveTasks = (list.rows || []).map(toProtoRow);
      mx.data.opsTasks = liveTasks;
      renderStatus(status);
      renderRunbook();
    });
  }

  mx.onLoad('operations.view', function () {
    return loadOps();
  });

  mx.hydrate('operations', function () {
    if (!mx.strict('operations')) return Promise.resolve();
    return loadOps();
  });

  window.addEventListener('matanho:legacy-ready', function () {
    document.querySelectorAll('[data-v33-ops-filter]').forEach(function (btn) {
      btn.addEventListener(
        'click',
        function (ev) {
          if (!mx.strict('operations')) return;
          ev.stopImmediatePropagation();
          opsFilter = btn.getAttribute('data-v33-ops-filter') || 'All';
          document.querySelectorAll('[data-v33-ops-filter]').forEach(function (x) {
            x.classList.toggle('active', x === btn);
          });
          renderRunbook();
        },
        true,
      );
    });

    mx.intercept(
      '#v33OpsNewTask, #v36OpsNew',
      function () {
        mx.gate(document.getElementById('v33OpsNewTask') || document.getElementById('v36OpsNew'), 'operations.task.manage');
        if (!mx.can('operations.task.manage')) return false;
        return mx.modal({
          eyebrow: 'OPERATIONS',
          title: 'New task',
          body:
            '<form id="mxOpsTaskForm"><label>Title<input name="title" class="v34-input" required></label><label>Area<select name="area" class="v34-input"><option>SETTLEMENT</option><option>CASH</option><option>VALUATION</option><option>CLOSE</option><option>OTHER</option></select></label><label>Due<input type="datetime-local" name="dueAt" class="v34-input" required></label></form>',
          actions: [
            {
              label: 'Create',
              primary: true,
              run: function (m) {
                var fd = new FormData(m.querySelector('#mxOpsTaskForm'));
                return mx
                  .post('/api/v1/operations/tasks', {
                    title: fd.get('title'),
                    area: fd.get('area'),
                    dueAt: new Date(fd.get('dueAt')).toISOString(),
                  })
                  .then(function () {
                    return mx.refresh('operations');
                  });
              },
            },
          ],
        });
      },
      { when: function () {
        return mx.live && mx.strict('operations');
      } },
    );

    mx.intercept(
      '#v33OpsCalendar, #v36OpsCalendar',
      function () {
        var from = new Date();
        var to = new Date();
        to.setDate(to.getDate() + 14);
        return mx
          .get(
            '/api/v1/operations/calendar' +
              mx.qs({ from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }),
          )
          .then(function (cal) {
            var events = cal.events || cal || [];
            mx.modal({
              eyebrow: 'OPERATIONS',
              title: 'Control calendar',
              body:
                '<div class="v35-list">' +
                (events.length
                  ? events
                      .map(function (e) {
                        return '<div class="v35-row"><span><strong>' + mx.esc(e.title || e.label) + '</strong><small>' + mx.esc(e.date || e.dueAt || '') + '</small></span></div>';
                      })
                      .join('')
                  : '<p>No events in the next two weeks.</p>') +
                '</div>',
              actions: [{ label: 'Close', primary: true, run: function () {} }],
            });
          });
      },
      { when: function () {
        return mx.live && mx.strict('operations');
      } },
    );

    if (mx.can('operations.task.manage')) {
      var gen = document.querySelector('[data-v36-ops-generate]');
      if (gen) {
        mx.intercept('[data-v36-ops-generate]', function () {
          return mx.post('/api/v1/operations/tasks/generate', {}).then(function () {
            return mx.refresh('operations');
          });
        });
      }
    }
  });
})();
