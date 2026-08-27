import { db } from "./firebase.js";
import { collection, addDoc, getDocs, query, where, updateDoc, deleteDoc, doc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setHead } from "./app.js";
import { esc, fmtDate, statusPill, toast } from "./utils.js";
import { hasAdminPermission } from "./permissions.js";

const ABSENCE_TYPES=[
  ['sick','Krank'],['child_sick','Kind krank'],['special_leave','Sonderurlaub'],
  ['unpaid_leave','Unbezahlter Urlaub'],['release','Freistellung'],['parental_leave','Elternzeit'],['other','Sonstige Abwesenheit']
];
function parseDate(s){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||'');return m?new Date(Number(m[1]),Number(m[2])-1,Number(m[3]),12):null}
function workdays(a,b,days=['1','2','3','4','5']){let s=parseDate(a),e=parseDate(b),n=0;if(!s||!e)return 0;const allowed=new Set((days?.length?days:['1','2','3','4','5']).map(String));for(;s<=e;s.setDate(s.getDate()+1))if(allowed.has(String(s.getDay())))n++;return n}
function typeLabel(key){return ABSENCE_TYPES.find(x=>x[0]===key)?.[1]||key||'Abwesenheit'}

export async function renderUrlaub(el,ctx){
  setHead("Urlaub & Abwesenheit","Urlaub beantragen, Abwesenheiten einsehen und Freigaben bearbeiten.");
  const isAdmin=ctx.profile.role==="admin";
  const canApprove=ctx.profile.role==="supervisor"||hasAdminPermission(ctx.profile,"vacationApprove");
  const canManageAbsences=hasAdminPermission(ctx.profile,"absenceManage");
  let own=[],team=[],absences=[],employees=[];
  try{const s=await getDocs(query(collection(db,"vacationRequests"),where("userId","==",ctx.profile.id)));own=s.docs.map(d=>({id:d.id,...d.data()}))}catch{}
  if(canApprove){try{const s=await getDocs(collection(db,"vacationRequests"));team=s.docs.map(d=>({id:d.id,...d.data()})).filter(x=>ctx.profile.role==="admin"||x.supervisorId===ctx.profile.id)}catch{}}
  try{const s=await getDocs(query(collection(db,'absences'),where('userId','==',ctx.profile.id)));absences=s.docs.map(d=>({id:d.id,...d.data()}))}catch{}
  if(canManageAbsences){
    try{const [as,us]=await Promise.all([getDocs(collection(db,'absences')),getDocs(collection(db,'users'))]);absences=as.docs.map(d=>({id:d.id,...d.data()}));employees=us.docs.map(d=>({id:d.id,...d.data()})).filter(u=>u.active!==false).sort((a,b)=>(a.name||'').localeCompare(b.name||'','de'))}catch(e){console.error(e)}
  }
  const approved=own.filter(x=>x.status==="approved").reduce((a,x)=>a+Number(x.days||0),0),pending=own.filter(x=>x.status==="pending").reduce((a,x)=>a+Number(x.days||0),0);
  const ownAbs=absences.filter(x=>x.userId===ctx.profile.id),sick=ownAbs.filter(x=>x.type==='sick').reduce((a,x)=>a+Number(x.days||0),0);
  const hrBlock=canManageAbsences?`<article class="card"><div class="card-head"><div><h2>Abwesenheit buchen</h2><p>Krankheit und weitere Abwesenheiten direkt durch die Personalabteilung erfassen.</p></div></div>
    <form id="absence-form" class="form-grid">
      <label class="field"><span>Mitarbeiter</span><select name="userId" required><option value="">– auswählen –</option>${employees.map(u=>`<option value="${esc(u.id)}">${esc(u.name||u.email||u.id)}</option>`).join('')}</select></label>
      <label class="field"><span>Art</span><select name="type">${ABSENCE_TYPES.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label>
      <label class="field"><span>Von</span><input name="from" type="date" required></label><label class="field"><span>Bis</span><input name="to" type="date" required></label>
      <label class="field"><span>eAU / Nachweis</span><select name="certificateStatus"><option value="">– keine Angabe –</option><option value="required">erforderlich / offen</option><option value="checked">geprüft</option><option value="not_required">nicht erforderlich</option></select></label>
      <label class="field"><span>Bemerkung</span><input name="note" placeholder="optional"></label>
      <div class="field full"><div class="info-strip">Bitte keine Diagnosen oder medizinischen Details eintragen. Für die Zeitwirtschaft genügt die Art und Dauer der Abwesenheit.</div><button class="btn primary">Abwesenheit buchen</button></div>
    </form></article>
    <article class="card"><div class="card-head"><div><h2>Gebuchte Abwesenheiten</h2><p>Direkt durch die Personalabteilung erfasste Fehlzeiten.</p></div></div>
    <div class="table-wrap"><table><thead><tr><th>Mitarbeiter</th><th>Art</th><th>Zeitraum</th><th>Tage</th><th>Nachweis</th><th></th></tr></thead><tbody>${absences.length?absences.sort((a,b)=>(b.from||'').localeCompare(a.from||'')).map(a=>`<tr><td>${esc(a.userName||'–')}</td><td><strong>${esc(typeLabel(a.type))}</strong></td><td>${fmtDate(a.from)} – ${fmtDate(a.to)}</td><td>${a.days||0}</td><td>${esc(a.certificateStatus==='checked'?'geprüft':a.certificateStatus==='required'?'offen':a.certificateStatus==='not_required'?'nicht erforderlich':'–')}</td><td><button class="btn danger small delete-absence" data-id="${a.id}">Löschen</button></td></tr>`).join(''):'<tr><td colspan="6" class="empty">Noch keine Abwesenheiten gebucht.</td></tr>'}</tbody></table></div></article>`:'';
  el.innerHTML=`<div class="kpi-grid three ${isAdmin?"admin-self-hidden":""}"><div class="kpi"><span>Anspruch</span><strong>${ctx.profile.vacationDays||30}</strong><small>Urlaubstage</small></div><div class="kpi"><span>Genehmigt</span><strong>${approved}</strong><small>Urlaubstage</small></div><div class="kpi"><span>${canManageAbsences?'Eigene Krankheit':'Beantragt'}</span><strong>${canManageAbsences?sick:pending}</strong><small>Tage</small></div></div>
    ${hrBlock}
    <div class="two-col ${isAdmin?"admin-self-hidden":""}"><article class="card"><div class="card-head"><div><h2>Urlaub beantragen</h2><p>Antrag wird dem zugeordneten Vorgesetzten bereitgestellt.</p></div></div><form id="vac-form" class="form-grid"><label class="field"><span>Von</span><input name="from" type="date" required></label><label class="field"><span>Bis</span><input name="to" type="date" required></label><label class="field"><span>Art</span><select name="type"><option>Urlaub</option><option>Freizeitausgleich</option><option>Sonderurlaub</option></select></label><label class="field"><span>Bemerkung</span><input name="note"></label><div class="field full"><button class="btn primary">Antrag senden</button></div></form></article>
    <article class="card"><div class="card-head"><div><h2>Meine Anträge</h2></div></div>${own.length?own.map(v=>`<div class="list-row"><div><strong>${fmtDate(v.from)} – ${fmtDate(v.to)}</strong><span>${esc(v.type||'Urlaub')} · ${v.days||0} Tage</span></div>${statusPill(v.status==='approved'?'Genehmigt':v.status==='rejected'?'Abgelehnt':'Beantragt',v.status==='approved'?'green':v.status==='rejected'?'red':'yellow')}</div>`).join(""):`<div class="empty">Keine Anträge vorhanden.</div>`}</article></div>
    ${canApprove?`<article class="card ${isAdmin?"admin-self-hidden":""}"><div class="card-head"><div><h2>Freigaben</h2><p>Urlaubsanträge der zugeordneten Mitarbeiter</p></div></div><div id="approval-list">${team.filter(v=>v.status==='pending').length?team.filter(v=>v.status==='pending').map(v=>`<div class="approval-row"><div><strong>${esc(v.userName||v.userId)}</strong><span>${fmtDate(v.from)} – ${fmtDate(v.to)} · ${v.days||0} Tage</span></div><div class="actions"><button class="btn small approve" data-id="${v.id}">Genehmigen</button><button class="btn small danger reject" data-id="${v.id}">Ablehnen</button></div></div>`).join(""):`<div class="empty">Keine offenen Freigaben.</div>`}</div></article>`:''}`;
  document.getElementById("vac-form").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),d=Object.fromEntries(f.entries());if(d.to<d.from){toast("Der Bis-Termin liegt vor dem Von-Termin.");return}await addDoc(collection(db,"vacationRequests"),{...d,days:workdays(d.from,d.to,ctx.profile.workDays),userId:ctx.profile.id,userName:ctx.profile.name||ctx.profile.email,companyId:ctx.profile.companyId,supervisorId:ctx.profile.supervisorId||null,status:"pending",createdAt:serverTimestamp()});toast("Urlaubsantrag gesendet.");renderUrlaub(el,ctx)};
  el.querySelectorAll(".approve,.reject").forEach(b=>b.onclick=async()=>{await updateDoc(doc(db,"vacationRequests",b.dataset.id),{status:b.classList.contains("approve")?"approved":"rejected",decidedBy:ctx.profile.id,decidedAt:serverTimestamp()});toast("Antrag bearbeitet.");renderUrlaub(el,ctx)});
  const af=el.querySelector('#absence-form');if(af)af.onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,user=employees.find(u=>u.id===f.elements.userId.value);if(!user)return;if(f.elements.to.value<f.elements.from.value){toast('Der Bis-Termin liegt vor dem Von-Termin.','error');return}const days=workdays(f.elements.from.value,f.elements.to.value,user.workDays);await addDoc(collection(db,'absences'),{userId:user.id,userName:user.name||user.email||user.id,companyId:user.companyId||'',supervisorId:user.supervisorId||null,type:f.elements.type.value,from:f.elements.from.value,to:f.elements.to.value,days,certificateStatus:f.elements.certificateStatus.value,note:f.elements.note.value.trim(),source:'hr_direct',createdBy:ctx.profile.id,createdAt:serverTimestamp()});toast('Abwesenheit gebucht.');renderUrlaub(el,ctx)};
  el.querySelectorAll('.delete-absence').forEach(b=>b.onclick=async()=>{if(!confirm('Diese Abwesenheitsbuchung wirklich löschen?'))return;await deleteDoc(doc(db,'absences',b.dataset.id));toast('Abwesenheit gelöscht.');renderUrlaub(el,ctx)});
}
