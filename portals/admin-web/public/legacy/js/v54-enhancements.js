/* Matanho Nexus V54 — compact default sidebar + dynamic order cash balance. */
(()=>{'use strict';
const $=(q,r=document)=>r.querySelector(q), $$=(q,r=document)=>[...r.querySelectorAll(q)];
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

/* Controlled prototype cash ledger. These values deliberately expose their source in the UI. */
const CASH54={
 'Balanced Growth Fund':{USD:1862400,ZWG:18460000},
 'USD Equity Fund':{USD:3240000,ZWG:0},
 'Income Fund':{USD:2780000,ZWG:12900000},
 'Zimbabwe Opportunities':{USD:940000,ZWG:26750000}
};
const COST_BUFFER54=.0065;
function order54(){try{return typeof order44!=='undefined'?order44:null}catch(_e){return null}}
function sec54(){try{return typeof currentSec44==='function'?currentSec44():null}catch(_e){return null}}
function fmt54(v,c){const n=Math.abs(Number(v)||0);return `${c||'USD'} ${n.toLocaleString(undefined,{maximumFractionDigits:c==='ZWG'?0:2})}`}
function cash54(){const o=order54(),s=sec54();if(!o||!s)return null;const current=Number(CASH54[o.portfolio]?.[s.currency]||0),gross=Math.max(0,Number(o.qty)||0)*Math.max(0,Number(o.price)||0),fees=gross*COST_BUFFER54,sign=o.side==='Sell'?1:-1,effect=sign*(gross-fees*(o.side==='Sell'?1:-1)),after=o.side==='Sell'?current+gross-fees:current-gross-fees;return{o,s,current,gross,fees,effect,after}}
function balanceState54(x){if(!x)return'good';if(x.after<0)return'fail';if(x.current>0&&x.after/x.current<.15)return'warn';return'good'}

function updateCollapse54(){const shell=$('#appShell'),btn=$('#collapseSidebar');if(!shell||!btn)return;const collapsed=shell.classList.contains('collapsed');btn.setAttribute('aria-label',collapsed?'Expand sidebar':'Collapse sidebar');btn.title=collapsed?'Expand sidebar':'Collapse sidebar'}
function bindCollapse54(){const btn=$('#collapseSidebar');if(!btn||btn.dataset.v54Bound)return;btn.dataset.v54Bound='1';btn.addEventListener('click',()=>requestAnimationFrame(updateCollapse54));updateCollapse54()}

function injectBalance54(){const ticket=$('#v44OrderTicket.show');if(!ticket)return;const o=order54(),s=sec54();if(!o||!s)return;let panel=$('.v54-balance-panel',ticket);const impact=$('.v44-order-impact',ticket);if(!impact)return;if(!panel){panel=document.createElement('section');panel.className='v54-balance-panel';impact.parentNode.insertBefore(panel,impact);}
 updateBalance54(panel);
 bindTicket54(ticket);
}
function updateBalance54(panel=$('#v44OrderTicket.show .v54-balance-panel')){if(!panel)return;const x=cash54();if(!x)return;const st=balanceState54(x),pct=x.current>0?Math.max(0,Math.min(100,x.after/x.current*100)):0;const direction=x.o.side==='Sell'?'+':'−';panel.innerHTML=`<div class="v54-balance-head"><div><strong>Cash available for this trade</strong><small>Updates with portfolio, security, side, quantity and price before submission.</small></div><span class="v54-balance-source">IBOR cash ledger · controlled balance</span></div><div class="v54-balance-grid"><div><span>Current available cash</span><strong>${esc(fmt54(x.current,x.s.currency))}</strong><small>${esc(x.o.portfolio)} · ${esc(x.s.currency)}</small></div><div class="effect"><span>${x.o.side==='Sell'?'Estimated net proceeds':'Estimated cash required'}</span><strong>${direction} ${esc(fmt54(x.o.side==='Sell'?x.gross-x.fees:x.gross+x.fees,x.s.currency))}</strong><small>Consideration ${esc(fmt54(x.gross,x.s.currency))} · cost buffer ${esc(fmt54(x.fees,x.s.currency))}</small></div><div class="after ${st}"><span>Available cash after trade</span><strong>${x.after<0?'− ':''}${esc(fmt54(x.after,x.s.currency))}</strong><small>${st==='fail'?'Insufficient order-eligible cash':st==='warn'?'Low residual cash after execution':'Cash headroom remains available'}</small></div></div><div class="v54-balance-foot"><span><b>Traceable input:</b> portfolio cash ledger / latest controlled cash balance. Dealing-cost buffer is illustrative at ${(COST_BUFFER54*100).toFixed(2)}% until configured to the manager’s approved fee schedule.</span><span class="v54-cash-bar ${st}"><i style="width:${pct.toFixed(1)}%"></i></span></div>`;
 const cashCtrl=$$('.v44-order-control',ticketOf(panel)).find(el=>$('strong',el)?.textContent?.includes('Cash / position availability'));if(cashCtrl){cashCtrl.classList.toggle('warn',st!=='good');const small=$('small',cashCtrl),em=$('em',cashCtrl);if(small)small.textContent=x.o.side==='Sell'?'Sellable quantity and expected proceeds checked':st==='fail'?'Order exceeds current available cash':`Cash after order ${fmt54(x.after,x.s.currency)}`;if(em)em.textContent=st==='fail'?'Fail':st==='warn'?'Review':'Pass'}
}
function ticketOf(el){return el.closest('#v44OrderTicket')||document}
function bindTicket54(ticket){if(ticket.dataset.v54Bound)return;ticket.dataset.v54Bound='1';const rerender=()=>requestAnimationFrame(()=>updateBalance54());['#v44OrderPortfolio','#v44OrderQty','#v44OrderPrice'].forEach(q=>{const el=$(q,ticket);if(el){el.addEventListener('input',rerender);el.addEventListener('change',rerender)}});ticket.addEventListener('click',e=>{if(e.target.closest('[data-v44-side],[data-v44-qty],.v52-order-result'))setTimeout(injectBalance54,0)});
}

/* Prevent a pre-trade pass when a buy instruction has insufficient controlled cash. */
function guardPretrade54(){if(document.documentElement.dataset.v54PretradeBound)return;document.documentElement.dataset.v54PretradeBound='1';document.addEventListener('click',e=>{const b=e.target.closest?.('#v44OrderValidate,#v44OrderSubmit');if(!b)return;const x=cash54();if(!x||x.o.side==='Sell'||x.after>=0)return;e.preventDefault();e.stopImmediatePropagation();try{if(typeof toast44==='function')toast44('Insufficient available cash',`${x.o.portfolio} would be ${fmt54(Math.abs(x.after),x.s.currency)} short after this order. Reduce the quantity or select another portfolio.`,'error');else if(typeof toast==='function')toast('Insufficient available cash','Reduce the order or select another portfolio.','error')}catch(_e){}updateBalance54()},true)}

let scheduled=false;
function enhance54(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;bindCollapse54();injectBalance54();updateCollapse54();document.documentElement.dataset.release='v54';window.MATANHO_RELEASE='v54'})}
function boot54(){guardPretrade54();enhance54();setTimeout(enhance54,500);setTimeout(enhance54,1400);new MutationObserver(enhance54).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});console.info('Matanho Nexus V54 enhancements ready')}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot54);else boot54();
})();
