/* Matanho Nexus V42 - release marker for chart flyout visibility hotfix */
(()=>{'use strict';
function mark(){document.documentElement.dataset.release='v42'}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mark,{once:true});else mark();
setTimeout(mark,1200);
console.info('Matanho Nexus V42 chart flyout visibility hotfix ready');
})();
