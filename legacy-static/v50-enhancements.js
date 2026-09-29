/* Matanho Nexus V50 — heatmap drill-through */
(()=>{'use strict';
const $=(q,r=document)=>r.querySelector(q), $$=(q,r=document)=>[...r.querySelectorAll(q)];
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const routeForSleeve=s=>({Listed:'ibor',Fixed:'ibor',Private:'private-markets','Real assets':'private-markets',Cash:'cash'})[s]||'ibor';
const routeLabel=s=>({Listed:'Positions',Fixed:'Positions',Private:'Private Markets','Real assets':'Private Markets',Cash:'Cash & Ledgers'})[s]||'Positions';
const money=n=>`US$ ${Number(n).toFixed(2)}m`;

const sleeveBook={
  Listed:[
    ['DLTA.ZW','Delta Corporation','Consumer',6.42,18.4],
    ['INN.VX','Innscor Africa','Consumer',5.18,15.2],
    ['CBZ.ZW','CBZ Holdings','Financials',3.76,11.8],
    ['FBC.ZW','FBC Holdings','Financials',2.94,9.6],
    ['SIM.VX','Simbisa Brands','Consumer',2.51,8.3]
  ],
  Fixed:[
    ['ZIMGB-2030','Government Bond 2030','Sovereign',4.90,18.8],
    ['ZIMTB-182D','Treasury Bill 182D','Sovereign',3.35,14.1],
    ['CBZ-2029','CBZ Note 2029','Financial credit',1.84,10.6],
    ['IDBZ-2028','IDBZ Infrastructure Bond','Development finance',1.31,8.7],
    ['CORP-USD-27','USD Corporate Note 2027','Corporate credit',0.92,7.4]
  ],
  Private:[
    ['PE-GEIV','Growth Equity IV','Private equity',4.46,22.9],
    ['PC-AGRI','AgriCo Private Credit','Private credit',2.18,15.7],
    ['INF-SOLAR','Solar SPV','Infrastructure',1.82,13.4],
    ['PE-FINTECH','Regional Fintech II','Growth equity',1.27,10.3],
    ['PC-LOG','Logistics Credit I','Private credit',0.88,8.1]
  ],
  'Real assets':[
    ['TIG.VX','Tigere REIT','Listed real estate',2.13,18.2],
    ['REV.ZW','Revitus REIT','Listed real estate',1.62,14.6],
    ['RE-IND-01','Harare Industrial Park','Direct property',1.34,12.8],
    ['RE-RET-03','Retail Property III','Direct property',0.96,9.7],
    ['INF-WATER','Water Infrastructure SPV','Infrastructure',0.71,7.9]
  ],
  Cash:[
    ['FCB-USD-01','First Capital Bank USD','Bank cash',2.84,21.1],
    ['CBZ-USD-02','CBZ USD Operating','Bank cash',2.21,18.2],
    ['FBC-USD-01','FBC USD Custody Cash','Custody cash',1.48,13.7],
    ['NMB-ZWG-01','NMB ZWG Operating','Bank cash',0.64,8.9],
    ['CALL-USD','USD Call Account','Call deposit',0.53,7.2]
  ]
};
const factorStress={Growth:-12.8,Rates:-5.6,FX:-8.9,Credit:-6.7,Liquidity:-4.8};
const factorSource={Growth:'Risk model factor loadings + approved market prices',Rates:'Duration / DV01 population + yield curves',FX:'Currency exposure population + approved FX snapshot',Credit:'Issuer / counterparty credit mapping + spread shocks',Liquidity:'Position liquidity buckets + cash / settlement obligations'};

function cellMetrics(factor,sleeve,score){
  const s=Number(score)||0,book=sleeveBook[sleeve]||sleeveBook.Listed;
  const nav=book.reduce((a,r)=>a+r[3],0);
  const weight=clamp(5+s*.16,4,24.5);
  const contribution=clamp(s*.031,0.2,3.6);
  const stress=(factorStress[factor]||-6)*(s/100);
  const headroom=clamp(22-s*.21,.4,20);
  return{nav,weight,contribution,stress,headroom};
}
function severity(score){return +score>80?'High':+score>55?'Material':'Low'}
function actionCopy(score){return +score>80?'Review before adding exposure':+score>55?'Monitor and test stressed headroom':'Within current risk capacity'}
function sourceRef(factor,sleeve){return `RISK-CUBE/${factor.toUpperCase()}/${sleeve.toUpperCase().replace(/\s+/g,'-')}/2026-09-01`}

function ensureShell(){
  let b=$('#v50HeatDrillBackdrop'),d=$('#v50HeatDrill');
  if(!b){b=document.createElement('div');b.id='v50HeatDrillBackdrop';document.body.appendChild(b)}
  if(!d){d=document.createElement('section');d.id='v50HeatDrill';d.setAttribute('role','dialog');d.setAttribute('aria-modal','true');d.setAttribute('aria-label','Risk heatmap drill-down');document.body.appendChild(d)}
  const close=()=>{b.classList.remove('show');d.classList.remove('show');document.body.style.overflow='';setTimeout(()=>{if(!d.classList.contains('show'))d.innerHTML=''},180)};
  b.onclick=close; d._close=close; return{b,d,close};
}
function go(route){const {close}=ensureShell();close();setTimeout(()=>{if(typeof window.navigate==='function')window.navigate(route);else $(`.nav-item[data-page="${route}"]`)?.click()},110)}
function scrollRisk(sel){const {close}=ensureShell();close();setTimeout(()=>{if(typeof window.navigate==='function')window.navigate('risk');setTimeout(()=>$(sel)?.scrollIntoView({behavior:'smooth',block:'start'}),300)},110)}
function applyStress(factor){
  const presets={Growth:{eq:-25,fx:-12,rates:100,red:8},Rates:{eq:-10,fx:-8,rates:250,red:6},FX:{eq:-12,fx:-22,rates:120,red:7},Credit:{eq:-14,fx:-8,rates:180,red:8},Liquidity:{eq:-12,fx:-10,rates:120,red:18}};
  const x=presets[factor]||presets.Growth;
  go('risk');
  setTimeout(()=>{
    [['v37RiskEq',x.eq],['v37RiskFx',x.fx],['v37RiskRates',x.rates],['v37RiskRed',x.red]].forEach(([id,v])=>{const el=$('#'+id);if(el){el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}))}});
    const card=$('.v40-risk-scenario')||[...$$('#page-risk .v37-risk-card')].find(x=>x.querySelector('h2')?.textContent.includes('Build and run'));
    card?.scrollIntoView({behavior:'smooth',block:'start'});
  },520);
}
function renderContributors(factor,sleeve,score){
  const rows=(sleeveBook[sleeve]||sleeveBook.Listed).map((r,i)=>{
    const share=clamp(r[4]*(.72+(+score/100)*.42),4,34),stress=(factorStress[factor]||-6)*(share/100),route=routeForSleeve(sleeve);
    return `<tr data-v50-record="${esc(r[0])}" data-route="${route}" tabindex="0"><td><strong>${esc(r[0])}</strong><small>${esc(r[1])}</small></td><td>${esc(r[2])}</td><td>${money(r[3])}</td><td><div class="v50-contrib-bar"><i style="width:${share.toFixed(1)}%"></i></div><small>${share.toFixed(1)}% of cell</small></td><td>${stress.toFixed(2)}%</td><td><small>IBOR / Risk Cube</small></td></tr>`
  }).join('');
  return `<div class="v50-contrib-wrap"><section class="v50-panel"><div class="v50-panel-head"><div><h3>Positions driving ${esc(factor)} × ${esc(sleeve)}</h3><p>Click any row to open the underlying book. Contributions are illustrative prototype analytics.</p></div><span class="v50-source-state">Source current</span></div><div class="v50-heat-table-wrap"><table class="v50-heat-table"><thead><tr><th>Instrument / asset</th><th>Exposure type</th><th>Market value</th><th>Cell contribution</th><th>Severe stress</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table></div></section><aside class="v50-side-card"><h3>Why this cell matters</h3><div class="v50-driver-list"><div class="v50-driver"><span>Primary driver</span><strong>${esc(factor)}</strong></div><div class="v50-driver"><span>Portfolio sleeve</span><strong>${esc(sleeve)}</strong></div><div class="v50-driver"><span>Risk intensity</span><strong>${esc(score)}/100 · ${severity(score)}</strong></div><div class="v50-driver"><span>Decision</span><strong>${esc(actionCopy(score))}</strong></div></div><div class="v50-action-row"><button type="button" data-v50-go="${routeForSleeve(sleeve)}">Open ${routeLabel(sleeve)}</button><button type="button" data-v50-tab="stress">Limits & stress</button><button class="primary" type="button" data-v50-stress="${esc(factor)}">Run focused stress</button></div></aside></div>`
}
function renderStress(factor,sleeve,score,m){
  const threshold=(10+Math.round((100-+score)/10)).toFixed(1),current=(threshold-m.headroom/10).toFixed(1);
  return `<section class="v50-panel"><div class="v50-panel-head"><div><h3>Effective limits and stress transmission</h3><p>See how the selected factor/sleeve combination behaves against the approved risk envelope.</p></div><span class="v50-source-state">RM-2026-07</span></div><div class="v50-stress-grid"><div class="v50-stress-item"><span>Selected cell</span><strong>${esc(score)}/100</strong><small>${severity(score)} relative contribution.</small></div><div class="v50-stress-item"><span>Severe stress contribution</span><strong>${m.stress.toFixed(2)}%</strong><small>Estimated portfolio P&amp;L from this cell.</small></div><div class="v50-stress-item"><span>Limit headroom</span><strong>${m.headroom.toFixed(1)}%</strong><small>Before the closest applicable threshold.</small></div><div class="v50-stress-item"><span>Effective threshold</span><strong>${threshold}%</strong><small>Illustrative mandate/house constraint.</small></div><div class="v50-stress-item"><span>Current usage</span><strong>${current}%</strong><small>Exposure after approved look-through mappings.</small></div><div class="v50-stress-item"><span>Review state</span><strong>${+score>80?'Action':'Monitor'}</strong><small>${esc(actionCopy(score))}.</small></div></div><div class="v50-action-row" style="padding:0 14px 14px"><button type="button" data-v50-limits>Open effective limit book</button><button class="primary" type="button" data-v50-stress="${esc(factor)}">Load focused stress</button></div></section>`
}
function renderLineage(factor,sleeve,score){
  return `<section class="v50-panel"><div class="v50-panel-head"><div><h3>Data lineage for this heatmap cell</h3><p>The drill-down shows the governed records used to calculate the displayed score.</p></div><span class="v50-source-state">4 / 4 current</span></div><div class="v50-lineage"><div class="v50-lineage-card"><span>Positions</span><strong>IBOR position snapshot</strong><small>438 positions · as of 15:42 CAT · portfolio and sleeve mapping applied.</small><code>IBOR.POSITIONS/2026-09-01/1542</code></div><div class="v50-lineage-card"><span>Market data</span><strong>Approved price &amp; FX snapshot</strong><small>ZSE/VFEX close plus controlled FX set used for exposure conversion.</small><code>MD.PRICES-FX/2026-09-01/CLOSE</code></div><div class="v50-lineage-card"><span>Risk model</span><strong>${esc(factorSource[factor]||'Approved risk model population')}</strong><small>Model version RM-2026-07 · effective rules as at 01 Jul 2026.</small><code>MODEL.RISK/RM-2026-07/${esc(factor).toUpperCase()}</code></div><div class="v50-lineage-card"><span>Cell output</span><strong>${esc(factor)} × ${esc(sleeve)} · ${esc(score)}/100</strong><small>Calculated from mapped positions, model sensitivities and current effective limits.</small><code>${esc(sourceRef(factor,sleeve))}</code></div></div><div class="v50-action-row" style="padding:0 14px 14px"><button type="button" data-v50-go="data">Open data lineage</button><button type="button" data-v50-go="audit">Open audit trail</button><button class="primary" type="button" data-v50-go="${routeForSleeve(sleeve)}">Open underlying records</button></div><div class="v50-heat-note">Prototype values are illustrative. Production would resolve these rows to the asset manager's authoritative IBOR, market-data, valuation and risk-model objects.</div></section>`
}
function openDrill(factor,sleeve,score,origin='Risk & Compliance'){
  const {b,d}=ensureShell(),m=cellMetrics(factor,sleeve,score);
  d.innerHTML=`<header class="v50-heat-head"><div class="v50-heat-head-main"><div class="v50-heat-breadcrumb"><button type="button" data-v50-back>${esc(origin)}</button><span>›</span><span>Risk heatmap</span><span>›</span><strong>${esc(factor)} × ${esc(sleeve)}</strong></div><h2>${esc(factor)} risk · ${esc(sleeve)}</h2><p>Drill-through from the heatmap cell to the exposures, stress, limits and governed source records that produced the score.</p></div><button class="v50-heat-close" type="button" aria-label="Close drill-down">×</button></header><div class="v50-heat-body"><div class="v50-score-row"><div class="v50-score-card ${+score>80?'alert':+score>55?'warn':'good'}"><span>Heatmap intensity</span><strong>${esc(score)}/100</strong><small>${severity(score)} contribution.</small></div><div class="v50-score-card"><span>Mapped exposure</span><strong>${money(m.nav)}</strong><small>${m.weight.toFixed(1)}% indicative portfolio weight.</small></div><div class="v50-score-card"><span>Risk contribution</span><strong>${m.contribution.toFixed(2)}%</strong><small>Contribution to total portfolio risk.</small></div><div class="v50-score-card"><span>Severe stress</span><strong>${m.stress.toFixed(2)}%</strong><small>Estimated portfolio P&amp;L from selected cell.</small></div></div><div class="v50-heat-tabs"><button class="active" type="button" data-v50-tab="contributors">Contributors</button><button type="button" data-v50-tab="stress">Limits &amp; stress</button><button type="button" data-v50-tab="lineage">Lineage</button></div><div class="v50-heat-pane active" data-v50-pane="contributors">${renderContributors(factor,sleeve,score)}</div><div class="v50-heat-pane" data-v50-pane="stress">${renderStress(factor,sleeve,score,m)}</div><div class="v50-heat-pane" data-v50-pane="lineage">${renderLineage(factor,sleeve,score)}</div></div>`;
  $('.v50-heat-close',d).onclick=d._close;
  $$('[data-v50-tab]',d).forEach(btn=>btn.onclick=()=>{const tab=btn.dataset.v50Tab;$$('.v50-heat-tabs [data-v50-tab]',d).forEach(x=>x.classList.toggle('active',x.dataset.v50Tab===tab));$$('[data-v50-pane]',d).forEach(x=>x.classList.toggle('active',x.dataset.v50Pane===tab))});
  $$('[data-v50-go]',d).forEach(btn=>btn.onclick=()=>go(btn.dataset.v50Go));
  $$('[data-v50-stress]',d).forEach(btn=>btn.onclick=()=>applyStress(btn.dataset.v50Stress));
  $$('[data-v50-limits]',d).forEach(btn=>btn.onclick=()=>scrollRisk('.v37-limit-table'));
  $$('[data-v50-record]',d).forEach(row=>{const activate=()=>go(row.dataset.route);row.onclick=activate;row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate()}}});
  $('[data-v50-back]',d).onclick=()=>{d._close(); if(origin==='Global Investment Office')setTimeout(()=>{if(typeof window.navigate==='function')window.navigate('command')},120)};
  b.classList.add('show');d.classList.add('show');document.body.style.overflow='hidden';
  setTimeout(()=>$('.v50-heat-close',d)?.focus(),20);
}
function parseRiskCell(t){const raw=t?.closest?.('[data-heat]')?.dataset.heat;if(!raw)return null;const [factor,sleeve,score]=raw.split('|');return{factor,sleeve,score,origin:'Risk & Compliance'}}
function parseCommandCell(t){const b=t?.closest?.('#gioRiskHeat button');if(!b)return null;return{factor:b.dataset.factor,sleeve:b.dataset.sleeve,score:b.dataset.intensity,origin:'Global Investment Office'}}
function interceptHeat(e){const hit=parseRiskCell(e.target)||parseCommandCell(e.target);if(!hit)return;e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
  const btn=e.target.closest('button');btn?.parentElement?.querySelectorAll?.('button.active')?.forEach(x=>x.classList.remove('active'));btn?.classList.add('active');
  if(hit.origin==='Global Investment Office'&&typeof window.navigate==='function'){
    window.navigate('risk');setTimeout(()=>openDrill(hit.factor,hit.sleeve,hit.score,hit.origin),260);
  }else openDrill(hit.factor,hit.sleeve,hit.score,hit.origin)
}
function annotate(){
  $$('#page-risk .v37-heat [data-heat]').forEach(b=>{const [f,s,v]=b.dataset.heat.split('|');b.title=`Drill into ${f} risk in ${s} · ${v}/100`;b.setAttribute('aria-label',`Drill into ${f} risk in ${s}, score ${v} out of 100`) });
  $$('#gioRiskHeat button').forEach(b=>{b.title=`Open ${b.dataset.factor} × ${b.dataset.sleeve} risk detail`;b.setAttribute('aria-label',`Open ${b.dataset.factor} risk in ${b.dataset.sleeve}, score ${b.dataset.intensity} out of 100`)})
}
function boot(){document.addEventListener('click',interceptHeat,true);document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('#v50HeatDrill.show'))ensureShell().close()});annotate();new MutationObserver(annotate).observe(document.body,{subtree:true,childList:true});document.documentElement.dataset.release='v50';console.info('Matanho Nexus V50 heatmap drill-through ready')}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,2350));else setTimeout(boot,2350);
})();
