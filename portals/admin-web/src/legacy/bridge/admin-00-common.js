/*
 * Admin workspace bridge - shared helpers. Module files (admin-10-*.js ...)
 * register loaders with mx.onLoad(); admin-99-boot.js runs them once the
 * signed-in user is known, before the prototype scripts evaluate.
 */
(function () {
  'use strict';
  var mx = window.mx;
  mx.loaders = [];
  /** Registers a loader `fn(user)`; `perm` (optional) skips it when the user lacks the permission. */
  mx.onLoad = function (perm, fn) {
    mx.loaders.push({ perm: perm, fn: fn });
  };

  /** Public URL of a sibling portal, derived from this host (nexus.x -> investor.nexus.x; localhost ports in dev). */
  mx.portalUrl = function (portal) {
    var loc = window.location;
    var ports = { admin: 3100, investor: 3101, onboarding: 3102, company: 3103 };
    if (/^(localhost|127\.0\.0\.1)$/.test(loc.hostname)) return loc.protocol + '//' + loc.hostname + ':' + ports[portal];
    var host = loc.hostname.replace(/^(investor|onboarding|company)\./, '');
    return loc.protocol + '//' + (portal === 'admin' ? host : portal + '.' + host);
  };

  /** Re-render prototype screens that listen for `storage` events on a key. */
  mx.storageSet = function (key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* ignore quota */
    }
  };
  mx.storagePing = function (key) {
    try {
      window.dispatchEvent(new StorageEvent('storage', { key: key }));
    } catch (e) {
      /* old browsers */
    }
  };

  mx.esc = function (v) {
    return String(v == null ? '' : v).replace(/[&<>'"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c];
    });
  };

  /**
   * Opens a dialog in the V34 workbench modal (same element ids and classes the
   * prototype's own modals use). `actions` = [{label, primary, run(modalEl)}];
   * a run() promise that resolves closes the dialog.
   */
  mx.modal = function (o) {
    var b = document.getElementById('v34ModalBackdrop');
    var m = document.getElementById('v34Modal');
    if (!b) {
      b = document.createElement('div');
      b.id = 'v34ModalBackdrop';
      b.className = 'v34-modal-backdrop';
      document.body.appendChild(b);
    }
    if (!m) {
      m = document.createElement('section');
      m.id = 'v34Modal';
      m.className = 'v34-modal';
      m.setAttribute('role', 'dialog');
      m.setAttribute('aria-modal', 'true');
      document.body.appendChild(m);
    }
    var close = function () {
      b.classList.remove('show');
      m.classList.remove('show');
      document.body.style.overflow = '';
    };
    b.onclick = close;
    m.style.maxWidth = o.wide ? '1180px' : '';
    m.innerHTML =
      '<header class="v34-modal-head"><div><div class="v34-kicker">' + (o.eyebrow || '') + '</div><h2>' + (o.title || '') + '</h2><p>' + (o.subtitle || '') +
      '</p></div><button class="v34-modal-close" type="button" aria-label="Close">x</button></header><div class="v34-modal-body">' + (o.body || '') +
      '</div><footer class="v34-modal-foot"><span></span><div>' +
      '<button class="v34-btn" type="button" data-mx-close>Close</button>' +
      (o.actions || [])
        .map(function (a, i) {
          return '<button class="v34-btn' + (a.primary ? ' primary' : '') + '" type="button" data-mx-action="' + i + '">' + a.label + '</button>';
        })
        .join('') +
      '</div></footer>';
    m.querySelector('.v34-modal-close').onclick = close;
    m.querySelector('[data-mx-close]').onclick = close;
    (o.actions || []).forEach(function (a, i) {
      var btn = m.querySelector('[data-mx-action="' + i + '"]');
      btn.onclick = function () {
        btn.disabled = true;
        Promise.resolve()
          .then(function () {
            return a.run(m);
          })
          .then(function (r) {
            if (r !== false) close();
          })
          .catch(mx.fail)
          .finally(function () {
            btn.disabled = false;
          });
      };
    });
    b.classList.add('show');
    m.classList.add('show');
    document.body.style.overflow = 'hidden';
    return m;
  };

  mx.money = function (n, currency) {
    var v = Number(n || 0);
    var abs = Math.abs(v);
    var s = abs >= 1e6 ? (abs / 1e6).toFixed(1) + 'M' : abs >= 1e3 ? Math.round(abs / 1e3) + 'K' : String(Math.round(abs));
    return (v < 0 ? '-' : '') + (currency && currency !== 'USD' ? currency + ' ' : '$') + s;
  };

  /** In-app reason/note dialog (replaces window.prompt for maker-checker and audit trails). */
  mx.reasonModal = function (o) {
    var min = o.minLength == null ? 3 : o.minLength;
    var formId = o.formId || 'mxReasonForm';
    mx.modal({
      eyebrow: o.eyebrow || 'WORKSPACE',
      title: o.title || 'Reason required',
      subtitle: o.subtitle || '',
      body:
        '<form id="' +
        formId +
        '"><label class="v34-field wide"><span>' +
        (o.label || 'Reason') +
        '</span><textarea class="v34-input" name="reason" rows="' +
        (o.rows || 3) +
        '" required minlength="' +
        min +
        '"></textarea></label></form>',
      actions: [
        { label: o.cancelLabel || 'Cancel', run: function () {} },
        {
          label: o.confirmLabel || 'Continue',
          primary: true,
          run: function (m) {
            var reason = String(new FormData(m.querySelector('#' + formId)).get('reason') || '').trim();
            if (reason.length < min) throw new Error('Give at least ' + min + ' characters');
            return o.onConfirm(reason, m);
          },
        },
      ],
    });
  };

  /** Session download when the API streams CSV/XLSX bytes (not a signed {url} JSON). */
  mx.streamDownload = function (path, fallbackName) {
    return fetch(mx.api + path, { credentials: 'include' }).then(function (res) {
      if (!res.ok) {
        return res.json().then(
          function (j) {
            throw (j && j.error) || { message: 'Export failed' };
          },
          function () {
            throw { message: 'Export failed (' + res.status + ')' };
          },
        );
      }
      var name = ((res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1] || fallbackName || 'export';
      return res.blob().then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 500);
      });
    });
  };
})();
