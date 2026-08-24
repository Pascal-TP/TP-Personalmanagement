import { db } from "./firebase.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setHead } from "./app.js";
import { esc, toast } from "./utils.js";

function toDate(value){if(!value)return null;if(value?.toDate)return value.toDate();const d=new Date(value);return Number.isNaN(d.getTime())?null:d}
function dateKey(d){const p=v=>String(v).padStart(2,"0");return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`}
function grossMinutes(r){const a=toDate(r.startAt),b=toDate(r.endAt);return a&&b&&b>a?Math.round((b-a)/60000):0}
function csvCell(v){const s=String(v??"");return /[;"\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
function download(name,text){const blob=new Blob(["\ufeff"+text],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}

function buildPdsRows(records,users,companies,from,to){
  const byDay=new Map();
  records.filter(r=>r.recordType!=="adjustment"&&r.status==="closed"&&/^\d{6}$/.test(String(r.projectNumber||""))).forEach(r=>{
    const start=toDate(r.startAt);if(!start)return;const dk=dateKey(start);if(dk<from||dk>to)return;
    const g=grossMinutes(r);if(g<=0)return;
    if(!byDay.has(`${r.userId}|${dk}`))byDay.set(`${r.userId}|${dk}`,[]);
    byDay.get(`${r.userId}|${dk}`).push({...r,_gross:g});
  });
  const allocated=[];
  for(const segments of byDay.values()){
    const totalGross=segments.reduce((s,r)=>s+r._gross,0);
    const pause=totalGross>540?45:totalGross>360?30:0;
    let assignedPause=0;
    segments.forEach((r,i)=>{
      const share=i===segments.length-1?pause-assignedPause:Math.round(pause*(r._gross/totalGross));assignedPause+=share;
      allocated.push({...r,_net:Math.max(0,r._gross-share)});
    });
  }
  const userMap=new Map(users.map(u=>[u.id,u])),companyMap=new Map(companies.map(c=>[c.id,c]));
  const groups=new Map();
  allocated.forEach(r=>{
    const u=userMap.get(r.userId)||{},c=companyMap.get(r.companyId)||{};
    const companyNumber=String(r.companyNumber||c.companyNumber||"");
    const employeeNumber=String(r.employeeNumber||u.employeeNumber||"");
    const areaNumber=String(r.companyAreaNumber||u.companyAreaNumber||"");
    const projectNumber=String(r.projectNumber||"");
    const key=[companyNumber,areaNumber,projectNumber,employeeNumber,r.userId].join("|");
    if(!groups.has(key))groups.set(key,{companyNumber,areaNumber,projectNumber,employeeNumber,userName:r.userName||u.name||"",minutes:0});
    groups.get(key).minutes+=r._net;
  });
  return [...groups.values()].sort((a,b)=>`${a.companyNumber}${a.projectNumber}${a.employeeNumber}`.localeCompare(`${b.companyNumber}${b.projectNumber}${b.employeeNumber}`));
}

export async function renderAuswertungen(el,ctx){
  setHead('Auswertungen','Übergreifende Übersicht und vorbereiteter PDS-Zeiterfassungsexport.');
  const [u,t,v,c,tr]=await Promise.all([getDocs(collection(db,'users')),getDocs(collection(db,'trainings')),getDocs(collection(db,'vacationRequests')),getDocs(collection(db,'companies')),getDocs(collection(db,'timeRecords'))]);
  let users=u.docs.map(d=>({id:d.id,...d.data()}));const companies=c.docs.map(d=>({id:d.id,...d.data()}));const records=tr.docs.map(d=>({id:d.id,...d.data()}));
  if(ctx.profile.role==='supervisor')users=users.filter(x=>x.id===ctx.profile.id||x.supervisorId===ctx.profile.id);
  const active=users.filter(x=>x.active!==false).length,pending=v.docs.map(d=>d.data()).filter(x=>x.status==='pending'&&(ctx.profile.role==='admin'||x.supervisorId===ctx.profile.id)).length;
  const now=new Date(),p=n=>String(n).padStart(2,'0'),today=`${now.getFullYear()}-${p(now.getMonth()+1)}-${p(now.getDate())}`,first=`${now.getFullYear()}-${p(now.getMonth()+1)}-01`;
  el.innerHTML=`<div class="kpi-grid three"><div class="kpi"><span>Aktive Mitarbeiter</span><strong>${active}</strong><small>im sichtbaren Bereich</small></div><div class="kpi"><span>Schulungen</span><strong>${t.size}</strong><small>im System angelegt</small></div><div class="kpi"><span>Offene Urlaubsfreigaben</span><strong>${pending}</strong><small>aktuell zu bearbeiten</small></div></div>
  ${ctx.profile.role==='admin'?`<article class="card"><div class="card-head"><div><h2>PDS-Zeiterfassungsexport</h2><p>Projektzeiten nach Firma, Firmenbereich, Projekt und Mitarbeiter zusammenfassen.</p></div></div><div class="info-strip"><strong>Vorläufiger Export:</strong> Das endgültige Nummern- und CSV-Format folgt noch von der Personalabteilung. Aktuell werden Tagespausen einmal pro Tag ermittelt und proportional auf die Projektsegmente verteilt.</div><form id="pds-export-form" class="form-grid"><label class="field"><span>Von</span><input name="from" type="date" value="${first}" required></label><label class="field"><span>Bis</span><input name="to" type="date" value="${today}" required></label><div class="field full actions"><button class="btn secondary" type="button" id="pds-preview">Vorschau erzeugen</button><button class="btn primary" type="button" id="pds-download">Vorläufige CSV herunterladen</button></div></form><div id="pds-export-result" class="table-wrap"></div></article>`:''}
  <article class="card"><div class="card-head"><div><h2>Weitere Auswertungen</h2><p>Dieser Bereich bleibt modular erweiterbar.</p></div></div><div class="info-strip">Später können hier u. a. Arbeitszeitkonten, Fehlzeiten, Urlaub, Schulungsquoten, Personalbewegungen und firmenbezogene Kennzahlen ergänzt werden.</div></article>`;
  if(ctx.profile.role!=='admin')return;
  const form=el.querySelector('#pds-export-form'),result=el.querySelector('#pds-export-result');
  const rows=()=>{const fd=new FormData(form);return buildPdsRows(records,users,companies,String(fd.get('from')),String(fd.get('to')))};
  const render=()=>{const data=rows();result.innerHTML=data.length?`<table><thead><tr><th>Firma-Nr.</th><th>Bereich-Nr.</th><th>Projekt-Nr.</th><th>Mitarbeiter-Nr.</th><th>Mitarbeiter</th><th>Stunden</th></tr></thead><tbody>${data.map(r=>`<tr><td>${esc(r.companyNumber||'FEHLT')}</td><td>${esc(r.areaNumber||'FEHLT')}</td><td>${esc(r.projectNumber)}</td><td>${esc(r.employeeNumber||'FEHLT')}</td><td>${esc(r.userName)}</td><td>${(r.minutes/60).toFixed(2).replace('.',',')}</td></tr>`).join('')}</tbody></table>`:`<div class="empty">Für den Zeitraum liegen keine abgeschlossenen projektbezogenen Buchungen vor.</div>`;return data};
  el.querySelector('#pds-preview').onclick=render;
  el.querySelector('#pds-download').onclick=()=>{const data=render();if(!data.length){toast('Keine Daten für den Export vorhanden.');return}const header=['FirmaNr','FirmenbereichNr','ProjektNr','MitarbeiterNr','Stunden'];const lines=[header.join(';'),...data.map(r=>[r.companyNumber,r.areaNumber,r.projectNumber,r.employeeNumber,(r.minutes/60).toFixed(2).replace('.',',')].map(csvCell).join(';'))];download(`PDS_Zeiten_${form.elements.from.value}_${form.elements.to.value}.csv`,lines.join('\r\n'));};
}
