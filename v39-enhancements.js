/* Matanho Nexus V39 - usability and visual hierarchy */
(()=>{'use strict';
const $=(q,r=document)=>r.querySelector(q), $$=(q,r=document)=>[...r.querySelectorAll(q)];
function toast(title,msg,type='info'){if(typeof window.toast==='function'){try{return window.toast(title,msg,type)}catch(e){}}console.info(title,msg,type)}

function setupOrders(){
  const page=$('#page-orders'); if(!page)return;
  const actions=$('.v33-head .v33-actions',page);
  const kpis=$('.v33-shell>.v33-kpis',page);
  if(actions&&kpis&&!$('#v39OrdersMetricsToggle',page)){
    const b=document.createElement('button'); b.type='button'; b.className='v33-btn v39-metrics-toggle'; b.id='v39OrdersMetricsToggle'; b.textContent='More metrics'; b.setAttribute('aria-expanded','false');
    const saved=(()=>{try{return localStorage.getItem('matanho-v39-orders-metrics')==='open'}catch(e){return false}})();
    const apply=open=>{kpis.classList.toggle('v39-expanded',open);b.textContent=open?'Less metrics':'More metrics';b.setAttribute('aria-expanded',String(open));try{localStorage.setItem('matanho-v39-orders-metrics',open?'open':'closed')}catch(e){}};
    b.onclick=()=>apply(!kpis.classList.contains('v39-expanded')); actions.insertBefore(b,actions.firstChild); apply(saved);
  }
  const tabs=$('#v33OrderMainTabs',page);
  if(tabs&&!$('#v39OrderHelper',page)){
    tabs.insertAdjacentHTML('afterend',`<div class="v39-order-helper" id="v39OrderHelper"><div class="v39-order-helper-copy"><div class="v39-order-helper-icon">↗</div><div><strong>Start with the security, then place the order.</strong><small>Use Chart for price context, Position for availability, Orders for working instructions and Research for the current thesis.</small></div></div><div class="v39-order-helper-actions"><button type="button" class="v33-btn" id="v39FindSecurity">Find security</button><button type="button" class="v33-btn primary" id="v39QuickOrder">New order</button></div></div>`);
    $('#v39FindSecurity',page)?.addEventListener('click',()=>{const el=$('#v33SecSearch',page);if(el){el.focus();el.scrollIntoView({behavior:'smooth',block:'center'})}else toast('Security search','Open the Security workstation to search the local market master.');});
    $('#v39QuickOrder',page)?.addEventListener('click',()=>$('#v33NewOrder',page)?.click());
  }
  const toolTips={Candles:'Choose candlestick, OHLC, hollow candle or line view.',Indicators:'Toggle MA20, EMA9, VWAP and RSI.',Compare:'Overlay another security on the current chart.',Alert:'Create a local price-crossing alert.',Replay:'Replay historical bars in the chart.',Log:'Toggle logarithmic price scaling.',Auto:'Automatically fit the visible price range.'};
  $$('.v36-tv-tool',page).forEach(b=>{const key=(b.textContent||'').trim();if(toolTips[key]){b.title=toolTips[key];b.setAttribute('aria-label',`${key}. ${toolTips[key]}`)}});
}

function findRiskCard(page,terms){return $$('.v37-risk-card',page).find(c=>terms.some(t=>(c.querySelector('h2')?.textContent||'').toLowerCase().includes(t)))}
function setupRisk(){
  const page=$('#page-risk'); if(!page||!page.classList.contains('v37-risk'))return;
  const banner=$('.v37-risk-banner',page);
  if(banner&&!$('#v39RiskNav',page)){
    const targets=[
      ['Liquidity',['liquidity cover']],
      ['Risk drivers',['risk contribution','factor']],
      ['Stress',['portfolio stress','stress']],
      ['Limits & cases',['effective limit','limit book','compliance']]
    ];
    const nav=document.createElement('nav');nav.id='v39RiskNav';nav.className='v39-risk-nav';nav.setAttribute('aria-label','Risk workspace sections');nav.innerHTML='<span>Jump to</span>';
    targets.forEach(([label,terms],idx)=>{const target=findRiskCard(page,terms);if(!target)return;target.id=target.id||`v39RiskSection${idx}`;const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.target=target.id;b.onclick=()=>{nav.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));target.scrollIntoView({behavior:'smooth',block:'start'});target.classList.remove('v39-section-flash');requestAnimationFrame(()=>target.classList.add('v39-section-flash'));setTimeout(()=>target.classList.remove('v39-section-flash'),950)};nav.appendChild(b)});
    banner.insertAdjacentElement('afterend',nav);
  }
  $$('.v37-risk-card [role="img"]',page).forEach(el=>{if(!el.getAttribute('tabindex'))el.setAttribute('tabindex','0')});
}

function setupCommon(){
  // Let keyboard users close chart tool panels without hunting for the originating control.
  if(document.documentElement.dataset.v39EscBound!=='1'){
    document.documentElement.dataset.v39EscBound='1';
    document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;const p=$('#page-orders .v38-chart-tools-panel.show');if(p){p.classList.remove('show');e.preventDefault()}});
  }
  // Buttons that only contain a symbol still receive a useful label when possible.
  $$('button').forEach(b=>{if(!b.getAttribute('aria-label')&&/^[×✕]$/.test((b.textContent||'').trim()))b.setAttribute('aria-label','Close')});
}

let pending=false;
function enhance(){if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;setupOrders();setupRisk();setupCommon();document.documentElement.dataset.release='v39'})}
function boot(){enhance();setTimeout(enhance,450);setTimeout(enhance,1200);new MutationObserver(m=>{if(m.some(x=>x.addedNodes.length||x.type==='attributes'))enhance()}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});window.addEventListener('resize',enhance,{passive:true});console.info('Matanho Nexus V39 usability enhancements ready')}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,1750));else setTimeout(boot,1750);
})();
