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
              '">Preview</button></td></tr>'
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
    ]).then(function (parts) {
      var list = parts[0].data || parts[0] || [];
      catalogue = parts[1].data || parts[1] || [];
      runByRef = {};
      var mapped = list.map(mapRunV33);
      applyReportRows(mapped);
      mx.data.reportRuns = mapped;
      mx.data.reportCatalogue = catalogue;
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
    return loadReports();
  });

  mx.hydrate('reports', function () {
    if (!liveReports()) return Promise.resolve();
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
          getEnvelope('/api/v1/reports/schedules').then(function (body) {
            var rows = body.data || body || [];
            mx.modal({
              title: 'Report schedules',
              body:
                rows.length
                  ? '<ul>' +
                    rows
                      .map(function (s) {
                        return '<li>' + s.name + ' · ' + (s.frequency || '') + ' · ' + (s.reportName || s.report) + '</li>';
                      })
                      .join('') +
                    '</ul>'
                  : '<p>No schedules yet. Create recurring delivery in ops-native reports.</p>',
            });
          });
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
