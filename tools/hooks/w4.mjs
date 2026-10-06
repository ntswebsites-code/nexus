/** W4 DATA_HOOKS: research universe, risk limits, performance chart series when signed in. */
const live = (key) => `window.__mxData&&window.__mxData.${key}||`;
const liveResearch = `(window.mx&&window.mx.live&&window.mx.strict('research'))`;
const liveRisk = `(window.mx&&window.mx.live&&window.mx.strict('risk'))`;
const livePerf = `(window.mx&&window.mx.live&&window.mx.strict('performance'))`;

export const DATA_HOOKS = {
  admin: {
    '01-inline.js': [[`const research = [`, `const research=window.__mxData._research||[`]],
    '02-v7-institutional-enhancement-js.js': [
      [`const equityResearchData={`, `const equityResearchData=window.__mxData._equityResearch||{`],
      [`const researchNotes={};`, `const researchNotes=window.__mxData._researchNotes||{};`],
    ],
    'v37-enhancements.js': [[`let riskLimits37=[`, `let riskLimits37=window.__mxData._riskLimits37||[`]],
    '08-inline.js': [
      [
        'function v17PerfSeries(){const anchors=',
        `function v17PerfSeries(){if(${livePerf}&&window.__mxData._v17PerfRows&&window.__mxData._v17PerfRows.length)return window.__mxData._v17PerfRows;const anchors=`,
      ],
    ],
  },
};
