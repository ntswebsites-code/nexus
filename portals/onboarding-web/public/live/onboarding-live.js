/*
 * Public onboarding: live wiring of the V65 wizard to /api/v1/public/applications (SRD 5.C,
 * FR-ONB-027, 029-035, 038-039). Loaded before the prototype script; it only reads and writes
 * the prototype's DOM (ids, data-* attributes) and never relies on its private functions.
 *
 * Mode comes from GET /api/v1/platform/flags (`onboarding.live`):
 *   - live: draft created once a valid email is typed, every change saved (debounced), each
 *     evidence card uploaded on selection, submit goes to the API and shows the server ONB ref;
 *   - not live: amber "Demo data" ribbon; the prototype runs on its own and stores nothing;
 *   - flags unreachable: red ribbon and submission is blocked (no pretend success).
 */
(function () {
  'use strict';
  var API = String(window.__MATANHO_API__ || '').replace(/\/+$/, '');
  var KEY = 'mx-onboarding-draft-v65';
  var PROTO_DRAFT = 'matanho-public-onboarding-draft-v57';
  var FIELDS = ['investorType', 'legalName', 'registrationRef', 'jurisdiction', 'incorporationDate', 'regulatedStatus', 'regulator', 'licenceRef', 'website', 'registeredAddress', 'relationship', 'mandate', 'initialInvestment', 'baseCurrency', 'investorClassification', 'primaryEmail', 'primaryContact', 'telephone', 'purpose', 'ownershipNarrative', 'authorityNarrative', 'pep', 'sanctions', 'adverseMedia', 'highRiskJurisdiction', 'sourceFunds', 'sourceWealth', 'annualVolume', 'transactionFrequency', 'fundingJurisdictions', 'expectedCurrencies', 'sourceFundsNarrative', 'expectedActivity', 'taxResidence', 'taxId', 'fatca', 'giin', 'crs', 'usIndicia', 'bankName', 'bankHolder', 'bankCountry', 'bankAccount', 'swift', 'bankCurrency', 'evidenceNote', 'complianceContact', 'signatureName', 'signatureCapacity'];
  // V65 card key -> API slot (mirrors V65_SLOT_MAP on the server, which also accepts card keys).
  var SLOT = { legal: 'doc1', registry: 'doc9', ownership: 'doc4', identity: 'doc10', address: 'doc2', bank: 'doc5', funds: 'doc3', tax: 'doc6', authority: 'doc7', subscription: 'doc8', additional: 'doc11' };
  var CARD = {};
  Object.keys(SLOT).forEach(function (k) { CARD[SLOT[k]] = k; });
  var REQUIRED_DOCS = ['legal', 'registry', 'ownership', 'identity', 'address', 'bank', 'funds', 'tax', 'authority'];
  var TITLES = { legal: 'Legal existence / identity', registry: 'Registry / constitutional extract', ownership: 'Ownership / control evidence', identity: 'Owners / signatories ID', address: 'Address evidence', bank: 'Bank verification', funds: 'Source-of-funds evidence', tax: 'Tax / FATCA / CRS', authority: 'Authority to invest' };

  var mode = 'pending';
  var draft = null; // {id, token}
  var server = null; // last GET view
  var uploaded = {}; // card -> {name, size, sha256, file}
  var pending = {}; // card -> File waiting for a draft
  var onFile = { taxId: false, bankAccount: false };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  // ------------------------------------------------------------------ ui helpers
  function ribbon(kind, html) {
    var el = document.getElementById('mx-ribbon');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mx-ribbon';
      el.setAttribute('role', 'status');
      document.body.insertBefore(el, document.body.firstChild);
    }
    el.style.cssText = 'position:sticky;top:0;z-index:2147483000;padding:8px 16px;font:700 12px/1.4 Inter,system-ui,sans-serif;text-align:center;letter-spacing:.02em;color:#fff;background:' + (kind === 'error' ? '#a9253e' : '#9a6400');
    el.innerHTML = html;
  }
  function toast(title, message, kind) {
    var box = document.createElement('div');
    box.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    box.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;max-width:380px;padding:12px 15px;border-radius:10px;font:600 12px/1.45 Inter,system-ui,sans-serif;box-shadow:0 10px 30px rgba(15,34,65,.18);color:#fff;background:' + (kind === 'error' ? '#a9253e' : kind === 'warn' ? '#9a6400' : '#1d2a3b');
    var t = document.createElement('strong');
    t.textContent = title;
    t.style.display = 'block';
    box.appendChild(t);
    if (message) box.appendChild(document.createTextNode(message));
    document.body.appendChild(box);
    setTimeout(function () { box.remove(); }, kind === 'error' ? 9000 : 5000);
  }
  function setDraftStatus(text) {
    var a = $('#draftStatus');
    if (a) a.textContent = text;
    var b = $('#railState');
    if (b) b.textContent = text;
  }
  function hhmm() { return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

  var legacyReady = new Promise(function (resolve) {
    if (document.documentElement.dataset.legacyReady) return resolve();
    window.addEventListener('matanho:legacy-ready', function () { resolve(); }, { once: true });
  });

  // ------------------------------------------------------------------ api
  function request(method, path, body, withToken) {
    var headers = { Accept: 'application/json' };
    var payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    if (withToken && draft) headers['X-Draft-Token'] = draft.token;
    return fetch(API + path, { method: method, headers: headers, body: payload, credentials: 'omit' }).then(function (res) {
      return res.text().then(function (text) {
        var json;
        try { json = text ? JSON.parse(text) : undefined; } catch (e) { json = undefined; }
        if (res.ok) return json;
        var e = json && json.error;
        var err = new Error((e && e.message) || 'Request failed (' + res.status + ')');
        err.status = res.status;
        err.code = (e && e.code) || 'http_error';
        err.details = e && e.details;
        throw err;
      });
    }, function () {
      var err = new Error('Matanho could not be reached. Check your connection and try again.');
      err.code = 'network';
      throw err;
    });
  }
  function base() { return '/api/v1/public/applications/' + encodeURIComponent(draft.id); }
  function writeDraft(d) {
    draft = d;
    try {
      if (d) localStorage.setItem(KEY, JSON.stringify(d));
      else localStorage.removeItem(KEY);
    } catch (e) { /* private mode: draft lives for this page only */ }
  }
  function readDraft() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }

  // ------------------------------------------------------------------ form <-> payload
  function val(id) {
    var el = document.getElementById(id);
    return el ? String(el.value == null ? '' : el.value).trim() : '';
  }
  function collect() {
    var form = { formVersion: 'v65' };
    FIELDS.forEach(function (id) { form[id] = val(id); });
    var owners = $$('#ownerList .repeater-row').map(function (r) {
      return { name: $('[data-owner=name]', r).value.trim(), nationality: $('[data-owner=nationality]', r).value.trim(), id: $('[data-owner=id]', r).value.trim(), pct: $('[data-owner=pct]', r).value.trim() };
    });
    var signatories = $$('#signatoryList .repeater-row').map(function (r) {
      return { name: $('[data-signatory=name]', r).value.trim(), role: $('[data-signatory=role]', r).value.trim(), email: $('[data-signatory=email]', r).value.trim() };
    });
    return { form: form, owners: owners.filter(function (o) { return o.name; }), signatories: signatories.filter(function (s) { return s.name; }) };
  }
  function fillRepeater(listSel, addSel, items, fill) {
    var list = $(listSel);
    if (!list || !items.length) return;
    var guard = 0;
    while ($$('.repeater-row', list).length < items.length && guard++ < 25) $(addSel).click();
    var rows = $$('.repeater-row', list);
    for (var i = rows.length - 1; i >= items.length; i--) $('.remove', rows[i]).click();
    $$('.repeater-row', list).forEach(function (row, i) { fill(row, items[i]); });
  }
  function setIn(row, sel, v) {
    var el = $(sel, row);
    if (el) el.value = v == null ? '' : v;
  }
  function markOnFile(id, on) {
    var el = document.getElementById(id);
    if (!el) return;
    onFile[id] = on;
    if (on) {
      el.placeholder = 'On file with Matanho - leave blank to keep';
      el.removeAttribute('required');
    }
  }
  function restore(view) {
    var f = view.form || {};
    FIELDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (el && f[id] != null && f[id] !== '') el.value = f[id];
    });
    fillRepeater('#ownerList', '#addOwner', view.ownerDetails || [], function (row, o) {
      setIn(row, '[data-owner=name]', o.name);
      setIn(row, '[data-owner=nationality]', o.nationality);
      setIn(row, '[data-owner=pct]', o.pct);
    });
    fillRepeater('#signatoryList', '#addSignatory', view.signatories || [], function (row, s) {
      setIn(row, '[data-signatory=name]', s.name);
      setIn(row, '[data-signatory=role]', s.role);
      setIn(row, '[data-signatory=email]', s.email);
    });
    markOnFile('taxId', !!view.taxIdOnFile);
    markOnFile('bankAccount', !!view.bankAccountOnFile);
    (view.evidence || []).forEach(function (e) {
      var card = CARD[e.slot] || e.slot;
      if (e.name) {
        uploaded[card] = { name: e.name, size: e.size, sha256: e.sha256, file: null };
        cardNote(card, e.name + ' · ' + kb(e.size) + ' · on file with Matanho', 'ok');
      }
    });
    var first = document.getElementById('legalName');
    if (first) first.dispatchEvent(new Event('change', { bubbles: true }));
    setDraftStatus('Restored from Matanho');
  }

  // ------------------------------------------------------------------ saving
  var creating = null;
  function ensureDraft() {
    if (draft) return Promise.resolve(draft);
    if (creating) return creating;
    var email = val('primaryEmail');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Promise.resolve(null);
    creating = request('POST', '/api/v1/public/applications', { email: email, applicantType: val('investorType') || undefined, name: val('legalName') || undefined })
      .then(function (r) {
        writeDraft({ id: r.id, token: r.token });
        server = { status: 'Draft' };
        return draft;
      })
      .finally(function () { creating = null; });
    return creating;
  }
  var timer = null;
  var chain = Promise.resolve();
  var saveFailedShown = false;
  function save() {
    chain = chain
      .then(function () {
        return ensureDraft().then(function (d) {
          if (!d || (server && server.status && server.status !== 'Draft')) return;
          return request('PATCH', base(), collect(), true).then(function () {
            saveFailedShown = false;
            setDraftStatus('Saved to Matanho ' + hhmm());
            return flushPending();
          });
        });
      })
      .catch(function (err) {
        setDraftStatus('Not saved');
        if (!saveFailedShown) toast('Draft not saved', err.message + ' Your entries are still on this page.', 'error');
        saveFailedShown = true;
      });
    return chain;
  }
  function scheduleSave() {
    if (mode !== 'live') return;
    clearTimeout(timer);
    timer = setTimeout(save, 1200);
  }

  // ------------------------------------------------------------------ evidence
  function kb(size) { return Math.max(1, Math.round((size || 0) / 1024)).toLocaleString() + ' KB'; }
  function cardNote(card, text, kind) {
    var host = $('[data-doc="' + card + '"]');
    if (!host) return;
    var el = $('.mx-upload', host);
    if (!el) {
      el = document.createElement('small');
      el.className = 'mx-upload';
      host.appendChild(el);
    }
    el.style.cssText = 'display:block;margin-top:6px;font-weight:700;color:' + (kind === 'error' ? '#a9253e' : kind === 'warn' ? '#9a6400' : '#1f7a4d');
    el.textContent = text;
  }
  function upload(card, file) {
    var fd = new FormData();
    fd.append('slot', card);
    fd.append('file', file, file.name);
    cardNote(card, 'Uploading ' + file.name + '…', 'warn');
    return request('POST', base() + '/evidence', fd, true).then(function (r) {
      uploaded[card] = { name: r.name, size: r.size, sha256: r.sha256, file: file };
      delete pending[card];
      cardNote(card, r.name + ' · ' + kb(r.size) + ' · uploaded securely · SHA-256 ' + String(r.sha256 || '').slice(0, 12) + '…', 'ok');
    }, function (err) {
      cardNote(card, 'Upload failed: ' + err.message, 'error');
      throw err;
    });
  }
  function flushPending() {
    return Object.keys(pending).reduce(function (p, card) {
      return p.then(function () { return upload(card, pending[card]); });
    }, Promise.resolve());
  }
  function onFileChosen(card, file) {
    pending[card] = file;
    ensureDraft().then(function (d) {
      if (!d) {
        cardNote(card, 'Waiting: enter the primary contact email on step 1 so this document can be stored securely.', 'warn');
        return;
      }
      return upload(card, file);
    }).catch(function (err) {
      toast('Document not uploaded', err.message, 'error');
    });
  }
  function docSatisfied(card) {
    var input = $('[data-doc-input="' + card + '"]');
    var local = input && input.files && input.files[0];
    return !!(local || uploaded[card]);
  }

  // ------------------------------------------------------------------ submit
  function activePane() {
    var p = $('.pane.active');
    return p ? Number(p.dataset.pane) : 0;
  }
  function goTo(index) {
    var b = $('#stepRail [data-step="' + index + '"]');
    if (b) b.click();
  }
  function validateAll() {
    for (var i = 0; i < 6; i++) {
      var pane = $('[data-pane="' + i + '"]');
      if (!pane) continue;
      var bad = $$('[required]', pane).filter(function (el) { return !el.checkValidity(); })[0];
      if (bad) {
        goTo(i);
        setTimeout(function () { bad.reportValidity(); }, 50);
        return false;
      }
      if (i === 1 && !collect().owners.length) {
        goTo(1);
        alert('Add at least one beneficial owner, controller, trustee or governing person.');
        return false;
      }
      if (i === 4) {
        var missing = REQUIRED_DOCS.filter(function (c) { return !docSatisfied(c); });
        if (missing.length) {
          goTo(4);
          alert('Supporting evidence still missing: ' + missing.slice(0, 4).map(function (c) { return TITLES[c]; }).join(', ') + (missing.length > 4 ? '…' : ''));
          return false;
        }
      }
    }
    return true;
  }
  function uploadLocalFiles() {
    return $$('[data-doc-input]').reduce(function (p, input) {
      var card = input.dataset.docInput;
      var file = input.files && input.files[0];
      if (!file || (uploaded[card] && uploaded[card].file === file)) return p;
      return p.then(function () { return upload(card, file); });
    }, Promise.resolve());
  }
  function showSuccess(ref) {
    $('#applicationForm').style.display = 'none';
    $('#successPanel').classList.add('show');
    $('#successRef').textContent = ref;
    $('#successAi').textContent = 'Queued · provider checks pending';
    var side = $('#sidePanel');
    if (side) side.style.display = 'none';
    $('#successPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function onSubmit(event) {
    var form = event.target;
    if (!form || form.id !== 'applicationForm') return;
    if (mode === 'demo') return; // prototype demo flow under the ribbon
    event.preventDefault();
    event.stopImmediatePropagation();
    if (mode !== 'live') {
      toast('Not submitted', mode === 'pending' ? 'Still connecting to Matanho. Try again in a moment.' : 'Matanho cannot be reached, so your application has not been submitted. Try again later.', 'error');
      return;
    }
    var followUp = server && server.status !== 'Draft' && server.caseStage === 'ClientAction';
    if (!followUp && !validateAll()) return;
    var btn = $('#submitBtn');
    var label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
    clearTimeout(timer);
    chain
      .then(ensureDraft)
      .then(function (d) {
        if (!d) throw new Error('Enter a valid primary contact email on step 1.');
        return uploadLocalFiles();
      })
      .then(function () {
        if (followUp) return { ref: server.ref, followUp: true };
        var body = collect();
        body.consent = true;
        return request('POST', base() + '/submit', body, true);
      })
      .then(function (r) {
        if (r.followUp) {
          toast('Documents received', 'Your additional evidence was added to ' + r.ref + '.');
          return;
        }
        writeDraft(null);
        try { localStorage.removeItem(PROTO_DRAFT); } catch (e) { /* ignore */ }
        server = { status: 'Submitted' };
        showSuccess(r.ref);
      })
      .catch(function (err) {
        if (err.code === 'incomplete_application' && err.details) {
          var items = [].concat(err.details.fields || [], err.details.evidence || []);
          toast('Application incomplete', 'Still needed: ' + items.join(', '), 'error');
        } else if (err.code === 'already_submitted') {
          writeDraft(null);
          toast('Already submitted', 'This application was already submitted. Contact Matanho Client Services for changes.', 'error');
        } else toast('Not submitted', err.message, 'error');
      })
      .finally(function () {
        if (btn) { btn.disabled = false; btn.textContent = label; }
      });
  }

  // ------------------------------------------------------------------ wiring
  document.addEventListener('submit', onSubmit, true);
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (mode !== 'live' || !t || !t.dataset) return;
    if (t.dataset.docInput && t.files && t.files[0]) onFileChosen(t.dataset.docInput, t.files[0]);
  }, true);
  ['input', 'change'].forEach(function (type) {
    document.addEventListener(type, function (e) {
      var t = e.target;
      if (t && t.closest && t.closest('#applicationForm') && t.type !== 'file' && t.id !== 'consent') scheduleSave();
    });
  });
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (mode !== 'live' || !t || !t.closest) return;
    // A resumed draft has its evidence on the server, not in this browser: let Continue pass.
    if (t.closest('#nextBtn') && activePane() === 4) {
      var allOk = REQUIRED_DOCS.every(docSatisfied);
      var someRemote = REQUIRED_DOCS.some(function (c) { var i = $('[data-doc-input="' + c + '"]'); return !(i && i.files && i.files[0]); });
      if (allOk && someRemote) {
        e.preventDefault();
        e.stopImmediatePropagation();
        goTo(5);
        return;
      }
    }
    if (t.closest('#saveBtn') || t.closest('#nextBtn') || t.closest('#addOwner') || t.closest('#addSignatory') || t.closest('.repeater-row .remove')) scheduleSave();
  }, true);

  // ------------------------------------------------------------------ boot
  function liveBoot() {
    // The tax id and account number never stay in browser storage in live mode (DEF-470).
    var native = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (this === window.localStorage && k === PROTO_DRAFT) {
        try {
          var d = JSON.parse(v);
          delete d.taxId;
          delete d.bankAccount;
          v = JSON.stringify(d);
        } catch (e) { /* leave as is */ }
      }
      return native.call(this, k, v);
    };
    var params = new URLSearchParams(window.location.search);
    var resume = params.get('resume');
    var fromLink = false;
    if (resume && resume.indexOf('.') > 0) {
      var i = resume.indexOf('.');
      writeDraft({ id: resume.slice(0, i), token: resume.slice(i + 1) });
      fromLink = true;
      params.delete('resume');
      var q = params.toString();
      history.replaceState(null, '', window.location.pathname + (q ? '?' + q : '') + window.location.hash);
    } else draft = readDraft();
    if (!draft) return;
    return request('GET', base() + (fromLink ? '?verified=1' : ''), undefined, true)
      .then(function (r) {
        server = r.application;
        if (server.status === 'Draft' || server.caseStage === 'ClientAction') {
          return legacyReady.then(function () {
            restore(server);
            if (server.caseStage === 'ClientAction' && server.requestedSlots && server.requestedSlots.length) {
              toast('Documents requested', 'Please upload: ' + server.requestedSlots.map(function (s) {
                var e = (server.evidence || []).filter(function (x) { return x.slot === s; })[0];
                return e ? e.label : s;
              }).join(', '), 'warn');
            }
          });
        }
        writeDraft(null);
        server = null;
      })
      .catch(function (err) {
        if (err.status === 404 || err.status === 409) {
          writeDraft(null);
          if (fromLink) toast('Link not valid', 'This application link has expired or was already used. Start a new application.', 'error');
        } else toast('Draft not restored', err.message, 'error');
      });
  }

  fetch(API + '/api/v1/platform/flags', { credentials: 'omit', cache: 'no-store' })
    .then(function (res) {
      if (!res.ok) throw new Error('flags ' + res.status);
      return res.json();
    })
    .then(function (flags) {
      mode = flags && flags.onboarding && flags.onboarding.live ? 'live' : 'demo';
      document.documentElement.dataset.mxMode = mode;
      if (mode === 'live') return liveBoot();
      return legacyReady.then(function () {
        ribbon('demo', 'DEMO DATA · This application is a demonstration and is not sent to Matanho. Nothing entered here is stored on our servers.');
      });
    })
    .catch(function () {
      mode = 'error';
      document.documentElement.dataset.mxMode = mode;
      return legacyReady.then(function () {
        ribbon('error', 'Matanho cannot be reached right now. This page is showing demo behaviour only and applications cannot be submitted.');
      });
    });
})();
