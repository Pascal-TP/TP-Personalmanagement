import { db } from "./firebase.js";
import { collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setHead } from "./app.js";
import { esc, toast } from "./utils.js";
import { hasAdminPermission } from "./permissions.js";

const PDS_HEADERS=['kostenstelle','kostenstelleSek','kostentraeger','kostenart','leistungsart','buchungsperiode','belegnummer','belegdatum','betrag','buchungstext','menge','bucher','datenart','planvariante','notiz','kostentraegerSek'];
function toDate(value){if(!value)return null;if(value?.toDate)return value.toDate();const d=new Date(value);return Number.isNaN(d.getTime())?null:d}
function dateKey(d){const p=v=>String(v).padStart(2,"0");return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`}
function grossMinutes(r){const a=toDate(r.startAt),b=toDate(r.endAt);return a&&b&&b>a?Math.round((b-a)/60000):0}
function csvCell(v){const s=String(v??"");return /[;"\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
function download(name,text){const blob=new Blob(["\ufeff"+text],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function isoWeek(d){const x=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));const day=x.getUTCDay()||7;x.setUTCDate(x.getUTCDate()+4-day);const yearStart=new Date(Date.UTC(x.getUTCFullYear(),0,1));return Math.ceil((((x-yearStart)/86400000)+1)/7)}
function deDate(d){return new Intl.DateTimeFormat('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'}).format(d)}
function monthBounds(period){const m=/^(\d{4})-(\d{2})$/.exec(period||'');if(!m)return null;const y=Number(m[1]),mo=Number(m[2]);const from=`${m[1]}-${m[2]}-01`;const last=new Date(y,mo,0);return {year:y,month:mo,from,to:dateKey(last),label:`${m[1]}/${m[2]}`}}
function buildBookingText(settings,period,createdAt){const prefix=String(settings.bookingTextPrefix??'$7$ZeitDritts$');if(settings.bookingTextMode==='free')return `${prefix}${String(settings.bookingTextCustom||'')}`;return `${prefix}Periode${period.label}KW${String(isoWeek(createdAt)).padStart(2,'0')}`}

function allocateNetProjectMinutes(records,from,to){
  const byDay=new Map();
  records.filter(r=>r.recordType!=="adjustment"&&r.status==="closed"&&/^\d{6}$/.test(String(r.projectNumber||""))).forEach(r=>{
    const start=toDate(r.startAt);if(!start)return;const dk=dateKey(start);if(dk<from||dk>to)return;const g=grossMinutes(r);if(g<=0)return;
    const key=`${r.userId}|${dk}`;if(!byDay.has(key))byDay.set(key,[]);byDay.get(key).push({...r,_gross:g});
  });
  const out=[];
  for(const segments of byDay.values()){
    const totalGross=segments.reduce((s,r)=>s+r._gross,0),pause=totalGross>540?45:totalGross>360?30:0;let assigned=0;
    segments.forEach((r,i)=>{const share=i===segments.length-1?pause-assigned:Math.round(pause*(r._gross/totalGross));assigned+=share;out.push({...r,_net:Math.max(0,r._gross-share)})});
  }
  // Admin-Korrekturbuchungen mit Projektnummer sind bereits Netto-Minuten und
  // werden zusätzlich dem Projekt zugeordnet. Ohne Projektnummer bleiben sie
  // reine Stundenkonto-Korrekturen und erscheinen nicht im PDS-Projektexport.
  records.filter(r=>r.recordType==="adjustment"&&/^\d{6}$/.test(String(r.projectNumber||""))).forEach(r=>{
    const dk=String(r.adjustmentDate||"");
    if(dk<from||dk>to)return;
    const minutes=Math.round(Number(r.adjustmentMinutes)||0);
    if(minutes===0)return;
    out.push({...r,_net:minutes});
  });
  return out;
}

function buildPdsExport(records,users,companies,areas,settings,period,createdAt){
  const userMap=new Map(users.map(u=>[u.id,u])),companyMap=new Map(companies.map(c=>[c.id,c])),areaMap=new Map(areas.map(a=>[a.id,a]));
  const allocated=allocateNetProjectMinutes(records,period.from,period.to),groups=new Map(),errors=[];
  allocated.forEach(r=>{
    const u=userMap.get(r.userId)||{},c=companyMap.get(r.companyId||u.companyId)||{};
    const recordCompany=String(r.companyNumber||'').trim(),currentCompany=String(c.companyNumber||'').trim();
    const companyNumber=/^\d{2}$/.test(recordCompany)?recordCompany:currentCompany;
    const recordEmployee=String(r.employeeNumber||'').trim(),currentEmployee=String(u.employeeNumber||'').trim();
    const employeeNumber=/^\d{5}$/.test(recordEmployee)?recordEmployee:currentEmployee;
    const areaById=areaMap.get(u.businessAreaId||'');
    const recordArea=String(r.companyAreaNumber||'').trim(),currentArea=String(u.companyAreaNumber||areaById?.code||'').trim();
    const areaNumber=/^\d{3}$/.test(recordArea)?recordArea:currentArea;
    const projectNumber=String(r.projectNumber||'').trim();
    const validation=[];
    if(!/^\d{2}$/.test(companyNumber))validation.push('Firmennummer fehlt/ungültig (2 Stellen)');
    if(!/^\d{3}$/.test(areaNumber))validation.push('Geschäftsbereich fehlt/ungültig (3 Stellen)');
    if(!/^\d{5}$/.test(employeeNumber))validation.push('Mitarbeiternummer fehlt/ungültig (5 Stellen)');
    if(!/^\d{6}$/.test(projectNumber))validation.push('Projektnummer fehlt/ungültig (6 Stellen)');
    if(validation.length){errors.push({userName:r.userName||u.name||r.userId,projectNumber,issues:validation});return}
    const intercompanyNumber=companyNumber; // V1.6: eigener Mandant für den reinen Stundenimport
    const kostentraeger=`${companyNumber}${areaNumber}${intercompanyNumber}${projectNumber}`;
    const kostenart=`${settings.personnelCostPrefix||'60'}${employeeNumber}`;
    const key=[kostentraeger,kostenart,r.userId].join('|');
    if(!groups.has(key))groups.set(key,{kostentraeger,kostenart,companyNumber,areaNumber,intercompanyNumber,projectNumber,employeeNumber,userName:r.userName||u.name||'',minutes:0});
    groups.get(key).minutes+=r._net;
  });
  const bookingText=buildBookingText(settings,period,createdAt),belegdatum=deDate(createdAt),dataType=String(settings.dataType||'i');
  const rows=[...groups.values()].sort((a,b)=>`${a.kostentraeger}${a.kostenart}`.localeCompare(`${b.kostentraeger}${b.kostenart}`)).map(g=>({
    ...g,buchungsperiode:period.label,belegdatum,buchungstext:bookingText,menge:(g.minutes/60).toFixed(2).replace('.',','),datenart:dataType
  }));
  return {rows,errors};
}
function pdsCsv(rows){return [PDS_HEADERS.join(';'),...rows.map(r=>['','',r.kostentraeger,r.kostenart,'',r.buchungsperiode,'',r.belegdatum,'',r.buchungstext,r.menge,'',r.datenart,'','',''].map(csvCell).join(';'))].join('\r\n')}

export async function renderAuswertungen(el,ctx){
  setHead('Auswertungen','Übergreifende Übersicht und fertiger PDS-Zeiterfassungsexport.');
  const [u,t,v,c,tr,a,pdsDoc]=await Promise.all([getDocs(collection(db,'users')),getDocs(collection(db,'trainings')),getDocs(collection(db,'vacationRequests')),getDocs(collection(db,'companies')),getDocs(collection(db,'timeRecords')),getDocs(collection(db,'businessAreas')),getDoc(doc(db,'pdsSettings','default'))]);
  let users=u.docs.map(d=>({id:d.id,...d.data()}));const companies=c.docs.map(d=>({id:d.id,...d.data()})),records=tr.docs.map(d=>({id:d.id,...d.data()})),areas=a.docs.map(d=>({id:d.id,...d.data()}));
  const settings={personnelCostPrefix:'60',bookingTextPrefix:'$7$ZeitDritts$',bookingTextMode:'period_week',bookingTextCustom:'',dataType:'i',...(pdsDoc.exists()?pdsDoc.data():{})};
  if(ctx.profile.role==='supervisor')users=users.filter(x=>x.id===ctx.profile.id||x.supervisorId===ctx.profile.id);
  const canHoursExport=hasAdminPermission(ctx.profile,'hoursExport');
  const active=users.filter(x=>x.active!==false).length,pending=v.docs.map(d=>d.data()).filter(x=>x.status==='pending'&&(ctx.profile.role==='admin'||x.supervisorId===ctx.profile.id)).length;
  const now=new Date(),p=n=>String(n).padStart(2,'0'),periodDefault=`${now.getFullYear()}-${p(now.getMonth()+1)}`;
  el.innerHTML=`<div class="kpi-grid three"><div class="kpi"><span>Aktive Mitarbeiter</span><strong>${active}</strong><small>im sichtbaren Bereich</small></div><div class="kpi"><span>Schulungen</span><strong>${t.size}</strong><small>im System angelegt</small></div><div class="kpi"><span>Offene Urlaubsfreigaben</span><strong>${pending}</strong><small>aktuell zu bearbeiten</small></div></div>
  ${canHoursExport?`<article class="card"><div class="card-head"><div><h2>PDS-Zeiterfassungsexport</h2><p>Projektzeiten automatisch im vorgegebenen 16-spaltigen PDS-Importformat erzeugen.</p></div></div>
    <div class="info-strip"><strong>Exportlogik:</strong> Kostenträger = Firma (2) + Geschäftsbereich (3) + IC-Firma (2) + Projekt (6). In V1.6 wird für den reinen Stundenimport die eigene Firmennummer auch als IC-Firma verwendet. Kostenart = <strong>${esc(settings.personnelCostPrefix||'60')}</strong> + fünfstellige Mitarbeiternummer. Die Pause wird pro Tag einmal ermittelt und anteilig auf die Projektzeiten verteilt.</div>
    <form id="pds-export-form" class="form-grid"><label class="field"><span>Buchungsperiode</span><input name="period" type="month" value="${periodDefault}" required></label><div class="field"><span>Aktueller Buchungstext</span><div class="readonly-box" id="pds-booking-text"></div></div><div class="field full actions"><button class="btn secondary" type="button" id="pds-preview">PDS-Vorschau erzeugen</button><button class="btn primary" type="button" id="pds-download">CSV für PDS herunterladen</button></div></form>
    <div id="pds-export-result" class="table-wrap"></div></article>`:''}
  <article class="card"><div class="card-head"><div><h2>Weitere Auswertungen</h2><p>Dieser Bereich bleibt modular erweiterbar.</p></div></div><div class="info-strip">Später können hier u. a. Arbeitszeitkonten, Fehlzeiten, Urlaub, Schulungsquoten, Personalbewegungen und firmenbezogene Kennzahlen ergänzt werden.</div></article>`;
  if(!canHoursExport)return;
  const form=el.querySelector('#pds-export-form'),result=el.querySelector('#pds-export-result'),booking=el.querySelector('#pds-booking-text');
  function currentPeriod(){return monthBounds(form.elements.period.value)}
  function refreshBooking(){const period=currentPeriod();booking.textContent=period?buildBookingText(settings,period,new Date()):'–'}
  form.elements.period.onchange=refreshBooking;refreshBooking();
  const build=()=>{const period=currentPeriod();if(!period)return {rows:[],errors:[{userName:'Export',projectNumber:'',issues:['Ungültige Buchungsperiode']}],period:null};return {...buildPdsExport(records,users,companies,areas,settings,period,new Date()),period}};
  const render=()=>{const data=build();const errorHtml=data.errors.length?`<div class="warning-box"><strong>${data.errors.length} Buchung(en) können nicht exportiert werden.</strong><span>Bitte die Stammdaten korrigieren. Die CSV wird erst erzeugt, wenn alle betroffenen Projektzeiten vollständig zugeordnet sind.</span></div><div class="table-wrap"><table><thead><tr><th>Mitarbeiter</th><th>Projekt</th><th>Fehler</th></tr></thead><tbody>${data.errors.map(x=>`<tr><td>${esc(x.userName)}</td><td>${esc(x.projectNumber||'–')}</td><td>${esc(x.issues.join('; '))}</td></tr>`).join('')}</tbody></table></div>`:'';
    const rowsHtml=data.rows.length?`<div class="payroll-preview-summary"><span class="pill green">${data.rows.length} PDS-Buchungszeilen</span><span class="pill blue">Periode ${esc(data.period?.label||'')}</span></div><table><thead><tr><th>Kostenträger</th><th>Kostenart</th><th>Mitarbeiter</th><th>Projekt</th><th>Menge</th><th>Buchungstext</th></tr></thead><tbody>${data.rows.map(r=>`<tr><td><strong>${esc(r.kostentraeger)}</strong><div class="small muted">${esc(r.companyNumber)} · ${esc(r.areaNumber)} · ${esc(r.intercompanyNumber)} · ${esc(r.projectNumber)}</div></td><td>${esc(r.kostenart)}</td><td>${esc(r.userName)}<div class="small muted">MA ${esc(r.employeeNumber)}</div></td><td>${esc(r.projectNumber)}</td><td>${esc(r.menge)} h</td><td>${esc(r.buchungstext)}</td></tr>`).join('')}</tbody></table>`:`<div class="empty">Für diese Buchungsperiode liegen keine abgeschlossenen projektbezogenen Buchungen vor.</div>`;
    result.innerHTML=errorHtml+rowsHtml;return data};
  el.querySelector('#pds-preview').onclick=render;
  el.querySelector('#pds-download').onclick=()=>{const data=render();if(data.errors.length){toast('CSV nicht erstellt: Bitte zuerst die angezeigten Stammdatenfehler korrigieren.','error');return}if(!data.rows.length){toast('Keine Daten für den Export vorhanden.');return}const created=new Date(),period=data.period;download(`PDS_Zeiten_${period.label.replace('/','-')}_${dateKey(created)}.csv`,pdsCsv(data.rows));toast('PDS-CSV wurde erstellt.')};
}
