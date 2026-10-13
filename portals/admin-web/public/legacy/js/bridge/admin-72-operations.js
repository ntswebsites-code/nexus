/*
 * Operations Control: status KPIs, runbook tasks, calendar, workload.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var liveTasks = [];
  var opsFilter = 'All';

  function liveOps() {
    return mx.live && mx.strict('operations');
  }

  function clearOpsChrome() {
    document.querySelectorAll('#page-operations .v33-kpi').forEach(function (k) {
      var s = k.querySelector('strong');
      var n = k.querySelector('small');
      if (s) s.textContent = '—';
      if (n) n.textContent = 'Loading…';
    });
    document.querySelectorAll('#page-operations .v33-lane strong').forEach(function (el) {
      el.textContent = '—';
    });
    document.querySelectorAll('#page-operations .v33-lane small').forEach(function (el) {
      el.textContent = 'Loading…';
    });
    document.querySelectorAll('#page-operations .v33-owner-ribbon + .v33-grid .v33-row em, #page-operations .v33-grid .v33-list .v33-row em').forEach(function (el) {
      el.textContent = '—';
    });
  }

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

  function downloadBlobFile(filename, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 500);
  }

  function exportRunbook(format) {
    var filterMap = { All: 'all', Due: 'due', Blocked: 'blocked', Scheduled: 'scheduled', Done: 'done' };
    var filter = filterMap[opsFilter] || 'all';
    var isXlsx = format === 'xlsx';
    return fetch(mx.api + '/api/v1/operations/tasks' + mx.qs({ filter: filter, format: format }), {
      credentials: 'include',
      headers: {
        Accept: isXlsx
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv',
      },
    })
      .then(function (r) {
        if (isXlsx) {
          return r.blob().then(function (blob) {
            if (!r.ok) throw { message: 'Export failed' };
            return blob;
          });
        }
        return r.text().then(function (text) {
          if (!r.ok) {
            var err;
            try {
              err = JSON.parse(text).error;
            } catch (e) {
              err = { message: text || 'Export failed' };
            }
            throw err;
          }
          return text;
        });
      })
      .then(function (payload) {
        if (isXlsx) downloadBlobFile('runbook.xlsx', payload);
        else if (typeof downloadTextFile === 'function') downloadTextFile('runbook.csv', payload);
        else downloadBlobFile('runbook.csv', new Blob([payload], { type: 'text/csv;charset=utf-8' }));
        mx.toast('Runbook exported', (isXlsx ? 'XLSX' : 'CSV') + ' downloaded from the server.');
      });
  }

  function exportCalendar(format, from, to) {
    var isXlsx = format === 'xlsx';
    var name = 'operations-calendar-' + from + '-' + to;
    return fetch(mx.api + '/api/v1/operations/calendar' + mx.qs({ from: from, to: to, format: format }), {
      credentials: 'include',
      headers: {
        Accept: isXlsx
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv',
      },
    })
      .then(function (r) {
        if (isXlsx) {
          return r.blob().then(function (blob) {
            if (!r.ok) throw { message: 'Export failed' };
            return blob;
          });
        }
        return r.text().then(function (text) {
          if (!r.ok) {
            var err;
            try {
              err = JSON.parse(text).error;
            } catch (e) {
              err = { message: text || 'Export failed' };
            }
            throw err;
          }
          return text;
        });
      })
      .then(function (payload) {
        if (isXlsx) downloadBlobFile(name + '.xlsx', payload);
        else if (typeof downloadTextFile === 'function') downloadTextFile(name + '.csv', payload);
        else downloadBlobFile(name + '.csv', new Blob([payload], { type: 'text/csv;charset=utf-8' }));
        mx.toast('Calendar exported', (isXlsx ? 'XLSX' : 'CSV') + ' downloaded from the server.');
      });
  }

  function showCloseGatesModal(s) {
    var cash = s.cash || {};
    var portfolios = cash.portfolios || [];
    var rows = portfolios
      .map(function (p) {
        return (
          '<div class="v35-row"><span><strong>' +
          mx.esc(p.portfolioRef || p.portfolioName) +
          '</strong><small>' +
          mx.esc((p.failing && p.failing.length ? p.failing.join(' · ') : 'Ready') || '') +
          '</small></span><em>' +
          mx.esc(p.closeStatus || '') +
          (p.blockers ? ' · ' + p.blockers + ' blocker(s)' : '') +
          '</em></div>'
        );
      })
      .join('');
    mx.modal({
      eyebrow: 'OPERATIONS · CLOSE',
      title: 'Cash close readiness',
      subtitle: 'Period end ' + (cash.periodEnd || 'current') + ' · live pre-check from the book of record.',
      body: rows ? '<div class="v35-list">' + rows + '</div>' : '<p>No portfolio close data returned.</p>',
      actions: [{ label: 'Close', primary: true, run: function () {} }],
    });
  }

  function showSettlementFailsModal(payload) {
    var rows = (payload && payload.data) || payload || [];
    var body = rows.length
      ? '<div class="v35-list">' +
        rows
          .slice(0, 15)
          .map(function (f) {
            return (
              '<div class="v35-row"><span><strong>' +
              mx.esc((f.orderRef || f.ref) + (f.ticker ? ' · ' + f.ticker : '')) +
              '</strong><small>' +
              mx.esc((f.portfolio && f.portfolio.name) || 'Portfolio') +
              ' · ' +
              mx.esc(f.daysLate + 'd late') +
              '</small></span><em>' +
              mx.esc(f.status) +
              '</em></div>'
            );
          })
          .join('') +
        '</div>'
      : '<p>No open settlement fails.</p>';
    mx.modal({
      eyebrow: 'OPERATIONS · SETTLEMENT',
      title: 'Settlement fails',
      subtitle: (payload && payload.summary && payload.summary.openCount != null ? payload.summary.openCount + ' open' : rows.length + ' row(s)') + ' from ops-controls.',
      body: body,
      actions: [{ label: 'Close', primary: true, run: function () {} }],
    });
  }

  function renderSettlementFails(payload) {
    if (!mx.strict('operations')) return;
    var rows = (payload && payload.data) || [];
    var open = rows.filter(function (f) {
      return f.open;
    });
    var kpis = document.querySelectorAll('#page-operations .v33-kpi, #page-operations .v36-ops-kpi');
    if (!kpis[1]) return;
    var small = kpis[1].querySelector('small');
    if (small) {
      small.textContent =
        open.length +
        ' settlement fail' +
        (open.length === 1 ? '' : 's') +
        ' · ' +
        (mx.data.opsStatus && mx.data.opsStatus.kpis ? mx.data.opsStatus.kpis.unsettledOrders : 0) +
        ' unsettled order(s)';
    }
    kpis[1].style.cursor = 'pointer';
    kpis[1].title = 'View settlement fails from reconciliation register';
    kpis[1].onclick = function (ev) {
      ev.preventDefault();
      showSettlementFailsModal(payload || { data: [] });
    };
  }

  function renderCloseGates(s) {
    if (!s || !mx.strict('operations')) return;
    var grid = document.querySelector('#page-operations .v33-lane-grid');
    if (grid && s.dependencies && s.dependencies.length) {
      var lanes = grid.querySelectorAll('.v33-lane');
      s.dependencies.forEach(function (dep, i) {
        if (!lanes[i]) return;
        var strong = lanes[i].querySelector('strong');
        var small = lanes[i].querySelector('small');
        if (strong) strong.textContent = dep.readinessPct + '% ready';
        if (small) small.textContent = dep.detail;
      });
    }
    var kpis = document.querySelectorAll('#page-operations .v33-kpi');
    if (kpis[4] && s.cash) {
      kpis[4].style.cursor = 'pointer';
      kpis[4].title = 'View cash close blockers by portfolio';
      kpis[4].onclick = function (ev) {
        if (!mx.strict('operations')) return;
        ev.preventDefault();
        showCloseGatesModal(s);
      };
    }
  }

  function ensureOpsExportButton() {
    var actions = document.querySelector('#page-operations .v33-actions');
    if (!actions || actions.querySelector('[data-mx-ops-export]') || !mx.strict('operations')) return;
    [['csv', 'Export CSV'], ['xlsx', 'Export XLSX']].forEach(function (pair) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'v33-btn';
      btn.setAttribute('data-mx-ops-export', pair[0]);
      btn.textContent = pair[1];
      actions.insertBefore(btn, actions.firstChild);
      btn.onclick = function () {
        exportRunbook(pair[0]).catch(mx.fail);
      };
    });
  }

  function renderStatus(s) {
    if (!s || !s.kpis) return;
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
    ['v33OpsKpiDue', 'v33OpsKpiExposure', 'v33OpsKpiCash', 'v33OpsKpiCa', 'v33OpsKpiClose', 'v33OpsKpiHealth'].forEach(function (id, i) {
      var el = document.getElementById(id);
      if (el && vals[i] != null) el.textContent = vals[i];
    });
    mx.badge('operations', s.kpis.dueToday);
    renderCloseGates(s);
    ensureOpsExportButton();
  }

  function loadOps() {
    return Promise.all([
      mx.get('/api/v1/operations/status'),
      mx.list('/api/v1/operations/tasks', { filter: 'all', pageSize: 50 }),
      mx.strict('operations') && mx.can('operations.view') ? mx.get('/api/v1/ops-controls/settlement-fails') : Promise.resolve(null),
    ]).then(function (res) {
      var status = res[0];
      var list = res[1];
      mx.data.opsStatus = status;
      mx.data.opsTaskRows = list.rows || [];
      mx.data.settlementFails = res[2];
      liveTasks = (list.rows || []).map(toProtoRow);
      mx.data.opsTasks = liveTasks;
      renderStatus(status);
      renderSettlementFails(res[2]);
      renderRunbook();
    });
  }

  mx.onLoad('operations.view', function () {
    if (liveOps()) clearOpsChrome();
    return loadOps();
  });

  mx.hydrate('operations', function () {
    if (!mx.strict('operations')) return Promise.resolve();
    if (liveOps()) clearOpsChrome();
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
        var fromStr = from.toISOString().slice(0, 10);
        var toStr = to.toISOString().slice(0, 10);
        return mx
          .get('/api/v1/operations/calendar' + mx.qs({ from: fromStr, to: toStr }))
          .then(function (cal) {
            var body = cal.data || cal;
            var events = body.events || body || [];
            mx.modal({
              eyebrow: 'OPERATIONS',
              title: 'Control calendar',
              subtitle: fromStr + ' – ' + toStr,
              body:
                '<div class="v35-list">' +
                (events.length
                  ? events
                      .map(function (e) {
                        return (
                          '<div class="v35-row"><span><strong>' +
                          mx.esc(e.title || e.label) +
                          '</strong><small>' +
                          mx.esc(e.date || e.dueAt || '') +
                          (e.kind ? ' · ' + mx.esc(e.kind) : '') +
                          '</small></span></div>'
                        );
                      })
                      .join('')
                  : '<p>No events in the next two weeks.</p>') +
                '</div>',
              actions: [
                {
                  label: 'Export CSV',
                  run: function () {
                    return exportCalendar('csv', fromStr, toStr);
                  },
                },
                {
                  label: 'Export XLSX',
                  run: function () {
                    return exportCalendar('xlsx', fromStr, toStr);
                  },
                },
                { label: 'Close', primary: true, run: function () {} },
              ],
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
