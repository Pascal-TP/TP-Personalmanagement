import { db } from './firebase.js';
import { collection, getDocs, getDoc, doc, query, where, addDoc, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { setHead } from './app.js';
import { esc, fmtDateTime, toast } from './utils.js';
import { hasAdminPermission } from './permissions.js';

const FIELD_DEFS=[
  {key:'name',label:'Name',group:'Persönliche Daten',scope:'public',type:'text'},
  {key:'street',label:'Straße / Hausnummer',group:'Kontaktdaten',type:'text'},
  {key:'postalCode',label:'PLZ',group:'Kontaktdaten',type:'text'},
  {key:'city',label:'Ort',group:'Kontaktdaten',type:'text'},
  {key:'privateEmail',label:'Private E-Mail',group:'Kontaktdaten',type:'email'},
  {key:'phone',label:'Telefon',group:'Kontaktdaten',type:'tel'},
  {key:'mobile',label:'Mobil',group:'Kontaktdaten',type:'tel'},
  {key:'emergencyContactName',label:'Notfallkontakt',group:'Kontaktdaten',type:'text'},
  {key:'emergencyContactPhone',label:'Telefon Notfallkontakt',group:'Kontaktdaten',type:'tel'},
  {key:'iban',label:'IBAN',group:'Bankdaten',type:'text'},
  {key:'bic',label:'BIC',group:'Bankdaten',type:'text'},
  {key:'bankId',label:'Bank',group:'Bankdaten',type:'select',source:'banks'},
  {key:'accountHolder',label:'Kontoinhaber',group:'Bankdaten',type:'text'},
  {key:'healthInsuranceId',label:'Krankenkasse',group:'Versicherungsdaten',type:'select',source:'insurers'},
  {key:'insuranceType',label:'Versicherungsart',group:'Versicherungsdaten',type:'select',options:['gesetzlich pflichtversichert','gesetzlich freiwillig','privat versichert','familienversichert','sonstiges']},
  {key:'socialSecurityNumber',label:'Sozialversicherungsnummer',group:'Versicherungsdaten',type:'text'},
  {key:'maritalStatus',label:'Familienstand',group:'Familie & Steuer',type:'select',options:['ledig','verheiratet','geschieden','verwitwet']},
  {key:'marriageDate',label:'Heirat am',group:'Familie & Steuer',type:'date'},
  {key:'taxClass',label:'Steuerklasse',group:'Familie & Steuer',type:'select',options:['I','II','III','IV','IV mit Faktor','V','VI']}
];
const REDACTED=new Set(['iban','socialSecurityNumber']);
const val=v=>v??'';
function same(a,b){return String(val(a)).trim()===String(val(b)).trim()}
function optionsHtml(def,current,refs){let arr=[];if(def.source==='banks')arr=refs.banks.map(x=>[x.id,`${x.name}${x.bic?` · ${x.bic}`:''}`]);else if(def.source==='insurers')arr=refs.insurers.map(x=>[x.id,`${x.name}${x.code?` · ${x.code}`:''}`]);else arr=(def.options||[]).map(x=>[x,x]);return `<option value="">– auswählen –</option>${arr.map(([v,l])=>`<option value="${esc(v)}" ${String(current)===String(v)?'selected':''}>${esc(l)}</option>`).join('')}`}
function inputHtml(def,current,refs,namePrefix='chg_'){if(def.type==='select')return `<select name="${namePrefix}${def.key}">${optionsHtml(def,current,refs)}</select>`;return `<input name="${namePrefix}${def.key}" type="${def.type||'text'}" value="${esc(current)}">`}
function labelValue(def,value,refs){if(value===null||value===undefined||value==='')return '–';if(REDACTED.has(def.key))return '[hinterlegt]';if(def.source==='banks')return refs.banks.find(x=>x.id===value)?.name||String(value);if(def.source==='insurers')return refs.insurers.find(x=>x.id===value)?.name||String(value);return String(value)}
async function refs(){const [b,i]=await Promise.all([getDocs(collection(db,'banks')),getDocs(collection(db,'healthInsurers'))]);return {banks:b.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.active!==false),insurers:i.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.active!==false)} }
function statusPill(s){return `<span class="pill ${s==='pending'?'yellow':s==='done'?'green':'gray'}">${s==='pending'?'offen':s==='done'?'erledigt':'abgelehnt'}</span>`}

async function renderEmployee(el,ctx){
  setHead('Änderungsantrag','Änderungen an persönlichen Stammdaten an die Personalabteilung senden.');
  const [privSnap,rSnap,ref]=await Promise.all([getDoc(doc(db,'employeePrivate',ctx.profile.id)),getDocs(query(collection(db,'personalDataChangeRequests'),where('userId','==',ctx.profile.id))),refs()]);
  const priv=privSnap.exists()?privSnap.data():{}; const current={name:ctx.profile.name||'',...priv};
  const requests=rSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0));
  const pending=requests.find(r=>r.status==='pending');
  const groups=[...new Set(FIELD_DEFS.map(x=>x.group))];
  el.innerHTML=`<article class="card change-request-card"><div class="card-head"><div><h2>Persönliche Daten ändern</h2><p>Es werden nur tatsächlich geänderte Felder an die Personalabteilung übermittelt.</p></div></div>${pending?`<div class="info-strip">Es besteht bereits ein offener Antrag vom ${esc(fmtDateTime(pending.createdAt))}. Ein weiterer Antrag ist erst nach Bearbeitung möglich.</div>`:`<form id="change-request-form" class="change-request-form">${groups.map(g=>`<section><h3>${esc(g)}</h3><div class="form-grid">${FIELD_DEFS.filter(x=>x.group===g).map(d=>`<label class="field"><span>${esc(d.label)}</span>${inputHtml(d,current[d.key],ref)}</label>`).join('')}</div></section>`).join('')}<label class="field full"><span>Hinweis an die Personalabteilung</span><textarea name="note" rows="3" placeholder="Optionaler Hinweis, z. B. Namensänderung nach Heirat"></textarea></label><div class="form-actions"><button class="btn primary" type="submit">Änderungsantrag senden</button></div></form>`}</article>
  <article class="card"><div class="card-head"><div><h2>Meine Änderungsanträge</h2><p>Erledigte Anträge bleiben als Nachweis erhalten.</p></div></div><div class="change-request-list">${requests.length?requests.map(r=>`<div class="change-request-item"><div><strong>${esc(fmtDateTime(r.createdAt))}</strong>${statusPill(r.status)}</div><span>${esc((r.changedFields||[]).map(k=>FIELD_DEFS.find(d=>d.key===k)?.label||k).join(', ')||'–')}</span><small>${(r.changedFields||[]).map(k=>{const d=FIELD_DEFS.find(x=>x.key===k);return d?`${esc(d.label)}: ${esc(labelValue(d,r.submittedData?.[k],ref))}`:''}).filter(Boolean).join(' · ')}</small>${r.adminNote?`<small>${esc(r.adminNote)}</small>`:''}</div>`).join(''):'<div class="empty">Noch keine Änderungsanträge vorhanden.</div>'}</div></article>`;
  const form=el.querySelector('#change-request-form'); if(!form)return;
  form.onsubmit=async e=>{e.preventDefault();const submittedData={},changedFields=[];FIELD_DEFS.forEach(d=>{let v=form.elements[`chg_${d.key}`]?.value??'';if(['iban','bic'].includes(d.key))v=v.replace(/\s+/g,'').toUpperCase();if(d.key==='privateEmail')v=v.trim().toLowerCase();else if(typeof v==='string')v=v.trim();if(!same(v,current[d.key])){submittedData[d.key]=v;changedFields.push(d.key)}});if(!changedFields.length){toast('Es wurden keine Änderungen erkannt.');return}await addDoc(collection(db,'personalDataChangeRequests'),{userId:ctx.profile.id,employeeName:ctx.profile.name||'',employeeNumber:ctx.profile.employeeNumber||'',companyId:ctx.profile.companyId||'',status:'pending',changedFields,submittedData,note:form.elements.note.value.trim(),createdAt:serverTimestamp(),updatedAt:serverTimestamp()});toast('Änderungsantrag wurde gesendet.');await renderEmployee(el,ctx)};
}

async function renderAdmin(el,ctx){
  setHead('Änderungsanträge','Persönliche Stammdatenänderungen prüfen und in die Mitarbeiterakte übernehmen.');
  if(!hasAdminPermission(ctx.profile,'personalDataChanges')){el.innerHTML='<div class="error-card">Keine Berechtigung für Stammdaten-Änderungsanträge.</div>';return}
  const [rSnap,uSnap,ref]=await Promise.all([getDocs(collection(db,'personalDataChangeRequests')),getDocs(collection(db,'users')),refs()]);
  const users=new Map(uSnap.docs.map(d=>[d.id,{id:d.id,...d.data()}]));
  const reqs=rSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>{if(a.status==='pending'&&b.status!=='pending')return -1;if(b.status==='pending'&&a.status!=='pending')return 1;return (b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0)});
  el.innerHTML=`<article class="card"><div class="card-head"><div><h2>Stammdaten-Änderungsanträge</h2><p>${reqs.filter(r=>r.status==='pending').length} offene Anträge · Originalmeldung bleibt unverändert erhalten.</p></div></div><div class="change-request-admin-list">${reqs.length?reqs.map(r=>`<button type="button" class="change-request-admin-row" data-id="${r.id}"><span><strong>${esc(r.employeeName||users.get(r.userId)?.name||'Mitarbeiter')}</strong><small>${esc(fmtDateTime(r.createdAt))}</small></span>${statusPill(r.status)}</button>`).join(''):'<div class="empty">Keine Änderungsanträge vorhanden.</div>'}</div></article><div id="change-request-detail"></div>`;
  const detail=el.querySelector('#change-request-detail');
  async function open(r){const user=users.get(r.userId)||{};const ps=await getDoc(doc(db,'employeePrivate',r.userId));const priv=ps.exists()?ps.data():{};const current={name:user.name||'',...priv};const fields=(r.changedFields||[]).map(k=>FIELD_DEFS.find(d=>d.key===k)).filter(Boolean);detail.innerHTML=`<article class="card change-review-card"><div class="card-head"><div><h2>${esc(r.employeeName||user.name||'Mitarbeiter')}</h2><p>Antrag vom ${esc(fmtDateTime(r.createdAt))}${r.note?` · Hinweis: ${esc(r.note)}`:''}</p></div>${statusPill(r.status)}</div><div class="change-review-grid"><div class="change-review-head">Feld</div><div class="change-review-head">Aktuell</div><div class="change-review-head">Gemeldet / zu übernehmen</div>${fields.map(d=>`<div><strong>${esc(d.label)}</strong></div><div>${esc(labelValue(d,current[d.key],ref))}</div><div>${r.status==='pending'?inputHtml(d,r.submittedData?.[d.key],ref,'review_'):esc(labelValue(d,r.reviewedData?.[d.key]??r.submittedData?.[d.key],ref))}</div>`).join('')}</div>${r.status==='pending'?`<label class="field full"><span>Interne Bemerkung</span><textarea id="review-note" rows="2"></textarea></label><div class="form-actions"><button class="btn primary" id="apply-request" type="button">Geprüft und Mitarbeiterakte aktualisieren</button><button class="btn secondary" id="reject-request" type="button">Antrag ablehnen</button></div>`:`${r.adminNote?`<div class="info-strip">${esc(r.adminNote)}</div>`:''}`}</article>`;
    if(r.status!=='pending')return;
    detail.querySelector('#apply-request').onclick=async()=>{const reviewedData={};fields.forEach(d=>{let v=detail.querySelector(`[name="review_${d.key}"]`)?.value??'';if(['iban','bic'].includes(d.key))v=v.replace(/\s+/g,'').toUpperCase();if(d.key==='privateEmail')v=v.trim().toLowerCase();else if(typeof v==='string')v=v.trim();reviewedData[d.key]=v});const publicUpdates={},privateUpdates={};fields.forEach(d=>{if(d.scope==='public')publicUpdates[d.key]=reviewedData[d.key];else privateUpdates[d.key]=reviewedData[d.key]});const changes=fields.filter(d=>!same(current[d.key],reviewedData[d.key])).map(d=>({field:d.scope==='public'?d.key:`private.${d.key}`,oldValue:REDACTED.has(d.key)?(current[d.key]?'[hinterlegt]':'[leer]'):val(current[d.key]),newValue:REDACTED.has(d.key)?(reviewedData[d.key]?'[hinterlegt]':'[leer]'):val(reviewedData[d.key])}));const batch=writeBatch(db);if(Object.keys(publicUpdates).length)batch.update(doc(db,'users',r.userId),{...publicUpdates,updatedAt:serverTimestamp()});if(Object.keys(privateUpdates).length)batch.set(doc(db,'employeePrivate',r.userId),{...privateUpdates,updatedAt:serverTimestamp()},{merge:true});batch.update(doc(db,'personalDataChangeRequests',r.id),{status:'done',reviewedData,adminNote:detail.querySelector('#review-note').value.trim(),processedAt:serverTimestamp(),processedBy:ctx.user.uid,processedByName:ctx.profile.name||'',updatedAt:serverTimestamp()});if(changes.length)batch.set(doc(collection(db,'employeeHistory')),{employeeId:r.userId,employeeName:user.name||r.employeeName||'',employeeEmail:user.email||'',action:'change_request_applied',changes,actorId:ctx.user.uid,actorName:ctx.profile.name||'',actorEmail:ctx.profile.email||ctx.user.email||'',createdAt:serverTimestamp()});await batch.commit();toast('Mitarbeiterakte wurde aktualisiert.');await renderAdmin(el,ctx)};
    detail.querySelector('#reject-request').onclick=async()=>{const reason=prompt('Grund der Ablehnung / Hinweis an den Mitarbeiter:','')??null;if(reason===null)return;const batch=writeBatch(db);batch.update(doc(db,'personalDataChangeRequests',r.id),{status:'rejected',adminNote:reason.trim(),processedAt:serverTimestamp(),processedBy:ctx.user.uid,processedByName:ctx.profile.name||'',updatedAt:serverTimestamp()});await batch.commit();toast('Antrag wurde als abgelehnt abgeschlossen.');await renderAdmin(el,ctx)};
  }
  el.querySelectorAll('.change-request-admin-row').forEach(b=>b.onclick=()=>open(reqs.find(r=>r.id===b.dataset.id)));
  const first=reqs.find(r=>r.status==='pending')||reqs[0];if(first)await open(first);
}

export async function renderAenderungsantraege(el,ctx){return ctx.profile?.role==='admin'?renderAdmin(el,ctx):renderEmployee(el,ctx)}
