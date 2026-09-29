/* V53 client portal simplification */
(()=>{'use strict';
const $=(q,r=document)=>r.querySelector(q), $$=(q,r=document)=>[...r.querySelectorAll(q)];
function simplify(){
 const inv=$('.nav-btn[data-page="investments"] span');if(inv)inv.textContent='Portfolio';
 const msg=$('.nav-btn[data-page="messages"] span');if(msg)msg.textContent='Support';
 const top=$('#topContext');if(top)top.textContent='Published relationship view';
 const head=$('[data-page-panel="overview"] .page-head');if(head){const eye=$('.eyebrow',head),h=$('h1',head),p=$('p',head);if(eye)eye.textContent='INVESTOR PORTAL';if(h)h.textContent='Your portfolio, clearly.';if(p)p.textContent='See published performance, upcoming capital actions and documents without the operational detail used by the investment team.'}
 $$('[data-go="requests"]').forEach(b=>{b.dataset.go='messages'});
 const mb=$('#mobileBottom button[data-page="investments"]');if(mb)mb.lastChild.textContent='Portfolio';
 document.documentElement.dataset.release='v53-client';
}
function boot(){simplify();new MutationObserver(simplify).observe(document.body,{childList:true,subtree:true});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
