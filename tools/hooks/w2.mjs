/** W2 DATA_HOOKS: portfolios list and IBOR positions read live arrays when signed in. */
const live = (key) => `window.__mxData&&window.__mxData.${key}||`;

export const DATA_HOOKS = {
  admin: {
    '01-inline.js': [
      [`const portfolios = [`, `const portfolios = ${live('portfolios')}[`],
      [`const institutionalPositions=[`, `const institutionalPositions=${live('institutionalPositions')}[`],
    ],
  },
};
