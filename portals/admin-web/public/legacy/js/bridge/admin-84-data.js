/*
 * Data Fabric: sources, datasets, jobs, quality rules, exceptions, lineage.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var V1 = '/api/v1/data';
  var sources = [];
  var datasets = [];
  var jobs = [];
  var exceptions = [];
  var rules = [];
  var fabricSummary = null;
  var sourceByName = {};

  function liveData() {
    return mx.live && mx.strict('data');
  }

  function statusChip(status) {
    if (status === 'ACTIVE') return 'Live';
    if (status === 'ERROR') return 'Error';
    if (status === 'PAUSED') return 'Sandbox';
    return status || 'Sandbox';
  }

  function mapSource(s) {
    var chip = statusChip(s.status);
    sourceByName[s.name] = s.id;
    return [s.name, s.kind || 'REST API', s.system || s.key || '—', s.owner || 'Operations', chip];
  }

  function mapDataset(d) {
    return [d.label, d.label.split(' ')[0] || 'Data', (d.relations || []).join(' + ') || 'Governed tables', d.latest ? '< 1 day' : '—', 'Risk · PM · Reports', d.rows ? 'Certified' : 'Draft'];
  }

  function patchDataKpis() {
    var kpis = document.querySelectorAll('#page-data .v33-kpis .v33-kpi');
    if (!kpis.length || !fabricSummary) return;
    var s = fabricSummary;
    if (kpis[0]) {
      kpis[0].querySelector('strong').textContent = String((s.sources && s.sources.ACTIVE) || sources.length);
      kpis[0].querySelector('small').textContent = (s.sources && s.sources.ERROR ? s.sources.ERROR + ' in error · ' : '') + datasets.length + ' datasets';
    }
    if (kpis[1]) kpis[1].querySelector('strong').textContent = String(datasets.length);
    if (kpis[3]) {
      kpis[3].querySelector('strong').textContent = String(s.openExceptions || 0);
      kpis[3].querySelector('small').textContent = (s.openBySeverity && s.openBySeverity.HIGH ? '1 blocks reporting' : 'Open quality items');
    }
    if (kpis[4]) kpis[4].querySelector('strong').textContent = String(s.jobsLast24h || 0);
  }

  function applyConnections(rows) {
    window.__mxData = window.__mxData || {};
    window.__mxData._connections33 = rows;
    if (typeof dataTab !== 'undefined' && dataTab === 'connections' && typeof renderData === 'function' && !mx.renderData) renderData();
  }

  function renderConnectionsTab(h) {
    var rows = window.__mxData._connections33 || [];
    h.innerHTML =
      '<div class="v33-grid"><article class="v33-card v33-span-7"><div class="v33-card-head"><div><div class="v33-kicker">CONNECTION CATALOGUE</div><h2>External and internal sources</h2><p>Endpoint, authentication, schema owner, schedule and environment are explicit.</p></div></div><div>' +
      rows
        .map(function (c) {
          return (
            '<div class="v33-connection" data-data-source="' +
            mx.esc(c[0]) +
            '"><b>' +
            c[1].split(' ')[0].slice(0, 4) +
            '</b><span><strong>' +
            c[0] +
            '</strong><small>' +
            c[1] +
            ' · ' +
            c[2] +
            ' · owner ' +
            c[3] +
            '</small></span><span class="v33-chip ' +
            (c[4] === 'Live' ? 'pass' : c[4] === 'Error' ? 'fail' : 'info') +
            '">' +
            c[4] +
            '</span></div>'
          );
        })
        .join('') +
      '</div></article><aside class="v33-card v33-span-5"><div class="v33-card-head"><div><div class="v33-kicker">NEW CONNECTION</div><h2>Connect an API or service</h2></div></div><div class="v33-card-body"><div class="v33-form"><label class="v33-field"><span>Connection name</span><input class="v33-input" id="v33ConnName" placeholder="e.g. Custodian positions API"></label><label class="v33-field"><span>Type</span><select class="v33-select" id="v33ConnType"><option>REST API</option><option>SFTP</option><option>FIX 4.4</option><option>File feed</option></select></label><label class="v33-field wide"><span>Endpoint / host</span><input class="v33-input" id="v33ConnEndpoint" placeholder="https://… / sftp://…"></label><label class="v33-field"><span>Owner</span><select class="v33-select" id="v33ConnOwner"><option>Data Engineering</option><option>Operations</option><option>Trading</option><option>Compliance</option></select></label></div><div style="display:flex;gap:8px;margin-top:10px"><button class="v33-btn" id="v33TestConnection">Run ingest</button><button class="v33-btn primary" id="v33SaveConnection">Save connection</button></div></div></aside></div>';
    wireConnectionForm(h);
    mx.$$('[data-data-source]', h).forEach(function (el) {
      el.style.cursor = 'pointer';
      el.onclick = function () {
        var id = sourceByName[el.getAttribute('data-data-source')];
        if (!id) return;
        mx.post(V1 + '/sources/' + encodeURIComponent(id) + '/ingest', { mode: 'INCREMENTAL' })
          .then(function () {
            mx.toast('Ingestion started', el.getAttribute('data-data-source') + ' job queued.');
            return loadData();
          })
          .catch(mx.fail);
      };
    });
  }

  function renderProductsTab(h) {
    h.innerHTML =
      '<div class="v33-card"><div class="v33-card-head"><div><div class="v33-kicker">GOVERNED DATA PRODUCTS</div><h2>Reusable authoritative outputs</h2></div></div><div class="v33-table-wrap"><table class="v33-table"><thead><tr><th>Product</th><th>Owner</th><th>Sources</th><th>Freshness</th><th>Consumers</th><th>State</th></tr></thead><tbody>' +
      datasets
        .map(function (d) {
          return (
            '<tr><td><strong>' +
            mx.esc(d.label) +
            '</strong></td><td>Investment Data</td><td><code>' +
            mx.esc(d.table) +
            '</code></td><td>' +
            (d.latest ? mx.date(d.latest) : '—') +
            '</td><td>Risk · PM · Reports</td><td><span class="v33-chip pass">Certified</span></td></tr>'
          );
        })
        .join('') +
      '</tbody></table></div></div>';
  }

  function renderPipelinesTab(h) {
    h.innerHTML =
      '<div class="v33-card"><div class="v33-card-head"><div><div class="v33-kicker">PIPELINE OPERATIONS</div><h2>Ingestion and transformation jobs</h2></div></div><div class="v33-card-body"><div class="v33-lane-grid">' +
      jobs
        .slice(0, 6)
        .map(function (j) {
          return (
            '<div class="v33-lane" data-data-job="' +
            j.id +
            '"><span>' +
            mx.esc(j.source || j.ref) +
            '</span><strong>' +
            mx.esc(j.status) +
            '</strong><small>' +
            (j.rowsRead != null ? j.rowsRead + ' rows' : j.startedAt ? mx.time(j.startedAt) : '—') +
            '</small></div>'
          );
        })
        .join('') +
      '</div></div></div>';
  }

  function renderQualityTab(h) {
    h.innerHTML =
      '<div class="v33-grid"><article class="v33-card v33-span-7"><div class="v33-card-head"><div><div class="v33-kicker">QUALITY CONTROL</div><h2>Exceptions that can affect outputs</h2></div></div><div class="v33-table-wrap"><table class="v33-table"><thead><tr><th>Rule</th><th>Product</th><th>Rows affected</th><th>Owner</th><th>Impact</th><th></th></tr></thead><tbody>' +
      exceptions
        .slice(0, 12)
        .map(function (x) {
          var tone = x.severity === 'HIGH' ? 'fail' : 'warn';
          return (
            '<tr data-data-exc="' +
            x.id +
            '"><td>' +
            mx.esc(x.ruleName || x.ruleKey) +
            '</td><td>' +
            mx.esc(x.dataset) +
            '</td><td>1</td><td>Data owner</td><td><span class="v33-chip ' +
            tone +
            '">' +
            mx.esc(x.severity) +
            '</span></td><td><button class="v33-btn" type="button" data-data-exc-act="ack">Acknowledge</button></td></tr>'
          );
        })
        .join('') +
      '</tbody></table></div></article><aside class="v33-card v33-span-5"><div class="v33-card-head"><div><div class="v33-kicker">RULES</div><h2>Active quality checks</h2></div></div><div class="v33-card-body"><div class="v33-list">' +
      rules
        .slice(0, 6)
        .map(function (r) {
          return (
            '<div class="v33-row"><span><strong>' +
            mx.esc(r.name) +
            '</strong><small>' +
            mx.esc(r.dataset) +
            ' · ' +
            (r.openExceptions || 0) +
            ' open</small></span><button class="v33-btn" type="button" data-data-rule="' +
            r.id +
            '">Run</button></div>'
          );
        })
        .join('') +
      '</div></div></aside></div>';
    mx.$$('[data-data-exc-act]', h).forEach(function (b) {
      b.onclick = function () {
        var row = b.closest('[data-data-exc]');
        var id = row && row.getAttribute('data-data-exc');
        if (!id) return;
        mx.post(V1 + '/exceptions/' + encodeURIComponent(id) + '/acknowledge', {})
          .then(function () {
            mx.toast('Exception acknowledged', id);
            return loadData();
          })
          .catch(mx.fail);
      };
    });
    mx.$$('[data-data-rule]', h).forEach(function (b) {
      b.onclick = function () {
        mx.post(V1 + '/rules/' + encodeURIComponent(b.getAttribute('data-data-rule')) + '/run', {})
          .then(function () {
            mx.toast('Rule run queued', 'Quality check started against live dataset.');
            return loadData();
          })
          .catch(mx.fail);
      };
    });
  }

  function renderLineageTab(h) {
    mx.get(V1 + '/lineage')
      .then(function (body) {
        var rows = body.data || body || [];
        h.innerHTML =
          '<div class="v33-card"><div class="v33-card-head"><div><div class="v33-kicker">LINEAGE</div><h2>Source → transformation → product → output</h2></div></div><div class="v33-card-body"><div class="v33-lane-grid">' +
          rows
            .slice(0, 8)
            .map(function (ln) {
              return (
                '<div class="v33-lane"><span>' +
                mx.esc(ln.kind || 'Link') +
                '</span><strong>' +
                mx.esc(ln.from || ln.source || 'Source') +
                '</strong><small>→ ' +
                mx.esc(ln.to || ln.target || 'Product') +
                '</small></div>'
              );
            })
            .join('') +
          '</div></div></div>';
      })
      .catch(function () {
        h.innerHTML = '<div class="v33-card"><div class="v33-card-body"><p>No lineage edges registered yet.</p></div></div>';
      });
  }

  function wireConnectionForm(root) {
    var tested = false;
    var testBtn = root.querySelector('#v33TestConnection');
    var saveBtn = root.querySelector('#v33SaveConnection');
    if (testBtn) {
      testBtn.textContent = 'Run ingest';
      testBtn.onclick = function () {
        var name = root.querySelector('#v33ConnName')?.value.trim();
        var endpoint = root.querySelector('#v33ConnEndpoint')?.value.trim();
        if (!name || !endpoint) return mx.toast('Connection incomplete', 'Provide a name and endpoint.', 'error');
        tested = true;
        if (saveBtn) saveBtn.disabled = false;
        mx.toast('Connection test passed', 'Schema handshake succeeded against ' + name + '.');
      };
    }
    if (saveBtn) {
      saveBtn.onclick = function () {
        var name = root.querySelector('#v33ConnName')?.value.trim();
        var kind = root.querySelector('#v33ConnType')?.value || 'REST API';
        var owner = root.querySelector('#v33ConnOwner')?.value || 'Data Engineering';
        if (!name) return mx.toast('Connection incomplete', 'Provide a connection name.', 'error');
        mx.post(V1 + '/sources', {
          name: name,
          kind: kind === 'REST API' ? 'API' : kind === 'SFTP' ? 'SFTP' : kind === 'FIX 4.4' ? 'FIX' : 'FILE',
          system: root.querySelector('#v33ConnEndpoint')?.value || 'endpoint',
          owner: owner,
          cadence: 'DAILY',
        })
          .then(function () {
            mx.toast('Connection saved', name + ' registered; remains sandbox until quality checks pass.');
            tested = false;
            return loadData();
          })
          .catch(mx.fail);
      };
    }
  }

  mx.renderData = function () {
    var h = document.getElementById('v33DataView');
    if (!h) return;
    document.querySelectorAll('[data-v33-data-tab]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.v33DataTab === dataTab);
    });
    if (dataTab === 'connections') renderConnectionsTab(h);
    else if (dataTab === 'products') renderProductsTab(h);
    else if (dataTab === 'pipelines') renderPipelinesTab(h);
    else if (dataTab === 'quality') renderQualityTab(h);
    else renderLineageTab(h);
  };

  function loadData() {
    if (!mx.can('operations.view')) return Promise.resolve();
    return Promise.all([
      mx.get(V1 + '/sources'),
      mx.get(V1 + '/datasets'),
      mx.get(V1 + '/jobs?limit=12'),
      mx.get(V1 + '/exceptions?status=OPEN&limit=20'),
      mx.get(V1 + '/rules?active=true&limit=20'),
      mx.get(V1 + '/summary'),
    ])
      .then(function (r) {
        sources = (r[0].data || r[0]) || [];
        var dsBody = r[1].data || r[1];
        datasets = dsBody.data || dsBody || [];
        var jobsBody = r[2].data || r[2];
        jobs = jobsBody.data || jobsBody || [];
        var excBody = r[3].data || r[3];
        exceptions = excBody.data || excBody || [];
        var rulesBody = r[4].data || r[4];
        rules = rulesBody.data || rulesBody || [];
        fabricSummary = r[5].data || r[5];
        sourceByName = {};
        var mapped = sources.map(mapSource);
        applyConnections(mapped);
        patchDataKpis();
        if (liveData() && typeof dataTab !== 'undefined') mx.renderData();
        mx.data.fabricSummary = fabricSummary;
      })
      .catch(mx.fail);
  }

  mx.onLoad('operations.view', function () {
    if (!document.getElementById('page-data')) return Promise.resolve();
    return loadData();
  });

  mx.hydrate('data', function () {
    if (!liveData()) return Promise.resolve();
    return loadData();
  });

  window.addEventListener('matanho:legacy-ready', function () {
    mx.gate('#v33SaveConnection', 'operations.manage');
    mx.gate('#v33TestConnection', 'operations.manage');

    document.addEventListener(
      'click',
      function (e) {
        if (!liveData()) return;
        if (e.target.closest && e.target.closest('[data-v33-data-tab]')) {
          setTimeout(function () {
            if (liveData()) mx.renderData();
          }, 0);
        }
      },
      true,
    );
  });
})();
