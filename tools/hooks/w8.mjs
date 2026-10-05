/** W8 DATA_HOOKS: private markets, data fabric, model governance. */
const liveModels = `(window.mx&&window.mx.live&&window.mx.strict('model-governance'))`;

export const DATA_HOOKS = {
  admin: {
    '06-inline.js': [
      [`const v15PrivateAssets=[`, `const v15PrivateAssets=window.__mxData._privateAssets15||(window.__mxData._privateAssets15=[`],
    ],
    'v33-rebuild.js': [
      [`const connections=[`, `const connections=window.__mxData._connections33||(window.__mxData._connections33=[`],
      [`const models=[`, `const models=window.__mxData._models33||(window.__mxData._models33=[`],
      [
        'function renderData(){const h=$',
        'function renderData(){if(window.mx&&window.mx.renderData)return window.mx.renderData();const h=$',
      ],
    ],
    'v37-enhancements.js': [
      [`let models37=[`, `let models37=window.__mxData._models37||(window.__mxData._models37=[`],
      [
        "try{const saved=JSON.parse(localStorage.getItem(MODEL_KEY37)||'null');",
        `try{const saved=${liveModels}?null:JSON.parse(localStorage.getItem(MODEL_KEY37)||'null');`,
      ],
    ],
  },
};
