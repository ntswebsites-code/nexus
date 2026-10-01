
(()=>{
'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const DRAFT='matanho-public-onboarding-draft-v57';
const BOOK='matanho-onboarding-v10';
const steps=[
  ['Investor','Profile & relationship'],['Ownership','UBOs & signatories'],['KYC / AML','Funds & declarations'],['Tax & bank','Tax + funding account'],['Evidence','Documents + OCR'],['Review','AI triage + submit']
];
const meta=[
  ['Investor profile','Tell us exactly who the investor is and what relationship is being requested.'],
  ['Ownership and authority','Identify the people who ultimately own, control and are authorised to act for the investor.'],
  ['KYC / AML declarations','Capture the economic purpose, source of funds, source of wealth and risk declarations used in due diligence.'],
  ['Tax and bank verification','Record FATCA / CRS classification and the verified bank account used for funding.'],
  ['Supporting evidence','Upload original documents, preview them in place and use OCR to reduce re-keying.'],
  ['Review and submit','Review the application pack, run AI-assisted triage and make the authorised declaration.']
];
const documentDefs=[
  {id:'legal',title:'Legal existence / identity',help:'Certificate of incorporation, trust deed, fund constitution or government ID.',required:true},
  {id:'registry',title:'Registry / constitutional extract',help:'Current registry extract, governing document or equivalent legal profile.',required:true},
  {id:'ownership',title:'Ownership / control evidence',help:'Share register, ownership chart, trustee / beneficiary schedule or controller record.',required:true},
  {id:'identity',title:'Owners / signatories ID',help:'Passport / national identity evidence for required natural persons.',required:true},
  {id:'address',title:'Address evidence',help:'Registered-office or residential address evidence, as applicable.',required:true},
  {id:'bank',title:'Bank verification',help:'Recent bank statement, bank letter or controlled account confirmation.',required:true},
  {id:'funds',title:'Source-of-funds evidence',help:'Bank-origin evidence, audited record, transaction evidence or equivalent support.',required:true},
  {id:'tax',title:'Tax / FATCA / CRS',help:'Tax residence, W-8/W-9 or self-certification evidence where applicable.',required:true},
  {id:'authority',title:'Authority to invest',help:'Board, trustee, IC or authorised-signatory resolution / mandate.',required:true},
  {id:'subscription',title:'Subscription / investment mandate',help:'Subscription agreement, IPS or investment mandate, if available.',required:false},
  {id:'additional',title:'Additional supporting evidence',help:'Any other document relevant to KYC, AML, tax or account opening.',required:false}
];
let step=0, lastAiResult=null;
const docs={};
documentDefs.forEach(d=>docs[d.id]={...d,file:null,url:null,ocrText:'',ocrConfidence:null,candidates:{},ocrState:'Not run'});

function esc(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function value(id){return $('#'+id)?.value?.trim?.() ?? $('#'+id)?.value ?? ''}
function setValue(id,v){const el=$('#'+id);if(el&&v!=null&&v!=='')el.value=v}
function money(v){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(v||0))}
function todayTime(){return new Date().toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'})}
function debounce(fn,ms=180){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}}

function renderRail(){
  $('#stepRail').innerHTML=steps.map((s,i)=>`<button type="button" data-step="${i}" class="${i===step?'active':''} ${i<step?'done':''}"><span class="step-num">${i+1}</span><span class="step-copy"><strong>${s[0]}</strong><small>${s[1]}</small></span><span class="step-check">✓</span></button>`).join('')+`<div class="rail-footer"><span>Application state</span><strong id="railState">Draft saved</strong></div>`;
  $$('#stepRail [data-step]').forEach(b=>b.addEventListener('click',()=>{const target=Number(b.dataset.step);if(target<=step||validatePane(step,false)){step=target;render()}}));
}
function render(){
  $$('.pane').forEach((p,i)=>p.classList.toggle('active',i===step));
  renderRail();
  $('#stepEyebrow').textContent=`STEP ${step+1} OF ${steps.length}`;
  $('#stepTitle').textContent=meta[step][0];$('#stepHelp').textContent=meta[step][1];
  const pct=Math.round(((step+1)/steps.length)*100);$('#progressLabel').textContent=`${pct}% complete`;$('#progressBar').style.width=pct+'%';
  $('#backBtn').disabled=step===0;$('#nextBtn').hidden=step===steps.length-1;$('#submitBtn').hidden=step!==steps.length-1;
  if(step===5)renderReview();
  updateReadiness();
  window.scrollTo({top:Math.max(0,$('#applicationCard').offsetTop-14),behavior:'smooth'});
}

function addOwner(data={}){
  const row=document.createElement('div');row.className='repeater-row';
  row.innerHTML=`<label class="field"><span>Full legal name</span><input data-owner="name" required value="${esc(data.name||'')}"></label><label class="field"><span>Nationality</span><input data-owner="nationality" value="${esc(data.nationality||'Zimbabwe')}"></label><label class="field"><span>ID / passport</span><input data-owner="id" value="${esc(data.id||'')}"></label><label class="field"><span>Ownership %</span><input data-owner="pct" type="number" min="0" max="100" step="0.01" value="${esc(data.pct||'')}"></label><button type="button" class="remove" aria-label="Remove owner">×</button>`;
  row.querySelector('.remove').addEventListener('click',()=>{if($$('#ownerList .repeater-row').length>1)row.remove();saveDraft(false);updateReadiness()});
  row.querySelectorAll('input').forEach(i=>i.addEventListener('input',onChange));$('#ownerList').appendChild(row);
}
function addSignatory(data={}){
  const row=document.createElement('div');row.className='repeater-row signatory';
  row.innerHTML=`<label class="field"><span>Full name</span><input data-signatory="name" required value="${esc(data.name||'')}"></label><label class="field"><span>Role / capacity</span><input data-signatory="role" value="${esc(data.role||'')}"></label><label class="field"><span>Email</span><input data-signatory="email" type="email" value="${esc(data.email||'')}"></label><button type="button" class="remove" aria-label="Remove signatory">×</button>`;
  row.querySelector('.remove').addEventListener('click',()=>{if($$('#signatoryList .repeater-row').length>1)row.remove();saveDraft(false);updateReadiness()});
  row.querySelectorAll('input').forEach(i=>i.addEventListener('input',onChange));$('#signatoryList').appendChild(row);
}
function collectRepeaters(){
  const owners=$$('#ownerList .repeater-row').map(r=>({name:r.querySelector('[data-owner=name]').value.trim(),nationality:r.querySelector('[data-owner=nationality]').value.trim(),id:r.querySelector('[data-owner=id]').value.trim(),pct:Number(r.querySelector('[data-owner=pct]').value||0)}));
  const signatories=$$('#signatoryList .repeater-row').map(r=>({name:r.querySelector('[data-signatory=name]').value.trim(),role:r.querySelector('[data-signatory=role]').value.trim(),email:r.querySelector('[data-signatory=email]').value.trim()}));
  return{owners,signatories};
}

function renderDocuments(){
  $('#documentGrid').innerHTML=documentDefs.map(d=>`<article class="doc-card" data-doc="${d.id}"><div class="doc-head"><div><strong>${d.title}${d.required?' *':''}</strong><small>${d.help}</small></div><span class="doc-status" id="status-${d.id}">Not uploaded</span></div><div class="doc-actions"><label class="upload-btn">Choose file<input type="file" data-doc-input="${d.id}" accept="application/pdf,image/png,image/jpeg,image/webp"></label><button type="button" class="text-btn" data-preview="${d.id}" disabled>Preview</button><button type="button" class="text-btn" data-ocr="${d.id}" disabled>Extract with OCR</button></div><div class="ocr-bar" id="ocrbar-${d.id}"><i></i></div><div class="ocr-meta" id="ocrmeta-${d.id}"></div></article>`).join('');
  $$('[data-doc-input]').forEach(inp=>inp.addEventListener('change',e=>handleFile(e.currentTarget.dataset.doc,e.currentTarget.files?.[0])));
  $$('[data-preview]').forEach(b=>b.addEventListener('click',()=>previewDoc(b.dataset.preview)));
  $$('[data-ocr]').forEach(b=>b.addEventListener('click',()=>runOcr(b.dataset.ocr)));
  refreshDocumentCards();
}
function refreshDocumentCards(){
  let uploaded=0;
  documentDefs.forEach(d=>{
    const rec=docs[d.id],card=$(`[data-doc="${d.id}"]`);if(!card)return;
    const status=$('#status-'+d.id),preview=card.querySelector('[data-preview]'),ocr=card.querySelector('[data-ocr]'),meta=$('#ocrmeta-'+d.id);
    if(rec.file){uploaded++;status.textContent=rec.ocrState==='Complete'?'OCR complete':rec.file.name;status.className='doc-status ready';preview.disabled=false;ocr.disabled=false;meta.style.display='block';meta.textContent=rec.ocrState==='Complete'?`OCR ${rec.ocrConfidence??'—'}% · ${Object.keys(rec.candidates||{}).length} field candidate(s)`:`${Math.round(rec.file.size/1024).toLocaleString()} KB · OCR not yet run`;}
    else{status.textContent='Not uploaded';status.className='doc-status';preview.disabled=true;ocr.disabled=true;meta.style.display='none'}
  });
  $('#heroEvidence').textContent=`${uploaded} uploaded`;
}
function handleFile(id,file){
  if(!file)return;const rec=docs[id];if(rec.url)URL.revokeObjectURL(rec.url);rec.file=file;rec.url=URL.createObjectURL(file);rec.ocrText='';rec.ocrConfidence=null;rec.candidates={};rec.ocrState='Not run';refreshDocumentCards();saveDraft(false);updateReadiness();
}
function previewDoc(id){
  const rec=docs[id];if(!rec.file)return;$('#previewTitle').textContent=`${rec.title} · ${rec.file.name}`;
  const type=rec.file.type||'';if(type==='application/pdf')$('#previewBody').innerHTML=`<iframe class="preview-frame" src="${rec.url}" title="${esc(rec.file.name)}"></iframe>`;else $('#previewBody').innerHTML=`<img class="preview-image" src="${rec.url}" alt="Preview of ${esc(rec.file.name)}">`;
  openModal('previewModal');
}
function openModal(id){$('#'+id).classList.add('show')}
function closeModal(id){$('#'+id).classList.remove('show')}
$$('[data-close-modal]').forEach(b=>b.addEventListener('click',()=>closeModal(b.dataset.closeModal)));
$$('.modal').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)closeModal(m.id)}));
document.addEventListener('keydown',e=>{if(e.key==='Escape')$$('.modal.show').forEach(m=>closeModal(m.id))});

function loadScriptOnce(src,globalName){return new Promise((resolve,reject)=>{if(globalName&&window[globalName])return resolve(window[globalName]);const old=[...document.scripts].find(s=>s.src===src);if(old){old.addEventListener('load',()=>resolve(globalName?window[globalName]:true),{once:true});old.addEventListener('error',reject,{once:true});return}const s=document.createElement('script');s.src=src;s.async=true;s.onload=()=>resolve(globalName?window[globalName]:true);s.onerror=()=>reject(new Error('Unable to load '+src));document.head.appendChild(s)})}
async function fileToOcrImage(file){
  if(file.type==='application/pdf'){
    await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js','pdfjsLib');
    if(!window.pdfjsLib)throw new Error('PDF reader unavailable');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const buf=await file.arrayBuffer(),pdf=await window.pdfjsLib.getDocument({data:buf}).promise,page=await pdf.getPage(1),vp=page.getViewport({scale:1.6}),canvas=document.createElement('canvas');canvas.width=vp.width;canvas.height=vp.height;await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;return canvas;
  }
  return URL.createObjectURL(file);
}
function parseOcrText(text){
  const out={};const lines=text.split(/\n+/).map(s=>s.trim()).filter(Boolean);
  const patterns=[
    ['registrationRef',/(?:registration|company|reg\.?|certificate)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z0-9\/\-.]{5,})/i],
    ['taxId',/(?:tax|tin|taxpayer)\s*(?:id|number|no\.)?\s*[:\-]?\s*([A-Z0-9\/\-.]{5,})/i],
    ['bankAccount',/(?:account|a\/c)\s*(?:number|no\.|#)?\s*[:\-]?\s*([A-Z0-9\-.]{5,})/i],
    ['swift',/(?:swift|bic)\s*[:\-]?\s*([A-Z0-9]{8,11})/i]
  ];
  patterns.forEach(([key,re])=>{const m=text.match(re);if(m)out[key]=m[1]});
  const nameLine=lines.find(l=>/^(?:legal\s+name|name|account\s+holder|entity)\s*[:\-]/i.test(l));if(nameLine){const v=nameLine.replace(/^[^:\-]+[:\-]\s*/, '').trim();if(v.length>3)out.legalName=v}
  const addressIdx=lines.findIndex(l=>/^address\s*[:\-]?$/i.test(l)||/^registered address/i.test(l));if(addressIdx>=0&&lines[addressIdx+1])out.registeredAddress=lines.slice(addressIdx+1,addressIdx+3).join(', ');
  return out;
}
async function runOcr(id,showResult=true){
  const rec=docs[id];if(!rec.file)return;const bar=$('#ocrbar-'+id),fill=bar.querySelector('i'),meta=$('#ocrmeta-'+id);bar.style.display='block';fill.style.width='3%';meta.style.display='block';meta.textContent='Loading OCR engine…';rec.ocrState='Running';
  try{
    await loadScriptOnce('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js','Tesseract');
    const source=await fileToOcrImage(rec.file);
    const result=await window.Tesseract.recognize(source,'eng',{logger:m=>{if(m.status==='recognizing text'){fill.style.width=Math.max(6,Math.round((m.progress||0)*100))+'%';meta.textContent=`OCR ${Math.round((m.progress||0)*100)}% · ${rec.file.name}`}}});
    if(typeof source==='string'&&source.startsWith('blob:'))URL.revokeObjectURL(source);
    rec.ocrText=result.data.text||'';rec.ocrConfidence=Math.round(result.data.confidence||0);rec.candidates=parseOcrText(rec.ocrText);rec.ocrState='Complete';fill.style.width='100%';refreshDocumentCards();if(showResult)showOcrResult(id);updateReadiness();saveDraft(false);
  }catch(err){rec.ocrState='Unavailable';fill.style.width='0';meta.textContent='OCR could not run in this browser. The original document is still attached. '+err.message;console.warn(err)}
}
function showOcrResult(id){
  const rec=docs[id];$('#ocrTitle').textContent=`OCR extraction · ${rec.file?.name||rec.title}`;const entries=Object.entries(rec.candidates||{});
  $('#ocrBody').innerHTML=`<div class="ocr-result"><div><div class="eyebrow">EXTRACTED TEXT · CONFIDENCE ${rec.ocrConfidence??'—'}%</div><div class="ocr-text">${esc(rec.ocrText||'No readable text extracted.')}</div></div><div><div class="eyebrow">FIELD CANDIDATES</div><div class="candidate-list">${entries.length?entries.map(([k,v])=>`<div class="candidate"><span>${esc(k)}</span><strong>${esc(v)}</strong><small>Candidate only · verify against the original document</small><button type="button" class="text-btn" data-apply-ocr="${esc(k)}" data-value="${esc(v)}">Apply to application</button></div>`).join(''):'<div class="candidate"><strong>No structured candidates detected</strong><small>The full OCR text remains available for human review.</small></div>'}</div></div></div>`;
  $$('[data-apply-ocr]').forEach(b=>b.addEventListener('click',()=>{const key=b.dataset.applyOcr,val=b.dataset.value;if($('#'+key)){$('#'+key).value=val;saveDraft(false);updateReadiness();b.textContent='Applied ✓'}}));openModal('ocrModal');
}
async function runAllOcr(){const ids=documentDefs.filter(d=>docs[d.id].file&&docs[d.id].ocrState!=='Complete').map(d=>d.id);if(!ids.length)return alert('Upload at least one document that still needs OCR.');for(const id of ids)await runOcr(id,false);alert(`${ids.length} document(s) processed. Open any document to review its OCR candidates.`)}

const dataIds=['investorType','legalName','registrationRef','jurisdiction','incorporationDate','regulatedStatus','regulator','licenceRef','website','registeredAddress','relationship','mandate','initialInvestment','baseCurrency','investorClassification','primaryEmail','primaryContact','telephone','purpose','ownershipNarrative','authorityNarrative','pep','sanctions','adverseMedia','highRiskJurisdiction','sourceFunds','sourceWealth','annualVolume','transactionFrequency','fundingJurisdictions','expectedCurrencies','sourceFundsNarrative','expectedActivity','taxResidence','taxId','fatca','giin','crs','usIndicia','bankName','bankHolder','bankCountry','bankAccount','swift','bankCurrency','evidenceNote','complianceContact','signatureName','signatureCapacity'];
function collect(){const d={};dataIds.forEach(id=>d[id]=value(id));Object.assign(d,collectRepeaters());d.documents=documentDefs.filter(def=>docs[def.id].file).map(def=>({id:def.id,title:def.title,name:docs[def.id].file.name,type:docs[def.id].file.type,size:docs[def.id].file.size,ocrState:docs[def.id].ocrState,ocrConfidence:docs[def.id].ocrConfidence,candidates:docs[def.id].candidates}));return d}
function saveDraft(show=true){const d=collect();try{localStorage.setItem(DRAFT,JSON.stringify(d));$('#draftStatus').textContent='Saved just now';const rs=$('#railState');if(rs)rs.textContent='Saved just now'}catch(e){}if(show){const b=$('#saveBtn'),old=b.textContent;b.textContent='Saved ✓';setTimeout(()=>b.textContent=old,800)}}
function restoreDraft(){try{const d=JSON.parse(localStorage.getItem(DRAFT)||'null');if(!d)return;dataIds.forEach(id=>setValue(id,d[id]));$('#ownerList').innerHTML='';(d.owners?.length?d.owners:[{}]).forEach(addOwner);$('#signatoryList').innerHTML='';(d.signatories?.length?d.signatories:[{}]).forEach(addSignatory)}catch(e){console.warn('Draft not restored',e)}}
const onChange=debounce(()=>{saveDraft(false);updateReadiness()},120);

function validatePane(index,report=true){const pane=$(`[data-pane="${index}"]`);if(!pane)return true;for(const el of pane.querySelectorAll('[required]')){if(!el.checkValidity()){if(report)el.reportValidity();return false}}if(index===1){const owners=collectRepeaters().owners;if(!owners.some(o=>o.name)){if(report)alert('Add at least one beneficial owner, controller, trustee or governing person.');return false}}if(index===4){const missing=documentDefs.filter(d=>d.required&&!docs[d.id].file);if(missing.length&&report){alert(`Supporting evidence still missing: ${missing.slice(0,4).map(x=>x.title).join(', ')}${missing.length>4?'…':''}`);return false}}return true}

function computeReadiness(){
  const d=collect(), requiredFields=['legalName','registrationRef','jurisdiction','registeredAddress','primaryEmail','primaryContact','sourceFundsNarrative','expectedActivity','taxResidence','bankName','bankHolder','bankCountry','bankAccount'];
  const fieldComplete=requiredFields.filter(k=>String(d[k]||'').trim()).length/requiredFields.length;
  const requiredDocs=documentDefs.filter(x=>x.required), uploaded=requiredDocs.filter(x=>docs[x.id].file).length/requiredDocs.length;
  const owners=d.owners?.filter(o=>o.name).length?1:0, signatories=d.signatories?.filter(s=>s.name).length?1:0;
  const score=Math.round((fieldComplete*.42+uploaded*.34+owners*.12+signatories*.07+(lastAiResult?1:0)*.05)*100);
  return Math.min(100,Math.max(0,score));
}
function buildChecks(){
  const d=collect(),requiredDocs=documentDefs.filter(x=>x.required),missingDocs=requiredDocs.filter(x=>!docs[x.id].file),ocrDone=documentDefs.filter(x=>docs[x.id].ocrState==='Complete').length;
  const bankMatch=!d.legalName||!d.bankHolder?null:normaliseName(d.legalName)===normaliseName(d.bankHolder)||normaliseName(d.bankHolder).includes(normaliseName(d.legalName).split(' ')[0]);
  return[
    {name:'Core application',state:value('legalName')&&value('registrationRef')&&value('sourceFundsNarrative')?'good':'warn',detail:value('legalName')?'Profile captured':'Legal profile incomplete',right:value('registrationRef')?'Ready':'Incomplete'},
    {name:'Beneficial ownership',state:d.owners?.some(o=>o.name)?'good':'warn',detail:d.owners?.filter(o=>o.name).length?`${d.owners.filter(o=>o.name).length} person(s) captured`:'Owner / controller required',right:d.owners?.some(o=>o.name)?'Captured':'Required'},
    {name:'Required evidence',state:missingDocs.length?'warn':'good',detail:missingDocs.length?`${missingDocs.length} required document(s) outstanding`:'Required evidence uploaded',right:`${requiredDocs.length-missingDocs.length}/${requiredDocs.length}`},
    {name:'OCR extraction',state:ocrDone?'good':'',detail:ocrDone?`${ocrDone} document(s) extracted`:'Run OCR after upload',right:ocrDone?'Active':'Optional'},
    {name:'Bank holder consistency',state:bankMatch===true?'good':bankMatch===false?'warn':'',detail:bankMatch===true?'Holder broadly aligns to legal name':bankMatch===false?'Possible name mismatch — human review required':'Waiting for bank details',right:bankMatch===false?'Review':bankMatch===true?'Pass':'Pending'},
    {name:'Sanctions / PEP / adverse media',state:lastAiResult?.externalProvider==='connected'?'good':'warn',detail:lastAiResult?.externalProvider==='connected'?'Approved provider result attached':'External screening provider result not yet attached',right:lastAiResult?.externalProvider==='connected'?'Provider':'Pending'},
    {name:'Human compliance decision',state:'',detail:'Required before account activation',right:'Mandatory'}
  ];
}
function normaliseName(s=''){return s.toLowerCase().replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim()}
function updateReadiness(){
  const score=computeReadiness();$('#readinessScore').textContent=score+'%';$('#scoreBar').style.width=score+'%';
  const checks=buildChecks();$('#checkList').innerHTML=checks.map(c=>`<div class="check-row"><span class="check-icon ${c.state}">${c.state==='good'?'✓':c.state==='warn'?'!':'•'}</span><span><strong>${c.name}</strong><small>${c.detail}</small></span><em>${c.right}</em></div>`).join('');
  const risk=lastAiResult?.risk||'Pending';$('#riskBadge').textContent=risk==='Pending'?'Risk pending':`${risk} review risk`;
  refreshDocumentCards();
}
function runAiTriage(show=true){
  const d=collect(),flags=[];
  if(d.pep!=='no')flags.push({severity:'high',code:'PEP_REVIEW',message:'PEP / public-office relationship requires enhanced human review and provider screening.'});
  if(d.sanctions!=='no')flags.push({severity:'high',code:'SANCTIONS_DECLARATION',message:'Applicant declared possible sanctions exposure. Do not proceed without provider evidence and Compliance review.'});
  if(d.adverseMedia!=='no')flags.push({severity:'medium',code:'ADVERSE_MEDIA',message:'Applicant disclosed possible adverse media / legal matters.'});
  if(d.highRiskJurisdiction!=='no')flags.push({severity:'medium',code:'JURISDICTION_EDD',message:'Enhanced-risk jurisdiction nexus requires policy-driven EDD.'});
  const pct=(d.owners||[]).reduce((s,o)=>s+Number(o.pct||0),0);if(pct>100.01)flags.push({severity:'medium',code:'OWNERSHIP_TOTAL',message:`Declared ownership totals ${pct.toFixed(1)}%, above 100%.`});
  if(Number(d.initialInvestment||0)>=1000000)flags.push({severity:'medium',code:'VALUE_EDD',message:'Large initial investment should be checked against the manager\'s enhanced-review threshold and source-of-funds policy.'});
  if(d.legalName&&d.bankHolder&&normaliseName(d.legalName)!==normaliseName(d.bankHolder)&&!normaliseName(d.bankHolder).includes(normaliseName(d.legalName).split(' ')[0]))flags.push({severity:'medium',code:'BANK_NAME_MISMATCH',message:'Funding-account holder does not clearly match the investor legal name.'});
  documentDefs.forEach(def=>{const rec=docs[def.id];if(rec.candidates?.legalName&&d.legalName&&normaliseName(rec.candidates.legalName)!==normaliseName(d.legalName))flags.push({severity:'medium',code:'OCR_NAME_MISMATCH',message:`${def.title}: OCR name candidate differs from the entered legal name.`});if(rec.candidates?.registrationRef&&d.registrationRef&&normaliseName(rec.candidates.registrationRef)!==normaliseName(d.registrationRef))flags.push({severity:'medium',code:'OCR_REG_MISMATCH',message:`${def.title}: OCR registration candidate differs from the entered reference.`})});
  const missing=documentDefs.filter(x=>x.required&&!docs[x.id].file);if(missing.length)flags.push({severity:'medium',code:'MISSING_EVIDENCE',message:`${missing.length} required evidence item(s) are still missing.`});
  const high=flags.filter(x=>x.severity==='high').length,med=flags.filter(x=>x.severity==='medium').length;
  const risk=high?'High':med>=2?'High':med===1?'Medium':'Low';
  lastAiResult={runAt:new Date().toISOString(),risk,flags,externalProvider:'not_connected',readiness:computeReadiness(),model:'ATS v57 · deterministic prototype triage',humanReviewRequired:true};
  updateReadiness();saveDraft(false);if(show)showAiDetails();return lastAiResult;
}
function showAiDetails(){
  const r=lastAiResult||runAiTriage(false),d=collect(),flags=r.flags||[];
  $('#aiBody').innerHTML=`<div class="review-card"><div class="review-head"><strong>AI-assisted triage result</strong><span class="doc-status ${r.risk==='Low'?'ready':''}">${r.risk} review risk</span></div><div class="review-body"><div><span>Readiness</span><strong>${computeReadiness()}%</strong><small>Form + evidence completeness</small></div><div><span>Model</span><strong>${esc(r.model)}</strong><small>Advisory triage only</small></div><div><span>External screening</span><strong>Provider result required</strong><small>No fabricated sanctions / PEP / media result</small></div></div></div><div class="section-title"><div><h3>Exceptions and review prompts</h3><p>Every item below should be resolved against original evidence and approved provider data.</p></div></div><div class="candidate-list">${flags.length?flags.map(f=>`<div class="candidate"><span>${esc(f.code.replaceAll('_',' '))}</span><strong>${esc(f.message)}</strong><small>Severity: ${esc(f.severity)} · human review required</small></div>`).join(''):'<div class="candidate"><strong>No rule-based exceptions identified</strong><small>This is not a sanctions/PEP/adverse-media clearance. Approved external screening is still required.</small></div>'}</div><div class="review-card" style="margin-top:12px"><div class="review-head"><strong>Screening plan</strong></div><div class="review-body"><div><span>Identity / legal existence</span><strong>${d.registrationRef?'Ready':'Incomplete'}</strong></div><div><span>UBO screening population</span><strong>${d.owners?.filter(o=>o.name).length||0} person(s)</strong></div><div><span>Required provider checks</span><strong>Sanctions · PEP · adverse media</strong></div></div></div>`;openModal('aiModal');
}

function renderReview(){
  const d=collect(),required=documentDefs.filter(x=>x.required),uploaded=required.filter(x=>docs[x.id].file).length,totalOwners=d.owners?.filter(o=>o.name).length||0;
  $('#reviewSummary').innerHTML=`
    <article class="review-card"><div class="review-head"><strong>Investor and relationship</strong><button type="button" data-edit-step="0">Edit</button></div><div class="review-body"><div><span>Investor</span><strong>${esc(d.legalName||'—')}</strong><small>${esc(d.investorType||'')}</small></div><div><span>Relationship</span><strong>${esc(d.relationship||'—')}</strong><small>${esc(d.mandate||'')}</small></div><div><span>Expected investment</span><strong>${money(d.initialInvestment)}</strong><small>${esc(d.baseCurrency||'USD')} base</small></div></div></article>
    <article class="review-card"><div class="review-head"><strong>KYC / AML profile</strong><button type="button" data-edit-step="2">Edit</button></div><div class="review-body"><div><span>Owners / controllers</span><strong>${totalOwners}</strong><small>Screening population</small></div><div><span>Source of funds</span><strong>${esc(d.sourceFunds||'—')}</strong><small>${esc(d.fundingJurisdictions||'')}</small></div><div><span>Declarations</span><strong>${[d.pep,d.sanctions,d.adverseMedia].some(v=>v&&v!=='no')?'Review required':'No self-declared flags'}</strong><small>Provider checks still mandatory</small></div></div></article>
    <article class="review-card"><div class="review-head"><strong>Tax, bank and evidence</strong><button type="button" data-edit-step="3">Edit</button></div><div class="review-body"><div><span>Tax residence</span><strong>${esc(d.taxResidence||'—')}</strong><small>${esc(d.fatca||'')}</small></div><div><span>Funding bank</span><strong>${esc(d.bankName||'—')}</strong><small>${esc(d.bankHolder||'')}</small></div><div><span>Required evidence</span><strong>${uploaded}/${required.length}</strong><small>${documentDefs.filter(x=>docs[x.id].ocrState==='Complete').length} OCR complete</small></div></div></article>`;
  $$('[data-edit-step]').forEach(b=>b.addEventListener('click',()=>{step=Number(b.dataset.editStep);render()}));
}

function submitApplication(e){
  e.preventDefault();
  for(let i=0;i<steps.length;i++){if(!validatePane(i,true)){step=i;render();return}}
  if(!lastAiResult)lastAiResult=runAiTriage(false);
  const d=collect(),ref='LP-'+new Date().getFullYear()+'-'+Math.floor(10000+Math.random()*89999),docsDone=d.documents.length,docsTotal=documentDefs.filter(x=>x.required).length;
  const record={id:ref,name:d.legalName,type:d.investorType,channel:'Investor / LP portal',stage:'Submitted',risk:lastAiResult.risk,identity:'Queued',screening:'Provider checks required',funds:'Queued',docsDone,docsTotal,owner:'Client Services intake',sla:'Just now',slaState:'Digital submission',progress:25,next:'Run approved identity, sanctions, PEP and adverse-media screening; review OCR consistency and source-of-funds evidence.',applicant:{registrationRef:d.registrationRef,email:d.primaryEmail,phone:d.telephone,country:d.jurisdiction,expectedInvestment:Number(d.initialInvestment||0),relationship:d.relationship,mandate:d.mandate,sourceOfFunds:d.sourceFunds,sourceOfWealth:d.sourceWealth,beneficialOwnerCount:d.owners.filter(o=>o.name).length,beneficialOwners:d.owners,signatories:d.signatories,purpose:d.purpose,activity:d.expectedActivity,taxResidence:d.taxResidence,fatca:d.fatca,crs:d.crs,bank:{name:d.bankName,holder:d.bankHolder,country:d.bankCountry,account:d.bankAccount,currency:d.bankCurrency,swift:d.swift},documents:d.documents,declarations:{pep:d.pep,sanctions:d.sanctions,adverseMedia:d.adverseMedia,highRiskJurisdiction:d.highRiskJurisdiction},signature:{name:d.signatureName,capacity:d.signatureCapacity,submittedAt:new Date().toISOString()}},ai:{status:'ATS triage complete · provider screening pending',modelVersion:lastAiResult.model,documentCompleteness:Math.round((docsDone/docsTotal)*100),reviewPriorityScore:lastAiResult.risk==='High'?80:lastAiResult.risk==='Medium'?55:25,exceptions:lastAiResult.flags.map(f=>({code:f.code,message:f.message,resolved:false})),disposition:`${lastAiResult.risk} review risk · external screening required`,humanReviewRequired:true,finalDecision:null,caveat:'AI-assisted triage is advisory. Final KYC/AML decision and external watchlist screening are human/provider-controlled.'},timeline:[[todayTime(),'Investor / LP application submitted',`Digital application captured with ${docsDone} evidence item(s), OCR metadata and AI-assisted triage.`]]};
  try{const book=JSON.parse(localStorage.getItem(BOOK)||'[]');book.unshift(record);localStorage.setItem(BOOK,JSON.stringify(book));localStorage.removeItem(DRAFT)}catch(err){console.warn('Could not persist application book',err)}
  $('#applicationForm').style.display='none';$('#successPanel').classList.add('show');$('#successRef').textContent=ref;$('#successAi').textContent=`${lastAiResult.risk} risk · provider checks pending`;$('#sidePanel').style.display='none';$('#successPanel').scrollIntoView({behavior:'smooth',block:'center'});
}

$('#addOwner').addEventListener('click',()=>addOwner());$('#addSignatory').addEventListener('click',()=>addSignatory());$('#runAllOcr').addEventListener('click',runAllOcr);$('#runAiBtn').addEventListener('click',()=>runAiTriage(true));$('#viewAiBtn').addEventListener('click',showAiDetails);
$('#nextBtn').addEventListener('click',()=>{if(!validatePane(step,true))return;saveDraft(false);step=Math.min(steps.length-1,step+1);render()});$('#backBtn').addEventListener('click',()=>{step=Math.max(0,step-1);render()});$('#saveBtn').addEventListener('click',()=>saveDraft(true));$('#applicationForm').addEventListener('submit',submitApplication);
renderDocuments();restoreDraft();if(!$('#ownerList').children.length)addOwner();if(!$('#signatoryList').children.length)addSignatory();
[...dataIds.map(id=>$('#'+id)).filter(Boolean)].forEach(el=>{el.addEventListener('input',onChange);el.addEventListener('change',onChange)});render();
})();
