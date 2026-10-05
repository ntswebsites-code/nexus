/* Admin bridge boot: load the signed-in user, then every permitted module's data. */
(function () {
  'use strict';
  var mx = window.mx;
  mx.boot(function () {
    return mx.loadMe().then(function (user) {
      return Promise.all(
        mx.loaders
          .filter(function (l) {
            return !l.perm || mx.can(l.perm);
          })
          .map(function (l) {
            return Promise.resolve()
              .then(function () {
                return l.fn(user);
              })
              .catch(function (err) {
                console.warn('[admin-bridge] loader failed', err);
              });
          }),
      );
    });
  });

  /* Unlisted staff link to the demoted native console (reference only, not in the sidebar). */
  window.addEventListener('matanho:legacy-ready', function () {
    mx.wrapGlobal('openDrawer', function (original, args) {
      var result = original.apply(this, args);
      if (!mx.live || !mx.can('admin.settings')) return result;
      var body = document.getElementById('drawerBody');
      if (!body || body.querySelector('[data-mx-ops-native]')) return result;
      var actions = body.querySelector('.form-actions');
      if (!actions) return result;
      var link = document.createElement('a');
      link.href = '/ops-native';
      link.className = 'btn secondary';
      link.setAttribute('data-mx-ops-native', '1');
      link.style.fontSize = '11px';
      link.style.opacity = '0.65';
      link.textContent = 'Native console (reference)';
      actions.appendChild(link);
      return result;
    });
  });
})();
