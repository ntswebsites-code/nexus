/*
 * Admin bridge - Investor Services workbench (V34 page). Builds the work queue
 * from live service requests, capital notices, documents awaiting approval or
 * signature, and unread secure messages; each task opens an action dialog that
 * calls the API (maker-checker is enforced server-side).
 */
(function () {
  'use strict';
  var mx = window.mx;
  var V1 = '/api/v1';
  var esc = function (v) {
    return mx.esc(v);
  };
  var raw = { requests: [], capital: [], docs: [], threads: [], clients: [] };

  function amount(c) {
    return (c.ccy || 'USD') + ' ' + Number(c.amount || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  function slaText(r) {
    if (!r.slaDueAt) return r.opened;
    var h = Math.round((new Date(r.slaDueAt).getTime() - Date.now()) / 3600000);
    return h < 0 ? 'SLA breached' : h < 24 ? 'SLA ' + h + 'h' : 'SLA ' + Math.round(h / 24) + 'd';
  }

  function buildTasks() {
    var t = [];
    raw.requests
      .filter(function (r) {
        return r.status !== 'Closed';
      })
      .forEach(function (r) {
        t.push({
          id: r.id,
          kind: 'Request',
          title: r.client + ' · ' + r.title,
          detail: r.type + ' · ' + r.status + (r.priority === 'Time sensitive' ? ' · time sensitive' : ''),
          due: slaText(r),
          owner: r.owner,
          severity: r.breached ? 'critical' : r.status === 'Waiting on you' ? 'good' : 'warn',
          _t: 'request',
          _r: r,
        });
      });
    raw.capital.forEach(function (c) {
      var map = {
        Draft: ['Approve ' + c.type.toLowerCase() + ' · ' + c.id, 'warn'],
        Approved: ['Publish notice · ' + c.id, 'warn'],
        Processing: ['Match funding evidence · ' + c.id, 'critical'],
        Due: ['Awaiting investor funding · ' + c.id, 'good'],
        Expected: [(c.type === 'Distribution' || c.type === 'Withdrawal' ? 'Release payment · ' : 'Expected receipt · ') + c.id, 'warn'],
      }[c.status];
      if (!map) return;
      t.push({ id: c.id, kind: 'Money', title: map[0], detail: c.client + ' · ' + c.investment + ' · ' + amount(c), due: c.due, owner: 'Investor Ops', severity: map[1], _t: 'capital', _r: c });
    });
    raw.docs.forEach(function (d) {
      if (d.status === 'In review') {
        t.push({ id: d.id, kind: 'Publication', title: 'Approve ' + d.name, detail: d.label + ' · ' + (d.client || d.related) + ' · v' + d.currentVersion, due: d.date, owner: d.owner, severity: 'warn', _t: 'document', _r: d });
      } else if (d.status === 'Approved' && (d.classification === 'Client' || d.classification === 'Public') && !d.publications.length) {
        t.push({ id: d.id, kind: 'Publication', title: 'Publish ' + d.name, detail: d.label + ' · ' + (d.client || d.related) + ' · approved', due: d.date, owner: d.owner, severity: 'warn', _t: 'document', _r: d });
      }
      d.signatures
        .filter(function (s) {
          return s.status === 'Pending';
        })
        .forEach(function (s) {
          t.push({ id: d.id + ':' + s.clientId, kind: 'Signature', title: 'Awaiting signature · ' + d.name, detail: (s.clientId || '') + ' · authorised signatory required', due: d.date, owner: d.owner, severity: 'warn', _t: 'document', _r: d });
        });
    });
    raw.threads
      .filter(function (th) {
        return th.unread > 0;
      })
      .forEach(function (th) {
        t.push({ id: th.id, kind: 'Request', title: 'Reply to ' + th.client + ' · ' + th.title, detail: 'Secure portal message · ' + th.unread + ' unread', due: th.last, owner: th.owner, severity: 'warn', _t: 'thread', _r: th });
      });
    return t;
  }

  function buildRelationships() {
    return raw.clients.map(function (c) {
      var open = raw.requests.filter(function (r) {
        return r.clientId === c.id && r.status !== 'Closed';
      });
      return {
        id: c.id,
        name: c.name,
        type: c.type,
        value: c.value,
        commitment: '—',
        unfunded: '—',
        portal: c.portalEnabled ? 'Active' : 'Not invited',
        owner: c.owner,
        next: open[0] ? open[0].title : c.kyc === 'Current' ? 'No open requests' : 'KYC ' + c.kyc.toLowerCase(),
        due: open[0] ? slaText(open[0]) : '—',
        tone: 'blue',
      };
    });
  }

  function fetchAll() {
    return Promise.all([
      mx.get(V1 + '/service-requests').then(function (r) {
        raw.requests = r.data;
      }),
      mx.get(V1 + '/capital-events').then(function (r) {
        raw.capital = r.data;
      }),
      mx.can('documents.view')
        ? mx.get(V1 + '/documents').then(function (r) {
            raw.docs = r.data;
          })
        : null,
      mx.get(V1 + '/message-threads').then(function (r) {
        raw.threads = r.data;
      }),
      mx.get(V1 + '/clients').then(function (r) {
        raw.clients = r.data;
      }),
    ]);
  }

  mx.onLoad('clients.view', function () {
    return fetchAll().then(function () {
      mx.data.serviceTasks = buildTasks();
      mx.data.serviceRelationships = buildRelationships();
    });
  });

  /** Reload and re-render the V34 lists in place (its render functions are private; the filter buttons call them). */
  mx.refreshServices = function () {
    return fetchAll().then(function () {
      if (mx.data.serviceTasks) mx.replace(mx.data.serviceTasks, buildTasks());
      if (mx.data.serviceRelationships) mx.replace(mx.data.serviceRelationships, buildRelationships());
      var active = document.querySelector('#page-investor-services [data-sf].active');
      if (active) active.click();
    });
  };

  function row(label, detail, value) {
    return '<div class="v34-row"><span><strong>' + esc(label) + '</strong><small>' + esc(detail || '') + '</small></span><em>' + esc(value || '') + '</em></div>';
  }
  function field(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  }

  // ------------------------------------------------------------ task dialogs

  function openRequest(r) {
    if (coLive()) return openRequestCo(r);
    var states = ['Open', 'In progress', 'Waiting on you', 'Closed'];
    mx.modal({
      eyebrow: 'INVESTOR SERVICES · REQUEST',
      title: esc(r.id + ' · ' + r.title),
      subtitle: esc(r.client + ' · opened ' + r.opened + ' · ' + slaText(r)),
      body:
        '<div class="v34-list">' + row('Client request', r.detail, r.type) +
        r.timeline
          .map(function (e) {
            return row(e[1], e[2], e[0]);
          })
          .join('') +
        '</div><div class="v34-form" style="margin-top:12px">' +
        '<label class="v34-field"><span>Owner</span><input class="v34-input" id="mxReqOwner" value="' + esc(r.owner === 'Unassigned' ? mx.user.name || '' : r.owner) + '"></label>' +
        '<label class="v34-field"><span>State</span><select class="v34-select" id="mxReqStatus">' +
        states
          .map(function (s) {
            return '<option' + (s === r.status ? ' selected' : '') + '>' + s + '</option>';
          })
          .join('') +
        '</select></label>' +
        '<label class="v34-field"><span>Progress %</span><input class="v34-input" type="number" min="0" max="100" id="mxReqProgress" value="' + r.progress + '"></label>' +
        '<label class="v34-field v34-wide"><span>Update visible to the client</span><textarea class="v34-textarea" id="mxReqNote"></textarea></label></div>',
      actions: mx.can('clients.edit')
        ? [
            {
              label: 'Save update',
              primary: true,
              run: function () {
                return mx
                  .patch(V1 + '/service-requests/' + encodeURIComponent(r.id), {
                    owner: field('mxReqOwner'),
                    status: field('mxReqStatus'),
                    progress: Number(field('mxReqProgress')),
                    note: field('mxReqNote') || undefined,
                    version: r.version,
                  })
                  .then(function () {
                    mx.toast('Request updated', r.id + ' · the client has been notified.');
                    return mx.refreshServices();
                  });
              },
            },
          ]
        : [],
    });
  }

  function openCapital(c) {
    var actions = [];
    var post = function (action, msg) {
      return function () {
        return mx.post(V1 + '/capital-events/' + encodeURIComponent(c.id) + '/' + action, { version: c.version }).then(function () {
          mx.toast(msg, c.id + ' · ' + c.client);
          return mx.refreshServices();
        });
      };
    };
    if (c.status === 'Draft' && mx.can('cash.approve')) actions.push({ label: 'Approve (checker)', primary: true, run: post('approve', 'Notice approved') });
    if (c.status === 'Approved' && (mx.can('clients.edit') || mx.can('cash.approve'))) actions.push({ label: 'Publish to investor', primary: true, run: post('publish', 'Notice published') });
    if (['Processing', 'Due', 'Expected'].indexOf(c.status) >= 0 && (mx.can('cash.approve') || mx.can('cash.journal.approve'))) {
      var incoming = c.type === 'Capital call' || c.type === 'Contribution';
      actions.push({ label: incoming ? 'Match receipt · mark funded' : 'Confirm payment · mark paid', primary: true, run: post('settle', incoming ? 'Receipt matched' : 'Payment confirmed') });
    }
    (c.evidenceFiles || []).slice(0, 1).forEach(function (e) {
      actions.unshift({
        label: 'Open proof of payment',
        run: function () {
          return mx.download(V1 + '/capital-events/' + encodeURIComponent(c.id) + '/evidence/' + e.id + '/download-url').then(function () {
            return false;
          });
        },
      });
    });
    mx.modal({
      eyebrow: 'PRIVATE CAPITAL · ' + esc(c.type.toUpperCase()),
      title: esc(c.id + ' · ' + c.investment),
      subtitle: esc(c.client + ' · ' + c.status + ' · due ' + c.due),
      body:
        '<div class="v34-list">' + row('Amount', c.purpose, amount(c)) + row('Status', c.evidence, c.status) + row('Payment / receipt', c.bank, c.published ? 'Published' : 'Not published') +
        (c.breakdown || [])
          .map(function (b) {
            return row(b[0], '', (c.ccy || 'USD') + ' ' + Number(b[1]).toLocaleString('en-US'));
          })
          .join('') +
        '</div><div class="v34-help" style="margin-top:10px">Maker-checker: the approver must differ from the preparer, and cash matching must be done by someone other than the investor who uploaded evidence.</div>',
      actions: actions,
    });
  }

  function openDocument(d) {
    var actions = [];
    var edit = mx.can('documents.edit');
    var go = function (action, body, msg) {
      return function () {
        return mx.post(V1 + '/documents/' + encodeURIComponent(d.id) + '/' + action, body()).then(function () {
          mx.toast(msg, d.name);
          return mx.refreshServices();
        });
      };
    };
    if (d.currentVersion) {
      actions.push({
        label: 'Open v' + d.currentVersion,
        run: function () {
          return mx.download(V1 + '/documents/' + encodeURIComponent(d.id) + '/download-url').then(function () {
            return false;
          });
        },
      });
    }
    if (edit && d.status === 'In review') {
      actions.push({
        label: 'Return to maker',
        run: go('return', function () {
          return { reason: field('mxDocReason') || 'Returned for changes' };
        }, 'Returned to maker'),
      });
      actions.push({ label: 'Approve (checker)', primary: true, run: go('approve', function () {
        return { version: d.version };
      }, 'Document approved') });
    }
    if (edit && (d.status === 'Approved' || d.status === 'Published') && (d.classification === 'Client' || d.classification === 'Public')) {
      actions.push({ label: 'Publish to client', primary: true, run: go('publish', function () {
        var sel = field('mxDocClient');
        return { clientIds: sel ? [sel] : undefined };
      }, 'Published to investor portal') });
    }
    var clientOptions = raw.clients
      .map(function (c) {
        return '<option value="' + esc(c.id) + '"' + (c.id === d.clientId ? ' selected' : '') + '>' + esc(c.name + ' · ' + c.id) + '</option>';
      })
      .join('');
    mx.modal({
      eyebrow: 'DOCUMENT CONTROL · ' + esc(d.status.toUpperCase()),
      title: esc(d.name),
      subtitle: esc(d.id + ' · ' + d.label + ' · v' + d.currentVersion + ' · ' + d.size),
      body:
        '<div class="v34-list">' + row('Classification', d.access, d.classification) + row('Related record', d.client || d.related, d.clientId || '') + row('Owner', 'Maker', d.owner) +
        d.publications
          .map(function (p) {
            return row('Published to ' + p.client, new Date(p.publishedAt).toLocaleString('en-GB'), 'Live');
          })
          .join('') +
        d.signatures
          .map(function (s) {
            return row('Signature · ' + (s.clientId || ''), s.signedBy.map(function (x) {
              return x.name + ' (' + x.authority + ')';
            }).join(', ') || 'Awaiting authorised signatory', s.status);
          })
          .join('') +
        '</div><div class="v34-form" style="margin-top:12px">' +
        (edit && (d.status === 'Approved' || d.status === 'Published') ? '<label class="v34-field v34-wide"><span>Publish to client</span><select class="v34-select" id="mxDocClient">' + clientOptions + '</select></label>' : '') +
        (edit && d.status === 'In review' ? '<label class="v34-field v34-wide"><span>Return reason (if returning)</span><textarea class="v34-textarea" id="mxDocReason"></textarea></label>' : '') +
        '</div>',
      actions: actions,
    });
  }

  function openThread(th) {
    mx.post(V1 + '/message-threads/' + th.id + '/read').catch(function () {});
    mx.modal({
      eyebrow: 'SECURE MESSAGE · ' + esc(th.client),
      title: esc(th.title),
      subtitle: esc(th.owner + ' · ' + th.last),
      body:
        '<div class="v34-list">' +
        th.messages
          .map(function (m) {
            return row(m.who === 'me' ? 'Matanho · ' + m.author : th.client + ' · ' + m.author, m.text, m.time);
          })
          .join('') +
        '</div><div class="v34-form" style="margin-top:12px"><label class="v34-field v34-wide"><span>Reply</span><textarea class="v34-textarea" id="mxThreadReply"></textarea></label></div>',
      actions: mx.can('clients.edit')
        ? [
            {
              label: 'Send secure reply',
              primary: true,
              run: function () {
                var text = field('mxThreadReply');
                if (!text) {
                  mx.toast('Reply required', 'Write a message first.', 'warn');
                  return false;
                }
                return mx.post(V1 + '/message-threads/' + th.id + '/messages', { text: text }).then(function () {
                  mx.toast('Reply sent', th.client + ' has been notified.');
                  return mx.refreshServices();
                });
              },
            },
          ]
        : [],
    });
  }

  var OPEN = { request: openRequest, capital: openCapital, document: openDocument, thread: openThread };

  mx.intercept(
    '[data-service-task]',
    function (el) {
      var id = el.getAttribute('data-service-task');
      var task = (mx.data.serviceTasks || []).find(function (t) {
        return t.id === id;
      });
      if (task && OPEN[task._t]) OPEN[task._t](task._r);
    },
    { when: function () {
      return mx.live && !!mx.data.serviceTasks;
    } },
  );

  // ------------------------------------------------------------ V34 create forms

  mx.intercept(
    '#v34SaveRequest',
    function () {
      var m = document.getElementById('v34Modal');
      var selects = m.querySelectorAll('select.v34-select');
      var name = selects[0] ? selects[0].value : '';
      var client = raw.clients.find(function (c) {
        return c.name === name;
      });
      if (!client) throw new Error('Choose an investor that exists in the client master');
      var detail = (m.querySelector('textarea') || {}).value || '';
      if (!detail.trim()) throw new Error('Add the request details');
      var due = (m.querySelector('input[type="datetime-local"]') || {}).value;
      return mx
        .post(V1 + '/service-requests', { clientId: client.id, type: selects[1].value, priority: selects[2].value, detail: detail.trim(), due: due || undefined })
        .then(function (r) {
          m.querySelector('.v34-modal-close').click();
          mx.toast('Service request created', r.request.id + ' · SLA started');
          return mx.refreshServices();
        });
    },
    { when: function () {
      return mx.live;
    } },
  );

  var EVENT_TYPE = { 'Capital call': 'Capital call', Distribution: 'Distribution', Subscription: 'Contribution', Redemption: 'Withdrawal' };
  mx.intercept(
    '#v34Modal .v34-modal-foot .v34-btn.primary',
    function () {
      var m = document.getElementById('v34Modal');
      var s = m.querySelectorAll('select.v34-select');
      var dates = m.querySelectorAll('input[type="date"]');
      var amt = Number((m.querySelector('input[type="number"]') || {}).value || 0);
      if (!(amt > 0)) throw new Error('Enter the gross amount');
      return mx
        .post(V1 + '/capital-events/allocate', {
          investment: s[0].value,
          type: EVENT_TYPE[s[1].value] || s[1].value,
          currency: s[2].value,
          amount: amt,
          due: dates[1] ? dates[1].value : dates[0].value,
          purpose: ((m.querySelector('textarea') || {}).value || '').trim() || undefined,
        })
        .then(function (r) {
          m.querySelector('.v34-modal-close').click();
          mx.toast('Capital event drafted', r.investors + ' investor notices await checker approval (' + r.refs.join(', ') + ').');
          return mx.refreshServices();
        });
    },
    {
      when: function (el) {
        if (!mx.live || el.hasAttribute('data-mx-action')) return false;
        var k = document.querySelector('#v34Modal .v34-kicker');
        return !!k && /CONTROLLED EVENT/.test(k.textContent);
      },
    },
  );

  // ------------------------------------------------------------ W7: client-ops depth, SLA policy, summary tiles

  var CO = '/api/v1/client-ops';
  var serviceSummary = null;
  var slaPolicies = [];

  function coLive() {
    return mx.live && mx.can('clients.view');
  }

  function openRequestCo(r) {
    var states = ['Open', 'In progress', 'Waiting on you', 'Closed'];
    mx.modal({
      eyebrow: 'INVESTOR SERVICES · REQUEST',
      title: esc(r.id + ' · ' + (r.title || r.client)),
      subtitle: esc(r.client + ' · ' + slaText(r)),
      body:
        '<div class="v34-list">' +
        row('Detail', r.detail || '', r.type) +
        '</div><div class="v34-form" style="margin-top:12px">' +
        '<label class="v34-field"><span>State</span><select class="v34-select" id="mxReqStatus">' +
        states
          .map(function (s) {
            return '<option' + (s === r.status ? ' selected' : '') + '>' + s + '</option>';
          })
          .join('') +
        '</select></label>' +
        '<label class="v34-field v34-wide"><span>Update visible to the client</span><textarea class="v34-textarea" id="mxReqNote"></textarea></label>' +
        '<label class="v34-field"><span>SLA due</span><input class="v34-input" type="datetime-local" id="mxReqSla"></label>' +
        '</div>',
      actions: mx.can('clients.edit')
        ? [
            {
              label: 'Save update',
              primary: true,
              run: function () {
                var note = field('mxReqNote');
                var status = field('mxReqStatus');
                return coRequestWrite(r, { status: status, note: note || undefined, notifyClient: !!note }, 'status').then(function () {
                  if (note) return coRequestWrite(r, { note: note }, 'note');
                }).then(function () {
                  var sla = field('mxReqSla');
                  if (sla) return coRequestWrite(r, { dueAt: new Date(sla).toISOString(), reason: note || 'Manual SLA reset' }, 'sla');
                });
              },
            },
          ]
        : [],
    });
  }

  function patchServiceKpis() {
    var host = document.querySelector('#page-investor-services .v34-kpis');
    if (!host || !serviceSummary) return;
    var s = serviceSummary;
    var tiles = host.querySelectorAll('.v34-kpi');
    if (tiles[0]) {
      tiles[0].querySelector('strong').textContent = String(s.open || 0);
      var sm = tiles[0].querySelector('small');
      if (sm) sm.textContent = (s.breached || 0) + ' breached · ' + (s.atRisk || 0) + ' at risk';
    }
    if (tiles[4]) {
      tiles[4].querySelector('strong').textContent = String(s.open || 0);
      var pct = s.slaMetPct != null ? s.slaMetPct + '% within SLA' : 'SLA tracked';
      tiles[4].querySelector('small').textContent = pct;
    }
    if (tiles[5]) {
      tiles[5].querySelector('strong').textContent = String((s.breached || 0) + (s.atRisk || 0));
      tiles[5].querySelector('small').textContent = (s.unassigned || 0) + ' unassigned';
    }
  }

  function loadServiceDepth() {
    return Promise.all([
      mx.get(CO + '/services/summary').then(function (r) {
        serviceSummary = r;
        mx.data.serviceSummary = r;
        patchServiceKpis();
      }),
      mx.get(CO + '/services/sla-policies').then(function (r) {
        slaPolicies = r.data || [];
      }),
    ]);
  }

  var priorRefresh = mx.refreshServices;
  mx.refreshServices = function () {
    return (priorRefresh ? priorRefresh() : fetchAll()).then(function () {
      return loadServiceDepth();
    });
  };

  mx.onLoad('clients.view', function () {
    if (!coLive()) return;
    return loadServiceDepth().then(function () {
      var page = document.getElementById('page-investor-services');
      if (!page || page.querySelector('#v34SlaPolicy')) return;
      var actions = page.querySelector('.v33-actions');
      if (actions) {
        var b = document.createElement('button');
        b.className = 'v33-btn';
        b.id = 'v34SlaPolicy';
        b.textContent = 'SLA policies';
        b.onclick = function () {
          mx.openSlaPolicyEditor();
        };
        actions.insertBefore(b, actions.firstChild);
      }
    });
  });

  mx.openSlaPolicyEditor = function () {
    var rows = slaPolicies
      .map(function (p) {
        return (
          '<div class="v34-row"><span><strong>' +
          esc(p.requestType) +
          '</strong><small>' +
          esc(p.priority) +
          '</small></span><em>' +
          esc(p.targetHours + 'h') +
          '</em></div>'
        );
      })
      .join('');
    mx.modal({
      eyebrow: 'INVESTOR SERVICES · SLA',
      title: 'SLA policy editor',
      subtitle: 'Target hours by request type and priority',
      body:
        '<div class="v34-list">' +
        (rows || '<div class="v34-help">No policies loaded.</div>') +
        '</div><div class="v34-form" style="margin-top:12px"><label class="v34-field"><span>Request type</span><input class="v34-input" id="mxSlaType" placeholder="Statement / reporting"></label><label class="v34-field"><span>Priority</span><select class="v34-select" id="mxSlaPri"><option>Normal</option><option>High</option><option>Urgent</option></select></label><label class="v34-field"><span>Target hours</span><input class="v34-input" type="number" id="mxSlaHours" min="1" value="24"></label></div>',
      actions: mx.can('clients.edit')
        ? [
            {
              label: 'Save policy',
              primary: true,
              run: function () {
                return mx
                  .put(CO + '/services/sla-policies', {
                    requestType: field('mxSlaType'),
                    priority: field('mxSlaPri'),
                    targetHours: Number(field('mxSlaHours')),
                  })
                  .then(function () {
                    mx.toast('SLA policy saved', field('mxSlaType'));
                    return mx.get(CO + '/services/sla-policies').then(function (r) {
                      slaPolicies = r.data || [];
                    });
                  });
              },
            },
          ]
        : [],
    });
  };

  function coRequestWrite(r, body, path) {
    return mx.post(CO + '/services/requests/' + encodeURIComponent(r.id) + '/' + path, body).then(function () {
      mx.toast('Request updated', r.id);
      return mx.refreshServices();
    });
  }
})();
