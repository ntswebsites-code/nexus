/** W1 DATA_HOOKS: operations runbook + command centre gio charts read live API data when signed in. */
const live = (key) => `window.__mxData&&window.__mxData.${key}||`;
const liveCommand = `(window.mx&&window.mx.live&&window.mx.strict('command'))`;

export const DATA_HOOKS = {
  admin: {
    'v33-rebuild.js': [[`const opsTasks=[`, `const opsTasks=${live('opsTasks')}[`]],
    '09-v30-chart-engine.js': [
      [
        `function renderPerformance(range='YTD'){\n const svg=$('#commandPerformanceSvg'); if(!svg)return;`,
        `function renderPerformance(range='YTD'){\n if(window.mx&&window.mx.live&&window.mx.strict('command')&&window.__mxData&&window.__mxData._commandPerfLive)return;\n const svg=$('#commandPerformanceSvg'); if(!svg)return;`,
      ],
      [
        `const items=[['Security selection',1.24],['Asset allocation',.46],['FX',.28],['Implementation',.18],['Fees',-.06]]`,
        `const items=${liveCommand}&&window.__mxData._gioAttribution?window.__mxData._gioAttribution:[['Security selection',1.24],['Asset allocation',.46],['FX',.28],['Implementation',.18],['Fees',-.06]]`,
      ],
      [
        `const W=620,H=300,L=48,R=22,T=20,B=42,steps=13,x=i=>L+(W-L-R)*i/(steps-1),base=[0,.18,.36,.52,.70,.88,1.06,1.18,1.36,1.52,1.65,1.82,1.92]`,
        `const W=620,H=300,L=48,R=22,T=20,B=42,steps=13,x=i=>L+(W-L-R)*i/(steps-1),base=${liveCommand}&&window.__mxData._gioScenarioBase?window.__mxData._gioScenarioBase:[0,.18,.36,.52,.70,.88,1.06,1.18,1.36,1.52,1.65,1.82,1.92]`,
      ],
      [
        `const cols=['Listed','Fixed','Private','Real assets','Cash'],rows=[['Growth',[90,22,76,48,8]],['Rates',[26,88,42,53,18]],['FX',[68,33,59,47,36]],['Credit',[32,72,81,55,15]],['Liquidity',[47,36,79,64,12]]]`,
        `const cols=${liveCommand}&&window.__mxData._gioRiskHeatCols?window.__mxData._gioRiskHeatCols:['Listed','Fixed','Private','Real assets','Cash'],rows=${liveCommand}&&window.__mxData._gioRiskHeatRows?window.__mxData._gioRiskHeatRows:[['Growth',[90,22,76,48,8]],['Rates',[26,88,42,53,18]],['FX',[68,33,59,47,36]],['Credit',[32,72,81,55,15]],['Liquidity',[47,36,79,64,12]]]`,
      ],
      [
        `const data=[['Opening cash',7.12],['Settlements',-.84],['Income',.38],['Capital calls',-1.46],['Redemptions',-.42],['Closing cash',4.78]]`,
        `const data=${liveCommand}&&window.__mxData._gioLiquidity?window.__mxData._gioLiquidity:[['Opening cash',7.12],['Settlements',-.84],['Income',.38],['Capital calls',-1.46],['Redemptions',-.42],['Closing cash',4.78]]`,
      ],
      [
        `function updateScope(scope){currentScope=scope;const d=SCOPE[scope]||SCOPE.whole;`,
        `function updateScope(scope){currentScope=scope;const d=${liveCommand}&&window.__mxData._gioScope&&window.__mxData._gioScope[scope]?window.__mxData._gioScope[scope]:(SCOPE[scope]||SCOPE.whole);`,
      ],
      [
        `const vals=[2.08,2.02,1.92,1.83,1.72,1.59,1.65,1.67,1.64],labs=['Now','T+1','T+2','T+3','T+4','T+5','T+10','T+20','T+30'],`,
        `const mxMini=${liveCommand}&&window.__mxData._gioMiniLiquidity;const vals=mxMini?mxMini.vals:[2.08,2.02,1.92,1.83,1.72,1.59,1.65,1.67,1.64],labs=mxMini?mxMini.labs:['Now','T+1','T+2','T+3','T+4','T+5','T+10','T+20','T+30'],`,
      ],
      [
        `if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,420));else setTimeout(init,420);`,
        `window.__mxRerenderCommandCharts=function(){renderAttribution();renderScenario();renderRiskHeat();renderLiquidityWaterfall();renderMiniLiquidity();};window.__mxApplyGioScope=function(s){updateScope(s);};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,420));else setTimeout(init,420);`,
      ],
    ],
  },
};
