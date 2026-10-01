/*
 * Onboarding portal bridge: persists the prototype wizard to the public
 * onboarding API (draft, evidence, submit) without changing its UI.
 *   - draft created as soon as a valid email is typed; token kept in this browser
 *   - `?resume=<id>.<token>` magic links restore a draft on any device
 *   - every field change is saved (debounced), evidence uploads on selection
 *   - submit uploads pending evidence, submits, then lets the prototype show its
 *     confirmation with the real ONB reference
 */
(function () {
  'use strict';
  var mx = window.mx;
  var KEY = 'mx-onboarding-draft';
  var PROTO_DRAFT = 'matanho-public-onboarding-draft-v19';
  var SLOTS = ['doc1', 'doc2', 'doc3', 'doc4', 'doc5', 'doc6', 'doc7', 'doc8'];
  var draft = null; // {id, token}
  var server = null; // last GET /applications/:id view
  var uploaded = {}; // slot -> {name,size}
  var pending = {}; // slot -> File (chosen before a draft existed)

  function readDraft() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch (e) {
      return null;
    }
  }
  function writeDraft(d) {
    draft = d;
    try {
      if (d) localStorage.setItem(KEY, JSON.stringify(d));
      else localStorage.removeItem(KEY);
    } catch (e) {
      /* private mode */
    }
  }
  function headers() {
    return { headers: { 'X-Draft-Token': draft.token } };
  }
  function base() {
    return '/api/v1/public/applications/' + encodeURIComponent(draft.id);
  }
  function validEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
  }
  function proto() {
    return typeof window.collect === 'function' ? window.collect() : null;
  }

  // -------------------------------------------------------------- boot ------
  mx.boot(function () {
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
    } else {
      draft = readDraft();
    }
    if (!draft) return;
    return mx
      .request('GET', base() + (fromLink ? '?verified=1' : ''), undefined, headers())
      .then(function (r) {
        server = r.application;
        (server.evidence || []).forEach(function (e) {
          if (e.name) uploaded[e.slot] = { name: e.name, size: e.size };
        });
        if (server.status === 'Draft' || server.caseStage === 'ClientAction') {
          // Hand the saved values to the prototype's own restore().
          var d = Object.assign({}, server.form);
          d.owners = server.owners && server.owners.length ? server.owners : undefined;
          try {
            localStorage.setItem(PROTO_DRAFT, JSON.stringify(d));
          } catch (e) {
            /* ignore */
          }
        } else {
          writeDraft(null);
        }
      })
      .catch(function (err) {
        if (err && (err.status === 404 || err.status === 409)) writeDraft(null);
        else throw err;
      });
  });

  // -------------------------------------------------------------- saving ----
  var creating = null;
  function ensureDraft() {
    if (draft) return Promise.resolve(draft);
    if (creating) return creating;
    var d = proto();
    if (!d || !validEmail(d.email)) return Promise.resolve(null);
    creating = mx
      .post('/api/v1/public/applications', { email: d.email.trim(), applicantType: d.type || undefined, name: d.name || undefined })
      .then(function (r) {
        writeDraft({ id: r.id, token: r.token });
        return draft;
      })
      .finally(function () {
        creating = null;
      });
    return creating;
  }

  var timer = null;
  var saving = Promise.resolve();
  function save() {
    saving = saving.then(function () {
      return ensureDraft().then(function (d) {
        if (!d || (server && server.status !== 'Draft')) return;
        var p = proto();
        if (!p) return;
        var form = {};
        Object.keys(p).forEach(function (k) {
          if (k !== 'owners' && k !== 'files') form[k] = String(p[k] == null ? '' : p[k]);
        });
        return mx.request('PATCH', base(), { form: form, owners: p.owners }, headers()).then(function () {
          return flushPending();
        });
      });
    }).catch(function (err) {
      console.warn('[onboarding-bridge] draft save failed', err);
    });
    return saving;
  }
  function scheduleSave() {
    clearTimeout(timer);
    timer = setTimeout(save, 1200);
  }

  // -------------------------------------------------------------- evidence --
  function showMeta(slot, text) {
    var input = document.getElementById(slot);
    var drop = input && input.closest('.drop');
    if (!drop) return;
    var meta = drop.querySelector('.v35-upload-meta');
    if (!meta) {
      meta = document.createElement('small');
      meta.className = 'v35-upload-meta';
      meta.style.cssText = 'display:block;margin-top:6px;color:#3158e8;font-weight:700';
      drop.appendChild(meta);
    }
    meta.textContent = text;
  }
  function kb(size) {
    return ((size || 0) / 1024).toFixed(1) + ' KB';
  }
  function uploadSlot(slot, file) {
    var fd = new FormData();
    fd.append('slot', slot);
    fd.append('file', file, file.name);
    return mx.request('POST', base() + '/evidence', fd, headers()).then(function (r) {
      uploaded[slot] = { name: r.name, size: r.size };
      delete pending[slot];
      showMeta(slot, r.name + ' · ' + kb(r.size) + ' · uploaded securely');
    });
  }
  function flushPending() {
    var slots = Object.keys(pending);
    if (!slots.length || !draft) return Promise.resolve();
    return slots.reduce(function (p, slot) {
      return p.then(function () {
        return uploadSlot(slot, pending[slot]);
      });
    }, Promise.resolve());
  }
  function onFile(slot, input) {
    var file = input.files && input.files[0];
    if (!file) return;
    pending[slot] = file;
    ensureDraft()
      .then(function (d) {
        if (!d) {
          mx.toast('Upload waiting', 'Enter your email on step 1 so your documents can be stored securely.', 'warn');
          return;
        }
        return uploadSlot(slot, file);
      })
      .catch(function (err) {
        delete pending[slot];
        showMeta(slot, 'Upload failed: ' + (err.message || 'try again'));
        mx.fail(err);
      });
  }

  // -------------------------------------------------------------- submit ----
  function onSubmit(event) {
    var form = event.target;
    if (!form || form.id !== 'form' || form.__mxPass) return;
    var consent = document.getElementById('consent');
    if (!consent || !consent.checked) return; // prototype reports the validation message
    event.preventDefault();
    event.stopImmediatePropagation();
    var btn = document.getElementById('submit');
    if (btn) btn.disabled = true;
    clearTimeout(timer);
    saving
      .then(ensureDraft)
      .then(function (d) {
        if (!d) throw new Error('Enter a valid email address on step 1.');
        if (server && server.caseStage === 'ClientAction') return flushPending().then(function () {
          return { ref: server.ref, followUp: true };
        });
        return save()
          .then(flushPending)
          .then(function () {
            var p = proto() || {};
            var formValues = {};
            Object.keys(p).forEach(function (k) {
              if (k !== 'owners' && k !== 'files') formValues[k] = String(p[k] == null ? '' : p[k]);
            });
            return mx.request('POST', base() + '/submit', { consent: true, form: formValues, owners: p.owners }, headers());
          });
      })
      .then(function (r) {
        writeDraft(null);
        form.__mxPass = true;
        try {
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        } finally {
          form.__mxPass = false;
        }
        var ref = document.getElementById('ref');
        if (ref && r && r.ref) ref.textContent = r.ref;
        if (r && r.followUp) mx.toast('Documents received', 'Your additional evidence was added to ' + r.ref + '.');
      })
      .catch(function (err) {
        if (err && err.code === 'incomplete_application' && err.details) {
          var items = [].concat(err.details.fields || [], err.details.evidence || []);
          mx.toast('Application incomplete', 'Still needed: ' + items.join(', '), 'error');
        } else mx.fail(err);
      })
      .finally(function () {
        if (btn) btn.disabled = false;
      });
  }

  // -------------------------------------------------------------- wiring ----
  document.addEventListener('submit', onSubmit, true);
  document.addEventListener(
    'change',
    function (e) {
      var t = e.target;
      if (t && t.id && SLOTS.indexOf(t.id) >= 0 && t.type === 'file') onFile(t.id, t);
    },
    true,
  );
  ['input', 'change'].forEach(function (type) {
    document.addEventListener(type, function (e) {
      var t = e.target;
      if (t && t.closest && t.closest('#form') && t.type !== 'file') scheduleSave();
    });
  });
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('#save') || t.closest('#next') || t.closest('#owners button') || t.closest('#addOwner')) scheduleSave();
  });

  window.addEventListener('matanho:legacy-ready', function () {
    Object.keys(uploaded).forEach(function (slot) {
      showMeta(slot, uploaded[slot].name + ' · ' + kb(uploaded[slot].size) + ' · uploaded securely');
    });
    if (server && server.caseStage === 'ClientAction' && server.requestedSlots && server.requestedSlots.length) {
      mx.toast('Documents requested', 'Please upload: ' + server.requestedSlots.map(function (s) {
        var e = (server.evidence || []).find(function (x) { return x.slot === s; });
        return e ? e.label : s;
      }).join(', '), 'warn');
    }
  });
})();
