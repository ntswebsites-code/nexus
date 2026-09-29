/* Matanho Nexus V47 — calmer orders and simplified client cash workspace */
(()=>{'use strict';
const $=(q,r=document)=>r.querySelector(q), $$=(q,r=document)=>[...r.querySelectorAll(q)];

function simplifyOrderFlow(){
  const host=$('#page-orders #v45OrderFlow'); if(!host)return;
  const head=$('.v45-order-flow-head',host), actions=$('.v45-order-flow-actions',host);
  if(head){const h2=$('h2',head);if(h2)h2.textContent='Active order lifecycle';}
  if(actions&&!$('#v47FlowToggle',host)){
    const b=document.createElement('button');b.type='button';b.id='v47FlowToggle';b.className='v45-btn v47-flow-toggle';b.textContent='View lifecycle';b.setAttribute('aria-expanded','false');
    b.onclick=()=>{const open=host.classList.toggle('v47-flow-open');b.textContent=open?'Hide lifecycle':'View lifecycle';b.setAttribute('aria-expanded',String(open));};
    actions.insertBefore(b,actions.firstChild);
  }
}

function simplifyClients(){
  const page=$('#page-clients'); if(!page||!page.classList.contains('v43-clients-page'))return;
  const eyebrow=$('.page-head .eyebrow',page),desc=$('.page-head p',page);
  if(eyebrow)eyebrow.textContent='RELATIONSHIPS · CASH · CONTROLS';
  if(desc)desc.textContent='Select a client, see what needs attention, and manage linked cash accounts from one place.';
  const summary=$('.v43-summary',page);
  if(summary&&(summary.children.length!==3||!summary.firstElementChild?.textContent.includes('Relationships')))summary.innerHTML=`<article><span>Relationships</span><strong>184</strong><small>Active client relationships</small></article><article><span>Available cash</span><strong>US$ 11.86M</strong><small>Across controlled accounts</small></article><article><span>Needs attention</span><strong class="attention">8</strong><small>6 KYC reviews · 2 cash exceptions</small></article>`;
  $$('[data-v43-main]',page).forEach(b=>{if(b.dataset.v43Main==='relationships')b.textContent='Clients';if(b.dataset.v43Main==='exceptions')b.textContent='Needs attention'});
  $$('[data-v43-detail]',page).forEach(b=>{if(b.dataset.v43Detail==='accounts')b.textContent='Cash';if(b.dataset.v43Detail==='service')b.textContent='Service'});
  page.dataset.v47Simple='1';
}
function tuneOrderModal(){
  const ticket=$('#v44OrderTicket.show'); if(!ticket)return;
  const svg=$('.v44-order-chart-stage svg',ticket); if(svg){svg.setAttribute('aria-label','Selected security price history');}
  const header=$('.v44-order-card:first-child .v44-order-card-head h3',ticket);if(header)header.textContent='Price history & market context';
}

let scheduled=false;
function enhance(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;simplifyOrderFlow();simplifyClients();tuneOrderModal();document.documentElement.dataset.release='v47'})}
function boot(){enhance();setTimeout(enhance,500);setTimeout(enhance,1400);new MutationObserver(enhance).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});console.info('Matanho Nexus V47 presentation enhancements ready')}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,2800));else setTimeout(boot,2800);
})();
