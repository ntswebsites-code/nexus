/** W7 DATA_HOOKS: onboarding queue, vault register, service/onboarding KPI bypasses. */
const liveOnboarding = `(window.mx&&window.mx.live&&window.mx.strict('onboarding'))`;

export const DATA_HOOKS = {
  admin: {
    'v33-rebuild.js': [
      [`const docs=[`, `const docs=window.__mxData._vaultDocs33||[`],
    ],
    'v35-enhancements.js': [
      [
        'kycCases35=[...dynamic,...seedCases35.filter(x=>!seen.has(x.id))]',
        'kycCases35=[...(window.mx&&window.mx.live&&window.mx.data.onboardingQueue?window.mx.data.onboardingQueue:dynamic),...(window.mx&&window.mx.live?[]:seedCases35.filter(x=>!seen.has(x.id)))]',
      ],
      [
        'function renderKycKpis35(){const open=',
        'function renderKycKpis35(){if(window.mx&&window.mx.renderKycKpis35)return window.mx.renderKycKpis35();const open=',
      ],
    ],
    '03-v10-branding-kyc-js.js': [
      [
        "localStorage.getItem('matanho-client-profiles-v10')",
        `${liveOnboarding}?null:localStorage.getItem('matanho-client-profiles-v10')`,
      ],
    ],
  },
};
