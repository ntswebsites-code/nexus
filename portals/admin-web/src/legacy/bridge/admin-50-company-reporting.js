/*
 * Admin bridge - portfolio-company reporting review (SRD 8.1 / 8.4).
 * V48 removed the V16 private-markets hub, so this adds a live entry card in
 * the same V16 hub styling. It opens the standard detail drawer with the review
 * queue, company status, pack detail (accept / return), questions and covenants.
 */
(function () {
  'use strict';
  var mx = window.mx;
  var V1 = '/api/v1/private-markets';
  var queue = [];
  var companies = [];

  function statusChip(s) {
    var tone = s === 'accepted' ? ' good' : s === 'returned' || s === 'overdue' ? ' warn' : '';
    return '<span class="v16-status' + tone + '">' + mx.esc(s.charAt(0).toUpperCase() + s.slice(1)) + '</span>';
  }

  function table(headers, rows) {
    return (
      '<div style="overflow:auto"><table class="v16-table"><thead><tr>' +
      headers.map(function (h) { return '<th>' + h + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      (rows.length
        ? rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('')
        : '<tr><td colspan="' + headers.length + '">Nothing waiting.</td></tr>') +
      '</tbody></table></div>'
    );
  }

  function load() {
    return Promise.all([mx.get(V1 + '/reporting-packs'), mx.get(V1 + '/companies')]).then(function (r) {
      queue = r[0].data;
      companies = r[1].data;
      renderHub();
    });
  }

  function renderHub() {
    var page = document.getElementById('page-private-markets');
    var head = page && page.querySelector('.page-head');
    if (!head) return;
    var hub = document.getElementById('mxCompanyHub');
    if (!hub) {
      hub = document.createElement('section');
      hub.className = 'v16-hub';
      hub.id = 'mxCompanyHub';
      head.insertAdjacentElement('afterend', hub);
    }
    var questions = companies.reduce(function (n, c) { return n + c.openQuestions; }, 0);
    var alerts = companies.reduce(function (n, c) { return n + c.covenantAlerts; }, 0);
    var btn = function (kicker, title, detail, key, warn) {
      return '<button type="button" class="' + (warn ? 'warn' : '') + '" data-mx-company-hub="' + key + '"><span>' + kicker + '</span><strong>' + title + '</strong><small>' + detail + '</small></button>';
    };
    hub.innerHTML =
      btn('PORTFOLIO COMPANIES', 'Company reporting', queue.length + ' pack' + (queue.length === 1 ? '' : 's') + ' awaiting review', 'queue', queue.length > 0) +
      btn('INVESTMENT TEAM', 'Company questions', questions + ' open', 'companies', questions > 0) +
      btn('COVENANTS', 'Covenant watch', alerts ? alerts + ' certificate' + (alerts === 1 ? '' : 's') + ' expiring' : 'All current', 'companies', alerts > 0);
    mx.$$('[data-mx-company-hub]', hub).forEach(function (b) {
      b.onclick = function () {
        load().then(openOverview, mx.fail);
      };
    });
  }

  function openOverview() {
    var review = mx.can('research.edit');
    var q = queue.map(function (p) {
      return [
        mx.esc(p.company.name),
        mx.esc(p.label),
        mx.date(p.submittedAt),
        p.items.filter(function (i) { return i.files.length; }).length + ' / ' + p.items.length + ' items',
        '<button class="btn secondary" type="button" data-mx-pack="' + p.uuid + '">' + (review ? 'Review' : 'View') + '</button>',
      ];
    });
    var c = companies.map(function (co) {
      var lp = co.latestPeriod;
      return [
        mx.esc(co.name),
        lp ? mx.esc(lp.label) : '—',
        lp ? statusChip(lp.status) : '—',
        String(co.openQuestions),
        co.covenantAlerts ? '<span class="v16-status warn">' + co.covenantAlerts + ' expiring</span>' : '<span class="v16-status good">Current</span>',
        '<button class="btn secondary" type="button" data-mx-company="' + mx.esc(co.id) + '">Open</button>',
      ];
    });
    openDrawer({
      eyebrow: 'PRIVATE MARKETS',
      title: 'Portfolio-company reporting',
      subtitle: 'Monthly financial, KPI and compliance packs submitted through the company portal.',
      body:
        '<h3>Awaiting review</h3>' + table(['Company', 'Period', 'Submitted', 'Completeness', ''], q) +
        '<h3 style="margin-top:16px">Companies</h3>' + table(['Company', 'Latest pack', 'Status', 'Open questions', 'Covenants', ''], c) +
        '<div class="form-actions"><button class="btn secondary" type="button" data-mx-open-portal>Open company portal</button></div>',
    });
    var body = document.getElementById('drawerBody');
    mx.$$('[data-mx-pack]', body).forEach(function (b) {
      b.onclick = function () {
        openPack(queue.find(function (p) { return p.uuid === b.getAttribute('data-mx-pack'); }));
      };
    });
    mx.$$('[data-mx-company]', body).forEach(function (b) {
      b.onclick = function () { openCompany(b.getAttribute('data-mx-company')); };
    });
    body.querySelector('[data-mx-open-portal]').onclick = function () {
      window.open(mx.portalUrl('company'), '_blank', 'noopener');
    };
  }

  function packBody(p) {
    var items = p.items
      .map(function (i) {
        var files = i.files.length
          ? i.files.map(function (f) {
              return '<button type="button" class="btn secondary" data-mx-file="' + f.id + '">' + mx.esc(f.name) + ' · ' + Math.round(f.size / 1024) + ' KB</button>';
            }).join(' ')
          : '<small>' + (i.required ? 'Missing (required)' : 'Not supplied') + '</small>';
        return [mx.esc(i.title) + (i.required ? '' : ' <small>(optional)</small>'), files];
      });
    var kpis = Object.keys(p.kpis || {}).map(function (k) { return [mx.esc(k), mx.esc(p.kpis[k])]; });
    return (
      table(['Item', 'Files'], items) +
      (kpis.length ? '<h3 style="margin-top:14px">Reported KPIs</h3>' + table(['KPI', 'Value'], kpis) : '') +
      (p.notes ? '<h3 style="margin-top:14px">Cover note</h3><p>' + mx.esc(p.notes) + '</p>' : '') +
      (p.reviewNote ? '<h3 style="margin-top:14px">Review note</h3><p>' + mx.esc(p.reviewNote) + ' <small>' + mx.esc(p.reviewer || '') + '</small></p>' : '')
    );
  }

  function wireFiles(root, p) {
    mx.$$('[data-mx-file]', root).forEach(function (b) {
      b.onclick = function () {
        mx.download(V1 + '/reporting-packs/' + p.uuid + '/files/' + b.getAttribute('data-mx-file') + '/download-url').catch(mx.fail);
      };
    });
  }

  function openPack(p) {
    if (!p) return;
    var review = mx.can('research.edit') && p.status === 'submitted';
    var company = p.company || {};
    var m = mx.modal({
      eyebrow: 'REPORTING PACK · ' + mx.esc(company.id || ''),
      title: mx.esc((company.name ? company.name + ' · ' : '') + p.label),
      subtitle: 'Submitted ' + mx.date(p.submittedAt) + ' · ' + mx.esc(p.status),
      wide: true,
      body: packBody(p),
      actions: review
        ? [
            {
              label: 'Return to company',
              run: function () {
                var note = window.prompt('What does the company need to fix?');
                if (!note) return false;
                return mx.post(V1 + '/reporting-packs/' + p.uuid + '/return', { note: note }).then(function () {
                  toast('Pack returned', company.name + ' · ' + p.label + ' sent back with your note.');
                  return load();
                });
              },
            },
            {
              label: 'Ask a question',
              run: function () {
                return askQuestion(company.id, p.id).then(function () { return false; });
              },
            },
            {
              label: 'Accept pack',
              primary: true,
              run: function () {
                var note = window.prompt('Optional note for the company', 'Accepted - thank you.');
                if (note === null) return false;
                return mx.post(V1 + '/reporting-packs/' + p.uuid + '/accept', { note: note }).then(function () {
                  toast('Pack accepted', company.name + ' · ' + p.label);
                  return load();
                });
              },
            },
          ]
        : [],
    });
    wireFiles(m, p);
  }

  function askQuestion(companyRef, period) {
    var title = window.prompt('Question subject');
    if (!title) return Promise.resolve();
    var text = window.prompt('Question for the company');
    if (!text) return Promise.resolve();
    return mx.post(V1 + '/companies/' + encodeURIComponent(companyRef) + '/questions', { title: title, text: text, period: period }).then(function (r) {
      toast('Question sent', r.thread.id + ' · ' + title);
      return load();
    });
  }

  function openCompany(ref) {
    mx.get(V1 + '/companies/' + encodeURIComponent(ref)).then(function (w) {
      var review = mx.can('research.edit');
      var packs = w.periodDetails.map(function (p) {
        return [mx.esc(p.label), 'Due ' + mx.esc(p.due), statusChip(p.status), p.reviewer ? mx.esc(p.reviewer) : '—', '<button class="btn secondary" type="button" data-mx-period="' + p.uuid + '">View</button>'];
      });
      var threads = w.threads.map(function (t) {
        var last = t.messages[t.messages.length - 1];
        return [
          mx.esc(t.id),
          mx.esc(t.title) + (last ? '<br/><small>' + mx.esc(last.name) + ': ' + mx.esc(last.text.slice(0, 120)) + '</small>' : ''),
          statusChip(t.status),
          review && t.status === 'open'
            ? '<button class="btn secondary" type="button" data-mx-reply="' + mx.esc(t.id) + '">Reply</button> <button class="btn secondary" type="button" data-mx-resolve="' + mx.esc(t.id) + '">Resolve</button>'
            : '',
        ];
      });
      var covs = w.covenants.map(function (c) {
        return [mx.esc(c.name), mx.esc(c.threshold), mx.esc(c.actual + (c.unit || '')), c.evidence === 'expiring' ? '<span class="v16-status warn">' + mx.esc(c.note || 'Expiring') + '</span>' : '<span class="v16-status good">Current</span>'];
      });
      var m = mx.modal({
        eyebrow: 'PORTFOLIO COMPANY · ' + mx.esc(w.company.id),
        title: mx.esc(w.company.name),
        subtitle: mx.esc(w.company.sector + ' · ' + w.company.country + ' · ' + (w.company.relationship.fund || '')),
        wide: true,
        body:
          '<h3>Reporting packs</h3>' + table(['Period', 'Due', 'Status', 'Reviewer', ''], packs) +
          '<h3 style="margin-top:14px">Questions</h3>' + table(['Ref', 'Subject', 'Status', ''], threads) +
          '<h3 style="margin-top:14px">Covenants</h3>' + table(['Covenant', 'Threshold', 'Actual', 'Evidence'], covs),
        actions: review
          ? [
              { label: 'Invite company user', run: function () { return inviteUser(w.company); } },
              { label: 'Ask a question', primary: true, run: function () { return askQuestion(w.company.id).then(function () { openCompany(ref); return false; }); } },
            ]
          : [],
      });
      mx.$$('[data-mx-period]', m).forEach(function (b) {
        b.onclick = function () {
          var p = w.periodDetails.find(function (x) { return x.uuid === b.getAttribute('data-mx-period'); });
          p.company = { id: w.company.id, name: w.company.name };
          openPack(p);
        };
      });
      mx.$$('[data-mx-reply]', m).forEach(function (b) {
        b.onclick = function () {
          var text = window.prompt('Reply to the company');
          if (!text) return;
          mx.post(V1 + '/questions/' + encodeURIComponent(b.getAttribute('data-mx-reply')) + '/messages', { text: text }).then(function () {
            toast('Reply sent', b.getAttribute('data-mx-reply'));
            openCompany(ref);
          }, mx.fail);
        };
      });
      mx.$$('[data-mx-resolve]', m).forEach(function (b) {
        b.onclick = function () {
          mx.post(V1 + '/questions/' + encodeURIComponent(b.getAttribute('data-mx-resolve')) + '/resolve', {}).then(function () {
            toast('Question resolved', b.getAttribute('data-mx-resolve'));
            load().then(function () { openCompany(ref); });
          }, mx.fail);
        };
      });
    }, mx.fail);
  }

  function inviteUser(company) {
    var name = window.prompt('Full name of the company user');
    if (!name) return false;
    var email = window.prompt('Work email for ' + name);
    if (!email) return false;
    return mx.post(V1 + '/companies/' + encodeURIComponent(company.id) + '/users', { name: name, email: email }).then(function () {
      toast('Invitation sent', email + ' can now set up access to the ' + company.name + ' reporting portal.');
    });
  }

  window.addEventListener('matanho:legacy-ready', function () {
    if (!mx.live || !mx.can('portfolio.view')) return;
    load().catch(mx.fail);
    // V48 re-lays out the private-markets page ~3s after boot; re-attach once it settles.
    setTimeout(renderHub, 4000);
  });
})();
