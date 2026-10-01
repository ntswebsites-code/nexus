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
})();
