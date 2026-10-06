/*
 * Admin bridge - document vault. The vault table lists controlled documents
 * from the API; upload, new version, export and the lifecycle (submit →
 * approve → publish) persist through /api/v1/documents.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var V1 = '/api/v1/documents';
  var CO = '/api/v1/client-ops';
  var records = {};
  var vaultSummary = null;
  var vaultDetail = {};
  window.__mxData = window.__mxData || {};
  if (!window.__mxData._vaultDocs33) window.__mxData._vaultDocs33 = [];

  function vaultLive() {
    return mx.live && mx.strict('vault');
  }

  function vaultRow(d) {
    records[d.id] = d;
    return {
      id: d.id,
      name: d.name,
      type: d.folder,
      related: d.clientId || d.related,
      owner: d.owner,
      updated: d.date,
      version: 'v' + (d.currentVersion || 1),
      access: d.access,
      status: d.status,
      format: d.format,
    };
  }

  function loadVaultDocuments() {
    return mx.get(V1).then(function (r) {
      mx.data.documents = (r.data || []).map(vaultRow);
      syncVaultPrototype(mx.data.documents);
    });
  }

  mx.onLoad('vault', function () {
    return loadVaultDocuments().then(function () {
      if (!vaultLive()) return;
      clearVaultKpis();
      return loadVaultDepth().then(function () {
        patchVaultSummaryTabs();
        setTimeout(function () {
          var page = document.getElementById('page-vault');
          if (!page || page.querySelector('[data-vault-changes]')) return;
          var head = page.querySelector('.page-head .actions, .v33-actions');
          if (head) {
            var b1 = document.createElement('button');
            b1.className = 'btn secondary';
            b1.setAttribute('data-vault-changes', '1');
            b1.textContent = 'Pending changes';
            var b2 = document.createElement('button');
            b2.className = 'btn secondary';
            b2.id = 'v33PmEvidence';
            b2.textContent = 'PM evidence';
            head.appendChild(b1);
            head.appendChild(b2);
          }
        }, 900);
      });
    });
  });

  function current() {
    var d = typeof state !== 'undefined' ? documents[state.currentDocument] : null;
    return d && records[d.id] ? d : null;
  }

  function refreshRow(doc) {
    var list = documents;
    var i = list.findIndex(function (x) {
      return x.id === doc.id;
    });
    var row = vaultRow(doc);
    if (i >= 0) Object.assign(list[i], row);
    else list.unshift(row);
    if (typeof renderDocuments === 'function') renderDocuments();
    return i >= 0 ? i : 0;
  }

  function pickFile() {
    return new Promise(function (resolve) {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pdf,.doc,.docx,.xlsx,.xls,.csv,.txt,.png,.jpg';
      input.onchange = function () {
        resolve(input.files && input.files[0]);
      };
      input.click();
    });
  }

  mx.wrapGlobal('uploadDocument', function (original, args) {
    if (!mx.live) return original.apply(this, args);
    if (!mx.can('documents.edit')) return toast('Permission denied', 'This role has read-only access to the document vault.', 'error');
    return pickFile().then(function (f) {
      if (!f) return;
      var folder = state.currentFolder === 'all' ? 'research' : state.currentFolder;
      var fd = new FormData();
      fd.append('name', f.name.replace(/\.[^.]+$/, ''));
      fd.append('type', folder);
      fd.append('classification', folder === 'clients' ? 'Client' : folder === 'compliance' ? 'Restricted' : 'Internal');
      fd.append('file', f, f.name);
      return mx.post(V1, fd).then(function (r) {
        refreshRow(r.document);
        toast('Document uploaded', r.document.id + ' · ' + f.name + ' added as a controlled draft (encrypted at rest).');
      }, mx.fail);
    });
  });

  function lifecycle(d) {
    var edit = mx.can('documents.edit');
    var b = [];
    if (edit && d.status === 'Draft') b.push(['submit', 'Submit for approval', true]);
    if (edit && d.status === 'In review') b.push(['return', 'Return to maker', false], ['approve', 'Approve (checker)', true]);
    if (edit && (d.status === 'Approved' || d.status === 'Published') && (d.classification === 'Client' || d.classification === 'Public')) b.push(['publish', d.status === 'Published' ? 'Re-publish' : 'Publish to client', true]);
    if (edit && d.status === 'Published') b.push(['withdraw', 'Withdraw', false]);
    return b;
  }

  function renderAside(doc) {
    var aside = document.querySelector('#documentModal .document-preview-layout aside');
    if (!aside) return;
    var list = aside.querySelector('.version-list');
    if (list) {
      list.innerHTML = doc.versions
        .map(function (v, i) {
          return '<button type="button" data-mx-version="' + v.version + '"><b>v' + v.version + '</b><span>' + (i === 0 ? 'Current' : 'Retained') + ' · ' + mx.date(v.at, { day: '2-digit', month: 'short' }) + '</span></button>';
        })
        .join('');
      mx.$$('[data-mx-version]', list).forEach(function (btn) {
        btn.onclick = function () {
          mx.download(V1 + '/' + encodeURIComponent(doc.id) + '/download-url?version=' + btn.getAttribute('data-mx-version')).catch(mx.fail);
        };
      });
    }
    var box = aside.querySelector('.mx-doc-lifecycle');
    if (!box) {
      box = document.createElement('div');
      box.className = 'mx-doc-lifecycle';
      aside.appendChild(box);
    }
    var actions = lifecycle(doc);
    var pubs = doc.publications
      .map(function (p) {
        return '<div class="access-chip"><span>Published · ' + mx.esc(p.client) + '</span></div>';
      })
      .join('');
    box.innerHTML =
      '<hr/><strong>Lifecycle</strong>' + pubs +
      '<div style="display:grid;gap:6px;margin-top:8px">' +
      actions
        .map(function (a) {
          return '<button type="button" class="btn ' + (a[2] ? 'primary' : 'secondary') + '" data-mx-doc="' + a[0] + '">' + a[1] + '</button>';
        })
        .join('') +
      '</div>';
    mx.$$('[data-mx-doc]', box).forEach(function (btn) {
      btn.onclick = function () {
        var action = btn.getAttribute('data-mx-doc');
        var body = { version: doc.version };
        if (action === 'return' || action === 'withdraw') {
          var reason = window.prompt(action === 'return' ? 'Reason for returning to the maker' : 'Reason for withdrawing from the investor portal');
          if (!reason) return;
          body = { reason: reason };
        }
        if (action === 'publish' && !doc.clientId) {
          var ref = window.prompt('Publish to which client? Enter the client reference (e.g. CL-00418)');
          if (!ref) return;
          body = { clientIds: [ref.trim()] };
        }
        btn.disabled = true;
        mx.post(V1 + '/' + encodeURIComponent(doc.id) + '/' + action, body)
          .then(function (r) {
            var idx = refreshRow(r.document);
            toast('Document ' + r.document.status.toLowerCase(), r.document.name);
            openDocument(idx);
          })
          .catch(mx.fail)
          .finally(function () {
            btn.disabled = false;
          });
      };
    });
  }

  mx.wrapGlobal('openDocument', function (original, args) {
    var result = original.apply(this, args);
    var d = documents[args[0]];
    if (mx.live && d && records[d.id]) {
      var load = vaultLive()
        ? mx.get(CO + '/vault/documents/' + encodeURIComponent(d.id))
        : mx.get(V1 + '/' + encodeURIComponent(d.id));
      load.then(function (r) {
        var doc = r.document || r;
        records[d.id] = doc;
        renderAside(doc);
        if (vaultLive()) renderVaultDepth(doc);
      }, mx.fail);
    }
    return result;
  });

  mx.intercept(
    '#docVersion',
    function () {
      var d = current();
      return pickFile().then(function (f) {
        if (!f) return;
        var fd = new FormData();
        fd.append('file', f, f.name);
        return mx.post(V1 + '/' + encodeURIComponent(d.id) + '/versions', fd).then(function (r) {
          var idx = refreshRow(r.document);
          toast('New version created', r.document.name + ' is now v' + r.document.currentVersion + '; prior versions are retained.');
          openDocument(idx);
        });
      });
    },
    { when: function () {
      return mx.live && !!current();
    } },
  );

  mx.intercept(
    '#downloadDocument',
    function () {
      var d = current();
      return mx.download(V1 + '/' + encodeURIComponent(d.id) + '/download-url');
    },
    { when: function () {
      var d = mx.live && current();
      return !!d && records[d.id].currentVersion > 0;
    } },
  );

  // ------------------------------------------------------------ W7: vault depth (holds, retention, changes, access log, PM evidence)

  function mapVaultDocRow(d) {
    return [d.name, d.clientRef || d.client || '—', d.owner || '—', mx.date(d.date, { day: '2-digit', month: 'short', year: 'numeric' }), d.classification, d.status, d.type];
  }

  function syncVaultPrototype(docs) {
    window.__mxData = window.__mxData || {};
    if (!window.__mxData._vaultDocs33) window.__mxData._vaultDocs33 = [];
    mx.replace(window.__mxData._vaultDocs33, docs.map(mapVaultDocRow));
    if (typeof renderDocs === 'function') renderDocs();
  }

  function loadVaultDepth() {
    return Promise.all([
      mx.get(CO + '/vault/summary').then(function (r) {
        vaultSummary = r;
        mx.data.vaultSummary = r;
      }),
      mx.get(CO + '/vault/documents').then(function (r) {
        var rows = r.data || [];
        mx.data.vaultRegister = rows;
        syncVaultPrototype(rows);
      }),
    ]);
  }

  function clearVaultKpis() {
    document.querySelectorAll('#page-vault .v33-kpis article strong, #page-vault .stat-grid .stat-card strong').forEach(function (el) {
      el.textContent = '—';
      el.className = '';
    });
    document.querySelectorAll('#page-vault .v33-kpis article small').forEach(function (el) {
      el.textContent = 'Loading…';
    });
  }

  function patchVaultSummaryTabs() {
    if (!vaultSummary) return;
    var s = vaultSummary;
    var host = document.querySelector('#page-vault .stat-grid, #page-vault .folder-stats');
    if (host) {
      var stats = host.querySelectorAll('.stat-card, article');
      if (stats[0]) stats[0].querySelector('strong, b').textContent = String(s.total || 0);
      if (stats[1]) stats[1].querySelector('strong, b').textContent = String(s.held || 0);
      if (stats[2]) stats[2].querySelector('strong, b').textContent = String(s.pendingChanges || 0);
    }
    var kpis = document.querySelectorAll('#page-vault .v33-kpis article');
    if (kpis[0]) kpis[0].querySelector('strong').textContent = String(s.total || 0);
    if (kpis[1]) kpis[1].querySelector('strong').textContent = String(s.held || 0);
    if (kpis[2]) kpis[2].querySelector('strong').textContent = String(s.pendingChanges || 0);
    if (kpis[3]) {
      var restricted = (s.byClassification && (s.byClassification.Restricted || s.byClassification.RESTRICTED)) || 0;
      kpis[3].querySelector('strong').textContent = String(restricted);
    }
    if (kpis[4]) kpis[4].querySelector('strong').textContent = String(s.accessLast7Days || 0);
    if (kpis[5]) {
      var review = (s.retention && (s.retention.REVIEW || s.retention.review)) || 0;
      kpis[5].querySelector('strong').textContent = String(review);
      kpis[5].querySelector('small').textContent = 'Retention state review';
    }
    var pendingBtn = document.querySelector('[data-vault-changes]');
    if (pendingBtn) pendingBtn.textContent = s.pendingChanges ? 'Pending changes (' + s.pendingChanges + ')' : 'Pending changes';
  }

  function renderVaultDepth(doc) {
    vaultDetail[doc.id] = doc;
    var aside = document.querySelector('#documentModal .document-preview-layout aside');
    if (!aside) return;
    var box = aside.querySelector('.mx-vault-depth');
    if (!box) {
      box = document.createElement('div');
      box.className = 'mx-vault-depth';
      aside.appendChild(box);
    }
    var holds = (doc.holds || []).filter(function (h) {
      return !h.releasedAt;
    });
    box.innerHTML =
      '<hr/><strong>Vault controls</strong>' +
      '<div class="access-chip"><span>Retention · ' +
      mx.esc(doc.retention || '—') +
      '</span></div>' +
      (holds.length ? holds.map(function (h) {
        return '<div class="access-chip"><span>Hold · ' + mx.esc(h.reason || '') + '</span></div>';
      }).join('') : '') +
      (mx.can('documents.edit')
        ? '<div style="display:grid;gap:6px;margin-top:8px">' +
          '<button type="button" class="btn secondary" data-mx-vhold="' +
          doc.id +
          '">Place legal hold</button>' +
          (holds[0] ? '<button type="button" class="btn secondary" data-mx-vrelease="' + holds[0].id + '">Release hold</button>' : '') +
          '<button type="button" class="btn secondary" data-mx-vchange="' +
          doc.id +
          '">Propose classification change</button>' +
          '<button type="button" class="btn secondary" data-mx-vlink="' +
          doc.id +
          '">Link client / fund</button>' +
          '<button type="button" class="btn secondary" data-mx-vaccess="' +
          doc.id +
          '">Access log</button>' +
          '</div>'
        : '');
    var holdBtn = box.querySelector('[data-mx-vhold]');
    if (holdBtn) {
      holdBtn.onclick = function () {
        var reason = window.prompt('Reason for legal hold:');
        if (!reason || reason.trim().length < 5) return;
        mx.post(CO + '/vault/documents/' + encodeURIComponent(doc.id) + '/hold', { reason: reason.trim() }).then(function () {
          mx.toast('Legal hold placed', doc.name);
          return refreshVaultDoc(doc.id);
        }, mx.fail);
      };
    }
    var rel = box.querySelector('[data-mx-vrelease]');
    if (rel) {
      rel.onclick = function () {
        var note = window.prompt('Release note (checker / step-up may apply):');
        if (!note) return;
        mx.post(CO + '/vault/holds/' + encodeURIComponent(rel.getAttribute('data-mx-vrelease')) + '/release', { note: note }).then(function () {
          mx.toast('Hold released', doc.name);
          return refreshVaultDoc(doc.id);
        }, mx.fail);
      };
    }
    var ch = box.querySelector('[data-mx-vchange]');
    if (ch) {
      ch.onclick = function () {
        var to = window.prompt('New classification (Internal / Restricted / Client / Public):', doc.classification || 'Internal');
        if (!to) return;
        var reason = window.prompt('Reason for change:') || '';
        mx.post(CO + '/vault/documents/' + encodeURIComponent(doc.id) + '/changes', { kind: 'CLASSIFICATION', to: to, reason: reason }).then(function () {
          mx.toast('Change proposed', 'Awaiting checker approval.');
        }, mx.fail);
      };
    }
    var lk = box.querySelector('[data-mx-vlink]');
    if (lk) {
      lk.onclick = function () {
        var clientId = window.prompt('Client reference (e.g. CL-00418) or leave blank:');
        var fundId = window.prompt('Fund reference or leave blank:');
        mx.post(CO + '/vault/documents/' + encodeURIComponent(doc.id) + '/link', {
          clientId: clientId ? clientId.trim() : null,
          fundId: fundId ? fundId.trim() : null,
        }).then(function () {
          mx.toast('Links updated', doc.name);
        }, mx.fail);
      };
    }
    var ac = box.querySelector('[data-mx-vaccess]');
    if (ac) {
      ac.onclick = function () {
        mx.get(CO + '/vault/documents/' + encodeURIComponent(doc.id)).then(function (r) {
          var log = (r.accessLog || r.log || []).slice(0, 12);
          mx.modal({
            eyebrow: 'VAULT · ACCESS LOG',
            title: doc.name,
            body:
              '<div class="v34-list">' +
              log
                .map(function (e) {
                  return '<div class="v34-row"><span><strong>' + mx.esc(e.action || e.by) + '</strong><small>' + mx.esc(e.at || '') + '</small></span><em>' + mx.esc(e.ip || '') + '</em></div>';
                })
                .join('') +
              '</div>',
            actions: [],
          });
        }, mx.fail);
      };
    }
  }

  function refreshVaultDoc(id) {
    return mx.get(CO + '/vault/documents/' + encodeURIComponent(id)).then(function (r) {
      renderVaultDepth(r);
      if (records[id]) Object.assign(records[id], r);
      return r;
    });
  }

  mx.intercept(
    '#v33DocRetention',
    function () {
      return mx.get(CO + '/vault/retention-schedules').then(function (r) {
        var rows = (r.data || [])
          .map(function (s) {
            return '<div class="v34-row"><span><strong>' + mx.esc(s.name || s.id) + '</strong></span><em>' + mx.esc(String(s.retentionYears || '') + 'y') + '</em></div>';
          })
          .join('');
        mx.modal({
          eyebrow: 'VAULT · RETENTION',
          title: 'Retention schedules',
          body: '<div class="v34-list">' + rows + '</div><p class="v34-help">Apply schedules to enforce disposal dates (dry-run available in ops-native).</p>',
          actions: mx.can('documents.edit')
            ? [
                {
                  label: 'Apply schedules',
                  primary: true,
                  run: function () {
                    return mx.post(CO + '/vault/retention-schedules/apply', { dryRun: false }).then(function (res) {
                      mx.toast('Retention applied', (res.updated || 0) + ' documents updated.');
                      return loadVaultDepth();
                    });
                  },
                },
              ]
            : [],
        });
      });
    },
    { when: vaultLive },
  );

  mx.intercept(
    '#v33VaultChanges, [data-vault-changes]',
    function () {
      return mx.get(CO + '/vault/changes', { status: 'PENDING' }).then(function (r) {
        var rows = r.data || [];
        mx.modal({
          eyebrow: 'VAULT · CHANGES',
          title: 'Pending document changes',
          wide: true,
          body:
            '<div class="v34-list">' +
            rows
              .map(function (c) {
                return (
                  '<div class="v34-row"><span><strong>' +
                  mx.esc(c.kind) +
                  '</strong><small>' +
                  mx.esc(c.documentName || c.documentId) +
                  '</small></span><em>' +
                  (mx.can('documents.edit')
                    ? '<button type="button" class="v34-btn small" data-mx-vc-approve="' +
                      c.id +
                      '">Approve</button> <button type="button" class="v34-btn small" data-mx-vc-reject="' +
                      c.id +
                      '">Reject</button>'
                    : '') +
                  '</em></div>'
                );
              })
              .join('') +
            '</div>',
          actions: [],
        });
        mx.$$('[data-mx-vc-approve]').forEach(function (b) {
          b.onclick = function () {
            var note = window.prompt('Approval note:') || '';
            mx.post(CO + '/vault/changes/' + b.getAttribute('data-mx-vc-approve') + '/approve', { note: note }).then(function () {
              mx.toast('Change approved', 'Applied to document.');
            }, mx.fail);
          };
        });
        mx.$$('[data-mx-vc-reject]').forEach(function (b) {
          b.onclick = function () {
            var note = window.prompt('Rejection reason:') || '';
            if (!note.trim()) return;
            mx.post(CO + '/vault/changes/' + b.getAttribute('data-mx-vc-reject') + '/reject', { note: note.trim() }).then(function () {
              mx.toast('Change rejected', 'Maker notified.');
            }, mx.fail);
          };
        });
      });
    },
    { when: vaultLive },
  );

  function openPmEvidenceModal() {
    return mx.get(CO + '/vault/pm-evidence').then(function (r) {
      var rows = r.data || [];
      mx.modal({
        eyebrow: 'VAULT · PM EVIDENCE',
        title: 'Private markets valuation evidence',
        subtitle: rows.length + ' mark evidence row(s)',
        wide: true,
        body:
          '<div class="v34-list">' +
          (rows.length
            ? rows
                .map(function (e) {
                  var doc = e.document;
                  return (
                    '<div class="v34-row"><span><strong>' +
                    mx.esc(e.title || e.id) +
                    '</strong><small>' +
                    mx.esc(e.fund || '') +
                    ' · ' +
                    mx.esc(e.mark || '') +
                    (doc && doc.name ? ' · ' + mx.esc(doc.name) : ' · no file') +
                    '</small></span><em>' +
                    mx.esc(e.markStatus || '') +
                    (mx.can('documents.edit')
                      ? ' <button type="button" class="v34-btn small" data-mx-pm-upload="' +
                        mx.esc(e.id) +
                        '">' +
                        (doc && doc.name ? 'Replace file' : 'Upload file') +
                        '</button>'
                      : '') +
                    '</em></div>'
                  );
                })
                .join('')
            : '<p class="ops-muted">No valuation evidence rows yet.</p>') +
          '</div>',
        actions: [{ label: 'Close', run: function () {} }],
      });
      mx.$$('[data-mx-pm-upload]').forEach(function (b) {
        b.onclick = function () {
          var id = b.getAttribute('data-mx-pm-upload');
          return pickFile().then(function (f) {
            if (!f) return;
            var fd = new FormData();
            fd.append('file', f, f.name);
            return mx.post(CO + '/vault/pm-evidence/' + encodeURIComponent(id) + '/file', fd).then(function () {
              mx.toast('Evidence file attached', f.name);
              return openPmEvidenceModal();
            }, mx.fail);
          });
        };
      });
    });
  }

  mx.openPmEvidenceModal = openPmEvidenceModal;

  mx.hydrate('vault', function () {
    if (!vaultLive()) return Promise.resolve();
    clearVaultKpis();
    return loadVaultDepth().then(function () {
      patchVaultSummaryTabs();
    });
  });

  mx.intercept(
    '#v33PmEvidence, [data-vault-pm-evidence]',
    function () {
      return openPmEvidenceModal();
    },
    { when: vaultLive },
  );
})();
