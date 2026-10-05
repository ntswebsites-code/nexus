/** W6 DATA_HOOKS: NAV, accounting, regulatory obligations, report runs. */
const liveNav = `(window.mx&&window.mx.live&&window.mx.strict('valuation'))`;
const liveAcct = `(window.mx&&window.mx.live&&window.mx.strict('accounting'))`;
const liveReg = `(window.mx&&window.mx.live&&window.mx.strict('regulatory'))`;
const liveReports = `(window.mx&&window.mx.live&&window.mx.strict('reports'))`;

export const DATA_HOOKS = {
  admin: {
    'v33-rebuild.js': [
      [`const reportRows=[`, `const reportRows=window.__mxData._reportRows33||(window.__mxData._reportRows33=[`],
      [`const obligations=[`, `const obligations=window.__mxData._obligations33||(window.__mxData._obligations33=[`],
    ],
    '01-inline.js': [
      [`let reports = [`, `let reports=window.__mxData._reportsInline||(window.__mxData._reportsInline=[`],
    ],
    'v34-enhancements.js': [
      [`const reportData=[`, `const reportData=window.__mxData._reportData34||(window.__mxData._reportData34=[`],
    ],
    'v49-enhancements.js': [
      [`const navState={`, `const navState=window.__mxData._navState49||(window.__mxData._navState49={`],
    ],
  },
};
