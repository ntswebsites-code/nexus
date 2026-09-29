/* Matanho Nexus V48 — simplified onboarding/private markets, single order CTA, clearer chart legends */
(()=>{'use strict';
const $=(q,r=document)=>r.querySelector(q), $$=(q,r=document)=>[...r.querySelectorAll(q)];

function simplifyOrders48(){
  const page=$('#page-orders'); if(!page)return;
  const dup=$('#v39QuickOrder',page); if(dup)dup.remove();
  const helper=$('#v39OrderHelper',page);
  if(helper){
    const strong=$('.v39-order-helper-copy strong',helper), small=$('.v39-order-helper-copy small',helper);
    if(strong)strong.textContent='Choose a security to update the workstation.';
    if(small)small.textContent='Chart, position, working orders and research stay in the selected ticker context.';
    const actions=$('.v39-order-helper-actions',helper); if(actions&&actions.children.length===0)actions.remove();
  }
}

function orderLegend48(){
  const ticket=$('#v44OrderTicket.show'); if(!ticket)return;
  const stage=$('#v44OrderChart',ticket); if(!stage||stage.previousElementSibling?.classList.contains('v48-order-legend-row'))return;
  const row=document.createElement('div'); row.className='v48-order-legend-row';
  row.innerHTML='<div class="v48-order-legend"><span><i class="price"></i>Price</span><span><i class="prev"></i>Previous close</span></div><small>Hover or tap the line for point values</small>';
  stage.parentNode.insertBefore(row,stage);
}

function readKycMetric48(label){
  const cards=$$('#v35KycKpis article'); const card=cards.find(c=>$('span',c)?.textContent.trim()===label); return $('strong',card)?.textContent.trim()||'—';
}
function refreshOnboardingSummary48(){
  const bar=$('#v48KycSummary'); if(!bar)return;
  const vals={action:readKycMetric48('Open cases'),ready:readKycMetric48('Ready to activate'),high:readKycMetric48('High risk / EDD')};
  Object.entries(vals).forEach(([k,v])=>{const e=$(`[data-v48-kyc-count="${k}"]`,bar);if(e)e.textContent=v});
}
function selectKycFilter48(value){
  const f=$('#v35KycFilter'); if(!f)return; f.value=value; f.dispatchEvent(new Event('change',{bubbles:true}));
  $$('[data-v48-kyc-filter]').forEach(b=>b.classList.toggle('active',b.dataset.v48KycFilter===value));
}
function simplifyOnboarding48(){
  const page=$('#page-onboarding'); if(!page||!$('.v35-kyc-shell',page))return;
  const head=$('.v33-head',page), eye=$('.v33-eyebrow',head), desc=$('p',head), actions=$('.v33-actions',head);
  if(eye)eye.textContent='APPLICATIONS · KYC · APPROVAL';
  if(desc)desc.textContent='Review only what needs a person: application evidence, exceptions and the final compliance decision.';
  const newBtn=$('#v35KycNew',page); if(newBtn)newBtn.textContent='+ New application';
  if(actions&&!$('#v48KycMore',actions)){
    const more=document.createElement('details');more.id='v48KycMore';more.className='v48-more';
    more.innerHTML='<summary class="v35-btn">More</summary><div class="v48-more-menu"><button type="button" data-v48-kyc-action="portal">Applicant portal</button><button type="button" data-v48-kyc-action="refresh">Refresh submissions</button><button type="button" data-v48-kyc-action="export">Export case pack</button></div>';
    actions.insertBefore(more,newBtn||actions.firstChild);
    $$('[data-v48-kyc-action]',more).forEach(b=>b.onclick=()=>{const map={portal:'v35KycPublic',refresh:'v35KycRefresh',export:'v35KycExport'};$('#'+map[b.dataset.v48KycAction],page)?.click();more.open=false});
  }
  if(head&&!$('#v48KycSummary',page)){
    head.insertAdjacentHTML('afterend','<section class="v48-kyc-summary" id="v48KycSummary"><button type="button" class="active" data-v48-kyc-filter="action"><span>Needs review</span><strong data-v48-kyc-count="action">—</strong><small>Human action required</small></button><button type="button" data-v48-kyc-filter="ready"><span>Ready to approve</span><strong data-v48-kyc-count="ready">—</strong><small>Hard gates passed</small></button><button type="button" data-v48-kyc-filter="high"><span>High risk / EDD</span><strong data-v48-kyc-count="high">—</strong><small>Enhanced review</small></button></section>');
    $$('[data-v48-kyc-filter]',page).forEach(b=>b.onclick=()=>selectKycFilter48(b.dataset.v48KycFilter));
  }
  refreshOnboardingSummary48();
  const detail=$('#v35KycDetail',page);
  if(detail&&!$('.v48-kyc-controls',detail)){
    const symbols=$('.v35-control-symbols',detail),journey=$('.v35-kyc-journey',detail);
    if(symbols||journey){const d=document.createElement('details');d.className='v48-kyc-controls';d.innerHTML='<summary>Controls & workflow</summary><div class="v48-kyc-controls-body"></div>';const body=$('.v48-kyc-controls-body',d);if(symbols)body.appendChild(symbols);if(journey)body.appendChild(journey);const tabs=$('.v35-tabs',detail);tabs?.parentNode.insertBefore(d,tabs)}
  }
}

function simplifyPrivateMarkets48(){
  const page=$('#page-private-markets'); if(!page)return;
  const eye=$('.page-head .eyebrow',page),desc=$('.page-head p',page);
  if(eye)eye.textContent='PRIVATE INVESTMENTS · CASH · VALUATIONS';
  if(desc)desc.textContent='See private-asset value, upcoming funding needs and the items that need judgement.';
  $('#v16PrivateHub',page)?.remove();
  const actions=$('.page-actions',page); if(actions){$$('button',actions).forEach(b=>{b.hidden=!b.matches('[data-v15-private-action="investment"]')});const primary=$('[data-v15-private-action="investment"]',actions);if(primary)primary.textContent='+ New investment'}
  const tabs=$('[data-v15-tab-group="private"]',page); if(tabs){
    const rename={overview:'Overview',portfolio:'Investments',pipeline:'Diligence',cashflows:'Cash planning',valuations:'Valuations'};
    $$('[data-v15-tab]',tabs).forEach(b=>{b.textContent=rename[b.dataset.v15Tab]||b.textContent;if(['pipeline','valuations'].includes(b.dataset.v15Tab))b.classList.add('v48-private-advanced')});
    if(!$('#v48PrivateMore',tabs)){const b=document.createElement('button');b.type='button';b.id='v48PrivateMore';b.className='v48-private-more';b.textContent='More';b.onclick=()=>{const open=page.classList.toggle('v48-private-more-open');b.textContent=open?'Less':'More';b.setAttribute('aria-expanded',String(open))};tabs.appendChild(b)}
  }
  const liqLegend=$('.v44-liq-legend,.v35-liq-legend',page); if(liqLegend)liqLegend.setAttribute('aria-label','Chart legend');
}

function makeLegendsReadable48(){
  const selectors=['.chart-legend','.premium-legend','.v35-liq-legend','.v44-liq-legend','.v36-chart-legend','.v36-tv-legend','.v37-chart-legend','.v38-risk-legend'];
  selectors.forEach(sel=>$$(sel).forEach(x=>x.classList.add('v48-legend')));
}

let queued=false;
function enhance48(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;simplifyOrders48();orderLegend48();simplifyOnboarding48();simplifyPrivateMarkets48();makeLegendsReadable48();document.documentElement.dataset.release='v48'})}
function boot48(){enhance48();setTimeout(enhance48,650);setTimeout(enhance48,1700);new MutationObserver(enhance48).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});console.info('Matanho Nexus V48 clarity enhancements ready')}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot48,3000));else setTimeout(boot48,3000);
})();
