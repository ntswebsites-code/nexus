/** W1 DATA_HOOKS: operations runbook reads live tasks from mx.data when signed in. */
const live = (key) => `window.__mxData&&window.__mxData.${key}||`;

export const DATA_HOOKS = {
  admin: {
    'v33-rebuild.js': [[`const opsTasks=[`, `const opsTasks=${live('opsTasks')}[`]],
  },
};
