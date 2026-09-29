/* Matanho Nexus V40 - unobscured UI + chart/card alignment */
(()=>{'use strict';
const $=(q,r=document)=>r.querySelector(q), $$=(q,r=document)=>[...r.querySelectorAll(q)];

function dockCopilot(){
  const fab=$('.v15-copilot-fab'); if(!fab||fab.classList.contains('v40-copilot-docked'))return;
  const host=$('.topbar-right'); if(!host)return;
  fab.classList.add('v40-copilot-docked');
  fab.title='Open Investment Copilot';
  const profile=$('.profile-button',host);
  if(profile)host.insertBefore(fab,profile);else host.appendChild(fab);
}

function markRiskCards(){
  const page=$('#page-risk.v37-risk'); if(!page)return;
  const cards=$$('.v37-risk-card',page);
  const map=[
    ['30-day liquidity cover','v40-risk-liquidity'],
    ['Budget utilisation','v40-risk-budget'],
    ['Risk contribution by factor','v40-risk-factor'],
    ['Where risk is concentrated','v40-risk-heatmap'],
    ['Build and run a portfolio stress','v40-risk-scenario'],
    ['What risk is calculated from','v40-risk-sources'],
    ['Signals requiring action','v40-risk-warning'],
    ['Human decision queue','v40-risk-cases']
  ];
  map.forEach(([title,cls])=>{const c=cards.find(x=>(x.querySelector('h2')?.textContent||'').includes(title));if(c)c.classList.add(cls)});
  const budget=$('.v40-risk-budget',page),body=budget&&$('.v37-risk-card-body',budget);
  if(body&&!$('.v40-budget-footer',body))body.insertAdjacentHTML('beforeend',`<div class="v40-budget-footer"><div><span>Available budget</span><strong>22%</strong><small>Portfolio capacity remaining</small></div><div><span>Nearest hard limit</span><strong>0.90%</strong><small>Delta issuer headroom</small></div><div><span>Stress buffer</span><strong>3 bps</strong><small>Above liquidity floor</small></div></div>`);
  const src=$('.v40-risk-sources',page),srcBody=src&&$('.v37-risk-card-body',src);
  if(srcBody&&!$('.v40-source-footer',srcBody))srcBody.insertAdjacentHTML('beforeend',`<div class="v40-source-footer"><div><span>Source coverage</span><strong>4 / 4 current</strong></div><div><span>Position cut-off</span><strong>15:42 CAT</strong></div><div><span>Model version</span><strong>RM-2026-07</strong></div></div>`);
}

function protectChartLabels(){
  // Keep labels inside visible chart bounds while allowing SVGs to occupy their host fully.
  $$('#page-risk .v38-risk-svg,#page-operations .v36-chart-stage svg,#page-orders .v38-trading-svg').forEach(svg=>{
    svg.style.maxWidth='100%';
    svg.style.display='block';
  });
}

function equaliseVisibleRows(){
  // CSS handles the normal case. This class marker makes dynamic pages re-apply after rerenders.
  ['#page-orders .v33-orders-top','#page-risk .v37-risk-grid','#page-operations .v36-chart-grid'].forEach(sel=>$(sel)?.classList.add('v40-aligned-grid'));
}

function improveTopbarFit(){
  const bar=$('.topbar-right');if(!bar)return;
  const ro=window.ResizeObserver?new ResizeObserver(()=>{
    const tight=window.innerWidth<1180;
    bar.classList.toggle('v40-tight',tight);
  }):null;
  ro?.observe(document.documentElement);
  bar.classList.toggle('v40-tight',window.innerWidth<1180);
}

let pending=false;
function enhance(){if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;dockCopilot();markRiskCards();protectChartLabels();equaliseVisibleRows();document.documentElement.dataset.release='v40'})}
function boot(){improveTopbarFit();enhance();setTimeout(enhance,450);setTimeout(enhance,1250);new MutationObserver(m=>{if(m.some(x=>x.addedNodes.length||x.type==='attributes'))enhance()}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});window.addEventListener('resize',enhance,{passive:true});console.info('Matanho Nexus V40 layout and chart-fit enhancements ready')}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,1800));else setTimeout(boot,1800);
})();
