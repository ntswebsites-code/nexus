/*
 * Reports & BI: catalogue, runs, schedules, editor/preview modals.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var runByRef = {};
  var catalogue = [];

  function getEnvelope(path) {
    return fetch(mx.api + path, { credentials: 'include', headers: { Accept: 'application/json' } }).then(function (r) {
      return r.json();
    });
  }

  function liveReports() {
    return mx.live && mx.strict('reports');
  }

  function clearReportsKpis() {
    document.querySelectorAll('#page-reports .v33-kpis .v33-kpi strong').forEach(function (el) {
      el.textContent = '—';
    });
    document.querySelectorAll('#page-reports .v33-kpis .v33-kpi small').forEach(function (el) {
      el.textContent = 'Loading…';
    });
  }

  function patchReportsKpis(rows, schedules) {
    var kpis = document.querySelectorAll('#page-reports .v33-kpis .v33-kpi');
    if (!kpis.length) return;
    rows = rows || [];
    schedules = schedules || [];
    var published = 0;
    var awaiting = 0;
    var client = 0;
    var reg = 0;
    rows.forEach(function (r) {
      var st = r.raw && r.raw.status;
      if (st === 'COMPLETED') published++;
      else if (st !== 'FAILED') awaiting++;
      if (r.type === 'Investor') client++;
      if (r.type === 'Regulatory') reg++;
    });
    var week = Date.now() + 7 * 86400000;
    var schedSoon = schedules.filter(function (s) {
      return s.nextRunOn && new Date(s.nextRunOn).getTime() <= week;
    }).length;
    if (kpis[0]) kpis[0].querySelector('strong').textContent = String(published);
    if (kpis[1]) kpis[1].querySelector('strong').textContent = String(awaiting);
    if (kpis[2]) {
      kpis[2].querySelector('strong').textContent = String(schedules.length);
      kpis[2].querySelector('small').textContent = schedSoon + ' in next 7 days';
    }
    if (kpis[3]) kpis[3].querySelector('strong').textContent = String(client);
    if (kpis[4]) {
      kpis[4].querySelector('strong').textContent = String(reg);
      kpis[4].querySelector('small').textContent = reg ? 'From report library' : 'No regulatory runs';
    }
    if (kpis[5]) {
      kpis[5].querySelector('strong').textContent = '0';
      kpis[5].querySelector('small').textContent = 'From data quality feed';
    }
  }

  function reportType(name, category) {
    var n = (name || category || '').toLowerCase();
    if (n.indexOf('investor') >= 0 || n.indexOf('client') >= 0) return 'Investor';
    if (n.indexOf('committee') >= 0 || n.indexOf('investment') >= 0) return 'Investment committee';
    if (n.indexOf('risk') >= 0) return 'Risk';
    if (n.indexOf('regulatory') >= 0 || n.indexOf('compliance') >= 0) return 'Regulatory';
    if (n.indexOf('management') >= 0 || n.indexOf('executive') >= 0) return 'Management';
    return category || 'Management';
  }

  function statusProto(s) {
    if (s === 'COMPLETED') return 'Published';
    if (s === 'FAILED') return 'Draft';
    return 'Review';
  }

  function mapRunV33(r) {
    var ref = r.ref || r.id;
    runByRef[ref] = r.id;
    return {
      apiId: r.id,
      id: ref,
      title: r.title || r.reportName || 'Report',
      type: reportType(r.reportName, r.report),
      audience: (r.params && r.params.portfolioId) || r.reportName || 'Controlled output',
      owner: r.requestedBy || 'Reports',
      updated: r.createdAt ? r.createdAt.replace('T', ' ').slice(0, 16) : '—',
      status: statusProto(r.status),
      raw: r,
    };
  }

  function mapRunInline(r, i) {
    var row = mapRunV33(r);
    return {
      name: row.title,
      type: row.type,
      period: (r.params && r.params.asOf) || mx.date(r.createdAt),
      owner: row.owner,
      edited: row.updated,
      version: 'v1',
      status: row.status === 'Published' ? 'Published' : row.status === 'Review' ? 'Awaiting approval' : 'Draft',
      apiId: row.apiId,
      ref: row.id,
      raw: r,
    };
  }

  function applyReportRows(rows) {
    window.__mxData = window.__mxData || {};
    window.__mxData._reportRows33 = rows;
    window.__mxData._reportData34 = rows;
    window.__mxData._reportsInline = rows.map(function (r, i) {
      return mapRunInline(r.raw, i);
    });
    if (typeof renderReports === 'function') renderReports();
    if (typeof renderReportDashboard === 'function') renderReportDashboard();
    if (typeof renderReports === 'function' && document.getElementById('reportRows')) {
      var body = document.getElementById('reportRows');
      if (body) {
        body.innerHTML = window.__mxData._reportsInline
          .map(function (r, i) {
            return (
              '<tr><td><strong>' +
              r.name +
              '</strong></td><td>' +
              r.type +
              '</td><td>' +
              r.period +
              '</td><td>' +
              r.owner +
              '</td><td>' +
              r.edited +
              '</td><td>' +
              r.version +
              '</td><td><span class="tag">' +
              r.status +
              '</span></td><td><button class="row-action report-preview" data-report-ref="' +
              r.ref +
              '">Preview</button>' +
              (r.raw && r.raw.status === 'COMPLETED' && !r.raw.distributedAt && mx.can('reports.approve') && ['FACT_SHEET', 'NAV_PACK'].indexOf(r.raw.report) >= 0
                ? ' <button class="row-action" data-mx-report-distribute="' +
                  mx.esc(r.ref) +
                  '" data-mx-api-id="' +
                  mx.esc(r.apiId) +
                  '">Distribute</button>'
                : '') +
              '</td></tr>'
            );
          })
          .join('');
      }
    }
  }

  function loadReports() {
    if (!mx.can('reports.view')) return Promise.resolve();
    return Promise.all([
      getEnvelope('/api/v1/reports/runs?limit=50'),
      getEnvelope('/api/v1/reports/catalogue'),
      getEnvelope('/api/v1/reports/schedules').catch(function () {
        return { data: [] };
      }),
    ]).then(function (parts) {
      var list = parts[0].data || parts[0] || [];
      catalogue = parts[1].data || parts[1] || [];
      var schedules = parts[2].data || parts[2] || [];
      runByRef = {};
      var mapped = list.map(mapRunV33);
      applyReportRows(mapped);
      mx.data.reportRuns = mapped;
      mx.data.reportCatalogue = catalogue;
      mx.data.reportSchedules = schedules;
      if (liveReports()) patchReportsKpis(mapped, schedules);
    });
  }

  function runApiId(ref) {
    return runByRef[ref];
  }

  function reportKeyForType(type) {
    var t = (type || '').toLowerCase();
    if (t.indexOf('cash') >= 0) return 'CASH';
    if (t.indexOf('holding') >= 0) return 'HOLDINGS';
    if (t.indexOf('transaction') >= 0) return 'TRANSACTIONS';
    if (t.indexOf('nav') >= 0) return 'NAV_PACK';
    return 'FACT_SHEET';
  }

  function createRun(key, format) {
    return getEnvelope('/api/v1/portfolios?limit=1').then(function (p) {
      var port = (p.data || p || [])[0];
      var params = port ? { portfolioId: port.id } : {};
      return mx.post('/api/v1/reports/runs', { key: key || 'FACT_SHEET', params: params, format: format || 'HTML' });
    });
  }

  function distributeRun(apiId, ref) {
    if (!mx.can('reports.approve')) {
      mx.toast('Access restricted', 'You need reports.approve to distribute to the LP portal.', 'error');
      return Promise.resolve();
    }
    return mx
      .post('/api/v1/reports/runs/' + encodeURIComponent(apiId) + '/distribute', {}, { stepUp: true })
      .then(function () {
        mx.toast('Report distributed', (ref || 'Run') + ' published to investor portal users.');
        return loadReports();
      });
  }

  function openCreateScheduleModal() {
    var def = catalogue[0];
    mx.modal({
      eyebrow: 'REPORTS',
      title: 'New report schedule',
      body:
        '<form id="mxNewSchedule"><label class="v34-field"><span>Name</span><input class="v34-input" name="name" required minlength="3"></label><label class="v34-field"><span>Report</span><select class="v34-select" name="key">' +
        catalogue
          .map(function (c) {
            return '<option value="' + mx.esc(c.key) + '">' + mx.esc(c.name) + '</option>';
          })
          .join('') +
        '</select></label><label class="v34-field"><span>Format</span><select class="v34-select" name="format"><option>CSV</option><option>HTML</option><option>PDF</option></select></label><label class="v34-field"><span>Frequency</span><select class="v34-select" name="frequency"><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY" selected>Monthly</option><option value="QUARTERLY">Quarterly</option></select></label><label class="v34-field"><span>First run (YYYY-MM-DD)</span><input class="v34-input" name="firstRunOn" type="date"></label><label class="v34-field"><span>Email recipients</span><input class="v34-input" name="recipients" placeholder="comma-separated"></label></form>',
      actions: [
        { label: 'Cancel', run: function () {} },
        {
          label: 'Create schedule',
          primary: true,
          run: function (m) {
            var fd = new FormData(m.querySelector('#mxNewSchedule'));
            var recipients = String(fd.get('recipients') || '')
              .split(/[\s,;]+/)
              .filter(Boolean);
            return getEnvelope('/api/v1/portfolios?limit=1').then(function (p) {
              var port = (p.data || p || [])[0];
              return mx.post('/api/v1/reports/schedules', {
                key: fd.get('key') || (def && def.key) || 'HOLDINGS',
                name: fd.get('name'),
                format: fd.get('format') || 'CSV',
                frequency: fd.get('frequency') || 'MONTHLY',
                firstRunOn: fd.get('firstRunOn') || undefined,
                recipients: recipients.length ? recipients : undefined,
                params: port ? { portfolioId: port.id } : {},
              });
            }).then(function () {
              mx.toast('Schedule created', 'Recurring report delivery saved.');
              return openSchedulesModal();
            });
          },
        },
      ],
    });
  }

  function openSchedulesModal() {
    return getEnvelope('/api/v1/reports/schedules').then(function (body) {
      var rows = body.data || body || [];
      mx.modal({
        eyebrow: 'REPORTS',
        title: 'Report schedules',
        subtitle: rows.length + ' configured',
        wide: true,
        body:
          (rows.length
            ? '<div class="v34-list">' +
              rows
                .map(function (s) {
                  return (
                    '<div class="v34-row"><span><strong>' +
                    mx.esc(s.name) +
                    '</strong><small>' +
                    mx.esc(s.reportName || s.report) +
                    ' · ' +
                    mx.esc(s.frequency) +
                    ' · next ' +
                    mx.esc(s.nextRunOn || '—') +
                    '</small></span><em>' +
                    (mx.can('reports.create')
                      ? '<button type="button" class="v34-btn small" data-mx-sched-run="' +
                        mx.esc(s.id) +
                        '">Run now</button> ' +
                        '<button type="button" class="v34-btn small" data-mx-sched-toggle="' +
                        mx.esc(s.id) +
                        '" data-mx-sched-active="' +
                        (s.active ? '1' : '0') +
                        '">' +
                        (s.active ? 'Pause' : 'Resume') +
                        '</button>'
                      : '') +
                    (mx.can('reports.approve') && ['FACT_SHEET', 'NAV_PACK'].indexOf(s.report) >= 0
                      ? ' <button type="button" class="v34-btn small" data-mx-sched-lp="' +
                        mx.esc(s.id) +
                        '" data-mx-sched-lp-on="' +
                        (s.lpDeliver ? '1' : '0') +
                        '">' +
                        (s.lpDeliver ? 'Stop LP' : 'LP deliver') +
                        '</button>'
                      : '') +
                    '</em></div>'
                  );
                })
                .join('') +
              '</div>'
            : '<p class="ops-muted">No schedules yet.</p>') +
          (mx.can('reports.create')
            ? '<div class="form-actions" style="margin-top:12px"><button type="button" class="btn secondary" id="mxSchedRunDue">Run due now</button><button type="button" class="btn primary" id="mxSchedCreate">New schedule</button></div>'
            : ''),
        actions: [{ label: 'Close', run: function () {} }],
      });
      var createBtn = document.getElementById('mxSchedCreate');
      if (createBtn) createBtn.onclick = openCreateScheduleModal;
      var dueBtn = document.getElementById('mxSchedRunDue');
      if (dueBtn) {
        dueBtn.onclick = function () {
          mx.post('/api/v1/reports/schedules/run-due', {}).then(function (r) {
            mx.toast('Schedules executed', (r.ran != null ? r.ran : r.data && r.data.ran) + ' schedule(s) ran.');
            return openSchedulesModal();
          }, mx.fail);
        };
      }
      document.querySelectorAll('[data-mx-sched-run]').forEach(function (b) {
        b.onclick = function () {
          mx.post('/api/v1/reports/schedules/' + encodeURIComponent(b.getAttribute('data-mx-sched-run')) + '/run-now', {}).then(function () {
            mx.toast('Schedule run queued', 'Output appears in the report library.');
            return loadReports();
          }, mx.fail);
        };
      });
      document.querySelectorAll('[data-mx-sched-toggle]').forEach(function (b) {
        b.onclick = function () {
          var id = b.getAttribute('data-mx-sched-toggle');
          var active = b.getAttribute('data-mx-sched-active') !== '1';
          mx.patch('/api/v1/reports/schedules/' + encodeURIComponent(id), { active: active }).then(function () {
            return openSchedulesModal();
          }, mx.fail);
        };
      });
      document.querySelectorAll('[data-mx-sched-lp]').forEach(function (b) {
        b.onclick = function () {
          var id = b.getAttribute('data-mx-sched-lp');
          var enabled = b.getAttribute('data-mx-sched-lp-on') !== '1';
          mx.post('/api/v1/reports/schedules/' + encodeURIComponent(id) + '/lp-delivery', { enabled: enabled }, { stepUp: true }).then(function () {
            mx.toast(enabled ? 'LP delivery enabled' : 'LP delivery stopped', id);
            return openSchedulesModal();
          }, mx.fail);
        };
      });
    });
  }

  function openRunPreview(apiId, title) {
    return getEnvelope('/api/v1/reports/runs/' + encodeURIComponent(apiId) + '/link').then(function (body) {
      var url = (body.data || body).url;
      if (!url) {
        mx.toast('No preview', 'Report output is not ready yet.', 'warn');
        return;
      }
      var paper = document.getElementById('previewPaper');
      var modal = document.getElementById('previewModal');
      var previewTitle = document.getElementById('previewTitle');
      if (paper && modal) {
        if (previewTitle) previewTitle.textContent = title || 'Report preview';
        paper.innerHTML =
          '<iframe src="' + url + '" style="width:100%;min-height:480px;border:0" title="Report preview"></iframe>';
        if (typeof openModal === 'function') openModal('previewModal');
        else {
          modal.classList.add('show');
          document.getElementById('modalBackdrop')?.classList.add('show');
        }
        return;
      }
      window.open(url, '_blank');
    });
  }

  mx.onLoad('reports.view', function () {
    if (!document.getElementById('page-reports')) return Promise.resolve();
    if (liveReports()) clearReportsKpis();
    return loadReports();
  });

  mx.hydrate('reports', function () {
    if (!liveReports()) return Promise.resolve();
    clearReportsKpis();
    return loadReports();
  });

  window.addEventListener('matanho:legacy-ready', function () {
    mx.gate('#v33NewReport', 'reports.create');
    mx.gate('#v34NewReport', 'reports.create');
    mx.gate('#submitReport', 'reports.create');

    document.addEventListener(
      'click',
      function (e) {
        if (!liveReports()) return;
        var newBtn = e.target.closest && e.target.closest('#v33NewReport, #v34NewReport');
        if (newBtn) {
          e.preventDefault();
          e.stopImmediatePropagation();
          var def = catalogue[0];
          createRun(def && def.key, 'HTML')
            .then(function () {
              mx.toast('Report run created', (def && def.name) || 'Controlled report generated from live data.');
              return loadReports();
            })
            .catch(mx.fail);
          return;
        }
        var sched = e.target.closest && e.target.closest('#v33ReportSchedule, #v34ReportSchedule');
        if (sched) {
          e.preventDefault();
          e.stopImmediatePropagation();
          openSchedulesModal().catch(mx.fail);
          return;
        }
        var dist = e.target.closest && e.target.closest('[data-mx-report-distribute]');
        if (dist) {
          e.preventDefault();
          e.stopImmediatePropagation();
          distributeRun(dist.getAttribute('data-mx-api-id'), dist.getAttribute('data-mx-report-distribute')).catch(mx.fail);
          return;
        }
        var row = e.target.closest && e.target.closest('[data-report-id]');
        if (row && row.dataset.reportId) {
          e.preventDefault();
          e.stopImmediatePropagation();
          var apiId = runApiId(row.dataset.reportId);
          if (!apiId) return;
          var mapped = (window.__mxData._reportRows33 || []).find(function (r) {
            return r.id === row.dataset.reportId;
          });
          openRunPreview(apiId, mapped && mapped.title).catch(mx.fail);
          return;
        }
      },
      true,
    );

    mx.intercept(
      '#previewReport',
      function () {
        var title = (document.getElementById('editorTitle') || {}).textContent || 'Report preview';
        var type =
          (typeof state !== 'undefined' && state.currentReportType) || (title.toLowerCase().indexOf('compliance') >= 0 ? 'compliance' : 'client');
        createRun(reportKeyForType(type), 'HTML')
          .then(function (run) {
            var id = (run.data || run).id;
            return openRunPreview(id, title);
          })
          .catch(mx.fail);
        return false;
      },
      { when: liveReports },
    );

    mx.intercept(
      '#submitReport',
      function () {
        var title = (document.getElementById('editorTitle') || {}).textContent || 'Report';
        createRun('FACT_SHEET', 'PDF')
          .then(function () {
            mx.toast('Report submitted', title + ' generated and queued for controlled distribution.');
            if (typeof closeModals === 'function') closeModals();
            return loadReports();
          })
          .catch(mx.fail);
        return false;
      },
      { when: liveReports },
    );

    mx.intercept(
      '#printPreview',
      function () {
        var iframe = document.querySelector('#previewPaper iframe');
        if (iframe && iframe.src) {
          window.open(iframe.src, '_blank');
          return false;
        }
        return true;
      },
      { when: liveReports },
    );

    mx.intercept(
      '#saveReport',
      function () {
        mx.toast('Draft saved', 'Report content retained locally; generate a run to persist controlled output.');
        return false;
      },
      { when: liveReports },
    );
  });
})();
