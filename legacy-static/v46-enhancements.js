/* Matanho Nexus V46 — progressive disclosure / calmer visual hierarchy */
(()=>{
'use strict';
const $=(q,r=document)=>r.querySelector(q), $$=(q,r=document)=>[...r.querySelectorAll(q)];

function relabelOrderMilestones(host){
 const stages=$$('.v45-order-stage',host).filter(x=>getComputedStyle(x).display!=='none');
 const labels=[['Decision','Intent approved'],['Approval','Controls passed'],['Execution','Broker activity'],['Settlement','Custody + cash'],['Complete','Books closed']];
 stages.forEach((el,i)=>{const strong=$('strong',el),small=$('small',el);if(strong)strong.textContent=labels[i]?.[0]||strong.textContent;if(small)small.textContent=labels[i]?.[1]||small.textContent});
}
function simplifyOrders(){
 const host=$('#page-orders #v45OrderFlow');if(!host)return;
 const kick=$('.v45-order-flow-head .v45-kicker',host),h2=$('.v45-order-flow-head h2',host);
 if(kick)kick.textContent='TRADE PROGRESS';
 if(h2)h2.textContent='From decision to final books';
 relabelOrderMilestones(host);
 let toggle=$('.v46-activity-toggle',host);
 if(!toggle){
  toggle=document.createElement('button');toggle.type='button';toggle.className='v46-activity-toggle';toggle.textContent='Show activity';
  const actions=$('.v45-order-flow-actions',host);actions?.insertBefore(toggle,actions.firstChild);
  toggle.addEventListener('click',()=>{const open=host.classList.toggle('v46-show-activity');toggle.textContent=open?'Hide activity':'Show activity'});
 }
 const ev=$('#v45OrderEvidence',host);if(ev)ev.textContent='Full audit trail';
 const adv=$('#v45OrderAdvance',host);if(adv&&!adv.disabled)adv.textContent=adv.textContent.replace('Advance to ','Next: ');
}

function buildReconProgress(page){
 let bar=$('.v46-recon-progress',page);if(bar)return;
 bar=document.createElement('section');bar.className='v46-recon-progress';
 bar.innerHTML='<strong>Reconciliation flow</strong><span class="v46-recon-step done"><i></i>Sources</span><span class="v46-recon-step done"><i></i>Validate</span><span class="v46-recon-step active"><i></i>Match</span><span class="v46-recon-step"><i></i>Resolve</span><span class="v46-recon-step"><i></i>Close</span><span class="v46-progress-spacer"></span><span class="v46-source-summary"><i></i><span>Counterparty feeds connected</span></span><button type="button" class="v46-link-btn" data-v46-sources>View sources</button>';
 const kpis=$('.v45-recon-kpis',page);kpis?.insertAdjacentElement('afterend',bar);
 $('[data-v46-sources]',bar)?.addEventListener('click',()=>{const open=page.classList.toggle('v46-show-sources');$('[data-v46-sources]',bar).textContent=open?'Hide sources':'View sources';if(open)$('#v45SourceHub',page)?.scrollIntoView({behavior:'smooth',block:'nearest'})});
}
function simplifyRecon(){
 const page=$('#page-reconciliations');if(!page)return;
 const kick=$('.v45-recon-head .v45-kicker',page),desc=$('.v45-recon-head p',page);
 if(kick)kick.textContent='MATCH WHAT MATTERS';
 if(desc)desc.textContent='Internal books are compared with independently received broker, custodian, bank and administrator records. Work only the exceptions that need a person.';
 const run=$('#v45RunAllMatching',page);if(run)run.textContent='Run matching';
 const health=$('#v45ReconSourceHealth',page);if(health)health.textContent='Source health';
 buildReconProgress(page);
 let toggle=$('.v46-evidence-toggle',page);
 const actions=$('.v45-case-actions',page);
 if(actions&&!toggle){
  toggle=document.createElement('button');toggle.type='button';toggle.className='v46-evidence-toggle';toggle.textContent='Show evidence';
  actions.insertBefore(toggle,actions.firstChild);
  toggle.addEventListener('click',()=>{const open=page.classList.toggle('v46-show-evidence');toggle.textContent=open?'Hide evidence':'Show evidence'});
 }
 const qTitle=$('.v45-recon-queue-card .v45-recon-card-head h2',page);if(qTitle)qTitle.textContent='Needs attention';
 const dTitle=$('.v45-recon-detail .v45-recon-card-head p',page);if(dTitle)dTitle.remove();
}

function apply(){simplifyOrders();simplifyRecon();document.documentElement.dataset.release='v46'}
function boot(){setTimeout(apply,4300);const roots=['#page-orders','#page-reconciliations'].map(q=>$(q)).filter(Boolean);roots.forEach(root=>new MutationObserver(()=>{clearTimeout(root._v46);root._v46=setTimeout(apply,80)}).observe(root,{childList:true,subtree:true}));window.addEventListener('resize',()=>setTimeout(apply,20),{passive:true});console.info('Matanho Nexus V46 calm interaction layer ready')}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
