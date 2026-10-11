/* Admin bridge boot: load the signed-in user, then every permitted module's data. */

(function () {

  'use strict';

  var mx = window.mx;

  mx.boot(function () {

    return mx.loadMe().then(function (user) {

      // Re-apply role navigation now that the authenticated identity (and its
      // server-side permissions) is loaded — nav gating must follow mx.user.
      try {
        if (typeof applyRoleNav === 'function') applyRoleNav();
      } catch (e) {
        console.warn('[admin-bridge] nav re-apply failed', e);
      }

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

  window.addEventListener('matanho:legacy-ready', function () {

    setTimeout(function () {

      var nav = document.getElementById('sideNav');

      if (nav) {

        nav.dataset.expanded = 'true';

        if (typeof applyRoleNav === 'function') applyRoleNav();

      }

    }, 600);

  });

})();