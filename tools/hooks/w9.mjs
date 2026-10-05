/** W9 DATA_HOOKS: copilot demo bypass when live (RBAC/settings localStorage handled in W0 base hooks). */
const liveCopilot = `(window.mx&&window.mx.live&&window.mx.strict('copilot'))`;

export const DATA_HOOKS = {
  admin: {
    '06-inline.js': [
      [
        'function appendV15Copilot(q){const box=document.getElementById',
        `function appendV15Copilot(q){if(${liveCopilot})return;const box=document.getElementById`,
      ],
    ],
  },
};
