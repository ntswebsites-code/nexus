/* Matanho Nexus V51 — simplify Orders & Execution around analyse + execute. */
(()=>{'use strict';
const $=(q,r=document)=>r.querySelector(q), $$=(q,r=document)=>[...r.querySelectorAll(q)];

function simplifyOrders51(){
  const page=$('#page-orders'); if(!page)return;
  const eye=$('.v33-head .v33-eyebrow',page), desc=$('.v33-head p',page);
  if(eye)eye.textContent='ANALYSE · DECIDE · EXECUTE';
  if(desc)desc.textContent='Select a security, analyse price, position, liquidity and research, then execute from one controlled order ticket.';
  const newOrder=$('#v33NewOrder',page); if(newOrder)newOrder.textContent='New order';

  const tabs=$$('#v33OrderMainTabs [data-v33-order-main]',page);
  tabs.forEach(b=>{
    const k=b.dataset.v33OrderMain;
    if(k==='workstation')b.textContent='Analyse & trade';
    if(k==='blotter')b.textContent='Orders';
    if(k==='approvals')b.textContent='Approvals';
  });

  const secTabs=$$('#v33SecurityTabs [data-v33-sec-tab]',page);
  secTabs.forEach(b=>{
    const k=b.dataset.v33SecTab;
    if(k==='chart')b.textContent='Price';
    if(k==='orders')b.textContent='Working orders';
  });

  const localHead=$('.v33-orders-top>aside .v33-card-head',page);
  if(localHead){const k=$('.v33-kicker',localHead),h=$('h2',localHead);if(k)k.textContent='MARKET';if(h)h.textContent='ZSE + VFEX securities'}

  const securityHead=$('.v33-security-head',page);
  if(securityHead){
    const small=$('small',securityHead); if(small)small.textContent=small.textContent.replace(/\s*·\s*(Open|Closed|Active|Trading).*$/i,'');
  }

  /* Preserve market depth, but move it behind progressive disclosure. */
  const depth=$('.v35-depth-board',page);
  if(depth&&!depth.closest('.v51-depth-details')){
    const d=document.createElement('details');d.className='v51-depth-details';
    d.innerHTML='<summary>Market depth & tradeability</summary>';
    depth.parentNode.insertBefore(d,depth);d.appendChild(depth);
  }

  /* There must be one primary route into the ticket. */
  $('#v39QuickOrder',page)?.remove();
  const helper=$('#v39OrderHelper',page); if(helper)helper.remove();
  page.dataset.v51SimpleOrders='1';
}

function tuneOrderTicket51(){
  const ticket=$('#v44OrderTicket.show'); if(!ticket)return;
  const marketHead=$('.v44-order-card:first-child .v44-order-card-head',ticket);
  if(marketHead){const kicker=$('.v44-kicker',marketHead),h=$('h3',marketHead);if(kicker)kicker.textContent='SECURITY ANALYSIS';if(h)h.textContent='Price & valuation'}
  const instruction=$('.v44-order-card:nth-child(2) .v44-order-card-head',ticket);
  if(instruction){const kicker=$('.v44-kicker',instruction),h=$('h3',instruction);if(kicker)kicker.textContent='EXECUTION';if(h)h.textContent='Trade instruction'}
  const legend=$('.v48-order-legend-row',ticket);
  if(legend){
    const spans=$$('.v48-order-legend span',legend);if(spans[0])spans[0].innerHTML='<i class="price"></i>Price';if(spans[1])spans[1].textContent='Previous close shown in market context';
    const note=$('small',legend);if(note)note.textContent='Hover or tap the line for price detail';
  }
  const footer=$('.v44-order-footer',ticket);if(footer){const submit=$('#v44OrderSubmit',footer);if(submit)submit.textContent='Submit for approval';}
  ticket.dataset.v51OrderTicket='1';
}

function removeDecorativeGrid51(){
  /* Dynamic SVGs can be re-rendered after filters change. Mark explicit generated grid lines too. */
  $$('.v36-tv-stage svg line').forEach(line=>{
    const stroke=(line.getAttribute('stroke')||'').toLowerCase();
    if(stroke==='#e6ebf2'||stroke==='#f0f3f7')line.style.display='none';
  });
  $$('.v44-order-chart-stage svg .v48-order-hgrid,.v44-order-chart-stage svg .v48-order-prev').forEach(line=>line.style.display='none');
  $$('svg .grid,svg .gridline,svg .grid-line,.grid-lines line').forEach(line=>line.style.display='none');
}

let queued=false;
function enhance51(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;simplifyOrders51();tuneOrderTicket51();removeDecorativeGrid51();document.documentElement.dataset.release='v51'})}
function boot51(){enhance51();setTimeout(enhance51,550);setTimeout(enhance51,1600);new MutationObserver(enhance51).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});console.info('Matanho Nexus V51 order-focus enhancements ready')}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot51,3200));else setTimeout(boot51,3200);
})();
