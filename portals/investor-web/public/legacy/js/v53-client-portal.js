/* V53 client portal simplification */
(()=>{'use strict';
const $=(q,r=document)=>r.querySelector(q), $$=(q,r=document)=>[...r.querySelectorAll(q)];
function setText(el,t){if(el&&el.textContent!==t)el.textContent=t}
function simplify(){
 const inv=$('.nav-btn[data-page="investments"] span');setText(inv,'Portfolio');
 const msg=$('.nav-btn[data-page="messages"] span');setText(msg,'Support');
 const top=$('#topContext');setText(top,'Published relationship view');
 const head=$('[data-page-panel="overview"] .page-head');if(head){const eye=$('.eyebrow',head),h=$('h1',head),p=$('p',head);setText(eye,'INVESTOR PORTAL');setText(h,'Your portfolio, clearly.');setText(p,'See published performance, upcoming capital actions and documents without the operational detail used by the investment team.')}
 $$('[data-go="requests"]').forEach(b=>{if(b.dataset.go!=='messages')b.dataset.go='messages'});
 const mb=$('#mobileBottom button[data-page="investments"]');if(mb)setText(mb.lastChild,'Portfolio');
 document.documentElement.dataset.release='v53-client';
}
function boot(){simplify();new MutationObserver(simplify).observe(document.body,{childList:true,subtree:true});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
