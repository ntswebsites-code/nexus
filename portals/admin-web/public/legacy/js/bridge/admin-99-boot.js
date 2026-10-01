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

  /* Link to the native operations console (/ops) for staff holding any fund-operations permission. */
  var OPS_PERMS = ['funds.view', 'capital.view', 'distributions.create', 'distributions.approve', 'distributions.settle', 'notices.view', 'dealing.view', 'term_sheets.view', 'custodian.view'];
  window.addEventListener('matanho:legacy-ready', function () {
    if (!mx.live || document.getElementById('mxOpsLink') || !OPS_PERMS.some(mx.can)) return;
    var nav = document.getElementById('sideNav');
    if (!nav) return;
    var link = document.createElement('a');
    link.id = 'mxOpsLink';
    link.className = 'nav-item';
    link.href = '/ops';
    link.style.textDecoration = 'none';
    link.innerHTML = '<svg><use href="#i-ops"></use></svg><span>Operations Console</span><em>New</em>';
    link.addEventListener('click', function (ev) {
      ev.stopPropagation();
    });
    var section = [].slice.call(nav.querySelectorAll('.nav-section')).filter(function (s) {
      return /control/i.test(s.textContent);
    })[0];
    if (section) nav.insertBefore(link, section.nextSibling);
    else nav.appendChild(link);
  });
})();
