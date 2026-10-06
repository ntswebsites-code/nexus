/** W5 DATA_HOOKS: cash tables, recon breaks, financing store, corporate actions. */
const live = (key) => `window.__mxData&&window.__mxData.${key}||`;
const liveCash = `(window.mx&&window.mx.live&&window.mx.strict('cash'))`;
const liveRecon = `(window.mx&&window.mx.live&&window.mx.strict('reconciliations'))`;
const liveFin = `(window.mx&&window.mx.live&&window.mx.strict('financing'))`;

export const DATA_HOOKS = {
  admin: {
    '01-inline.js': [
      [`let cashJournals = [`, `let cashJournals = ${live('cashJournals')}[`],
      [`let cashReservations = [`, `let cashReservations = ${live('cashReservations')}[`],
      [`let cashExpectations = [`, `let cashExpectations = ${live('cashExpectations')}[`],
      [`let statementImports = [`, `let statementImports = ${live('statementImports')}[`],
    ],
    '04-v12-user-focused-js.js': [
      [
        "localStorage.getItem('matanho-recon-v12')",
        `${liveRecon}?null:localStorage.getItem('matanho-recon-v12')`,
      ],
      [
        "localStorage.setItem('matanho-recon-v12'",
        `${liveRecon}?void 0:localStorage.setItem('matanho-recon-v12'`,
      ],
    ],
    '06-inline.js': [
      [`const v15CorpActions=[`, `const v15CorpActions=window.__mxData._v15CorpActions||[`],
    ],
    'v33-rebuild.js': [
      [`const breaks=[`, `const breaks=window.__mxData._reconBreaks33||[`],
      [`const facilities=[`, `const facilities=window.__mxData._facilities33||[`],
    ],
    'v52-enhancements.js': [
      [
        'function loadFin52(){try{fin52=JSON.parse(localStorage.getItem(',
        `function loadFin52(){if(${liveFin}&&window.__mxData._fin52){fin52=window.__mxData._fin52;return}try{fin52=JSON.parse(localStorage.getItem(`,
      ],
      [
        "localStorage.setItem('matanho-v52-financing'",
        `${liveFin}?void 0:localStorage.setItem('matanho-v52-financing'`,
      ],
    ],
    'v53-enhancements.js': [
      [
        "localStorage.getItem('matanho-v53-counterpart-imports')",
        `${liveRecon}?[]:localStorage.getItem('matanho-v53-counterpart-imports')`,
      ],
      [
        "localStorage.setItem('matanho-v53-counterpart-imports'",
        `${liveRecon}?void 0:localStorage.setItem('matanho-v53-counterpart-imports'`,
      ],
    ],
  },
};
