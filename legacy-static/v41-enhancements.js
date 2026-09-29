/* Matanho Nexus V41 - chart label deconfliction and dynamic visual alignment */
(()=>{'use strict';
const $=(q,r=document)=>r.querySelector(q), $$=(q,r=document)=>[...r.querySelectorAll(q)];

function deconflictOrderChart(){
  const shell=$('#page-orders .v36-tv-shell');
  const stage=shell&&$('.v36-tv-stage',shell);
  if(!shell||!stage)return;
  shell.classList.add('v41-chart-shell');
  let key=$('.v41-chart-key',shell);
  const legacyLegend=$('.v36-tv-legend',stage);
  const status=$('.v38-chart-status',stage);
  if(!key){
    key=document.createElement('div');
    key.className='v36-tv-legend v41-chart-key';
    const series=document.createElement('div');
    series.className='v41-key-series';
    key.appendChild(series);
    stage.before(key);
  }
  const series=$('.v41-key-series',key);
  if(legacyLegend&&series){
    series.innerHTML=legacyLegend.innerHTML;
    legacyLegend.remove();
  }
  if(status&&status.parentElement!==key)key.appendChild(status);
}

function markVisualRows(){
  // Add a stable marker to dynamic cards so rerenders retain stretch behaviour.
  $$('#page-risk .v37-risk-card,#page-operations .v36-chart-card,#page-orders .v33-card').forEach(c=>c.classList.add('v41-stretch-card'));
}

function keepControlsInView(){
  $$('.page-actions,.v33-actions,.v36-ops-actions,.v37-risk-actions').forEach(row=>{
    row.style.maxWidth='100%';
  });
  $$('.v33-kpi small,.v36-ops-kpi small,.v37-risk-kpi small').forEach(el=>el.removeAttribute('title'));
}

let frame=0;
function enhance(){
  cancelAnimationFrame(frame);
  frame=requestAnimationFrame(()=>{
    deconflictOrderChart();
    markVisualRows();
    keepControlsInView();
    document.documentElement.dataset.release='v41';
  });
}
function boot(){
  enhance();
  setTimeout(enhance,500);
  setTimeout(enhance,1400);
  new MutationObserver(m=>{if(m.some(x=>x.addedNodes.length||x.type==='attributes'))enhance()}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  window.addEventListener('resize',enhance,{passive:true});
  console.info('Matanho Nexus V41 chart-fit enhancements ready');
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,2100));else setTimeout(boot,2100);
})();
