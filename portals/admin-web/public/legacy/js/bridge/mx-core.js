/*
 * Matanho legacy data bridge - core.
 *
 * Loaded before the prototype scripts (see LegacyScripts). Portal bridges use
 * it to fetch live data from the shared API into `window.__mxData`, which the
 * prototype's data declarations read first (patched in tools/legacy-bridge.mjs),
 * and to intercept prototype actions so they persist through the API.
 * If the API is unreachable or the user is signed out, `__mxData` stays empty
 * and the prototype falls back to its original demo data.
 */
(function () {
  'use strict';
  var API = String(window.__MATANHO_API__ || '').replace(/\/+$/, '');
  var data = (window.__mxData = window.__mxData || {});
  var mx = (window.mx = window.mx || {});
  mx.api = API;
  mx.data = data;
  mx.live = false;
  mx.user = null;

  var PAGE_PERMS = {
    command: 'dashboard.view',
    portfolios: 'portfolio.view',
    'private-markets': 'portfolio.view',
    'portfolio-lab': 'portfolio.view',
    orders: 'orders.view',
    research: 'research.view',
    risk: 'risk.view',
    performance: 'reports.view',
    clients: 'clients.view',
    'investor-services': 'clients.view',
    onboarding: 'onboarding.view',
    ibor: 'portfolio.view',
    financing: 'risk.view',
    cash: 'cash.view',
    reports: 'reports.view',
    vault: 'documents.view',
    operations: 'operations.view',
    reconciliations: 'operations.view',
    'corporate-actions': 'operations.view',
    valuation: 'valuation.view',
    accounting: 'valuation.view',
    regulatory: 'reports.view',
    data: 'operations.view',
    'model-governance': 'risk.view',
    copilot: 'dashboard.view',
    rbac: 'admin.rbac',
    settings: 'admin.settings',
    audit: 'audit.view',
  };

  var hydrators = {};
  var hydrated = {};

  function ApiError(status, body) {
    var e = new Error((body && body.message) || 'Request failed (' + status + ')');
    e.status = status;
    e.code = (body && body.code) || 'http_error';
    e.details = body && body.details;
    e.fieldErrors = body && body.fieldErrors;
    return e;
  }

  function unwrap(payload) {
    if (payload && typeof payload === 'object' && 'data' in payload) return payload.data;
    return payload;
  }

  mx.uuid = function () {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '-' + Math.random().toString(36).slice(2);
  };

  mx.qs = function (obj) {
    var sp = new URLSearchParams();
    for (var k in obj || {}) if (obj[k] != null && obj[k] !== '') sp.set(k, obj[k]);
    var s = sp.toString();
    return s ? '?' + s : '';
  };

  mx.versioned = function (row) {
    return row && row.version != null ? String(row.version) : undefined;
  };

  var stepUpPending = null;
  var stepUpKey = null;

  function stepUpModal() {
    if (stepUpPending) return stepUpPending;
    stepUpPending = new Promise(function (resolve, reject) {
      var esc = function (v) {
        return String(v == null ? '' : v).replace(/[&<>'"]/g, function (c) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c];
        });
      };
      var wrap = document.createElement('div');
      wrap.setAttribute('role', 'dialog');
      wrap.setAttribute('aria-modal', 'true');
      wrap.style.cssText =
        'position:fixed;inset:0;z-index:2147483646;background:rgba(15,24,38,.45);display:grid;place-items:center;font:13px/1.5 Inter,system-ui,sans-serif';
      var card =
        'background:#fff;border-radius:14px;padding:22px 24px;width:min(420px,92vw);box-shadow:0 24px 60px rgba(15,34,65,.28);color:#10213a';
      var btn =
        'border:1px solid #d5dce7;background:#fff;border-radius:9px;padding:8px 14px;font:600 12px Inter,system-ui,sans-serif;cursor:pointer';
      var primary = btn + ';background:#0f2a4a;border-color:#0f2a4a;color:#fff';
      var close = function (ok) {
        wrap.remove();
        stepUpPending = null;
        if (ok) resolve();
        else {
          var err = new Error('Confirmation cancelled');
          err.code = 'step_up_cancelled';
          reject(err);
        }
      };
      wrap.innerHTML =
        '<div style="' +
        card +
        '"><div style="font-size:10px;letter-spacing:.08em;color:#5d6877;font-weight:700">STEP-UP REQUIRED</div>' +
        '<h2 style="margin:4px 0 10px;font-size:17px">Confirm this action</h2>' +
        '<p>Enter the 6-digit code from your authenticator app.</p>' +
        '<form id="mxStepUpForm"><input id="mxStepUpCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="\\d{6}" required placeholder="123456" style="width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #d5dce7;border-radius:9px;font-size:16px;letter-spacing:.3em">' +
        '<p id="mxStepUpErr" style="color:#a9253e;font-size:12px;min-height:18px;margin:6px 0 0"></p>' +
        '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px"><button type="button" data-x style="' +
        btn +
        '">Cancel</button><button type="submit" style="' +
        primary +
        '">Confirm</button></div></form></div>';
      document.body.appendChild(wrap);
      wrap.querySelector('[data-x]').onclick = function () {
        close(false);
      };
      wrap.querySelector('#mxStepUpCode').focus();
      wrap.querySelector('#mxStepUpForm').onsubmit = function (ev) {
        ev.preventDefault();
        var code = wrap.querySelector('#mxStepUpCode').value.replace(/\s+/g, '');
        request('POST', '/api/auth/mfa/step-up', { code: code }, { noStepUp: true, idem: false })
          .then(function () {
            close(true);
          })
          .catch(function (e) {
            wrap.querySelector('#mxStepUpErr').textContent = esc((e && e.message) || 'That code is not valid.');
          });
      };
    });
    return stepUpPending;
  }

  function request(method, path, body, opts) {
    opts = opts || {};
    var headers = { Accept: 'application/json' };
    var payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    var mutating = /^(POST|PUT|PATCH)$/i.test(method);
    if (mutating && opts.idem !== false) {
      if (!opts.idempotencyKey) opts.idempotencyKey = stepUpKey || mx.uuid();
      headers['Idempotency-Key'] = opts.idempotencyKey;
      if (!stepUpKey) stepUpKey = opts.idempotencyKey;
    }
    if (opts.version != null) headers['If-Match'] = String(opts.version);
    if (opts.headers) for (var k in opts.headers) headers[k] = opts.headers[k];
    return fetch(API + path, { method: method, headers: headers, body: payload, credentials: 'include' }).then(function (res) {
      return res.text().then(function (text) {
        var json;
        try {
          json = text ? JSON.parse(text) : undefined;
        } catch (e) {
          json = undefined;
        }
        if (res.ok) {
          stepUpKey = null;
          return unwrap(json);
        }
        var errBody = json && json.error;
        var err = ApiError(res.status, errBody);
        if (res.status === 401 && err.code === 'step_up_required' && !opts.noStepUp) {
          return stepUpModal().then(function () {
            return request(method, path, body, {
              headers: opts.headers,
              noStepUp: true,
              idempotencyKey: opts.idempotencyKey || stepUpKey,
              version: opts.version,
              idem: opts.idem,
            });
          });
        }
        if (res.status === 409 && err.code === 'version_conflict') {
          mx.toast('Conflict', err.message || 'This record was changed by someone else. Reloading.', 'error');
        }
        throw err;
      });
    });
  }

  mx.request = request;
  mx.get = function (p) {
    return request('GET', p);
  };
  mx.post = function (p, b, o) {
    return request('POST', p, b === undefined ? {} : b, o);
  };
  mx.put = function (p, b, o) {
    return request('PUT', p, b, o);
  };
  mx.patch = function (p, b, o) {
    return request('PATCH', p, b, o);
  };
  mx.del = function (p, o) {
    return request('DELETE', p, undefined, o);
  };

  mx.list = function (path, params) {
    return mx.get(path + mx.qs(params)).then(function (data) {
      if (data && typeof data === 'object' && 'rows' in data) {
        return { rows: data.rows, total: data.total, page: data.page, pageSize: data.pageSize };
      }
      if (Array.isArray(data)) return { rows: data, total: data.length, page: 1, pageSize: data.length };
      return { rows: [], total: 0, page: 1, pageSize: 0 };
    });
  };

  /** Uploads File objects; resolves to [{id,name,size,mime}]. */
  mx.upload = function (files) {
    var list = [].slice.call(files || []).filter(Boolean);
    if (!list.length) return Promise.resolve([]);
    var fd = new FormData();
    list.forEach(function (f) {
      fd.append('file', f, f.name);
    });
    return request('POST', '/api/v1/uploads', fd).then(function (r) {
      return r.files;
    });
  };
  /** Opens a signed download URL returned by `path` ({url}). */
  mx.download = function (path) {
    var win = window.open('about:blank', '_blank');
    return mx.get(path).then(
      function (r) {
        if (win) win.location.href = r.url;
        else window.location.href = r.url;
      },
      function (e) {
        if (win) win.close();
        throw e;
      },
    );
  };

  /** Toast via the prototype's own toast() when present, otherwise a minimal fallback. */
  mx.toast = function (title, message, kind) {
    try {
      if (typeof window.toast === 'function') return window.toast(title, message || '', kind || 'success');
    } catch (e) {
      /* fall through */
    }
    var box = document.createElement('div');
    box.setAttribute('role', 'status');
    box.style.cssText =
      'position:fixed;right:18px;bottom:18px;z-index:2147483647;max-width:360px;padding:11px 14px;border-radius:10px;' +
      'font:600 12px/1.45 Inter,system-ui,sans-serif;box-shadow:0 10px 30px rgba(15,34,65,.18);color:#fff;background:' +
      (kind === 'error' ? '#a9253e' : kind === 'warn' ? '#9a6400' : '#1d2a3b');
    box.textContent = title + (message ? ' - ' + message : '');
    document.body.appendChild(box);
    setTimeout(function () {
      box.remove();
    }, 4200);
  };

  mx.fail = function (err, form) {
    if (err && err.code === 'step_up_cancelled') return;
    console.warn('[mx-bridge]', err);
    var msg = (err && err.message) || 'The server rejected this action.';
    if ((err && err.code === 'not_implemented') || (err && err.status === 501)) msg = 'Not available yet';
    if (err && err.code === 'segregation_of_duties') msg = 'A different approver is required. ' + msg;
    if (err && err.code === 'forbidden') msg = 'You do not have permission for this action. ' + msg;
    if (err && err.fieldErrors) {
      var reasons = Object.keys(err.fieldErrors)
        .map(function (k) {
          return err.fieldErrors[k];
        })
        .filter(function (r) {
          return r && msg.indexOf(r) < 0;
        });
      if (reasons.length) msg = msg + (msg.endsWith('.') ? ' ' : '. ') + reasons.slice(0, 3).join('. ');
      if (form) {
        Object.keys(err.fieldErrors).forEach(function (field) {
          var input = form.querySelector('[name="' + field + '"],#' + field);
          if (input) input.setAttribute('aria-invalid', 'true');
        });
      }
    }
    mx.toast('Not saved', msg, 'error');
  };

  /**
   * Capture-phase click interception. `handler(el, event)` may return a promise;
   * when `opts.thenNative` is set and the handler succeeds (does not return
   * false), the original prototype handler is replayed so the UI updates exactly
   * as before.
   */
  mx.intercept = function (selector, handler, opts) {
    opts = opts || {};
    document.addEventListener(
      'click',
      function (event) {
        var el = event.target && event.target.closest ? event.target.closest(selector) : null;
        if (!el || el.__mxPass) return;
        if (opts.when && !opts.when(el, event)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (el.__mxBusy) return;
        el.__mxBusy = true;
        Promise.resolve()
          .then(function () {
            return handler(el, event);
          })
          .then(function (result) {
            if (result !== false && opts.thenNative) {
              el.__mxPass = true;
              try {
                el.click();
              } finally {
                el.__mxPass = false;
              }
            }
          })
          .catch(mx.fail)
          .finally(function () {
            el.__mxBusy = false;
          });
      },
      true,
    );
  };

  /**
   * Capture-phase form submit interception; on success the original submit
   * handlers run (so the prototype updates its UI) and `after(result)` is called.
   */
  mx.interceptSubmit = function (selector, handler, opts) {
    opts = opts || {};
    document.addEventListener(
      'submit',
      function (event) {
        var form = event.target;
        if (!form || !form.matches || !form.matches(selector) || form.__mxPass) return;
        if (opts.when && !opts.when(form, event)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (form.__mxBusy) return;
        form.__mxBusy = true;
        Promise.resolve()
          .then(function () {
            return handler(form, event);
          })
          .then(function (result) {
            if (result === false) return;
            form.__mxPass = true;
            try {
              form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            } finally {
              form.__mxPass = false;
            }
            if (opts.after) opts.after(result, form);
          })
          .catch(mx.fail)
          .finally(function () {
            form.__mxBusy = false;
          });
      },
      true,
    );
  };

  /** Wraps a global prototype function once the prototype has loaded. */
  mx.wrapGlobal = function (name, wrapper) {
    window.addEventListener('matanho:legacy-ready', function () {
      var original = window[name];
      if (typeof original !== 'function' || original.__mxWrapped) return;
      var wrapped = function () {
        return wrapper.call(this, original, [].slice.call(arguments));
      };
      wrapped.__mxWrapped = true;
      window[name] = wrapped;
    });
  };

  /** Replace an array's contents in place (keeps references held by prototype code). */
  mx.replace = function (target, items) {
    if (!Array.isArray(target)) return;
    target.splice.apply(target, [0, target.length].concat(items || []));
  };

  /** Runs `fn` when `page` is first opened and on `mx.refresh(page)`. */
  mx.hydrate = function (page, fn) {
    hydrators[page] = fn;
  };

  mx.refresh = function (page) {
    hydrated[page] = false;
    if (hydrators[page]) return runHydrate(page);
    return Promise.resolve();
  };

  function runHydrate(page) {
    hydrated[page] = true;
    return Promise.resolve(hydrators[page]()).catch(function (e) {
      console.warn('[mx-hydrate]', page, e);
    });
  }

  mx.gate = function (el, perm, opts) {
    opts = opts || {};
    if (!el) return;
    var allowed = mx.can(perm);
    if (allowed) return;
    if (opts.hide) el.style.display = 'none';
    else {
      el.disabled = true;
      el.setAttribute('aria-disabled', 'true');
      el.title = opts.reason || 'You do not have permission for this action';
    }
  };

  mx.badge = function (page, n) {
    var item = document.querySelector('.nav-item[data-page="' + page + '"] em');
    if (!item) return;
    if (n == null || n === 0) item.textContent = '';
    else item.textContent = String(n);
  };

  mx.strict = function (page) {
    if (!mx.live) return false;
    var perm = PAGE_PERMS[page];
    return !perm || mx.can(perm);
  };

  /** Re-render a table body using existing row classes. cols: [{key, render?}] */
  mx.table = function (el, rows, cols) {
    if (!el) return;
    var tbody = el.tagName === 'TBODY' ? el : el.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = (rows || [])
      .map(function (row) {
        var cells = (cols || [])
          .map(function (col) {
            var val = col.render ? col.render(row) : row[col.key];
            return '<td' + (col.className ? ' class="' + col.className + '"' : '') + '>' + (val == null ? '' : val) + '</td>';
          })
          .join('');
        var id = row.id != null ? ' data-id="' + String(row.id).replace(/"/g, '&quot;') + '"' : '';
        return '<tr' + id + '>' + cells + '</tr>';
      })
      .join('');
  };

  mx.time = function (iso) {
    var d = iso ? new Date(iso) : new Date();
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  mx.date = function (iso, opts) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-GB', opts || { day: '2-digit', month: 'short', year: 'numeric' });
  };
  mx.$ = function (s, r) {
    return (r || document).querySelector(s);
  };
  mx.$$ = function (s, r) {
    return [].slice.call((r || document).querySelectorAll(s));
  };

  /**
   * Registers the portal's initial load. LegacyScripts waits for it (with a
   * timeout) before evaluating the prototype scripts.
   */
  mx.boot = function (loader) {
    window.__matanhoBridgeReady = Promise.resolve()
      .then(loader)
      .then(function () {
        mx.live = true;
        document.documentElement.dataset.mxLive = '1';
      })
      .catch(function (err) {
        if (err && err.status === 401) console.info('[mx-bridge] signed out - showing prototype data');
        else console.warn('[mx-bridge] live data unavailable - showing prototype data', err);
      });
    return window.__matanhoBridgeReady;
  };

  mx.wrapGlobal('navigate', function (original, args) {
    var page = args[0];
    var result = original.apply(this, args);
    if (hydrators[page] && !hydrated[page]) runHydrate(page);
    return result;
  });

  /**
   * Two-factor set-up dialog (self-contained so it works in every legacy UI).
   * Shows the current status; when not enrolled, issues a TOTP key and verifies
   * the first code. Resolves true once enrolled.
   */
  mx.mfaSetup = function () {
    var esc = function (v) {
      return String(v == null ? '' : v).replace(/[&<>'"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c];
      });
    };
    return mx.get('/api/auth/mfa/status').then(function (status) {
      return new Promise(function (resolve) {
        var wrap = document.createElement('div');
        wrap.setAttribute('role', 'dialog');
        wrap.setAttribute('aria-modal', 'true');
        wrap.style.cssText =
          'position:fixed;inset:0;z-index:2147483646;background:rgba(15,24,38,.45);display:grid;place-items:center;font:13px/1.5 Inter,system-ui,sans-serif';
        var card =
          'background:#fff;border-radius:14px;padding:22px 24px;width:min(420px,92vw);box-shadow:0 24px 60px rgba(15,34,65,.28);color:#10213a';
        var btn =
          'border:1px solid #d5dce7;background:#fff;border-radius:9px;padding:8px 14px;font:600 12px Inter,system-ui,sans-serif;cursor:pointer';
        var primary = btn + ';background:#0f2a4a;border-color:#0f2a4a;color:#fff';
        var close = function (ok) {
          wrap.remove();
          resolve(!!ok);
        };
        var head =
          '<div style="font-size:10px;letter-spacing:.08em;color:#5d6877;font-weight:700">ACCOUNT SECURITY</div><h2 style="margin:4px 0 10px;font-size:17px">Two-factor authentication</h2>';
        if (status.enrolled) {
          wrap.innerHTML =
            '<div style="' +
            card +
            '">' +
            head +
            '<p>Enabled' +
            (status.enrolledAt
              ? ' since ' +
                esc(
                  new Date(status.enrolledAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
                )
              : '') +
            '. Approvals and signatures ask for a fresh code.</p><p style="color:#5d6877;font-size:12px">Lost your device? Ask a System Administrator to reset your second factor.</p><div style="text-align:right;margin-top:14px"><button type="button" data-x style="' +
            primary +
            '">Done</button></div></div>';
          document.body.appendChild(wrap);
          wrap.querySelector('[data-x]').onclick = function () {
            close(true);
          };
          return;
        }
        wrap.innerHTML =
          '<div style="' +
          card +
          '">' +
          head +
          '<p id="mxMfaIntro">Preparing a new key…</p><form id="mxMfaForm" style="display:none"><p>Add this key to your authenticator app (Microsoft Authenticator, Google Authenticator, 1Password…), then enter the 6-digit code it shows.</p>' +
          '<code id="mxMfaSecret" style="display:block;padding:10px;border-radius:8px;background:#f3f6fa;font-size:14px;letter-spacing:.08em;word-break:break-all"></code><a id="mxMfaLink" style="display:inline-block;margin:6px 0 10px;font-size:12px">Open in authenticator app</a>' +
          '<input id="mxMfaCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="\\d{6}" required placeholder="123456" style="width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #d5dce7;border-radius:9px;font-size:16px;letter-spacing:.3em">' +
          '<p id="mxMfaErr" style="color:#a9253e;font-size:12px;min-height:18px;margin:6px 0 0"></p><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px"><button type="button" data-x style="' +
          btn +
          '">Cancel</button><button type="submit" style="' +
          primary +
          '">Verify & enable</button></div></form></div>';
        document.body.appendChild(wrap);
        wrap.querySelector('[data-x]').onclick = function () {
          close(false);
        };
        mx.post('/api/auth/mfa/enroll', {}).then(
          function (r) {
            wrap.querySelector('#mxMfaIntro').style.display = 'none';
            wrap.querySelector('#mxMfaForm').style.display = '';
            wrap.querySelector('#mxMfaSecret').textContent = r.secret.replace(/(.{4})/g, '$1 ').trim();
            wrap.querySelector('#mxMfaLink').href = r.otpauthUri;
            wrap.querySelector('#mxMfaCode').focus();
          },
          function (e) {
            wrap.querySelector('#mxMfaIntro').textContent = (e && e.message) || 'Could not start two-factor set-up.';
          },
        );
        wrap.querySelector('#mxMfaForm').onsubmit = function (ev) {
          ev.preventDefault();
          var code = wrap.querySelector('#mxMfaCode').value.replace(/\s+/g, '');
          mx.post('/api/auth/mfa/verify', { code: code }).then(
            function () {
              mx.toast('Two-factor enabled', 'Approvals and signatures will now ask for a code from your authenticator.');
              close(true);
            },
            function (e) {
              wrap.querySelector('#mxMfaErr').textContent = (e && e.message) || 'That code is not valid.';
            },
          );
        };
      });
    });
  };

  mx.loadMe = function () {
    return mx.get('/api/auth/me').then(function (r) {
      mx.user = r.user;
      return r.user;
    });
  };
  mx.can = function (code) {
    return !!(mx.user && mx.user.permissions.indexOf(code) >= 0);
  };
})();
