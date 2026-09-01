import { db } from "./firebase.js";
import { collection, addDoc, getDocs, query, where, updateDoc, deleteDoc, doc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setHead } from "./app.js";
import { esc, fmtDate, fmtDateTime, statusPill, toast } from "./utils.js";
import { hasAdminPermission } from "./permissions.js";
import { getAssignedDocs, supervisorIdsOf } from "./supervisor-utils.js";
import { vacationYearBalance } from "./vacation-utils.js";

const ABSENCE_TYPES=[
  ['vacation','Urlaub'],['sick','Krank'],['child_sick','Kind krank'],['special_leave','Sonderurlaub'],
  ['vocational_school','Berufsschule'],['training','Weiterbildung'],['university','Uni'],
  ['unpaid_leave','Unbezahlter Urlaub'],['release','Freistellung'],['parental_leave','Elternzeit'],['other','Sonstige Abwesenheit']
];
function parseDate(s){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||'');return m?new Date(Number(m[1]),Number(m[2])-1,Number(m[3]),12):null}
function workdays(a,b,days=['1','2','3','4','5']){let s=parseDate(a),e=parseDate(b),n=0;if(!s||!e)return 0;const allowed=new Set((days?.length?days:['1','2','3','4','5']).map(String));for(;s<=e;s.setDate(s.getDate()+1))if(allowed.has(String(s.getDay())))n++;return n}
function typeLabel(key){return ABSENCE_TYPES.find(x=>x[0]===key)?.[1]||key||'Abwesenheit'}
function absenceActive(a){return a?.status!=='withdrawn'}
function vacationStatus(v){
  if(v.status==='approved')return statusPill('Genehmigt','green');
  if(v.status==='rejected')return statusPill('Abgelehnt','red');
  if(v.status==='withdrawn')return statusPill('Zurückgezogen','gray');
  return statusPill('Beantragt','yellow');
}
function vacationHistory(v){
  const rows=[];
  if(v.createdAt)rows.push(`Beantragt: ${fmtDateTime(v.createdAt)}`);
  if(v.decidedAt)rows.push(`${v.status==='rejected'?'Abgelehnt':'Entschieden'}: ${fmtDateTime(v.decidedAt)}`);
  if(v.withdrawnAt)rows.push(`Zurückgezogen: ${fmtDateTime(v.withdrawnAt)}`);
  if(v.withdrawalAcknowledgedAt)rows.push(`Zur Kenntnis genommen: ${fmtDateTime(v.withdrawalAcknowledgedAt)}`);
  return rows.length?`<small class="vacation-history">${rows.map(esc).join(' · ')}</small>`:'';
}

export async function renderUrlaub(el,ctx){
  setHead("Urlaub & Abwesenheit","Urlaub / Abwesenheit beantragen, Abwesenheiten einsehen und Freigaben bearbeiten.");
  const isAdmin=ctx.profile.role==="admin";
  const canApprove=ctx.profile.role==="supervisor"||hasAdminPermission(ctx.profile,"vacationApprove");
  const canManageAbsences=hasAdminPermission(ctx.profile,"absenceManage");
  let own=[],team=[],absences=[],employees=[];
  try{const s=await getDocs(query(collection(db,"vacationRequests"),where("userId","==",ctx.profile.id)));own=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(b.from||'').localeCompare(String(a.from||'')))}catch(e){console.error('Eigene Urlaubsanträge konnten nicht geladen werden',e)}
  let carryoverSettings=[];try{const cs=await getDocs(query(collection(db,'vacationCarryoverSettings'),where('userId','==',ctx.profile.id)));carryoverSettings=cs.docs.map(d=>({id:d.id,...d.data()}))}catch(e){console.warn('Resturlaubseinstellungen konnten nicht geladen werden',e)}
  if(canApprove){
    try{
      if(isAdmin){
        const s=await getDocs(collection(db,"vacationRequests"));
        team=s.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.userId!==ctx.profile.id);
      }else{
        team=(await getAssignedDocs(db,"vacationRequests",ctx.profile.id)).filter(x=>x.userId!==ctx.profile.id);
      }
    }catch(e){console.error('Urlaubsfreigaben konnten nicht geladen werden',e)}
  }
  try{const s=await getDocs(query(collection(db,'absences'),where('userId','==',ctx.profile.id)));absences=s.docs.map(d=>({id:d.id,...d.data()}))}catch{}
  if(canManageAbsences){
    try{const [as,us]=await Promise.all([getDocs(collection(db,'absences')),getDocs(collection(db,'users'))]);absences=as.docs.map(d=>({id:d.id,...d.data()}));employees=us.docs.map(d=>({id:d.id,...d.data()})).filter(u=>u.active!==false).sort((a,b)=>(a.name||'').localeCompare(b.name||'','de'))}catch(e){console.error(e)}
  }
  const ownAbs=absences.filter(x=>x.userId===ctx.profile.id),directVacationDays=ownAbs.filter(x=>x.type==='vacation'&&absenceActive(x)).reduce((a,x)=>a+Number(x.days||0),0);
  const approved=own.filter(x=>x.status==="approved").reduce((a,x)=>a+Number(x.days||0),0)+directVacationDays,pending=own.filter(x=>x.status==="pending").reduce((a,x)=>a+Number(x.days||0),0);
  const sick=ownAbs.filter(x=>x.type==='sick'&&absenceActive(x)).reduce((a,x)=>a+Number(x.days||0),0);
  const pendingTeam=team.filter(v=>v.status==='pending');
  const withdrawnTeam=team.filter(v=>v.status==='withdrawn'&&!v.withdrawalAcknowledgedAt);

  const hrBlock=canManageAbsences?`<article class="card"><div class="card-head"><div><h2>Abwesenheit buchen</h2><p>Urlaub, Krankheit und weitere Abwesenheiten direkt durch die Personalabteilung erfassen. Urlaub gilt sofort und benötigt keine zusätzliche Freigabe.</p></div></div>
    <form id="absence-form" class="form-grid">
      <label class="field"><span>Mitarbeiter</span><select name="userId" required><option value="">– auswählen –</option>${employees.map(u=>`<option value="${esc(u.id)}">${esc(u.name||u.email||u.id)}</option>`).join('')}</select></label>
      <label class="field"><span>Art</span><select name="type">${ABSENCE_TYPES.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label>
      <label class="field"><span>Von</span><input name="from" type="date" required></label><label class="field"><span>Bis</span><input name="to" type="date" required></label>
      <label class="field"><span>eAU / Nachweis</span><select name="certificateStatus"><option value="">– keine Angabe –</option><option value="required">erforderlich / offen</option><option value="checked">geprüft</option><option value="not_required">nicht erforderlich</option></select></label>
      <label class="field"><span>Bemerkung</span><input name="note" placeholder="optional"></label>
      <div class="field full"><div class="info-strip">Direkt gebuchter Urlaub gilt sofort als genehmigt und wird nur protokolliert. Er kann bei einem Irrtum zurückgezogen werden. Bitte bei Krankheitsbuchungen keine Diagnosen oder medizinischen Details eintragen.</div><button class="btn primary">Abwesenheit buchen</button></div>
    </form></article>
    <article class="card"><div class="card-head"><div><h2>Gebuchte Abwesenheiten</h2><p>Direkt durch die Personalabteilung erfasste Abwesenheiten. Zurückgezogener Urlaub bleibt als Protokolleintrag erhalten.</p></div></div>
    <div class="table-wrap"><table><thead><tr><th>Mitarbeiter</th><th>Art</th><th>Zeitraum</th><th>Tage</th><th>Nachweis / Status</th><th></th></tr></thead><tbody>${absences.length?absences.sort((a,b)=>(b.from||'').localeCompare(a.from||'')).map(a=>`<tr><td>${esc(a.userName||'–')}</td><td><strong>${esc(typeLabel(a.type))}</strong></td><td>${fmtDate(a.from)} – ${fmtDate(a.to)}</td><td>${a.days||0}</td><td>${a.type==='vacation'?(a.status==='withdrawn'?`Zurückgezogen${a.withdrawnAt?` · ${fmtDateTime(a.withdrawnAt)}`:''}`:'Sofort gültig') : esc(a.certificateStatus==='checked'?'geprüft':a.certificateStatus==='required'?'offen':a.certificateStatus==='not_required'?'nicht erforderlich':'–')}</td><td>${a.type==='vacation'?(a.status==='withdrawn'?'<span class="muted">protokolliert</span>':`<button class="btn danger small withdraw-direct-vacation" data-id="${a.id}">Zurückziehen</button>`):`<button class="btn danger small delete-absence" data-id="${a.id}">Löschen</button>`}</td></tr>`).join(''):'<tr><td colspan="6" class="empty">Noch keine Abwesenheiten gebucht.</td></tr>'}</tbody></table></div></article>`:'';

  const vacationYear=new Date().getFullYear(),vacBalance=vacationYear>=2026?vacationYearBalance(ctx.profile,own,carryoverSettings,vacationYear,{absences:ownAbs}):null;
  el.innerHTML=`<div class="kpi-grid three ${isAdmin?"admin-self-hidden":""}"><div class="kpi"><span>Anspruch</span><strong>${ctx.profile.vacationDays||30}</strong><small>Urlaubstage</small></div><div class="kpi"><span>Genehmigt</span><strong>${approved}</strong><small>Urlaubstage</small></div><div class="kpi"><span>${canManageAbsences?'Eigene Krankheit':'Beantragt'}</span><strong>${canManageAbsences?sick:pending}</strong><small>Tage</small></div></div>${vacBalance&&!isAdmin?`<div class="info-strip"><strong>Resturlaub ${vacationYear}:</strong> ${vacBalance.carryover} Tage aus ${vacationYear-1} übertragen · ${vacBalance.carryoverUsed} Tage davon bereits genutzt · ${vacBalance.carryoverRemaining} Tage noch verfügbar${vacBalance.expired?` · ${vacBalance.expired} Tage verfallen`:''}. Frist: ${fmtDate(vacBalance.expiry)}. Genehmigter Urlaub bis zur Frist wird automatisch zuerst auf den Resturlaub angerechnet.</div>`:''}
    ${hrBlock}
    <div class="two-col ${isAdmin?"admin-self-hidden":""}"><article class="card"><div class="card-head"><div><h2>Urlaub / Abwesenheit beantragen</h2><p>Antrag wird dem zugeordneten Vorgesetzten bereitgestellt.</p></div></div><form id="vac-form" class="form-grid"><label class="field"><span>Von</span><input name="from" type="date" required></label><label class="field"><span>Bis</span><input name="to" type="date" required></label><label class="field"><span>Art</span><select name="type"><option>Urlaub</option><option>Freizeitausgleich</option><option>Sonderurlaub</option><option>Berufsschule</option><option>Weiterbildung</option><option>Uni</option></select></label><label class="field"><span>Bemerkung</span><input name="note"></label><div class="field full"><button class="btn primary">Antrag senden</button></div></form></article>
    <article class="card"><div class="card-head"><div><h2>Meine Anträge</h2><p>Offene und genehmigte Anträge können zurückgezogen werden; der Vorgang bleibt dokumentiert.</p></div></div>${own.length?own.map(v=>`<div class="list-row vacation-request-row"><div><strong>${fmtDate(v.from)} – ${fmtDate(v.to)}</strong><span>${esc(v.type||'Urlaub')} · ${v.days||0} Tage</span>${vacationHistory(v)}</div><div class="actions">${vacationStatus(v)}${['pending','approved'].includes(v.status)?`<button class="btn small danger withdraw-vacation" type="button" data-id="${v.id}">Antrag zurückziehen</button>`:''}</div></div>`).join(""):`<div class="empty">Keine Anträge vorhanden.</div>`}</article></div>
    ${canApprove?`<article class="card"><div class="card-head"><div><h2>Urlaubsfreigaben</h2><p>Offene Anträge der zugeordneten Mitarbeiter sowie zurückgezogene Anträge zur Kenntnisnahme.</p></div></div><div id="approval-list">
      ${withdrawnTeam.length?`<div class="info-strip"><strong>${withdrawnTeam.length} zurückgezogene${withdrawnTeam.length===1?'r':''} Antrag${withdrawnTeam.length===1?'':'e'}</strong> wartet/warten auf Kenntnisnahme.</div>${withdrawnTeam.map(v=>`<div class="approval-row withdrawn-vacation-row"><div><strong>${esc(v.userName||v.userId)}</strong><span>${fmtDate(v.from)} – ${fmtDate(v.to)} · ${v.days||0} Tage · zurückgezogen</span>${vacationHistory(v)}</div><div class="actions"><button class="btn small secondary acknowledge-withdrawal" data-id="${v.id}">Zur Kenntnis genommen</button></div></div>`).join('')}`:''}
      ${pendingTeam.length?pendingTeam.map(v=>`<div class="approval-row"><div><strong>${esc(v.userName||v.userId)}</strong><span>${fmtDate(v.from)} – ${fmtDate(v.to)} · ${v.days||0} Tage</span>${v.note?`<small>${esc(v.note)}</small>`:''}</div><div class="actions"><button class="btn small approve" data-id="${v.id}">Genehmigen</button><button class="btn small danger reject" data-id="${v.id}">Ablehnen</button></div></div>`).join(""):(withdrawnTeam.length?'':'<div class="empty">Keine offenen Freigaben.</div>')}
    </div></article>`:''}`;

  const vacForm=el.querySelector('#vac-form');if(vacForm)vacForm.onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),d=Object.fromEntries(f.entries());if(d.to<d.from){toast("Der Bis-Termin liegt vor dem Von-Termin.");return}const ownSupervisors=supervisorIdsOf(ctx.profile);if(!ownSupervisors.length){toast('Für diesen Benutzer ist kein Vorgesetzter hinterlegt. Der Antrag kann derzeit nicht weitergeleitet werden.','error');return}await addDoc(collection(db,"vacationRequests"),{...d,days:workdays(d.from,d.to,ctx.profile.workDays),userId:ctx.profile.id,userName:ctx.profile.name||ctx.profile.email,companyId:ctx.profile.companyId,supervisorId:ctx.profile.supervisorId||null,supervisorId2:ctx.profile.supervisorId2||null,status:"pending",createdAt:serverTimestamp()});toast("Urlaubsantrag gesendet.");renderUrlaub(el,ctx)};
  el.querySelectorAll(".approve,.reject").forEach(b=>b.onclick=async()=>{await updateDoc(doc(db,"vacationRequests",b.dataset.id),{status:b.classList.contains("approve")?"approved":"rejected",decidedBy:ctx.profile.id,decidedByName:ctx.profile.name||ctx.profile.email||'',decidedAt:serverTimestamp()});toast("Antrag bearbeitet.");renderUrlaub(el,ctx)});
  el.querySelectorAll('.withdraw-vacation').forEach(b=>b.onclick=async()=>{if(!confirm('Diesen Urlaubsantrag wirklich zurückziehen? Der Vorgang bleibt dokumentiert und der Vorgesetzte wird informiert.'))return;await updateDoc(doc(db,'vacationRequests',b.dataset.id),{status:'withdrawn',withdrawnAt:serverTimestamp(),withdrawnBy:ctx.profile.id,withdrawnByName:ctx.profile.name||ctx.profile.email||''});toast('Urlaubsantrag zurückgezogen.');renderUrlaub(el,ctx)});
  el.querySelectorAll('.acknowledge-withdrawal').forEach(b=>b.onclick=async()=>{await updateDoc(doc(db,'vacationRequests',b.dataset.id),{withdrawalAcknowledgedAt:serverTimestamp(),withdrawalAcknowledgedBy:ctx.profile.id,withdrawalAcknowledgedByName:ctx.profile.name||ctx.profile.email||''});toast('Rücknahme zur Kenntnis genommen.');renderUrlaub(el,ctx)});
  const af=el.querySelector('#absence-form');if(af)af.onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,user=employees.find(u=>u.id===f.elements.userId.value);if(!user)return;if(f.elements.to.value<f.elements.from.value){toast('Der Bis-Termin liegt vor dem Von-Termin.','error');return}const days=workdays(f.elements.from.value,f.elements.to.value,user.workDays);const type=f.elements.type.value;await addDoc(collection(db,'absences'),{userId:user.id,userName:user.name||user.email||user.id,companyId:user.companyId||'',supervisorId:user.supervisorId||null,supervisorId2:user.supervisorId2||null,type,from:f.elements.from.value,to:f.elements.to.value,days,certificateStatus:type==='vacation'?'':f.elements.certificateStatus.value,note:f.elements.note.value.trim(),status:type==='vacation'?'active':null,source:'hr_direct',createdBy:ctx.profile.id,createdByName:ctx.profile.name||ctx.profile.email||'',createdAt:serverTimestamp()});toast(type==='vacation'?'Urlaub sofort gültig gebucht.':'Abwesenheit gebucht.');renderUrlaub(el,ctx)};
  el.querySelectorAll('.withdraw-direct-vacation').forEach(b=>b.onclick=async()=>{if(!confirm('Diesen direkt gebuchten Urlaub wirklich zurückziehen? Der Vorgang bleibt zur Nachvollziehbarkeit protokolliert.'))return;await updateDoc(doc(db,'absences',b.dataset.id),{status:'withdrawn',withdrawnAt:serverTimestamp(),withdrawnBy:ctx.profile.id,withdrawnByName:ctx.profile.name||ctx.profile.email||''});toast('Direkt gebuchter Urlaub zurückgezogen.');renderUrlaub(el,ctx)});
  el.querySelectorAll('.delete-absence').forEach(b=>b.onclick=async()=>{if(!confirm('Diese Abwesenheitsbuchung wirklich löschen?'))return;await deleteDoc(doc(db,'absences',b.dataset.id));toast('Abwesenheit gelöscht.');renderUrlaub(el,ctx)});
}
