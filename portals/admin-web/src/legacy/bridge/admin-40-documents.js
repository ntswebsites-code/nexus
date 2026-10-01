/*
 * Admin bridge - document vault. The vault table lists controlled documents
 * from the API; upload, new version, export and the lifecycle (submit →
 * approve → publish) persist through /api/v1/documents.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var V1 = '/api/v1/documents';
  var records = {};

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

  mx.onLoad('documents.view', function () {
    return mx.get(V1).then(function (r) {
      mx.data.documents = r.data.map(vaultRow);
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
      mx.get(V1 + '/' + encodeURIComponent(d.id)).then(function (r) {
        records[d.id] = r.document;
        renderAside(r.document);
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
})();
